import { createHash, randomUUID } from 'node:crypto';

import type {
  CaptureVariationListingRevisionInput,
  Json,
  VariationListingAggregateSnapshot,
  VariationListingGroupRow,
  VariationListingPublishingCheckpointRow,
  VariationListingRevisionPlanOperationInput,
  VariationListingRevisionPlanOperation,
  VariationListingTransactionGateway,
} from '@ebay-inventory/data';

import {
  buildVariationListingInventoryPayloadBundle,
  variationListingEpsImageUrlSchema,
  type VariationListingInventoryPayloadBundle,
  type VariationListingRepresentativeImage,
} from '@/ebay/variation-listing-payloads.js';

const SNAPSHOT_VERSION = 1;
const INTENT_VERSION = 1;

export type VariationListingRemoteRead<T> =
  | { state: 'present'; value: T }
  | { state: 'proven_absent' }
  | { state: 'unknown'; reason: string };

export interface VariationListingRemoteInventoryItem {
  groupKeys: string[] | null;
  payload: Json;
  sku: string;
}

export interface VariationListingRemoteOffer {
  lifecycleClass: 'active' | 'ended' | 'not-listed' | 'ambiguous' | null;
  listingId: string | null;
  marketplaceId: string;
  offerId: string;
  payload: Json;
  sku: string;
  status: 'PUBLISHED' | 'UNPUBLISHED';
}

export interface VariationListingRemoteGroup {
  payload: Json;
  variantSKUs: string[];
}

export interface VariationListingRemoteMedia {
  expirationDate: string;
  imageId: string;
  imageUrl: string;
  location: string;
}

export interface VariationListingPublicationReadGateway {
  getInventoryItem(sku: string): Promise<VariationListingRemoteRead<VariationListingRemoteInventoryItem>>;
  getInventoryItemGroup(groupKey: string): Promise<VariationListingRemoteRead<VariationListingRemoteGroup>>;
  getOffers(sku: string, marketplaceId: string): Promise<VariationListingRemoteRead<VariationListingRemoteOffer[]>>;
}

export interface VariationListingFrozenPublicationSnapshot {
  aggregate: VariationListingAggregateSnapshot;
  mediaResources: VariationListingMediaResource[];
  representativeImages: VariationListingRepresentativeImage[] | null;
}

/** Role-addressed immutable Media source intent. The seller EPS URL is remote
 * output and is therefore journaled only after eBay returns and exact read-back
 * confirms it; it is never fabricated or frozen before Media creation. */
export interface VariationListingMediaResource {
  copyId: string;
  role: 'front' | 'back';
  sourceUrl: string;
}

export interface VariationListingFrozenPublicationRevision {
  captureInput: CaptureVariationListingRevisionInput;
  snapshot: VariationListingFrozenPublicationSnapshot;
}

export interface VariationListingUnpublishedReconciliation {
  group: VariationListingRemoteGroup;
  items: VariationListingRemoteInventoryItem[];
  offers: VariationListingRemoteOffer[];
  state: 'exact_unpublished';
}

export interface VariationListingPublishedReconciliation {
  group: VariationListingRemoteGroup;
  items: VariationListingRemoteInventoryItem[];
  listingId: string;
  offers: VariationListingRemoteOffer[];
  state: 'exact_published';
}

function canonicalJson(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child as Json)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function digestJson(value: Json): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function asJson<T>(value: T): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

function operation(input: {
  kind: string;
  key: string;
  sequenceNo: number;
  targetRef: string;
  intent: Json;
}): VariationListingRevisionPlanOperationInput {
  return {
    intent: input.intent,
    intentDigest: digestJson(input.intent),
    intentVersion: INTENT_VERSION,
    operationKey: input.key,
    operationKind: input.kind,
    sequenceNo: input.sequenceNo,
    targetRef: input.targetRef,
  };
}

