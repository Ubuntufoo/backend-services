import type { Json, ListingRow } from '@ebay-inventory/data';
import {
  PublishRequiredItemSpecificsValidationError,
  type PublishRequiredItemSpecificIssue,
} from '@/ebay/publish-validation.js';
import { createLogger } from '@/utils/logger.js';

const INTERNAL_ITEM_SPECIFIC_KEYS = new Set([
  'CategorySuggestion',
  'ConditionSuggestion',
  'pricingModifierOptions',
  'skuCategoryCode',
]);
const requiredItemSpecificsLogger = createLogger('RequiredItemSpecificsValidation');
const LOT_PLAYER_RULE_BY_CATEGORY_ID: Record<string, string[]> = {
  '183050': ['Player/Athlete', 'Player', 'Athlete'],
};
const LOT_ITEM_SPECIFIC_DEFAULT_VALUE = 'Various';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeAspectKey(value: string): string {
  return value.trim().toLowerCase();
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

export function getCategoryTreeIdFromTaxonomyResponse(response: unknown): string {
  if (
    !isRecord(response) ||
    typeof response.categoryTreeId !== 'string' ||
    !response.categoryTreeId.trim()
  ) {
    throw new Error('Taxonomy default category tree response is missing categoryTreeId.');
  }

  return response.categoryTreeId.trim();
}

export function getRequiredAspectNamesFromTaxonomyResponse(response: unknown): string[] {
  if (!isRecord(response) || !Array.isArray(response.aspects)) {
    throw new Error('Taxonomy item aspects response is missing aspects.');
  }

  const requiredAspectNames: string[] = [];
  const seenNames = new Set<string>();

  for (const aspect of response.aspects) {
    if (
      !isRecord(aspect) ||
      typeof aspect.localizedAspectName !== 'string' ||
      !aspect.localizedAspectName.trim()
    ) {
      throw new Error('Taxonomy item aspects response contains an invalid aspect name.');
    }

    if (!isRecord(aspect.aspectConstraint)) {
      throw new Error(
        `Taxonomy item aspects response is missing constraints for "${aspect.localizedAspectName.trim()}".`
      );
    }

    const aspectRequired = aspect.aspectConstraint.aspectRequired;
    if (aspectRequired !== undefined && typeof aspectRequired !== 'boolean') {
      throw new Error(
        `Taxonomy item aspects response has invalid aspectRequired for "${aspect.localizedAspectName.trim()}".`
      );
    }

    if (aspectRequired !== true) {
      continue;
    }

    const aspectName = aspect.localizedAspectName.trim();
    const normalizedName = normalizeAspectKey(aspectName);
    if (!seenNames.has(normalizedName)) {
      requiredAspectNames.push(aspectName);
      seenNames.add(normalizedName);
    }
  }

  return requiredAspectNames;
}

export function hasRequiredAspectValue(
  itemSpecifics: ListingRow['item_specifics'],
  aspectName: string
): boolean {
  if (!isRecord(itemSpecifics)) {
    return false;
  }

  const normalizedAspectName = normalizeAspectKey(aspectName);
  if (!normalizedAspectName || INTERNAL_ITEM_SPECIFIC_KEYS.has(aspectName.trim())) {
    return false;
  }

  for (const [key, value] of Object.entries(itemSpecifics)) {
    if (
      INTERNAL_ITEM_SPECIFIC_KEYS.has(key.trim()) ||
      normalizeAspectKey(key) !== normalizedAspectName
    ) {
      continue;
    }

    return hasMeaningfulAspectValue(value as Json);
  }

  return false;
}

function hasRequiredAspectValueForKeys(
  itemSpecifics: ListingRow['item_specifics'],
  acceptedKeys: readonly string[]
): boolean {
  return acceptedKeys.some((key) => hasRequiredAspectValue(itemSpecifics, key));
}

export function getEffectiveItemSpecificsForCategoryValidation(
  listing: Pick<ListingRow, 'capture_mode' | 'category_id' | 'item_specifics'>
): ListingRow['item_specifics'] {
  const categoryId = listing.category_id?.trim();
  const playerKeys = categoryId ? LOT_PLAYER_RULE_BY_CATEGORY_ID[categoryId] : undefined;

  if (listing.capture_mode !== 'lot_3_image' || !playerKeys) {
    return listing.item_specifics;
  }

  if (hasRequiredAspectValueForKeys(listing.item_specifics, playerKeys)) {
    return listing.item_specifics;
  }

  const baseItemSpecifics = isRecord(listing.item_specifics) ? listing.item_specifics : {};
  return {
    ...baseItemSpecifics,
    'Player/Athlete': LOT_ITEM_SPECIFIC_DEFAULT_VALUE,
  };
}

function createMissingAspectField(aspectName: string): PublishRequiredItemSpecificIssue {
  return {
    acceptedKeys: [aspectName],
    aspectName,
    field: `item_specifics.${aspectName}`,
    message: `${aspectName} is required for this eBay category before publishing.`,
    scope: 'listing',
  };
}

export function validateRequiredItemSpecificsForCategory({
  listing,
  requiredAspectNames,
  satisfiedAspectNames = [],
}: {
  listing: ListingRow;
  requiredAspectNames: string[];
  satisfiedAspectNames?: string[];
}): void {
  const satisfiedNames = new Set(satisfiedAspectNames.map(normalizeAspectKey));
  const effectiveItemSpecifics = getEffectiveItemSpecificsForCategoryValidation(listing);
  const missingFields = requiredAspectNames
    .filter((aspectName) => {
      const normalizedName = normalizeAspectKey(aspectName);
      return (
        !satisfiedNames.has(normalizedName) &&
        !hasRequiredAspectValue(effectiveItemSpecifics, aspectName)
      );
    })
    .map((aspectName) => createMissingAspectField(aspectName));

  if (missingFields.length === 0) {
    return;
  }

  requiredItemSpecificsLogger.warn('Listing missing required eBay item specifics.', {
    category_id: listing.category_id,
    listing_id: listing.listing_id,
    missing_aspects: missingFields.map((field) => field.aspectName),
    required_aspects: requiredAspectNames,
  });

  throw new PublishRequiredItemSpecificsValidationError(listing.listing_id, missingFields);
}
