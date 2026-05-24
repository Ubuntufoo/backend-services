import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EbayOAuthRequestError,
  exchangeRefreshTokenForAccessToken,
} from '@/ebay/oauth-client.js';
import type { EbayOAuthValidationConfig } from '@/ebay/config.js';

interface MockResponse {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

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

function createJsonResponse(body: unknown, status = 200, statusText = 'OK'): MockResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    async json(): Promise<unknown> {
      return body;
    },
    async text(): Promise<string> {
      return JSON.stringify(body);
    },
  };
}

describe('exchangeRefreshTokenForAccessToken', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('sends POST to configured OAuth URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        access_token: 'access-token',
        expires_in: 7200,
        token_type: 'Bearer',
      })
    );

    await exchangeRefreshTokenForAccessToken(createConfig(), {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.sandbox.ebay.com/identity/v1/oauth2/token',
      expect.objectContaining({
        method: 'POST',
      })
    );
  });

  it('sends Basic Auth header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        access_token: 'access-token',
        expires_in: 7200,
        token_type: 'Bearer',
      })
    );

    await exchangeRefreshTokenForAccessToken(createConfig(), {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request.headers).toMatchObject({
      Authorization: `Basic ${Buffer.from('client-id:client-secret').toString('base64')}`,
    });
  });

  it('sends application/x-www-form-urlencoded body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        access_token: 'access-token',
        expires_in: 7200,
        token_type: 'Bearer',
      })
    );

    await exchangeRefreshTokenForAccessToken(createConfig(), {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request.headers).toMatchObject({
      'Content-Type': 'application/x-www-form-urlencoded',
    });
    expect(request.body).toBeInstanceOf(URLSearchParams);
  });

  it('includes grant_type=refresh_token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        access_token: 'access-token',
        expires_in: 7200,
        token_type: 'Bearer',
      })
    );

    await exchangeRefreshTokenForAccessToken(createConfig(), {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = request.body as URLSearchParams;
    expect(body.get('grant_type')).toBe('refresh_token');
  });

  it('includes refresh_token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        access_token: 'access-token',
        expires_in: 7200,
        token_type: 'Bearer',
      })
    );

    await exchangeRefreshTokenForAccessToken(createConfig(), {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = request.body as URLSearchParams;
    expect(body.get('refresh_token')).toBe('refresh-token');
  });

  it('returns token metadata on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        access_token: 'access-token',
        expires_in: 7200,
        token_type: 'Bearer',
      })
    );

    const result = await exchangeRefreshTokenForAccessToken(createConfig(), {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(result).toEqual({
      accessToken: 'access-token',
      expiresIn: 7200,
      tokenType: 'Bearer',
    });
  });

  it('throws sanitized error on 400/401', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse(
        {
          error: 'invalid_grant',
          error_description: 'refresh token expired',
        },
        401,
        'Unauthorized'
      )
    );

    await expect(
      exchangeRefreshTokenForAccessToken(createConfig(), {
        fetchImpl: fetchMock as unknown as typeof fetch,
      })
    ).rejects.toEqual(
      expect.objectContaining({
        name: 'EbayOAuthRequestError',
        status: 401,
        message: 'eBay OAuth refresh failed (401): refresh token expired',
      })
    );
  });

  it('does not leak secret, refresh token, or access token in error messages', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse(
        {
          error_description:
            'bad client-secret refresh-token access-token-from-body',
          access_token: 'access-token-from-body',
          refresh_token: 'refresh-token',
        },
        400,
        'Bad Request'
      )
    );

    let thrown: unknown;

    try {
      await exchangeRefreshTokenForAccessToken(createConfig(), {
        fetchImpl: fetchMock as unknown as typeof fetch,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(EbayOAuthRequestError);

    const message = (thrown as Error).message;
    expect(message).not.toContain('client-secret');
    expect(message).not.toContain('refresh-token');
    expect(message).not.toContain('access-token-from-body');
    expect(message).toContain('[REDACTED]');
  });
});
