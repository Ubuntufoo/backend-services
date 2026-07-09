import {
  computePricingConfidence,
  computePricingStats,
  normalizeSoldComps,
} from '@/pricing/index.js';

import { NOISY_APIFY_SOLD_COMPS_FIXTURE } from './fixtures/noisy-apify-sold-comps.js';

describe('pricing noisy Apify-like sold comps fixture', () => {
  it('normalizes noisy records into expected accepted comps and ordered rejections', () => {
    const normalized = normalizeSoldComps(NOISY_APIFY_SOLD_COMPS_FIXTURE);

    expect(normalized.comps).toHaveLength(8);
    expect(normalized.comps.map((comp) => comp.title)).toEqual([
      '2024 Topps Chrome Rookie A',
      '2024 Topps Chrome Rookie B',
      '2024 Topps Chrome Rookie C',
      '2024 Topps Chrome Rookie D',
      '2024 Topps Chrome Rookie E',
      '2024 Topps Chrome Rookie F EUR',
      '2024 Topps Chrome Rookie H',
      '2024 Topps Chrome Rookie I',
    ]);
    expect(normalized.rejected).toEqual([
      { index: 1, reason: 'blank_title', title: null },
      { index: 2, reason: 'invalid_price', title: 'Zero Price Record' },
      { index: 3, reason: 'invalid_price', title: 'Negative Price Record' },
      { index: 4, reason: 'invalid_price', title: 'Infinite Price Record' },
      { index: 7, reason: 'invalid_shipping', title: 'Negative Shipping Record' },
      { index: 8, reason: 'invalid_sold_date', title: 'Invalid Sold Date Record' },
      { index: 9, reason: 'invalid_listing_url', title: 'Invalid URL Record' },
      { index: 12, reason: 'invalid_listing_url', title: 'Non HTTP URL Record' },
      { index: 14, reason: 'extreme_price_outlier', title: '2024 Topps Chrome Rookie G Outlier' },
    ]);
  });

  it('trims accepted fields and normalizes shipping/nullability predictably', () => {
    const normalized = normalizeSoldComps(NOISY_APIFY_SOLD_COMPS_FIXTURE);

    expect(normalized.comps[0]).toMatchObject({
      title: '2024 Topps Chrome Rookie A',
      condition: null,
      listingUrl: null,
      shippingPrice: null,
      totalPrice: { value: 20, currency: 'USD' },
    });
    expect(normalized.comps[1]).toMatchObject({
      title: '2024 Topps Chrome Rookie B',
      condition: 'Near Mint',
      listingUrl: 'https://example.com/item/rookie-b',
      shippingPrice: null,
      totalPrice: { value: 22, currency: 'USD' },
    });
    expect(normalized.comps[2]).toMatchObject({
      title: '2024 Topps Chrome Rookie C',
      condition: 'Used',
      listingUrl: 'https://example.com/item/rookie-c',
      shippingPrice: { value: 0, currency: 'USD' },
      totalPrice: { value: 24, currency: 'USD' },
    });
    expect(normalized.comps[3]).toMatchObject({
      condition: null,
      shippingPrice: { value: 3, currency: 'USD' },
      totalPrice: { value: 28, currency: 'USD' },
    });
    expect(normalized.comps[4]).toMatchObject({
      condition: 'PSA 9',
      listingUrl: 'https://example.com/item/rookie-e',
      shippingPrice: { value: 4, currency: 'USD' },
      totalPrice: { value: 30, currency: 'USD' },
      soldDate: '2026-01-12T14:15:00.000Z',
    });
  });

  it('computes deterministic stats from accepted comps only and ignores mixed currency in stats', () => {
    const normalized = normalizeSoldComps(NOISY_APIFY_SOLD_COMPS_FIXTURE);
    const stats = computePricingStats(normalized.comps);

    expect(stats).toEqual({
      soldCount: 7,
      medianSoldPrice: 28,
      lowSoldPrice: 20,
      highSoldPrice: 34,
      deterministicSuggestedPrice: 28,
      currency: 'USD',
      ignored: [{ id: normalized.comps[5]!.id, reason: 'currency_mismatch' }],
    });
  });

  it('returns deterministic confidence-only output without recommendation fields', () => {
    const normalized = normalizeSoldComps(NOISY_APIFY_SOLD_COMPS_FIXTURE);
    const stats = computePricingStats(normalized.comps);
    const confidence = computePricingConfidence({
      comps: normalized.comps,
      stats,
    });

    expect(confidence).toEqual({
      confidence: 'medium',
      reasons: ['moderate_comp_count'],
    });
    expect(Object.keys(confidence).sort()).toEqual(['confidence', 'reasons']);
    expect(confidence).not.toHaveProperty('singleRecommendation');
    expect(confidence).not.toHaveProperty('lotRecommendation');
  });
});
