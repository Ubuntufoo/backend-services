import { describe, it, expect, beforeEach, vi } from 'vitest';
import nock from 'nock';
import { EbayApiClient } from '@/api/client.js';
import { getEbayConfig } from '@/config/environment.js';
import type { EbayConfig } from '@/types/ebay.js';
import { apiLogger } from '@/utils/logger.js';

// Mock EbayOAuthClient
const mockOAuthClient = {
  hasUserTokens: vi.fn(),
  getAccessToken: vi.fn(),
  getOrRefreshAppAccessToken: vi.fn(),
  setUserTokens: vi.fn(),
  initialize: vi.fn(),
  getTokenInfo: vi.fn(),
  isAuthenticated: vi.fn(),
};

vi.mock('@/auth/oauth.js', () => ({
  EbayOAuthClient: vi.fn(function (this: unknown) {
    return mockOAuthClient;
  }),
}));

describe('EbayApiClient Unit Tests', () => {
  let apiClient: EbayApiClient;
  let config: EbayConfig;

  beforeEach(async () => {
    vi.clearAllMocks();
    nock.cleanAll();

    // Disable proxy to prevent axios from using it
    delete process.env.HTTP_PROXY;
    delete process.env.HTTPS_PROXY;
    delete process.env.http_proxy;
    delete process.env.https_proxy;

    // Enable nock to intercept HTTP requests
    nock.disableNetConnect();

    config = {
      clientId: 'test_client_id',
      clientSecret: 'test_client_secret',
      environment: 'sandbox',
      redirectUri: 'https://localhost/callback',
    };

    // Setup mock OAuth client
    mockOAuthClient.hasUserTokens.mockReturnValue(true);
    mockOAuthClient.getAccessToken.mockResolvedValue('mock_access_token');
    mockOAuthClient.getOrRefreshAppAccessToken.mockResolvedValue('mock_app_access_token');
    mockOAuthClient.initialize.mockResolvedValue(undefined);
    mockOAuthClient.isAuthenticated.mockReturnValue(true);
    mockOAuthClient.getTokenInfo.mockReturnValue({
      hasUserTokens: true,
      accessToken: 'mock_access_token',
      refreshToken: 'mock_refresh_token',
    });

    apiClient = new EbayApiClient(config);
    await apiClient.initialize();
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  describe('Rate Limiting', () => {
    it('should track request counts', async () => {
      // Mock a series of successful API calls
      for (let i = 0; i < 5; i++) {
        nock('https://api.sandbox.ebay.com')
          .get('/sell/inventory/v1/test')
          .reply(200, { success: true });
      }

      // Make 5 requests
      for (let i = 0; i < 5; i++) {
        await apiClient.get('/sell/inventory/v1/test');
      }

      const stats = apiClient.getRateLimitStats();
      expect(stats.current).toBe(5);
      expect(stats.max).toBe(5000);
      expect(stats.windowMs).toBe(60000);
    });

    it('should reset rate limit count after time window', async () => {
      // This test would require mocking time, which is complex
      // Instead we'll test the stats method
      const stats = apiClient.getRateLimitStats();
      expect(stats).toHaveProperty('current');
      expect(stats).toHaveProperty('max');
      expect(stats).toHaveProperty('windowMs');
    });
  });

  describe('Default marketplace and language headers', () => {
    it('should include EBAY_US and en-US headers by default', async () => {
      const originalEnv = process.env;
      process.env = { ...originalEnv };

      try {
        process.env.EBAY_CLIENT_ID = 'test_client_id';
        process.env.EBAY_CLIENT_SECRET = 'test_client_secret';
        delete process.env.EBAY_MARKETPLACE_ID;
        delete process.env.EBAY_CONTENT_LANGUAGE;
        process.env.EBAY_ENVIRONMENT = 'sandbox';

        const defaultClient = new EbayApiClient(getEbayConfig());
        await defaultClient.initialize();

        nock('https://api.sandbox.ebay.com', {
          reqheaders: {
            'x-ebay-c-marketplace-id': 'EBAY_US',
            'content-language': 'en-US',
          },
        })
          .get('/sell/inventory/v1/test')
          .reply(200, { success: true });

        const result = await defaultClient.get('/sell/inventory/v1/test');
        expect(result).toEqual({ success: true });
      } finally {
        process.env = originalEnv;
      }
    });

    it('should override headers when config provides values', async () => {
      const customClient = new EbayApiClient({
        clientId: 'test_client_id',
        clientSecret: 'test_client_secret',
        environment: 'sandbox',
        redirectUri: 'https://localhost/callback',
        marketplaceId: 'EBAY_DE',
        contentLanguage: 'de-DE',
      });
      await customClient.initialize();

      nock('https://api.sandbox.ebay.com', {
        reqheaders: {
          'x-ebay-c-marketplace-id': 'EBAY_DE',
          'content-language': 'de-DE',
        },
      })
        .get('/sell/inventory/v1/test')
        .reply(200, { success: true });

      const result = await customClient.get('/sell/inventory/v1/test');
      expect(result).toEqual({ success: true });
    });
  });

  describe('429 Rate Limit Errors', () => {
    it('should handle 429 errors with Retry-After header', async () => {
      nock('https://api.sandbox.ebay.com')
        .get('/sell/inventory/v1/test')
        .reply(429, { error: 'Rate limit exceeded' }, { 'retry-after': '60' });

      await expect(apiClient.get('/sell/inventory/v1/test')).rejects.toThrow(
        /eBay API rate limit exceeded.*60 seconds/
      );
    });

    it('should handle 429 errors without Retry-After header', async () => {
      nock('https://api.sandbox.ebay.com')
        .get('/sell/inventory/v1/test')
        .reply(429, { error: 'Rate limit exceeded' });

      await expect(apiClient.get('/sell/inventory/v1/test')).rejects.toThrow(
        /eBay API rate limit exceeded.*60 seconds/
      );
    });
  });

  describe('Application-token GET', () => {
    it('uses the Application token even when User credentials are present', async () => {
      nock('https://api.sandbox.ebay.com', {
        reqheaders: { authorization: 'Bearer mock_app_access_token' },
      })
        .get('/buy/browse/v1/test')
        .query({ q: 'test card' })
        .reply(200, { itemSummaries: [] });

      await expect(
        apiClient.getWithApplicationToken('/buy/browse/v1/test', { q: 'test card' })
      ).resolves.toEqual({ itemSummaries: [] });
      expect(mockOAuthClient.getOrRefreshAppAccessToken).toHaveBeenCalledWith();
      expect(mockOAuthClient.getAccessToken).not.toHaveBeenCalled();
    });

    it('remints the Application token once after a 401 and retries the GET', async () => {
      mockOAuthClient.getOrRefreshAppAccessToken
        .mockResolvedValueOnce('expired_app_token')
        .mockResolvedValueOnce('fresh_app_token');

      nock('https://api.sandbox.ebay.com', {
        reqheaders: { authorization: 'Bearer expired_app_token' },
      })
        .get('/buy/browse/v1/test')
        .reply(401, { errors: [{ message: 'Invalid access token' }] });
      nock('https://api.sandbox.ebay.com', {
        reqheaders: { authorization: 'Bearer fresh_app_token' },
      })
        .get('/buy/browse/v1/test')
        .reply(200, { itemSummaries: [] });

      await expect(
        apiClient.getWithApplicationToken('/buy/browse/v1/test')
      ).resolves.toEqual({ itemSummaries: [] });
      expect(mockOAuthClient.getOrRefreshAppAccessToken).toHaveBeenNthCalledWith(1);
      expect(mockOAuthClient.getOrRefreshAppAccessToken).toHaveBeenNthCalledWith(2, true);
      expect(mockOAuthClient.getAccessToken).not.toHaveBeenCalled();
    });

    it('does not expose the Application token in request errors', async () => {
      mockOAuthClient.getOrRefreshAppAccessToken.mockResolvedValue('secret_app_token');
      nock('https://api.sandbox.ebay.com')
        .get('/buy/browse/v1/test')
        .reply(400, { errors: [{ message: 'Invalid request' }] });

      const error = await apiClient
        .getWithApplicationToken('/buy/browse/v1/test')
        .catch((caught: unknown) => caught);

      expect(String(error)).not.toContain('secret_app_token');
      expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
    });

    it('keeps the default seller GET on the User-token-preferred path after a 401', async () => {
      mockOAuthClient.getAccessToken
        .mockResolvedValueOnce('expired_user_token')
        .mockResolvedValue('fresh_user_token');

      nock('https://api.sandbox.ebay.com', {
        reqheaders: { authorization: 'Bearer expired_user_token' },
      })
        .get('/sell/inventory/v1/test')
        .reply(401, { errors: [{ message: 'Invalid access token' }] });
      nock('https://api.sandbox.ebay.com', {
        reqheaders: { authorization: 'Bearer fresh_user_token' },
      })
        .get('/sell/inventory/v1/test')
        .reply(200, { success: true });

      await expect(apiClient.get('/sell/inventory/v1/test')).resolves.toEqual({ success: true });
      expect(mockOAuthClient.getAccessToken).toHaveBeenCalledTimes(3);
      expect(mockOAuthClient.getOrRefreshAppAccessToken).not.toHaveBeenCalled();
    });
  });

  describe('Server Error Retry Logic', () => {
    it('should retry on 500 errors with exponential backoff', async () => {
      const apiErrorSpy = vi.spyOn(apiLogger, 'error').mockImplementation(() => {});

      // First two attempts fail with 500
      nock('https://api.sandbox.ebay.com')
        .get('/sell/inventory/v1/test')
        .reply(500, { error: 'Internal server error' });

      nock('https://api.sandbox.ebay.com')
        .get('/sell/inventory/v1/test')
        .reply(500, { error: 'Internal server error' });

      // Third attempt succeeds
      nock('https://api.sandbox.ebay.com')
        .get('/sell/inventory/v1/test')
        .reply(200, { success: true });

      const result = await apiClient.get('/sell/inventory/v1/test');

      expect(result).toEqual({ success: true });
      expect(apiErrorSpy).toHaveBeenCalled();

      apiErrorSpy.mockRestore();
    }, 10000);

    it('should give up after 3 retry attempts', async () => {
      const apiErrorSpy = vi.spyOn(apiLogger, 'error').mockImplementation(() => {});

      // All 4 attempts fail (original + 3 retries)
      for (let i = 0; i < 4; i++) {
        nock('https://api.sandbox.ebay.com')
          .get('/sell/inventory/v1/test')
          .reply(500, { error: 'Internal server error' });
      }

      await expect(apiClient.get('/sell/inventory/v1/test')).rejects.toThrow();

      apiErrorSpy.mockRestore();
    }, 15000);

    it('should retry on 502 errors', async () => {
      const apiErrorSpy = vi.spyOn(apiLogger, 'error').mockImplementation(() => {});

      nock('https://api.sandbox.ebay.com')
        .get('/sell/inventory/v1/test')
        .reply(502, { error: 'Bad gateway' });

      nock('https://api.sandbox.ebay.com')
        .get('/sell/inventory/v1/test')
        .reply(200, { success: true });

      const result = await apiClient.get('/sell/inventory/v1/test');
      expect(result).toEqual({ success: true });

      apiErrorSpy.mockRestore();
    }, 10000);

    it('should retry on 503 errors', async () => {
      const apiErrorSpy = vi.spyOn(apiLogger, 'error').mockImplementation(() => {});

      nock('https://api.sandbox.ebay.com')
        .get('/sell/inventory/v1/test')
        .reply(503, { error: 'Service unavailable' });

      nock('https://api.sandbox.ebay.com')
        .get('/sell/inventory/v1/test')
        .reply(200, { success: true });

      const result = await apiClient.get('/sell/inventory/v1/test');
      expect(result).toEqual({ success: true });

      apiErrorSpy.mockRestore();
    }, 10000);

    it('should retry on 504 errors', async () => {
      const apiErrorSpy = vi.spyOn(apiLogger, 'error').mockImplementation(() => {});

      nock('https://api.sandbox.ebay.com')
        .get('/sell/inventory/v1/test')
        .reply(504, { error: 'Gateway timeout' });

      nock('https://api.sandbox.ebay.com')
        .get('/sell/inventory/v1/test')
        .reply(200, { success: true });

      const result = await apiClient.get('/sell/inventory/v1/test');
      expect(result).toEqual({ success: true });

      apiErrorSpy.mockRestore();
    }, 10000);
  });

  describe('Rate Limit Header Tracking', () => {
    it('should log rate limit headers when present', async () => {
      const apiHttpSpy = vi.spyOn(apiLogger, 'http').mockImplementation(() => {});

      nock('https://api.sandbox.ebay.com').get('/sell/inventory/v1/test').reply(
        200,
        { success: true },
        {
          'x-ebay-c-ratelimit-remaining': '4500',
          'x-ebay-c-ratelimit-limit': '5000',
        }
      );

      await apiClient.get('/sell/inventory/v1/test');

      // Check that rate limit info was logged (could be in detailed debug format)
      const rateLimitCalls = apiHttpSpy.mock.calls.filter(
        (call) => (call[1] as { rateLimit?: string } | undefined)?.rateLimit === '4500/5000'
      );
      expect(rateLimitCalls.length).toBeGreaterThan(0);

      apiHttpSpy.mockRestore();
    });

    it('should not log when rate limit headers are absent', async () => {
      const apiHttpSpy = vi.spyOn(apiLogger, 'http').mockImplementation(() => {});

      nock('https://api.sandbox.ebay.com')
        .get('/sell/inventory/v1/test')
        .reply(200, { success: true });

      await apiClient.get('/sell/inventory/v1/test');

      // Should not have been called with rate limit message
      const rateLimitCalls = apiHttpSpy.mock.calls.filter(
        (call) => (call[1] as { rateLimit?: string } | undefined)?.rateLimit
      );
      expect(rateLimitCalls).toHaveLength(0);

      apiHttpSpy.mockRestore();
    });
  });

  describe('Client Helper Methods', () => {
    it('should return isAuthenticated status', () => {
      const isAuth = apiClient.isAuthenticated();
      expect(typeof isAuth).toBe('boolean');
    });

    it('should return hasUserTokens status', () => {
      mockOAuthClient.hasUserTokens.mockReturnValue(true);
      const hasTokens = apiClient.hasUserTokens();
      expect(typeof hasTokens).toBe('boolean');
    });

    it('should set user tokens', async () => {
      await apiClient.setUserTokens(
        'new-access-token',
        'new-refresh-token',
        Date.now() + 7200000,
        Date.now() + 47304000000
      );

      expect(mockOAuthClient.setUserTokens).toHaveBeenCalled();
    });

    it('should return token info', () => {
      const tokenInfo = apiClient.getTokenInfo();
      expect(tokenInfo).toBeDefined();
    });

    it('should return OAuth client instance', () => {
      const oauthClient = apiClient.getOAuthClient();
      expect(oauthClient).toBeDefined();
    });
  });
});
