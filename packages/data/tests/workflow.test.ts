import { describe, expect, it, vi } from 'vitest';
import type { ListingRow, SupabaseDataClient } from '../src/index.js';
import {
  ListingWorkflowStateError,
  assertValidListingWorkflowStateInput,
  updateListingWorkflowState,
} from '../src/index.js';

const listingRow: ListingRow = {
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
  handling_days: null,
  id: 'listing-row-id',
  image_urls: [],
  item_specifics: {},
  last_error_at: null,
  last_error_code: null,
  listing_id: 'LIST-001',
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
  sku: 'SKU-001',
  sold_at: null,
  status: 'approved_for_export',
  sub_status: 'publish_queued',
  title: null,
  updated_at: '2026-05-17T00:00:00.000Z',
};

function createWorkflowUpdateClient(): SupabaseDataClient {
  return {
    from: vi.fn((name: string) => {
      expect(name).toBe('listings');

      return {
        update: vi.fn((payload: unknown) => {
          expect(payload).toEqual({
            status: 'approved_for_export',
            sub_status: 'publish_queued',
          });

          return {
            eq: vi.fn((column: string, value: string) => {
              expect(column).toBe('listing_id');
              expect(value).toBe('LIST-001');

              return {
                select: vi.fn(() => ({
                  single: vi.fn(async () => ({
                    data: listingRow,
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

describe('workflow helpers', () => {
  it('accepts valid workflow states', () => {
    expect(() =>
      assertValidListingWorkflowStateInput({
        status: 'approved_for_export',
        subStatus: 'publish_queued',
      })
    ).not.toThrow();
  });

  it('rejects invalid workflow states before the repository call', () => {
    expect(() =>
      assertValidListingWorkflowStateInput({
        status: 'record_created',
        subStatus: 'publish_queued',
      })
    ).toThrow(ListingWorkflowStateError);
  });

  it('updates listing workflow state after validation', async () => {
    const client = createWorkflowUpdateClient();

    await expect(
      updateListingWorkflowState(client, {
        listingId: 'LIST-001',
        status: 'approved_for_export',
        subStatus: 'publish_queued',
      })
    ).resolves.toEqual(listingRow);
  });
});
