import {
  DEFAULT_APP_SETTINGS_ID,
  getPricingProviderMode,
  isPricingEnabled,
  type JobRow,
  type Json,
  type ListingPriceResearchRow,
  type ListingRow,
} from '@ebay-inventory/data';
import type { EnvSource } from '@ebay-inventory/env';

import type { SidecarDataAccess } from '@/data/sidecar-data.js';
import {
  buildNormalizeSoldCompsContext,
  buildPricingProviderInput,
  buildPricingTitleFromItemSpecifics,
  computeConditionAdjustmentSummary,
  computePricingConfidence,
  computePricingStats,
  getListingItemSpecifics,
  getListingConditionForAdjustment,
  normalizeSoldComps,
  redactSensitiveText as redactPricingSensitiveText,
  resolveProductionPricingProvider,
  type ConditionAdjustmentSummary,
  type LlmPricingPromptFactKey,
  type LlmPricingPromptFacts,
  type PricingAnalystFailureCause,
  type PricingAnalystFailureDiagnostics,
  type LivePricingProviderMode,
  type PricingAnalyst,
  type PricingAnalystInput,
  type PricingAnalystResult,
  type PricingConfidenceResult,
  type PricingProvider,
  type PricingProviderInput,
  type PricingProviderResult,
  type PricingStatsResult,
  type SoldCompsUsageSnapshot,
  ProductionPricingAnalystError,
} from '@/pricing/index.js';
import { createLogger } from '@/utils/logger.js';
import {
  classifyJobError,
  JOB_ERROR_CODES,
  SidecarJobError,
  toJobErrorUpdateInput,
} from './job-errors.js';

const APIFY_PROVIDER_NAME = 'apify';
const FIXTURE_PROVIDER_NAME = 'fixture';
const SOLDCOMPS_PROVIDER_NAME = 'soldcomps';
const SUPPORTED_PRICING_PROVIDER_NAMES = new Set([
  APIFY_PROVIDER_NAME,
  FIXTURE_PROVIDER_NAME,
  SOLDCOMPS_PROVIDER_NAME,
]);
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
  createPricingProvider?: () => PricingProvider;
  computeConfidence?: (input: {
    comps: Parameters<typeof computePricingConfidence>[0]['comps'];
    stats: PricingStatsResult;
  }) => PricingConfidenceResult;
  computeStats?: (comps: Parameters<typeof computePricingStats>[0]) => PricingStatsResult;
  dataAccess: SidecarDataAccess;
  normalizeComps?: typeof normalizeSoldComps;
  now: () => Date;
  pricingProviderEnv?: EnvSource;
  pricingAnalyst?: PricingAnalyst;
  pricingProvider?: PricingProvider;
  resolvePricingProvider?: (mode: LivePricingProviderMode) => PricingProvider;
}

export interface RunResearchPriceJobResult {
  job: JobRow;
  listing: ListingRow | null;
}

export interface PriceListingNowOptions {
  executionSource?: 'cli' | 'job';
  jobId?: string;
}

export interface PriceListingNowResult {
  acceptedCompCount: number;
  listing: ListingRow;
  listingPriceResearchUpdated: boolean;
  provider: string;
  rawCompCount: number;
  selectedProviderMode: LivePricingProviderMode;
  suggestedPrice: number;
}

