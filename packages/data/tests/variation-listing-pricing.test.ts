import { describe, expect, it } from 'vitest';

import {
  VARIATION_LISTING_MANUAL_PRICE_AMOUNTS,
  isVariationListingManualPriceAmount,
} from '../src/index.js';

describe('variation listing manual price contract', () => {
  it('exposes the exact current manual price tiers from one canonical application constant', () => {
    expect(VARIATION_LISTING_MANUAL_PRICE_AMOUNTS).toEqual([0.99, 1.49, 1.99, 2.49]);
  });

  it.each([0.99, 1.49, 1.99, 2.49])('accepts supported tier %s', (price) => {
    expect(isVariationListingManualPriceAmount(price)).toBe(true);
  });

  it.each([0, 1, 1.29, 2.99, NaN, Infinity, '1.49', null])(
    'rejects unsupported value %s',
    (price) => {
      expect(isVariationListingManualPriceAmount(price)).toBe(false);
    }
  );
});
