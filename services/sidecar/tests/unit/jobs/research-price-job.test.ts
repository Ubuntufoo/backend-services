import type {
  AppSettingsRow,
  ListingPriceResearchRow,
  ListingRow,
  ResolvedAiModelRoute,
} from '@ebay-inventory/data';

import { describe, expect, it, vi } from 'vitest';

import { JOB_ERROR_CODES } from '@/jobs/job-errors.js';
import { priceListingNow } from '@/jobs/research-price-job.js';
import {
  ApifyPricingProviderError,
  createProductionPricingAnalyst,
  SoldCompsPricingProviderError,
} from '@/pricing/index.js';

function createListing(overrides: Partial<ListingRow> = {}): ListingRow {
  return {
    approved_for_export_at: null,
    capture_mode: null,
    category_id: '261328',
    condition_id: '2750',
    condition_notes: null,
    created_at: '2026-06-11T12:00:00.000Z',
    description: null,
    ebay_listing_id: null,
    ebay_listing_status: null,
    ebay_listing_url: null,
    ebay_offer_id: null,
    ese_eligible: null,
    estimated_weight_oz: null,
    exported_at: null,
    generated_at: null,
    handling_days: null,
    id: 'listing-row-id',
    image_urls: [],
    item_specifics: {
      'Card Number': '136',
      Manufacturer: 'Panini',
      Player: 'Victor Wembanyama',
      Set: 'Prizm',
      Year: '2023',
      pricingModifierOptions: {
        excludeAutographs: true,
        excludeGraded: true,
        excludeVariants: false,
      },
    },
    last_error_at: null,
    last_error_code: null,
    last_error_context: {},
    last_error_message: null,
    listing_id: 'Single-000123',
    listing_type: 'single',
    merchant_location_key: null,
    package_type: null,
    price: null,
    r2_delete_after: null,
    r2_deleted_at: null,
    r2_object_keys: [],
    r2_retention_policy: null,
    seller_hints: null,
    shipping_profile: null,
    sku: 'Single-000123',
    sold_at: null,
    status: 'needs_review',
    sub_status: 'review_pending',
    title: '2023 Panini Prizm Victor Wembanyama Rookie Card',
    updated_at: '2026-06-11T12:00:00.000Z',
    ...overrides,
  };
}

function createResearchRow(overrides: Partial<ListingPriceResearchRow> = {}): ListingPriceResearchRow {
  return {
    comps: [],
    created_at: '2026-06-11T12:05:00.000Z',
    error_code: null,
    error_message: null,
    id: 'listing-price-research-id',
    listing_id: 'Single-000123',
    llm_price_explanation: null,
    llm_reasoning_json: {},
    llm_rejected_comp_ids: [],
    median_sold_price: null,
    suggested_price: null,
    confidence: null,
    pricing_model_name: null,
    provider: 'apify',
    query: null,
    raw_result_json: {},
    sold_count: null,
    status: 'pending',
    updated_at: '2026-06-11T12:05:00.000Z',
    ...overrides,
  };
}

function createAppSettings(
  overrides: Partial<AppSettingsRow> = {}
): AppSettingsRow {
  return {
    created_at: '2026-06-11T12:00:00.000Z',
    ebay_policy_ids: {},
    id: 'app-settings-id',
    pricing_provider_mode: 'soldcomps',
    updated_at: '2026-06-11T12:00:00.000Z',
    ...overrides,
  } as AppSettingsRow;
}

function createVictorComp(
  price: number,
  soldDate: string,
  title = '2023 Panini Prizm Victor Wembanyama #136'
) {
  return {
    price: { currency: 'USD', value: price },
    soldDate,
    title,
  };
}

function createNormalizedComp(id: string, title: string, totalPrice: number) {
  return {
    condition: null,
    id,
    listingUrl: null,
    price: { currency: 'USD', value: totalPrice },
    shippingPrice: null,
    soldDate: '2026-06-01T10:00:00.000Z',
    source: 'provider' as const,
    title,
    totalPrice: { currency: 'USD', value: totalPrice },
  };
}

function createResolvedAiModelRoute(
  overrides: Partial<ResolvedAiModelRoute> = {}
): ResolvedAiModelRoute {
  return {
    displayName: 'Gemma 4 31B IT',
    fallbackOnQuotaExceeded: true,
    fallbackOnRateLimit: true,
    fallbackOnUnavailable: true,
    freeTierStatus: 'verified_paid_only',
    isFreeTierEligible: false,
    modelName: 'gemma-4-31b-it',
    provider: 'google',
    requestsPerDay: 1500,
    requestsPerMinute: 15,
    routeOrder: 1,
    supportsImages: false,
    supportsJsonOutput: true,
    supportsStructuredOutput: true,
    supportsText: true,
    taskType: 'pricing_reasoning',
    ...overrides,
  };
}

function createDataAccess(
  listing: ListingRow | null,
  appSettings = createAppSettings(),
  options: {
    aiModelRouteError?: Error;
    aiModelRoutes?: ResolvedAiModelRoute[];
  } = {}
) {
  const getByListingId = vi.fn().mockResolvedValue(listing);
  const update = vi.fn().mockImplementation(async (_listingId: string, changes: { price?: number }) =>
    createListing({
      ...(listing ?? createListing()),
      price: changes.price ?? listing?.price ?? null,
    })
  );
  const create = vi.fn().mockResolvedValue(createResearchRow());
  const markFailed = vi.fn().mockImplementation(async (input) =>
    createResearchRow({
      error_code: input.error_code,
      error_message: input.error_message,
      id: input.id,
      raw_result_json: input.raw_result_json,
      status: 'failed',
    })
  );
  const markSucceeded = vi.fn().mockImplementation(async (input) =>
    createResearchRow({
      confidence: input.confidence,
      id: input.id,
      median_sold_price: input.median_sold_price,
      query: input.query,
      raw_result_json: input.raw_result_json,
      sold_count: input.sold_count,
      status: 'succeeded',
      suggested_price: input.suggested_price,
    })
  );
  const resolveForTask = vi.fn().mockImplementation(async () => {
    if (options.aiModelRouteError) {
      throw options.aiModelRouteError;
    }

    return options.aiModelRoutes ?? [createResolvedAiModelRoute()];
  });
  const incrementGeminiCallsUsed = vi.fn().mockResolvedValue({
    effectiveLimit: 500,
    resource: 'gemini',
    source: 'app_settings',
    updatedUsage: {
      gemini_calls_used: 1,
      gemini_daily_limit: 500,
      order_sync_count: 0,
      usage_date: '2026-06-12',
    },
    usage: {
      gemini_calls_used: 0,
      gemini_daily_limit: 500,
      order_sync_count: 0,
      usage_date: '2026-06-12',
    },
  });
  const updateAppSettings = vi.fn().mockImplementation(async (changes) => ({
    ...(appSettings ?? createAppSettings()),
    ...changes,
  }));

  return {
    dataAccess: {
      aiModelRoutes: {
        resolveForTask,
      },
      appSettings: {
        get: vi.fn().mockResolvedValue(appSettings),
        update: updateAppSettings,
      },
      dailyUsage: {
        incrementGeminiCallsUsed,
      },
      listingPriceResearch: {
        create,
        markFailed,
        markSucceeded,
      },
      listings: {
        getByListingId,
        update,
      },
    } as never,
    spies: {
      create,
      getByListingId,
      incrementGeminiCallsUsed,
      markFailed,
      markSucceeded,
      resolveForTask,
      updateAppSettings,
      update,
    },
  };
}

