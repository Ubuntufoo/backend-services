import type { Json } from '@ebay-inventory/data';
import type { RemovedSkuPurgeCandidateManifest } from '@/ebay/variation-listing-removed-sku-purge-preview.js';

const OWNERSHIP_SCOPES = [
  'variation-groups',
  'standard-single-lot',
  'prior-revisions',
  'local-files',
  'r2-objects',
] as const;

const CANDIDATE_KEYS = [
  'groupId', 'revisionId', 'targetVariationId', 'targetSku', 'r2ObjectKeys',
  'copies', 'localSourceRefs', 'ownershipChecks', 'deletionAuthorized', 'requiredChecks',
];
const COPY_KEYS = ['copyId', 'frontR2Key', 'backR2Key', 'localSourceRefs'];
const OWNERSHIP_CHECK_KEYS = ['scope', 'status'];
const WITNESS_KEYS = [
  'version', 'groupId', 'revisionId', 'targetVariationId', 'targetSku',
  'confirmedRevision', 'desiredRevision', 'capturedDesiredRevision', 'copyIds',
  'r2ObjectKeys', 'sourceRefs', 'liveVariationReferenceCount',
  'standardReferenceCount', 'otherGroupRevisionReferenceCount',
  'sameGroupHistoricalReferencesVerified', 'journalHistoryVerified',
  'referenceSearchComplete', 'singleStatementSnapshot', 'deletionAuthorized',
];

export interface RemovedSkuPredeleteWitness {
  version: 1;
  groupId: string;
  revisionId: string;
  targetVariationId: string;
  targetSku: string;
  confirmedRevision: number;
  desiredRevision: number;
  capturedDesiredRevision: number;
  copyIds: string[];
  r2ObjectKeys: string[];
  sourceRefs: string[];
  liveVariationReferenceCount: number;
  standardReferenceCount: number;
  otherGroupRevisionReferenceCount: number;
  sameGroupHistoricalReferencesVerified: false;
  journalHistoryVerified: false;
  referenceSearchComplete: false;
  singleStatementSnapshot: true;
  deletionAuthorized: false;
}

export interface RemovedSkuPredeleteAssessment {
  witness: RemovedSkuPredeleteWitness;
  referenceCountsClear: boolean;
  deletionAuthorized: false;
  blockers: string[];
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Removed-SKU pre-delete ${label} is malformed.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`Removed-SKU pre-delete ${label} fields are malformed.`);
  }
}

function trimmedString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value;
}

function strings(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((x) => !trimmedString(x))) {
    throw new Error(`Removed-SKU pre-delete ${label} are malformed.`);
  }
  const result = value as string[];
  if (new Set(result).size !== result.length) {
    throw new Error(`Removed-SKU pre-delete ${label} are duplicated.`);
  }
  return [...result];
}

function count(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error('Removed-SKU pre-delete witness count is malformed.');
  }
  return value as number;
}

function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error('Removed-SKU pre-delete witness revision is malformed.');
  }
  return value as number;
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && new Set(left).size === left.length &&
    new Set(right).size === right.length && left.every((value) => right.includes(value));
}

function validateCandidate(candidate: unknown): {
  groupId: string;
  revisionId: string;
  targetVariationId: string;
  targetSku: string;
  copyIds: string[];
  r2ObjectKeys: string[];
  localSourceRefs: string[];
} {
  const value = object(candidate, 'candidate');
  exactKeys(value, CANDIDATE_KEYS, 'candidate');
  for (const key of ['groupId', 'revisionId', 'targetVariationId', 'targetSku'] as const) {
    if (!trimmedString(value[key])) {
      throw new Error(`Removed-SKU pre-delete candidate ${key} is malformed.`);
    }
  }
  if (value.deletionAuthorized !== false) {
    throw new Error('Removed-SKU pre-delete candidate deletion authorization is invalid.');
  }

  const r2ObjectKeys = strings(value.r2ObjectKeys, 'candidate R2 object keys');
  const localSourceRefs = strings(value.localSourceRefs, 'candidate local source references');
  if (!Array.isArray(value.copies) || value.copies.length === 0) {
    throw new Error('Removed-SKU pre-delete candidate copies are malformed.');
  }
  const copyIds: string[] = [];
  const copyKeys: string[] = [];
  const copyRefs: string[] = [];
  for (const rawCopy of value.copies) {
    const copy = object(rawCopy, 'candidate copy');
    exactKeys(copy, COPY_KEYS, 'candidate copy');
    if (!trimmedString(copy.copyId) || !trimmedString(copy.frontR2Key) ||
        !trimmedString(copy.backR2Key) || copy.frontR2Key === copy.backR2Key) {
      throw new Error('Removed-SKU pre-delete candidate copy identity is malformed.');
    }
    const refs = copy.localSourceRefs;
    if (!Array.isArray(refs) || refs.length !== 2 || refs.some((ref) => !trimmedString(ref)) ||
        new Set(refs).size !== refs.length) {
      throw new Error('Removed-SKU pre-delete candidate copy source references are malformed.');
    }
    copyIds.push(copy.copyId);
    copyKeys.push(copy.frontR2Key, copy.backR2Key);
    copyRefs.push(...(refs as string[]));
  }
  if (new Set(copyIds).size !== copyIds.length || new Set(copyKeys).size !== copyKeys.length ||
      new Set(copyRefs).size !== copyRefs.length || !sameSet(r2ObjectKeys, copyKeys) ||
      !sameSet(localSourceRefs, copyRefs)) {
    throw new Error('Removed-SKU pre-delete candidate resource identity is malformed.');
  }

  if (!Array.isArray(value.ownershipChecks) || value.ownershipChecks.length !== OWNERSHIP_SCOPES.length) {
    throw new Error('Removed-SKU pre-delete candidate ownership checks are malformed.');
  }
  const scopes: string[] = [];
  for (const rawCheck of value.ownershipChecks) {
    const check = object(rawCheck, 'candidate ownership check');
    exactKeys(check, OWNERSHIP_CHECK_KEYS, 'candidate ownership check');
    if (!trimmedString(check.scope) || check.status !== 'unverified' ||
        !(OWNERSHIP_SCOPES as readonly string[]).includes(check.scope)) {
      throw new Error('Removed-SKU pre-delete candidate ownership checks are malformed.');
    }
    scopes.push(check.scope);
  }
  if (new Set(scopes).size !== OWNERSHIP_SCOPES.length || !sameSet(scopes, OWNERSHIP_SCOPES)) {
    throw new Error('Removed-SKU pre-delete candidate ownership checks are malformed.');
  }
  if (!Array.isArray(value.requiredChecks) || value.requiredChecks.length === 0 ||
      value.requiredChecks.some((check) => !trimmedString(check))) {
    throw new Error('Removed-SKU pre-delete candidate required checks are malformed.');
  }

  return {
    groupId: value.groupId as string,
    revisionId: value.revisionId as string,
    targetVariationId: value.targetVariationId as string,
    targetSku: value.targetSku as string,
    copyIds,
    r2ObjectKeys,
    localSourceRefs,
  };
}

