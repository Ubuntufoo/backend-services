import { describe, expect, it, vi } from 'vitest';
import axios, { AxiosError } from 'axios';

import { EbayApiClient } from '@/api/client.js';
import { BrowseMalformedResponseError } from '@/api/buy/browse.js';
import { IdentityApi } from '@/api/other/identity.js';

import {
  ACTIVE_MARKET_PAGE_SIZE,
  buildActiveMarketSnapshot,
  computePriceDistribution,
  projectActiveMarketCompetitors,
  traverseActiveMarket,
  type ActiveMarketTraversalInput,
} from '@/pricing/active-market.js';

const input: ActiveMarketTraversalInput = {
  providerInput: {
    listingId: 'listing-1',
    title: '1990 Pro Set Barry Sanders #102',
    categoryId: '261328',
    conditionId: '4000',
    itemSpecifics: {
      Player: 'Barry Sanders',
      Year: '1990',
      Manufacturer: 'Pro Set',
      Set: 'Pro Set',
      'Card Number': '102',
    },
    browsePricingOptions: {
      skipBrowse: false,
      minPriceMultiplier: 0.33,
      maxPriceMultiplier: 3,
    },
  },
  anchor: {
    value: 2.5,
    currency: 'USD',
    basis: 'condition_adjusted_base_price_before_competitive_velocity',
  },
  shippingContext: { country: 'US', postalCode: '19406' },
};

function item(legacyItemId: string, title: string) {
  return {
    legacyItemId,
    title,
    condition: 'Ungraded',
    conditionId: '4000',
    itemPrice: { value: 1.5, currency: 'USD' },
    shippingCost: null,
    shippingType: null,
    itemUrl: `https://www.ebay.com/itm/${legacyItemId}`,
  };
}

