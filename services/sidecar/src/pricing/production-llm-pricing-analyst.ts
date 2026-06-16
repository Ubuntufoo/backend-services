import { GoogleGenAI } from '@google/genai';
import { AiModelRouteNotFoundError, type ResolvedAiModelRoute } from '@ebay-inventory/data';

import type { SidecarDataAccess } from '@/data/sidecar-data.js';
import {
  GeminiDraftServiceError,
  generateListingDraftWithFallback,
  loadGeminiDraftConfig,
} from '@/gemini/index.js';

import { computePricingConfidence } from './confidence.js';
import { buildLlmPricingPrompt } from './llm-pricing-prompt.js';
import { parseLlmPricingReasoningOutput } from './llm-pricing-reasoning.js';
import type {
  LlmPricingPrompt,
  LlmPricingPromptComp,
  LlmPricingPromptStats,
  PricingAnalyst,
  PricingAnalystInput,
  PricingAnalystResult,
} from './types.js';

const AI_PROVIDER_GOOGLE = 'google';
const PRICING_REASONING_ROUTE_TASK_TYPE = 'pricing_reasoning';
const JSON_RESPONSE_MIME_TYPE = 'application/json';

const LLM_PRICING_RESPONSE_JSON_SCHEMA = {
  additionalProperties: false,
  properties: {
    ambiguousConditionTerms: {
      items: { type: 'string' },
      type: 'array',
    },
    compNotes: {
      items: {
        additionalProperties: false,
        properties: {
          compId: { type: 'string' },
          note: { type: 'string' },
        },
        required: ['compId', 'note'],
        type: 'object',
      },
      type: 'array',
    },
    conditionAdjustedPrice: {
      anyOf: [{ type: 'number' }, { type: 'null' }],
    },
    conditionAdjustmentPercent: {
      anyOf: [{ type: 'number' }, { type: 'null' }],
    },
    conditionAdjustmentReason: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
    },
    confidence: {
      enum: ['low', 'medium', 'high'],
      type: 'string',
    },
    priceExplanation: { type: 'string' },
    rejectedCompIds: {
      items: { type: 'string' },
      type: 'array',
    },
    reviewWarnings: {
      items: { type: 'string' },
      type: 'array',
    },
    selectedCompIds: {
      items: { type: 'string' },
      type: 'array',
    },
  },
  required: [
    'selectedCompIds',
    'rejectedCompIds',
    'conditionAdjustedPrice',
    'conditionAdjustmentPercent',
    'conditionAdjustmentReason',
    'confidence',
    'priceExplanation',
  ],
  type: 'object',
} as const;

export interface PricingReasoningModelResponse {
  rawOutput: unknown;
  text: string;
}

export interface CreateProductionPricingAnalystOptions {
  dataAccess: SidecarDataAccess;
  env?: NodeJS.ProcessEnv;
  executeModel?: (input: {
    model: string;
    prompt: LlmPricingPrompt;
  }) => Promise<PricingReasoningModelResponse>;
  now: () => Date;
}

export class ProductionPricingAnalystError extends Error {
  readonly modelName?: string;

  constructor(message: string, options?: ErrorOptions & { modelName?: string }) {
    super(message, options);
    this.name = 'ProductionPricingAnalystError';
    this.modelName = options?.modelName;
  }
}

class ProductionPricingAnalyst implements PricingAnalyst {
  readonly name = 'google_pricing_reasoning';

  constructor(private readonly options: CreateProductionPricingAnalystOptions) {}

