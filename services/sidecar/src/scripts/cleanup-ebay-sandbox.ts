#!/usr/bin/env node

import { resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  runSandboxCleanup,
  type SandboxCleanupInput,
} from '@/ebay/sandbox-cleanup.js';
import { loadRootEnvironment } from '@/config/env-paths.js';

loadRootEnvironment();

type ParsedArgs = SandboxCleanupInput;

function parsePositiveInteger(value: string, flagName: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${flagName} requires a positive integer value.`);
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${flagName} requires a positive integer value.`);
  }

  return parsed;
}

function parseNonEmptyValue(value: string | undefined, flagName: string): string {
  if (!value || value === '--' || value.startsWith('--')) {
    throw new Error(`${flagName} requires a non-empty value.`);
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${flagName} requires a non-empty value.`);
  }

  return trimmed;
}

function parseArgs(argv: string[]): ParsedArgs {
  const skus: string[] = [];
  const prefixes: string[] = [];
  let allowLargeRange = false;
  let confirmSandboxCleanup = false;
  let destructiveDelete = false;
  let from: number | undefined;
  let to: number | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];

    if (current === '--') {
      continue;
    }

    if (current === '--sku') {
      skus.push(parseNonEmptyValue(argv[index + 1], '--sku'));
      index += 1;
      continue;
    }

    if (current === '--prefix') {
      prefixes.push(parseNonEmptyValue(argv[index + 1], '--prefix'));
      index += 1;
      continue;
    }

    if (current === '--from') {
      from = parsePositiveInteger(parseNonEmptyValue(argv[index + 1], '--from'), '--from');
      index += 1;
      continue;
    }

    if (current === '--to') {
      to = parsePositiveInteger(parseNonEmptyValue(argv[index + 1], '--to'), '--to');
      index += 1;
      continue;
    }

    if (current === '--allow-large-range') {
      allowLargeRange = true;
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
    allowLargeRange,
    confirmSandboxCleanup,
    delete: destructiveDelete,
    from,
    prefixes,
    skus,
    to,
  };
}

function printSummary(summary: unknown): void {
  console.log(JSON.stringify(summary, null, 2));
}

export async function runCleanupEbaySandboxCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);

  if (args.delete && !args.confirmSandboxCleanup) {
    throw new Error('Destructive sandbox cleanup requires --confirm-sandbox-cleanup.');
  }
  const report = await runSandboxCleanup(args);

  printSummary({
    candidateCount: report.candidateCount,
    candidateSkus: report.candidateSkus,
    foundSkus: report.foundSkus,
    from: report.from,
    missingSkus: report.missingSkus,
    offersBySku: report.offersBySku,
    prefixes: report.prefixes,
    skus: report.skus,
    sourceMode: report.sourceMode,
    to: report.to,
  });

  if (!args.delete) {
    return;
  }

  printSummary({
    candidateCount: report.candidateCount,
    mode: 'delete',
    outcomes: report.outcomes,
    success: report.success,
  });

  if (!report.success) {
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
