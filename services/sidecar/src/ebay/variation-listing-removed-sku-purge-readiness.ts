import {isAbsolute} from 'node:path';

import type {
  Json,
  VariationListingAggregateSnapshot,
  VariationListingPublishingCheckpointRow,
  VariationListingRevisionRow,
} from '@ebay-inventory/data';
import {
  buildRemovedSkuPurgeCandidateManifest,
  type RemovedSkuPurgeCandidateManifest,
} from '@/ebay/variation-listing-removed-sku-purge-preview.js';
import {
  inspectRemovedSkuOwnership,
  type RemovedSkuOwnershipRows,
  type RemovedSkuOwnershipAudit,
  type RemovedSkuR2MetadataInspector,
} from '@/ebay/variation-listing-removed-sku-ownership.js';
import {
  inventoryRemovedSkuLocalArtifacts,
  type RemovedSkuLocalArtifactInventory,
  type RemovedSkuLocalArtifactRoot,
} from '@/ebay/variation-listing-removed-sku-local-artifacts.js';
import {
  assessRemovedSkuPredeleteWitness,
  type RemovedSkuPredeleteAssessment,
} from '@/ebay/variation-listing-removed-sku-predelete.js';

export interface RemovedSkuPurgeReadiness {
  kind: 'removed_sku_read_only_readiness';
  groupId: string;
  revisionId: string;
  targetVariationId: string;
  targetSku: string;
  /** Candidate identifiers are for operator preview, never an executable delete list. */
  r2ObjectKeys: string[];
  localPaths: string[];
  r2Present: number;
  r2Absent: number;
  r2UnknownOrInaccessible: number;
  localPresent: number;
  localUnverifiedOrShared: number;
  databaseReferenceConflicts: number;
  /** The database witness, when available, is only one diagnostic source. */
  databaseWitnessUsed: boolean;
  blockers: string[];
  /** No endpoint or executor may infer authorization from this result. */
  deletionAuthorized: false;
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length &&
    new Set(left).size === left.length &&
    new Set(right).size === right.length &&
    left.every((item) => right.includes(item));
}

