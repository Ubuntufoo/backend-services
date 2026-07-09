import type { ListingPriceResearchRow, ListingRow } from '@ebay-inventory/data';
import type {
  ListingIdentityWarning,
  ListingLatestPricingResearchFailureSummary,
  ListingLatestPricingResearchCompSummary,
  ListingLatestPricingResearchSummary,
  ListingPricingAnalysisWarning,
  PricingAnalysisWarningFailureSummary,
} from '@ebay-inventory/types';
import { readGeneratedDraftYearSignal } from '@/pricing/generated-draft-metadata.js';

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
  const selectedCompIds = asStringArray(reasoning?.selectedCompIds);
  const rejectedCompIdsFromRow = asStringArray(research.llm_rejected_comp_ids);
  const rejectedCompIds =
    rejectedCompIdsFromRow.length > 0 ? rejectedCompIdsFromRow : asStringArray(reasoning?.rejectedCompIds);

  return {
    rejected_comp_count: rejectedCompIds.length,
    rejected_comp_ids: rejectedCompIds,
    selected_comp_count: selectedCompIds.length,
    selected_comp_ids: selectedCompIds,
    total_comp_count: Array.isArray(research.comps) ? research.comps.length : 0,
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
    compSummary.selected_comp_count
  );
  const rejectedCompCount = firstCount(
    diagnostics?.normalizationRejectedCount,
    diagnostics?.rejectedCompCount,
    normalization?.rejectedCount,
    compSummary.rejected_comp_count
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
    firstCount(diagnostics?.rawCompCount, diagnostics?.normalizationInputCount, normalization?.rawCount),
  ].filter((value): value is number => value !== null);
  const zeroCountsOnly = allCounts.length > 0 && allCounts.every((value) => value === 0);
  const zeroContext = hasZeroResultsText(research.error_message) || hasZeroResultsText(failure?.message);

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

  if (zeroCountsOnly || (providerReturnedCount === 0 && !hasProviderFailureContext) || zeroContext) {
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

export function serializeLatestPricingResearch(
  research: ListingPriceResearchRow | null
): ListingLatestPricingResearchSummary | null {
  if (!research) {
    return null;
  }

  return {
    comp_summary: getLatestPricingResearchCompSummary(research),
    confidence: asString(research.confidence),
    created_at: research.created_at,
    error_code: asString(research.error_code),
    error_message: sanitizeErrorMessage(research.error_message),
    failure_summary: buildFailureSummary(research),
    listing_id: research.listing_id,
    llm_price_explanation: asString(research.llm_price_explanation),
    median_sold_price: asNumber(research.median_sold_price),
    pricing_model_name: asString(research.pricing_model_name),
    provider: research.provider,
    query: asString(research.query),
    research_id: research.id,
    sold_count: asNumber(research.sold_count),
    status: research.status,
    suggested_price: asNumber(research.suggested_price),
    updated_at: research.updated_at,
  };
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

function getListingIdentityWarnings(
  listing: Pick<ListingRow, 'item_specifics'>
): ListingIdentityWarning[] {
  const yearSignal = readGeneratedDraftYearSignal(listing.item_specifics);

  if (!yearSignal?.isUnverified) {
    return [];
  }

  return [
    {
      code: 'year_unverified',
      likely_year: yearSignal.likelyYear,
      likely_year_range: yearSignal.likelyYearRange,
      severity: 'warning',
      summary: 'Card year is unverified.',
    },
  ];
}

export type ListingApiResponse = ListingRow & {
  identity_warnings: ListingIdentityWarning[];
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
    identity_warnings: getListingIdentityWarnings(listing),
    latest_pricing_research: serializeLatestPricingResearch(research),
    pricing_analysis_warnings: getListingPricingAnalysisWarnings(listing, research),
  };
}
