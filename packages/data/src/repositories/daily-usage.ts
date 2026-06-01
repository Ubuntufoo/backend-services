import type { DailyUsageRow } from '../database.js';
import type { SupabaseDataClient } from '../client.js';
import { getAppSettings } from './app-settings.js';
import {
  type MultiResult,
  requireOptionalResult,
  requireSingleResult,
  type SingleResult,
} from './shared.js';

const DEFAULT_GEMINI_DAILY_LIMIT = 500;
export const DEFAULT_ORDER_SYNC_DAILY_LIMIT = 25;
const POSTGRES_UNIQUE_VIOLATION_CODE = '23505';
const MAX_INCREMENT_RETRIES = 3;
export const GEMINI_USAGE_TIME_ZONE = 'America/Los_Angeles';

type DailyUsageCounterName = 'gemini_calls_used' | 'order_sync_count';
type DailyUsageLimitSource = 'app_settings' | 'daily_usage' | 'route_capacity' | 'default';
type DailyUsageResource = 'gemini' | 'order_sync';
const GEMINI_ROUTE_CAPACITY_PROVIDER = 'google';
const GEMINI_ROUTE_CAPACITY_TASK_TYPE = 'listing_draft_generation';

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

export interface GeminiDailyUsageWindow {
  resetAt: string;
  resetTimeZone: typeof GEMINI_USAGE_TIME_ZONE;
  usageDate: string;
}

export interface GeminiDailyUsageSummary extends GeminiDailyUsageWindow {
  effectiveLimit: number;
  remaining: number;
  used: number;
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

function getDateFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric',
  });
}

function getDateTimeFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    month: '2-digit',
    second: '2-digit',
    timeZone,
    year: 'numeric',
  });
}

function formatDateParts(date: Date, timeZone: string): Record<string, string> {
  return getDateFormatter(timeZone).formatToParts(date).reduce<Record<string, string>>(
    (parts, part) => {
      if (part.type !== 'literal') {
        parts[part.type] = part.value;
      }

      return parts;
    },
    {}
  );
}

function formatDateTimeParts(date: Date, timeZone: string): Record<string, string> {
  return getDateTimeFormatter(timeZone).formatToParts(date).reduce<Record<string, string>>(
    (parts, part) => {
      if (part.type !== 'literal') {
        parts[part.type] = part.value;
      }

      return parts;
    },
    {}
  );
}

function toUsageDateString(parts: Record<string, string>): string {
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addDaysToIsoDate(usageDate: string, days: number): string {
  const [year, month, day] = usageDate.split('-').map((value) => Number(value));
  const utcDate = new Date(Date.UTC(year, month - 1, day + days));
  return utcDate.toISOString().slice(0, 10);
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = formatDateTimeParts(date, timeZone);
  const zonedTimestamp = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );

  return zonedTimestamp - date.getTime();
}

function zonedMidnightToUtc(usageDate: string, timeZone: string): Date {
  const [year, month, day] = usageDate.split('-').map((value) => Number(value));
  let timestamp = Date.UTC(year, month - 1, day, 0, 0, 0, 0);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const offset = getTimeZoneOffsetMs(new Date(timestamp), timeZone);
    const nextTimestamp = Date.UTC(year, month - 1, day, 0, 0, 0, 0) - offset;

    if (nextTimestamp === timestamp) {
      break;
    }

    timestamp = nextTimestamp;
  }

  return new Date(timestamp);
}

