import { describe, expect, it } from 'vitest';

import {
  buildActiveMarketTitleTarget,
  getActiveMarketTitleMismatchReason,
} from '@/pricing/active-market-title.js';
import {
  buildExactCardTitleTarget,
  getExactCardTitleMismatchReason,
} from '@/pricing/exact-card-title.js';
import {
  normalizeSoldComps,
  type NormalizeSoldCompsContext,
  type RawSoldComp,
} from '@/pricing/index.js';

const CONTEXT: NormalizeSoldCompsContext = {
  itemSpecifics: {
    'Card Number': '123',
    Manufacturer: 'Topps',
    Player: 'Johnny Bench',
    Set: 'Topps Chrome',
    Year: '1973',
  },
  title: '1973 Topps Chrome Johnny Bench #123',
};

function soldTitleReason(title: string): string | null {
  return getExactCardTitleMismatchReason(title, buildExactCardTitleTarget(CONTEXT));
}

function activeTitleReason(title: string): string | null {
  return getActiveMarketTitleMismatchReason(title, buildActiveMarketTitleTarget(CONTEXT));
}

function buildRawComp(overrides: Partial<RawSoldComp> = {}): RawSoldComp {
  return {
    title: '1973 Topps Chrome Johnny Bench #123',
    price: { value: 19.99, currency: 'USD' },
    shippingPrice: { value: 3.5, currency: 'USD' },
    soldDate: '2026-01-15T12:34:56.000Z',
    condition: 'Near Mint',
    listingUrl: 'https://example.com/item/123',
    ...overrides,
  };
}

describe('active/sold exact-card title parity', () => {
  describe('shared card-identity rules', () => {
    it.each([
      ['1973 Topps Chrome Mickey Mantle #123', 'exact_player_mismatch'],
      ['1973 Donruss Johnny Bench #123', 'exact_set_mismatch'],
      ['1988 Topps Chrome Johnny Bench #123', 'exact_year_mismatch'],
      ['1973 Topps Chrome Johnny Bench #999', 'exact_card_number_mismatch'],
    ])('reject "%s" with the same reason in both filters', (title, reason) => {
      expect(soldTitleReason(title)).toBe(reason);
      expect(activeTitleReason(title)).toBe(reason);
    });
  });

  describe('Browse-only precision checks (SoldComps still accepts)', () => {
    it.each([
      ['1973 Topps Johnny Bench #123', 'active_set_mismatch'],
      ['1973 Topps Chrome Johnny Bench #123 Reprint', 'active_reprint_mismatch'],
      ['1973 Topps Chrome Johnny Bench #123 Signed', 'active_autograph_mismatch'],
      ['1973 Topps Chrome Johnny Bench #123 Lot of 2', 'active_multi_card_mismatch'],
      ['1973 Topps Chrome Johnny Bench 123', 'active_card_number_evidence_mismatch'],
    ])('"%s" is a Browse-only rejection %s', (title, reason) => {
      expect(soldTitleReason(title)).toBeNull();
      expect(activeTitleReason(title)).toBe(reason);
    });
  });

  describe('Browse strictness does not blanket legitimate titles', () => {
    it('accepts a title that omits the card number', () => {
      const title = '1973 Topps Chrome Johnny Bench';

      expect(soldTitleReason(title)).toBeNull();
      expect(activeTitleReason(title)).toBeNull();
    });

    it('accepts a contextual Hall-of-Fame year while SoldComps keeps strict year handling', () => {
      const title = '1973 Topps Chrome Johnny Bench Card No. 123 Hall of Fame Class of 1988';

      expect(activeTitleReason(title)).toBeNull();
      expect(soldTitleReason(title)).toBe('exact_year_mismatch');
    });
  });

  describe('SoldComps keeps sold-only date/price checks independent of Browse', () => {
    it('rejects an invalid sold date even for a Browse-accepted title', () => {
      const title = '1973 Topps Chrome Johnny Bench #123';
      expect(activeTitleReason(title)).toBeNull();

      const normalized = normalizeSoldComps(
        [buildRawComp({ title, soldDate: 'not-a-date' })],
        CONTEXT
      );

      expect(normalized.comps).toEqual([]);
      expect(normalized.rejected).toEqual([{ index: 0, reason: 'invalid_sold_date', title }]);
    });

    it('still applies the post-normalization extreme sold-price outlier check', () => {
      const normalized = normalizeSoldComps(
        [
          buildRawComp({ price: { value: 2.95, currency: 'USD' }, shippingPrice: null }),
          buildRawComp({ price: { value: 3.1, currency: 'USD' }, shippingPrice: null }),
          buildRawComp({ price: { value: 3.35, currency: 'USD' }, shippingPrice: null }),
          buildRawComp({ price: { value: 10.4, currency: 'USD' }, shippingPrice: null }),
        ],
        CONTEXT
      );

      expect(normalized.comps.map((comp) => comp.price.value)).toEqual([2.95, 3.1, 3.35]);
      expect(normalized.rejected).toContainEqual({
        index: 3,
        reason: 'extreme_price_outlier',
        title: '1973 Topps Chrome Johnny Bench #123',
      });
    });

    it('routes shared identity mismatches through SoldComps normalization unchanged', () => {
      const title = '1988 Topps Chrome Johnny Bench #123';
      expect(soldTitleReason(title)).toBe('exact_year_mismatch');

      const normalized = normalizeSoldComps([buildRawComp({ title })], CONTEXT);

      expect(normalized.comps).toEqual([]);
      expect(normalized.rejected).toEqual([{ index: 0, reason: 'exact_year_mismatch', title }]);
    });
  });
});