export function buildVariationListingFrozenPublicationRevision(input: {
  aggregate: VariationListingAggregateSnapshot;
  mediaResources?: readonly VariationListingMediaResource[];
  representativeImages?: readonly VariationListingRepresentativeImage[];
  revisionId: string;
}): VariationListingFrozenPublicationRevision {
  const aggregate = structuredClone(input.aggregate);
  if (aggregate.group.lifecycle_state !== 'publish-ready') {
    throw new Error('Variation listing initial publication requires lifecycle_state publish-ready.');
  }
  const orderedVariations = [...aggregate.variations].sort((left, right) => left.position - right.position);
  if (orderedVariations.length < 2) {
    throw new Error('Variation listing initial publication requires at least two variations.');
  }
  const availableByVariation = new Map(orderedVariations.map((variation) => [variation.variation_id, 0]));
  for (const copy of aggregate.copies) {
    if (copy.availability_state === 'available') {
      availableByVariation.set(copy.variation_id, (availableByVariation.get(copy.variation_id) ?? 0) + 1);
    }
  }
  if (orderedVariations.some((variation) => (availableByVariation.get(variation.variation_id) ?? 0) <= 0)) {
    throw new Error('Variation listing initial publication requires positive derived quantity for every variation.');
  }

  const mediaResources = structuredClone([...(input.mediaResources ?? [])]);
  const representativeImages = input.representativeImages
    ? structuredClone([...input.representativeImages])
    : null;
  if ((mediaResources.length === 0) === (representativeImages === null)) {
    throw new Error('Variation listing publication requires exactly one image source mode: existing EPS images or Media source intents.');
  }

  const representativeCopyIds = orderedVariations.map((variation) => {
    if (!variation.representative_copy_id) {
      throw new Error(`Variation ${variation.variation_id} is missing representative_copy_id.`);
    }
    return variation.representative_copy_id;
  });
  const mediaKeys = new Set<string>();
  if (mediaResources.length > 0) {
    for (const media of mediaResources) {
      const key = `${media.copyId}:${media.role}`;
      if (!media.copyId || !media.sourceUrl || mediaKeys.has(key)) {
        throw new Error('Variation listing Media resources must have unique, complete role identities.');
      }
      if (!representativeCopyIds.includes(media.copyId)) {
        throw new Error('Variation listing Media resource must belong to a representative copy.');
      }
      mediaKeys.add(key);
    }
    for (const copyId of representativeCopyIds) {
      if (!mediaKeys.has(`${copyId}:front`) || !mediaKeys.has(`${copyId}:back`)) {
        throw new Error('Variation listing Media source intents must contain front and back for every representative copy.');
      }
    }
    if (mediaResources.length !== representativeCopyIds.length * 2) {
      throw new Error('Variation listing Media source intents must exactly match representative copy roles.');
    }
  } else {
    buildVariationListingInventoryPayloadBundle({ aggregate, representativeImages: representativeImages! });
  }

  const snapshot: VariationListingFrozenPublicationSnapshot = {
    aggregate,
    mediaResources,
    representativeImages,
  };
  const operations: VariationListingRevisionPlanOperationInput[] = [];
  let sequenceNo = 1;
  for (const media of mediaResources) {
    const key = `${media.copyId}:${media.role}`;
    operations.push(operation({
      sequenceNo: sequenceNo++,
      key: `media:${key}`,
      kind: 'media_ingest',
      targetRef: key,
      intent: asJson(media),
    }));
  }
  for (const variation of orderedVariations) {
    operations.push(
      operation({
        sequenceNo: sequenceNo++,
        key: `child-item:${variation.variation_id}`,
        kind: 'child_inventory_item_write',
        targetRef: variation.sku,
        intent: asJson({ variationId: variation.variation_id, sku: variation.sku }),
      }),
      operation({
        sequenceNo: sequenceNo++,
        key: `child-offer:${variation.variation_id}`,
        kind: 'child_offer_write',
        targetRef: variation.sku,
        intent: asJson({ variationId: variation.variation_id, sku: variation.sku }),
      })
    );
  }
  operations.push(
    operation({
      sequenceNo: sequenceNo++,
      key: 'complete-group',
      kind: 'complete_group_replace',
      targetRef: aggregate.group.group_key,
      intent: asJson({ groupId: aggregate.group.group_id, groupKey: aggregate.group.group_key }),
    }),
    operation({
      sequenceNo: sequenceNo++,
      key: 'group-publish',
      kind: 'group_publish',
      targetRef: aggregate.group.group_key,
      intent: asJson({ groupId: aggregate.group.group_id, groupKey: aggregate.group.group_key }),
    }),
    operation({
      sequenceNo,
      key: 'revision-reconcile',
      kind: 'revision_reconcile',
      targetRef: aggregate.group.group_key,
      intent: asJson({
        groupId: aggregate.group.group_id,
        groupKey: aggregate.group.group_key,
        orderedSkus: orderedVariations.map((variation) => variation.sku),
      }),
    })
  );

  const snapshotJson = asJson(snapshot);
  return {
    snapshot,
    captureInput: {
      capturedDesiredRevision: aggregate.group.desired_revision,
      groupId: aggregate.group.group_id,
      operationPlan: operations,
      revisionId: input.revisionId,
      snapshot: snapshotJson,
      snapshotDigest: digestJson(snapshotJson),
      snapshotVersion: SNAPSHOT_VERSION,
    },
  };
}

function buildBundleFromImages(
  frozen: VariationListingFrozenPublicationRevision,
  representativeImages: readonly VariationListingRepresentativeImage[]
): VariationListingInventoryPayloadBundle {
  return buildVariationListingInventoryPayloadBundle({
    aggregate: frozen.snapshot.aggregate,
    representativeImages,
  });
}

function groupPayloadWithoutMembership(payload: Json): Json {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const { variantSKUs: _variantSKUs, ...rest } = payload as Record<string, Json>;
  return rest;
}

function exactPresent<T>(read: VariationListingRemoteRead<T>, label: string): T {
  if (read.state === 'unknown') throw new Error(`${label} remote state is unknown: ${read.reason}`);
  if (read.state === 'proven_absent') throw new Error(`${label} is proven absent.`);
  return read.value;
}

function requireJsonEqual(actual: Json, expected: Json, label: string): void {
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error(`${label} does not exactly match the frozen revision intent.`);
  }
}

function requireExactGroupMembership(actual: readonly string[], expected: readonly string[]): void {
  if (new Set(actual).size !== actual.length || new Set(expected).size !== expected.length) {
    throw new Error('Variation listing group membership contains duplicate SKUs.');
  }
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  if (
    actualSet.size !== expectedSet.size ||
    [...expectedSet].some((sku) => !actualSet.has(sku)) ||
    [...actualSet].some((sku) => !expectedSet.has(sku))
  ) {
    throw new Error('Variation listing group membership does not exactly match the frozen revision.');
  }
}

