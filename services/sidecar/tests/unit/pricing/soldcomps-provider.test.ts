import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
  SoldCompsPricingProviderError,
  buildSoldCompsQuery,
  buildSoldCompsRequestParams,
  createSoldCompsPricingProvider,
  parseSoldCompsUsageHeaders,
  parseSoldCompsResponse,
  redactSoldCompsSensitiveText,
} from '@/pricing/index.js';
import { buildSoldCompsKeyword } from '@/pricing/soldcomps-keyword.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureDir = path.resolve(__dirname, '../../fixtures/soldcomps');
const soldCompsFixture = JSON.parse(
  readFileSync(path.join(fixtureDir, 'scrape-response-single-000007.json'), 'utf8')
) as {
  hasNextPage: boolean;
  items: Array<Record<string, unknown>>;
  keyword: string;
  page: number;
  totalItems: number;
};

describe('SoldComps pricing provider', () => {
  const baseInput = {
    categoryId: '261328',
    conditionId: '2750',
    itemSpecifics: {
      'Card Number': '98',
      Manufacturer: 'Topps',
      Player: 'Johnny Riddle',
      Set: 'Topps',
      Year: '1955',
    },
    listingId: 'LIST-001',
    listingType: 'single' as const,
    requestedCompCount: 12,
    title: 'Johnny Riddle 1955 Topps #98 St. Louis Cardinals Coach',
  };

  it('builds expected request params from pricing context', () => {
    expect(buildSoldCompsRequestParams(baseInput)).toEqual({
      count: 12,
      ebaySite: 'ebay.com',
      keyword: buildSoldCompsQuery(baseInput),
      page: 1,
      sortOrder: 'endedRecently',
    });
  });

  it('uses SoldComps default requested comp count of 50 when input omits requestedCompCount', () => {
    expect(
      buildSoldCompsRequestParams({
        ...baseInput,
        requestedCompCount: undefined,
      })
    ).toMatchObject({
      count: 50,
    });
  });

  it('appends stable negative modifiers for raw single-card searches only', () => {
    expect(
      buildSoldCompsRequestParams({
        ...baseInput,
        conditionId: '4000',
        title: 'Darryl Strawberry 1997 Fleer #179',
        itemSpecifics: {
          'Card Number': '179',
          Manufacturer: 'Fleer',
          Player: 'Darryl Strawberry',
          Set: 'Fleer',
          Year: '1997',
        },
      }).keyword
    ).toBe(
      'Darryl Strawberry 1997 Fleer #179 -pick -choose -complete -lot -signed -auto -autograph -graded -slab -slabbed -PSA -BGS -SGC -CGC -CSG -TAG -HGA -MBA -GMA -KSA -ISA -WCG -BCCG -Beckett'
    );
  });

  it('keeps placeholder parallel facets out of SoldComps keyword', () => {
    expect(
      buildSoldCompsRequestParams({
        ...baseInput,
        conditionId: '4000',
        itemSpecifics: {
          'Card Number': '125',
          'Insert Set': 'N/A',
          Manufacturer: 'Topps',
          'Parallel/Variety': 'Base',
          Player: 'John Hadl',
          Set: 'Topps Football',
          Year: '1967',
        },
        listingId: 'Single-000014',
        title: 'John Hadl 1967 Topps #125',
      }).keyword
    ).toBe(
      'John Hadl 1967 Topps Football #125 -pick -choose -complete -lot -signed -auto -autograph -graded -slab -slabbed -PSA -BGS -SGC -CGC -CSG -TAG -HGA -MBA -GMA -KSA -ISA -WCG -BCCG -Beckett'
    );
  });

  it('does not append raw-card grading exclusions for graded targets', () => {
    expect(buildSoldCompsRequestParams(baseInput).keyword).toBe('Johnny Riddle 1955 Topps #98 graded');
  });

  it('keeps rookie, RC, and set-break comps allowed in raw SoldComps keywords', () => {
    const keyword = buildSoldCompsRequestParams({
      ...baseInput,
      conditionId: '4000',
      title: 'Victor Wembanyama 2023 Panini Prizm #136 Rookie RC Set Break',
    }).keyword;

    expect(keyword).not.toContain('-rookie');
    expect(keyword).not.toContain('-RC');
    expect(keyword).not.toContain('-set break');
    expect(keyword).not.toContain('-set-break');
  });

  it('keeps modifiers stable and avoids duplicate equivalent negatives', () => {
    const rawInput = {
      categoryId: '261328',
      conditionId: '4000',
      itemSpecifics: {
        'Card Number': '179',
        Manufacturer: 'Fleer',
        Player: 'Darryl Strawberry',
        Set: 'Fleer',
        Year: '1997',
      },
      listingId: 'LIST-DUPES',
      listingType: 'single',
      requestedCompCount: 20,
      title: 'Darryl Strawberry 1997 Fleer #179',
    } as const;

    const keyword = buildSoldCompsKeyword(
      rawInput,
      'Darryl Strawberry 1997 Fleer #179 -"you pick" -signed -PSA'
    );

    expect(keyword).toBe(
      'Darryl Strawberry 1997 Fleer #179 -"you pick" -signed -PSA -pick -choose -complete -lot -auto -autograph -graded -slab -slabbed -BGS -SGC -CGC -CSG -TAG -HGA -MBA -GMA -KSA -ISA -WCG -BCCG -Beckett'
    );
    expect(keyword.match(/-"you pick"/g)).toHaveLength(1);
    expect(keyword.match(/-signed/g)).toHaveLength(1);
    expect(keyword.match(/-PSA/g)).toHaveLength(1);
  });

  it('sends bearer-auth request against v1 scrape endpoint', async () => {
    const fetch = vi.fn(async () => ({
      headers: new Headers({
        'x-usage-limit': '2000',
        'x-usage-used': '43',
      }),
      json: async () => soldCompsFixture,
      ok: true,
      status: 200,
    })) as typeof globalThis.fetch;
    const provider = createSoldCompsPricingProvider(
      {
        apiKey: 'sc_secret-token',
      },
      { fetch }
    );

    await provider.fetchSoldComps({
      ...baseInput,
      requestedCompCount: undefined,
    });

    expect(fetch).toHaveBeenCalledWith(
      expect.objectContaining({
        href: expect.stringContaining('https://api.sold-comps.com/v1/scrape?'),
      }),
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer sc_secret-token',
        },
        method: 'GET',
      })
    );
    const requestUrl = String(fetch.mock.calls[0]?.[0]);
    expect(requestUrl).toContain('keyword=Johnny+Riddle+1955+Topps+%2398');
    expect(requestUrl).toContain('count=50');
    expect(requestUrl).toContain('page=1');
    expect(requestUrl).toContain('ebaySite=ebay.com');
    expect(requestUrl).toContain('sortOrder=endedRecently');
  });

  it('preserves compact negative modifiers through URLSearchParams encoding', async () => {
    const fetch = vi.fn(async () => ({
      headers: new Headers(),
      json: async () => soldCompsFixture,
      ok: true,
      status: 200,
    })) as typeof globalThis.fetch;
    const provider = createSoldCompsPricingProvider(
      {
        apiKey: 'sc_secret-token',
      },
      { fetch }
    );

    await provider.fetchSoldComps({
      ...baseInput,
      conditionId: '4000',
      title: 'Darryl Strawberry 1997 Fleer #179',
      itemSpecifics: {
        'Card Number': '179',
        Manufacturer: 'Fleer',
        Player: 'Darryl Strawberry',
        Set: 'Fleer',
        Year: '1997',
      },
      requestedCompCount: undefined,
    });

    const requestUrl = String(fetch.mock.calls[0]?.[0]);
    expect(requestUrl).toContain('keyword=Darryl+Strawberry+1997+Fleer+%23179');
    expect(requestUrl).toContain('-pick');
    expect(requestUrl).toContain('-choose');
    expect(requestUrl).toContain('-complete');
    expect(requestUrl).toContain('-lot');
    expect(requestUrl).toContain('-Beckett');
  });

  it('maps SoldComps payload into internal sold comps', () => {
    const result = parseSoldCompsResponse(soldCompsFixture, {
      fetchedAt: '2026-06-15T12:00:00.000Z',
      query: soldCompsFixture.keyword,
      request: {
        count: 50,
        ebaySite: 'ebay.com',
        keyword: soldCompsFixture.keyword,
        page: 1,
        sortOrder: 'endedRecently',
      },
      responseHeaders: {
        'x-usage-limit': '2000',
        'x-usage-used': '43',
      },
      status: 200,
    });

    expect(result).toMatchObject({
      fetchedAt: '2026-06-15T12:00:00.000Z',
      provider: 'soldcomps',
      query: 'Johnny Riddle 1955 Topps #98',
    });
    expect(result.soldComps[0]).toEqual({
      condition: 'Pre-Owned',
      listingUrl: 'https://www.ebay.com/itm/256123456789?nordt=true',
      price: {
        currency: 'USD',
        value: 14.5,
      },
      shippingPrice: {
        currency: 'USD',
        value: 1.99,
      },
      soldDate: '2026-06-14T18:42:00.000Z',
      title: '1955 Topps Johnny Riddle #98 St. Louis Cardinals',
    });
    expect(result.soldComps[2]).toEqual({
      listingUrl: 'https://www.ebay.com/itm/256123456791?nordt=true',
      price: {
        currency: 'USD',
        value: 7.25,
      },
      soldDate: '2026-06-12T18:42:00.000Z',
      title: 'Johnny Riddle 1955 Topps #98 low grade',
    });
    expect(result.rawResult).toMatchObject({
      input: {
        query: 'Johnny Riddle 1955 Topps #98',
        request: {
          count: 50,
          ebaySite: 'ebay.com',
          keyword: 'Johnny Riddle 1955 Topps #98',
          page: 1,
          sortOrder: 'endedRecently',
        },
      },
      output: {
        hasNextPage: true,
        itemCount: 3,
        page: 1,
        totalItems: 3,
      },
      responseHeaders: {
        'x-usage-limit': '2000',
        'x-usage-used': '43',
      },
      status: 200,
      usage: {
        limit: 2000,
        source: 'headers',
        updatedAt: '2026-06-15T12:00:00.000Z',
        used: 43,
      },
    });
    expect(result.soldCompsUsage).toEqual({
      limit: 2000,
      source: 'headers',
      updatedAt: '2026-06-15T12:00:00.000Z',
      used: 43,
    });
  });

  it('returns missing usage snapshot when SoldComps headers absent', () => {
    expect(
      parseSoldCompsUsageHeaders(undefined, '2026-06-15T12:00:00.000Z')
    ).toEqual({
      limit: null,
      source: 'missing',
      updatedAt: '2026-06-15T12:00:00.000Z',
      used: null,
    });
  });

  it('returns malformed usage snapshot when SoldComps headers invalid', () => {
    expect(
      parseSoldCompsUsageHeaders(
        {
          'x-usage-limit': '50',
          'x-usage-used': 'forty-three',
        },
        '2026-06-15T12:00:00.000Z'
      )
    ).toEqual({
      limit: null,
      source: 'malformed',
      updatedAt: '2026-06-15T12:00:00.000Z',
      used: null,
    });
  });

  it('accepts fewer-than-requested comps as success', async () => {
    const provider = createSoldCompsPricingProvider(
      {
        apiKey: 'sc_secret-token',
      },
      {
        now: () => new Date('2026-06-15T12:00:00.000Z'),
        runRequest: async () => ({
          body: soldCompsFixture,
          status: 200,
        }),
      }
    );

    const result = await provider.fetchSoldComps({
      ...baseInput,
      requestedCompCount: 50,
    });

    expect(result.soldComps).toHaveLength(3);
  });

  it('accepts zero-result responses as success', async () => {
    const provider = createSoldCompsPricingProvider(
      {
        apiKey: 'sc_secret-token',
      },
      {
        runRequest: async () => ({
          body: {
            hasNextPage: false,
            items: [],
            keyword: soldCompsFixture.keyword,
            page: 1,
            totalItems: 0,
          },
          status: 200,
        }),
      }
    );

    const result = await provider.fetchSoldComps(baseInput);

    expect(result.soldComps).toEqual([]);
    expect(result.rawResult).toMatchObject({
      output: {
        hasNextPage: false,
        itemCount: 0,
      },
    });
  });

  it.each([
    ['missing keyword', { ...soldCompsFixture, keyword: undefined }],
    ['missing title', { ...soldCompsFixture, items: [{ ...soldCompsFixture.items[0], title: null }] }],
    ['missing soldPrice', { ...soldCompsFixture, items: [{ ...soldCompsFixture.items[0], soldPrice: null }] }],
    ['missing soldCurrency', { ...soldCompsFixture, items: [{ ...soldCompsFixture.items[0], soldCurrency: null }] }],
    ['invalid shippingPrice', { ...soldCompsFixture, items: [{ ...soldCompsFixture.items[0], shippingPrice: 'free' }] }],
    ['invalid endedAt', { ...soldCompsFixture, items: [{ ...soldCompsFixture.items[0], endedAt: 'not-a-date' }] }],
    ['invalid url', { ...soldCompsFixture, items: [{ ...soldCompsFixture.items[0], url: 'ftp://example.com/item/1' }] }],
  ])('rejects malformed provider output: %s', (_label, payload) => {
    expect(() => parseSoldCompsResponse(payload, { query: 'Johnny Riddle 1955 Topps #98' })).toThrowError(
      expect.objectContaining({
        category: 'malformed_output',
        code: 'soldcomps_output_invalid',
        workflowSafe: true,
      })
    );
  });

  it.each([
    [429, 'rate_limit', 'soldcomps_rate_limited'],
    [401, 'auth_config', 'soldcomps_auth_failed'],
    [403, 'auth_config', 'soldcomps_auth_failed'],
    [500, 'provider_unavailable', 'soldcomps_provider_unavailable'],
    [502, 'provider_unavailable', 'soldcomps_provider_unavailable'],
    [504, 'timeout_network', 'soldcomps_timeout'],
  ] as const)('classifies HTTP %s failures', async (status, category, code) => {
    const provider = createSoldCompsPricingProvider(
      {
        apiKey: 'sc_secret-token',
      },
      {
        fetch: vi.fn(async () => ({
          headers: new Headers(),
          json: async () => ({}),
          ok: false,
          status,
          text: async () =>
            JSON.stringify({
              detail: 'Bearer super-secret-token token=secret-value',
              error: 'apiKey=secret quota exceeded',
              limit: 2000,
              plan: 'Growth',
            }),
        })) as typeof fetch,
      }
    );

    await expect(provider.fetchSoldComps(baseInput)).rejects.toMatchObject({
      category,
      code,
      provider: 'soldcomps',
      query: expect.not.stringContaining('secret-value'),
      workflowSafe: true,
    });
  });

  it('classifies timeout aborts', async () => {
    const abortError = new Error('Request aborted token=secret-value');
    abortError.name = 'AbortError';
    const provider = createSoldCompsPricingProvider(
      {
        apiKey: 'sc_secret-token',
      },
      {
        fetch: vi.fn(async () => {
          throw abortError;
        }) as typeof fetch,
      }
    );

    await expect(provider.fetchSoldComps(baseInput)).rejects.toMatchObject({
      category: 'timeout_network',
      code: 'soldcomps_timeout',
      workflowSafe: true,
    });
  });

  it('classifies network-like failures', async () => {
    const provider = createSoldCompsPricingProvider(
      {
        apiKey: 'sc_secret-token',
      },
      {
        fetch: vi.fn(async () => {
          throw new TypeError('fetch failed: ECONNRESET token=secret-value');
        }) as typeof fetch,
      }
    );

    await expect(provider.fetchSoldComps(baseInput)).rejects.toMatchObject({
      category: 'timeout_network',
      code: 'soldcomps_network_error',
      query: expect.not.stringContaining('secret-value'),
      workflowSafe: true,
    });
  });

  it('redacts token-like fragments from raw result metadata', async () => {
    const provider = createSoldCompsPricingProvider(
      {
        apiKey: 'sc_secret-token',
      },
      {
        now: () => new Date('2026-06-15T12:00:00.000Z'),
        runRequest: async () => ({
          body: {
            ...soldCompsFixture,
            keyword:
              'https://market.example/item/123?token=secret-value&access_token=secret apiKey=secret-value Bearer super-secret-token',
          },
          responseHeaders: {
            authorization: 'Bearer super-secret-token',
            'x-upgrade-url': 'https://api.example/upgrade?apiKey=secret',
          },
          status: 200,
        }),
      }
    );

    const result = await provider.fetchSoldComps({
      ...baseInput,
      title:
        'https://market.example/item/123?token=secret-value&access_token=secret apiKey=secret-value Bearer super-secret-token',
    });

    const serialized = JSON.stringify(result.rawResult);
    expect(serialized).not.toContain('secret-token');
    expect(serialized).not.toContain('secret-value');
    expect(serialized).not.toContain('super-secret-token');
    expect(serialized).toContain('[redacted-url]');
    expect(serialized).toContain('Bearer [redacted-token]');
  });

  it('classifies missing auth/config before request', async () => {
    const provider = createSoldCompsPricingProvider({
      apiKey: ' ',
    });

    await expect(provider.fetchSoldComps(baseInput)).rejects.toMatchObject({
      category: 'auth_config',
      code: 'soldcomps_auth_config_invalid',
      workflowSafe: true,
    });
  });

  it('redacts token-like fragments from messages', () => {
    expect(
      redactSoldCompsSensitiveText(
        'Bearer super-secret-token https://api.example/path?access_token=abc token=xyz apiKey: 1234567890'
      )
    ).toBe(
      'Bearer [redacted-token] [redacted-url] [redacted-secret:***] [redacted-secret:12***90]'
    );
  });

  it('redacts exact token/access-token/apiKey/bearer patterns directly', () => {
    const redacted = redactSoldCompsSensitiveText(
      'token=secret-value access_token=secret apiKey=secret Bearer super-secret-token'
    );

    expect(redacted).not.toContain('secret-value');
    expect(redacted).not.toContain('super-secret-token');
    expect(redacted).not.toContain('apiKey=secret');
    expect(redacted).not.toContain('access_token=secret');
    expect(redacted).toContain('Bearer [redacted-token]');
  });

  it('surfaces provider failures through typed SoldComps provider errors', async () => {
    const provider = createSoldCompsPricingProvider(
      {
        apiKey: 'sc_secret-token',
      },
      {
        runRequest: async () => {
          throw new Error('Provider failed');
        },
      }
    );

    await expect(provider.fetchSoldComps(baseInput)).rejects.toMatchObject({
      category: 'provider_failure',
      code: 'soldcomps_provider_failure',
      provider: 'soldcomps',
      workflowSafe: true,
    });
  });

  it('redacts token-like fragments from thrown failure messages', async () => {
    const provider = createSoldCompsPricingProvider(
      {
        apiKey: 'sc_secret-token',
      },
      {
        fetch: vi.fn(async () => ({
          headers: new Headers(),
          json: async () => ({}),
          ok: false,
          status: 429,
          text: async () =>
            JSON.stringify({
              detail: 'Bearer super-secret-token token=secret-value access_token=secret',
              error: 'apiKey=secret',
              limit: 2000,
              plan: 'Growth',
            }),
        })) as typeof fetch,
      }
    );

    await expect(provider.fetchSoldComps(baseInput)).rejects.toSatisfy((error) => {
      expect(error).toBeInstanceOf(SoldCompsPricingProviderError);
      const message = (error as Error).message;
      expect(message).not.toContain('secret-token');
      expect(message).not.toContain('super-secret-token');
      expect(message).not.toContain('secret-value');
      expect(message).toContain('Bearer [redacted-token]');
      return true;
    });
  });
});
