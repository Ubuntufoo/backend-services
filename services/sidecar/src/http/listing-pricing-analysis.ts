import type { ListingPriceResearchRow, ListingRow } from '@ebay-inventory/data';
import type {
  ListingActiveMarketAnchor,
  ListingActiveMarketCompetitor,
  ListingActiveMarketDistribution,
  ListingActiveMarketDistributions,
  ListingActiveMarketItemPriceWindow,
  ListingActiveMarketMoney,
  ListingActiveMarketMultipliers,
  ListingActiveMarketQuery,
  ListingActiveMarketSafeguards,
  ListingActiveMarketShippingContext,
  ListingLatestPricingResearchActiveMarket,
  ListingLatestPricingResearchFailureSummary,
  ListingLatestPricingResearchCompSummary,
  ListingLatestPricingResearchPriceAdjustment,
  ListingLatestPricingResearchSummary,
  ListingPriceAdjustmentConditionReason,
  ListingPricingAnalysisWarning,
  PricingAnalysisWarningFailureSummary,
} from '@ebay-inventory/types';

const GENERATED_DRAFT_METADATA_KEY = '__draft_metadata';

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as JsonRecord;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asCount(value: unknown): number | null {
  const normalized = asNumber(value);
  return normalized !== null && normalized >= 0 ? Math.trunc(normalized) : null;
}

function asPositiveNumber(value: unknown): number | null {
  const normalized = asNumber(value);
  return normalized !== null && normalized > 0 ? normalized : null;
}

function asNullableNumber(value: unknown): number | null | undefined {
  return value === null ? null : (asNumber(value) ?? undefined);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    const normalized = asString(entry);
    return normalized ? [normalized] : [];
  });
}

export function getDismissedPricingWarningCodes(
  research: Pick<ListingPriceResearchRow, 'dismissed_pricing_warning_codes'> | null | undefined
): string[] {
  return asStringArray(research?.dismissed_pricing_warning_codes);
}

const URL_REDACTION_PATTERN = /\bhttps?:\/\/\S+/giu;
const KEYED_SECRET_PATTERN =
  /\b((?:api|access|refresh|bearer|auth|client|secret|session|user)?[_-]?(?:token|key|secret|password))\s*[:=]\s*([^\s,;]+)/giu;
const AUTHORIZATION_PATTERN = /\b(authorization)\s*[:=]\s*(bearer\s+[^\s,;]+)/giu;
const BASIC_AUTH_PATTERN = /\bbasic\s+[A-Za-z0-9+/=]{12,}\b/gu;
const STANDALONE_TOKEN_PATTERN = /\b(?:sk|rk|pk|pat)_[A-Za-z0-9_-]{8,}\b/gu;

function redactInlineSecrets(value: string): string {
  return value
    .replace(URL_REDACTION_PATTERN, '[redacted-url]')
    .replace(KEYED_SECRET_PATTERN, (_match, key: string) => `${key}=[redacted]`)
    .replace(AUTHORIZATION_PATTERN, (_match, key: string) => `${key}=[redacted]`)
    .replace(BASIC_AUTH_PATTERN, 'basic [redacted]')
    .replace(STANDALONE_TOKEN_PATTERN, '[redacted]');
}

function sanitizeErrorMessage(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const firstLine = value
    .split(/\r?\n/u)
    .map((part) => part.trim())
    .find((part) => part.length > 0);

  return firstLine ? redactInlineSecrets(firstLine).slice(0, 500) : null;
}

function sanitizeSummaryString(value: unknown, maxLength = 160): string | null {
  const sanitized = sanitizeErrorMessage(value);
  return sanitized ? sanitized.slice(0, maxLength) : null;
}

function sanitizeReasonCountKey(value: unknown): string | null {
  const sanitized = sanitizeSummaryString(value, 80);

  if (!sanitized) {
    return null;
  }

  const normalized = sanitized
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .slice(0, 48);

  return normalized.length > 0 ? normalized : null;
}

