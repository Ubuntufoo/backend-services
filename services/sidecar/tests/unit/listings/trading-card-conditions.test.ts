import { describe, expect, it } from 'vitest';
import {
  getRawCardConditionCandidateLabels,
  getRawCardConditionDescriptorValueId,
  getRawCardConditionDisplayLabel,
  normalizeRawCardConditionToken,
} from '@/listings/trading-card-conditions.js';

describe('trading card conditions', () => {
  it.each([
    ['MT', 'NEAR_MINT_OR_BETTER'],
    ['MINT', 'NEAR_MINT_OR_BETTER'],
    ['NM-MT', 'NEAR_MINT_OR_BETTER'],
    ['NM', 'NEAR_MINT_OR_BETTER'],
    ['EX-MT', 'EXCELLENT'],
    ['EX', 'EXCELLENT'],
    ['VG-EX', 'VERY_GOOD'],
    ['VG', 'VERY_GOOD'],
    ['GOOD', 'VERY_GOOD'],
    ['FR', 'POOR'],
    ['PR', 'POOR'],
  ] as const)('normalizes legacy token %s to %s', (legacyToken, supportedToken) => {
    expect(normalizeRawCardConditionToken(legacyToken)).toBe(supportedToken);
  });

  it.each([
    ['261328', 'NEAR_MINT_OR_BETTER', '400010', 'Near mint or better'],
    ['261328', 'EXCELLENT', '400011', 'Excellent'],
    ['261328', 'VERY_GOOD', '400012', 'Very good'],
    ['261328', 'POOR', '400013', 'Poor'],
    ['183050', 'NEAR_MINT_OR_BETTER', '400010', 'Near mint or better'],
    ['183050', 'EXCELLENT', '400011', 'Excellent'],
    ['183050', 'VERY_GOOD', '400012', 'Very good'],
    ['183050', 'POOR', '400013', 'Poor'],
    ['183454', 'NEAR_MINT_OR_BETTER', '400010', 'Near mint or better'],
    ['183454', 'EXCELLENT', '400015', 'Lightly played (Excellent)'],
    ['183454', 'VERY_GOOD', '400016', 'Moderately played (Very good)'],
    ['183454', 'POOR', '400017', 'Heavily played (Poor)'],
  ] as const)(
    'maps category %s token %s to descriptor id %s',
    (categoryId, token, descriptorValueId, categoryLabel) => {
      expect(getRawCardConditionDescriptorValueId(categoryId, token)).toBe(descriptorValueId);
      expect(getRawCardConditionCandidateLabels(categoryId, token)).toContain(categoryLabel);
    }
  );

  it.each([
    ['NEAR_MINT_OR_BETTER', 'Near mint or better'],
    ['EXCELLENT', 'Excellent'],
    ['VERY_GOOD', 'Very good'],
    ['POOR', 'Poor'],
  ] as const)('returns display label for %s', (token, displayLabel) => {
    expect(getRawCardConditionDisplayLabel(token)).toBe(displayLabel);
  });

  it('does not fall back to sports descriptor mappings for unsupported categories', () => {
    expect(getRawCardConditionDescriptorValueId('9999', 'EXCELLENT')).toBeNull();
    expect(getRawCardConditionCandidateLabels('9999', 'EXCELLENT')).toEqual([]);
  });

  it('rejects unsupported tokens', () => {
    expect(normalizeRawCardConditionToken('NEAR MINT')).toBeNull();
  });
});
