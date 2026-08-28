#!/usr/bin/env node

import { createHash } from 'crypto';
import { readFile, realpath } from 'fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'path';
import { fileURLToPath } from 'url';
import { loadRootEnvironment } from '@/config/env-paths.js';
import {
  executableVariationListingManifestSchema,
  sanitizeError,
  type ExecutableVariationListingManifest,
} from '@/ebay/variation-listing-sandbox-pilot.js';
import {
  verifyVariationListingSandbox,
  type VerificationReport,
} from '@/ebay/variation-listing-sandbox-verification.js';

loadRootEnvironment();

// -- CLI types -------------------------------------------------------------

interface VerifyArgs {
  manifestPath: string;
  confirmSandboxSeller: string;
}

export interface CliSeams {
  repoRoot?: string;
  readApiFactory?: () => Promise<
    import('@/ebay/variation-listing-sandbox-pilot.js').VariationListingPilotReadApi
  >;
  sha256FileImpl?: (path: string) => Promise<string>;
  print?: (output: string) => void;
  readFileImpl?: (path: string) => Promise<string>;
}

// -- Helpers ----------------------------------------------------------------

function requireValue(value: string | undefined, flag: string): string {
  if (!value || value === '--' || value.startsWith('--') || value.trim().length === 0) {
    throw new Error(`${flag} requires a non-empty value.`);
  }
  return value.trim();
}

function isAbsolutePath(path: string): boolean {
  return resolve(path) === path;
}

function hasTraversal(path: string): boolean {
  const segments = path.split('/');
  return segments.some((s) => s === '..');
}

function hasBackslash(path: string): boolean {
  return path.includes('\\');
}

function validateManifestPath(path: string): void {
  if (isAbsolutePath(path))
    throw new Error('Manifest path must be relative. Absolute paths are forbidden.');
  if (hasTraversal(path)) throw new Error('Manifest path must not contain traversal (..).');
  if (hasBackslash(path))
    throw new Error('Manifest path must use forward slashes. Backslashes are forbidden.');
  if (!path.startsWith('.local/you-pick-sandbox/'))
    throw new Error('Manifest path must start with .local/you-pick-sandbox/.');
  if (!path.endsWith('/manifest.json'))
    throw new Error('Manifest path must end with /manifest.json.');
  if (basename(path) !== 'manifest.json')
    throw new Error('Manifest filename must be exactly manifest.json.');
  const parentDir = basename(dirname(path));
  if (!parentDir || parentDir === '.' || parentDir === '..')
    throw new Error('Manifest path must include a run directory.');
}

const FORBIDDEN_FLAGS = ['--fixture', '--execute', '--cleanup', '--attestation'];

