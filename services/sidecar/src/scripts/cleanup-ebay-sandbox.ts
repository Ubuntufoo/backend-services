#!/usr/bin/env node

import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { EbaySellerApi } from '@/api/index.js';
import { getEbayConfig } from '@/config/environment.js';
import { loadRootEnvironment } from '@/config/env-paths.js';
import {
  DEFAULT_SANDBOX_CLEANUP_PREFIXES,
  collectSandboxCleanupTargets,
  performSandboxCleanup,
} from '@/ebay/sandbox-cleanup.js';

loadRootEnvironment();

interface ParsedArgs {
  confirmSandboxCleanup: boolean;
  delete: boolean;
  prefixes: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const prefixes: string[] = [];
  let confirmSandboxCleanup = false;
  let destructiveDelete = false;

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];

    if (current === '--') {
      continue;
    }

    if (current === '--prefix') {
      const prefix = argv[index + 1];
      if (!prefix || prefix === '--' || prefix.startsWith('--') || prefix.length === 0) {
        throw new Error('--prefix requires a non-empty value.');
      }
      prefixes.push(prefix);
      index += 1;
      continue;
    }

    if (current === '--delete') {
      destructiveDelete = true;
      continue;
    }

    if (current === '--confirm-sandbox-cleanup') {
      confirmSandboxCleanup = true;
      continue;
    }

    throw new Error(`Unknown argument: ${current}`);
  }

  return {
    confirmSandboxCleanup,
    delete: destructiveDelete,
    prefixes: prefixes.length > 0 ? prefixes : [...DEFAULT_SANDBOX_CLEANUP_PREFIXES],
  };
}

function printSummary(summary: unknown): void {
  console.log(JSON.stringify(summary, null, 2));
}

async function createEbayApi(): Promise<EbaySellerApi> {
  const api = new EbaySellerApi(getEbayConfig());
  await api.initialize();
  return api;
}

export async function runCleanupEbaySandboxCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);

  if (process.env.EBAY_ENVIRONMENT !== 'sandbox') {
    throw new Error('EBAY_ENVIRONMENT must be set to "sandbox" before running sandbox cleanup.');
  }

  if (args.delete && !args.confirmSandboxCleanup) {
    throw new Error('Destructive sandbox cleanup requires --confirm-sandbox-cleanup.');
  }

  const api = await createEbayApi();
  const targets = await collectSandboxCleanupTargets(api, args.prefixes);

  printSummary({
    mode: args.delete ? 'delete' : 'dry-run',
    matchedSkus: targets.map((target) => target.inventoryItem.sku),
    prefixes: args.prefixes,
    targets,
  });

  if (!args.delete) {
    return;
  }

  const outcomes = await performSandboxCleanup(api, targets);
  const success = outcomes.every((outcome) => outcome.status !== 'failed');

  printSummary({
    mode: 'delete',
    outcomes,
    success,
  });

  if (!success) {
    throw new Error('One or more sandbox cleanup operations failed.');
  }
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
const modulePath = resolve(fileURLToPath(import.meta.url));

if (entryPath && modulePath === entryPath) {
  runCleanupEbaySandboxCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    /* eslint-disable-next-line n/no-process-exit -- CLI entry should exit non-zero on failure */
    process.exit(1);
  });
}
