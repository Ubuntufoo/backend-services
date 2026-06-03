import type { Json, ListingRow } from '@ebay-inventory/data';

export const TRADING_CARD_CONDITION_ASPECT_KEY = 'Card Condition';
export const RAW_TRADING_CARD_CONDITION_ID = '4000';
export const GRADED_TRADING_CARD_CONDITION_ID = '2750';

export const RAW_CARD_CONDITION_TOKENS = [
  'NEAR_MINT_OR_BETTER',
  'EXCELLENT',
  'VERY_GOOD',
  'POOR',
] as const;

export type RawCardConditionToken = (typeof RAW_CARD_CONDITION_TOKENS)[number];
export const LEGACY_RAW_CARD_CONDITION_TOKENS = [
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

export type LegacyRawCardConditionToken = (typeof LEGACY_RAW_CARD_CONDITION_TOKENS)[number];

const RAW_CARD_CONDITION_DISPLAY_LABELS: Record<RawCardConditionToken, string> = {
  NEAR_MINT_OR_BETTER: 'Near mint or better',
  EXCELLENT: 'Excellent',
  VERY_GOOD: 'Very good',
  POOR: 'Poor',
};

const LEGACY_RAW_CARD_CONDITION_TOKEN_NORMALIZATION: Record<
  LegacyRawCardConditionToken,
  RawCardConditionToken
> = {
  MT: 'NEAR_MINT_OR_BETTER',
  MINT: 'NEAR_MINT_OR_BETTER',
  'NM-MT': 'NEAR_MINT_OR_BETTER',
  NM: 'NEAR_MINT_OR_BETTER',
  'EX-MT': 'EXCELLENT',
  EX: 'EXCELLENT',
  'VG-EX': 'VERY_GOOD',
  VG: 'VERY_GOOD',
  GOOD: 'VERY_GOOD',
  FR: 'POOR',
  PR: 'POOR',
};

const RAW_CARD_CONDITION_DESCRIPTOR_VALUE_IDS: Record<RawCardConditionToken, string> = {
  NEAR_MINT_OR_BETTER: '400010',
  EXCELLENT: '400011',
  VERY_GOOD: '400012',
  POOR: '400013',
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

export function isLegacyRawCardConditionToken(value: unknown): value is LegacyRawCardConditionToken {
  return (
    typeof value === 'string' &&
    (LEGACY_RAW_CARD_CONDITION_TOKENS as readonly string[]).includes(value.trim())
  );
}

export function normalizeRawCardConditionToken(value: unknown): RawCardConditionToken | null {
  if (isRawCardConditionToken(value)) {
    return value.trim() as RawCardConditionToken;
  }

  if (isLegacyRawCardConditionToken(value)) {
    return LEGACY_RAW_CARD_CONDITION_TOKEN_NORMALIZATION[value.trim() as LegacyRawCardConditionToken];
  }

  return null;
}

export function getRawCardConditionDisplayLabel(token: RawCardConditionToken): string {
  return RAW_CARD_CONDITION_DISPLAY_LABELS[token];
}

export function getRawCardConditionCandidateLabels(token: RawCardConditionToken): string[] {
  return [token, getRawCardConditionDisplayLabel(token)];
}

export function getRawCardConditionDescriptorValueId(token: RawCardConditionToken): string {
  return RAW_CARD_CONDITION_DESCRIPTOR_VALUE_IDS[token];
}

export function getSavedRawCardConditionToken(
  itemSpecifics: ListingRow['item_specifics']
): RawCardConditionToken | null {
  if (!isRecord(itemSpecifics)) {
    return null;
  }

  const value = itemSpecifics[TRADING_CARD_CONDITION_ASPECT_KEY];
  return normalizeRawCardConditionToken(value);
}
