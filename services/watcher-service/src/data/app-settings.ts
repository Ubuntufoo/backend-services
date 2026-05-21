import {
  DEFAULT_APP_SETTINGS_ID,
  createSupabaseServiceClient,
  getAppSettings,
  type AppSettingsRow,
} from '@ebay-inventory/data';

export interface WatcherAppSettingsRepository {
  get(id?: string): Promise<AppSettingsRow | null>;
}

export function createWatcherAppSettingsRepository(
  env: NodeJS.ProcessEnv = process.env
): WatcherAppSettingsRepository {
  const client = createSupabaseServiceClient(env);

  return {
    get: async (id = DEFAULT_APP_SETTINGS_ID) => await getAppSettings(client, id),
  };
}
