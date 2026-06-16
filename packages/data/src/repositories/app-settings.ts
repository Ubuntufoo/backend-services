import type { AppSettingsInsert, AppSettingsRow, AppSettingsUpdate } from '../database.js';
import type { SupabaseDataClient } from '../client.js';
import {
  PRICING_PROVIDER_MODES,
  type PricingProviderMode,
} from '@ebay-inventory/types';
import {
  requireOptionalResult,
  requireSingleResult,
  type SingleResult,
} from './shared.js';

export const DEFAULT_APP_SETTINGS_ID = 'default';
export const DEFAULT_PRICING_PROVIDER_MODE: PricingProviderMode = 'soldcomps';
const ENABLED_PRICING_PROVIDER_MODES = new Set<PricingProviderMode>(['soldcomps', 'apify']);
const PRICING_PROVIDER_MODE_SET = new Set<string>(PRICING_PROVIDER_MODES);

export interface SoldCompsUsageSnapshot {
  limit: number | null;
  source: 'headers' | 'malformed' | 'missing';
  updatedAt: string;
  used: number | null;
}

type PricingAppSettingsLike = {
  pricing_provider_mode?: AppSettingsRow['pricing_provider_mode'] | null;
  pricing_service_enabled?: boolean | null;
} | null | undefined;

export function getPricingProviderMode(
  appSettings: PricingAppSettingsLike
): PricingProviderMode {
  if (
    typeof appSettings?.pricing_provider_mode === 'string' &&
    PRICING_PROVIDER_MODE_SET.has(appSettings.pricing_provider_mode)
  ) {
    return appSettings.pricing_provider_mode as PricingProviderMode;
  }

  if (appSettings?.pricing_service_enabled === false) {
    return 'off';
  }

  return DEFAULT_PRICING_PROVIDER_MODE;
}

export function isPricingProviderModeEnabled(mode: PricingProviderMode): boolean {
  return ENABLED_PRICING_PROVIDER_MODES.has(mode);
}

export function isPricingEnabled(
  appSettings: PricingAppSettingsLike
): boolean {
  return isPricingProviderModeEnabled(getPricingProviderMode(appSettings));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeNullableInteger(value: unknown): number | null | undefined {
  if (value === null) {
    return null;
  }

  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return undefined;
  }

  return value;
}

export function parseSoldCompsUsageSnapshot(value: unknown): SoldCompsUsageSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }

  const updatedAt = typeof value.updatedAt === 'string' ? value.updatedAt.trim() : '';
  const used = normalizeNullableInteger(value.used);
  const limit = normalizeNullableInteger(value.limit);
  const source = value.source;

  if (!updatedAt || (used === undefined && limit === undefined)) {
    return null;
  }

  if (source !== 'headers' && source !== 'malformed' && source !== 'missing') {
    return null;
  }

  return {
    limit: limit ?? null,
    source,
    updatedAt,
    used: used ?? null,
  };
}

export async function createAppSettings(
  client: SupabaseDataClient,
  input: AppSettingsInsert
): Promise<AppSettingsRow> {
  const result = (await client
    .from('app_settings')
    .insert(input)
    .select()
    .single()) as SingleResult<AppSettingsRow>;

  return requireSingleResult(result, 'App settings row was not created.');
}

export async function getAppSettings(
  client: SupabaseDataClient,
  id = DEFAULT_APP_SETTINGS_ID
): Promise<AppSettingsRow | null> {
  const result = (await client
    .from('app_settings')
    .select('*')
    .eq('id', id)
    .maybeSingle()) as SingleResult<AppSettingsRow>;

  return requireOptionalResult(result);
}

export async function updateAppSettings(
  client: SupabaseDataClient,
  changes: AppSettingsUpdate,
  id = DEFAULT_APP_SETTINGS_ID
): Promise<AppSettingsRow> {
  const result = await client
    .from('app_settings')
    .update(changes)
    .eq('id', id)
    .select()
    .single() as SingleResult<AppSettingsRow>;

  return requireSingleResult(result, `App settings "${id}" were not updated.`);
}
