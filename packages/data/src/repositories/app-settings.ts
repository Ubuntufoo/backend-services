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