function firstCount(...values: unknown[]): number | null {
  for (const value of values) {
    const count = asCount(value);
    if (count !== null) {
      return count;
    }
  }

  return null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const normalized = sanitizeSummaryString(value);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function firstRawString(...values: unknown[]): string | null {
  for (const value of values) {
    const normalized = asString(value);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function hasExplicitProviderFailureDetails(value: unknown): boolean {
  const record = asRecord(value);

  return Boolean(
    firstRawString(
      record?.providerFailureCode,
      record?.providerFailureCategory,
      record?.providerFailureStatus
    )
  );
}

function hasProviderRoutingFailureEvidence(value: unknown): boolean {
  const record = asRecord(value);

  return Boolean(
    record &&
    (hasExplicitProviderFailureDetails(record) ||
      firstRawString(record.provider, record.query, record.message) ||
      asRecord(record.rawResult))
  );
}

function hasZeroResultsText(value: unknown): boolean {
  const sanitized = sanitizeSummaryString(value, 240);

  if (!sanitized) {
    return false;
  }

  return (
    /\b(?:zero|0|no)\s+(?:provider\s+)?(?:results?|returned\s+results?|comps?)\b/iu.test(
      sanitized
    ) || /\breturned\s+0\b/iu.test(sanitized)
  );
}

function getRejectedReasonCounts(value: unknown): Record<string, number> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const counts = new Map<string, number>();

  for (const entry of value) {
    const record = asRecord(entry);
    const key = sanitizeReasonCountKey(record?.reason) ?? sanitizeReasonCountKey(record?.code);

    if (!key) {
      continue;
    }

    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return counts.size > 0 ? Object.fromEntries(counts) : undefined;
}

function mapFailureSummary(value: unknown): PricingAnalysisWarningFailureSummary | null {
  const record = asRecord(value);

  if (!record) {
    return null;
  }

  const errorCode = asString(record.errorCode);
  const errorStatus = asString(record.errorStatus);
  const provider = asString(record.provider);
  const reason = asString(record.reason);
  const retryable = asBoolean(record.retryable);
  const statusCode = asNumber(record.statusCode);

  const summary: PricingAnalysisWarningFailureSummary = {
    ...(errorCode ? { error_code: errorCode } : {}),
    ...(errorStatus ? { error_status: errorStatus } : {}),
    ...(provider ? { provider } : {}),
    ...(reason ? { reason } : {}),
    ...(retryable !== null ? { retryable } : {}),
    ...(statusCode !== null ? { status_code: statusCode } : {}),
  };

  return Object.keys(summary).length > 0 ? summary : null;
}

export function getListingPricingAnalysisWarnings(
  listing: Pick<ListingRow, 'listing_id'>,
  research: ListingPriceResearchRow | null
): ListingPricingAnalysisWarning[] {
  const reasoning = asRecord(research?.llm_reasoning_json);
  const rawWarnings = reasoning?.warnings;
  const dismissedCodes = new Set(getDismissedPricingWarningCodes(research));

  if (!Array.isArray(rawWarnings) || !research) {
    return [];
  }

  return rawWarnings.flatMap((warning): ListingPricingAnalysisWarning[] => {
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

    if (
      !analyst ||
      !code ||
      !reason ||
      severity !== 'warning' ||
      !summary ||
      retryable === null ||
      dismissedCodes.has(code)
    ) {
      return [];
    }

    return [
      {
        analyst,
        code,
        failure: mapFailureSummary(record.failure),
        listing_id: listing.listing_id,
        model_name: asString(record.modelName),
        reason,
        research_id: research.id,
        retryable,
        severity: 'warning',
        summary,
      },
    ];
  });
}

function getLatestPricingResearchCompSummary(
  research: ListingPriceResearchRow
): ListingLatestPricingResearchCompSummary {
  const reasoning = asRecord(research.llm_reasoning_json);
  const rawResult = asRecord(research.raw_result_json);
  const diagnostics = asRecord(rawResult?.diagnostics);
  const normalization = asRecord(rawResult?.normalization);
  const output = asRecord(rawResult?.output);
  const providerResult = asRecord(rawResult?.providerResult);
  const providerResultOutput = asRecord(providerResult?.output);
  const selectedCompIds = asStringArray(reasoning?.selectedCompIds);
  const rejectedCompIdsFromRow = asStringArray(research.llm_rejected_comp_ids);
  const rejectedCompIds =
    rejectedCompIdsFromRow.length > 0
      ? rejectedCompIdsFromRow
      : asStringArray(reasoning?.rejectedCompIds);
  const normalizationAcceptedCount =
    firstCount(
      diagnostics?.normalizationAcceptedCount,
      diagnostics?.acceptedCompCount,
      normalization?.acceptedCount,
      Array.isArray(research.comps) ? research.comps.length : null
    ) ?? 0;
  const normalizationRejectedCount =
    firstCount(
      diagnostics?.normalizationRejectedCount,
      diagnostics?.rejectedCompCount,
      normalization?.rejectedCount,
      Array.isArray(normalization?.rejected) ? normalization.rejected.length : null
    ) ?? 0;
  const providerReturnedCount =
    firstCount(
      diagnostics?.providerReturnedCount,
      diagnostics?.rawCompCount,
      diagnostics?.normalizationInputCount,
      normalization?.inputCount,
      normalization?.rawCount,
      output?.itemCount,
      providerResultOutput?.itemCount,
      providerResult?.returnedSoldComps,
      normalizationAcceptedCount + normalizationRejectedCount
    ) ?? 0;
  const providerReportedTotalCount = firstCount(
    diagnostics?.providerReportedTotalCount,
    output?.totalItems,
    providerResultOutput?.totalItems
  );

  return {
    normalization_accepted_count: normalizationAcceptedCount,
    normalization_rejected_count: normalizationRejectedCount,
    ...(providerReportedTotalCount !== null
      ? { provider_reported_count: providerReportedTotalCount }
      : {}),
    provider_returned_count: providerReturnedCount,
    rejected_comp_count: rejectedCompIds.length,
    rejected_comp_ids: rejectedCompIds,
    selected_comp_count: selectedCompIds.length,
    selected_comp_ids: selectedCompIds,
    total_comp_count: normalizationAcceptedCount,
  };
}

function buildFailureSummary(
  research: ListingPriceResearchRow
): ListingLatestPricingResearchFailureSummary | null {
  if (research.status !== 'failed') {
    return null;
  }

  const rawResult = asRecord(research.raw_result_json);
  const diagnostics = asRecord(rawResult?.diagnostics);
  const normalization = asRecord(rawResult?.normalization);
  const providerRouting = asRecord(rawResult?.providerRouting);
  const firstProviderFailure = asRecord(providerRouting?.firstProviderFailure);
  const failure = asRecord(rawResult?.failure);
  const providerResult = asRecord(rawResult?.providerResult);
  const providerResultOutput = asRecord(providerResult?.output);
  const providerResultRequest = asRecord(asRecord(providerResult?.input)?.request);
  const compSummary = getLatestPricingResearchCompSummary(research);

  const provider = firstString(
    firstProviderFailure?.provider,
    failure?.provider,
    diagnostics?.actualProvider,
    diagnostics?.selectedProvider,
    research.provider
  );
  const query = firstString(firstProviderFailure?.query, failure?.query, research.query);
  const requestedCount = firstCount(diagnostics?.requestedCount, providerResultRequest?.count);
  const providerReturnedCount = firstCount(
    diagnostics?.providerReturnedCount,
    diagnostics?.rawCompCount,
    diagnostics?.normalizationInputCount,
    normalization?.inputCount,
    normalization?.rawCount,
    providerResultOutput?.itemCount,
    providerResult?.returnedSoldComps
  );
  const acceptedCompCount = firstCount(
    diagnostics?.normalizationAcceptedCount,
    diagnostics?.acceptedCompCount,
    normalization?.acceptedCount,
    compSummary.normalization_accepted_count
  );
  const rejectedCompCount = firstCount(
    diagnostics?.normalizationRejectedCount,
    diagnostics?.rejectedCompCount,
    normalization?.rejectedCount,
    compSummary.normalization_rejected_count
  );
  const rejectedReasonCounts = getRejectedReasonCounts(normalization?.rejected);

  const baseSummary = {
    ...(provider ? { provider } : {}),
    ...(query ? { query } : {}),
  };
  const countSummary = {
    ...(requestedCount !== null ? { requested_count: requestedCount } : {}),
    ...(providerReturnedCount !== null ? { provider_returned_count: providerReturnedCount } : {}),
    ...(acceptedCompCount !== null ? { accepted_comp_count: acceptedCompCount } : {}),
    ...(rejectedCompCount !== null ? { rejected_comp_count: rejectedCompCount } : {}),
  };
  const hasProviderFailureContext =
    hasExplicitProviderFailureDetails(failure) ||
    hasProviderRoutingFailureEvidence(firstProviderFailure);
  const allCounts = [
    providerReturnedCount,
    firstCount(
      diagnostics?.rawCompCount,
      diagnostics?.normalizationInputCount,
      normalization?.rawCount
    ),
  ].filter((value): value is number => value !== null);
  const zeroCountsOnly = allCounts.length > 0 && allCounts.every((value) => value === 0);
  const zeroContext =
    hasZeroResultsText(research.error_message) || hasZeroResultsText(failure?.message);

  if (
    (providerReturnedCount ?? 0) > 0 &&
    (acceptedCompCount ?? 0) === 0 &&
    (rejectedCompCount ?? 0) > 0
  ) {
    return {
      ...baseSummary,
      ...countSummary,
      ...(rejectedReasonCounts ? { rejected_reason_counts: rejectedReasonCounts } : {}),
      reason: 'all_comps_rejected',
    };
  }

  if (
    zeroCountsOnly ||
    (providerReturnedCount === 0 && !hasProviderFailureContext) ||
    zeroContext
  ) {
    return {
      ...baseSummary,
      ...countSummary,
      reason: 'provider_zero_results',
    };
  }

  if (hasProviderFailureContext) {
    const providerFailureCode = firstString(
      firstProviderFailure?.providerFailureCode,
      failure?.providerFailureCode
    );
    const providerFailureCategory = firstString(
      firstProviderFailure?.providerFailureCategory,
      failure?.providerFailureCategory
    );
    const providerFailureStatus = firstString(
      firstProviderFailure?.providerFailureStatus,
      failure?.providerFailureStatus,
      asRecord(firstProviderFailure?.rawResult)?.status,
      asRecord(failure?.rawResult)?.status
    );

    return {
      ...baseSummary,
      ...(providerFailureCategory ? { provider_failure_category: providerFailureCategory } : {}),
      ...(providerFailureCode ? { provider_failure_code: providerFailureCode } : {}),
      ...(providerFailureStatus ? { provider_failure_status: providerFailureStatus } : {}),
      reason: 'provider_failure',
    };
  }

  return {
    ...(provider ? { provider } : {}),
    ...(query ? { query } : {}),
    reason: 'unknown',
  };
}

const ACTIVE_MARKET_STATUSES = new Set(['available', 'skipped', 'unavailable']);

const ACTIVE_MARKET_BUYING_OPTION = 'FIXED_PRICE';
const ACTIVE_MARKET_ANCHOR_BASIS = 'condition_adjusted_base_price_before_competitive_velocity';
const ACTIVE_MARKET_SHIPPING_CONTEXT_BASIS = 'configured_contextual_location';

const ACTIVE_MARKET_SKIP_REASONS = new Set(['browse_disabled']);
const ACTIVE_MARKET_UNAVAILABLE_REASONS = new Set([
  'missing_anchor',
  'invalid_options',
  'missing_shipping_context',
  'seller_identity_unavailable',
  'time_limit',
  'auth_failed',
  'api_failed',
  'malformed_response',
]);
const ACTIVE_MARKET_INCOMPLETE_REASONS = new Set([
  'page_limit',
  'time_limit',
  'offset_limit',
  'page_error',
]);

function requiredString(value: unknown): string | undefined {
  return asString(value) ?? undefined;
}

function nullableString(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  return asString(value) ?? undefined;
}

function requiredBoolean(value: unknown): boolean | undefined {
  return asBoolean(value) ?? undefined;
}

function requiredCount(value: unknown): number | undefined {
  return asCount(value) ?? undefined;
}

function nullableCount(value: unknown): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  return asCount(value) ?? undefined;
}

function nullableNumber(value: unknown): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  return asNumber(value) ?? undefined;
}

function mapRequiredActiveMarketMoney(value: unknown): ListingActiveMarketMoney | undefined {
  const record = asRecord(value);

  if (!record) {
    return undefined;
  }

  const amount = asNumber(record.value);
  const currency = asString(record.currency);

  if (amount === null || !currency) {
    return undefined;
  }

  return { value: amount, currency };
}

function mapNullableActiveMarketMoney(value: unknown): ListingActiveMarketMoney | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  return mapRequiredActiveMarketMoney(value);
}

