import { formatStructuredSku, normalizeSkuCategoryCode } from '@ebay-inventory/types';
import type { ListingRow } from './database.js';

export class ListingWorkflowTransitionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ListingWorkflowTransitionConflictError';
  }
}

function readItemSpecificsCategoryCode(itemSpecifics: ListingRow['item_specifics']): unknown {
  if (!itemSpecifics || typeof itemSpecifics !== 'object' || Array.isArray(itemSpecifics)) {
    return undefined;
  }

  return (itemSpecifics as Record<string, unknown>).skuCategoryCode;
}

export function finalizeListingSkuForExportApproval(
  listing: Pick<ListingRow, 'item_specifics' | 'listing_id'>
): string {
  const categoryCode = normalizeSkuCategoryCode(
    readItemSpecificsCategoryCode(listing.item_specifics)
  ) ?? 'OTHER';

  return formatStructuredSku({
    baseSku: listing.listing_id,
    categoryCode,
  });
}
