import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SandboxBootstrapApi } from '@/ebay/sandbox-bootstrap.js';
import {
  ensureDefaultInventoryLocation,
  ensureDefaultSellerPolicies,
  formatSandboxBootstrapResult,
  runSandboxBootstrap,
  validateSandboxOAuthAccess,
} from '@/ebay/sandbox-bootstrap.js';
import { setupLogger } from '@/utils/logger.js';

const REQUIRED_SCOPE_STRING = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.account',
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
].join(' ');

function createApi(overrides: Partial<SandboxBootstrapApi> = {}): SandboxBootstrapApi {
  const oauthClient = {
    getAccessToken: vi.fn().mockResolvedValue('access-token'),
    getUserTokens: vi.fn().mockReturnValue({
      scope: REQUIRED_SCOPE_STRING,
    }),
  };

  return {
    account: {
      createFulfillmentPolicy: vi.fn(),
      createPaymentPolicy: vi.fn(),
      createReturnPolicy: vi.fn(),
      getFulfillmentPolicies: vi.fn(),
      getPaymentPolicies: vi.fn(),
      getReturnPolicies: vi.fn(),
    },
    getAuthClient: vi.fn(() => ({
      getConfig: vi.fn(() => ({
        environment: 'sandbox',
        marketplaceId: 'EBAY_US',
      })),
      getOAuthClient: vi.fn(() => oauthClient),
    })),
    hasUserTokens: vi.fn(() => true),
    inventory: {
      createOrReplaceInventoryLocation: vi.fn(),
      getInventoryLocations: vi.fn(),
    },
    ...overrides,
  };
}

