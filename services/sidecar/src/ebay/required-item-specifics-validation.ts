import type { Json, ListingRow } from '@ebay-inventory/data';
import {
  PublishRequiredItemSpecificsValidationError,
  type PublishRequiredItemSpecificIssue,
} from '@/ebay/publish-validation.js';
import { TRADING_CARD_CONDITION_ASPECT_KEY } from '@/listings/trading-card-conditions.js';
import { createLogger } from '@/utils/logger.js';

const INTERNAL_ITEM_SPECIFIC_KEYS = new Set(['CategorySuggestion', 'ConditionSuggestion']);
const requiredItemSpecificsLogger = createLogger('RequiredItemSpecificsValidation');
const LOT_ITEM_SPECIFIC_DEFAULT_VALUE = 'Various';
const LOT_MARKER_FIELDS = ['Listing Type', 'Format', 'Type'];
const LOT_MARKER_VALUE = 'lot';
const LOT_TEXT_PATTERNS = [
  /\blot\b/i,
  /\bbundle\b/i,
  /\bassortment\b/i,
  /\bmixed\b/i,
  /\bmulti-card\b/i,
  /\bmulti card\b/i,
];

export interface RequiredItemSpecificRule {
  acceptedKeys: string[];
  aspectName: string;
}

const CATEGORY_REQUIRED_ITEM_SPECIFIC_RULES: Record<string, RequiredItemSpecificRule[]> = {
  '183050': [
    {
      acceptedKeys: [TRADING_CARD_CONDITION_ASPECT_KEY],
      aspectName: TRADING_CARD_CONDITION_ASPECT_KEY,
    },
    {
      acceptedKeys: ['Manufacturer', 'Card Manufacturer'],
      aspectName: 'Manufacturer',
    },
    {
      acceptedKeys: ['Player/Athlete', 'Player', 'Athlete'],
      aspectName: 'Player/Athlete',
    },
  ],
};

