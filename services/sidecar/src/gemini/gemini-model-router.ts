import { ApiError } from '@google/genai';
import type { ResolvedAiModelRoute } from '@ebay-inventory/data';
import { GeminiDraftServiceError, GeminiDraftValidationError } from './contracts.js';

export type GeminiFallbackKind = 'rate_limit' | 'quota_exceeded' | 'unavailable' | 'none';

export interface GeminiFallbackAttempt<Route = ResolvedAiModelRoute> {
  attemptOrder: number;
  completedAt: string;
  durationMs: number;
  error?: unknown;
  fallbackKind: GeminiFallbackKind;
  route: Route;
  startedAt: string;
  status: 'failed' | 'succeeded';
}

export interface GenerateListingDraftWithFallbackOptions<
  Draft,
  Route extends ResolvedAiModelRoute = ResolvedAiModelRoute,
> {
  classifyFallbackKind?: (error: unknown) => GeminiFallbackKind;
  executeRoute(route: Route): Promise<Draft>;
  incrementDailyUsage(): Promise<void>;
  now: () => Date;
  onAttemptFailed?(attempt: GeminiFallbackAttempt<Route> & { willFallback: boolean }): Promise<void>;
  onAttemptStarted?(attempt: Pick<GeminiFallbackAttempt<Route>, 'attemptOrder' | 'route' | 'startedAt'>): Promise<void>;
  onAttemptSucceeded?(attempt: GeminiFallbackAttempt<Route> & { draft: Draft }): Promise<void>;
  routes: Route[];
}

export interface GenerateListingDraftWithFallbackResult<
  Draft,
  Route extends ResolvedAiModelRoute = ResolvedAiModelRoute,
> {
  attempts: GeminiFallbackAttempt<Route>[];
  draft: Draft;
  selectedAttempt: GeminiFallbackAttempt<Route>;
  selectedRoute: Route;
}

export class GeminiFallbackExecutionError<
  Route extends ResolvedAiModelRoute = ResolvedAiModelRoute,
> extends Error {
  readonly attemptedModels: string[];
  readonly attempts: GeminiFallbackAttempt<Route>[];
  readonly fallbackExhausted: boolean;
  readonly finalError: unknown;

  constructor(input: {
    attempts: GeminiFallbackAttempt<Route>[];
    fallbackExhausted: boolean;
    finalError: unknown;
  }) {
    super(input.finalError instanceof Error ? input.finalError.message : 'Gemini fallback execution failed.');
    this.name = 'GeminiFallbackExecutionError';
    this.attempts = input.attempts;
    this.attemptedModels = input.attempts.map((attempt) => attempt.route.modelName);
    this.fallbackExhausted = input.fallbackExhausted;
    this.finalError = input.finalError;
  }
}

function asIsoTimestamp(now: () => Date): string {
  return now().toISOString();
}

function getDurationMs(startedAt: string, completedAt: string): number {
  return Math.max(0, Date.parse(completedAt) - Date.parse(startedAt));
}

function getErrorStatus(error: unknown): number | undefined {
  if (error instanceof ApiError && typeof error.status === 'number') {
    return error.status;
  }

  if (typeof error === 'object' && error !== null && 'status' in error) {
    const value = (error as { status?: unknown }).status;

    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string') {
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
  }

  return undefined;
}

function getErrorCause(error: unknown): unknown {
  if (error instanceof Error) {
    return error.cause;
  }

  if (typeof error === 'object' && error !== null && 'cause' in error) {
    return (error as { cause?: unknown }).cause;
  }

  return undefined;
}

function getErrorTexts(error: unknown): string[] {
  const texts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current);

    if (typeof current === 'string') {
      texts.push(current.toLowerCase());
      break;
    }

    if (current instanceof Error) {
      texts.push(current.message.toLowerCase());
      current = current.cause;
      continue;
    }

    if (typeof current === 'object') {
      const message = (current as { message?: unknown }).message;
      if (typeof message === 'string') {
        texts.push(message.toLowerCase());
      }
      current = getErrorCause(current);
      continue;
    }

    texts.push(String(current).toLowerCase());
    break;
  }

  return texts;
}

