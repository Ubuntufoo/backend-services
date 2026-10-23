import { lstat, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import type {
  Json,
  R2ObjectMetadataInspection,
  SupabaseDataClient,
} from '@ebay-inventory/data';
import type {
  RemovedSkuPurgeCandidateManifest,
  RemovedSkuPurgeOwnershipCheck,
} from '@/ebay/variation-listing-removed-sku-purge-preview.js';

export interface RemovedSkuOwnershipRows {
  /** Set only by the exhaustive reader; arbitrary partial arrays cannot clear a DB scope. */
  scanComplete: true;
  scanCounts: {
    variationCopies: number;
    standardListings: number;
    revisions: number;
  };
  /** A complete, paginated read of all currently persisted Variation copy references. */
  variationCopies: Array<{
    copy_id: string;
    front_r2_key: string;
    back_r2_key: string;
    capture_front_source_ref: string;
    capture_back_source_ref: string;
  }>;
  /** Includes every Standard Single/Lot record regardless of workflow status. */
  standardListings: Array<{
    listing_id: string;
    r2_object_keys: string[];
    image_urls: string[];
  }>;
  /** Includes every group's historical revisions, not only the target group. */
  revisions: Array<{ revision_id: string; group_id: string; snapshot: Json }>;
}

export interface RemovedSkuReferenceConflict {
  scope: 'variation-groups' | 'standard-single-lot' | 'prior-revisions';
  owner: string;
  resource: string;
}

export interface RemovedSkuLocalFileObservation {
  sourceRef: string;
  /** No value here is ever sufficient to authorize deletion. */
  status: 'missing' | 'present' | 'unverified' | 'shared';
  resolvedPath: string | null;
  reason: string;
}

export interface RemovedSkuR2KeyCheck {
  key: string;
  /** Format is only a structural check; it never establishes ownership. */
  formatValid: boolean;
  status: R2ObjectMetadataInspection['status'];
  reason: string;
}

export type RemovedSkuR2MetadataInspector = (
  key: string
) => Promise<R2ObjectMetadataInspection>;

export interface RemovedSkuOwnershipAudit {
  groupId: string;
  revisionId: string;
  targetSku: string;
  databaseChecks: ReadonlyArray<{
    scope: 'variation-groups' | 'standard-single-lot' | 'prior-revisions';
    status: 'clear' | 'conflict';
  }>;
  referenceConflicts: RemovedSkuReferenceConflict[];
  localFiles: RemovedSkuLocalFileObservation[];
  r2KeyChecks: RemovedSkuR2KeyCheck[];
  /** DB references are only one ownership source; no delete operation accepts this audit. */
  deletionAuthorized: false;
  outstandingChecks: readonly string[];
}

const SCAN_PAGE_SIZE = 250;
const MAX_SCAN_PAGES = 100;
const WATCHER_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const REQUIRED_OWNERSHIP_SCOPES: ReadonlySet<RemovedSkuPurgeOwnershipCheck['scope']> = new Set([
  'variation-groups',
  'standard-single-lot',
  'prior-revisions',
  'local-files',
  'r2-objects',
]);

type PageResult<T> = {
  data: T[] | null;
  error: { message: string } | null;
  count: number | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '' || value !== value.trim()) {
    throw new Error(`Removed-SKU reference scan: malformed ${label}.`);
  }
  return value;
}

function requiredPathSegment(value: unknown, label: string): string {
  const text = requiredString(value, label);
  if (/[\\/\0]/.test(text)) throw new Error(`Removed-SKU reference scan: malformed ${label}.`);
  return text;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry.trim() === '' || entry !== entry.trim())) {
    throw new Error(`Removed-SKU reference scan: malformed ${label}.`);
  }
  return value as string[];
}

function validateJson(value: unknown, depth = 0): void {
  if (depth > 100) throw new Error('Removed-SKU reference scan: malformed historical snapshot.');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return;
    throw new Error('Removed-SKU reference scan: malformed historical snapshot.');
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => validateJson(entry, depth + 1));
    return;
  }
  if (isRecord(value)) {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error('Removed-SKU reference scan: malformed historical snapshot.');
    }
    Object.values(value).forEach((entry) => validateJson(entry, depth + 1));
    return;
  }
  throw new Error('Removed-SKU reference scan: malformed historical snapshot.');
}

