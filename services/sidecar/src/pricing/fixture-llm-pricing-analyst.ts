import { computePricingConfidence } from './confidence.js';
import { buildLlmPricingPrompt } from './llm-pricing-prompt.js';
import {
  LlmPricingReasoningValidationError,
  parseLlmPricingReasoningOutput,
} from './llm-pricing-reasoning.js';
import type {
  LlmPricingPromptComp,
  LlmPricingPromptStats,
  PricingAnalyst,
  PricingAnalystInput,
  PricingAnalystResult,
} from './types.js';

export const FIXTURE_LLM_PRICING_ANALYST_MODEL_NAME = 'fixture-llm-pricing-analyst-v1';

type FixtureLlmPricingAnalystMode = 'valid' | 'invalid_json' | 'throws' | 'custom';

export interface CreateFixtureLlmPricingAnalystOptions {
  mode?: FixtureLlmPricingAnalystMode;
  rawOutput?: unknown;
}

export class FixtureLlmPricingAnalystError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'FixtureLlmPricingAnalystError';
  }
}

class FixtureLlmPricingAnalyst implements PricingAnalyst {
  readonly name = 'fixture';

  constructor(private readonly options: CreateFixtureLlmPricingAnalystOptions = {}) {}

  async analyze(input: PricingAnalystInput): Promise<PricingAnalystResult> {
    const prompt = buildLlmPricingPrompt({
      listing: input.listing,
      stats: toPromptStats(input),
      comps: input.comps.map(toPromptComp),
      options: input.promptOptions,
    });

    if (this.options.mode === 'throws') {
      throw new FixtureLlmPricingAnalystError('Fixture LLM pricing analyst configured to throw.');
    }

    try {
      const rawOutput = buildRawOutput(input, this.options.mode, this.options.rawOutput);
      const reasoning = parseLlmPricingReasoningOutput(rawOutput, {
        validCompIds: input.comps.map((comp) => comp.id),
        stats: {
          lowSoldPrice: input.stats.lowSoldPrice,
          highSoldPrice: input.stats.highSoldPrice,
        },
      });

      return {
        modelName: FIXTURE_LLM_PRICING_ANALYST_MODEL_NAME,
        reasoning,
        prompt,
        rawOutput,
      };
    } catch (error) {
      if (
        error instanceof FixtureLlmPricingAnalystError ||
        error instanceof LlmPricingReasoningValidationError
      ) {
        throw error;
      }

      throw new FixtureLlmPricingAnalystError('Fixture LLM pricing analyst failed.', { cause: error });
    }
  }
}

export function createFixtureLlmPricingAnalyst(
  options: CreateFixtureLlmPricingAnalystOptions = {},
): PricingAnalyst {
  return new FixtureLlmPricingAnalyst(options);
}

function buildRawOutput(
  input: PricingAnalystInput,
  mode: FixtureLlmPricingAnalystMode | undefined,
  customRawOutput: unknown,
): unknown {
  switch (mode) {
    case 'invalid_json':
      return '{';
    case 'custom':
      return customRawOutput;
    case 'valid':
    case undefined:
      return buildValidRawOutput(input);
    default:
      return buildValidRawOutput(input);
  }
}

function buildValidRawOutput(input: PricingAnalystInput) {
  const guardrailsAvailable =
    isPositiveAmount(input.stats.lowSoldPrice) &&
    isPositiveAmount(input.stats.highSoldPrice) &&
    input.stats.lowSoldPrice <= input.stats.highSoldPrice;
  const selectedCompIds = guardrailsAvailable
    ? input.comps
        .filter((comp) =>
          isCompWithinGuardrails(comp, input.stats.lowSoldPrice as number, input.stats.highSoldPrice as number),
        )
        .map((comp) => comp.id)
    : [];
  const rejectedCompIds = input.comps
    .map((comp) => comp.id)
    .filter((compId) => !selectedCompIds.includes(compId));
  const suggestedPrice = getSafeSuggestedPrice(input);

  return {
    selectedCompIds,
    rejectedCompIds,
    suggestedPrice,
    confidence: computePricingConfidence({
      comps: input.comps,
      stats: input.stats,
    }).confidence,
    priceExplanation:
      selectedCompIds.length > 0 && suggestedPrice !== null
        ? 'Selected comps align with deterministic sold range.'
        : 'Deterministic comps do not support a safe price.',
  };
}

function toPromptStats(input: PricingAnalystInput): LlmPricingPromptStats {
  return {
    soldCount: input.stats.soldCount,
    low: input.stats.lowSoldPrice,
    median: input.stats.medianSoldPrice,
    high: input.stats.highSoldPrice,
    suggested: input.stats.deterministicSuggestedPrice,
    confidence: computePricingConfidence({
      comps: input.comps,
      stats: input.stats,
    }).confidence,
  };
}

function toPromptComp(comp: PricingAnalystInput['comps'][number]): LlmPricingPromptComp {
  return {
    id: comp.id,
    title: comp.title,
    price: comp.totalPrice.value,
    soldAt: comp.soldDate,
    condition: comp.condition,
  };
}

function getSafeSuggestedPrice(input: PricingAnalystInput): number | null {
  const suggestedPrice = normalizePrice(input.stats.deterministicSuggestedPrice);
  const low = normalizePrice(input.stats.lowSoldPrice);
  const high = normalizePrice(input.stats.highSoldPrice);

  if (suggestedPrice === null || low === null || high === null || suggestedPrice < low || suggestedPrice > high) {
    return null;
  }

  return suggestedPrice;
}

function isCompWithinGuardrails(
  comp: PricingAnalystInput['comps'][number],
  low: number,
  high: number,
): boolean {
  const totalValue = comp.totalPrice.value;
  return Number.isFinite(totalValue) && totalValue > 0 && totalValue >= low && totalValue <= high;
}

function isPositiveAmount(value: number | null): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function normalizePrice(value: number | null): number | null {
  if (!isPositiveAmount(value)) {
    return null;
  }

  const normalized = Number(value.toFixed(2));
  if (normalized <= 0) {
    return null;
  }

  const cents = Math.round(normalized * 100);
  return Number.isSafeInteger(cents) ? normalized : null;
}
