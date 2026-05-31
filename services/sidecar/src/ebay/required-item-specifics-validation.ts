import type { Json, ListingRow } from '@ebay-inventory/data';
import type { TaxonomyApi } from '@/api/listing-metadata/taxonomy.js';
import { PublishListingValidationError } from '@/ebay/publish-validation.js';
import { createLogger } from '@/utils/logger.js';

type PublishTaxonomyApi = Pick<TaxonomyApi, 'getDefaultCategoryTreeId' | 'getItemAspectsForCategory'>;

const INTERNAL_ITEM_SPECIFIC_KEYS = new Set(['CategorySuggestion', 'ConditionSuggestion']);
const requiredItemSpecificsLogger = createLogger('RequiredItemSpecificsValidation');

function hasText(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getListingLabel(listing: Pick<ListingRow, 'listing_id'>): string {
  return hasText(listing.listing_id) ? listing.listing_id.trim() : '[missing listing_id]';
}

function getCategoryTreeId(response: unknown): string | null {
  if (!isRecord(response) || !hasText(response.categoryTreeId as string | undefined)) {
    return null;
  }

  return (response.categoryTreeId as string).trim();
}

function isRequiredAspect(aspect: Record<string, unknown>): boolean {
  if (aspect.aspectRequired === true) {
    return true;
  }

  const constraint = isRecord(aspect.aspectConstraint) ? aspect.aspectConstraint : null;
  if (constraint?.aspectRequired === true) {
    return true;
  }

  const usage = [aspect.aspectUsage, constraint?.aspectUsage, constraint?.aspectMode]
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim().toUpperCase());

  return usage.includes('REQUIRED');
}

export function getRequiredAspectNamesFromMetadata(response: unknown): string[] {
  if (!isRecord(response) || !Array.isArray(response.aspects)) {
    return [];
  }

  return response.aspects
    .filter((aspect): aspect is Record<string, unknown> => isRecord(aspect))
    .filter((aspect) => isRequiredAspect(aspect))
    .map((aspect) =>
      typeof aspect.localizedAspectName === 'string' ? aspect.localizedAspectName.trim() : ''
    )
    .filter((name) => name.length > 0);
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

export function hasRequiredAspectValue(
  itemSpecifics: ListingRow['item_specifics'],
  aspectName: string
): boolean {
  const normalizedAspectName = aspectName.trim();

  if (!normalizedAspectName || INTERNAL_ITEM_SPECIFIC_KEYS.has(normalizedAspectName)) {
    return false;
  }

  if (!isRecord(itemSpecifics)) {
    return false;
  }

  for (const [key, value] of Object.entries(itemSpecifics)) {
    if (key.trim() !== normalizedAspectName || INTERNAL_ITEM_SPECIFIC_KEYS.has(key.trim())) {
      continue;
    }

    return hasMeaningfulAspectValue(value as Json);
  }

  return false;
}

export async function validateRequiredItemSpecificsForCategory({
  listing,
  marketplaceId,
  taxonomyApi,
}: {
  listing: ListingRow;
  marketplaceId: string;
  taxonomyApi: PublishTaxonomyApi;
}): Promise<void> {
  const categoryId = listing.category_id?.trim();

  if (!hasText(marketplaceId) || !categoryId) {
    return;
  }

  const categoryTreeResponse = await taxonomyApi.getDefaultCategoryTreeId(marketplaceId.trim());
  const categoryTreeId = getCategoryTreeId(categoryTreeResponse);

  if (!categoryTreeId) {
    throw new Error(
      `Default category tree ID was missing for marketplace "${marketplaceId.trim()}".`
    );
  }

  const aspectsResponse = await taxonomyApi.getItemAspectsForCategory(categoryTreeId, categoryId);
  const requiredAspectNames = getRequiredAspectNamesFromMetadata(aspectsResponse);
  const missingAspectNames = requiredAspectNames.filter(
    (aspectName) => !hasRequiredAspectValue(listing.item_specifics, aspectName)
  );

  if (missingAspectNames.length === 0) {
    return;
  }

  requiredItemSpecificsLogger.warn('Listing missing required eBay item specifics.', {
    category_id: categoryId,
    listing_id: listing.listing_id,
    missing_aspects: missingAspectNames,
    required_aspects: requiredAspectNames,
  });

  const listingLabel = getListingLabel(listing);
  const issue =
    missingAspectNames.length === 1
      ? `Listing "${listingLabel}" is missing required eBay item specific "${missingAspectNames[0]}" for category "${categoryId}".`
      : `Listing "${listingLabel}" is missing required eBay item specifics for category "${categoryId}": ${missingAspectNames.join(', ')}.`;

  throw new PublishListingValidationError(listing.listing_id, [issue]);
}
