import type { ListingPriceResearchRow, ListingRow } from '@ebay-inventory/data';
import { describe, expect, it, vi } from 'vitest';

import {
  retryPricingAnalysis,
  RetryPricingAnalysisError,
  type RetryPricingAnalysisDependencies,
} from '@/jobs/retry-pricing-analysis.js';
import type { PricingAnalyst, PricingAnalystResult } from '@/pricing/index.js';
import { ProductionPricingAnalystError } from '@/pricing/index.js';

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
    price: 23.0,
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

function createComps() {
  return [
    {
      condition: null,
      id: 'comp-1',
      listingUrl: null,
      price: { currency: 'USD', value: 20 },
      shippingPrice: null,
      soldDate: '2026-06-01T10:00:00.000Z',
      source: 'provider' as const,
      title: '2023 Panini Prizm Victor Wembanyama #136',
      totalPrice: { currency: 'USD', value: 20 },
    },
    {
      condition: null,
      id: 'comp-2',
      listingUrl: null,
      price: { currency: 'USD', value: 22 },
      shippingPrice: null,
      soldDate: '2026-05-31T10:00:00.000Z',
      source: 'provider' as const,
      title: '2023 Panini Prizm Victor Wembanyama',
      totalPrice: { currency: 'USD', value: 22 },
    },
    {
      condition: null,
      id: 'comp-3',
      listingUrl: null,
      price: { currency: 'USD', value: 24 },
      shippingPrice: null,
      soldDate: '2026-05-30T10:00:00.000Z',
      source: 'provider' as const,
      title: 'Panini Prizm Victor Wembanyama #136',
      totalPrice: { currency: 'USD', value: 24 },
    },
  ];
}

function createCompsWithConditions() {
  return [
    {
      condition: null,
      id: 'comp-c1',
      listingUrl: null,
      price: { currency: 'USD', value: 20 },
      shippingPrice: null,
      soldDate: '2026-06-01T10:00:00.000Z',
      source: 'provider' as const,
      title: '2023 Panini Prizm Victor Wembanyama #136 Near Mint',
      totalPrice: { currency: 'USD', value: 20 },
    },
    {
      condition: null,
      id: 'comp-c2',
      listingUrl: null,
      price: { currency: 'USD', value: 22 },
      shippingPrice: null,
      soldDate: '2026-05-31T10:00:00.000Z',
      source: 'provider' as const,
      title: '2023 Panini Prizm Victor Wembanyama EX',
      totalPrice: { currency: 'USD', value: 22 },
    },
    {
      condition: null,
      id: 'comp-c3',
      listingUrl: null,
      price: { currency: 'USD', value: 24 },
      shippingPrice: null,
      soldDate: '2026-05-30T10:00:00.000Z',
      source: 'provider' as const,
      title: 'Panini Prizm Victor Wembanyama #136 VG-EX',
      totalPrice: { currency: 'USD', value: 24 },
    },
  ];
}

function createRetryableWarningLlmReasoningJson(overrides: Record<string, unknown> = {}) {
  return {
    fallback: 'llm_analysis_failed',
    modelName: 'gemma-4-31b-it',
    status: 'succeeded',
    warnings: [
      {
        analyst: 'google_pricing_reasoning',
        code: 'llm_analysis_failed',
        failure: {
          errorCode: 'MODEL_OVERLOADED',
          errorStatus: 'UNAVAILABLE',
          provider: 'google',
          retryable: true,
          statusCode: 503,
        },
        modelName: 'gemma-4-31b-it',
        reason: 'llm_analysis_failed',
        retryable: true,
        severity: 'warning',
        summary: 'LLM pricing analysis failed. Deterministic price used.',
      },
    ],
    ...overrides,
  };
}

function createResearchRow(
  overrides: Partial<ListingPriceResearchRow> = {}
): ListingPriceResearchRow {
  return {
    comps: createComps(),
    confidence: 'medium',
    created_at: '2026-06-11T12:05:00.000Z',
    error_code: null,
    error_message: null,
    id: 'listing-price-research-id',
    listing_id: 'Single-000123',
    llm_price_explanation: null,
    llm_reasoning_json: createRetryableWarningLlmReasoningJson(),
    llm_rejected_comp_ids: [],
    median_sold_price: 22,
    pricing_model_name: 'gemma-4-31b-it',
    provider: 'apify',
    query: '2023 Panini Prizm Victor Wembanyama Rookie Card 136',
    raw_result_json: {},
    sold_count: 3,
    status: 'succeeded',
    suggested_price: 22,
    updated_at: '2026-06-11T12:05:00.000Z',
    ...overrides,
  };
}

