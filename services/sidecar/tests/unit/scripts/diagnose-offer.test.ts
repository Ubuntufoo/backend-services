import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getOfferMock = vi.fn();
const initializeMock = vi.fn();
const loadRootEnvironmentMock = vi.fn();

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
  EbaySellerApi: vi.fn(function (
    this: {
      initialize: typeof initializeMock;
      inventory: {
        getOffer: typeof getOfferMock;
      };
    }
  ) {
    this.initialize = initializeMock;
    this.inventory = {
      getOffer: getOfferMock,
    };
  }),
}));

describe('diagnose offer script', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initializeMock.mockResolvedValue(undefined);
    getOfferMock.mockResolvedValue({
      availableQuantity: 1,
      categoryId: '261328',
      format: 'FIXED_PRICE',
      marketplaceId: 'EBAY_US',
      offerId: '11109473010',
      sku: 'Single-000004',
      status: 'PUBLISHED',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints safe offer diagnostics', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { runDiagnoseOfferCli } = await import('@/scripts/diagnose-offer.js');
    await runDiagnoseOfferCli(['--', '11109473010']);

    expect(getOfferMock).toHaveBeenCalledWith('11109473010');
    expect(logSpy).toHaveBeenCalledWith(
      JSON.stringify(
        {
          availableQuantity: 1,
          categoryId: '261328',
          format: 'FIXED_PRICE',
          marketplaceId: 'EBAY_US',
          offerId: '11109473010',
          sku: 'Single-000004',
          status: 'PUBLISHED',
        },
        null,
        2
      )
    );
  });
});
