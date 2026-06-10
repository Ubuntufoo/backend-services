import type { JobRow, Json, ListingPriceResearchRow, ListingRow } from '@ebay-inventory/data';

import type { SidecarDataAccess } from '@/data/sidecar-data.js';
import {
  computePricingConfidence,
  computePricingStats,
  createFixturePricingProvider,
  normalizeSoldComps,
  type LlmPricingPromptFactKey,
  type LlmPricingPromptFacts,
  type PricingAnalyst,
  type PricingAnalystInput,
  type PricingAnalystResult,
  type PricingConfidenceResult,
  type PricingProvider,
  type PricingProviderInput,
  type PricingProviderResult,
  type PricingStatsResult,
} from '@/pricing/index.js';
import {
  classifyJobError,
  JOB_ERROR_CODES,
  SidecarJobError,
  toJobErrorUpdateInput,
} from './job-errors.js';

const DEFAULT_MIN_SOLD_COMPS = 12;
const FIXTURE_PROVIDER_NAME = 'fixture';
const PRICING_MODEL_NAME = 'deterministic-fixture-v1';
const LLM_PRICING_FACT_KEYS: readonly LlmPricingPromptFactKey[] = [
  'Player',
  'Year',
  'Manufacturer',
  'Set',
  'Card Number',
  'Parallel/Variety',
  'Team/Franchise',
] as const;

export interface ResearchPriceJobDependencies {
  computeConfidence?: (input: {
    comps: Parameters<typeof computePricingConfidence>[0]['comps'];
    stats: PricingStatsResult;
  }) => PricingConfidenceResult;
  computeStats?: (comps: Parameters<typeof computePricingStats>[0]) => PricingStatsResult;
  dataAccess: SidecarDataAccess;
  normalizeComps?: typeof normalizeSoldComps;
  now: () => Date;
  pricingAnalyst?: PricingAnalyst;
  pricingProvider?: PricingProvider;
}

export interface RunResearchPriceJobResult {
  job: JobRow;
  listing: ListingRow | null;
}

function asIsoTimestamp(now: () => Date): string {
  return now().toISOString();
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getListingItemSpecifics(
  value: ListingRow['item_specifics']
): PricingProviderInput['itemSpecifics'] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const itemSpecifics = Object.fromEntries(
    Object.entries(value).flatMap(([key, entryValue]) => {
      if (
        entryValue === null ||
        typeof entryValue === 'string' ||
        (Array.isArray(entryValue) && entryValue.every((candidate) => typeof candidate === 'string'))
      ) {
        return [[key, entryValue]];
      }

      return [];
    })
  );

  return Object.keys(itemSpecifics).length > 0 ? itemSpecifics : undefined;
}

function normalizeSuggestedPrice(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  const normalized = Number(value.toFixed(2));

  if (!Number.isFinite(normalized) || normalized <= 0) {
    return null;
  }

  const cents = Math.round(normalized * 100);

  return Number.isSafeInteger(cents) ? normalized : null;
}

function asJson(value: unknown): Json {
  return value as Json;
}

function asCompactErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.replace(/\s+/g, ' ').trim();

  if (normalized.length <= 240) {
    return normalized;
  }

  return `${normalized.slice(0, 237)}...`;
}

function buildPricingProviderInput(listing: ListingRow, listingId: string): PricingProviderInput {
  const itemSpecifics = getListingItemSpecifics(listing.item_specifics);
  const title = asNonEmptyString(listing.title) ?? buildPricingTitleFromItemSpecifics(itemSpecifics) ?? listingId;

  return {
    categoryId: listing.category_id,
    conditionId: listing.condition_id,
    itemSpecifics,
    listingId,
    minSoldComps: DEFAULT_MIN_SOLD_COMPS,
    title,
  };
}

function buildPricingTitleFromItemSpecifics(
  itemSpecifics: PricingProviderInput['itemSpecifics']
): string | undefined {
  if (!itemSpecifics) {
    return undefined;
  }

  const titleParts = [
    itemSpecifics.Player,
    itemSpecifics.Year,
    itemSpecifics.Manufacturer,
    itemSpecifics.Set,
    itemSpecifics['Card Number'],
  ]
    .flatMap((value) => (Array.isArray(value) ? value : value ? [value] : []))
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return titleParts.length > 0 ? titleParts.join(' ') : undefined;
}

