import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getInventoryItemsMock = vi.fn();
const getOffersMock = vi.fn();
const deleteOfferMock = vi.fn();
const deleteInventoryItemMock = vi.fn();
const endListingMock = vi.fn();

vi.mock('@/api/client.js', () => ({
  EbayApiRequestError: class EbayApiRequestError extends Error {
    readonly statusCode?: number;

    constructor(message: string, _errors: unknown[] = [], statusCode?: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

describe('sandbox cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.EBAY_ENVIRONMENT = 'sandbox';

    getInventoryItemsMock.mockResolvedValue({
      inventoryItems: [
        { sku: 'Lot-100' },
        { sku: 'Single-200' },
        { sku: 'Keep-300' },
      ],
      total: 3,
    });

    getOffersMock.mockImplementation(async (sku: string) => {
      if (sku === 'Lot-100') {
        return {
          offers: [
            {
              format: 'FIXED_PRICE',
              listing: { listingId: 'LIST-100' },
              marketplaceId: 'EBAY_US',
              offerId: 'OFFER-100',
              sku: 'Lot-100',
              status: 'PUBLISHED',
            },
          ],
          total: 1,
        };
      }

      if (sku === 'Single-200') {
        return {
          offers: [
            {
              format: 'FIXED_PRICE',
              marketplaceId: 'EBAY_US',
              offerId: 'OFFER-200',
              sku: 'Single-200',
              status: 'UNPUBLISHED',
            },
          ],
          total: 1,
        };
      }

      return { offers: [], total: 0 };
    });

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

    const { runSandboxCleanup } = await import('@/ebay/sandbox-cleanup.js');

    await expect(
      runSandboxCleanup(
        {
          prefixes: ['Single-'],
        },
        {
          api: {
            inventory: {
              deleteInventoryItem: deleteInventoryItemMock,
              deleteOffer: deleteOfferMock,
              getInventoryItems: getInventoryItemsMock,
              getOffers: getOffersMock,
            },
            trading: {
              endListing: endListingMock,
            },
          } as never,
        }
      )
    ).rejects.toThrow('EBAY_ENVIRONMENT must be set to "sandbox" before running sandbox cleanup.');
    expect(getInventoryItemsMock).not.toHaveBeenCalled();
  });

  it('lists matching sandbox items in dry-run mode without deleting anything', async () => {
    const { runSandboxCleanup } = await import('@/ebay/sandbox-cleanup.js');

    const report = await runSandboxCleanup({
      prefixes: ['Single-', 'Lot-'],
    }, {
      api: {
        inventory: {
          deleteInventoryItem: deleteInventoryItemMock,
          deleteOffer: deleteOfferMock,
          getInventoryItems: getInventoryItemsMock,
          getOffers: getOffersMock,
        },
      } as never,
    });

    expect(report.mode).toBe('dry-run');
    expect(report.matchedSkus).toEqual(['Lot-100', 'Single-200']);
    expect(report.targets).toHaveLength(2);
    expect(deleteOfferMock).not.toHaveBeenCalled();
    expect(deleteInventoryItemMock).not.toHaveBeenCalled();
    expect(endListingMock).not.toHaveBeenCalled();
  });

  it('requires explicit confirmation before destructive cleanup', async () => {
    const { runSandboxCleanup } = await import('@/ebay/sandbox-cleanup.js');

    await expect(
      runSandboxCleanup(
        {
          delete: true,
          prefixes: ['Single-'],
        },
        {
          api: {
            inventory: {
              deleteInventoryItem: deleteInventoryItemMock,
              deleteOffer: deleteOfferMock,
              getInventoryItems: getInventoryItemsMock,
              getOffers: getOffersMock,
            },
            trading: {
              endListing: endListingMock,
            },
          } as never,
        }
      )
    ).rejects.toThrow('Destructive sandbox cleanup requires --confirm-sandbox-cleanup.');
  });

  it('deletes matching offers and inventory items only for matching prefixes', async () => {
    const { runSandboxCleanup } = await import('@/ebay/sandbox-cleanup.js');

    const report = await runSandboxCleanup(
      {
        confirmSandboxCleanup: true,
        delete: true,
        prefixes: ['Single-', 'Lot-'],
      },
      {
        api: {
          inventory: {
            deleteInventoryItem: deleteInventoryItemMock,
            deleteOffer: deleteOfferMock,
            getInventoryItems: getInventoryItemsMock,
            getOffers: getOffersMock,
          },
          trading: {
            endListing: endListingMock,
          },
        } as never,
      }
    );

    expect(endListingMock).toHaveBeenCalledWith('LIST-100');
    expect(deleteOfferMock).toHaveBeenCalledWith('OFFER-100');
    expect(deleteOfferMock).toHaveBeenCalledWith('OFFER-200');
    expect(deleteInventoryItemMock).toHaveBeenCalledWith('Lot-100');
    expect(deleteInventoryItemMock).toHaveBeenCalledWith('Single-200');
    expect(deleteOfferMock).not.toHaveBeenCalledWith(expect.stringContaining('Keep'));
    expect(deleteInventoryItemMock).not.toHaveBeenCalledWith('Keep-300');
    expect(report.success).toBe(true);
  });

  it('keeps going when a resource is already missing', async () => {
    deleteOfferMock.mockImplementation(async (offerId: string) => {
      if (offerId === 'OFFER-200') {
        throw Object.assign(new Error('eBay API Error: Not Found'), { statusCode: 404 });
      }
      return undefined;
    });

    deleteInventoryItemMock.mockImplementation(async (sku: string) => {
      if (sku === 'Single-200') {
        throw Object.assign(new Error('eBay API Error: Not Found'), { statusCode: 404 });
      }
      return undefined;
    });

    const { runSandboxCleanup } = await import('@/ebay/sandbox-cleanup.js');
    const report = await runSandboxCleanup(
      {
        confirmSandboxCleanup: true,
        delete: true,
        prefixes: ['Single-', 'Lot-'],
      },
      {
        api: {
          inventory: {
            deleteInventoryItem: deleteInventoryItemMock,
            deleteOffer: deleteOfferMock,
            getInventoryItems: getInventoryItemsMock,
            getOffers: getOffersMock,
          },
          trading: {
            endListing: endListingMock,
          },
        } as never,
      }
    );

    expect(report.success).toBe(true);
    expect(report.outcomes.find((outcome) => outcome.sku === 'Single-200')?.skippedMissing).toEqual([
      'offer:OFFER-200',
      'inventory:Single-200',
    ]);
    expect(report.outcomes.find((outcome) => outcome.sku === 'Lot-100')?.deletedOffers).toEqual([
      'OFFER-100',
    ]);
  });
});
