import { loadSupabaseEnv, type SupabaseEnv } from '@ebay-inventory/env';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.js';

export interface SupabaseServiceClientConfig {
  projectRef: string;
  publishableKey: string;
  serviceRoleKey: string;
  url: string;
}

export type SupabaseDataClient = Pick<SupabaseClient<Database>, 'from' | 'rpc'>;

export function loadSupabaseServiceClientConfig(
  env: NodeJS.ProcessEnv = process.env
): SupabaseServiceClientConfig {
  const supabaseEnv: SupabaseEnv = loadSupabaseEnv({ env });

  return {
    projectRef: supabaseEnv.SUPABASE_PROJECT_REF,
    publishableKey: supabaseEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    serviceRoleKey: supabaseEnv.SUPABASE_SERVICE_ROLE_KEY,
    url: supabaseEnv.NEXT_PUBLIC_SUPABASE_URL,
  };
}

export function createSupabaseServiceClient(
  env: NodeJS.ProcessEnv = process.env
): SupabaseClient<Database> {
  const config = loadSupabaseServiceClientConfig(env);

  return createClient<Database>(config.url, config.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