function buildLlmPricingFacts(itemSpecifics: PricingProviderInput['itemSpecifics']): LlmPricingPromptFacts | undefined {
  if (!itemSpecifics) {
    return undefined;
  }

  const facts = Object.fromEntries(
    LLM_PRICING_FACT_KEYS.flatMap((key) => {
      const value = itemSpecifics[key];
      const normalized = Array.isArray(value)
        ? value.map((entry) => entry.trim()).filter((entry) => entry.length > 0).join(' / ')
        : value?.trim() ?? '';

      return normalized.length > 0 ? [[key, normalized] as const] : [];
    })
  );

  return Object.keys(facts).length > 0 ? facts : undefined;
}

function buildPricingAnalystInput(
  listing: ListingRow,
  listingId: string,
  comps: Parameters<typeof computePricingStats>[0],
  stats: PricingStatsResult
): PricingAnalystInput {
  const itemSpecifics = getListingItemSpecifics(listing.item_specifics);

  return {
    listing: {
      title:
        asNonEmptyString(listing.title) ?? buildPricingTitleFromItemSpecifics(itemSpecifics) ?? listingId,
      facts: buildLlmPricingFacts(itemSpecifics),
    },
    stats,
    comps: [...comps],
  };
}

function buildSucceededLlmReasoningJson(
  result: PricingAnalystResult,
  fallbackReason: string | null
): Json {
  return asJson({
    fallback: fallbackReason,
    modelName: result.modelName,
    reasoning: result.reasoning,
    status: 'succeeded',
  });
}

function buildFailedLlmReasoningJson(
  analyst: PricingAnalyst,
  fallbackReason: string,
  error: unknown
): Json {
  return asJson({
    analyst: analyst.name,
    error: asCompactErrorMessage(error),
    fallback: fallbackReason,
    status: 'failed',
  });
}

function buildResearchPriceError(
  code:
    | typeof JOB_ERROR_CODES.RESEARCH_PRICE_FAILED
    | typeof JOB_ERROR_CODES.RESEARCH_PRICE_LISTING_NOT_ELIGIBLE
    | typeof JOB_ERROR_CODES.RESEARCH_PRICE_MISSING_LISTING_ID
    | typeof JOB_ERROR_CODES.RESEARCH_PRICE_LISTING_NOT_FOUND
    | typeof JOB_ERROR_CODES.RESEARCH_PRICE_SUGGESTED_PRICE_INVALID,
  message: string,
  context: Record<string, Json> = {}
): SidecarJobError {
  return new SidecarJobError(code, 'terminal', message, context);
}

function resolvePricingProvider(dependencies: ResearchPriceJobDependencies): PricingProvider {
  const pricingProvider = dependencies.pricingProvider ?? createFixturePricingProvider();

  if (pricingProvider.name !== FIXTURE_PROVIDER_NAME) {
    throw buildResearchPriceError(
      JOB_ERROR_CODES.RESEARCH_PRICE_FAILED,
      `Unsupported pricing provider "${pricingProvider.name}" for research_price. Only "${FIXTURE_PROVIDER_NAME}" is supported.`,
      {
        provider: pricingProvider.name,
        supported_provider: FIXTURE_PROVIDER_NAME,
      }
    );
  }

  return pricingProvider;
}

