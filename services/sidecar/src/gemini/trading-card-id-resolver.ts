import type { ListingRow } from '@ebay-inventory/data';
import type { GeneratedListingDraft } from './contracts.js';
import { RAW_TRADING_CARD_CONDITION_ID } from '@/listings/trading-card-conditions.js';

export interface TradingCardListingIds {
  category_id: string | null;
  condition_id: string | null;
}

const CATEGORY_ID_BY_SUGGESTION_TOKEN: { categoryId: string; pattern: RegExp }[] = [
  { categoryId: '183050', pattern: /sports trading card/ },
  { categoryId: '183050', pattern: /non-sport trading card/ },
  { categoryId: '183454', pattern: /ccg individual card/ },
];

function normalizeLabel(value: string | null | undefined): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function shouldResolveSportsTradingCardCategory(
  listing: Pick<ListingRow, 'listing_type'>,
  draft: Pick<GeneratedListingDraft, 'categorySuggestion'>
): string | null {
  if (listing.listing_type !== 'single') {
    return null;
  }

  const categorySuggestion = normalizeLabel(draft.categorySuggestion);

  if (categorySuggestion.includes('lot')) {
    return null;
  }

  return (
    CATEGORY_ID_BY_SUGGESTION_TOKEN.find(({ pattern }) => pattern.test(categorySuggestion))
      ?.categoryId ?? null
  );
}

function shouldResolveUngradedCondition(
  draft: Pick<GeneratedListingDraft, 'cardConditionToken'>
): boolean {
  return typeof draft.cardConditionToken === 'string';
}

export function resolveTradingCardListingIds(
  listing: Pick<ListingRow, 'listing_type'>,
  draft: Pick<GeneratedListingDraft, 'cardConditionToken' | 'categorySuggestion'>
): TradingCardListingIds {
  return {
    category_id: shouldResolveSportsTradingCardCategory(listing, draft),
    condition_id: shouldResolveUngradedCondition(draft) ? RAW_TRADING_CARD_CONDITION_ID : null,
  };
}
