import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getSandboxSellingPolicyManagementDiagnosticMock = vi.fn();
const validateEbayOAuthMock = vi.fn();
const optInSandboxSellingPolicyManagementMock = vi.fn();
const initializeMock = vi.fn();
const getAuthClientMock = vi.fn(() => ({
  getConfig: vi.fn(() => ({
    environment: 'sandbox',
  })),
}));
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

vi.mock('@/ebay/config.js', () => ({
  loadEbayOAuthValidationConfig: vi.fn(() => ({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    environment: 'sandbox',
    marketplaceId: 'EBAY_US',
    oauthBaseUrl: 'https://api.sandbox.ebay.com/identity/v1/oauth2/token',
    apiBaseUrl: 'https://api.sandbox.ebay.com',
    refreshToken: 'refresh-token',
    publishEnabled: false,
  })),
}));

vi.mock('@/ebay/validate-oauth.js', () => ({
  validateEbayOAuth: validateEbayOAuthMock,
}));

vi.mock('@/ebay/sandbox-selling-policy-program.js', () => ({
  getSandboxSellingPolicyManagementDiagnostic: getSandboxSellingPolicyManagementDiagnosticMock,
  optInSandboxSellingPolicyManagement: optInSandboxSellingPolicyManagementMock,
}));

vi.mock('@/api/index.js', () => ({
  EbaySellerApi: vi.fn(function (this: { initialize: typeof initializeMock; getAuthClient: typeof getAuthClientMock }) {
    this.initialize = initializeMock;
    this.getAuthClient = getAuthClientMock;
  }),
}));

describe('diagnose sandbox script', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initializeMock.mockResolvedValue(undefined);
    validateEbayOAuthMock.mockResolvedValue({
      ok: true,
      environment: 'sandbox',
      marketplaceId: 'EBAY_US',
      tokenType: 'User',
      expiresIn: 7200,
    });
    getSandboxSellingPolicyManagementDiagnosticMock.mockResolvedValue({
      selling_policy_management_opted_in: true,
      warnings: [],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints sandbox selling policy diagnostic JSON', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { runDiagnoseSandboxCli } = await import('@/scripts/diagnose-sandbox.js');
    await runDiagnoseSandboxCli();

    expect(validateEbayOAuthMock).toHaveBeenCalledTimes(1);
    expect(getSandboxSellingPolicyManagementDiagnosticMock).toHaveBeenCalledTimes(1);
    expect(optInSandboxSellingPolicyManagementMock).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      JSON.stringify(
        {
          environment: 'sandbox',
          oauth_validation: {
            expiresIn: 7200,
            ok: true,
            tokenType: 'User',
          },
          selling_policy_management_opted_in: true,
          warnings: [],
        },
        null,
        2
      )
    );
  });
});
