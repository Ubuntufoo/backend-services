import {
  formatStructuredSku,
  isValidListingWorkflowState,
  normalizeSkuCategoryCode,
  type ListingStatus,
  type ListingSubStatus,
} from '@ebay-inventory/types';
import type { ListingRow } from './database.js';
import type { SupabaseDataClient } from './client.js';
import { getListingByListingId, updateListing } from './repositories/listings.js';
import { requireOptionalResult } from './repositories/shared.js';

export class ListingWorkflowStateError extends Error {
  constructor(status: string, subStatus: string) {
    super(`subStatus "${subStatus}" is not valid for status "${status}"`);
    this.name = 'ListingWorkflowStateError';
  }
}

export class ListingWorkflowTransitionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ListingWorkflowTransitionConflictError';
  }
}

export interface ListingWorkflowTransitionInput {
  listingId: string;
  status: ListingStatus;
  subStatus: ListingSubStatus;
}

function isApprovalForExportTransition(input: ListingWorkflowTransitionInput): boolean {
  return input.status === 'approved_for_export' && input.subStatus === 'publish_queued';
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

export function assertValidListingWorkflowStateInput(
  input: Pick<ListingWorkflowTransitionInput, 'status' | 'subStatus'>
): void {
  if (!isValidListingWorkflowState(input.status, input.subStatus)) {
    throw new ListingWorkflowStateError(input.status, input.subStatus);
  }
}

export async function updateListingWorkflowState(
  client: SupabaseDataClient,
  input: ListingWorkflowTransitionInput
): Promise<ListingRow> {
  assertValidListingWorkflowStateInput(input);

  if (!isApprovalForExportTransition(input)) {
    return await updateListing(client, input.listingId, {
      status: input.status,
      sub_status: input.subStatus,
    });
  }

  const listing = await getListingByListingId(client, input.listingId);

  if (!listing) {
    throw new Error(`Listing "${input.listingId}" was not found.`);
  }

  if (listing.status !== 'needs_review') {
    throw new ListingWorkflowTransitionConflictError(
      `Listing "${input.listingId}" must be in needs_review before approval for export. Current status: "${listing.status}".`
    );
  }

  const finalizedSku = finalizeListingSkuForExportApproval(listing);
  const result = await client
    .from('listings')
    .update({
      sku: finalizedSku,
      status: input.status,
      sub_status: input.subStatus,
    })
    .eq('listing_id', input.listingId)
    .eq('status', 'needs_review')
    .select()
    .maybeSingle();

  return requireOptionalResult(result) ?? (() => {
    throw new ListingWorkflowTransitionConflictError(
      `Listing "${input.listingId}" changed before approval for export could be saved. Refresh and retry.`
    );
  })();
}
