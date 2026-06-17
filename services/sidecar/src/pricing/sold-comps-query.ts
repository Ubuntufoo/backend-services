import {
  GRADED_TRADING_CARD_CONDITION_ID,
  RAW_TRADING_CARD_CONDITION_ID,
  TRADING_CARD_CONDITION_ASPECT_KEY,
} from '@/listings/trading-card-conditions.js';

import type { PricingProviderInput } from './types.js';
import { extractSeasonStartYear, normalizeSeasonRanges } from './season-range.js';

const PLAYER_ITEM_SPECIFIC_KEYS = ['Player', 'Player/Athlete', 'Athlete'] as const;
const YEAR_ITEM_SPECIFIC_KEYS = ['Year', 'Season'] as const;
const MANUFACTURER_ITEM_SPECIFIC_KEYS = ['Manufacturer', 'Card Manufacturer', 'Brand'] as const;
const SET_LINE_ITEM_SPECIFIC_KEYS = ['Set', 'Series', 'Product', 'Product Line'] as const;
const CARD_NUMBER_ITEM_SPECIFIC_KEYS = ['Card Number'] as const;
const QUERY_TITLE_STOPWORDS = new Set([
  'and',
  'baseball',
  'basketball',
  'card',
  'cards',
  'football',
  'for',
  'hockey',
  'insert',
  'mlb',
  'nba',
  'nfl',
  'nhl',
  'of',
  'rc',
  'rookie',
  'soccer',
  'sports',
  'tcg',
  'the',
  'trading',
]);
const SPECIAL_CHARACTERISTIC_ITEM_SPECIFIC_KEYS = [
  'Autographed',
  'Features',
  'Signed By',
  'Signed',
  'Variation',
] as const;
const NOISY_QUERY_PHRASES = [
  '3rd base',
  'first base',
  'left field',
  'right field',
  'second base',
  'short stop',
  'third base',
] as const;
const NOISY_QUERY_TERMS = new Set([
  'base',
  'baseball',
  'basketball',
  'card',
  'cards',
  'catcher',
  'coach',
  'football',
  'franchise',
  'goalie',
  'guard',
  'hockey',
  'manager',
  'mlb',
  'nba',
  'nfl',
  'nhl',
  'outfield',
  'pitcher',
  'position',
  'qb',
  'quarterback',
  'rb',
  'receiver',
  'running',
  'season',
  'soccer',
  'sport',
  'sports',
  'team',
  'trading',
  'wr',
]);
const AUTOGRAPH_PATTERNS = [
  /\bauto(?:graph|graphed)?\b/i,
  /\bautographed\b/i,
  /\bsigned\b/i,
] as const;
const GRADE_PATTERN = /\b(PSA|BGS|SGC|CGC|CSG|TAG|HGA)\s*(10|[1-9](?:\.\d)?)\b/i;
const TITLE_CARD_NUMBER_PATTERNS = [
  /\bCard\s*#\s*([A-Za-z]{0,4}\d{1,4}[A-Za-z]{0,4})\b/gi,
  /\bCard\s*No\.?\s*([A-Za-z]{0,4}\d{1,4}[A-Za-z]{0,4})\b/gi,
  /\bCard\s*Number\s*([A-Za-z]{0,4}\d{1,4}[A-Za-z]{0,4})\b/gi,
  /(?:^|[\s(])#\s*([A-Za-z]{0,4}\d{1,4}[A-Za-z]{0,4})(?=$|[\s),.-])/gi,
] as const;
const SERIAL_NUMBER_PATTERN = /(?:^|[\s(])(?:#?\d{1,4}\s*\/\s*\d{1,4}|\d{1,4}\s*of\s*\d{1,4})(?:$|[\s)])/i;
const GRADER_ITEM_SPECIFIC_KEYS = ['Professional Grader', 'Grader', 'Graded'] as const;
const GRADE_ITEM_SPECIFIC_KEYS = ['Grade', 'Card Grade'] as const;

export function buildSoldCompsQuery(input: PricingProviderInput): string {
  const rawTitle = input.title.trim();
  const terms = new QueryTermAccumulator();
  const player = getPlayer(input.itemSpecifics);
  const primaryYear = getPrimaryYear(input.itemSpecifics, rawTitle);
  const title = normalizeSeasonRanges(rawTitle, { targetYear: primaryYear });
  const isLot = isLotListing(input, title);
  const manufacturer = getManufacturer(input.itemSpecifics, { primaryYear });
  const cardNumber = getCardNumber(input.itemSpecifics, title, primaryYear);

  terms.add(player);
  terms.add(primaryYear);
  terms.add(getProductLine(input.itemSpecifics, title, { cardNumber, manufacturer, player, primaryYear }));

  if (!isLot) {
    terms.add(formatCardNumber(cardNumber));
  }

  terms.add(getGradingSignal(input));
  terms.add(getAutographSignal(input.itemSpecifics, title));

  if (isLot) {
    terms.add('lot');
  }

  if (terms.isEmpty()) {
    for (const token of tokenizeTitle(title)) {
      terms.add(token);
    }
  }

  return terms.toString() || title;
}

class QueryTermAccumulator {
  readonly #terms: string[] = [];
  readonly #seen = new Set<string>();

  add(value: string | undefined): void {
    const normalized = value?.trim().replace(/\s+/g, ' ');

    if (!normalized) {
      return;
    }

    const key = normalized.toLocaleLowerCase();
    if (this.#seen.has(key)) {
      return;
    }

    if (this.#terms.some((term) => containsWholePhrase(term, normalized))) {
      return;
    }

    this.#terms.push(normalized);
    this.#seen.add(key);
  }

  isEmpty(): boolean {
    return this.#terms.length === 0;
  }

  toArray(): string[] {
    return [...this.#terms];
  }

  toString(): string {
    return this.#terms.join(' ');
  }
}

function getSpecificValues(
  itemSpecifics: PricingProviderInput['itemSpecifics'],
  keys: readonly string[]
): string[] {
  if (!itemSpecifics) {
    return [];
  }

  return keys.flatMap((key) => normalizeSpecificValue(itemSpecifics[key]));
}

function normalizeSpecificValue(value: string | string[] | null | undefined): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  }

  const normalized = value?.trim();
  return normalized ? [normalized] : [];
}

function getFirstSpecificValue(
  itemSpecifics: PricingProviderInput['itemSpecifics'],
  keys: readonly string[]
): string | undefined {
  return getSpecificValues(itemSpecifics, keys)[0];
}

function getPlayer(itemSpecifics: PricingProviderInput['itemSpecifics']): string | undefined {
  return getFirstSpecificValue(itemSpecifics, PLAYER_ITEM_SPECIFIC_KEYS);
}

function getPrimaryYear(itemSpecifics: PricingProviderInput['itemSpecifics'], title: string): string | undefined {
  const titleYear = extractYear(title);
  if (titleYear) {
    return titleYear;
  }

  const specificYear = getFirstSpecificValue(itemSpecifics, YEAR_ITEM_SPECIFIC_KEYS);
  return extractYear(specificYear);
}

function extractYear(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  return value.match(/\b(19\d{2}|20\d{2})\b/)?.[1] ?? extractSeasonStartYear(value) ?? undefined;
}

function getManufacturer(
  itemSpecifics: PricingProviderInput['itemSpecifics'],
  context: { primaryYear?: string }
): string | undefined {
  for (const value of getSpecificValues(itemSpecifics, MANUFACTURER_ITEM_SPECIFIC_KEYS)) {
    const normalized = cleanStructuredValue(value, { primaryYear: context.primaryYear });
    if (normalized) {
      return normalized;
    }
  }

  return undefined;
}

function getProductLine(
  itemSpecifics: PricingProviderInput['itemSpecifics'],
  title: string,
  context: {
    cardNumber?: string;
    manufacturer?: string;
    player?: string;
    primaryYear?: string;
  }
): string | undefined {
  const setLine = getSetLine(itemSpecifics, title, context);

  if (!setLine) {
    return context.manufacturer;
  }

  if (!context.manufacturer) {
    return setLine;
  }

  if (containsWholePhrase(setLine, context.manufacturer)) {
    return setLine;
  }

  if (containsWholePhrase(context.manufacturer, setLine)) {
    return context.manufacturer;
  }

  return `${context.manufacturer} ${setLine}`;
}

function getSetLine(
  itemSpecifics: PricingProviderInput['itemSpecifics'],
  title: string,
  context: {
    cardNumber?: string;
    manufacturer?: string;
    player?: string;
    primaryYear?: string;
  }
): string | undefined {
  for (const value of getSpecificValues(itemSpecifics, SET_LINE_ITEM_SPECIFIC_KEYS)) {
    const cleaned = cleanSetLineValue(value, context);
    if (cleaned) {
      return cleaned;
    }
  }

  if (context.manufacturer) {
    return undefined;
  }

  return extractSetLineFromTitle(title, context);
}

function getCardNumber(
  itemSpecifics: PricingProviderInput['itemSpecifics'],
  title: string,
  primaryYear?: string
): string | undefined {
  const specific = sanitizeCardNumber(getFirstSpecificValue(itemSpecifics, CARD_NUMBER_ITEM_SPECIFIC_KEYS));

  if (specific) {
    return specific;
  }

  for (const pattern of TITLE_CARD_NUMBER_PATTERNS) {
    for (const match of title.matchAll(pattern)) {
      const candidate = sanitizeCardNumber(match[1]);
      if (candidate && candidate !== primaryYear) {
        return candidate;
      }
    }
  }

  return undefined;
}

function sanitizeCardNumber(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/^#+/, '');
  return normalized && /^[A-Za-z]{0,4}\d{1,4}[A-Za-z]{0,4}$/.test(normalized) ? normalized : undefined;
}

function formatCardNumber(value: string | undefined): string | undefined {
  return value ? `#${value.replace(/^#+/, '')}` : undefined;
}

function includesWholeTerm(source: string, candidate: string): boolean {
  const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(?:^|[^A-Za-z0-9])${escaped}(?:$|[^A-Za-z0-9])`, 'i').test(source);
}

function containsWholePhrase(source: string, candidate: string): boolean {
  const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(?:^|\\s)${escaped}(?:$|\\s)`, 'i').test(source);
}

function getGradingSignal(input: PricingProviderInput): string | undefined {
  const explicitGrade = extractGradeSignal(input.itemSpecifics, input.title);

  if (input.conditionId?.trim() === GRADED_TRADING_CARD_CONDITION_ID) {
    return explicitGrade ?? 'graded';
  }

  if (explicitGrade) {
    return explicitGrade;
  }

  if (input.conditionId?.trim() === RAW_TRADING_CARD_CONDITION_ID) {
    return undefined;
  }

  if (getFirstSpecificValue(input.itemSpecifics, [TRADING_CARD_CONDITION_ASPECT_KEY])) {
    return undefined;
  }

  return undefined;
}

function extractGradeSignal(
  itemSpecifics: PricingProviderInput['itemSpecifics'],
  title: string
): string | undefined {
  const fromTitle = extractTitleGrade(title);
  if (fromTitle) {
    return fromTitle;
  }

  const grader = normalizeGrader(getFirstSpecificValue(itemSpecifics, GRADER_ITEM_SPECIFIC_KEYS));
  const grade = normalizeGrade(getFirstSpecificValue(itemSpecifics, GRADE_ITEM_SPECIFIC_KEYS));

  if (grader && grade) {
    return `${grader} ${grade}`;
  }

  return undefined;
}

function extractTitleGrade(title: string): string | undefined {
  const match = title.match(GRADE_PATTERN);
  return match ? `${match[1].toUpperCase()} ${match[2]}` : undefined;
}

function cleanSetLineValue(
  value: string,
  context: {
    cardNumber?: string;
    manufacturer?: string;
    player?: string;
    primaryYear?: string;
  }
): string | undefined {
  return cleanStructuredValue(value, context);
}

function removeWholePhrase(source: string, candidate: string): string {
  const escaped = escapeRegExp(candidate).replace(/\s+/g, '\\s+');
  return source.replace(new RegExp(`(?:^|\\s)${escaped}(?=$|\\s)`, 'gi'), ' ').replace(/\s+/g, ' ').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanStructuredValue(
  value: string,
  context: {
    cardNumber?: string;
    manufacturer?: string;
    player?: string;
    primaryYear?: string;
  }
): string | undefined {
  let normalized = normalizeSeasonRanges(value.trim(), { targetYear: context.primaryYear });

  if (!normalized) {
    return undefined;
  }

  if (context.player) {
    normalized = removeWholePhrase(normalized, context.player);
  }

  if (context.primaryYear) {
    normalized = removeWholePhrase(normalized, context.primaryYear);
  }

  if (context.manufacturer) {
    normalized = removeWholePhrase(normalized, context.manufacturer);
  }

  if (context.cardNumber) {
    normalized = normalized.replace(
      new RegExp(`(?:^|\\s)#?${escapeRegExp(context.cardNumber)}(?=$|[\\s),.-])`, 'gi'),
      ' '
    );
  }

  normalized = normalized.replace(/\b(19\d{2}|20\d{2})\b/g, ' ');
  normalized = normalized.replace(SERIAL_NUMBER_PATTERN, ' ');
  normalized = normalized.replace(/\bCard\s*(?:No\.?|Number)\s*#?\s*[A-Za-z]{0,4}\d{1,4}[A-Za-z]{0,4}\b/gi, ' ');
  normalized = stripNoisyQueryTerms(normalized);
  normalized = normalized.replace(/\s+/g, ' ').trim();

  return normalized || undefined;
}

function extractSetLineFromTitle(
  title: string,
  context: {
    cardNumber?: string;
    manufacturer?: string;
    player?: string;
    primaryYear?: string;
  }
): string | undefined {
  const cleaned = cleanStructuredValue(title, context);
  if (!cleaned) {
    return undefined;
  }

  const tokens = tokenizeTitle(cleaned).filter((token) => !isNoisyQueryToken(token));
  return tokens.slice(0, 3).join(' ') || undefined;
}

function stripNoisyQueryTerms(value: string): string {
  let normalized = value;

  for (const phrase of NOISY_QUERY_PHRASES) {
    normalized = removeWholePhrase(normalized, phrase);
  }

  const tokens = normalized
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .filter((token) => !isNoisyQueryToken(token));

  return tokens.join(' ');
}

function isNoisyQueryToken(token: string): boolean {
  return NOISY_QUERY_TERMS.has(token.toLowerCase());
}

function getAutographSignal(
  itemSpecifics: PricingProviderInput['itemSpecifics'],
  title: string
): string | undefined {
  for (const pattern of AUTOGRAPH_PATTERNS) {
    if (pattern.test(title)) {
      return 'autograph';
    }
  }

  for (const key of SPECIAL_CHARACTERISTIC_ITEM_SPECIFIC_KEYS) {
    for (const value of normalizeSpecificValue(itemSpecifics?.[key])) {
      if (AUTOGRAPH_PATTERNS.some((pattern) => pattern.test(value))) {
        return 'autograph';
      }
    }
  }

  return undefined;
}

function normalizeGrader(value: string | undefined): string | undefined {
  const normalized = value?.trim().toUpperCase();
  return normalized && /^(PSA|BGS|SGC|CGC|CSG|TAG|HGA)$/.test(normalized) ? normalized : undefined;
}

function normalizeGrade(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && /^(10|[1-9](?:\.\d)?)$/.test(normalized) ? normalized : undefined;
}

function isLotListing(input: PricingProviderInput, title: string): boolean {
  return input.listingType === 'lot' || /\blot\b|\blot of\b|\bbundle\b|\bmultiple\b/i.test(title);
}

function tokenizeTitle(title: string): string[] {
  return title
    .replace(/[#/()-]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1)
    .filter((token) => !QUERY_TITLE_STOPWORDS.has(token.toLocaleLowerCase()));
}