const DATABASE_SCOPES = [
  'variation-groups',
  'standard-single-lot',
  'prior-revisions',
] as const;
const OWNERSHIP_SCOPES = [
  'variation-groups',
  'standard-single-lot',
  'prior-revisions',
  'local-files',
  'r2-objects',
] as const;
const R2_STATUSES = ['present', 'absent', 'unknown', 'inaccessible'] as const;
const LOCAL_FILE_STATUSES = ['missing', 'present', 'unverified', 'shared'] as const;
const LOCAL_CANDIDATE_MATCHES = ['source-reference', 'identity-in-path'] as const;
const LOCAL_CANDIDATE_STATUSES = ['present', 'unverified', 'shared'] as const;
const LOCAL_ROOT_KINDS = ['incoming', 'processed', 'staging', 'cache'] as const;

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value;
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function validateReadinessInputs(
  candidate: RemovedSkuPurgeCandidateManifest,
  ownership: RemovedSkuOwnershipAudit,
  local: RemovedSkuLocalArtifactInventory,
  predelete: RemovedSkuPredeleteAssessment | null,
): void {
  if (!candidate || typeof candidate !== 'object' || candidate.deletionAuthorized !== false ||
      !nonEmptyString(candidate.groupId) || !nonEmptyString(candidate.revisionId) ||
      !nonEmptyString(candidate.targetVariationId) || !nonEmptyString(candidate.targetSku) ||
      !Array.isArray(candidate.copies) || candidate.copies.length === 0 ||
      !Array.isArray(candidate.r2ObjectKeys) || !Array.isArray(candidate.localSourceRefs) ||
      !candidate.r2ObjectKeys.every(nonEmptyString) || !candidate.localSourceRefs.every(nonEmptyString) ||
      !Array.isArray(candidate.ownershipChecks) || candidate.ownershipChecks.length !== OWNERSHIP_SCOPES.length ||
      !Array.isArray(candidate.requiredChecks) || candidate.requiredChecks.length === 0 ||
      !candidate.requiredChecks.every(nonEmptyString)) {
    throw new Error('Removed-SKU readiness inputs contain a malformed candidate.');
  }
  const candidateCopyIds: string[] = [];
  const candidateKeys: string[] = [];
  const candidateRefs: string[] = [];
  for (const copy of candidate.copies) {
    if (!copy || typeof copy !== 'object' || !nonEmptyString(copy.copyId) ||
        !nonEmptyString(copy.frontR2Key) || !nonEmptyString(copy.backR2Key) ||
        copy.frontR2Key === copy.backR2Key || !Array.isArray(copy.localSourceRefs) ||
        copy.localSourceRefs.length !== 2 || !copy.localSourceRefs.every(nonEmptyString) ||
        copy.localSourceRefs[0] === copy.localSourceRefs[1]) {
      throw new Error('Removed-SKU readiness inputs contain a malformed candidate copy.');
    }
    candidateCopyIds.push(copy.copyId);
    candidateKeys.push(copy.frontR2Key, copy.backR2Key);
    candidateRefs.push(...copy.localSourceRefs);
  }
  if (!sameSet(candidateKeys, candidate.r2ObjectKeys) ||
      !sameSet(candidateRefs, candidate.localSourceRefs) ||
      new Set(candidateCopyIds).size !== candidateCopyIds.length) {
    throw new Error('Removed-SKU readiness candidate resource mapping is inconsistent.');
  }
  const candidateScopes = candidate.ownershipChecks.map((check) => check?.scope);
  if (!sameSet(candidateScopes, OWNERSHIP_SCOPES) ||
      candidate.ownershipChecks.some((check) => check?.status !== 'unverified')) {
    throw new Error('Removed-SKU readiness candidate ownership checks are malformed.');
  }

  if (!ownership || typeof ownership !== 'object' || ownership.deletionAuthorized !== false ||
      ownership.groupId !== candidate.groupId || ownership.revisionId !== candidate.revisionId ||
      ownership.targetSku !== candidate.targetSku || !Array.isArray(ownership.databaseChecks) ||
      !sameSet(ownership.databaseChecks.map((check) => check?.scope), DATABASE_SCOPES) ||
      ownership.databaseChecks.some((check) => check?.status !== 'clear' && check?.status !== 'conflict') ||
      !Array.isArray(ownership.referenceConflicts) || !Array.isArray(ownership.localFiles) ||
      !Array.isArray(ownership.r2KeyChecks) || !Array.isArray(ownership.outstandingChecks) ||
      !ownership.outstandingChecks.every(nonEmptyString) ||
      !sameSet(ownership.r2KeyChecks.map((check) => check?.key), candidate.r2ObjectKeys) ||
      !sameSet(ownership.localFiles.map((file) => file?.sourceRef), candidate.localSourceRefs)) {
    throw new Error('Removed-SKU readiness ownership evidence is malformed or inconsistent.');
  }
  for (const conflict of ownership.referenceConflicts) {
    if (!conflict || typeof conflict !== 'object' ||
        !(DATABASE_SCOPES as readonly string[]).includes(conflict.scope) ||
        !nonEmptyString(conflict.owner) || !nonEmptyString(conflict.resource)) {
      throw new Error('Removed-SKU readiness database conflict evidence is malformed.');
    }
  }
  for (const check of ownership.databaseChecks) {
    const conflictObserved = ownership.referenceConflicts.some((conflict) => conflict.scope === check.scope);
    if ((check.status === 'conflict') !== conflictObserved) {
      throw new Error('Removed-SKU readiness database ownership evidence is internally inconsistent.');
    }
  }
  for (const file of ownership.localFiles) {
    if (!file || typeof file !== 'object' || !nonEmptyString(file.sourceRef) ||
        !(LOCAL_FILE_STATUSES as readonly string[]).includes(file.status) ||
        (file.resolvedPath !== null && (!nonEmptyString(file.resolvedPath) || !isAbsolute(file.resolvedPath))) ||
        !nonEmptyString(file.reason)) {
      throw new Error('Removed-SKU readiness local ownership evidence is malformed.');
    }
  }
  for (const check of ownership.r2KeyChecks) {
    if (!check || typeof check !== 'object' || !nonEmptyString(check.key) ||
        typeof check.formatValid !== 'boolean' ||
        !(R2_STATUSES as readonly string[]).includes(check.status) ||
        !nonEmptyString(check.reason)) {
      throw new Error('Removed-SKU readiness R2 ownership evidence is malformed.');
    }
  }

  if (!local || typeof local !== 'object' || local.deletionAuthorized !== false ||
      typeof local.scannedConfiguredRootsCompletely !== 'boolean' ||
      !nonNegativeSafeInteger(local.configuredRootCount) ||
      !nonNegativeSafeInteger(local.scannedEntryCount) || !Array.isArray(local.sourceFiles) ||
      !Array.isArray(local.candidates) || !Array.isArray(local.unresolved) ||
      !local.unresolved.every(nonEmptyString) ||
      !sameSet(local.sourceFiles.map((file) => file?.sourceRef), candidate.localSourceRefs)) {
    throw new Error('Removed-SKU readiness local inventory is malformed or inconsistent.');
  }
  for (const file of local.sourceFiles) {
    if (!file || typeof file !== 'object' || !nonEmptyString(file.sourceRef) ||
        !(LOCAL_FILE_STATUSES as readonly string[]).includes(file.status) ||
        (file.resolvedPath !== null && (!nonEmptyString(file.resolvedPath) || !isAbsolute(file.resolvedPath))) ||
        !nonEmptyString(file.reason)) {
      throw new Error('Removed-SKU readiness source inventory is malformed.');
    }
  }
  for (const item of local.candidates) {
    if (!item || typeof item !== 'object' || !nonEmptyString(item.absolutePath) ||
        !isAbsolute(item.absolutePath) ||
        !(LOCAL_ROOT_KINDS as readonly string[]).includes(item.rootKind) ||
        !(LOCAL_CANDIDATE_MATCHES as readonly string[]).includes(item.match) ||
        !(LOCAL_CANDIDATE_STATUSES as readonly string[]).includes(item.status) ||
        !nonEmptyString(item.reason)) {
      throw new Error('Removed-SKU readiness local candidate inventory is malformed.');
    }
  }

  if (predelete !== null) {
    const witness = predelete.witness;
    if (!predelete || typeof predelete !== 'object' || predelete.deletionAuthorized !== false ||
        predelete.referenceCountsClear !== false || !Array.isArray(predelete.blockers) ||
        predelete.blockers.length === 0 || !predelete.blockers.every(nonEmptyString) ||
        !witness || typeof witness !== 'object' || witness.deletionAuthorized !== false ||
        witness.version !== 1 || witness.sameGroupHistoricalReferencesVerified !== false ||
        witness.journalHistoryVerified !== false || witness.referenceSearchComplete !== false ||
        witness.singleStatementSnapshot !== true || witness.groupId !== candidate.groupId ||
        witness.revisionId !== candidate.revisionId || witness.targetVariationId !== candidate.targetVariationId ||
        witness.targetSku !== candidate.targetSku || !sameSet(witness.copyIds, candidateCopyIds) ||
        !sameSet(witness.r2ObjectKeys, candidate.r2ObjectKeys) ||
        !sameSet(witness.sourceRefs, candidate.localSourceRefs) ||
        !Number.isSafeInteger(witness.confirmedRevision) || witness.confirmedRevision < 1 ||
        !Number.isSafeInteger(witness.desiredRevision) || witness.desiredRevision < 1 ||
        !Number.isSafeInteger(witness.capturedDesiredRevision) || witness.capturedDesiredRevision < 1 ||
        witness.confirmedRevision !== witness.desiredRevision ||
        witness.confirmedRevision < witness.capturedDesiredRevision ||
        !nonNegativeSafeInteger(witness.liveVariationReferenceCount) ||
        !nonNegativeSafeInteger(witness.standardReferenceCount) ||
        !nonNegativeSafeInteger(witness.otherGroupRevisionReferenceCount)) {
      throw new Error('Removed-SKU readiness database witness is malformed or inconsistent.');
    }
  }
}