function validateOwnershipRows(rows: RemovedSkuOwnershipRows): void {
  if (!isRecord(rows) || !Array.isArray(rows.variationCopies) ||
      !Array.isArray(rows.standardListings) || !Array.isArray(rows.revisions) ||
      rows.scanComplete !== true || !isRecord(rows.scanCounts)) {
    throw new Error('Removed-SKU reference scan: malformed ownership rows.');
  }
  for (const [label, count, actual] of [
    ['Variation copies', rows.scanCounts.variationCopies, rows.variationCopies.length],
    ['Standard listings', rows.scanCounts.standardListings, rows.standardListings.length],
    ['Variation revisions', rows.scanCounts.revisions, rows.revisions.length],
  ] as const) {
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0 || count !== actual) {
      throw new Error(`Removed-SKU reference scan: malformed ${label} completeness attestation.`);
    }
  }
  validateRowsForTable(rows.variationCopies, 'Variation copies');
  validateRowsForTable(rows.standardListings, 'Standard listings');
  validateRowsForTable(rows.revisions, 'Variation revisions');
  const duplicate = (values: readonly string[], label: string) => {
    if (new Set(values).size !== values.length) {
      throw new Error(`Removed-SKU reference scan: duplicate ${label} identity makes ownership ambiguous.`);
    }
  };
  duplicate(rows.variationCopies.map((row) => row.copy_id), 'copy');
  duplicate(rows.standardListings.map((row) => row.listing_id), 'Standard listing');
  duplicate(rows.revisions.map((row) => row.revision_id), 'revision');
}

/** Exhaustively page every table; server row caps, count drift or errors cannot count as absence. */
async function readAllRows<T>(
  label: string,
  query: (start: number, end: number) => PromiseLike<PageResult<T>>,
  validatePage: (rows: readonly T[]) => void,
): Promise<T[]> {
  const all: T[] = [];
  let expectedCount: number | null = null;
  const maxRows = SCAN_PAGE_SIZE * MAX_SCAN_PAGES;
  for (let page = 0; page < MAX_SCAN_PAGES; page += 1) {
    const start = page * SCAN_PAGE_SIZE;
    const result = await query(start, start + SCAN_PAGE_SIZE - 1);
    if (result.error !== null || !Array.isArray(result.data) ||
        typeof result.count !== 'number' || !Number.isSafeInteger(result.count) || result.count < 0 ||
        result.data.length > SCAN_PAGE_SIZE) {
      throw new Error(`Removed-SKU reference scan: ${label} read failed or returned an invalid page.`);
    }
    const pageCount = result.count;
    if (expectedCount === null) expectedCount = pageCount;
    const count = expectedCount ?? pageCount;
    if (result.count !== count || count > maxRows) {
      throw new Error(`Removed-SKU reference scan: ${label} count is incomplete or changed.`);
    }
    validatePage(result.data);
    all.push(...result.data);
    if (all.length > count) {
      throw new Error(`Removed-SKU reference scan: ${label} returned more rows than its exact count.`);
    }
    if (all.length === count) return all;
    if (result.data.length !== SCAN_PAGE_SIZE) {
      throw new Error(`Removed-SKU reference scan: ${label} returned an incomplete page.`);
    }
  }
  throw new Error(`Removed-SKU reference scan: ${label} exceeded the bounded scan; absence is unproven.`);
}

