import { describe, expect, it, vi } from 'vitest';
import { EbayApiRequestError } from '@/api/client.js';
import { discoverLivePublishConfig } from '@/ebay/live-publish-config-discovery.js';
import type { EbayConfig } from '@/types/ebay.js';
import type { EbayOAuthValidationConfig } from '@/ebay/config.js';

function createRuntimeConfig(overrides: Partial<EbayConfig> = {}): EbayConfig {
  return {
    accessToken: 'access-token-secret',
    appAccessToken: 'app-access-token-secret',
    clientId: 'client-id',
    clientSecret: 'client-secret-secret',
    contentLanguage: 'en-US',
    environment: 'production',
    marketplaceId: 'EBAY_US',
    refreshToken: 'refresh-token-secret',
    ...overrides,
  };
}

function createOauthConfig(
  overrides: Partial<EbayOAuthValidationConfig> = {}
): EbayOAuthValidationConfig {
  return {
    apiBaseUrl: 'https://api.ebay.com',
    clientId: 'client-id',
    clientSecret: 'client-secret-secret',
    environment: 'production',
    marketplaceId: 'EBAY_US',
    oauthBaseUrl: 'https://api.ebay.com/identity/v1/oauth2/token',
    publishEnabled: true,
    refreshToken: 'refresh-token-secret',
    ...overrides,
  };
}

function createApi(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    account: {
      getFulfillmentPolicies: vi.fn().mockResolvedValue({
        fulfillmentPolicies: [
          {
            fulfillmentPolicyId: 'FULFILLMENT-1',
            marketplaceId: 'EBAY_US',
            name: 'Live Fulfillment',
          },
        ],
      }),
      getPaymentPolicies: vi.fn().mockResolvedValue({
        paymentPolicies: [
          {
            marketplaceId: 'EBAY_US',
            name: 'Live Payment',
            paymentPolicyId: 'PAYMENT-1',
          },
        ],
      }),
      getReturnPolicies: vi.fn().mockResolvedValue({
        returnPolicies: [
          {
            marketplaceId: 'EBAY_US',
            name: 'Live Return',
            returnPolicyId: 'RETURN-1',
          },
        ],
      }),
    },
    initialize: vi.fn().mockResolvedValue(undefined),
    inventory: {
      getInventoryLocations: vi.fn().mockResolvedValue({
        locations: [
          {
            merchantLocationKey: 'warehouse-main',
            merchantLocationStatus: 'ENABLED',
            name: 'Warehouse Main',
          },
        ],
        total: 1,
      }),
    },
    ...overrides,
  };
}

