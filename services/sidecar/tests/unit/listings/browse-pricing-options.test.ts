import { describe, expect, it } from 'vitest';
import {
  BROWSE_PRICING_OPTIONS_ITEM_SPECIFIC_KEY,
  mergeBrowsePricingOptions,
  readBrowsePricingOptions,
} from '@/listings/browse-pricing-options.js';

describe('browse pricing option item specifics', () => {
  it('reads canonical defaults when the value is absent', () => {
    expect(readBrowsePricingOptions({ Brand: 'Acme' })).toEqual({
      skipBrowse: false,
      minPriceMultiplier: 0.33,
      maxPriceMultiplier: 3,
    });
  });

  it('round-trips partial updates while preserving unrelated specifics', () => {
    const itemSpecifics = {
      Brand: 'Acme',
      pricingModifierOptions: { excludeGraded: true },
      [BROWSE_PRICING_OPTIONS_ITEM_SPECIFIC_KEY]: {
        skipBrowse: false,
        minPriceMultiplier: 0.5,
        maxPriceMultiplier: 2,
      },
    };

    const merged = mergeBrowsePricingOptions(itemSpecifics, { maxPriceMultiplier: 4 });

    expect(merged).toEqual({
      Brand: 'Acme',
      pricingModifierOptions: { excludeGraded: true },
      [BROWSE_PRICING_OPTIONS_ITEM_SPECIFIC_KEY]: {
        skipBrowse: false,
        minPriceMultiplier: 0.5,
        maxPriceMultiplier: 4,
      },
    });
    expect(readBrowsePricingOptions(merged)).toEqual({
      skipBrowse: false,
      minPriceMultiplier: 0.5,
      maxPriceMultiplier: 4,
    });
  });

  it('rejects invalid merged ranges through the canonical normalizer', () => {
    expect(() =>
      mergeBrowsePricingOptions(
        {
          [BROWSE_PRICING_OPTIONS_ITEM_SPECIFIC_KEY]: {
            skipBrowse: false,
            minPriceMultiplier: 1,
            maxPriceMultiplier: 2,
          },
        },
        { minPriceMultiplier: 3 }
      )
    ).toThrow('minPriceMultiplier must be less than maxPriceMultiplier.');
  });
});
