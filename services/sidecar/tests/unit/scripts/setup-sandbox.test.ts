import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const formatSandboxBootstrapResultMock = vi.fn();
const getSidecarDataAccessMock = vi.fn();
const loadRootEnvironmentMock = vi.fn();
const publishListingMock = vi.fn();
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
  formatSandboxBootstrapResult: formatSandboxBootstrapResultMock,
  runSandboxBootstrap: runSandboxBootstrapMock,
}));

vi.mock('@/ebay/publish-listing.js', () => ({
  publishListing: publishListingMock,
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
    formatSandboxBootstrapResultMock.mockReturnValue('formatted bootstrap');
    getSidecarDataAccessMock.mockReturnValue({ appSettings: {} });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints bootstrap result in terminal summary format', async () => {
    const result = {
      created: {
        fulfillment: true,
        location: true,
        payment: true,
        return: true,
      },
      fulfillmentPolicyId: 'FULFILLMENT-1',
      marketplaceId: 'EBAY_US',
      merchantLocationKey: 'default-main-location',
      persistedAppSettingsId: 'default',
      paymentPolicyId: 'PAYMENT-1',
      returnPolicyId: 'RETURN-1',
      warnings: [],
    };
    runSandboxBootstrapMock.mockResolvedValue(result);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { runSetupSandboxCli } = await import('@/scripts/setup-sandbox.js');
    await runSetupSandboxCli();

    expect(formatSandboxBootstrapResultMock).toHaveBeenCalledWith(result);
    expect(logSpy).toHaveBeenCalledWith('formatted bootstrap');
    expect(publishListingMock).not.toHaveBeenCalled();
  });

  it('surfaces bootstrap failures to caller', async () => {
    runSandboxBootstrapMock.mockRejectedValue(new Error('boom'));

    const { runSetupSandboxCli } = await import('@/scripts/setup-sandbox.js');

    await expect(runSetupSandboxCli()).rejects.toThrow('boom');
  });
});
