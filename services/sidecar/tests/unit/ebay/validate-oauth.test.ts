import { describe, expect, it, vi } from 'vitest';
import { validateEbayOAuth } from '@/ebay/validate-oauth.js';
import type { EbayOAuthValidationConfig } from '@/ebay/config.js';

function createConfig(): EbayOAuthValidationConfig {
  return {
    environment: 'sandbox',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    refreshToken: 'refresh-token',
    apiBaseUrl: 'https://api.sandbox.ebay.com',
    oauthBaseUrl: 'https://api.sandbox.ebay.com/identity/v1/oauth2/token',
    marketplaceId: 'EBAY_US',
    publishEnabled: false,
  };
}

function createJsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    async json(): Promise<unknown> {
      return body;
    },
    async text(): Promise<string> {
      return JSON.stringify(body);
    },
  } as Response;
}

describe('validateEbayOAuth', () => {
  it('returns ok/environment/marketplace/tokenType/expiresIn', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        access_token: 'access-token',
        expires_in: 7200,
        token_type: 'Bearer',
      })
    );

    const result = await validateEbayOAuth(createConfig(), {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(result).toEqual({
      ok: true,
      environment: 'sandbox',
      marketplaceId: 'EBAY_US',
      tokenType: 'Bearer',
      expiresIn: 7200,
    });
  });

  it('does not return accessToken', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        access_token: 'access-token',
        expires_in: 7200,
        token_type: 'Bearer',
      })
    );

    const result = await validateEbayOAuth(createConfig(), {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(result).not.toHaveProperty('accessToken');
  });
});
