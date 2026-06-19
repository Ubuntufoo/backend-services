import {
  LlmPricingReasoningValidationError,
  parseLlmPricingReasoningOutput,
  type LlmPricingReasoningValidationContext,
} from '@/pricing/index.js';

describe('parseLlmPricingReasoningOutput', () => {
  const context: LlmPricingReasoningValidationContext = {
    validCompIds: ['c1', 'c2', 'c3'],
    canonicalCompIdsByPromptId: {
      c1: 'comp-1',
      c2: 'comp-2',
      c3: 'comp-3',
    },
    allowedAdjustment: {
      eligible: true,
      targetPrice: 15.13,
      minPrice: 15.13,
      maxPrice: 15.13,
    },
  };

  it('accepts valid exact-target output', () => {
    expect(
      parseLlmPricingReasoningOutput(
        {
          selectedCompIds: ['c1', 'c2'],
          rejectedCompIds: ['c3'],
          conditionAdjustedPrice: 15.129,
          conditionAdjustmentPercent: -0.0488,
          conditionAdjustmentReason: 'Most explicit-condition comps appear slightly stronger.',
          confidence: 'medium',
          priceExplanation: 'Median comps support exact deterministic target.',
          reviewWarnings: ['Most explicit-condition comps appear higher grade than listing.'],
          ambiguousConditionTerms: ['low grade'],
          compNotes: [{ compId: 'c1', note: 'Recent sale aligns with target.' }],
        },
        context,
      ),
    ).toEqual({
      selectedCompIds: ['comp-1', 'comp-2'],
      rejectedCompIds: ['comp-3'],
      conditionAdjustedPrice: 15.13,
      conditionAdjustmentPercent: -0.0488,
      conditionAdjustmentReason: 'Most explicit-condition comps appear slightly stronger.',
      confidence: 'medium',
      priceExplanation: 'Median comps support exact deterministic target.',
      reviewWarnings: ['Most explicit-condition comps appear higher grade than listing.'],
      ambiguousConditionTerms: ['low grade'],
      compNotes: [{ compId: 'comp-1', note: 'Recent sale aligns with target.' }],
    });
  });

  it('accepts null conditionAdjustedPrice', () => {
    expect(
      parseLlmPricingReasoningOutput(
        {
          selectedCompIds: ['c1'],
          rejectedCompIds: ['c2', 'c3'],
          conditionAdjustedPrice: null,
          conditionAdjustmentPercent: null,
          conditionAdjustmentReason: 'Condition evidence is thin.',
          confidence: 'low',
          priceExplanation: 'Deterministic median should remain final.',
        },
        context,
      ),
    ).toEqual({
      selectedCompIds: ['comp-1'],
      rejectedCompIds: ['comp-2', 'comp-3'],
      conditionAdjustedPrice: null,
      conditionAdjustmentPercent: null,
      conditionAdjustmentReason: 'Condition evidence is thin.',
      confidence: 'low',
      priceExplanation: 'Deterministic median should remain final.',
    });
  });

  it('rejects malformed JSON text', () => {
    expect(() => parseLlmPricingReasoningOutput('{', context)).toThrow(LlmPricingReasoningValidationError);
  });

  it.each([
    ['non-object output', [], /Expected object, received array/],
    ['missing required fields', { selectedCompIds: ['c1'] }, /rejectedCompIds|confidence|priceExplanation/],
    ['extra output field', { ...buildValidPayload(), extra: true }, /Unrecognized key\(s\) in object: 'extra'/],
    ['invalid confidence', { ...buildValidPayload(), confidence: 'certain' }, /confidence/],
    ['selectedCompIds not array', { ...buildValidPayload(), selectedCompIds: 'c1' }, /selectedCompIds/],
    ['rejectedCompIds not array', { ...buildValidPayload(), rejectedCompIds: 'c2' }, /rejectedCompIds/],
    ['selected unknown comp id', { ...buildValidPayload(), selectedCompIds: ['c1', 'unknown'] }, /selectedCompIds.*unknown compId/],
    ['rejected unknown comp id', { ...buildValidPayload(), rejectedCompIds: ['unknown'] }, /rejectedCompIds.*unknown compId/],
    ['selected duplicate comp id', { ...buildValidPayload(), selectedCompIds: ['c1', 'c1'] }, /duplicate compId/],
    ['rejected duplicate comp id', { ...buildValidPayload(), rejectedCompIds: ['c2', 'c2'] }, /duplicate compId/],
    ['selected rejected overlap', { ...buildValidPayload(), selectedCompIds: ['c1'], rejectedCompIds: ['c1'] }, /overlaps rejectedCompIds/],
    ['conditionAdjustedPrice string', { ...buildValidPayload(), conditionAdjustedPrice: '15.13' }, /conditionAdjustedPrice/],
    ['conditionAdjustedPrice NaN', { ...buildValidPayload(), conditionAdjustedPrice: Number.NaN }, /conditionAdjustedPrice/],
    ['conditionAdjustedPrice zero', { ...buildValidPayload(), conditionAdjustedPrice: 0 }, /conditionAdjustedPrice/],
    ['conditionAdjustedPrice negative', { ...buildValidPayload(), conditionAdjustedPrice: -1 }, /conditionAdjustedPrice/],
    ['conditionAdjustedPrice rounds to zero', { ...buildValidPayload(), conditionAdjustedPrice: 0.001 }, /conditionAdjustedPrice/],
    ['conditionAdjustmentPercent string', { ...buildValidPayload(), conditionAdjustmentPercent: '0.1' }, /conditionAdjustmentPercent/],
    ['oversized explanation', { ...buildValidPayload(), priceExplanation: 'x'.repeat(501) }, /priceExplanation/],
    ['reviewWarnings non-string', { ...buildValidPayload(), reviewWarnings: [123] }, /reviewWarnings/],
    ['ambiguous terms too long', { ...buildValidPayload(), ambiguousConditionTerms: ['x'.repeat(81)] }, /ambiguousConditionTerms/],
    ['compNotes unknown comp id', { ...buildValidPayload(), compNotes: [{ compId: 'unknown', note: 'Outlier comp.' }] }, /compNotes.*unknown/],
  ])('rejects %s', (_label, payload, message) => {
    expect(() => parseLlmPricingReasoningOutput(payload, context)).toThrow(message);
  });

  it('remaps alias ids back to canonical comp ids', () => {
    expect(
      parseLlmPricingReasoningOutput(
        {
          ...buildValidPayload(),
          selectedCompIds: ['c1'],
          rejectedCompIds: ['comp-2'],
        },
        context,
      ),
    ).toMatchObject({
      selectedCompIds: ['comp-1'],
      rejectedCompIds: ['comp-2'],
    });
  });

  it('rejects off-target adjustment', () => {
    expect(() =>
      parseLlmPricingReasoningOutput(
        {
          ...buildValidPayload(),
          conditionAdjustedPrice: 15.12,
        },
        context,
      ),
    ).toThrow(/deterministic condition-adjusted target 15.13/);
  });

  it('rejects conditionAdjustedPrice when deterministic target unavailable', () => {
    expect(() =>
      parseLlmPricingReasoningOutput(
        {
          ...buildValidPayload(),
          conditionAdjustedPrice: 15.13,
        },
        {
          ...context,
          allowedAdjustment: {
            eligible: false,
            targetPrice: null,
            minPrice: null,
            maxPrice: null,
          },
        },
      ),
    ).toThrow(/requires deterministic eligible condition adjustment target/);
  });
});

function buildValidPayload() {
  return {
    selectedCompIds: ['c1'],
    rejectedCompIds: ['c2'],
    conditionAdjustedPrice: 15.13,
    conditionAdjustmentPercent: 0,
    conditionAdjustmentReason: 'Exact deterministic target accepted.',
    confidence: 'high' as const,
    priceExplanation: 'Price aligns with exact deterministic condition target.',
  };
}
