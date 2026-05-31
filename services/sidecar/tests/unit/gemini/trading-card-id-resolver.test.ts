import type { ListingRow } from '@ebay-inventory/data';
import { describe, expect, it } from 'vitest';
import { resolveTradingCardListingIds } from '@/gemini/index.js';

function createListing(overrides: Partial<ListingRow> = {}): Pick<ListingRow, 'listing_type'> {
  return {
    listing_type: 'single',
    ...overrides,
  };
}

describe('resolveTradingCardListingIds', () => {
  it('resolves sports trading card single and ungraded into publishable ids', () => {
    expect(
      resolveTradingCardListingIds(createListing(), {
        categorySuggestion: 'Sports Trading Cards',
        cardConditionToken: 'VG',
      })
    ).toEqual({
      category_id: '183050',
      condition_id: '4000',
    });
  });

  it('does not resolve category ids for non-single listings', () => {
    expect(
      resolveTradingCardListingIds(createListing({ listing_type: 'lot' }), {
        categorySuggestion: 'Sports Trading Cards',
        cardConditionToken: 'VG',
      })
    ).toEqual({
      category_id: null,
      condition_id: '4000',
    });
  });

  it('does not resolve ids for unrelated categories or graded cards', () => {
    expect(
      resolveTradingCardListingIds(createListing(), {
        categorySuggestion: 'Baseball Cards',
        cardConditionToken: null,
      })
    ).toEqual({
      category_id: null,
      condition_id: null,
    });
  });
});