export function resolveGeminiDailyUsageWindow(now: Date = new Date()): GeminiDailyUsageWindow {
  const usageDateParts = formatDateParts(now, GEMINI_USAGE_TIME_ZONE);
  const usageDate = toUsageDateString(usageDateParts);
  const nextUsageDate = addDaysToIsoDate(usageDate, 1);

  return {
    resetAt: zonedMidnightToUtc(nextUsageDate, GEMINI_USAGE_TIME_ZONE).toISOString(),
    resetTimeZone: GEMINI_USAGE_TIME_ZONE,
    usageDate,
  };
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

type GeminiRouteCapacityCatalogRow = {
  free_tier_daily_request_limit: number | null;
  is_enabled: boolean;
  is_free_tier_eligible: boolean;
};

type GeminiRouteCapacityRow = {
  catalog: GeminiRouteCapacityCatalogRow | GeminiRouteCapacityCatalogRow[] | null;
  route_is_enabled: boolean;
  model_name: string;
};

function getGeminiRouteCapacityCatalog(
  row: GeminiRouteCapacityRow
): GeminiRouteCapacityCatalogRow | null {
  if (Array.isArray(row.catalog)) {
    return row.catalog[0] ?? null;
  }

  return row.catalog;
}

async function getGeminiRouteCapacityLimit(
  client: SupabaseDataClient
): Promise<number | null> {
  const result = (await client
    .from('ai_model_task_routes')
    .select(
      'model_name, route_is_enabled:is_enabled, catalog:ai_model_catalog!inner(is_enabled, is_free_tier_eligible, free_tier_daily_request_limit)'
    )
    .eq('task_type', GEMINI_ROUTE_CAPACITY_TASK_TYPE)
    .eq('provider', GEMINI_ROUTE_CAPACITY_PROVIDER)
    .eq('is_enabled', true)
    .eq('catalog.is_enabled', true)
    .eq('catalog.is_free_tier_eligible', true)) as MultiResult<GeminiRouteCapacityRow>;

  if (result.error) {
    throw new Error(result.error.message);
  }

  const totalCapacity = (result.data ?? []).reduce((sum, row) => {
    const catalog = getGeminiRouteCapacityCatalog(row);

    if (!row.route_is_enabled || !catalog?.is_enabled || !catalog.is_free_tier_eligible) {
      return sum;
    }

    const limit = catalog.free_tier_daily_request_limit;

    if (typeof limit !== 'number' || limit <= 0) {
      return sum;
    }

    return sum + limit;
  }, 0);

  return totalCapacity > 0 ? totalCapacity : null;
}

async function resolveLimit(
  client: SupabaseDataClient,
  usageDate: string,
  resource: DailyUsageResource
): Promise<DailyUsageLimitResolution> {
  const usage = await getOrCreateDailyUsage(client, usageDate);
  const appSettings = await getAppSettings(client);

  if (resource === 'gemini') {
    const routeCapacityLimit = await getGeminiRouteCapacityLimit(client);
    const preferredLimit = appSettings?.gemini_daily_limit;
    const fallbackLimit = usage.gemini_daily_limit;

    if (typeof preferredLimit === 'number' && preferredLimit > 0) {
      return {
        effectiveLimit: preferredLimit,
        source: 'app_settings',
        usage,
      };
    }

    if (typeof fallbackLimit === 'number' && fallbackLimit > 0) {
      return {
        effectiveLimit: fallbackLimit,
        source: 'daily_usage',
        usage,
      };
    }

    if (typeof routeCapacityLimit === 'number' && routeCapacityLimit > 0) {
      return {
        effectiveLimit: routeCapacityLimit,
        source: 'route_capacity',
        usage,
      };
    }

    return {
      ...resolvePositiveLimit(undefined, undefined, DEFAULT_GEMINI_DAILY_LIMIT),
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
  return await resolveLimit(
    client,
    usageDate ?? resolveGeminiDailyUsageWindow().usageDate,
    'gemini'
  );
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
  return await incrementUsageCounter(
    client,
    'gemini',
    'gemini_calls_used',
    usageDate ?? resolveGeminiDailyUsageWindow().usageDate
  );
}

export async function incrementOrderSyncCount(
  client: SupabaseDataClient,
  usageDate?: string
): Promise<DailyUsageIncrementResult> {
  return await incrementUsageCounter(client, 'order_sync', 'order_sync_count', usageDate);
}

export async function getGeminiDailyUsageSummary(
  client: SupabaseDataClient,
  now: Date = new Date()
): Promise<GeminiDailyUsageSummary> {
  const window = resolveGeminiDailyUsageWindow(now);
  const resolution = await getEffectiveGeminiDailyLimit(client, window.usageDate);
  const used = resolution.usage.gemini_calls_used;

  return {
    effectiveLimit: resolution.effectiveLimit,
    remaining: Math.max(resolution.effectiveLimit - used, 0),
    resetAt: window.resetAt,
    resetTimeZone: window.resetTimeZone,
    usageDate: window.usageDate,
    used,
  };
}