function mapRequiredActiveMarketDistribution(
  value: unknown
): ListingActiveMarketDistribution | undefined {
  const record = asRecord(value);

  if (!record) {
    return undefined;
  }

  const low = asNumber(record.low);
  const median = asNumber(record.median);
  const high = asNumber(record.high);
  const currency = asString(record.currency);

  if (low === null || median === null || high === null || !currency) {
    return undefined;
  }

  return { low, median, high, currency };
}

function mapNullableActiveMarketDistribution(
  value: unknown
): ListingActiveMarketDistribution | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  return mapRequiredActiveMarketDistribution(value);
}

function mapActiveMarketQuery(value: unknown): ListingActiveMarketQuery | undefined {
  const record = asRecord(value);

  if (!record) {
    return undefined;
  }

  const marketplaceId = requiredString(record.marketplaceId);
  const buyingOption = requiredString(record.buyingOption);
  const canonical = nullableString(record.canonical);
  const categoryId = nullableString(record.categoryId);
  const conditionId = nullableString(record.conditionId);

  if (
    !marketplaceId ||
    buyingOption !== ACTIVE_MARKET_BUYING_OPTION ||
    canonical === undefined ||
    categoryId === undefined ||
    conditionId === undefined
  ) {
    return undefined;
  }

  return {
    canonical,
    marketplace_id: marketplaceId,
    category_id: categoryId,
    condition_id: conditionId,
    buying_option: buyingOption,
  };
}

