import { describe, expect, it, vi } from 'vitest';

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
        condition: 'Pre-Owned',
        conditionId: 3000,
        endedAt: '2026-05-13T00:00:00.000Z',
        isBestOfferAccepted: false,
        itemId: '377150575490',
        keyword: 'Johnny Riddle 1954 Topps #98 St. Louis Cardinals Coach',
        listingType: 'buy_it_now',
        scrapedAt: '2026-06-11T20:51:02.556Z',
        sellerFeedbackScore: 46900,
        sellerPositivePercent: 99.7,
        sellerType: null,
        sellerUsername: 'sbarko',
        shippingPrice: null,
        shippingType: 'free',
        soldCurrency: 'USD',
        soldPrice: '5.00',
        thumbnailUrl: 'https://i.ebayimg.com/images/g/T2cAAeSwAaFp8Smi/s-l500.webp',
        title: '1954 Topps - Johnny Riddle #147 - St. Louis Cardinals',
        totalPrice: '5.00',
        url: 'https://www.ebay.com/itm/377150575490?nordt=true',
      },
      {
        condition: 'Pre-Owned',
        endedAt: '2026-05-12T00:00:00.000Z',
        keyword: 'Johnny Riddle 1954 Topps #98 St. Louis Cardinals Coach',
        shippingPrice: '4.99',
        soldCurrency: 'USD',
        soldPrice: 7.5,
        title: '1954 Topps Johnny Riddle Cardinals',
        url: 'https://www.ebay.com/itm/377150575491?nordt=true',
      },
    ],
    query: 'Johnny Riddle 1954 Topps #98 St. Louis Cardinals Coach',
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
      count: 9,
      facets: {
        'Card Number': '136',
        Manufacturer: 'Panini',
        Player: 'Victor Wembanyama',
        Set: 'Prizm',
        Year: '2023',
      },
      itemSpecifics: baseInput.itemSpecifics,
      keywords: ['2023 Panini Prizm Victor Wembanyama Rookie Card 136'],
      listingId: 'LIST-001',
      minSoldComps: 9,
      title: '2023 Panini Prizm Victor Wembanyama Rookie Card',
    });
  });

  it('omits structured categoryId and conditionId even when eBay ids exist', async () => {
    const runActor = vi.fn(async () => validActorOutput);
    const provider = createApifyPricingProvider(
      {
        actorId: 'actor-123',
        token: 'secret-token',
      },
      {
        runActor,
      }
    );

    await provider.fetchSoldComps({
      ...baseInput,
      categoryId: '183050',
      conditionId: '3000',
    });

    expect(runActor).toHaveBeenCalledWith(
      expect.objectContaining({
        actorInput: expect.objectContaining({
          keywords: ['2023 Panini Prizm Victor Wembanyama Rookie Card 136'],
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

    expect(actorInput.keywords).toEqual(['2023 Panini Prizm Victor Wembanyama Rookie Card 136']);
    expect(actorInput.keywords[0]).not.toContain('category:183050');
    expect(actorInput.keywords[0]).not.toContain('condition:4000');
  });

  it('uses Apify default min sold comps of 8 when input omits minSoldComps', () => {
    expect(
      buildApifyActorInput({
        ...baseInput,
        minSoldComps: undefined,
      })
    ).toMatchObject({
      count: 8,
      minSoldComps: 8,
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
      minSoldComps: 5,
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
        itemCount: 2,
        sampleTitles: [
          '1954 Topps - Johnny Riddle #147 - St. Louis Cardinals',
          '1954 Topps Johnny Riddle Cardinals',
        ],
      },
      run: validActorOutput.run,
    });
  });

  it('maps actor shippingPrice string to internal shippingPrice money shape', () => {
    const result = parseApifyActorOutput(validActorOutput, {
      actorId: 'actor-123',
      fetchedAt: '2026-05-20T13:00:04.000Z',
    });

    expect(result.soldComps[1]).toMatchObject({
      shippingPrice: {
        currency: 'USD',
        value: 4.99,
      },
    });
  });

  it.each([
    ['null output', null],
    ['object instead of item array', { query: validActorOutput.query, run: {}, items: {} }],
    ['missing soldPrice field', { ...validActorOutput, items: [{ ...validActorOutput.items[0], soldPrice: undefined }] }],
    ['non-finite soldPrice', { ...validActorOutput, items: [{ ...validActorOutput.items[0], soldPrice: 'NaN' }] }],
    ['bad endedAt', { ...validActorOutput, items: [{ ...validActorOutput.items[0], endedAt: '' }] }],
    ['bad url', { ...validActorOutput, items: [{ ...validActorOutput.items[0], url: '' }] }],
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
        actorInput: {
          keywords: [expect.stringContaining('[redacted-url] Bearer [redacted-token]')],
        },
        query: expect.stringContaining('[redacted-url] Bearer [redacted-token]'),
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
