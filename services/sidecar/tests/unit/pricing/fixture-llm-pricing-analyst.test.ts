import {
  FIXTURE_LLM_PRICING_ANALYST_MODEL_NAME,
  FixtureLlmPricingAnalystError,
  LlmPricingReasoningValidationError,
  createFixtureLlmPricingAnalyst,
  type NormalizedSoldComp,
  type PricingAnalystInput,
  type PricingStatsResult,
} from '@/pricing/index.js';

describe('createFixtureLlmPricingAnalyst', () => {
  it('returns valid validated reasoning with fixed model name and serializable prompt/raw output', async () => {
    const analyst = createFixtureLlmPricingAnalyst();
    const result = await analyst.analyze(buildInput());

    expect(result.modelName).toBe(FIXTURE_LLM_PRICING_ANALYST_MODEL_NAME);
    expect(result.reasoning).toEqual({
      selectedCompIds: ['comp-1', 'comp-2', 'comp-3'],
      rejectedCompIds: [],
      suggestedPrice: 15.13,
      confidence: 'medium',
      priceExplanation: 'Selected comps align with deterministic sold range.',
    });
    expect(JSON.parse(JSON.stringify(result.prompt))).toEqual(result.prompt);
    expect(JSON.parse(JSON.stringify(result.rawOutput))).toEqual(result.rawOutput);
  });

  it('captures compact prompt payload built from listing facts deterministic stats and normalized comps', async () => {
    const analyst = createFixtureLlmPricingAnalyst();
    const result = await analyst.analyze(buildInput());
    const payload = extractPayload(result.prompt.userPrompt);
    const serialized = JSON.stringify(payload);

    expect(payload).toEqual({
      listing: {
        title: '2023 Panini Prizm Victor Wembanyama #136 Rookie',
        condition: 'Ungraded',
        facts: {
          Player: 'Victor Wembanyama',
          Year: '2023',
          Manufacturer: 'Panini',
          Set: 'Prizm',
          'Card Number': '136',
        },
      },
      stats: {
        soldCount: 3,
        confidence: 'medium',
        low: 10,
        median: 15.13,
        high: 20,
        suggested: 15.13,
      },
      comps: [
        {
          id: 'comp-1',
          title: 'Comp One',
          price: 10,
          soldAt: '2026-05-28T00:00:00.000Z',
          condition: 'Ungraded',
        },
        {
          id: 'comp-2',
          title: 'Comp Two',
          price: 15.13,
          soldAt: '2026-05-27T00:00:00.000Z',
          condition: 'Near Mint',
        },
        {
          id: 'comp-3',
          title: 'Comp Three',
          price: 20,
          soldAt: '2026-05-26T00:00:00.000Z',
        },
      ],
    });
    expect(serialized).not.toContain('listingUrl');
    expect(serialized).not.toContain('source');
    expect(serialized).not.toContain('rawOutput');
    expect(serialized).not.toContain('provider');
    expect(serialized).not.toContain('imageUrl');
  });

  it('keeps selected and rejected ids within provided comps only', async () => {
    const analyst = createFixtureLlmPricingAnalyst();
    const input = buildInput({
      comps: [
        buildComp({ id: 'comp-a', totalPrice: { value: 11, currency: 'USD' } }),
        buildComp({ id: 'comp-b', totalPrice: { value: 25, currency: 'USD' } }),
        buildComp({ id: 'comp-c', totalPrice: { value: 0, currency: 'USD' } }),
      ],
      stats: {
        ...buildStats(),
        lowSoldPrice: 10,
        highSoldPrice: 20,
        deterministicSuggestedPrice: 15,
      },
    });
    const result = await analyst.analyze(input);
    const allIds = input.comps.map((comp) => comp.id);

    expect(result.reasoning.selectedCompIds.every((compId) => allIds.includes(compId))).toBe(true);
    expect(result.reasoning.rejectedCompIds.every((compId) => allIds.includes(compId))).toBe(true);
    expect(result.reasoning.selectedCompIds).toEqual(['comp-a']);
    expect(result.reasoning.rejectedCompIds).toEqual(['comp-b', 'comp-c']);
  });

  it('returns suggestedPrice null when deterministic stats do not support safe price', async () => {
    const analyst = createFixtureLlmPricingAnalyst();

    await expect(
      analyst.analyze(
        buildInput({
          stats: {
            ...buildStats(),
            lowSoldPrice: null,
            highSoldPrice: null,
            deterministicSuggestedPrice: 15.13,
          },
        }),
      ),
    ).resolves.toMatchObject({
      reasoning: {
        suggestedPrice: null,
        selectedCompIds: [],
        rejectedCompIds: ['comp-1', 'comp-2', 'comp-3'],
        priceExplanation: 'Deterministic comps do not support a safe price.',
      },
    });

    await expect(
      analyst.analyze(
        buildInput({
          stats: {
            ...buildStats(),
            lowSoldPrice: 10,
            highSoldPrice: 20,
            deterministicSuggestedPrice: 20.01,
          },
        }),
      ),
    ).resolves.toMatchObject({
      reasoning: {
        suggestedPrice: null,
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
        suggestedPrice: 9.99,
        confidence: 'medium',
        priceExplanation: 'Below deterministic range.',
      },
    });

    await expect(analyst.analyze(buildInput())).rejects.toThrow(/within deterministic sold price range/);
  });

  it('throws clear analyst error in throws mode', async () => {
    const analyst = createFixtureLlmPricingAnalyst({ mode: 'throws' });

    await expect(analyst.analyze(buildInput())).rejects.toThrow(FixtureLlmPricingAnalystError);
    await expect(analyst.analyze(buildInput())).rejects.toThrow(/configured to throw/);
  });

  it('does not require provider sdk env or api key', async () => {
    const analyst = createFixtureLlmPricingAnalyst();
    const result = await analyst.analyze(buildInput());

    expect(result.rawOutput).toBeDefined();
    expect(analyst.name).toBe('fixture');
  });

  it('omits compNotes by default and only allows validated custom compNotes', async () => {
    const analyst = createFixtureLlmPricingAnalyst();
    const defaultResult = await analyst.analyze(buildInput());

    expect(defaultResult.reasoning.compNotes).toBeUndefined();

    const customAnalyst = createFixtureLlmPricingAnalyst({
      mode: 'custom',
      rawOutput: {
        selectedCompIds: ['comp-1'],
        rejectedCompIds: ['comp-2', 'comp-3'],
        suggestedPrice: 15.13,
        confidence: 'medium',
        priceExplanation: 'Deterministic range supports selected comp.',
        compNotes: [{ compId: 'comp-1', note: 'Matches deterministic midpoint.' }],
      },
    });
    const customResult = await customAnalyst.analyze(buildInput());

    expect(customResult.reasoning.compNotes).toEqual([
      { compId: 'comp-1', note: 'Matches deterministic midpoint.' },
    ]);
  });

  it('keeps default output free of lot or single recommendation language', async () => {
    const analyst = createFixtureLlmPricingAnalyst();
    const result = await analyst.analyze(buildInput());
    const serialized = JSON.stringify(result.reasoning).toLowerCase();

    expect(serialized).not.toContain('sell as lot');
    expect(serialized).not.toContain('sell as single');
    expect(serialized).not.toContain('lot recommendation');
    expect(serialized).not.toContain('single recommendation');
  });

  it('returns deterministic repeated results for identical input', async () => {
    const analyst = createFixtureLlmPricingAnalyst();
    const input = buildInput();

    await expect(analyst.analyze(input)).resolves.toEqual(await analyst.analyze(input));
  });
});

function extractPayload(userPrompt: string): {
  listing: Record<string, unknown>;
  stats: Record<string, unknown>;
  comps: Array<Record<string, unknown>>;
} {
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
      condition: 'Ungraded',
      facts: {
        Player: 'Victor Wembanyama',
        Year: '2023',
        Manufacturer: 'Panini',
        Set: 'Prizm',
        'Card Number': '136',
      },
    },
    stats: buildStats(),
    comps: [
      buildComp({
        id: 'comp-1',
        title: 'Comp One',
        totalPrice: { value: 10, currency: 'USD' },
        soldDate: '2026-05-28T00:00:00.000Z',
        condition: 'Ungraded',
      }),
      buildComp({
        id: 'comp-2',
        title: 'Comp Two',
        totalPrice: { value: 15.13, currency: 'USD' },
        soldDate: '2026-05-27T00:00:00.000Z',
        condition: 'Near Mint',
      }),
      buildComp({
        id: 'comp-3',
        title: 'Comp Three',
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
