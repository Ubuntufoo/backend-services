import { computePricingConfidence } from './confidence.js';
import { buildLlmPricingPrompt, createLlmPromptCompIdAliases } from './llm-pricing-prompt.js';
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
    const compIdAliasesByCanonicalId = createLlmPromptCompIdAliases(
      input.comps.map((comp) => comp.id),
    );
    const prompt = buildLlmPricingPrompt({
      listing: input.listing,
      stats: toPromptStats(input),
      comps: input.comps.map(toPromptComp),
      conditionAdjustment: input.conditionAdjustment,
      options: {
        ...input.promptOptions,
        compIdAliasesByCanonicalId,
      },
    });

    if (this.options.mode === 'throws') {
      throw new FixtureLlmPricingAnalystError('Fixture LLM pricing analyst configured to throw.');
    }

    try {
      const rawOutput = buildRawOutput(input, this.options.mode, this.options.rawOutput);
      const reasoning = parseLlmPricingReasoningOutput(rawOutput, {
        canonicalCompIdsByPromptId: invertCompIdAliases(compIdAliasesByCanonicalId),
        validCompIds: Object.values(compIdAliasesByCanonicalId),
        allowedAdjustment: input.conditionAdjustment.allowedAdjustment,
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
  const selectedCompIds = Object.values(
    createLlmPromptCompIdAliases(input.comps.map((comp) => comp.id)),
  );
  const conditionAdjustedPrice = getConditionAdjustedPrice(input);

  return {
    selectedCompIds,
    rejectedCompIds: [],
    conditionAdjustedPrice,
    conditionAdjustmentPercent:
      conditionAdjustedPrice !== null ? input.conditionAdjustment.allowedAdjustment.appliedPercent : null,
    conditionAdjustmentReason:
      conditionAdjustedPrice !== null
        ? 'Deterministic condition target accepted.'
        : input.conditionAdjustment.allowedAdjustment.eligible
          ? 'No safe condition adjustment selected.'
          : 'Condition adjustment unavailable from deterministic guardrails.',
    confidence: computePricingConfidence({
      comps: input.comps,
      stats: input.stats,
    }).confidence,
    priceExplanation:
      conditionAdjustedPrice !== null
        ? 'Deterministic median and condition evidence support exact target.'
        : 'Deterministic median remains final because condition adjustment was not applied.',
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

function getConditionAdjustedPrice(input: PricingAnalystInput): number | null {
  if (!input.conditionAdjustment.allowedAdjustment.eligible) {
    return null;
  }

  return normalizePrice(input.conditionAdjustment.allowedAdjustment.targetPrice);
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

function invertCompIdAliases(
  compIdAliasesByCanonicalId: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(compIdAliasesByCanonicalId).map(([canonicalCompId, promptCompId]) => [
        promptCompId,
        canonicalCompId,
      ]),
    ),
  );
}
