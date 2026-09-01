export const VARIATION_LISTING_MANUAL_PRICE_AMOUNTS = [0.99, 1.49, 1.99, 2.49] as const;

export type VariationListingManualPriceAmount =
  (typeof VARIATION_LISTING_MANUAL_PRICE_AMOUNTS)[number];

const VARIATION_LISTING_MANUAL_PRICE_SET = new Set<number>(
  VARIATION_LISTING_MANUAL_PRICE_AMOUNTS
);

export function isVariationListingManualPriceAmount(
  value: unknown
): value is VariationListingManualPriceAmount {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    VARIATION_LISTING_MANUAL_PRICE_SET.has(value)
  );
}
