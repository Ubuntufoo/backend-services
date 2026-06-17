import type { Json, ListingRow } from '@ebay-inventory/data';
import {
  DEFAULT_PRICING_MODIFIER_OPTIONS,
  type PricingModifierOptions,
} from '@ebay-inventory/types';

export const PRICING_MODIFIER_OPTIONS_ITEM_SPECIFIC_KEY = 'pricingModifierOptions';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

export function readPricingModifierOptions(
  itemSpecifics: ListingRow['item_specifics']
): PricingModifierOptions {
  const stored = isRecord(itemSpecifics)
    ? itemSpecifics[PRICING_MODIFIER_OPTIONS_ITEM_SPECIFIC_KEY]
    : undefined;

  if (!isRecord(stored)) {
    return { ...DEFAULT_PRICING_MODIFIER_OPTIONS };
  }

  return {
    excludeAutographs:
      asBoolean(stored.excludeAutographs) ?? DEFAULT_PRICING_MODIFIER_OPTIONS.excludeAutographs,
    excludeGraded:
      asBoolean(stored.excludeGraded) ?? DEFAULT_PRICING_MODIFIER_OPTIONS.excludeGraded,
    excludeVariants:
      asBoolean(stored.excludeVariants) ?? DEFAULT_PRICING_MODIFIER_OPTIONS.excludeVariants,
  };
}

export function mergePricingModifierOptions(
  itemSpecifics: ListingRow['item_specifics'],
  options: Partial<PricingModifierOptions>
): Json {
  const base = isRecord(itemSpecifics) ? { ...itemSpecifics } : {};
  const current = readPricingModifierOptions(itemSpecifics);

  base[PRICING_MODIFIER_OPTIONS_ITEM_SPECIFIC_KEY] = {
    ...current,
    ...Object.fromEntries(
      Object.entries(options).filter(([, value]) => typeof value === 'boolean')
    ),
  };

  return base as Json;
}