function assertResearchPriceListingEligible(listing: ListingRow): void {
  if (listing.listing_type !== 'single') {
    throw buildResearchPriceError(
      JOB_ERROR_CODES.RESEARCH_PRICE_LISTING_NOT_ELIGIBLE,
      `Listing "${listing.listing_id}" is not eligible for research_price because listing_type is "${listing.listing_type ?? 'null'}".`,
      {
        listing_id: listing.listing_id,
        listing_type: listing.listing_type ?? 'null',
      }
    );
  }

  if (listing.status !== 'needs_review') {
    throw buildResearchPriceError(
      JOB_ERROR_CODES.RESEARCH_PRICE_LISTING_NOT_ELIGIBLE,
      `Listing "${listing.listing_id}" is not eligible for research_price from status "${listing.status}".`,
      {
        listing_id: listing.listing_id,
        status: listing.status,
        sub_status: listing.sub_status ?? 'null',
      }
    );
  }

  if (listing.sub_status !== 'review_pending') {
    throw buildResearchPriceError(
      JOB_ERROR_CODES.RESEARCH_PRICE_LISTING_NOT_ELIGIBLE,
      `Listing "${listing.listing_id}" is not eligible for research_price from sub_status "${listing.sub_status ?? 'null'}".`,
      {
        listing_id: listing.listing_id,
        status: listing.status,
        sub_status: listing.sub_status ?? 'null',
      }
    );
  }
}

async function getListingSafely(
  dataAccess: SidecarDataAccess,
  listingId: string
): Promise<ListingRow | null> {
  try {
    return await dataAccess.listings.getByListingId(listingId);
  } catch {
    return null;
  }
}

async function markResearchFailedSafely(
  dataAccess: SidecarDataAccess,
  research: ListingPriceResearchRow | null,
  error: SidecarJobError,
  providerResult?: PricingProviderResult
): Promise<void> {
  if (!research) {
    return;
  }

  await dataAccess.listingPriceResearch.markFailed({
    error_code: error.code,
    error_message: error.message,
    id: research.id,
    llm_reasoning_json: {},
    pricing_model_name: PRICING_MODEL_NAME,
    raw_result_json: providerResult ? asJson(providerResult.rawResult) : undefined,
  });
}

