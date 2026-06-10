import {
  LlmPricingReasoningValidationError,
  parseLlmPricingReasoningOutput,
  type LlmPricingReasoningValidationContext,
} from '@/pricing/index.js';

describe('parseLlmPricingReasoningOutput', () => {
  const context: LlmPricingReasoningValidationContext = {
    validCompIds: ['comp-1', 'comp-2', 'comp-3'],
    stats: {
      lowSoldPrice: 10,
      highSoldPrice: 20,
    },
  };

  it('accepts valid output', () => {
    expect(
      parseLlmPricingReasoningOutput(
        {
          selectedCompIds: ['comp-1', 'comp-2'],
          rejectedCompIds: ['comp-3'],
          suggestedPrice: 15.129,
          confidence: 'medium',
          priceExplanation: 'Median sold comps support mid-range pricing.',
          compNotes: [{ compId: 'comp-1', note: 'Recent sale near median.' }],
        },
        context,
      ),
    ).toEqual({
      selectedCompIds: ['comp-1', 'comp-2'],
      rejectedCompIds: ['comp-3'],
      suggestedPrice: 15.129,
      confidence: 'medium',
      priceExplanation: 'Median sold comps support mid-range pricing.',
      compNotes: [{ compId: 'comp-1', note: 'Recent sale near median.' }],
    });
  });

  it('accepts suggestedPrice null', () => {
    expect(
      parseLlmPricingReasoningOutput(
        {
          selectedCompIds: ['comp-1'],
          rejectedCompIds: ['comp-2', 'comp-3'],
          suggestedPrice: null,
          confidence: 'low',
          priceExplanation: 'Deterministic stats should drive price.',
        },
        context,
      ),
    ).toEqual({
      selectedCompIds: ['comp-1'],
      rejectedCompIds: ['comp-2', 'comp-3'],
      suggestedPrice: null,
      confidence: 'low',
      priceExplanation: 'Deterministic stats should drive price.',
    });
  });

  it('rejects malformed JSON text', () => {
    expect(() => parseLlmPricingReasoningOutput('{', context)).toThrow(LlmPricingReasoningValidationError);
  });

  it('rejects non-object output', () => {
    expect(() => parseLlmPricingReasoningOutput([], context)).toThrow(/Expected object, received array/);
  });

  it('rejects missing required fields', () => {
    expect(() =>
      parseLlmPricingReasoningOutput(
        {
          selectedCompIds: ['comp-1'],
        },
        context,
      ),
    ).toThrow(/rejectedCompIds|confidence|priceExplanation/);
  });

  it('rejects invalid confidence', () => {
    expect(() =>
      parseLlmPricingReasoningOutput(
        {
          ...buildValidPayload(),
          confidence: 'certain',
        },
        context,
      ),
    ).toThrow(/confidence/);
  });

  it('rejects unknown selected comp id', () => {
    expect(() =>
      parseLlmPricingReasoningOutput(
        {
          ...buildValidPayload(),
          selectedCompIds: ['comp-1', 'unknown'],
        },
        context,
      ),
    ).toThrow(/selectedCompIds.*unknown compId/);
  });

  it('rejects unknown rejected comp id', () => {
    expect(() =>
      parseLlmPricingReasoningOutput(
        {
          ...buildValidPayload(),
          rejectedCompIds: ['unknown'],
        },
        context,
      ),
    ).toThrow(/rejectedCompIds.*unknown compId/);
  });

  it('rejects selected and rejected overlap', () => {
    expect(() =>
      parseLlmPricingReasoningOutput(
        {
          ...buildValidPayload(),
          selectedCompIds: ['comp-1'],
          rejectedCompIds: ['comp-1'],
        },
        context,
      ),
    ).toThrow(/overlaps rejectedCompIds/);
  });

  it('rejects duplicate selected and rejected comp ids', () => {
    expect(() =>
      parseLlmPricingReasoningOutput(
        {
          ...buildValidPayload(),
          selectedCompIds: ['comp-1', 'comp-1'],
        },
        context,
      ),
    ).toThrow(/duplicate compId/);

    expect(() =>
      parseLlmPricingReasoningOutput(
        {
          ...buildValidPayload(),
          rejectedCompIds: ['comp-2', 'comp-2'],
        },
        context,
      ),
    ).toThrow(/duplicate compId/);
  });

  it('rejects invalid suggested prices', () => {
    for (const suggestedPrice of ['12.50', Number.NaN, 0, -1, 0.001] as const) {
      expect(() =>
        parseLlmPricingReasoningOutput(
          {
            ...buildValidPayload(),
            suggestedPrice,
          },
          context,
        ),
      ).toThrow(/suggestedPrice/);
    }
  });

  it('rejects suggested price below low guardrail', () => {
    expect(() =>
      parseLlmPricingReasoningOutput(
        {
          ...buildValidPayload(),
          suggestedPrice: 9.99,
        },
        context,
      ),
    ).toThrow(/within deterministic sold price range 10.00-20.00/);
  });

  it('rejects suggested price above high guardrail', () => {
    expect(() =>
      parseLlmPricingReasoningOutput(
        {
          ...buildValidPayload(),
          suggestedPrice: 20.01,
        },
        context,
      ),
    ).toThrow(/within deterministic sold price range 10.00-20.00/);
  });

  it('rejects suggested price when deterministic guardrails unavailable', () => {
    expect(() =>
      parseLlmPricingReasoningOutput(
        {
          ...buildValidPayload(),
          suggestedPrice: 15,
        },
        {
          ...context,
          stats: {
            lowSoldPrice: null,
            highSoldPrice: null,
          },
        },
      ),
    ).toThrow(/requires deterministic low\/high sold price guardrails/);
  });

  it('rejects oversized explanation', () => {
    expect(() =>
      parseLlmPricingReasoningOutput(
        {
          ...buildValidPayload(),
          priceExplanation: 'x'.repeat(501),
        },
        context,
      ),
    ).toThrow(/priceExplanation/);
  });

  it('rejects recommendation language', () => {
    expect(() =>
      parseLlmPricingReasoningOutput(
        {
          ...buildValidPayload(),
          priceExplanation: 'Sell as lot based on grouped demand.',
        },
        context,
      ),
    ).toThrow(/disallowed lot\/single recommendation language/);
  });

  it('rejects comp notes for unknown comp ids', () => {
    expect(() =>
      parseLlmPricingReasoningOutput(
        {
          ...buildValidPayload(),
          compNotes: [{ compId: 'unknown', note: 'Outlier comp.' }],
        },
        context,
      ),
    ).toThrow(/compNotes.*unknown/);
  });
});

function buildValidPayload() {
  return {
    selectedCompIds: ['comp-1'],
    rejectedCompIds: ['comp-2'],
    suggestedPrice: 15,
    confidence: 'high' as const,
    priceExplanation: 'Price sits inside deterministic sold range and aligns with strongest comps.',
  };
}
