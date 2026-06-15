import {
  FIXTURE_LLM_PRICING_ANALYST_MODEL_NAME,
  FixtureLlmPricingAnalystError,
  LlmPricingReasoningValidationError,
  createFixtureLlmPricingAnalyst,
  type ConditionAdjustmentSummary,
  type NormalizedSoldComp,
  type PricingAnalystInput,
  type PricingStatsResult,
} from '@/pricing/index.js';

describe('createFixtureLlmPricingAnalyst', () => {
  it('returns validated exact-target reasoning with fixed model name', async () => {
    const analyst = createFixtureLlmPricingAnalyst();
    const result = await analyst.analyze(buildInput());

    expect(result.modelName).toBe(FIXTURE_LLM_PRICING_ANALYST_MODEL_NAME);
    expect(result.reasoning).toEqual({
      selectedCompIds: ['comp-1', 'comp-2', 'comp-3'],
      rejectedCompIds: [],
      conditionAdjustedPrice: 14.44,
      conditionAdjustmentPercent: -0.0456,
      conditionAdjustmentReason: 'Deterministic condition target accepted.',
      confidence: 'medium',
      priceExplanation: 'Deterministic median and condition evidence support exact target.',
    });
    expect(JSON.parse(JSON.stringify(result.prompt))).toEqual(result.prompt);
    expect(JSON.parse(JSON.stringify(result.rawOutput))).toEqual(result.rawOutput);
  });

  it('captures prompt payload including condition summary', async () => {
    const analyst = createFixtureLlmPricingAnalyst();
    const result = await analyst.analyze(buildInput());
    const payload = extractPayload(result.prompt.userPrompt);

    expect(payload.conditionAdjustment).toMatchObject({
      listingConditionSignal: {
        label: 'Very Good',
        score: 3,
      },
      allowedAdjustment: {
        eligible: true,
        targetPrice: 14.44,
      },
    });
  });

  it('keeps selected and rejected ids within provided comps only', async () => {
    const analyst = createFixtureLlmPricingAnalyst();
    const input = buildInput({
      comps: [
        buildComp({ id: 'comp-a', totalPrice: { value: 11, currency: 'USD' } }),
        buildComp({ id: 'comp-b', totalPrice: { value: 25, currency: 'USD' } }),
      ],
    });
    const result = await analyst.analyze(input);
    const allIds = input.comps.map((comp) => comp.id);

    expect(result.reasoning.selectedCompIds.every((compId) => allIds.includes(compId))).toBe(true);
    expect(result.reasoning.rejectedCompIds.every((compId) => allIds.includes(compId))).toBe(true);
    expect(result.reasoning.selectedCompIds).toEqual(['comp-a', 'comp-b']);
    expect(result.reasoning.rejectedCompIds).toEqual([]);
  });

  it('returns null conditionAdjustedPrice when deterministic adjustment not eligible', async () => {
    const analyst = createFixtureLlmPricingAnalyst();

    await expect(
      analyst.analyze(
        buildInput({
          conditionAdjustment: buildConditionAdjustment({
            allowedAdjustment: {
              eligible: false,
              targetPrice: null,
              minPrice: null,
              maxPrice: null,
              rawPercent: null,
              appliedPercent: null,
              reason: 'listing_condition_unknown',
            },
            listingConditionSignal: null,
            listingConditionScore: null,
          }),
        }),
      ),
    ).resolves.toMatchObject({
      reasoning: {
        conditionAdjustedPrice: null,
        conditionAdjustmentPercent: null,
        priceExplanation: 'Deterministic median remains final because condition adjustment was not applied.',
      },
    });
  });

  it('fails validation for invalid_json mode', async () => {
    const analyst = createFixtureLlmPricingAnalyst({ mode: 'invalid_json' });

    await expect(analyst.analyze(buildInput())).rejects.toThrow(LlmPricingReasoningValidationError);
  });

  it('fails validation for custom invalid raw output', async () => {
    const analyst = createFixtureLlmPricingAnalyst({
      mode: 'custom',
      rawOutput: {
        selectedCompIds: ['comp-1'],
        rejectedCompIds: ['comp-2'],
        conditionAdjustedPrice: 9.99,
        conditionAdjustmentPercent: -0.3,
        conditionAdjustmentReason: 'Below deterministic target.',
        confidence: 'medium',
        priceExplanation: 'Below deterministic target.',
      },
    });

    await expect(analyst.analyze(buildInput())).rejects.toThrow(/deterministic condition-adjusted target/);
  });

  it('throws clear analyst error in throws mode', async () => {
    const analyst = createFixtureLlmPricingAnalyst({ mode: 'throws' });

    await expect(analyst.analyze(buildInput())).rejects.toThrow(FixtureLlmPricingAnalystError);
    await expect(analyst.analyze(buildInput())).rejects.toThrow(/configured to throw/);
  });

  it('omits compNotes by default and validates custom compNotes', async () => {
    const analyst = createFixtureLlmPricingAnalyst();
    const defaultResult = await analyst.analyze(buildInput());

    expect(defaultResult.reasoning.compNotes).toBeUndefined();

    const customAnalyst = createFixtureLlmPricingAnalyst({
      mode: 'custom',
      rawOutput: {
        selectedCompIds: ['comp-1'],
        rejectedCompIds: ['comp-2', 'comp-3'],
        conditionAdjustedPrice: 14.44,
        conditionAdjustmentPercent: -0.0456,
        conditionAdjustmentReason: 'Exact target accepted.',
        confidence: 'medium',
        priceExplanation: 'Deterministic target accepted.',
        compNotes: [{ compId: 'comp-1', note: 'Matches deterministic target.' }],
      },
    });
    const customResult = await customAnalyst.analyze(buildInput());

    expect(customResult.reasoning.compNotes).toEqual([
      { compId: 'comp-1', note: 'Matches deterministic target.' },
    ]);
  });

  it('returns deterministic repeated results for identical input', async () => {
    const analyst = createFixtureLlmPricingAnalyst();
    const input = buildInput();

    await expect(analyst.analyze(input)).resolves.toEqual(await analyst.analyze(input));
  });
});

