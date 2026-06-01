import type { ResolvedAiModelRoute } from '@ebay-inventory/data';
import { describe, expect, it, vi } from 'vitest';
import {
  classifyGeminiFallbackKind,
  GeminiDraftServiceError,
  GeminiDraftValidationError,
  GeminiFallbackExecutionError,
  generateListingDraftWithFallback,
} from '@/gemini/index.js';

function createRoute(overrides: Partial<ResolvedAiModelRoute> = {}): ResolvedAiModelRoute {
  return {
    displayName: 'Gemini 3.1 Flash Lite',
    fallbackOnQuotaExceeded: true,
    fallbackOnRateLimit: true,
    fallbackOnUnavailable: true,
    freeTierStatus: 'unknown',
    isFreeTierEligible: true,
    modelName: 'gemini-3.1-flash-lite',
    provider: 'google',
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
      routes: [createRoute(), createRoute({ modelName: 'gemini-3.1-pro', routeOrder: 2 })],
    });

    expect(executeRoute).toHaveBeenCalledTimes(1);
    expect(result.draft).toEqual({ title: 'draft-1' });
    expect(result.selectedRoute.modelName).toBe('gemini-3.1-flash-lite');
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
      routes: [createRoute(), createRoute({ modelName: 'gemini-3.1-pro', routeOrder: 2 })],
    });

    expect(executeRoute).toHaveBeenCalledTimes(2);
    expect(result.selectedRoute.modelName).toBe('gemini-3.1-pro');
    expect(result.attempts.map((attempt) => attempt.status)).toEqual(['failed', 'succeeded']);
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
      routes: [createRoute(), createRoute({ modelName: 'gemini-3.1-pro', routeOrder: 2 })],
    });

    expect(executeRoute).toHaveBeenCalledTimes(2);
    expect(result.selectedRoute.modelName).toBe('gemini-3.1-pro');
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
      routes: [createRoute(), createRoute({ modelName: 'gemini-3.1-pro', routeOrder: 2 })],
    });

    expect(executeRoute).toHaveBeenCalledTimes(2);
    expect(result.selectedRoute.modelName).toBe('gemini-3.1-pro');
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
          createRoute({ modelName: 'gemini-3.1-pro', routeOrder: 2 }),
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
        routes: [createRoute(), createRoute({ modelName: 'gemini-3.1-pro', routeOrder: 2 })],
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
      routes: [createRoute(), createRoute({ modelName: 'gemini-3.1-pro', routeOrder: 2 })],
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
      routes: [createRoute(), createRoute({ modelName: 'gemini-3.1-pro', routeOrder: 2 })],
    });

    await expect(promise).rejects.toBeInstanceOf(GeminiFallbackExecutionError);

    expect(executeRoute).toHaveBeenCalledTimes(1);
    expect(onAttemptStarted).toHaveBeenCalledTimes(1);
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
        routes: [createRoute(), createRoute({ modelName: 'gemini-3.1-pro', routeOrder: 2 })],
      })
    ).rejects.toMatchObject({
      attemptedModels: ['gemini-3.1-flash-lite', 'gemini-3.1-pro'],
      fallbackExhausted: true,
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
});
