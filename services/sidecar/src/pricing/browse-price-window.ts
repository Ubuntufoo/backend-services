import type { BrowsePricingOptions } from './browse-pricing-options.js';

export function deriveBrowseItemPriceWindow(
  basePrice: number,
  options: BrowsePricingOptions
) {
  if (!Number.isFinite(basePrice) || basePrice <= 0) {
    throw new RangeError('Browse price window requires a positive finite base price.');
  }

  const scaledMinimum = normalizeCentBoundary(
    basePrice * options.minPriceMultiplier * 100
  );
  const scaledMaximum = normalizeCentBoundary(
    basePrice * options.maxPriceMultiplier * 100
  );

  return {
    minItemPrice: Math.floor(scaledMinimum) / 100,
    maxItemPrice: Math.ceil(scaledMaximum) / 100,
  };
}

function normalizeCentBoundary(value: number): number {
  const nearestInteger = Math.round(value);
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(value)) * 8;
  return Math.abs(value - nearestInteger) <= tolerance ? nearestInteger : value;
}
