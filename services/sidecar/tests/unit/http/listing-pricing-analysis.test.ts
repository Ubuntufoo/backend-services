import { describe, expect, it } from 'vitest';
import type { ListingPriceResearchRow } from '@ebay-inventory/data';
import { serializeLatestPricingResearch } from '@/http/listing-pricing-analysis.js';

function createResearch(
  overrides: Partial<ListingPriceResearchRow> = {}
): ListingPriceResearchRow {
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
