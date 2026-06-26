import { GoogleGenAI } from '@google/genai';
import { AiModelRouteNotFoundError, type ResolvedAiModelRoute } from '@ebay-inventory/data';

import type { SidecarDataAccess } from '@/data/sidecar-data.js';
import {
  GeminiDraftServiceError,
  type GenerateListingDraftWithFallbackResult,
  generateListingDraftWithFallback,
  loadGeminiDraftConfig,
} from '@/gemini/index.js';

import { redactSensitiveText } from './apify-provider.js';
import { computePricingConfidence } from './confidence.js';
import { buildLlmPricingPrompt, createLlmPromptCompIdAliases } from './llm-pricing-prompt.js';
import { parseLlmPricingReasoningOutput } from './llm-pricing-reasoning.js';
import type {
  LlmPricingPrompt,
  LlmPricingPromptComp,
  LlmPricingPromptStats,
  PricingAnalyst,
  PricingAnalystFailureCause,
  PricingAnalystFailureDiagnostics,
  PricingAnalystInput,
  PricingAnalystResult,
} from './types.js';

const AI_PROVIDER_GOOGLE = 'google';
const PRICING_REASONING_ROUTE_TASK_TYPE = 'pricing_reasoning';
const JSON_RESPONSE_MIME_TYPE = 'application/json';

const nowMs = () => performance.now();
const elapsedMs = (startedAt: number) => Math.max(0, Math.round(performance.now() - startedAt));

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

type PricingReasoningDraft = PricingReasoningModelResponse & {
  modelName: string;
};

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
  readonly failureDiagnostics?: PricingAnalystFailureDiagnostics;
  readonly modelName?: string;
  readonly providerName?: string;

  constructor(
    message: string,
    options?: ErrorOptions & {
      failureDiagnostics?: PricingAnalystFailureDiagnostics;
      modelName?: string;
      providerName?: string;
    }
  ) {
    super(message, options);
    this.name = 'ProductionPricingAnalystError';
    this.failureDiagnostics = options?.failureDiagnostics;
    this.modelName = options?.modelName;
    this.providerName = options?.providerName;
  }
}

class ProductionPricingAnalyst implements PricingAnalyst {
  readonly name = 'google_pricing_reasoning';

  constructor(private readonly options: CreateProductionPricingAnalystOptions) {}