async function reconcileBase(
  gateway: VariationListingPublicationReadGateway,
  frozen: VariationListingFrozenPublicationRevision,
  expected: VariationListingInventoryPayloadBundle
): Promise<{
  group: VariationListingRemoteGroup;
  items: VariationListingRemoteInventoryItem[];
  offers: VariationListingRemoteOffer[];
}> {
  const group = exactPresent(
    await gateway.getInventoryItemGroup(expected.groupKey),
    `Variation listing group ${expected.groupKey}`
  );
  requireExactGroupMembership(group.variantSKUs, expected.children.map((child) => child.sku));
  requireJsonEqual(
    groupPayloadWithoutMembership(group.payload),
    groupPayloadWithoutMembership(asJson(expected.group)),
    `Variation listing group ${expected.groupKey}`
  );

  const items: VariationListingRemoteInventoryItem[] = [];
  const offers: VariationListingRemoteOffer[] = [];
  const seenOfferIds = new Set<string>();

  for (const child of expected.children) {
    const item = exactPresent(
      await gateway.getInventoryItem(child.sku),
      `Variation listing child item ${child.sku}`
    );
    if (item.sku !== child.sku) throw new Error(`Variation listing child item ${child.sku} identity mismatch.`);
    if (!item.groupKeys || item.groupKeys.length !== 1 || item.groupKeys[0] !== expected.groupKey) {
      throw new Error(`Variation listing child item ${child.sku} group association mismatch.`);
    }
    requireJsonEqual(item.payload, asJson(child.inventoryItem), `Variation listing child item ${child.sku}`);
    items.push(item);

    const childOffers = exactPresent(
      await gateway.getOffers(child.sku, child.offer.marketplaceId),
      `Variation listing child offers ${child.sku}`
    );
    if (childOffers.length !== 1) {
      throw new Error(`Variation listing child ${child.sku} must reconcile to exactly one offer.`);
    }
    const offer = childOffers[0]!;
    if (offer.sku !== child.sku || offer.marketplaceId !== child.offer.marketplaceId) {
      throw new Error(`Variation listing child offer ${child.sku} ownership mismatch.`);
    }
    if (seenOfferIds.has(offer.offerId)) throw new Error('Variation listing remote offer IDs must be unique.');
    seenOfferIds.add(offer.offerId);
    requireJsonEqual(offer.payload, asJson(child.offer), `Variation listing child offer ${child.sku}`);
    offers.push(offer);
  }

  return { group, items, offers };
}

export async function reconcileVariationListingExactUnpublished(
  gateway: VariationListingPublicationReadGateway,
  frozen: VariationListingFrozenPublicationRevision,
  bundle?: VariationListingInventoryPayloadBundle
): Promise<VariationListingUnpublishedReconciliation> {
  const expected = bundle ?? (frozen.snapshot.representativeImages
    ? buildBundleFromImages(frozen, frozen.snapshot.representativeImages)
    : (() => { throw new Error('Resolved Media EPS images are required for publication reconciliation.'); })());
  const reconciled = await reconcileBase(gateway, frozen, expected);
  if (
    reconciled.offers.some(
      (offer) => offer.status !== 'UNPUBLISHED' || offer.listingId !== null
    )
  ) {
    throw new Error('Variation listing frozen revision is not one exact unpublished aggregate.');
  }
  return { ...reconciled, state: 'exact_unpublished' };
}

export async function reconcileVariationListingExactPublished(
  gateway: VariationListingPublicationReadGateway,
  frozen: VariationListingFrozenPublicationRevision,
  bundle?: VariationListingInventoryPayloadBundle
): Promise<VariationListingPublishedReconciliation> {
  const expected = bundle ?? (frozen.snapshot.representativeImages
    ? buildBundleFromImages(frozen, frozen.snapshot.representativeImages)
    : (() => { throw new Error('Resolved Media EPS images are required for publication reconciliation.'); })());
  const reconciled = await reconcileBase(gateway, frozen, expected);
  if (
    reconciled.offers.some(
      (offer) =>
        offer.status !== 'PUBLISHED' ||
        offer.listingId === null ||
        offer.lifecycleClass !== 'active'
    )
  ) {
    throw new Error('Variation listing frozen revision is not one exact active published aggregate.');
  }
  const listingIds = new Set(reconciled.offers.map((offer) => offer.listingId));
  if (listingIds.size !== 1) {
    throw new Error('Variation listing published offers do not resolve to one listing ID.');
  }
  return {
    ...reconciled,
    listingId: reconciled.offers[0]!.listingId!,
    state: 'exact_published',
  };
}

/** Read-only eBay boundary.  Production/Sandbox clients are intentionally not
 * constructed here; the caller must inject one. */
export interface VariationListingPublicationRemoteGateway
  extends VariationListingPublicationReadGateway {
  getMedia(location: string): Promise<VariationListingRemoteRead<VariationListingRemoteMedia>>;
}

export interface VariationListingPublicationMutationGateway {
  createMedia(sourceUrl: string): Promise<VariationListingRemoteMedia>;
  createOrReplaceInventoryItem(sku: string, payload: Json): Promise<void>;
  createOffer(payload: Json): Promise<{ offerId: string }>;
  createOrReplaceInventoryItemGroup(groupKey: string, payload: Json): Promise<void>;
  publishInventoryItemGroup(payload: Json): Promise<{ listingId: string }>;
}