/**
 * Fail-closed aggregation of independently derived read-only evidence.
 * This summary does not prove exclusive ownership or hold any lock.
 */
export function summarizeRemovedSkuPurgeReadiness(input: {
  candidate: RemovedSkuPurgeCandidateManifest;
  ownership: RemovedSkuOwnershipAudit;
  local: RemovedSkuLocalArtifactInventory;
  predelete: RemovedSkuPredeleteAssessment | null;
}): RemovedSkuPurgeReadiness {
  const {candidate, ownership, local, predelete} = input;
  validateReadinessInputs(candidate, ownership, local, predelete);
  if (candidate.deletionAuthorized !== false || ownership.deletionAuthorized !== false ||
      local.deletionAuthorized !== false ||
      ownership.groupId !== candidate.groupId || ownership.revisionId !== candidate.revisionId ||
      ownership.targetSku !== candidate.targetSku ||
      predelete && (
        predelete.witness.groupId !== candidate.groupId ||
        predelete.witness.revisionId !== candidate.revisionId ||
        predelete.witness.targetVariationId !== candidate.targetVariationId ||
        predelete.witness.targetSku !== candidate.targetSku ||
        !sameSet(predelete.witness.r2ObjectKeys, candidate.r2ObjectKeys) ||
        !sameSet(predelete.witness.sourceRefs, candidate.localSourceRefs)
      ) ||
      !sameSet(ownership.r2KeyChecks.map((row) => row.key), candidate.r2ObjectKeys) ||
      !sameSet(local.sourceFiles.map((row) => row.sourceRef), candidate.localSourceRefs)) {
    throw new Error('Removed-SKU readiness inputs disagree about frozen identity or authorization.');
  }

  const blockers: string[] = [];
  const add = (condition: boolean, message: string) => { if (condition) blockers.push(message); };
  add(ownership.referenceConflicts.length > 0,
    `Resource references are shared with ${ownership.referenceConflicts.length} other database owners.`);
  add(ownership.databaseChecks.length !== 3 ||
    ownership.databaseChecks.some((check) => check.status !== 'clear'),
  'Database ownership scan is incomplete or contains shared references.');
  add(ownership.r2KeyChecks.length === 0 ||
      ownership.r2KeyChecks.some((check) => !check.formatValid || check.status === 'unknown' || check.status === 'inaccessible'),
    'At least one R2 object has unknown ownership, malformed identity, or inaccessible metadata.');
  add(ownership.r2KeyChecks.some((check) => check.status === 'absent'),
    'At least one frozen R2 object is absent; the candidate resource set is stale.');
  add(!local.scannedConfiguredRootsCompletely || local.unresolved.length > 0,
    'Local file inventory is incomplete, ambiguous, or contains unresolved resources.');
  add(local.candidates.some((item) => item.match !== 'source-reference' ||
      item.status !== 'present'), 'Local candidate paths are not exclusive frozen source references.');
  add(local.sourceFiles.some((file) => file.status !== 'present' || file.resolvedPath === null),
    'At least one frozen local source reference is missing, shared, or unverified.');
  const sourcePaths = local.sourceFiles
    .filter((file) => file.status === 'present' && file.resolvedPath !== null)
    .map((file) => file.resolvedPath as string);
  add(sourcePaths.some((path) => local.candidates.filter((item) =>
    item.match === 'source-reference' && item.absolutePath === path).length !== 1),
  'Configured local inventory did not produce exactly one candidate for every frozen source file.');
  add(predelete === null, 'No consistent-snapshot database witness was supplied.');
  if (predelete) blockers.push(...predelete.blockers);
  blockers.push(
    'Unconfigured filesystem locations and external consumers cannot be certified absent.',
    'The read-only database witness does not lock ownership against subsequent writes.',
    'File identity must be pinned against replacement at deletion time; R2 deletion needs a supported conditional identity guarantee.',
    'Durable per-object recovery and separate operator confirmation are not implemented.',
  );

  return {
    kind: 'removed_sku_read_only_readiness',
    groupId: candidate.groupId,
    revisionId: candidate.revisionId,
    targetVariationId: candidate.targetVariationId,
    targetSku: candidate.targetSku,
    r2ObjectKeys: [...candidate.r2ObjectKeys],
    localPaths: [...new Set(local.candidates.map((item) => item.absolutePath))],
    r2Present: ownership.r2KeyChecks.filter((item) => item.status === 'present').length,
    r2Absent: ownership.r2KeyChecks.filter((item) => item.status === 'absent').length,
    r2UnknownOrInaccessible: ownership.r2KeyChecks.filter((item) =>
      item.status === 'unknown' || item.status === 'inaccessible').length,
    localPresent: local.candidates.filter((item) => item.status === 'present').length,
    localUnverifiedOrShared: local.candidates.filter((item) =>
      item.status !== 'present').length,
    databaseReferenceConflicts: ownership.referenceConflicts.length,
    databaseWitnessUsed: predelete !== null,
    blockers: [...new Set(blockers)],
    deletionAuthorized: false,
  };
}

