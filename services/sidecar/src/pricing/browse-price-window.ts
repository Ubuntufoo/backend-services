import type { BrowsePricingOptions } from './browse-pricing-options.js';

export function deriveBrowseItemPriceWindow(
  basePrice: number,
  options: BrowsePricingOptions
) {
  if (!Number.isFinite(basePrice) || basePrice <= 0) {
    throw new RangeError('Browse price window requires a positive finite base price.');
  }

  return {
    minItemPrice: Math.floor(basePrice * options.minPriceMultiplier * 100) / 100,
    maxItemPrice: Math.ceil(basePrice * options.maxPriceMultiplier * 100) / 100,
  };
}
