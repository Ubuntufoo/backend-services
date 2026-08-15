import { describe, expect, it } from 'vitest';
import { parseAuthorizedSellerYears } from '@/gemini/seller-year-hints.js';

describe('parseAuthorizedSellerYears', () => {
  it('accepts colon and explicit natural-language seller year directives', () => {
    expect(parseAuthorizedSellerYears('year:1969')).toEqual(['1969']);
    expect(parseAuthorizedSellerYears('Year: 1969')).toEqual(['1969']);
    expect(parseAuthorizedSellerYears('Year is 1969')).toEqual(['1969']);
    expect(parseAuthorizedSellerYears('year IS 1969.')).toEqual(['1969']);
  });

  it('does not authorize unlabeled free-form year mentions', () => {
    expect(parseAuthorizedSellerYears('I think this card is from 1969')).toEqual([]);
    expect(parseAuthorizedSellerYears('1969 Topps card')).toEqual([]);
  });

  it('deduplicates identical directives and preserves conflicts for fail-closed handling', () => {
    expect(parseAuthorizedSellerYears('year:1969\nYear is 1969')).toEqual(['1969']);
    expect(parseAuthorizedSellerYears('Year is 1969\nyear:1970')).toEqual(['1969', '1970']);
  });
});
