#!/usr/bin/env node

import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { EbaySellerApi } from '@/api/index.js';
import { getEbayConfig } from '@/config/environment.js';
import { loadRootEnvironment } from '@/config/env-paths.js';
import {
  formatConditionPolicyDiagnostic,
  getConditionPolicyDiagnostic,
} from '@/ebay/condition-policy-diagnostic.js';
import { TRADING_CARD_CATEGORY_IDS } from '@/listings/trading-card-conditions.js';

loadRootEnvironment();

interface CliArgs {
  categoryIds: string[];
  marketplaceId: string;
}

function parseArgs(argv: string[]): CliArgs {
  const categoryIds: string[] = [];
  let marketplaceId = process.env.EBAY_MARKETPLACE_ID?.trim() || 'EBAY_US';

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--category') {
      const value = argv[index + 1]?.trim();
      if (!value) {
        throw new Error('Missing value for --category');
      }
      categoryIds.push(value);
      index += 1;
      continue;
    }

    if (arg === '--marketplace') {
      const value = argv[index + 1]?.trim();
      if (!value) {
        throw new Error('Missing value for --marketplace');
      }
      marketplaceId = value;
      index += 1;
      continue;
    }
  }

  return {
    categoryIds: categoryIds.length > 0 ? categoryIds : [...TRADING_CARD_CATEGORY_IDS],
    marketplaceId,
  };
}

export async function runDiagnoseConditionPolicyCli(argv = process.argv.slice(2)): Promise<void> {
  const { categoryIds, marketplaceId } = parseArgs(argv);
  const api = new EbaySellerApi(getEbayConfig());
  await api.initialize();

  const diagnostic = await getConditionPolicyDiagnostic(api.metadata, marketplaceId, categoryIds);
  console.log(formatConditionPolicyDiagnostic(diagnostic));
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
const modulePath = resolve(fileURLToPath(import.meta.url));

if (entryPath && modulePath === entryPath) {
  runDiagnoseConditionPolicyCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    /* eslint-disable-next-line n/no-process-exit -- CLI entry should exit non-zero on failure */
    process.exit(1);
  });
}
