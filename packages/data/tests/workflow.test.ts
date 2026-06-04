import { describe, expect, it, vi } from 'vitest';
import type { ListingRow, SupabaseDataClient } from '../src/index.js';
import {
  ListingWorkflowStateError,
  ListingWorkflowTransitionConflictError,
  assertValidListingWorkflowStateInput,
  finalizeListingSkuForExportApproval,
  updateListingWorkflowState,
} from '../src/index.js';

const baseListingRow: ListingRow = {
  approved_for_export_at: null,
  capture_mode: null,
  category_id: null,
  condition_id: null,
  condition_notes: null,
  created_at: '2026-05-17T00:00:00.000Z',
  description: null,
  ebay_listing_id: null,
  ebay_listing_status: null,
  ebay_listing_url: null,
  ebay_offer_id: null,
  ese_eligible: null,
  estimated_weight_oz: null,
  exported_at: null,
  generated_at: null,
  handling_days: null,
  id: 'listing-row-id',
  image_urls: [],
  item_specifics: {},
  last_error_at: null,
  last_error_code: null,
  last_error_context: {},
  last_error_message: null,
  listing_id: 'Single-000001',
  listing_type: null,
  merchant_location_key: null,
  package_type: null,
  price: null,
  r2_delete_after: null,
  r2_deleted_at: null,
  r2_object_keys: [],
  r2_retention_policy: null,
  seller_hints: null,
  shipping_profile: null,
  sku: 'Single-000001',
  sold_at: null,
  status: 'needs_review',
  sub_status: 'review_pending',
  title: null,
  updated_at: '2026-05-17T00:00:00.000Z',
};

function createGenericWorkflowUpdateClient(expectedRow: ListingRow): SupabaseDataClient {
  return {
    from: vi.fn((name: string) => {
      expect(name).toBe('listings');

      return {
        update: vi.fn((payload: unknown) => {
          expect(payload).toEqual({
            status: 'needs_review',
            sub_status: 'review_pending',
          });

          return {
            eq: vi.fn((column: string, value: string) => {
              expect(column).toBe('listing_id');
              expect(value).toBe('Single-000001');

              return {
                select: vi.fn(() => ({
                  single: vi.fn(async () => ({
                    data: expectedRow,
                    error: null,
                  })),
                })),
              };
            }),
          };
        }),
      };
    }),
  } as unknown as SupabaseDataClient;
}

function createApprovalClient(
  listing: ListingRow,
  onUpdate: (payload: unknown) => void,
  updatedListing: ListingRow | null = null
): SupabaseDataClient {
  return {
    from: vi.fn((name: string) => {
      expect(name).toBe('listings');

      return {
        select: vi.fn(() => ({
          eq: vi.fn((column: string, value: string) => {
            expect(column).toBe('listing_id');
            expect(value).toBe(listing.listing_id);

            return {
              maybeSingle: vi.fn(async () => ({
                data: listing,
                error: null,
              })),
            };
          }),
        })),
        update: vi.fn((payload: unknown) => {
          onUpdate(payload);

          return {
            eq: vi.fn((column: string, value: string) => {
              expect(column).toBe('listing_id');
              expect(value).toBe(listing.listing_id);

              return {
                eq: vi.fn((statusColumn: string, statusValue: string) => {
                  expect(statusColumn).toBe('status');
                  expect(statusValue).toBe('needs_review');

                  return {
                    select: vi.fn(() => ({
                      maybeSingle: vi.fn(async () => ({
                        data: updatedListing,
                        error: null,
                      })),
                    })),
                  };
                }),
              };
            }),
          };
        }),
      };
    }),
  } as unknown as SupabaseDataClient;
}

