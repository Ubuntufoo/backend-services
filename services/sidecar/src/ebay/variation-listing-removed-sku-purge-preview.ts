import type {
  Json,
  VariationListingAggregateSnapshot,
  VariationListingPublishingCheckpointRow,
  VariationListingRevisionPlanOperation,
  VariationListingRevisionRow,
} from '@ebay-inventory/data';

import { inspectVariationListingJournal } from '@ebay-inventory/data';

import { hydrateVariationListingPermanentRemovalPlan } from '@/ebay/variation-listing-permanent-removal.js';

type FrozenRecord = Record<string, Json>;

export interface RemovedSkuPurgeCopyCandidate {
  copyId: string;
  frontR2Key: string;
  backR2Key: string;
  /** Source references are NOT verified local filesystem paths. */
  localSourceRefs: string[];
}

export type RemovedSkuPurgeOwnershipCheckStatus = 'unverified';

export interface RemovedSkuPurgeOwnershipCheck {
  scope:
    | 'variation-groups'
    | 'standard-single-lot'
    | 'prior-revisions'
    | 'local-files'
    | 'r2-objects';
  status: RemovedSkuPurgeOwnershipCheckStatus;
}

export interface RemovedSkuPurgeCandidateManifest {
  groupId: string;
  revisionId: string;
  targetVariationId: string;
  targetSku: string;
  /** Frozen image-object identities, not deletion authorization. */
  r2ObjectKeys: string[];
  copies: RemovedSkuPurgeCopyCandidate[];
  /** Raw capture references, NOT local-path ownership evidence. */
  localSourceRefs: string[];
  /** Every ownership domain remains unverified; this manifest cannot authorize deletion. */
  ownershipChecks: readonly RemovedSkuPurgeOwnershipCheck[];
  /** Always false until separately verified across all local, shared, and R2 owners. */
  deletionAuthorized: false;
  requiredChecks: readonly string[];
}

function record(value: unknown, label: string): FrozenRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Removed-SKU purge preview: ${label} must be an object.`);
  }
  return value as FrozenRecord;
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Removed-SKU purge preview: ${label} must be a nonempty string.`);
  }
  return value;
}

/**
 * A read-only inventory of candidates after confirmed zero-only group removal.
 *
 * This function cannot prove ownership across other buckets, Standard
 * Single/Lot listings, old revisions, local directories or R2. Its output is
 * deliberately non-executable; no delete endpoint should accept it as proof.
 */
