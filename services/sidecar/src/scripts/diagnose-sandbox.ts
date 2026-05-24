#!/usr/bin/env node

import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { EbaySellerApi } from '@/api/index.js';
import { loadEbayOAuthValidationConfig } from '@/ebay/config.js';
import { validateEbayOAuth } from '@/ebay/validate-oauth.js';
import { getEbayConfig } from '@/config/environment.js';
import { loadRootEnvironment } from '@/config/env-paths.js';
import { getSandboxSellingPolicyManagementDiagnostic } from '@/ebay/sandbox-selling-policy-program.js';

loadRootEnvironment();

export async function runDiagnoseSandboxCli(): Promise<void> {
  const oauthConfig = loadEbayOAuthValidationConfig(process.env);
  const oauthValidation = await validateEbayOAuth(oauthConfig);
  const api = new EbaySellerApi(getEbayConfig());
  await api.initialize();

  const diagnostic = await getSandboxSellingPolicyManagementDiagnostic(api);

  console.log(
    JSON.stringify(
      {
        environment: oauthValidation.environment,
        oauth_validation: {
          expiresIn: oauthValidation.expiresIn,
          ok: oauthValidation.ok,
          tokenType: oauthValidation.tokenType,
        },
        selling_policy_management_opted_in: diagnostic.selling_policy_management_opted_in,
        warnings: diagnostic.warnings,
      },
      null,
      2
    )
  );
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
const modulePath = resolve(fileURLToPath(import.meta.url));

if (entryPath && modulePath === entryPath) {
  runDiagnoseSandboxCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    /* eslint-disable-next-line n/no-process-exit -- CLI entry should exit non-zero on failure */
    process.exit(1);
  });
}
