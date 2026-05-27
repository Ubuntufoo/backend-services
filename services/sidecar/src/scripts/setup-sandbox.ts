#!/usr/bin/env node

import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { EbaySellerApi } from '@/api/index.js';
import { getEbayConfig } from '@/config/environment.js';
import { loadRootEnvironment } from '@/config/env-paths.js';
import { getSidecarDataAccess } from '@/data/sidecar-data.js';
import {
  formatSandboxBootstrapResult,
  runSandboxBootstrap,
} from '@/ebay/sandbox-bootstrap.js';

loadRootEnvironment();

export async function runSetupSandboxCli(): Promise<void> {
  const api = new EbaySellerApi(getEbayConfig());
  await api.initialize();

  const result = await runSandboxBootstrap({
    api,
    dataAccess: getSidecarDataAccess(),
  });

  console.log(formatSandboxBootstrapResult(result));
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
const modulePath = resolve(fileURLToPath(import.meta.url));

if (entryPath && modulePath === entryPath) {
  runSetupSandboxCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    /* eslint-disable-next-line n/no-process-exit -- CLI entry should exit non-zero on failure */
    process.exit(1);
  });
}
