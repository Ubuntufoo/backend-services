import type { JobRow, Json, ListingPriceResearchRow, ListingRow } from '@ebay-inventory/data';

import type { SidecarDataAccess } from '@/data/sidecar-data.js';
import {
  computePricingConfidence,
  computePricingStats,
  createFixturePricingProvider,
  normalizeSoldComps,
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

export interface ResearchPriceJobDependencies {
  computeConfidence?: (input: {
    comps: Parameters<typeof computePricingConfidence>[0]['comps'];
    stats: PricingStatsResult;
  }) => PricingConfidenceResult;
  computeStats?: (comps: Parameters<typeof computePricingStats>[0]) => PricingStatsResult;
  dataAccess: SidecarDataAccess;
  normalizeComps?: typeof normalizeSoldComps;
  now: () => Date;
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

function isPositiveFiniteNumber(value: number | null): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function asJson(value: unknown): Json {
  return value as Json;
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

function buildResearchPriceEligibilityError(
  code:
    | typeof JOB_ERROR_CODES.RESEARCH_PRICE_LISTING_NOT_ELIGIBLE
    | typeof JOB_ERROR_CODES.RESEARCH_PRICE_MISSING_LISTING_ID
    | typeof JOB_ERROR_CODES.RESEARCH_PRICE_LISTING_NOT_FOUND
    | typeof JOB_ERROR_CODES.RESEARCH_PRICE_SUGGESTED_PRICE_INVALID,
  category: 'terminal' | 'user_fixable',
  message: string
): SidecarJobError {
  return new SidecarJobError(code, category, message);
}

export async function runResearchPriceJob(
  job: JobRow,
  dependencies: ResearchPriceJobDependencies
): Promise<RunResearchPriceJobResult> {
  const errorAt = asIsoTimestamp(dependencies.now);
  const listingId = asNonEmptyString(job.listing_id);

  if (!listingId) {
    const error = buildResearchPriceEligibilityError(
      JOB_ERROR_CODES.RESEARCH_PRICE_MISSING_LISTING_ID,
      'terminal',
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
    const error = buildResearchPriceEligibilityError(
      JOB_ERROR_CODES.RESEARCH_PRICE_LISTING_NOT_FOUND,
      'terminal',
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

  if (listing.listing_type !== 'single') {
    const error = buildResearchPriceEligibilityError(
      JOB_ERROR_CODES.RESEARCH_PRICE_LISTING_NOT_ELIGIBLE,
      'user_fixable',
      `Listing "${listingId}" is not eligible for research_price because listing_type is "${listing.listing_type ?? 'null'}".`
    );
    const failedJob = await dependencies.dataAccess.jobs.fail(
      job.id,
      toJobErrorUpdateInput(error, errorAt)
    );

    return {
      job: failedJob,
      listing,
    };
  }

  if (listing.status !== 'needs_review') {
    const error = buildResearchPriceEligibilityError(
      JOB_ERROR_CODES.RESEARCH_PRICE_LISTING_NOT_ELIGIBLE,
      'user_fixable',
      `Listing "${listingId}" is not eligible for research_price from status "${listing.status}".`
    );
    const failedJob = await dependencies.dataAccess.jobs.fail(
      job.id,
      toJobErrorUpdateInput(error, errorAt)
    );

    return {
      job: failedJob,
      listing,
    };
  }

  const pricingProvider = dependencies.pricingProvider ?? createFixturePricingProvider();
  const runNormalizeComps = dependencies.normalizeComps ?? normalizeSoldComps;
  const runComputeStats = dependencies.computeStats ?? computePricingStats;
  const runComputeConfidence = dependencies.computeConfidence ?? computePricingConfidence;
  let research: ListingPriceResearchRow | null = null;
  let providerResult: PricingProviderResult | undefined;

  try {
    research = await dependencies.dataAccess.listingPriceResearch.create({
      listing_id: listingId,
      provider: FIXTURE_PROVIDER_NAME,
      status: 'pending',
    });

    providerResult = await pricingProvider.fetchSoldComps({
      categoryId: listing.category_id,
      conditionId: listing.condition_id,
      itemSpecifics: getListingItemSpecifics(listing.item_specifics),
      listingId,
      minSoldComps: DEFAULT_MIN_SOLD_COMPS,
      title: listing.title ?? listingId,
    });

    const normalized = runNormalizeComps(providerResult.soldComps);
    const stats = runComputeStats(normalized.comps);

    if (!isPositiveFiniteNumber(stats.deterministicSuggestedPrice)) {
      throw buildResearchPriceEligibilityError(
        JOB_ERROR_CODES.RESEARCH_PRICE_SUGGESTED_PRICE_INVALID,
        'terminal',
        `Listing "${listingId}" did not produce a deterministic suggested price.`
      );
    }

    const confidence = runComputeConfidence({
      comps: normalized.comps,
      stats,
    });

    await dependencies.dataAccess.listingPriceResearch.markSucceeded({
      comps: asJson(normalized.comps),
      confidence: confidence.confidence,
      id: research.id,
      llm_price_explanation: null,
      llm_reasoning_json: {},
      llm_rejected_comp_ids: [],
      llm_selected_comp_ids: [],
      median_sold_price: stats.medianSoldPrice,
      pricing_model_name: PRICING_MODEL_NAME,
      query: providerResult.query,
      raw_result_json: asJson(providerResult.rawResult),
      sold_count: stats.soldCount,
      suggested_price: stats.deterministicSuggestedPrice,
    });

    const pricedListing = await dependencies.dataAccess.listings.update(listingId, {
      price: stats.deterministicSuggestedPrice,
    });

    const completedJob = await dependencies.dataAccess.jobs.complete(job.id);

    return {
      job: completedJob,
      listing: pricedListing,
    };
  } catch (error) {
    let jobError = classifyJobError(job.job_type, error);

    try {
      await markResearchFailedSafely(
        dependencies.dataAccess,
        research,
        jobError,
        providerResult
      );
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