describe('workflow helpers', () => {
  it('accepts valid workflow states', () => {
    expect(() =>
      assertValidListingWorkflowStateInput({
        status: 'approved_for_export',
        subStatus: 'publish_queued',
      })
    ).not.toThrow();
  });

  it('rejects invalid workflow states before repository call', () => {
    expect(() =>
      assertValidListingWorkflowStateInput({
        status: 'record_created',
        subStatus: 'publish_queued',
      })
    ).toThrow(ListingWorkflowStateError);
  });

  it('updates non-approval workflow state after validation', async () => {
    const updatedRow: ListingRow = {
      ...baseListingRow,
      status: 'needs_review',
      sub_status: 'review_pending',
    };
    const client = createGenericWorkflowUpdateClient(updatedRow);

    await expect(
      updateListingWorkflowState(client, {
        listingId: 'Single-000001',
        status: 'needs_review',
        subStatus: 'review_pending',
      })
    ).resolves.toEqual(updatedRow);
  });

  it.each([
    ['BSKBL single', 'Single-000001', 'BSKBL', 'BSKBL-Single-000001'],
    ['BSBL lot', 'Lot-000002', 'BSBL', 'BSBL-Lot-000002'],
    ['OTHER explicit', 'Single-000003', 'OTHER', 'OTHER-Single-000003'],
    ['missing category', 'Single-000004', undefined, 'OTHER-Single-000004'],
    ['invalid category Basketball', 'Single-000005', 'Basketball', 'OTHER-Single-000005'],
    ['invalid category TCG', 'Single-000006', 'TCG', 'OTHER-Single-000006'],
    [
      'invalid full sku category',
      'Single-000007',
      'BSKBL-Single-000001',
      'OTHER-Single-000007',
    ],
    ['normalized lowercase category', 'Single-000008', ' bskbl ', 'BSKBL-Single-000008'],
  ])('finalizes SKU on approval for %s', async (_label, listingId, skuCategoryCode, expectedSku) => {
    const listing: ListingRow = {
      ...baseListingRow,
      ebay_listing_id: 'EBAY-LISTING',
      ebay_offer_id: 'EBAY-OFFER',
      item_specifics:
        skuCategoryCode === undefined
          ? {}
          : {
              skuCategoryCode,
            },
      listing_id: listingId,
      sku: listingId,
    };
    const updatedRow: ListingRow = {
      ...listing,
      sku: expectedSku,
      status: 'approved_for_export',
      sub_status: 'publish_queued',
    };
    const client = createApprovalClient(
      listing,
      (payload) => {
        expect(payload).toEqual({
          sku: expectedSku,
          status: 'approved_for_export',
          sub_status: 'publish_queued',
        });
      },
      updatedRow
    );

    await expect(
      updateListingWorkflowState(client, {
        listingId,
        status: 'approved_for_export',
        subStatus: 'publish_queued',
      })
    ).resolves.toEqual(updatedRow);
  });

  it('overwrites mismatched structured sku on needs_review approval', async () => {
    const listing: ListingRow = {
      ...baseListingRow,
      item_specifics: {
        skuCategoryCode: 'BSBL',
      },
      listing_id: 'Single-000009',
      sku: 'BSKBL-Single-000009',
    };
    const updatedRow: ListingRow = {
      ...listing,
      sku: 'BSBL-Single-000009',
      status: 'approved_for_export',
      sub_status: 'publish_queued',
    };
    const client = createApprovalClient(
      listing,
      (payload) => {
        expect(payload).toEqual({
          sku: 'BSBL-Single-000009',
          status: 'approved_for_export',
          sub_status: 'publish_queued',
        });
      },
      updatedRow
    );

    await expect(
      updateListingWorkflowState(client, {
        listingId: 'Single-000009',
        status: 'approved_for_export',
        subStatus: 'publish_queued',
      })
    ).resolves.toEqual(updatedRow);
  });

  it.each(['exported', 'listed', 'sold'] as const)(
    'does not mutate %s listings during approval',
    async (status) => {
      const listing: ListingRow = {
        ...baseListingRow,
        status,
      };
      const client = createApprovalClient(listing, () => {
        throw new Error('approval update should not run');
      });

      await expect(
        updateListingWorkflowState(client, {
          listingId: listing.listing_id,
          status: 'approved_for_export',
          subStatus: 'publish_queued',
        })
      ).rejects.toThrow(ListingWorkflowTransitionConflictError);
    }
  );

  it('preserves stale-status protection when approval update loses race', async () => {
    const listing: ListingRow = {
      ...baseListingRow,
      item_specifics: {
        skuCategoryCode: 'BSKBL',
      },
    };
    const client = createApprovalClient(listing, () => {}, null);

    await expect(
      updateListingWorkflowState(client, {
        listingId: listing.listing_id,
        status: 'approved_for_export',
        subStatus: 'publish_queued',
      })
    ).rejects.toThrow('changed before approval for export could be saved');
  });

  it('derives final sku from immutable listing_id, not current sku', () => {
    expect(
      finalizeListingSkuForExportApproval({
        item_specifics: {
          skuCategoryCode: 'BSKBL',
        },
        listing_id: 'Single-000001',
      } as Pick<ListingRow, 'item_specifics' | 'listing_id'>)
    ).toBe('BSKBL-Single-000001');
  });
});
