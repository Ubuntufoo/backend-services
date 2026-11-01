import { describe, expect, it, vi } from 'vitest';

import {
  OUT_OF_STOCK_MARKETPLACE,
  OUT_OF_STOCK_SANDBOX_OAUTH_URL,
  OUT_OF_STOCK_SANDBOX_ORIGIN,
  QTY_REGRESSION_GROUP_ID,
  QTY_REGRESSION_FAILED_OPERATION_KEY,
  QTY_REGRESSION_FAILED_REVISION_ID,
  QTY_REGRESSION_LISTING_ID,
  QTY_REGRESSION_TARGET_OFFER_ID,
  QTY_REGRESSION_TARGET_SKU,
  createSandboxApi,
  parseEnableOutOfStockArgs,
  resolveQtyRegressionListingId,
  runEnableSandboxOutOfStockControlCli,
  validateOutOfStockEnvironment,
  type DurableListingDataAccess,
  type SandboxSellerApi,
} from '@/scripts/enable-sandbox-out-of-stock-control.js';

const baseEnv = (): NodeJS.ProcessEnv => ({
  EBAY_ENVIRONMENT: 'sandbox',
  EBAY_MARKETPLACE_ID: OUT_OF_STOCK_MARKETPLACE,
  EBAY_REFRESH_TOKEN: 'refresh-token',
  EBAY_API_BASE_URL: OUT_OF_STOCK_SANDBOX_ORIGIN,
  EBAY_OAUTH_BASE_URL: OUT_OF_STOCK_SANDBOX_OAUTH_URL,
});

const data = (listingId = QTY_REGRESSION_LISTING_ID): DurableListingDataAccess => ({
  variationListings: {
    listGroups: vi.fn(async () => [{ groupId: QTY_REGRESSION_GROUP_ID, lastConfirmedRevision: 7 }]),
    listRevisionsByGroupId: vi.fn(async () => [{
      revisionId: 'confirmed-revision',
      groupId: QTY_REGRESSION_GROUP_ID,
      capturedDesiredRevision: 7,
      snapshot: { confirmed: { remote: { listingId, offerIdsBySku: { [QTY_REGRESSION_TARGET_SKU]: QTY_REGRESSION_TARGET_OFFER_ID } } } },
    }, {
      revisionId: QTY_REGRESSION_FAILED_REVISION_ID,
      groupId: QTY_REGRESSION_GROUP_ID,
      capturedDesiredRevision: 8,
      operationPlan: [{ operation_key: QTY_REGRESSION_FAILED_OPERATION_KEY, target_ref: QTY_REGRESSION_TARGET_SKU }],
    }]),
    listCheckpointsByRevisionId: vi.fn(async () => [{
      revisionId: 'confirmed-revision',
      state: 'confirmed_complete',
      observedRemoteState: 'present',
      evidence: { listingId },
    }]),
  },
});

const api = (before: boolean, after = true): SandboxSellerApi => ({
  getTradingUser: vi.fn(async () => ({ userId: 'seller-123' })),
  getTradingItem: vi.fn(async (itemId: string) => ({ itemId, sellerUserId: 'seller-123' })),
  getUserPreferences: vi.fn()
    .mockResolvedValueOnce({ outOfStockControl: before })
    .mockResolvedValueOnce({ outOfStockControl: after }),
  setUserPreferences: vi.fn(async () => ({ ack: 'Success' })),
});

