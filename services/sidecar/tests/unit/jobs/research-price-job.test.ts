import type { AppSettingsRow, ListingPriceResearchRow, ListingRow } from '@ebay-inventory/data';

import { describe, expect, it, vi } from 'vitest';

import { JOB_ERROR_CODES } from '@/jobs/job-errors.js';
import { priceListingNow } from '@/jobs/research-price-job.js';
import { ApifyPricingProviderError } from '@/pricing/index.js';

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
    pricing_service_enabled: true,
    updated_at: '2026-06-11T12:00:00.000Z',
    ...overrides,
  } as AppSettingsRow;
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
      createAppSettings({ pricing_service_enabled: false })
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
        {
          price: { currency: 'USD', value: 20 },
          soldDate: '2026-06-01T10:00:00.000Z',
          title: 'Comp A',
        },
        {
          price: { currency: 'USD', value: 22 },
          soldDate: '2026-05-31T10:00:00.000Z',
          title: 'Comp B',
        },
        {
          price: { currency: 'USD', value: 24 },
          soldDate: '2026-05-30T10:00:00.000Z',
          title: 'Comp C',
        },
        {
          price: { currency: 'USD', value: 26 },
          soldDate: '2026-05-29T10:00:00.000Z',
          title: 'Comp D',
        },
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
        minSoldComps: 8,
      })
    );
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

  it('uses explicit configured minSoldComps for canonical apify pricing path', async () => {
    const listing = createListing();
    const { dataAccess } = createDataAccess(listing);
    const fetchSoldComps = vi.fn().mockResolvedValue({
      fetchedAt: '2026-06-12T10:05:00.000Z',
      provider: 'apify',
      query: 'query',
      rawResult: { actorId: 'actor-123' },
      soldComps: [
        { price: { currency: 'USD', value: 20 }, soldDate: '2026-06-01T10:00:00.000Z', title: 'Comp A' },
        { price: { currency: 'USD', value: 22 }, soldDate: '2026-05-31T10:00:00.000Z', title: 'Comp B' },
        { price: { currency: 'USD', value: 24 }, soldDate: '2026-05-30T10:00:00.000Z', title: 'Comp C' },
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
      pricingProviderMinSoldComps: 8,
    });

    expect(fetchSoldComps).toHaveBeenCalledWith(
      expect.objectContaining({
        listingId: listing.listing_id,
        minSoldComps: 8,
      })
    );
  });

  it('falls back to apify default minSoldComps=8 in live provider path', async () => {
    const listing = createListing();
    const { dataAccess } = createDataAccess(listing);
    const fetchSoldComps = vi.fn().mockResolvedValue({
      fetchedAt: '2026-06-12T10:05:00.000Z',
      provider: 'apify',
      query: 'query',
      rawResult: { actorId: 'actor-123' },
      soldComps: [
        { price: { currency: 'USD', value: 20 }, soldDate: '2026-06-01T10:00:00.000Z', title: 'Comp A' },
        { price: { currency: 'USD', value: 22 }, soldDate: '2026-05-31T10:00:00.000Z', title: 'Comp B' },
        { price: { currency: 'USD', value: 24 }, soldDate: '2026-05-30T10:00:00.000Z', title: 'Comp C' },
      ],
    });
    const originalEnv = process.env.APIFY_MIN_SOLD_COMPS;
    process.env.APIFY_MIN_SOLD_COMPS = '';

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
        minSoldComps: 8,
      })
    );
  });

  it('does not cap over-returned comps after fetch in canonical path', async () => {
    const listing = createListing();
    const { dataAccess } = createDataAccess(listing);
    const soldComps = Array.from({ length: 12 }, (_value, index) => ({
      price: { currency: 'USD', value: 20 + index },
      soldDate: `2026-06-${String(index + 1).padStart(2, '0')}T10:00:00.000Z`,
      title: `Comp ${index + 1}`,
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
      pricingProviderMinSoldComps: 8,
    });

    expect(result.rawCompCount).toBe(12);
    expect(result.acceptedCompCount).toBe(12);
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
});
