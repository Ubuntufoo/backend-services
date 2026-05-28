import type { Json, ListingRow } from '@ebay-inventory/data';

export const TRADING_CARD_CONDITION_ASPECT_KEY = 'Card Condition';
export const RAW_TRADING_CARD_CONDITION_ID = '4000';
export const GRADED_TRADING_CARD_CONDITION_ID = '2750';

export const RAW_CARD_CONDITION_TOKENS = [
  'MT',
  'MINT',
  'NM-MT',
  'NM',
  'EX-MT',
  'EX',
  'VG-EX',
  'VG',
  'GOOD',
  'FR',
  'PR',
] as const;

export type RawCardConditionToken = (typeof RAW_CARD_CONDITION_TOKENS)[number];

const RAW_CARD_CONDITION_DISPLAY_LABELS: Record<RawCardConditionToken, string> = {
  MT: 'Gem Mint',
  MINT: 'Mint',
  'NM-MT': 'Near Mint-Mint',
  NM: 'Near Mint',
  'EX-MT': 'Excellent-Mint',
  EX: 'Excellent',
  'VG-EX': 'Very Good-Excellent',
  VG: 'Very Good',
  GOOD: 'Good',
  FR: 'Fair',
  PR: 'Poor',
};

const RAW_CARD_CONDITION_METADATA_ALIASES: Record<RawCardConditionToken, string[]> = {
  MT: ['Gem Mint'],
  MINT: ['Mint'],
  'NM-MT': ['Near Mint-Mint', 'Near Mint or Better'],
  NM: ['Near Mint'],
  'EX-MT': ['Excellent-Mint'],
  EX: ['Excellent'],
  'VG-EX': ['Very Good-Excellent'],
  VG: ['Very Good'],
  GOOD: ['Good'],
  FR: ['Fair'],
  PR: ['Poor'],
};

export const TRADING_CARD_CATEGORY_IDS = new Set(['183050', '183454', '261328']);

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function isRecord(value: Json | null | undefined): value is Record<string, Json> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isTradingCardCategoryId(categoryId: string | null | undefined): boolean {
  const normalizedCategoryId = normalizeText(categoryId);
  return normalizedCategoryId.length > 0 && TRADING_CARD_CATEGORY_IDS.has(normalizedCategoryId);
}

export function isRawCardConditionToken(value: unknown): value is RawCardConditionToken {
  return (
    typeof value === 'string' &&
    (RAW_CARD_CONDITION_TOKENS as readonly string[]).includes(value.trim())
  );
}

export function getRawCardConditionDisplayLabel(token: RawCardConditionToken): string {
  return RAW_CARD_CONDITION_DISPLAY_LABELS[token];
}

export function getRawCardConditionCandidateLabels(token: RawCardConditionToken): string[] {
  return [token, getRawCardConditionDisplayLabel(token), ...RAW_CARD_CONDITION_METADATA_ALIASES[token]];
}

export function getSavedRawCardConditionToken(
  itemSpecifics: ListingRow['item_specifics']
): RawCardConditionToken | null {
  if (!isRecord(itemSpecifics)) {
    return null;
  }

  const value = itemSpecifics[TRADING_CARD_CONDITION_ASPECT_KEY];
  return isRawCardConditionToken(value) ? value : null;
}
