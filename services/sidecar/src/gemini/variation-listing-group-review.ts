import type { VariationListingAggregateSnapshot } from '@ebay-inventory/data';
import { getGeminiDraftClient, type GeminiDraftClient } from './client.js';
import { loadGeminiDraftConfig } from './config.js';
import { GeminiDraftServiceError, GeminiDraftValidationError } from './contracts.js';
import {
  type GeneratedVariationListingGroupReviewDraft,
  type GenerateVariationListingGroupReviewInput,
  type VariationListingConditionCompatibilityIssue,
  type VariationListingGroupContentModelResponse,
  type VariationListingGroupReadiness,
  validateGenerateVariationListingGroupReviewInput,
  variationListingGroupContentModelResponseSchema,
} from './variation-listing-group-review-contracts.js';
import { buildVariationListingGroupReviewPrompt } from './variation-listing-group-review-prompt.js';

const CODE_FENCE_PATTERN = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu;
const CONDITION_RANK: Record<string, number> = {
  POOR: 0,
  VERY_GOOD: 1,
  EXCELLENT: 2,
  NEAR_MINT_OR_BETTER: 3,
};

const SINGLE_COMMON_ASPECT_KEYS = [
  'Manufacturer',
  'Set',
  'Card Number',
  'Parallel/Variety',
  'Insert Set',
  'Card Name',
  'Language',
  'Year Manufactured',
  'Season',
  'Print Run',
] as const;
const MULTI_COMMON_ASPECT_KEYS = [
  'Sport',
  'League',
  'Player/Athlete',
  'Team',
  'Features',
] as const;
const REQUIRED_COMMON_ASPECT_KEYS_BY_CATEGORY: Record<string, readonly string[]> = {
  '261328': ['Sport'],
};

export interface GenerateVariationListingGroupReviewOptions {
  model: string;
}

export interface VariationListingGroupReviewGeneratorDependencies {
  getClient?: (apiKey: string) => GeminiDraftClient;
  loadConfig?: typeof loadGeminiDraftConfig;
}

