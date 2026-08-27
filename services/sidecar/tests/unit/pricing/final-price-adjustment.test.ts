import { describe, expect, it } from 'vitest';

import { computeFinalPriceAdjustment } from '@/pricing/final-price-adjustment.js';
import type { NormalizedSoldComp } from '@/pricing/types.js';

const CURRENT_TIME = new Date('2026-07-20T00:00:00.000Z');

describe('computeFinalPriceAdjustment', () => {
  it('applies only the competitive discount with at least eight recent accepted comps', () => {
    const result = computeFinalPriceAdjustment({
      basePrice: 117.63,
      comps: Array.from({ length: 8 }, (_, index) =>
        buildComp(`2026-07-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`)
      ),
      currentTime: CURRENT_TIME,
    });

    expect(result).toEqual({
      basePrice: 117.63,
      competitiveDiscountPercent: 5,
      competitiveAdjustedPrice: 111.7485,
      recentWindowDays: 90,
      recentAcceptedCompCount: 8,
      salesVelocityTier: 'high',
      salesVelocityDiscountPercent: 0,
      finalPrice: 111.7,
    });
  });

  it('applies the medium velocity discount after the competitive discount', () => {
    const result = computeFinalPriceAdjustment({
      basePrice: 100,
      comps: [
        buildComp('2026-07-01T00:00:00.000Z'),
        buildComp('2026-06-01T00:00:00.000Z'),
        buildComp('2026-05-01T00:00:00.000Z'),
      ],
      currentTime: CURRENT_TIME,
    });

    expect(result).toMatchObject({
      competitiveAdjustedPrice: 95,
      recentAcceptedCompCount: 3,
      salesVelocityTier: 'medium',
      salesVelocityDiscountPercent: 2.5,
      finalPrice: 92.6,
    });
  });

  it('applies the low velocity discount after the competitive discount', () => {
    const result = computeFinalPriceAdjustment({
      basePrice: 100,
      comps: [buildComp('2026-07-01T00:00:00.000Z')],
      currentTime: CURRENT_TIME,
    });

    expect(result).toMatchObject({
      competitiveAdjustedPrice: 95,
      recentAcceptedCompCount: 1,
      salesVelocityTier: 'low',
      salesVelocityDiscountPercent: 5,
      finalPrice: 90.25,
    });
  });

  it('applies the low velocity discount when accepted comps are all older than 90 days', () => {
    const result = computeFinalPriceAdjustment({
      basePrice: 100,
      comps: [
        buildComp('2026-04-20T23:59:59.999Z'),
        buildComp('2026-01-01T00:00:00.000Z'),
      ],
      currentTime: CURRENT_TIME,
    });

    expect(result).toMatchObject({
      basePrice: 100,
      recentAcceptedCompCount: 0,
      salesVelocityTier: 'low',
      salesVelocityDiscountPercent: 5,
      finalPrice: 90.25,
    });
  });

  it('counts the inclusive 90-day boundary but excludes older, invalid, and future dates', () => {
    const result = computeFinalPriceAdjustment({
      basePrice: 100,
      comps: [
        buildComp('2026-04-21T00:00:00.000Z'),
        buildComp('2026-04-20T23:59:59.999Z'),
        buildComp('not-a-date'),
        buildComp('2026-07-20T00:00:00.001Z'),
      ],
      currentTime: CURRENT_TIME,
    });

    expect(result).toMatchObject({
      recentAcceptedCompCount: 1,
      salesVelocityTier: 'low',
      finalPrice: 90.25,
    });
  });

  it('rejects invalid inputs and a rounded non-positive final price', () => {
    expect(() =>
      computeFinalPriceAdjustment({ basePrice: 0, comps: [], currentTime: CURRENT_TIME })
    ).toThrow('positive finite base price');
    expect(() =>
      computeFinalPriceAdjustment({
        basePrice: 0.001,
        comps: [],
        currentTime: CURRENT_TIME,
      })
    ).toThrow('positive valid price');
    expect(() =>
      computeFinalPriceAdjustment({ basePrice: 100, comps: [], currentTime: new Date('invalid') })
    ).toThrow('valid current time');
  });

  it.each([
    [3.23, 3.2],
    [4.14, 3.95],
    [4.09, 3.95],
    [15.01, 14.95],
    [100.1, 99.95],
    [4.19, 4.15],
  ])('floors post-modifier price %s to inflection price %s', (rawFinalPrice, expected) => {
    const result = computeFinalPriceAdjustment({
      basePrice: rawFinalPrice / 0.95,
      comps: Array.from({ length: 8 }, (_, index) =>
        buildComp(`2026-07-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`)
      ),
      currentTime: CURRENT_TIME,
    });

    expect(result.finalPrice).toBe(expected);
  });
});

function buildComp(soldDate: string): NormalizedSoldComp {
  return {
    condition: null,
    id: soldDate,
    listingUrl: null,
    price: { currency: 'USD', value: 100 },
    shippingPrice: null,
    soldDate,
    source: 'provider',
    title: 'Accepted sold comp',
    totalPrice: { currency: 'USD', value: 100 },
  };
}
