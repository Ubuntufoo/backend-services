import type { ResolvedAiModelRoute } from '@ebay-inventory/data';

import { describe, expect, it, vi } from 'vitest';

import {
  ProductionPricingAnalystError,
  createProductionPricingAnalyst,
  type ConditionAdjustmentSummary,
  type PricingAnalystInput,
  type PricingStatsResult,
} from '@/pricing/index.js';

describe('createProductionPricingAnalyst', () => {
  it('uses short prompt-local comp aliases and remaps model output to canonical ids', async () => {
    const executeModel = vi.fn(async ({ prompt }: { prompt: { userPrompt: string } }) => {
      const payload = extractPayload(prompt.userPrompt);

      expect(payload.comps).toEqual([
        expect.objectContaining({ id: 'c1', soldAt: '2026-05-28' }),
        expect.objectContaining({ id: 'c2', soldAt: '2026-05-27' }),
      ]);
      expect(payload.conditionAdjustment).toMatchObject({
        compConditionSignals: [
          expect.objectContaining({ compId: 'c1' }),
          expect.objectContaining({ compId: 'c2' }),
        ],
      });
      expect(JSON.stringify(payload)).not.toContain('canonical-comp-1');
      expect(JSON.stringify(payload)).not.toContain('canonical-comp-2');

      const response = {
        selectedCompIds: ['c1'],
        rejectedCompIds: ['c2'],
        conditionAdjustedPrice: 14.44,
        conditionAdjustmentPercent: -0.0456,
        conditionAdjustmentReason: 'Exact target accepted.',
        confidence: 'medium',
        priceExplanation: 'Alias output parsed correctly.',
      };

      return {
        rawOutput: response,
        text: JSON.stringify(response),
      };
    });
    const analyst = createProductionPricingAnalyst({
      dataAccess: {
        aiModelRoutes: {
          resolveForTask: vi.fn().mockResolvedValue([buildRoute()]),
        },
        dailyUsage: {
          incrementGeminiCallsUsed: vi.fn(),
        },
      } as never,
      executeModel,
      now: () => new Date('2026-06-19T15:00:00.000Z'),
    });

    const result = await analyst.analyze(
      buildInput({
        comps: [
          buildComp({ id: 'canonical-comp-1', soldDate: '2026-05-28T00:00:00.000Z' }),
          buildComp({ id: 'canonical-comp-2', soldDate: '2026-05-27T00:00:00.000Z' }),
        ],
        conditionAdjustment: buildConditionAdjustment({
          compConditionSignals: [
            {
              compId: 'canonical-comp-1',
              price: 10,
              signal: null,
              title: 'Comp One',
            },
            {
              compId: 'canonical-comp-2',
              price: 20,
              signal: null,
              title: 'Comp Two',
            },
          ],
        }),
      }),
    );

    expect(result.reasoning.selectedCompIds).toEqual(['canonical-comp-1']);
    expect(result.reasoning.rejectedCompIds).toEqual(['canonical-comp-2']);
    expect(executeModel).toHaveBeenCalledTimes(1);
  });

  it('captures safe nested diagnostics for retryable upstream execution failures', async () => {
    const analyst = createProductionPricingAnalyst({
      dataAccess: {
        aiModelRoutes: {
          resolveForTask: vi.fn().mockResolvedValue([buildRoute()]),
        },
        dailyUsage: {
          incrementGeminiCallsUsed: vi.fn(),
        },
      } as never,
      executeModel: vi.fn().mockRejectedValue(
        new Error('Gemini request failed. authorization=Bearer top-secret', {
          cause: new Error('Model overloaded due to high demand. apiKey=abc123', {
            cause: {
              code: 503,
              message: 'Upstream unavailable. authorization: Bearer nested-secret',
              reason: 'HIGH_DEMAND',
              status: 'UNAVAILABLE',
            },
          }),
        })
      ),
      now: () => new Date('2026-06-17T16:39:14.000Z'),
    });

    await expect(analyst.analyze(buildInput())).rejects.toMatchObject({
      failureDiagnostics: {
        errorStatus: 'UNAVAILABLE',
        modelName: 'gemma-4-31b-it',
        provider: 'google',
        reason: 'HIGH_DEMAND',
        retryable: true,
        statusCode: 503,
      },
      modelName: 'gemma-4-31b-it',
      providerName: 'google',
    });

    const error = await analyst.analyze(buildInput()).catch((caught) => caught);

    expect(error).toBeInstanceOf(ProductionPricingAnalystError);
    expect(JSON.stringify(error.failureDiagnostics)).not.toContain('top-secret');
    expect(JSON.stringify(error.failureDiagnostics)).not.toContain('nested-secret');
    expect(JSON.stringify(error.failureDiagnostics)).not.toContain('abc123');
  });
});