/** The existing revision transaction gateway deliberately owns writes.  This
 * separate injected reader keeps the execution seam usable with the existing
 * simplified journal without adding a generic persistence abstraction. */
export interface VariationListingPublicationJournalReader {
  listCheckpoints(revisionId: string): Promise<VariationListingPublishingCheckpointRow[]>;
}

export interface VariationListingPublicationRevisionReader {
  loadRevision(revisionId: string): Promise<import('@ebay-inventory/data').VariationListingRevisionRow | null>;
}

export interface VariationListingPublicationExecutionInput {
  frozen: VariationListingFrozenPublicationRevision;
  journal: VariationListingPublicationJournalReader & VariationListingPublicationRevisionReader;
  mutations: VariationListingPublicationMutationGateway;
  remote: VariationListingPublicationRemoteGateway;
  transaction: Pick<
    VariationListingTransactionGateway,
    'appendJournalCheckpoint' | 'captureRevision' | 'confirmRevision' | 'loadAggregate'
  >;
  checkpointId?: () => string;
}

export interface VariationListingPublicationExecutionResult {
  confirmedRevision: number;
  listingId: string;
  revisionId: string;
}

type OperationHistory = Map<string, VariationListingPublishingCheckpointRow[]>;

function errorEvidence(error: unknown): Json {
  return { error: error instanceof Error ? error.message : String(error) };
}

function mediaEvidence(media: VariationListingRemoteMedia): Json {
  return {
    expirationDate: media.expirationDate,
    imageId: media.imageId,
    imageUrl: media.imageUrl,
    location: media.location,
  };
}

function requiredEvidenceString(value: Json, key: string, label: string): string {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || typeof value[key] !== 'string') {
    throw new Error(`Variation listing ${label} evidence is missing ${key}.`);
  }
  return value[key] as string;
}

function checkpointEvidence(value: Json): Json {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Variation listing journal evidence must be a JSON object.');
  }
  return value;
}

function planOperation(
  frozen: VariationListingFrozenPublicationRevision,
  operationKey: string
): VariationListingRevisionPlanOperation {
  const operation = frozen.captureInput.operationPlan.find(
    (candidate) => candidate.operationKey === operationKey
  );
  if (!operation) throw new Error(`Frozen variation listing operation ${operationKey} is missing.`);
  return {
    intent: operation.intent,
    intent_digest: operation.intentDigest,
    intent_version: operation.intentVersion,
    operation_key: operation.operationKey,
    operation_kind: operation.operationKind,
    sequence_no: operation.sequenceNo,
    target_ref: operation.targetRef,
  };
}

/** Mirrors the simplified journal's append-only state grammar at the execution
 * boundary, before making any replay decision. */
function assertJournalHistory(
  operation: VariationListingRevisionPlanOperation,
  checkpoints: readonly VariationListingPublishingCheckpointRow[]
): void {
  const ordered = [...checkpoints].sort(
    (left, right) => left.attempt_number - right.attempt_number || left.checkpoint_number - right.checkpoint_number
  );
  for (let index = 0; index < ordered.length; index += 1) {
    const current = ordered[index]!;
    if (current.operation_key !== operation.operation_key || current.attempt_number < 1 || current.checkpoint_number < 1) {
      throw new Error(`Variation listing operation ${operation.operation_key} history is invalid.`);
    }
    if (index === 0) {
      if (current.attempt_number !== 1 || current.checkpoint_number !== 1) throw new Error(`Variation listing operation ${operation.operation_key} history must begin at 1/1.`);
      if (operation.operation_kind !== 'revision_reconcile' && current.state !== 'started') throw new Error(`Variation listing mutation operation ${operation.operation_key} must begin started.`);
      continue;
    }
    const previous = ordered[index - 1]!;
    const contiguous =
      (current.attempt_number === previous.attempt_number && current.checkpoint_number === previous.checkpoint_number + 1) ||
      (current.attempt_number === previous.attempt_number + 1 && current.checkpoint_number === 1);
    if (!contiguous) throw new Error(`Variation listing operation ${operation.operation_key} journal numbering is not contiguous.`);
    if (previous.state === 'started' && (current.attempt_number !== previous.attempt_number || !['unknown', 'confirmed_complete', 'confirmed_no_op'].includes(current.state))) {
      throw new Error(`Variation listing operation ${operation.operation_key} started checkpoint must resolve before retry.`);
    }
    if (previous.state === 'unknown' && (current.attempt_number !== previous.attempt_number + 1 || current.checkpoint_number !== 1 || !['confirmed_complete', 'confirmed_no_op'].includes(current.state))) {
      throw new Error(`Variation listing operation ${operation.operation_key} unknown outcome requires exact reconciliation.`);
    }
    if (isTerminal(previous)) throw new Error(`Variation listing operation ${operation.operation_key} is terminal and cannot reopen.`);
  }
}

