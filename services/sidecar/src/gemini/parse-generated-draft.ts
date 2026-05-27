import {
  GeminiDraftServiceError,
  type GeneratedListingDraft,
  generatedListingDraftSchema,
} from './contracts.js';

type DraftRecord = Record<string, unknown>;
type ConfidenceKey = 'title' | 'category' | 'price' | 'aspects';

const CODE_FENCE_PATTERN = /^```(?:json)?\s*([\s\S]*?)\s*```$/i;
const CONFIDENCE_KEYS: ConfidenceKey[] = ['title', 'category', 'price', 'aspects'];

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

function normalizeCanonicalId(
  snakeCaseValue: unknown,
  camelCaseValue: unknown
): string | null {
  const snakeCase = normalizeNullableString(snakeCaseValue);

  if (snakeCase !== null) {
    return snakeCase;
  }

  return normalizeNullableString(camelCaseValue);
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

function normalizePriceSuggestion(value: unknown, warnings: string[]): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (value !== undefined && value !== null) {
    warnings.push('Gemini response field "priceSuggestion" was invalid and was reset to null.');
  }

  return null;
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

  return generatedListingDraftSchema.parse({
    title: normalizeRequiredString(parsed.title, 'title', serviceWarnings),
    description: normalizeRequiredString(parsed.description, 'description', serviceWarnings),
    category_id: normalizeCanonicalId(parsed.category_id, parsed.categoryId),
    condition_id: normalizeCanonicalId(parsed.condition_id, parsed.conditionId),
    categorySuggestion: normalizeNullableString(parsed.categorySuggestion),
    conditionSuggestion: normalizeNullableString(parsed.conditionSuggestion),
    aspects: normalizeAspects(parsed.aspects, serviceWarnings),
    priceSuggestion: normalizePriceSuggestion(parsed.priceSuggestion, serviceWarnings),
    confidence: normalizeConfidence(parsed.confidence, serviceWarnings),
    warnings: [...modelWarnings, ...serviceWarnings],
    rawModelResponse,
  });
}
