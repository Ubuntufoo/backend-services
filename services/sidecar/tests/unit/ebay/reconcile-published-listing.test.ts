import type { AppSettingsRow, ListingRow } from '@ebay-inventory/data';
import { describe, expect, it, vi } from 'vitest';
import type { SidecarDataAccess } from '@/data/sidecar-data.js';
import { reconcilePublishedListing } from '@/ebay/reconcile-published-listing.js';

function createListing(overrides: Partial<ListingRow> = {}): ListingRow {
  return {
    approved_for_export_at: '2026-05-24T12:00:00.000Z',
    capture_mode: null,
    category_id: '1234',
    condition_id: '4000',
    condition_notes: null,
    created_at: '2026-05-24T10:00:00.000Z',
    description: 'Detailed listing description.',
    ebay_listing_id: null,
    ebay_listing_status: null,
    ebay_listing_url: null,
    ebay_offer_id: 'OFFER-001',
    ese_eligible: null,
    estimated_weight_oz: 8,
    exported_at: null,
    generated_at: '2026-05-24T11:00:00.000Z',
    handling_days: 2,
    id: 'row-1',
    image_urls: ['https://cdn.example.com/front.jpg'],
    item_specifics: {},
    last_error_at: '2026-05-24T15:00:00.000Z',
    last_error_code: 'publish_export_state_persist_failed',
    last_error_context: { stage: 'finalize' },
    last_error_message: 'finalize failed',
    listing_id: 'LIST-001',
    listing_type: 'single',
    merchant_location_key: null,
    package_type: 'BOX',
    price: 24.5,
    r2_delete_after: null,
    r2_deleted_at: null,
    r2_object_keys: [],
    r2_retention_policy: null,
    seller_hints: null,
    shipping_profile: null,
    sku: 'SKU-KEEP',
    sold_at: null,
    status: 'approved_for_export',
    sub_status: 'idle',
    title: 'Vintage puzzle',
    updated_at: '2026-05-24T11:30:00.000Z',
    ...overrides,
  };
}

function createAppSettings(overrides: Partial<AppSettingsRow> = {}): AppSettingsRow {
  return {
    capture_mode: 'single_2_image',
    default_fulfillment_policy_id: 'FULFILLMENT-1',
    default_package_type: 'LETTER',
    default_payment_policy_id: 'PAYMENT-1',
    default_return_policy_id: 'RETURN-1',
    default_shipping_profile: null,
    ebay_marketplace_id: 'EBAY_US',
    gemini_daily_limit: 500,
    handling_days: 2,
    id: 'default',
    incoming_folder_path: '/incoming',
    max_order_syncs_per_day: 25,
    merchant_location_key: 'warehouse-1',
    office_location_name: null,
    processed_folder_path: '/processed',
    r2_retention_days_after_sold: 30,
    updated_at: '2026-05-24T11:00:00.000Z',
    ...overrides,
  };
}

function createDataAccess(listing: ListingRow): SidecarDataAccess {
  return {
    aiModelRoutes: {
      resolveForTask: vi.fn(async () => []),
    },
    aiModelAttempts: {
      create: vi.fn(),
      markFailed: vi.fn(),
      markSucceeded: vi.fn(),
    },
    dailyUsage: {
      getGeminiSummary: vi.fn(),
      incrementGeminiCallsUsed: vi.fn(),
    },
    appSettings: {
      create: vi.fn(),
      get: vi.fn(async () => createAppSettings()),
      update: vi.fn(),
    },
    jobs: {
      claimDueQueued: vi.fn(),
      complete: vi.fn(),
      enqueueGenerateAi: vi.fn(),
      enqueuePublish: vi.fn(),
      fail: vi.fn(),
      getById: vi.fn(),
      listByListingId: vi.fn(),
      listByListingIds: vi.fn(),
      listDueQueued: vi.fn(),
      listStaleRunning: vi.fn(),
      resetForManualRetry: vi.fn(),
      requeue: vi.fn(),
      updateGeminiAttemptAudit: vi.fn(),
      update: vi.fn(),
    },
    listings: {
      claimApprovedForPublish: vi.fn(),
      create: vi.fn(),
      getByListingId: vi.fn(async () => listing),
      getByOfferId: vi.fn(async () => listing),
      listApprovedForExport: vi.fn(),
      list: vi.fn(),
      listByStatus: vi.fn(),
      prepareForGenerateAi: vi.fn(),
      saveImageMetadata: vi.fn(),
      update: vi.fn(async (_listingId: string, changes) => ({
        ...listing,
        ...changes,
      })),
      updateWorkflowState: vi.fn(),
    },
  };
}

