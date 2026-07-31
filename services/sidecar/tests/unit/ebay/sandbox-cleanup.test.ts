import { EbayApiRequestError } from '@/api/client.js';
import type { ListingRow } from '@ebay-inventory/data';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SidecarDataAccess } from '@/data/sidecar-data.js';

const getInventoryItemsMock = vi.fn();
const getInventoryItemMock = vi.fn();
const getOffersMock = vi.fn();
const deleteOfferMock = vi.fn();
const deleteInventoryItemMock = vi.fn();
const endListingMock = vi.fn();

function createOfferUnavailableError(): EbayApiRequestError {
  return new EbayApiRequestError(
    'eBay API Error: This Offer is not available',
    [
      {
        category: 'System',
        domain: 'API_INVENTORY',
        errorId: 25713,
        message: 'This Offer is not available',
      },
    ],
    404
  );
}

function createApiMock(): {
  inventory: {
    deleteInventoryItem: typeof deleteInventoryItemMock;
    deleteOffer: typeof deleteOfferMock;
    getInventoryItem: typeof getInventoryItemMock;
    getInventoryItems: typeof getInventoryItemsMock;
    getOffers: typeof getOffersMock;
  };
  trading: {
    endListing: typeof endListingMock;
  };
} {
  return {
    inventory: {
      deleteInventoryItem: deleteInventoryItemMock,
      deleteOffer: deleteOfferMock,
      getInventoryItem: getInventoryItemMock,
      getInventoryItems: getInventoryItemsMock,
      getOffers: getOffersMock,
    },
    trading: {
      endListing: endListingMock,
    },
  };
}

const exportedListing = {
  approved_for_export_at: '2026-07-30T12:00:00.000Z',
  ebay_listing_id: 'LISTING-1',
  ebay_listing_status: 'ACTIVE',
  ebay_listing_url: 'https://sandbox.ebay.com/itm/LISTING-1',
  ebay_offer_id: 'OFFER-1',
  exported_at: '2026-07-30T12:01:00.000Z',
  listing_id: 'Single-000001',
  r2_object_keys: [' listings/Single-000001/front.jpg ', 'listings/Single-000001/back.jpg'],
  sku: 'BSKBL-Single-000001',
  sold_at: null,
  status: 'exported',
  updated_at: '2026-07-30T12:02:00.000Z',
} as ListingRow;

function createCleanupDataAccess(currentListing: ListingRow | null = exportedListing) {
  return {
    appSettings: {
      get: vi.fn(async () => ({ processed_folder_path: '/processed' })),
    },
    jobs: {
      listByListingId: vi.fn(async () => []),
    },
    listings: {
      deleteSandboxCleaned: vi.fn(async () => currentListing),
      getBySku: vi.fn(async () => currentListing),
    },
    orders: {
      hasByListingId: vi.fn(async () => false),
    },
  } as unknown as SidecarDataAccess;
}

function expectNoCleanupMutations(
  dataAccess: SidecarDataAccess,
  deleteObjects: ReturnType<typeof vi.fn>,
  removeDirectory: ReturnType<typeof vi.fn>
): void {
  expect(endListingMock).not.toHaveBeenCalled();
  expect(deleteOfferMock).not.toHaveBeenCalled();
  expect(deleteInventoryItemMock).not.toHaveBeenCalled();
  expect(deleteObjects).not.toHaveBeenCalled();
  expect(removeDirectory).not.toHaveBeenCalled();
  expect(dataAccess.listings.deleteSandboxCleaned).not.toHaveBeenCalled();
}

