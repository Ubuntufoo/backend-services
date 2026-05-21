#!/usr/bin/env node

import {
  createR2ImageStorageClient,
  createSupabaseServiceClient,
  loadR2ImageStorageConfig,
  loadSupabaseServiceClientConfig,
} from '@ebay-inventory/data';
import { loadSidecarRootEnv } from '@ebay-inventory/env';
import { ROOT_ENV_LOCAL_PATH, ROOT_ENV_PATH, loadRootEnvironment } from '@/config/env-paths.js';

loadRootEnvironment();

const R2_ENV_KEYS = [
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_NAME',
  'R2_S3_ENDPOINT',
  'R2_ENDPOINT',
  'R2_PUBLIC_BASE_URL',
] as const;

try {
  const env = loadSidecarRootEnv({ env: process.env });
  const supabaseConfig = loadSupabaseServiceClientConfig(process.env);
  createSupabaseServiceClient(process.env);
  const hasAnyR2Config = R2_ENV_KEYS.some((key) => {
    const value = process.env[key];
    return typeof value === 'string' && value.trim() !== '';
  });

  console.log(`Validated ${ROOT_ENV_PATH} with overrides from ${ROOT_ENV_LOCAL_PATH}`);
  console.log(`Supabase project ref: ${supabaseConfig.projectRef}`);
  console.log(`Supabase URL: ${supabaseConfig.url}`);
  console.log(`eBay enabled: ${env.EBAY_ENABLED}`);
  console.log(`eBay environment: ${env.EBAY_ENVIRONMENT ?? 'sandbox'}`);

  if (hasAnyR2Config) {
    const r2Config = loadR2ImageStorageConfig(process.env);
    createR2ImageStorageClient(process.env);

    console.log(`R2 bucket: ${r2Config.bucketName}`);
    console.log(`R2 public base URL: ${r2Config.publicBaseUrl}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  /* eslint-disable-next-line n/no-process-exit -- validation CLI should exit non-zero on failure */
  process.exit(1);
}
