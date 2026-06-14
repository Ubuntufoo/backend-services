import {
  computePricingStats,
  createFixturePricingProvider,
  normalizeSoldComps,
  type NormalizedSoldComp,
} from '@/pricing/index.js';

describe('computePricingStats', () => {
  it('returns null stats for empty list', () => {
    expect(computePricingStats([])).toEqual({
      soldCount: 0,
      medianSoldPrice: null,
      lowSoldPrice: null,
      highSoldPrice: null,
      deterministicSuggestedPrice: null,
      currency: null,
      ignored: [],
    });
  });

  it('returns same value for single comp stats', () => {
    const result = computePricingStats([buildComp({ totalPrice: { value: 12.34, currency: 'USD' } })]);

    expect(result).toEqual({
      soldCount: 1,
      medianSoldPrice: 12.34,
      lowSoldPrice: 12.34,
      highSoldPrice: 12.34,
      deterministicSuggestedPrice: 12.34,
      currency: 'USD',
      ignored: [],
    });
  });

  it('computes odd-count median from sorted total prices', () => {
    const result = computePricingStats([
      buildComp({ id: 'a', totalPrice: { value: 30, currency: 'USD' } }),
      buildComp({ id: 'b', totalPrice: { value: 10, currency: 'USD' } }),
      buildComp({ id: 'c', totalPrice: { value: 20, currency: 'USD' } }),
    ]);

    expect(result.medianSoldPrice).toBe(20);
    expect(result.lowSoldPrice).toBe(10);
    expect(result.highSoldPrice).toBe(30);
  });

  it('computes even-count median as average of two middle prices', () => {
    const result = computePricingStats([
      buildComp({ id: 'a', totalPrice: { value: 40, currency: 'USD' } }),
      buildComp({ id: 'b', totalPrice: { value: 10, currency: 'USD' } }),
      buildComp({ id: 'c', totalPrice: { value: 20, currency: 'USD' } }),
      buildComp({ id: 'd', totalPrice: { value: 30, currency: 'USD' } }),
    ]);

    expect(result.medianSoldPrice).toBe(25);
    expect(result.deterministicSuggestedPrice).toBe(25);
  });

  it('uses total price rather than item price', () => {
    const result = computePricingStats([
      buildComp({
        price: { value: 1, currency: 'USD' },
        totalPrice: { value: 20, currency: 'USD' },
      }),
      buildComp({
        id: 'b',
        price: { value: 999, currency: 'USD' },
        totalPrice: { value: 22, currency: 'USD' },
      }),
    ]);

    expect(result.medianSoldPrice).toBe(21);
    expect(result.lowSoldPrice).toBe(20);
    expect(result.highSoldPrice).toBe(22);
  });

  it('ignores invalid non-finite zero and negative total prices', () => {
    const result = computePricingStats([
      buildComp({ id: 'valid', totalPrice: { value: 19.99, currency: 'USD' } }),
      buildComp({ id: 'zero', totalPrice: { value: 0, currency: 'USD' } }),
      buildComp({ id: 'negative', totalPrice: { value: -1, currency: 'USD' } }),
      buildComp({ id: 'nan', totalPrice: { value: Number.NaN, currency: 'USD' } }),
      buildComp({ id: 'infinite', totalPrice: { value: Number.POSITIVE_INFINITY, currency: 'USD' } }),
    ]);

    expect(result.soldCount).toBe(1);
    expect(result.currency).toBe('USD');
    expect(result.ignored).toEqual([
      { id: 'zero', reason: 'invalid_total_price' },
      { id: 'negative', reason: 'invalid_total_price' },
      { id: 'nan', reason: 'invalid_total_price' },
      { id: 'infinite', reason: 'invalid_total_price' },
    ]);
  });

  it('uses first valid currency and ignores mismatches', () => {
    const result = computePricingStats([
      buildComp({ id: 'usd-1', totalPrice: { value: 20, currency: 'USD' } }),
      buildComp({ id: 'eur-1', totalPrice: { value: 100, currency: 'EUR' } }),
      buildComp({ id: 'usd-2', totalPrice: { value: 24, currency: 'USD' } }),
    ]);

    expect(result).toMatchObject({
      soldCount: 2,
      medianSoldPrice: 22,
      lowSoldPrice: 20,
      highSoldPrice: 24,
      deterministicSuggestedPrice: 22,
      currency: 'USD',
    });
    expect(result.ignored).toEqual([{ id: 'eur-1', reason: 'currency_mismatch' }]);
  });

  it('rounds median low high and suggested price to 2 decimals', () => {
    const result = computePricingStats([
      buildComp({ id: 'a', totalPrice: { value: 10.111, currency: 'USD' } }),
      buildComp({ id: 'b', totalPrice: { value: 20.555, currency: 'USD' } }),
    ]);

    expect(result).toMatchObject({
      medianSoldPrice: 15.33,
      lowSoldPrice: 10.11,
      highSoldPrice: 20.55,
      deterministicSuggestedPrice: 15.33,
    });
  });

  it('produces deterministic result regardless of input order', () => {
    const ordered = [
      buildComp({ id: 'a', totalPrice: { value: 12, currency: 'USD' } }),
      buildComp({ id: 'b', totalPrice: { value: 18, currency: 'USD' } }),
      buildComp({ id: 'c', totalPrice: { value: 24, currency: 'USD' } }),
      buildComp({ id: 'd', totalPrice: { value: 30, currency: 'USD' } }),
    ];
    const reversed = [...ordered].reverse();

    expect(computePricingStats(ordered)).toEqual(computePricingStats(reversed));
  });

  it('does not mutate input comps', () => {
    const comps = [
      buildComp({ id: 'a', totalPrice: { value: 30, currency: 'USD' } }),
      buildComp({ id: 'b', totalPrice: { value: 10, currency: 'USD' } }),
    ];
    const snapshot = structuredClone(comps);

    computePricingStats(comps);

    expect(comps).toEqual(snapshot);
  });

  it('computes non-null stats from fixture provider normalized output', async () => {
    const provider = createFixturePricingProvider();
    const raw = await provider.fetchSoldComps({
      listingId: 'listing-123',
      title: 'Victor Wembanyama rookie card',
    });
    const normalized = normalizeSoldComps(raw.soldComps);

    const result = computePricingStats(normalized.comps);

    expect(normalized.comps.length).toBeGreaterThan(0);
    expect(normalized.comps.length + normalized.rejected.length).toBeGreaterThanOrEqual(12);
    expect(result.soldCount).toBe(normalized.comps.length);
    expect(result.currency).toBe('USD');
    expect(result.medianSoldPrice).not.toBeNull();
    expect(result.lowSoldPrice).not.toBeNull();
    expect(result.highSoldPrice).not.toBeNull();
    expect(result.deterministicSuggestedPrice).toBe(result.medianSoldPrice);
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
