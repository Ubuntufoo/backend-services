import { afterEach, describe, expect, it, vi } from 'vitest';

const createClientMock = vi.fn(() => ({ from: vi.fn() }));

vi.mock('@supabase/supabase-js', () => ({
  createClient: createClientMock,
}));

describe('Supabase service client', () => {
  afterEach(() => {
    createClientMock.mockClear();
  });

  it('loads the service client config from environment variables', async () => {
    const { loadSupabaseServiceClientConfig } = await import('@/supabase/client.js');

    const config = loadSupabaseServiceClientConfig({
      NEXT_PUBLIC_SUPABASE_URL: 'https://fmiliwxthjonjwywuqta.supabase.co',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
      SUPABASE_PROJECT_REF: 'fmiliwxthjonjwywuqta',
    } as NodeJS.ProcessEnv);

    expect(config).toEqual({
      projectRef: 'fmiliwxthjonjwywuqta',
      publishableKey: 'sb_publishable_test',
      serviceRoleKey: 'service-role-test',
      url: 'https://fmiliwxthjonjwywuqta.supabase.co',
    });
  });

  it('creates a server-only Supabase client with the service role key', async () => {
    const { createSupabaseServiceClient } = await import('@/supabase/client.js');

    createSupabaseServiceClient({
      NEXT_PUBLIC_SUPABASE_URL: 'https://fmiliwxthjonjwywuqta.supabase.co',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
      SUPABASE_PROJECT_REF: 'fmiliwxthjonjwywuqta',
    } as NodeJS.ProcessEnv);

    expect(createClientMock).toHaveBeenCalledWith(
      'https://fmiliwxthjonjwywuqta.supabase.co',
      'service-role-test',
      expect.objectContaining({
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      })
    );
  });
});
