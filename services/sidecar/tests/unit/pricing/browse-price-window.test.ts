import { describe, expect, it } from 'vitest';

import {
  DEFAULT_BROWSE_PRICING_OPTIONS,
  type BrowsePricingOptions,
} from '@/pricing/browse-pricing-options.js';
import { deriveBrowseItemPriceWindow } from '@/pricing/browse-price-window.js';

describe('deriveBrowseItemPriceWindow', () => {
  it('derives the canonical default window', () => {
    expect(deriveBrowseItemPriceWindow(100, DEFAULT_BROWSE_PRICING_OPTIONS)).toEqual({
      minItemPrice: 33,
      maxItemPrice: 300,
    });
  });

  it('derives a custom multiplier window', () => {
    const options: BrowsePricingOptions = {
      skipBrowse: true,
      minPriceMultiplier: 0.5,
      maxPriceMultiplier: 2,
    };

    expect(deriveBrowseItemPriceWindow(42, options)).toEqual({
      minItemPrice: 21,
      maxItemPrice: 84,
    });
  });

  it('rounds fractional cents outward', () => {
    const options: BrowsePricingOptions = {
      skipBrowse: false,
      minPriceMultiplier: 0.3335,
      maxPriceMultiplier: 1.0001,
    };

    expect(deriveBrowseItemPriceWindow(10, options)).toEqual({
      minItemPrice: 3.33,
      maxItemPrice: 10.01,
    });
  });

  it('keeps exact-cent boundaries unchanged', () => {
    const options: BrowsePricingOptions = {
      skipBrowse: false,
      minPriceMultiplier: 0.5,
      maxPriceMultiplier: 2,
    };

    expect(deriveBrowseItemPriceWindow(100, options)).toEqual({
      minItemPrice: 50,
      maxItemPrice: 200,
    });
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects invalid base price %s',
    (basePrice) => {
      expect(() => deriveBrowseItemPriceWindow(basePrice, DEFAULT_BROWSE_PRICING_OPTIONS)).toThrow(
        'positive finite base price'
      );
    }
  );
});
