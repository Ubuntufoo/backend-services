#!/usr/bin/env node

import { createSupabaseServiceClient, loadSupabaseServiceClientConfig } from '@ebay-inventory/data';
import { loadSidecarRootEnv } from '@ebay-inventory/env';
import { ROOT_ENV_LOCAL_PATH, ROOT_ENV_PATH, loadRootEnvironment } from '@/config/env-paths.js';

loadRootEnvironment();

try {
  const env = loadSidecarRootEnv({ env: process.env });
  const supabaseConfig = loadSupabaseServiceClientConfig(process.env);
  createSupabaseServiceClient(process.env);

  console.log(`Validated ${ROOT_ENV_PATH} with overrides from ${ROOT_ENV_LOCAL_PATH}`);
  console.log(`Supabase project ref: ${supabaseConfig.projectRef}`);
  console.log(`Supabase URL: ${supabaseConfig.url}`);
  console.log(`eBay enabled: ${env.EBAY_ENABLED}`);
  console.log(`eBay environment: ${env.EBAY_ENVIRONMENT ?? 'sandbox'}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
