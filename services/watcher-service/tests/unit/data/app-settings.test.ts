import { afterEach, describe, expect, it, vi } from 'vitest';

const createSupabaseServiceClientMock = vi.fn(() => ({ from: vi.fn() }));
const getAppSettingsMock = vi.fn();

vi.mock('@ebay-inventory/data', () => ({
  DEFAULT_APP_SETTINGS_ID: 'default',
  createSupabaseServiceClient: createSupabaseServiceClientMock,
  getAppSettings: getAppSettingsMock,
}));

describe('watcher app settings repository', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('creates one shared client and delegates app settings reads through @ebay-inventory/data', async () => {
    getAppSettingsMock.mockResolvedValueOnce({ capture_mode: 'single_2_image' });

    const { createWatcherAppSettingsRepository } = await import(
      '../../../src/data/app-settings.js'
    );
    const env = {
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
      NEXT_PUBLIC_SUPABASE_URL: 'https://fmiliwxthjonjwywuqta.supabase.co',
      SUPABASE_PROJECT_REF: 'fmiliwxthjonjwywuqta',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    } as NodeJS.ProcessEnv;

    const repository = createWatcherAppSettingsRepository(env);

    await repository.get();

    expect(createSupabaseServiceClientMock).toHaveBeenCalledWith(env);
    const client = createSupabaseServiceClientMock.mock.results[0]?.value;
    expect(getAppSettingsMock).toHaveBeenCalledWith(client, 'default');
  });
});