function extractPayload(userPrompt: string): Record<string, unknown> {
  const marker = 'Pricing payload:\n';
  const index = userPrompt.indexOf(marker);

  if (index < 0) {
    throw new Error('Prompt payload marker missing.');
  }

  return JSON.parse(userPrompt.slice(index + marker.length));
}

function buildInput(overrides: Partial<PricingAnalystInput> = {}): PricingAnalystInput {
  return {
    listing: {
      title: '2023 Panini Prizm Victor Wembanyama #136 Rookie',
      condition: 'Very Good',
      facts: {
        Player: 'Victor Wembanyama',
        Year: '2023',
        Manufacturer: 'Panini',
        Set: 'Prizm',
        'Card Number': '136',
      },
    },
    stats: buildStats(),
    conditionAdjustment: buildConditionAdjustment(),
    comps: [
      buildComp({
        id: 'comp-1',
        title: 'Comp One VG',
        totalPrice: { value: 10, currency: 'USD' },
        soldDate: '2026-05-28T00:00:00.000Z',
        condition: 'Ungraded',
      }),
      buildComp({
        id: 'comp-2',
        title: 'Comp Two EX',
        totalPrice: { value: 15.13, currency: 'USD' },
        soldDate: '2026-05-27T00:00:00.000Z',
        condition: 'Near Mint',
      }),
      buildComp({
        id: 'comp-3',
        title: 'Comp Three VG-EX',
        totalPrice: { value: 20, currency: 'USD' },
        soldDate: '2026-05-26T00:00:00.000Z',
        condition: null,
      }),
    ],
    ...overrides,
  };
}

function buildStats(overrides: Partial<PricingStatsResult> = {}): PricingStatsResult {
  return {
    soldCount: 3,
    medianSoldPrice: 15.13,
    lowSoldPrice: 10,
    highSoldPrice: 20,
    deterministicSuggestedPrice: 15.13,
    currency: 'USD',
    ignored: [],
    ...overrides,
  };
}

function buildConditionAdjustment(
  overrides: Partial<ConditionAdjustmentSummary> = {},
): ConditionAdjustmentSummary {
  return {
    listingConditionSignal: {
      label: 'Very Good',
      matchedText: 'VERY_GOOD',
      score: 3,
      source: 'listing_condition',
    },
    compConditionSignals: [],
    explicitCompConditionCount: 3,
    compMedianConditionScore: 3.5,
    listingConditionScore: 3,
    conditionDelta: -0.5,
    deterministicMedianPrice: 15.13,
    allowedAdjustment: {
      eligible: true,
      targetPrice: 14.44,
      minPrice: 14.44,
      maxPrice: 14.44,
      rawPercent: -0.0438,
      appliedPercent: -0.0456,
      reason: 'eligible',
    },
    ...overrides,
  };
}

function buildComp(overrides: Partial<NormalizedSoldComp> = {}): NormalizedSoldComp {
  return {
    id: 'comp-1',
    title: 'Sample Title',
    price: { value: 19.99, currency: 'USD' },
    shippingPrice: { value: 3.5, currency: 'USD' },
    totalPrice: { value: 23.49, currency: 'USD' },
    soldDate: '2026-01-15T12:34:56.000Z',
    condition: 'Near Mint',
    listingUrl: 'https://example.com/item/123',
    source: 'provider',
    ...overrides,
  };
}
