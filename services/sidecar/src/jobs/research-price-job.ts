import type { JobRow, Json, ListingPriceResearchRow, ListingRow } from '@ebay-inventory/data';

import type { SidecarDataAccess } from '@/data/sidecar-data.js';
import {
  buildPricingProviderInput,
  buildPricingTitleFromItemSpecifics,
  computePricingConfidence,
  computePricingStats,
  createFixturePricingProvider,
  getListingItemSpecifics,
  normalizeSoldComps,
  redactSensitiveText as redactPricingSensitiveText,
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
import { createLogger } from '@/utils/logger.js';
import {
  classifyJobError,
  JOB_ERROR_CODES,
  SidecarJobError,
  toJobErrorUpdateInput,
} from './job-errors.js';

const DEFAULT_MIN_SOLD_COMPS = 12;
const APIFY_PROVIDER_NAME = 'apify';
const FIXTURE_PROVIDER_NAME = 'fixture';
const DEFAULT_PRICING_SERVICE_ENABLED = true;
const PRICING_MODEL_NAME = 'deterministic-fixture-v1';
const SUPPORTED_PRICING_PROVIDER_NAMES = new Set([APIFY_PROVIDER_NAME, FIXTURE_PROVIDER_NAME]);
const jobLogger = createLogger('Job');
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

function isPricingServiceEnabled(
  appSettings: { pricing_service_enabled?: boolean | null } | null | undefined
): boolean {
  return typeof appSettings?.pricing_service_enabled === 'boolean'
    ? appSettings.pricing_service_enabled
    : DEFAULT_PRICING_SERVICE_ENABLED;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function redactSensitiveText(value: string): string {
  return redactPricingSensitiveText(value);
}

function asCompactErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = redactSensitiveText(message).replace(/\s+/g, ' ').trim();

  if (normalized.length <= 240) {
    return normalized;
  }

  return `${normalized.slice(0, 237)}...`;
}

function getPricingMode(
  pricingProvider: PricingProvider,
  pricingAnalyst?: PricingAnalyst
): 'fixture' | 'deterministic' | 'llm_assisted' {
  if (pricingAnalyst) {
    return 'llm_assisted';
  }

  return pricingProvider.name === FIXTURE_PROVIDER_NAME ? 'fixture' : 'deterministic';
}

function getProviderFailureDetails(error: unknown): {
  providerFailureCategory?: string;
  providerFailureCode?: string;
  providerFailureMessage: string;
  provider?: string;
  query?: string;
  workflowSafe?: boolean;
} {
  const providerFailureMessage = asCompactErrorMessage(error);

  if (!isRecord(error)) {
    return { providerFailureMessage };
  }

  return {
    provider: asNonEmptyString(error.provider) ?? asNonEmptyString(error.providerName),
    providerFailureCategory:
      asNonEmptyString(error.category) ?? asNonEmptyString(error.providerFailureCategory),
    providerFailureCode: asNonEmptyString(error.code) ?? asNonEmptyString(error.errorCode),
    providerFailureMessage: asCompactErrorMessage(
      asNonEmptyString(error.providerFailureMessage) ??
        asNonEmptyString(error.errorMessage) ??
        asNonEmptyString(error.message) ??
        providerFailureMessage
    ),
    query: asNonEmptyString(error.query)
      ? redactSensitiveText(asNonEmptyString(error.query)!)
      : undefined,
    workflowSafe: typeof error.workflowSafe === 'boolean' ? error.workflowSafe : undefined,
  };
}

function buildResearchProviderFailureJobError(
  error: unknown,
  fallbackProvider: string
): SidecarJobError {
  const failure = getProviderFailureDetails(error);
  const category =
    failure.providerFailureCategory === 'rate_limit' ||
    failure.providerFailureCategory === 'timeout_network' ||
    failure.providerFailureCategory === 'provider_unavailable'
      ? 'recoverable'
      : failure.providerFailureCategory === 'auth_config'
        ? 'user_fixable'
        : 'terminal';

  return new SidecarJobError(
    JOB_ERROR_CODES.RESEARCH_PRICE_FAILED,
    category,
    failure.providerFailureMessage,
    Object.fromEntries(
      Object.entries({
        provider: failure.provider ?? fallbackProvider,
        provider_failure_category: failure.providerFailureCategory,
        provider_failure_code: failure.providerFailureCode,
        query: failure.query,
        workflow_safe: failure.workflowSafe ?? true,
      }).filter(([, value]) => value !== undefined)
    ) as Record<string, Json>
  );
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
    | typeof JOB_ERROR_CODES.RESEARCH_PRICE_DISABLED
    | typeof JOB_ERROR_CODES.RESEARCH_PRICE_LISTING_NOT_ELIGIBLE
    | typeof JOB_ERROR_CODES.RESEARCH_PRICE_MISSING_LISTING_ID
    | typeof JOB_ERROR_CODES.RESEARCH_PRICE_LISTING_NOT_FOUND
    | typeof JOB_ERROR_CODES.RESEARCH_PRICE_SUGGESTED_PRICE_INVALID,
  message: string,
  context: Record<string, Json> = {}
): SidecarJobError {
  return new SidecarJobError(
    code,
    code === JOB_ERROR_CODES.RESEARCH_PRICE_LISTING_NOT_ELIGIBLE ||
      code === JOB_ERROR_CODES.RESEARCH_PRICE_DISABLED
      ? 'user_fixable'
      : 'terminal',
    message,
    context
  );
}

async function assertPricingServiceEnabled(
  dependencies: ResearchPriceJobDependencies,
  job: JobRow
): Promise<void> {
  const appSettings = await dependencies.dataAccess.appSettings.get();

  if (isPricingServiceEnabled(appSettings)) {
    return;
  }

  throw buildResearchPriceError(
    JOB_ERROR_CODES.RESEARCH_PRICE_DISABLED,
    `Pricing service disabled. research_price skipped for job "${job.id}".`,
    {
      pricing_service_enabled: false,
      settings_source: appSettings ? 'app_settings' : 'default',
      workflow_safe: true,
    }
  );
}

function resolvePricingProvider(dependencies: ResearchPriceJobDependencies): PricingProvider {
  const pricingProvider = dependencies.pricingProvider ?? createFixturePricingProvider();

  if (!SUPPORTED_PRICING_PROVIDER_NAMES.has(pricingProvider.name)) {
    throw buildResearchPriceError(
      JOB_ERROR_CODES.RESEARCH_PRICE_FAILED,
      `Unsupported pricing provider "${pricingProvider.name}" for research_price. Supported providers: ${[...SUPPORTED_PRICING_PROVIDER_NAMES].join(', ')}.`,
      {
        provider: pricingProvider.name,
        supported_providers: [...SUPPORTED_PRICING_PROVIDER_NAMES],
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

export function isResearchPriceListingEligible(listing: ListingRow): boolean {
  try {
    assertResearchPriceListingEligible(listing);
    return true;
  } catch {
    return false;
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

  const failureContext = {
    failure: Object.fromEntries(
      Object.entries({
        category: asNonEmptyString(error.context.provider_failure_category),
        code: asNonEmptyString(error.context.provider_failure_code) ?? error.code,
        message: asCompactErrorMessage(error.message),
        provider: asNonEmptyString(error.context.provider),
        query: asNonEmptyString(error.context.query),
        workflowSafe:
          typeof error.context.workflow_safe === 'boolean' ? error.context.workflow_safe : true,
      }).filter(([, value]) => value !== undefined)
    ),
    ...(providerResult ? { providerResult: providerResult.rawResult } : {}),
  };

  await dataAccess.listingPriceResearch.markFailed({
    error_code: error.code,
    error_message: asCompactErrorMessage(error.message),
    id: research.id,
    llm_reasoning_json: {},
    pricing_model_name: PRICING_MODEL_NAME,
    raw_result_json: asJson(failureContext),
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
    await assertPricingServiceEnabled(dependencies, job);
    assertResearchPriceListingEligible(listing);
    pricingProvider = resolvePricingProvider(dependencies);
  } catch (error) {
    const jobError = classifyJobError(job.job_type, error);
    if (jobError.code === JOB_ERROR_CODES.RESEARCH_PRICE_DISABLED) {
      jobLogger.info('Skipped research_price job because pricing service is disabled.', {
        event: 'research_price_disabled',
        jobId: job.id,
        listingId,
        pricingServiceEnabled: false,
      });
    }
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
  let rawCompCount: number | undefined;
  let normalizedCompCount: number | undefined;

  try {
    jobLogger.info('Started research_price job.', {
      event: 'research_price_started',
      jobId: job.id,
      listingId,
      pricingMode: getPricingMode(pricingProvider, dependencies.pricingAnalyst),
      provider: pricingProvider.name,
    });

    research = await dependencies.dataAccess.listingPriceResearch.create({
      listing_id: listingId,
      provider: pricingProvider.name,
      status: 'pending',
    });

    providerResult = await pricingProvider.fetchSoldComps(
      buildPricingProviderInput(listing, listingId, DEFAULT_MIN_SOLD_COMPS)
    );
    rawCompCount = providerResult.soldComps.length;

    const normalized = runNormalizeComps(providerResult.soldComps);
    normalizedCompCount = normalized.comps.length;
    const stats = runComputeStats(normalized.comps);
    jobLogger.info('Completed research_price provider fetch.', {
      event: 'research_price_provider_result',
      jobId: job.id,
      listingId,
      normalizedCompCount,
      provider: providerResult.provider,
      query: redactSensitiveText(providerResult.query),
      rawCompCount,
    });
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
        jobLogger.warn('Fell back to deterministic research_price after LLM failure.', {
          analyst: dependencies.pricingAnalyst.name,
          compactErrorMessage: asCompactErrorMessage(error),
          deterministicSuggestedPrice,
          event: 'research_price_llm_fallback',
          fallbackReason,
          jobId: job.id,
          listingId,
        });
      }
    }

    if (fallbackReason === 'llm_suggested_price_null' && pricingModelName) {
      jobLogger.info('Fell back to deterministic research_price after null LLM price.', {
        deterministicSuggestedPrice,
        event: 'research_price_llm_fallback',
        fallbackReason,
        jobId: job.id,
        listingId,
        pricingModelName,
      });
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

    jobLogger.info('Succeeded research_price job.', {
      confidence: confidence.confidence,
      deterministicSuggestedPrice,
      event: 'research_price_succeeded',
      finalSuggestedPrice,
      jobId: job.id,
      listingId,
      listingPriceUpdated: pricedListing.price === finalSuggestedPrice,
      llmFallbackReason: fallbackReason ?? undefined,
      llmStatus: dependencies.pricingAnalyst
        ? fallbackReason === 'llm_analysis_failed'
          ? 'failed'
          : 'succeeded'
        : 'not_attempted',
      normalizedCompCount,
      pricingModelName,
      soldCount: stats.soldCount,
    });

    const completedJob = await dependencies.dataAccess.jobs.complete(job.id);

    return {
      job: completedJob,
      listing: pricedListing,
    };
  } catch (error) {
    let jobError =
      pricingProvider.name === APIFY_PROVIDER_NAME
        ? buildResearchProviderFailureJobError(error, pricingProvider.name)
        : classifyJobError(job.job_type, error);
    const providerFailure = getProviderFailureDetails(error);
    const provider =
      providerResult?.provider ??
      providerFailure.provider ??
      (error instanceof SidecarJobError ? asNonEmptyString(error.context.provider) : undefined) ??
      pricingProvider.name;
    const providerFailureCategory =
      providerFailure.providerFailureCategory ??
      (error instanceof SidecarJobError
        ? asNonEmptyString(error.context.provider_failure_category)
        : undefined);
    const providerFailureCode =
      providerFailure.providerFailureCode ??
      (error instanceof SidecarJobError ? asNonEmptyString(error.context.provider_failure_code) : undefined);
    const query =
      (providerResult?.query ? redactSensitiveText(providerResult.query) : undefined) ??
      providerFailure.query ??
      (error instanceof SidecarJobError ? asNonEmptyString(error.context.query) : undefined);

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

    jobLogger.warn('Failed research_price job.', {
      event: 'research_price_failed',
      failureCode: jobError.code,
      jobId: job.id,
      listingId,
      normalizedCompCount,
      provider,
      providerFailureCategory,
      providerFailureCode,
      providerFailureMessage: providerFailure.providerFailureMessage,
      query,
      rawCompCount,
      workflowSafe: true,
    });

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