  async analyze(input: PricingAnalystInput): Promise<PricingAnalystResult> {
    const compIdAliasesByCanonicalId = createLlmPromptCompIdAliases(
      input.comps.map((comp) => comp.id),
    );
    const prompt = buildPrompt(input, compIdAliasesByCanonicalId);
    const promptByteLength = getPromptByteLength(prompt);
    const routes = await this.options.dataAccess.aiModelRoutes.resolveForTask(
      buildPricingReasoningRouteResolutionInput()
    );

    if (routes.length === 0) {
      throw new AiModelRouteNotFoundError(buildPricingReasoningRouteResolutionInput());
    }

    const executeModel =
      this.options.executeModel ?? createGeminiPricingReasoningExecutor(this.options.env);

    let routerResult: GenerateListingDraftWithFallbackResult<PricingReasoningDraft>;
    const modelCallStartedAt = nowMs();
    try {
      routerResult = await generateListingDraftWithFallback({
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
    } catch (error) {
      const nestedFailure = findNestedProductionPricingAnalystError(error);
      if (nestedFailure) {
        throw nestedFailure;
      }

      throw error;
    }

    const reasoningResult = routerResult.draft;
    const modelCallMs = elapsedMs(modelCallStartedAt);
    const parseStartedAt = nowMs();

    try {
      const reasoning = parseLlmPricingReasoningOutput(reasoningResult.text, {
        allowedAdjustment: input.conditionAdjustment.allowedAdjustment,
        canonicalCompIdsByPromptId: invertCompIdAliases(compIdAliasesByCanonicalId),
        validCompIds: Object.values(compIdAliasesByCanonicalId),
      });
      const parseMs = elapsedMs(parseStartedAt);

      return {
        diagnostics: {
          compCountSent: input.comps.length,
          modelCallMs,
          outputTextByteLength: Buffer.byteLength(reasoningResult.text, 'utf8'),
          parseMs,
          promptByteLength,
          selectedModel: reasoningResult.modelName,
        },
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
          failureDiagnostics: buildFailureDiagnostics(error, {
            modelName: reasoningResult.modelName,
            providerName: AI_PROVIDER_GOOGLE,
          }),
          modelName: reasoningResult.modelName,
          providerName: AI_PROVIDER_GOOGLE,
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
  provider: typeof AI_PROVIDER_GOOGLE;
  requireJsonOutput: true;
  requireStructuredOutput: true;
  taskType: typeof PRICING_REASONING_ROUTE_TASK_TYPE;
} {
  return {
    provider: AI_PROVIDER_GOOGLE,
    requireJsonOutput: true,
    requireStructuredOutput: true,
    taskType: PRICING_REASONING_ROUTE_TASK_TYPE,
  };
}

function buildPrompt(
  input: PricingAnalystInput,
  compIdAliasesByCanonicalId: Readonly<Record<string, string>>,
): LlmPricingPrompt {
  return buildLlmPricingPrompt({
    comps: input.comps.map(toPromptComp),
    conditionAdjustment: input.conditionAdjustment,
    listing: input.listing,
    options: {
      ...input.promptOptions,
      compIdAliasesByCanonicalId,
    },
    stats: toPromptStats(input),
  });
}

function getPromptByteLength(prompt: LlmPricingPrompt): number {
  return (
    Buffer.byteLength(prompt.systemInstruction, 'utf8') +
    Buffer.byteLength(prompt.userPrompt, 'utf8')
  );
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
        failureDiagnostics: buildFailureDiagnostics(error, {
          modelName: route.modelName,
          providerName: route.provider,
        }),
        modelName: route.modelName,
        providerName: route.provider,
      }
    );
  }
}

function buildFailureDiagnostics(
  error: unknown,
  context: {
    modelName?: string;
    providerName?: string;
  }
): PricingAnalystFailureDiagnostics {
  const causes = extractFailureCauseChain(error);
  const statusCode = firstDefined(causes.map((cause) => cause.statusCode));
  const errorStatus = firstDefined(causes.map((cause) => cause.errorStatus));
  const errorCode = firstDefined(causes.map((cause) => cause.errorCode));
  const reason = firstDefined(causes.map((cause) => cause.reason));

  return {
    causes,
    ...(errorCode ? { errorCode } : {}),
    ...(errorStatus ? { errorStatus } : {}),
    ...(context.modelName ? { modelName: context.modelName } : {}),
    ...(context.providerName ? { provider: context.providerName } : {}),
    ...(reason ? { reason } : {}),
    retryable: classifyRetryableFailure(causes),
    ...(statusCode !== undefined ? { statusCode } : {}),
  };
}

function findNestedProductionPricingAnalystError(
  error: unknown
): ProductionPricingAnalystError | null {
  const visited = new Set<unknown>();
  const queue: unknown[] = [error];

  while (queue.length > 0) {
    const current = queue.shift();

    if (current instanceof ProductionPricingAnalystError) {
      return current;
    }

    if (!isRecord(current) && !(current instanceof Error)) {
      continue;
    }

    if (visited.has(current)) {
      continue;
    }
    visited.add(current);

    const nestedCause = getNestedRecordValue(current, 'cause');
    const nestedError = getNestedRecordValue(current, 'error');
    const finalError = getNestedRecordValue(current, 'finalError');

    if (nestedCause !== undefined) {
      queue.push(nestedCause);
    }
    if (nestedError !== undefined) {
      queue.push(nestedError);
    }
    if (finalError !== undefined) {
      queue.push(finalError);
    }
  }

  return null;
}

function extractFailureCauseChain(error: unknown): PricingAnalystFailureCause[] {
  const causes: PricingAnalystFailureCause[] = [];
  const visited = new Set<unknown>();
  const queue: unknown[] = [error];

  while (queue.length > 0 && causes.length < 6) {
    const current = queue.shift();

    if (!isRecord(current) && !(current instanceof Error)) {
      if (current !== undefined && current !== null) {
        causes.push({
          message: sanitizeFailureMessage(String(current)),
        });
      }
      continue;
    }

    if (visited.has(current)) {
      continue;
    }
    visited.add(current);

    const cause = buildFailureCause(current);
    if (cause) {
      causes.push(cause);
    }

    const nestedCause = getNestedRecordValue(current, 'cause');
    const nestedError = getNestedRecordValue(current, 'error');

    if (nestedCause !== undefined) {
      queue.push(nestedCause);
    }
    if (nestedError !== undefined && nestedError !== nestedCause) {
      queue.push(nestedError);
    }
  }

  return causes.length > 0
    ? causes
    : [
        {
          message: sanitizeFailureMessage('Unknown pricing analyst failure.'),
        },
      ];
}

function buildFailureCause(value: Error | Record<string, unknown>): PricingAnalystFailureCause | null {
  const message = getFailureMessage(value);

  if (!message) {
    return null;
  }

  const name =
    value instanceof Error
      ? sanitizeFailureLabel(value.name)
      : sanitizeFailureLabel(asNonEmptyString(value.name));
  const statusCode = getNumericField(value, ['statusCode', 'status', 'httpStatus', 'httpStatusCode', 'code']);
  const errorStatus = getStringField(value, ['errorStatus', 'status', 'statusText']);
  const errorCode = getCodeField(value, statusCode);
  const reason = getStringField(value, ['reason', 'errorReason', 'failureReason']);

  return {
    ...(errorCode ? { errorCode } : {}),
    ...(errorStatus ? { errorStatus } : {}),
    message,
    ...(name ? { name } : {}),
    ...(reason ? { reason } : {}),
    ...(statusCode !== undefined ? { statusCode } : {}),
  };
}

function getFailureMessage(value: Error | Record<string, unknown>): string | undefined {
  if (value instanceof Error) {
    return sanitizeFailureMessage(value.message);
  }

  const message =
    getStringField(value, ['message', 'errorMessage']) ??
    getStringField(value, ['details', 'detail', 'description']);

  return message ? sanitizeFailureMessage(message) : undefined;
}

function getCodeField(
  value: Error | Record<string, unknown>,
  statusCode?: number
): string | undefined {
  const code = getStringField(value, ['errorCode', 'code', 'reasonCode']);

  if (code) {
    return code;
  }

  if (statusCode !== undefined) {
    return undefined;
  }

  const numericCode = getNumericField(value, ['code']);
  return numericCode !== undefined ? String(numericCode) : undefined;
}

function getNestedRecordValue(value: Error | Record<string, unknown>, key: string): unknown {
  if (value instanceof Error) {
    return (value as Error & Record<string, unknown>)[key];
  }

  return value[key];
}

function getNumericField(
  value: Error | Record<string, unknown>,
  keys: readonly string[]
): number | undefined {
  for (const key of keys) {
    const candidate = getNestedRecordValue(value, key);
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return Math.trunc(candidate);
    }
    if (typeof candidate === 'string' && /^\d{3}$/.test(candidate.trim())) {
      return Number(candidate.trim());
    }
  }

  return undefined;
}

function getStringField(
  value: Error | Record<string, unknown>,
  keys: readonly string[]
): string | undefined {
  for (const key of keys) {
    const candidate = getNestedRecordValue(value, key);
    const normalized = asNonEmptyString(candidate);
    if (normalized) {
      return sanitizeFailureMessage(normalized);
    }
  }

  return undefined;
}

function classifyRetryableFailure(causes: readonly PricingAnalystFailureCause[]): boolean {
  return causes.some((cause) => {
    if (
      cause.statusCode === 429 ||
      cause.statusCode === 500 ||
      cause.statusCode === 502 ||
      cause.statusCode === 503 ||
      cause.statusCode === 504
    ) {
      return true;
    }

    const combined = [cause.errorCode, cause.errorStatus, cause.reason, cause.message]
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .join(' ')
      .toLowerCase();

    return /(resource_exhausted|unavailable|deadline_exceeded|timeout|timed out|high demand|capacity|overloaded|try again|temporar|quota|rate limit)/i.test(
      combined
    );
  });
}

function sanitizeFailureLabel(value: string | undefined): string | undefined {
  const normalized = asNonEmptyString(value);
  return normalized ? normalized.slice(0, 80) : undefined;
}

function firstDefined<T>(values: readonly (T | undefined)[]): T | undefined {
  return values.find((value): value is T => value !== undefined);
}

function sanitizeFailureMessage(value: string): string {
  const normalized = redactSensitiveText(value)
    .replace(/\bauthorization\s*[:=]?\s*Bearer\s+\[redacted-token\]/gi, '[redacted-authorization]')
    .replace(/\bauthorization\b/gi, '[redacted-header]')
    .replace(/\bapi[_-]?key\b/gi, '[redacted-key]')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized.length <= 240 ? normalized : `${normalized.slice(0, 237)}...`;
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