export function parseVerifyArgs(argv: string[]): VerifyArgs {
  const result: Partial<VerifyArgs> = {};
  const seen = new Set<string>();

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;

    if (FORBIDDEN_FLAGS.includes(argument)) {
      throw new Error(`Forbidden mutation flag: ${argument}. Verification is strictly read-only.`);
    }

    if (seen.has(argument)) throw new Error(`${argument} may be supplied only once.`);
    seen.add(argument);

    if (argument === '--manifest') {
      if (result.manifestPath) throw new Error('--manifest may be supplied only once.');
      const value = requireValue(argv[index + 1], '--manifest');
      validateManifestPath(value);
      result.manifestPath = value;
      index += 1;
      continue;
    }

    if (argument === '--confirm-sandbox-seller') {
      if (result.confirmSandboxSeller)
        throw new Error('--confirm-sandbox-seller may be supplied only once.');
      result.confirmSandboxSeller = requireValue(argv[index + 1], '--confirm-sandbox-seller');
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  if (!result.manifestPath) throw new Error('--manifest is required.');
  if (!result.confirmSandboxSeller) throw new Error('--confirm-sandbox-seller is required.');

  return result as VerifyArgs;
}

async function sha256File(path: string): Promise<string> {
  const data = await readFile(path);
  return createHash('sha256').update(data).digest('hex');
}

function sanitizeVerificationReport(report: VerificationReport): Record<string, unknown> {
  return {
    status: report.status,
    runId: report.runId,
    sellerId: report.sellerId,
    groupKey: report.groupKey,
    listingId: report.listingId,
    children: report.children.map((child) => ({
      slot: child.slot,
      sku: child.sku,
      quantity: child.quantity,
      expectedQuantity: child.expectedQuantity,
      quantityMatch: child.quantityMatch,
      offerId: child.offerId,
      expectedOfferId: child.expectedOfferId,
      offerStatus: child.offerStatus,
      listingLifecycle: child.listingLifecycle,
      itemSemanticMatch: child.itemSemanticMatch,
      offerSemanticMatch: child.offerSemanticMatch,
      groupAssociationMatch: child.groupAssociationMatch,
    })),
    groupSemanticMatch: report.groupSemanticMatch,
    manifestSha256: report.manifestSha256,
    reads: report.reads,
    mutationCapabilitiesResolved: report.mutationCapabilitiesResolved,
    manifestWritten: report.manifestWritten,
  };
}

// -- Main -------------------------------------------------------------------

export async function runVerifyVariationListingSandboxCli(
  argv: string[] = process.argv.slice(2),
  seams: CliSeams = {}
): Promise<void> {
  const args = parseVerifyArgs(argv);
  const repoRoot =
    seams.repoRoot ?? resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
  const guardedPrefix = '.local/you-pick-sandbox/';

  // Resolve the manifest path within the repo root
  const manifestAbsolute = resolve(repoRoot, args.manifestPath);

  // Realpath containment: both repo root and manifest must resolve within guarded prefix
  const [rootReal, fileReal] = await Promise.all([realpath(repoRoot), realpath(manifestAbsolute)]);
  const guardedDir = join(rootReal, guardedPrefix);
  if (!fileReal.startsWith(guardedDir))
    throw new Error('Manifest real path must reside within .local/you-pick-sandbox/.');
  if (basename(fileReal) !== 'manifest.json')
    throw new Error('Manifest file must be exactly manifest.json.');

  // Pre-condition: compute manifest SHA before any network access
  const hasher = seams.sha256FileImpl ?? sha256File;
  const fileReader = seams.readFileImpl ?? ((p: string) => readFile(p, 'utf8'));
  const manifestSha256 = await hasher(manifestAbsolute);

  // Parse and validate manifest (read-only — never writes)
  let manifestParsed: unknown;
  try {
    manifestParsed = JSON.parse(await fileReader(manifestAbsolute)) as unknown;
  } catch (error) {
    throw new Error(`Manifest is missing or corrupt: ${sanitizeError(error)}`);
  }

  const manifest = executableVariationListingManifestSchema.parse(
    manifestParsed
  ) as ExecutableVariationListingManifest;

  // Resolve read API (never resolve mutation API)
  const factory =
    seams.readApiFactory ??
    (async () => {
      const { createVariationListingPilotReadApi } =
        await import('@/scripts/variation-listing-sandbox-pilot.js');
      return createVariationListingPilotReadApi();
    });
  const readApi = await factory();

  // Run pure verification
  const report = await verifyVariationListingSandbox({
    readApi,
    manifest,
    manifestSha256,
    confirmSandboxSeller: args.confirmSandboxSeller,
  });

  // Output sanitized JSON to stdout only
  const output = `${JSON.stringify(sanitizeVerificationReport(report), null, 2)}\n`;
  (seams.print ?? ((o: string) => process.stdout.write(o)))(output);
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
const modulePath = resolve(fileURLToPath(import.meta.url));

if (entryPath && entryPath === modulePath) {
  runVerifyVariationListingSandboxCli().catch((error) => {
    process.stderr.write(`${JSON.stringify({ error: sanitizeError(error), status: 'failed' })}\n`);
    /* eslint-disable-next-line n/no-process-exit -- CLI must fail non-zero on gate failure. */
    process.exit(1);
  });
}