describe('sandbox cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.EBAY_ENVIRONMENT = 'sandbox';

    getInventoryItemsMock.mockResolvedValue({
      inventoryItems: [
        { sku: 'BSKBL-Single-000002' },
        { sku: 'Keep-300' },
        { sku: 'BSKBL-Single-000001' },
      ],
      total: 3,
    });

    getInventoryItemMock.mockImplementation(async (sku: string) => ({ sku }));
    getOffersMock.mockImplementation(async (sku: string) => ({
      offers:
        sku === 'BSKBL-Single-000001' ? [{ offerId: 'OFFER-1', sku, status: 'PUBLISHED' }] : [],
      total: sku === 'BSKBL-Single-000001' ? 1 : 0,
    }));

    deleteOfferMock.mockResolvedValue(undefined);
    deleteInventoryItemMock.mockResolvedValue(undefined);
    endListingMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.EBAY_ENVIRONMENT;
  });

  it('refuses to run in production', async () => {
    process.env.EBAY_ENVIRONMENT = 'production';

    const { resolveSandboxCleanupPlan } = await import('@/ebay/sandbox-cleanup.js');

    await expect(
      resolveSandboxCleanupPlan(
        {
          prefixes: ['BSKBL-Single-'],
        },
        {
          api: createApiMock() as never,
        }
      )
    ).rejects.toThrow('EBAY_ENVIRONMENT must be set to "sandbox" before running sandbox cleanup.');
    expect(getInventoryItemsMock).not.toHaveBeenCalled();
    expect(getOffersMock).not.toHaveBeenCalled();
  });

  it('rejects destructive cleanup without explicit confirmation', async () => {
    const { runSandboxCleanup } = await import('@/ebay/sandbox-cleanup.js');

    await expect(
      runSandboxCleanup(
        {
          delete: true,
          skus: ['BSKBL-Single-000001'],
        },
        {
          api: createApiMock() as never,
        }
      )
    ).rejects.toThrow('Destructive sandbox cleanup requires --confirm-sandbox-cleanup.');
  });

  it('rejects local listing IDs and unstructured range prefixes', async () => {
    const { resolveSandboxCleanupCandidateSelection } = await import('@/ebay/sandbox-cleanup.js');

    expect(() => resolveSandboxCleanupCandidateSelection({ skus: ['Single-000016'] })).toThrow(
      'Local listing IDs such as Single-000016 are not accepted.'
    );
    expect(() =>
      resolveSandboxCleanupCandidateSelection({
        from: 1,
        prefixes: ['Single-'],
        to: 2,
      })
    ).toThrow('--prefix must be a canonical structured SKU prefix');
  });

  it('rejects bare cleanup and prefix-only cleanup', async () => {
    const { runSandboxCleanup } = await import('@/ebay/sandbox-cleanup.js');

    await expect(
      runSandboxCleanup(
        {},
        {
          api: createApiMock() as never,
        }
      )
    ).rejects.toThrow(
      'Broad inventory-list cleanup mode is disabled because the eBay sandbox inventory list endpoint is unreliable.'
    );

    await expect(
      runSandboxCleanup(
        {
          prefixes: ['BSKBL-Single-'],
        },
        {
          api: createApiMock() as never,
        }
      )
    ).rejects.toThrow(
      'Broad inventory-list cleanup mode is disabled because the eBay sandbox inventory list endpoint is unreliable.'
    );
  });

  it('builds zero-padded range candidates and skips inventory list lookup', async () => {
    const { resolveSandboxCleanupPlan } = await import('@/ebay/sandbox-cleanup.js');

    const plan = await resolveSandboxCleanupPlan(
      {
        from: 1,
        prefixes: ['BSKBL-Single-'],
        to: 3,
      },
      {
        api: createApiMock() as never,
      }
    );

    expect(getInventoryItemsMock).not.toHaveBeenCalled();
    expect(getOffersMock).toHaveBeenNthCalledWith(1, 'BSKBL-Single-000001');
    expect(getOffersMock).toHaveBeenNthCalledWith(2, 'BSKBL-Single-000002');
    expect(getOffersMock).toHaveBeenNthCalledWith(3, 'BSKBL-Single-000003');
    expect(plan.candidateSkus).toEqual([
      'BSKBL-Single-000001',
      'BSKBL-Single-000002',
      'BSKBL-Single-000003',
    ]);
    expect(plan.candidateCount).toBe(3);
  });

  it('supports multiple prefixes in generated range mode', async () => {
    const { resolveSandboxCleanupPlan } = await import('@/ebay/sandbox-cleanup.js');

    const plan = await resolveSandboxCleanupPlan(
      {
        from: 1,
        prefixes: ['BSKBL-Single-', 'OTHER-Lot-'],
        to: 2,
      },
      {
        api: createApiMock() as never,
      }
    );

    expect(plan.candidateSkus).toEqual([
      'BSKBL-Single-000001',
      'BSKBL-Single-000002',
      'OTHER-Lot-000001',
      'OTHER-Lot-000002',
    ]);
    expect(getOffersMock).toHaveBeenCalledTimes(4);
  });

  it('supports explicit sku mode', async () => {
    const { resolveSandboxCleanupPlan } = await import('@/ebay/sandbox-cleanup.js');

    const plan = await resolveSandboxCleanupPlan(
      {
        skus: ['BSKBL-Single-000001', 'OTHER-Lot-000002'],
      },
      {
        api: createApiMock() as never,
      }
    );

    expect(plan.sourceMode).toBe('sku');
    expect(plan.candidateSkus).toEqual(['BSKBL-Single-000001', 'OTHER-Lot-000002']);
    expect(getInventoryItemsMock).not.toHaveBeenCalled();
    expect(getOffersMock).toHaveBeenNthCalledWith(1, 'BSKBL-Single-000001');
    expect(getOffersMock).toHaveBeenNthCalledWith(2, 'OTHER-Lot-000002');
  });

  it('rejects explicit sku mode combined with range args', async () => {
    const { resolveSandboxCleanupPlan } = await import('@/ebay/sandbox-cleanup.js');

    await expect(
      resolveSandboxCleanupPlan(
        {
          from: 1,
          skus: ['BSKBL-Single-000001'],
          to: 2,
        },
        {
          api: createApiMock() as never,
        }
      )
    ).rejects.toThrow('--sku cannot be combined with --prefix, --from, or --to.');
    expect(getInventoryItemsMock).not.toHaveBeenCalled();
    expect(getOffersMock).not.toHaveBeenCalled();
  });

  it('separates found and missing skus in generated range dry-run output', async () => {
    getOffersMock.mockImplementation(async (sku: string) => {
      if (sku === 'BSKBL-Single-000001') {
        return {
          offers: [
            {
              offerId: 'OFFER-1',
              sku,
              status: 'PUBLISHED',
            },
          ],
          total: 1,
        };
      }

      if (sku === 'BSKBL-Single-000002') {
        return {
          offers: [],
          total: 0,
        };
      }

      if (sku === 'BSKBL-Single-000003') {
        throw createOfferUnavailableError();
      }

      return {
        offers: [],
        total: 0,
      };
    });

    getInventoryItemMock.mockImplementation(async (sku: string) => {
      if (sku === 'BSKBL-Single-000002') {
        return { sku };
      }

      if (sku === 'BSKBL-Single-000003') {
        throw createOfferUnavailableError();
      }

      return { sku };
    });

    const { runSandboxCleanup } = await import('@/ebay/sandbox-cleanup.js');
    const report = await runSandboxCleanup(
      {
        from: 1,
        prefixes: ['BSKBL-Single-'],
        to: 3,
      },
      {
        api: createApiMock() as never,
      }
    );

    expect(report.mode).toBe('dry-run');
    expect(report.candidateSkus).toEqual([
      'BSKBL-Single-000001',
      'BSKBL-Single-000002',
      'BSKBL-Single-000003',
    ]);
    expect(report.foundSkus).toEqual(['BSKBL-Single-000001', 'BSKBL-Single-000002']);
    expect(report.missingSkus).toEqual(['BSKBL-Single-000003']);
    expect(report.offersBySku['BSKBL-Single-000001']).toHaveLength(1);
    expect(report.offersBySku['BSKBL-Single-000002']).toHaveLength(0);
    expect(report.offersBySku['BSKBL-Single-000003']).toHaveLength(0);
    expect(report.sourceMode).toBe('range');
    expect(getInventoryItemsMock).not.toHaveBeenCalled();
    expect(getInventoryItemMock).toHaveBeenCalledTimes(2);
    expect(getInventoryItemMock).toHaveBeenNthCalledWith(1, 'BSKBL-Single-000002');
    expect(getInventoryItemMock).toHaveBeenNthCalledWith(2, 'BSKBL-Single-000003');
  });

  it('rejects invalid ranges and large generated ranges without override', async () => {
    const { resolveSandboxCleanupPlan } = await import('@/ebay/sandbox-cleanup.js');

    await expect(
      resolveSandboxCleanupPlan(
        {
          from: 0,
          prefixes: ['BSKBL-Single-'],
          to: 1,
        },
        {
          api: createApiMock() as never,
        }
      )
    ).rejects.toThrow('--from must be a positive integer.');

    await expect(
      resolveSandboxCleanupPlan(
        {
          from: 5,
          prefixes: ['BSKBL-Single-'],
          to: 4,
        },
        {
          api: createApiMock() as never,
        }
      )
    ).rejects.toThrow('--to must be greater than or equal to --from.');

    await expect(
      resolveSandboxCleanupPlan(
        {
          from: 1,
          to: 2,
        },
        {
          api: createApiMock() as never,
        }
      )
    ).rejects.toThrow('--prefix is required when using --from/--to.');

    await expect(
      resolveSandboxCleanupPlan(
        {
          from: 1,
          prefixes: ['BSKBL-Single-'],
          to: 501,
        },
        {
          api: createApiMock() as never,
        }
      )
    ).rejects.toThrow('Generated SKU range would create 501 candidates. Limit is 500.');
  });

  it('allows large generated ranges when explicitly overridden', async () => {
    getOffersMock.mockResolvedValue({ offers: [], total: 0 });
    getInventoryItemMock.mockResolvedValue({ sku: 'BSKBL-Single-000001' });

    const { resolveSandboxCleanupPlan } = await import('@/ebay/sandbox-cleanup.js');
    const plan = await resolveSandboxCleanupPlan(
      {
        allowLargeRange: true,
        from: 1,
        prefixes: ['BSKBL-Single-'],
        to: 501,
      },
      {
        api: createApiMock() as never,
      }
    );

    expect(plan.candidateCount).toBe(501);
    expect(getOffersMock).toHaveBeenCalledTimes(501);
  });

  it('deletes published offers and inventory items in destructive mode', async () => {
    getOffersMock.mockResolvedValue({
      offers: [
        {
          listing: { listingId: 'LIST-1' },
          offerId: 'OFFER-1',
          sku: 'BSKBL-Single-000001',
          status: 'PUBLISHED',
        },
      ],
      total: 1,
    });

    const { runSandboxCleanup } = await import('@/ebay/sandbox-cleanup.js');
    const report = await runSandboxCleanup(
      {
        confirmSandboxCleanup: true,
        delete: true,
        skus: ['BSKBL-Single-000001'],
      },
      {
        api: createApiMock() as never,
      }
    );

    expect(endListingMock).toHaveBeenCalledWith('LIST-1');
    expect(deleteOfferMock).toHaveBeenCalledWith('OFFER-1');
    expect(deleteInventoryItemMock).toHaveBeenCalledWith('BSKBL-Single-000001');
    expect(report.mode).toBe('delete');
    expect(report.success).toBe(true);
    expect(report.outcomes[0].status).toBe('deleted');
  });
});

