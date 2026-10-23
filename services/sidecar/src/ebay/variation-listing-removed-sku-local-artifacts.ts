import { lstat, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import type { RemovedSkuPurgeCandidateManifest } from '@/ebay/variation-listing-removed-sku-purge-preview.js';
import {
  inspectRemovedSkuLocalFiles,
  type RemovedSkuLocalFileObservation,
} from '@/ebay/variation-listing-removed-sku-ownership.js';

export type RemovedSkuLocalRootKind = 'incoming' | 'processed' | 'staging' | 'cache';

export interface RemovedSkuLocalArtifactRoot {
  kind: RemovedSkuLocalRootKind;
  /** Explicit operator-configured directory; never inferred from an R2 key. */
  absolutePath: string;
}

export interface RemovedSkuLocalArtifactCandidate {
  absolutePath: string;
  rootKind: RemovedSkuLocalRootKind;
  match: 'source-reference' | 'identity-in-path';
  status: 'present' | 'shared' | 'unverified';
  reason: string;
}

export interface RemovedSkuLocalArtifactInventory {
  /** Complete applies ONLY to the configured roots, not unknown caches/locations. */
  scannedConfiguredRootsCompletely: boolean;
  configuredRootCount: number;
  scannedEntryCount: number;
  sourceFiles: RemovedSkuLocalFileObservation[];
  candidates: RemovedSkuLocalArtifactCandidate[];
  unresolved: string[];
  /** The inventory never grants deletion, even when all candidate files are found. */
  deletionAuthorized: false;
}

const DEFAULT_MAX_ENTRIES = 10_000;
const DEFAULT_MAX_DEPTH = 8;

function within(root: string, target: string): boolean {
  const offset = relative(root, target);
  return offset !== '' && offset !== '..' && !offset.startsWith(`..${sep}`) && !isAbsolute(offset);
}

function withinOrEqual(root: string, target: string): boolean {
  return root === target || within(root, target);
}

function validPositiveLimit(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 50_000) {
    throw new Error(`Removed-SKU local inventory: invalid ${label} limit.`);
  }
  return value;
}

function validCandidate(candidate: RemovedSkuPurgeCandidateManifest): void {
  const nonEmpty = (value: unknown): value is string =>
    typeof value === 'string' && value.length > 0 && value === value.trim();
  const ownershipScopes = [
    'variation-groups',
    'standard-single-lot',
    'prior-revisions',
    'local-files',
    'r2-objects',
  ] as const;
  if (!candidate || typeof candidate !== 'object' || candidate.deletionAuthorized !== false ||
      !Array.isArray(candidate.copies) || candidate.copies.length === 0 ||
      !Array.isArray(candidate.r2ObjectKeys) || !Array.isArray(candidate.localSourceRefs) ||
      !nonEmpty(candidate.groupId) || !nonEmpty(candidate.revisionId) ||
      !nonEmpty(candidate.targetVariationId) || !nonEmpty(candidate.targetSku) ||
      !candidate.r2ObjectKeys.every(nonEmpty) || !candidate.localSourceRefs.every(nonEmpty) ||
      !Array.isArray(candidate.ownershipChecks) || candidate.ownershipChecks.length !== ownershipScopes.length ||
      !Array.isArray(candidate.requiredChecks) || candidate.requiredChecks.length === 0 ||
      !candidate.requiredChecks.every(nonEmpty)) {
    throw new Error('Removed-SKU local inventory: invalid frozen candidate.');
  }
  const seenScopes = new Set<string>();
  for (const check of candidate.ownershipChecks) {
    if (!check || !ownershipScopes.includes(check.scope) || check.status !== 'unverified' || seenScopes.has(check.scope)) {
      throw new Error('Removed-SKU local inventory: invalid frozen candidate.');
    }
    seenScopes.add(check.scope);
  }
  if (seenScopes.size !== ownershipScopes.length) {
    throw new Error('Removed-SKU local inventory: invalid frozen candidate.');
  }

  const copyIds = new Set<string>();
  const r2Keys = new Set<string>();
  const sourceRefs = new Set<string>();
  for (const copy of candidate.copies) {
    if (!copy || !nonEmpty(copy.copyId) || !nonEmpty(copy.frontR2Key) ||
        !nonEmpty(copy.backR2Key) || copy.frontR2Key === copy.backR2Key ||
        !Array.isArray(copy.localSourceRefs) || copy.localSourceRefs.length !== 2 ||
        copy.localSourceRefs.some((ref) => !nonEmpty(ref)) ||
        copy.localSourceRefs[0] === copy.localSourceRefs[1] ||
        copyIds.has(copy.copyId) || r2Keys.has(copy.frontR2Key) ||
        r2Keys.has(copy.backR2Key) || sourceRefs.has(copy.localSourceRefs[0]) ||
        sourceRefs.has(copy.localSourceRefs[1])) {
      throw new Error('Removed-SKU local inventory: invalid frozen candidate.');
    }
    copyIds.add(copy.copyId);
    r2Keys.add(copy.frontR2Key);
    r2Keys.add(copy.backR2Key);
    sourceRefs.add(copy.localSourceRefs[0]);
    sourceRefs.add(copy.localSourceRefs[1]);
  }

  const exactSet = (values: readonly string[], expected: Set<string>): boolean =>
    new Set(values).size === expected.size && values.length === expected.size && values.every((value) => expected.has(value));
  if (!exactSet(candidate.r2ObjectKeys, r2Keys) || !exactSet(candidate.localSourceRefs, sourceRefs)) {
    throw new Error('Removed-SKU local inventory: frozen candidate mapping is inconsistent.');
  }
}

