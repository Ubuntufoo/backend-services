import type { GeneratedListingDraft } from '@/gemini/contracts.js';
import {
  GENERATED_YEAR_EVIDENCE_SOURCE_TYPES,
  containsStandaloneYear,
  isSupportedCardYear,
} from '@/gemini/year-normalization.js';

export const GENERATED_DRAFT_METADATA_KEY = '__draft_metadata';

type JsonRecord = Record<string, unknown>;

export interface GeneratedDraftYearMetadata {
  image_index: number;
  source_type: NonNullable<GeneratedListingDraft['yearEvidence']>['sourceType'];
  visible_text: string;
  year: string;
}

export interface GeneratedDraftMetadata {
  year?: GeneratedDraftYearMetadata | null;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function asInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function isYearEvidenceSourceType(
  value: unknown
): value is NonNullable<GeneratedListingDraft['yearEvidence']>['sourceType'] {
  return (
    typeof value === 'string' &&
    GENERATED_YEAR_EVIDENCE_SOURCE_TYPES.includes(
      value as NonNullable<GeneratedListingDraft['yearEvidence']>['sourceType']
    )
  );
}

function toGeneratedDraftYearMetadata(value: unknown): GeneratedDraftYearMetadata | null {
  if (!isRecord(value)) {
    return null;
  }

  const year = asNullableString(value.year);
  const sourceType = value.source_type;
  const visibleText = asNullableString(value.visible_text);
  const imageIndex = asInteger(value.image_index);

  if (!year || !isSupportedCardYear(year)) {
    return null;
  }

  if (!isYearEvidenceSourceType(sourceType)) {
    return null;
  }

  if (!visibleText || !containsStandaloneYear(visibleText, year)) {
    return null;
  }

  if (imageIndex === null) {
    return null;
  }

  return {
    image_index: imageIndex,
    source_type: sourceType,
    visible_text: visibleText,
    year,
  };
}

export function buildGeneratedDraftMetadata(
  yearEvidence: GeneratedListingDraft['yearEvidence']
): GeneratedDraftMetadata | null {
  if (!yearEvidence) {
    return null;
  }

  const metadata = toGeneratedDraftYearMetadata({
    image_index: yearEvidence.imageIndex,
    source_type: yearEvidence.sourceType,
    visible_text: yearEvidence.visibleText,
    year: yearEvidence.year,
  });

  if (!metadata) {
    return null;
  }

  return {
    year: metadata,
  };
}

export function readGeneratedDraftYearMetadata(itemSpecifics: unknown): GeneratedDraftYearMetadata | null {
  if (!isRecord(itemSpecifics)) {
    return null;
  }

  const draftMetadata = itemSpecifics[GENERATED_DRAFT_METADATA_KEY];
  if (!isRecord(draftMetadata)) {
    return null;
  }

  const year = draftMetadata.year;
  return toGeneratedDraftYearMetadata(year);
}

export function readCurrentCanonicalYear(itemSpecifics: unknown): string | null {
  if (!isRecord(itemSpecifics)) {
    return null;
  }

  const value = itemSpecifics.Year;
  if (typeof value !== 'string') {
    return null;
  }

  const year = asNullableString(value);
  return year && isSupportedCardYear(year) ? year : null;
}

export function readAuthorizedGeneratedDraftYearMetadata(
  itemSpecifics: unknown
): GeneratedDraftYearMetadata | null {
  const metadata = readGeneratedDraftYearMetadata(itemSpecifics);
  if (!metadata) {
    return null;
  }

  return readCurrentCanonicalYear(itemSpecifics) === metadata.year ? metadata : null;
}
