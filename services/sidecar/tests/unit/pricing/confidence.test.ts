import {
  computePricingConfidence,
  computePricingStats,
  createFixturePricingProvider,
  normalizeSoldComps,
  type NormalizedSoldComp,
  type PricingStatsResult,
} from '@/pricing/index.js';

describe('computePricingConfidence', () => {
  it('returns low for empty stats and no comps', () => {
    expect(
      computePricingConfidence({
        comps: [],
        stats: {
          soldCount: 0,
          medianSoldPrice: null,
          lowSoldPrice: null,
          highSoldPrice: null,
          deterministicSuggestedPrice: null,
          currency: null,
          ignored: [],
        },
      }),
    ).toEqual({
      confidence: 'low',
      reasons: ['missing_pricing_stats'],
    });
  });

  it('returns low when sold count is below 3', () => {
    const comps = [
      buildComp({ id: 'a', totalPrice: { value: 10, currency: 'USD' } }),
      buildComp({ id: 'b', totalPrice: { value: 12, currency: 'USD' } }),
    ];

    expect(
      computePricingConfidence({
        comps,
        stats: computePricingStats(comps),
      }),
    ).toEqual({
      confidence: 'low',
      reasons: ['insufficient_comps'],
    });
  });

  it('returns medium when sold count is between 3 and 7', () => {
    const comps = buildCompList([10, 12, 14, 16]);

    expect(
      computePricingConfidence({
        comps,
        stats: computePricingStats(comps),
      }),
    ).toEqual({
      confidence: 'medium',
      reasons: ['moderate_comp_count'],
    });
  });

  it('returns high when sold count is at least 8', () => {
    const comps = buildCompList([10, 11, 12, 13, 14, 15, 16, 17]);

    expect(
      computePricingConfidence({
        comps,
        stats: computePricingStats(comps),
      }),
    ).toEqual({
      confidence: 'high',
      reasons: ['strong_comp_count'],
    });
  });

  it('forces low when median suggested or currency is missing', () => {
    const statsCases: PricingStatsResult[] = [
      {
        soldCount: 4,
        medianSoldPrice: null,
        lowSoldPrice: 10,
        highSoldPrice: 15,
        deterministicSuggestedPrice: 12,
        currency: 'USD',
        ignored: [],
      },
      {
        soldCount: 4,
        medianSoldPrice: 12,
        lowSoldPrice: 10,
        highSoldPrice: 15,
        deterministicSuggestedPrice: null,
        currency: 'USD',
        ignored: [],
      },
      {
        soldCount: 4,
        medianSoldPrice: 12,
        lowSoldPrice: 10,
        highSoldPrice: 15,
        deterministicSuggestedPrice: 12,
        currency: null,
        ignored: [],
      },
    ];

    for (const stats of statsCases) {
      expect(
        computePricingConfidence({
          comps: buildCompList([10, 12, 14, 16]),
          stats,
        }),
      ).toEqual({
        confidence: 'low',
        reasons: ['missing_pricing_stats'],
      });
    }
  });

  it('downgrades one level for high ignored ratio', () => {
    const comps = buildCompList([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    const stats = computePricingStats(comps);
    stats.ignored = [
      { id: 'x1', reason: 'invalid_total_price' },
      { id: 'x2', reason: 'invalid_total_price' },
      { id: 'x3', reason: 'currency_mismatch' },
      { id: 'x4', reason: 'currency_mismatch' },
      { id: 'x5', reason: 'invalid_total_price' },
    ];

    expect(
      computePricingConfidence({
        comps,
        stats,
      }),
    ).toEqual({
      confidence: 'medium',
      reasons: ['strong_comp_count', 'high_ignored_ratio'],
    });
  });

  it('downgrades one level for wide price spread', () => {
    const comps = buildCompList([10, 11, 12, 13, 14, 15, 16, 40]);

    expect(
      computePricingConfidence({
        comps,
        stats: computePricingStats(comps),
      }),
    ).toEqual({
      confidence: 'medium',
      reasons: ['strong_comp_count', 'wide_price_spread'],
    });
  });

  it('applies multiple downgrades without going below low', () => {
    const comps = buildCompList([10, 12, 14, 50]);
    const stats = computePricingStats(comps);
    stats.ignored = [
      { id: 'x1', reason: 'invalid_total_price' },
      { id: 'x2', reason: 'currency_mismatch' },
    ];

    expect(
      computePricingConfidence({
        comps,
        stats,
      }),
    ).toEqual({
      confidence: 'low',
      reasons: ['moderate_comp_count', 'high_ignored_ratio', 'wide_price_spread'],
    });
  });

  it('includes relevant reason codes in output', () => {
    const comps = buildCompList([10, 12, 14, 16, 18, 20, 22, 24]);
    const stats = computePricingStats(comps);
    stats.ignored = [
      { id: 'x1', reason: 'invalid_total_price' },
      { id: 'x2', reason: 'invalid_total_price' },
      { id: 'x3', reason: 'invalid_total_price' },
      { id: 'x4', reason: 'invalid_total_price' },
    ];
    stats.lowSoldPrice = 5;
    stats.highSoldPrice = 25;

    const result = computePricingConfidence({ comps, stats });

    expect(result.confidence).toBe('low');
    expect(result.reasons).toContain('strong_comp_count');
    expect(result.reasons).toContain('high_ignored_ratio');
    expect(result.reasons).toContain('wide_price_spread');
  });

  it('works with fixture provider normalized comps and stats', async () => {
    const provider = createFixturePricingProvider();
    const raw = await provider.fetchSoldComps({
      listingId: 'listing-123',
      title: 'Victor Wembanyama rookie card',
    });
    const normalized = normalizeSoldComps(raw.soldComps);
    const stats = computePricingStats(normalized.comps);
    const result = computePricingConfidence({
      comps: normalized.comps,
      stats,
    });

    expect(normalized.comps.length).toBeGreaterThan(0);
    expect(normalized.rejected.length).toBeGreaterThanOrEqual(1);
    expect(result.confidence).toMatch(/^(low|medium|high)$/);
    expect(Array.isArray(result.reasons)).toBe(true);
  });

  it('returns confidence-only shape without recommendation fields', () => {
    const comps = buildCompList([10, 11, 12, 13, 14, 15, 16, 17]);
    const result = computePricingConfidence({
      comps,
      stats: computePricingStats(comps),
    });

    expect(Object.keys(result).sort()).toEqual(['confidence', 'reasons']);
    expect(result).not.toHaveProperty('manual_review');
    expect(result).not.toHaveProperty('single_candidate');
    expect(result).not.toHaveProperty('lot_candidate');
    expect(result).not.toHaveProperty('sellability');
    expect(result).not.toHaveProperty('profitability');
  });
});

function buildComp(overrides: Partial<NormalizedSoldComp> = {}): NormalizedSoldComp {
  return {
    id: 'comp-1',
    title: 'Sample Title',
    price: { value: 19.99, currency: 'USD' },
    shippingPrice: { value: 3.5, currency: 'USD' },
    totalPrice: { value: 23.49, currency: 'USD' },
    soldDate: '2026-01-15T12:34:56.000Z',
    condition: 'Near Mint',
    listingUrl: 'https://example.com/item/123',
    source: 'provider',
    ...overrides,
  };
}

function buildCompList(values: number[]): NormalizedSoldComp[] {
  return values.map((value, index) =>
    buildComp({
      id: `comp-${index + 1}`,
      totalPrice: { value, currency: 'USD' },
    }),
  );
}
