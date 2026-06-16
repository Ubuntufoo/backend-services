import {
  computeConditionAdjustmentSummary,
  type NormalizedSoldComp,
  type PricingStatsResult,
} from '@/pricing/index.js';

describe('computeConditionAdjustmentSummary', () => {
  it('computes downward target for Single-000012 style case', () => {
    const summary = computeConditionAdjustmentSummary({
      listingCondition: 'VERY_GOOD',
      comps: [
        buildComp('comp-1', 'Card A VG-EX', 5.2),
        buildComp('comp-2', 'Card B VG/EX', 5.89),
        buildComp('comp-3', 'Card C low grade', 4.7),
        buildComp('comp-4', 'Card D EX', 6.1),
      ],
      stats: buildStats({ medianSoldPrice: 5.89, lowSoldPrice: 4.7, highSoldPrice: 6.1 }),
    });

    expect(summary.listingConditionSignal).toMatchObject({
      label: 'Very Good',
      score: 3,
      source: 'listing_condition',
    });
    expect(summary.compConditionSignals.map((entry) => entry.signal?.label)).toEqual([
      'VG-EX',
      'VG-EX',
      'Low Grade',
      'EX',
    ]);
    expect(summary.compMedianConditionScore).toBe(3.5);
    expect(summary.allowedAdjustment).toMatchObject({
      eligible: true,
      minPrice: expect.any(Number),
      maxPrice: expect.any(Number),
      reason: 'eligible',
      targetPrice: 5.49,
    });
  });

  it('caps upward adjustment at +20%', () => {
    const summary = computeConditionAdjustmentSummary({
      listingCondition: 'NEAR_MINT_OR_BETTER',
      comps: [
        buildComp('comp-1', 'Card A VG', 10),
        buildComp('comp-2', 'Card B VG-EX', 11),
        buildComp('comp-3', 'Card C VG', 12),
        buildComp('comp-4', 'Card D VG-EX', 13),
      ],
      stats: buildStats({ medianSoldPrice: 11.5, lowSoldPrice: 10, highSoldPrice: 13 }),
    });

    expect(summary.allowedAdjustment).toMatchObject({
      eligible: true,
      targetPrice: 13,
      appliedPercent: 0.1304,
    });
  });

  it('treats missing listing token as unknown', () => {
    const summary = computeConditionAdjustmentSummary({
      listingCondition: null,
      comps: [
        buildComp('comp-1', 'Card A EX', 10),
        buildComp('comp-2', 'Card B EX', 11),
        buildComp('comp-3', 'Card C EX', 12),
      ],
      stats: buildStats(),
    });

    expect(summary.allowedAdjustment.reason).toBe('listing_condition_unknown');
    expect(summary.allowedAdjustment.eligible).toBe(false);
  });

  it('requires at least three explicit comp condition signals', () => {
    const summary = computeConditionAdjustmentSummary({
      listingCondition: 'VERY_GOOD',
      comps: [buildComp('comp-1', 'Card A VG', 10), buildComp('comp-2', 'Card B RC', 11)],
      stats: buildStats(),
    });

    expect(summary.explicitCompConditionCount).toBe(1);
    expect(summary.allowedAdjustment.reason).toBe('insufficient_explicit_comp_conditions');
  });

  it('rejects false positives from embedded shorthand and RC/HOF noise', () => {
    const summary = computeConditionAdjustmentSummary({
      listingCondition: 'VERY_GOOD',
      comps: [
        buildComp('comp-1', 'Excellenting RC HOF card', 10),
        buildComp('comp-2', 'Player GQ insert', 11),
        buildComp('comp-3', 'Team EXPO card', 12),
      ],
      stats: buildStats(),
    });

    expect(summary.compConditionSignals.every((entry) => entry.signal === null)).toBe(true);
    expect(summary.explicitCompConditionCount).toBe(0);
  });
});

function buildStats(overrides: Partial<PricingStatsResult> = {}): PricingStatsResult {
  return {
    soldCount: 4,
    medianSoldPrice: 11,
    lowSoldPrice: 10,
    highSoldPrice: 12,
    deterministicSuggestedPrice: 11,
    currency: 'USD',
    ignored: [],
    ...overrides,
  };
}

function buildComp(id: string, title: string, totalPrice: number): NormalizedSoldComp {
  return {
    id,
    title,
    price: { value: totalPrice, currency: 'USD' },
    shippingPrice: null,
    totalPrice: { value: totalPrice, currency: 'USD' },
    soldDate: '2026-06-01T00:00:00.000Z',
    condition: null,
    listingUrl: null,
    source: 'provider',
  };
}
