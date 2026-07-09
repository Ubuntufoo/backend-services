export const GENERATED_DRAFT_METADATA_KEY = '__draft_metadata';
export const YEAR_UNVERIFIED_WARNING_CODE = 'year_unverified';

type JsonRecord = Record<string, unknown>;

export interface GeneratedDraftYearSignal {
  isUnverified: boolean;
  likelyYear: string | null;
  likelyYearRange: string | null;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

export function readGeneratedDraftYearSignal(itemSpecifics: unknown): GeneratedDraftYearSignal | null {
  if (!isRecord(itemSpecifics)) {
    return null;
  }

  const draftMetadata = itemSpecifics[GENERATED_DRAFT_METADATA_KEY];
  if (!isRecord(draftMetadata)) {
    return null;
  }

  const year = draftMetadata.year;
  if (!isRecord(year)) {
    return null;
  }

  const isUnverified =
    year.status === 'unverified' || year.warning_code === YEAR_UNVERIFIED_WARNING_CODE;

  if (!isUnverified) {
    return null;
  }

  return {
    isUnverified: true,
    likelyYear: asNullableString(year.likely_year),
    likelyYearRange: asNullableString(year.likely_year_range),
  };
}
