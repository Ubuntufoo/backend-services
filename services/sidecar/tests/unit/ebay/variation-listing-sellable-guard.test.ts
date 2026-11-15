import { describe, expect, it } from 'vitest';
import { hasAtLeastTwoSellableVariations } from '@/ebay/variation-listing-sellable-guard.js';

describe('two-sellable-variation safety guard', () => {
  it.each([
    [[1, 1], true],
    [[0, 1, 1], true],
    [[2, 0, 4], true],
    [[0, 1], false],
    [[0, 0, 1], false],
    [[0, 0], false],
    [[], false],
    [[1, -1, 2], false],
    [[1, Number.NaN, 1], false],
    [[1, 2_147_483_648, 1], false],
  ] as const)('validates quantities %j', (quantities, allowed) => {
    expect(hasAtLeastTwoSellableVariations(quantities)).toBe(allowed);
  });
});
