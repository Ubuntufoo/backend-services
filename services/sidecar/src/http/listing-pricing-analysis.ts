import type { ListingPriceResearchRow, ListingRow } from '@ebay-inventory/data';
import type { ListingPricingAnalysisWarning, PricingAnalysisWarningFailureSummary } from '@ebay-inventory/types';

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

    if (!analyst || !code || !reason || severity !== 'warning' || !summary || retryable === null) {
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

export type ListingApiResponse = ListingRow & {
  pricing_analysis_warnings: ListingPricingAnalysisWarning[];
};

export function serializeListing(
  listing: ListingRow,
  research: ListingPriceResearchRow | null
): ListingApiResponse {
  return {
    ...listing,
    pricing_analysis_warnings: getListingPricingAnalysisWarnings(listing, research),
  };
}