function validateRowsForTable<T>(rows: readonly T[], label: string): void {
  if (label === 'Variation copies') {
    for (const row of rows) {
      if (!isRecord(row)) throw new Error(`Removed-SKU reference scan: malformed ${label} row.`);
      requiredString(row.copy_id, 'Variation copy ID');
      requiredString(row.front_r2_key, 'Variation front R2 key');
      requiredString(row.back_r2_key, 'Variation back R2 key');
      requiredString(row.capture_front_source_ref, 'Variation front source ref');
      requiredString(row.capture_back_source_ref, 'Variation back source ref');
    }
    return;
  }
  if (label === 'Standard listings') {
    for (const row of rows) {
      if (!isRecord(row)) throw new Error(`Removed-SKU reference scan: malformed ${label} row.`);
      requiredString(row.listing_id, 'Standard listing ID');
      stringArray(row.r2_object_keys, 'Standard listing R2 references');
      stringArray(row.image_urls, 'Standard listing image references');
    }
    return;
  }
  for (const row of rows) {
    if (!isRecord(row) || !isRecord(row.snapshot) || Array.isArray(row.snapshot)) {
      throw new Error(`Removed-SKU reference scan: malformed ${label} row.`);
    }
    validateJson(row.snapshot);
    requiredString(row.revision_id, 'historical revision ID');
    requiredString(row.group_id, 'historical revision group ID');
  }
}

/**
 * Read-only service-role scan. Never changes an object, inventory row, or
 * revision. Caller must not cache the result as pre-delete authorization.
 */
export async function readRemovedSkuOwnershipRows(client: SupabaseDataClient): Promise<RemovedSkuOwnershipRows> {
  const [variationCopies, standardListings, revisions] = await Promise.all([
    readAllRows<RemovedSkuOwnershipRows['variationCopies'][number]>(
      'Variation copies',
      (a, b) => client.from('variation_listing_copies')
        .select('copy_id,front_r2_key,back_r2_key,capture_front_source_ref,capture_back_source_ref', { count: 'exact' })
        .order('copy_id', { ascending: true }).range(a, b),
      (rows) => validateRowsForTable(rows, 'Variation copies'),
    ),
    readAllRows<RemovedSkuOwnershipRows['standardListings'][number]>(
      'Standard listings',
      (a, b) => client.from('listings')
        .select('listing_id,r2_object_keys,image_urls', { count: 'exact' })
        .order('listing_id', { ascending: true }).range(a, b),
      (rows) => validateRowsForTable(rows, 'Standard listings'),
    ),
    readAllRows<RemovedSkuOwnershipRows['revisions'][number]>(
      'Variation revisions',
      (a, b) => client.from('variation_listing_revisions')
        .select('revision_id,group_id,snapshot', { count: 'exact' })
        .order('revision_id', { ascending: true }).range(a, b),
      (rows) => validateRowsForTable(rows, 'Variation revisions'),
    ),
  ]);
  const distinct = <T>(rows: readonly T[], key: (row: T) => string, label: string) => {
    if (new Set(rows.map(key)).size !== rows.length) {
      throw new Error(`Removed-SKU reference scan: duplicate ${label} identity makes ownership ambiguous.`);
    }
  };
  distinct(variationCopies, (row) => row.copy_id, 'copy');
  distinct(standardListings, (row) => row.listing_id, 'Standard listing');
  distinct(revisions, (row) => row.revision_id, 'revision');
  return {
    scanComplete: true,
    scanCounts: {
      variationCopies: variationCopies.length,
      standardListings: standardListings.length,
      revisions: revisions.length,
    },
    variationCopies,
    standardListings,
    revisions,
  };
}

