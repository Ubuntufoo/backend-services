import { describe, expect, it } from 'vitest';
import type { ListingPriceResearchRow } from '@ebay-inventory/data';
import { serializeLatestPricingResearch } from '@/http/listing-pricing-analysis.js';

function createResearch(overrides: Partial<ListingPriceResearchRow> = {}): ListingPriceResearchRow {
  return {
    comps: [],
    confidence: null,
    created_at: '2026-06-17T16:00:00.000Z',
    dismissed_pricing_warning_codes: [],
    error_code: null,
    error_message: null,
    id: 'pricing-research-001',
    listing_id: 'LIST-001',
    llm_price_explanation: null,
    llm_reasoning_json: {},
    llm_rejected_comp_ids: [],
    median_sold_price: null,
    pricing_model_name: null,
    provider: 'apify',
    query: '1993 upper deck sp derek jeter',
    raw_result_json: {},
    sold_count: null,
    status: 'failed',
    suggested_price: null,
    updated_at: '2026-06-17T16:00:00.000Z',
    ...overrides,
  } as ListingPriceResearchRow;
}

function createCompetitor(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    legacyItemId: 'item-1',
    title: '1993 Upper Deck SP Derek Jeter',
    condition: 'Near Mint',
    conditionId: '2750',
    itemPrice: { value: 100, currency: 'USD' },
    shippingCost: { value: 5, currency: 'USD' },
    shippingType: 'FreeShipping',
    totalPrice: { value: 105, currency: 'USD' },
    itemUrl: 'https://ebay.com/itm/item-1',
    ...overrides,
  };
}

function createActiveMarket(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: 'available',
    skipReason: null,
    unavailableReason: null,
    incompleteReason: null,
    capturedAt: '2026-08-15T12:00:00.000Z',
    anchor: {
      basis: 'condition_adjusted_base_price_before_competitive_velocity',
      currency: 'USD',
      value: 100,
    },
    multipliers: { minPriceMultiplier: 0.33, maxPriceMultiplier: 3 },
    itemPriceWindow: { min: 33, max: 300, currency: 'USD' },
    query: {
      canonical: '1993 upper deck sp derek jeter',
      marketplaceId: 'EBAY_US',
      categoryId: '261328',
      conditionId: '2750',
      buyingOption: 'FIXED_PRICE',
    },
    sellerExclusionApplied: true,
    shippingContext: {
      country: 'US',
      postalCode: '10001',
      basis: 'configured_contextual_location',
    },
    safeguards: { maxPages: 10, maxDurationMs: 15000, maxOffset: 2000 },
    pagesScanned: 2,
    candidateRowsScanned: 42,
    complete: true,
    exactAcceptedCount: 3,
    acceptedCount: 3,
    rejectedCount: 5,
    rejectionReasonCounts: { active_set_mismatch: 3, active_autograph_mismatch: 2 },
    distributions: {
      itemPrice: { low: 50, median: 100, high: 150, currency: 'USD' },
      shippingKnownTotal: { low: 55, median: 108, high: 160, currency: 'USD' },
    },
    shippingKnownAcceptedCount: 2,
    latencyMs: 420,
    tacticalSellPrice: null,
    competitors: [
      createCompetitor({ legacyItemId: 'item-1' }),
      createCompetitor({
        legacyItemId: 'item-2',
        condition: null,
        conditionId: null,
        shippingCost: null,
        shippingType: null,
        totalPrice: null,
        itemUrl: 'https://ebay.com/itm/item-2',
      }),
    ],
    ...overrides,
  };
}