describe('reconcilePublishedListing', () => {
  it('marks listing exported when offer read returns listingId', async () => {
    const listing = createListing();
    const dataAccess = createDataAccess(listing);
    const createOffer = vi.fn();
    const createOrReplaceInventoryItem = vi.fn();
    const publishOffer = vi.fn();
    const inventoryApi = {
      createOffer,
      createOrReplaceInventoryItem,
      getOffer: vi.fn(async () => ({
        listingId: 'EBAY-001',
        marketplaceId: 'EBAY_US',
        offerId: 'OFFER-001',
        sku: 'SKU-KEEP',
        status: 'PUBLISHED',
      })),
      publishOffer,
    };

    const result = await reconcilePublishedListing(
      { listingId: 'LIST-001' },
      {
        dataAccess,
        inventoryApi,
        now: () => new Date('2026-05-24T15:30:00.000Z'),
      }
    );

    expect(dataAccess.listings.update).toHaveBeenCalledWith('LIST-001', {
      ebay_listing_id: 'EBAY-001',
      ebay_listing_url: 'https://www.ebay.com/itm/EBAY-001',
      ebay_offer_id: 'OFFER-001',
      exported_at: '2026-05-24T15:30:00.000Z',
      last_error_at: null,
      last_error_code: null,
      last_error_context: {},
      last_error_message: null,
      status: 'exported',
      sub_status: 'idle',
    });
    expect(result.reconciled).toBe(true);
    expect(result.ebayListingId).toBe('EBAY-001');
    expect(result.listing.sku).toBe('SKU-KEEP');
    expect(createOffer).not.toHaveBeenCalled();
    expect(createOrReplaceInventoryItem).not.toHaveBeenCalled();
    expect(publishOffer).not.toHaveBeenCalled();
  });

  it('does not mark listing exported when offer read omits listingId', async () => {
    const listing = createListing();
    const dataAccess = createDataAccess(listing);
    const inventoryApi = {
      getOffer: vi.fn(async () => ({
        marketplaceId: 'EBAY_US',
        offerId: 'OFFER-001',
        sku: 'SKU-KEEP',
        status: 'PUBLISHED',
      })),
    };

    const result = await reconcilePublishedListing(
      { offerId: 'OFFER-001' },
      {
        dataAccess,
        inventoryApi,
        now: () => new Date('2026-05-24T15:30:00.000Z'),
      }
    );

    expect(dataAccess.listings.getByOfferId).toHaveBeenCalledWith('OFFER-001');
    expect(dataAccess.listings.update).not.toHaveBeenCalled();
    expect(result.reconciled).toBe(false);
    expect(result.ebayListingId).toBeNull();
    expect(result.reason).toBe('Offer "OFFER-001" is published externally but did not expose listingId.');
  });

  it('uses neutral reason when offer status is not published', async () => {
    const listing = createListing();
    const dataAccess = createDataAccess(listing);
    const inventoryApi = {
      getOffer: vi.fn(async () => ({
        marketplaceId: 'EBAY_US',
        offerId: 'OFFER-001',
        sku: 'SKU-KEEP',
        status: 'UNPUBLISHED',
      })),
    };

    const result = await reconcilePublishedListing(
      { offerId: 'OFFER-001' },
      {
        dataAccess,
        inventoryApi,
        now: () => new Date('2026-05-24T15:30:00.000Z'),
      }
    );

    expect(result.reconciled).toBe(false);
    expect(result.reason).toBe('Offer "OFFER-001" did not expose listingId.');
  });

  it('fails loudly when duplicate local rows are found for one offer id', async () => {
    const listing = createListing();
    const dataAccess = createDataAccess(listing);
    dataAccess.listings.getByOfferId = vi.fn(async () => {
      throw new Error('Multiple local listings found for ebay_offer_id "OFFER-001".');
    });

    await expect(
      reconcilePublishedListing(
        { offerId: 'OFFER-001' },
        {
          dataAccess,
          inventoryApi: {
            getOffer: vi.fn(),
          },
          now: () => new Date('2026-05-24T15:30:00.000Z'),
        }
      )
    ).rejects.toThrow('Multiple local listings found for ebay_offer_id "OFFER-001".');
    expect(dataAccess.listings.update).not.toHaveBeenCalled();
  });
});