function normalizeText(value: string): string {
  return value.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

function normalizedKey(value: string): string {
  return normalizeText(value).toLowerCase();
}

function asAspectValues(value: unknown): string[] {
  if (typeof value === 'string') {
    const normalized = normalizeText(value);
    return normalized ? [normalized] : [];
  }
  if (typeof value === 'number' && Number.isFinite(value)) return [String(value)];
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const normalized = normalizeText(entry);
    const key = normalizedKey(normalized);
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function deriveSingleCommonValue(
  metadata: readonly Record<string, unknown>[],
  key: string
): string | null {
  const values = metadata.map((entry) => asAspectValues(entry[key]));
  if (values.some((entry) => entry.length !== 1)) return null;
  const first = values[0]?.[0];
  if (!first) return null;
  const expected = normalizedKey(first);
  return values.every((entry) => normalizedKey(entry[0]!) === expected) ? first : null;
}

function deriveMultiCommonValues(
  metadata: readonly Record<string, unknown>[],
  key: string
): string[] {
  const values = metadata.map((entry) => asAspectValues(entry[key]));
  if (values.length === 0 || values.some((entry) => entry.length === 0)) return [];
  const remaining = new Set(values[0]!.map(normalizedKey));
  for (const current of values.slice(1)) {
    const currentKeys = new Set(current.map(normalizedKey));
    for (const candidate of [...remaining]) {
      if (!currentKeys.has(candidate)) remaining.delete(candidate);
    }
  }
  return values[0]!.filter((value) => remaining.has(normalizedKey(value)));
}

export function deriveVariationListingCommonEbayAspects(
  input: GenerateVariationListingGroupReviewInput
): Record<string, string | string[]> {
  const validated = validateGenerateVariationListingGroupReviewInput(input);
  const metadata = validated.variations.map((variation) => variation.variationMetadata);
  const result: Record<string, string | string[]> = {};

  for (const key of SINGLE_COMMON_ASPECT_KEYS) {
    const value = deriveSingleCommonValue(metadata, key);
    if (value) result[key] = value;
  }
  for (const key of MULTI_COMMON_ASPECT_KEYS) {
    const values = deriveMultiCommonValues(metadata, key);
    if (values.length > 0) result[key] = values;
  }
  return result;
}

export function evaluateVariationListingGroupReadiness(
  input: GenerateVariationListingGroupReviewInput
): VariationListingGroupReadiness {
  const validated = validateGenerateVariationListingGroupReviewInput(input);
  const derivedCommonEbayAspects = deriveVariationListingCommonEbayAspects(validated);
  const blockers: string[] = [];
  if (validated.variations.length < 2) {
    blockers.push('Variation listing publish readiness requires at least two variations.');
  }
  const required = REQUIRED_COMMON_ASPECT_KEYS_BY_CATEGORY[validated.categoryId];
  if (!required) {
    blockers.push(`Variation listing group readiness has no reviewed common-aspect contract for category ${validated.categoryId}.`);
  } else {
    for (const key of required) {
      const value = derivedCommonEbayAspects[key];
      if (value === undefined || (Array.isArray(value) && value.length === 0)) {
        blockers.push(`Required common eBay aspect ${key} has no truthful value across every variation.`);
      }
    }
  }

  const groupRank = CONDITION_RANK[validated.conditionToken]!;
  const incompatibleCopies: VariationListingConditionCompatibilityIssue[] = [];
  for (const copy of validated.copies) {
    if (copy.availabilityState !== 'available') continue;
    const copyRank = CONDITION_RANK[copy.conditionToken]!;
    if (copyRank < groupRank) {
      incompatibleCopies.push({
        copyId: copy.copyId,
        variationId: copy.variationId,
        copyConditionToken: copy.conditionToken,
        groupConditionToken: validated.conditionToken,
      });
    }
  }
  if (incompatibleCopies.length > 0) {
    blockers.push(
      `${incompatibleCopies.length} available physical copy/copies are below the group's shared condition tier.`
    );
  }
  return {
    ready: blockers.length === 0,
    blockers,
    conditionCompatible: incompatibleCopies.length === 0,
    incompatibleCopies,
  };
}

export function parseVariationListingGroupContentResponse(
  rawText: string,
  rawModelResponse: unknown
): VariationListingGroupContentModelResponse & { rawModelResponse?: unknown } {
  const trimmed = rawText.trim();
  const payload = CODE_FENCE_PATTERN.exec(trimmed)?.[1]?.trim() ?? trimmed;
  if (!payload) throw new GeminiDraftServiceError('Gemini returned an empty variation group content response.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch (error) {
    throw new GeminiDraftServiceError('Gemini returned invalid JSON for variation group content.', {
      cause: error,
    });
  }
  const result = variationListingGroupContentModelResponseSchema.safeParse(parsed);
  if (!result.success) throw new GeminiDraftValidationError(result.error.issues);
  return {
    ...result.data,
    title: normalizeText(result.data.title),
    description: normalizeText(result.data.description),
    warnings: result.data.warnings.map(normalizeText),
    rawModelResponse,
  };
}

export function buildVariationListingGroupReviewInputFromAggregate(
  aggregate: VariationListingAggregateSnapshot,
  userHints?: GenerateVariationListingGroupReviewInput['userHints']
): GenerateVariationListingGroupReviewInput {
  return validateGenerateVariationListingGroupReviewInput({
    groupId: aggregate.group.group_id,
    categoryId: aggregate.group.category_id,
    conditionToken: aggregate.group.condition_token as GenerateVariationListingGroupReviewInput['conditionToken'],
    variations: aggregate.variations.map((variation) => ({
      variationId: variation.variation_id,
      selectorValue: variation.selector_value,
      variationMetadata: variation.variation_metadata as Record<string, unknown>,
    })),
    copies: aggregate.copies.map((copy) => ({
      copyId: copy.copy_id,
      variationId: copy.variation_id,
      availabilityState:
        copy.availability_state as GenerateVariationListingGroupReviewInput['copies'][number]['availabilityState'],
      conditionToken: copy.condition_token as GenerateVariationListingGroupReviewInput['conditionToken'],
    })),
    userHints,
  });
}

export async function generateVariationListingGroupReview(
  input: GenerateVariationListingGroupReviewInput,
  options: GenerateVariationListingGroupReviewOptions,
  dependencies: VariationListingGroupReviewGeneratorDependencies = {}
): Promise<GeneratedVariationListingGroupReviewDraft> {
  const validated = validateGenerateVariationListingGroupReviewInput(input);
  const derivedCommonEbayAspects = deriveVariationListingCommonEbayAspects(validated);
  const readiness = evaluateVariationListingGroupReadiness(validated);
  const config = (dependencies.loadConfig ?? loadGeminiDraftConfig)();
  if (!config.apiKey) {
    throw new GeminiDraftServiceError('GEMINI_API_KEY is required to generate variation group review drafts.');
  }
  const client = (dependencies.getClient ?? getGeminiDraftClient)(config.apiKey);
  const prompt = buildVariationListingGroupReviewPrompt(validated, derivedCommonEbayAspects);
  let raw;
  try {
    raw = await client.generateDraftRaw({ model: options.model, imageParts: [], prompt });
  } catch (error) {
    throw new GeminiDraftServiceError(
      `Gemini variation group content generation failed for group "${validated.groupId}".`,
      { cause: error instanceof Error ? error : undefined }
    );
  }
  const content = parseVariationListingGroupContentResponse(raw.text, raw.rawResponse);
  return {
    groupId: validated.groupId,
    title: content.title,
    description: content.description,
    derivedCommonEbayAspects,
    readiness,
    warnings: [...content.warnings],
    rawModelResponse: content.rawModelResponse,
  };
}