describe('active-market traversal', () => {
  it('marks an empty usable page complete with an exact zero census', async () => {
    const identity = vi.fn().mockResolvedValue('private-seller');
    const search = vi.fn().mockResolvedValue({ items: [], next: null, total: 0 });

    const result = await traverseActiveMarket(input, {
      browse: { search },
      identity: { getUsername: identity },
    });

    expect(result).toMatchObject({
      status: 'available',
      complete: true,
      exactAcceptedCount: 0,
      acceptedCount: 0,
      rejectedCount: 0,
      pagesScanned: 1,
      candidateRowsScanned: 0,
      sellerExclusionApplied: true,
    });
    expect(identity).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('marks a one-page usable result complete and keeps accepted order', async () => {
    const search = vi.fn().mockResolvedValue({
      items: [item('one', '1990 Pro Set Barry Sanders #102')],
      next: null,
      total: 1,
    });

    const result = await traverseActiveMarket(input, {
      browse: { search },
      identity: { getUsername: vi.fn().mockResolvedValue('private-seller') },
    });

    expect(result.complete).toBe(true);
    expect(result.exactAcceptedCount).toBe(1);
    expect(result.acceptedItems.map((entry) => entry.legacyItemId)).toEqual(['one']);
    expect(result.pagesScanned).toBe(1);
    expect(result.candidateRowsScanned).toBe(1);
  });

  it('shares the original deadline signal across an Application-token 401 remint retry', async () => {
    const client = new EbayApiClient({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      environment: 'sandbox',
      redirectUri: 'https://localhost/callback',
    });
    const authClient = (client as unknown as {
      authClient: {
        getOrRefreshAppAccessToken: ReturnType<typeof vi.fn>;
      };
    }).authClient;
    const authCalls: Array<{ forceRefresh?: boolean; signal?: AbortSignal }> = [];
    authClient.getOrRefreshAppAccessToken = vi.fn(
      async (forceRefresh?: boolean, options?: { signal?: AbortSignal }) => {
        authCalls.push({ forceRefresh, signal: options?.signal });
        return forceRefresh ? 'fresh-token' : 'expired-token';
      }
    );

    const unauthorized = new AxiosError('unauthorized');
    unauthorized.response = {
      status: 401,
      statusText: 'Unauthorized',
      headers: {},
      config: {} as never,
      data: {},
    };
    const axiosGet = vi
      .spyOn(axios, 'get')
      .mockRejectedValueOnce(unauthorized)
      .mockImplementationOnce(async (_url, config) => {
        const retrySignal = config?.signal as AbortSignal;
        await new Promise<void>((_resolve, reject) => {
          if (retrySignal.aborted) {
            reject(retrySignal.reason);
            return;
          }
          retrySignal.addEventListener('abort', () => reject(retrySignal.reason), { once: true });
        });
        throw new Error('unreachable');
      });
    const signal = AbortSignal.timeout(10);

    await expect(
      client.getWithApplicationToken('/buy/browse/v1/item_summary/search', undefined, { signal })
    ).rejects.toBeInstanceOf(Error);

    expect(authCalls).toHaveLength(2);
    expect(authCalls[0].signal).toBe(signal);
    expect(authCalls[1]).toMatchObject({ forceRefresh: true, signal });
    expect(axiosGet).toHaveBeenCalledTimes(2);
    expect(axiosGet.mock.calls[0][1]?.signal).toBe(signal);
    expect(axiosGet.mock.calls[1][1]?.signal).toBe(signal);
    axiosGet.mockRestore();
  });

  it('aborts Identity 401 retry on the traversal deadline before Browse starts', async () => {
    const client = new EbayApiClient({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      environment: 'sandbox',
      redirectUri: 'https://localhost/callback',
    });
    const identity = new IdentityApi(client);
    const authClient = (client as unknown as {
      authClient: {
        getAccessToken: ReturnType<typeof vi.fn>;
        refreshUserToken: ReturnType<typeof vi.fn>;
      };
    }).authClient;
    const authSignals: Array<AbortSignal | undefined> = [];
    const refreshSignals: Array<AbortSignal | undefined> = [];
    authClient.getAccessToken = vi.fn(async (options?: { signal?: AbortSignal }) => {
      authSignals.push(options?.signal);
      return authSignals.length === 1 ? 'initial-token' : 'refreshed-token';
    });
    authClient.refreshUserToken = vi.fn(async (options?: { signal?: AbortSignal }) => {
      refreshSignals.push(options?.signal);
    });

    const unauthorized = new AxiosError('unauthorized');
    unauthorized.response = {
      status: 401,
      statusText: 'Unauthorized',
      headers: {},
      config: {} as never,
      data: {},
    };
    const axiosGet = vi
      .spyOn(axios, 'get')
      .mockRejectedValueOnce(unauthorized)
      .mockImplementationOnce(async (_url, config) => {
        const retrySignal = config?.signal as AbortSignal;
        await new Promise<never>((_resolve, reject) => {
          if (retrySignal.aborted) {
            reject(retrySignal.reason);
            return;
          }
          retrySignal.addEventListener('abort', () => reject(retrySignal.reason), { once: true });
        });
        throw new Error('unreachable');
      });
    const browse = vi.fn();

    try {
      const result = await traverseActiveMarket(
        { ...input, safeguards: { maxDurationMs: 25 } },
        { browse: { search: browse }, identity }
      );

      const sharedSignal = authSignals[0];
      expect(sharedSignal).toBeDefined();
      expect(result.status).toBe('unavailable');
      expect(result.unavailableReason).toBe('time_limit');
      expect(browse).not.toHaveBeenCalled();
      expect(authSignals).toEqual([sharedSignal, sharedSignal]);
      expect(refreshSignals).toEqual([sharedSignal]);
      expect(axiosGet.mock.calls[0][1]?.signal).toBe(sharedSignal);
      expect(axiosGet.mock.calls[1][1]?.signal).toBe(sharedSignal);
    } finally {
      axiosGet.mockRestore();
    }
  });

  it('follows pages, filters titles, deduplicates, and preserves eBay order', async () => {
    const search = vi.fn()
      .mockResolvedValueOnce({
        items: [
          item('1', '1990 Pro Set Barry Sanders #102'),
          item('2', '1990 Pro Set Barry Sanders #102 Lot of 2'),
        ],
        next: '/buy/browse/v1/item_summary/search?offset=200',
        total: 300,
      })
      .mockResolvedValueOnce({
        items: [
          item('1', '1990 Pro Set Barry Sanders #102'),
          item('3', '1990 Pro Set Barry Sanders #102'),
        ],
        next: null,
        total: 300,
      });

    const result = await traverseActiveMarket(input, {
      browse: { search },
      identity: { getUsername: vi.fn().mockResolvedValue('private-seller') },
    });

    expect(result.complete).toBe(true);
    expect(result.acceptedItems.map((entry) => entry.legacyItemId)).toEqual(['1', '3']);
    expect(result.rejectedCount).toBe(1);
    expect(result.rejectionReasonCounts.active_multi_card_mismatch).toBe(1);
    expect(result.candidateRowsScanned).toBe(4);
    expect(result.acceptedCount).toBe(2);
    expect(result.pagesScanned).toBe(2);
    expect(search).toHaveBeenCalledTimes(2);
    expect(search.mock.calls[0][0]).toMatchObject({
      limit: ACTIVE_MARKET_PAGE_SIZE,
      excludeSellerUsername: 'private-seller',
      minItemPrice: 0.82,
      maxItemPrice: 7.5,
    });
    expect(JSON.stringify(result)).not.toContain('private-seller');
  });

  it('retains rows but marks traversal incomplete at a visible safeguard', async () => {
    const search = vi.fn().mockResolvedValue({
      items: [item('1', '1990 Pro Set Barry Sanders #102')],
      next: '/buy/browse/v1/item_summary/search?offset=200',
      total: 300,
    });

    const result = await traverseActiveMarket(
      { ...input, safeguards: { maxPages: 1 } },
      {
        browse: { search },
        identity: { getUsername: vi.fn().mockResolvedValue('private-seller') },
      }
    );

    // A normal two-page result is not made incomplete by the production defaults.
    expect(result.complete).toBe(false);
    expect(result.incompleteReason).toBe('page_limit');
    expect(result.acceptedItems.map((entry) => entry.legacyItemId)).toEqual(['1']);
    expect(result.acceptedCount).toBe(1);
    expect(result.exactAcceptedCount).toBeNull();
    expect(result.safeguards.maxPages).toBe(1);
  });

  it('stops before consuming a continuation above maxOffset', async () => {
    const search = vi.fn().mockResolvedValue({
      items: [item('offset-row', '1990 Pro Set Barry Sanders #102')],
      next: '/buy/browse/v1/item_summary/search?offset=200',
      total: 300,
    });

    const result = await traverseActiveMarket(
      { ...input, safeguards: { maxOffset: 100 } },
      {
        browse: { search },
        identity: { getUsername: vi.fn().mockResolvedValue('private-seller') },
      }
    );

    expect(result).toMatchObject({
      status: 'available',
      complete: false,
      incompleteReason: 'offset_limit',
      acceptedCount: 1,
      exactAcceptedCount: null,
      pagesScanned: 1,
    });
    expect(search).toHaveBeenCalledTimes(1);
    expect(search.mock.calls[0]?.[0]).not.toHaveProperty('next');
  });

  it.each([
    ['/buy/browse/v1/item_summary/search?offset=0', 'same offset'],
    ['/buy/browse/v1/item_summary/search?offset=not-a-number', 'malformed offset'],
    ['https://evil.example/buy/browse/v1/item_summary/search?offset=200', 'unsafe host'],
    ['/buy/browse/v1/item_summary/other?offset=200', 'unsafe path'],
  ])('commits a usable page but rejects an unsafe or non-monotonic %s continuation', async (next) => {
    const search = vi.fn().mockResolvedValue({
      items: [item('continuation-row', '1990 Pro Set Barry Sanders #102')],
      next,
      total: 300,
    });

    const result = await traverseActiveMarket(input, {
      browse: { search },
      identity: { getUsername: vi.fn().mockResolvedValue('private-seller') },
    });

    expect(result).toMatchObject({
      status: 'available',
      complete: false,
      incompleteReason: 'page_error',
      acceptedCount: 1,
      exactAcceptedCount: null,
      pagesScanned: 1,
    });
    expect(result.acceptedItems.map((entry) => entry.legacyItemId)).toEqual(['continuation-row']);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('rejects a backward continuation after committing the preceding usable page', async () => {
    const search = vi.fn().mockResolvedValueOnce({
      items: [item('forward-row', '1990 Pro Set Barry Sanders #102')],
      next: '/buy/browse/v1/item_summary/search?offset=200',
      total: 300,
    }).mockResolvedValueOnce({
      items: [item('backward-row', '1990 Pro Set Barry Sanders #102')],
      next: '/buy/browse/v1/item_summary/search?offset=100',
      total: 300,
    });

    const result = await traverseActiveMarket(input, {
      browse: { search },
      identity: { getUsername: vi.fn().mockResolvedValue('private-seller') },
    });

    expect(result).toMatchObject({
      status: 'available',
      complete: false,
      incompleteReason: 'page_error',
      pagesScanned: 2,
      acceptedCount: 2,
      exactAcceptedCount: null,
    });
    expect(result.acceptedItems.map((entry) => entry.legacyItemId)).toEqual([
      'forward-row',
      'backward-row',
    ]);
    expect(search).toHaveBeenCalledTimes(2);
  });

  it('retains accepted rows and gates exact stats on a time-limited partial scan', async () => {
    let calls = 0;
    const now = vi.fn(() => {
      calls += 1;
      return calls >= 5 ? 1_000 : 0;
    });
    const search = vi.fn().mockResolvedValue({
      items: [item('time-row', '1990 Pro Set Barry Sanders #102')],
      next: '/buy/browse/v1/item_summary/search?offset=200',
      total: 300,
    });

    const result = await traverseActiveMarket(
      { ...input, safeguards: { maxDurationMs: 100 } },
      {
        browse: { search },
        identity: { getUsername: vi.fn().mockResolvedValue('private-seller') },
        now,
      }
    );

    expect(result).toMatchObject({
      status: 'available',
      complete: false,
      incompleteReason: 'time_limit',
      acceptedCount: 1,
      exactAcceptedCount: null,
      pagesScanned: 1,
    });
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('passes remaining timeout to each page and rejects an in-flight overrun', async () => {
    let elapsed = 0;
    const search = vi.fn(async ({ timeoutMs }: { timeoutMs?: number }) => {
      await new Promise((resolve) => setTimeout(resolve, (timeoutMs ?? 0) + 1));
      elapsed = (timeoutMs ?? 0) + 1;
      return {
        items: [item('late', '1990 Pro Set Barry Sanders #102')],
        next: null,
        total: 1,
      };
    });

    const result = await traverseActiveMarket(
      { ...input, safeguards: { maxDurationMs: 10 } },
      {
        browse: { search },
        identity: { getUsername: vi.fn().mockResolvedValue('private-seller') },
        now: () => elapsed,
      }
    );

    expect(search).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 10 }));
    expect(result.status).toBe('unavailable');
    expect(result.unavailableReason).toBe('time_limit');
    expect(result.pagesScanned).toBe(0);
    expect(result.acceptedItems).toEqual([]);
  });

  it.each([
    ['api', Object.assign(new Error('server failure'), { statusCode: 500 }), 'api_failed'],
    ['auth', Object.assign(new Error('unauthorized'), { statusCode: 401 }), 'auth_failed'],
    ['malformed', new BrowseMalformedResponseError('itemSummaries'), 'malformed_response'],
  ])('returns unavailable/%s before the first usable page', async (_kind, error, reason) => {
    const identity = vi.fn().mockResolvedValue('private-seller');
    const search = vi.fn().mockRejectedValue(error);

    const result = await traverseActiveMarket(input, {
      browse: { search },
      identity: { getUsername: identity },
    });

    expect(result).toMatchObject({
      status: 'unavailable',
      unavailableReason: reason,
      complete: false,
      pagesScanned: 0,
      acceptedItems: [],
      exactAcceptedCount: null,
      sellerExclusionApplied: false,
    });
    expect(identity).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['api', Object.assign(new Error('server failure'), { statusCode: 500 })],
    ['auth', Object.assign(new Error('unauthorized'), { statusCode: 401 })],
    ['malformed', new BrowseMalformedResponseError('itemSummaries')],
  ])('returns available/incomplete page_error after a usable %s page', async (_kind, error) => {
    const search = vi
      .fn()
      .mockResolvedValueOnce({
        items: [item('retained', '1990 Pro Set Barry Sanders #102')],
        next: '/buy/browse/v1/item_summary/search?offset=200',
        total: 300,
      })
      .mockRejectedValueOnce(error);

    const result = await traverseActiveMarket(input, {
      browse: { search },
      identity: { getUsername: vi.fn().mockResolvedValue('private-seller') },
    });

    expect(result).toMatchObject({
      status: 'available',
      incompleteReason: 'page_error',
      complete: false,
      pagesScanned: 1,
      acceptedCount: 1,
      exactAcceptedCount: null,
    });
    expect(result.acceptedItems.map((entry) => entry.legacyItemId)).toEqual(['retained']);
    expect(search).toHaveBeenCalledTimes(2);
  });

  it('always uses anchor currency; traversal input has no currency override', async () => {
    const search = vi.fn().mockResolvedValue({
      items: [],
      next: null,
      total: 0,
    });

    const result = await traverseActiveMarket(
      { ...input, currency: 'EUR' } as ActiveMarketTraversalInput,
      {
        browse: { search },
        identity: { getUsername: vi.fn().mockResolvedValue('private-seller') },
      }
    );

    expect(search).toHaveBeenCalledWith(expect.objectContaining({ currency: 'USD' }));
    expect(result.itemPriceWindow?.currency).toBe('USD');
  });

  it('does not call Identity or Browse when Browse is disabled', async () => {
    const identity = vi.fn();
    const search = vi.fn();

    const result = await traverseActiveMarket(
      {
        ...input,
        options: { skipBrowse: true, minPriceMultiplier: 0.33, maxPriceMultiplier: 3 },
      },
      { browse: { search }, identity: { getUsername: identity } }
    );

    expect(result).toMatchObject({ status: 'skipped', skipReason: 'browse_disabled' });
    expect(identity).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
  });

  it('fails closed on invalid options before calling Identity or Browse', async () => {
    const identity = vi.fn();
    const search = vi.fn();

    const result = await traverseActiveMarket(
      { ...input, options: { minPriceMultiplier: 0 } },
      { browse: { search }, identity: { getUsername: identity } }
    );

    expect(result).toMatchObject({ status: 'unavailable', unavailableReason: 'invalid_options' });
    expect(identity).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
  });

  it('fails closed on a missing anchor before calling Identity or Browse', async () => {
    const identity = vi.fn();
    const search = vi.fn();

    const result = await traverseActiveMarket(
      { ...input, anchor: null },
      { browse: { search }, identity: { getUsername: identity } }
    );

    expect(result).toMatchObject({ status: 'unavailable', unavailableReason: 'missing_anchor' });
    expect(identity).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
  });

  it('fails closed on Identity failure before calling Browse', async () => {
    const identity = vi.fn().mockRejectedValue(new Error('identity unavailable'));
    const search = vi.fn();

    const result = await traverseActiveMarket(input, {
      browse: { search },
      identity: { getUsername: identity },
    });

    expect(result).toMatchObject({
      status: 'unavailable',
      unavailableReason: 'seller_identity_unavailable',
      sellerExclusionApplied: false,
    });
    expect(identity).toHaveBeenCalledTimes(1);
    expect(search).not.toHaveBeenCalled();
  });

  it('fails closed when Browse is requested without a complete shipping context', async () => {
    const search = vi.fn();
    const identity = vi.fn().mockResolvedValue('private-seller');
    const result = await traverseActiveMarket(
      { ...input, shippingContext: undefined },
      {
        browse: { search },
        identity: { getUsername: identity },
        environment: {},
      }
    );

    expect(result.status).toBe('unavailable');
    expect(result.unavailableReason).toBe('missing_shipping_context');
    expect(result.shippingContext).toBeNull();
    expect(identity).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
  });
});

describe('active-market projection and distributions', () => {
  it('projects the approved competitor shape in accepted traversal order', () => {
    const rows = [
      {
        ...item('first', 'first'),
        condition: null,
        shippingCost: { value: 0.5, currency: 'USD' },
        shippingType: 'FREE_SHIPPING',
      },
      {
        ...item('second', 'second'),
        itemPrice: { value: 2, currency: 'USD' },
        shippingCost: null,
      },
    ];

    expect(projectActiveMarketCompetitors(rows)).toEqual([
      {
        legacyItemId: 'first',
        title: 'first',
        condition: null,
        conditionId: '4000',
        itemPrice: { value: 1.5, currency: 'USD' },
        shippingCost: { value: 0.5, currency: 'USD' },
        shippingType: 'FREE_SHIPPING',
        totalPrice: { value: 2, currency: 'USD' },
        itemUrl: 'https://www.ebay.com/itm/first',
      },
      {
        legacyItemId: 'second',
        title: 'second',
        condition: 'Ungraded',
        conditionId: '4000',
        itemPrice: { value: 2, currency: 'USD' },
        shippingCost: null,
        shippingType: null,
        totalPrice: null,
        itemUrl: 'https://www.ebay.com/itm/second',
      },
    ]);
  });

  it('only computes total price for finite, non-negative, same-currency shipping', () => {
    const rows = [
      { ...item('missing', 'missing') },
      { ...item('currency', 'currency'), shippingCost: { value: 1, currency: 'EUR' } },
      { ...item('negative', 'negative'), shippingCost: { value: -1, currency: 'USD' } },
      { ...item('nan', 'nan'), shippingCost: { value: Number.NaN, currency: 'USD' } },
      { ...item('zero', 'zero'), shippingCost: { value: 0, currency: 'USD' } },
      {
        ...item('invalid-item', 'invalid-item'),
        itemPrice: { value: -1, currency: 'USD' },
        shippingCost: { value: 1, currency: 'USD' },
      },
      { ...item('usable', 'usable'), shippingCost: { value: 1, currency: 'USD' } },
    ];

    expect(projectActiveMarketCompetitors(rows).map((entry) => entry.totalPrice)).toEqual([
      null,
      null,
      null,
      null,
      { value: 1.5, currency: 'USD' },
      null,
      { value: 2.5, currency: 'USD' },
    ]);
  });

  it('computes odd/even medians without cross-currency aggregation', () => {
    expect(
      computePriceDistribution([
        { value: 5, currency: 'USD' },
        { value: 1, currency: 'USD' },
        { value: 3, currency: 'USD' },
      ])
    ).toEqual({ low: 1, median: 3, high: 5, currency: 'USD' });
    expect(
      computePriceDistribution([
        { value: 4, currency: 'USD' },
        { value: 1, currency: 'USD' },
        { value: 3, currency: 'USD' },
        { value: 2, currency: 'USD' },
      ])
    ).toEqual({ low: 1, median: 2.5, high: 4, currency: 'USD' });
    expect(
      computePriceDistribution([
        { value: 5, currency: 'USD' },
        { value: 1, currency: 'EUR' },
      ])
    ).toBeNull();
  });

  it('gates exact census and distributions on complete traversal', () => {
    const rows = [
      { ...item('known', 'known'), shippingCost: { value: 1, currency: 'USD' } },
      { ...item('unknown', 'unknown'), itemPrice: { value: 2, currency: 'USD' } },
    ];

    expect(buildActiveMarketSnapshot(rows, false)).toMatchObject({
      complete: false,
      exactAcceptedCount: null,
      shippingKnownAcceptedCount: 1,
      itemPriceDistribution: null,
      shippingKnownTotalDistribution: null,
      tacticalSellPrice: null,
    });
    expect(buildActiveMarketSnapshot(rows, true)).toMatchObject({
      complete: true,
      exactAcceptedCount: 2,
      shippingKnownAcceptedCount: 1,
      itemPriceDistribution: { low: 1.5, median: 1.75, high: 2, currency: 'USD' },
      shippingKnownTotalDistribution: { low: 2.5, median: 2.5, high: 2.5, currency: 'USD' },
    });
  });
});
