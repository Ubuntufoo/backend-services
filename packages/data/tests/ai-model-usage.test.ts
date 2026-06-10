import { describe, expect, it, vi } from 'vitest';
import type { SupabaseDataClient } from '../src/client.js';
import type { AiModelUsageWindowRow } from '../src/database.js';
import {
  reserveAiModelUsage,
  reserveAiModelUsageWindow,
  resolveAiModelUsageWindowStart,
} from '../src/repositories/ai-model-usage.js';

type WindowType = 'minute' | 'day';

type UsageKey = `${string}|${string}|${string}|${WindowType}|${string}`;

function buildUsageKey(row: Pick<AiModelUsageWindowRow, 'provider' | 'model_name' | 'task_type' | 'window_type' | 'window_start'>): UsageKey {
  return `${row.provider}|${row.model_name}|${row.task_type}|${row.window_type as WindowType}|${row.window_start}`;
}

function createUsageClient() {
  const windows = new Map<UsageKey, AiModelUsageWindowRow>();

  const rpc = vi.fn((fn: string, args?: Record<string, unknown>) => {
    const input = args ?? {};

    if (fn === 'reserve_ai_model_usage_window') {
      const key = buildUsageKey({
        model_name: String(input.p_model_name),
        provider: String(input.p_provider),
        task_type: String(input.p_task_type),
        window_start: String(input.p_window_start),
        window_type: String(input.p_window_type) as WindowType,
      });
      const amount = Number(input.p_amount ?? 1);
      const limit = Number(input.p_limit);
      const current = windows.get(key);
      const nextUsed = (current?.requests_used ?? 0) + amount;

      const row =
        nextUsed <= limit
          ? (() => {
              const nextRow: AiModelUsageWindowRow = {
                created_at: current?.created_at ?? String(input.p_window_start),
                id: current?.id ?? `usage-${windows.size + 1}`,
                model_name: String(input.p_model_name),
                provider: String(input.p_provider),
                requests_used: nextUsed,
                task_type: String(input.p_task_type),
                updated_at: String(input.p_window_start),
                window_start: String(input.p_window_start),
                window_type: String(input.p_window_type),
              };
              windows.set(key, nextRow);
              return {
                allowed: true,
                remaining: limit - nextUsed,
                request_limit: limit,
                requests_used: nextUsed,
                window_start: nextRow.window_start,
                window_type: nextRow.window_type as WindowType,
              };
            })()
          : {
              allowed: false,
              remaining: Math.max(limit - (current?.requests_used ?? 0), 0),
              request_limit: limit,
              requests_used: current?.requests_used ?? 0,
              window_start: String(input.p_window_start),
              window_type: String(input.p_window_type) as WindowType,
            };

      return {
        single: vi.fn(async () => ({
          data: row,
          error: null,
        })),
      };
    }

    if (fn === 'reserve_ai_model_usage') {
      const amount = Number(input.p_amount ?? 1);
      const now = new Date(String(input.p_now));
      const minuteLimit = Number(input.p_requests_per_minute ?? 0);
      const dayLimit = Number(input.p_requests_per_day ?? 0);
      const provider = String(input.p_provider);
      const modelName = String(input.p_model_name);
      const taskType = String(input.p_task_type);
      const minuteWindowStart = resolveAiModelUsageWindowStart('minute', now);
      const dayWindowStart = resolveAiModelUsageWindowStart('day', now);
      const minuteKey = buildUsageKey({
        model_name: modelName,
        provider,
        task_type: taskType,
        window_start: minuteWindowStart,
        window_type: 'minute',
      });
      const dayKey = buildUsageKey({
        model_name: modelName,
        provider,
        task_type: taskType,
        window_start: dayWindowStart,
        window_type: 'day',
      });
      const minuteCurrent = windows.get(minuteKey);
      const dayCurrent = windows.get(dayKey);

      if (minuteLimit > 0 && (minuteCurrent?.requests_used ?? 0) + amount > minuteLimit) {
        return {
          single: vi.fn(async () => ({
            data: {
              allowed: false,
              day_remaining: null,
              day_request_limit: null,
              day_requests_used: null,
              day_window_start: null,
              denied_reason: 'minute_limit_reached',
              minute_remaining: Math.max(minuteLimit - (minuteCurrent?.requests_used ?? 0), 0),
              minute_request_limit: minuteLimit,
              minute_requests_used: minuteCurrent?.requests_used ?? 0,
              minute_window_start: minuteWindowStart,
            },
            error: null,
          })),
        };
      }

      if (dayLimit > 0 && (dayCurrent?.requests_used ?? 0) + amount > dayLimit) {
        return {
          single: vi.fn(async () => ({
            data: {
              allowed: false,
              day_remaining: Math.max(dayLimit - (dayCurrent?.requests_used ?? 0), 0),
              day_request_limit: dayLimit,
              day_requests_used: dayCurrent?.requests_used ?? 0,
              day_window_start: dayWindowStart,
              denied_reason: 'day_limit_reached',
              minute_remaining:
                minuteLimit > 0 ? Math.max(minuteLimit - (minuteCurrent?.requests_used ?? 0), 0) : null,
              minute_request_limit: minuteLimit > 0 ? minuteLimit : null,
              minute_requests_used: minuteLimit > 0 ? minuteCurrent?.requests_used ?? 0 : null,
              minute_window_start: minuteLimit > 0 ? minuteWindowStart : null,
            },
            error: null,
          })),
        };
      }

      let minuteRequestsUsed: number | null = null;
      let dayRequestsUsed: number | null = null;

      if (minuteLimit > 0) {
        const nextMinuteUsed = (minuteCurrent?.requests_used ?? 0) + amount;
        minuteRequestsUsed = nextMinuteUsed;
        windows.set(minuteKey, {
          created_at: minuteCurrent?.created_at ?? minuteWindowStart,
          id: minuteCurrent?.id ?? `usage-${windows.size + 1}`,
          model_name: modelName,
          provider,
          requests_used: nextMinuteUsed,
          task_type: taskType,
          updated_at: minuteWindowStart,
          window_start: minuteWindowStart,
          window_type: 'minute',
        });
      }

      if (dayLimit > 0) {
        const nextDayUsed = (dayCurrent?.requests_used ?? 0) + amount;
        dayRequestsUsed = nextDayUsed;
        windows.set(dayKey, {
          created_at: dayCurrent?.created_at ?? dayWindowStart,
          id: dayCurrent?.id ?? `usage-${windows.size + 1}`,
          model_name: modelName,
          provider,
          requests_used: nextDayUsed,
          task_type: taskType,
          updated_at: dayWindowStart,
          window_start: dayWindowStart,
          window_type: 'day',
        });
      }

      return {
        single: vi.fn(async () => ({
          data: {
            allowed: true,
            day_remaining: dayLimit > 0 ? Math.max(dayLimit - (dayRequestsUsed ?? 0), 0) : null,
            day_request_limit: dayLimit > 0 ? dayLimit : null,
            day_requests_used: dayRequestsUsed,
            day_window_start: dayLimit > 0 ? dayWindowStart : null,
            denied_reason: null,
            minute_remaining: minuteLimit > 0 ? Math.max(minuteLimit - (minuteRequestsUsed ?? 0), 0) : null,
            minute_request_limit: minuteLimit > 0 ? minuteLimit : null,
            minute_requests_used: minuteRequestsUsed,
            minute_window_start: minuteLimit > 0 ? minuteWindowStart : null,
          },
          error: null,
        })),
      };
    }

    throw new Error(`Unexpected RPC ${fn}`);
  }) as unknown as SupabaseDataClient['rpc'];

  const client: SupabaseDataClient = {
    from: vi.fn(),
    rpc,
  };

  return {
    client,
    getWindow: (input: {
      modelName: string;
      provider: string;
      taskType: string;
      windowStart: string;
      windowType: WindowType;
    }) =>
      windows.get(
        buildUsageKey({
          model_name: input.modelName,
          provider: input.provider,
          task_type: input.taskType,
          window_start: input.windowStart,
          window_type: input.windowType,
        })
      ) ?? null,
    listWindows: () => [...windows.values()],
  };
}