describe('shared sandbox listing cleanup orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.EBAY_ENVIRONMENT = 'sandbox';
    getOffersMock.mockResolvedValue({
      offers: [
        {
          listing: { listingId: 'LISTING-1' },
          offerId: 'OFFER-1',
          sku: exportedListing.sku,
          status: 'PUBLISHED',
        },
      ],
      total: 1,
    });
    getInventoryItemMock.mockImplementation(async (sku: string) => ({ sku }));
    deleteOfferMock.mockResolvedValue(undefined);
    deleteInventoryItemMock.mockResolvedValue(undefined);
    endListingMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.EBAY_ENVIRONMENT;
  });

  it('uses one remote-then-local path and returns the stable UI payload', async () => {
    const calls: string[] = [];
    const dataAccess = createCleanupDataAccess();
    endListingMock.mockImplementation(async () => {
      calls.push('end-listing');
    });
    deleteOfferMock.mockImplementation(async () => {
      calls.push('delete-offer');
    });
    deleteInventoryItemMock.mockImplementation(async () => {
      calls.push('delete-inventory');
    });
    dataAccess.listings.deleteSandboxCleaned = vi.fn(async () => {
      calls.push('database');
      return exportedListing;
    });

    const { deleteSandboxListingById } = await import('@/listings/delete-sandbox-listing.js');
    const result = await deleteSandboxListingById(
      {
        expectedSku: exportedListing.sku!,
        expectedUpdatedAt: exportedListing.updated_at,
        listingId: exportedListing.listing_id,
      },
      {
        api: createApiMock() as never,
        dataAccess,
        deleteObjects: vi.fn(async () => {
          calls.push('r2');
        }),
        env: process.env,
        removeDirectory: vi.fn(async () => {
          calls.push('filesystem');
        }),
      }
    );

    expect(result).toEqual({
      deleted: true,
      listingId: 'Single-000001',
      localOutcome: {
        databaseDeleted: true,
        r2ObjectCount: 2,
        status: 'deleted',
        watcherDirectoryRemoved: true,
      },
      remoteOutcome: {
        deletedInventoryItem: true,
        deletedOfferCount: 1,
        endedListingCount: 1,
        missingResourceCount: 0,
        status: 'deleted',
      },
      sku: 'BSKBL-Single-000001',
    });
    expect(dataAccess.listings.deleteSandboxCleaned).toHaveBeenCalledWith({
      expectedSku: 'BSKBL-Single-000001',
      expectedUpdatedAt: '2026-07-30T12:02:00.000Z',
      listingId: 'Single-000001',
    });
    expect(calls).toEqual([
      'end-listing',
      'delete-offer',
      'delete-inventory',
      'r2',
      'filesystem',
      'database',
    ]);
  });

  it('deletes inventory found after an offers 404 before purging local state', async () => {
    getOffersMock.mockRejectedValue(createOfferUnavailableError());
    const calls: string[] = [];
    const dataAccess = createCleanupDataAccess();
    deleteInventoryItemMock.mockImplementation(async () => {
      calls.push('delete-inventory');
    });
    dataAccess.listings.deleteSandboxCleaned = vi.fn(async () => {
      calls.push('database');
      return exportedListing;
    });
    const { deleteSandboxListingById } = await import('@/listings/delete-sandbox-listing.js');

    const result = await deleteSandboxListingById(
      {
        expectedSku: exportedListing.sku!,
        expectedUpdatedAt: exportedListing.updated_at,
        listingId: exportedListing.listing_id,
      },
      {
        api: createApiMock() as never,
        dataAccess,
        deleteObjects: vi.fn(async () => {
          calls.push('r2');
        }),
        env: process.env,
        removeDirectory: vi.fn(async () => {
          calls.push('filesystem');
        }),
      }
    );

    expect(result).toMatchObject({
      deleted: true,
      remoteOutcome: {
        deletedInventoryItem: true,
        deletedOfferCount: 0,
        status: 'deleted',
      },
    });
    expect(getInventoryItemMock).toHaveBeenCalledWith(exportedListing.sku);
    expect(endListingMock).not.toHaveBeenCalled();
    expect(deleteOfferMock).not.toHaveBeenCalled();
    expect(calls).toEqual(['delete-inventory', 'r2', 'filesystem', 'database']);
  });

  it('purges eligible local state only after offers and inventory are independently missing', async () => {
    getOffersMock.mockRejectedValue(createOfferUnavailableError());
    getInventoryItemMock.mockRejectedValue(createOfferUnavailableError());
    const dataAccess = createCleanupDataAccess();
    const { deleteSandboxListingById } = await import('@/listings/delete-sandbox-listing.js');

    await expect(
      deleteSandboxListingById(
        {
          expectedSku: exportedListing.sku!,
          expectedUpdatedAt: exportedListing.updated_at,
          listingId: exportedListing.listing_id,
        },
        {
          api: createApiMock() as never,
          dataAccess,
          deleteObjects: vi.fn(async () => undefined),
          env: process.env,
          removeDirectory: vi.fn(async () => undefined),
        }
      )
    ).resolves.toMatchObject({
      deleted: true,
      remoteOutcome: { deletedInventoryItem: false, status: 'skipped' },
    });
    expect(getInventoryItemMock).toHaveBeenCalledWith(exportedListing.sku);
    expect(deleteInventoryItemMock).not.toHaveBeenCalled();
    expect(dataAccess.listings.deleteSandboxCleaned).toHaveBeenCalledOnce();
  });

  it('reports a successful exact-SKU no-op when remote and local resources are already gone', async () => {
    getOffersMock.mockRejectedValue(createOfferUnavailableError());
    getInventoryItemMock.mockRejectedValue(createOfferUnavailableError());
    const dataAccess = createCleanupDataAccess(null);
    const { runSandboxListingCleanup } = await import(
      '@/listings/delete-sandbox-listing.js'
    );

    const report = await runSandboxListingCleanup(
      {
        confirmSandboxCleanup: true,
        delete: true,
        skus: [exportedListing.sku!],
      },
      { api: createApiMock() as never, dataAccess, env: process.env }
    );

    expect(report.success).toBe(true);
    expect(report.outcomes).toEqual([
      expect.objectContaining({ sku: exportedListing.sku, status: 'skipped' }),
    ]);
    expect(report.localOutcomes).toEqual([
      expect.objectContaining({ sku: exportedListing.sku, status: 'already_missing' }),
    ]);
    expect(deleteOfferMock).not.toHaveBeenCalled();
    expect(deleteInventoryItemMock).not.toHaveBeenCalled();
  });

  it('preserves all local cleanup stages when remote deletion fails', async () => {
    deleteOfferMock.mockRejectedValue(new Error('eBay 503 unavailable'));
    const dataAccess = createCleanupDataAccess();
    const deleteObjects = vi.fn();
    const removeDirectory = vi.fn();
    const { deleteSandboxListingById } = await import('@/listings/delete-sandbox-listing.js');

    await expect(
      deleteSandboxListingById(
        {
          expectedSku: exportedListing.sku!,
          expectedUpdatedAt: exportedListing.updated_at,
          listingId: exportedListing.listing_id,
        },
        {
          api: createApiMock() as never,
          dataAccess,
          deleteObjects,
          env: process.env,
          removeDirectory,
        }
      )
    ).rejects.toMatchObject({ code: 'sandbox_cleanup_remote_failed', statusCode: 502 });
    expect(deleteObjects).not.toHaveBeenCalled();
    expect(removeDirectory).not.toHaveBeenCalled();
    expect(dataAccess.listings.deleteSandboxCleaned).not.toHaveBeenCalled();
  });

  it('maps inventory verification failure after an offers 404 to 502 and preserves local state', async () => {
    getOffersMock.mockRejectedValue(createOfferUnavailableError());
    getInventoryItemMock.mockRejectedValue(new Error('eBay 503 unavailable'));
    const dataAccess = createCleanupDataAccess();
    const deleteObjects = vi.fn();
    const removeDirectory = vi.fn();
    const { deleteSandboxListingById } = await import(
      '@/listings/delete-sandbox-listing.js'
    );

    await expect(
      deleteSandboxListingById(
        {
          expectedSku: exportedListing.sku!,
          expectedUpdatedAt: exportedListing.updated_at,
          listingId: exportedListing.listing_id,
        },
        {
          api: createApiMock() as never,
          dataAccess,
          deleteObjects,
          env: process.env,
          removeDirectory,
        }
      )
    ).rejects.toMatchObject({ code: 'sandbox_cleanup_remote_failed', statusCode: 502 });
    expect(getInventoryItemMock).toHaveBeenCalledWith(exportedListing.sku);
    expectNoCleanupMutations(dataAccess, deleteObjects, removeDirectory);
  });

  it('honors an injected production environment before any cleanup mutation', async () => {
    const dataAccess = createCleanupDataAccess();
    const deleteObjects = vi.fn();
    const removeDirectory = vi.fn();
    const { deleteSandboxListingById } = await import('@/listings/delete-sandbox-listing.js');

    await expect(
      deleteSandboxListingById(
        {
          expectedSku: exportedListing.sku!,
          expectedUpdatedAt: exportedListing.updated_at,
          listingId: exportedListing.listing_id,
        },
        {
          api: createApiMock() as never,
          dataAccess,
          deleteObjects,
          env: { ...process.env, EBAY_ENVIRONMENT: 'production' },
          removeDirectory,
        }
      )
    ).rejects.toMatchObject({ code: 'sandbox_environment_required', statusCode: 409 });
    expect(getOffersMock).not.toHaveBeenCalled();
    expect(getInventoryItemMock).not.toHaveBeenCalled();
    expectNoCleanupMutations(dataAccess, deleteObjects, removeDirectory);
  });

  it('blocks a sold row before any cleanup mutation', async () => {
    const dataAccess = createCleanupDataAccess({
      ...exportedListing,
      sold_at: '2026-07-30T13:00:00.000Z',
    });
    const deleteObjects = vi.fn();
    const removeDirectory = vi.fn();
    const { deleteSandboxListingById } = await import('@/listings/delete-sandbox-listing.js');

    await expect(
      deleteSandboxListingById(
        {
          expectedSku: exportedListing.sku!,
          expectedUpdatedAt: exportedListing.updated_at,
          listingId: exportedListing.listing_id,
        },
        {
          api: createApiMock() as never,
          dataAccess,
          deleteObjects,
          env: process.env,
          removeDirectory,
        }
      )
    ).rejects.toMatchObject({ code: 'sandbox_cleanup_sold_listing', statusCode: 409 });
    expectNoCleanupMutations(dataAccess, deleteObjects, removeDirectory);
  });

  it('blocks an associated order before any cleanup mutation', async () => {
    const dataAccess = createCleanupDataAccess();
    dataAccess.orders.hasByListingId = vi.fn(async () => true);
    const deleteObjects = vi.fn();
    const removeDirectory = vi.fn();
    const { deleteSandboxListingById } = await import('@/listings/delete-sandbox-listing.js');

    await expect(
      deleteSandboxListingById(
        {
          expectedSku: exportedListing.sku!,
          expectedUpdatedAt: exportedListing.updated_at,
          listingId: exportedListing.listing_id,
        },
        {
          api: createApiMock() as never,
          dataAccess,
          deleteObjects,
          env: process.env,
          removeDirectory,
        }
      )
    ).rejects.toMatchObject({ code: 'sandbox_cleanup_order_exists', statusCode: 409 });
    expectNoCleanupMutations(dataAccess, deleteObjects, removeDirectory);
  });

  it('blocks active jobs before any remote write', async () => {
    const dataAccess = createCleanupDataAccess();
    dataAccess.jobs.listByListingId = vi.fn(async () => [{ status: 'running' }] as never);
    const deleteObjects = vi.fn();
    const removeDirectory = vi.fn();
    const { deleteSandboxListingById } = await import('@/listings/delete-sandbox-listing.js');

    await expect(
      deleteSandboxListingById(
        {
          expectedSku: exportedListing.sku!,
          expectedUpdatedAt: exportedListing.updated_at,
          listingId: exportedListing.listing_id,
        },
        {
          api: createApiMock() as never,
          dataAccess,
          deleteObjects,
          env: process.env,
          removeDirectory,
        }
      )
    ).rejects.toMatchObject({ code: 'sandbox_cleanup_active_job', statusCode: 409 });
    expectNoCleanupMutations(dataAccess, deleteObjects, removeDirectory);
  });

  it('keeps the database row when R2 cleanup fails or the final delete is stale', async () => {
    const dataAccess = createCleanupDataAccess();
    const { deleteSandboxListingById } = await import('@/listings/delete-sandbox-listing.js');
    const input = {
      expectedSku: exportedListing.sku!,
      expectedUpdatedAt: exportedListing.updated_at,
      listingId: exportedListing.listing_id,
    };

    await expect(
      deleteSandboxListingById(input, {
        api: createApiMock() as never,
        dataAccess,
        deleteObjects: vi.fn(async () => {
          throw new Error('R2 unavailable');
        }),
        env: process.env,
        removeDirectory: vi.fn(),
      })
    ).rejects.toMatchObject({ code: 'sandbox_cleanup_local_failed', statusCode: 500 });
    expect(dataAccess.listings.deleteSandboxCleaned).not.toHaveBeenCalled();

    vi.clearAllMocks();
    getOffersMock.mockResolvedValue({ offers: [], total: 0 });
    getInventoryItemMock.mockResolvedValue({ sku: exportedListing.sku });
    deleteInventoryItemMock.mockResolvedValue(undefined);
    dataAccess.listings.getBySku = vi.fn(async () => exportedListing);
    dataAccess.orders.hasByListingId = vi.fn(async () => false);
    dataAccess.jobs.listByListingId = vi.fn(async () => []);
    dataAccess.appSettings.get = vi.fn(
      async () => ({ processed_folder_path: '/processed' }) as never
    );
    dataAccess.listings.deleteSandboxCleaned = vi.fn(async () => null);

    await expect(
      deleteSandboxListingById(input, {
        api: createApiMock() as never,
        dataAccess,
        deleteObjects: vi.fn(async () => undefined),
        env: process.env,
        removeDirectory: vi.fn(async () => undefined),
      })
    ).rejects.toMatchObject({ code: 'sandbox_cleanup_state_stale', statusCode: 409 });
  });
});
