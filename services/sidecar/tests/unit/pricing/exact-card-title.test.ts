import { describe, expect, it } from 'vitest';

import {
  buildExactCardTitleTarget,
  getExactCardTitleMismatchReason,
} from '@/pricing/exact-card-title.js';

describe('exact-card-title', () => {
  it('preserves SoldComps acceptance when a known card number is absent from the comp title', () => {
    const target = buildExactCardTitleTarget({
      itemSpecifics: { 'Card Number': '123', Manufacturer: 'Topps', Player: 'Johnny Bench' },
    });

    expect(getExactCardTitleMismatchReason('1973 Topps Johnny Bench', target)).toBeNull();
  });

  it('preserves SoldComps strict conflict handling for contextual years', () => {
    const target = buildExactCardTitleTarget({
      itemSpecifics: { Manufacturer: 'Topps', Player: 'Johnny Bench', Year: '1973' },
    });

    expect(
      getExactCardTitleMismatchReason('1973 Topps Johnny Bench Hall of Fame Class of 1988', target)
    ).toBe('exact_year_mismatch');
  });

  it('does not derive target year from title when only an explicit four-digit card number is present', () => {
    const target = buildExactCardTitleTarget({
      itemSpecifics: {
        Manufacturer: 'Topps',
        Player: 'Phil Rizzuto',
        Set: 'Topps',
      },
      title: 'Phil Rizzuto Topps Card 1951',
    });

    expect(target).toMatchObject({
      baseSetTokens: ['topps'],
      cardNumber: '1951',
      year: null,
    });
  });

  it('does not classify protected four-digit card numbers as conflicting years', () => {
    const target = buildExactCardTitleTarget({
      itemSpecifics: {
        'Card Number': '1951',
        Manufacturer: 'Topps',
        Player: 'Phil Rizzuto',
        Set: 'Topps',
      },
      title: 'Phil Rizzuto Topps Card 1951',
    });

    expect(getExactCardTitleMismatchReason('Phil Rizzuto Topps No. 1951', target)).toBeNull();
    expect(getExactCardTitleMismatchReason('Phil Rizzuto Topps Card No 1951', target)).toBeNull();
  });
});