function makeHistory(
  frozen: VariationListingFrozenPublicationRevision,
  checkpoints: readonly VariationListingPublishingCheckpointRow[]
): OperationHistory {
  const allowed = new Set(frozen.captureInput.operationPlan.map((operation) => operation.operationKey));
  const history: OperationHistory = new Map(
    frozen.captureInput.operationPlan.map((operation) => [operation.operationKey, []])
  );
  for (const checkpoint of checkpoints) {
    if (checkpoint.revision_id !== frozen.captureInput.revisionId || !allowed.has(checkpoint.operation_key)) {
      throw new Error('Variation listing journal history does not belong to the frozen revision plan.');
    }
    history.get(checkpoint.operation_key)!.push(checkpoint);
  }
  for (const operation of frozen.captureInput.operationPlan) {
    assertJournalHistory(
      planOperation(frozen, operation.operationKey),
      history.get(operation.operationKey)!
    );
  }
  return history;
}

function latest(history: readonly VariationListingPublishingCheckpointRow[]) {
  return [...history].sort(
    (left, right) =>
      left.attempt_number - right.attempt_number || left.checkpoint_number - right.checkpoint_number
  ).at(-1) ?? null;
}

function isTerminal(checkpoint: VariationListingPublishingCheckpointRow | null): boolean {
  return checkpoint?.state === 'confirmed_complete' || checkpoint?.state === 'confirmed_no_op';
}

async function appendCheckpoint(
  input: VariationListingPublicationExecutionInput,
  history: OperationHistory,
  operationKey: string,
  checkpoint: {
    attemptNumber: number;
    checkpointNumber: number;
    evidence: Json;
    observedRemoteState?: 'present' | 'proven_absent' | 'unknown';
    state: 'started' | 'unknown' | 'confirmed_complete' | 'confirmed_no_op';
  }
): Promise<void> {
  const result = await input.transaction.appendJournalCheckpoint({
    attemptNumber: checkpoint.attemptNumber,
    checkpointId: (input.checkpointId ?? randomUUID)(),
    checkpointNumber: checkpoint.checkpointNumber,
    evidence: checkpointEvidence(checkpoint.evidence),
    observedRemoteState: checkpoint.observedRemoteState,
    operationKey,
    revisionId: input.frozen.captureInput.revisionId,
    state: checkpoint.state,
  });
  history.get(operationKey)!.push(result.checkpoint);
}

async function finishExistingUnknown(
  input: VariationListingPublicationExecutionInput,
  history: OperationHistory,
  operationKey: string,
  after: () => Promise<Json | null>,
  pre: () => Promise<Json | null>
): Promise<void> {
  const current = latest(history.get(operationKey)!);
  if (!current) return;
  if (isTerminal(current)) {
    const evidence = await after();
    if (evidence === null) throw new Error(`Variation listing operation ${operationKey} terminal state no longer reconciles exactly.`);
    return;
  }
  const afterEvidence = await after();
  if (afterEvidence !== null) {
    await appendCheckpoint(input, history, operationKey, {
      attemptNumber: current.state === 'started' ? current.attempt_number : current.attempt_number + 1,
      checkpointNumber: current.state === 'started' ? current.checkpoint_number + 1 : 1,
      evidence: afterEvidence,
      observedRemoteState: 'present',
      state: 'confirmed_complete',
    });
    return;
  }
  const preEvidence = await pre();
  if (preEvidence === null) {
    if (current.state === 'started') {
      await appendCheckpoint(input, history, operationKey, {
        attemptNumber: current.attempt_number,
        checkpointNumber: current.checkpoint_number + 1,
        evidence: { reason: 'Neither exact after-state nor exact pre-state is proven.' },
        observedRemoteState: 'unknown',
        state: 'unknown',
      });
    }
    throw new Error(`Variation listing operation ${operationKey} has an unknown mutation outcome; replay is forbidden.`);
  }
  if (current.state === 'started') {
    await appendCheckpoint(input, history, operationKey, {
      attemptNumber: current.attempt_number,
      checkpointNumber: current.checkpoint_number + 1,
      evidence: preEvidence,
      observedRemoteState: 'proven_absent',
      state: 'confirmed_no_op',
    });
  } else {
    await appendCheckpoint(input, history, operationKey, {
      attemptNumber: current.attempt_number + 1,
      checkpointNumber: 1,
      evidence: preEvidence,
      observedRemoteState: 'proven_absent',
      state: 'confirmed_no_op',
    });
  }
  throw new Error(`Variation listing operation ${operationKey} is proven unchanged after an unknown mutation outcome; a new revision is required before retry.`);
}