function mapActiveMarketAnchor(value: unknown): ListingActiveMarketAnchor | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  const record = asRecord(value);

  if (!record) {
    return undefined;
  }

  const amount = asNumber(record.value);
  const currency = asString(record.currency);
  const basis = asString(record.basis);

  if (amount === null || !currency || basis !== ACTIVE_MARKET_ANCHOR_BASIS) {
    return undefined;
  }

  return { value: amount, currency, basis };
}

function mapActiveMarketMultipliers(
  value: unknown
): ListingActiveMarketMultipliers | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  const record = asRecord(value);

  if (!record) {
    return undefined;
  }

  const minPriceMultiplier = asNumber(record.minPriceMultiplier);
  const maxPriceMultiplier = asNumber(record.maxPriceMultiplier);

  if (minPriceMultiplier === null || maxPriceMultiplier === null) {
    return undefined;
  }

  return {
    min_price_multiplier: minPriceMultiplier,
    max_price_multiplier: maxPriceMultiplier,
  };
}

function mapActiveMarketItemPriceWindow(
  value: unknown
): ListingActiveMarketItemPriceWindow | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  const record = asRecord(value);

  if (!record) {
    return undefined;
  }

  const min = asNumber(record.min);
  const max = asNumber(record.max);
  const currency = asString(record.currency);

  if (min === null || max === null || !currency) {
    return undefined;
  }

  return { min, max, currency };
}