function createDataAccess(): {
  appSettings: {
    create: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
} {
  return {
    appSettings: {
      create: vi.fn(),
      get: vi.fn(),
      update: vi.fn(),
    },
  };
}

describe('sandbox bootstrap', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    vi.clearAllMocks();
    originalEnv = { ...process.env };
    process.env.EBAY_REFRESH_TOKEN = 'test-refresh-token';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('persists stored policy ids and location key when they are still valid', async () => {
    const api = createApi();
    const dataAccess = createDataAccess();
    dataAccess.appSettings.get.mockResolvedValue({
      default_fulfillment_policy_id: 'FULFILLMENT-1',
      default_payment_policy_id: 'PAYMENT-1',
      default_return_policy_id: 'RETURN-1',
      ebay_marketplace_id: 'EBAY_US',
      merchant_location_key: 'stored-location',
    });
    api.account.getPaymentPolicies = vi.fn().mockResolvedValue({
      paymentPolicies: [{ name: 'Other', paymentPolicyId: 'PAYMENT-1' }],
    });
    api.account.getFulfillmentPolicies = vi.fn().mockResolvedValue({
      fulfillmentPolicies: [{ fulfillmentPolicyId: 'FULFILLMENT-1', name: 'Other' }],
    });
    api.account.getReturnPolicies = vi.fn().mockResolvedValue({
      returnPolicies: [{ name: 'Other', returnPolicyId: 'RETURN-1' }],
    });
    api.inventory.getInventoryLocations = vi.fn().mockResolvedValue({
      locations: [{ merchantLocationKey: 'stored-location', name: 'Stored Warehouse' }],
    });
    dataAccess.appSettings.update.mockResolvedValue({});

    const result = await runSandboxBootstrap({ api, dataAccess });

    expect(result.created).toEqual({
      fulfillment: false,
      location: false,
      payment: false,
      return: false,
    });
    expect(result.fulfillmentPolicyId).toBe('FULFILLMENT-1');
    expect(result.paymentPolicyId).toBe('PAYMENT-1');
    expect(result.returnPolicyId).toBe('RETURN-1');
    expect(result.merchantLocationKey).toBe('stored-location');
    expect(result.persistedAppSettingsId).toBe('default');
    expect(dataAccess.appSettings.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        default_fulfillment_policy_id: 'FULFILLMENT-1',
        default_payment_policy_id: 'PAYMENT-1',
        default_return_policy_id: 'RETURN-1',
      }),
      'default'
    );
    expect(dataAccess.appSettings.update).toHaveBeenNthCalledWith(
      2,
      {
        merchant_location_key: 'stored-location',
      },
      'default'
    );
  });

  it('creates missing app settings row and bootstrap defaults when nothing exists', async () => {
    const api = createApi();
    const dataAccess = createDataAccess();
    dataAccess.appSettings.get.mockResolvedValue(null);
    dataAccess.appSettings.create.mockResolvedValue({
      ebay_marketplace_id: 'EBAY_US',
      id: 'default',
    });
    dataAccess.appSettings.update.mockResolvedValue({});
    api.account.getPaymentPolicies = vi.fn().mockResolvedValue({ paymentPolicies: [] });
    api.account.getFulfillmentPolicies = vi.fn().mockResolvedValue({ fulfillmentPolicies: [] });
    api.account.getReturnPolicies = vi.fn().mockResolvedValue({ returnPolicies: [] });
    api.account.createPaymentPolicy = vi.fn().mockResolvedValue({ paymentPolicyId: 'PAYMENT-NEW' });
    api.account.createFulfillmentPolicy = vi
      .fn()
      .mockResolvedValue({ fulfillmentPolicyId: 'FULFILLMENT-NEW' });
    api.account.createReturnPolicy = vi.fn().mockResolvedValue({ returnPolicyId: 'RETURN-NEW' });
    api.inventory.getInventoryLocations = vi.fn().mockResolvedValue({ locations: [] });
    api.inventory.createOrReplaceInventoryLocation = vi.fn().mockResolvedValue(undefined);

    const result = await runSandboxBootstrap({ api, dataAccess });

    expect(dataAccess.appSettings.create).toHaveBeenCalledWith({
      ebay_marketplace_id: 'EBAY_US',
      id: 'default',
    });
    expect(result.created).toEqual({
      fulfillment: true,
      location: true,
      payment: true,
      return: true,
    });
    expect(result.persistedAppSettingsId).toBe('default');
    expect(result.warnings).toEqual([]);
    expect(dataAccess.appSettings.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        default_fulfillment_policy_id: 'FULFILLMENT-NEW',
        default_payment_policy_id: 'PAYMENT-NEW',
        default_return_policy_id: 'RETURN-NEW',
      }),
      'default'
    );
    expect(dataAccess.appSettings.update).toHaveBeenNthCalledWith(
      2,
      {
        merchant_location_key: 'default-main-location',
      },
      'default'
    );
  });

  it('falls back to first existing policy only with warning after create failure', async () => {
    const api = createApi();
    api.account.getPaymentPolicies = vi
      .fn()
      .mockResolvedValueOnce({ paymentPolicies: [] })
      .mockResolvedValueOnce({
        paymentPolicies: [{ name: 'Fallback Payment', paymentPolicyId: 'PAYMENT-FALLBACK' }],
      });
    api.account.getFulfillmentPolicies = vi.fn().mockResolvedValue({
      fulfillmentPolicies: [
        { fulfillmentPolicyId: 'FULFILLMENT-1', name: 'Sandbox Default Fulfillment Policy' },
      ],
    });
    api.account.getReturnPolicies = vi.fn().mockResolvedValue({
      returnPolicies: [{ name: 'Sandbox Default Return Policy', returnPolicyId: 'RETURN-1' }],
    });
    api.account.createPaymentPolicy = vi
      .fn()
      .mockRejectedValue(new Error('sandbox create blocked'));

    const result = await ensureDefaultSellerPolicies(
      api,
      {
        default_fulfillment_policy_id: null,
        default_payment_policy_id: null,
        default_return_policy_id: null,
      },
      'EBAY_US'
    );

    expect(result.paymentPolicyId).toBe('PAYMENT-FALLBACK');
    expect(result.created.payment).toBe(false);
    expect(result.warnings[0]).toContain('Fell back to existing payment policy');
  });

  it('replaces placeholder stored policy ids and merchant location key with real sandbox values', async () => {
    const api = createApi();
    const dataAccess = createDataAccess();
    dataAccess.appSettings.get.mockResolvedValue({
      default_fulfillment_policy_id: 'mock-fulfillment-policy-id',
      default_payment_policy_id: 'mock-payment-policy-id',
      default_return_policy_id: 'mock-return-policy-id',
      ebay_marketplace_id: 'EBAY_US',
      merchant_location_key: '<merchantLocationKey>',
    });
    dataAccess.appSettings.update.mockResolvedValue({});
    api.account.getPaymentPolicies = vi.fn().mockResolvedValue({
      paymentPolicies: [{ name: 'Sandbox Default Payment Policy', paymentPolicyId: 'PAYMENT-REAL' }],
    });
    api.account.getFulfillmentPolicies = vi.fn().mockResolvedValue({
      fulfillmentPolicies: [
        { fulfillmentPolicyId: 'FULFILLMENT-REAL', name: 'Sandbox Default Fulfillment Policy' },
      ],
    });
    api.account.getReturnPolicies = vi.fn().mockResolvedValue({
      returnPolicies: [{ name: 'Sandbox Default Return Policy', returnPolicyId: 'RETURN-REAL' }],
    });
    api.inventory.getInventoryLocations = vi.fn().mockResolvedValue({
      locations: [{ merchantLocationKey: 'real-location', name: 'Real Warehouse' }],
    });
    api.inventory.createOrReplaceInventoryLocation = vi.fn().mockResolvedValue(undefined);

    const result = await runSandboxBootstrap({ api, dataAccess });

    expect(result.paymentPolicyId).toBe('PAYMENT-REAL');
    expect(result.fulfillmentPolicyId).toBe('FULFILLMENT-REAL');
    expect(result.returnPolicyId).toBe('RETURN-REAL');
    expect(result.merchantLocationKey).toBe('default-main-location');
    expect(api.inventory.createOrReplaceInventoryLocation).toHaveBeenCalledWith(
      'default-main-location',
      expect.any(Object)
    );
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        'Ignoring placeholder stored payment policy id "mock-payment-policy-id" during sandbox bootstrap.',
        'Ignoring placeholder stored fulfillment policy id "mock-fulfillment-policy-id" during sandbox bootstrap.',
        'Ignoring placeholder stored return policy id "mock-return-policy-id" during sandbox bootstrap.',
        'Ignoring placeholder stored merchant_location_key "<merchantLocationKey>" during sandbox bootstrap.',
      ])
    );
    expect(dataAccess.appSettings.update).toHaveBeenNthCalledWith(
      2,
      { merchant_location_key: 'default-main-location' },
      'default'
    );
  });

  it('handles marketplace mismatch safely by persisting active sidecar marketplace', async () => {
    const api = createApi();
    const dataAccess = createDataAccess();
    dataAccess.appSettings.get.mockResolvedValue({
      default_fulfillment_policy_id: 'FULFILLMENT-US',
      default_payment_policy_id: 'PAYMENT-US',
      default_return_policy_id: 'RETURN-US',
      ebay_marketplace_id: 'EBAY_GB',
      merchant_location_key: 'stored-location',
    });
    dataAccess.appSettings.update.mockResolvedValue({});
    api.account.getPaymentPolicies = vi.fn().mockResolvedValue({
      paymentPolicies: [{ name: 'Sandbox Default Payment Policy', paymentPolicyId: 'PAYMENT-REAL' }],
    });
    api.account.getFulfillmentPolicies = vi.fn().mockResolvedValue({
      fulfillmentPolicies: [
        { fulfillmentPolicyId: 'FULFILLMENT-REAL', name: 'Sandbox Default Fulfillment Policy' },
      ],
    });
    api.account.getReturnPolicies = vi.fn().mockResolvedValue({
      returnPolicies: [{ name: 'Sandbox Default Return Policy', returnPolicyId: 'RETURN-REAL' }],
    });
    api.inventory.getInventoryLocations = vi.fn().mockResolvedValue({
      locations: [{ merchantLocationKey: 'stored-location', name: 'Stored Warehouse' }],
    });
    const warn = vi.fn();

    const result = await runSandboxBootstrap({
      api,
      dataAccess,
      logger: { warn } as unknown as typeof setupLogger,
    });

    expect(api.account.getPaymentPolicies).toHaveBeenCalledWith('EBAY_US');
    expect(result.marketplaceId).toBe('EBAY_US');
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        'Stored app_settings.default.ebay_marketplace_id "EBAY_GB" does not match active sidecar marketplace "EBAY_US". Bootstrap will persist "EBAY_US".',
      ])
    );
    expect(dataAccess.appSettings.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        ebay_marketplace_id: 'EBAY_US',
      }),
      'default'
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('does not match active sidecar marketplace "EBAY_US"')
    );
  });

  it('does not invoke publish flow during sandbox bootstrap', async () => {
    const api = createApi();
    const dataAccess = createDataAccess();
    const publishListing = vi.fn();
    dataAccess.appSettings.get.mockResolvedValue({
      default_fulfillment_policy_id: 'FULFILLMENT-1',
      default_payment_policy_id: 'PAYMENT-1',
      default_return_policy_id: 'RETURN-1',
      ebay_marketplace_id: 'EBAY_US',
      merchant_location_key: 'stored-location',
    });
    dataAccess.appSettings.update.mockResolvedValue({});
    api.account.getPaymentPolicies = vi.fn().mockResolvedValue({
      paymentPolicies: [{ name: 'Other', paymentPolicyId: 'PAYMENT-1' }],
    });
    api.account.getFulfillmentPolicies = vi.fn().mockResolvedValue({
      fulfillmentPolicies: [{ fulfillmentPolicyId: 'FULFILLMENT-1', name: 'Other' }],
    });
    api.account.getReturnPolicies = vi.fn().mockResolvedValue({
      returnPolicies: [{ name: 'Other', returnPolicyId: 'RETURN-1' }],
    });
    api.inventory.getInventoryLocations = vi.fn().mockResolvedValue({
      locations: [{ merchantLocationKey: 'stored-location', name: 'Stored Warehouse' }],
    });

    await runSandboxBootstrap({
      api: {
        ...api,
        publishListing,
      } as unknown as SandboxBootstrapApi,
      dataAccess,
    });

    expect(publishListing).not.toHaveBeenCalled();
  });

  it('fails inventory bootstrap when create fails and no safe fallback exists', async () => {
    const api = createApi();
    api.inventory.getInventoryLocations = vi
      .fn()
      .mockResolvedValueOnce({ locations: [] })
      .mockResolvedValueOnce({ locations: [] });
    api.inventory.createOrReplaceInventoryLocation = vi
      .fn()
      .mockRejectedValue(new Error('location create blocked'));

    await expect(
      ensureDefaultInventoryLocation(api, { merchant_location_key: null })
    ).rejects.toThrow('Failed to create default inventory location');
  });

  it('emits warning when direct default location lookup fails after list reload failure', async () => {
    const api = createApi({
      inventory: {
        createOrReplaceInventoryLocation: vi.fn().mockRejectedValue(new Error('create failed')),
        getInventoryLocation: vi.fn().mockRejectedValue(new Error('lookup failed')),
        getInventoryLocations: vi
          .fn()
          .mockResolvedValueOnce({ locations: [] })
          .mockRejectedValueOnce(new Error('reload failed')),
      } as unknown as SandboxBootstrapApi['inventory'],
    });
    const warn = vi.fn();

    await expect(
      ensureDefaultInventoryLocation(
        api,
        { merchant_location_key: null },
        { warn } as unknown as typeof setupLogger
      )
    ).rejects.toThrow('Failed to ensure inventory location bootstrap. Root cause: reload failed');

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'Failed direct inventory location lookup for default key "default-main-location" after list reload failed. Root cause: lookup failed'
      )
    );
  });

  it('rejects missing required scopes', async () => {
    const api = createApi();
    const oauthClient = api.getAuthClient().getOAuthClient();
    vi.mocked(oauthClient.getUserTokens).mockReturnValue({
      scope:
        'https://api.ebay.com/oauth/api_scope https://api.ebay.com/oauth/api_scope/sell.inventory',
    });

    await expect(validateSandboxOAuthAccess(api)).rejects.toThrow('Missing required scopes');
  });

  it('passes when refresh succeeds and scopes are returned', async () => {
    const api = createApi();

    await expect(validateSandboxOAuthAccess(api)).resolves.toEqual({
      tokenScopes: REQUIRED_SCOPE_STRING.split(' '),
    });
  });

  it('warns and continues when refresh succeeds but scope metadata is omitted', async () => {
    const api = createApi();
    const oauthClient = api.getAuthClient().getOAuthClient();
    vi.mocked(oauthClient.getUserTokens).mockReturnValue({});
    const warnSpy = vi.spyOn(setupLogger, 'warn').mockImplementation(() => {});

    await expect(validateSandboxOAuthAccess(api)).resolves.toEqual({ tokenScopes: [] });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Token refresh succeeded but eBay did not return scope metadata')
    );
  });

  it('fails when refresh token validation fails', async () => {
    const api = createApi({
      hasUserTokens: vi.fn(() => false),
    });

    await expect(validateSandboxOAuthAccess(api)).rejects.toThrow(
      'Refresh token could not be loaded or refreshed'
    );
  });

  it('fails with actionable message when policy API returns insufficient scope', async () => {
    const api = createApi();
    const oauthClient = api.getAuthClient().getOAuthClient();
    vi.mocked(oauthClient.getUserTokens).mockReturnValue({});
    api.account.getPaymentPolicies = vi
      .fn()
      .mockRejectedValue(new Error('eBay API Error: insufficient_scope'));

    await expect(
      ensureDefaultSellerPolicies(
        api,
        {
          default_fulfillment_policy_id: null,
          default_payment_policy_id: null,
          default_return_policy_id: null,
        },
        'EBAY_US'
      )
    ).rejects.toThrow(
      'Re-authorize sandbox user with scopes: api_scope, sell.account, sell.inventory'
    );
  });

  it('surfaces business policy eligibility failures clearly', async () => {
    const api = createApi();
    api.account.getPaymentPolicies = vi
      .fn()
      .mockRejectedValue(new Error('eBay API Error: User is not eligible for Business Policy.'));

    await expect(
      ensureDefaultSellerPolicies(
        api,
        {
          default_fulfillment_policy_id: null,
          default_payment_policy_id: null,
          default_return_policy_id: null,
        },
        'EBAY_US'
      )
    ).rejects.toThrow(
      'Sandbox account limitation. eBay seller not eligible for Business Policy'
    );
  });

  it('rejects non-sandbox environment', async () => {
    const api = createApi({
      getAuthClient: vi.fn(() => ({
        getConfig: vi.fn(() => ({
          environment: 'production',
          marketplaceId: 'EBAY_US',
        })),
        getOAuthClient: vi.fn(() => ({
          getAccessToken: vi.fn().mockResolvedValue('access-token'),
          getUserTokens: vi.fn().mockReturnValue({
            scope: REQUIRED_SCOPE_STRING,
          }),
        })),
      })),
    });

    await expect(validateSandboxOAuthAccess(api)).rejects.toThrow(
      'Sandbox bootstrap only runs against EBAY_ENVIRONMENT=sandbox'
    );
  });

  it('formats bootstrap output with created and reused summaries', () => {
    const output = formatSandboxBootstrapResult({
      created: {
        fulfillment: false,
        location: true,
        payment: false,
        return: false,
      },
      fulfillmentPolicyId: 'FULFILLMENT-1',
      marketplaceId: 'EBAY_US',
      merchantLocationKey: 'default-main-location',
      persistedAppSettingsId: 'default',
      paymentPolicyId: 'PAYMENT-1',
      returnPolicyId: 'RETURN-1',
      warnings: ['warning-1'],
    });

    expect(output).toContain('payment policy ID: PAYMENT-1 (reused)');
    expect(output).toContain('merchant location key: default-main-location (created)');
    expect(output).toContain('app_settings row: default');
    expect(output).toContain('- merchant_location_key = default-main-location');
    expect(output).toContain('warnings:');
  });
});
