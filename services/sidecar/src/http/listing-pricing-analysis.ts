import type { ListingPriceResearchRow, ListingRow } from '@ebay-inventory/data';
import type {
  ListingLatestPricingResearchCompSummary,
  ListingLatestPricingResearchSummary,
  ListingPricingAnalysisWarning,
  PricingAnalysisWarningFailureSummary,
} from '@ebay-inventory/types';

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

function mapFailureSummary(value: unknown): PricingAnalysisWarningFailureSummary | null {
  const record = asRecord(value);

  if (!record) {
    return null;
  }

  const summary: PricingAnalysisWarningFailureSummary = {
    ...(asString(record.errorCode) ? { error_code: asString(record.errorCode)! } : {}),
    ...(asString(record.errorStatus) ? { error_status: asString(record.errorStatus)! } : {}),
    ...(asString(record.provider) ? { provider: asString(record.provider)! } : {}),
    ...(asString(record.reason) ? { reason: asString(record.reason)! } : {}),
    ...(asBoolean(record.retryable) !== null ? { retryable: asBoolean(record.retryable)! } : {}),
    ...(asNumber(record.statusCode) !== null ? { status_code: asNumber(record.statusCode)! } : {}),
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
  const rejectedCompIds =
    asStringArray(research.llm_rejected_comp_ids).length > 0
      ? asStringArray(research.llm_rejected_comp_ids)
      : asStringArray(reasoning?.rejectedCompIds);

  return {
    rejected_comp_count: rejectedCompIds.length,
    rejected_comp_ids: rejectedCompIds,
    selected_comp_count: selectedCompIds.length,
    selected_comp_ids: selectedCompIds,
    total_comp_count: Array.isArray(research.comps) ? research.comps.length : 0,
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

export type ListingApiResponse = ListingRow & {
  latest_pricing_research: ListingLatestPricingResearchSummary | null;
  pricing_analysis_warnings: ListingPricingAnalysisWarning[];
};

export function serializeListing(
  listing: ListingRow,
  research: ListingPriceResearchRow | null
): ListingApiResponse {
  return {
    ...listing,
    latest_pricing_research: serializeLatestPricingResearch(research),
    pricing_analysis_warnings: getListingPricingAnalysisWarnings(listing, research),
  };
}
