import {createHash} from 'node:crypto';

import type {RemovedSkuPurgeCandidateManifest} from '@/ebay/variation-listing-removed-sku-purge-preview.js';

export interface RemovedSkuR2ContentObservation {
  objectKey: string;
  status: 'present' | 'absent' | 'inaccessible' | 'unknown';
  /** Bytes from a bounded, successful GET of this exact object key. */
  body?: Uint8Array;
  /** ETags obtained independently from HEAD and GET. */
  headEtag?: string;
  getEtag?: string;
  contentLength?: number;
}

export interface RemovedSkuR2ContentProof {
  verifiedKeys: string[];
  blockers: string[];
  /** Content integrity is not exclusive ownership or an atomic DELETE guarantee. */
  deletionAuthorized: false;
}

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const DIGEST_AND_EXTENSION = /^([a-f0-9]{12})\.(?:jpg|jpeg|png|webp)$/;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
/** Bound aggregate caller-supplied bytes hashed in one offline proof. */
const MAX_TOTAL_IMAGE_BYTES = 64 * 1024 * 1024;
const MAX_COPIES = 128;
const MAX_OBJECT_KEYS = MAX_COPIES * 2;
const MAX_OBSERVATIONS = MAX_OBJECT_KEYS;
const MAX_TEXT_LENGTH = 4096;
const OWNERSHIP_SCOPES = [
  'variation-groups',
  'standard-single-lot',
  'prior-revisions',
  'local-files',
  'r2-objects',
] as const;

function plainRecord(value: unknown, label = 'frozen candidate'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Removed-SKU R2 proof: invalid ${label}.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`Removed-SKU R2 proof: invalid ${label}.`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !Object.prototype.propertyIsEnumerable.call(value, key)) {
      throw new Error(`Removed-SKU R2 proof: malformed ${label}.`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) {
      throw new Error(`Removed-SKU R2 proof: malformed ${label}.`);
    }
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`Removed-SKU R2 proof: malformed ${label}.`);
  }
}

function allowedKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  if (Object.keys(value).some((key) => !keys.includes(key))) {
    throw new Error(`Removed-SKU R2 proof: malformed ${label}.`);
  }
}

function boundedText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_TEXT_LENGTH ||
      value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`Removed-SKU R2 proof: malformed ${label}.`);
  }
  return value;
}

function exactStringArray(value: unknown, label: string, maxLength: number, rejectDuplicates = true): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxLength) {
    throw new Error(`Removed-SKU R2 proof: malformed ${label}.`);
  }
  const strings = Array.from(value, (entry) => boundedText(entry, label));
  if (rejectDuplicates && new Set(strings).size !== strings.length) {
    throw new Error(`Removed-SKU R2 proof: duplicate ${label}.`);
  }
  return strings;
}

function frozenKeys(candidate: RemovedSkuPurgeCandidateManifest): Map<string, string> {
  const candidateRecord = plainRecord(candidate);
  exactKeys(candidateRecord, [
    'groupId', 'revisionId', 'targetVariationId', 'targetSku', 'r2ObjectKeys',
    'copies', 'localSourceRefs', 'ownershipChecks', 'deletionAuthorized', 'requiredChecks',
  ], 'frozen candidate');
  if (candidate.deletionAuthorized !== false ||
      typeof candidate.groupId !== 'string' || !UUID.test(candidate.groupId) ||
      typeof candidate.revisionId !== 'string' || !UUID.test(candidate.revisionId) ||
      typeof candidate.targetVariationId !== 'string' || !UUID.test(candidate.targetVariationId)) {
    throw new Error('Removed-SKU R2 proof: invalid frozen candidate.');
  }
  boundedText(candidate.targetSku, 'candidate SKU');
  if (!Array.isArray(candidate.copies) || candidate.copies.length === 0 || candidate.copies.length > MAX_COPIES) {
    throw new Error('Removed-SKU R2 proof: invalid frozen candidate copies.');
  }
  const candidateKeys = exactStringArray(candidate.r2ObjectKeys, 'candidate R2 keys', MAX_OBJECT_KEYS, false);
  const candidateRefs = exactStringArray(candidate.localSourceRefs, 'candidate source refs', MAX_OBJECT_KEYS);
  exactStringArray(candidate.requiredChecks, 'required ownership checks', MAX_OBJECT_KEYS);
  if (!Array.isArray(candidate.ownershipChecks) || candidate.ownershipChecks.length !== OWNERSHIP_SCOPES.length) {
    throw new Error('Removed-SKU R2 proof: malformed ownership checks.');
  }
  const scopes = new Set<string>();
  for (const rawCheck of candidate.ownershipChecks) {
    const check = plainRecord(rawCheck, 'ownership check');
    exactKeys(check, ['scope', 'status'], 'ownership check');
    if (typeof check.scope !== 'string' || !OWNERSHIP_SCOPES.includes(check.scope as typeof OWNERSHIP_SCOPES[number]) ||
        check.status !== 'unverified' || scopes.has(check.scope)) {
      throw new Error('Removed-SKU R2 proof: malformed ownership checks.');
    }
    scopes.add(check.scope);
  }

  const expected = new Map<string, string>();
  const expectedRefs = new Set<string>();
  const seenCopies = new Set<string>();
  for (const copy of candidate.copies) {
    const copyRecord = plainRecord(copy, 'frozen copy');
    exactKeys(copyRecord, ['copyId', 'frontR2Key', 'backR2Key', 'localSourceRefs'], 'frozen copy');
    if (typeof copy.copyId !== 'string' || !UUID.test(copy.copyId) || seenCopies.has(copy.copyId) ||
        !Array.isArray(copy.localSourceRefs) || copy.localSourceRefs.length !== 2) {
      throw new Error('Removed-SKU R2 proof: invalid or repeated copy identity.');
    }
    const copyRefs = Array.from(copy.localSourceRefs, (ref) => boundedText(ref, 'copy source reference'));
    if (copyRefs[0] === copyRefs[1] || copyRefs.some((ref) => expectedRefs.has(ref))) {
      throw new Error('Removed-SKU R2 proof: duplicate copy source reference.');
    }
    copyRefs.forEach((ref) => expectedRefs.add(ref));
    if (copyRefs.some((ref) => !candidateRefs.includes(ref))) {
      throw new Error('Removed-SKU R2 proof: copy/source ownership mapping is inconsistent.');
    }
    seenCopies.add(copy.copyId);
    for (const [role, key] of [
      ['front', copy.frontR2Key],
      ['back', copy.backR2Key],
    ] as const) {
      const prefix = `variation-listing/${candidate.groupId}/${candidate.targetVariationId}/${copy.copyId}/${role}-`;
      const match = typeof key === 'string' && key.length <= MAX_TEXT_LENGTH && key.startsWith(prefix)
        ? DIGEST_AND_EXTENSION.exec(key.slice(prefix.length))
        : null;
      if (!match || expected.has(key)) {
        throw new Error('Removed-SKU R2 proof: duplicate or malformed frozen object key.');
      }
      expected.set(key, match[1]!);
    }
  }
  if (candidateKeys.length !== expected.size || new Set(candidateKeys).size !== candidateKeys.length ||
      candidateRefs.length !== expectedRefs.size || candidateRefs.some((ref) => !expectedRefs.has(ref)) ||
      candidateKeys.some(key => !expected.has(key)) || scopes.size !== OWNERSHIP_SCOPES.length) {
    throw new Error('Removed-SKU R2 proof: frozen key set is inconsistent.');
  }
  return expected;
}