function mapActiveMarketShippingContext(
  value: unknown
): ListingActiveMarketShippingContext | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  const record = asRecord(value);

  if (!record) {
    return undefined;
  }

  const country = asString(record.country);
  const postalCode = asString(record.postalCode);
  const basis = asString(record.basis);

  if (!country || !postalCode || basis !== ACTIVE_MARKET_SHIPPING_CONTEXT_BASIS) {
    return undefined;
  }

  return { country, postal_code: postalCode, basis };
}

function mapActiveMarketSafeguards(value: unknown): ListingActiveMarketSafeguards | undefined {
  const record = asRecord(value);

  if (!record) {
    return undefined;
  }

  const maxPages = requiredCount(record.maxPages);
  const maxDurationMs = requiredCount(record.maxDurationMs);
  const maxOffset = requiredCount(record.maxOffset);

  if (maxPages === undefined || maxDurationMs === undefined || maxOffset === undefined) {
    return undefined;
  }

  return {
    max_pages: maxPages,
    max_duration_ms: maxDurationMs,
    max_offset: maxOffset,
  };
}

function mapActiveMarketRejectionReasonCounts(value: unknown): Record<string, number> | undefined {
  const record = asRecord(value);

  if (!record) {
    return undefined;
  }

  const counts: Record<string, number> = {};

  for (const [rawKey, countValue] of Object.entries(record)) {
    const key = sanitizeReasonCountKey(rawKey);
    const count = asCount(countValue);

    if (!key || count === null) {
      return undefined;
    }

    counts[key] = (counts[key] ?? 0) + count;
  }

  return counts;
}

function mapActiveMarketCompetitors(value: unknown): ListingActiveMarketCompetitor[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const competitors: ListingActiveMarketCompetitor[] = [];

  for (const entry of value) {
    const record = asRecord(entry);

    if (!record) {
      return undefined;
    }

    const legacyItemId = requiredString(record.legacyItemId);
    const title = requiredString(record.title);
    const itemUrl = requiredString(record.itemUrl);
    const itemPrice = mapRequiredActiveMarketMoney(record.itemPrice);
    const condition = nullableString(record.condition);
    const conditionId = nullableString(record.conditionId);
    const shippingType = nullableString(record.shippingType);
    const shippingCost = mapNullableActiveMarketMoney(record.shippingCost);
    const totalPrice = mapNullableActiveMarketMoney(record.totalPrice);

    if (
      !legacyItemId ||
      !title ||
      !itemUrl ||
      !itemPrice ||
      condition === undefined ||
      conditionId === undefined ||
      shippingType === undefined ||
      shippingCost === undefined ||
      totalPrice === undefined
    ) {
      return undefined;
    }

    competitors.push({
      legacy_item_id: legacyItemId,
      title,
      condition,
      condition_id: conditionId,
      item_price: itemPrice,
      shipping_cost: shippingCost,
      shipping_type: shippingType,
      total_price: totalPrice,
      item_url: itemUrl,
    });
  }

  return competitors;
}

function mapActiveMarketDistributions(
  value: unknown,
  complete: boolean
): ListingActiveMarketDistributions | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return complete ? undefined : null;
  }

  if (!complete) {
    return undefined;
  }

  const record = asRecord(value);

  if (!record) {
    return undefined;
  }

  const itemPrice = mapNullableActiveMarketDistribution(record.itemPrice);
  const shippingKnownTotal = mapNullableActiveMarketDistribution(record.shippingKnownTotal);

  if (itemPrice === undefined || shippingKnownTotal === undefined) {
    return undefined;
  }

  return {
    item_price: itemPrice,
    shipping_known_total: shippingKnownTotal,
  };
}

