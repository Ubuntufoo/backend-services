import type { DailyUsageRow } from '../database.js';
import type { SupabaseDataClient } from '../client.js';
import { getAppSettings } from './app-settings.js';
import {
  requireOptionalResult,
  requireSingleResult,
  type SingleResult,
} from './shared.js';

const DEFAULT_GEMINI_DAILY_LIMIT = 500;
export const DEFAULT_ORDER_SYNC_DAILY_LIMIT = 25;
const POSTGRES_UNIQUE_VIOLATION_CODE = '23505';
const MAX_INCREMENT_RETRIES = 3;

type DailyUsageCounterName = 'gemini_calls_used' | 'order_sync_count';
type DailyUsageLimitSource = 'app_settings' | 'daily_usage' | 'default';
type DailyUsageResource = 'gemini' | 'order_sync';

interface SupabaseErrorWithCode {
  code?: string;
  message: string;
}

export interface DailyUsageLimitResolution {
  effectiveLimit: number;
  source: DailyUsageLimitSource;
  usage: DailyUsageRow;
}

export interface DailyUsageIncrementResult extends DailyUsageLimitResolution {
  resource: DailyUsageResource;
  updatedUsage: DailyUsageRow;
}

export class DailyUsageLimitExceededError extends Error {
  readonly effectiveLimit: number;
  readonly resource: DailyUsageResource;
  readonly source: DailyUsageLimitSource;
  readonly usageDate: string;
  readonly used: number;

  constructor(input: {
    effectiveLimit: number;
    resource: DailyUsageResource;
    source: DailyUsageLimitSource;
    usageDate: string;
    used: number;
  }) {
    super(
      `${input.resource} daily limit reached for ${input.usageDate}: ${input.used}/${input.effectiveLimit}.`
    );
    this.name = 'DailyUsageLimitExceededError';
    this.effectiveLimit = input.effectiveLimit;
    this.resource = input.resource;
    this.source = input.source;
    this.usageDate = input.usageDate;
    this.used = input.used;
  }
}

function isSupabaseUniqueViolation(error: unknown): error is SupabaseErrorWithCode {
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    (error as SupabaseErrorWithCode).code === POSTGRES_UNIQUE_VIOLATION_CODE
  );
}

function resolveUsageDate(usageDate?: string): string {
  return usageDate ?? new Date().toISOString().slice(0, 10);
}

async function getDailyUsageByDate(
  client: SupabaseDataClient,
  usageDate: string
): Promise<DailyUsageRow | null> {
  const result = (await client
    .from('daily_usage')
    .select('*')
    .eq('usage_date', usageDate)
    .maybeSingle()) as SingleResult<DailyUsageRow>;

  return requireOptionalResult(result);
}

async function insertDailyUsageRow(
  client: SupabaseDataClient,
  usageDate: string
): Promise<DailyUsageRow> {
  const result = (await client
    .from('daily_usage')
    .insert({ usage_date: usageDate })
    .select()
    .single()) as SingleResult<DailyUsageRow>;

  return requireSingleResult(result, `Daily usage row "${usageDate}" was not created.`);
}

function resolvePositiveLimit(
  preferred: number | null | undefined,
  fallback: number | null | undefined,
  defaultLimit: number
): Pick<DailyUsageLimitResolution, 'effectiveLimit' | 'source'> {
  if (typeof preferred === 'number' && preferred > 0) {
    return {
      effectiveLimit: preferred,
      source: 'app_settings',
    };
  }

  if (typeof fallback === 'number' && fallback > 0) {
    return {
      effectiveLimit: fallback,
      source: 'daily_usage',
    };
  }

  return {
    effectiveLimit: defaultLimit,
    source: 'default',
  };
}

async function resolveLimit(
  client: SupabaseDataClient,
  usageDate: string,
  resource: DailyUsageResource
): Promise<DailyUsageLimitResolution> {
  const usage = await getOrCreateDailyUsage(client, usageDate);
  const appSettings = await getAppSettings(client);

  if (resource === 'gemini') {
    return {
      ...resolvePositiveLimit(
        appSettings?.gemini_daily_limit,
        usage.gemini_daily_limit,
        DEFAULT_GEMINI_DAILY_LIMIT
      ),
      usage,
    };
  }

  return {
    ...resolvePositiveLimit(
      appSettings?.max_order_syncs_per_day,
      undefined,
      DEFAULT_ORDER_SYNC_DAILY_LIMIT
    ),
    usage,
  };
}

async function incrementUsageCounter(
  client: SupabaseDataClient,
  resource: DailyUsageResource,
  counter: DailyUsageCounterName,
  usageDate?: string
): Promise<DailyUsageIncrementResult> {
  const resolvedUsageDate = resolveUsageDate(usageDate);

  for (let attempt = 0; attempt < MAX_INCREMENT_RETRIES; attempt += 1) {
    const resolution = await resolveLimit(client, resolvedUsageDate, resource);
    const used = resolution.usage[counter];

    if (used >= resolution.effectiveLimit) {
      throw new DailyUsageLimitExceededError({
        effectiveLimit: resolution.effectiveLimit,
        resource,
        source: resolution.source,
        usageDate: resolvedUsageDate,
        used,
      });
    }

    const result = (await client
      .from('daily_usage')
      .update({
        [counter]: used + 1,
      })
      .eq('usage_date', resolvedUsageDate)
      .eq(counter, used)
      .select()
      .maybeSingle()) as SingleResult<DailyUsageRow>;

    if (result.error) {
      throw new Error(result.error.message);
    }

    if (result.data) {
      return {
        effectiveLimit: resolution.effectiveLimit,
        resource,
        source: resolution.source,
        updatedUsage: result.data,
        usage: resolution.usage,
      };
    }
  }

  throw new Error(`Daily usage counter "${counter}" could not be incremented for "${resolvedUsageDate}".`);
}

export async function getOrCreateDailyUsage(
  client: SupabaseDataClient,
  usageDate?: string
): Promise<DailyUsageRow> {
  const resolvedUsageDate = resolveUsageDate(usageDate);
  const existing = await getDailyUsageByDate(client, resolvedUsageDate);

  if (existing) {
    return existing;
  }

  try {
    return await insertDailyUsageRow(client, resolvedUsageDate);
  } catch (error) {
    if (!isSupabaseUniqueViolation(error)) {
      throw error;
    }
  }

  const createdElsewhere = await getDailyUsageByDate(client, resolvedUsageDate);

  if (!createdElsewhere) {
    throw new Error(`Daily usage row "${resolvedUsageDate}" was not readable after insert conflict.`);
  }

  return createdElsewhere;
}

export async function getEffectiveGeminiDailyLimit(
  client: SupabaseDataClient,
  usageDate?: string
): Promise<DailyUsageLimitResolution> {
  return await resolveLimit(client, resolveUsageDate(usageDate), 'gemini');
}

export async function getEffectiveOrderSyncDailyLimit(
  client: SupabaseDataClient,
  usageDate?: string
): Promise<DailyUsageLimitResolution> {
  return await resolveLimit(client, resolveUsageDate(usageDate), 'order_sync');
}

export async function incrementGeminiCallsUsed(
  client: SupabaseDataClient,
  usageDate?: string
): Promise<DailyUsageIncrementResult> {
  return await incrementUsageCounter(client, 'gemini', 'gemini_calls_used', usageDate);
}

export async function incrementOrderSyncCount(
  client: SupabaseDataClient,
  usageDate?: string
): Promise<DailyUsageIncrementResult> {
  return await incrementUsageCounter(client, 'order_sync', 'order_sync_count', usageDate);
}
