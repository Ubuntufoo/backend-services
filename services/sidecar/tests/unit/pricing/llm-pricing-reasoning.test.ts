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
      suggestedPrice: 15.13,
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

  it.each([
    ['non-object output', [], /Expected object, received array/],
    ['missing required fields', { selectedCompIds: ['comp-1'] }, /rejectedCompIds|confidence|priceExplanation/],
    ['extra output field', { ...buildValidPayload(), extra: true }, /Unrecognized key\(s\) in object: 'extra'/],
    ['invalid confidence', { ...buildValidPayload(), confidence: 'certain' }, /confidence/],
    ['selectedCompIds not array', { ...buildValidPayload(), selectedCompIds: 'comp-1' }, /selectedCompIds/],
    ['rejectedCompIds not array', { ...buildValidPayload(), rejectedCompIds: 'comp-2' }, /rejectedCompIds/],
    ['selected unknown comp id', { ...buildValidPayload(), selectedCompIds: ['comp-1', 'unknown'] }, /selectedCompIds.*unknown compId/],
    ['rejected unknown comp id', { ...buildValidPayload(), rejectedCompIds: ['unknown'] }, /rejectedCompIds.*unknown compId/],
    ['selected duplicate comp id', { ...buildValidPayload(), selectedCompIds: ['comp-1', 'comp-1'] }, /duplicate compId/],
    ['rejected duplicate comp id', { ...buildValidPayload(), rejectedCompIds: ['comp-2', 'comp-2'] }, /duplicate compId/],
    ['selected rejected overlap', { ...buildValidPayload(), selectedCompIds: ['comp-1'], rejectedCompIds: ['comp-1'] }, /overlaps rejectedCompIds/],
    ['selected non-string comp id', { ...buildValidPayload(), selectedCompIds: [123] }, /compId must be a string/],
    ['rejected non-string comp id', { ...buildValidPayload(), rejectedCompIds: [123] }, /compId must be a string/],
    ['suggestedPrice string', { ...buildValidPayload(), suggestedPrice: '12.50' }, /suggestedPrice/],
    ['suggestedPrice NaN', { ...buildValidPayload(), suggestedPrice: Number.NaN }, /suggestedPrice/],
    ['suggestedPrice Infinity', { ...buildValidPayload(), suggestedPrice: Number.POSITIVE_INFINITY }, /suggestedPrice/],
    ['suggestedPrice zero', { ...buildValidPayload(), suggestedPrice: 0 }, /suggestedPrice/],
    ['suggestedPrice negative', { ...buildValidPayload(), suggestedPrice: -1 }, /suggestedPrice/],
    ['suggestedPrice rounds to zero', { ...buildValidPayload(), suggestedPrice: 0.001 }, /suggestedPrice/],
    ['oversized explanation', { ...buildValidPayload(), priceExplanation: 'x'.repeat(501) }, /priceExplanation/],
    ['recommendation language', { ...buildValidPayload(), priceExplanation: 'Sell as lot based on grouped demand.' }, /disallowed lot\/single recommendation language/],
    ['compNotes unknown comp id', { ...buildValidPayload(), compNotes: [{ compId: 'unknown', note: 'Outlier comp.' }] }, /compNotes.*unknown/],
    ['compNotes note too long', { ...buildValidPayload(), compNotes: [{ compId: 'comp-1', note: 'x'.repeat(241) }] }, /compNotes.*at most 240 characters/],
    ['compNotes note non-string', { ...buildValidPayload(), compNotes: [{ compId: 'comp-1', note: 123 }] }, /compNotes\.0\.note/],
  ])('rejects %s', (_label, payload, message) => {
    expect(() => parseLlmPricingReasoningOutput(payload, context)).toThrow(message);
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
