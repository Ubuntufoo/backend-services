import { describe, expect, it } from 'vitest';

import {
  buildExactCardTitleTarget,
  getExactCardTitleMismatchReason,
} from '@/pricing/exact-card-title.js';

describe('exact-card-title', () => {
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
