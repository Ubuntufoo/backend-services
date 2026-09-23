import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import nock from 'nock';
import { AxiosError, type AxiosAdapter } from 'axios';
import { EbayApiClient } from '@/api/client.js';
import { apiLogger } from '@/utils/logger.js';

const mockAuth = vi.hoisted(() => ({
  initialize: vi.fn(),
  getAccessToken: vi.fn(),
  isAuthenticated: vi.fn(),
}));

vi.mock('@/auth/oauth.js', () => ({
  EbayOAuthClient: vi.fn(function () {
    return mockAuth;
  }),
}));

describe('eBay shared-client server-error retry safety', () => {
  let client: EbayApiClient;
  const origin = 'https://api.sandbox.ebay.com';
  const path = '/sell/inventory/v1/test';

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    nock.cleanAll();
    nock.disableNetConnect();
    mockAuth.getAccessToken.mockResolvedValue('local-fixture');
    mockAuth.initialize.mockResolvedValue(undefined);
    mockAuth.isAuthenticated.mockReturnValue(true);
    client = new EbayApiClient({
      clientId: 'local-fixture',
      clientSecret: 'local-fixture',
      environment: 'sandbox',
      redirectUri: 'https://localhost/callback',
    });
    await client.initialize();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    nock.cleanAll();
    nock.enableNetConnect();
  });

  const settleRetryDelays = async <T>(request: Promise<T>, delays: number[]): Promise<T> => {
    for (const delay of delays) {
      await vi.advanceTimersByTimeAsync(delay);
    }
    return await request;
  };

  it('retries an exact inventory GET after transient 500s and reports recovery', async () => {
    const scope = nock(origin)
      .get(path)
      .reply(500, { errors: [{ message: 'A system error has occurred.' }] })
      .get(path)
      .reply(500, { errors: [{ message: 'A system error has occurred.' }] })
      .get(path)
      .reply(200, { sku: 'unit-test' });
    const info = vi.spyOn(apiLogger, 'info').mockImplementation(() => {});
    const request = client.get(path, undefined, { timeout: 0 });
    await expect(settleRetryDelays(request, [1_000, 2_000])).resolves.toEqual({
      sku: 'unit-test',
    });
    expect(scope.isDone()).toBe(true);
    expect(info).toHaveBeenCalledWith('eBay read recovered after a transient server error.', {
      method: 'GET',
      retryAttempts: 2,
      status: 200,
    });
  });

  it('exhausts only three GET retries and preserves the final HTTP status', async () => {
    const scope = nock(origin)
      .get(path)
      .times(4)
      .reply(500, {
        errors: [{ message: 'A system error has occurred.' }],
      });
    const warn = vi.spyOn(apiLogger, 'warn').mockImplementation(() => {});
    await expect(
      settleRetryDelays(client.get(path, undefined, { timeout: 0 }), [1_000, 2_000, 4_000])
    ).rejects.toMatchObject({
      statusCode: 500,
    });
    expect(scope.isDone()).toBe(true);
    expect(warn).toHaveBeenCalledWith('eBay GET exhausted its server-error retries.', {
      retryAttempts: 3,
      status: 500,
    });
  });

  it.each(['POST', 'PUT', 'DELETE'] as const)(
    'never automatically replays %s after an ambiguous 500',
    async (method) => {
      const payload = { sku: 'unit-test' };
      const scope = nock(origin);
      if (method === 'POST')
        scope.post(path, payload).reply(500, { errors: [{ message: 'System error' }] });
      if (method === 'PUT')
        scope.put(path, payload).reply(500, { errors: [{ message: 'System error' }] });
      if (method === 'DELETE')
        scope.delete(path).reply(500, { errors: [{ message: 'System error' }] });
      const warn = vi.spyOn(apiLogger, 'warn').mockImplementation(() => {});
      const request =
        method === 'POST'
          ? client.post(path, payload)
          : method === 'PUT'
            ? client.put(path, payload)
            : client.delete(path);
      await expect(request).rejects.toMatchObject({ statusCode: 500 });
      expect(scope.isDone()).toBe(true);
      expect(warn).toHaveBeenCalledWith(
        'eBay non-GET server error: automatic retry suppressed; remote outcome may be unknown.',
        { method, status: 500 }
      );
    }
  );

  it('suppresses automatic replay for PATCH after an ambiguous 500', async () => {
    const method = 'PATCH';
    const payload = { sku: 'unit-test' };
    const scope = nock(origin)
      .intercept(path, method)
      .reply(500, {
        errors: [{ message: 'System error' }],
      });
    const warn = vi.spyOn(apiLogger, 'warn').mockImplementation(() => {});
    const internalClient = (
      client as unknown as {
        httpClient: {
          request: (config: {
            method: string;
            url: string;
            data: unknown;
            timeout: number;
          }) => Promise<unknown>;
        };
      }
    ).httpClient;

    await expect(
      internalClient.request({ method, url: path, data: payload, timeout: 0 })
    ).rejects.toMatchObject({ statusCode: 500 });
    expect(scope.isDone()).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      'eBay non-GET server error: automatic retry suppressed; remote outcome may be unknown.',
      { method, status: 500 }
    );
  });

  it('suppresses automatic replay for an unknown method after an ambiguous 500', async () => {
    const method = 'TRACE';
    const payload = { sku: 'unit-test' };
    let attempts = 0;
    const adapter: AxiosAdapter = async (config) => {
      attempts += 1;
      return await Promise.reject(
        new AxiosError('synthetic server error', 'ERR_BAD_RESPONSE', config, undefined, {
          config,
          data: { errors: [{ message: 'System error' }] },
          headers: {},
          status: 500,
          statusText: 'Internal Server Error',
        })
      );
    };
    const warn = vi.spyOn(apiLogger, 'warn').mockImplementation(() => {});
    const internalClient = (
      client as unknown as {
        httpClient: {
          request: (config: {
            adapter: AxiosAdapter;
            data: unknown;
            method: string;
            timeout: number;
            url: string;
          }) => Promise<unknown>;
        };
      }
    ).httpClient;

    await expect(
      internalClient.request({ adapter, data: payload, method, timeout: 0, url: path })
    ).rejects.toMatchObject({ statusCode: 500 });
    expect(attempts).toBe(1);
    expect(warn).toHaveBeenCalledWith(
      'eBay non-GET server error: automatic retry suppressed; remote outcome may be unknown.',
      { method, status: 500 }
    );
  });
});
