import type { ListingRow, Json } from '@ebay-inventory/data';

import type { SidecarDataAccess } from '@/data/sidecar-data.js';
import {
  computeConditionAdjustmentSummary,
  computePricingStats,
  getListingConditionForAdjustment,
  getListingItemSpecifics,
  buildPricingTitleFromItemSpecifics,
  type ConditionAdjustmentSummary,
  type LlmPricingPromptFactKey,
  type LlmPricingPromptFacts,
  type NormalizedSoldComp,
  type PricingAnalysisWarning,
  type PricingAnalysisWarningReason,
  type PricingAnalyst,
  type PricingAnalystFailureCause,
  type PricingAnalystFailureDiagnostics,
  type PricingAnalystInput,
  type PricingAnalystResult,
  type PricingStatsResult,
  ProductionPricingAnalystError,
} from '@/pricing/index.js';
import { createLogger } from '@/utils/logger.js';

const retryLogger = createLogger('RetryPricingAnalysis');

type RetryableLlmPricingAnalysisWarningReason = Exclude<
  PricingAnalysisWarningReason,
  'provider_failure'
>;

const PRICING_ANALYSIS_WARNING_REASONS_RETRYABLE = new Set<
  RetryableLlmPricingAnalysisWarningReason
>([
  'llm_analysis_failed',
  'llm_condition_adjusted_price_invalid',
  'llm_condition_adjusted_price_out_of_window',
  'llm_condition_adjusted_price_null',
]);

const LLM_PRICING_FACT_KEYS: readonly LlmPricingPromptFactKey[] = [
  'Player',
  'Year',
  'Manufacturer',
  'Set',
  'Card Number',
  'Parallel/Variety',
  'Team/Franchise',
] as const;

export interface RetryPricingAnalysisDependencies {
  dataAccess: SidecarDataAccess;
  pricingAnalyst?: PricingAnalyst;
}

export interface RetryPricingAnalysisResult {
  listing: ListingRow;
  researchUpdated: boolean;
  warningResolved: boolean;
}

// -- Shared helpers ---------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
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

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
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

function parsePricingAnalysisWarnings(llmReasoningJson: unknown): PricingAnalysisWarning[] {
  const reasoning = asRecord(llmReasoningJson);
  const rawWarnings = reasoning?.warnings;
  if (!Array.isArray(rawWarnings)) {
    return [];
  }

  return rawWarnings.flatMap((warning): PricingAnalysisWarning[] => {
    const record = asRecord(warning);
    if (!record) {
      return [];
    }

    const analyst = asString(record.analyst);
    const code = asString(record.code);
    const reason = asString(record.reason);
    const severity = asString(record.severity);
    const summary = asString(record.summary);
    const retryable = asBoolean(record.retryable);

    if (!analyst || !code || !reason || severity !== 'warning' || !summary || retryable === null) {
      return [];
    }

    return [
      {
        analyst,
        code: code as PricingAnalysisWarningReason,
        reason: reason as PricingAnalysisWarningReason,
        retryable,
        severity: 'warning' as const,
        summary,
      },
    ];
  });
}

function hasRetryablePricingAnalysisWarning(llmReasoningJson: unknown): boolean {
  return parsePricingAnalysisWarnings(llmReasoningJson).some(
    (warning) =>
      warning.retryable && isRetryableLlmPricingAnalysisWarningReason(warning.reason)
  );
}

function parseComps(value: unknown): NormalizedSoldComp[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is NormalizedSoldComp => {
    if (!entry || typeof entry !== 'object') {
      return false;
    }
    const record = entry as Record<string, unknown>;
    return (
      typeof record.id === 'string' &&
      typeof record.title === 'string' &&
      typeof record.soldDate === 'string' &&
      asRecord(record.totalPrice) !== null &&
      typeof asRecord(record.totalPrice)!.value === 'number'
    );
  });
}

function buildLlmPricingFacts(
  itemSpecifics: Record<string, unknown> | undefined
): LlmPricingPromptFacts | undefined {
  if (!itemSpecifics) {
    return undefined;
  }

  const facts = Object.fromEntries(
    LLM_PRICING_FACT_KEYS.flatMap((key) => {
      const value = itemSpecifics[key];
      const normalized = Array.isArray(value)
        ? value
            .map((entry) => String(entry).trim())
            .filter((entry) => entry.length > 0)
            .join(' / ')
        : typeof value === 'string'
          ? value.trim()
          : '';

      return normalized.length > 0 ? [[key, normalized] as const] : [];
    })
  );

  return Object.keys(facts).length > 0 ? facts : undefined;
}