export async function runResearchPriceJob(
  job: JobRow,
  dependencies: ResearchPriceJobDependencies
): Promise<RunResearchPriceJobResult> {
  const errorAt = asIsoTimestamp(dependencies.now);
  const listingId = asNonEmptyString(job.listing_id);

  if (!listingId) {
    const error = buildResearchPriceError(
      JOB_ERROR_CODES.RESEARCH_PRICE_MISSING_LISTING_ID,
      `Job "${job.id}" is missing listing_id and cannot run research_price.`
    );
    const failedJob = await dependencies.dataAccess.jobs.fail(
      job.id,
      toJobErrorUpdateInput(error, errorAt)
    );

    return {
      job: failedJob,
      listing: null,
    };
  }

  const listing = await dependencies.dataAccess.listings.getByListingId(listingId);

  if (!listing) {
    const error = buildResearchPriceError(
      JOB_ERROR_CODES.RESEARCH_PRICE_LISTING_NOT_FOUND,
      `Listing "${listingId}" was not found for research_price.`
    );
    const failedJob = await dependencies.dataAccess.jobs.fail(
      job.id,
      toJobErrorUpdateInput(error, errorAt)
    );

    return {
      job: failedJob,
      listing: null,
    };
  }

  let pricingProvider: PricingProvider;
  try {
    assertResearchPriceListingEligible(listing);
    pricingProvider = resolvePricingProvider(dependencies);
  } catch (error) {
    const jobError = classifyJobError(job.job_type, error);
    const failedJob = await dependencies.dataAccess.jobs.fail(
      job.id,
      toJobErrorUpdateInput(jobError, errorAt)
    );

    return {
      job: failedJob,
      listing,
    };
  }

  const runNormalizeComps = dependencies.normalizeComps ?? normalizeSoldComps;
  const runComputeStats = dependencies.computeStats ?? computePricingStats;
  const runComputeConfidence = dependencies.computeConfidence ?? computePricingConfidence;
  let research: ListingPriceResearchRow | null = null;
  let researchSucceeded = false;
  let providerResult: PricingProviderResult | undefined;

  try {
    research = await dependencies.dataAccess.listingPriceResearch.create({
      listing_id: listingId,
      provider: FIXTURE_PROVIDER_NAME,
      status: 'pending',
    });

    providerResult = await pricingProvider.fetchSoldComps(buildPricingProviderInput(listing, listingId));

    const normalized = runNormalizeComps(providerResult.soldComps);
    const stats = runComputeStats(normalized.comps);
    const deterministicSuggestedPrice = normalizeSuggestedPrice(stats.deterministicSuggestedPrice);

    if (deterministicSuggestedPrice === null) {
      throw buildResearchPriceError(
        JOB_ERROR_CODES.RESEARCH_PRICE_SUGGESTED_PRICE_INVALID,
        `Listing "${listingId}" did not produce a deterministic suggested price.`
      );
    }

    const confidence = runComputeConfidence({
      comps: normalized.comps,
      stats,
    });

    let llmReasoningJson: Json = {};
    let llmSelectedCompIds: Json = [];
    let llmRejectedCompIds: Json = [];
    let llmPriceExplanation: string | null = null;
    let pricingModelName: string | null = PRICING_MODEL_NAME;
    let llmSuggestedPrice: number | null = null;
    let fallbackReason: string | null = null;

    if (dependencies.pricingAnalyst) {
      try {
        const analystResult = await dependencies.pricingAnalyst.analyze(
          buildPricingAnalystInput(listing, listingId, normalized.comps, stats)
        );

        llmSuggestedPrice = normalizeSuggestedPrice(analystResult.reasoning.suggestedPrice);
        fallbackReason = llmSuggestedPrice === null ? 'llm_suggested_price_null' : null;
        llmReasoningJson = buildSucceededLlmReasoningJson(analystResult, fallbackReason);
        llmSelectedCompIds = asJson(analystResult.reasoning.selectedCompIds);
        llmRejectedCompIds = asJson(analystResult.reasoning.rejectedCompIds);
        llmPriceExplanation = analystResult.reasoning.priceExplanation;
        pricingModelName = analystResult.modelName;
      } catch (error) {
        fallbackReason = 'llm_analysis_failed';
        llmReasoningJson = buildFailedLlmReasoningJson(
          dependencies.pricingAnalyst,
          fallbackReason,
          error
        );
      }
    }

    const finalSuggestedPrice = normalizeSuggestedPrice(
      llmSuggestedPrice ?? deterministicSuggestedPrice
    );

    if (finalSuggestedPrice === null) {
      throw buildResearchPriceError(
        JOB_ERROR_CODES.RESEARCH_PRICE_SUGGESTED_PRICE_INVALID,
        `Listing "${listingId}" did not produce a valid final suggested price.`
      );
    }

    await dependencies.dataAccess.listingPriceResearch.markSucceeded({
      comps: asJson(normalized.comps),
      confidence: confidence.confidence,
      id: research.id,
      llm_price_explanation: llmPriceExplanation,
      llm_reasoning_json: llmReasoningJson,
      llm_rejected_comp_ids: llmRejectedCompIds,
      llm_selected_comp_ids: llmSelectedCompIds,
      median_sold_price: stats.medianSoldPrice,
      pricing_model_name: pricingModelName,
      query: providerResult.query,
      raw_result_json: asJson(providerResult.rawResult),
      sold_count: stats.soldCount,
      suggested_price: finalSuggestedPrice,
    });
    researchSucceeded = true;

    const pricedListing = await dependencies.dataAccess.listings.update(listingId, {
      price: finalSuggestedPrice,
    });

    const completedJob = await dependencies.dataAccess.jobs.complete(job.id);

    return {
      job: completedJob,
      listing: pricedListing,
    };
  } catch (error) {
    let jobError = classifyJobError(job.job_type, error);

    try {
      if (!researchSucceeded) {
        await markResearchFailedSafely(
          dependencies.dataAccess,
          research,
          jobError,
          providerResult
        );
      }
    } catch (cleanupError) {
      jobError = new SidecarJobError(
        jobError.code,
        jobError.category,
        `${jobError.message} Cleanup also failed: ${cleanupError instanceof Error ? cleanupError.message : 'Unknown cleanup error'}`,
        jobError.context,
        { cause: jobError }
      );
    }

    const failedJob = await dependencies.dataAccess.jobs.fail(
      job.id,
      toJobErrorUpdateInput(jobError, errorAt)
    );

    return {
      job: failedJob,
      listing: await getListingSafely(dependencies.dataAccess, listingId),
    };
  }
}