async function executeMutationOperation(
  input: VariationListingPublicationExecutionInput,
  history: OperationHistory,
  operationKey: string,
  after: () => Promise<Json | null>,
  pre: () => Promise<Json | null>,
  mutate: () => Promise<void>
): Promise<void> {
  const operation = planOperation(input.frozen, operationKey);
  const checkpoints = history.get(operationKey)!;
  const current = latest(checkpoints);
  if (current) {
    await finishExistingUnknown(input, history, operationKey, after, pre);
    return;
  }
  const before = await after();
  if (before !== null) {
    await appendCheckpoint(input, history, operationKey, {
      attemptNumber: 1,
      checkpointNumber: 1,
      evidence: {},
      state: 'started',
    });
    await appendCheckpoint(input, history, operationKey, {
      attemptNumber: 1,
      checkpointNumber: 2,
      evidence: before,
      observedRemoteState: 'present',
      state: 'confirmed_no_op',
    });
    return;
  }
  const preEvidence = await pre();
  if (preEvidence === null) {
    throw new Error(`Variation listing operation ${operation.operation_key} pre-state is neither exact intent nor proven absent.`);
  }
  await appendCheckpoint(input, history, operationKey, {
    attemptNumber: 1,
    checkpointNumber: 1,
    evidence: {},
    state: 'started',
  });
  try {
    await mutate();
  } catch (error) {
    await appendCheckpoint(input, history, operationKey, {
      attemptNumber: 1,
      checkpointNumber: 2,
      evidence: errorEvidence(error),
      observedRemoteState: 'unknown',
      state: 'unknown',
    });
    throw error;
  }
  const afterEvidence = await after();
  if (afterEvidence === null) {
    await appendCheckpoint(input, history, operationKey, {
      attemptNumber: 1,
      checkpointNumber: 2,
      evidence: { reason: 'Mutation returned but exact after-state was not observed.' },
      observedRemoteState: 'unknown',
      state: 'unknown',
    });
    throw new Error(`Variation listing operation ${operationKey} returned without an exact after-state.`);
  }
  await appendCheckpoint(input, history, operationKey, {
    attemptNumber: 1,
    checkpointNumber: 2,
    evidence: afterEvidence,
    observedRemoteState: 'present',
    state: 'confirmed_complete',
  });
}

function exactItemEvidence(
  read: VariationListingRemoteRead<VariationListingRemoteInventoryItem>,
  child: VariationListingInventoryPayloadBundle['children'][number],
  groupKey: string
): Json | null {
  if (read.state === 'unknown') throw new Error(`Variation listing child item ${child.sku} read is unknown: ${read.reason}`);
  if (read.state === 'proven_absent') return null;
  const item = read.value;
  if (item.sku !== child.sku) throw new Error(`Variation listing child item ${child.sku} identity mismatch.`);
  if (
    item.groupKeys !== null &&
    (item.groupKeys.length !== 1 || item.groupKeys[0] !== groupKey)
  ) {
    throw new Error(`Variation listing child item ${child.sku} group association mismatch.`);
  }
  requireJsonEqual(item.payload, asJson(child.inventoryItem), `Variation listing child item ${child.sku}`);
  return asJson({ sku: item.sku });
}

function exactOfferEvidence(
  read: VariationListingRemoteRead<VariationListingRemoteOffer[]>,
  child: VariationListingInventoryPayloadBundle['children'][number],
  state: 'UNPUBLISHED' | 'PUBLISHED' | 'UNPUBLISHED_OR_PUBLISHED'
): Json | null {
  if (read.state === 'unknown') throw new Error(`Variation listing child offer ${child.sku} read is unknown: ${read.reason}`);
  if (read.state === 'proven_absent') return null;
  if (read.value.length === 0) return null;
  if (read.value.length !== 1) throw new Error(`Variation listing child ${child.sku} must reconcile to exactly one offer.`);
  const offer = read.value[0]!;
  if (
    offer.sku !== child.sku ||
    offer.marketplaceId !== child.offer.marketplaceId ||
    (state !== 'UNPUBLISHED_OR_PUBLISHED' && offer.status !== state)
  ) {
    throw new Error(`Variation listing child offer ${child.sku} ownership or state mismatch.`);
  }
  if (
    (state === 'UNPUBLISHED' && offer.listingId !== null) ||
    (state === 'PUBLISHED' && offer.listingId === null) ||
    (state === 'UNPUBLISHED_OR_PUBLISHED' &&
      ((offer.status === 'UNPUBLISHED' && offer.listingId !== null) ||
        (offer.status === 'PUBLISHED' && offer.listingId === null)))
  ) {
    throw new Error(`Variation listing child offer ${child.sku} listing identity mismatch.`);
  }
  requireJsonEqual(offer.payload, asJson(child.offer), `Variation listing child offer ${child.sku}`);
  return asJson({ listingId: offer.listingId, offerId: offer.offerId, sku: offer.sku });
}

