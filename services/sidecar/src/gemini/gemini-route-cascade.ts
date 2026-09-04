import {
  AiModelRouteNotFoundError,
  type ResolveAiModelRoutesInput,
  type ResolvedAiModelRoute,
} from '@ebay-inventory/data';

import {
  generateListingDraftWithFallback,
  type GenerateListingDraftWithFallbackOptions,
  type GenerateListingDraftWithFallbackResult,
} from './gemini-model-router.js';

export const GEMINI_LISTING_DRAFT_TASK_TYPE = 'listing_draft_generation' as const;

export interface GeminiRouteCascadeDataAccess {
  aiModelRoutes: {
    resolveForTask(input: ResolveAiModelRoutesInput): Promise<ResolvedAiModelRoute[]>;
  };
  dailyUsage: {
    incrementGeminiCallsUsed(usageDate?: string): Promise<unknown>;
  };
}

export interface ExecuteGeminiRouteCascadeOptions<Draft>
  extends Pick<
    GenerateListingDraftWithFallbackOptions<Draft>,
    'executeRoute' | 'now' | 'onAttemptFailed' | 'onAttemptStarted' | 'onAttemptSucceeded'
  > {
  dataAccess: GeminiRouteCascadeDataAccess;
  /** Runs after route resolution and before any usage reservation/provider call. */
  beforeAttempts?(): Promise<void>;
  requireImages: boolean;
  taskType?: string;
}

export function buildGeminiRouteResolutionInput(
  taskType: string,
  requireImages: boolean
): ResolveAiModelRoutesInput {
  return {
    freeTierOnly: true,
    provider: 'google',
    requireImages,
    requireJsonOutput: true,
    requireStructuredOutput: true,
    taskType,
  };
}

export async function executeGeminiRouteCascade<Draft>(
  options: ExecuteGeminiRouteCascadeOptions<Draft>
): Promise<GenerateListingDraftWithFallbackResult<Draft>> {
  const taskType = options.taskType ?? GEMINI_LISTING_DRAFT_TASK_TYPE;
  const resolutionInput = buildGeminiRouteResolutionInput(taskType, options.requireImages);
  const routes = await options.dataAccess.aiModelRoutes.resolveForTask(resolutionInput);
  if (routes.length === 0) throw new AiModelRouteNotFoundError(resolutionInput);
  await options.beforeAttempts?.();

  return await generateListingDraftWithFallback({
    executeRoute: options.executeRoute,
    incrementDailyUsage: async () => {
      await options.dataAccess.dailyUsage.incrementGeminiCallsUsed();
    },
    now: options.now,
    ...(options.onAttemptFailed ? { onAttemptFailed: options.onAttemptFailed } : {}),
    ...(options.onAttemptStarted ? { onAttemptStarted: options.onAttemptStarted } : {}),
    ...(options.onAttemptSucceeded ? { onAttemptSucceeded: options.onAttemptSucceeded } : {}),
    routes,
  });
}