/**
 * Offline-only content verification. The caller supplies bounded read-only
 * HEAD/GET observations. This function never contacts R2 or deletes images.
 *
 * A matching SHA-256 key suffix and ETag verifies observed bytes, NOT exclusive
 * ownership, immutable writer lineage, or identity at a later DELETE.
 */
export function verifyRemovedSkuR2Content(
  candidate: RemovedSkuPurgeCandidateManifest,
  observations: readonly RemovedSkuR2ContentObservation[],
): RemovedSkuR2ContentProof {
  const expected = frozenKeys(candidate);
  if (!Array.isArray(observations) || observations.length > MAX_OBSERVATIONS) {
    throw new Error('Removed-SKU R2 proof: observations are malformed or oversized.');
  }
  const blockers: string[] = [];
  const verifiedKeys: string[] = [];
  const seen = new Set<string>();
  let totalBodyBytes = 0;
  let aggregateBodyLimitExceeded = false;

  for (const observation of observations) {
    const record = plainRecord(observation, 'observation');
    allowedKeys(record, ['objectKey', 'status', 'body', 'headEtag', 'getEtag', 'contentLength'], 'observation');
    if (typeof observation.objectKey !== 'string' || !expected.has(observation.objectKey) ||
        seen.has(observation.objectKey)) {
      throw new Error('Removed-SKU R2 proof: unexpected or duplicate observation.');
    }
    seen.add(observation.objectKey);
    if (observation.body instanceof Uint8Array) {
      totalBodyBytes += observation.body.byteLength;
      if (totalBodyBytes > MAX_TOTAL_IMAGE_BYTES) aggregateBodyLimitExceeded = true;
    }
    if (aggregateBodyLimitExceeded) continue;
    if (observation.status !== 'present' || !(observation.body instanceof Uint8Array) ||
        observation.body.byteLength === 0 || observation.body.byteLength > MAX_IMAGE_BYTES ||
        observation.contentLength !== observation.body.byteLength ||
        typeof observation.headEtag !== 'string' || observation.headEtag.length === 0 ||
        observation.headEtag.length > MAX_TEXT_LENGTH || observation.headEtag.trim() !== observation.headEtag ||
        /[\u0000-\u001f\u007f]/.test(observation.headEtag) || observation.getEtag !== observation.headEtag) {
      blockers.push(`R2 image evidence missing, oversized, stale, or unverifiable: ${observation.objectKey}`);
      continue;
    }
    const digest = createHash('sha256').update(observation.body).digest('hex').slice(0, 12);
    if (digest !== expected.get(observation.objectKey)) {
      blockers.push(`R2 image content differs from the frozen digest: ${observation.objectKey}`);
      continue;
    }
    verifiedKeys.push(observation.objectKey);
  }

  for (const key of expected.keys()) {
    if (!seen.has(key)) blockers.push(`Frozen R2 image has no complete HEAD/GET evidence: ${key}`);
  }
  if (aggregateBodyLimitExceeded) {
    return {
      verifiedKeys: [],
      blockers: [...blockers, `R2 image evidence exceeds the ${MAX_TOTAL_IMAGE_BYTES} byte aggregate body limit.`],
      deletionAuthorized: false,
    };
  }
  // Even full content verification never grants destructive authority.
  return {verifiedKeys, blockers, deletionAuthorized: false};
}