function buildRoute(overrides: Partial<ResolvedAiModelRoute> = {}): ResolvedAiModelRoute {
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

function buildInput(overrides: Partial<PricingAnalystInput> = {}): PricingAnalystInput {
  return {
    comps: [
      buildComp({ id: 'comp-1', soldDate: '2026-05-28T00:00:00.000Z' }),
      buildComp({ id: 'comp-2', soldDate: '2026-05-27T00:00:00.000Z' }),
    ],
    conditionAdjustment: buildConditionAdjustment(),
    listing: {
      condition: 'Very Good',
      facts: {
        'Card Number': '136',
        Manufacturer: 'Panini',
        Player: 'Victor Wembanyama',
        Set: 'Prizm',
        Year: '2023',
      },
      title: '2023 Panini Prizm Victor Wembanyama #136 Rookie',
    },
    promptOptions: {
      maxComps: 20,
    },
    stats: buildStats(),
    ...overrides,
  };
}

function buildComp(
  overrides: Partial<PricingAnalystInput['comps'][number]> = {},
): PricingAnalystInput['comps'][number] {
  return {
    condition: 'Ungraded',
    id: 'comp-1',
    listingUrl: null,
    price: {
      currency: 'USD',
      value: 10,
    },
    shippingPrice: null,
    soldDate: '2026-05-28T00:00:00.000Z',
    source: 'provider',
    title: 'Victor Wembanyama comp',
    totalPrice: {
      currency: 'USD',
      value: 10,
    },
    ...overrides,
  };
}

function buildStats(overrides: Partial<PricingStatsResult> = {}): PricingStatsResult {
  return {
    currency: 'USD',
    deterministicSuggestedPrice: 15.13,
    highSoldPrice: 20,
    ignored: [],
    lowSoldPrice: 10,
    medianSoldPrice: 15.13,
    soldCount: 3,
    ...overrides,
  };
}

function buildConditionAdjustment(
  overrides: Partial<ConditionAdjustmentSummary> = {}
): ConditionAdjustmentSummary {
  return {
    allowedAdjustment: {
      appliedPercent: -0.0456,
      eligible: true,
      maxPrice: 15.13,
      minPrice: 14.44,
      rawPercent: -0.0456,
      reason: 'eligible',
      targetPrice: 14.44,
    },
    compConditionSignals: [],
    compMedianConditionScore: 3.5,
    conditionDelta: -0.5,
    deterministicMedianPrice: 15.13,
    explicitCompConditionCount: 3,
    listingConditionScore: 3,
    listingConditionSignal: {
      label: 'Very Good',
      matchedText: 'VERY_GOOD',
      score: 3,
      source: 'listing_condition',
    },
    ...overrides,
  };
}

function extractPayload(userPrompt: string): Record<string, unknown> {
  const marker = 'Pricing payload:\n';
  const index = userPrompt.indexOf(marker);

  if (index < 0) {
    throw new Error('Prompt payload marker missing.');
  }

  return JSON.parse(userPrompt.slice(index + marker.length));
}