function getResearchPriceLogMessage(
  phase: 'failed' | 'started' | 'succeeded',
  executionSource: PriceListingNowOptions['executionSource']
): string {
  if (executionSource === 'cli') {
    switch (phase) {
      case 'started':
        return 'Started research_price execution.';
      case 'succeeded':
        return 'Succeeded research_price execution.';
      case 'failed':
        return 'Failed research_price execution.';
    }
  }

  switch (phase) {
    case 'started':
      return 'Started research_price job.';
    case 'succeeded':
      return 'Succeeded research_price job.';
    case 'failed':
      return 'Failed research_price job.';
  }
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

function assertValidSuggestedPrice(
  listingId: string,
  value: unknown,
  source: 'deterministic' | 'final'
): number {
  const normalized = normalizeSuggestedPrice(value);

  if (normalized !== null) {
    return normalized;
  }

  const detail =
    source === 'deterministic'
      ? 'a deterministic suggested price'
      : 'a valid final suggested price';

  throw buildResearchPriceError(
    JOB_ERROR_CODES.RESEARCH_PRICE_SUGGESTED_PRICE_INVALID,
    `Listing "${listingId}" did not produce ${detail}.`
  );
}

function assertMedianSoldPrice(listingId: string, value: number | null): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }

  throw buildResearchPriceError(
    JOB_ERROR_CODES.RESEARCH_PRICE_SUGGESTED_PRICE_INVALID,
    `Listing "${listingId}" did not produce a valid median sold price.`
  );
}

function asJson(value: unknown): Json {
  return value as Json;
}

function sanitizePersistedPricingRawResult(value: unknown, canonicalQuery?: string): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizePersistedPricingRawResult(entry, canonicalQuery));
  }

  if (!isRecord(value)) {
    return value;
  }

  const query = asNonEmptyString(value.query);
  const nextCanonicalQuery = query ?? canonicalQuery;
  const keyword = asNonEmptyString(value.keyword);

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) => {
      if (key === 'sampleTitles') {
        return [];
      }

      if (key === 'keyword' && nextCanonicalQuery && keyword === nextCanonicalQuery) {
        return [];
      }

      return [[key, sanitizePersistedPricingRawResult(entry, nextCanonicalQuery)]];
    })
  );
}

function asFiniteNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function buildPricingResearchDiagnostics(
  providerRawResult: unknown,
  rawCompCount: number,
  normalized: ReturnType<typeof normalizeSoldComps>
): Record<string, boolean | number> {
  const providerOutput = isRecord(providerRawResult) && isRecord(providerRawResult.output)
    ? providerRawResult.output
    : null;
  const providerReturnedCount =
    asFiniteNonNegativeInteger(providerOutput?.itemCount) ??
    (isRecord(providerRawResult)
      ? asFiniteNonNegativeInteger(providerRawResult.returnedSoldComps)
      : undefined) ??
    rawCompCount;
  const requestedCount =
    isRecord(providerRawResult) && isRecord(providerRawResult.input) && isRecord(providerRawResult.input.request)
      ? asFiniteNonNegativeInteger(providerRawResult.input.request.count)
      : undefined;
  const providerReportedTotalCount = asFiniteNonNegativeInteger(providerOutput?.totalItems);
  const providerHasNextPage = asBoolean(providerOutput?.hasNextPage);

  return Object.fromEntries(
    Object.entries({
      normalizationAcceptedCount: normalized.comps.length,
      normalizationInputCount: rawCompCount,
      normalizationRejectedCount: normalized.rejected.length,
      providerHasNextPage,
      providerReportedTotalCount,
      providerReturnedCount,
      requestedCount,
    }).filter(([, value]) => value !== undefined)
  ) as Record<string, boolean | number>;
}

function buildPricingResearchRawResult(
  providerRawResult: unknown,
  rawCompCount: number,
  normalized: ReturnType<typeof normalizeSoldComps>
): Json {
  const base =
    typeof providerRawResult === 'object' && providerRawResult !== null && !Array.isArray(providerRawResult)
      ? { ...providerRawResult }
      : { providerRawResult };

  return asJson({
    ...(sanitizePersistedPricingRawResult(base) as Record<string, unknown>),
    diagnostics: buildPricingResearchDiagnostics(base, rawCompCount, normalized),
    normalization: {
      acceptedCount: normalized.comps.length,
      inputCount: rawCompCount,
      rawCount: rawCompCount,
      rejectedCount: normalized.rejected.length,
      rejected: normalized.rejected,
    },
  });
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
  fallbackProvider: string,
  selectedProviderMode?: LivePricingProviderMode
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
        pricing_provider_mode: selectedProviderMode,
        provider_failure_category: failure.providerFailureCategory,
        provider_failure_code: failure.providerFailureCode,
        query: failure.query,
        workflow_safe: failure.workflowSafe ?? true,
      }).filter(([, value]) => value !== undefined)
    ) as Record<string, Json>
  );
}

