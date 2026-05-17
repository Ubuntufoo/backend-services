#!/usr/bin/env node

import { createSupabaseServiceClient, loadSupabaseServiceClientConfig } from '@ebay-inventory/data';
import { loadSidecarRootEnv } from '@ebay-inventory/env';
import { ROOT_ENV_LOCAL_PATH, loadRootEnvironment } from '@/config/env-paths.js';

loadRootEnvironment();

try {
  const env = loadSidecarRootEnv({ env: process.env });
  const supabaseConfig = loadSupabaseServiceClientConfig(process.env);
  createSupabaseServiceClient(process.env);

  console.log(`Validated ${ROOT_ENV_LOCAL_PATH}`);
  console.log(`Supabase project ref: ${supabaseConfig.projectRef}`);
  console.log(`Supabase URL: ${supabaseConfig.url}`);
  console.log(`eBay environment: ${env.EBAY_ENVIRONMENT}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