function createSuccessfulPricingAnalyst(): PricingAnalyst {
  return {
    analyze: vi.fn().mockResolvedValue({
      modelName: 'gemma-4-31b-it',
      prompt: {
        systemInstruction: 'test',
        userPrompt: 'test',
      },
      rawOutput: {},
      reasoning: {
        ambiguousConditionTerms: [],
        compNotes: [],
        conditionAdjustedPrice: 25,
        conditionAdjustmentPercent: 0.1363,
        conditionAdjustmentReason: 'Listing is near mint, comps average EX.',
        confidence: 'high' as const,
        priceExplanation: 'Adjusted for condition.',
        rejectedCompIds: [],
        reviewWarnings: [],
        selectedCompIds: ['comp-1', 'comp-2', 'comp-3'],
      },
    } satisfies PricingAnalystResult),
    name: 'google_pricing_reasoning',
  };
}

function createFailingPricingAnalyst(): PricingAnalyst {
  return {
    analyze: vi.fn().mockRejectedValue(
      new ProductionPricingAnalystError(
        'Pricing analyst execution failed for model "gemma-4-31b-it".',
        {
          failureDiagnostics: {
            causes: [
              {
                errorCode: 'MODEL_OVERLOADED',
                errorStatus: 'UNAVAILABLE',
                message: 'Model overloaded',
                reason: 'HIGH_DEMAND',
                statusCode: 503,
              },
            ],
            errorCode: 'MODEL_OVERLOADED',
            errorStatus: 'UNAVAILABLE',
            modelName: 'gemma-4-31b-it',
            provider: 'google',
            reason: 'HIGH_DEMAND',
            retryable: true,
            statusCode: 503,
          },
          modelName: 'gemma-4-31b-it',
          providerName: 'google',
        }
      )
    ),
    name: 'google_pricing_reasoning',
  };
}

function createDependencies(
  overrides: Partial<{
    getByListingId: ReturnType<typeof vi.fn>;
    getLatestByListingId: ReturnType<typeof vi.fn>;
    markSucceeded: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    pricingAnalyst: PricingAnalyst;
  }> = {}
): {
  dependencies: RetryPricingAnalysisDependencies;
  spies: Record<string, ReturnType<typeof vi.fn>>;
} {
  const markSucceeded = overrides.markSucceeded ?? vi.fn().mockResolvedValue(createResearchRow());
  const update =
    overrides.update ??
    vi
      .fn()
      .mockImplementation(async (_listingId: string, changes: { price?: number }) =>
        createListing({ price: changes.price ?? 23.0 })
      );
  const getByListingId = overrides.getByListingId ?? vi.fn().mockResolvedValue(createListing());
  const getLatestByListingId =
    overrides.getLatestByListingId ?? vi.fn().mockResolvedValue(createResearchRow());

  return {
    dependencies: {
      dataAccess: {
        listingPriceResearch: {
          getLatestByListingId,
          markSucceeded,
        },
        listings: {
          getByListingId,
          update,
        },
      } as never,
      pricingAnalyst: overrides.pricingAnalyst ?? createSuccessfulPricingAnalyst(),
    },
    spies: {
      getByListingId,
      getLatestByListingId,
      markSucceeded,
      update,
    },
  };
}

