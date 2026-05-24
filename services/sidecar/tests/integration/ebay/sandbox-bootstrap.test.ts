import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import nock from 'nock';
import { EbaySellerApi } from '@/api/index.js';
import { runSandboxBootstrap } from '@/ebay/sandbox-bootstrap.js';
import type { EbayConfig } from '@/types/ebay.js';
import { cleanupMocks } from '../../helpers/mock-http.js';

const mockOAuthClient = {
  getAccessToken: vi.fn(),
  getTokenInfo: vi.fn(),
  getUserTokens: vi.fn(),
  hasUserTokens: vi.fn(),
  initialize: vi.fn(),
  isAuthenticated: vi.fn(),
  setUserTokens: vi.fn(),
};

vi.mock('@/auth/oauth.js', () => ({
  EbayOAuthClient: vi.fn(function (this: unknown) {
    return mockOAuthClient;
  }),
}));

describe('sandbox bootstrap integration', () => {
  let config: EbayConfig;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    vi.clearAllMocks();
    cleanupMocks();
    nock.disableNetConnect();

    originalEnv = process.env;
    process.env = { ...originalEnv };
    delete process.env.HTTP_PROXY;
    delete process.env.HTTPS_PROXY;
    delete process.env.http_proxy;
    delete process.env.https_proxy;

    config = {
      clientId: 'test_client_id',
      clientSecret: 'test_client_secret',
      environment: 'sandbox',
      redirectUri: 'https://localhost/callback',
    };

    mockOAuthClient.getAccessToken.mockResolvedValue('mock_access_token');
    mockOAuthClient.getUserTokens.mockReturnValue({
      scope: [
        'https://api.ebay.com/oauth/api_scope',
        'https://api.ebay.com/oauth/api_scope/sell.account',
        'https://api.ebay.com/oauth/api_scope/sell.inventory',
      ].join(' '),
    });
    mockOAuthClient.hasUserTokens.mockReturnValue(true);
    mockOAuthClient.initialize.mockResolvedValue(undefined);
    mockOAuthClient.isAuthenticated.mockReturnValue(true);
  });

  afterEach(() => {
    cleanupMocks();
    nock.enableNetConnect();
    process.env = originalEnv;
  });

  it('creates missing policies and inventory location through eBay APIs', async () => {
    const api = new EbaySellerApi(config);
    await api.initialize();

    const dataAccess = {
      appSettings: {
        create: vi.fn(),
        get: vi.fn().mockResolvedValue({
          default_fulfillment_policy_id: null,
          default_payment_policy_id: null,
          default_return_policy_id: null,
          ebay_marketplace_id: 'EBAY_US',
          merchant_location_key: null,
        }),
        update: vi.fn().mockResolvedValue({}),
      },
    };

    nock('https://api.sandbox.ebay.com')
      .get('/sell/account/v1/payment_policy')
      .query({ marketplace_id: 'EBAY_US' })
      .reply(200, { paymentPolicies: [] })
      .post('/sell/account/v1/payment_policy')
      .reply(200, { paymentPolicyId: 'PAYMENT-123' })
      .get('/sell/account/v1/fulfillment_policy')
      .query({ marketplace_id: 'EBAY_US' })
      .reply(200, { fulfillmentPolicies: [] })
      .post('/sell/account/v1/fulfillment_policy')
      .reply(200, { fulfillmentPolicyId: 'FULFILLMENT-123' })
      .get('/sell/account/v1/return_policy')
      .query({ marketplace_id: 'EBAY_US' })
      .reply(200, { returnPolicies: [] })
      .post('/sell/account/v1/return_policy')
      .reply(200, { returnPolicyId: 'RETURN-123' })
      .get('/sell/inventory/v1/location')
      .reply(200, { locations: [] })
      .post('/sell/inventory/v1/location/default-main-location')
      .reply(204);

    const result = await runSandboxBootstrap({
      api,
      dataAccess,
    });

    expect(result).toEqual({
      created: {
        fulfillment: true,
        location: true,
        payment: true,
        return: true,
      },
      fulfillmentPolicyId: 'FULFILLMENT-123',
      marketplaceId: 'EBAY_US',
      merchantLocationKey: 'default-main-location',
      paymentPolicyId: 'PAYMENT-123',
      returnPolicyId: 'RETURN-123',
      warnings: [],
    });
    expect(dataAccess.appSettings.update).toHaveBeenCalledWith(
      expect.objectContaining({
        default_fulfillment_policy_id: 'FULFILLMENT-123',
        default_payment_policy_id: 'PAYMENT-123',
        default_return_policy_id: 'RETURN-123',
        merchant_location_key: 'default-main-location',
      }),
      'default'
    );
  });
});
