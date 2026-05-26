import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getSandboxConfigDiagnosticMock = vi.fn();
const getSidecarDataAccessMock = vi.fn();
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

vi.mock('@/data/sidecar-data.js', () => ({
  getSidecarDataAccess: getSidecarDataAccessMock,
}));

vi.mock('@/ebay/sandbox-config-diagnostic.js', () => ({
  getSandboxConfigDiagnostic: getSandboxConfigDiagnosticMock,
}));

vi.mock('@/api/index.js', () => ({
  EbaySellerApi: vi.fn(function (this: { initialize: typeof initializeMock }) {
    this.initialize = initializeMock;
  }),
}));

describe('diagnose sandbox config script', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initializeMock.mockResolvedValue(undefined);
    getSidecarDataAccessMock.mockReturnValue({ appSettings: {} });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints sandbox config diagnostic JSON', async () => {
    getSandboxConfigDiagnosticMock.mockResolvedValue({
      appSettings: {
        current: null,
        issues: [],
        readError: null,
      },
      environment: 'sandbox',
      marketplaceId: 'EBAY_US',
      oauthValidation: {
        ok: true,
      },
      proposedValues: {
        default_fulfillment_policy_id: 'FULFILLMENT-1',
        default_payment_policy_id: 'PAYMENT-1',
        default_return_policy_id: 'RETURN-1',
        ebay_marketplace_id: 'EBAY_US',
        merchant_location_key: 'default-main-location',
      },
      sellingPolicyManagementOptedIn: true,
      suggestedSql: 'update public.app_settings ...',
      summaries: {
        fulfillmentPolicies: [],
        inventoryLocations: [],
        paymentPolicies: [],
        returnPolicies: [],
      },
      warnings: [],
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { runDiagnoseSandboxConfigCli } = await import('@/scripts/diagnose-sandbox-config.js');
    await runDiagnoseSandboxConfigCli();

    expect(getSandboxConfigDiagnosticMock).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(
      JSON.stringify(
        {
          appSettings: {
            current: null,
            issues: [],
            readError: null,
          },
          environment: 'sandbox',
          marketplaceId: 'EBAY_US',
          oauthValidation: {
            ok: true,
          },
          proposedValues: {
            default_fulfillment_policy_id: 'FULFILLMENT-1',
            default_payment_policy_id: 'PAYMENT-1',
            default_return_policy_id: 'RETURN-1',
            ebay_marketplace_id: 'EBAY_US',
            merchant_location_key: 'default-main-location',
          },
          sellingPolicyManagementOptedIn: true,
          suggestedSql: 'update public.app_settings ...',
          summaries: {
            fulfillmentPolicies: [],
            inventoryLocations: [],
            paymentPolicies: [],
            returnPolicies: [],
          },
          warnings: [],
        },
        null,
        2
      )
    );
  });
});