describe('serializeLatestPricingResearch', () => {
  it('returns null for missing research', () => {
    expect(serializeLatestPricingResearch(null)).toBeNull();
  });

  it('keeps failure_summary null for succeeded research', () => {
    const result = serializeLatestPricingResearch(
      createResearch({
        comps: [{ id: 'comp-1' }],
        confidence: 'high',
        status: 'succeeded',
        suggested_price: 24,
      })
    );

    expect(result?.failure_summary).toBeNull();
    expect(result?.price_adjustment).toBeNull();
  });

  it.each([
    { median: 4, expectedMin: 1, expectedMax: 12 },
    { median: 5, expectedMin: 1, expectedMax: 15 },
    { median: 12.8, expectedMin: 4, expectedMax: 38 },
    { median: 1, expectedMin: 1, expectedMax: 3 },
    { median: 0.25, expectedMin: 1, expectedMax: 1 },
  ])(
    'derives the Terapeak price band from a $median SoldComps median',
    ({ median, expectedMin, expectedMax }) => {
      const result = serializeLatestPricingResearch(
        createResearch({
          median_sold_price: median,
          provider: 'soldcomps',
          status: 'succeeded',
        })
      );

      expect(result?.terapeak_min_price).toBe(expectedMin);
      expect(result?.terapeak_max_price).toBe(expectedMax);
    }
  );

  it.each([
    { label: 'failed', overrides: { median_sold_price: 5, provider: 'soldcomps' } },
    {
      label: 'non-SoldComps',
      overrides: { median_sold_price: 5, provider: 'apify', status: 'succeeded' },
    },
    {
      label: 'missing median',
      overrides: { median_sold_price: null, provider: 'soldcomps', status: 'succeeded' },
    },
    {
      label: 'zero median',
      overrides: { median_sold_price: 0, provider: 'soldcomps', status: 'succeeded' },
    },
    {
      label: 'non-finite median',
      overrides: {
        median_sold_price: Number.POSITIVE_INFINITY,
        provider: 'soldcomps',
        status: 'succeeded',
      },
    },
  ])('returns a null Terapeak price band for $label research', ({ overrides }) => {
    const result = serializeLatestPricingResearch(createResearch(overrides));

    expect(result?.terapeak_min_price).toBeNull();
    expect(result?.terapeak_max_price).toBeNull();
  });

  it('exposes the persisted adjustment audit for new successful research', () => {
    const result = serializeLatestPricingResearch(
      createResearch({
        median_sold_price: 117.63,
        raw_result_json: {
          conditionAdjustment: {
            listingConditionSignal: {
              label: 'Near Mint or Better',
              matchedText: 'NEAR_MINT_OR_BETTER',
              score: 5,
              source: 'listing_condition',
            },
            listingConditionScore: 5,
            explicitCompConditionCount: 3,
            compMedianConditionScore: 5.5,
            conditionDelta: -0.5,
            deterministicMedianPrice: 117.63,
            allowedAdjustment: {
              eligible: true,
              targetPrice: 117.63,
              minPrice: 117.63,
              maxPrice: 117.63,
              rawPercent: -0.1225,
              appliedPercent: 0,
              reason: 'negative_blocked_for_top_condition',
            },
          },
          finalPriceAdjustment: {
            basePrice: 117.63,
            competitiveDiscountPercent: 5,
            competitiveAdjustedPrice: 111.7485,
            recentWindowDays: 90,
            recentAcceptedCompCount: 8,
            salesVelocityTier: 'high',
            salesVelocityDiscountPercent: 0,
            finalPrice: 111.75,
          },
        },
        status: 'succeeded',
        suggested_price: 111.75,
      })
    );

    expect(result?.price_adjustment).toEqual({
      median_sold_price: 117.63,
      listing_condition_label: 'Near Mint or Better',
      listing_condition_score: 5,
      explicit_comp_condition_count: 3,
      comp_median_condition_score: 5.5,
      observed_condition_delta: -0.5,
      raw_condition_percent: -12.25,
      applied_condition_percent: 0,
      condition_adjusted_price: 117.63,
      condition_reason: 'negative_blocked_for_top_condition',
      competitive_discount_percent: 5,
      competitive_adjusted_price: 111.7485,
      recent_window_days: 90,
      recent_accepted_comp_count: 8,
      sales_velocity_tier: 'high',
      sales_velocity_discount_percent: 0,
      final_total_adjustment_percent: -5,
      final_suggested_price: 111.75,
    });
  });

  it('returns a null adjustment audit for incomplete successful research', () => {
    const result = serializeLatestPricingResearch(
      createResearch({
        raw_result_json: {
          conditionAdjustment: { deterministicMedianPrice: 100 },
          finalPriceAdjustment: { finalPrice: 95 },
        },
        status: 'succeeded',
      })
    );

    expect(result?.price_adjustment).toBeNull();
  });

  it('exposes normalization and provider counts separately from llm comp selections', () => {
    const result = serializeLatestPricingResearch(
      createResearch({
        comps: [{ id: 'comp-1' }, { id: 'comp-2' }],
        llm_reasoning_json: {
          rejectedCompIds: ['comp-2'],
          selectedCompIds: ['comp-1'],
        },
        raw_result_json: {
          diagnostics: {
            normalizationAcceptedCount: 2,
            normalizationRejectedCount: 24,
            providerReportedTotalCount: 50,
            providerReturnedCount: 26,
          },
        },
        status: 'succeeded',
      })
    );

    expect(result?.comp_summary).toEqual({
      normalization_accepted_count: 2,
      normalization_rejected_count: 24,
      provider_reported_count: 50,
      provider_returned_count: 26,
      rejected_comp_count: 1,
      rejected_comp_ids: ['comp-2'],
      selected_comp_count: 1,
      selected_comp_ids: ['comp-1'],
      total_comp_count: 2,
    });
  });

  it('falls back to persisted comps when latest research predates normalization diagnostics', () => {
    const result = serializeLatestPricingResearch(
      createResearch({
        comps: [{ id: 'comp-1' }, { id: 'comp-2' }, { id: 'comp-3' }],
        status: 'succeeded',
      })
    );

    expect(result?.comp_summary).toEqual({
      normalization_accepted_count: 3,
      normalization_rejected_count: 0,
      provider_returned_count: 3,
      rejected_comp_count: 0,
      rejected_comp_ids: [],
      selected_comp_count: 0,
      selected_comp_ids: [],
      total_comp_count: 3,
    });
  });

  it('classifies provider zero results from zero diagnostics', () => {
    const result = serializeLatestPricingResearch(
      createResearch({
        raw_result_json: {
          diagnostics: {
            normalizationAcceptedCount: 0,
            normalizationInputCount: 0,
            normalizationRejectedCount: 0,
            providerReturnedCount: 0,
            requestedCount: 25,
            selectedProvider: 'soldcomps',
          },
        },
      })
    );

    expect(result?.failure_summary).toEqual({
      accepted_comp_count: 0,
      provider: 'soldcomps',
      provider_returned_count: 0,
      query: '1993 upper deck sp derek jeter',
      reason: 'provider_zero_results',
      rejected_comp_count: 0,
      requested_count: 25,
    });
  });

  it('keeps provider zero results ahead of generic failed-research code and message', () => {
    const result = serializeLatestPricingResearch(
      createResearch({
        error_code: 'RESEARCH_PRICE_FAILED',
        error_message: 'Provider returned zero results for this query',
        raw_result_json: {
          diagnostics: {
            normalizationInputCount: 0,
            providerReturnedCount: 0,
            rawCompCount: 0,
            selectedProvider: 'soldcomps',
          },
        },
      })
    );

    expect(result?.failure_summary).toEqual({
      accepted_comp_count: 0,
      provider: 'soldcomps',
      provider_returned_count: 0,
      query: '1993 upper deck sp derek jeter',
      reason: 'provider_zero_results',
      rejected_comp_count: 0,
    });
  });

  it('classifies all comps rejected and returns safe reason counts', () => {
    const result = serializeLatestPricingResearch(
      createResearch({
        raw_result_json: {
          diagnostics: {
            normalizationAcceptedCount: 0,
            normalizationRejectedCount: 3,
            providerReturnedCount: 3,
          },
          normalization: {
            rejected: [
              { reason: 'grade mismatch' },
              { reason: 'grade mismatch' },
              { code: 'title-mismatch' },
            ],
          },
        },
      })
    );

    expect(result?.failure_summary).toEqual({
      accepted_comp_count: 0,
      provider: 'apify',
      provider_returned_count: 3,
      query: '1993 upper deck sp derek jeter',
      reason: 'all_comps_rejected',
      rejected_comp_count: 3,
      rejected_reason_counts: {
        grade_mismatch: 2,
        title_mismatch: 1,
      },
    });
  });

  it('classifies provider failures from persisted failure context', () => {
    const result = serializeLatestPricingResearch(
      createResearch({
        raw_result_json: {
          failure: {
            providerFailureCategory: 'rate_limit',
            providerFailureCode: 'RATE_LIMITED',
            provider: 'soldcomps',
            query: 'secret query token=sk_live_123456',
          },
        },
      })
    );

    expect(result?.failure_summary).toEqual({
      provider: 'soldcomps',
      provider_failure_category: 'rate_limit',
      provider_failure_code: 'RATE_LIMITED',
      query: 'secret query token=[redacted]',
      reason: 'provider_failure',
    });
  });

  it('keeps generic failure code without provider evidence classified as unknown', () => {
    const result = serializeLatestPricingResearch(
      createResearch({
        raw_result_json: {
          failure: {
            code: 'research_price_suggested_price_invalid',
          },
        },
      })
    );

    expect(result?.failure_summary).toEqual({
      provider: 'apify',
      query: '1993 upper deck sp derek jeter',
      reason: 'unknown',
    });
  });

  it('falls back to unknown for legacy failed research without diagnostics', () => {
    const result = serializeLatestPricingResearch(
      createResearch({
        error_code: 'RATE_LIMITED',
        error_message: 'Provider overloaded',
      })
    );

    expect(result?.failure_summary).toEqual({
      provider: 'apify',
      query: '1993 upper deck sp derek jeter',
      reason: 'unknown',
    });
  });
});

