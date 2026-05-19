import type { AppSettingsInsert, AppSettingsRow, AppSettingsUpdate } from '../database.js';
import type { SupabaseDataClient } from '../client.js';
import {
  requireOptionalResult,
  requireSingleResult,
  type SingleResult,
} from './shared.js';

export const DEFAULT_APP_SETTINGS_ID = 'default';

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
