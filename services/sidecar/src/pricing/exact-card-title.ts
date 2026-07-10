import { extractSeasonStartYear } from './season-range.js';
import type { NormalizeSoldCompsContext, PricingProviderInput } from './types.js';

const PLAYER_ITEM_SPECIFIC_KEYS = ['Player', 'Player/Athlete', 'Athlete'] as const;
const YEAR_ITEM_SPECIFIC_KEYS = ['Year'] as const;
const SET_ITEM_SPECIFIC_KEYS = ['Set'] as const;
const MANUFACTURER_ITEM_SPECIFIC_KEYS = ['Manufacturer', 'Card Manufacturer', 'Brand'] as const;
const CARD_NUMBER_ITEM_SPECIFIC_KEYS = ['Card Number'] as const;
const TITLE_CARD_NUMBER_PATTERNS = [
  /\bCard\s*([A-Za-z]{0,4}\d{1,4}[A-Za-z]{0,4})\b/gi,
  /\bCard\s*#\s*([A-Za-z]{0,4}\d{1,4}[A-Za-z]{0,4})\b/gi,
  /\bCard\s*No\.?\s*#?\s*([A-Za-z]{0,4}\d{1,4}[A-Za-z]{0,4})\b/gi,
  /\bCard\s*Number\s*#?\s*([A-Za-z]{0,4}\d{1,4}[A-Za-z]{0,4})\b/gi,
  /\bNo\.?\s*#?\s*([A-Za-z]{0,4}\d{1,4}[A-Za-z]{0,4})\b/gi,
  /(?:^|[\s(])#\s*([A-Za-z]{0,4}\d{1,4}[A-Za-z]{0,4})(?=$|[\s),.-])/gi,
] as const;
const YEAR_PATTERN = /\b(19\d{2}|20\d{2})\b/g;
const SET_NOISE_TOKENS = new Set([
  'base',
  'baseball',
  'basketball',
  'break',
  'card',
  'edition',
  'football',
  'hockey',
  'insert',
  'rookie',
  'rc',
  'set',
  'soccer',
  'sports',
  'tcg',
  'trading',
]);
const MULTI_WORD_BASE_BRAND_PAIRS = new Set(['nba hoops', 'upper deck']);
interface ExactCardTitleTarget {
  baseSetTokens: string[];
  cardNumber: string | null;
  playerTokenGroups: string[][];
  playerPhrase: string | null;
  year: string | null;
}

const PLAYER_NAME_DELIMITER_PATTERN = /\s+-\s+|\/|,|&|\bvs\b|\band\b/giu;

export const EXACT_CARD_REJECTION_REASONS = {
  cardNumberMismatch: 'exact_card_number_mismatch',
  playerMismatch: 'exact_player_mismatch',
  setMismatch: 'exact_set_mismatch',
  yearMismatch: 'exact_year_mismatch',
} as const;

export function buildExactCardTitleTarget(context: NormalizeSoldCompsContext): ExactCardTitleTarget {
  const itemSpecifics = context.itemSpecifics;
  const fallbackTitle = context.title ?? '';

  return {
    baseSetTokens: getBaseSetTokens(itemSpecifics),
    cardNumber:
      getFirstSpecificValue(itemSpecifics, CARD_NUMBER_ITEM_SPECIFIC_KEYS, normalizeCardNumber) ??
      extractExplicitCardNumber(fallbackTitle),
    playerTokenGroups: getPlayerTokenGroups(itemSpecifics),
    playerPhrase: getFirstSpecificValue(itemSpecifics, PLAYER_ITEM_SPECIFIC_KEYS, normalizePhrase),
    year: getFirstSpecificValue(itemSpecifics, YEAR_ITEM_SPECIFIC_KEYS, normalizeYear),
  };
}

export function getExactCardTitleMismatchReason(
  title: string,
  target: ExactCardTitleTarget
): string | null {
  const tokens = tokenizeTitle(title);

  if (
    target.playerPhrase &&
    !matchesPlayerTokens(tokens, target.playerPhrase, target.playerTokenGroups)
  ) {
    return EXACT_CARD_REJECTION_REASONS.playerMismatch;
  }

  if (target.baseSetTokens.length > 0 && !containsWholePhraseTokens(tokens, target.baseSetTokens)) {
    return EXACT_CARD_REJECTION_REASONS.setMismatch;
  }

  if (target.year && hasConflictingYear(title, target.year)) {
    return EXACT_CARD_REJECTION_REASONS.yearMismatch;
  }

  if (target.cardNumber) {
    const extractedCardNumber = extractTitleCardNumber(title, target);
    if (extractedCardNumber && extractedCardNumber !== target.cardNumber) {
      return EXACT_CARD_REJECTION_REASONS.cardNumberMismatch;
    }
  }

  return null;
}

function getBaseSetTokens(itemSpecifics: PricingProviderInput['itemSpecifics']): string[] {
  if (!itemSpecifics) {
    return [];
  }

  for (const key of MANUFACTURER_ITEM_SPECIFIC_KEYS) {
    const rawValue = itemSpecifics[key];
    const values = Array.isArray(rawValue) ? rawValue : typeof rawValue === 'string' ? [rawValue] : [];

    for (const value of values) {
      const tokens = tokenizeBaseBrand(value);
      if (tokens.length > 0) {
        return tokens;
      }
    }
  }

  for (const key of SET_ITEM_SPECIFIC_KEYS) {
    const rawValue = itemSpecifics[key];
    const values = Array.isArray(rawValue) ? rawValue : typeof rawValue === 'string' ? [rawValue] : [];

    for (const value of values) {
      const tokens = deriveBaseBrandFromSet(value);
      if (tokens.length > 0) {
        return tokens;
      }
    }
  }

  return [];
}

function getFirstSpecificValue(
  itemSpecifics: PricingProviderInput['itemSpecifics'],
  keys: readonly string[],
  normalize: (value: string) => string | null
): string | null {
  if (!itemSpecifics) {
    return null;
  }

  for (const key of keys) {
    const rawValue = itemSpecifics[key];
    const values = Array.isArray(rawValue) ? rawValue : typeof rawValue === 'string' ? [rawValue] : [];

    for (const value of values) {
      const normalized = normalize(value);
      if (normalized) {
        return normalized;
      }
    }
  }

  return null;
}

function normalizePhrase(value: string): string | null {
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized.length > 0 ? normalized : null;
}

function normalizeYear(value: string): string | null {
  const trimmed = value.trim();
  const match = trimmed.match(/^(19\d{2}|20\d{2})$/);
  return match?.[1] ?? extractSeasonStartYear(trimmed) ?? null;
}

function normalizeCardNumber(value: string): string | null {
  const normalized = value.trim().replace(/^#\s*/, '');
  return /^[A-Za-z]{0,4}\d{1,4}[A-Za-z]{0,4}$/.test(normalized) ? normalized.toUpperCase() : null;
}

function getPlayerTokenGroups(itemSpecifics: PricingProviderInput['itemSpecifics']): string[][] {
  if (!itemSpecifics) {
    return [];
  }

  const groups: string[][] = [];

  for (const key of PLAYER_ITEM_SPECIFIC_KEYS) {
    const rawValue = itemSpecifics[key];
    const values = Array.isArray(rawValue) ? rawValue : typeof rawValue === 'string' ? [rawValue] : [];

    for (const value of values) {
      const normalized = normalizePhrase(value);
      if (!normalized) {
        continue;
      }

      for (const segment of normalized.split(PLAYER_NAME_DELIMITER_PATTERN)) {
        const tokens = tokenizeTitle(segment);
        if (tokens.length > 0) {
          groups.push(tokens);
        }
      }
    }
  }

  return groups;
}

function tokenizeBaseBrand(value: string): string[] {
  const normalized = normalizePhrase(value);
  if (!normalized) {
    return [];
  }

  return tokenizeTitle(normalized).filter((token) => !SET_NOISE_TOKENS.has(token) && !/^\d+$/.test(token));
}

function deriveBaseBrandFromSet(value: string): string[] {
  const tokens = tokenizeBaseBrand(value);
  if (tokens.length <= 1) {
    return tokens;
  }

  const firstPair = `${tokens[0]} ${tokens[1]}`;
  if (MULTI_WORD_BASE_BRAND_PAIRS.has(firstPair)) {
    return tokens.slice(0, 2);
  }

  return tokens.slice(0, 1);
}

function hasConflictingYear(title: string, targetYear: string): boolean {
  const years = getTitleYearCandidates(title);
  return years.some((year) => year !== targetYear);
}

function getTitleYearCandidates(title: string): string[] {
  return stripExplicitCardNumberSpans(title).match(YEAR_PATTERN) ?? [];
}

function extractExplicitCardNumber(title: string): string | null {
  for (const pattern of TITLE_CARD_NUMBER_PATTERNS) {
    pattern.lastIndex = 0;
    const match = pattern.exec(title);
    const normalized = normalizeCardNumber(match?.[1] ?? '');
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function extractTitleCardNumber(title: string, target: ExactCardTitleTarget): string | null {
  const explicitCardNumber = extractExplicitCardNumber(title);
  if (explicitCardNumber) {
    return explicitCardNumber;
  }

  const yearCandidates = new Set(getTitleYearCandidates(title));
  const cardNumberCandidates = tokenizeTitle(title)
    .map((token) => normalizeCardNumber(token))
    .filter((token): token is string => token !== null)
    .filter((token) => !yearCandidates.has(token));

  if (target.cardNumber && cardNumberCandidates.includes(target.cardNumber)) {
    return target.cardNumber;
  }

  return cardNumberCandidates[0] ?? null;
}

function stripExplicitCardNumberSpans(title: string): string {
  let stripped = title;

  for (const pattern of TITLE_CARD_NUMBER_PATTERNS) {
    pattern.lastIndex = 0;
    stripped = stripped.replace(pattern, ' ');
  }

  return stripped.replace(/\s+/g, ' ').trim();
}

function containsWholePhraseTokens(tokens: string[], phraseTokens: string[]): boolean {
  return findPhraseIndexes(tokens, phraseTokens).length > 0;
}

function matchesPlayerTokens(
  titleTokens: string[],
  playerPhrase: string,
  playerTokenGroups: string[][]
): boolean {
  if (playerTokenGroups.length <= 1) {
    return containsWholePhraseTokens(titleTokens, tokenizeTitle(playerPhrase));
  }

  const titleTokenCounts = countTokens(titleTokens);

  for (const [token, count] of countTokens(playerTokenGroups.flat()) ) {
    if ((titleTokenCounts.get(token) ?? 0) < count) {
      return false;
    }
  }

  return true;
}

function countTokens(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();

  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  return counts;
}

function findPhraseIndexes(tokens: string[], phraseTokens: string[]): number[] {
  if (phraseTokens.length === 0 || tokens.length < phraseTokens.length) {
    return [];
  }

  const indexes: number[] = [];

  for (let index = 0; index <= tokens.length - phraseTokens.length; index += 1) {
    const matches = phraseTokens.every((token, offset) => tokens[index + offset] === token);
    if (matches) {
      indexes.push(index);
    }
  }

  return indexes;
}

function tokenizeTitle(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}