function isProviderFailure(
  error: unknown,
  failure: ReturnType<typeof getProviderFailureDetails>
): boolean {
  return (
    failure.provider !== undefined ||
    failure.providerFailureCategory !== undefined ||
    failure.providerFailureCode !== undefined ||
    failure.workflowSafe !== undefined ||
    (isRecord(error) &&
      (typeof error.provider === 'string' ||
        typeof error.providerName === 'string' ||
        typeof error.category === 'string' ||
        typeof error.code === 'string'))
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
  stats: PricingStatsResult,
  conditionAdjustment: ConditionAdjustmentSummary
): PricingAnalystInput {
  const itemSpecifics = getListingItemSpecifics(listing.item_specifics);

  return {
    listing: {
      condition: conditionAdjustment.listingConditionSignal?.label ?? null,
      title:
        asNonEmptyString(listing.title) ?? buildPricingTitleFromItemSpecifics(itemSpecifics) ?? listingId,
      facts: buildLlmPricingFacts(itemSpecifics),
    },
    stats,
    comps: [...comps],
    conditionAdjustment,
  };
}

function buildSucceededLlmReasoningJson(
  result: PricingAnalystResult,
  fallbackReason: string | null,
  conditionAdjustment: ConditionAdjustmentSummary
): Json {
  const normalizedConditionAdjustedPrice = normalizeConditionAdjustedPrice(
    result.reasoning.conditionAdjustedPrice
  );
  const derivedPercent =
    normalizedConditionAdjustedPrice !== null && conditionAdjustment.deterministicMedianPrice !== null
      ? Number(
          (normalizedConditionAdjustedPrice / conditionAdjustment.deterministicMedianPrice - 1).toFixed(4)
        )
      : null;

  return asJson({
    fallback: fallbackReason,
    modelName: result.modelName,
    reasoning: {
      ...result.reasoning,
      conditionAdjustmentPercent: derivedPercent,
    },
    status: 'succeeded',
  });
}

function buildFailedLlmReasoningJson(
  analyst: PricingAnalyst,
  fallbackReason: string,
  error: unknown,
  modelName?: string | null
): Json {
  const failure = buildLlmFailureDiagnostics(error, modelName);

  return asJson({
    analyst: analyst.name,
    error: asCompactErrorMessage(error),
    fallback: fallbackReason,
    failure,
    ...(modelName ? { modelName } : {}),
    status: 'failed',
  });
}

function buildLlmFailureDiagnostics(
  error: unknown,
  modelName?: string | null
): PricingAnalystFailureDiagnostics {
  if (error instanceof ProductionPricingAnalystError && error.failureDiagnostics) {
    return error.failureDiagnostics;
  }

  const fallbackCause = buildFallbackFailureCause(error);

  return {
    causes: [fallbackCause],
    ...(fallbackCause.errorCode ? { errorCode: fallbackCause.errorCode } : {}),
    ...(fallbackCause.errorStatus ? { errorStatus: fallbackCause.errorStatus } : {}),
    ...(modelName ? { modelName } : {}),
    ...(fallbackCause.reason ? { reason: fallbackCause.reason } : {}),
    retryable: false,
    ...(fallbackCause.statusCode !== undefined ? { statusCode: fallbackCause.statusCode } : {}),
  };
}

function buildFallbackFailureCause(error: unknown): PricingAnalystFailureCause {
  return {
    message: asCompactErrorMessage(error),
    ...(error instanceof Error ? { name: error.name } : {}),
  };
}

function buildSkippedLlmReasoningJson(fallbackReason: string, conditionAdjustment: ConditionAdjustmentSummary): Json {
  return asJson({
    conditionAdjustment,
    fallback: fallbackReason,
    status: 'not_attempted',
  });
}

function getConditionAdjustmentFallbackReason(
  summary: ConditionAdjustmentSummary
): 'condition_adjustment_not_allowed' | null {
  return summary.allowedAdjustment.eligible ? null : 'condition_adjustment_not_allowed';
}

function getLlmFallbackReason(error: unknown): string {
  if (error instanceof Error && error.message.includes('conditionAdjustedPrice must equal deterministic')) {
    return 'llm_condition_adjusted_price_out_of_window';
  }

  if (
    error instanceof Error &&
    error.message.includes('conditionAdjustedPrice') &&
    error.message.includes('must')
  ) {
    return 'llm_condition_adjusted_price_invalid';
  }

  return 'llm_analysis_failed';
}

function getLlmStatusForLog(
  pricingAnalyst: PricingAnalyst | undefined,
  llmReasoningJson: Json
): 'failed' | 'not_attempted' | 'succeeded' {
  if (!pricingAnalyst) {
    return 'not_attempted';
  }

  if (
    typeof llmReasoningJson === 'object' &&
    llmReasoningJson !== null &&
    !Array.isArray(llmReasoningJson) &&
    'status' in llmReasoningJson
  ) {
    const status = (llmReasoningJson as { status?: unknown }).status;
    if (status === 'failed' || status === 'not_attempted' || status === 'succeeded') {
      return status;
    }
  }

  return 'succeeded';
}

function normalizeConditionAdjustedPrice(value: unknown): number | null {
  return normalizeSuggestedPrice(value);
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

async function persistSoldCompsUsageSnapshot(
  dataAccess: SidecarDataAccess,
  snapshot: SoldCompsUsageSnapshot | null | undefined
): Promise<void> {
  if (!snapshot) {
    return;
  }

  try {
    await dataAccess.appSettings.update(
      {
        soldcomps_usage_snapshot: asJson(snapshot),
      },
      DEFAULT_APP_SETTINGS_ID
    );
  } catch (error) {
    jobLogger.warn('Failed to persist SoldComps usage snapshot.', {
      compactErrorMessage: asCompactErrorMessage(error),
      event: 'research_price_soldcomps_usage_snapshot_persist_failed',
      snapshotSource: snapshot.source,
      snapshotUpdatedAt: snapshot.updatedAt,
    });
  }
}

async function getEnabledPricingProviderMode(
  dependencies: ResearchPriceJobDependencies,
  options: PriceListingNowOptions = {}
): Promise<LivePricingProviderMode> {
  const appSettings = await dependencies.dataAccess.appSettings.get();
  const pricingProviderMode = getPricingProviderMode(appSettings);

  if (pricingProviderMode !== 'off' && isPricingEnabled(appSettings)) {
    return pricingProviderMode;
  }

  throw buildResearchPriceError(
    JOB_ERROR_CODES.RESEARCH_PRICE_DISABLED,
    options.executionSource === 'cli'
      ? 'Pricing provider mode off. pricing:price-one skipped.'
      : `Pricing provider mode off. research_price skipped for job "${options.jobId ?? 'unknown'}".`,
    {
      ...(options.executionSource ? { execution_source: options.executionSource } : {}),
      ...(options.jobId ? { job_id: options.jobId } : {}),
      pricing_provider_mode: pricingProviderMode,
      settings_source: appSettings ? 'app_settings' : 'default',
      workflow_safe: true,
    }
  );
}

function assertSupportedPricingProvider(pricingProvider: PricingProvider): PricingProvider {
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

function resolvePricingProvider(
  dependencies: ResearchPriceJobDependencies,
  selectedProviderMode: LivePricingProviderMode
): PricingProvider {
  if (dependencies.pricingProvider) {
    return assertSupportedPricingProvider(dependencies.pricingProvider);
  }

  if (dependencies.createPricingProvider) {
    return assertSupportedPricingProvider(dependencies.createPricingProvider());
  }

  return assertSupportedPricingProvider(
    dependencies.resolvePricingProvider?.(selectedProviderMode) ??
      resolveProductionPricingProvider({
        env: dependencies.pricingProviderEnv,
        mode: selectedProviderMode,
      })
  );
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
      pricing_model_name: null,
      raw_result_json: asJson(failureContext),
    });
}

async function persistSucceededResearch(
  dataAccess: SidecarDataAccess,
  input: {
    confidence: string;
    comps: Json;
    llmPriceExplanation: string | null;
    llmReasoningJson: Json;
    llmRejectedCompIds: Json;
    medianSoldPrice: number;
    pricingModelName: string | null;
    query: string;
    rawResultJson: Json;
    researchId: string;
    soldCount: number;
    suggestedPrice: number;
  }
): Promise<void> {
  await dataAccess.listingPriceResearch.markSucceeded({
    comps: input.comps,
    confidence: input.confidence,
    id: input.researchId,
    llm_price_explanation: input.llmPriceExplanation,
    llm_reasoning_json: input.llmReasoningJson,
    llm_rejected_comp_ids: input.llmRejectedCompIds,
    median_sold_price: input.medianSoldPrice,
    pricing_model_name: input.pricingModelName,
    query: input.query,
    raw_result_json: input.rawResultJson,
    sold_count: input.soldCount,
    suggested_price: input.suggestedPrice,
  });
}

export async function priceListingNow(
  listingId: string,
  dependencies: ResearchPriceJobDependencies,
  options: PriceListingNowOptions = {}
): Promise<PriceListingNowResult> {
  const listing = await dependencies.dataAccess.listings.getByListingId(listingId);

  if (!listing) {
    throw buildResearchPriceError(
      JOB_ERROR_CODES.RESEARCH_PRICE_LISTING_NOT_FOUND,
      `Listing "${listingId}" was not found for research_price.`
    );
  }

  const selectedProviderMode = await getEnabledPricingProviderMode(dependencies, options);
  assertResearchPriceListingEligible(listing);
  const runNormalizeComps = dependencies.normalizeComps ?? normalizeSoldComps;
  const runComputeStats = dependencies.computeStats ?? computePricingStats;
  const runComputeConfidence = dependencies.computeConfidence ?? computePricingConfidence;
  let pricingProvider: PricingProvider;

  try {
    pricingProvider = resolvePricingProvider(dependencies, selectedProviderMode);
  } catch (error) {
    const providerFailure = getProviderFailureDetails(error);
    throw isProviderFailure(error, providerFailure)
      ? buildResearchProviderFailureJobError(error, selectedProviderMode, selectedProviderMode)
      : classifyJobError('research_price', error);
  }

  let research: ListingPriceResearchRow | null = null;
  let researchSucceeded = false;
  let providerResult: PricingProviderResult | undefined;
  let rawCompCount = 0;
  let normalizedCompCount = 0;

  try {
    jobLogger.info(getResearchPriceLogMessage('started', options.executionSource), {
      event: 'research_price_started',
      executionSource: options.executionSource ?? 'job',
      jobId: options.jobId,
      listingId,
      pricingMode: getPricingMode(pricingProvider, dependencies.pricingAnalyst),
      provider: pricingProvider.name,
      selectedProviderMode,
    });

    research = await dependencies.dataAccess.listingPriceResearch.create({
      listing_id: listingId,
      provider: pricingProvider.name,
      status: 'pending',
    });

    providerResult = await pricingProvider.fetchSoldComps(buildPricingProviderInput(listing, listingId));
    if (providerResult.provider === SOLDCOMPS_PROVIDER_NAME) {
      await persistSoldCompsUsageSnapshot(
        dependencies.dataAccess,
        providerResult.soldCompsUsage ?? null
      );
    }
    rawCompCount = providerResult.soldComps.length;

    const normalized = runNormalizeComps(providerResult.soldComps, buildNormalizeSoldCompsContext(listing, listingId));
    normalizedCompCount = normalized.comps.length;
    const stats = runComputeStats(normalized.comps);
    const pricingRawResult = buildPricingResearchRawResult(
      providerResult.rawResult,
      rawCompCount,
      normalized
    );
    jobLogger.info('Completed research_price provider fetch.', {
      acceptedCompCount: normalizedCompCount,
      event: 'research_price_provider_result',
      executionSource: options.executionSource ?? 'job',
      jobId: options.jobId,
      listingId,
      normalizedCompCount,
      provider: providerResult.provider,
      query: redactSensitiveText(providerResult.query),
      rawCompCount,
      selectedProviderMode,
    });
    const deterministicSuggestedPrice = assertValidSuggestedPrice(
      listingId,
      stats.deterministicSuggestedPrice,
      'deterministic'
    );

    const confidence = runComputeConfidence({
      comps: normalized.comps,
      stats,
    });
    const listingCondition = getListingConditionForAdjustment(getListingItemSpecifics(listing.item_specifics));
    const conditionAdjustment = computeConditionAdjustmentSummary({
      comps: normalized.comps,
      listingCondition,
      stats,
    });
    const deterministicFallbackReason = getConditionAdjustmentFallbackReason(conditionAdjustment);

    let llmReasoningJson: Json = {};
    let llmRejectedCompIds: Json = [];
    let llmPriceExplanation: string | null = null;
    let pricingModelName: string | null = null;
    let llmConditionAdjustedPrice: number | null = null;
    let fallbackReason: string | null = deterministicFallbackReason;

    if (dependencies.pricingAnalyst) {
      try {
        const analystResult = await dependencies.pricingAnalyst.analyze(
          buildPricingAnalystInput(listing, listingId, normalized.comps, stats, conditionAdjustment)
        );

        llmConditionAdjustedPrice = normalizeConditionAdjustedPrice(
          analystResult.reasoning.conditionAdjustedPrice
        );
        fallbackReason =
          llmConditionAdjustedPrice === null
            ? conditionAdjustment.allowedAdjustment.eligible
              ? 'llm_condition_adjusted_price_null'
              : deterministicFallbackReason
            : null;
        llmReasoningJson = buildSucceededLlmReasoningJson(
          analystResult,
          fallbackReason,
          conditionAdjustment
        );
        llmRejectedCompIds = asJson(analystResult.reasoning.rejectedCompIds);
        llmPriceExplanation = analystResult.reasoning.priceExplanation;
        pricingModelName = analystResult.modelName;
      } catch (error) {
        fallbackReason = getLlmFallbackReason(error);
        pricingModelName =
          error instanceof ProductionPricingAnalystError ? error.modelName ?? null : pricingModelName;
        llmReasoningJson = buildFailedLlmReasoningJson(
          dependencies.pricingAnalyst,
          fallbackReason,
          error,
          pricingModelName
        );
        jobLogger.warn('Fell back to deterministic research_price after LLM failure.', {
          analyst: dependencies.pricingAnalyst.name,
          compactErrorMessage: asCompactErrorMessage(error),
          deterministicSuggestedPrice,
          event: 'research_price_llm_fallback',
          fallbackReason,
          jobId: options.jobId,
          listingId,
          pricingModelName: pricingModelName ?? undefined,
        });
      }
    } else if (fallbackReason !== null) {
      llmReasoningJson = buildSkippedLlmReasoningJson(fallbackReason, conditionAdjustment);
    }

    if (fallbackReason === 'llm_condition_adjusted_price_null' && pricingModelName) {
      jobLogger.info('Fell back to deterministic research_price after null LLM condition adjustment.', {
        deterministicSuggestedPrice,
        event: 'research_price_llm_fallback',
        fallbackReason,
        jobId: options.jobId,
        listingId,
        pricingModelName,
      });
    }

    const finalSuggestedPrice = assertValidSuggestedPrice(
      listingId,
      llmConditionAdjustedPrice ?? deterministicSuggestedPrice,
      'final'
    );
    const medianSoldPrice = assertMedianSoldPrice(listingId, stats.medianSoldPrice);

    await persistSucceededResearch(
      dependencies.dataAccess,
      {
        comps: asJson(normalized.comps),
        confidence: confidence.confidence,
        llmPriceExplanation,
        llmReasoningJson,
        llmRejectedCompIds,
        medianSoldPrice,
        pricingModelName,
        query: providerResult.query,
        rawResultJson: pricingRawResult,
        researchId: research.id,
        soldCount: stats.soldCount,
        suggestedPrice: finalSuggestedPrice,
      }
    );
    researchSucceeded = true;
    const pricedListing = await dependencies.dataAccess.listings.update(listingId, {
      price: finalSuggestedPrice,
    });

    jobLogger.info(getResearchPriceLogMessage('succeeded', options.executionSource), {
      acceptedCompCount: normalizedCompCount,
      confidence: confidence.confidence,
      deterministicSuggestedPrice,
      event: 'research_price_succeeded',
      executionSource: options.executionSource ?? 'job',
      finalSuggestedPrice,
      jobId: options.jobId,
      listingId,
      listingPriceUpdated: pricedListing.price === finalSuggestedPrice,
      llmFallbackReason: fallbackReason ?? undefined,
      llmStatus: getLlmStatusForLog(dependencies.pricingAnalyst, llmReasoningJson),
      normalizedCompCount,
      pricingModelName,
      rawCompCount,
      soldCount: stats.soldCount,
    });

    return {
      acceptedCompCount: normalizedCompCount,
      listing: pricedListing,
      listingPriceResearchUpdated: true,
      provider: providerResult.provider,
      rawCompCount,
      selectedProviderMode,
      suggestedPrice: finalSuggestedPrice,
    };
  } catch (error) {
    const providerFailure = getProviderFailureDetails(error);
    let jobError =
      error instanceof SidecarJobError
        ? error
        : isProviderFailure(error, providerFailure)
          ? buildResearchProviderFailureJobError(error, pricingProvider.name, selectedProviderMode)
          : classifyJobError('research_price', error);
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
      (error instanceof SidecarJobError
        ? asNonEmptyString(error.context.provider_failure_code)
        : undefined);
    const query =
      (providerResult?.query ? redactSensitiveText(providerResult.query) : undefined) ??
      providerFailure.query ??
      (error instanceof SidecarJobError ? asNonEmptyString(error.context.query) : undefined);

    try {
      if (!researchSucceeded) {
        await markResearchFailedSafely(dependencies.dataAccess, research, jobError, providerResult);
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

    jobLogger.warn(getResearchPriceLogMessage('failed', options.executionSource), {
      acceptedCompCount: normalizedCompCount,
      event: 'research_price_failed',
      executionSource: options.executionSource ?? 'job',
      failureCode: jobError.code,
      jobId: options.jobId,
      listingId,
      normalizedCompCount,
      provider,
      providerFailureCategory,
      providerFailureCode,
      providerFailureMessage: providerFailure.providerFailureMessage,
      query,
      rawCompCount,
      selectedProviderMode,
      workflowSafe: true,
    });

    throw jobError;
  }
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

  try {
    const result = await priceListingNow(listingId, dependencies, {
      executionSource: 'job',
      jobId: job.id,
    });
    const completedJob = await dependencies.dataAccess.jobs.complete(job.id);

    return {
      job: completedJob,
      listing: result.listing,
    };
  } catch (error) {
    const jobError =
      error instanceof SidecarJobError ? error : classifyJobError(job.job_type, error);
    if (jobError.code === JOB_ERROR_CODES.RESEARCH_PRICE_DISABLED) {
      jobLogger.info('Skipped research_price job because pricing provider mode is off.', {
        event: 'research_price_disabled',
        jobId: job.id,
        listingId,
        pricingProviderMode: 'off',
      });
    }

    const failedJob = await dependencies.dataAccess.jobs.fail(
      job.id,
      toJobErrorUpdateInput(jobError, errorAt)
    );

    return {
      job: failedJob,
      listing: listingId
        ? await getListingSafely(dependencies.dataAccess, listingId)
        : null,
    };
  }
}
