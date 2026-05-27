import type { ListingRow } from '@ebay-inventory/data';
import type { GeneratedListingDraft } from './contracts.js';

export interface TradingCardListingIds {
  category_id: string | null;
  condition_id: string | null;
}

const SPORTS_TRADING_CARD_CATEGORY_ID = '261328';
const UNGRADED_CONDITION_ID = '4000';

function normalizeLabel(value: string | null | undefined): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function shouldResolveSportsTradingCardCategory(
  listing: Pick<ListingRow, 'listing_type'>,
  draft: Pick<GeneratedListingDraft, 'categorySuggestion'>
): boolean {
  if (listing.listing_type !== 'single') {
    return false;
  }

  const categorySuggestion = normalizeLabel(draft.categorySuggestion);

  return categorySuggestion.includes('sports trading card') && !categorySuggestion.includes('lot');
}

function shouldResolveUngradedCondition(
  draft: Pick<GeneratedListingDraft, 'conditionSuggestion'>
): boolean {
  return normalizeLabel(draft.conditionSuggestion).includes('ungraded');
}

export function resolveTradingCardListingIds(
  listing: Pick<ListingRow, 'listing_type'>,
  draft: Pick<GeneratedListingDraft, 'categorySuggestion' | 'conditionSuggestion'>
): TradingCardListingIds {
  return {
    category_id: shouldResolveSportsTradingCardCategory(listing, draft)
      ? SPORTS_TRADING_CARD_CATEGORY_ID
      : null,
    condition_id: shouldResolveUngradedCondition(draft) ? UNGRADED_CONDITION_ID : null,
  };
}
