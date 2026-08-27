import { describe, expect, it } from 'vitest';

import type { Money } from '@/api/buy/browse.js';
import type { ActiveMarketCompetitor, ActiveMarketSnapshot } from '@/pricing/active-market.js';
import { computeTacticalSellPrice } from '@/pricing/tactical-price.js';

const OWN_FREE_SHIPPING: Money = { value: 0, currency: 'USD' };

const invalidItemPrices: Array<[string, number]> = [
  ['non-finite (NaN)', Number.NaN],
  ['non-finite (Infinity)', Number.POSITIVE_INFINITY],
  ['negative', -1],
];

const fallbackShipping: Array<[string, Money | null]> = [
  ['unknown (null)', null],
  ['nonzero', { value: 4.99, currency: 'USD' }],
  ['malformed (NaN)', { value: Number.NaN, currency: 'USD' }],
  ['non-USD', { value: 0, currency: 'EUR' }],
];

const malformedLandedTotals: Array<[string, Money]> = [
  ['negative', { value: -1, currency: 'USD' }],
  ['non-finite (NaN)', { value: Number.NaN, currency: 'USD' }],
  ['non-USD currency', { value: 10, currency: 'EUR' }],
];

function usd(value: number): Money {
  return { value, currency: 'USD' };
}

function competitor(
  id: string,
  itemValue: number,
  totalPrice: Money | null = null
): ActiveMarketCompetitor {
  return {
    legacyItemId: id,
    title: `Competitor ${id}`,
    condition: null,
    conditionId: null,
    itemPrice: usd(itemValue),
    shippingCost: null,
    shippingType: null,
    totalPrice,
    itemUrl: `https://www.ebay.com/itm/${id}`,
  };
}

