import {
  GeminiDraftServiceError,
  type GeneratedListingDraft,
  generatedListingDraftSchema,
} from './contracts.js';
import { normalizeSkuCategoryCode } from '@ebay-inventory/types';
import { isRawCardConditionToken } from '@/listings/trading-card-conditions.js';

type DraftRecord = Record<string, unknown>;
type ConfidenceKey = 'title' | 'category' | 'price' | 'aspects';
type AspectRecord = Record<string, string | string[]>;

const CODE_FENCE_PATTERN = /^```(?:json)?\s*([\s\S]*?)\s*```$/i;
const CONFIDENCE_KEYS: ConfidenceKey[] = ['title', 'category', 'price', 'aspects'];
const TITLE_CARD_NUMBER_PATTERNS = [
  /(?:^|[\s([{])#\s*([A-Za-z0-9-]+)\b/i,
  /\bCard\s*#\s*([A-Za-z0-9-]+)\b/i,
  /\bCard\s+No\.?\s*([A-Za-z0-9-]+)\b/i,
  /\bCard\s+Number\s+([A-Za-z0-9-]+)\b/i,
];

function extractJsonPayload(rawText: string): string {
  const trimmed = rawText.trim();
  const fencedMatch = CODE_FENCE_PATTERN.exec(trimmed);

  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  return trimmed;
}

function isRecord(value: unknown): value is DraftRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseDraftObject(rawText: string): DraftRecord {
  const payload = extractJsonPayload(rawText);

  if (payload.length === 0) {
    throw new GeminiDraftServiceError('Gemini returned an empty listing draft response.');
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(payload);
  } catch (error) {
    throw new GeminiDraftServiceError('Gemini returned invalid JSON for the listing draft.', {
      cause: error,
    });
  }

  if (!isRecord(parsed)) {
    throw new GeminiDraftServiceError(
      'Gemini returned JSON for the listing draft, but it was not an object.'
    );
  }

  return parsed;
}

function normalizeRequiredString(
  value: unknown,
  fieldName: 'title' | 'description',
  warnings: string[]
): string {
  if (typeof value === 'string') {
    return value;
  }

  warnings.push(
    `Gemini response field "${fieldName}" was missing or invalid; defaulted to an empty string.`
  );

  return '';
}

function normalizeNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function normalizeCardConditionToken(
  value: unknown,
  warnings: string[]
): GeneratedListingDraft['cardConditionToken'] {
  if (value === undefined || value === null) {
    return null;
  }

  if (isRawCardConditionToken(value)) {
    return value;
  }

  warnings.push(
    'Gemini response field "cardConditionToken" was invalid and was reset to null.'
  );
  return null;
}

function normalizeAspects(value: unknown, warnings: string[]): Record<string, string | string[]> {
  if (!isRecord(value)) {
    return {};
  }

  const aspects: Record<string, string | string[]> = {};

  for (const [key, rawAspectValue] of Object.entries(value)) {
    if (typeof rawAspectValue === 'string') {
      aspects[key] = rawAspectValue;
      continue;
    }

    if (Array.isArray(rawAspectValue)) {
      const stringValues = rawAspectValue.filter(
        (entry): entry is string => typeof entry === 'string'
      );

      if (stringValues.length > 0) {
        aspects[key] = stringValues;
      }

      if (stringValues.length !== rawAspectValue.length || stringValues.length === 0) {
        warnings.push(`Gemini response aspect "${key}" contained invalid values and was filtered.`);
      }
      continue;
    }

    warnings.push(`Gemini response aspect "${key}" was invalid and was discarded.`);
  }

  return aspects;
}

function getAspectString(aspects: AspectRecord, key: string): string | null {
  const value = aspects[key];

  return typeof value === 'string' ? value : null;
}

function normalizeCardNumberValue(value: string): string {
  return value.trim().replace(/^#\s*/, '').trim();
}

function extractCardNumberFromTitle(title: string): string | null {
  for (const pattern of TITLE_CARD_NUMBER_PATTERNS) {
    const match = pattern.exec(title);
    const candidate = match?.[1];

    if (!candidate) {
      continue;
    }

    const normalized = normalizeCardNumberValue(candidate);

    if (normalized.length > 0) {
      return normalized;
    }
  }

  return null;
}

export function normalizeGeneratedDraft(
  draft: Pick<GeneratedListingDraft, 'title' | 'aspects' | 'warnings'>
): Pick<GeneratedListingDraft, 'title' | 'aspects' | 'warnings'> {
  const aspects: AspectRecord = { ...draft.aspects };
  const warnings = [...draft.warnings];

  const year = getAspectString(aspects, 'Year');
  const season = getAspectString(aspects, 'Season');
  if (!year && season) {
    aspects.Year = season;
  }

  const manufacturer = getAspectString(aspects, 'Manufacturer');
  const cardManufacturer = getAspectString(aspects, 'Card Manufacturer');
  if (!manufacturer && cardManufacturer) {
    aspects.Manufacturer = cardManufacturer;
  }

  const player = getAspectString(aspects, 'Player');
  const playerAthlete = getAspectString(aspects, 'Player/Athlete');
  const athlete = getAspectString(aspects, 'Athlete');

  if (!player && playerAthlete) {
    aspects.Player = playerAthlete;
  } else if (!player && athlete) {
    aspects.Player = athlete;
  }

  const cardNumber = getAspectString(aspects, 'Card Number');
  if (cardNumber) {
    const normalizedCardNumber = normalizeCardNumberValue(cardNumber);

    if (normalizedCardNumber.length > 0) {
      aspects['Card Number'] = normalizedCardNumber;
    }
  }

  const normalizedAspectCardNumber = getAspectString(aspects, 'Card Number');
  const titleCardNumber = extractCardNumberFromTitle(draft.title);

  if (!normalizedAspectCardNumber && titleCardNumber) {
    aspects['Card Number'] = titleCardNumber;
  } else if (
    normalizedAspectCardNumber &&
    titleCardNumber &&
    normalizedAspectCardNumber !== titleCardNumber
  ) {
    warnings.push(
      `Gemini response title card number "${titleCardNumber}" conflicted with aspects["Card Number"] "${normalizedAspectCardNumber}"; kept aspect value.`
    );
  }

  return {
    title: draft.title,
    aspects,
    warnings,
  };
}

function normalizePriceSuggestion(value: unknown, warnings: string[]): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (value !== undefined && value !== null) {
    warnings.push('Gemini response field "priceSuggestion" was invalid and was reset to null.');
  }

  return null;
}

function normalizeSkuCategoryCodeSuggestion(
  value: unknown,
  warnings: string[]
): NonNullable<GeneratedListingDraft['skuCategoryCode']> {
  const normalized = normalizeSkuCategoryCode(value);

  if (normalized) {
    return normalized;
  }

  if (value !== undefined && value !== null) {
    warnings.push('Gemini response field "skuCategoryCode" was invalid and defaulted to OTHER.');
  }

  return 'OTHER';
}

function normalizeConfidence(
  value: unknown,
  warnings: string[]
): GeneratedListingDraft['confidence'] {
  if (!isRecord(value)) {
    return {};
  }

  const confidence: NonNullable<GeneratedListingDraft['confidence']> = {};

  for (const key of CONFIDENCE_KEYS) {
    const rawValue = value[key];

    if (typeof rawValue === 'number' && Number.isFinite(rawValue) && rawValue >= 0 && rawValue <= 1) {
      confidence[key] = rawValue;
      continue;
    }

    if (rawValue !== undefined) {
      warnings.push(`Gemini response field "confidence.${key}" was invalid and was discarded.`);
    }
  }

  return confidence;
}

function normalizeModelWarnings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === 'string');
}

export function parseGeneratedDraft(
  rawText: string,
  rawModelResponse: unknown
): GeneratedListingDraft {
  const parsed = parseDraftObject(rawText);
  const serviceWarnings: string[] = [];
  const modelWarnings = normalizeModelWarnings(parsed.warnings);
  const title = normalizeRequiredString(parsed.title, 'title', serviceWarnings);
  const description = normalizeRequiredString(parsed.description, 'description', serviceWarnings);
  const categorySuggestion = normalizeNullableString(parsed.categorySuggestion);
  const cardConditionNote = normalizeNullableString(parsed.cardConditionNote);
  const cardConditionToken = normalizeCardConditionToken(parsed.cardConditionToken, serviceWarnings);
  const conditionSuggestion = normalizeNullableString(parsed.conditionSuggestion);
  const skuCategoryCode = normalizeSkuCategoryCodeSuggestion(parsed.skuCategoryCode, serviceWarnings);
  const aspects = normalizeAspects(parsed.aspects, serviceWarnings);
  const priceSuggestion = normalizePriceSuggestion(parsed.priceSuggestion, serviceWarnings);
  const confidence = normalizeConfidence(parsed.confidence, serviceWarnings);

  const normalizedDraft = normalizeGeneratedDraft({
    title,
    aspects,
    warnings: [...modelWarnings, ...serviceWarnings],
  });

  return generatedListingDraftSchema.parse({
    title: normalizedDraft.title,
    description,
    categorySuggestion,
    cardConditionNote,
    cardConditionToken,
    conditionSuggestion,
    skuCategoryCode,
    aspects: normalizedDraft.aspects,
    priceSuggestion,
    confidence,
    warnings: normalizedDraft.warnings,
    rawModelResponse,
  });
}
