import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loadRootEnvironmentMock = vi.fn();
const initializeMock = vi.fn();
const collectSandboxCleanupTargetsMock = vi.fn();
const performSandboxCleanupMock = vi.fn();

vi.mock('@/config/env-paths.js', () => ({
  loadRootEnvironment: loadRootEnvironmentMock,
}));

vi.mock('@/config/environment.js', () => ({
  getEbayConfig: vi.fn(() => ({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    environment: 'sandbox',
    marketplaceId: 'EBAY_US',
  })),
}));

vi.mock('@/api/index.js', () => ({
  EbaySellerApi: vi.fn(function (this: { initialize: typeof initializeMock }) {
    this.initialize = initializeMock;
  }),
}));

vi.mock('@/ebay/sandbox-cleanup.js', () => ({
  DEFAULT_SANDBOX_CLEANUP_PREFIXES: ['Single-', 'Lot-'],
  collectSandboxCleanupTargets: collectSandboxCleanupTargetsMock,
  performSandboxCleanup: performSandboxCleanupMock,
}));

describe('cleanup ebay sandbox script', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.EBAY_ENVIRONMENT = 'sandbox';
    initializeMock.mockResolvedValue(undefined);
    collectSandboxCleanupTargetsMock.mockResolvedValue([
      {
        inventoryItem: { sku: 'Lot-100' },
        offers: [
          {
            offerId: 'OFFER-100',
            sku: 'Lot-100',
            status: 'PUBLISHED',
          },
        ],
      },
    ]);
    performSandboxCleanupMock.mockResolvedValue([
      {
        deletedInventoryItem: true,
        deletedOffers: ['OFFER-100'],
        errors: [],
        sku: 'Lot-100',
        skippedMissing: [],
        status: 'deleted',
      },
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.EBAY_ENVIRONMENT;
  });

  it('parses prefixes and prints cleanup preview before destructive action', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { runCleanupEbaySandboxCli } = await import('@/scripts/cleanup-ebay-sandbox.js');

    await runCleanupEbaySandboxCli(['--prefix', 'Lot-', '--delete', '--confirm-sandbox-cleanup']);

    expect(collectSandboxCleanupTargetsMock).toHaveBeenCalledWith(expect.anything(), ['Lot-']);
    expect(performSandboxCleanupMock).toHaveBeenCalledWith(expect.anything(), [
      {
        inventoryItem: { sku: 'Lot-100' },
        offers: [
          {
            offerId: 'OFFER-100',
            sku: 'Lot-100',
            status: 'PUBLISHED',
          },
        ],
      },
    ]);
    expect(logSpy).toHaveBeenNthCalledWith(
      1,
      JSON.stringify(
        {
          mode: 'delete',
          matchedSkus: ['Lot-100'],
          prefixes: ['Lot-'],
          targets: [
            {
              inventoryItem: { sku: 'Lot-100' },
              offers: [
                {
                  offerId: 'OFFER-100',
                  sku: 'Lot-100',
                  status: 'PUBLISHED',
                },
              ],
            },
          ],
        },
        null,
        2
      )
    );
    expect(logSpy).toHaveBeenNthCalledWith(
      2,
      JSON.stringify(
        {
          mode: 'delete',
          outcomes: [
            {
              deletedInventoryItem: true,
              deletedOffers: ['OFFER-100'],
              errors: [],
              sku: 'Lot-100',
              skippedMissing: [],
              status: 'deleted',
            },
          ],
          success: true,
        },
        null,
        2
      )
    );
  });

  it('rejects unknown args', async () => {
    const { runCleanupEbaySandboxCli } = await import('@/scripts/cleanup-ebay-sandbox.js');

    await expect(runCleanupEbaySandboxCli(['--bad'])).rejects.toThrow('Unknown argument: --bad');
  });

  it('rejects missing prefix values', async () => {
    const { runCleanupEbaySandboxCli } = await import('@/scripts/cleanup-ebay-sandbox.js');

    await expect(runCleanupEbaySandboxCli(['--prefix'])).rejects.toThrow(
      '--prefix requires a non-empty value.'
    );
  });

  it('rejects production environment before making API calls', async () => {
    process.env.EBAY_ENVIRONMENT = 'production';

    const { runCleanupEbaySandboxCli } = await import('@/scripts/cleanup-ebay-sandbox.js');

    await expect(runCleanupEbaySandboxCli()).rejects.toThrow(
      'EBAY_ENVIRONMENT must be set to "sandbox" before running sandbox cleanup.'
    );
    expect(collectSandboxCleanupTargetsMock).not.toHaveBeenCalled();
    expect(performSandboxCleanupMock).not.toHaveBeenCalled();
  });

  it('requires confirmation before destructive cleanup', async () => {
    const { runCleanupEbaySandboxCli } = await import('@/scripts/cleanup-ebay-sandbox.js');

    await expect(runCleanupEbaySandboxCli(['--delete'])).rejects.toThrow(
      'Destructive sandbox cleanup requires --confirm-sandbox-cleanup.'
    );
  });
});
