import type { Json } from '@ebay-inventory/data';
import { getGeminiDraftClient, type GeminiDraftClient } from './client.js';
import { loadGeminiDraftConfig } from './config.js';
import {
  GeminiDraftServiceError,
  GeminiDraftValidationError,
} from './contracts.js';
import {
  type GeneratedVariationListingIdentityDraft,
  type GenerateVariationListingIdentityInput,
  type VariationListingEvidenceFact,
  type VariationListingIdentityFacts,
  type VariationListingIdentityModelResponse,
  type VariationListingNormalizedIdentity,
  type VariationListingSerialEvidence,
  type VariationListingYearEvidence,
  validateGenerateVariationListingIdentityInput,
  variationListingIdentityModelResponseSchema,
} from './variation-listing-identity-contracts.js';
import { buildVariationListingIdentityPrompt } from './variation-listing-identity-prompt.js';
import {
  containsStandaloneYear,
  isSupportedCardYear,
  normalizeSportsSeasonRange,
} from './year-normalization.js';

const CODE_FENCE_PATTERN = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu;
const SERIAL_FRACTION_PATTERN = /(?<![\p{L}\p{N}#])(\d{1,6})\s*\/\s*(\d{1,6})(?![\p{L}\p{N}])/gu;
const WHITESPACE_PATTERN = /\s+/gu;
const CARD_NUMBER_TOKEN_PATTERN = /^[\p{L}\p{N}]+(?:[-/.][\p{L}\p{N}]+)*$/u;
const CARD_NUMBER_RANGE_PATTERN = /^\d+-\d+$/u;
const CARD_NUMBER_PREFIX_PATTERN = /^(?:(?:card\s+number)|(?:card\s+(?:#|no\.?))|(?:no\.?))\s*#?\s*(\S+)$/iu;
const CARD_NUMBER_HASH_PREFIX_PATTERN = /^#\s*(\S+)$/u;
const SEASON_RANGE_TEXT_PATTERN = /\b(?:19|20)\d{2}\s*[-/]\s*(?:\d{2}|\d{4})\b/gu;
const YEAR_EVIDENCE_MARKER_PATTERNS: Record<VariationListingYearEvidence['sourceType'], RegExp> = {
  copyright_line: /(?:©|\bcopyright\b)/iu,
  manufacture_line: /(?:\bmanufactur(?:e|ed|ing)\b|\bmade\b)/iu,
  production_line: /(?:\bproduced\b|\bproduction\b|\bprinted\b)/iu,
  explicit_release_year: /(?:\brelease(?:d)?\b|\byear\b)/iu,
};

export interface GenerateVariationListingIdentityOptions {
  model: string;
}

export interface VariationListingIdentityGeneratorDependencies {
  getClient?: (apiKey: string) => GeminiDraftClient;
  loadConfig?: typeof loadGeminiDraftConfig;
}

export interface PreparedGenerateVariationListingIdentity {
  input: GenerateVariationListingIdentityInput;
  execute(options: GenerateVariationListingIdentityOptions): Promise<GeneratedVariationListingIdentityDraft>;
}

function normalizeText(value: string): string {
  return value.normalize('NFC').replace(WHITESPACE_PATTERN, ' ').trim();
}

function normalizeFactValue(value: string): string {
  return normalizeText(value);
}

function normalizeCardNumber(value: string): string {
  const normalized = normalizeFactValue(value);
  const prefixedMatch = CARD_NUMBER_PREFIX_PATTERN.exec(normalized) ?? CARD_NUMBER_HASH_PREFIX_PATTERN.exec(normalized);
  const token = prefixedMatch?.[1] ?? normalized;
  if (!token || !CARD_NUMBER_TOKEN_PATTERN.test(token) || CARD_NUMBER_RANGE_PATTERN.test(token)) {
    throw new GeminiDraftServiceError('Variation identity cardNumber is malformed.');
  }
  return token;
}

function containsYearOutsideSeasonRange(text: string, year: string): boolean {
  return containsStandaloneYear(text.replace(SEASON_RANGE_TEXT_PATTERN, ' '), year);
}

function normalizeEvidenceFact(
  fact: VariationListingEvidenceFact | null | undefined,
  options: { cardNumber?: boolean } = {}
): VariationListingEvidenceFact | null {
  if (!fact) return null;
  const value = options.cardNumber ? normalizeCardNumber(fact.value) : normalizeFactValue(fact.value);
  const visibleEvidence = normalizeText(fact.visibleEvidence);
  if (!value || !visibleEvidence) return null;
  return { value, imageIndex: fact.imageIndex, visibleEvidence };
}

function dedupeStrings(values: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const value = normalizeText(raw);
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function validateYearEvidence(
  evidence: VariationListingYearEvidence | null | undefined,
  explicitYear: string | undefined,
  warnings: string[]
): VariationListingYearEvidence | null {
  if (explicitYear) {
    if (evidence) {
      warnings.push('Gemini visible yearEvidence was ignored because explicitYear is canonical.');
    }
    return null;
  }
  if (!evidence) return null;
  if (!isSupportedCardYear(evidence.year) || !containsYearOutsideSeasonRange(evidence.visibleText, evidence.year)) {
    throw new GeminiDraftServiceError('Variation identity yearEvidence is inconsistent with visibleText.');
  }
  if (!YEAR_EVIDENCE_MARKER_PATTERNS[evidence.sourceType].test(evidence.visibleText)) {
    throw new GeminiDraftServiceError('Variation identity yearEvidence is inconsistent with its sourceType.');
  }
  return {
    ...evidence,
    visibleText: normalizeText(evidence.visibleText),
  };
}

function validateSeasonEvidence(
  evidence: VariationListingIdentityModelResponse['seasonEvidence']
): NonNullable<VariationListingIdentityModelResponse['seasonEvidence']> | null {
  if (!evidence) return null;
  const season = normalizeSportsSeasonRange(evidence.season);
  if (!season) {
    throw new GeminiDraftServiceError('Variation identity seasonEvidence is not an adjacent sports season.');
  }
  const claims = [...evidence.visibleText.matchAll(/\b(?:19|20)\d{2}\s*[-/]\s*(?:\d{2}|\d{4})\b/gu)];
  if (claims.length !== 1 || normalizeSportsSeasonRange(claims[0]![0]) !== season) {
    throw new GeminiDraftServiceError('Variation identity seasonEvidence is inconsistent with visibleText.');
  }
  return { ...evidence, season, visibleText: normalizeText(evidence.visibleText) };
}

function validateSerialEvidence(
  evidence: VariationListingSerialEvidence | null | undefined
): VariationListingSerialEvidence | null {
  if (!evidence) return null;
  if (evidence.numerator > evidence.denominator) {
    throw new GeminiDraftServiceError('Variation identity serialEvidence numerator exceeds denominator.');
  }
  const visibleText = normalizeText(evidence.visibleText).replace(/\s*\/\s*/gu, '/');
  const matches = [...visibleText.matchAll(SERIAL_FRACTION_PATTERN)];
  if (matches.length !== 1) {
    throw new GeminiDraftServiceError('Variation identity serialEvidence must contain exactly one visible fraction.');
  }
  const numerator = Number.parseInt(matches[0]![1]!, 10);
  const denominator = Number.parseInt(matches[0]![2]!, 10);
  if (numerator !== evidence.numerator || denominator !== evidence.denominator) {
    throw new GeminiDraftServiceError('Variation identity serialEvidence does not match its visible fraction.');
  }
  if (/\bcard(?:\s+(?:number|no\.?))?\s*#?\s*\d+\s+of\s+\d+/iu.test(visibleText)) {
    throw new GeminiDraftServiceError('Variation identity serialEvidence is ambiguous with a card-number range.');
  }
  return { ...evidence, visibleText };
}

function normalizeFacts(facts: VariationListingIdentityFacts): {
  facts: VariationListingIdentityFacts;
  identity: VariationListingNormalizedIdentity;
} {
  const normalizedFacts: VariationListingIdentityFacts = {
    sport: normalizeEvidenceFact(facts.sport),
    league: normalizeEvidenceFact(facts.league),
    playerAthlete: normalizeEvidenceFact(facts.playerAthlete),
    team: normalizeEvidenceFact(facts.team),
    manufacturer: normalizeEvidenceFact(facts.manufacturer),
    set: normalizeEvidenceFact(facts.set),
    cardNumber: normalizeEvidenceFact(facts.cardNumber, { cardNumber: true }),
    parallelVariety: normalizeEvidenceFact(facts.parallelVariety),
    insertSet: normalizeEvidenceFact(facts.insertSet),
    cardName: normalizeEvidenceFact(facts.cardName),
    language: normalizeEvidenceFact(facts.language),
    features: (facts.features ?? []).map((feature) => ({
      ...feature,
      visibleEvidence: normalizeText(feature.visibleEvidence),
    })),
  };
  const identity: VariationListingNormalizedIdentity = {
    features: dedupeStrings((facts.features ?? []).map((feature) => feature.value)),
  };
  const mappings: Array<[
    keyof Omit<VariationListingIdentityFacts, 'features'>,
    keyof Omit<VariationListingNormalizedIdentity, 'features' | 'year' | 'season' | 'serialNumber' | 'printRun'>,
  ]> = [
    ['sport', 'sport'],
    ['league', 'league'],
    ['playerAthlete', 'playerAthlete'],
    ['team', 'team'],
    ['manufacturer', 'manufacturer'],
    ['set', 'set'],
    ['cardNumber', 'cardNumber'],
    ['parallelVariety', 'parallelVariety'],
    ['insertSet', 'insertSet'],
    ['cardName', 'cardName'],
    ['language', 'language'],
  ];
  for (const [factKey, identityKey] of mappings) {
    const fact = normalizedFacts[factKey] as VariationListingEvidenceFact | null | undefined;
    if (fact?.value) identity[identityKey] = fact.value;
  }
  return { facts: normalizedFacts, identity };
}

function buildSelectorValue(identity: VariationListingNormalizedIdentity): string {
  const temporal = identity.season ?? identity.year;
  const setIdentity = identity.set ?? identity.manufacturer;
  const characteristics = [identity.insertSet, identity.parallelVariety].filter(
    (value): value is string => Boolean(value)
  );
  const serialNumber = identity.serialNumber;
  const selectorFeatures = identity.features.filter((feature) =>
    ['Rookie Card', 'Refractor'].includes(feature)
  );
  const parts = dedupeStrings([
    ...(temporal ? [temporal] : []),
    ...(setIdentity ? [setIdentity] : []),
    ...characteristics,
    ...selectorFeatures,
    ...(identity.playerAthlete ? [identity.playerAthlete] : []),
    ...(identity.cardName ? [identity.cardName] : []),
    ...(identity.cardNumber ? [`#${identity.cardNumber}`] : []),
    ...(serialNumber ? [serialNumber] : []),
    ...(identity.team ? [identity.team] : []),
  ]);
  if (parts.length < 2) {
    throw new GeminiDraftServiceError(
      'Variation identity does not contain enough proven components to construct a safe selector.'
    );
  }
  if (
    !identity.playerAthlete &&
    !identity.cardName &&
    !identity.cardNumber &&
    !identity.serialNumber &&
    !identity.insertSet &&
    !identity.parallelVariety &&
    selectorFeatures.length === 0
  ) {
    throw new GeminiDraftServiceError(
      'Variation identity does not contain a card-distinguishing component for a safe selector.'
    );
  }
  return parts.join(' ').trim();
}

function buildVariationMetadata(
  identity: VariationListingNormalizedIdentity,
  evidence: Record<string, unknown>,
  reviewNotes: string[],
  warnings: string[]
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  const assign = (key: string, value: string | number | string[] | undefined): void => {
    if (value === undefined || (Array.isArray(value) && value.length === 0)) return;
    metadata[key] = value;
  };
  assign('Sport', identity.sport);
  assign('League', identity.league);
  assign('Player/Athlete', identity.playerAthlete);
  assign('Team', identity.team);
  assign('Manufacturer', identity.manufacturer);
  assign('Set', identity.set);
  assign('Card Number', identity.cardNumber);
  assign('Parallel/Variety', identity.parallelVariety);
  assign('Insert Set', identity.insertSet);
  assign('Card Name', identity.cardName);
  assign('Language', identity.language);
  assign('Features', identity.features);
  assign('Year Manufactured', identity.year);
  assign('Season', identity.season);
  assign('Print Run', identity.printRun);
  if (identity.serialNumber) metadata['Serial Number'] = identity.serialNumber;
  metadata._identityEvidence = evidence;
  metadata._review = { notes: reviewNotes, warnings };
  return metadata;
}

function evidenceRecord(
  facts: VariationListingIdentityFacts,
  yearEvidence: VariationListingYearEvidence | null,
  seasonEvidence: VariationListingIdentityModelResponse['seasonEvidence'],
  serialEvidence: VariationListingSerialEvidence | null
): Record<string, unknown> {
  const evidence: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(facts)) {
    if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) continue;
    evidence[key] = value;
  }
  if (yearEvidence) evidence.yearEvidence = yearEvidence;
  if (seasonEvidence) evidence.seasonEvidence = seasonEvidence;
  if (serialEvidence) evidence.serialEvidence = serialEvidence;
  return evidence;
}

function extractJsonPayload(rawText: string): string {
  const trimmed = rawText.trim();
  const fenced = CODE_FENCE_PATTERN.exec(trimmed);
  return fenced?.[1]?.trim() ?? trimmed;
}

export function parseVariationListingIdentityResponse(
  rawText: string,
  rawModelResponse: unknown,
  input: GenerateVariationListingIdentityInput
): GeneratedVariationListingIdentityDraft {
  const validatedInput = validateGenerateVariationListingIdentityInput(input);
  const payload = extractJsonPayload(rawText);
  if (!payload) throw new GeminiDraftServiceError('Gemini returned an empty variation identity response.');
  let json: unknown;
  try {
    json = JSON.parse(payload);
  } catch (error) {
    throw new GeminiDraftServiceError('Gemini returned invalid JSON for variation identity.', {
      cause: error,
    });
  }
  const parsedResult = variationListingIdentityModelResponseSchema.safeParse(json);
  if (!parsedResult.success) throw new GeminiDraftValidationError(parsedResult.error.issues);
  const parsed = parsedResult.data;
  const warnings = dedupeStrings(parsed.warnings);
  const reviewNotes = dedupeStrings(parsed.reviewNotes);
  const { facts, identity } = normalizeFacts(parsed.facts);
  const explicitYear = validatedInput.userHints?.explicitYear;
  const yearEvidence = validateYearEvidence(parsed.yearEvidence, explicitYear, warnings);
  const seasonEvidence = validateSeasonEvidence(parsed.seasonEvidence);
  const serialEvidence = validateSerialEvidence(parsed.serialEvidence);
  if (explicitYear) identity.year = explicitYear;
  else if (yearEvidence) identity.year = yearEvidence.year;
  if (seasonEvidence) identity.season = seasonEvidence.season;
  if (serialEvidence) {
    const serialMatch = [...serialEvidence.visibleText.matchAll(SERIAL_FRACTION_PATTERN)][0];
    identity.serialNumber = `${serialMatch?.[1] ?? serialEvidence.numerator}/${serialMatch?.[2] ?? serialEvidence.denominator}`;
    identity.printRun = serialEvidence.denominator;
    if (!identity.features.some((feature) => feature === 'Serial Numbered')) {
      identity.features.push('Serial Numbered');
    }
  }
  const evidence = evidenceRecord(facts, yearEvidence, seasonEvidence, serialEvidence);
  const selectorValue = buildSelectorValue(identity);
  const variationMetadata = buildVariationMetadata(identity, evidence, reviewNotes, warnings);
  return {
    variationId: validatedInput.variationId,
    selectorValue,
    identity,
    variationMetadata,
    evidence,
    reviewNotes,
    warnings,
    sourceImages: {
      front: {
        imageUrl: validatedInput.imageUrls[0],
        sourceRef: validatedInput.sourceRefs.front,
        imageIndex: 0,
      },
      back: {
        imageUrl: validatedInput.imageUrls[1],
        sourceRef: validatedInput.sourceRefs.back,
        imageIndex: 1,
      },
    },
    rawModelResponse,
  };
}

export function prepareGenerateVariationListingIdentity(
  input: GenerateVariationListingIdentityInput,
  dependencies: VariationListingIdentityGeneratorDependencies = {}
): Promise<PreparedGenerateVariationListingIdentity> {
  return Promise.resolve().then(async () => {
    const validatedInput = validateGenerateVariationListingIdentityInput(input);
    const config = (dependencies.loadConfig ?? loadGeminiDraftConfig)();
    if (!config.apiKey) {
      throw new GeminiDraftServiceError('GEMINI_API_KEY is required to generate variation identity drafts.');
    }
    const client = (dependencies.getClient ?? getGeminiDraftClient)(config.apiKey);
    const imageParts = await client.prepareImageParts(validatedInput.imageUrls);
    const prompt = buildVariationListingIdentityPrompt(validatedInput);
    return {
      input: validatedInput,
      execute: async (options) => {
        let raw;
        try {
          raw = await client.generateDraftRaw({ model: options.model, imageParts: imageParts.imageParts, prompt });
        } catch (error) {
          throw new GeminiDraftServiceError(
            `Gemini variation identity generation failed for variation "${validatedInput.variationId}".`,
            { cause: error instanceof Error ? error : undefined }
          );
        }
        return parseVariationListingIdentityResponse(raw.text, raw.rawResponse, validatedInput);
      },
    };
  });
}

export async function generateVariationListingIdentity(
  input: GenerateVariationListingIdentityInput,
  options: GenerateVariationListingIdentityOptions,
  dependencies: VariationListingIdentityGeneratorDependencies = {}
): Promise<GeneratedVariationListingIdentityDraft> {
  const prepared = await prepareGenerateVariationListingIdentity(input, dependencies);
  return await prepared.execute(options);
}

export function toVariationListingNewVariationIdentityHandoff(
  draft: GeneratedVariationListingIdentityDraft
): { selectorValue: string; variationMetadata: Json } {
  return {
    selectorValue: draft.selectorValue,
    variationMetadata: draft.variationMetadata as Json,
  };
}
