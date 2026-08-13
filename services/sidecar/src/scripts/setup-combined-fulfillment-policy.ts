#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EbaySellerApi } from '@/api/index.js';
import { getEbayConfig } from '@/config/environment.js';
import { loadRootEnvironment } from '@/config/env-paths.js';
import { getSidecarDataAccess } from '@/data/sidecar-data.js';
import { setupCombinedFulfillmentPolicy } from '@/ebay/fulfillment-policy.js';

loadRootEnvironment();

function getFlagValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function getConfiguredEseSourcePolicyId(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const production = (value as Record<string, unknown>).production;
  if (typeof production !== 'object' || production === null || Array.isArray(production)) {
    return null;
  }
  const policyId = (production as Record<string, unknown>).fulfillmentPolicyId;
  return typeof policyId === 'string' && policyId.trim().length > 0 ? policyId.trim() : null;
}

export async function runSetupCombinedFulfillmentPolicyCli(): Promise<void> {
  const execute = process.argv.includes('--execute');
  const runtimeConfig = getEbayConfig();
  if (runtimeConfig.environment !== 'production') {
    throw new Error('EBAY_ENVIRONMENT must be exactly "production".');
  }

  const appSettings = await getSidecarDataAccess().appSettings.get();
  const eseSourceFulfillmentPolicyId =
    getFlagValue('--ese-source-policy-id') ??
    getConfiguredEseSourcePolicyId(appSettings?.ebay_publish_config);
  if (!eseSourceFulfillmentPolicyId) {
    throw new Error(
      'Provide --ese-source-policy-id or retain the current production fulfillmentPolicyId as the eSE source.'
    );
  }

  const api = new EbaySellerApi(runtimeConfig);
  await api.initialize();
  const marketplaceId = runtimeConfig.marketplaceId ?? 'EBAY_US';
  const result = await setupCombinedFulfillmentPolicy({
    accountApi: api.account,
    eseSourceFulfillmentPolicyId,
    execute,
    marketplaceId,
  });

  console.log(
    JSON.stringify(
      {
        ...result,
        execute,
        marketplaceId,
        nextStep:
          result.combinedFulfillmentPolicyId === null
            ? 'Review the dry-run, then rerun with --execute.'
            : 'Set production combinedFulfillmentPolicyId and groundFulfillmentPolicyId in app_settings.ebay_publish_config.',
      },
      null,
      2
    )
  );
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
const modulePath = resolve(fileURLToPath(import.meta.url));
if (entryPath === modulePath) {
  runSetupCombinedFulfillmentPolicyCli().catch((error) => {
    console.error(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) })
    );
    process.exitCode = 1;
  });
}
