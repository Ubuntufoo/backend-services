import { describe, expect, it } from 'vitest';
import {
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
    ['NEAR_MINT_OR_BETTER', '400010', 'Near mint or better'],
    ['EXCELLENT', '400011', 'Excellent'],
    ['VERY_GOOD', '400012', 'Very good'],
    ['POOR', '400013', 'Poor'],
  ] as const)(
    'maps supported token %s to descriptor id %s and label %s',
    (token, descriptorValueId, displayLabel) => {
      expect(getRawCardConditionDescriptorValueId(token)).toBe(descriptorValueId);
      expect(getRawCardConditionDisplayLabel(token)).toBe(displayLabel);
    }
  );

  it('rejects unsupported tokens', () => {
    expect(normalizeRawCardConditionToken('NEAR MINT')).toBeNull();
  });
});