describe('live publish config discovery', () => {
  it('rejects non-production config before remote calls', async () => {
    const api = createApi();

    const report = await discoverLivePublishConfig({
      api,
      oauthConfig: createOauthConfig({ environment: 'sandbox' }),
      runtimeConfig: createRuntimeConfig({ environment: 'sandbox' }),
    });

    expect(report.overallStatus).toBe('failed');
    expect(api.initialize).not.toHaveBeenCalled();
    expect(api.account.getPaymentPolicies).not.toHaveBeenCalled();
    expect(api.account.getFulfillmentPolicies).not.toHaveBeenCalled();
    expect(api.account.getReturnPolicies).not.toHaveBeenCalled();
    expect(api.inventory.getInventoryLocations).not.toHaveBeenCalled();
  });

  it('returns policy IDs, names, and marketplace IDs', async () => {
    const api = createApi();

    const report = await discoverLivePublishConfig({
      api,
      oauthConfig: createOauthConfig(),
      runtimeConfig: createRuntimeConfig(),
      validateOAuth: vi.fn().mockResolvedValue({
        environment: 'production',
        expiresIn: 7200,
        marketplaceId: 'EBAY_US',
        ok: true,
        tokenType: 'Bearer',
      }),
    });

    expect(report.overallStatus).toBe('ok');
    expect(report.paymentPolicies).toEqual([
      {
        marketplaceId: 'EBAY_US',
        name: 'Live Payment',
        paymentPolicyId: 'PAYMENT-1',
      },
    ]);
    expect(report.fulfillmentPolicies).toEqual([
      {
        fulfillmentPolicyId: 'FULFILLMENT-1',
        marketplaceId: 'EBAY_US',
        name: 'Live Fulfillment',
      },
    ]);
    expect(report.returnPolicies).toEqual([
      {
        marketplaceId: 'EBAY_US',
        name: 'Live Return',
        returnPolicyId: 'RETURN-1',
      },
    ]);
  });

  it('returns inventory location keys, names, and statuses', async () => {
    const api = createApi();

    const report = await discoverLivePublishConfig({
      api,
      oauthConfig: createOauthConfig(),
      runtimeConfig: createRuntimeConfig(),
      validateOAuth: vi.fn().mockResolvedValue({
        environment: 'production',
        expiresIn: 7200,
        marketplaceId: 'EBAY_US',
        ok: true,
        tokenType: 'Bearer',
      }),
    });

    expect(report.inventoryLocations).toEqual([
      {
        merchantLocationKey: 'warehouse-main',
        name: 'Warehouse Main',
        status: 'ENABLED',
      },
    ]);
  });

  it('handles business policy ineligible errors with sanitized details', async () => {
    const api = createApi({
      account: {
        getFulfillmentPolicies: vi.fn().mockRejectedValue(
          new EbayApiRequestError(
            'eBay API Error: User is not eligible for Business Policy',
            [
              {
                category: 'REQUEST',
                domain: 'API_ACCOUNT',
                errorId: 98765,
                longMessage:
                  'Authorization: Bearer access-token-secret User is not eligible for Business Policy',
                message: 'User is not eligible for Business Policy',
                parameters: [{ name: 'token', value: 'access-token-secret' }],
              },
            ],
            403
          )
        ),
        getPaymentPolicies: vi.fn().mockResolvedValue({
          paymentPolicies: [
            {
              marketplaceId: 'EBAY_US',
              name: 'Live Payment',
              paymentPolicyId: 'PAYMENT-1',
            },
          ],
        }),
        getReturnPolicies: vi.fn().mockResolvedValue({
          returnPolicies: [
            {
              marketplaceId: 'EBAY_US',
              name: 'Live Return',
              returnPolicyId: 'RETURN-1',
            },
          ],
        }),
      },
    });

    const report = await discoverLivePublishConfig({
      api,
      oauthConfig: createOauthConfig(),
      runtimeConfig: createRuntimeConfig(),
      validateOAuth: vi.fn().mockResolvedValue({
        environment: 'production',
        expiresIn: 7200,
        marketplaceId: 'EBAY_US',
        ok: true,
        tokenType: 'Bearer',
      }),
    });

    expect(report.paymentPolicies).toEqual([]);
    expect(report.fulfillmentPolicies).toEqual([]);
    expect(report.returnPolicies).toEqual([]);
    expect(JSON.stringify(report)).not.toContain('access-token-secret');
    expect(JSON.stringify(report)).toContain('[REDACTED]');
  });

  it('continues with partial results when one resource family fails', async () => {
    const api = createApi({
      inventory: {
        getInventoryLocations: vi.fn().mockRejectedValue(new Error('inventory boom')),
      },
    });

    const report = await discoverLivePublishConfig({
      api,
      oauthConfig: createOauthConfig(),
      runtimeConfig: createRuntimeConfig(),
      validateOAuth: vi.fn().mockResolvedValue({
        environment: 'production',
        expiresIn: 7200,
        marketplaceId: 'EBAY_US',
        ok: true,
        tokenType: 'Bearer',
      }),
    });

    expect(report.overallStatus).toBe('partial');
    expect(report.paymentPolicies.length).toBe(1);
    expect(report.errors.length).toBeGreaterThan(0);
  });

  it('does not call mutation methods', async () => {
    const api = createApi();
    const accountMutationGuard = vi.fn();
    const inventoryMutationGuard = vi.fn();
    (api as unknown as Record<string, unknown>).account = {
      ...api.account,
      createPaymentPolicy: accountMutationGuard,
      createFulfillmentPolicy: accountMutationGuard,
      createReturnPolicy: accountMutationGuard,
      updatePaymentPolicy: accountMutationGuard,
      updateFulfillmentPolicy: accountMutationGuard,
      updateReturnPolicy: accountMutationGuard,
    };
    (api as unknown as Record<string, unknown>).inventory = {
      ...api.inventory,
      createOrReplaceInventoryItem: inventoryMutationGuard,
      createOrReplaceInventoryLocation: inventoryMutationGuard,
      updateLocationDetails: inventoryMutationGuard,
      enableInventoryLocation: inventoryMutationGuard,
      createOffer: inventoryMutationGuard,
      publishOffer: inventoryMutationGuard,
    };

    await discoverLivePublishConfig({
      api: api as typeof api,
      oauthConfig: createOauthConfig(),
      runtimeConfig: createRuntimeConfig(),
      validateOAuth: vi.fn().mockResolvedValue({
        environment: 'production',
        expiresIn: 7200,
        marketplaceId: 'EBAY_US',
        ok: true,
        tokenType: 'Bearer',
      }),
    });

    expect(accountMutationGuard).not.toHaveBeenCalled();
    expect(inventoryMutationGuard).not.toHaveBeenCalled();
  });
});