function routeAllowsFallback(route: ResolvedAiModelRoute, kind: GeminiFallbackKind): boolean {
  switch (kind) {
    case 'rate_limit':
      return route.fallbackOnRateLimit;
    case 'quota_exceeded':
      return route.fallbackOnQuotaExceeded;
    case 'unavailable':
      return route.fallbackOnUnavailable;
    case 'none':
      return false;
  }
}

function isGeminiApiKeyError(error: GeminiDraftServiceError): boolean {
  return error.message.includes('GEMINI_API_KEY is required');
}

export function classifyGeminiFallbackKind(error: unknown): GeminiFallbackKind {
  if (error instanceof GeminiDraftValidationError) {
    return 'none';
  }

  if (error instanceof GeminiDraftServiceError && isGeminiApiKeyError(error)) {
    return 'none';
  }

  const status = getErrorStatus(error);
  const text = getErrorTexts(error).join(' ');

  if (text.includes('quota') || text.includes('resource exhausted')) {
    return 'quota_exceeded';
  }

  if (status === 429 || text.includes('rate limit') || text.includes('too many requests')) {
    return 'rate_limit';
  }

  if (
    status === 503 ||
    (typeof status === 'number' && status >= 500 && status < 600) ||
    text.includes('temporarily unavailable') ||
    text.includes('unavailable') ||
    text.includes('connection error') ||
    text.includes('request timed out') ||
    text.includes('fetch failed') ||
    text.includes('network') ||
    text.includes('econnreset') ||
    text.includes('eai_again') ||
    text.includes('enotfound') ||
    text.includes('socket hang up')
  ) {
    return 'unavailable';
  }

  return 'none';
}

export async function generateListingDraftWithFallback<
  Draft,
  Route extends ResolvedAiModelRoute = ResolvedAiModelRoute,
>(
  options: GenerateListingDraftWithFallbackOptions<Draft, Route>
): Promise<GenerateListingDraftWithFallbackResult<Draft, Route>> {
  const attempts: GeminiFallbackAttempt<Route>[] = [];
  const classifyFallbackKind = options.classifyFallbackKind ?? classifyGeminiFallbackKind;

  for (const [index, route] of options.routes.entries()) {
    try {
      await options.incrementDailyUsage();
    } catch (error) {
      if (attempts.length > 0) {
        throw new GeminiFallbackExecutionError({
          attempts,
          fallbackExhausted: false,
          finalError: error,
        });
      }

      throw error;
    }

    const attemptOrder = index + 1;
    const startedAt = asIsoTimestamp(options.now);
    await options.onAttemptStarted?.({
      attemptOrder,
      route,
      startedAt,
    });

    try {
      const draft = await options.executeRoute(route);
      const completedAt = asIsoTimestamp(options.now);
      const succeededAttempt: GeminiFallbackAttempt<Route> = {
        attemptOrder,
        completedAt,
        durationMs: getDurationMs(startedAt, completedAt),
        fallbackKind: 'none',
        route,
        startedAt,
        status: 'succeeded',
      };
      attempts.push(succeededAttempt);
      await options.onAttemptSucceeded?.({
        ...succeededAttempt,
        draft,
      });

      return {
        attempts,
        draft,
        selectedAttempt: succeededAttempt,
        selectedRoute: route,
      };
    } catch (error) {
      const completedAt = asIsoTimestamp(options.now);
      const fallbackKind = classifyFallbackKind(error);
      const hasNextRoute = index < options.routes.length - 1;
      const willFallback = hasNextRoute && routeAllowsFallback(route, fallbackKind);
      const failedAttempt: GeminiFallbackAttempt<Route> = {
        attemptOrder,
        completedAt,
        durationMs: getDurationMs(startedAt, completedAt),
        error,
        fallbackKind,
        route,
        startedAt,
        status: 'failed',
      };
      attempts.push(failedAttempt);
      await options.onAttemptFailed?.({
        ...failedAttempt,
        willFallback,
      });

      if (willFallback) {
        continue;
      }

      throw new GeminiFallbackExecutionError({
        attempts,
        fallbackExhausted: !hasNextRoute && routeAllowsFallback(route, fallbackKind),
        finalError: error,
      });
    }
  }

  throw new Error('Gemini fallback router requires at least one route.');
}