function buildLatestPricingResearchActiveMarket(
  research: ListingPriceResearchRow
): ListingLatestPricingResearchActiveMarket | null {
  const rawResult = asRecord(research.raw_result_json);
  const activeMarket = asRecord(rawResult?.activeMarket);

  if (!activeMarket) {
    return null;
  }

  const status = requiredString(activeMarket.status);
  const capturedAt = requiredString(activeMarket.capturedAt);
  const complete = requiredBoolean(activeMarket.complete);

  if (!status || !ACTIVE_MARKET_STATUSES.has(status) || !capturedAt || complete === undefined) {
    return null;
  }

  const skipReason = nullableString(activeMarket.skipReason);
  const unavailableReason = nullableString(activeMarket.unavailableReason);
  const incompleteReason = nullableString(activeMarket.incompleteReason);

  if (
    skipReason === undefined ||
    unavailableReason === undefined ||
    incompleteReason === undefined
  ) {
    return null;
  }

  if (skipReason !== null && !ACTIVE_MARKET_SKIP_REASONS.has(skipReason)) {
    return null;
  }
  if (unavailableReason !== null && !ACTIVE_MARKET_UNAVAILABLE_REASONS.has(unavailableReason)) {
    return null;
  }
  if (incompleteReason !== null && !ACTIVE_MARKET_INCOMPLETE_REASONS.has(incompleteReason)) {
    return null;
  }

  if (status === 'skipped' && skipReason === null) {
    return null;
  }
  if (status !== 'skipped' && skipReason !== null) {
    return null;
  }
  if (status === 'unavailable' && unavailableReason === null) {
    return null;
  }
  if (status !== 'unavailable' && unavailableReason !== null) {
    return null;
  }
  if ((status === 'skipped' || status === 'unavailable') && complete) {
    return null;
  }

  const incompleteAvailable = status === 'available' && !complete;
  if (incompleteAvailable && incompleteReason === null) {
    return null;
  }
  if (!incompleteAvailable && incompleteReason !== null) {
    return null;
  }

  const exactAcceptedCount = nullableCount(activeMarket.exactAcceptedCount);

  if (exactAcceptedCount === undefined) {
    return null;
  }
  if (complete && exactAcceptedCount === null) {
    return null;
  }
  if (!complete && exactAcceptedCount !== null) {
    return null;
  }

  const pagesScanned = requiredCount(activeMarket.pagesScanned);
  const candidateRowsScanned = requiredCount(activeMarket.candidateRowsScanned);
  const acceptedCount = requiredCount(activeMarket.acceptedCount);
  const rejectedCount = requiredCount(activeMarket.rejectedCount);
  const shippingKnownAcceptedCount = requiredCount(activeMarket.shippingKnownAcceptedCount);
  const latencyMs = requiredCount(activeMarket.latencyMs);
  const sellerExclusionApplied = requiredBoolean(activeMarket.sellerExclusionApplied);

  if (
    pagesScanned === undefined ||
    candidateRowsScanned === undefined ||
    acceptedCount === undefined ||
    rejectedCount === undefined ||
    shippingKnownAcceptedCount === undefined ||
    latencyMs === undefined ||
    sellerExclusionApplied === undefined
  ) {
    return null;
  }

  const query = mapActiveMarketQuery(activeMarket.query);
  const safeguards = mapActiveMarketSafeguards(activeMarket.safeguards);
  const rejectionReasonCounts = mapActiveMarketRejectionReasonCounts(
    activeMarket.rejectionReasonCounts
  );
  const competitors = mapActiveMarketCompetitors(activeMarket.competitors);

  if (!query || !safeguards || !rejectionReasonCounts || !competitors) {
    return null;
  }

  const anchor = mapActiveMarketAnchor(activeMarket.anchor);
  const multipliers = mapActiveMarketMultipliers(activeMarket.multipliers);
  const itemPriceWindow = mapActiveMarketItemPriceWindow(activeMarket.itemPriceWindow);
  const shippingContext = mapActiveMarketShippingContext(activeMarket.shippingContext);

  if (
    anchor === undefined ||
    multipliers === undefined ||
    itemPriceWindow === undefined ||
    shippingContext === undefined
  ) {
    return null;
  }

  const distributions = mapActiveMarketDistributions(activeMarket.distributions, complete);

  if (distributions === undefined) {
    return null;
  }

  const tacticalSellPrice = nullableNumber(activeMarket.tacticalSellPrice);

  if (tacticalSellPrice === undefined || tacticalSellPrice !== null) {
    return null;
  }

  return {
    status: status as ListingLatestPricingResearchActiveMarket['status'],
    skip_reason: skipReason,
    unavailable_reason: unavailableReason,
    incomplete_reason: incompleteReason,
    captured_at: capturedAt,
    anchor,
    multipliers,
    item_price_window: itemPriceWindow,
    query,
    seller_exclusion_applied: sellerExclusionApplied,
    shipping_context: shippingContext,
    safeguards,
    pages_scanned: pagesScanned,
    candidate_rows_scanned: candidateRowsScanned,
    complete,
    exact_accepted_count: exactAcceptedCount,
    accepted_count: acceptedCount,
    rejected_count: rejectedCount,
    rejection_reason_counts: rejectionReasonCounts,
    distributions,
    shipping_known_accepted_count: shippingKnownAcceptedCount,
    latency_ms: latencyMs,
    tactical_sell_price: tacticalSellPrice,
    competitors,
  };
}