describe('enable Sandbox OutOfStockControlPreference once', () => {
  it('rejects wrong environment, marketplace, URL, and production material', () => {
    expect(() => validateOutOfStockEnvironment({ ...baseEnv(), EBAY_ENVIRONMENT: 'production' })).toThrow(/sandbox/i);
    expect(() => validateOutOfStockEnvironment({ ...baseEnv(), EBAY_MARKETPLACE_ID: 'EBAY_GB' })).toThrow(/EBAY_US/);
    expect(() => validateOutOfStockEnvironment({ ...baseEnv(), EBAY_API_BASE_URL: 'https://api.ebay.com' })).toThrow(/exact Sandbox/);
    expect(() => validateOutOfStockEnvironment({ ...baseEnv(), EBAY_PRODUCTION_CLIENT_SECRET: 'secret' })).toThrow(/Production/);
    expect(() => validateOutOfStockEnvironment({ ...baseEnv(), EBAY_USER_REFRESH_TOKEN: 'other-refresh' })).toThrow(/exactly one/);
    expect(() => parseEnableOutOfStockArgs([])).toThrow(/explicit/);
  });

  it('binds the exact durable QtyRegression01 listing identity', async () => {
    await expect(resolveQtyRegressionListingId(data())).resolves.toBe(QTY_REGRESSION_LISTING_ID);
    const wrong = data();
    wrong.variationListings.listGroups = vi.fn(async () => [{ groupId: 'other', lastConfirmedRevision: 7 }]);
    await expect(resolveQtyRegressionListingId(wrong)).rejects.toThrow(/missing or ambiguous/);
    await expect(resolveQtyRegressionListingId(data('110591486627'))).rejects.toThrow(/durable fixture/);
    await expect(resolveQtyRegressionListingId(data('foreign-listing'))).rejects.toThrow(/durable fixture/);
  });

  it('does not write when preference is already true', async () => {
    const sellerApi = api(true);
    const print = vi.fn();
    const report = await runEnableSandboxOutOfStockControlCli(['--execute'], {
      env: baseEnv(), loadRootEnvironment: vi.fn(), createApi: () => sellerApi, createDataAccess: () => data(), print,
    });
    expect(report).toMatchObject({ status: 'verified', before: true, setUserPreferencesCalls: 0, after: true });
    expect(sellerApi.setUserPreferences).not.toHaveBeenCalled();
    expect(sellerApi.getUserPreferences).toHaveBeenCalledOnce();
    expect(print).toHaveBeenCalledOnce();
  });

  it('writes exactly once with false→true and verifies post-state', async () => {
    const sellerApi = api(false, true);
    const report = await runEnableSandboxOutOfStockControlCli(['--execute'], {
      env: baseEnv(), loadRootEnvironment: vi.fn(), createApi: () => sellerApi, createDataAccess: () => data(), print: vi.fn(),
    });
    expect(report).toMatchObject({ status: 'verified', before: false, setUserPreferencesCalls: 1, setAck: 'Success', after: true });
    expect(sellerApi.setUserPreferences).toHaveBeenCalledOnce();
    expect(sellerApi.getUserPreferences).toHaveBeenCalledTimes(2);
  });

  it('fails closed on missing or ambiguous durable preference', async () => {
    const sellerApi = api(false);
    sellerApi.getUserPreferences = vi.fn(async () => ({ outOfStockControl: undefined as unknown as boolean }));
    await expect(runEnableSandboxOutOfStockControlCli(['--execute'], {
      env: baseEnv(), loadRootEnvironment: vi.fn(), createApi: () => sellerApi, createDataAccess: () => data(), print: vi.fn(),
    })).rejects.toThrow(/ambiguous/);
    expect(sellerApi.setUserPreferences).not.toHaveBeenCalled();
  });

  it('does not retry a failed or unknown Set ack and performs at most one read-only after-check', async () => {
    const sellerApi = api(false, true);
    sellerApi.setUserPreferences = vi.fn(async () => ({ ack: 'Failure' }));
    const report = await runEnableSandboxOutOfStockControlCli(['--execute'], {
      env: baseEnv(), loadRootEnvironment: vi.fn(), createApi: () => sellerApi, createDataAccess: () => data(), print: vi.fn(),
    });
    expect(report).toMatchObject({ status: 'blocked', setUserPreferencesCalls: 1, setAck: 'Failure', after: true });
    expect(sellerApi.setUserPreferences).toHaveBeenCalledOnce();
    expect(sellerApi.getUserPreferences).toHaveBeenCalledTimes(2);
  });

  it('stops before preferences when Trading GetItem owner mismatches', async () => {
    const sellerApi = api(false);
    sellerApi.getTradingItem = vi.fn(async (itemId: string) => ({ itemId, sellerUserId: 'other-seller' }));
    await expect(runEnableSandboxOutOfStockControlCli(['--execute'], {
      env: baseEnv(), loadRootEnvironment: vi.fn(), createApi: () => sellerApi, createDataAccess: () => data(), print: vi.fn(),
    })).rejects.toThrow(/ownership/);
    expect(sellerApi.getUserPreferences).not.toHaveBeenCalled();
    expect(sellerApi.setUserPreferences).not.toHaveBeenCalled();
  });

  it('uses exact Sandbox Trading URLs, auth headers, and minimal preference XML', async () => {
    const responses = [
      { ok: true, status: 200, json: async () => ({ access_token: 'access-token', expires_in: 3600, token_type: 'Bearer' }) },
      { ok: true, status: 200, text: async () => '<GetUserResponse xmlns="urn:ebay:apis:eBLBaseComponents"><Ack>Success</Ack><User><UserID>seller-123</UserID></User></GetUserResponse>' },
      { ok: true, status: 200, text: async () => '<GetItemResponse xmlns="urn:ebay:apis:eBLBaseComponents"><Ack>Success</Ack><Item><ItemID>110591486626</ItemID><Seller><UserID>seller-123</UserID></Seller></Item></GetItemResponse>' },
      { ok: true, status: 200, text: async () => '<GetUserPreferencesResponse xmlns="urn:ebay:apis:eBLBaseComponents"><Ack>Success</Ack><OutOfStockControlPreference>false</OutOfStockControlPreference></GetUserPreferencesResponse>' },
      { ok: true, status: 200, text: async () => '<SetUserPreferencesResponse xmlns="urn:ebay:apis:eBLBaseComponents"><Ack>Success</Ack></SetUserPreferencesResponse>' },
    ];
    const fetchImpl = vi.fn(async () => responses.shift());
    const sellerApi = await createSandboxApi({ ...baseEnv(), EBAY_CLIENT_ID: 'client-id', EBAY_CLIENT_SECRET: 'client-secret' }, fetchImpl as unknown as typeof fetch);
    await expect(sellerApi.getTradingUser()).resolves.toEqual({ userId: 'seller-123' });
    await expect(sellerApi.getTradingItem(QTY_REGRESSION_LISTING_ID)).resolves.toEqual({ itemId: QTY_REGRESSION_LISTING_ID, sellerUserId: 'seller-123' });
    await expect(sellerApi.getUserPreferences()).resolves.toEqual({ outOfStockControl: false });
    await expect(sellerApi.setUserPreferences()).resolves.toEqual({ ack: 'Success' });
    expect(fetchImpl).toHaveBeenCalledTimes(5);
    expect(fetchImpl.mock.calls[1]?.[0]).toBe('https://api.sandbox.ebay.com/ws/api.dll');
    const requestBody = (call: number): string => {
      const body = (fetchImpl.mock.calls[call]?.[1] as RequestInit | undefined)?.body;
      return typeof body === 'string' ? body : body instanceof URLSearchParams ? body.toString() : '';
    };
    const getPreferencesBody = requestBody(3);
    const setPreferencesBody = requestBody(4);
    expect(getPreferencesBody).toContain('<ShowOutOfStockControlPreference>true</ShowOutOfStockControlPreference>');
    expect(setPreferencesBody).toContain('<OutOfStockControlPreference>true</OutOfStockControlPreference>');
    expect(setPreferencesBody).not.toContain('ShowOutOfStockControlPreference');
    expect(setPreferencesBody.match(/<OutOfStockControlPreference>/g)).toHaveLength(1);
    expect((fetchImpl.mock.calls[4]?.[1] as RequestInit).headers).toMatchObject({ 'X-EBAY-API-IAF-TOKEN': 'access-token' });
  });

  it('treats a non-success Set ack as blocked and reads once after, without retry', async () => {
    const responses = [
      { ok: true, status: 200, json: async () => ({ access_token: 'access-token', expires_in: 3600, token_type: 'Bearer' }) },
      { ok: true, status: 200, text: async () => '<GetUserResponse xmlns="urn:ebay:apis:eBLBaseComponents"><Ack>Success</Ack><User><UserID>seller-123</UserID></User></GetUserResponse>' },
      { ok: true, status: 200, text: async () => '<GetItemResponse xmlns="urn:ebay:apis:eBLBaseComponents"><Ack>Success</Ack><Item><ItemID>110591486626</ItemID><Seller><UserID>seller-123</UserID></Seller></Item></GetItemResponse>' },
      { ok: true, status: 200, text: async () => '<GetUserPreferencesResponse xmlns="urn:ebay:apis:eBLBaseComponents"><Ack>Success</Ack><OutOfStockControlPreference>false</OutOfStockControlPreference></GetUserPreferencesResponse>' },
      { ok: true, status: 200, text: async () => '<SetUserPreferencesResponse xmlns="urn:ebay:apis:eBLBaseComponents"><Ack>Warning</Ack></SetUserPreferencesResponse>' },
      { ok: true, status: 200, text: async () => '<GetUserPreferencesResponse xmlns="urn:ebay:apis:eBLBaseComponents"><Ack>Success</Ack><OutOfStockControlPreference>true</OutOfStockControlPreference></GetUserPreferencesResponse>' },
    ];
    const fetchImpl = vi.fn(async () => responses.shift());
    const report = await runEnableSandboxOutOfStockControlCli(['--execute'], {
      env: { ...baseEnv(), EBAY_CLIENT_ID: 'client-id', EBAY_CLIENT_SECRET: 'client-secret' },
      loadRootEnvironment: vi.fn(),
      createApi: () => createSandboxApi({ ...baseEnv(), EBAY_CLIENT_ID: 'client-id', EBAY_CLIENT_SECRET: 'client-secret' }, fetchImpl as unknown as typeof fetch),
      createDataAccess: () => data(), print: vi.fn(),
    });
    expect(report).toMatchObject({ status: 'blocked', setUserPreferencesCalls: 1, after: true });
    const calls = fetchImpl.mock.calls.map(([, options]) => (options as RequestInit | undefined)?.headers && (options as RequestInit).headers as Record<string, string>);
    expect(calls.filter((headers) => headers?.['X-EBAY-API-CALL-NAME'] === 'SetUserPreferences')).toHaveLength(1);
    expect(calls.filter((headers) => headers?.['X-EBAY-API-CALL-NAME'] === 'GetUserPreferences')).toHaveLength(2);
  });

  it('rejects malformed or duplicate Trading response roots/Acks and scopes seller to Item.Seller', async () => {
    const malformedFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ access_token: 'access-token', expires_in: 3600, token_type: 'Bearer' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => '<GetUserResponse xmlns="urn:ebay:apis:eBLBaseComponents"><Ack>Success</Ack><User><UserID>seller-123</UserID></User></GetUserResponse><GetUserResponse xmlns="urn:ebay:apis:eBLBaseComponents"><Ack>Success</Ack></GetUserResponse>' });
    const malformedApi = await createSandboxApi({ ...baseEnv(), EBAY_CLIENT_ID: 'client-id', EBAY_CLIENT_SECRET: 'client-secret' }, malformedFetch as unknown as typeof fetch);
    await expect(malformedApi.getTradingUser()).rejects.toThrow(/root/);

    const duplicateAckFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ access_token: 'access-token', expires_in: 3600, token_type: 'Bearer' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => '<GetUserResponse xmlns="urn:ebay:apis:eBLBaseComponents"><Ack>Success</Ack><Ack>Success</Ack><User><UserID>seller-123</UserID></User></GetUserResponse>' });
    const duplicateAckApi = await createSandboxApi({ ...baseEnv(), EBAY_CLIENT_ID: 'client-id', EBAY_CLIENT_SECRET: 'client-secret' }, duplicateAckFetch as unknown as typeof fetch);
    await expect(duplicateAckApi.getTradingUser()).rejects.toThrow(/ambiguous Ack/);

    const sellerScopedFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ access_token: 'access-token', expires_in: 3600, token_type: 'Bearer' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => '<GetItemResponse xmlns="urn:ebay:apis:eBLBaseComponents"><Ack>Success</Ack><Item><ItemID>110591486626</ItemID><UserID>foreign-user</UserID><Seller><UserID>seller-123</UserID></Seller></Item></GetItemResponse>' });
    const sellerScopedApi = await createSandboxApi({ ...baseEnv(), EBAY_CLIENT_ID: 'client-id', EBAY_CLIENT_SECRET: 'client-secret' }, sellerScopedFetch as unknown as typeof fetch);
    await expect(sellerScopedApi.getTradingItem(QTY_REGRESSION_LISTING_ID)).resolves.toEqual({ itemId: QTY_REGRESSION_LISTING_ID, sellerUserId: 'seller-123' });
  });
});
