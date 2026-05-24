#!/usr/bin/env node

import { loadRootEnvironment } from '@/config/env-paths.js';
import { loadEbayOAuthValidationConfig } from '@/ebay/config.js';
import { validateEbayOAuth } from '@/ebay/validate-oauth.js';

loadRootEnvironment();

try {
  const config = loadEbayOAuthValidationConfig(process.env);
  const result = await validateEbayOAuth(config);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  /* eslint-disable-next-line n/no-process-exit -- validation CLI should exit non-zero on failure */
  process.exit(1);
}