export function serializeLatestPricingResearch(
  research: ListingPriceResearchRow | null
): ListingLatestPricingResearchSummary | null {
  if (!research) {
    return null;
  }

  const medianSoldPrice = asNumber(research.median_sold_price);
  const hasTerapeakPriceBand =
    research.status === 'succeeded' &&
    research.provider === 'soldcomps' &&
    medianSoldPrice !== null &&
    medianSoldPrice > 0;
  const terapeakMinPrice = hasTerapeakPriceBand
    ? Math.max(1, Math.floor(medianSoldPrice / 3))
    : null;
  const terapeakMaxPrice =
    terapeakMinPrice === null || medianSoldPrice === null
      ? null
      : Math.max(terapeakMinPrice, Math.floor(medianSoldPrice * 3));
  const activeMarket = buildLatestPricingResearchActiveMarket(research);

  return {
    comp_summary: getLatestPricingResearchCompSummary(research),
    ...(activeMarket ? { active_market: activeMarket } : {}),
    confidence: asString(research.confidence),
    created_at: research.created_at,
    error_code: asString(research.error_code),
    error_message: sanitizeErrorMessage(research.error_message),
    failure_summary: buildFailureSummary(research),
    listing_id: research.listing_id,
    llm_price_explanation: asString(research.llm_price_explanation),
    median_sold_price: medianSoldPrice,
    pricing_model_name: asString(research.pricing_model_name),
    price_adjustment: buildPriceAdjustment(research),
    provider: research.provider,
    query: asString(research.query),
    research_id: research.id,
    sold_count: asNumber(research.sold_count),
    status: research.status,
    suggested_price: asNumber(research.suggested_price),
    terapeak_max_price: terapeakMaxPrice,
    terapeak_min_price: terapeakMinPrice,
    updated_at: research.updated_at,
  };
}

const PRICE_ADJUSTMENT_CONDITION_REASONS = new Set<ListingPriceAdjustmentConditionReason>([
  'eligible',
  'negative_blocked_for_top_condition',
  'listing_condition_unknown',
  'median_price_unavailable',
  'insufficient_explicit_comp_conditions',
  'comp_condition_median_unavailable',
  'target_price_invalid',
]);

