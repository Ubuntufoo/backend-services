import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const discoverLivePublishConfigMock = vi.fn();
const getEbayConfigMock = vi.fn();
const loadEbayOAuthValidationConfigMock = vi.fn();
const loadRootEnvironmentMock = vi.fn();
const validateEbayOAuthMock = vi.fn();
const initializeMock = vi.fn();

vi.mock('@/config/env-paths.js', () => ({
  loadRootEnvironment: loadRootEnvironmentMock,
}));

vi.mock('@/config/environment.js', () => ({
  getEbayConfig: getEbayConfigMock,
}));

vi.mock('@/ebay/config.js', () => ({
  loadEbayOAuthValidationConfig: loadEbayOAuthValidationConfigMock,
}));

vi.mock('@/ebay/validate-oauth.js', () => ({
  validateEbayOAuth: validateEbayOAuthMock,
}));

vi.mock('@/ebay/live-publish-config-discovery.js', () => ({
  discoverLivePublishConfig: discoverLivePublishConfigMock,
}));

vi.mock('@/api/index.js', () => ({
  EbaySellerApi: vi.fn(function (this: { initialize: typeof initializeMock }) {
    this.initialize = initializeMock;
  }),
}));

describe('list live publish config script', () => {
  let originalExitCode: number | undefined;
  let originalEnv: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    originalExitCode = process.exitCode;
    originalEnv = process.env.EBAY_ENVIRONMENT;
    process.exitCode = undefined;
    process.env.EBAY_ENVIRONMENT = 'production';
    getEbayConfigMock.mockReturnValue({
      clientId: 'client-id',
      clientSecret: 'client-secret-secret',
      contentLanguage: 'en-US',
      environment: 'production',
      marketplaceId: 'EBAY_US',
      refreshToken: 'refresh-token-secret',
    });
    loadEbayOAuthValidationConfigMock.mockReturnValue({
      apiBaseUrl: 'https://api.ebay.com',
      clientId: 'client-id',
      clientSecret: 'client-secret-secret',
      environment: 'production',
      marketplaceId: 'EBAY_US',
      oauthBaseUrl: 'https://api.ebay.com/identity/v1/oauth2/token',
      publishEnabled: true,
      refreshToken: 'refresh-token-secret',
    });
    discoverLivePublishConfigMock.mockResolvedValue({
      apiBaseUrl: 'https://api.ebay.com',
      checkedAt: '2026-06-02T00:00:00.000Z',
      environment: 'production',
      errors: [],
      fulfillmentPolicies: [],
      inventoryLocations: [],
      marketplaceId: 'EBAY_US',
      overallStatus: 'ok',
      paymentPolicies: [],
      returnPolicies: [],
    });
    initializeMock.mockResolvedValue(undefined);
    validateEbayOAuthMock.mockResolvedValue({
      environment: 'production',
      expiresIn: 7200,
      marketplaceId: 'EBAY_US',
      ok: true,
      tokenType: 'Bearer',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = originalExitCode;
    process.env.EBAY_ENVIRONMENT = originalEnv;
  });

  it('prints JSON only and suppresses logger output on success', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { runListLivePublishConfigCli } = await import('@/scripts/list-live-publish-config.js');
    await runListLivePublishConfigCli();

    expect(loadRootEnvironmentMock).toHaveBeenCalledTimes(1);
    expect(discoverLivePublishConfigMock).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(
      JSON.stringify(
        {
          apiBaseUrl: 'https://api.ebay.com',
          checkedAt: '2026-06-02T00:00:00.000Z',
          environment: 'production',
          errors: [],
          fulfillmentPolicies: [],
          inventoryLocations: [],
          marketplaceId: 'EBAY_US',
          overallStatus: 'ok',
          paymentPolicies: [],
          returnPolicies: [],
        },
        null,
        2
      )
    );
    expect(process.exitCode).toBeUndefined();
  });

  it('prints failed JSON before remote calls for non-production env', async () => {
    process.env.EBAY_ENVIRONMENT = 'sandbox';
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { runListLivePublishConfigCli } = await import('@/scripts/list-live-publish-config.js');
    await runListLivePublishConfigCli();

    expect(discoverLivePublishConfigMock).not.toHaveBeenCalled();
    expect(getEbayConfigMock).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(1);
  });

  it('captures diagnostics into JSON errors array when discovery fails', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    discoverLivePublishConfigMock.mockImplementation(async () => {
      console.error('Authorization: Bearer access-token-secret');
      return {
        apiBaseUrl: 'https://api.ebay.com',
        checkedAt: '2026-06-02T00:00:00.000Z',
        environment: 'production',
        errors: [
          {
            family: 'account',
            message: 'Failed to list publish config values.',
            details: {
              message: 'Authorization: Bearer [REDACTED]',
            },
          },
        ],
        fulfillmentPolicies: [],
        inventoryLocations: [],
        marketplaceId: 'EBAY_US',
        overallStatus: 'partial',
        paymentPolicies: [],
        returnPolicies: [],
      };
    });

    const { runListLivePublishConfigCli } = await import('@/scripts/list-live-publish-config.js');
    await runListLivePublishConfigCli();

    const printed = logSpy.mock.calls[0]?.[0] as string;
    expect(printed).not.toContain('access-token-secret');
    expect(printed).toContain('[REDACTED]');
    expect(process.exitCode).toBe(1);
  });
});