function rebuildPricingAnalystInput(
  listing: ListingRow,
  comps: NormalizedSoldComp[],
  stats: PricingStatsResult,
  conditionAdjustment: ConditionAdjustmentSummary
): PricingAnalystInput {
  const itemSpecifics = getListingItemSpecifics(listing.item_specifics);

  return {
    listing: {
      condition: conditionAdjustment.listingConditionSignal?.label ?? null,
      title:
        asNonEmptyString(listing.title) ??
        buildPricingTitleFromItemSpecifics(itemSpecifics) ??
        listing.listing_id,
      facts: buildLlmPricingFacts(itemSpecifics as Record<string, unknown> | undefined),
    },
    stats,
    comps: [...comps],
    conditionAdjustment,
  };
}

// -- Warning / reasoning helpers (mirrors research-price-job internals) -----

function isRetryableLlmPricingAnalysisWarningReason(
  value: string | null
): value is RetryableLlmPricingAnalysisWarningReason {
  return (
    value !== null &&
    PRICING_ANALYSIS_WARNING_REASONS_RETRYABLE.has(value as RetryableLlmPricingAnalysisWarningReason)
  );
}

function getPricingAnalysisWarningSummary(reason: RetryableLlmPricingAnalysisWarningReason): string {
  switch (reason) {
    case 'llm_analysis_failed':
      return 'LLM pricing analysis failed. Deterministic price used.';
    case 'llm_condition_adjusted_price_invalid':
      return 'LLM returned invalid condition-adjusted price. Deterministic price used.';
    case 'llm_condition_adjusted_price_out_of_window':
      return 'LLM returned off-target condition-adjusted price. Deterministic price used.';
    case 'llm_condition_adjusted_price_null':
      return 'LLM returned no condition-adjusted price. Deterministic price used.';
  }
}

function buildPricingAnalysisWarnings(input: {
  analyst: string;
  fallbackReason: string | null;
  failure?: PricingAnalystFailureDiagnostics;
  modelName?: string | null;
}): PricingAnalysisWarning[] | undefined {
  if (!isRetryableLlmPricingAnalysisWarningReason(input.fallbackReason)) {
    return undefined;
  }

  const fallbackReason = input.fallbackReason;

  return [
    {
      analyst: input.analyst,
      code: fallbackReason,
      ...(input.failure ? { failure: input.failure } : {}),
      ...(input.modelName ? { modelName: input.modelName } : {}),
      reason: fallbackReason,
      retryable: input.failure?.retryable ?? false,
      severity: 'warning',
      summary: getPricingAnalysisWarningSummary(fallbackReason),
    },
  ];
}

