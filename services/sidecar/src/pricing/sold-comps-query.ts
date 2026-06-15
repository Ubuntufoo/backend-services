import {
  GRADED_TRADING_CARD_CONDITION_ID,
  RAW_TRADING_CARD_CONDITION_ID,
  TRADING_CARD_CONDITION_ASPECT_KEY,
} from '@/listings/trading-card-conditions.js';

import type { PricingProviderInput } from './types.js';

const PLAYER_ITEM_SPECIFIC_KEYS = ['Player', 'Player/Athlete', 'Athlete'] as const;
const YEAR_ITEM_SPECIFIC_KEYS = ['Year', 'Season'] as const;
const MANUFACTURER_ITEM_SPECIFIC_KEYS = ['Manufacturer', 'Card Manufacturer', 'Brand'] as const;
const SET_LINE_ITEM_SPECIFIC_KEYS = ['Set', 'Series', 'Product', 'Product Line'] as const;
const CARD_NUMBER_ITEM_SPECIFIC_KEYS = ['Card Number'] as const;
const PARALLEL_FACET_ITEM_SPECIFIC_KEYS = ['Parallel/Variety', 'Insert Set'] as const;
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
const PARALLEL_ITEM_SPECIFIC_KEYS = [
  'Parallel/Variety',
  'Insert Set',
  'Features',
  'Series',
  'Product',
  'Product Line',
  'Variation',
] as const;
const PARALLEL_TERMS = [
  'Topps Chrome',
  'Bowman Chrome',
  'Rated Rookie',
  'Blue Velocity',
  'Red Ice',
  'Pink Ice',
  'Fast Break',
  'Tiger Stripe',
  'Cracked Ice',
  'Photo Variation',
  'X-Fractor',
  'Die-Cut',
  'Prizm',
  'Silver',
  'Refractor',
  'Mosaic',
  'Optic',
  'Select',
  'Chrome',
  'Concourse',
  'Courtside',
  'Genesis',
  'Checkerboard',
  'Kaboom',
  'Downtown',
  'Color Blast',
  'Shimmer',
  'Sparkle',
  'Disco',
  'Mojo',
  'Scope',
  'Impact',
  'Holo',
  'Foil',
  'Negative',
  'Sepia',
  'Hyper',
  'Wave',
  'Pink',
  'Gold',
  'Green',
  'Blue',
  'Red',
  'Black',
  'White',
  'Purple',
  'Orange',
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
  const title = input.title.trim();
  const terms = new QueryTermAccumulator();
  const isLot = isLotListing(input, title);
  const player = getPlayer(input.itemSpecifics);
  const primaryYear = getPrimaryYear(input.itemSpecifics, title);
  const manufacturer = getManufacturer(input.itemSpecifics);
  const cardNumber = getCardNumber(input.itemSpecifics, title, primaryYear);

  terms.add(player);
  terms.add(primaryYear);
  terms.add(manufacturer);
  terms.add(getSetLine(input.itemSpecifics, title, { cardNumber, manufacturer, player, primaryYear }));

  if (!isLot) {
    terms.add(formatCardNumber(cardNumber));
  }

  for (const token of getParallelSignals(input.itemSpecifics, title)) {
    terms.add(token);
  }

  terms.add(getGradingSignal(input));

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
  return value?.match(/\b(19\d{2}|20\d{2})\b/)?.[1];
}

function getManufacturer(itemSpecifics: PricingProviderInput['itemSpecifics']): string | undefined {
  return getFirstSpecificValue(itemSpecifics, MANUFACTURER_ITEM_SPECIFIC_KEYS);
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
  const terms = new QueryTermAccumulator();

  for (const value of getSpecificValues(itemSpecifics, SET_LINE_ITEM_SPECIFIC_KEYS)) {
    terms.add(cleanSetLineValue(value, context));
  }

  if (!terms.isEmpty()) {
    return terms.toString();
  }

  if (context.manufacturer) {
    return undefined;
  }

  return tokenizeTitle(title)
    .filter((token) => !/^\d{4}$/.test(token))
    .filter((token) => !context.player || !includesWholeTerm(context.player, token))
    .filter((token) => !context.manufacturer || !includesWholeTerm(context.manufacturer, token))
    .filter((token) => token !== context.cardNumber)
    .slice(0, 4)
    .join(' ');
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

function getParallelSignals(itemSpecifics: PricingProviderInput['itemSpecifics'], title: string): string[] {
  const terms = new QueryTermAccumulator();

  for (const key of PARALLEL_FACET_ITEM_SPECIFIC_KEYS) {
    for (const value of normalizeSpecificValue(itemSpecifics?.[key])) {
      const extracted = extractParallelTerms(value);
      if (extracted.length === 0) {
        terms.add(value);
        continue;
      }

      for (const term of extracted) {
        terms.add(term);
      }
    }
  }

  for (const value of getSpecificValues(itemSpecifics, PARALLEL_ITEM_SPECIFIC_KEYS)) {
    for (const term of extractParallelTerms(value)) {
      terms.add(term);
    }
  }

  for (const term of extractParallelTerms(title)) {
    terms.add(term);
  }

  return terms.toArray();
}

function extractParallelTerms(value: string): string[] {
  return PARALLEL_TERMS.filter((term) => includesWholeTerm(value, term));
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
  let normalized = value.trim();

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
  normalized = normalized.replace(/\s+/g, ' ').trim();

  return normalized || undefined;
}

function removeWholePhrase(source: string, candidate: string): string {
  const escaped = escapeRegExp(candidate).replace(/\s+/g, '\\s+');
  return source.replace(new RegExp(`(?:^|\\s)${escaped}(?=$|\\s)`, 'gi'), ' ').replace(/\s+/g, ' ').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