function buildSnapshot(
  competitors: ActiveMarketCompetitor[],
  overrides: Partial<ActiveMarketSnapshot> = {}
): ActiveMarketSnapshot {
  const shippingKnown = competitors.filter((entry) => entry.totalPrice !== null);
  return {
    complete: true,
    competitors,
    exactAcceptedCount: competitors.length,
    shippingKnownAcceptedCount: shippingKnown.length,
    itemPriceDistribution: { low: 0, median: 0, high: 0, currency: 'USD' },
    shippingKnownTotalDistribution:
      shippingKnown.length > 0 ? { low: 0, median: 0, high: 0, currency: 'USD' } : null,
    tacticalSellPrice: null,
    ...overrides,
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

describe('computeTacticalSellPrice', () => {
  it('selects nearest-rank Q1, undercuts $0.01, and rounds to a nickel on the item-price basis', () => {
    const competitors = Array.from({ length: 20 }, (_, index) =>
      competitor(`item-${index}`, index + 1)
    );

    expect(computeTacticalSellPrice(buildSnapshot(competitors), null)).toBe(4.95);
  });

  it('applies psychological rounding when the post-undercut value lands in $x.00-$x.10', () => {
    const competitors = Array.from({ length: 20 }, (_, index) => competitor(`item-${index}`, 4.15));

    expect(computeTacticalSellPrice(buildSnapshot(competitors), null)).toBe(3.95);
  });

  it('selects the landed basis when landed evidence qualifies and own shipping is known-free USD', () => {
    const competitors = Array.from({ length: 20 }, (_, index) =>
      competitor(`landed-${index}`, 1, usd(2 + index))
    );

    expect(computeTacticalSellPrice(buildSnapshot(competitors), OWN_FREE_SHIPPING)).toBe(5.95);
  });

  it.each(fallbackShipping)(
    'falls back to the item-price basis for %s own shipping',
    (_label, ownShipping) => {
      const competitors = Array.from({ length: 20 }, (_, index) =>
        competitor(`fallback-${index}`, 3, usd(10))
      );

      expect(computeTacticalSellPrice(buildSnapshot(competitors), ownShipping)).toBe(2.95);
    }
  );

  it('qualifies the landed basis at exactly 75% landed coverage', () => {
    const competitors = Array.from({ length: 40 }, (_, index) =>
      competitor(`boundary-${index}`, 5, index < 30 ? usd(10) : null)
    );

    expect(computeTacticalSellPrice(buildSnapshot(competitors), OWN_FREE_SHIPPING)).toBe(9.95);
  });

  it('falls back to the item-price basis below the 75% landed-coverage threshold', () => {
    const competitors = Array.from({ length: 40 }, (_, index) =>
      competitor(`below-${index}`, 5, index < 29 ? usd(10) : null)
    );

    expect(computeTacticalSellPrice(buildSnapshot(competitors), OWN_FREE_SHIPPING)).toBe(4.95);
  });

  it('returns null for an incomplete snapshot', () => {
    const competitors = Array.from({ length: 20 }, (_, index) =>
      competitor(`incomplete-${index}`, 1)
    );

    expect(
      computeTacticalSellPrice(
        buildSnapshot(competitors, { complete: false, exactAcceptedCount: null }),
        null
      )
    ).toBeNull();
  });

  it('returns null when fewer than 20 competitors are accepted', () => {
    const competitors = Array.from({ length: 19 }, (_, index) => competitor(`thin-${index}`, 1));

    expect(computeTacticalSellPrice(buildSnapshot(competitors), null)).toBeNull();
  });

  it('returns null when exactAcceptedCount disagrees with the competitor count', () => {
    const competitors = Array.from({ length: 20 }, (_, index) =>
      competitor(`mismatch-${index}`, 1)
    );

    expect(
      computeTacticalSellPrice(buildSnapshot(competitors, { exactAcceptedCount: 21 }), null)
    ).toBeNull();
    expect(
      computeTacticalSellPrice(buildSnapshot(competitors, { exactAcceptedCount: null }), null)
    ).toBeNull();
  });

  it.each(invalidItemPrices)('returns null for an invalid %s item price', (_label, value) => {
    const competitors = Array.from({ length: 20 }, (_, index) =>
      competitor(`bad-item-${index}`, index === 7 ? value : 1)
    );

    expect(computeTacticalSellPrice(buildSnapshot(competitors), null)).toBeNull();
  });

  it('returns null for mixed item-price currency', () => {
    const competitors = Array.from({ length: 20 }, (_, index) =>
      index === 3
        ? { ...competitor(`foreign-${index}`, 1), itemPrice: { value: 1, currency: 'EUR' } }
        : competitor(`usd-${index}`, 1)
    );

    expect(computeTacticalSellPrice(buildSnapshot(competitors), null)).toBeNull();
  });

  it('returns null when the post-undercut value drops below $0.01', () => {
    const competitors = Array.from({ length: 20 }, (_, index) =>
      competitor(`tiny-${index}`, 0.005)
    );

    expect(computeTacticalSellPrice(buildSnapshot(competitors), null)).toBeNull();
  });

  it('returns null when the rounded result drops below $0.01', () => {
    const competitors = Array.from({ length: 20 }, (_, index) => competitor(`tiny-${index}`, 0.02));

    expect(computeTacticalSellPrice(buildSnapshot(competitors), null)).toBeNull();
  });

  it.each(malformedLandedTotals)(
    'fails closed for a non-null %s landed total',
    (_label, totalPrice) => {
      const competitors = Array.from({ length: 20 }, (_, index) =>
        competitor(`bad-total-${index}`, 1, index === 5 ? totalPrice : usd(10))
      );

      expect(computeTacticalSellPrice(buildSnapshot(competitors), OWN_FREE_SHIPPING)).toBeNull();
    }
  );

  it('does not mutate the snapshot, competitor order, money objects, or own-shipping input', () => {
    const competitors = Array.from({ length: 20 }, (_, index) =>
      competitor(`immutable-${index}`, 2 + index, index % 3 === 0 ? usd(3 + index) : null)
    );
    const ownShipping = usd(0);
    const originalOrder = competitors.map((entry) => entry.legacyItemId);
    const snapshot = buildSnapshot(competitors);
    const snapshotBefore = structuredClone(snapshot);
    const shippingBefore = structuredClone(ownShipping);

    deepFreeze(snapshot);
    deepFreeze(ownShipping);

    expect(computeTacticalSellPrice(snapshot, ownShipping)).toBe(5.95);
    expect(snapshot).toEqual(snapshotBefore);
    expect(ownShipping).toEqual(shippingBefore);
    expect(snapshot.competitors.map((entry) => entry.legacyItemId)).toEqual(originalOrder);
  });
});