const LOT_PLAYER_RULE_BY_CATEGORY_ID: Record<string, RequiredItemSpecificRule> = {
  '183050': {
    acceptedKeys: ['Player/Athlete', 'Player', 'Athlete'],
    aspectName: 'Player/Athlete',
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeAspectKey(value: string): string {
  return value.trim().toLowerCase();
}

function hasLotText(value: string | null | undefined): boolean {
  if (typeof value !== 'string') {
    return false;
  }

  return LOT_TEXT_PATTERNS.some((pattern) => pattern.test(value));
}

function hasMeaningfulAspectValue(value: Json): boolean {
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.some((entry) => typeof entry === 'string' && entry.trim().length > 0);
  }

  return false;
}

function getNormalizedTextAspectValue(
  itemSpecifics: ListingRow['item_specifics'],
  acceptedKeys: readonly string[]
): string | null {
  const normalizedAcceptedKeys = new Set(acceptedKeys.map((key) => normalizeAspectKey(key)));

  if (!isRecord(itemSpecifics)) {
    return null;
  }

  for (const [key, value] of Object.entries(itemSpecifics)) {
    if (!normalizedAcceptedKeys.has(normalizeAspectKey(key))) {
      continue;
    }

    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

export function getRequiredItemSpecificRulesForCategory(
  categoryId: string | null | undefined
): RequiredItemSpecificRule[] {
  const normalizedCategoryId = categoryId?.trim();

  if (!normalizedCategoryId) {
    return [];
  }

  return CATEGORY_REQUIRED_ITEM_SPECIFIC_RULES[normalizedCategoryId] ?? [];
}

export function hasRequiredAspectValue(
  itemSpecifics: ListingRow['item_specifics'],
  aspectName: string
): boolean {
  return hasRequiredAspectValueForKeys(itemSpecifics, [aspectName]);
}

export function hasRequiredAspectValueForKeys(
  itemSpecifics: ListingRow['item_specifics'],
  acceptedKeys: readonly string[]
): boolean {
  const normalizedAcceptedKeys = new Set(
    acceptedKeys
      .map((key) => key.trim())
      .filter((key) => key.length > 0 && !INTERNAL_ITEM_SPECIFIC_KEYS.has(key))
      .map((key) => normalizeAspectKey(key))
  );

  if (normalizedAcceptedKeys.size === 0 || !isRecord(itemSpecifics)) {
    return false;
  }

  for (const [key, value] of Object.entries(itemSpecifics)) {
    const normalizedKey = normalizeAspectKey(key);

    if (INTERNAL_ITEM_SPECIFIC_KEYS.has(key.trim()) || !normalizedAcceptedKeys.has(normalizedKey)) {
      continue;
    }

    return hasMeaningfulAspectValue(value as Json);
  }

  return false;
}

export function isLikelyLotListing(listing: Pick<ListingRow, 'item_specifics' | 'listing_id' | 'seller_hints' | 'title'>): boolean {
  if (listing.listing_id?.startsWith('Lot-')) {
    return true;
  }

  if (hasLotText(listing.title) || hasLotText(listing.seller_hints)) {
    return true;
  }

  const markerValue = getNormalizedTextAspectValue(listing.item_specifics, LOT_MARKER_FIELDS);
  return markerValue?.toLowerCase() === LOT_MARKER_VALUE;
}

export function getEffectiveItemSpecificsForCategoryValidation(
  listing: Pick<ListingRow, 'category_id' | 'item_specifics' | 'listing_id' | 'seller_hints' | 'title'>
): ListingRow['item_specifics'] {
  const categoryId = listing.category_id?.trim();
  const lotPlayerRule = categoryId ? LOT_PLAYER_RULE_BY_CATEGORY_ID[categoryId] : undefined;

  if (!lotPlayerRule || !isLikelyLotListing(listing)) {
    return listing.item_specifics;
  }

  if (hasRequiredAspectValueForKeys(listing.item_specifics, lotPlayerRule.acceptedKeys)) {
    return listing.item_specifics;
  }

  const baseItemSpecifics =
    listing.item_specifics && isRecord(listing.item_specifics) ? listing.item_specifics : {};

  return {
    ...baseItemSpecifics,
    [lotPlayerRule.aspectName]: LOT_ITEM_SPECIFIC_DEFAULT_VALUE,
  };
}

function createMissingAspectField(rule: RequiredItemSpecificRule): PublishRequiredItemSpecificIssue {
  return {
    acceptedKeys: rule.acceptedKeys,
    aspectName: rule.aspectName,
    field: `item_specifics.${rule.aspectName}`,
    message: `${rule.aspectName} is required for this eBay category before publishing.`,
    scope: 'listing',
  };
}

export function validateRequiredItemSpecificsForCategory({
  listing,
}: {
  listing: ListingRow;
}): void {
  const categoryId = listing.category_id?.trim();
  const requiredRules = getRequiredItemSpecificRulesForCategory(categoryId);

  if (!categoryId || requiredRules.length === 0) {
    return;
  }

  const effectiveItemSpecifics = getEffectiveItemSpecificsForCategoryValidation(listing);
  const missingFields = requiredRules
    .filter((rule) => !hasRequiredAspectValueForKeys(effectiveItemSpecifics, rule.acceptedKeys))
    .map((rule) => createMissingAspectField(rule));

  if (missingFields.length === 0) {
    return;
  }

  requiredItemSpecificsLogger.warn('Listing missing required eBay item specifics.', {
    category_id: categoryId,
    listing_id: listing.listing_id,
    missing_aspects: missingFields.map((field) => field.aspectName),
    required_aspects: requiredRules.map((rule) => rule.aspectName),
  });

  throw new PublishRequiredItemSpecificsValidationError(listing.listing_id, missingFields);
}

export function getCoveredCategoryIds(): string[] {
  return Object.keys(CATEGORY_REQUIRED_ITEM_SPECIFIC_RULES);
}
