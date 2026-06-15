import type { ListingRow } from '@ebay-inventory/data';

import type { PricingProviderInput } from './types.js';

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function getListingItemSpecifics(
  value: ListingRow['item_specifics']
): PricingProviderInput['itemSpecifics'] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const itemSpecifics = Object.fromEntries(
    Object.entries(value).flatMap(([key, entryValue]) => {
      if (
        entryValue === null ||
        typeof entryValue === 'string' ||
        (Array.isArray(entryValue) && entryValue.every((candidate) => typeof candidate === 'string'))
      ) {
        return [[key, entryValue]];
      }

      return [];
    })
  );

  return Object.keys(itemSpecifics).length > 0 ? itemSpecifics : undefined;
}

export function buildPricingTitleFromItemSpecifics(
  itemSpecifics: PricingProviderInput['itemSpecifics']
): string | undefined {
  if (!itemSpecifics) {
    return undefined;
  }

  const titleParts = [
    itemSpecifics.Player,
    itemSpecifics.Year,
    itemSpecifics.Manufacturer,
    itemSpecifics.Set,
    itemSpecifics['Card Number'],
  ]
    .flatMap((value) => (Array.isArray(value) ? value : value ? [value] : []))
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return titleParts.length > 0 ? titleParts.join(' ') : undefined;
}

export function buildPricingProviderInput(
  listing: ListingRow,
  listingId: string,
  requestedCompCount?: number
): PricingProviderInput {
  const itemSpecifics = getListingItemSpecifics(listing.item_specifics);
  const title =
    asNonEmptyString(listing.title) ?? buildPricingTitleFromItemSpecifics(itemSpecifics) ?? listingId;

  return {
    categoryId: listing.category_id,
    conditionId: listing.condition_id,
    itemSpecifics,
    listingId,
    listingType: listing.listing_type,
    ...(requestedCompCount === undefined ? {} : { requestedCompCount }),
    title,
  };
}