function buildPriceAdjustment(
  research: ListingPriceResearchRow
): ListingLatestPricingResearchPriceAdjustment | null {
  if (research.status !== 'succeeded') {
    return null;
  }

  const rawResult = asRecord(research.raw_result_json);
  const conditionAdjustment = asRecord(rawResult?.conditionAdjustment);
  const allowedAdjustment = asRecord(conditionAdjustment?.allowedAdjustment);
  const finalPriceAdjustment = asRecord(rawResult?.finalPriceAdjustment);
  const listingConditionSignalValue = conditionAdjustment?.listingConditionSignal;
  const listingConditionSignal =
    listingConditionSignalValue === null ? null : asRecord(listingConditionSignalValue);
  const listingConditionLabel =
    listingConditionSignalValue === null ? null : asString(listingConditionSignal?.label);
  const listingConditionScore = asNullableNumber(conditionAdjustment?.listingConditionScore);
  const compMedianConditionScore = asNullableNumber(conditionAdjustment?.compMedianConditionScore);
  const observedConditionDelta = asNullableNumber(conditionAdjustment?.conditionDelta);
  const rawConditionPercent = asNullableNumber(allowedAdjustment?.rawPercent);
  const medianSoldPrice = asPositiveNumber(conditionAdjustment?.deterministicMedianPrice);
  const conditionAdjustedPrice = asPositiveNumber(finalPriceAdjustment?.basePrice);
  const competitiveDiscountPercent = asNumber(finalPriceAdjustment?.competitiveDiscountPercent);
  const competitiveAdjustedPrice = asPositiveNumber(finalPriceAdjustment?.competitiveAdjustedPrice);
  const recentWindowDays = asCount(finalPriceAdjustment?.recentWindowDays);
  const recentAcceptedCompCount = asCount(finalPriceAdjustment?.recentAcceptedCompCount);
  const salesVelocityTier = asString(finalPriceAdjustment?.salesVelocityTier);
  const salesVelocityDiscountPercent = asNumber(finalPriceAdjustment?.salesVelocityDiscountPercent);
  const finalSuggestedPrice = asPositiveNumber(finalPriceAdjustment?.finalPrice);
  const explicitCompConditionCount = asCount(conditionAdjustment?.explicitCompConditionCount);
  const conditionReason = asString(allowedAdjustment?.reason);

  if (
    !conditionAdjustment ||
    !allowedAdjustment ||
    !finalPriceAdjustment ||
    (listingConditionSignalValue !== null &&
      (!listingConditionSignal || listingConditionLabel === null)) ||
    listingConditionScore === undefined ||
    compMedianConditionScore === undefined ||
    observedConditionDelta === undefined ||
    rawConditionPercent === undefined ||
    medianSoldPrice === null ||
    conditionAdjustedPrice === null ||
    competitiveDiscountPercent === null ||
    competitiveAdjustedPrice === null ||
    recentWindowDays === null ||
    recentAcceptedCompCount === null ||
    (salesVelocityTier !== 'high' &&
      salesVelocityTier !== 'medium' &&
      salesVelocityTier !== 'low') ||
    salesVelocityDiscountPercent === null ||
    finalSuggestedPrice === null ||
    explicitCompConditionCount === null ||
    !conditionReason ||
    !PRICE_ADJUSTMENT_CONDITION_REASONS.has(
      conditionReason as ListingPriceAdjustmentConditionReason
    )
  ) {
    return null;
  }

  return {
    median_sold_price: medianSoldPrice,
    listing_condition_label: listingConditionLabel,
    listing_condition_score: listingConditionScore,
    explicit_comp_condition_count: explicitCompConditionCount,
    comp_median_condition_score: compMedianConditionScore,
    observed_condition_delta: observedConditionDelta,
    raw_condition_percent:
      rawConditionPercent === null ? null : ratioToPercentagePoints(rawConditionPercent),
    applied_condition_percent: ratioToPercentagePoints(
      conditionAdjustedPrice / medianSoldPrice - 1
    ),
    condition_adjusted_price: conditionAdjustedPrice,
    condition_reason: conditionReason as ListingPriceAdjustmentConditionReason,
    competitive_discount_percent: competitiveDiscountPercent,
    competitive_adjusted_price: competitiveAdjustedPrice,
    recent_window_days: recentWindowDays,
    recent_accepted_comp_count: recentAcceptedCompCount,
    sales_velocity_tier: salesVelocityTier,
    sales_velocity_discount_percent: salesVelocityDiscountPercent,
    final_total_adjustment_percent: ratioToPercentagePoints(
      finalSuggestedPrice / medianSoldPrice - 1
    ),
    final_suggested_price: finalSuggestedPrice,
  };
}

function ratioToPercentagePoints(value: number): number {
  const percentagePoints = Number((value * 100).toFixed(2));
  return Object.is(percentagePoints, -0) ? 0 : percentagePoints;
}

function sanitizeListingItemSpecifics(
  itemSpecifics: ListingRow['item_specifics']
): ListingRow['item_specifics'] {
  const record = asRecord(itemSpecifics);

  if (!record || !(GENERATED_DRAFT_METADATA_KEY in record)) {
    return itemSpecifics;
  }

  const { [GENERATED_DRAFT_METADATA_KEY]: _draftMetadata, ...rest } = record;
  return rest as ListingRow['item_specifics'];
}

export type ListingApiResponse = ListingRow & {
  identity_warnings: [];
  latest_pricing_research: ListingLatestPricingResearchSummary | null;
  pricing_analysis_warnings: ListingPricingAnalysisWarning[];
};

export function serializeListing(
  listing: ListingRow,
  research: ListingPriceResearchRow | null
): ListingApiResponse {
  return {
    ...listing,
    item_specifics: sanitizeListingItemSpecifics(listing.item_specifics),
    identity_warnings: [],
    latest_pricing_research: serializeLatestPricingResearch(research),
    pricing_analysis_warnings: getListingPricingAnalysisWarnings(listing, research),
  };
}