export async function executeVariationListingPublication(
  input: VariationListingPublicationExecutionInput
): Promise<VariationListingPublicationExecutionResult> {
  const durableOperationPlan = input.frozen.captureInput.operationPlan.map((operation) => ({
    intent: operation.intent,
    intent_digest: operation.intentDigest,
    intent_version: operation.intentVersion,
    operation_key: operation.operationKey,
    operation_kind: operation.operationKind,
    sequence_no: operation.sequenceNo,
    target_ref: operation.targetRef,
  }));
  const existing = await input.journal.loadRevision(input.frozen.captureInput.revisionId);
  const captured = existing
    ? { revision: existing }
    : await input.transaction.captureRevision(input.frozen.captureInput);
  if (
    captured.revision.revision_id !== input.frozen.captureInput.revisionId ||
    captured.revision.group_id !== input.frozen.captureInput.groupId ||
    captured.revision.captured_desired_revision !== input.frozen.captureInput.capturedDesiredRevision ||
    captured.revision.snapshot_version !== input.frozen.captureInput.snapshotVersion ||
    captured.revision.snapshot_digest !== input.frozen.captureInput.snapshotDigest ||
    canonicalJson(captured.revision.snapshot) !== canonicalJson(input.frozen.captureInput.snapshot) ||
    canonicalJson(captured.revision.operation_plan) !== canonicalJson(durableOperationPlan)
  ) {
    throw new Error('Captured variation listing revision does not exactly match the frozen publication plan.');
  }
  const history = makeHistory(input.frozen, await input.journal.listCheckpoints(input.frozen.captureInput.revisionId));
  const resolvedMediaImages = new Map<string, string>();

  for (const media of input.frozen.snapshot.mediaResources) {
    const operationKey = `media:${media.copyId}:${media.role}`;
    const current = latest(history.get(operationKey)!);
    if (current) {
      if (isTerminal(current)) {
        const location = requiredEvidenceString(current.evidence, 'location', `Media operation ${operationKey}`);
        const imageId = requiredEvidenceString(current.evidence, 'imageId', `Media operation ${operationKey}`);
        const imageUrl = requiredEvidenceString(current.evidence, 'imageUrl', `Media operation ${operationKey}`);
        const expirationDate = requiredEvidenceString(current.evidence, 'expirationDate', `Media operation ${operationKey}`);
        const read = await input.remote.getMedia(location);
        if (
          read.state !== 'present' ||
          read.value.imageId !== imageId ||
          read.value.location !== location ||
          read.value.imageUrl !== imageUrl ||
          read.value.expirationDate !== expirationDate ||
          variationListingEpsImageUrlSchema.safeParse(imageUrl).success === false
        ) {
          throw new Error(`Variation listing Media operation ${operationKey} terminal identity no longer reconciles exactly.`);
        }
        resolvedMediaImages.set(`${media.copyId}:${media.role}`, imageUrl);
        continue;
      }
      throw new Error(`Variation listing Media operation ${operationKey} has started without a durably captured Media identity; replay is forbidden.`);
    }
    await appendCheckpoint(input, history, operationKey, { attemptNumber: 1, checkpointNumber: 1, evidence: {}, state: 'started' });
    let created: VariationListingRemoteMedia;
    try {
      created = await input.mutations.createMedia(media.sourceUrl);
    } catch (error) {
      await appendCheckpoint(input, history, operationKey, {
        attemptNumber: 1,
        checkpointNumber: 2,
        evidence: errorEvidence(error),
        observedRemoteState: 'unknown',
        state: 'unknown',
      });
      throw error;
    }
    const read = await input.remote.getMedia(created.location);
    if (
      read.state !== 'present' ||
      read.value.imageId !== created.imageId ||
      read.value.location !== created.location ||
      read.value.imageUrl !== created.imageUrl ||
      variationListingEpsImageUrlSchema.safeParse(read.value.imageUrl).success === false ||
      read.value.expirationDate !== created.expirationDate
    ) {
      await appendCheckpoint(input, history, operationKey, {
        attemptNumber: 1,
        checkpointNumber: 2,
        evidence: { reason: 'Created Media resource did not reconcile exactly.' },
        observedRemoteState: 'unknown',
        state: 'unknown',
      });
      throw new Error(`Variation listing Media operation ${operationKey} did not reconcile to its frozen EPS identity.`);
    }
    await appendCheckpoint(input, history, operationKey, {
      attemptNumber: 1,
      checkpointNumber: 2,
      evidence: mediaEvidence(read.value),
      observedRemoteState: 'present',
      state: 'confirmed_complete',
    });
    resolvedMediaImages.set(`${media.copyId}:${media.role}`, read.value.imageUrl);
  }

  const representativeImages =
    input.frozen.snapshot.representativeImages ??
    [...new Set(input.frozen.snapshot.mediaResources.map((media) => media.copyId))].map((copyId) => {
      const frontEpsUrl = resolvedMediaImages.get(`${copyId}:front`);
      const backEpsUrl = resolvedMediaImages.get(`${copyId}:back`);
      if (!frontEpsUrl || !backEpsUrl) {
        throw new Error(`Variation listing representative copy ${copyId} is missing resolved Media evidence.`);
      }
      return { copyId, frontEpsUrl, backEpsUrl };
    });
  const bundle = buildBundleFromImages(input.frozen, representativeImages);

  for (const child of bundle.children) {
    await executeMutationOperation(
      input,
      history,
      `child-item:${child.variationId}`,
      async () => exactItemEvidence(await input.remote.getInventoryItem(child.sku), child, bundle.groupKey),
      async () => {
        const read = await input.remote.getInventoryItem(child.sku);
        if (read.state === 'unknown') throw new Error(`Variation listing child item ${child.sku} pre-state is unknown: ${read.reason}`);
        return read.state === 'proven_absent' ? { sku: child.sku } : null;
      },
      () => input.mutations.createOrReplaceInventoryItem(child.sku, asJson(child.inventoryItem))
    );
  }
  for (const child of bundle.children) {
    let returnedOfferId: string | null = null;
    await executeMutationOperation(
      input,
      history,
      `child-offer:${child.variationId}`,
      async () => {
        const evidence = exactOfferEvidence(
          await input.remote.getOffers(child.sku, child.offer.marketplaceId),
          child,
          isTerminal(latest(history.get('group-publish')!))
            ? 'UNPUBLISHED_OR_PUBLISHED'
            : 'UNPUBLISHED'
        );
        if (
          evidence !== null &&
          returnedOfferId !== null &&
          requiredEvidenceString(evidence, 'offerId', `child offer ${child.sku}`) !== returnedOfferId
        ) {
          throw new Error(`Variation listing child offer ${child.sku} returned identity does not match exact read-back.`);
        }
        return evidence;
      },
      async () => {
        const read = await input.remote.getOffers(child.sku, child.offer.marketplaceId);
        if (read.state === 'unknown') throw new Error(`Variation listing child offer ${child.sku} pre-state is unknown: ${read.reason}`);
        return read.state === 'proven_absent' || read.value.length === 0 ? { sku: child.sku } : null;
      },
      async () => {
        returnedOfferId = (await input.mutations.createOffer(asJson(child.offer))).offerId;
      }
    );
  }

  let returnedListingId: string | null = null;
  await executeMutationOperation(
    input,
    history,
    'complete-group',
    async () => {
      const read = await input.remote.getInventoryItemGroup(bundle.groupKey);
      if (read.state === 'unknown') throw new Error(`Variation listing group ${bundle.groupKey} read is unknown: ${read.reason}`);
      if (read.state === 'proven_absent') return null;
      requireExactGroupMembership(read.value.variantSKUs, bundle.children.map((child) => child.sku));
      requireJsonEqual(
        groupPayloadWithoutMembership(read.value.payload),
        groupPayloadWithoutMembership(asJson(bundle.group)),
        `Variation listing group ${bundle.groupKey}`
      );
      return { groupKey: bundle.groupKey };
    },
    async () => {
      const read = await input.remote.getInventoryItemGroup(bundle.groupKey);
      if (read.state === 'unknown') throw new Error(`Variation listing group ${bundle.groupKey} pre-state is unknown: ${read.reason}`);
      return read.state === 'proven_absent' ? { groupKey: bundle.groupKey } : null;
    },
    () => input.mutations.createOrReplaceInventoryItemGroup(bundle.groupKey, asJson(bundle.group))
  );

  await executeMutationOperation(
    input,
    history,
    'group-publish',
    async () => {
      try {
        const published = await reconcileVariationListingExactPublished(input.remote, input.frozen, bundle);
        if (returnedListingId !== null && published.listingId !== returnedListingId) {
          throw new Error('Variation listing group publish returned identity does not match exact read-back.');
        }
        return { listingId: published.listingId };
      } catch (publishedError) {
        try {
          await reconcileVariationListingExactUnpublished(input.remote, input.frozen, bundle);
          return null;
        } catch {
          throw publishedError;
        }
      }
    },
    async () => {
      await reconcileVariationListingExactUnpublished(input.remote, input.frozen, bundle);
      return { groupKey: bundle.groupKey };
    },
    async () => {
      await reconcileVariationListingExactUnpublished(input.remote, input.frozen, bundle);
      returnedListingId = (await input.mutations.publishInventoryItemGroup(asJson(bundle.publishRequest))).listingId;
    }
  );

  const reconcileKey = 'revision-reconcile';
  const reconcileHistory = history.get(reconcileKey)!;
  if (latest(reconcileHistory)) {
    const published = await reconcileVariationListingExactPublished(input.remote, input.frozen, bundle);
    if (!isTerminal(latest(reconcileHistory))) {
      const current = latest(reconcileHistory)!;
      await appendCheckpoint(input, history, reconcileKey, {
        attemptNumber: current.attempt_number,
        checkpointNumber: current.checkpoint_number + 1,
        evidence: { listingId: published.listingId },
        observedRemoteState: 'present',
        state: 'confirmed_complete',
      });
    }
  } else {
    const published = await reconcileVariationListingExactPublished(input.remote, input.frozen, bundle);
    await appendCheckpoint(input, history, reconcileKey, {
      attemptNumber: 1,
      checkpointNumber: 1,
      evidence: { listingId: published.listingId },
      observedRemoteState: 'present',
      state: 'confirmed_complete',
    });
  }

  const published = await reconcileVariationListingExactPublished(input.remote, input.frozen, bundle);
  const current = await input.transaction.loadAggregate(input.frozen.captureInput.groupId);
  if (!current) throw new Error('Variation listing group disappeared before revision confirmation.');
  if (current.group.desired_revision < input.frozen.captureInput.capturedDesiredRevision) {
    throw new Error('Variation listing group desired revision regressed before confirmation.');
  }
  let confirmed: VariationListingGroupRow;
  if (current.group.last_confirmed_revision === input.frozen.captureInput.capturedDesiredRevision) {
    confirmed = current.group;
  } else {
    if (current.group.last_confirmed_revision !== input.frozen.snapshot.aggregate.group.last_confirmed_revision) {
      throw new Error('Variation listing revision confirmation conflicts with a newer confirmed revision.');
    }
    confirmed = await input.transaction.confirmRevision({
      confirmedRevision: input.frozen.captureInput.capturedDesiredRevision,
      expectedPreviousConfirmedRevision: input.frozen.snapshot.aggregate.group.last_confirmed_revision,
      groupId: input.frozen.captureInput.groupId,
    });
  }
  if (
    confirmed.group_id !== input.frozen.captureInput.groupId ||
    confirmed.last_confirmed_revision !== input.frozen.captureInput.capturedDesiredRevision ||
    confirmed.desired_revision < input.frozen.captureInput.capturedDesiredRevision
  ) {
    throw new Error('Variation listing revision confirmation did not preserve the frozen revision watermarks.');
  }
  return {
    confirmedRevision: input.frozen.captureInput.capturedDesiredRevision,
    listingId: published.listingId,
    revisionId: input.frozen.captureInput.revisionId,
  };
}
