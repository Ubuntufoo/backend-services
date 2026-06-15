import type { NormalizeSoldCompsContext, PricingProviderInput } from './types.js';

const PLAYER_ITEM_SPECIFIC_KEYS = ['Player', 'Player/Athlete', 'Athlete'] as const;
const YEAR_ITEM_SPECIFIC_KEYS = ['Year', 'Season'] as const;
const SET_ITEM_SPECIFIC_KEYS = ['Set'] as const;
const MANUFACTURER_ITEM_SPECIFIC_KEYS = ['Manufacturer', 'Card Manufacturer', 'Brand'] as const;
const CARD_NUMBER_ITEM_SPECIFIC_KEYS = ['Card Number'] as const;
const PARALLEL_ITEM_SPECIFIC_KEYS = ['Parallel/Variety', 'Insert Set'] as const;
const TITLE_CARD_NUMBER_PATTERNS = [
  /\bCard\s*#\s*([A-Za-z]{0,4}\d{1,4}[A-Za-z]{0,4})\b/gi,
  /\bCard\s*No\.?\s*#?\s*([A-Za-z]{0,4}\d{1,4}[A-Za-z]{0,4})\b/gi,
  /\bCard\s*Number\s*#?\s*([A-Za-z]{0,4}\d{1,4}[A-Za-z]{0,4})\b/gi,
  /(?:^|[\s(])#\s*([A-Za-z]{0,4}\d{1,4}[A-Za-z]{0,4})(?=$|[\s),.-])/gi,
] as const;
const YEAR_PATTERN = /\b(19\d{2}|20\d{2})\b/g;
const SET_NOISE_TOKENS = new Set([
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

export interface ExactCardTitleTarget {
  cardNumber: string | null;
  parallelPhrases: string[];
  playerPhrase: string | null;
  setPhrase: string | null;
  year: string | null;
}

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
    cardNumber:
      getFirstSpecificValue(itemSpecifics, CARD_NUMBER_ITEM_SPECIFIC_KEYS, normalizeCardNumber) ??
      extractExplicitCardNumber(fallbackTitle),
    parallelPhrases: getSpecificValues(itemSpecifics, PARALLEL_ITEM_SPECIFIC_KEYS, normalizePhrase),
    playerPhrase: getFirstSpecificValue(itemSpecifics, PLAYER_ITEM_SPECIFIC_KEYS, normalizePhrase),
    setPhrase:
      getFirstSpecificValue(itemSpecifics, SET_ITEM_SPECIFIC_KEYS, normalizePhrase) ??
      getFirstSpecificValue(itemSpecifics, MANUFACTURER_ITEM_SPECIFIC_KEYS, normalizePhrase),
    year:
      getFirstSpecificValue(itemSpecifics, YEAR_ITEM_SPECIFIC_KEYS, normalizeYear) ??
      extractFirstYear(fallbackTitle),
  };
}

export function getExactCardTitleMismatchReason(
  title: string,
  target: ExactCardTitleTarget
): string | null {
  const tokens = tokenizeTitle(title);

  if (target.playerPhrase && !containsWholePhraseTokens(tokens, tokenizeTitle(target.playerPhrase))) {
    return EXACT_CARD_REJECTION_REASONS.playerMismatch;
  }

  if (target.setPhrase && !matchesSetIdentity(tokens, target.setPhrase, target.playerPhrase, target.parallelPhrases)) {
    return EXACT_CARD_REJECTION_REASONS.setMismatch;
  }

  if (target.year && hasConflictingYear(title, target.year)) {
    return EXACT_CARD_REJECTION_REASONS.yearMismatch;
  }

  if (target.cardNumber) {
    const extractedCardNumber = extractExplicitCardNumber(title);
    if (extractedCardNumber && extractedCardNumber !== target.cardNumber) {
      return EXACT_CARD_REJECTION_REASONS.cardNumberMismatch;
    }
  }

  return null;
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

function getSpecificValues(
  itemSpecifics: PricingProviderInput['itemSpecifics'],
  keys: readonly string[],
  normalize: (value: string) => string | null
): string[] {
  if (!itemSpecifics) {
    return [];
  }

  const values: string[] = [];

  for (const key of keys) {
    const rawValue = itemSpecifics[key];
    const candidates = Array.isArray(rawValue) ? rawValue : typeof rawValue === 'string' ? [rawValue] : [];

    for (const candidate of candidates) {
      const normalized = normalize(candidate);
      if (normalized && !values.includes(normalized)) {
        values.push(normalized);
      }
    }
  }

  return values;
}

function normalizePhrase(value: string): string | null {
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized.length > 0 ? normalized : null;
}

function normalizeYear(value: string): string | null {
  const match = value.trim().match(/^(19\d{2}|20\d{2})$/);
  return match?.[1] ?? null;
}

function normalizeCardNumber(value: string): string | null {
  const normalized = value.trim().replace(/^#\s*/, '');
  return /^[A-Za-z]{0,4}\d{1,4}[A-Za-z]{0,4}$/.test(normalized) ? normalized.toUpperCase() : null;
}

function extractFirstYear(title: string): string | null {
  const matches = getTitleYearCandidates(title);
  return matches?.[0] ?? null;
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

function stripExplicitCardNumberSpans(title: string): string {
  let stripped = title;

  for (const pattern of TITLE_CARD_NUMBER_PATTERNS) {
    pattern.lastIndex = 0;
    stripped = stripped.replace(pattern, ' ');
  }

  return stripped.replace(/\s+/g, ' ').trim();
}

function matchesSetIdentity(
  tokens: string[],
  setPhrase: string,
  playerPhrase: string | null,
  parallelPhrases: string[]
): boolean {
  const targetTokens = compactSetTokens(tokenizeTitle(setPhrase));
  const playerTokens = playerPhrase ? tokenizeTitle(playerPhrase) : [];
  const parallelTokenGroups = parallelPhrases.map((phrase) => compactSetTokens(tokenizeTitle(phrase))).filter((tokens) => tokens.length > 0);
  if (targetTokens.length === 0) {
    return true;
  }

  const phraseIndexes = findPhraseIndexes(tokens, targetTokens);
  if (phraseIndexes.length === 0) {
    return false;
  }

  return phraseIndexes.some((startIndex) => {
    const nextTokens = tokens.slice(startIndex + targetTokens.length);
    const nextToken = nextTokens[0];

    if (
      parallelTokenGroups.some((parallelTokens) =>
        parallelTokens.every((token, offset) => nextTokens[offset] === token)
      )
    ) {
      return true;
    }

    return (
      !nextToken ||
      SET_NOISE_TOKENS.has(nextToken) ||
      nextToken === playerTokens[0] ||
      /^[a-z]{0,4}\d{1,4}[a-z]{0,4}$/i.test(nextToken)
    );
  });
}

function compactSetTokens(tokens: string[]): string[] {
  return tokens.filter((token) => !SET_NOISE_TOKENS.has(token) && !/^\d+$/.test(token));
}

function containsWholePhraseTokens(tokens: string[], phraseTokens: string[]): boolean {
  return findPhraseIndexes(tokens, phraseTokens).length > 0;
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
