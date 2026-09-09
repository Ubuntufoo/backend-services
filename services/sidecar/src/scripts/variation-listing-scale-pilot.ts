#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildVariationListingScaleEvidenceTemplate,
  buildVariationListingScaleFixture,
  compareVariationListingScaleEvidence,
  evaluateVariationListingScaleEvidence,
  parseVariationListingScaleEvidence,
  type VariationListingScalePilotEvidence,
} from '@/ebay/variation-listing-scale-pilot.js';

export type VariationListingScalePilotCliArgs =
  | { command: 'template'; variationCount: number }
  | { command: 'evaluate'; evidencePath: string }
  | { command: 'compare'; previousPath: string; currentPath: string };

function positiveInteger(value: string | undefined, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} requires a positive integer.`);
  }
  return parsed;
}

function requiredPath(value: string | undefined, label: string): string {
  if (!value || value.trim() === '' || value.startsWith('--')) {
    throw new Error(`${label} requires a file path.`);
  }
  return value;
}

export function parseVariationListingScalePilotArgs(argv: string[]): VariationListingScalePilotCliArgs {
  const [command, first, second, ...rest] = argv.filter((value) => value !== '--');
  if (rest.length > 0) throw new Error('Too many scale-pilot arguments.');
  if (command === 'template') {
    if (second !== undefined) throw new Error('template accepts at most one variation-count argument.');
    return { command, variationCount: first === undefined ? 10 : positiveInteger(first, 'template') };
  }
  if (command === 'evaluate') {
    if (second !== undefined) throw new Error('evaluate accepts exactly one evidence path.');
    return { command, evidencePath: requiredPath(first, 'evaluate') };
  }
  if (command === 'compare') {
    return {
      command,
      previousPath: requiredPath(first, 'compare'),
      currentPath: requiredPath(second, 'compare'),
    };
  }
  throw new Error('Use one of: template [variationCount], evaluate <evidence.json>, compare <previous.json> <current.json>.');
}

async function readEvidence(path: string): Promise<VariationListingScalePilotEvidence> {
  const raw = JSON.parse(await readFile(resolve(path), 'utf8')) as unknown;
  return parseVariationListingScaleEvidence(raw);
}

export async function runVariationListingScalePilotCli(
  argv: string[] = process.argv.slice(2),
  print: (output: string) => void = console.log
): Promise<void> {
  const args = parseVariationListingScalePilotArgs(argv);
  if (args.command === 'template') {
    print(
      JSON.stringify(
        {
          fixture: buildVariationListingScaleFixture(args.variationCount),
          evidence: buildVariationListingScaleEvidenceTemplate(args.variationCount),
        },
        null,
        2
      )
    );
    return;
  }
  if (args.command === 'evaluate') {
    const evidence = await readEvidence(args.evidencePath);
    print(JSON.stringify(evaluateVariationListingScaleEvidence(evidence), null, 2));
    return;
  }
  const [previous, current] = await Promise.all([
    readEvidence(args.previousPath),
    readEvidence(args.currentPath),
  ]);
  print(JSON.stringify(compareVariationListingScaleEvidence(previous, current), null, 2));
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
const modulePath = resolve(fileURLToPath(import.meta.url));
if (entryPath && entryPath === modulePath) {
  runVariationListingScalePilotCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    /* eslint-disable-next-line n/no-process-exit -- invalid offline evidence should fail the CLI. */
    process.exit(1);
  });
}
