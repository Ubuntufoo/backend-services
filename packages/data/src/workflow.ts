import {
  isValidListingWorkflowState,
  type ListingStatus,
  type ListingSubStatus,
} from '@ebay-inventory/types';
import type { ListingRow } from './database.js';
import type { SupabaseDataClient } from './client.js';
import { updateListing } from './repositories/listings.js';

export class ListingWorkflowStateError extends Error {
  constructor(status: string, subStatus: string) {
    super(`subStatus "${subStatus}" is not valid for status "${status}"`);
    this.name = 'ListingWorkflowStateError';
  }
}

export interface ListingWorkflowTransitionInput {
  listingId: string;
  status: ListingStatus;
  subStatus: ListingSubStatus;
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

  return await updateListing(client, input.listingId, {
    status: input.status,
    sub_status: input.subStatus,
  });
}
