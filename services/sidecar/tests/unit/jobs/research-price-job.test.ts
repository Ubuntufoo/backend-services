import type { AppSettingsRow, ListingPriceResearchRow, ListingRow } from '@ebay-inventory/data';

import { describe, expect, it, vi } from 'vitest';

import { JOB_ERROR_CODES } from '@/jobs/job-errors.js';
import { priceListingNow } from '@/jobs/research-price-job.js';
import { ApifyPricingProviderError, SoldCompsPricingProviderError } from '@/pricing/index.js';

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
    confidence: null,
    created_at: '2026-06-11T12:05:00.000Z',
    error_code: null,
    error_message: null,
    id: 'listing-price-research-id',
    listing_id: 'Single-000123',
    llm_price_explanation: null,
    llm_reasoning_json: {},
    llm_rejected_comp_ids: [],
    llm_selected_comp_ids: [],
    median_sold_price: null,
    pricing_model_name: null,
    provider: 'apify',
    query: null,
    raw_result_json: {},
    sold_count: null,
    status: 'pending',
    suggested_price: null,
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

function createDataAccess(listing: ListingRow | null, appSettings = createAppSettings()) {
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

  return {
    dataAccess: {
      appSettings: {
        get: vi.fn().mockResolvedValue(appSettings),
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
      markFailed,
      markSucceeded,
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
        priceExplanation: 'accepted comps only',
        rejectedCompIds: [],
        selectedCompIds: [],
        suggestedPrice: 19,
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
              normalization: expect.objectContaining({
                acceptedCount: 3,
                rawCount: 5,
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
  });

  it('persists exact-card mismatch reasons and excludes rejected comps from stats', async () => {
    const listing = createListing({
      item_specifics: {
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
        priceExplanation: 'Used exact comps only.',
        rejectedCompIds: [],
        selectedCompIds: [],
        suggestedPrice: 15,
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

    expect(
      analyze.mock.calls[0]?.[0]?.comps.map((comp: { title: string }) => comp.title)
    ).toEqual([
      '1997 Fleer Darryl Strawberry #179',
      '1997 Fleer Set Break #179 Darryl Strawberry',
    ]);
    expect(analyze).toHaveBeenCalledWith(
      expect.objectContaining({
        stats: expect.objectContaining({
          highSoldPrice: 14,
          lowSoldPrice: 10,
          soldCount: 2,
        }),
      })
    );
    expect(spies.markSucceeded).toHaveBeenCalledWith(
      expect.objectContaining({
        raw_result_json: expect.objectContaining({
          normalization: expect.objectContaining({
            acceptedCount: 2,
            rawCount: 3,
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

  it('uses persisted default soldcomps mode when app settings row missing', async () => {
    const listing = createListing();
    const { dataAccess } = createDataAccess(listing, null);
    const resolvePricingProvider = vi.fn().mockReturnValue({
      fetchSoldComps: vi.fn().mockResolvedValue({
        fetchedAt: '2026-06-12T10:05:00.000Z',
        provider: 'soldcomps',
        query: 'query',
        rawResult: { provider: 'soldcomps' },
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