function validateCandidate(candidate: RemovedSkuPurgeCandidateManifest): void {
  if (!isRecord(candidate) || candidate.deletionAuthorized !== false) {
    throw new Error('Removed-SKU reference scan requires a non-authorizing frozen-copy preview.');
  }
  requiredPathSegment(candidate.groupId, 'candidate group ID');
  requiredString(candidate.revisionId, 'candidate revision ID');
  requiredPathSegment(candidate.targetVariationId, 'candidate variation ID');
  requiredString(candidate.targetSku, 'candidate SKU');
  if (!Array.isArray(candidate.copies) || candidate.copies.length === 0 ||
      !Array.isArray(candidate.r2ObjectKeys) || !Array.isArray(candidate.localSourceRefs)) {
    throw new Error('Removed-SKU reference scan: malformed candidate copy manifest.');
  }
  const copyIds = new Set<string>();
  const expectedKeys = new Set<string>();
  const expectedRefs = new Set<string>();
  for (const copy of candidate.copies) {
    if (!isRecord(copy) || !Array.isArray(copy.localSourceRefs)) {
      throw new Error('Removed-SKU reference scan: malformed candidate copy.');
    }
    const copyId = requiredPathSegment(copy.copyId, 'candidate copy ID');
    const front = requiredString(copy.frontR2Key, 'candidate front R2 key');
    const back = requiredString(copy.backR2Key, 'candidate back R2 key');
    const refs = stringArray(copy.localSourceRefs, 'candidate copy source refs');
    if (copyIds.has(copyId) || front === back || refs.length !== 2) {
      throw new Error('Removed-SKU reference scan: duplicate candidate copy identity.');
    }
    copyIds.add(copyId);
    expectedKeys.add(front);
    expectedKeys.add(back);
    for (const ref of refs) {
      if (expectedRefs.has(ref)) throw new Error('Removed-SKU reference scan: duplicate candidate source ref.');
      expectedRefs.add(ref);
    }
  }
  const keys = stringArray(candidate.r2ObjectKeys, 'candidate R2 keys');
  const refs = stringArray(candidate.localSourceRefs, 'candidate source refs');
  if (new Set(keys).size !== keys.length || new Set(refs).size !== refs.length ||
      keys.length !== expectedKeys.size || refs.length !== expectedRefs.size ||
      keys.some((key) => !expectedKeys.has(key)) || refs.some((ref) => !expectedRefs.has(ref))) {
    throw new Error('Removed-SKU reference scan: candidate copy/key/source mapping is inconsistent.');
  }
  if (!Array.isArray(candidate.ownershipChecks) ||
      candidate.ownershipChecks.length !== REQUIRED_OWNERSHIP_SCOPES.size) {
    throw new Error('Removed-SKU reference scan: malformed candidate ownership checks.');
  }
  const seenScopes = new Set<string>();
  for (const check of candidate.ownershipChecks) {
    if (!isRecord(check) || check.status !== 'unverified' || typeof check.scope !== 'string' ||
        !REQUIRED_OWNERSHIP_SCOPES.has(check.scope as RemovedSkuPurgeOwnershipCheck['scope']) ||
        seenScopes.has(check.scope)) {
      throw new Error('Removed-SKU reference scan: malformed candidate ownership checks.');
    }
    seenScopes.add(check.scope);
  }
  if (seenScopes.size !== REQUIRED_OWNERSHIP_SCOPES.size ||
      !Array.isArray(candidate.requiredChecks) || candidate.requiredChecks.length === 0 ||
      candidate.requiredChecks.some((check) => typeof check !== 'string' || check.trim() === '' || check !== check.trim())) {
    throw new Error('Removed-SKU reference scan: malformed candidate ownership checks.');
  }
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Exact key comparison plus conservative URL path matching. */
function isReferenced(value: string, key: string): boolean {
  if (value === key) return true;
  const suffix = `/${key}`;
  if (value.endsWith(suffix) || decode(value).endsWith(suffix)) return true;
  try {
    const url = new URL(value);
    const pathname = url.pathname.replace(/^\/+/, '');
    const decodedPath = decode(pathname);
    return pathname === key || decodedPath === key || pathname.endsWith(suffix) || decodedPath.endsWith(suffix);
  } catch {
    return false;
  }
}

/** Exact resource-key comparison plus conservative detection of URL references. */
export function findRemovedSkuReferenceConflicts(
  candidate: RemovedSkuPurgeCandidateManifest,
  rows: RemovedSkuOwnershipRows,
): RemovedSkuReferenceConflict[] {
  validateCandidate(candidate);
  validateOwnershipRows(rows);
  const keys = candidate.r2ObjectKeys;
  const refs = candidate.localSourceRefs;
  const resources = [...keys, ...refs];
  const allowedCopies = new Map(candidate.copies.map((copy) => [copy.copyId, copy] as const));
  const conflicts: RemovedSkuReferenceConflict[] = [];
  const conflict = (scope: RemovedSkuReferenceConflict['scope'], owner: string, resource: string) => {
    if (!conflicts.some((entry) => entry.scope === scope && entry.owner === owner && entry.resource === resource)) {
      conflicts.push({ scope, owner, resource });
    }
  };
  for (const copy of rows.variationCopies) {
    for (const resource of [
      copy.front_r2_key, copy.back_r2_key,
      copy.capture_front_source_ref, copy.capture_back_source_ref,
    ]) {
      if (resources.includes(resource)) conflict('variation-groups', `copy:${copy.copy_id}`, resource);
    }
  }
  for (const listing of rows.standardListings) {
    for (const value of [...listing.r2_object_keys, ...listing.image_urls]) {
      const hit = keys.find((key) => isReferenced(value, key)) ?? (refs.includes(value) ? value : null);
      if (hit) conflict('standard-single-lot', `listing:${listing.listing_id}`, hit);
    }
  }
  for (const revision of rows.revisions) {
    const visit = (value: unknown, owner: string, inheritedAllowed: boolean, depth: number) => {
      if (depth > 70) throw new Error('Removed-SKU reference scan: historical snapshot is excessively nested.');
      if (Array.isArray(value)) {
        value.forEach((item, index) => visit(item, `${owner}[${index}]`, inheritedAllowed, depth + 1));
        return;
      }
      if (isRecord(value)) {
        // A historical reference to the very same frozen target copy is provenance,
        // not an independent owner. A different copy or anonymous media record is.
        const ownCopy = revision.group_id === candidate.groupId &&
          value.variation_id === candidate.targetVariationId &&
          typeof value.copy_id === 'string' ? allowedCopies.get(value.copy_id) : undefined;
        for (const [key, child] of Object.entries(value)) {
          const provenanceValue = ownCopy && (
            (key === 'front_r2_key' && child === ownCopy.frontR2Key) ||
            (key === 'back_r2_key' && child === ownCopy.backR2Key) ||
            (key === 'capture_front_source_ref' && child === ownCopy.localSourceRefs[0]) ||
            (key === 'capture_back_source_ref' && child === ownCopy.localSourceRefs[1])
          );
          visit(child, `${owner}.${key}`, Boolean(provenanceValue), depth + 1);
        }
        return;
      }
      if (typeof value === 'string') {
        const hit = keys.find((key) => isReferenced(value, key)) ?? (refs.includes(value) ? value : null);
        if (hit && !inheritedAllowed) conflict('prior-revisions', owner, hit);
      }
    };
    visit(revision.snapshot, `revision:${revision.revision_id}`, false, 0);
  }
  return conflicts;
}

function isWithin(root: string, target: string): boolean {
  const diff = relative(root, target);
  return diff !== '' && diff !== '..' && !diff.startsWith(`..${sep}`) && !isAbsolute(diff);
}

function isWithinOrEqual(root: string, target: string): boolean {
  return root === target || isWithin(root, target);
}

async function existingCanonicalParent(path: string): Promise<string | null> {
  let cursor = path;
  while (true) {
    try {
      return await realpath(cursor);
    } catch (error) {
      if (!isRecord(error) || error.code !== 'ENOENT') return null;
      const parent = dirname(cursor);
      if (parent === cursor) return null;
      cursor = parent;
    }
  }
}

/**
 * Local source refs can be opaque or moved by the watcher. Nothing here
 * guesses a root or treats a missing file as safe to delete.
 */
export async function inspectRemovedSkuLocalFiles(
  refs: readonly string[],
  trustedRoots: readonly string[],
): Promise<RemovedSkuLocalFileObservation[]> {
  const roots: string[] = [];
  for (const input of trustedRoots) {
    if (!isAbsolute(input)) throw new Error('Removed-SKU reference scan: trusted local root must be absolute.');
    let root: string;
    try {
      root = await realpath(resolve(input));
      const metadata = await stat(root);
      if (!metadata.isDirectory()) throw new Error('not-directory');
    } catch {
      throw new Error('Removed-SKU reference scan: trusted local root is inaccessible or not a directory.');
    }
    if (roots.some((existing) => isWithinOrEqual(existing, root) || isWithinOrEqual(root, existing))) {
      throw new Error('Removed-SKU reference scan: trusted local roots overlap or alias to one another.');
    }
    roots.push(root);
  }
  const observations: RemovedSkuLocalFileObservation[] = [];
  const resolvedOwners = new Map<string, number>();
  for (const ref of refs) {
    if (!isAbsolute(ref) || roots.length === 0) {
      observations.push({ sourceRef: ref, status: 'unverified', resolvedPath: null, reason: 'Opaque/relative reference or no approved local root.' });
      continue;
    }
    const path = resolve(ref);
    // Canonicalize before comparing: macOS `/var` and `/private/var` (and
    // configured symlink aliases) must not turn an in-root file into a false
    // outside-root result.
    const canonicalHint = await existingCanonicalParent(path);
    const root = canonicalHint
      ? roots.find((candidate) => isWithinOrEqual(candidate, canonicalHint))
      : undefined;
    if (!root) {
      observations.push({ sourceRef: ref, status: 'unverified', resolvedPath: null, reason: 'Outside approved local storage roots.' });
      continue;
    }
    try {
      const metadata = await lstat(path);
      if (metadata.isSymbolicLink()) {
        let resolvedPath: string;
        try {
          resolvedPath = await realpath(path);
        } catch {
          observations.push({ sourceRef: ref, status: 'unverified', resolvedPath: null, reason: 'Final symlink cannot be canonically resolved.' });
          continue;
        }
        observations.push({ sourceRef: ref, status: 'unverified', resolvedPath: null,
          reason: isWithin(root, resolvedPath) ? 'Final symlink is not an owned regular file.' : 'Final symlink escapes approved local storage root.' });
        continue;
      }
      if (!metadata.isFile()) {
        observations.push({ sourceRef: ref, status: 'unverified', resolvedPath: null, reason: 'Path is not a regular file.' });
        continue;
      }
      const resolvedPath = await realpath(path);
      if (!isWithin(root, resolvedPath)) {
        observations.push({ sourceRef: ref, status: 'unverified', resolvedPath: null, reason: 'Intermediate symlink escapes approved local storage root.' });
        continue;
      }
      const info = await stat(path);
      const previous = resolvedOwners.get(resolvedPath);
      if (previous !== undefined || info.nlink > 1) {
        const observation = { sourceRef: ref, resolvedPath, status: 'shared' as const, reason: info.nlink > 1 ? 'File has multiple hard links.' : 'Multiple refs resolve to the same file.' };
        observations.push(observation);
        if (previous !== undefined) {
          observations[previous] = {
            ...observations[previous],
            status: 'shared',
            reason: observation.reason,
          };
        }
      } else {
        resolvedOwners.set(resolvedPath, observations.length);
        observations.push({ sourceRef: ref, resolvedPath, status: 'present', reason: 'Read-only file presence verified; ownership remains unverified.' });
      }
    } catch (error) {
      if (isRecord(error) && error.code === 'ENOENT') {
        const parent = await existingCanonicalParent(path);
        if (parent && isWithinOrEqual(root, parent)) {
          observations.push({ sourceRef: ref, status: 'missing', resolvedPath: null, reason: 'Canonical in-root parent verified; target path is absent and ownership remains unverified.' });
        } else {
          observations.push({ sourceRef: ref, status: 'unverified', resolvedPath: null, reason: 'Missing path has no verified canonical in-root parent.' });
        }
      } else {
        observations.push({ sourceRef: ref, status: 'unverified', resolvedPath: null, reason: 'Filesystem could not be verified.' });
      }
    }
  }
  return observations;
}

function watcherKeyFormat(candidate: RemovedSkuPurgeCandidateManifest, copyId: string, role: 'front' | 'back', key: string): boolean {
  if (!UUID.test(candidate.groupId) || !UUID.test(candidate.targetVariationId) || !UUID.test(copyId)) return false;
  const prefix = `variation-listing/${candidate.groupId}/${candidate.targetVariationId}/${copyId}/${role}-`;
  if (!key.startsWith(prefix)) return false;
  const suffix = key.slice(prefix.length);
  const extension = suffix.slice(suffix.lastIndexOf('.'));
  const digest = extension ? suffix.slice(0, -extension.length) : '';
  return /^[0-9a-f]{12}$/.test(digest) && WATCHER_IMAGE_EXTENSIONS.has(extension);
}

async function inspectR2Key(
  candidate: RemovedSkuPurgeCandidateManifest,
  copyId: string,
  role: 'front' | 'back',
  key: string,
  inspector: RemovedSkuR2MetadataInspector | undefined,
): Promise<RemovedSkuR2KeyCheck> {
  const formatValid = watcherKeyFormat(candidate, copyId, role, key);
  if (!formatValid) return { key, formatValid, status: 'unknown', reason: 'R2 key does not match the exact watcher object-key format.' };
  if (!inspector) return { key, formatValid, status: 'unknown', reason: 'Read-only R2 metadata inspector is not configured.' };
  try {
    const metadata = await inspector(key);
    if (!isRecord(metadata) || metadata.objectKey !== key || typeof metadata.status !== 'string' ||
        !['present', 'absent', 'inaccessible', 'unknown'].includes(metadata.status)) {
      return { key, formatValid, status: 'unknown', reason: 'R2 metadata inspector returned malformed evidence.' };
    }
    return {
      key,
      formatValid,
      status: metadata.status as R2ObjectMetadataInspection['status'],
      reason: typeof metadata.reason === 'string' ? metadata.reason : `R2 metadata status: ${metadata.status}.`,
    };
  } catch {
    return { key, formatValid, status: 'unknown', reason: 'R2 metadata inspection failed; ownership is unknown.' };
  }
}

/** Scans are diagnostic only. No R2 write/delete occurs here. */
export async function inspectRemovedSkuOwnership(input: {
  candidate: RemovedSkuPurgeCandidateManifest;
  rows: RemovedSkuOwnershipRows;
  trustedLocalRoots?: readonly string[];
  r2MetadataInspector?: RemovedSkuR2MetadataInspector;
}): Promise<RemovedSkuOwnershipAudit> {
  const { candidate, rows } = input;
  validateCandidate(candidate);
  validateOwnershipRows(rows);
  const referenceConflicts = findRemovedSkuReferenceConflicts(candidate, rows);
  const localFiles = await inspectRemovedSkuLocalFiles(candidate.localSourceRefs, input.trustedLocalRoots ?? []);
  const r2KeyChecks = await Promise.all(candidate.copies.flatMap((copy) => [
    inspectR2Key(candidate, copy.copyId, 'front', copy.frontR2Key, input.r2MetadataInspector),
    inspectR2Key(candidate, copy.copyId, 'back', copy.backR2Key, input.r2MetadataInspector),
  ]));
  const scopes = ['variation-groups', 'standard-single-lot', 'prior-revisions'] as const;
  return {
    groupId: candidate.groupId,
    revisionId: candidate.revisionId,
    targetSku: candidate.targetSku,
    databaseChecks: scopes.map((scope) => ({
      scope,
      status: referenceConflicts.some((conflict) => conflict.scope === scope) ? 'conflict' : 'clear',
    })),
    referenceConflicts,
    localFiles,
    r2KeyChecks,
    deletionAuthorized: false,
    outstandingChecks: [
      'Re-check all references against a transactionally consistent, fresh database view immediately before any delete.',
      'R2 metadata status is read-only and does not prove exclusive ownership; verify all other references and metadata before any purge.',
      'Verify all local source, cached, staged and processed paths under configured roots and no symlink or shared-file ownership.',
      'A separate explicit authorization and idempotent partial-failure recovery remain required.',
    ],
  };
}
