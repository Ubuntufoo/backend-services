import { describe, expect, it } from 'vitest';

import {
  DEFAULT_BROWSE_PRICING_OPTIONS,
  normalizeBrowsePricingOptions,
  type BrowsePricingOptions,
} from '@/pricing/browse-pricing-options.js';

describe('browse-pricing-options', () => {
  it('exposes canonical defaults with Browse enabled and the approved multiplier range', () => {
    expect(DEFAULT_BROWSE_PRICING_OPTIONS).toEqual({
      skipBrowse: false,
      minPriceMultiplier: 0.33,
      maxPriceMultiplier: 3,
    });
  });

  it('returns the canonical defaults for missing input', () => {
    expect(normalizeBrowsePricingOptions(undefined)).toEqual({
      skipBrowse: false,
      minPriceMultiplier: 0.33,
      maxPriceMultiplier: 3,
    });
    expect(normalizeBrowsePricingOptions(null)).toEqual({
      skipBrowse: false,
      minPriceMultiplier: 0.33,
      maxPriceMultiplier: 3,
    });
  });

  it('returns a fresh object rather than the shared default reference', () => {
    const normalized = normalizeBrowsePricingOptions(undefined);
    expect(normalized).toEqual(DEFAULT_BROWSE_PRICING_OPTIONS);
    expect(normalized).not.toBe(DEFAULT_BROWSE_PRICING_OPTIONS);
  });

  it('accepts valid custom values', () => {
    expect(
      normalizeBrowsePricingOptions({
        skipBrowse: true,
        minPriceMultiplier: 0.5,
        maxPriceMultiplier: 2,
      })
    ).toEqual({
      skipBrowse: true,
      minPriceMultiplier: 0.5,
      maxPriceMultiplier: 2,
    });
  });

  it('rejects non-object input', () => {
    for (const invalid of ['skip', 7, [], [0.5, 2]]) {
      expect(() => normalizeBrowsePricingOptions(invalid)).toThrow(TypeError);
    }
  });

  it('rejects non-boolean skipBrowse shapes', () => {
    for (const skipBrowse of ['true', 1, undefined, {}, ['no']]) {
      expect(() =>
        normalizeBrowsePricingOptions({
          skipBrowse,
          minPriceMultiplier: 0.33,
          maxPriceMultiplier: 3,
        })
      ).toThrow(TypeError);
    }
  });

  it('rejects missing skipBrowse', () => {
    expect(() =>
      normalizeBrowsePricingOptions({ minPriceMultiplier: 0.33, maxPriceMultiplier: 3 })
    ).toThrow(TypeError);
  });

  it('rejects non-finite minPriceMultiplier values', () => {
    for (const minPriceMultiplier of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      '0.33',
    ]) {
      expect(() =>
        normalizeBrowsePricingOptions({
          skipBrowse: false,
          minPriceMultiplier,
          maxPriceMultiplier: 3,
        })
      ).toThrow(RangeError);
    }
  });

  it('rejects non-finite maxPriceMultiplier values', () => {
    for (const maxPriceMultiplier of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      '3',
    ]) {
      expect(() =>
        normalizeBrowsePricingOptions({
          skipBrowse: false,
          minPriceMultiplier: 0.33,
          maxPriceMultiplier,
        })
      ).toThrow(RangeError);
    }
  });

  it('rejects zero or negative multipliers', () => {
    expect(() =>
      normalizeBrowsePricingOptions({
        skipBrowse: false,
        minPriceMultiplier: 0,
        maxPriceMultiplier: 3,
      })
    ).toThrow(RangeError);
    expect(() =>
      normalizeBrowsePricingOptions({
        skipBrowse: false,
        minPriceMultiplier: -0.5,
        maxPriceMultiplier: 3,
      })
    ).toThrow(RangeError);
    expect(() =>
      normalizeBrowsePricingOptions({
        skipBrowse: false,
        minPriceMultiplier: 0.33,
        maxPriceMultiplier: 0,
      })
    ).toThrow(RangeError);
    expect(() =>
      normalizeBrowsePricingOptions({
        skipBrowse: false,
        minPriceMultiplier: 0.33,
        maxPriceMultiplier: -1,
      })
    ).toThrow(RangeError);
  });

  it('rejects min >= max multiplier order', () => {
    expect(() =>
      normalizeBrowsePricingOptions({
        skipBrowse: false,
        minPriceMultiplier: 3,
        maxPriceMultiplier: 3,
      })
    ).toThrow(RangeError);
    expect(() =>
      normalizeBrowsePricingOptions({
        skipBrowse: false,
        minPriceMultiplier: 4,
        maxPriceMultiplier: 3,
      })
    ).toThrow(RangeError);
  });

  it('keeps the normalized result a stable BrowsePricingOptions shape', () => {
    const normalized = normalizeBrowsePricingOptions({
      skipBrowse: true,
      minPriceMultiplier: 0.33,
      maxPriceMultiplier: 3,
      extra: 'ignored',
    });

    const expected: BrowsePricingOptions = {
      skipBrowse: true,
      minPriceMultiplier: 0.33,
      maxPriceMultiplier: 3,
    };
    expect(normalized).toEqual(expected);
    expect(Object.keys(normalized).sort()).toEqual(
      ['skipBrowse', 'minPriceMultiplier', 'maxPriceMultiplier'].sort()
    );
  });
});