/** Validates a fresh SQL snapshot but NEVER transforms that read into delete authority. */
export function assessRemovedSkuPredeleteWitness(
  candidate: RemovedSkuPurgeCandidateManifest,
  raw: Json,
): RemovedSkuPredeleteAssessment {
  const validCandidate = validateCandidate(candidate);
  const value = object(raw, 'witness');
  exactKeys(value, WITNESS_KEYS, 'witness');
  if (value.version !== 1 || value.groupId !== validCandidate.groupId ||
      value.revisionId !== validCandidate.revisionId ||
      value.targetVariationId !== validCandidate.targetVariationId ||
      value.targetSku !== validCandidate.targetSku || value.singleStatementSnapshot !== true ||
      value.sameGroupHistoricalReferencesVerified !== false ||
      value.journalHistoryVerified !== false || value.referenceSearchComplete !== false ||
      value.deletionAuthorized !== false) {
    throw new Error('Removed-SKU pre-delete witness identity or safety contract is invalid.');
  }
  const witness = {
    version: 1 as const,
    groupId: validCandidate.groupId,
    revisionId: validCandidate.revisionId,
    targetVariationId: validCandidate.targetVariationId,
    targetSku: validCandidate.targetSku,
    confirmedRevision: revision(value.confirmedRevision),
    desiredRevision: revision(value.desiredRevision),
    capturedDesiredRevision: revision(value.capturedDesiredRevision),
    copyIds: strings(value.copyIds, 'witness copy IDs'),
    r2ObjectKeys: strings(value.r2ObjectKeys, 'witness R2 object keys'),
    sourceRefs: strings(value.sourceRefs, 'witness source references'),
    liveVariationReferenceCount: count(value.liveVariationReferenceCount),
    standardReferenceCount: count(value.standardReferenceCount),
    otherGroupRevisionReferenceCount: count(value.otherGroupRevisionReferenceCount),
    sameGroupHistoricalReferencesVerified: false as const,
    journalHistoryVerified: false as const,
    referenceSearchComplete: false as const,
    singleStatementSnapshot: true as const,
    deletionAuthorized: false as const,
  };
  if (witness.confirmedRevision !== witness.desiredRevision ||
      witness.confirmedRevision < witness.capturedDesiredRevision ||
      !sameSet(witness.copyIds, validCandidate.copyIds) ||
      !sameSet(witness.r2ObjectKeys, validCandidate.r2ObjectKeys) ||
      !sameSet(witness.sourceRefs, validCandidate.localSourceRefs)) {
    throw new Error('Removed-SKU pre-delete witness conflicts with the immutable candidate resource identity.');
  }
  const blockers = [
    ...(witness.liveVariationReferenceCount ? ['Live Variation copy references remain.'] : []),
    ...(witness.standardReferenceCount ? ['Standard Single/Lot references remain.'] : []),
    ...(witness.otherGroupRevisionReferenceCount ? ['Other-group historical revision references remain.'] : []),
    'Same-group historical ownership is not verified by this witness.',
    'Journal history verification is incomplete.',
    'Reference search coverage is incomplete.',
    'A statement snapshot cannot prevent later database, filesystem or R2 changes.',
    'A separate confirmed and crash-safe deletion operation has not been implemented.',
  ];
  return { witness, referenceCountsClear: false, deletionAuthorized: false, blockers };
}