function buildFallbackFailureCause(error: unknown): PricingAnalystFailureCause {
  return {
    message: asCompactErrorMessage(error),
    ...(error instanceof Error ? { name: error.name } : {}),
  };
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

function buildFailedLlmReasoningJson(
  analyst: PricingAnalyst,
  fallbackReason: string,
  error: unknown,
  modelName?: string | null
): Json {
  const failure = buildLlmFailureDiagnostics(error, modelName);
  const warnings = buildPricingAnalysisWarnings({
    analyst: analyst.name,
    fallbackReason,
    failure,
    modelName,
  });

  return asJson({
    analyst: analyst.name,
    error: asCompactErrorMessage(error),
    fallback: fallbackReason,
    failure,
    ...(modelName ? { modelName } : {}),
    status: 'failed',
    ...(warnings ? { warnings } : {}),
  });
}

function buildSucceededLlmReasoningJson(
  result: PricingAnalystResult,
  analyst: PricingAnalyst,
  fallbackReason: string | null,
  conditionAdjustment: ConditionAdjustmentSummary
): Json {
  const normalizedConditionAdjustedPrice = normalizeSuggestedPrice(
    result.reasoning.conditionAdjustedPrice
  );
  const derivedPercent =
    normalizedConditionAdjustedPrice !== null &&
    conditionAdjustment.deterministicMedianPrice !== null
      ? Number(
          (
            normalizedConditionAdjustedPrice / conditionAdjustment.deterministicMedianPrice -
            1
          ).toFixed(4)
        )
      : null;
  const warnings = buildPricingAnalysisWarnings({
    analyst: analyst.name,
    fallbackReason,
    modelName: result.modelName,
  });

  return asJson({
    fallback: fallbackReason,
    modelName: result.modelName,
    reasoning: {
      ...result.reasoning,
      conditionAdjustmentPercent: derivedPercent,
    },
    status: 'succeeded',
    ...(warnings ? { warnings } : {}),
  });
}

function getLlmFallbackReason(error: unknown): string {
  if (
    error instanceof Error &&
    error.message.includes('conditionAdjustedPrice must equal deterministic')
  ) {
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

function isConditionAdjustmentNotAllowed(conditionAdjustment: ConditionAdjustmentSummary): boolean {
  return !conditionAdjustment.allowedAdjustment.eligible;
}

/**
 * Returns true when `price` is within the allowed adjustment window.
 * A null minPrice/maxPrice means that bound is unconstrained.
 * Only meaningful when `allowedAdjustment.eligible` is already true.
 */
function isPriceInAllowedWindow(
  price: number,
  allowedAdjustment: ConditionAdjustmentSummary['allowedAdjustment']
): boolean {
  if (allowedAdjustment.minPrice !== null && price < allowedAdjustment.minPrice) {
    return false;
  }
  if (allowedAdjustment.maxPrice !== null && price > allowedAdjustment.maxPrice) {
    return false;
  }
  return true;
}

// -- Main retry function ----------------------------------------------------

/**
 * Retries LLM pricing analysis for a listing that has retryable
 * pricing-analysis warnings.
 *
 * - Validates the listing exists and has a latest successful pricing research
 *   row with retryable warnings.
 * - Reuses persisted comps & listing data to rebuild PricingAnalystInput.
 * - Re-runs ONLY the LLM condition-adjustment step (no sold comps provider
 *   fetch).
 * - On success with valid condition-adjusted price: persists updated
 *   llm_reasoning_json and updates listing price.
 * - On success with null/invalid/out-of-window price: preserves existing
 *   listing price, persists updated warnings.
 * - On model/provider failure: preserves existing listing price, persists
 *   refreshed warning diagnostics.
 * - Does NOT write listing last_error_* fields.
 */
export async function retryPricingAnalysis(
  listingId: string,
  dependencies: RetryPricingAnalysisDependencies
): Promise<RetryPricingAnalysisResult> {
  const { dataAccess, pricingAnalyst } = dependencies;

  // 1. Validate listing exists
  const listing = await dataAccess.listings.getByListingId(listingId);
  if (!listing) {
    throw new RetryPricingAnalysisError(`Listing "${listingId}" was not found.`, 'not_found');
  }

  // 2. Validate latest successful pricing research exists
  const latestResearch = await dataAccess.listingPriceResearch.getLatestByListingId(listingId);
  if (!latestResearch) {
    throw new RetryPricingAnalysisError(
      `Listing "${listingId}" has no pricing research to retry.`,
      'no_research'
    );
  }

  if (latestResearch.status !== 'succeeded') {
    throw new RetryPricingAnalysisError(
      `Listing "${listingId}" latest pricing research is not in succeeded state.`,
      'research_not_succeeded'
    );
  }

  // 3. Validate there are retryable pricing-analysis warnings
  if (!hasRetryablePricingAnalysisWarning(latestResearch.llm_reasoning_json)) {
    throw new RetryPricingAnalysisError(
      `Listing "${listingId}" has no retryable pricing-analysis warnings.`,
      'no_retryable_warning'
    );
  }

  // 4. Parse persisted comps
  const comps = parseComps(latestResearch.comps);
  if (comps.length === 0) {
    throw new RetryPricingAnalysisError(
      `Listing "${listingId}" has no persisted comps for pricing-analysis retry.`,
      'no_comps'
    );
  }

  // 5. Validate pricing analyst is available
  if (!pricingAnalyst) {
    throw new RetryPricingAnalysisError(
      'Pricing analyst is not available for retry.',
      'no_analyst'
    );
  }

  // 6. Rebuild stats from persisted comps
  const stats = computePricingStats(comps);

  // 7. Rebuild condition adjustment
  const listingCondition = getListingConditionForAdjustment(
    getListingItemSpecifics(listing.item_specifics)
  );
  const conditionAdjustment = computeConditionAdjustmentSummary({
    comps,
    listingCondition,
    stats,
  });

  // 8. Build analyst input and re-run
  const analystInput = rebuildPricingAnalystInput(listing, comps, stats, conditionAdjustment);

  let analystResult: PricingAnalystResult | null = null;
  let llmReasoningJson: Json;
  let llmConditionAdjustedPrice: number | null = null;
  let fallbackReason: string | null = null;
  let pricingModelName: string | null = null;

  try {
    analystResult = await pricingAnalyst.analyze(analystInput);
    pricingModelName = analystResult.modelName;

    llmConditionAdjustedPrice = normalizeSuggestedPrice(
      analystResult.reasoning.conditionAdjustedPrice
    );

    const { allowedAdjustment } = conditionAdjustment;

    if (!allowedAdjustment.eligible) {
      fallbackReason = 'condition_adjustment_not_allowed';
    } else if (llmConditionAdjustedPrice === null) {
      // Distinguish null-vs-invalid by checking whether the raw value was
      // present. normalizeSuggestedPrice returns null for missing, negative,
      // zero, or non-finite values.
      const rawPrice = analystResult.reasoning.conditionAdjustedPrice;
      fallbackReason =
        rawPrice === null || rawPrice === undefined
          ? 'llm_condition_adjusted_price_null'
          : 'llm_condition_adjusted_price_invalid';
    } else if (!isPriceInAllowedWindow(llmConditionAdjustedPrice, allowedAdjustment)) {
      fallbackReason = 'llm_condition_adjusted_price_out_of_window';
    } else {
      fallbackReason = null;
    }

    llmReasoningJson = buildSucceededLlmReasoningJson(
      analystResult,
      pricingAnalyst,
      fallbackReason,
      conditionAdjustment
    );
  } catch (error) {
    fallbackReason = getLlmFallbackReason(error);
    pricingModelName =
      error instanceof ProductionPricingAnalystError ? (error.modelName ?? null) : null;

    llmReasoningJson = buildFailedLlmReasoningJson(
      pricingAnalyst,
      fallbackReason,
      error,
      pricingModelName
    );

    retryLogger.warn('Pricing analysis retry failed with model/provider error.', {
      compactErrorMessage: asCompactErrorMessage(error),
      event: 'retry_pricing_analysis_failed',
      fallbackReason,
      listingId,
      pricingModelName: pricingModelName ?? undefined,
    });
  }

  // 9. Determine if warning was resolved
  const warningResolved = fallbackReason === null && llmConditionAdjustedPrice !== null;

  // 10. Persist updated llm_reasoning_json on the research row
  const resolvedReasoning = warningResolved ? analystResult?.reasoning : undefined;
  const rejectedCompIds = resolvedReasoning
    ? (resolvedReasoning.rejectedCompIds as unknown as Json)
    : (latestResearch.llm_rejected_comp_ids ?? []);
  const priceExplanation = resolvedReasoning
    ? resolvedReasoning.priceExplanation
    : latestResearch.llm_price_explanation;
  const suggestedPrice =
    warningResolved && llmConditionAdjustedPrice !== null
      ? llmConditionAdjustedPrice
      : (latestResearch.suggested_price ?? stats.deterministicSuggestedPrice);

  await dataAccess.listingPriceResearch.markSucceeded({
    comps: (latestResearch.comps ?? asJson(comps)) as Json,
    confidence: latestResearch.confidence ?? (stats.soldCount > 0 ? 'medium' : 'low'),
    id: latestResearch.id,
    llm_price_explanation: priceExplanation,
    llm_reasoning_json: llmReasoningJson,
    llm_rejected_comp_ids: rejectedCompIds,
    median_sold_price: stats.medianSoldPrice ?? latestResearch.median_sold_price,
    pricing_model_name: pricingModelName ?? latestResearch.pricing_model_name,
    query: latestResearch.query ?? undefined,
    raw_result_json: (latestResearch.raw_result_json ?? {}) as Json,
    sold_count: stats.soldCount,
    suggested_price: suggestedPrice,
  });

  // 11. Update listing price only if retry produced a valid condition-adjusted
  //     price
  let updatedListing: ListingRow = listing;
  if (warningResolved && llmConditionAdjustedPrice !== null) {
    updatedListing = await dataAccess.listings.update(listingId, {
      price: llmConditionAdjustedPrice,
    });
  }

  retryLogger.info('Completed pricing analysis retry.', {
    event: 'retry_pricing_analysis_completed',
    listingId,
    warningResolved,
    fallbackReason: fallbackReason ?? undefined,
    llmConditionAdjustedPrice,
    pricingModelName: pricingModelName ?? undefined,
  });

  return {
    listing: updatedListing,
    researchUpdated: true,
    warningResolved,
  };
}

export class RetryPricingAnalysisError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'RetryPricingAnalysisError';
    this.code = code;
  }
}
