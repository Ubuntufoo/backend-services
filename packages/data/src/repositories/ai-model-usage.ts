import type { SupabaseDataClient } from '../client.js';
import type { AiModelUsageWindowRow } from '../database.js';
import { requireSingleResult, type SingleResult } from './shared.js';

export type AiModelUsageWindowType = 'minute' | 'day';
export type AiModelUsageDeniedReason = 'minute_limit_reached' | 'day_limit_reached';

interface ReserveAiModelUsageWindowRpcRow {
  allowed: boolean;
  request_limit: number;
  remaining: number;
  requests_used: number;
  window_start: string;
  window_type: AiModelUsageWindowType;
}

interface ReserveAiModelUsageRpcRow {
  allowed: boolean;
  day_remaining: number | null;
  day_request_limit: number | null;
  day_requests_used: number | null;
  day_window_start: string | null;
  denied_reason: AiModelUsageDeniedReason | null;
  minute_remaining: number | null;
  minute_request_limit: number | null;
  minute_requests_used: number | null;
  minute_window_start: string | null;
}

export interface ReserveAiModelUsageWindowInput {
  amount?: number;
  limit: number | null | undefined;
  modelName: string;
  provider: string;
  taskType: string;
  windowStart: Date | string;
  windowType: AiModelUsageWindowType;
}

export interface AiModelUsageWindowReservation {
  limit: number;
  remaining: number;
  requestsUsed: number;
  windowStart: string;
  windowType: AiModelUsageWindowType;
}

export interface ReserveAiModelUsageWindowResult extends AiModelUsageWindowReservation {
  allowed: boolean;
  reason?: AiModelUsageDeniedReason;
}

export interface ReserveAiModelUsageInput {
  amount?: number;
  limits: {
    requestsPerDay?: number | null;
    requestsPerMinute?: number | null;
  };
  modelName: string;
  now?: Date;
  provider: string;
  taskType: string;
}

export interface ReserveAiModelUsageResult {
  allowed: boolean;
  dayWindow?: AiModelUsageWindowReservation;
  minuteWindow?: AiModelUsageWindowReservation;
  reason?: AiModelUsageDeniedReason;
  retryAfter?: string;
}

function normalizeAmount(amount?: number): number {
  const normalized = amount ?? 1;

  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw new Error('AI model usage reservation amount must be a positive integer.');
  }

  return normalized;
}

function normalizeLimit(limit: number | null | undefined): number | null {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) {
    return null;
  }

  return Math.trunc(limit);
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toReservation(
  windowType: AiModelUsageWindowType,
  windowStart: string,
  requestLimit: number,
  requestsUsed: number,
  remaining: number
): AiModelUsageWindowReservation {
  return {
    limit: requestLimit,
    remaining,
    requestsUsed,
    windowStart,
    windowType,
  };
}

export function resolveAiModelUsageWindowStart(
  windowType: AiModelUsageWindowType,
  now: Date = new Date()
): string {
  if (windowType === 'minute') {
    return new Date(Math.floor(now.getTime() / 60_000) * 60_000).toISOString();
  }

  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

export async function reserveAiModelUsageWindow(
  client: SupabaseDataClient,
  input: ReserveAiModelUsageWindowInput
): Promise<ReserveAiModelUsageWindowResult> {
  const amount = normalizeAmount(input.amount);
  const limit = normalizeLimit(input.limit);
  const windowStart = toIsoString(input.windowStart);

  if (limit === null) {
    return {
      allowed: true,
      limit: 0,
      remaining: 0,
      requestsUsed: 0,
      windowStart,
      windowType: input.windowType,
    };
  }

  const result = (await client
    .rpc('reserve_ai_model_usage_window', {
      p_amount: amount,
      p_limit: limit,
      p_model_name: input.modelName,
      p_provider: input.provider,
      p_task_type: input.taskType,
      p_window_start: windowStart,
      p_window_type: input.windowType,
    })
    .single()) as SingleResult<ReserveAiModelUsageWindowRpcRow>;

  const row = requireSingleResult(result, 'AI model usage window reservation did not return a row.');
  const reservation = toReservation(
    row.window_type,
    row.window_start,
    row.request_limit,
    row.requests_used,
    row.remaining
  );

  if (row.allowed) {
    return {
      allowed: true,
      ...reservation,
    };
  }

  return {
    allowed: false,
    reason: row.window_type === 'minute' ? 'minute_limit_reached' : 'day_limit_reached',
    ...reservation,
  };
}

export async function reserveAiModelUsage(
  client: SupabaseDataClient,
  input: ReserveAiModelUsageInput
): Promise<ReserveAiModelUsageResult> {
  const amount = normalizeAmount(input.amount);
  const requestsPerMinute = normalizeLimit(input.limits.requestsPerMinute);
  const requestsPerDay = normalizeLimit(input.limits.requestsPerDay);

  if (requestsPerMinute === null && requestsPerDay === null) {
    return { allowed: true };
  }

  const now = input.now ?? new Date();
  const result = (await client
    .rpc('reserve_ai_model_usage', {
      p_amount: amount,
      p_model_name: input.modelName,
      p_now: now.toISOString(),
      p_provider: input.provider,
      p_requests_per_day: requestsPerDay,
      p_requests_per_minute: requestsPerMinute,
      p_task_type: input.taskType,
    })
    .single()) as SingleResult<ReserveAiModelUsageRpcRow>;

  const row = requireSingleResult(result, 'AI model usage reservation did not return a row.');
  const minuteWindow =
    row.minute_request_limit !== null && row.minute_requests_used !== null && row.minute_window_start !== null
      ? toReservation(
          'minute',
          row.minute_window_start,
          row.minute_request_limit,
          row.minute_requests_used,
          row.minute_remaining ?? 0
        )
      : undefined;
  const dayWindow =
    row.day_request_limit !== null && row.day_requests_used !== null && row.day_window_start !== null
      ? toReservation('day', row.day_window_start, row.day_request_limit, row.day_requests_used, row.day_remaining ?? 0)
      : undefined;

  if (row.allowed) {
    return {
      allowed: true,
      dayWindow,
      minuteWindow,
    };
  }

  return {
    allowed: false,
    dayWindow,
    minuteWindow,
    reason: row.denied_reason ?? undefined,
    retryAfter:
      row.denied_reason === 'minute_limit_reached' && row.minute_window_start !== null
        ? new Date(new Date(row.minute_window_start).getTime() + 60_000).toISOString()
        : undefined,
  };
}

export type {
  AiModelUsageWindowRow,
};