describe('serializeLatestPricingResearch active_market', () => {
  it('serializes a valid complete active-market snapshot with snake_case fields', () => {
    const result = serializeLatestPricingResearch(
      createResearch({
        status: 'succeeded',
        raw_result_json: { activeMarket: createActiveMarket() },
      })
    );

    expect(result?.active_market).toEqual({
      status: 'available',
      skip_reason: null,
      unavailable_reason: null,
      incomplete_reason: null,
      captured_at: '2026-08-15T12:00:00.000Z',
      anchor: {
        value: 100,
        currency: 'USD',
        basis: 'condition_adjusted_base_price_before_competitive_velocity',
      },
      multipliers: { min_price_multiplier: 0.33, max_price_multiplier: 3 },
      item_price_window: { min: 33, max: 300, currency: 'USD' },
      query: {
        canonical: '1993 upper deck sp derek jeter',
        marketplace_id: 'EBAY_US',
        category_id: '261328',
        condition_id: '2750',
        buying_option: 'FIXED_PRICE',
      },
      seller_exclusion_applied: true,
      shipping_context: {
        country: 'US',
        postal_code: '10001',
        basis: 'configured_contextual_location',
      },
      safeguards: { max_pages: 10, max_duration_ms: 15000, max_offset: 2000 },
      pages_scanned: 2,
      candidate_rows_scanned: 42,
      complete: true,
      exact_accepted_count: 3,
      accepted_count: 3,
      rejected_count: 5,
      rejection_reason_counts: { active_set_mismatch: 3, active_autograph_mismatch: 2 },
      distributions: {
        item_price: { low: 50, median: 100, high: 150, currency: 'USD' },
        shipping_known_total: { low: 55, median: 108, high: 160, currency: 'USD' },
      },
      shipping_known_accepted_count: 2,
      latency_ms: 420,
      tactical_sell_price: null,
      competitors: [
        {
          legacy_item_id: 'item-1',
          title: '1993 Upper Deck SP Derek Jeter',
          condition: 'Near Mint',
          condition_id: '2750',
          item_price: { value: 100, currency: 'USD' },
          shipping_cost: { value: 5, currency: 'USD' },
          shipping_type: 'FreeShipping',
          total_price: { value: 105, currency: 'USD' },
          item_url: 'https://ebay.com/itm/item-1',
        },
        {
          legacy_item_id: 'item-2',
          title: '1993 Upper Deck SP Derek Jeter',
          condition: null,
          condition_id: null,
          item_price: { value: 100, currency: 'USD' },
          shipping_cost: null,
          shipping_type: null,
          total_price: null,
          item_url: 'https://ebay.com/itm/item-2',
        },
      ],
    });
  });

  it('omits active_market for legacy rows without activeMarket', () => {
    const result = serializeLatestPricingResearch(
      createResearch({ raw_result_json: { diagnostics: { providerReturnedCount: 1 } } })
    );

    expect(result).not.toBeNull();
    expect(result?.active_market).toBeUndefined();
  });

  it.each([
    { label: 'non-object', activeMarket: 'garbage' },
    { label: 'null', activeMarket: null },
    { label: 'array', activeMarket: [] },
    { label: 'missing status', activeMarket: { capturedAt: '2026-08-15T12:00:00.000Z' } },
    {
      label: 'invalid status',
      activeMarket: { status: 'mystery', capturedAt: '2026-08-15T12:00:00.000Z' },
    },
    { label: 'missing capturedAt', activeMarket: { status: 'available' } },
    {
      label: 'missing query',
      activeMarket: { status: 'available', capturedAt: '2026-08-15T12:00:00.000Z' },
    },
  ])('omits active_market for $label activeMarket', ({ activeMarket }) => {
    const result = serializeLatestPricingResearch(
      createResearch({ raw_result_json: { activeMarket } })
    );

    expect(result?.active_market).toBeUndefined();
  });

  it.each([
    {
      label: 'malformed anchor',
      overrides: { anchor: { value: 'not-a-number', currency: 'USD', basis: 'configured' } },
    },
    { label: 'malformed distributions', overrides: { distributions: 'not-an-object' } },
    {
      label: 'malformed competitors',
      overrides: { competitors: [{ legacyItemId: 'missing-item-price' }, null, 'garbage'] },
    },
    { label: 'missing safeguards', overrides: { safeguards: null } },
    {
      label: 'missing query marketplaceId',
      overrides: { query: { canonical: 'x', buyingOption: 'FIXED_PRICE' } },
    },
  ])('omits active_market when nested persisted data is $label', ({ overrides }) => {
    const result = serializeLatestPricingResearch(
      createResearch({ raw_result_json: { activeMarket: createActiveMarket(overrides) } })
    );

    expect(result?.active_market).toBeUndefined();
  });

  it('preserves null exact count and distributions for incomplete snapshots', () => {
    const result = serializeLatestPricingResearch(
      createResearch({
        raw_result_json: {
          activeMarket: createActiveMarket({
            complete: false,
            incompleteReason: 'time_limit',
            exactAcceptedCount: null,
            distributions: null,
          }),
        },
      })
    );

    expect(result?.active_market?.complete).toBe(false);
    expect(result?.active_market?.exact_accepted_count).toBeNull();
    expect(result?.active_market?.distributions).toBeNull();
    expect(result?.active_market?.incomplete_reason).toBe('time_limit');
  });

  it('omits active_market when complete and exact count are inconsistent', () => {
    const result = serializeLatestPricingResearch(
      createResearch({
        raw_result_json: {
          activeMarket: createActiveMarket({
            complete: false,
            incompleteReason: 'time_limit',
            exactAcceptedCount: 7,
            distributions: null,
          }),
        },
      })
    );

    expect(result?.active_market).toBeUndefined();
  });

  it('serializes a complete snapshot with only item_price distribution', () => {
    const result = serializeLatestPricingResearch(
      createResearch({
        raw_result_json: {
          activeMarket: createActiveMarket({
            distributions: {
              itemPrice: { low: 50, median: 100, high: 150, currency: 'USD' },
              shippingKnownTotal: null,
            },
          }),
        },
      })
    );

    expect(result?.active_market?.distributions).toEqual({
      item_price: { low: 50, median: 100, high: 150, currency: 'USD' },
      shipping_known_total: null,
    });
  });

  it.each([
    {
      label: 'skipped without skip reason',
      overrides: {
        status: 'skipped',
        complete: false,
        exactAcceptedCount: null,
        distributions: null,
      },
    },
    {
      label: 'unavailable without unavailable reason',
      overrides: {
        status: 'unavailable',
        complete: false,
        exactAcceptedCount: null,
        distributions: null,
      },
    },
    {
      label: 'incomplete available without incomplete reason',
      overrides: {
        complete: false,
        incompleteReason: null,
        exactAcceptedCount: null,
        distributions: null,
      },
    },
  ])('omits active_market when status/reason inconsistent: $label', ({ overrides }) => {
    const result = serializeLatestPricingResearch(
      createResearch({ raw_result_json: { activeMarket: createActiveMarket(overrides) } })
    );

    expect(result?.active_market).toBeUndefined();
  });

  it.each([
    {
      label: 'non-FIXED_PRICE buyingOption',
      overrides: {
        query: {
          canonical: '1993 upper deck sp derek jeter',
          marketplaceId: 'EBAY_US',
          categoryId: '261328',
          conditionId: '2750',
          buyingOption: 'AUCTION',
        },
      },
    },
    {
      label: 'wrong anchor basis',
      overrides: {
        anchor: { value: 100, currency: 'USD', basis: 'some_other_basis' },
      },
    },
    {
      label: 'wrong shipping context basis',
      overrides: {
        shippingContext: { country: 'US', postalCode: '10001', basis: 'some_other_basis' },
      },
    },
    {
      label: 'unknown skip reason',
      overrides: {
        status: 'skipped',
        skipReason: 'not_a_real_reason',
        complete: false,
        exactAcceptedCount: null,
        distributions: null,
      },
    },
    {
      label: 'unknown unavailable reason',
      overrides: {
        status: 'unavailable',
        unavailableReason: 'not_a_real_reason',
        complete: false,
        exactAcceptedCount: null,
        distributions: null,
      },
    },
    {
      label: 'unknown incomplete reason',
      overrides: {
        complete: false,
        incompleteReason: 'not_a_real_reason',
        exactAcceptedCount: null,
        distributions: null,
      },
    },
  ])('omits active_market for invalid fixed literal or reason: $label', ({ overrides }) => {
    const result = serializeLatestPricingResearch(
      createResearch({ raw_result_json: { activeMarket: createActiveMarket(overrides) } })
    );

    expect(result?.active_market).toBeUndefined();
  });

  it.each([
    {
      label: 'skipped with complete true',
      overrides: { status: 'skipped', skipReason: 'browse_disabled' },
    },
    {
      label: 'unavailable with complete true',
      overrides: { status: 'unavailable', unavailableReason: 'missing_anchor' },
    },
    { label: 'non-positive tacticalSellPrice', overrides: { tacticalSellPrice: 0 } },
    { label: 'fractional-cent tacticalSellPrice', overrides: { tacticalSellPrice: 42.505 } },
  ])('omits active_market when $label', ({ overrides }) => {
    const result = serializeLatestPricingResearch(
      createResearch({ raw_result_json: { activeMarket: createActiveMarket(overrides) } })
    );

    expect(result?.active_market).toBeUndefined();
  });

  it('serializes a valid nullable tactical sell price', () => {
    const result = serializeLatestPricingResearch(
      createResearch({
        raw_result_json: { activeMarket: createActiveMarket({ tacticalSellPrice: 42.5 }) },
      })
    );

    expect(result?.active_market?.tactical_sell_price).toBe(42.5);
  });

  it.each([
    { label: 'tacticalSellPrice', key: 'tacticalSellPrice' },
    { label: 'exactAcceptedCount', key: 'exactAcceptedCount' },
    { label: 'distributions', key: 'distributions' },
    { label: 'skipReason', key: 'skipReason' },
    { label: 'unavailableReason', key: 'unavailableReason' },
    { label: 'incompleteReason', key: 'incompleteReason' },
    { label: 'anchor', key: 'anchor' },
    { label: 'multipliers', key: 'multipliers' },
    { label: 'itemPriceWindow', key: 'itemPriceWindow' },
    { label: 'shippingContext', key: 'shippingContext' },
  ])('omits active_market when required nullable key "$label" is missing', ({ key }) => {
    const snapshot = createActiveMarket();
    delete snapshot[key];

    const result = serializeLatestPricingResearch(
      createResearch({ raw_result_json: { activeMarket: snapshot } })
    );

    expect(result?.active_market).toBeUndefined();
  });

  it('serializes explicit null nested fields in an unavailable snapshot', () => {
    const result = serializeLatestPricingResearch(
      createResearch({
        raw_result_json: {
          activeMarket: createActiveMarket({
            status: 'unavailable',
            unavailableReason: 'missing_anchor',
            complete: false,
            exactAcceptedCount: null,
            distributions: null,
            anchor: null,
            multipliers: null,
            itemPriceWindow: null,
            shippingContext: null,
          }),
        },
      })
    );

    expect(result?.active_market?.status).toBe('unavailable');
    expect(result?.active_market?.anchor).toBeNull();
    expect(result?.active_market?.multipliers).toBeNull();
    expect(result?.active_market?.item_price_window).toBeNull();
    expect(result?.active_market?.shipping_context).toBeNull();
    expect(result?.active_market?.exact_accepted_count).toBeNull();
    expect(result?.active_market?.distributions).toBeNull();
    expect(result?.active_market?.tactical_sell_price).toBeNull();
  });

  it('serializes a skipped snapshot with its skip reason', () => {
    const result = serializeLatestPricingResearch(
      createResearch({
        raw_result_json: {
          activeMarket: createActiveMarket({
            status: 'skipped',
            skipReason: 'browse_disabled',
            complete: false,
            exactAcceptedCount: null,
            distributions: null,
          }),
        },
      })
    );

    expect(result?.active_market?.status).toBe('skipped');
    expect(result?.active_market?.skip_reason).toBe('browse_disabled');
    expect(result?.active_market?.unavailable_reason).toBeNull();
    expect(result?.active_market?.exact_accepted_count).toBeNull();
    expect(result?.active_market?.distributions).toBeNull();
  });

  it('serializes an unavailable snapshot with its unavailable reason', () => {
    const result = serializeLatestPricingResearch(
      createResearch({
        raw_result_json: {
          activeMarket: createActiveMarket({
            status: 'unavailable',
            unavailableReason: 'missing_anchor',
            complete: false,
            exactAcceptedCount: null,
            distributions: null,
          }),
        },
      })
    );

    expect(result?.active_market?.status).toBe('unavailable');
    expect(result?.active_market?.unavailable_reason).toBe('missing_anchor');
    expect(result?.active_market?.exact_accepted_count).toBeNull();
    expect(result?.active_market?.distributions).toBeNull();
  });

  it('preserves competitor order', () => {
    const result = serializeLatestPricingResearch(
      createResearch({
        raw_result_json: {
          activeMarket: createActiveMarket({
            competitors: [
              createCompetitor({ legacyItemId: 'first' }),
              createCompetitor({ legacyItemId: 'second' }),
              createCompetitor({ legacyItemId: 'third' }),
            ],
          }),
        },
      })
    );

    expect(
      result?.active_market?.competitors.map((competitor) => competitor.legacy_item_id)
    ).toEqual(['first', 'second', 'third']);
  });

  it('preserves nullable shipping and total without inference', () => {
    const result = serializeLatestPricingResearch(
      createResearch({
        raw_result_json: {
          activeMarket: createActiveMarket({
            competitors: [
              createCompetitor({ shippingCost: null, shippingType: null, totalPrice: null }),
            ],
          }),
        },
      })
    );

    expect(result?.active_market?.competitors[0]?.shipping_cost).toBeNull();
    expect(result?.active_market?.competitors[0]?.shipping_type).toBeNull();
    expect(result?.active_market?.competitors[0]?.total_price).toBeNull();
    expect(result?.active_market?.competitors[0]?.item_price).toEqual({
      value: 100,
      currency: 'USD',
    });
  });

  it('maps capturedAt to captured_at', () => {
    const result = serializeLatestPricingResearch(
      createResearch({
        raw_result_json: {
          activeMarket: createActiveMarket({ capturedAt: '2026-08-15T21:17:25.000Z' }),
        },
      })
    );

    expect(result?.active_market?.captured_at).toBe('2026-08-15T21:17:25.000Z');
  });

  it('keeps tactical_sell_price null', () => {
    const result = serializeLatestPricingResearch(
      createResearch({ raw_result_json: { activeMarket: createActiveMarket() } })
    );

    expect(result?.active_market?.tactical_sell_price).toBeNull();
  });

  it('never serializes seller, auth, acceptedItems, or raw payload keys', () => {
    const result = serializeLatestPricingResearch(
      createResearch({
        raw_result_json: {
          activeMarket: createActiveMarket({
            sellerUsername: 'sneaky-seller',
            sellerUserId: 'secret-user-id',
            accessToken: 'sk_live_secret',
            acceptedItems: [{ legacyItemId: 'leaked' }],
            rawPayload: { ebay: 'leaked' },
            competitors: [
              createCompetitor({
                sellerUsername: 'sneaky-seller',
                sellerUserId: 'secret-user-id',
                accessToken: 'sk_live_secret',
                rawItem: { ebay: 'leaked' },
              }),
            ],
          }),
        },
      })
    );

    expect(result?.active_market).not.toHaveProperty('sellerUsername');
    expect(result?.active_market).not.toHaveProperty('sellerUserId');
    expect(result?.active_market).not.toHaveProperty('accessToken');
    expect(result?.active_market).not.toHaveProperty('acceptedItems');
    expect(result?.active_market).not.toHaveProperty('rawPayload');
    expect(result?.active_market?.competitors[0]).not.toHaveProperty('sellerUsername');
    expect(result?.active_market?.competitors[0]).not.toHaveProperty('sellerUserId');
    expect(result?.active_market?.competitors[0]).not.toHaveProperty('accessToken');
    expect(result?.active_market?.competitors[0]).not.toHaveProperty('rawItem');
  });

  it('leaves existing summary fields unchanged when active_market is present', () => {
    const base = createResearch({
      status: 'succeeded',
      suggested_price: 24,
      comps: [{ id: 'comp-1' }],
    });
    const withActive = createResearch({
      status: 'succeeded',
      suggested_price: 24,
      comps: [{ id: 'comp-1' }],
      raw_result_json: { activeMarket: createActiveMarket() },
    });

    const baseResult = serializeLatestPricingResearch(base);
    const withActiveResult = serializeLatestPricingResearch(withActive);
    const { active_market: _activeMarket, ...withoutActiveMarket } = withActiveResult ?? {};

    expect(withoutActiveMarket).toEqual(baseResult);
  });
});
