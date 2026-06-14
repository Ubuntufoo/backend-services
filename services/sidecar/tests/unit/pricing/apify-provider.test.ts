import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
  ApifyPricingProviderError,
  buildApifyActorInput,
  createApifyPricingProvider,
  normalizeSoldComps,
  parseApifyActorOutput,
  redactSensitiveText,
} from '@/pricing/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureDir = path.resolve(__dirname, '../../fixtures/apify');
const soldCompsFixture = JSON.parse(
  readFileSync(path.join(fixtureDir, 'sold-comps-single-000007.json'), 'utf8')
) as {
  items: Array<Record<string, unknown>>;
  query: string;
  run: Record<string, unknown>;
};

describe('Apify pricing provider', () => {
  const baseInput = {
    categoryId: '261328',
    conditionId: '2750',
    itemSpecifics: {
      'Card Number': '136',
      Manufacturer: 'Panini',
      Player: 'Victor Wembanyama',
      Set: 'Prizm',
      Year: '2023',
    },
    listingId: 'LIST-001',
    listingType: 'single' as const,
    minSoldComps: 9,
    title: '2023 Panini Prizm Victor Wembanyama Rookie Card PSA 10',
  };

  it('builds expected actor input from pricing context', () => {
    expect(buildApifyActorInput(baseInput)).toEqual({
      count: 9,
      facets: {
        'Card Number': '136',
        Manufacturer: 'Panini',
        Player: 'Victor Wembanyama',
        Set: 'Prizm',
        Year: '2023',
      },
      itemSpecifics: baseInput.itemSpecifics,
      keywords: ['Victor Wembanyama 2023 Panini Prizm #136 PSA 10'],
      listingId: 'LIST-001',
      title: '2023 Panini Prizm Victor Wembanyama Rookie Card PSA 10',
    });
  });

  it('omits structured categoryId and conditionId even when eBay ids exist', async () => {
    const runActor = vi.fn(async () => soldCompsFixture);
    const provider = createApifyPricingProvider(
      {
        actorId: 'actor-123',
        token: 'secret-token',
      },
      { runActor }
    );

    await provider.fetchSoldComps({
      ...baseInput,
      categoryId: '183050',
      conditionId: '3000',
    });

    expect(runActor).toHaveBeenCalledWith(
      expect.objectContaining({
        actorInput: expect.objectContaining({
          keywords: ['Victor Wembanyama 2023 Panini Prizm #136 PSA 10'],
          listingId: 'LIST-001',
        }),
      })
    );
    expect(runActor.mock.calls[0][0]?.actorInput).not.toHaveProperty('categoryId');
    expect(runActor.mock.calls[0][0]?.actorInput).not.toHaveProperty('conditionId');
    expect(runActor.mock.calls[0][0]?.actorInput).not.toHaveProperty('query');
  });

  it('does not include synthetic category or condition fragments in actor search string', () => {
    const actorInput = buildApifyActorInput({
      ...baseInput,
      categoryId: '183050',
      conditionId: '4000',
    });

    expect(actorInput.keywords).toEqual(['Victor Wembanyama 2023 Panini Prizm #136']);
    expect(actorInput.keywords[0]).not.toContain('category:183050');
    expect(actorInput.keywords[0]).not.toContain('condition:4000');
  });

  it('de-dupes repeated parallel signals across title and specifics', () => {
    const actorInput = buildApifyActorInput({
      ...baseInput,
      conditionId: '4000',
      itemSpecifics: {
        ...baseInput.itemSpecifics,
        Features: ['Silver', 'Prizm'],
        'Parallel/Variety': 'Silver Prizm',
      },
      title: '2023 Panini Prizm Victor Wembanyama Silver Prizm Rookie Card',
    });

    expect(actorInput.keywords).toEqual(['Victor Wembanyama 2023 Panini Prizm #136 Silver']);
  });

  it('does not add raw signal for ungraded cards', () => {
    const actorInput = buildApifyActorInput({
      ...baseInput,
      conditionId: '4000',
      itemSpecifics: {
        ...baseInput.itemSpecifics,
        'Card Condition': 'NEAR_MINT_OR_BETTER',
      },
      title: '2023 Panini Prizm Victor Wembanyama Rookie Card',
    });

    expect(actorInput.keywords).toEqual(['Victor Wembanyama 2023 Panini Prizm #136']);
    expect(actorInput.keywords[0]).not.toContain('PSA');
    expect(actorInput.keywords[0]).not.toContain('raw');
  });

  it('uses graded signal without raw when grader and grade exist', () => {
    const actorInput = buildApifyActorInput({
      ...baseInput,
      itemSpecifics: {
        ...baseInput.itemSpecifics,
        'Card Condition': 'NEAR_MINT_OR_BETTER',
      },
    });

    expect(actorInput.keywords).toEqual(['Victor Wembanyama 2023 Panini Prizm #136 PSA 10']);
    expect(actorInput.keywords[0]).not.toContain('raw');
  });

  it('falls back to generic graded signal when graded title lacks grader and grade', () => {
    const actorInput = buildApifyActorInput({
      ...baseInput,
      title: '2023 Panini Prizm Victor Wembanyama Rookie Card',
    });

    expect(actorInput.keywords).toEqual(['Victor Wembanyama 2023 Panini Prizm #136 graded']);
    expect(actorInput.keywords[0]).not.toContain('raw');
  });

  it.each([
    ['SGC', '7', 'Victor Wembanyama 2023 Panini Prizm #136 SGC 7'],
    ['BGS', '9.5', 'Victor Wembanyama 2023 Panini Prizm #136 BGS 9.5'],
  ])('uses structured grader+grade signal for %s %s', (grader, grade, expectedQuery) => {
    const actorInput = buildApifyActorInput({
      ...baseInput,
      title: '2023 Panini Prizm Victor Wembanyama Rookie Card',
      itemSpecifics: {
        ...baseInput.itemSpecifics,
        Grade: grade,
        'Professional Grader': grader,
      },
    });

    expect(actorInput.keywords).toEqual([expectedQuery]);
  });

  it('builds query without player when missing', () => {
    const actorInput = buildApifyActorInput({
      ...baseInput,
      conditionId: '4000',
      itemSpecifics: {
        'Card Number': '136',
        Manufacturer: 'Panini',
        Set: 'Prizm',
        Year: '2023',
      },
      title: '2023 Panini Prizm Rookie Card',
    });

    expect(actorInput.keywords).toEqual(['2023 Panini Prizm #136']);
  });

  it('omits malformed card number fragments when missing', () => {
    const actorInput = buildApifyActorInput({
      ...baseInput,
      conditionId: '4000',
      itemSpecifics: {
        Manufacturer: 'Panini',
        Player: 'Victor Wembanyama',
        Set: 'Prizm',
        Year: '2023',
      },
      title: '2023 Panini Prizm Victor Wembanyama Rookie Card',
    });

    expect(actorInput.keywords).toEqual(['Victor Wembanyama 2023 Panini Prizm']);
    expect(actorInput.keywords[0]).not.toContain('# ');
  });

  it('keeps lot queries broader and includes lot signal', () => {
    const actorInput = buildApifyActorInput({
      ...baseInput,
      conditionId: '4000',
      listingType: 'lot',
      title: '2023 Panini Prizm Victor Wembanyama Lot of 3 Rookie Cards',
    });

    expect(actorInput.keywords).toEqual(['Victor Wembanyama 2023 Panini Prizm lot']);
    expect(actorInput.keywords[0]).not.toContain('#136');
  });

  it('falls back to minimal safe query when identity sparse', () => {
    const actorInput = buildApifyActorInput({
      categoryId: '261328',
      conditionId: null,
      itemSpecifics: undefined,
      listingId: 'LIST-EMPTY',
      listingType: 'single',
      minSoldComps: 8,
      title: 'Vintage trading card',
    });

    expect(actorInput.keywords).toEqual(['Vintage']);
  });

  it('uses Apify default min sold comps of 8 when input omits minSoldComps', () => {
    expect(
      buildApifyActorInput({
        ...baseInput,
        minSoldComps: undefined,
      })
    ).toMatchObject({
      count: 8,
    });
  });

  it('honors explicit lower Apify min sold comps without clamping to 8 or 12', () => {
    expect(
      buildApifyActorInput({
        ...baseInput,
        minSoldComps: 5,
      })
    ).toMatchObject({
      count: 5,
    });
  });

  it('removes duplicated player/year/card number noise from trading-card query parts', () => {
    const actorInput = buildApifyActorInput({
      categoryId: '261328',
      conditionId: '4000',
      itemSpecifics: {
        'Card Number': '98',
        Player: 'Johnny Riddle',
        'Product Line': 'Johnny Riddle Topps 98',
        Year: '1954',
      },
      listingId: 'Single-000007',
      listingType: 'single',
      minSoldComps: 8,
      title: '1955 Topps #98 Johnny Riddle St. Louis Cardinals Vintage Baseball Card',
    });

    expect(actorInput.keywords).toEqual(['Johnny Riddle 1955 Topps #98']);
  });

  it('maps actor-native fixture into internal sold comps', () => {
    const result = parseApifyActorOutput(soldCompsFixture, {
      actorId: 'actor-123',
      fetchedAt: '2026-06-11T20:51:09.000Z',
    });

    expect(result).toMatchObject({
      fetchedAt: '2026-06-11T20:51:09.000Z',
      provider: 'apify',
      query: soldCompsFixture.query,
    });
    expect(result.soldComps[0]).toEqual({
      condition: 'Pre-Owned',
      listingUrl: 'https://www.ebay.com/itm/377150575490?nordt=true',
      price: {
        currency: 'USD',
        value: 5,
      },
      soldDate: '2026-05-13T00:00:00.000Z',
      title: '1954 Topps - Johnny Riddle #147 - St. Louis Cardinals',
    });
    expect(result.rawResult).toMatchObject({
      actorId: 'actor-123',
      input: {
        actorInput: undefined,
      },
      output: {
        itemCount: 7,
        sampleTitles: [
          '1954 Topps - Johnny Riddle #147 - St. Louis Cardinals',
          '1954 Topps Johnny Riddle Cardinals',
          '1954 Topps Johnny Riddle #147',
        ],
      },
      run: soldCompsFixture.run,
    });
  });

  it('maps actor shippingPrice string to internal shippingPrice money shape', () => {
    const result = parseApifyActorOutput(soldCompsFixture, {
      actorId: 'actor-123',
      fetchedAt: '2026-06-11T20:51:09.000Z',
    });

    expect(result.soldComps[1]).toMatchObject({
      shippingPrice: {
        currency: 'USD',
        value: 1.99,
      },
    });
  });

  it.each([8, 12])(
    'accepts fewer-than-requested comps: requested=%s returned=7',
    async (minSoldComps) => {
      const provider = createApifyPricingProvider(
        {
          actorId: 'actor-123',
          token: 'secret-token',
        },
        {
          now: () => new Date('2026-06-11T20:51:09.000Z'),
          runActor: async () => soldCompsFixture,
        }
      );

      const result = await provider.fetchSoldComps({
        ...baseInput,
        minSoldComps,
        title: soldCompsFixture.query,
      });

      expect(result.soldComps).toHaveLength(7);
    }
  );

  it('retains over-returned comps instead of capping them to requested count', async () => {
    const items = Array.from({ length: 12 }, (_value, index) => ({
      endedAt: `2026-06-${String(index + 1).padStart(2, '0')}T12:00:00.000Z`,
      soldCurrency: 'USD',
      soldPrice: String(index + 10),
      title: `Comp ${index + 1}`,
      url: `https://www.ebay.com/itm/${index + 1}`,
    }));
    const provider = createApifyPricingProvider(
      {
        actorId: 'actor-123',
        token: 'secret-token',
      },
      {
        now: () => new Date('2026-06-11T20:51:09.000Z'),
        runActor: async () => ({
          items,
          query: 'Johnny Riddle 1955 Topps #98',
          run: { itemCount: 12, status: 'SUCCEEDED' },
        }),
      }
    );

    const result = await provider.fetchSoldComps({
      ...baseInput,
      listingId: 'Single-000007',
      minSoldComps: 8,
      title: '1955 Topps #98 Johnny Riddle St. Louis Cardinals Vintage Baseball Card',
    });
    const normalized = normalizeSoldComps(result.soldComps);

    expect(result.soldComps).toHaveLength(12);
    expect(normalized.comps).toHaveLength(12);
  });

  it('accepts zero-comp actor output without provider failure', () => {
    const result = parseApifyActorOutput(
      {
        items: [],
        query: soldCompsFixture.query,
        run: {
          itemCount: 0,
          status: 'SUCCEEDED',
        },
      },
      {
        actorId: 'actor-123',
        fetchedAt: '2026-06-11T20:51:09.000Z',
      }
    );

    expect(result.soldComps).toEqual([]);
    expect(result.rawResult).toMatchObject({
      output: {
        itemCount: 0,
        sampleTitles: [],
      },
    });
  });

  it.each([
    ['missing title', { ...soldCompsFixture, items: [{ ...soldCompsFixture.items[0], title: undefined }] }],
    ['missing soldPrice', { ...soldCompsFixture, items: [{ ...soldCompsFixture.items[0], soldPrice: undefined }] }],
    ['non-numeric soldPrice', { ...soldCompsFixture, items: [{ ...soldCompsFixture.items[0], soldPrice: 'free' }] }],
    ['missing soldCurrency', { ...soldCompsFixture, items: [{ ...soldCompsFixture.items[0], soldCurrency: undefined }] }],
    ['missing endedAt', { ...soldCompsFixture, items: [{ ...soldCompsFixture.items[0], endedAt: undefined }] }],
    ['invalid endedAt', { ...soldCompsFixture, items: [{ ...soldCompsFixture.items[0], endedAt: '2026-13-40' }] }],
    ['missing url', { ...soldCompsFixture, items: [{ ...soldCompsFixture.items[0], url: undefined }] }],
    ['invalid url', { ...soldCompsFixture, items: [{ ...soldCompsFixture.items[0], url: 'ftp://example.com/item/1' }] }],
    ['invalid shippingPrice', { ...soldCompsFixture, items: [{ ...soldCompsFixture.items[0], shippingPrice: 'free' }] }],
  ])('rejects malformed actor output: %s', (_label, payload) => {
    expect(() =>
      parseApifyActorOutput(payload, {
        actorId: 'actor-123',
      })
    ).toThrowError(
      expect.objectContaining({
        category: 'malformed_output',
        code: 'apify_output_invalid',
        workflowSafe: true,
      })
    );
  });

  it.each([
    [429, 'rate_limit', 'apify_rate_limited'],
    [402, 'rate_limit', 'apify_rate_limited'],
    [401, 'auth_config', 'apify_auth_failed'],
    [403, 'auth_config', 'apify_auth_failed'],
    [503, 'provider_unavailable', 'apify_provider_unavailable'],
    [502, 'provider_unavailable', 'apify_provider_unavailable'],
    [504, 'timeout_network', 'apify_timeout'],
  ] as const)('classifies HTTP %s failures', async (status, category, code) => {
    const provider = createApifyPricingProvider(
      {
        actorId: 'actor-123',
        token: 'secret-token',
      },
      {
        fetch: vi.fn(async () => ({
          json: async () => ({}),
          ok: false,
          status,
          text: async () =>
            `Bearer super-secret-token token=secret-value access_token=secret apiKey=secret status=${status}`,
        })) as typeof fetch,
      }
    );

    await expect(provider.fetchSoldComps(baseInput)).rejects.toMatchObject({
      category,
      code,
      provider: 'apify',
      query: expect.not.stringContaining('secret-value'),
      workflowSafe: true,
    });
  });

  it('classifies timeout aborts', async () => {
    const abortError = new Error('Request aborted token=secret-value');
    abortError.name = 'AbortError';
    const provider = createApifyPricingProvider(
      {
        actorId: 'actor-123',
        token: 'secret-token',
      },
      {
        fetch: vi.fn(async () => {
          throw abortError;
        }) as typeof fetch,
      }
    );

    await expect(provider.fetchSoldComps(baseInput)).rejects.toMatchObject({
      category: 'timeout_network',
      code: 'apify_timeout',
      workflowSafe: true,
    });
  });

  it('classifies network-like failures', async () => {
    const provider = createApifyPricingProvider(
      {
        actorId: 'actor-123',
        token: 'secret-token',
      },
      {
        fetch: vi.fn(async () => {
          throw new TypeError('fetch failed: ECONNRESET token=secret-value');
        }) as typeof fetch,
      }
    );

    await expect(provider.fetchSoldComps(baseInput)).rejects.toMatchObject({
      category: 'timeout_network',
      code: 'apify_network_error',
      query: expect.not.stringContaining('secret-value'),
      workflowSafe: true,
    });
  });

  it('redacts token-like fragments from raw result', async () => {
    const provider = createApifyPricingProvider(
      {
        actorId: 'actor-123',
        token: 'secret-token',
      },
      {
        now: () => new Date('2026-05-20T13:00:04.000Z'),
        runActor: async () => ({
          ...soldCompsFixture,
          query:
            'https://market.example/item/123?token=secret-value&access_token=secret apiKey=secret-value Bearer super-secret-token',
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

  it('redacts token-like fragments from thrown failure messages', async () => {
    const provider = createApifyPricingProvider(
      {
        actorId: 'actor-123',
        token: 'secret-token',
      },
      {
        fetch: vi.fn(async () => ({
          json: async () => ({}),
          ok: false,
          status: 429,
          text: async () =>
            'Bearer super-secret-token token=secret-value access_token=secret apiKey=secret',
        })) as typeof fetch,
      }
    );

    await expect(provider.fetchSoldComps(baseInput)).rejects.toSatisfy((error) => {
      expect(error).toBeInstanceOf(ApifyPricingProviderError);
      const message = (error as Error).message;
      expect(message).not.toContain('secret-token');
      expect(message).not.toContain('super-secret-token');
      expect(message).not.toContain('secret-value');
      expect(message).toContain('Bearer [redacted-token]');
      return true;
    });
  });

  it('surfaces provider failures through typed Apify provider errors', async () => {
    const provider = createApifyPricingProvider(
      {
        actorId: 'actor-123',
        token: 'secret-token',
      },
      {
        runActor: async () => {
          throw new Error('Actor failed');
        },
      }
    );

    await expect(provider.fetchSoldComps(baseInput)).rejects.toMatchObject({
      category: 'provider_failure',
      code: 'apify_provider_failure',
      workflowSafe: true,
    });
  });

  it('classifies missing auth/config before actor run', async () => {
    const provider = createApifyPricingProvider({
      actorId: ' ',
      token: ' ',
    });

    await expect(provider.fetchSoldComps(baseInput)).rejects.toMatchObject({
      category: 'auth_config',
      code: 'apify_auth_config_invalid',
      workflowSafe: true,
    });
  });

  it('redacts token-like fragments from messages', () => {
    expect(
      redactSensitiveText(
        'Bearer super-secret-token https://api.example/path?access_token=abc token=xyz apiKey: 1234567890'
      )
    ).toBe(
      'Bearer [redacted-token] [redacted-url] [redacted-secret:***] [redacted-secret:12***90]'
    );
  });

  it('redacts exact token/access-token/apiKey/bearer patterns directly', () => {
    const redacted = redactSensitiveText(
      'token=secret-value access_token=secret apiKey=secret Bearer super-secret-token'
    );

    expect(redacted).not.toContain('secret-value');
    expect(redacted).not.toContain('super-secret-token');
    expect(redacted).not.toContain('apiKey=secret');
    expect(redacted).not.toContain('access_token=secret');
    expect(redacted).toContain('Bearer [redacted-token]');
  });
});
