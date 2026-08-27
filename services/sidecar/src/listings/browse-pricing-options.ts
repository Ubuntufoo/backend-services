import type { Json, ListingRow } from '@ebay-inventory/data';

import {
  DEFAULT_BROWSE_PRICING_OPTIONS,
  normalizeBrowsePricingOptions,
  type BrowsePricingOptions,
} from '@/pricing/browse-pricing-options.js';

export const BROWSE_PRICING_OPTIONS_ITEM_SPECIFIC_KEY = 'browsePricingOptions';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readBrowsePricingOptions(
  itemSpecifics: ListingRow['item_specifics']
): BrowsePricingOptions {
  const stored = isRecord(itemSpecifics)
    ? itemSpecifics[BROWSE_PRICING_OPTIONS_ITEM_SPECIFIC_KEY]
    : undefined;

  return normalizeBrowsePricingOptions(
    isRecord(stored) ? { ...DEFAULT_BROWSE_PRICING_OPTIONS, ...stored } : stored
  );
}

export function mergeBrowsePricingOptions(
  itemSpecifics: ListingRow['item_specifics'],
  options: Partial<BrowsePricingOptions>
): Json {
  const base = isRecord(itemSpecifics) ? { ...itemSpecifics } : {};
  const current = readBrowsePricingOptions(itemSpecifics);

  base[BROWSE_PRICING_OPTIONS_ITEM_SPECIFIC_KEY] = normalizeBrowsePricingOptions({
    ...current,
    ...options,
  }) as unknown as Json;

  return base as Json;
}
