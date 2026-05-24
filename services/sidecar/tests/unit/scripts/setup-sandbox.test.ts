import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getSidecarDataAccessMock = vi.fn();
const loadRootEnvironmentMock = vi.fn();
const runSandboxBootstrapMock = vi.fn();
const initializeMock = vi.fn();

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

vi.mock('@/data/sidecar-data.js', () => ({
  getSidecarDataAccess: getSidecarDataAccessMock,
}));

vi.mock('@/ebay/sandbox-bootstrap.js', () => ({
  runSandboxBootstrap: runSandboxBootstrapMock,
}));

vi.mock('@/api/index.js', () => ({
  EbaySellerApi: vi.fn(function (this: { initialize: typeof initializeMock }) {
    this.initialize = initializeMock;
  }),
}));

describe('setup sandbox script', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initializeMock.mockResolvedValue(undefined);
    getSidecarDataAccessMock.mockReturnValue({ appSettings: {} });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints bootstrap result as JSON', async () => {
    runSandboxBootstrapMock.mockResolvedValue({
      created: {
        fulfillment: true,
        location: true,
        payment: true,
        return: true,
      },
      fulfillmentPolicyId: 'FULFILLMENT-1',
      marketplaceId: 'EBAY_US',
      merchantLocationKey: 'default-main-location',
      paymentPolicyId: 'PAYMENT-1',
      returnPolicyId: 'RETURN-1',
      warnings: [],
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { runSetupSandboxCli } = await import('@/scripts/setup-sandbox.js');
    await runSetupSandboxCli();

    expect(logSpy).toHaveBeenCalledWith(
      JSON.stringify(
        {
          created: {
            fulfillment: true,
            location: true,
            payment: true,
            return: true,
          },
          fulfillmentPolicyId: 'FULFILLMENT-1',
          marketplaceId: 'EBAY_US',
          merchantLocationKey: 'default-main-location',
          paymentPolicyId: 'PAYMENT-1',
          returnPolicyId: 'RETURN-1',
          warnings: [],
        },
        null,
        2
      )
    );
  });

  it('surfaces bootstrap failures to caller', async () => {
    runSandboxBootstrapMock.mockRejectedValue(new Error('boom'));

    const { runSetupSandboxCli } = await import('@/scripts/setup-sandbox.js');

    await expect(runSetupSandboxCli()).rejects.toThrow('boom');
  });
});