function tokenMatch(part: string, identity: string): boolean {
  const escaped = identity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^A-Za-z0-9])${escaped}(?:$|[^A-Za-z0-9])`).test(part);
}

/**
 * A deliberately read-only inventory of explicitly configured watcher roots.
 * A path/name match is NOT a resource ownership claim, and unknown locations
 * cannot be certified absent. No recursive removal, file writes or R2 calls.
 */
export async function inventoryRemovedSkuLocalArtifacts(input: {
  candidate: RemovedSkuPurgeCandidateManifest;
  roots: readonly RemovedSkuLocalArtifactRoot[];
  maxEntries?: number;
  maxDepth?: number;
}): Promise<RemovedSkuLocalArtifactInventory> {
  validCandidate(input.candidate);
  const maxEntries = validPositiveLimit(input.maxEntries ?? DEFAULT_MAX_ENTRIES, 'entry');
  const maxDepth = validPositiveLimit(input.maxDepth ?? DEFAULT_MAX_DEPTH, 'depth');
  const roots: Array<{kind: RemovedSkuLocalRootKind; path: string}> = [];
  for (const root of input.roots) {
    if (!root || !['incoming', 'processed', 'staging', 'cache'].includes(root.kind) ||
        typeof root.absolutePath !== 'string' || !isAbsolute(root.absolutePath)) {
      throw new Error('Removed-SKU local inventory: each configured root must have a supported kind and absolute path.');
    }
    let resolvedRoot: string;
    try {
      resolvedRoot = await realpath(resolve(root.absolutePath));
      if (!(await lstat(resolvedRoot)).isDirectory()) throw new Error('not a directory');
    } catch {
      throw new Error('Removed-SKU local inventory: a configured root is missing or not a readable directory.');
    }
    if (roots.some((existing) => existing.path === resolvedRoot ||
        within(existing.path, resolvedRoot) || within(resolvedRoot, existing.path))) {
      throw new Error('Removed-SKU local inventory: roots overlap; ownership coverage is ambiguous.');
    }
    roots.push({kind: root.kind, path: resolvedRoot});
  }
  const candidate = input.candidate;
  // The existing read-only inspector checks canonical containment, symlinks,
  // nonregular files and hard links for the exact frozen source references.
  const sourceFiles = await inspectRemovedSkuLocalFiles(candidate.localSourceRefs, roots.map((root) => root.path));
  const resolvedSources = new Set(sourceFiles
    .filter((file) => (file.status === 'present' || file.status === 'shared') && file.resolvedPath !== null)
    .map((file) => file.resolvedPath!));
  const identifiers = [candidate.targetVariationId, candidate.targetSku,
    ...candidate.copies.map((copy) => copy.copyId)];
  const results: RemovedSkuLocalArtifactCandidate[] = [];
  const unresolved: string[] = [];
  let scannedEntryCount = 0;
  async function walk(root: {kind: RemovedSkuLocalRootKind; path: string}, directory: string, depth: number): Promise<void> {
    if (depth > maxDepth) {
      throw new Error('Removed-SKU local inventory: directory depth cap reached; coverage incomplete.');
    }
    let canonicalDirectory: string;
    let entries;
    try {
      canonicalDirectory = await realpath(directory);
      const directoryMetadata = await lstat(canonicalDirectory);
      if (!directoryMetadata.isDirectory() || !withinOrEqual(root.path, canonicalDirectory)) {
        throw new Error('directory escaped configured root');
      }
      entries = await readdir(canonicalDirectory, {withFileTypes: true});
    } catch {
      throw new Error('Removed-SKU local inventory: configured directory cannot be completely enumerated or contained.');
    }
    try {
      const canonicalAfterEnumeration = await realpath(directory);
      const directoryMetadata = await lstat(canonicalAfterEnumeration);
      if (canonicalAfterEnumeration !== canonicalDirectory || !directoryMetadata.isDirectory() ||
          !withinOrEqual(root.path, canonicalAfterEnumeration)) {
        throw new Error('directory changed during enumeration');
      }
    } catch {
      throw new Error('Removed-SKU local inventory: configured directory changed or escaped during enumeration.');
    }
    for (const entry of entries) {
      scannedEntryCount += 1;
      if (scannedEntryCount > maxEntries) {
        throw new Error('Removed-SKU local inventory: entry cap reached; coverage incomplete.');
      }
      const path = join(canonicalDirectory, entry.name);
      if (entry.isSymbolicLink()) {
        unresolved.push('Configured directory contains a symbolic link; its target was not scanned.');
        continue;
      }
      if (entry.isDirectory()) {
        await walk(root, path, depth + 1);
        continue;
      }
      if (!entry.isFile()) {
        unresolved.push('Configured directory contains an unsupported filesystem entry.');
        continue;
      }
      const fromReference = resolvedSources.has(path);
      const localParts = relative(root.path, path).split(sep);
      const nameMatch = localParts.some((part) => identifiers.some((identity) => tokenMatch(part, identity)));
      if (!fromReference && !nameMatch) continue;
      try {
        const [physical, metadata] = await Promise.all([realpath(path), lstat(path)]);
        if (!within(root.path, physical) || !metadata.isFile()) {
          const reason = 'Candidate is not a verified regular file under its configured root.';
          results.push({absolutePath: path, rootKind: root.kind,
            match: fromReference ? 'source-reference' : 'identity-in-path',
            status: 'unverified', reason});
          unresolved.push(`Candidate requires additional verification: ${path} ${reason}`);
          continue;
        }
        const status = metadata.nlink > 1 ? 'shared' : 'present';
        results.push({
          absolutePath: physical,
          rootKind: root.kind,
          match: fromReference ? 'source-reference' : 'identity-in-path',
          status,
          reason: metadata.nlink > 1
            ? 'Multiple filesystem hard links; ownership cannot be attributed.'
            : fromReference
              ? 'Frozen capture source path is present; ownership is not proven.'
              : 'Path mentions removed identity; association and ownership are unverified.',
        });
        if (status === 'shared') {
          unresolved.push(`Candidate requires additional verification: ${physical} has shared filesystem ownership.`);
        }
      } catch {
        const reason = 'Candidate file changed or could not be inspected.';
        results.push({absolutePath: path, rootKind: root.kind,
          match: fromReference ? 'source-reference' : 'identity-in-path',
          status: 'unverified', reason});
        unresolved.push(`Candidate requires additional verification: ${path} ${reason}`);
      }
    }
  }
  for (const root of roots) await walk(root, root.path, 0);
  for (const source of sourceFiles) {
    if (source.status === 'missing' || source.status === 'unverified' || source.status === 'shared') {
      unresolved.push(`Frozen source path requires additional verification: ${source.reason}`);
    }
    if (source.status === 'present' && source.resolvedPath &&
        !results.some((item) => item.absolutePath === source.resolvedPath)) {
      unresolved.push('A frozen source file was observed but not located in the configured root enumeration.');
    }
  }
  return {
    scannedConfiguredRootsCompletely: unresolved.length === 0 && roots.length > 0,
    configuredRootCount: roots.length,
    scannedEntryCount,
    sourceFiles,
    candidates: results,
    unresolved: [...new Set(unresolved)],
    deletionAuthorized: false,
  };
}
