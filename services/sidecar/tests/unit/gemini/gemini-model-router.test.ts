import type { ResolvedAiModelRoute } from '@ebay-inventory/data';
import { describe, expect, it, vi } from 'vitest';
import {
  classifyGeminiFallbackKind,
  executeGeminiRouteCascade,
  GeminiDraftServiceError,
  GeminiDraftTitleOverflowError,
  GeminiDraftValidationError,
  GeminiFallbackExecutionError,
  generateListingDraftWithFallback,
} from '@/gemini/index.js';

function createRoute(overrides: Partial<ResolvedAiModelRoute> = {}): ResolvedAiModelRoute {
  return {
    displayName: 'Gemini 3.5 Flash Lite',
    fallbackOnQuotaExceeded: true,
    fallbackOnRateLimit: true,
    fallbackOnUnavailable: true,
    freeTierStatus: 'unknown',
    isFreeTierEligible: true,
    modelName: 'gemini-3.5-flash-lite',
    provider: 'google',
    requestsPerDay: null,
    requestsPerMinute: null,
    routeOrder: 1,
    supportsImages: true,
    supportsJsonOutput: true,
    supportsStructuredOutput: true,
    supportsText: true,
    taskType: 'listing_draft_generation',
    ...overrides,
  };
}

describe('generateListingDraftWithFallback', () => {
  it('succeeds on first route and skips later routes', async () => {
    const executeRoute = vi.fn(async () => ({ title: 'draft-1' }));

    const result = await generateListingDraftWithFallback({
      executeRoute,
      incrementDailyUsage: vi.fn(async () => undefined),
      now: () => new Date('2026-06-01T12:00:00.000Z'),
      routes: [createRoute(), createRoute({ modelName: 'gemini-3.1-flash-lite', routeOrder: 2 })],
    });

    expect(executeRoute).toHaveBeenCalledTimes(1);
    expect(result.draft).toEqual({ title: 'draft-1' });
    expect(result.selectedRoute.modelName).toBe('gemini-3.5-flash-lite');
    expect(result.attempts).toHaveLength(1);
  });

  it('falls back on rate-limit failures', async () => {
    const executeRoute = vi
      .fn()
      .mockRejectedValueOnce(new GeminiDraftServiceError('429 rate limit exceeded'))
      .mockResolvedValueOnce({ title: 'draft-2' });

    const result = await generateListingDraftWithFallback({
      executeRoute,
      incrementDailyUsage: vi.fn(async () => undefined),
      now: () => new Date('2026-06-01T12:00:00.000Z'),
      routes: [createRoute(), createRoute({ modelName: 'gemini-3.1-flash-lite', routeOrder: 2 })],
    });

    expect(executeRoute).toHaveBeenCalledTimes(2);
    expect(result.selectedRoute.modelName).toBe('gemini-3.1-flash-lite');
    expect(result.attempts.map((attempt) => attempt.status)).toEqual(['failed', 'succeeded']);
  });

  it('falls through the configured six-model stable route order', async () => {
    const executeRoute = vi
      .fn()
      .mockRejectedValueOnce(new GeminiDraftServiceError('429 rate limit exceeded'))
      .mockRejectedValueOnce(new GeminiDraftServiceError('RESOURCE_EXHAUSTED: quota reached'))
      .mockRejectedValueOnce(new GeminiDraftServiceError('503 temporarily unavailable'))
      .mockRejectedValueOnce(new GeminiDraftServiceError('503 temporarily unavailable'))
      .mockRejectedValueOnce(new GeminiDraftServiceError('503 temporarily unavailable'))
      .mockResolvedValueOnce({ title: 'draft-6' });
    const routes = [
      createRoute(),
      createRoute({ modelName: 'gemini-3.1-flash-lite', routeOrder: 2 }),
      createRoute({ modelName: 'gemini-3.8-flash', routeOrder: 3 }),
      createRoute({ modelName: 'gemini-3.7-flash', routeOrder: 4 }),
      createRoute({ modelName: 'gemini-3.6-flash', routeOrder: 5 }),
      createRoute({ modelName: 'gemini-3.5-flash', routeOrder: 6 }),
    ];

    const result = await generateListingDraftWithFallback({
      executeRoute,
      incrementDailyUsage: vi.fn(async () => undefined),
      now: () => new Date('2026-09-04T12:00:00.000Z'),
      routes,
    });

    expect(executeRoute).toHaveBeenCalledTimes(6);
    routes.forEach((route, index) => expect(executeRoute).toHaveBeenNthCalledWith(index + 1, route));
    expect(result.selectedRoute.modelName).toBe('gemini-3.5-flash');
    expect(result.attempts.map((attempt) => attempt.status)).toEqual([
      'failed', 'failed', 'failed', 'failed', 'failed', 'succeeded',
    ]);
  });

  it('shared route cascade resolves free-tier structured routes and owns usage accounting', async () => {
    const routes = [
      createRoute(),
      createRoute({ modelName: 'gemini-3.1-flash-lite', routeOrder: 2 }),
    ];
    const resolveForTask = vi.fn(async () => routes);
    const incrementGeminiCallsUsed = vi.fn(async () => undefined);
    const executeRoute = vi
      .fn()
      .mockRejectedValueOnce(new GeminiDraftServiceError('503 unavailable'))
      .mockResolvedValueOnce({ title: 'fallback' });

    const result = await executeGeminiRouteCascade({
      dataAccess: { aiModelRoutes: { resolveForTask }, dailyUsage: { incrementGeminiCallsUsed } },
      executeRoute,
      now: () => new Date('2026-09-04T12:00:00.000Z'),
      requireImages: true,
    });

    expect(resolveForTask).toHaveBeenCalledWith({
      freeTierOnly: true,
      provider: 'google',
      requireImages: true,
      requireJsonOutput: true,
      requireStructuredOutput: true,
      taskType: 'listing_draft_generation',
    });
    expect(incrementGeminiCallsUsed).toHaveBeenCalledTimes(2);
    expect(result.selectedRoute.modelName).toBe('gemini-3.1-flash-lite');
  });

  it('falls back on quota failures', async () => {
    const executeRoute = vi
      .fn()
      .mockRejectedValueOnce(new GeminiDraftServiceError('RESOURCE_EXHAUSTED: quota reached'))
      .mockResolvedValueOnce({ title: 'draft-2' });

    const result = await generateListingDraftWithFallback({
      executeRoute,
      incrementDailyUsage: vi.fn(async () => undefined),
      now: () => new Date('2026-06-01T12:00:00.000Z'),
      routes: [createRoute(), createRoute({ modelName: 'gemini-3.1-flash-lite', routeOrder: 2 })],
    });

    expect(executeRoute).toHaveBeenCalledTimes(2);
    expect(result.selectedRoute.modelName).toBe('gemini-3.1-flash-lite');
  });

  it('falls back on unavailable failures', async () => {
    const executeRoute = vi
      .fn()
      .mockRejectedValueOnce(new GeminiDraftServiceError('503 temporarily unavailable'))
      .mockResolvedValueOnce({ title: 'draft-2' });

    const result = await generateListingDraftWithFallback({
      executeRoute,
      incrementDailyUsage: vi.fn(async () => undefined),
      now: () => new Date('2026-06-01T12:00:00.000Z'),
      routes: [createRoute(), createRoute({ modelName: 'gemini-3.1-flash-lite', routeOrder: 2 })],
    });

    expect(executeRoute).toHaveBeenCalledTimes(2);
    expect(result.selectedRoute.modelName).toBe('gemini-3.1-flash-lite');
  });

  it('stops when matching fallback flag is disabled', async () => {
    const executeRoute = vi
      .fn()
      .mockRejectedValueOnce(new GeminiDraftServiceError('429 too many requests'));

    await expect(
      generateListingDraftWithFallback({
        executeRoute,
        incrementDailyUsage: vi.fn(async () => undefined),
        now: () => new Date('2026-06-01T12:00:00.000Z'),
        routes: [
          createRoute({ fallbackOnRateLimit: false }),
          createRoute({ modelName: 'gemini-3.1-flash-lite', routeOrder: 2 }),
        ],
      })
    ).rejects.toBeInstanceOf(GeminiFallbackExecutionError);

    expect(executeRoute).toHaveBeenCalledTimes(1);
  });

  it('does not fallback on validation failures', async () => {
    const executeRoute = vi.fn(async () => {
      throw new GeminiDraftValidationError([
        {
          code: 'custom',
          message: 'bad schema',
          path: ['title'],
        } as never,
      ]);
    });

    await expect(
      generateListingDraftWithFallback({
        executeRoute,
        incrementDailyUsage: vi.fn(async () => undefined),
        now: () => new Date('2026-06-01T12:00:00.000Z'),
        routes: [createRoute(), createRoute({ modelName: 'gemini-3.1-flash-lite', routeOrder: 2 })],
      })
    ).rejects.toBeInstanceOf(GeminiFallbackExecutionError);

    expect(executeRoute).toHaveBeenCalledTimes(1);
  });

  it('increments usage once per started provider call', async () => {
    const incrementDailyUsage = vi.fn(async () => undefined);
    const executeRoute = vi
      .fn()
      .mockRejectedValueOnce(new GeminiDraftServiceError('429 too many requests'))
      .mockResolvedValueOnce({ title: 'draft-2' });

    await generateListingDraftWithFallback({
      executeRoute,
      incrementDailyUsage,
      now: () => new Date('2026-06-01T12:00:00.000Z'),
      routes: [createRoute(), createRoute({ modelName: 'gemini-3.1-flash-lite', routeOrder: 2 })],
    });

    expect(incrementDailyUsage).toHaveBeenCalledTimes(2);
  });

  it('stops before second attempt when daily usage is exhausted', async () => {
    const incrementDailyUsage = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('daily limit reached'));
    const onAttemptStarted = vi.fn(async () => undefined);
    const executeRoute = vi
      .fn()
      .mockRejectedValueOnce(new GeminiDraftServiceError('429 too many requests'));

    const promise = generateListingDraftWithFallback({
      executeRoute,
      incrementDailyUsage,
      now: () => new Date('2026-06-01T12:00:00.000Z'),
      onAttemptStarted,
      routes: [createRoute(), createRoute({ modelName: 'gemini-3.1-flash-lite', routeOrder: 2 })],
    });

    await expect(promise).rejects.toBeInstanceOf(GeminiFallbackExecutionError);

    expect(executeRoute).toHaveBeenCalledTimes(1);
    expect(onAttemptStarted).toHaveBeenCalledTimes(1);
  });

  it('does not treat a successful-attempt audit failure as a provider failure', async () => {
    const executeRoute = vi.fn(async () => ({ title: 'draft-1' }));
    const auditError = new Error('audit persistence failed');
    const onAttemptSucceeded = vi.fn(async () => {
      throw auditError;
    });

    await expect(
      generateListingDraftWithFallback({
        executeRoute,
        incrementDailyUsage: vi.fn(async () => undefined),
        now: () => new Date('2026-06-01T12:00:00.000Z'),
        onAttemptSucceeded,
        routes: [
          createRoute(),
          createRoute({ modelName: 'gemini-3.1-flash-lite', routeOrder: 2 }),
        ],
      })
    ).rejects.toBe(auditError);

    expect(executeRoute).toHaveBeenCalledTimes(1);
    expect(onAttemptSucceeded).toHaveBeenCalledTimes(1);
  });

  it('marks exhausted fallback failures recoverably', async () => {
    const executeRoute = vi
      .fn()
      .mockRejectedValueOnce(new GeminiDraftServiceError('429 too many requests'))
      .mockRejectedValueOnce(new GeminiDraftServiceError('503 unavailable'));

    await expect(
      generateListingDraftWithFallback({
        executeRoute,
        incrementDailyUsage: vi.fn(async () => undefined),
        now: () => new Date('2026-06-01T12:00:00.000Z'),
        routes: [createRoute(), createRoute({ modelName: 'gemini-3.1-flash-lite', routeOrder: 2 })],
      })
    ).rejects.toMatchObject({
      attemptedModels: ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'],
      fallbackExhausted: true,
      finalFallbackKind: 'unavailable',
      name: 'GeminiFallbackExecutionError',
    });
  });
});

