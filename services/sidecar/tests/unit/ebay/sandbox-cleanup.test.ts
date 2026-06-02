import { EbayApiRequestError } from '@/api/client.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('sandbox cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.EBAY_ENVIRONMENT = 'sandbox';

    getInventoryItemsMock.mockResolvedValue({
      inventoryItems: [
        { sku: 'Single-000002' },
        { sku: 'Keep-300' },
        { sku: 'Single-000001' },
      ],
      total: 3,
    });

    getInventoryItemMock.mockImplementation(async (sku: string) => ({ sku }));
    getOffersMock.mockImplementation(async (sku: string) => ({
      offers: sku === 'Single-000001' ? [{ offerId: 'OFFER-1', sku, status: 'PUBLISHED' }] : [],
      total: sku === 'Single-000001' ? 1 : 0,
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
          prefixes: ['Single-'],
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
          skus: ['Single-000001'],
        },
        {
          api: createApiMock() as never,
        }
      )
    ).rejects.toThrow('Destructive sandbox cleanup requires --confirm-sandbox-cleanup.');
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
    ).rejects.toThrow('Broad inventory-list cleanup mode is disabled because the eBay sandbox inventory list endpoint is unreliable.');

    await expect(
      runSandboxCleanup(
        {
          prefixes: ['Single-'],
        },
        {
          api: createApiMock() as never,
        }
      )
    ).rejects.toThrow('Broad inventory-list cleanup mode is disabled because the eBay sandbox inventory list endpoint is unreliable.');
  });

  it('builds zero-padded range candidates and skips inventory list lookup', async () => {
    const { resolveSandboxCleanupPlan } = await import('@/ebay/sandbox-cleanup.js');

    const plan = await resolveSandboxCleanupPlan(
      {
        from: 1,
        prefixes: ['Single-'],
        to: 3,
      },
      {
        api: createApiMock() as never,
      }
    );

    expect(getInventoryItemsMock).not.toHaveBeenCalled();
    expect(getOffersMock).toHaveBeenNthCalledWith(1, 'Single-000001');
    expect(getOffersMock).toHaveBeenNthCalledWith(2, 'Single-000002');
    expect(getOffersMock).toHaveBeenNthCalledWith(3, 'Single-000003');
    expect(plan.candidateSkus).toEqual(['Single-000001', 'Single-000002', 'Single-000003']);
    expect(plan.candidateCount).toBe(3);
  });

  it('supports multiple prefixes in generated range mode', async () => {
    const { resolveSandboxCleanupPlan } = await import('@/ebay/sandbox-cleanup.js');

    const plan = await resolveSandboxCleanupPlan(
      {
        from: 1,
        prefixes: ['Single-', 'Lot-'],
        to: 2,
      },
      {
        api: createApiMock() as never,
      }
    );

    expect(plan.candidateSkus).toEqual([
      'Single-000001',
      'Single-000002',
      'Lot-000001',
      'Lot-000002',
    ]);
    expect(getOffersMock).toHaveBeenCalledTimes(4);
  });

  it('supports explicit sku mode', async () => {
    const { resolveSandboxCleanupPlan } = await import('@/ebay/sandbox-cleanup.js');

    const plan = await resolveSandboxCleanupPlan(
      {
        skus: ['Single-000001', 'Lot-000002'],
      },
      {
        api: createApiMock() as never,
      }
    );

    expect(plan.sourceMode).toBe('sku');
    expect(plan.candidateSkus).toEqual(['Single-000001', 'Lot-000002']);
    expect(getInventoryItemsMock).not.toHaveBeenCalled();
    expect(getOffersMock).toHaveBeenNthCalledWith(1, 'Single-000001');
    expect(getOffersMock).toHaveBeenNthCalledWith(2, 'Lot-000002');
  });

  it('rejects explicit sku mode combined with range args', async () => {
    const { resolveSandboxCleanupPlan } = await import('@/ebay/sandbox-cleanup.js');

    await expect(
      resolveSandboxCleanupPlan(
        {
          from: 1,
          skus: ['Single-000001'],
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
      if (sku === 'Single-000001') {
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

      if (sku === 'Single-000002') {
        return {
          offers: [],
          total: 0,
        };
      }

      if (sku === 'Single-000003') {
        throw createOfferUnavailableError();
      }

      return {
        offers: [],
        total: 0,
      };
    });

    getInventoryItemMock.mockImplementation(async (sku: string) => {
      if (sku === 'Single-000002') {
        return { sku };
      }

      if (sku === 'Single-000003') {
        throw new Error('should not probe inventory for missing offer');
      }

      return { sku };
    });

    const { runSandboxCleanup } = await import('@/ebay/sandbox-cleanup.js');
    const report = await runSandboxCleanup(
      {
        from: 1,
        prefixes: ['Single-'],
        to: 3,
      },
      {
        api: createApiMock() as never,
      }
    );

    expect(report.mode).toBe('dry-run');
    expect(report.candidateSkus).toEqual(['Single-000001', 'Single-000002', 'Single-000003']);
    expect(report.foundSkus).toEqual(['Single-000001', 'Single-000002']);
    expect(report.missingSkus).toEqual(['Single-000003']);
    expect(report.offersBySku['Single-000001']).toHaveLength(1);
    expect(report.offersBySku['Single-000002']).toHaveLength(0);
    expect(report.offersBySku['Single-000003']).toHaveLength(0);
    expect(report.sourceMode).toBe('range');
    expect(getInventoryItemsMock).not.toHaveBeenCalled();
    expect(getInventoryItemMock).toHaveBeenCalledTimes(1);
    expect(getInventoryItemMock).toHaveBeenCalledWith('Single-000002');
  });

  it('rejects invalid ranges and large generated ranges without override', async () => {
    const { resolveSandboxCleanupPlan } = await import('@/ebay/sandbox-cleanup.js');

    await expect(
      resolveSandboxCleanupPlan(
        {
          from: 0,
          prefixes: ['Single-'],
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
          prefixes: ['Single-'],
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
          prefixes: ['Single-'],
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
    getInventoryItemMock.mockResolvedValue({ sku: 'Single-000001' });

    const { resolveSandboxCleanupPlan } = await import('@/ebay/sandbox-cleanup.js');
    const plan = await resolveSandboxCleanupPlan(
      {
        allowLargeRange: true,
        from: 1,
        prefixes: ['Single-'],
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
          sku: 'Single-000001',
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
        skus: ['Single-000001'],
      },
      {
        api: createApiMock() as never,
      }
    );

    expect(endListingMock).toHaveBeenCalledWith('LIST-1');
    expect(deleteOfferMock).toHaveBeenCalledWith('OFFER-1');
    expect(deleteInventoryItemMock).toHaveBeenCalledWith('Single-000001');
    expect(report.mode).toBe('delete');
    expect(report.success).toBe(true);
    expect(report.outcomes[0].status).toBe('deleted');
  });
});