export function buildRemovedSkuPurgeCandidateManifest(input: {
  revision: VariationListingRevisionRow;
  checkpoints: readonly VariationListingPublishingCheckpointRow[];
  currentAggregate: VariationListingAggregateSnapshot;
}): RemovedSkuPurgeCandidateManifest {
  const { revision, checkpoints, currentAggregate } = input;
  // Includes SHA256 frozen-snapshot and single-operation intent verification.
  const plan = hydrateVariationListingPermanentRemovalPlan(revision);
  if (revision.group_id !== currentAggregate.group.group_id ||
      plan.captureInput.groupId !== currentAggregate.group.group_id ||
      currentAggregate.group.group_key !== plan.groupKey ||
      currentAggregate.group.lifecycle_state !== 'active' ||
      currentAggregate.group.last_confirmed_revision === null ||
      currentAggregate.group.last_confirmed_revision < revision.captured_desired_revision) {
    throw new Error('Removed-SKU purge preview: confirmed active group watermark does not cover this removal.');
  }
  const operation = plan.captureInput.operationPlan[0];
  if (!operation) {
    throw new Error('Removed-SKU purge preview: frozen removal operation is missing.');
  }
  if (checkpoints.some((checkpoint) =>
    checkpoint.revision_id !== revision.revision_id || checkpoint.operation_key !== operation.operationKey
  )) {
    throw new Error('Removed-SKU purge preview: journal contains a checkpoint for another revision or operation.');
  }
  const journalOperation: VariationListingRevisionPlanOperation = {
    sequence_no: operation.sequenceNo,
    operation_key: operation.operationKey,
    operation_kind: operation.operationKind,
    target_ref: operation.targetRef,
    intent_version: operation.intentVersion,
    intent_digest: operation.intentDigest,
    intent: operation.intent,
  };
  const inspection = inspectVariationListingJournal(journalOperation, checkpoints);
  const latest = inspection.latestCheckpoint;
  if (!latest || latest.state !== 'confirmed_complete' || latest.observed_remote_state !== 'present') {
    throw new Error('Removed-SKU purge preview: terminal membership removal proof is missing.');
  }
  const evidence = record(latest.evidence, 'terminal checkpoint evidence');
  const expectedKeys = ['listingId', 'state', 'survivorSkus', 'targetSku'];
  if (Object.keys(evidence).sort().join(',') !== expectedKeys.join(',') ||
      evidence.listingId !== plan.listingId ||
      evidence.targetSku !== plan.targetSku ||
      evidence.state !== 'removed' ||
      !Array.isArray(evidence.survivorSkus) ||
      evidence.survivorSkus.length !== plan.survivorSkus.length ||
      evidence.survivorSkus.some((sku, i) => sku !== plan.survivorSkus[i])) {
    throw new Error('Removed-SKU purge preview: terminal evidence does not exactly match frozen removal identity.');
  }
  if (currentAggregate.variations.some((variation) =>
    variation.variation_id === plan.targetVariationId || variation.sku === plan.targetSku) ||
    currentAggregate.copies.some((copy) => copy.variation_id === plan.targetVariationId)) {
    throw new Error('Removed-SKU purge preview: target still exists in live variation/copy rows.');
  }
  const root = record(revision.snapshot, 'frozen snapshot');
  const confirmed = record(root.confirmed, 'frozen confirmed snapshot');
  const frozenAggregate = record(confirmed.aggregate, 'frozen confirmed aggregate');
  const frozenGroup = record(frozenAggregate.group, 'frozen confirmed group');
  if (frozenGroup.group_id !== currentAggregate.group.group_id ||
      frozenGroup.group_key !== plan.groupKey ||
      frozenGroup.marketplace_id !== plan.marketplaceId) {
    throw new Error('Removed-SKU purge preview: frozen confirmed group identity does not match the removal.');
  }
  if (!Array.isArray(frozenAggregate.variations)) {
    throw new Error('Removed-SKU purge preview: frozen variation inventory is unavailable.');
  }
  const frozenTargetVariations = frozenAggregate.variations.filter((candidate) => {
    const variation = record(candidate, 'frozen variation');
    return variation.variation_id === plan.targetVariationId || variation.sku === plan.targetSku;
  });
  if (frozenTargetVariations.length !== 1) {
    throw new Error('Removed-SKU purge preview: frozen target variation identity is missing or duplicated.');
  }
  const frozenTargetVariation = record(frozenTargetVariations[0], 'frozen target variation');
  if (frozenTargetVariation.variation_id !== plan.targetVariationId || frozenTargetVariation.sku !== plan.targetSku) {
    throw new Error('Removed-SKU purge preview: frozen target variation identity does not match the removal.');
  }
  if (!Array.isArray(frozenAggregate.copies)) {
    throw new Error('Removed-SKU purge preview: frozen copy inventory is unavailable.');
  }
  const targetCopies: RemovedSkuPurgeCopyCandidate[] = [];
  const targetKeys = new Set<string>();
  const targetIds = new Set<string>();
  const targetSourceRefs = new Set<string>();
  const nonTargetKeys = new Set<string>();
  const nonTargetSourceRefs = new Set<string>();
  for (const candidate of frozenAggregate.copies) {
    const copy = record(candidate, 'frozen copy');
    const variationId = string(copy.variation_id, 'frozen copy variation');
    const frontR2Key = string(copy.front_r2_key, 'frozen front key');
    const backR2Key = string(copy.back_r2_key, 'frozen back key');
    const sourceRefs = [
      string(copy.capture_front_source_ref, 'front source reference'),
      string(copy.capture_back_source_ref, 'back source reference'),
    ];
    if (variationId !== plan.targetVariationId) {
      nonTargetKeys.add(frontR2Key);
      nonTargetKeys.add(backR2Key);
      sourceRefs.forEach((ref) => nonTargetSourceRefs.add(ref));
      continue;
    }
    const copyId = string(copy.copy_id, 'frozen target copy ID');
    if (targetIds.has(copyId) || frontR2Key === backR2Key ||
        sourceRefs[0] === sourceRefs[1] ||
        targetSourceRefs.has(sourceRefs[0]) || targetSourceRefs.has(sourceRefs[1]) ||
        targetKeys.has(frontR2Key) || targetKeys.has(backR2Key)) {
      throw new Error('Removed-SKU purge preview: target copy, source refs, or R2 keys are duplicated.');
    }
    targetIds.add(copyId);
    targetSourceRefs.add(sourceRefs[0]);
    targetSourceRefs.add(sourceRefs[1]);
    targetKeys.add(frontR2Key);
    targetKeys.add(backR2Key);
    targetCopies.push({ copyId, frontR2Key, backR2Key, localSourceRefs: sourceRefs });
  }
  if (targetCopies.length === 0) {
    throw new Error('Removed-SKU purge preview: frozen target copy inventory is missing.');
  }
  const liveKeys = new Set(currentAggregate.copies.flatMap((copy) =>
    [copy.front_r2_key, copy.back_r2_key]));
  const liveSourceRefs = new Set(currentAggregate.copies.flatMap((copy) =>
    [copy.capture_front_source_ref, copy.capture_back_source_ref]));
  const refs = targetCopies.flatMap((copy) => copy.localSourceRefs);
  if ([...targetKeys].some((key) => nonTargetKeys.has(key) || liveKeys.has(key)) ||
      refs.some((ref) => nonTargetSourceRefs.has(ref) || liveSourceRefs.has(ref))) {
    throw new Error('Removed-SKU purge preview: image identity is shared with another frozen or live copy.');
  }
  // The v3 revision is the single durable source of removed-copy keys. Local
  // source refs are not necessarily files and MUST be resolved under a trusted
  // configured root before any future delete operation.
  return {
    groupId: currentAggregate.group.group_id,
    revisionId: revision.revision_id,
    targetVariationId: plan.targetVariationId,
    targetSku: plan.targetSku,
    r2ObjectKeys: [...targetKeys],
    copies: targetCopies,
    localSourceRefs: [...new Set(refs)],
    ownershipChecks: [
      { scope: 'variation-groups', status: 'unverified' },
      { scope: 'standard-single-lot', status: 'unverified' },
      { scope: 'prior-revisions', status: 'unverified' },
      { scope: 'local-files', status: 'unverified' },
      { scope: 'r2-objects', status: 'unverified' },
    ],
    deletionAuthorized: false,
    requiredChecks: [
      'Check exclusive ownership and references across every Variation bucket, Standard Single/Lot listing, earlier revision, and remaining media record.',
      'Resolve local source references under an approved local storage root and prove there are no shared files or symlink escapes.',
      'Recheck ownership immediately before each delete and durably journal partial R2/local failure without duplicating the frozen revision.',
      'Require a separate explicit destructive confirmation; this preview never deletes or authorizes deletion.',
    ],
  };
}
