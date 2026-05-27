import { describe, expect, it, vi } from 'vitest';
import type { AppSettingsRow, ListingRow } from '@ebay-inventory/data';
import type { SidecarDataAccess } from '@/data/sidecar-data.js';
import { publishListing } from '@/ebay/publish-listing.js';
import {
  PublishListingValidationError,
} from '@/ebay/publish-validation.js';
import type { PublishListingError } from '@/ebay/publish-validation.js';

function createListing(overrides: Partial<ListingRow> = {}): ListingRow {
  return {
    approved_for_export_at: '2026-05-24T12:00:00.000Z',
    capture_mode: null,
    category_id: '1234',
    condition_id: '4000',
    condition_notes: 'Minor wear.',
    created_at: '2026-05-24T10:00:00.000Z',
    description: 'Detailed listing description.',
    ebay_listing_id: null,
    ebay_listing_status: null,
    ebay_listing_url: null,
    ebay_offer_id: null,
    ese_eligible: null,
    estimated_weight_oz: 8,
    exported_at: null,
    generated_at: '2026-05-24T11:00:00.000Z',
    handling_days: 2,
    id: 'row-1',
    image_urls: ['https://cdn.example.com/front.jpg'],
    item_specifics: {
      Brand: 'Acme',
    },
    last_error_at: null,
    last_error_code: null,
    last_error_context: {},
    last_error_message: null,
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
    sku: null,
    sold_at: null,
    status: 'approved_for_export',
    sub_status: 'publish_queued',
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

function createDependencies({
  appSettings = createAppSettings(),
  createOfferResult = { offerId: 'OFFER-001' },
  listing = createListing(),
  publishOfferResult = { listingId: 'EBAY-001' },
}: {
  appSettings?: AppSettingsRow | null;
  createOfferResult?: { offerId?: string };
  listing?: ListingRow | null;
  publishOfferResult?: { listingId?: string };
} = {}): {
  dataAccess: SidecarDataAccess;
  inventoryApi: {
    createOffer: ReturnType<typeof vi.fn>;
    createOrReplaceInventoryItem: ReturnType<typeof vi.fn>;
    publishOffer: ReturnType<typeof vi.fn>;
  };
  listingUpdates: { listingId: string; changes: Partial<ListingRow> }[];
  now: () => Date;
} {
  const inventoryApi = {
    createOffer: vi.fn(async () => createOfferResult),
    createOrReplaceInventoryItem: vi.fn(async () => undefined),
    publishOffer: vi.fn(async () => publishOfferResult),
  };

  const listingsGetByListingId = vi.fn(async () => listing);
  const appSettingsGet = vi.fn(async () => appSettings);
  const listingsUpdateWorkflowState = vi.fn(async (input: {
    listingId: string;
    status: string;
    subStatus: string;
  }) => ({
    ...(listing ?? createListing()),
    listing_id: input.listingId,
    status: input.status,
    sub_status: input.subStatus,
  }));
  const listingUpdates: { listingId: string; changes: Partial<ListingRow> }[] = [];
  const listingsUpdate = vi.fn(async (currentListingId: string, changes: Partial<ListingRow>) => {
    listingUpdates.push({
      listingId: currentListingId,
      changes,
    });

    return {
      ...(listing ?? createListing()),
      ...changes,
      listing_id: currentListingId,
    } as ListingRow;
  });

  const dataAccess: SidecarDataAccess = {
    appSettings: {
      create: vi.fn(),
      get: appSettingsGet,
      update: vi.fn(),
    },
    jobs: {
      claimDueQueued: vi.fn(),
      complete: vi.fn(),
      create: vi.fn(),
      enqueueGenerateAi: vi.fn(),
      enqueueProcessImages: vi.fn(),
      enqueuePublish: vi.fn(),
      fail: vi.fn(),
      getActiveGenerateAiByListingId: vi.fn(),
      getById: vi.fn(),
      listByListingId: vi.fn(),
      listDueQueued: vi.fn(),
      listStaleRunning: vi.fn(),
      requeue: vi.fn(),
      update: vi.fn(),
    },
    listings: {
      claimApprovedForPublish: vi.fn(),
      create: vi.fn(),
      getByListingId: listingsGetByListingId,
      listApprovedForExport: vi.fn(async () => []),
      list: vi.fn(),
      listByStatus: vi.fn(),
      markPublishFailed: vi.fn(),
      saveImageMetadata: vi.fn(),
      update: listingsUpdate,
      updateWorkflowState: listingsUpdateWorkflowState,
    },
    orders: {
      create: vi.fn(),
      getByOrderId: vi.fn(),
      update: vi.fn(),
    },
  };

  return {
    dataAccess,
    inventoryApi,
    listingUpdates,
    now: () => new Date('2026-05-24T15:30:00.000Z'),
  };
}

describe('publishListing', () => {
  it('runs happy path orchestration and persists exported state', async () => {
    const dependencies = createDependencies();

    const result = await publishListing('LIST-001', dependencies);

    expect(dependencies.inventoryApi.createOrReplaceInventoryItem).toHaveBeenCalledWith(
      'LIST-001',
      expect.objectContaining({
        product: expect.objectContaining({
          title: 'Vintage puzzle',
        }),
      })
    );
    expect(dependencies.inventoryApi.createOffer).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantLocationKey: 'warehouse-1',
        sku: 'LIST-001',
      })
    );
    expect(dependencies.inventoryApi.publishOffer).toHaveBeenCalledWith('OFFER-001');
    expect(dependencies.dataAccess.listings.updateWorkflowState).not.toHaveBeenCalled();
    expect(dependencies.listingUpdates).toEqual([
      {
        listingId: 'LIST-001',
        changes: {
          sku: 'LIST-001',
        },
      },
      {
        listingId: 'LIST-001',
        changes: {
          ebay_offer_id: 'OFFER-001',
          sku: 'LIST-001',
        },
      },
      {
        listingId: 'LIST-001',
        changes: {
          ebay_listing_id: 'EBAY-001',
          ebay_listing_url: 'https://www.ebay.com/itm/EBAY-001',
          ebay_offer_id: 'OFFER-001',
          exported_at: '2026-05-24T15:30:00.000Z',
          last_error_at: null,
          last_error_code: null,
          last_error_context: null,
          last_error_message: null,
          sku: 'LIST-001',
          status: 'exported',
          sub_status: 'idle',
        },
      },
    ]);
    expect(result).toEqual({
      ebayListingId: 'EBAY-001',
      exportedAt: '2026-05-24T15:30:00.000Z',
      listingId: 'LIST-001',
      offerId: 'OFFER-001',
      reusedExistingOffer: false,
      sku: 'LIST-001',
      status: 'exported',
    });
  });

  it.each([
    {
      appSettings: {
        ebay_marketplace_id: null,
      },
      issues: ['app_settings.ebay_marketplace_id is required for publish.'],
      label: 'missing marketplace',
    },
    {
      appSettings: {
        default_payment_policy_id: '   ',
      },
      issues: ['app_settings.default_payment_policy_id is required for publish.'],
      label: 'blank payment policy',
    },
    {
      appSettings: {
        default_fulfillment_policy_id: '   ',
      },
      issues: ['app_settings.default_fulfillment_policy_id is required for publish.'],
      label: 'blank fulfillment policy',
    },
    {
      appSettings: {
        default_return_policy_id: '   ',
      },
      issues: ['app_settings.default_return_policy_id is required for publish.'],
      label: 'blank return policy',
    },
    {
      appSettings: {
        merchant_location_key: '   ',
      },
      issues: ['app_settings.merchant_location_key is required for publish.'],
      label: 'blank merchant location',
    },
    {
      appSettings: {
        default_fulfillment_policy_id: 'mock-fulfillment-policy-id',
        default_payment_policy_id: 'mock-payment-policy-id',
        default_return_policy_id: 'mock-return-policy-id',
        merchant_location_key: 'default-main-location',
      },
      issues: [
        'app_settings.default_payment_policy_id "mock-payment-policy-id" is a placeholder. Run sandbox policy diagnostics and update app_settings.default before publish.',
        'app_settings.default_fulfillment_policy_id "mock-fulfillment-policy-id" is a placeholder. Run sandbox policy diagnostics and update app_settings.default before publish.',
        'app_settings.default_return_policy_id "mock-return-policy-id" is a placeholder. Run sandbox policy diagnostics and update app_settings.default before publish.',
        'app_settings.merchant_location_key "default-main-location" looks like a placeholder. Run sandbox location diagnostics and update app_settings.default before publish.',
      ],
      label: 'default-main-location with mock policies',
    },
  ])(
    'blocks publish before createOffer when app settings are invalid: $label',
    async ({ appSettings, issues }) => {
      const dependencies = createDependencies({
        appSettings: createAppSettings(appSettings),
      });

      await expect(publishListing('LIST-001', dependencies)).rejects.toMatchObject({
        code: 'LISTING_NOT_READY',
        context: {
          issues: expect.arrayContaining(issues),
          listingId: 'LIST-001',
          stage: 'validate',
        },
      });
      expect(dependencies.inventoryApi.createOrReplaceInventoryItem).not.toHaveBeenCalled();
      expect(dependencies.inventoryApi.createOffer).not.toHaveBeenCalled();
      expect(dependencies.inventoryApi.publishOffer).not.toHaveBeenCalled();
    }
  );

  it('aggregates missing listing fields before any inventory api calls', async () => {
    const dependencies = createDependencies({
      listing: createListing({
        category_id: '   ',
        condition_id: '  ',
        image_urls: ['   '],
        price: 0,
        title: '   ',
      }),
    });

    await expect(publishListing('LIST-001', dependencies)).rejects.toMatchObject({
      code: 'LISTING_NOT_READY',
      context: {
        issues: [
          'Listing "LIST-001" is missing title.',
          'Listing "LIST-001" is missing category_id.',
          'Listing "LIST-001" is missing condition_id.',
          'Listing "LIST-001" must include at least one image URL for publish.',
          'Listing "LIST-001" contains blank image_urls entries.',
          'Listing "LIST-001" is missing a valid price.',
        ],
        listingId: 'LIST-001',
        stage: 'validate',
      },
    });
    expect(dependencies.inventoryApi.createOrReplaceInventoryItem).not.toHaveBeenCalled();
    expect(dependencies.inventoryApi.createOffer).not.toHaveBeenCalled();
    expect(dependencies.inventoryApi.publishOffer).not.toHaveBeenCalled();
  });

  it('rejects unsupported condition ids before any inventory api calls', async () => {
    const dependencies = createDependencies({
      listing: createListing({
        condition_id: '3000',
      }),
    });

    await expect(publishListing('LIST-001', dependencies)).rejects.toMatchObject({
      code: 'LISTING_NOT_READY',
      context: {
        issues: [
          'Listing "LIST-001" has unsupported condition_id "3000" for Inventory API mapping.',
        ],
        listingId: 'LIST-001',
        stage: 'validate',
      },
    });
    expect(dependencies.inventoryApi.createOrReplaceInventoryItem).not.toHaveBeenCalled();
    expect(dependencies.inventoryApi.createOffer).not.toHaveBeenCalled();
    expect(dependencies.inventoryApi.publishOffer).not.toHaveBeenCalled();
  });

  it('rejects listings with blank fallback sku source', async () => {
    const dependencies = createDependencies({
      listing: createListing({
        listing_id: '   ',
        sku: null,
      }),
    });

    await expect(publishListing('LIST-001', dependencies)).rejects.toMatchObject({
      context: {
        issues: ['Listing is missing listing_id required for publish SKU.'],
        listingId: '   ',
      },
    });
    expect(dependencies.inventoryApi.createOrReplaceInventoryItem).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'null', price: null },
    { label: 'zero', price: 0 },
    { label: 'negative', price: -1 },
    { label: 'infinite', price: Number.POSITIVE_INFINITY },
    { label: 'nan', price: Number.NaN },
  ])('rejects $label price values before publish', async ({ price }) => {
    const dependencies = createDependencies({
      listing: createListing({
        price,
      }),
    });

    await expect(publishListing('LIST-001', dependencies)).rejects.toMatchObject({
      context: {
        issues: ['Listing "LIST-001" is missing a valid price.'],
      },
    });
    expect(dependencies.inventoryApi.createOrReplaceInventoryItem).not.toHaveBeenCalled();
  });

  it('rejects empty image url arrays before publish', async () => {
    const dependencies = createDependencies({
      listing: createListing({
        image_urls: [],
      }),
    });

    await expect(publishListing('LIST-001', dependencies)).rejects.toMatchObject({
      context: {
        issues: ['Listing "LIST-001" must include at least one image URL for publish.'],
      },
    });
    expect(dependencies.inventoryApi.createOrReplaceInventoryItem).not.toHaveBeenCalled();
  });

  it('rejects listings outside approved_for_export status', async () => {
    const dependencies = createDependencies({
      listing: createListing({
        status: 'needs_review',
        sub_status: 'review_pending',
      }),
    });

    await expect(publishListing('LIST-001', dependencies)).rejects.toThrow(
      PublishListingValidationError
    );
    expect(dependencies.dataAccess.listings.updateWorkflowState).not.toHaveBeenCalled();
  });

  it('wraps inventory item failures without requeueing publish state internally', async () => {
    const dependencies = createDependencies();
    dependencies.inventoryApi.createOrReplaceInventoryItem = vi.fn(async () => {
      throw new Error('inventory unavailable');
    });

    await expect(publishListing('LIST-001', dependencies)).rejects.toMatchObject({
      code: 'INVENTORY_ITEM_UPSERT_FAILED',
      context: {
        listingId: 'LIST-001',
        stage: 'inventory_item',
      },
    } satisfies Partial<PublishListingError>);
    expect(dependencies.listingUpdates).toEqual([]);
  });

  it('wraps offer creation failures after persisting sku only', async () => {
    const dependencies = createDependencies();
    dependencies.inventoryApi.createOffer = vi.fn(async () => {
      throw new Error('offer create failed');
    });

    await expect(publishListing('LIST-001', dependencies)).rejects.toMatchObject({
      code: 'OFFER_CREATE_FAILED',
      context: {
        listingId: 'LIST-001',
        stage: 'offer',
      },
    } satisfies Partial<PublishListingError>);
    expect(dependencies.listingUpdates).toEqual([
      {
        listingId: 'LIST-001',
        changes: {
          sku: 'LIST-001',
        },
      },
    ]);
  });

  it('wraps publishOffer failures and preserves offer id for retry safety', async () => {
    const dependencies = createDependencies();
    dependencies.inventoryApi.publishOffer = vi.fn(async () => {
      throw new Error('publish failed');
    });

    await expect(publishListing('LIST-001', dependencies)).rejects.toMatchObject({
      code: 'OFFER_PUBLISH_FAILED',
      context: {
        listingId: 'LIST-001',
        stage: 'publish',
      },
    } satisfies Partial<PublishListingError>);
    expect(dependencies.listingUpdates).toEqual([
      {
        listingId: 'LIST-001',
        changes: {
          sku: 'LIST-001',
        },
      },
      {
        listingId: 'LIST-001',
        changes: {
          ebay_offer_id: 'OFFER-001',
          sku: 'LIST-001',
        },
      },
    ]);
  });

  it('raises explicit finalization errors when publish succeeds but exported state persistence fails', async () => {
    const dependencies = createDependencies();
    dependencies.dataAccess.listings.update = vi.fn(
      async (currentListingId: string, changes: Partial<ListingRow>) => {
        dependencies.listingUpdates.push({
          listingId: currentListingId,
          changes,
        });

        if ('status' in changes && changes.status === 'exported') {
          throw new Error('write failed');
        }

        return {
          listing_id: currentListingId,
          ...(dependencies.listingUpdates.length > 0 ? createListing() : {}),
          ...changes,
        } as ListingRow;
      }
    );

    await expect(publishListing('LIST-001', dependencies)).rejects.toMatchObject({
      code: 'EXPORT_STATE_PERSIST_FAILED',
      context: {
        listingId: 'LIST-001',
        stage: 'finalize',
      },
    } satisfies Partial<PublishListingError>);
    expect(dependencies.listingUpdates).toEqual([
      {
        listingId: 'LIST-001',
        changes: {
          sku: 'LIST-001',
        },
      },
      {
        listingId: 'LIST-001',
        changes: {
          ebay_offer_id: 'OFFER-001',
          sku: 'LIST-001',
        },
      },
      {
        listingId: 'LIST-001',
        changes: {
          ebay_listing_id: 'EBAY-001',
          ebay_listing_url: 'https://www.ebay.com/itm/EBAY-001',
          ebay_offer_id: 'OFFER-001',
          exported_at: '2026-05-24T15:30:00.000Z',
          last_error_at: null,
          last_error_code: null,
          last_error_context: null,
          last_error_message: null,
          sku: 'LIST-001',
          status: 'exported',
          sub_status: 'idle',
        },
      },
    ]);
  });

  it('reuses existing offer ids instead of creating duplicate offers on retry', async () => {
    const dependencies = createDependencies({
      listing: createListing({
        ebay_offer_id: 'OFFER-EXISTING',
        sku: 'SKU-001',
      }),
    });

    const result = await publishListing('LIST-001', dependencies);

    expect(dependencies.inventoryApi.createOffer).not.toHaveBeenCalled();
    expect(dependencies.inventoryApi.publishOffer).toHaveBeenCalledWith('OFFER-EXISTING');
    expect(result.reusedExistingOffer).toBe(true);
    expect(result.offerId).toBe('OFFER-EXISTING');
  });

  it('does not overwrite existing listing identifiers when publish response omits them', async () => {
    const dependencies = createDependencies({
      listing: createListing({
        ebay_listing_id: 'EBAY-EXISTING',
        ebay_listing_url: 'https://www.ebay.com/itm/EBAY-EXISTING',
        ebay_offer_id: 'OFFER-EXISTING',
      }),
      publishOfferResult: {},
    });

    const result = await publishListing('LIST-001', dependencies);

    expect(dependencies.listingUpdates).toEqual([
      {
        listingId: 'LIST-001',
        changes: {
          sku: 'LIST-001',
        },
      },
      {
        listingId: 'LIST-001',
        changes: {
          ebay_offer_id: 'OFFER-EXISTING',
          exported_at: '2026-05-24T15:30:00.000Z',
          last_error_at: null,
          last_error_code: null,
          last_error_context: null,
          last_error_message: null,
          sku: 'LIST-001',
          status: 'exported',
          sub_status: 'idle',
        },
      },
    ]);
    expect(result.ebayListingId).toBe('EBAY-EXISTING');
  });

  it('raises not found errors when listing is missing', async () => {
    const dependencies = createDependencies({
      listing: null,
    });

    await expect(publishListing('LIST-404', dependencies)).rejects.toMatchObject({
      code: 'LISTING_NOT_FOUND',
      context: {
        listingId: 'LIST-404',
        stage: 'load',
      },
    } satisfies Partial<PublishListingError>);
  });

  it('raises missing app settings errors before any api calls', async () => {
    const dependencies = createDependencies({
      appSettings: null,
    });

    await expect(publishListing('LIST-001', dependencies)).rejects.toMatchObject({
      code: 'APP_SETTINGS_NOT_FOUND',
      context: {
        listingId: 'LIST-001',
        stage: 'load',
      },
    } satisfies Partial<PublishListingError>);
    expect(dependencies.inventoryApi.createOrReplaceInventoryItem).not.toHaveBeenCalled();
  });
});