describe('priceListingNow', () => {
  it('skips provider resolution when pricing disabled', async () => {
    const listing = createListing();
    const { dataAccess, spies } = createDataAccess(
      listing,
      createAppSettings({ pricing_provider_mode: 'off' })
    );
    const createPricingProvider = vi.fn();

    await expect(
      priceListingNow(listing.listing_id, {
        createPricingProvider,
        dataAccess,
        now: () => new Date('2026-06-12T10:00:00.000Z'),
      })
    ).rejects.toMatchObject({
      code: JOB_ERROR_CODES.RESEARCH_PRICE_DISABLED,
      context: expect.objectContaining({
        pricing_provider_mode: 'off',
      }),
    });

    expect(createPricingProvider).not.toHaveBeenCalled();
    expect(spies.create).not.toHaveBeenCalled();
    expect(spies.markFailed).not.toHaveBeenCalled();
    expect(spies.update).not.toHaveBeenCalled();
  });

  it('fails clearly when listing missing', async () => {
    const { dataAccess, spies } = createDataAccess(null);
    const createPricingProvider = vi.fn();

    await expect(
      priceListingNow('Single-404', {
        createPricingProvider,
        dataAccess,
        now: () => new Date('2026-06-12T10:00:00.000Z'),
      })
    ).rejects.toMatchObject({
      code: JOB_ERROR_CODES.RESEARCH_PRICE_LISTING_NOT_FOUND,
      message: 'Listing "Single-404" was not found for research_price.',
    });

    expect(createPricingProvider).not.toHaveBeenCalled();
    expect(spies.create).not.toHaveBeenCalled();
  });

  it('writes listing price research and listing price on success', async () => {
    const listing = createListing();
    const { dataAccess, spies } = createDataAccess(listing);
    const fetchSoldComps = vi.fn().mockResolvedValue({
      fetchedAt: '2026-06-12T10:05:00.000Z',
      provider: 'apify',
      query: '2023 Panini Prizm Victor Wembanyama Rookie Card 136',
      rawResult: {
        actorId: 'actor-123',
      },
      soldComps: [
        createVictorComp(20, '2026-06-01T10:00:00.000Z', '2023 Panini Prizm Victor Wembanyama #136'),
        createVictorComp(22, '2026-05-31T10:00:00.000Z', '2023 Panini Prizm Victor Wembanyama'),
        createVictorComp(24, '2026-05-30T10:00:00.000Z', 'Panini Prizm Victor Wembanyama #136'),
        createVictorComp(26, '2026-05-29T10:00:00.000Z', '2023 Panini Prizm RC Victor Wembanyama #136'),
      ],
    });

    const result = await priceListingNow(listing.listing_id, {
      createPricingProvider: () =>
        ({
          fetchSoldComps,
          name: 'apify',
        }) as never,
      dataAccess,
      now: () => new Date('2026-06-12T10:00:00.000Z'),
    });

    expect(fetchSoldComps).toHaveBeenCalledTimes(1);
    expect(fetchSoldComps).toHaveBeenCalledWith(
      expect.objectContaining({
        listingId: listing.listing_id,
      })
    );
    expect(fetchSoldComps.mock.calls[0]?.[0]).not.toHaveProperty('requestedCompCount');
    expect(spies.create).toHaveBeenCalledWith({
      listing_id: listing.listing_id,
      provider: 'apify',
      status: 'pending',
    });
    expect(spies.markSucceeded).toHaveBeenCalledTimes(1);
    expect(spies.update).toHaveBeenCalledWith(listing.listing_id, {
      price: result.suggestedPrice,
    });
    expect(result).toMatchObject({
      acceptedCompCount: expect.any(Number),
      listingPriceResearchUpdated: true,
      provider: 'apify',
      rawCompCount: 4,
      suggestedPrice: expect.any(Number),
    });
    expect(result.listing.price).toBe(result.suggestedPrice);
  });

  it('uses persisted pricing modifier options when building provider query', async () => {
    const listing = createListing({
      condition_id: '4000',
      item_specifics: {
        'Card Number': '179',
        Manufacturer: 'Fleer',
        Player: 'Darryl Strawberry',
        Set: 'Fleer',
        Year: '1997',
        pricingModifierOptions: {
          excludeAutographs: false,
          excludeGraded: false,
          excludeVariants: true,
        },
      },
      title: 'Darryl Strawberry 1997 Fleer #179',
    });
    const { dataAccess } = createDataAccess(listing);
    const fetchSoldComps = vi.fn().mockResolvedValue({
      fetchedAt: '2026-06-12T10:05:00.000Z',
      provider: 'soldcomps',
      query: 'Darryl Strawberry 1997 Fleer #179 -pick -choose -complete -lot',
      rawResult: {
        fetchedAt: '2026-06-12T10:05:00.000Z',
      },
      soldComps: [
        createVictorComp(20, '2026-06-01T10:00:00.000Z', 'Darryl Strawberry 1997 Fleer #179'),
        createVictorComp(22, '2026-05-31T10:00:00.000Z', 'Darryl Strawberry 1997 Fleer #179 EX'),
        createVictorComp(24, '2026-05-30T10:00:00.000Z', 'Darryl Strawberry 1997 Fleer #179 NM'),
      ],
    });

    await priceListingNow(listing.listing_id, {
      createPricingProvider: () =>
        ({
          fetchSoldComps,
          name: 'soldcomps',
        }) as never,
      dataAccess,
      now: () => new Date('2026-06-12T10:00:00.000Z'),
    });

    expect(fetchSoldComps).toHaveBeenCalledWith(
      expect.objectContaining({
        pricingModifierOptions: {
          excludeAutographs: false,
          excludeGraded: false,
          excludeVariants: true,
        },
      })
    );
  });

  it('allows apify pricing mode without preflight rejection', async () => {
    const listing = createListing();
    const { dataAccess, spies } = createDataAccess(
      listing,
      createAppSettings({ pricing_provider_mode: 'apify' })
    );

    await priceListingNow(listing.listing_id, {
      createPricingProvider: () =>
        ({
          fetchSoldComps: vi.fn().mockResolvedValue({
            fetchedAt: '2026-06-12T10:05:00.000Z',
            provider: 'apify',
            query: 'query',
            rawResult: { actorId: 'actor-123' },
            soldComps: [
              createVictorComp(20, '2026-06-01T10:00:00.000Z', '2023 Panini Prizm Victor Wembanyama #136'),
              createVictorComp(22, '2026-05-31T10:00:00.000Z', '2023 Panini Prizm Victor Wembanyama'),
              createVictorComp(24, '2026-05-30T10:00:00.000Z', 'Panini Prizm Victor Wembanyama #136'),
            ],
          }),
          name: 'apify',
        }) as never,
      dataAccess,
      now: () => new Date('2026-06-12T10:00:00.000Z'),
    });

    expect(spies.create).toHaveBeenCalledTimes(1);
    expect(spies.update).toHaveBeenCalledTimes(1);
  });

  it('does not inject shared requestedCompCount into apify provider input', async () => {
    const listing = createListing();
    const { dataAccess } = createDataAccess(listing);
    const fetchSoldComps = vi.fn().mockResolvedValue({
      fetchedAt: '2026-06-12T10:05:00.000Z',
      provider: 'apify',
      query: 'query',
      rawResult: { actorId: 'actor-123' },
      soldComps: [
        createVictorComp(20, '2026-06-01T10:00:00.000Z', '2023 Panini Prizm Victor Wembanyama #136'),
        createVictorComp(22, '2026-05-31T10:00:00.000Z', '2023 Panini Prizm Victor Wembanyama'),
        createVictorComp(24, '2026-05-30T10:00:00.000Z', 'Panini Prizm Victor Wembanyama #136'),
      ],
    });

    await priceListingNow(listing.listing_id, {
      createPricingProvider: () =>
        ({
          fetchSoldComps,
          name: 'apify',
        }) as never,
      dataAccess,
      now: () => new Date('2026-06-12T10:00:00.000Z'),
    });

    expect(fetchSoldComps).toHaveBeenCalledWith(
      expect.objectContaining({
        listingId: listing.listing_id,
      })
    );
    expect(fetchSoldComps.mock.calls[0]?.[0]).not.toHaveProperty('requestedCompCount');
  });

  it('does not inject shared requestedCompCount even when APIFY_MIN_SOLD_COMPS env override exists', async () => {
    const listing = createListing();
    const { dataAccess } = createDataAccess(listing);
    const fetchSoldComps = vi.fn().mockResolvedValue({
      fetchedAt: '2026-06-12T10:05:00.000Z',
      provider: 'apify',
      query: 'query',
      rawResult: { actorId: 'actor-123' },
      soldComps: [
        createVictorComp(20, '2026-06-01T10:00:00.000Z', '2023 Panini Prizm Victor Wembanyama #136'),
        createVictorComp(22, '2026-05-31T10:00:00.000Z', '2023 Panini Prizm Victor Wembanyama'),
        createVictorComp(24, '2026-05-30T10:00:00.000Z', 'Panini Prizm Victor Wembanyama #136'),
      ],
    });
    const originalEnv = process.env.APIFY_MIN_SOLD_COMPS;
    process.env.APIFY_MIN_SOLD_COMPS = '8';

    try {
      await priceListingNow(listing.listing_id, {
        createPricingProvider: () =>
          ({
            fetchSoldComps,
            name: 'apify',
          }) as never,
        dataAccess,
        now: () => new Date('2026-06-12T10:00:00.000Z'),
      });
    } finally {
      if (originalEnv === undefined) {
        delete process.env.APIFY_MIN_SOLD_COMPS;
      } else {
        process.env.APIFY_MIN_SOLD_COMPS = originalEnv;
      }
    }

    expect(fetchSoldComps).toHaveBeenCalledWith(
      expect.objectContaining({
        listingId: listing.listing_id,
      })
    );
    expect(fetchSoldComps.mock.calls[0]?.[0]).not.toHaveProperty('requestedCompCount');
  });

  it('does not cap over-returned comps after fetch in canonical path', async () => {
    const listing = createListing();
    const { dataAccess } = createDataAccess(listing);
    const soldComps = Array.from({ length: 12 }, (_value, index) => ({
      price: { currency: 'USD', value: 20 + index },
      soldDate: `2026-06-${String(index + 1).padStart(2, '0')}T10:00:00.000Z`,
      title: `2023 Panini Prizm Victor Wembanyama #136 Variant ${index + 1}`,
    }));

    const result = await priceListingNow(listing.listing_id, {
      createPricingProvider: () =>
        ({
          fetchSoldComps: vi.fn().mockResolvedValue({
            fetchedAt: '2026-06-12T10:05:00.000Z',
            provider: 'apify',
            query: 'query',
            rawResult: { actorId: 'actor-123' },
            soldComps,
          }),
          name: 'apify',
        }) as never,
      dataAccess,
      now: () => new Date('2026-06-12T10:00:00.000Z'),
    });

    expect(result.rawCompCount).toBe(12);
    expect(result.acceptedCompCount).toBe(12);
  });

  it('filters invalid comps before stats and llm input while preserving raw-result audit', async () => {
    const listing = createListing({
      item_specifics: {
        'Card Condition': 'VERY_GOOD',
        'Card Number': '98',
        Manufacturer: 'Topps',
        Player: 'Johnny Riddle',
        Set: 'Topps',
        Year: '1955',
      },
      title: '1955 Topps #98 Johnny Riddle',
    });
    const { dataAccess, spies } = createDataAccess(listing);
    const analyze = vi.fn().mockResolvedValue({
      modelName: 'gemini-test',
      prompt: { systemInstruction: 'sys', userPrompt: 'user' },
      rawOutput: {},
      reasoning: {
        confidence: 'medium',
        conditionAdjustedPrice: 18,
        conditionAdjustmentPercent: 0,
        conditionAdjustmentReason: 'Exact target accepted.',
        priceExplanation: 'accepted comps only',
        rejectedCompIds: [],
        selectedCompIds: [],
      },
    });

    await priceListingNow(listing.listing_id, {
      createPricingProvider: () =>
        ({
          fetchSoldComps: vi.fn().mockResolvedValue({
            fetchedAt: '2026-06-12T10:05:00.000Z',
            provider: 'apify',
            query: 'Johnny Riddle 1955 Topps #98',
            rawResult: {
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
                itemCount: 5,
                sampleTitles: [
                  '1955 TOPPS BASEBALL CARD #98 JOHNNY RIDDLE EX/EX+',
                  '1955 Topps #98 Johnny Riddle PSA 5',
                  '1955 Topps Set Break #98 Johnny Riddle VG-VGEX St Louis Cardinals',
                ],
              },
            },
            soldComps: [
              {
                price: { currency: 'USD', value: 18 },
                soldDate: '2026-06-01T10:00:00.000Z',
                title: '1955 TOPPS BASEBALL CARD #98 JOHNNY RIDDLE EX/EX+',
              },
              {
                price: { currency: 'USD', value: 22 },
                soldDate: '2026-05-31T10:00:00.000Z',
                title: '1955 TOPPS BASEBALL CARD #98 JOHNNY RIDDLE VG',
              },
              {
                price: { currency: 'USD', value: 60 },
                soldDate: '2026-05-30T10:00:00.000Z',
                title: '1955 Topps #98 Johnny Riddle PSA 5',
              },
              {
                price: { currency: 'USD', value: 7 },
                soldDate: '2026-05-29T10:00:00.000Z',
                title: '1955 Topps Set Break #98 Johnny Riddle VG-VGEX St Louis Cardinals',
              },
              {
                price: { currency: 'USD', value: 5 },
                soldDate: '2026-05-28T10:00:00.000Z',
                title: '1955 Topps #98 Johnny Riddle complete your set',
              },
            ],
          }),
          name: 'apify',
        }) as never,
      dataAccess,
      now: () => new Date('2026-06-12T10:00:00.000Z'),
      pricingAnalyst: {
        analyze,
        name: 'test-analyst',
      },
    });

    expect(
      analyze.mock.calls[0]?.[0]?.comps.map((comp: { title: string }) => comp.title)
    ).toEqual([
      '1955 TOPPS BASEBALL CARD #98 JOHNNY RIDDLE EX/EX+',
      '1955 TOPPS BASEBALL CARD #98 JOHNNY RIDDLE VG',
      '1955 Topps Set Break #98 Johnny Riddle VG-VGEX St Louis Cardinals',
    ]);
    expect(analyze).toHaveBeenCalledWith(
      expect.objectContaining({
        conditionAdjustment: expect.objectContaining({
          allowedAdjustment: expect.objectContaining({
            eligible: true,
            targetPrice: 18,
          }),
        }),
        stats: expect.objectContaining({
          highSoldPrice: 22,
          lowSoldPrice: 7,
          soldCount: 3,
        }),
      })
    );
    expect(spies.markSucceeded).toHaveBeenCalledWith(
      expect.objectContaining({
        raw_result_json: expect.objectContaining({
          diagnostics: expect.objectContaining({
            normalizationAcceptedCount: 3,
            normalizationInputCount: 5,
            normalizationRejectedCount: 2,
            providerReturnedCount: 5,
          }),
          normalization: expect.objectContaining({
            acceptedCount: 3,
            inputCount: 5,
            rawCount: 5,
            rejectedCount: 2,
            rejected: expect.arrayContaining([
              expect.objectContaining({
                reason: 'excluded_graded_listing',
                title: '1955 Topps #98 Johnny Riddle PSA 5',
              }),
              expect.objectContaining({
                reason: 'excluded_selection_listing',
                title: '1955 Topps #98 Johnny Riddle complete your set',
              }),
            ]),
          }),
        }),
        sold_count: 3,
      })
    );
    const markSucceededInput = spies.markSucceeded.mock.calls[0]?.[0];
    expect(markSucceededInput?.raw_result_json).toMatchObject({
      diagnostics: {
        normalizationAcceptedCount: 3,
        normalizationInputCount: 5,
        normalizationRejectedCount: 2,
        providerReturnedCount: 5,
      },
      input: {
        query: 'Johnny Riddle 1955 Topps #98',
      },
      output: {
        itemCount: 5,
      },
    });
    expect(markSucceededInput?.raw_result_json).not.toHaveProperty('keyword');
    expect(markSucceededInput?.raw_result_json).not.toHaveProperty('output.sampleTitles');
    expect(markSucceededInput?.raw_result_json).toMatchObject({
      input: {
        query: 'Johnny Riddle 1955 Topps #98',
        request: {
          count: 50,
          ebaySite: 'ebay.com',
          page: 1,
          sortOrder: 'endedRecently',
        },
      },
    });
    expect(markSucceededInput?.raw_result_json).not.toHaveProperty('input.request.keyword');
  });

  it('persists exact-card mismatch reasons and excludes rejected comps from stats', async () => {
    const listing = createListing({
      item_specifics: {
        'Card Condition': 'VERY_GOOD',
        'Card Number': '179',
        Manufacturer: 'Fleer',
        Player: 'Darryl Strawberry',
        Set: 'Fleer',
        Year: '1997',
      },
      title: '1997 Fleer Darryl Strawberry #179',
    });
    const { dataAccess, spies } = createDataAccess(listing);
    const analyze = vi.fn().mockResolvedValue({
      modelName: 'test-analyst',
      prompt: { systemInstruction: 'system', userPrompt: 'prompt' },
      rawOutput: {},
      reasoning: {
        compNotes: [],
        confidence: 'medium',
        conditionAdjustedPrice: null,
        conditionAdjustmentPercent: null,
        conditionAdjustmentReason: 'Condition adjustment unavailable.',
        priceExplanation: 'Used exact comps only.',
        rejectedCompIds: [],
        selectedCompIds: [],
      },
    });

    await priceListingNow(listing.listing_id, {
      createPricingProvider: () =>
        ({
          fetchSoldComps: vi.fn().mockResolvedValue({
            fetchedAt: '2026-06-12T10:05:00.000Z',
            provider: 'apify',
            query: 'Darryl Strawberry 1997 Fleer #179',
            rawResult: { actorId: 'actor-123' },
            soldComps: [
              {
                price: { currency: 'USD', value: 10 },
                soldDate: '2026-06-01T10:00:00.000Z',
                title: '1997 Fleer Darryl Strawberry #179',
              },
              {
                price: { currency: 'USD', value: 14 },
                soldDate: '2026-05-31T10:00:00.000Z',
                title: '1997 Fleer Set Break #179 Darryl Strawberry',
              },
              {
                price: { currency: 'USD', value: 99 },
                soldDate: '2026-05-30T10:00:00.000Z',
                title: '1997 Fleer Ultra - Darryl Strawberry #G106 Gold Medallion New York Yankees Card',
              },
            ],
          }),
          name: 'apify',
        }) as never,
      dataAccess,
      now: () => new Date('2026-06-12T10:00:00.000Z'),
      pricingAnalyst: {
        analyze,
        name: 'test-analyst',
      },
    });

    expect(analyze).toHaveBeenCalledTimes(1);
    expect(spies.markSucceeded).toHaveBeenCalledWith(
      expect.objectContaining({
        llm_reasoning_json: expect.objectContaining({
          modelName: 'test-analyst',
          fallback: 'condition_adjustment_not_allowed',
          reasoning: expect.objectContaining({
            conditionAdjustedPrice: null,
          }),
          status: 'succeeded',
        }),
      })
    );
    expect(spies.markSucceeded).toHaveBeenCalledWith(
      expect.objectContaining({
        raw_result_json: expect.objectContaining({
          diagnostics: expect.objectContaining({
            normalizationAcceptedCount: 2,
            normalizationInputCount: 3,
            normalizationRejectedCount: 1,
            providerReturnedCount: 3,
          }),
          normalization: expect.objectContaining({
            acceptedCount: 2,
            inputCount: 3,
            rawCount: 3,
            rejectedCount: 1,
            rejected: expect.arrayContaining([
              expect.objectContaining({
                reason: 'exact_set_mismatch',
                title: '1997 Fleer Ultra - Darryl Strawberry #G106 Gold Medallion New York Yankees Card',
              }),
            ]),
          }),
        }),
        sold_count: 2,
      })
    );
  });

  it('persists provider scarcity diagnostics distinctly from normalization counts', async () => {
    const listing = createListing({
      condition_id: '4000',
      item_specifics: {
        'Card Number': '125',
        Manufacturer: 'Topps',
        Player: 'John Hadl',
        Set: 'Topps Football',
        Year: '1966',
      },
      title: '1966 Topps Football #125 John Hadl',
    });
    const { dataAccess, spies } = createDataAccess(
      listing,
      createAppSettings({ pricing_provider_mode: 'soldcomps' })
    );

    await priceListingNow(listing.listing_id, {
      createPricingProvider: () =>
        ({
          fetchSoldComps: vi.fn().mockResolvedValue({
            fetchedAt: '2026-06-17T00:38:46.631Z',
            provider: 'soldcomps',
            query:
              'John Hadl 1966 Topps #125 -pick -choose -complete -lot -PSA -BGS -SGC -CGC -CSG -TAG -HGA -MBA -GMA -KSA -ISA -WCG -BCCG -Beckett -grade -graded -slab -slabbed -auto -autograph',
            rawResult: {
              fetchedAt: '2026-06-17T00:38:46.631Z',
              input: {
                query:
                  'John Hadl 1966 Topps #125 -pick -choose -complete -lot -PSA -BGS -SGC -CGC -CSG -TAG -HGA -MBA -GMA -KSA -ISA -WCG -BCCG -Beckett -grade -graded -slab -slabbed -auto -autograph',
                request: {
                  count: 50,
                  ebaySite: 'ebay.com',
                  keyword:
                    'John Hadl 1966 Topps #125 -pick -choose -complete -lot -PSA -BGS -SGC -CGC -CSG -TAG -HGA -MBA -GMA -KSA -ISA -WCG -BCCG -Beckett -grade -graded -slab -slabbed -auto -autograph',
                  page: 1,
                  sortOrder: 'endedRecently',
                },
              },
              output: {
                hasNextPage: false,
                itemCount: 6,
                page: 1,
                totalItems: 6,
              },
            },
            soldComps: [
              createVictorComp(12, '2026-06-01T10:00:00.000Z', '1966 Topps Football #125 John Hadl'),
              createVictorComp(13, '2026-05-31T10:00:00.000Z', '1966 Topps Football #125 John Hadl EX'),
              createVictorComp(11, '2026-05-30T10:00:00.000Z', '1966 Topps Football #125 John Hadl VG'),
              createVictorComp(10, '2026-05-29T10:00:00.000Z', '1966 Topps Football #125 John Hadl low grade'),
              createVictorComp(14, '2026-05-28T10:00:00.000Z', '1966 Topps Football #125 John Hadl sharp'),
              createVictorComp(9, '2026-05-27T10:00:00.000Z', '1966 Topps Football #125 John Hadl crease'),
            ],
          }),
          name: 'soldcomps',
        }) as never,
      dataAccess,
      now: () => new Date('2026-06-17T00:38:46.631Z'),
    });

    const markSucceededInput = spies.markSucceeded.mock.calls[0]?.[0];
    expect(markSucceededInput?.raw_result_json).toMatchObject({
      diagnostics: {
        normalizationAcceptedCount: 6,
        normalizationInputCount: 6,
        normalizationRejectedCount: 0,
        providerHasNextPage: false,
        providerReportedTotalCount: 6,
        providerReturnedCount: 6,
        requestedCount: 50,
      },
      input: {
        query:
          'John Hadl 1966 Topps #125 -pick -choose -complete -lot -PSA -BGS -SGC -CGC -CSG -TAG -HGA -MBA -GMA -KSA -ISA -WCG -BCCG -Beckett -grade -graded -slab -slabbed -auto -autograph',
        request: {
          count: 50,
          ebaySite: 'ebay.com',
          page: 1,
          sortOrder: 'endedRecently',
        },
      },
      normalization: {
        acceptedCount: 6,
        inputCount: 6,
        rawCount: 6,
        rejected: [],
        rejectedCount: 0,
      },
      output: {
        hasNextPage: false,
        itemCount: 6,
        page: 1,
        totalItems: 6,
      },
    });
    expect(markSucceededInput?.raw_result_json).not.toHaveProperty('input.request.keyword');
  });

  it('uses production pricing analyst route and persists non-empty llm reasoning when analyst available', async () => {
    const listing = createListing({
      item_specifics: {
        'Card Condition': 'VERY_GOOD',
        'Card Number': '12',
        Manufacturer: 'Topps',
        Player: 'Sample Player',
        Set: 'Base',
        Year: '1952',
      },
      title: '1952 Topps #12 Sample Player',
    });
    const { dataAccess, spies } = createDataAccess(listing);
    const normalizeComps = vi.fn().mockReturnValue({
      comps: [
        createNormalizedComp('comp-1', '1952 Topps #12 Sample Player VG-EX', 5.89),
        createNormalizedComp('comp-2', '1952 Topps #12 Sample Player VG/EX', 5.89),
        createNormalizedComp('comp-3', '1952 Topps #12 Sample Player low grade', 4.7),
        createNormalizedComp('comp-4', '1952 Topps #12 Sample Player EX', 6.1),
      ],
      rejected: [],
    });
    const productionAnalyst = createProductionPricingAnalyst({
      dataAccess,
      executeModel: vi.fn(async ({ model, prompt }) => ({
        rawOutput: { model, prompt },
        text: JSON.stringify({
          confidence: 'medium',
          conditionAdjustedPrice: 5.49,
          conditionAdjustmentPercent: -0.1,
          conditionAdjustmentReason: 'Exact target accepted.',
          priceExplanation: 'Deterministic target accepted from explicit condition evidence.',
          rejectedCompIds: [],
          selectedCompIds: ['comp-1', 'comp-2', 'comp-3', 'comp-4'],
        }),
      })),
      now: () => new Date('2026-06-12T10:00:00.000Z'),
    });

    const result = await priceListingNow(listing.listing_id, {
      createPricingProvider: () =>
        ({
          fetchSoldComps: vi.fn().mockResolvedValue({
            fetchedAt: '2026-06-12T10:05:00.000Z',
            provider: 'apify',
            query: '1952 Topps #12 Sample Player',
            rawResult: { actorId: 'actor-123' },
            soldComps: [
              createVictorComp(5.89, '2026-06-01T10:00:00.000Z', '1952 Topps #12 Sample Player VG-EX'),
              createVictorComp(5.89, '2026-05-31T10:00:00.000Z', '1952 Topps #12 Sample Player VG/EX'),
              createVictorComp(4.7, '2026-05-30T10:00:00.000Z', '1952 Topps #12 Sample Player low grade'),
              createVictorComp(6.1, '2026-05-29T10:00:00.000Z', '1952 Topps #12 Sample Player EX'),
            ],
          }),
          name: 'apify',
        }) as never,
      dataAccess,
      normalizeComps,
      now: () => new Date('2026-06-12T10:00:00.000Z'),
      pricingAnalyst: productionAnalyst,
    });

    expect(result.suggestedPrice).toBe(5.49);
    expect(spies.resolveForTask).toHaveBeenCalledWith({
      provider: 'google',
      requireJsonOutput: true,
      requireStructuredOutput: true,
      taskType: 'pricing_reasoning',
    });
    expect(spies.incrementGeminiCallsUsed).toHaveBeenCalledTimes(1);
    expect(spies.markSucceeded).toHaveBeenCalledWith(
      expect.objectContaining({
        llm_reasoning_json: expect.objectContaining({
          fallback: null,
          modelName: 'gemma-4-31b-it',
          reasoning: expect.objectContaining({
            conditionAdjustedPrice: 5.49,
            confidence: 'medium',
          }),
          status: 'succeeded',
        }),
        pricing_model_name: 'gemma-4-31b-it',
        suggested_price: 5.49,
      })
    );
  });

  it('passes raw-card single shipping-default context into normalization', async () => {
    const listing = createListing({
      condition_id: '4000',
      item_specifics: {
        'Card Condition': 'VERY_GOOD',
        'Card Number': '98',
        Manufacturer: 'Topps',
        Player: 'Johnny Riddle',
        Set: 'Topps',
        Year: '1955',
      },
      title: '1955 Topps #98 Johnny Riddle',
    });
    const { dataAccess } = createDataAccess(listing);
    const normalizeComps = vi.fn().mockReturnValue({
      comps: [createNormalizedComp('comp-1', '1955 Topps #98 Johnny Riddle', 6.25)],
      rejected: [],
    });

    await priceListingNow(listing.listing_id, {
      createPricingProvider: () =>
        ({
          fetchSoldComps: vi.fn().mockResolvedValue({
            fetchedAt: '2026-06-12T10:05:00.000Z',
            provider: 'apify',
            query: '1955 Topps #98 Johnny Riddle',
            rawResult: { actorId: 'actor-123' },
            soldComps: [
              {
                price: { currency: 'USD', value: 5 },
                shippingPrice: { currency: 'USD', value: 15 },
                soldDate: '2026-06-01T10:00:00.000Z',
                title: '1955 Topps #98 Johnny Riddle',
              },
            ],
          }),
          name: 'apify',
        }) as never,
      dataAccess,
      normalizeComps,
      now: () => new Date('2026-06-12T10:00:00.000Z'),
    });

    expect(normalizeComps).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        conditionId: '4000',
        listingType: 'single',
        rawCardSingleShippingDefaults: true,
      })
    );
  });

  it('does not enable raw-card single shipping defaults for explicit graded listings', async () => {
    const listing = createListing({
      condition_id: '2750',
      item_specifics: {
        'Card Number': '136',
        Grade: '9',
        Manufacturer: 'Panini',
        Player: 'Victor Wembanyama',
        'Professional Grader': 'PSA',
        Set: 'Prizm',
        Year: '2023',
      },
      title: '2023 Panini Prizm Victor Wembanyama PSA 9 #136',
    });
    const { dataAccess } = createDataAccess(listing);
    const normalizeComps = vi.fn().mockReturnValue({
      comps: [createNormalizedComp('comp-1', '2023 Panini Prizm Victor Wembanyama PSA 9 #136', 35)],
      rejected: [],
    });

    await priceListingNow(listing.listing_id, {
      createPricingProvider: () =>
        ({
          fetchSoldComps: vi.fn().mockResolvedValue({
            fetchedAt: '2026-06-12T10:05:00.000Z',
            provider: 'apify',
            query: '2023 Panini Prizm Victor Wembanyama PSA 9 #136',
            rawResult: { actorId: 'actor-123' },
            soldComps: [
              {
                price: { currency: 'USD', value: 20 },
                shippingPrice: { currency: 'USD', value: 15 },
                soldDate: '2026-06-01T10:00:00.000Z',
                title: '2023 Panini Prizm Victor Wembanyama PSA 9 #136',
              },
            ],
          }),
          name: 'apify',
        }) as never,
      dataAccess,
      normalizeComps,
      now: () => new Date('2026-06-12T10:00:00.000Z'),
    });

    expect(normalizeComps).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        conditionId: '2750',
        listingType: 'single',
        rawCardSingleShippingDefaults: false,
      })
    );
  });

  it('falls back deterministically when pricing_reasoning route missing', async () => {
    const listing = createListing({
      item_specifics: {
        'Card Condition': 'VERY_GOOD',
        'Card Number': '12',
        Manufacturer: 'Topps',
        Player: 'Sample Player',
        Set: 'Base',
        Year: '1952',
      },
      title: '1952 Topps #12 Sample Player',
    });
    const { dataAccess, spies } = createDataAccess(listing, createAppSettings(), {
      aiModelRoutes: [],
    });
    const normalizeComps = vi.fn().mockReturnValue({
      comps: [
        createNormalizedComp('comp-1', '1952 Topps #12 Sample Player VG-EX', 5.89),
        createNormalizedComp('comp-2', '1952 Topps #12 Sample Player VG/EX', 5.89),
        createNormalizedComp('comp-3', '1952 Topps #12 Sample Player low grade', 4.7),
        createNormalizedComp('comp-4', '1952 Topps #12 Sample Player EX', 6.1),
      ],
      rejected: [],
    });
    const executeModel = vi.fn(async () => ({
      rawOutput: {},
      text: '{}',
    }));
    const productionAnalyst = createProductionPricingAnalyst({
      dataAccess,
      executeModel,
      now: () => new Date('2026-06-12T10:00:00.000Z'),
    });

    const result = await priceListingNow(listing.listing_id, {
      createPricingProvider: () =>
        ({
          fetchSoldComps: vi.fn().mockResolvedValue({
            fetchedAt: '2026-06-12T10:05:00.000Z',
            provider: 'apify',
            query: '1952 Topps #12 Sample Player',
            rawResult: { actorId: 'actor-123' },
            soldComps: [
              createVictorComp(5.89, '2026-06-01T10:00:00.000Z', '1952 Topps #12 Sample Player VG-EX'),
              createVictorComp(5.89, '2026-05-31T10:00:00.000Z', '1952 Topps #12 Sample Player VG/EX'),
              createVictorComp(4.7, '2026-05-30T10:00:00.000Z', '1952 Topps #12 Sample Player low grade'),
              createVictorComp(6.1, '2026-05-29T10:00:00.000Z', '1952 Topps #12 Sample Player EX'),
            ],
          }),
          name: 'apify',
        }) as never,
      dataAccess,
      normalizeComps,
      now: () => new Date('2026-06-12T10:00:00.000Z'),
      pricingAnalyst: productionAnalyst,
    });

    expect(result.suggestedPrice).toBe(5.89);
    expect(executeModel).not.toHaveBeenCalled();
    expect(spies.incrementGeminiCallsUsed).not.toHaveBeenCalled();
    expect(spies.markSucceeded).toHaveBeenCalledWith(
      expect.objectContaining({
        llm_reasoning_json: expect.objectContaining({
          analyst: 'google_pricing_reasoning',
          fallback: 'llm_analysis_failed',
          status: 'failed',
        }),
        pricing_model_name: null,
        suggested_price: 5.89,
      })
    );
  });

  it('uses valid exact condition-adjusted target as final price', async () => {
    const listing = createListing({
      item_specifics: {
        'Card Condition': 'VERY_GOOD',
        'Card Number': '12',
        Manufacturer: 'Topps',
        Player: 'Sample Player',
        Set: 'Base',
        Year: '1952',
      },
      listing_id: 'Single-000012',
      title: '1952 Topps #12 Sample Player',
    });
    const { dataAccess, spies } = createDataAccess(listing);
    const analyze = vi.fn().mockResolvedValue({
      modelName: 'gemini-test',
      prompt: { systemInstruction: 'sys', userPrompt: 'user' },
      rawOutput: {},
      reasoning: {
        confidence: 'medium',
        conditionAdjustedPrice: 5.63,
        conditionAdjustmentPercent: -0.1,
        conditionAdjustmentReason: 'Most explicit-condition comps are slightly stronger.',
        priceExplanation: 'Median is 5.89 and stronger condition comps justify exact target.',
        rejectedCompIds: [],
        selectedCompIds: ['comp-1', 'comp-2', 'comp-3', 'comp-4'],
      },
    });
    const normalizeComps = vi.fn().mockReturnValue({
      comps: [
        createNormalizedComp('comp-1', '1952 Topps #12 Sample Player VG-EX', 5.89),
        createNormalizedComp('comp-2', '1952 Topps #12 Sample Player VG/EX', 5.89),
        createNormalizedComp('comp-3', '1952 Topps #12 Sample Player low grade', 4.7),
        createNormalizedComp('comp-4', '1952 Topps #12 Sample Player EX', 6.1),
      ],
      rejected: [],
    });

    const result = await priceListingNow(listing.listing_id, {
      createPricingProvider: () =>
        ({
          fetchSoldComps: vi.fn().mockResolvedValue({
            fetchedAt: '2026-06-12T10:05:00.000Z',
            provider: 'apify',
            query: '1952 Topps #12 Sample Player',
            rawResult: { actorId: 'actor-123' },
            soldComps: [
              createVictorComp(5.89, '2026-06-01T10:00:00.000Z', '1952 Topps #12 Sample Player VG-EX'),
              createVictorComp(5.89, '2026-05-31T10:00:00.000Z', '1952 Topps #12 Sample Player VG/EX'),
              createVictorComp(4.7, '2026-05-30T10:00:00.000Z', '1952 Topps #12 Sample Player low grade'),
              createVictorComp(6.1, '2026-05-29T10:00:00.000Z', '1952 Topps #12 Sample Player EX'),
            ],
          }),
          name: 'apify',
        }) as never,
      dataAccess,
      normalizeComps,
      now: () => new Date('2026-06-12T10:00:00.000Z'),
      pricingAnalyst: {
        analyze,
        name: 'test-analyst',
      },
    });

    expect(result.suggestedPrice).toBe(5.63);
    expect(spies.markSucceeded).toHaveBeenCalledWith(
      expect.objectContaining({
        llm_reasoning_json: expect.objectContaining({
          fallback: null,
          reasoning: expect.objectContaining({
            conditionAdjustedPrice: 5.63,
            conditionAdjustmentPercent: -0.0441,
          }),
        }),
        suggested_price: 5.63,
      })
    );
  });

  it('falls back to deterministic price when analyst returns null conditionAdjustedPrice', async () => {
    const listing = createListing({
      item_specifics: {
        'Card Condition': 'VERY_GOOD',
        'Card Number': '12',
        Manufacturer: 'Topps',
        Player: 'Sample Player',
        Set: 'Base',
        Year: '1952',
      },
      title: '1952 Topps #12 Sample Player',
    });
    const { dataAccess, spies } = createDataAccess(listing);
    const normalizeComps = vi.fn().mockReturnValue({
      comps: [
        createNormalizedComp('comp-1', '1952 Topps #12 Sample Player VG-EX', 5.89),
        createNormalizedComp('comp-2', '1952 Topps #12 Sample Player VG/EX', 5.89),
        createNormalizedComp('comp-3', '1952 Topps #12 Sample Player low grade', 4.7),
        createNormalizedComp('comp-4', '1952 Topps #12 Sample Player EX', 6.1),
      ],
      rejected: [],
    });

    await priceListingNow(listing.listing_id, {
      createPricingProvider: () =>
        ({
          fetchSoldComps: vi.fn().mockResolvedValue({
            fetchedAt: '2026-06-12T10:05:00.000Z',
            provider: 'apify',
            query: '1952 Topps #12 Sample Player',
            rawResult: { actorId: 'actor-123' },
            soldComps: [
              createVictorComp(5.89, '2026-06-01T10:00:00.000Z', '1952 Topps #12 Sample Player VG-EX'),
              createVictorComp(5.89, '2026-05-31T10:00:00.000Z', '1952 Topps #12 Sample Player VG/EX'),
              createVictorComp(4.7, '2026-05-30T10:00:00.000Z', '1952 Topps #12 Sample Player low grade'),
              createVictorComp(6.1, '2026-05-29T10:00:00.000Z', '1952 Topps #12 Sample Player EX'),
            ],
          }),
          name: 'apify',
        }) as never,
      dataAccess,
      normalizeComps,
      now: () => new Date('2026-06-12T10:00:00.000Z'),
      pricingAnalyst: {
        analyze: vi.fn().mockResolvedValue({
          modelName: 'gemini-test',
          prompt: { systemInstruction: 'sys', userPrompt: 'user' },
          rawOutput: {},
          reasoning: {
            confidence: 'medium',
            conditionAdjustedPrice: null,
            conditionAdjustmentPercent: null,
            conditionAdjustmentReason: 'Deterministic median should remain final.',
            priceExplanation: 'Deterministic median should remain final.',
            rejectedCompIds: [],
            selectedCompIds: [],
          },
        }),
        name: 'test-analyst',
      },
    });

    expect(spies.markSucceeded).toHaveBeenCalledWith(
      expect.objectContaining({
        llm_reasoning_json: expect.objectContaining({
          fallback: 'llm_condition_adjusted_price_null',
        }),
        suggested_price: 5.89,
      })
    );
  });

  it('falls back to deterministic price when analyst returns off-target adjustment', async () => {
    const listing = createListing({
      item_specifics: {
        'Card Condition': 'VERY_GOOD',
        'Card Number': '12',
        Manufacturer: 'Topps',
        Player: 'Sample Player',
        Set: 'Base',
        Year: '1952',
      },
      title: '1952 Topps #12 Sample Player',
    });
    const { dataAccess, spies } = createDataAccess(listing);
    const normalizeComps = vi.fn().mockReturnValue({
      comps: [
        createNormalizedComp('comp-1', '1952 Topps #12 Sample Player VG-EX', 5.89),
        createNormalizedComp('comp-2', '1952 Topps #12 Sample Player VG/EX', 5.89),
        createNormalizedComp('comp-3', '1952 Topps #12 Sample Player low grade', 4.7),
        createNormalizedComp('comp-4', '1952 Topps #12 Sample Player EX', 6.1),
      ],
      rejected: [],
    });

    await priceListingNow(listing.listing_id, {
      createPricingProvider: () =>
        ({
          fetchSoldComps: vi.fn().mockResolvedValue({
            fetchedAt: '2026-06-12T10:05:00.000Z',
            provider: 'apify',
            query: '1952 Topps #12 Sample Player',
            rawResult: { actorId: 'actor-123' },
            soldComps: [
              createVictorComp(5.89, '2026-06-01T10:00:00.000Z', '1952 Topps #12 Sample Player VG-EX'),
              createVictorComp(5.89, '2026-05-31T10:00:00.000Z', '1952 Topps #12 Sample Player VG/EX'),
              createVictorComp(4.7, '2026-05-30T10:00:00.000Z', '1952 Topps #12 Sample Player low grade'),
              createVictorComp(6.1, '2026-05-29T10:00:00.000Z', '1952 Topps #12 Sample Player EX'),
            ],
          }),
          name: 'apify',
        }) as never,
      dataAccess,
      normalizeComps,
      now: () => new Date('2026-06-12T10:00:00.000Z'),
      pricingAnalyst: {
        analyze: vi.fn().mockRejectedValue(
          new Error('conditionAdjustedPrice must equal deterministic condition-adjusted target 5.63')
        ),
        name: 'test-analyst',
      },
    });

    expect(spies.markSucceeded).toHaveBeenCalledWith(
      expect.objectContaining({
        llm_reasoning_json: expect.objectContaining({
          fallback: 'llm_condition_adjusted_price_out_of_window',
          status: 'failed',
        }),
        suggested_price: 5.89,
      })
    );
  });

  it('uses persisted default soldcomps mode when app settings row missing', async () => {
    const listing = createListing();
    const { dataAccess, spies } = createDataAccess(listing, null);
    const resolvePricingProvider = vi.fn().mockReturnValue({
      fetchSoldComps: vi.fn().mockResolvedValue({
        fetchedAt: '2026-06-12T10:05:00.000Z',
        provider: 'soldcomps',
        query: 'query',
        rawResult: { provider: 'soldcomps' },
        soldCompsUsage: {
          limit: 50,
          source: 'headers',
          updatedAt: '2026-06-12T10:05:00.000Z',
          used: 43,
        },
        soldComps: [
          createVictorComp(20, '2026-06-01T10:00:00.000Z', '2023 Panini Prizm Victor Wembanyama #136'),
          createVictorComp(22, '2026-05-31T10:00:00.000Z', '2023 Panini Prizm Victor Wembanyama'),
          createVictorComp(24, '2026-05-30T10:00:00.000Z', 'Panini Prizm Victor Wembanyama #136'),
        ],
      }),
      name: 'soldcomps',
    });

    const result = await priceListingNow(listing.listing_id, {
      dataAccess,
      now: () => new Date('2026-06-12T10:00:00.000Z'),
      resolvePricingProvider,
    });

    expect(resolvePricingProvider).toHaveBeenCalledWith('soldcomps');
    expect(result.provider).toBe('soldcomps');
    expect(spies.updateAppSettings).toHaveBeenCalledWith(
      {
        soldcomps_usage_snapshot: {
          limit: 50,
          source: 'headers',
          updatedAt: '2026-06-12T10:05:00.000Z',
          used: 43,
        },
      },
      'default'
    );
  });

  it('persists null-safe SoldComps usage snapshot when headers missing or malformed', async () => {
    const listing = createListing();
    const { dataAccess, spies } = createDataAccess(listing);
    const fetchSoldComps = vi
      .fn()
      .mockResolvedValueOnce({
        fetchedAt: '2026-06-12T10:05:00.000Z',
        provider: 'soldcomps',
        query: 'query',
        rawResult: { provider: 'soldcomps' },
        soldCompsUsage: {
          limit: null,
          source: 'missing',
          updatedAt: '2026-06-12T10:05:00.000Z',
          used: null,
        },
        soldComps: [
          createVictorComp(20, '2026-06-01T10:00:00.000Z', '2023 Panini Prizm Victor Wembanyama #136'),
          createVictorComp(22, '2026-05-31T10:00:00.000Z', '2023 Panini Prizm Victor Wembanyama'),
          createVictorComp(24, '2026-05-30T10:00:00.000Z', 'Panini Prizm Victor Wembanyama #136'),
        ],
      })
      .mockResolvedValueOnce({
        fetchedAt: '2026-06-12T10:06:00.000Z',
        provider: 'soldcomps',
        query: 'query',
        rawResult: { provider: 'soldcomps' },
        soldCompsUsage: {
          limit: null,
          source: 'malformed',
          updatedAt: '2026-06-12T10:06:00.000Z',
          used: null,
        },
        soldComps: [
          createVictorComp(20, '2026-06-01T10:00:00.000Z', '2023 Panini Prizm Victor Wembanyama #136'),
          createVictorComp(22, '2026-05-31T10:00:00.000Z', '2023 Panini Prizm Victor Wembanyama'),
          createVictorComp(24, '2026-05-30T10:00:00.000Z', 'Panini Prizm Victor Wembanyama #136'),
        ],
      });

    await priceListingNow(listing.listing_id, {
      dataAccess,
      now: () => new Date('2026-06-12T10:00:00.000Z'),
      pricingProvider: {
        fetchSoldComps,
        name: 'soldcomps',
      } as never,
    });

    await priceListingNow(listing.listing_id, {
      dataAccess,
      now: () => new Date('2026-06-12T10:00:00.000Z'),
      pricingProvider: {
        fetchSoldComps,
        name: 'soldcomps',
      } as never,
    });

    expect(spies.updateAppSettings).toHaveBeenNthCalledWith(
      1,
      {
        soldcomps_usage_snapshot: {
          limit: null,
          source: 'missing',
          updatedAt: '2026-06-12T10:05:00.000Z',
          used: null,
        },
      },
      'default'
    );
    expect(spies.updateAppSettings).toHaveBeenNthCalledWith(
      2,
      {
        soldcomps_usage_snapshot: {
          limit: null,
          source: 'malformed',
          updatedAt: '2026-06-12T10:06:00.000Z',
          used: null,
        },
      },
      'default'
    );
  });

  it('keeps pricing success path when SoldComps usage snapshot persistence fails', async () => {
    const listing = createListing();
    const { dataAccess, spies } = createDataAccess(listing);
    spies.updateAppSettings.mockRejectedValueOnce(new Error('app settings write failed'));

    const result = await priceListingNow(listing.listing_id, {
      dataAccess,
      now: () => new Date('2026-06-12T10:00:00.000Z'),
      pricingProvider: {
        fetchSoldComps: vi.fn().mockResolvedValue({
          fetchedAt: '2026-06-12T10:05:00.000Z',
          provider: 'soldcomps',
          query: 'query',
          rawResult: { provider: 'soldcomps' },
          soldCompsUsage: {
            limit: 50,
            source: 'headers',
            updatedAt: '2026-06-12T10:05:00.000Z',
            used: 43,
          },
          soldComps: [
            createVictorComp(20, '2026-06-01T10:00:00.000Z', '2023 Panini Prizm Victor Wembanyama #136'),
            createVictorComp(22, '2026-05-31T10:00:00.000Z', '2023 Panini Prizm Victor Wembanyama'),
            createVictorComp(24, '2026-05-30T10:00:00.000Z', 'Panini Prizm Victor Wembanyama #136'),
          ],
        }),
        name: 'soldcomps',
      } as never,
    });

    expect(result).toMatchObject({
      listingPriceResearchUpdated: true,
      provider: 'soldcomps',
      selectedProviderMode: 'soldcomps',
      suggestedPrice: expect.any(Number),
    });
    expect(spies.markSucceeded).toHaveBeenCalledTimes(1);
    expect(spies.update).toHaveBeenCalledWith(listing.listing_id, {
      price: result.suggestedPrice,
    });
    expect(spies.updateAppSettings).toHaveBeenCalledWith(
      {
        soldcomps_usage_snapshot: {
          limit: 50,
          source: 'headers',
          updatedAt: '2026-06-12T10:05:00.000Z',
          used: 43,
        },
      },
      'default'
    );
  });

  it('uses persisted apify mode for runtime provider resolution', async () => {
    const listing = createListing();
    const { dataAccess } = createDataAccess(
      listing,
      createAppSettings({ pricing_provider_mode: 'apify' })
    );
    const resolvePricingProvider = vi.fn().mockReturnValue({
      fetchSoldComps: vi.fn().mockResolvedValue({
        fetchedAt: '2026-06-12T10:05:00.000Z',
        provider: 'apify',
        query: 'query',
        rawResult: { provider: 'apify' },
        soldComps: [
          createVictorComp(20, '2026-06-01T10:00:00.000Z', '2023 Panini Prizm Victor Wembanyama #136'),
          createVictorComp(22, '2026-05-31T10:00:00.000Z', '2023 Panini Prizm Victor Wembanyama'),
          createVictorComp(24, '2026-05-30T10:00:00.000Z', 'Panini Prizm Victor Wembanyama #136'),
        ],
      }),
      name: 'apify',
    });

    const result = await priceListingNow(listing.listing_id, {
      dataAccess,
      now: () => new Date('2026-06-12T10:00:00.000Z'),
      resolvePricingProvider,
    });

    expect(resolvePricingProvider).toHaveBeenCalledWith('apify');
    expect(result.provider).toBe('apify');
  });

  it('fails selected soldcomps mode clearly without fixture fallback when config missing', async () => {
    const listing = createListing();
    const { dataAccess, spies } = createDataAccess(listing);

    await expect(
      priceListingNow(listing.listing_id, {
        dataAccess,
        now: () => new Date('2026-06-12T10:00:00.000Z'),
        pricingProviderEnv: {},
      })
    ).rejects.toMatchObject({
      category: 'user_fixable',
      code: JOB_ERROR_CODES.RESEARCH_PRICE_FAILED,
      context: expect.objectContaining({
        provider: 'soldcomps',
        provider_failure_category: 'auth_config',
        provider_failure_code: 'soldcomps_config_invalid',
      }),
    });

    expect(spies.create).not.toHaveBeenCalled();
    expect(spies.markFailed).not.toHaveBeenCalled();
    expect(spies.update).not.toHaveBeenCalled();
  });

  it('classifies and redacts provider failure', async () => {
    const listing = createListing();
    const { dataAccess, spies } = createDataAccess(listing);

    await expect(
      priceListingNow(listing.listing_id, {
        createPricingProvider: () =>
          ({
            fetchSoldComps: vi.fn().mockRejectedValue(
              new ApifyPricingProviderError(
                'apify_auth_failed',
                'auth_config',
                'Bearer super-secret-token https://api.apify.com/v2/acts',
                'token=super-secret-token'
              )
            ),
            name: 'apify',
          }) as never,
        dataAccess,
        now: () => new Date('2026-06-12T10:00:00.000Z'),
      })
    ).rejects.toMatchObject({
      category: 'user_fixable',
      code: JOB_ERROR_CODES.RESEARCH_PRICE_FAILED,
      context: expect.objectContaining({
        provider: 'apify',
        provider_failure_category: 'auth_config',
        provider_failure_code: 'apify_auth_failed',
      }),
    });

    const markFailedInput = spies.markFailed.mock.calls[0]?.[0];
    expect(markFailedInput.error_code).toBe(JOB_ERROR_CODES.RESEARCH_PRICE_FAILED);
    expect(JSON.stringify(markFailedInput)).not.toContain('super-secret-token');
    expect(markFailedInput.raw_result_json).toMatchObject({
      failure: expect.objectContaining({
        code: 'apify_auth_failed',
      }),
    });
  });

  it('classifies soldcomps typed provider failure through provider-neutral path', async () => {
    const listing = createListing();
    const { dataAccess, spies } = createDataAccess(listing);

    await expect(
      priceListingNow(listing.listing_id, {
        createPricingProvider: () =>
          ({
            fetchSoldComps: vi.fn().mockRejectedValue(
              new SoldCompsPricingProviderError(
                'soldcomps_rate_limited',
                'rate_limit',
                'Bearer soldcomps-secret token=soldcomps-secret',
                'player=victor'
              )
            ),
            name: 'soldcomps',
          }) as never,
        dataAccess,
        now: () => new Date('2026-06-12T10:00:00.000Z'),
      })
    ).rejects.toMatchObject({
      category: 'recoverable',
      code: JOB_ERROR_CODES.RESEARCH_PRICE_FAILED,
      context: expect.objectContaining({
        provider: 'soldcomps',
        provider_failure_category: 'rate_limit',
        provider_failure_code: 'soldcomps_rate_limited',
      }),
    });

    const markFailedInput = spies.markFailed.mock.calls[0]?.[0];
    expect(JSON.stringify(markFailedInput)).not.toContain('soldcomps-secret');
  });
});
