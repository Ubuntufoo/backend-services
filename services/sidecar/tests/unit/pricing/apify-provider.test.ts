import { describe, expect, it } from 'vitest';

import {
  ApifyPricingProviderError,
  buildApifyActorInput,
  createApifyPricingProvider,
  parseApifyActorOutput,
  redactSensitiveText,
} from '@/pricing/index.js';

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
    minSoldComps: 9,
    title: '2023 Panini Prizm Victor Wembanyama Rookie Card',
  };

  const validActorOutput = {
    items: [
      {
        condition: 'Near Mint',
        listingUrl: 'https://www.ebay.com/itm/100000000001',
        price: {
          currency: 'USD',
          value: 24.99,
        },
        shippingPrice: {
          currency: 'USD',
          value: 4.99,
        },
        soldDate: '2026-05-18T12:00:00.000Z',
        title: '2023 Panini Prizm Victor Wembanyama Rookie Card #136',
      },
      {
        condition: null,
        listingUrl: null,
        price: {
          currency: 'USD',
          value: 21,
        },
        shippingPrice: null,
        soldDate: '2026-05-17T12:00:00.000Z',
        title: 'Victor Wembanyama 2023 Prizm Base Rookie',
      },
    ],
    query:
      '2023 Panini Prizm Victor Wembanyama Rookie Card | category:261328 | condition:2750 | player:Victor Wembanyama | year:2023 | manufacturer:Panini | card_number:136 | set:Prizm',
    run: {
      finishedAt: '2026-05-20T13:00:03.000Z',
      itemCount: 2,
      runId: 'run-123',
      startedAt: '2026-05-20T13:00:00.000Z',
      status: 'SUCCEEDED',
    },
  };

  it('builds expected actor input from pricing context', () => {
    expect(buildApifyActorInput(baseInput)).toEqual({
      categoryId: '261328',
      conditionId: '2750',
      facets: {
        'Card Number': '136',
        Manufacturer: 'Panini',
        Player: 'Victor Wembanyama',
        Set: 'Prizm',
        Year: '2023',
      },
      itemSpecifics: baseInput.itemSpecifics,
      listingId: 'LIST-001',
      minSoldComps: 12,
      query:
        '2023 Panini Prizm Victor Wembanyama Rookie Card | category:261328 | condition:2750 | player:Victor Wembanyama | year:2023 | manufacturer:Panini | card_number:136 | set:Prizm',
      title: '2023 Panini Prizm Victor Wembanyama Rookie Card',
    });
  });

  it('parses valid actor output into pricing provider result', () => {
    const result = parseApifyActorOutput(validActorOutput, {
      actorId: 'actor-123',
      fetchedAt: '2026-05-20T13:00:04.000Z',
    });

    expect(result).toMatchObject({
      fetchedAt: '2026-05-20T13:00:04.000Z',
      provider: 'apify',
      query: validActorOutput.query,
    });
    expect(result.soldComps).toEqual(validActorOutput.items);
    expect(result.rawResult).toMatchObject({
      actorId: 'actor-123',
      output: {
        itemCount: 2,
        sampleTitles: [
          '2023 Panini Prizm Victor Wembanyama Rookie Card #136',
          'Victor Wembanyama 2023 Prizm Base Rookie',
        ],
      },
      run: validActorOutput.run,
    });
  });

  it.each([
    ['null output', null],
    ['object instead of item array', { query: validActorOutput.query, run: {}, items: {} }],
    ['missing price field', { ...validActorOutput, items: [{ ...validActorOutput.items[0], price: undefined }] }],
    ['non-finite price', { ...validActorOutput, items: [{ ...validActorOutput.items[0], price: { currency: 'USD', value: Number.NaN } }] }],
    ['bad sold date', { ...validActorOutput, items: [{ ...validActorOutput.items[0], soldDate: '' }] }],
    ['bad url', { ...validActorOutput, items: [{ ...validActorOutput.items[0], listingUrl: '' }] }],
  ])('rejects malformed actor output: %s', (_label, payload) => {
    expect(() =>
      parseApifyActorOutput(payload, {
        actorId: 'actor-123',
      })
    ).toThrow(ApifyPricingProviderError);
  });

  it('uses injected actor runner and redacts sensitive query fragments in raw result', async () => {
    const provider = createApifyPricingProvider(
      {
        actorId: 'actor-123',
        token: 'secret-token',
      },
      {
        now: () => new Date('2026-05-20T13:00:04.000Z'),
        runActor: async () => ({
          ...validActorOutput,
          query:
            'https://market.example/item/123?token=secret-value Bearer super-secret-token',
        }),
      }
    );

    const result = await provider.fetchSoldComps({
      ...baseInput,
      title: 'https://market.example/item/123?token=secret-value Bearer super-secret-token',
    });

    expect(result.provider).toBe('apify');
    expect(result.rawResult).toMatchObject({
      input: {
        query: '[redacted-url] Bearer [redacted-token]',
      },
    });
    expect(JSON.stringify(result.rawResult)).not.toContain('secret-value');
    expect(JSON.stringify(result.rawResult)).not.toContain('super-secret-token');
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

    await expect(provider.fetchSoldComps(baseInput)).rejects.toBeInstanceOf(
      ApifyPricingProviderError
    );
  });

  it.each([
    [429, 'rate_limit', 'apify_rate_limited'],
    [401, 'auth_config', 'apify_auth_failed'],
    [504, 'timeout_network', 'apify_timeout'],
    [503, 'provider_unavailable', 'apify_provider_unavailable'],
    [418, 'provider_failure', 'apify_http_418'],
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
          text: async () => `token=secret-value status=${status}`,
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
});