/**
 * End-to-end read-only preparation boundary. The candidate constructor
 * revalidates the immutable v3 snapshot and the COMPLETE c2 checkpoint
 * history using the production journal inspector. The optional SQL witness
 * remains unapplied and non-authorizing; never treat this preview as a lock.
 */
export async function inspectRemovedSkuPurgeReadiness(input: {
  revision: VariationListingRevisionRow;
  checkpoints: readonly VariationListingPublishingCheckpointRow[];
  currentAggregate: VariationListingAggregateSnapshot;
  ownershipRows: RemovedSkuOwnershipRows;
  localRoots: readonly RemovedSkuLocalArtifactRoot[];
  r2MetadataInspector?: RemovedSkuR2MetadataInspector;
  predeleteWitness?: Json;
}): Promise<RemovedSkuPurgeReadiness> {
  const candidate = buildRemovedSkuPurgeCandidateManifest({
    revision: input.revision,
    checkpoints: input.checkpoints,
    currentAggregate: input.currentAggregate,
  });
  const [ownership, local] = await Promise.all([
    inspectRemovedSkuOwnership({
      candidate,
      rows: input.ownershipRows,
      trustedLocalRoots: input.localRoots.map((root) => root.absolutePath),
      r2MetadataInspector: input.r2MetadataInspector,
    }),
    inventoryRemovedSkuLocalArtifacts({
      candidate,
      roots: input.localRoots,
    }),
  ]);
  const predelete = input.predeleteWitness === undefined ? null :
    assessRemovedSkuPredeleteWitness(candidate, input.predeleteWitness);
  return summarizeRemovedSkuPurgeReadiness({candidate, ownership, local, predelete});
}
