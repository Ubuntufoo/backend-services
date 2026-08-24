import {
  GENERATED_LISTING_ASPECT_KEYS,
  GeminiDraftServiceError,
  type GeneratedListingDraft,
  generatedListingDraftSchema,
} from './contracts.js';
import { normalizeSkuCategoryCode } from '@ebay-inventory/types';
import { isRawCardConditionToken } from '@/listings/trading-card-conditions.js';
import {
  GENERATED_YEAR_EVIDENCE_SOURCE_TYPES,
  normalizeGeneratedDraftYearFields,
  type NormalizeGeneratedDraftYearFieldsOptions,
} from './year-normalization.js';

type DraftRecord = Record<string, unknown>;
type ConfidenceKey = 'title' | 'category' | 'price' | 'aspects';
type AspectRecord = Record<string, string | string[]>;
type AspectValue = string | string[] | null | undefined;
type YearEvidenceSourceType = (typeof GENERATED_YEAR_EVIDENCE_SOURCE_TYPES)[number];
type SerialEvidence = NonNullable<GeneratedListingDraft['serialEvidence']>;

const CODE_FENCE_PATTERN = /^```(?:json)?\s*([\s\S]*?)\s*```$/i;
const CONFIDENCE_KEYS: ConfidenceKey[] = ['title', 'category', 'price', 'aspects'];
const GENERATED_LISTING_ASPECT_KEY_SET = new Set<string>(GENERATED_LISTING_ASPECT_KEYS);
const TRANSIENT_GENERATED_LISTING_ASPECT_KEYS = new Set([
  'Athlete',
  'Card Manufacturer',
  'Player/Athlete',
  'Season',
  'Year',
]);
const MAX_GENERATED_TITLE_LENGTH = 80;
const TITLE_CARD_NUMBER_PATTERNS = [
  /(?:^|[\s([{])#\s*([A-Za-z0-9-]+)\b/i,
  /\bNo\.?\s*#?\s*([A-Za-z0-9-]+)\b/i,
  /\bCard\s*#\s*([A-Za-z0-9-]+)\b/i,
  /\bCard\s+No\.?\s*([A-Za-z0-9-]+)\b/i,
  /\bCard\s+Number\s+([A-Za-z0-9-]+)\b/i,
  /\bCard\s+(?!No\b|No\.\b|Number\b)([A-Za-z]{0,4}\d{1,4}[A-Za-z]{0,4})\b/i,
];
const TITLE_CHARACTERISTIC_ASPECT_KEYS = ['Set', 'Parallel/Variety', 'Insert Set'] as const;
const TITLE_CARD_NUMBER_RANGE_PATTERN =
  /(?:^|[\s([{])(?:#\s*[A-Za-z0-9-]+|Card\s+(?:(?:No\.?|Number)\s*)?[A-Za-z0-9-]+)\s+of\s+\d{1,4}\b/giu;
const POSITIVE_FEATURE_PATTERN =
  /\b(?:rookie(?:\s+card)?|refractor|insert|parallel(?:\/variety)?|serial(?:[-\s]+numbered)?)\b/iu;
const PROHIBITED_TITLE_CONDITION_PATTERNS = [
  /\b(?:low\s+grade|near\s+mint(?:\s+or\s+better)?|very\s+good|good|fair)\b/giu,
  /(?<![\p{L}\p{N}])(?:NM(?:\+|-MT)?|EX-MT|VG-EX|EX|VG|MT|FR|PR)(?![\p{L}\p{N}])/giu,
  /\b(?:excellent|mint|poor)\b/giu,
  /\b(?:PSA|BGS|SGC|CGC|GMA)\s*(?:grade\s*)?\d+(?:\.\d+)?\b/giu,
  /\b(?:graded?|grade)\s+\d+(?:\.\d+)?\b/giu,
] as const;

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

function normalizeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

function isValidImageIndex(imageIndex: number, imageCount?: number): boolean {
  return imageIndex >= 0 && (imageCount === undefined || imageIndex < imageCount);
}

function trimToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function normalizeYearEvidenceSourceType(value: unknown): YearEvidenceSourceType | undefined {
  return typeof value === 'string' &&
    GENERATED_YEAR_EVIDENCE_SOURCE_TYPES.includes(value as YearEvidenceSourceType)
    ? (value as YearEvidenceSourceType)
    : undefined;
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

  warnings.push('Gemini response field "cardConditionToken" was invalid and was reset to null.');
  return null;
}

function assertGeneratedTitleLength(title: string): string {
  if (title.length > MAX_GENERATED_TITLE_LENGTH) {
    throw new GeminiDraftServiceError(
      'Generated listing title exceeds 80 characters after backend normalization.'
    );
  }

  return title;
}

function normalizeTitleWhitespace(value: string): string {
  return value
    .replace(/\s+([,.:;)\]])/gu, '$1')
    .replace(/([([{])\s+/gu, '$1')
    .replace(/\s{2,}/gu, ' ')
    .trim();
}

function isWordCharacter(value: string | undefined): boolean {
  return value !== undefined && /[\p{L}\p{N}]/u.test(value);
}

function getPhraseSpans(
  title: string,
  phrase: string,
  avoidConditionCovered = false
): Array<[number, number]> {
  const normalizedPhrase = phrase.trim();
  if (normalizedPhrase.length === 0) {
    return [];
  }

  const lowerTitle = title.toLocaleLowerCase();
  const lowerPhrase = normalizedPhrase.toLocaleLowerCase();
  const conditionSpans = avoidConditionCovered ? getConditionLanguageSpans(title) : [];
  let firstMatch: [number, number] | null = null;
  let start = lowerTitle.indexOf(lowerPhrase);

  while (start >= 0) {
    const end = start + normalizedPhrase.length;
    if (!isWordCharacter(title[start - 1]) && !isWordCharacter(title[end])) {
      firstMatch ??= [start, end];
      const fullyCoveredByCondition = conditionSpans.some(([conditionStart, conditionEnd]) => {
        return (
          conditionStart <= start &&
          conditionEnd >= end &&
          conditionEnd - conditionStart > end - start
        );
      });
      if (!fullyCoveredByCondition) {
        return [[start, end]];
      }
    }
    start = lowerTitle.indexOf(lowerPhrase, start + 1);
  }

  return firstMatch && !avoidConditionCovered ? [firstMatch] : [];
}

function getConditionLanguageSpans(title: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const pattern of PROHIBITED_TITLE_CONDITION_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of title.matchAll(pattern)) {
      const start = match.index ?? -1;
      if (start >= 0) {
        spans.push([start, start + match[0].length]);
      }
    }
  }
  return spans;
}

function getProtectedTitleSpans(title: string, aspects: AspectRecord): Array<[number, number]> {
  const spans: Array<[number, number]> = [];

  for (const pattern of TITLE_CARD_NUMBER_PATTERNS) {
    const globalPattern = new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`);
    for (const match of title.matchAll(globalPattern)) {
      const start = match.index ?? -1;
      if (start >= 0) {
        spans.push([start, start + match[0].length]);
      }
    }
  }

  for (const match of title.matchAll(TITLE_CARD_NUMBER_RANGE_PATTERN)) {
    const start = match.index ?? -1;
    if (start >= 0) {
      spans.push([start, start + match[0].length]);
    }
  }

  for (const key of TITLE_CHARACTERISTIC_ASPECT_KEYS) {
    for (const value of getAspectStringValues(aspects[key])) {
      const safeValue = getSafeCanonicalComponent(value, title);
      if (safeValue) {
        spans.push(...getPhraseSpans(title, safeValue, true));
      }
    }
  }

  const serialNumberPattern = /\b\d{1,4}\s*\/\s*\d{1,4}\b/gu;
  for (const match of title.matchAll(serialNumberPattern)) {
    const start = match.index ?? -1;
    if (start >= 0) {
      spans.push([start, start + match[0].length]);
    }
  }

  for (const value of getAspectStringValues(aspects.Features)) {
    if (POSITIVE_FEATURE_PATTERN.test(value) && !containsProhibitedConditionLanguage(value)) {
      spans.push(...getPhraseSpans(title, value));
    }
  }

  return spans;
}

function containsProhibitedConditionLanguage(value: string): boolean {
  return PROHIBITED_TITLE_CONDITION_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(value);
  });
}

function getUnprotectedMatchSpans(
  start: number,
  end: number,
  protectedSpans: Array<[number, number]>
): Array<[number, number]> {
  let segments: Array<[number, number]> = [[start, end]];

  for (const [protectedStart, protectedEnd] of protectedSpans) {
    const nextSegments: Array<[number, number]> = [];
    for (const [segmentStart, segmentEnd] of segments) {
      if (segmentEnd <= protectedStart || segmentStart >= protectedEnd) {
        nextSegments.push([segmentStart, segmentEnd]);
        continue;
      }

      if (segmentStart < protectedStart) {
        nextSegments.push([segmentStart, protectedStart]);
      }
      if (segmentEnd > protectedEnd) {
        nextSegments.push([protectedEnd, segmentEnd]);
      }
    }
    segments = nextSegments;
  }

  return segments.filter(([segmentStart, segmentEnd]) => segmentStart < segmentEnd);
}

function sanitizeGeneratedTitleConditionLanguage(title: string, aspects: AspectRecord): string {
  const protectedSpans = getProtectedTitleSpans(title, aspects);
  const matches: Array<[number, number]> = [];

  for (const pattern of PROHIBITED_TITLE_CONDITION_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of title.matchAll(pattern)) {
      const start = match.index ?? -1;
      if (start < 0) {
        continue;
      }

      const end = start + match[0].length;
      matches.push(...getUnprotectedMatchSpans(start, end, protectedSpans));
    }
  }

  const selectedMatches: Array<[number, number]> = [];
  for (const match of matches.sort((left, right) => {
    return left[0] - right[0] || right[1] - right[0] - (left[1] - left[0]);
  })) {
    if (!selectedMatches.some(([start, end]) => match[0] < end && match[1] > start)) {
      selectedMatches.push(match);
    }
  }

  let sanitized = title;
  for (const [start, end] of selectedMatches.sort((left, right) => right[0] - left[0])) {
    sanitized = `${sanitized.slice(0, start)} ${sanitized.slice(end)}`;
  }

  return normalizeTitleWhitespace(sanitized);
}

function findFirstTitlePhraseSpan(title: string, phrase: string): [number, number] | null {
  return getPhraseSpans(title, phrase)[0] ?? null;
}

function getTitleCardSpans(title: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];

  for (const pattern of TITLE_CARD_NUMBER_PATTERNS) {
    const globalPattern = new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`);
    for (const match of title.matchAll(globalPattern)) {
      const start = match.index ?? -1;
      if (start >= 0) {
        spans.push([start, start + match[0].length]);
      }
    }
  }

  for (const match of title.matchAll(TITLE_CARD_NUMBER_RANGE_PATTERN)) {
    const start = match.index ?? -1;
    if (start >= 0) {
      spans.push([start, start + match[0].length]);
    }
  }

  const sorted = spans.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  const firstSpan = sorted[0];
  if (!firstSpan) {
    return [];
  }

  const firstCluster = sorted.filter(([start, end]) => start < firstSpan[1] && end > firstSpan[0]);
  const rangeSpan = firstCluster
    .filter(([start, end]) => /\bof\s+\d{1,4}\b/iu.test(title.slice(start, end)))
    .sort((left, right) => right[1] - right[0] - (left[1] - left[0]))[0];
  const preferredFirstSpan = rangeSpan ?? firstCluster[firstCluster.length - 1] ?? firstSpan;
  return [preferredFirstSpan, ...sorted.filter((span) => span !== preferredFirstSpan)];
}

function removeFirstTitlePhrase(text: string, phrase: string): string {
  const span = findFirstTitlePhraseSpan(text, phrase);
  if (!span) {
    return text;
  }

  return `${text.slice(0, span[0])} ${text.slice(span[1])}`;
}

function removeTitlePhrases(text: string, phrases: string[]): string {
  let result = text;
  for (const phrase of phrases) {
    result = removeFirstTitlePhrase(result, phrase);
  }
  return normalizeTitleWhitespace(result);
}

function isCardLabelRemainder(value: string): boolean {
  return /^(?:card|no\.?)$/iu.test(value.trim());
}

function getFirstAspectValue(aspects: AspectRecord, key: string): string | null {
  return getAspectStringValues(aspects[key])[0] ?? null;
}

function getSafeCanonicalComponent(value: string | null, title = ''): string | null {
  const normalized = trimToNull(value);
  if (!normalized) {
    return null;
  }

  // Drop values that are entirely condition/grade language. Preserve larger
  // named phrases such as "Mint Collection" and "Excellent Adventure".
  const sanitized = sanitizeGeneratedTitleConditionLanguage(normalized, {});
  if (!containsProhibitedConditionLanguage(normalized)) {
    return normalized;
  }

  if (/^mint$/iu.test(normalized) && title && getPhraseSpans(title, normalized, true).length > 0) {
    return normalized;
  }

  // Keep known larger named phrases whose condition-like word is part of the
  // official identity; strip explicit condition prefixes from mixed values.
  const namedPrefixMatch = /^(mint|excellent)\s+(.+)$/iu.exec(normalized);
  if (
    namedPrefixMatch &&
    sanitized &&
    normalizeTitleWhitespace(namedPrefixMatch[2]).toLocaleLowerCase() ===
      sanitized.toLocaleLowerCase()
  ) {
    return normalized;
  }

  return sanitized || null;
}

function containsWholePhrase(value: string, phrase: string): boolean {
  return findFirstTitlePhraseSpan(value, phrase) !== null;
}

function dedupeTitleParts(parts: string[]): string[] {
  const deduped: string[] = [];
  const seen = new Set<string>();

  for (const part of parts.map((value) => normalizeTitleWhitespace(value)).filter(Boolean)) {
    const key = part.toLocaleLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(part);
  }

  return deduped;
}

function getCanonicalYearTitlePart(title: string, aspects: AspectRecord): string | null {
  const year = trimToNull(getAspectString(aspects, 'Year'));
  if (!year) {
    return null;
  }

  const leadingRange = new RegExp(`^\\s*${year}\\s*[-/]\\s*(?:\\d{2}|\\d{4})\\b`, 'u').exec(title);
  return leadingRange?.[0]?.trim() ?? year;
}

function getCanonicalSetParts(aspects: AspectRecord, title = ''): string[] {
  const set = getSafeCanonicalComponent(getFirstAspectValue(aspects, 'Set'), title);
  const titleSet = set?.replace(/^(?:19|20)\d{2}\s*[-/]\s*(?:\d{2}|\d{4})(?=\s|$)\s*/u, '') || null;
  const manufacturer = getSafeCanonicalComponent(
    trimToNull(getAspectString(aspects, 'Manufacturer')),
    title
  );

  if (!titleSet) {
    return manufacturer ? [manufacturer] : [];
  }

  if (!manufacturer || containsWholePhrase(titleSet, manufacturer)) {
    return [titleSet];
  }

  return [manufacturer, titleSet];
}

function removeConditionLanguageFromCharacteristic(value: string): string | null {
  const sanitized = sanitizeGeneratedTitleConditionLanguage(value, {});
  return POSITIVE_FEATURE_PATTERN.test(sanitized) ? sanitized : null;
}

function getCanonicalCharacteristicParts(title: string, aspects: AspectRecord): string[] {
  const parts: string[] = [];
  const setParts = getCanonicalSetParts(aspects, title);

  for (const value of [
    ...getAspectStringValues(aspects['Insert Set']),
    ...getAspectStringValues(aspects['Parallel/Variety']),
  ]) {
    const safeValue = getSafeCanonicalComponent(value, title);
    if (!safeValue) {
      continue;
    }
    const titleSpan = findFirstTitlePhraseSpan(title, safeValue);
    const sourcePhrase = titleSpan ? title.slice(titleSpan[0], titleSpan[1]) : safeValue;
    parts.push(removeComponentOverlap(sourcePhrase, setParts));
  }

  for (const value of getAspectStringValues(aspects.Features)) {
    const sanitizedValue = removeConditionLanguageFromCharacteristic(value);
    if (!sanitizedValue) {
      continue;
    }

    // Preserve the complete visible characteristic when the model supplied a
    // shorthand aspect (for example Features: ["Rookie"] for "Rookie Card").
    let sourcePhrase = sanitizedValue;
    if (/^rookie$/iu.test(sanitizedValue)) {
      const rookieCardSpan = findFirstTitlePhraseSpan(title, 'Rookie Card');
      if (rookieCardSpan) {
        sourcePhrase = title.slice(rookieCardSpan[0], rookieCardSpan[1]);
      }
    } else {
      const titleSpan = findFirstTitlePhraseSpan(title, sanitizedValue);
      if (titleSpan) {
        sourcePhrase = title.slice(titleSpan[0], titleSpan[1]);
      }
    }
    parts.push(sourcePhrase);

    // Serial-numbered cards carry a more useful visible identifier than the
    // generic Features value. Keep that exact identifier in the characteristic
    // slot while still retaining the positive "Serial Numbered" evidence.
    if (/serial(?:[-\s]+numbered)?/iu.test(sanitizedValue)) {
      const serialSpan = /\b\d{1,4}\s*\/\s*\d{1,4}\b/iu.exec(title);
      if (serialSpan) {
        parts.push(serialSpan[0]);
      }
    }
  }

  const deduped = dedupeTitleParts(parts);
  return deduped.filter((part, index) => {
    return !deduped.some((other, otherIndex) => {
      return (
        otherIndex !== index &&
        other.length > part.length &&
        new RegExp(`(?:^|\\s)${escapeRegExp(part)}(?:$|\\s)`, 'iu').test(other)
      );
    });
  });
}

function removeComponentOverlap(value: string, priorParts: string[]): string {
  let result = normalizeTitleWhitespace(value);
  for (const priorPart of priorParts) {
    const prefix = new RegExp(`^${escapeRegExp(priorPart)}\\s+`, 'iu');
    result = result.replace(prefix, '').trim();
  }
  return result || value;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function getCanonicalCardPart(title: string, cardNumber: string | null): string | null {
  const cardSpan = getTitleCardSpans(title)[0];
  const source = cardSpan ? title.slice(cardSpan[0], cardSpan[1]) : null;
  const sourceMatch = source?.match(
    /(?:#\s*|\bNo\.?\s*#?\s*|\bCard\s+(?:(?:No\.?|Number)\s*)?#?\s*)([A-Za-z0-9-]+(?:\s+of\s+\d{1,4})?)/iu
  );
  const normalizedAspect = normalizeCardNumberValue(cardNumber ?? '');
  const safeAspect = getSafeCanonicalComponent(normalizedAspect, title);
  const normalizedSource = normalizeCardNumberValue(sourceMatch?.[1] ?? '');
  const normalized = /\bof\s+\d{1,4}\b/iu.test(normalizedAspect)
    ? safeAspect
    : normalizedSource || safeAspect;
  return normalized ? `#${normalized}` : null;
}

function isBareCardNumberDuplicate(part: string, cardNumber: string | null): boolean {
  const normalizedCardNumber = normalizeCardNumberValue(cardNumber ?? '');
  if (!normalizedCardNumber) {
    return false;
  }

  const normalizedPart = part.trim();
  return /^\d+$/u.test(normalizedPart) && normalizedPart === normalizedCardNumber;
}

function getTrailingNumericParts(
  title: string,
  cardSpan: [number, number] | null,
  cardNumber: string | null
): string[] {
  if (!cardSpan) {
    return [];
  }

  const parts: string[] = [];
  const tailStart = cardSpan[1];
  const tail = title.slice(tailStart);
  const serialSpans = [...tail.matchAll(/\b\d{1,4}\s*\/\s*\d{1,4}\b/gu)]
    .map((match) => {
      const start = match.index ?? -1;
      return start >= 0 ? ([start, start + match[0].length] as [number, number]) : null;
    })
    .filter((span): span is [number, number] => span !== null);

  for (const match of tail.matchAll(/(?<![\p{L}\p{N}])\d{1,2}(?:\.\d+)?(?![\p{L}\p{N}])/gu)) {
    const start = match.index ?? -1;
    const end = start + match[0].length;
    if (serialSpans.some(([serialStart, serialEnd]) => start >= serialStart && end <= serialEnd)) {
      continue;
    }
    if (!isBareCardNumberDuplicate(match[0], cardNumber)) {
      parts.push(match[0]);
    }
  }

  return dedupeTitleParts(parts);
}

function getNumericTitleParts(
  title: string,
  aspects: AspectRecord,
  playerSpan: [number, number] | null,
  cardSpan: [number, number] | null,
  cardNumber: string | null
): string[] {
  if (!playerSpan) {
    return [];
  }

  const knownPhrases = [
    ...(() => {
      const yearPart = getCanonicalYearTitlePart(title, aspects);
      return yearPart ? [yearPart] : [];
    })(),
    ...getCanonicalSetParts(aspects, title),
    ...getCanonicalCharacteristicParts(title, aspects),
    ...getAspectStringValues(aspects.Player),
    ...getAspectStringValues(aspects.Franchise),
  ];
  const slices = [
    title.slice(0, playerSpan[0]),
    title.slice(playerSpan[1], cardSpan?.[0] ?? title.length),
  ];
  const parts: string[] = [];
  for (const slice of slices) {
    const remainder = removeTitlePhrases(slice, knownPhrases);
    for (const match of remainder.matchAll(
      /\b(?:Series|Insert)\s+\d{1,2}\b|(?<![\p{L}\p{N}])\d{1,2}(?:\.\d+)?(?![\p{L}\p{N}])/giu
    )) {
      const part = match[0].trim();
      if (!isCardLabelRemainder(part) && !isBareCardNumberDuplicate(part, cardNumber)) {
        parts.push(part);
      }
    }
  }
  return dedupeTitleParts(parts);
}

function normalizeCanonicalTitleOrder(title: string, aspects: AspectRecord): string {
  const player = trimToNull(getAspectString(aspects, 'Player'));
  if (!player) {
    return title;
  }

  const setParts = getCanonicalSetParts(aspects, title);
  const characteristicParts = getCanonicalCharacteristicParts(title, aspects);
  const cardNumber = trimToNull(getAspectString(aspects, 'Card Number'));
  const yearPart = getCanonicalYearTitlePart(title, aspects);
  const team = getSafeCanonicalComponent(trimToNull(getAspectString(aspects, 'Franchise')), title);

  // With no canonical component beyond the player, retain the model's
  // unstructured title verbatim so semantic title length remains fail-closed.
  if (
    !yearPart &&
    setParts.length === 0 &&
    characteristicParts.length === 0 &&
    !cardNumber &&
    !team
  ) {
    return title;
  }

  const playerSpan = findFirstTitlePhraseSpan(title, player);
  const cardSpan = getTitleCardSpans(title)[0] ?? null;
  const numericTitleParts = getNumericTitleParts(title, aspects, playerSpan, cardSpan, cardNumber);
  const canonicalSetParts = dedupeTitleParts([...setParts, ...numericTitleParts]);
  const canonicalCharacteristicParts = characteristicParts;
  const cardPart = getCanonicalCardPart(title, cardNumber);
  const trailingNumericParts = getTrailingNumericParts(title, cardSpan, cardNumber);
  const orderedParts = [
    getCanonicalYearTitlePart(title, aspects),
    ...canonicalSetParts,
    ...canonicalCharacteristicParts,
    player,
    cardPart,
    ...trailingNumericParts,
    team,
  ].filter((part): part is string => Boolean(part));

  return normalizeTitleWhitespace(dedupeTitleParts(orderedParts).join(' '));
}

function normalizeAspects(value: unknown, warnings: string[]): Record<string, string | string[]> {
  if (!isRecord(value)) {
    return {};
  }

  const aspects: Record<string, string | string[]> = {};
  const unexpectedKeys: string[] = [];

  for (const [key, rawAspectValue] of Object.entries(value)) {
    if (
      !GENERATED_LISTING_ASPECT_KEY_SET.has(key) &&
      !TRANSIENT_GENERATED_LISTING_ASPECT_KEYS.has(key)
    ) {
      unexpectedKeys.push(key);
      continue;
    }

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

  if (unexpectedKeys.length > 0) {
    warnings.push(
      `Gemini response aspects discarded unexpected keys: ${unexpectedKeys
        .map((key) => JSON.stringify(key))
        .join(', ')}.`
    );
  }

  return aspects;
}

function getAspectString(aspects: AspectRecord, key: string): string | null {
  const value = aspects[key];
  return typeof value === 'string' ? value : null;
}

function getAspectStringValues(value: AspectValue): string[] {
  if (typeof value === 'string') {
    const normalized = trimToNull(value);
    return normalized ? [normalized] : [];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .flatMap((entry) => (typeof entry === 'string' ? [entry] : []))
    .map((entry) => trimToNull(entry))
    .filter((entry): entry is string => entry !== null);
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
  draft: Pick<GeneratedListingDraft, 'title' | 'aspects' | 'warnings' | 'yearEvidence'>,
  options: NormalizeGeneratedDraftYearFieldsOptions = {}
): Pick<GeneratedListingDraft, 'title' | 'aspects' | 'warnings' | 'yearEvidence'> {
  const yearNormalized = normalizeGeneratedDraftYearFields(
    {
      aspects: draft.aspects,
      title: draft.title,
      warnings: draft.warnings,
      yearEvidence: draft.yearEvidence,
    },
    options
  );

  const aspects: AspectRecord = { ...yearNormalized.aspects };
  const warnings = [...yearNormalized.warnings];
  let title = yearNormalized.title;

  const manufacturer = trimToNull(getAspectString(aspects, 'Manufacturer'));
  const cardManufacturer = trimToNull(getAspectString(aspects, 'Card Manufacturer'));
  if (!manufacturer && cardManufacturer) {
    aspects.Manufacturer = cardManufacturer;
  }
  delete aspects['Card Manufacturer'];

  const player = getAspectString(aspects, 'Player');
  const playerAthlete = getAspectString(aspects, 'Player/Athlete');
  const athlete = getAspectString(aspects, 'Athlete');

  if (!player && playerAthlete) {
    aspects.Player = playerAthlete;
  } else if (!player && athlete) {
    aspects.Player = athlete;
  }
  delete aspects['Player/Athlete'];
  delete aspects.Athlete;

  const cardNumber = getAspectString(aspects, 'Card Number');
  if (cardNumber) {
    const normalizedCardNumber = normalizeCardNumberValue(cardNumber);

    if (normalizedCardNumber.length > 0) {
      aspects['Card Number'] = normalizedCardNumber;
    }
  }

  const normalizedAspectCardNumber = getAspectString(aspects, 'Card Number');
  const titleCardNumber = extractCardNumberFromTitle(title);

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

  title = sanitizeGeneratedTitleConditionLanguage(title, aspects);
  title = normalizeCanonicalTitleOrder(title, aspects);

  return {
    title,
    aspects,
    warnings,
    yearEvidence: yearNormalized.yearEvidence ?? null,
  };
}

function normalizeSerialEvidence(
  value: unknown,
  warnings: string[],
  imageCount?: number,
  title?: string
): SerialEvidence | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (!isRecord(value)) {
    warnings.push('Gemini response field "serialEvidence" was invalid and was discarded.');
    return null;
  }

  const visibleText = trimToNull(normalizeNullableString(value.visibleText));
  const imageIndex = normalizeInteger(value.imageIndex);
  const numerator = normalizeInteger(value.numerator);
  const denominator = normalizeInteger(value.denominator);

  if (!visibleText || imageIndex === undefined || numerator === undefined || denominator === undefined) {
    warnings.push('Gemini response field "serialEvidence" was incomplete and was discarded.');
    return null;
  }

  if (
    numerator <= 0 ||
    denominator <= 0 ||
    numerator > denominator ||
    !isValidImageIndex(imageIndex, imageCount)
  ) {
    warnings.push('Gemini response field "serialEvidence" failed positive integer or image validation and was discarded.');
    return null;
  }

  const fractionPattern = /(?<![\p{L}\p{N}#])\d{1,6}\s*\/\s*\d{1,6}(?![\p{L}\p{N}])/gu;
  const fractions = [...visibleText.matchAll(fractionPattern)].map((match) => match[0]);
  const expectedPattern = new RegExp(
    `(?<![\\p{L}\\p{N}#])0*${numerator}\\s*\\/\\s*0*${denominator}(?![\\p{L}\\p{N}])`,
    'u'
  );
  const hasCardNumberContext =
    /(?:#\s*\d+|\bcard(?:\s+(?:number|no\.?))?\s*#?\s*\d+\s+of\s+\d+)/iu.test(
      visibleText
    );
  const isTitleOnlyClaim =
    title !== undefined && normalizeTitleWhitespace(visibleText).toLocaleLowerCase() === normalizeTitleWhitespace(title).toLocaleLowerCase();

  if (
    fractions.length !== 1 ||
    !expectedPattern.test(visibleText) ||
    hasCardNumberContext ||
    isTitleOnlyClaim
  ) {
    warnings.push('Gemini response field "serialEvidence" was ambiguous or inconsistent and was discarded.');
    return null;
  }

  return { visibleText, imageIndex, numerator, denominator };
}

function applySerialEvidenceToAspects(
  aspects: Record<string, string | string[]>,
  serialEvidence: SerialEvidence | null
): void {
  if (!serialEvidence) {
    return;
  }

  aspects['Print Run'] = String(serialEvidence.denominator);
  const features = getAspectStringValues(aspects.Features);
  if (!features.some((feature) => /\bserial(?:[-\s]+numbered)?\b/iu.test(feature))) {
    aspects.Features = [...features, 'Serial Numbered'];
  }
}

function normalizeYearEvidence(
  value: unknown,
  warnings: string[]
): GeneratedListingDraft['yearEvidence'] {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (!isRecord(value)) {
    warnings.push('Gemini response field "yearEvidence" was invalid and was discarded.');
    return null;
  }

  const year = trimToNull(normalizeNullableString(value.year));
  const sourceType = normalizeYearEvidenceSourceType(value.sourceType);
  const visibleText = trimToNull(normalizeNullableString(value.visibleText));
  const imageIndex = normalizeInteger(value.imageIndex);

  if (value.year !== undefined && year === null) {
    warnings.push('Gemini response field "yearEvidence.year" was invalid and was discarded.');
  }

  if (value.sourceType !== undefined && sourceType === undefined) {
    warnings.push('Gemini response field "yearEvidence.sourceType" was invalid and was discarded.');
  }

  if (value.visibleText !== undefined && visibleText === null) {
    warnings.push(
      'Gemini response field "yearEvidence.visibleText" was invalid and was discarded.'
    );
  }

  if (value.imageIndex !== undefined && imageIndex === undefined) {
    warnings.push('Gemini response field "yearEvidence.imageIndex" was invalid and was discarded.');
  }

  if (!year || !sourceType || !visibleText || imageIndex === undefined) {
    if (Object.keys(value).length > 0) {
      warnings.push('Gemini response field "yearEvidence" was incomplete and was discarded.');
    }
    return null;
  }

  return {
    year,
    sourceType,
    visibleText,
    imageIndex,
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

    if (
      typeof rawValue === 'number' &&
      Number.isFinite(rawValue) &&
      rawValue >= 0 &&
      rawValue <= 1
    ) {
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
  rawModelResponse: unknown,
  options: NormalizeGeneratedDraftYearFieldsOptions = {}
): GeneratedListingDraft {
  const parsed = parseDraftObject(rawText);
  const serviceWarnings: string[] = [];
  const modelWarnings = normalizeModelWarnings(parsed.warnings);
  const title = normalizeRequiredString(parsed.title, 'title', serviceWarnings);
  const description = normalizeRequiredString(parsed.description, 'description', serviceWarnings);
  const categorySuggestion = normalizeNullableString(parsed.categorySuggestion);
  const cardConditionNote = normalizeNullableString(parsed.cardConditionNote);
  const cardConditionToken = normalizeCardConditionToken(
    parsed.cardConditionToken,
    serviceWarnings
  );
  const conditionSuggestion = normalizeNullableString(parsed.conditionSuggestion);
  const skuCategoryCode = normalizeSkuCategoryCodeSuggestion(
    parsed.skuCategoryCode,
    serviceWarnings
  );
  const aspects = normalizeAspects(parsed.aspects, serviceWarnings);
  const yearEvidence = normalizeYearEvidence(parsed.yearEvidence, serviceWarnings);
  const serialEvidence = normalizeSerialEvidence(
    parsed.serialEvidence,
    serviceWarnings,
    options.imageCount,
    title
  );
  const priceSuggestion = normalizePriceSuggestion(parsed.priceSuggestion, serviceWarnings);
  const confidence = normalizeConfidence(parsed.confidence, serviceWarnings);

  const normalizedDraft = normalizeGeneratedDraft(
    {
      title,
      aspects,
      warnings: [...modelWarnings, ...serviceWarnings],
      yearEvidence,
    },
    options
  );
  const finalTitle = assertGeneratedTitleLength(normalizedDraft.title);
  applySerialEvidenceToAspects(normalizedDraft.aspects, serialEvidence);

  return generatedListingDraftSchema.parse({
    title: finalTitle,
    description,
    categorySuggestion,
    cardConditionNote,
    cardConditionToken,
    conditionSuggestion,
    skuCategoryCode,
    aspects: normalizedDraft.aspects,
    yearEvidence: normalizedDraft.yearEvidence,
    serialEvidence,
    priceSuggestion,
    confidence,
    warnings: normalizedDraft.warnings,
    rawModelResponse,
  });
}