describe('retryPricingAnalysis', () => {
  it('throws not_found when listing does not exist', async () => {
    const { dependencies } = createDependencies({
      getByListingId: vi.fn().mockResolvedValue(null),
    });

    await expect(retryPricingAnalysis('Single-404', dependencies)).rejects.toThrow(
      RetryPricingAnalysisError
    );

    await expect(retryPricingAnalysis('Single-404', dependencies)).rejects.toMatchObject({
      code: 'not_found',
      message: 'Listing "Single-404" was not found.',
    });
  });

  it('throws no_research when listing has no pricing research', async () => {
    const { dependencies } = createDependencies({
      getLatestByListingId: vi.fn().mockResolvedValue(null),
    });

    await expect(retryPricingAnalysis('Single-000123', dependencies)).rejects.toMatchObject({
      code: 'no_research',
      message: 'Listing "Single-000123" has no pricing research to retry.',
    });
  });

  it('throws research_not_succeeded when latest research is not succeeded', async () => {
    const { dependencies } = createDependencies({
      getLatestByListingId: vi.fn().mockResolvedValue(createResearchRow({ status: 'failed' })),
    });

    await expect(retryPricingAnalysis('Single-000123', dependencies)).rejects.toMatchObject({
      code: 'research_not_succeeded',
    });
  });

  it('throws no_retryable_warning when no retryable warnings exist', async () => {
    const { dependencies } = createDependencies({
      getLatestByListingId: vi.fn().mockResolvedValue(
        createResearchRow({
          llm_reasoning_json: {
            fallback: null,
            modelName: 'gemma-4-31b-it',
            status: 'succeeded',
            warnings: [],
          },
        })
      ),
    });

    await expect(retryPricingAnalysis('Single-000123', dependencies)).rejects.toMatchObject({
      code: 'no_retryable_warning',
    });
  });

  it('throws no_retryable_warning when warnings are not retryable', async () => {
    const { dependencies } = createDependencies({
      getLatestByListingId: vi.fn().mockResolvedValue(
        createResearchRow({
          llm_reasoning_json: {
            warnings: [
              {
                analyst: 'google_pricing_reasoning',
                code: 'llm_analysis_failed',
                reason: 'llm_analysis_failed',
                retryable: false,
                severity: 'warning',
                summary: 'LLM pricing analysis failed.',
              },
            ],
          },
        })
      ),
    });

    await expect(retryPricingAnalysis('Single-000123', dependencies)).rejects.toMatchObject({
      code: 'no_retryable_warning',
    });
  });

  it('throws no_comps when research has no persisted comps', async () => {
    const { dependencies } = createDependencies({
      getLatestByListingId: vi.fn().mockResolvedValue(createResearchRow({ comps: [] })),
    });

    await expect(retryPricingAnalysis('Single-000123', dependencies)).rejects.toMatchObject({
      code: 'no_comps',
    });
  });

  it('throws no_analyst when no pricing analyst is available', async () => {
    const markSucceeded = vi.fn().mockResolvedValue(createResearchRow());
    const update = vi
      .fn()
      .mockImplementation(async (_listingId: string, changes: { price?: number }) =>
        createListing({ price: changes.price ?? 23.0 })
      );
    const getByListingId = vi.fn().mockResolvedValue(createListing());
    const getLatestByListingId = vi.fn().mockResolvedValue(createResearchRow());

    const dependencies: RetryPricingAnalysisDependencies = {
      dataAccess: {
        listingPriceResearch: {
          getLatestByListingId,
          markSucceeded,
        },
        listings: {
          getByListingId,
          update,
        },
      } as never,
      pricingAnalyst: undefined,
    };

    await expect(retryPricingAnalysis('Single-000123', dependencies)).rejects.toMatchObject({
      code: 'no_analyst',
    });
  });

  it('succeeds and updates listing price on valid LLM condition-adjusted price', async () => {
    // Use comps with equal prices and matching listing condition so
    // delta=0 → targetPrice = deterministicMedianPrice = 22.
    const uniformComps = [
      {
        condition: null,
        id: 'comp-u1',
        listingUrl: null,
        price: { currency: 'USD', value: 22 },
        shippingPrice: null,
        soldDate: '2026-06-01T10:00:00.000Z',
        source: 'provider' as const,
        title: '2023 Panini Prizm Victor Wembanyama #136 EX',
        totalPrice: { currency: 'USD', value: 22 },
      },
      {
        condition: null,
        id: 'comp-u2',
        listingUrl: null,
        price: { currency: 'USD', value: 22 },
        shippingPrice: null,
        soldDate: '2026-05-31T10:00:00.000Z',
        source: 'provider' as const,
        title: '2023 Panini Prizm Victor Wembanyama EX',
        totalPrice: { currency: 'USD', value: 22 },
      },
      {
        condition: null,
        id: 'comp-u3',
        listingUrl: null,
        price: { currency: 'USD', value: 22 },
        shippingPrice: null,
        soldDate: '2026-05-30T10:00:00.000Z',
        source: 'provider' as const,
        title: 'Panini Prizm Victor Wembanyama #136 EX',
        totalPrice: { currency: 'USD', value: 22 },
      },
    ];

    const researchWithConditions = createResearchRow({
      comps: uniformComps,
      median_sold_price: 22,
      suggested_price: 22,
    });

    // Listing condition matches comps (EX=4 → median comp score=4 → delta=0).
    const listingWithCondition = createListing({
      item_specifics: {
        'Card Condition': 'EXCELLENT',
        'Card Number': '136',
        Manufacturer: 'Panini',
        Player: 'Victor Wembanyama',
        Set: 'Prizm',
        Year: '2023',
      },
    });

    // LLM returns exactly the deterministic median, which equals the target
    // when delta is 0.
    const inWindowAnalyst: PricingAnalyst = {
      analyze: vi.fn().mockResolvedValue({
        modelName: 'gemma-4-31b-it',
        prompt: { systemInstruction: 'test', userPrompt: 'test' },
        rawOutput: {},
        reasoning: {
          ambiguousConditionTerms: [],
          compNotes: [],
          conditionAdjustedPrice: 22,
          conditionAdjustmentPercent: 0,
          conditionAdjustmentReason: 'Same condition.',
          confidence: 'high' as const,
          priceExplanation: 'No adjustment needed.',
          rejectedCompIds: [],
          reviewWarnings: [],
          selectedCompIds: ['comp-u1', 'comp-u2', 'comp-u3'],
        },
      } satisfies PricingAnalystResult),
      name: 'google_pricing_reasoning',
    };

    const markSucceeded = vi.fn().mockResolvedValue(researchWithConditions);
    const update = vi
      .fn()
      .mockImplementation(async (_listingId: string, changes: { price?: number }) =>
        createListing({ price: changes.price ?? 23.0 })
      );
    const getByListingId = vi.fn().mockResolvedValue(listingWithCondition);
    const getLatestByListingId = vi.fn().mockResolvedValue(researchWithConditions);

    const dependencies: RetryPricingAnalysisDependencies = {
      dataAccess: {
        listingPriceResearch: { getLatestByListingId, markSucceeded },
        listings: { getByListingId, update },
      } as never,
      pricingAnalyst: inWindowAnalyst,
    };
    const spies = { markSucceeded, update };

    const result = await retryPricingAnalysis('Single-000123', dependencies);

    expect(result.warningResolved).toBe(true);
    expect(result.researchUpdated).toBe(true);
    expect(spies.markSucceeded).toHaveBeenCalledTimes(1);

    const markSucceededInput = spies.markSucceeded.mock.calls[0]?.[0];
    expect(markSucceededInput.suggested_price).toBe(22);
    expect(markSucceededInput.llm_reasoning_json).toMatchObject({
      status: 'succeeded',
      fallback: null,
    });

    expect(spies.update).toHaveBeenCalledWith('Single-000123', {
      price: 22,
    });
    expect(result.listing.price).toBe(22);
  });

  it('preserves existing listing price when LLM returns null condition-adjusted price', async () => {
    const nullPriceAnalyst: PricingAnalyst = {
      analyze: vi.fn().mockResolvedValue({
        modelName: 'gemma-4-31b-it',
        prompt: { systemInstruction: 'test', userPrompt: 'test' },
        rawOutput: {},
        reasoning: {
          ambiguousConditionTerms: [],
          compNotes: [],
          conditionAdjustedPrice: null,
          conditionAdjustmentPercent: null,
          conditionAdjustmentReason: null,
          confidence: 'low' as const,
          priceExplanation: 'Unable to adjust.',
          rejectedCompIds: [],
          reviewWarnings: [],
          selectedCompIds: ['comp-1', 'comp-2'],
        },
      } satisfies PricingAnalystResult),
      name: 'google_pricing_reasoning',
    };

    const { dependencies, spies } = createDependencies({
      pricingAnalyst: nullPriceAnalyst,
    });

    // With comps lacking condition signals, condition adjustment may
    // not be eligible. The fallback reason will reflect the actual
    // adjustment eligibility. We verify the price is preserved.
    const result = await retryPricingAnalysis('Single-000123', dependencies);

    expect(result.warningResolved).toBe(false);
    expect(result.researchUpdated).toBe(true);

    const markSucceededInput = spies.markSucceeded.mock.calls[0]?.[0];
    // When condition adjustment is not allowed, the fallback is
    // condition_adjustment_not_allowed; when eligible but LLM returns
    // null, it's llm_condition_adjusted_price_null.
    expect(markSucceededInput.llm_reasoning_json).toMatchObject({
      status: 'succeeded',
    });
    // Verify it's one of the two expected fallback reasons
    const fallback = (markSucceededInput.llm_reasoning_json as Record<string, unknown>).fallback;
    expect(
      fallback === 'llm_condition_adjusted_price_null' ||
        fallback === 'condition_adjustment_not_allowed'
    ).toBe(true);

    // Listing price should NOT be updated
    expect(spies.update).not.toHaveBeenCalled();
    expect(result.listing.price).toBe(23.0);
  });

  it('preserves existing listing price and persists warning on model/provider failure', async () => {
    const { dependencies, spies } = createDependencies({
      pricingAnalyst: createFailingPricingAnalyst(),
    });

    const result = await retryPricingAnalysis('Single-000123', dependencies);

    expect(result.warningResolved).toBe(false);
    expect(result.researchUpdated).toBe(true);

    const markSucceededInput = spies.markSucceeded.mock.calls[0]?.[0];
    expect(markSucceededInput.llm_reasoning_json).toMatchObject({
      status: 'failed',
      fallback: 'llm_analysis_failed',
      warnings: expect.arrayContaining([
        expect.objectContaining({
          code: 'llm_analysis_failed',
          retryable: true,
          severity: 'warning',
        }),
      ]),
    });

    // Listing price should NOT be updated
    expect(spies.update).not.toHaveBeenCalled();
    expect(result.listing.price).toBe(23.0);
  });

  it('does not write last_error_* fields on listing', async () => {
    const { dependencies } = createDependencies();

    const result = await retryPricingAnalysis('Single-000123', dependencies);

    expect(result.listing.last_error_at).toBeNull();
    expect(result.listing.last_error_code).toBeNull();
    expect(result.listing.last_error_message).toBeNull();
  });

  it('re-runs only LLM step without calling sold comps provider', async () => {
    const analyst = createSuccessfulPricingAnalyst();
    const { dependencies } = createDependencies({ pricingAnalyst: analyst });

    await retryPricingAnalysis('Single-000123', dependencies);

    // The analyst should be called with rebuilt input from persisted comps
    expect(analyst.analyze).toHaveBeenCalledTimes(1);
    const analyzeInput = (analyst.analyze as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(analyzeInput.comps).toHaveLength(3);
    expect(analyzeInput.comps[0].id).toBe('comp-1');
    expect(analyzeInput.stats.soldCount).toBe(3);
  });

  it('preserves existing price when LLM returns price outside allowed window', async () => {
    const outOfWindowAnalyst: PricingAnalyst = {
      analyze: vi.fn().mockResolvedValue({
        modelName: 'gemma-4-31b-it',
        prompt: { systemInstruction: 'test', userPrompt: 'test' },
        rawOutput: {},
        reasoning: {
          ambiguousConditionTerms: [],
          compNotes: [],
          conditionAdjustedPrice: 999, // Way outside the window
          conditionAdjustmentPercent: 40,
          conditionAdjustmentReason: 'Rare gem mint.',
          confidence: 'low' as const,
          priceExplanation: 'Gem mint premium.',
          rejectedCompIds: [],
          reviewWarnings: [],
          selectedCompIds: ['comp-c1'],
        },
      } satisfies PricingAnalystResult),
      name: 'google_pricing_reasoning',
    };

    // Use comps with condition terms and listing with condition token
    // so allowedAdjustment is eligible and the window check activates.
    const researchWithConditions = createResearchRow({
      comps: createCompsWithConditions(),
    });
    const listingWithCondition = createListing({
      item_specifics: {
        'Card Condition': 'NEAR_MINT_OR_BETTER',
        'Card Number': '136',
        Manufacturer: 'Panini',
        Player: 'Victor Wembanyama',
        Set: 'Prizm',
        Year: '2023',
      },
    });
    const markSucceeded = vi.fn().mockResolvedValue(researchWithConditions);
    const update = vi
      .fn()
      .mockImplementation(async (_listingId: string, changes: { price?: number }) =>
        createListing({ price: changes.price ?? 23.0 })
      );
    const getByListingId = vi.fn().mockResolvedValue(listingWithCondition);
    const getLatestByListingId = vi.fn().mockResolvedValue(researchWithConditions);

    const dependencies: RetryPricingAnalysisDependencies = {
      dataAccess: {
        listingPriceResearch: { getLatestByListingId, markSucceeded },
        listings: { getByListingId, update },
      } as never,
      pricingAnalyst: outOfWindowAnalyst,
    };
    const spies = { markSucceeded, update };

    const result = await retryPricingAnalysis('Single-000123', dependencies);

    // Warning must NOT be resolved for out-of-window price
    expect(result.warningResolved).toBe(false);
    expect(result.researchUpdated).toBe(true);

    // Listing price must NOT be updated
    expect(spies.update).not.toHaveBeenCalled();
    expect(result.listing.price).toBe(23.0);

    // Persisted llm_reasoning_json must carry out-of-window warning
    const markSucceededInput = spies.markSucceeded.mock.calls[0]?.[0];
    expect(markSucceededInput.llm_reasoning_json).toMatchObject({
      status: 'succeeded',
      fallback: 'llm_condition_adjusted_price_out_of_window',
    });
    const reasoningJson = markSucceededInput.llm_reasoning_json as Record<string, unknown>;
    const warnings = reasoningJson.warnings as Array<Record<string, unknown>>;
    expect(warnings[0]).toMatchObject({
      code: 'llm_condition_adjusted_price_out_of_window',
      reason: 'llm_condition_adjusted_price_out_of_window',
      severity: 'warning',
      summary: 'LLM returned off-target condition-adjusted price. Deterministic price used.',
    });

    // Suggested price must remain previous/deterministic, not 999
    expect(markSucceededInput.suggested_price).not.toBe(999);
    expect(markSucceededInput.suggested_price).toBe(22);
  });

  it('preserves existing price when LLM returns invalid (negative) condition-adjusted price', async () => {
    // With no condition signals on comps, the adjustment is not eligible.
    // The fallback reflects that reality before checking price validity.
    const invalidPriceAnalyst: PricingAnalyst = {
      analyze: vi.fn().mockResolvedValue({
        modelName: 'gemma-4-31b-it',
        prompt: { systemInstruction: 'test', userPrompt: 'test' },
        rawOutput: {},
        reasoning: {
          ambiguousConditionTerms: [],
          compNotes: [],
          conditionAdjustedPrice: -5, // Invalid negative price
          conditionAdjustmentPercent: null,
          conditionAdjustmentReason: null,
          confidence: 'low' as const,
          priceExplanation: 'Error.',
          rejectedCompIds: [],
          reviewWarnings: [],
          selectedCompIds: [],
        },
      } satisfies PricingAnalystResult),
      name: 'google_pricing_reasoning',
    };

    const { dependencies, spies } = createDependencies({
      pricingAnalyst: invalidPriceAnalyst,
    });

    const result = await retryPricingAnalysis('Single-000123', dependencies);

    expect(result.warningResolved).toBe(false);
    expect(result.researchUpdated).toBe(true);

    // Listing price must NOT be updated
    expect(spies.update).not.toHaveBeenCalled();
    expect(result.listing.price).toBe(23.0);

    const markSucceededInput = spies.markSucceeded.mock.calls[0]?.[0];
    const reasoningJson = markSucceededInput.llm_reasoning_json as Record<string, unknown>;
    // negative normalizes to null; adjustment isn't eligible with no condition
    // signals → condition_adjustment_not_allowed
    expect(reasoningJson.fallback).toBe('condition_adjustment_not_allowed');

    // Suggested price remains previous
    expect(markSucceededInput.suggested_price).toBe(22);
  });
});