  async analyze(input: PricingAnalystInput): Promise<PricingAnalystResult> {
    const prompt = buildPrompt(input);
    const routes = await this.options.dataAccess.aiModelRoutes.resolveForTask(
      buildPricingReasoningRouteResolutionInput()
    );

    if (routes.length === 0) {
      throw new AiModelRouteNotFoundError(buildPricingReasoningRouteResolutionInput());
    }

    const executeModel =
      this.options.executeModel ?? createGeminiPricingReasoningExecutor(this.options.env);

    const routerResult = await generateListingDraftWithFallback({
      executeRoute: async (route) => ({
        ...(await executeRoute(executeModel, route, prompt)),
        modelName: route.modelName,
      }),
      incrementDailyUsage: async () => {
        await this.options.dataAccess.dailyUsage.incrementGeminiCallsUsed();
      },
      now: this.options.now,
      routes,
    });

    const reasoningResult = routerResult.draft;

    try {
      const reasoning = parseLlmPricingReasoningOutput(reasoningResult.text, {
        allowedAdjustment: input.conditionAdjustment.allowedAdjustment,
        validCompIds: input.comps.map((comp) => comp.id),
      });

      return {
        modelName: reasoningResult.modelName,
        prompt,
        rawOutput: reasoningResult.rawOutput,
        reasoning,
      };
    } catch (error) {
      throw new ProductionPricingAnalystError(
        `Pricing analyst returned invalid reasoning for model "${reasoningResult.modelName}".`,
        {
          cause: error instanceof Error ? error : undefined,
          modelName: reasoningResult.modelName,
        }
      );
    }
  }
}

export function createProductionPricingAnalyst(
  options: CreateProductionPricingAnalystOptions
): PricingAnalyst {
  return new ProductionPricingAnalyst(options);
}

function buildPricingReasoningRouteResolutionInput(): {
  freeTierOnly: true;
  provider: typeof AI_PROVIDER_GOOGLE;
  requireJsonOutput: true;
  requireStructuredOutput: true;
  taskType: typeof PRICING_REASONING_ROUTE_TASK_TYPE;
} {
  return {
    freeTierOnly: true,
    provider: AI_PROVIDER_GOOGLE,
    requireJsonOutput: true,
    requireStructuredOutput: true,
    taskType: PRICING_REASONING_ROUTE_TASK_TYPE,
  };
}

function buildPrompt(input: PricingAnalystInput): LlmPricingPrompt {
  return buildLlmPricingPrompt({
    comps: input.comps.map(toPromptComp),
    conditionAdjustment: input.conditionAdjustment,
    listing: input.listing,
    options: input.promptOptions,
    stats: toPromptStats(input),
  });
}

function toPromptStats(input: PricingAnalystInput): LlmPricingPromptStats {
  return {
    confidence: computePricingConfidence({
      comps: input.comps,
      stats: input.stats,
    }).confidence,
    high: input.stats.highSoldPrice,
    low: input.stats.lowSoldPrice,
    median: input.stats.medianSoldPrice,
    soldCount: input.stats.soldCount,
    suggested: input.stats.deterministicSuggestedPrice,
  };
}

function toPromptComp(comp: PricingAnalystInput['comps'][number]): LlmPricingPromptComp {
  return {
    condition: comp.condition,
    id: comp.id,
    price: comp.totalPrice.value,
    soldAt: comp.soldDate,
    title: comp.title,
  };
}

async function executeRoute(
  executeModel: NonNullable<CreateProductionPricingAnalystOptions['executeModel']>,
  route: ResolvedAiModelRoute,
  prompt: LlmPricingPrompt
): Promise<PricingReasoningModelResponse> {
  try {
    return await executeModel({
      model: route.modelName,
      prompt,
    });
  } catch (error) {
    throw new ProductionPricingAnalystError(
      `Pricing analyst execution failed for model "${route.modelName}".`,
      {
        cause: error instanceof Error ? error : undefined,
        modelName: route.modelName,
      }
    );
  }
}

function createGeminiPricingReasoningExecutor(
  env: NodeJS.ProcessEnv = process.env
): NonNullable<CreateProductionPricingAnalystOptions['executeModel']> {
  const config = loadGeminiDraftConfig(env);

  if (!config.apiKey) {
    throw new GeminiDraftServiceError(
      'GEMINI_API_KEY is required to run pricing_reasoning.'
    );
  }

  const client = new GoogleGenAI({ apiKey: config.apiKey });

  return async ({ model, prompt }) => {
    const response = await client.models.generateContent({
      config: {
        responseJsonSchema: LLM_PRICING_RESPONSE_JSON_SCHEMA,
        responseMimeType: JSON_RESPONSE_MIME_TYPE,
        systemInstruction: prompt.systemInstruction,
        temperature: 0,
      },
      contents: prompt.userPrompt,
      model,
    });

    return {
      rawOutput: response,
      text: response.text ?? '',
    };
  };
}