describe('ai-model-usage repository', () => {
  it('creates minute window and increments to 1, then increments existing window', async () => {
    const harness = createUsageClient();
    const windowStart = '2026-06-10T12:34:00.000Z';

    await expect(
      reserveAiModelUsageWindow(harness.client, {
        limit: 15,
        modelName: 'gemma-4-31b-it',
        provider: 'google',
        taskType: 'pricing_reasoning',
        windowStart,
        windowType: 'minute',
      })
    ).resolves.toEqual({
      allowed: true,
      limit: 15,
      remaining: 14,
      requestsUsed: 1,
      windowStart,
      windowType: 'minute',
    });

    await expect(
      reserveAiModelUsageWindow(harness.client, {
        limit: 15,
        modelName: 'gemma-4-31b-it',
        provider: 'google',
        taskType: 'pricing_reasoning',
        windowStart,
        windowType: 'minute',
      })
    ).resolves.toEqual({
      allowed: true,
      limit: 15,
      remaining: 13,
      requestsUsed: 2,
      windowStart,
      windowType: 'minute',
    });
  });

  it('denies when minute limit would be exceeded', async () => {
    const harness = createUsageClient();
    const windowStart = '2026-06-10T12:34:00.000Z';

    await reserveAiModelUsageWindow(harness.client, {
      limit: 1,
      modelName: 'gemma-4-31b-it',
      provider: 'google',
      taskType: 'pricing_reasoning',
      windowStart,
      windowType: 'minute',
    });

    await expect(
      reserveAiModelUsageWindow(harness.client, {
        limit: 1,
        modelName: 'gemma-4-31b-it',
        provider: 'google',
        taskType: 'pricing_reasoning',
        windowStart,
        windowType: 'minute',
      })
    ).resolves.toEqual({
      allowed: false,
      limit: 1,
      reason: 'minute_limit_reached',
      remaining: 0,
      requestsUsed: 1,
      windowStart,
      windowType: 'minute',
    });
  });

  it('creates day window and denies when day limit would be exceeded', async () => {
    const harness = createUsageClient();
    const windowStart = '2026-06-10T00:00:00.000Z';

    await expect(
      reserveAiModelUsageWindow(harness.client, {
        limit: 1,
        modelName: 'gemma-4-31b-it',
        provider: 'google',
        taskType: 'pricing_reasoning',
        windowStart,
        windowType: 'day',
      })
    ).resolves.toEqual({
      allowed: true,
      limit: 1,
      remaining: 0,
      requestsUsed: 1,
      windowStart,
      windowType: 'day',
    });

    await expect(
      reserveAiModelUsageWindow(harness.client, {
        limit: 1,
        modelName: 'gemma-4-31b-it',
        provider: 'google',
        taskType: 'pricing_reasoning',
        windowStart,
        windowType: 'day',
      })
    ).resolves.toEqual({
      allowed: false,
      limit: 1,
      reason: 'day_limit_reached',
      remaining: 0,
      requestsUsed: 1,
      windowStart,
      windowType: 'day',
    });
  });

  it('reserves both minute and day windows successfully', async () => {
    const harness = createUsageClient();

    await expect(
      reserveAiModelUsage(harness.client, {
        limits: {
          requestsPerDay: 1500,
          requestsPerMinute: 15,
        },
        modelName: 'gemma-4-31b-it',
        now: new Date('2026-06-10T12:34:56.789Z'),
        provider: 'google',
        taskType: 'pricing_reasoning',
      })
    ).resolves.toEqual({
      allowed: true,
      dayWindow: {
        limit: 1500,
        remaining: 1499,
        requestsUsed: 1,
        windowStart: '2026-06-10T00:00:00.000Z',
        windowType: 'day',
      },
      minuteWindow: {
        limit: 15,
        remaining: 14,
        requestsUsed: 1,
        windowStart: '2026-06-10T12:34:00.000Z',
        windowType: 'minute',
      },
    });
  });

  it('does not reserve day if minute denied and reports prior minute usage unchanged when day denied', async () => {
    const harness = createUsageClient();

    await reserveAiModelUsage(harness.client, {
      limits: {
        requestsPerDay: 1500,
        requestsPerMinute: 1,
      },
      modelName: 'gemma-4-31b-it',
      now: new Date('2026-06-10T12:34:10.000Z'),
      provider: 'google',
      taskType: 'pricing_reasoning',
    });

    await expect(
      reserveAiModelUsage(harness.client, {
        limits: {
          requestsPerDay: 1500,
          requestsPerMinute: 1,
        },
        modelName: 'gemma-4-31b-it',
        now: new Date('2026-06-10T12:34:40.000Z'),
        provider: 'google',
        taskType: 'pricing_reasoning',
      })
    ).resolves.toMatchObject({
      allowed: false,
      reason: 'minute_limit_reached',
    });

    expect(
      harness.getWindow({
        modelName: 'gemma-4-31b-it',
        provider: 'google',
        taskType: 'pricing_reasoning',
        windowStart: '2026-06-10T00:00:00.000Z',
        windowType: 'day',
      })?.requests_used
    ).toBe(1);

    const dayDeniedHarness = createUsageClient();
    await reserveAiModelUsage(dayDeniedHarness.client, {
      limits: {
        requestsPerDay: 1,
        requestsPerMinute: 15,
      },
      modelName: 'gemma-4-31b-it',
      now: new Date('2026-06-10T12:34:10.000Z'),
      provider: 'google',
      taskType: 'pricing_reasoning',
    });

    await expect(
      reserveAiModelUsage(dayDeniedHarness.client, {
        limits: {
          requestsPerDay: 1,
          requestsPerMinute: 15,
        },
        modelName: 'gemma-4-31b-it',
        now: new Date('2026-06-10T12:34:40.000Z'),
        provider: 'google',
        taskType: 'pricing_reasoning',
      })
    ).resolves.toMatchObject({
      allowed: false,
      dayWindow: {
        requestsUsed: 1,
      },
      minuteWindow: {
        requestsUsed: 1,
      },
      reason: 'day_limit_reached',
    });

    // Day denial must not consume or compensate minute usage; caller sees
    // unchanged preexisting minute usage for that window.
    expect(
      dayDeniedHarness.getWindow({
        modelName: 'gemma-4-31b-it',
        provider: 'google',
        taskType: 'pricing_reasoning',
        windowStart: '2026-06-10T12:34:00.000Z',
        windowType: 'minute',
      })?.requests_used
    ).toBe(1);
  });

  it('skips windows for null, undefined, and non-positive limits', async () => {
    const harness = createUsageClient();

    await expect(
      reserveAiModelUsage(harness.client, {
        limits: {
          requestsPerDay: 0,
          requestsPerMinute: null,
        },
        modelName: 'gemma-4-31b-it',
        provider: 'google',
        taskType: 'pricing_reasoning',
      })
    ).resolves.toEqual({ allowed: true });

    await expect(
      reserveAiModelUsageWindow(harness.client, {
        limit: undefined,
        modelName: 'gemma-4-31b-it',
        provider: 'google',
        taskType: 'pricing_reasoning',
        windowStart: '2026-06-10T12:34:00.000Z',
        windowType: 'minute',
      })
    ).resolves.toEqual({
      allowed: true,
      limit: 0,
      remaining: 0,
      requestsUsed: 0,
      windowStart: '2026-06-10T12:34:00.000Z',
      windowType: 'minute',
    });

    expect(harness.listWindows()).toHaveLength(0);
  });

  it('keeps unique windows per provider/model/task/window and separates task, model, provider', async () => {
    const harness = createUsageClient();
    const windowStart = '2026-06-10T12:34:00.000Z';

    await reserveAiModelUsageWindow(harness.client, {
      limit: 15,
      modelName: 'gemma-4-31b-it',
      provider: 'google',
      taskType: 'pricing_reasoning',
      windowStart,
      windowType: 'minute',
    });
    await reserveAiModelUsageWindow(harness.client, {
      limit: 15,
      modelName: 'gemma-4-31b-it',
      provider: 'google',
      taskType: 'pricing_reasoning',
      windowStart,
      windowType: 'minute',
    });
    await reserveAiModelUsageWindow(harness.client, {
      limit: 15,
      modelName: 'gemma-4-31b-it',
      provider: 'google',
      taskType: 'listing_draft_generation',
      windowStart,
      windowType: 'minute',
    });
    await reserveAiModelUsageWindow(harness.client, {
      limit: 15,
      modelName: 'gemini-3.1-flash-lite',
      provider: 'google',
      taskType: 'pricing_reasoning',
      windowStart,
      windowType: 'minute',
    });
    await reserveAiModelUsageWindow(harness.client, {
      limit: 15,
      modelName: 'gemma-4-31b-it',
      provider: 'openai',
      taskType: 'pricing_reasoning',
      windowStart,
      windowType: 'minute',
    });

    expect(harness.listWindows()).toHaveLength(4);
    expect(
      harness.getWindow({
        modelName: 'gemma-4-31b-it',
        provider: 'google',
        taskType: 'pricing_reasoning',
        windowStart,
        windowType: 'minute',
      })?.requests_used
    ).toBe(2);
    expect(
      harness.getWindow({
        modelName: 'gemma-4-31b-it',
        provider: 'google',
        taskType: 'listing_draft_generation',
        windowStart,
        windowType: 'minute',
      })?.requests_used
    ).toBe(1);
    expect(
      harness.getWindow({
        modelName: 'gemini-3.1-flash-lite',
        provider: 'google',
        taskType: 'pricing_reasoning',
        windowStart,
        windowType: 'minute',
      })?.requests_used
    ).toBe(1);
    expect(
      harness.getWindow({
        modelName: 'gemma-4-31b-it',
        provider: 'openai',
        taskType: 'pricing_reasoning',
        windowStart,
        windowType: 'minute',
      })?.requests_used
    ).toBe(1);
  });

  it('builds UTC minute/day windows and represents Gemma pricing limits', async () => {
    expect(resolveAiModelUsageWindowStart('minute', new Date('2026-06-10T12:34:56.789Z'))).toBe(
      '2026-06-10T12:34:00.000Z'
    );
    expect(resolveAiModelUsageWindowStart('day', new Date('2026-06-10T12:34:56.789Z'))).toBe(
      '2026-06-10T00:00:00.000Z'
    );

    const harness = createUsageClient();
    await expect(
      reserveAiModelUsage(harness.client, {
        limits: {
          requestsPerDay: 1500,
          requestsPerMinute: 15,
        },
        modelName: 'gemma-4-31b-it',
        now: new Date('2026-06-10T12:34:56.789Z'),
        provider: 'google',
        taskType: 'pricing_reasoning',
      })
    ).resolves.toMatchObject({
      allowed: true,
      dayWindow: {
        limit: 1500,
      },
      minuteWindow: {
        limit: 15,
      },
    });
  });
});