describe('classifyGeminiFallbackKind', () => {
  it('detects supported fallback kinds conservatively', () => {
    expect(classifyGeminiFallbackKind(new GeminiDraftServiceError('429 too many requests'))).toBe(
      'rate_limit'
    );
    expect(
      classifyGeminiFallbackKind(new GeminiDraftServiceError('RESOURCE_EXHAUSTED: quota hit'))
    ).toBe('quota_exceeded');
    expect(
      classifyGeminiFallbackKind(new GeminiDraftServiceError('Request timed out. Connection error.'))
    ).toBe('unavailable');
    expect(
      classifyGeminiFallbackKind(new GeminiDraftServiceError('Gemini returned invalid JSON for the listing draft.'))
    ).toBe('none');
  });

  it('detects a provider 503 nested beneath a Gemini service error', () => {
    const providerError = Object.assign(new Error('high demand'), { status: 503 });
    const wrapped = new GeminiDraftServiceError('variation identity generation failed', {
      cause: providerError,
    });
    expect(classifyGeminiFallbackKind(wrapped)).toBe('unavailable');
  });

  it('does not fallback when deterministic validation is nested beneath a service error', () => {
    const validation = new GeminiDraftValidationError([
      { code: 'custom', message: 'schema quota field is invalid', path: ['title'] } as never,
    ]);
    const wrapped = new GeminiDraftServiceError('Gemini response processing failed.', {
      cause: validation,
    });

    expect(classifyGeminiFallbackKind(wrapped)).toBe('none');
  });

  it.each([400, 401, 403])(
    'does not fallback on known non-429 client error %s even when text mentions quota',
    (status) => {
      const providerError = Object.assign(new Error('quota policy rejected request'), { status });
      expect(classifyGeminiFallbackKind(providerError)).toBe('none');
    }
  );

  it('does not fallback on deterministic protected title overflow', () => {
    expect(
      classifyGeminiFallbackKind(
        new GeminiDraftTitleOverflowError({
          preCompactionTitle: 'x'.repeat(81),
          preCompactionLength: 81,
          finalTitle: 'x'.repeat(81),
          finalLength: 81,
          protectedComponents: ['Player'],
          omittedComponents: [],
        })
      )
    ).toBe('none');
  });
});
