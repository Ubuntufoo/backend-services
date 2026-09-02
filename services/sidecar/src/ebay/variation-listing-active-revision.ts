import { createHash, randomUUID } from 'node:crypto';

import type {
  CaptureVariationListingRevisionInput,
  Json,
  VariationListingAggregateSnapshot,
  VariationListingPublishingCheckpointRow,
  VariationListingRevisionPlanOperationInput,
  VariationListingRevisionRow,
  VariationListingTransactionGateway,
} from '@ebay-inventory/data';

import {
  buildVariationListingInventoryPayloadBundle,
  variationListingEpsImageUrlSchema,
  type VariationListingInventoryPayloadBundle,
  type VariationListingRepresentativeImage,
} from '@/ebay/variation-listing-payloads.js';
import {
  reconcileVariationListingExactPublished,
  type VariationListingMediaResource,
  type VariationListingPublicationReadGateway,
  type VariationListingRemoteOffer,
  type VariationListingRemoteMedia,
} from '@/ebay/variation-listing-publication.js';

const SNAPSHOT_VERSION = 2;
const INTENT_VERSION = 1;

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

function requireJsonEqual(actual: Json, expected: Json, label: string): void {
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error(`${label} does not exactly match the frozen revision intent.`);
  }
}

function asJson<T>(value: T): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

function object(value: Json, label: string): Record<string, Json> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Variation listing ${label} must be a JSON object.`);
  }
  return value as Record<string, Json>;
}

function stringValue(value: Json | undefined, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Variation listing ${label} must be a non-empty string.`);
  }
  return value;
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

export interface VariationListingConfirmedRemoteIdentity {
  listingId: string;
  offerIdsBySku: Record<string, string>;
}

export interface VariationListingFrozenActiveRevisionSnapshot {
  aggregate: VariationListingAggregateSnapshot;
  confirmed: {
    aggregate: VariationListingAggregateSnapshot;
    representativeImages: VariationListingRepresentativeImage[];
    remote: VariationListingConfirmedRemoteIdentity;
    revisionId: string;
  };
  mediaResources: VariationListingMediaResource[];
  representativeImages: VariationListingRepresentativeImage[];
}

export interface VariationListingFrozenActiveRevision {
  captureInput: CaptureVariationListingRevisionInput;
  confirmedBundle: VariationListingInventoryPayloadBundle;
  desiredBundlePreview: VariationListingInventoryPayloadBundle | null;
  snapshot: VariationListingFrozenActiveRevisionSnapshot;
}

export interface PrepareVariationListingActiveRevisionInput {
  currentAggregate: VariationListingAggregateSnapshot;
  previousRevision: VariationListingRevisionRow;
  previousCheckpoints: readonly VariationListingPublishingCheckpointRow[];
  remote: VariationListingPublicationReadGateway;
  revisionId: string;
  mediaResources?: readonly VariationListingMediaResource[];
}

function revisionSnapshotAggregate(revision: VariationListingRevisionRow): VariationListingAggregateSnapshot {
  const root = object(revision.snapshot, 'confirmed revision snapshot');
  const snapshotVersion = revision.snapshot_version;
  if (snapshotVersion === 1) {
    const aggregate = object(root.aggregate, 'confirmed revision aggregate');
    return aggregate as unknown as VariationListingAggregateSnapshot;
  }
  if (snapshotVersion === 2) {
    const aggregate = object(root.aggregate, 'confirmed active revision aggregate');
    return aggregate as unknown as VariationListingAggregateSnapshot;
  }
  throw new Error(`Unsupported confirmed variation listing snapshot version ${snapshotVersion}.`);
}

function parseRepresentativeImage(value: Json, label: string): VariationListingRepresentativeImage {
  const row = object(value, label);
  const parsed = {
    copyId: stringValue(row.copyId, `${label} copyId`),
    frontEpsUrl: stringValue(row.frontEpsUrl, `${label} frontEpsUrl`),
    backEpsUrl: stringValue(row.backEpsUrl, `${label} backEpsUrl`),
  };
  variationListingEpsImageUrlSchema.parse(parsed.frontEpsUrl);
  variationListingEpsImageUrlSchema.parse(parsed.backEpsUrl);
  if (parsed.frontEpsUrl === parsed.backEpsUrl) {
    throw new Error(`Variation listing ${label} front/back EPS URLs must be distinct.`);
  }
  return parsed;
}

function terminalMediaEvidence(
  revisionId: string,
  checkpoints: readonly VariationListingPublishingCheckpointRow[],
  copyId: string,
  role: 'front' | 'back'
): string {
  const operationKey = `media:${copyId}:${role}`;
  const matches = checkpoints
    .filter((checkpoint) => checkpoint.revision_id === revisionId && checkpoint.operation_key === operationKey)
    .sort(
      (left, right) =>
        left.attempt_number - right.attempt_number || left.checkpoint_number - right.checkpoint_number
    );
  const terminal = matches.at(-1);
  if (terminal?.state !== 'confirmed_complete' || terminal.observed_remote_state !== 'present') {
    throw new Error(`Variation listing confirmed Media operation ${operationKey} lacks terminal exact evidence.`);
  }
  const evidence = object(terminal.evidence, `confirmed Media ${operationKey} evidence`);
  const imageId = stringValue(evidence.imageId, `confirmed Media ${operationKey} imageId`);
  const location = stringValue(evidence.location, `confirmed Media ${operationKey} location`);
  const expirationDate = stringValue(evidence.expirationDate, `confirmed Media ${operationKey} expirationDate`);
  const imageUrl = stringValue(evidence.imageUrl, `confirmed Media ${operationKey} imageUrl`);
  variationListingEpsImageUrlSchema.parse(imageUrl);
  for (const candidate of matches.filter((row) => row.state === 'confirmed_complete' && row.observed_remote_state === 'present')) {
    const prior = object(candidate.evidence, `confirmed Media ${operationKey} evidence`);
    if (prior.imageId !== imageId || prior.location !== location || prior.expirationDate !== expirationDate || prior.imageUrl !== imageUrl) {
      throw new Error(`Variation listing confirmed Media operation ${operationKey} has conflicting terminal evidence.`);
    }
  }
  return imageUrl;
}

export function reconstructVariationListingConfirmedRepresentativeImages(input: {
  revision: VariationListingRevisionRow;
  checkpoints: readonly VariationListingPublishingCheckpointRow[];
}): VariationListingRepresentativeImage[] {
  const root = object(input.revision.snapshot, 'confirmed revision snapshot');
  if (input.revision.snapshot_version === 2) {
    if (!Array.isArray(root.representativeImages)) {
      throw new Error('Variation listing version-2 confirmed snapshot is missing representativeImages.');
    }
    const images = root.representativeImages.map((entry, index) =>
      parseRepresentativeImage(entry, `confirmed representative image ${index}`)
    );
    if (new Set(images.map((image) => image.copyId)).size !== images.length) {
      throw new Error('Variation listing confirmed representative image copy IDs must be unique.');
    }
    // A v2 snapshot may have captured a desired representative refresh before
    // Media completed. Resolve those own intents from terminal Media evidence.
    if (Array.isArray(root.mediaResources) && root.mediaResources.length > 0) {
      const replacements = new Map<string, { front?: string; back?: string }>();
      const keys = new Set<string>();
      for (const [index, entry] of root.mediaResources.entries()) {
        const row = object(entry, `confirmed Media resource ${index}`);
        const copyId = stringValue(row.copyId, `confirmed Media resource ${index} copyId`);
        const role = stringValue(row.role, `confirmed Media resource ${index} role`);
        if (role !== 'front' && role !== 'back') {
          throw new Error(`Variation listing confirmed Media resource ${index} has invalid role.`);
        }
        const key = `${copyId}:${role}`;
        if (keys.has(key)) throw new Error(`Variation listing confirmed Media resource ${index} is duplicated.`);
        keys.add(key);
        const pair = replacements.get(copyId) ?? {};
        pair[role] = terminalMediaEvidence(input.revision.revision_id, input.checkpoints, copyId, role);
        replacements.set(copyId, pair);
      }
      const merged = new Map(images.map((image) => [image.copyId, image]));
      for (const [copyId, pair] of replacements) {
        if (!pair.front || !pair.back) {
          throw new Error(`Variation listing confirmed Media copy ${copyId} lacks front/back terminal evidence.`);
        }
        merged.set(copyId, { copyId, frontEpsUrl: pair.front, backEpsUrl: pair.back });
      }
      return [...merged.values()];
    }
    return images;
  }
  if (input.revision.snapshot_version !== 1) {
    throw new Error(`Unsupported confirmed variation listing snapshot version ${input.revision.snapshot_version}.`);
  }

  if (Array.isArray(root.representativeImages)) {
    const images = root.representativeImages.map((entry, index) =>
      parseRepresentativeImage(entry, `confirmed representative image ${index}`)
    );
    if (new Set(images.map((image) => image.copyId)).size !== images.length) {
      throw new Error('Variation listing confirmed representative image copy IDs must be unique.');
    }
    return images;
  }
  if (!Array.isArray(root.mediaResources)) {
    throw new Error('Variation listing version-1 confirmed snapshot has no reconstructable representative image source.');
  }
  const media = root.mediaResources.map((entry, index) => {
    const row = object(entry, `confirmed Media resource ${index}`);
    const role = stringValue(row.role, `confirmed Media resource ${index} role`);
    if (role !== 'front' && role !== 'back') {
      throw new Error(`Variation listing confirmed Media resource ${index} has invalid role.`);
    }
    return {
      copyId: stringValue(row.copyId, `confirmed Media resource ${index} copyId`),
      role,
    } as const;
  });
  const mediaKeys = new Set<string>();
  for (const resource of media) {
    const key = `${resource.copyId}:${resource.role}`;
    if (mediaKeys.has(key)) throw new Error(`Variation listing confirmed Media resource ${key} is duplicated.`);
    mediaKeys.add(key);
  }
  const aggregate = object(root.aggregate, 'confirmed revision aggregate') as unknown as VariationListingAggregateSnapshot;
  const expectedRepresentatives = aggregate.variations.map((variation) => variation.representative_copy_id);
  if (expectedRepresentatives.some((copyId) => typeof copyId !== 'string')) {
    throw new Error('Variation listing confirmed aggregate has a missing representative copy.');
  }
  const copyIds = [...new Set(media.map((resource) => resource.copyId))];
  if (copyIds.length !== expectedRepresentatives.length || expectedRepresentatives.some((copyId) => !copyIds.includes(copyId!))) {
    throw new Error('Variation listing confirmed Media resources do not cover every representative copy.');
  }
  return copyIds.map((copyId) => ({
    copyId,
    frontEpsUrl: terminalMediaEvidence(input.revision.revision_id, input.checkpoints, copyId, 'front'),
    backEpsUrl: terminalMediaEvidence(input.revision.revision_id, input.checkpoints, copyId, 'back'),
  }));
}

function validateExistingVariationIdentity(
  previous: VariationListingAggregateSnapshot,
  current: VariationListingAggregateSnapshot
): void {
  const currentById = new Map(current.variations.map((variation) => [variation.variation_id, variation]));
  const currentSkuSet = new Set(current.variations.map((variation) => variation.sku));
  for (const prior of previous.variations) {
    const next = currentById.get(prior.variation_id);
    if (!next) {
      throw new Error(`Variation listing active revision cannot remove confirmed variation ${prior.variation_id}.`);
    }
    if (
      next.sku !== prior.sku ||
      next.selector_value !== prior.selector_value ||
      next.position !== prior.position ||
      next.inventory_serial !== prior.inventory_serial
    ) {
      throw new Error(`Variation listing confirmed variation ${prior.variation_id} identity changed.`);
    }
  }
  if (currentSkuSet.size !== current.variations.length) {
    throw new Error('Variation listing current aggregate contains duplicate SKUs.');
  }
}

function mediaIntentMap(resources: readonly VariationListingMediaResource[]): Map<string, VariationListingMediaResource> {
  const map = new Map<string, VariationListingMediaResource>();
  for (const resource of resources) {
    const key = `${resource.copyId}:${resource.role}`;
    if (!resource.copyId || !resource.sourceUrl || map.has(key)) {
      throw new Error('Variation listing active Media intents must have unique, complete copy/role identities.');
    }
    map.set(key, structuredClone(resource));
  }
  return map;
}

function resolveDesiredRepresentativeImages(input: {
  current: VariationListingAggregateSnapshot;
  previous: VariationListingAggregateSnapshot;
  previousImages: readonly VariationListingRepresentativeImage[];
  mediaResources: readonly VariationListingMediaResource[];
}): { representativeImages: VariationListingRepresentativeImage[]; unresolvedMediaCopyIds: string[] } {
  const previousVariationById = new Map(input.previous.variations.map((variation) => [variation.variation_id, variation]));
  const previousImagesByCopyId = new Map(input.previousImages.map((image) => [image.copyId, image]));
  const media = mediaIntentMap(input.mediaResources);
  const representativeImages: VariationListingRepresentativeImage[] = [];
  const unresolvedMediaCopyIds: string[] = [];

  for (const variation of [...input.current.variations].sort((a, b) => a.position - b.position)) {
    const copyId = variation.representative_copy_id;
    if (!copyId) throw new Error(`Variation ${variation.variation_id} is missing representative_copy_id.`);
    const prior = previousVariationById.get(variation.variation_id);
    const sameRepresentative = prior?.representative_copy_id === copyId;
    const hasFrontIntent = media.has(`${copyId}:front`);
    const hasBackIntent = media.has(`${copyId}:back`);
    if (hasFrontIntent !== hasBackIntent) {
      throw new Error(`Variation listing representative copy ${copyId} must refresh front and back together.`);
    }
    if (sameRepresentative && !hasFrontIntent) {
      const inherited = previousImagesByCopyId.get(copyId);
      if (!inherited) {
        throw new Error(`Variation listing representative copy ${copyId} has no inherited confirmed EPS pair.`);
      }
      representativeImages.push(structuredClone(inherited));
      continue;
    }
    if (!hasFrontIntent || !hasBackIntent) {
      throw new Error(`Variation listing representative copy ${copyId} requires front/back Media source intents.`);
    }
    unresolvedMediaCopyIds.push(copyId);
  }

  const expectedMediaKeys = new Set(unresolvedMediaCopyIds.flatMap((copyId) => [`${copyId}:front`, `${copyId}:back`]));
  for (const key of media.keys()) {
    if (!expectedMediaKeys.has(key)) {
      throw new Error(`Variation listing active Media intent ${key} does not belong to a required representative refresh.`);
    }
  }
  return { representativeImages, unresolvedMediaCopyIds };
}

function buildRemoteIdentity(offers: readonly VariationListingRemoteOffer[], listingId: string): VariationListingConfirmedRemoteIdentity {
  const offerIdsBySku: Record<string, string> = {};
  for (const offer of offers) {
    if (offer.listingId !== listingId || offer.status !== 'PUBLISHED' || offer.lifecycleClass !== 'active') {
      throw new Error('Variation listing confirmed offer is not active on the expected listing ID.');
    }
    if (offerIdsBySku[offer.sku]) {
      throw new Error(`Variation listing confirmed SKU ${offer.sku} has duplicate remote offers.`);
    }
    offerIdsBySku[offer.sku] = offer.offerId;
  }
  return { listingId, offerIdsBySku };
}

export async function prepareVariationListingFrozenActiveRevision(
  input: PrepareVariationListingActiveRevisionInput
): Promise<VariationListingFrozenActiveRevision> {
  const current = structuredClone(input.currentAggregate);
  if (current.group.lifecycle_state !== 'active') {
    throw new Error('Variation listing active revision requires lifecycle_state active.');
  }
  if (current.group.last_confirmed_revision === null) {
    throw new Error('Variation listing active revision requires a confirmed revision watermark.');
  }
  if (current.group.desired_revision <= current.group.last_confirmed_revision) {
    throw new Error('Variation listing active revision requires staged desired changes.');
  }
  if (
    input.previousRevision.group_id !== current.group.group_id ||
    input.previousRevision.captured_desired_revision !== current.group.last_confirmed_revision
  ) {
    throw new Error('Variation listing previous revision does not match the current confirmed watermark.');
  }
  if (digestJson(input.previousRevision.snapshot) !== input.previousRevision.snapshot_digest) {
    throw new Error('Variation listing previous confirmed revision snapshot digest does not match its durable snapshot.');
  }

  const priorPlan = Array.isArray(input.previousRevision.operation_plan)
    ? input.previousRevision.operation_plan as unknown as { operation_key: string }[]
    : [];
  const priorOperationKeys = new Set(priorPlan.map((operation) => operation.operation_key));
  for (const checkpoint of input.previousCheckpoints) {
    if (checkpoint.revision_id !== input.previousRevision.revision_id || !priorOperationKeys.has(checkpoint.operation_key)) {
      throw new Error('Variation listing previous journal checkpoint does not belong to the confirmed revision plan.');
    }
  }

  const previousAggregate = revisionSnapshotAggregate(input.previousRevision);
  if (previousAggregate.group.group_id !== current.group.group_id) {
    throw new Error('Variation listing confirmed revision snapshot belongs to another group.');
  }
  validateExistingVariationIdentity(previousAggregate, current);
  const previousImages = reconstructVariationListingConfirmedRepresentativeImages({
    revision: input.previousRevision,
    checkpoints: input.previousCheckpoints,
  });
  const confirmedBundle = buildVariationListingInventoryPayloadBundle({
    aggregate: previousAggregate,
    representativeImages: previousImages,
  });
  const confirmedRemote = await reconcileVariationListingExactPublished(input.remote, {
    captureInput: {
      capturedDesiredRevision: input.previousRevision.captured_desired_revision,
      groupId: input.previousRevision.group_id,
      operationPlan: [],
      revisionId: input.previousRevision.revision_id,
      snapshot: input.previousRevision.snapshot,
      snapshotDigest: input.previousRevision.snapshot_digest,
      snapshotVersion: input.previousRevision.snapshot_version,
    },
    snapshot: {
      aggregate: previousAggregate,
      mediaResources: [],
      representativeImages: previousImages,
    },
  }, confirmedBundle);
  const remoteIdentity = buildRemoteIdentity(confirmedRemote.offers, confirmedRemote.listingId);

  const mediaResources = structuredClone([...(input.mediaResources ?? [])]);
  const desiredImages = resolveDesiredRepresentativeImages({
    current,
    previous: previousAggregate,
    previousImages,
    mediaResources,
  });
  if (desiredImages.unresolvedMediaCopyIds.length > 0) {
    const placeholders = new Map(desiredImages.representativeImages.map((image) => [image.copyId, image]));
    for (const copyId of desiredImages.unresolvedMediaCopyIds) {
      const token = digestJson(copyId).slice(0, 24);
      placeholders.set(copyId, {
        copyId,
        frontEpsUrl: `https://i.ebayimg.com/images/g/${token}-front/s-l1600.jpg`,
        backEpsUrl: `https://i.ebayimg.com/images/g/${token}-back/s-l1600.jpg`,
      });
    }
    buildVariationListingInventoryPayloadBundle({
      aggregate: current,
      representativeImages: [...new Set(current.variations.map((variation) => variation.representative_copy_id))].map((copyId) => {
        if (!copyId) throw new Error('Variation listing active revision has a missing representative copy.');
        const image = placeholders.get(copyId);
        if (!image) throw new Error(`Variation listing representative copy ${copyId} has no structural image input.`);
        return image;
      }),
    });
  }
  const desiredBundlePreview = desiredImages.unresolvedMediaCopyIds.length === 0
    ? buildVariationListingInventoryPayloadBundle({
        aggregate: current,
        representativeImages: desiredImages.representativeImages,
      })
    : null;

  const snapshot: VariationListingFrozenActiveRevisionSnapshot = {
    aggregate: current,
    confirmed: {
      aggregate: previousAggregate,
      representativeImages: previousImages,
      remote: remoteIdentity,
      revisionId: input.previousRevision.revision_id,
    },
    mediaResources,
    representativeImages: desiredImages.representativeImages,
  };

  const operations: VariationListingRevisionPlanOperationInput[] = [];
  let sequenceNo = 1;
  for (const mediaResource of mediaResources) {
    const key = `${mediaResource.copyId}:${mediaResource.role}`;
    operations.push(operation({
      sequenceNo: sequenceNo++,
      key: `media:${key}`,
      kind: 'media_ingest',
      targetRef: key,
      intent: asJson(mediaResource),
    }));
  }
  for (const variation of [...current.variations].sort((a, b) => a.position - b.position)) {
    const existed = previousAggregate.variations.some((candidate) => candidate.variation_id === variation.variation_id);
    operations.push(operation({
      sequenceNo: sequenceNo++,
      key: `child-item:${variation.variation_id}`,
      kind: 'child_inventory_item_write',
      targetRef: variation.sku,
      intent: asJson({ existed, sku: variation.sku, variationId: variation.variation_id }),
    }));
    operations.push(operation({
      sequenceNo: sequenceNo++,
      key: `child-offer:${variation.variation_id}`,
      kind: 'child_offer_write',
      targetRef: variation.sku,
      intent: asJson({ existed, sku: variation.sku, variationId: variation.variation_id }),
    }));
  }
  operations.push(operation({
    sequenceNo: sequenceNo++,
    key: 'complete-group',
    kind: 'complete_group_replace',
    targetRef: current.group.group_key,
    intent: asJson({ groupId: current.group.group_id, groupKey: current.group.group_key }),
  }));
  for (const variation of [...current.variations]
    .sort((a, b) => a.position - b.position)
    .filter((variation) => !previousAggregate.variations.some((candidate) => candidate.variation_id === variation.variation_id))) {
    operations.push(operation({
      sequenceNo: sequenceNo++,
      key: `publish-offer:${variation.variation_id}`,
      kind: 'group_publish',
      targetRef: variation.sku,
      intent: asJson({ sku: variation.sku, variationId: variation.variation_id }),
    }));
  }
  operations.push(operation({
    sequenceNo,
    key: 'revision-reconcile',
    kind: 'revision_reconcile',
    targetRef: current.group.group_key,
    intent: asJson({
      frozenListingId: remoteIdentity.listingId,
      groupId: current.group.group_id,
      groupKey: current.group.group_key,
      orderedSkus: [...current.variations].sort((a, b) => a.position - b.position).map((variation) => variation.sku),
      previousConfirmedRevision: current.group.last_confirmed_revision,
    }),
  }));

  const snapshotJson = asJson(snapshot);
  return {
    snapshot,
    confirmedBundle,
    desiredBundlePreview,
    captureInput: {
      capturedDesiredRevision: current.group.desired_revision,
      groupId: current.group.group_id,
      operationPlan: operations,
      revisionId: input.revisionId,
      snapshot: snapshotJson,
      snapshotDigest: digestJson(snapshotJson),
      snapshotVersion: SNAPSHOT_VERSION,
    },
  };
}

/** Mutation seam used only by an already-active revision.  The initial
 * publish executor remains in variation-listing-publication.ts; active
 * revisions deliberately use updateOffer/publishOffer and never call a fresh
 * group publish for an existing offer. */
export interface VariationListingActiveMutationGateway {
  createMedia?: (sourceUrl: string) => Promise<VariationListingRemoteMedia>;
  createOffer: (payload: Json) => Promise<{ offerId: string }>;
  createOrReplaceInventoryItem: (sku: string, payload: Json) => Promise<void>;
  createOrReplaceInventoryItemGroup: (groupKey: string, payload: Json) => Promise<void>;
  publishOffer: (offerId: string) => Promise<{ listingId: string }>;
  updateOffer: (offerId: string, payload: Json) => Promise<void>;
}

export interface VariationListingActiveRevisionExecutionInput {
  frozen: VariationListingFrozenActiveRevision;
  journal: {
    listCheckpoints(revisionId: string): Promise<VariationListingPublishingCheckpointRow[]>;
    /** Durable revision lookup is required so a restart resumes the captured
     * plan instead of attempting a second capture (the capture RPC is not
     * idempotent). */
    loadRevision: (revisionId: string) => Promise<VariationListingRevisionRow | null>;
  };
  mutations: VariationListingActiveMutationGateway;
  remote: VariationListingPublicationReadGateway & {
    getMedia?: (location: string) => Promise<
      | { state: 'present'; value: VariationListingRemoteMedia }
      | { state: 'proven_absent' }
      | { state: 'unknown'; reason: string }
    >;
  };
  transaction: Pick<
    VariationListingTransactionGateway,
    'appendJournalCheckpoint' | 'captureRevision' | 'confirmRevision' | 'loadAggregate'
  >;
  checkpointId?: () => string;
}

export interface VariationListingActiveRevisionExecutionResult {
  confirmedRevision: number;
  listingId: string;
  revisionId: string;
}

type ActiveHistory = Map<string, VariationListingPublishingCheckpointRow[]>;
type ActiveState = 'started' | 'unknown' | 'retry_authorized' | 'retry_exhausted' | 'confirmed_complete' | 'confirmed_no_op';

function activeLatest(rows: readonly VariationListingPublishingCheckpointRow[]): VariationListingPublishingCheckpointRow | null {
  return [...rows].sort((a, b) => a.attempt_number - b.attempt_number || a.checkpoint_number - b.checkpoint_number).at(-1) ?? null;
}

function activeTerminal(row: VariationListingPublishingCheckpointRow | null): boolean {
  return row?.state === 'confirmed_complete' || row?.state === 'confirmed_no_op' || row?.state === 'retry_exhausted';
}

function activeErrorEvidence(error: unknown): Json {
  return { error: error instanceof Error ? error.message : String(error) };
}

async function activeAppend(
  input: VariationListingActiveRevisionExecutionInput,
  history: ActiveHistory,
  operationKey: string,
  state: ActiveState,
  attemptNumber: number,
  checkpointNumber: number,
  evidence: Json,
  observedRemoteState?: 'present' | 'proven_absent' | 'unknown'
): Promise<void> {
  if (evidence === null || typeof evidence !== 'object' || Array.isArray(evidence)) {
    throw new Error(`Variation listing operation ${operationKey} evidence must be an object.`);
  }
  const result = await input.transaction.appendJournalCheckpoint({
    attemptNumber,
    checkpointId: (input.checkpointId ?? randomUUID)(),
    checkpointNumber,
    evidence,
    observedRemoteState,
    operationKey,
    revisionId: input.frozen.captureInput.revisionId,
    state,
  });
  history.get(operationKey)!.push(result.checkpoint);
}

function makeActiveHistory(
  frozen: VariationListingFrozenActiveRevision,
  checkpoints: readonly VariationListingPublishingCheckpointRow[]
): ActiveHistory {
  const allowed = new Set(frozen.captureInput.operationPlan.map((entry) => entry.operationKey));
  const history: ActiveHistory = new Map(frozen.captureInput.operationPlan.map((entry) => [entry.operationKey, []]));
  for (const checkpoint of checkpoints) {
    if (checkpoint.revision_id !== frozen.captureInput.revisionId || !allowed.has(checkpoint.operation_key)) {
      throw new Error('Variation listing journal history does not belong to the frozen active revision.');
    }
    history.get(checkpoint.operation_key)!.push(checkpoint);
  }
  for (const operation of frozen.captureInput.operationPlan) {
    const rows = history.get(operation.operationKey)!;
    const ordered = [...rows].sort((a, b) => a.attempt_number - b.attempt_number || a.checkpoint_number - b.checkpoint_number);
    if (ordered.length === 0) continue;
    const readOnly = operation.operationKind === 'revision_reconcile' || operation.operationKind === 'final_absence_verification';
    if (ordered[0].attempt_number !== 1 || ordered[0].checkpoint_number !== 1 || (ordered[0].state !== 'started' && !(readOnly && (ordered[0].state === 'confirmed_complete' || ordered[0].state === 'confirmed_no_op')))) {
      throw new Error(`Variation listing active operation ${operation.operationKey} history must begin started at 1/1.`);
    }
    for (const row of ordered) {
      if (row.evidence === null || typeof row.evidence !== 'object' || Array.isArray(row.evidence)) {
        throw new Error(`Variation listing active operation ${operation.operationKey} checkpoint evidence must be an object.`);
      }
      if (row.state !== 'started' && Object.keys(row.evidence).length === 0) {
        throw new Error(`Variation listing active operation ${operation.operationKey} resolved checkpoint requires exact evidence.`);
      }
      if (row.state === 'started' && row.observed_remote_state !== null) {
        throw new Error(`Variation listing active operation ${operation.operationKey} started checkpoint cannot claim remote evidence.`);
      }
      if (row.state === 'unknown' && row.observed_remote_state !== 'unknown') {
        throw new Error(`Variation listing active operation ${operation.operationKey} unknown checkpoint requires ambiguity evidence.`);
      }
      if (row.state === 'confirmed_complete' && row.observed_remote_state !== 'present') {
        throw new Error(`Variation listing active operation ${operation.operationKey} terminal checkpoint requires present evidence.`);
      }
      if (row.state === 'confirmed_no_op' && row.observed_remote_state !== 'present' && row.observed_remote_state !== 'proven_absent') {
        throw new Error(`Variation listing active operation ${operation.operationKey} no-op checkpoint requires exact evidence.`);
      }
      if ((row.state === 'retry_authorized' || row.state === 'retry_exhausted') && row.observed_remote_state !== 'present' && row.observed_remote_state !== 'proven_absent') {
        throw new Error(`Variation listing active operation ${operation.operationKey} retry checkpoint requires exact pre-state evidence.`);
      }
    }
    for (let i = 1; i < ordered.length; i += 1) {
      const previous = ordered[i - 1];
      const current = ordered[i];
      const contiguous =
        (current.attempt_number === previous.attempt_number && current.checkpoint_number === previous.checkpoint_number + 1) ||
        (current.attempt_number === previous.attempt_number + 1 && current.checkpoint_number === 1);
      if (!contiguous) throw new Error(`Variation listing active operation ${operation.operationKey} journal numbering is not contiguous.`);
      if (activeTerminal(previous)) throw new Error(`Variation listing active operation ${operation.operationKey} is terminal and cannot reopen.`);
      if (previous.state === 'retry_authorized' && (current.state !== 'started' || current.attempt_number !== previous.attempt_number || current.checkpoint_number !== previous.checkpoint_number + 1)) {
        throw new Error(`Variation listing active operation ${operation.operationKey} retry authorization permits exactly one replay.`);
      }
      if (previous.state === 'started') {
        if (current.attempt_number !== previous.attempt_number || !['unknown', 'confirmed_complete', 'confirmed_no_op'].includes(current.state)) {
          throw new Error(`Variation listing active operation ${operation.operationKey} started checkpoint must resolve on same attempt.`);
        }
      }
      if (previous.state === 'unknown' || previous.observed_remote_state === 'unknown') {
        if (current.attempt_number !== previous.attempt_number + 1 || current.checkpoint_number !== 1) {
          throw new Error(`Variation listing active operation ${operation.operationKey} unknown outcome requires next-attempt reconciliation.`);
        }
        const retryAuthorizedCount = ordered.slice(0, i).filter((row) => row.state === 'retry_authorized').length;
        const allowed = retryAuthorizedCount === 0
          ? ['confirmed_complete', 'confirmed_no_op', 'retry_authorized']
          : ['confirmed_complete', 'retry_exhausted'];
        if (!allowed.includes(current.state)) {
          throw new Error(`Variation listing active operation ${operation.operationKey} unknown outcome has an invalid reconciliation transition.`);
        }
      }
    }
  }
  return history;
}

function activeObjectEvidence(value: Json, label: string): Record<string, Json> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} evidence must be an object.`);
  return value as Record<string, Json>;
}

function preEvidenceState(evidence: Json): 'present' | 'proven_absent' {
  if (evidence !== null && typeof evidence === 'object' && !Array.isArray(evidence) && (evidence as Record<string, Json>).absent === true) {
    return 'proven_absent';
  }
  return 'present';
}

function activeString(value: Json | undefined, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} evidence is missing a non-empty string.`);
  return value;
}

async function executeActiveOperation(
  input: VariationListingActiveRevisionExecutionInput,
  history: ActiveHistory,
  operationKey: string,
  after: () => Promise<Json | null>,
  pre: () => Promise<Json | null>,
  mutate: () => Promise<void>
): Promise<void> {
  const rows = history.get(operationKey)!;
  const current = activeLatest(rows);
  const retryAuthorizedPreviously = rows.some((row) => row.state === 'retry_authorized');
  if (current?.state === 'retry_exhausted') throw new Error(`Variation listing operation ${operationKey} exhausted its one bounded replay.`);
  if (current?.state === 'confirmed_complete') {
    if ((await after()) === null) throw new Error(`Variation listing operation ${operationKey} terminal after-state no longer reconciles exactly.`);
    return;
  }
  if (current?.state === 'confirmed_no_op') {
    if ((await after()) === null) throw new Error(`Variation listing operation ${operationKey} terminal no-op no longer reconciles exactly.`);
    return;
  }
  if (current?.state === 'retry_authorized') {
    const afterEvidence = await after();
    if (afterEvidence !== null) {
      await activeAppend(input, history, operationKey, 'started', current.attempt_number, current.checkpoint_number + 1, {});
      await activeAppend(input, history, operationKey, 'confirmed_complete', current.attempt_number, current.checkpoint_number + 2, afterEvidence, 'present');
      return;
    }
    const preEvidence = await pre();
    if (preEvidence === null) throw new Error(`Variation listing operation ${operationKey} retry pre-state is not exact; replay is forbidden.`);
    await activeAppend(input, history, operationKey, 'started', current.attempt_number, current.checkpoint_number + 1, {});
    try {
      await mutate();
    } catch (error) {
      await activeAppend(input, history, operationKey, 'unknown', current.attempt_number, current.checkpoint_number + 2, activeErrorEvidence(error), 'unknown');
      throw error;
    }
    const replayAfter = await after();
    if (replayAfter === null) {
      await activeAppend(input, history, operationKey, 'unknown', current.attempt_number, current.checkpoint_number + 2, { reason: 'Replay returned without exact after-state.' }, 'unknown');
      throw new Error(`Variation listing operation ${operationKey} replay outcome is unknown.`);
    }
    await activeAppend(input, history, operationKey, 'confirmed_complete', current.attempt_number, current.checkpoint_number + 2, replayAfter, 'present');
    return;
  }
  if (current?.state === 'unknown' || current?.observed_remote_state === 'unknown') {
    const afterEvidence = await after();
    if (afterEvidence !== null) {
      await activeAppend(input, history, operationKey, 'confirmed_complete', current.attempt_number + 1, 1, afterEvidence, 'present');
      return;
    }
    const preEvidence = await pre();
    if (preEvidence === null) {
      throw new Error(`Variation listing operation ${operationKey} has unknown state; exact pre-state is not proven.`);
    }
    if (retryAuthorizedPreviously) {
      await activeAppend(input, history, operationKey, 'retry_exhausted', current.attempt_number + 1, 1, preEvidence, preEvidenceState(preEvidence));
      throw new Error(`Variation listing operation ${operationKey} exhausted its one bounded replay.`);
    }
    await activeAppend(input, history, operationKey, 'retry_authorized', current.attempt_number + 1, 1, preEvidence, preEvidenceState(preEvidence));
    throw new Error(`Variation listing operation ${operationKey} retry authorized; resume permits exactly one replay.`);
  }
  if (current?.state === 'started') {
    const afterEvidence = await after();
    if (afterEvidence !== null) {
      await activeAppend(input, history, operationKey, 'confirmed_complete', current.attempt_number, current.checkpoint_number + 1, afterEvidence, 'present');
      return;
    }
    const preEvidence = await pre();
    if (preEvidence !== null) {
      // A started checkpoint means the mutation may have reached the remote
      // even when the resume read does not match the desired after-state.
      // Recording no-op here would falsely confirm an operation whose desired
      // payload/state is absent or different. Preserve the exact observed
      // pre-state as ambiguity evidence and require reconciliation instead.
      await activeAppend(
        input,
        history,
        operationKey,
        'unknown',
        current.attempt_number,
        current.checkpoint_number + 1,
        // Keep the exact pre-read as checkpoint evidence. It is truthful
        // evidence of what is observed now, while the unknown state records
        // that a started mutation may already have changed the remote.
        preEvidence,
        'unknown'
      );
      throw new Error(`Variation listing operation ${operationKey} has an unknown mutation outcome; replay is forbidden.`);
    }
    await activeAppend(input, history, operationKey, 'unknown', current.attempt_number, current.checkpoint_number + 1, { reason: 'Neither exact after-state nor exact pre-state is proven.' }, 'unknown');
    throw new Error(`Variation listing operation ${operationKey} has an unknown mutation outcome; replay is forbidden.`);
  }
  const afterEvidence = await after();
  if (afterEvidence !== null) {
    await activeAppend(input, history, operationKey, 'started', 1, 1, {});
    await activeAppend(input, history, operationKey, 'confirmed_no_op', 1, 2, afterEvidence, 'present');
    return;
  }
  const preEvidence = await pre();
  if (preEvidence === null) throw new Error(`Variation listing operation ${operationKey} pre-state is not exact.`);
  await activeAppend(input, history, operationKey, 'started', 1, 1, {});
  try {
    await mutate();
  } catch (error) {
    await activeAppend(input, history, operationKey, 'unknown', 1, 2, activeErrorEvidence(error), 'unknown');
    throw error;
  }
  const mutationAfter = await after();
  if (mutationAfter === null) {
    await activeAppend(input, history, operationKey, 'unknown', 1, 2, { reason: 'Mutation returned without exact after-state.' }, 'unknown');
    throw new Error(`Variation listing operation ${operationKey} returned without an exact after-state.`);
  }
  await activeAppend(input, history, operationKey, 'confirmed_complete', 1, 2, mutationAfter, 'present');
}

function requireActiveMethod<T extends keyof VariationListingActiveMutationGateway>(
  mutations: VariationListingActiveMutationGateway,
  method: T
): NonNullable<VariationListingActiveMutationGateway[T]> {
  const fn = mutations[method];
  if (typeof fn !== 'function') throw new Error(`Variation listing active mutation gateway is missing ${method}.`);
  return fn;
}

function activeOffer(
  read: Awaited<ReturnType<VariationListingPublicationReadGateway['getOffers']>>,
  expected: VariationListingInventoryPayloadBundle['children'][number]['offer'],
  identity: { offerId: string; listingId: string },
  status: 'PUBLISHED' | 'UNPUBLISHED',
  lifecycleRequired: boolean
): Json | null {
  if (read.state === 'unknown') throw new Error(`Variation listing offer ${expected.sku} read is unknown: ${read.reason}`);
  if (read.state === 'proven_absent' || read.value.length === 0) return null;
  if (read.value.length !== 1) throw new Error(`Variation listing offer ${expected.sku} must have exactly one offer.`);
  const offer = read.value[0];
  if (offer.offerId !== identity.offerId || offer.sku !== expected.sku || offer.marketplaceId !== expected.marketplaceId || offer.status !== status || offer.listingId !== identity.listingId || (lifecycleRequired && offer.lifecycleClass !== 'active')) {
    throw new Error(`Variation listing offer ${expected.sku} does not match the frozen offer identity.`);
  }
  if (canonicalJson(offer.payload) !== canonicalJson(asJson(expected))) return null;
  return asJson({ offerId: offer.offerId, listingId: offer.listingId, payload: offer.payload, sku: offer.sku });
}

function activeItem(
  read: Awaited<ReturnType<VariationListingPublicationReadGateway['getInventoryItem']>>,
  expected: VariationListingInventoryPayloadBundle['children'][number],
  groupKey: string,
  requireGroup: boolean
): Json | null {
  if (read.state === 'unknown') throw new Error(`Variation listing item ${expected.sku} read is unknown: ${read.reason}`);
  if (read.state === 'proven_absent') return null;
  if (read.value.sku !== expected.sku) throw new Error(`Variation listing item ${expected.sku} identity mismatch.`);
  if (read.value.groupKeys !== null && (read.value.groupKeys.length !== 1 || read.value.groupKeys[0] !== groupKey)) throw new Error(`Variation listing item ${expected.sku} has foreign group association.`);
  if (requireGroup && (read.value.groupKeys?.length !== 1 || read.value.groupKeys[0] !== groupKey)) throw new Error(`Variation listing item ${expected.sku} is not associated with the expected group.`);
  if (canonicalJson(read.value.payload) !== canonicalJson(asJson(expected.inventoryItem))) return null;
  return asJson({ groupKeys: read.value.groupKeys, payload: read.value.payload, sku: read.value.sku });
}

function activeGroup(read: Awaited<ReturnType<VariationListingPublicationReadGateway['getInventoryItemGroup']>>, expected: VariationListingInventoryPayloadBundle['group']): Json | null {
  if (read.state === 'unknown') throw new Error(`Variation listing group ${expected.inventoryItemGroupKey} read is unknown: ${read.reason}`);
  if (read.state === 'proven_absent') return null;
  if (new Set(read.value.variantSKUs).size !== read.value.variantSKUs.length || new Set(expected.variantSKUs).size !== expected.variantSKUs.length || read.value.variantSKUs.length !== expected.variantSKUs.length || expected.variantSKUs.some((sku) => !read.value.variantSKUs.includes(sku))) return null;
  if (canonicalJson(groupPayloadWithoutMembership(read.value.payload)) !== canonicalJson(groupPayloadWithoutMembership(asJson(expected)))) return null;
  return asJson({ groupKey: expected.inventoryItemGroupKey, payload: read.state === 'present' ? read.value.payload : null, variantSKUs: read.state === 'present' ? read.value.variantSKUs : [] });
}

function groupPayloadWithoutMembership(payload: Json): Json {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const { variantSKUs: _variantSKUs, ...rest } = payload as Record<string, Json>;
  return rest;
}

function activeMediaEvidence(media: VariationListingRemoteMedia): Json {
  return {
    expirationDate: media.expirationDate,
    imageId: media.imageId,
    imageUrl: media.imageUrl,
    location: media.location,
  };
}

function activeMediaFromCheckpoint(
  row: VariationListingPublishingCheckpointRow,
  operationKey: string
): VariationListingRemoteMedia {
  const evidence = activeObjectEvidence(row.evidence, `Media operation ${operationKey}`);
  const media = {
    expirationDate: activeString(evidence.expirationDate, `Media operation ${operationKey} expirationDate`),
    imageId: activeString(evidence.imageId, `Media operation ${operationKey} imageId`),
    imageUrl: activeString(evidence.imageUrl, `Media operation ${operationKey} imageUrl`),
    location: activeString(evidence.location, `Media operation ${operationKey} location`),
  };
  variationListingEpsImageUrlSchema.parse(media.imageUrl);
  return media;
}

/** Execute one frozen active revision. Every remote mutation is preceded by
 * an exact pre-state read and followed by exact after-state reconciliation.
 * The journal's retry grammar is intentionally local to this seam so Slice A
 * and YP5.2 initial publication behavior remain unchanged. */
export async function executeVariationListingActiveRevision(
  input: VariationListingActiveRevisionExecutionInput
): Promise<VariationListingActiveRevisionExecutionResult> {
  const captureInput = input.frozen.captureInput;
  const frozenSnapshot = asJson(input.frozen.snapshot);
  // Treat the prepared snapshot and the JSON handed to durable capture as one
  // immutable intent. Validate both canonical parity and the digest before
  // touching any remote mutation seam.
  if (captureInput.snapshotVersion !== SNAPSHOT_VERSION) {
    throw new Error(`Unsupported active revision snapshot version ${captureInput.snapshotVersion}.`);
  }
  requireJsonEqual(frozenSnapshot, captureInput.snapshot, 'Frozen active revision snapshot');
  if (digestJson(captureInput.snapshot) !== captureInput.snapshotDigest) {
    throw new Error('Frozen variation listing active revision snapshot digest does not match its snapshot.');
  }
  for (const operation of captureInput.operationPlan) {
    if (digestJson(operation.intent) !== operation.intentDigest) {
      throw new Error(`Frozen variation listing operation ${operation.operationKey} intent digest does not match its intent.`);
    }
  }

  // The lookup is intentionally mandatory. The capture RPC rejects duplicate
  // revision rows, so skipping this read on restart would turn a resumable
  // execution into a second capture attempt.
  if (typeof input.journal.loadRevision !== 'function') {
    throw new Error('Variation listing active revision requires a durable revision lookup.');
  }
  const existingRevision = await input.journal.loadRevision(captureInput.revisionId);
  const captured = existingRevision
    ? { revision: existingRevision }
    : await input.transaction.captureRevision(captureInput);
  const durableOperationPlan = captureInput.operationPlan.map((operation) => ({
    intent: operation.intent,
    intent_digest: operation.intentDigest,
    intent_version: operation.intentVersion,
    operation_key: operation.operationKey,
    operation_kind: operation.operationKind,
    sequence_no: operation.sequenceNo,
    target_ref: operation.targetRef,
  }));
  if (
    captured.revision.revision_id !== captureInput.revisionId ||
    captured.revision.group_id !== captureInput.groupId ||
    captured.revision.captured_desired_revision !== captureInput.capturedDesiredRevision ||
    captured.revision.snapshot_version !== captureInput.snapshotVersion ||
    captured.revision.snapshot_digest !== captureInput.snapshotDigest ||
    captured.revision.operation_count !== captureInput.operationPlan.length
  ) {
    throw new Error('Captured variation listing active revision identity does not exactly match the frozen plan.');
  }
  if (digestJson(captured.revision.snapshot) !== captured.revision.snapshot_digest) {
    throw new Error('Captured variation listing active revision snapshot digest does not match its durable snapshot.');
  }
  requireJsonEqual(captured.revision.snapshot, captureInput.snapshot, 'Captured variation listing active revision snapshot');
  if (canonicalJson(captured.revision.operation_plan) !== canonicalJson(durableOperationPlan)) {
    throw new Error('Captured variation listing active revision operation plan does not exactly match the frozen plan.');
  }
  const history = makeActiveHistory(input.frozen, await input.journal.listCheckpoints(captureInput.revisionId));
  const previousBundle = input.frozen.confirmedBundle;
  const desiredImages = new Map(input.frozen.snapshot.representativeImages.map((image) => [image.copyId, structuredClone(image)]));
  const resolvedMedia = new Map<string, VariationListingRemoteMedia>();
  const getMedia = input.remote.getMedia;

  for (const media of input.frozen.snapshot.mediaResources) {
    if (!getMedia) throw new Error('Variation listing active Media execution requires a getMedia read gateway.');
    const operationKey = `media:${media.copyId}:${media.role}`;
    const rows = history.get(operationKey)!;
    const current = activeLatest(rows);
    if (current) {
      // Media evidence is only durable after a successful ingest that was
      // observed as present. A no-op/proven-absent checkpoint (or any forged
      // terminal shape) cannot supply an EPS identity for resume.
      if (current.state !== 'confirmed_complete' || current.observed_remote_state !== 'present') {
        throw new Error(`Variation listing Media operation ${operationKey} has no durable confirmed-present identity; replay is forbidden.`);
      }
      const expected = activeMediaFromCheckpoint(current, operationKey);
      const read = await getMedia(expected.location);
      if (read.state !== 'present' || read.value.imageId !== expected.imageId || read.value.location !== expected.location || read.value.imageUrl !== expected.imageUrl || read.value.expirationDate !== expected.expirationDate) {
        throw new Error(`Variation listing Media operation ${operationKey} terminal identity no longer reconciles exactly.`);
      }
      resolvedMedia.set(operationKey, expected);
      continue;
    }
    const createMedia = requireActiveMethod(input.mutations, 'createMedia');
    await activeAppend(input, history, operationKey, 'started', 1, 1, {});
    let created: VariationListingRemoteMedia;
    try {
      created = await createMedia(media.sourceUrl);
    } catch (error) {
      await activeAppend(input, history, operationKey, 'unknown', 1, 2, activeErrorEvidence(error), 'unknown');
      throw error;
    }
    const read = await getMedia(created.location);
    if (read.state !== 'present' || read.value.imageId !== created.imageId || read.value.location !== created.location || read.value.imageUrl !== created.imageUrl || read.value.expirationDate !== created.expirationDate || !variationListingEpsImageUrlSchema.safeParse(read.value.imageUrl).success) {
      await activeAppend(input, history, operationKey, 'unknown', 1, 2, { reason: 'Created Media resource did not reconcile exactly.' }, 'unknown');
      throw new Error(`Variation listing Media operation ${operationKey} did not reconcile to its frozen EPS identity.`);
    }
    await activeAppend(input, history, operationKey, 'confirmed_complete', 1, 2, activeMediaEvidence(read.value), 'present');
    resolvedMedia.set(operationKey, read.value);
  }

  // Merge inherited image pairs with terminal outputs from this revision.
  for (const media of input.frozen.snapshot.mediaResources) {
    const front = resolvedMedia.get(`media:${media.copyId}:front`)?.imageUrl;
    const back = resolvedMedia.get(`media:${media.copyId}:back`)?.imageUrl;
    if (front && back) desiredImages.set(media.copyId, { copyId: media.copyId, frontEpsUrl: front, backEpsUrl: back });
  }
  const representativeImages = [...new Set(input.frozen.snapshot.aggregate.variations.map((variation) => variation.representative_copy_id))].map((copyId) => {
    if (!copyId) throw new Error('Variation listing active revision has a missing representative copy.');
    const image = desiredImages.get(copyId);
    if (!image) throw new Error(`Variation listing representative copy ${copyId} is missing resolved EPS evidence.`);
    return image;
  });
  const desiredBundle = buildVariationListingInventoryPayloadBundle({ aggregate: input.frozen.snapshot.aggregate, representativeImages });
  const previousByVariation = new Map(input.frozen.snapshot.confirmed.aggregate.variations.map((variation) => [variation.variation_id, variation]));
  const priorOfferIds = input.frozen.snapshot.confirmed.remote.offerIdsBySku;
  const frozenListingId = input.frozen.snapshot.confirmed.remote.listingId;
  const newOfferIdsByVariation = new Map<string, string>();

  for (const child of desiredBundle.children) {
    const priorVariation = previousByVariation.get(child.variationId);
    const priorChild = previousBundle.children.find((candidate) => candidate.variationId === child.variationId);
    const existed = Boolean(priorVariation);
    const itemOperationKey = `child-item:${child.variationId}`;
    const itemAfter = async (): Promise<Json | null> => activeItem(await input.remote.getInventoryItem(child.sku), child, desiredBundle.groupKey, existed);
    const itemRows = history.get(itemOperationKey)!;
    const originalItemAfter = itemAfter;
    const guardedItemAfter = async (): Promise<Json | null> => {
      const result = await originalItemAfter();
      if (!existed && itemRows.length === 0 && result !== null) return null;
      return result;
    };
    const itemPre = async (): Promise<Json | null> => {
      if (!priorChild) {
        const read = await input.remote.getInventoryItem(child.sku);
        if (read.state === 'unknown') throw new Error(`Variation listing item ${child.sku} pre-state is unknown: ${read.reason}`);
        if (read.state === 'proven_absent') return { absent: true, sku: child.sku };
        throw new Error(`Variation listing new item ${child.sku} must be proven absent before create.`);
      }
      return activeItem(await input.remote.getInventoryItem(child.sku), priorChild, desiredBundle.groupKey, true);
    };
    await executeActiveOperation(input, history, itemOperationKey, guardedItemAfter, itemPre, () => input.mutations.createOrReplaceInventoryItem(child.sku, asJson(child.inventoryItem)));

    const priorOfferId = priorOfferIds[child.sku];
    const offerIdentity = { offerId: priorOfferId ?? '', listingId: frozenListingId };
    let returnedOfferId: string | null = null;
    const offerOperationKey = `child-offer:${child.variationId}`;
    const offerRows = history.get(offerOperationKey)!;
    const offerAfter = async (): Promise<Json | null> => {
      const read = await input.remote.getOffers(child.sku, child.offer.marketplaceId);
      if (!existed) {
        if (read.state === 'unknown') throw new Error(`Variation listing new offer ${child.sku} read is unknown: ${read.reason}`);
        if (read.state === 'proven_absent' || read.value.length === 0) return null;
        if (read.value.length !== 1) throw new Error(`Variation listing new offer ${child.sku} must have exactly one offer.`);
        const offer = read.value[0];
        if (offer.sku !== child.sku || offer.marketplaceId !== child.offer.marketplaceId) throw new Error(`Variation listing new offer ${child.sku} identity mismatch.`);
        if (canonicalJson(offer.payload) !== canonicalJson(asJson(child.offer))) {
          throw new Error(`Variation listing new offer ${child.sku} payload mismatch.`);
        }
        // Before this operation has any durable history, any existing offer is
        // a collision rather than an adoptable after-state. executeActiveOperation
        // will then run the exact absence pre-read and fail closed.
        if (offerRows.length === 0) return null;
        const latestOfferRow = activeLatest(offerRows);
        if (offer.status === 'UNPUBLISHED' && offer.listingId === null) {
          if (returnedOfferId && returnedOfferId !== offer.offerId) {
            throw new Error(`Variation listing new offer ${child.sku} returned ID drifted.`);
          }
          // On a resumed execution the only identity that may be adopted is
          // the one already journaled by a terminal confirmed-complete
          // checkpoint. A preterminal started/unknown checkpoint has no
          // durable offer identity; an exact-payload offer found there may be
          // foreign/replaced and must fail closed. The same invocation may
          // continue only when createOffer returned an ID that is still in
          // memory and matches the read-back.
          if (!returnedOfferId && latestOfferRow?.state !== 'confirmed_complete') {
            throw new Error(`Variation listing new offer ${child.sku} has no durable offer identity for resume.`);
          }
          if (latestOfferRow?.state === 'confirmed_complete') {
            const durableOfferId = activeString(
              activeObjectEvidence(latestOfferRow.evidence, `offer operation ${offerOperationKey}`).offerId,
              `offer operation ${offerOperationKey} offerId`
            );
            if (durableOfferId !== offer.offerId) {
              throw new Error(`Variation listing new offer ${child.sku} durable offer ID drifted.`);
            }
          }
          // This is the exact successful after-state of createOffer. The later
          // publish-offer operation owns the UNPUBLISHED -> PUBLISHED transition.
          return asJson({ offerId: offer.offerId, listingId: null, payload: offer.payload, sku: offer.sku });
        }
        if (offer.status !== 'PUBLISHED' || offer.listingId !== frozenListingId || offer.lifecycleClass !== 'active') {
          throw new Error(`Variation listing new offer ${child.sku} after-state is invalid.`);
        }
        // A published state is only acceptable after this child-offer operation
        // was already durably completed with the same offer identity. This lets
        // later resumes pass after publishOffer without adopting a foreign offer.
        if (latestOfferRow?.state !== 'confirmed_complete') {
          throw new Error(`Variation listing new offer ${child.sku} became published before its create operation was durably confirmed.`);
        }
        const durableOfferId = activeString(
          activeObjectEvidence(latestOfferRow.evidence, `offer operation ${offerOperationKey}`).offerId,
          `offer operation ${offerOperationKey} offerId`
        );
        if (durableOfferId !== offer.offerId) {
          throw new Error(`Variation listing new offer ${child.sku} durable offer ID drifted.`);
        }
        return asJson({ offerId: offer.offerId, listingId: offer.listingId, payload: offer.payload, sku: offer.sku });
      }
      if (!priorOfferId) throw new Error(`Variation listing existing offer ${child.sku} has no frozen offer ID.`);
      return activeOffer(read, child.offer, offerIdentity, 'PUBLISHED', true);
    };
    const offerPre = async (): Promise<Json | null> => {
      const read = await input.remote.getOffers(child.sku, child.offer.marketplaceId);
      if (!existed) {
        if (read.state === 'unknown') throw new Error(`Variation listing new offer ${child.sku} pre-state is unknown: ${read.reason}`);
        if (read.state === 'proven_absent' || read.value.length === 0) return { absent: true, sku: child.sku };
        throw new Error(`Variation listing new offer ${child.sku} must be absent before create.`);
      }
      if (!priorOfferId) throw new Error(`Variation listing existing offer ${child.sku} has no frozen offer ID.`);
      return activeOffer(read, priorChild ? previousBundle.children.find((candidate) => candidate.variationId === child.variationId)!.offer : child.offer, offerIdentity, 'PUBLISHED', true);
    };
    const offerMutate = async (): Promise<void> => {
      if (existed) {
        await requireActiveMethod(input.mutations, 'updateOffer')(priorOfferId, asJson(child.offer));
      } else {
        const created = await input.mutations.createOffer(asJson(child.offer));
        if (!created.offerId || typeof created.offerId !== 'string') throw new Error(`Variation listing new offer ${child.sku} create returned no offerId.`);
        returnedOfferId = created.offerId;
      }
    };
    await executeActiveOperation(input, history, offerOperationKey, offerAfter, offerPre, offerMutate);
    if (!existed) {
      const terminalOfferRow = activeLatest(history.get(offerOperationKey)!);
      if (terminalOfferRow?.state !== 'confirmed_complete' || terminalOfferRow.observed_remote_state !== 'present') {
        throw new Error(`Variation listing new offer ${child.sku} lacks a durable confirmed offer identity.`);
      }
      const durableOfferId = activeString(
        activeObjectEvidence(terminalOfferRow.evidence, `offer operation ${offerOperationKey}`).offerId,
        `offer operation ${offerOperationKey} offerId`
      );
      newOfferIdsByVariation.set(child.variationId, durableOfferId);
    }
  }

  const groupPre = async (): Promise<Json | null> => activeGroup(await input.remote.getInventoryItemGroup(desiredBundle.groupKey), previousBundle.group);
  const groupAfter = async (): Promise<Json | null> => activeGroup(await input.remote.getInventoryItemGroup(desiredBundle.groupKey), desiredBundle.group);
  await executeActiveOperation(input, history, 'complete-group', groupAfter, groupPre, () => input.mutations.createOrReplaceInventoryItemGroup(desiredBundle.groupKey, asJson(desiredBundle.group)));

  const newChildren = desiredBundle.children.filter((child) => !previousByVariation.has(child.variationId));
  for (const child of newChildren) {
    const offerId = newOfferIdsByVariation.get(child.variationId);
    if (!offerId) throw new Error(`Variation listing publish offer ${child.sku} has no durable created offer ID.`);
    const operationKey = `publish-offer:${child.variationId}`;
    const identifyOffer = async (status: 'UNPUBLISHED' | 'PUBLISHED'): Promise<Json | null> => {
      const read = await input.remote.getOffers(child.sku, child.offer.marketplaceId);
      if (read.state === 'unknown') throw new Error(`Variation listing publish offer ${child.sku} read is unknown: ${read.reason}`);
      if (read.state === 'proven_absent' || read.value.length === 0) return null;
      if (read.value.length !== 1) throw new Error(`Variation listing publish offer ${child.sku} must have exactly one offer.`);
      const offer = read.value[0];
      if (offer.offerId !== offerId || offer.sku !== child.sku || offer.marketplaceId !== child.offer.marketplaceId) throw new Error(`Variation listing publish offer ${child.sku} identity/state mismatch.`);
      if (status === 'PUBLISHED') {
        if (offer.status === 'UNPUBLISHED' && offer.listingId === null && canonicalJson(offer.payload) === canonicalJson(asJson(child.offer))) return null;
        if (offer.status !== 'PUBLISHED' || offer.listingId !== frozenListingId || offer.lifecycleClass !== 'active') throw new Error(`Variation listing publish offer ${child.sku} identity/state mismatch.`);
      } else if (offer.status !== 'UNPUBLISHED' || offer.listingId !== null) {
        throw new Error(`Variation listing publish offer ${child.sku} identity/state mismatch.`);
      }
      if (canonicalJson(offer.payload) !== canonicalJson(asJson(child.offer))) {
        if (status === 'PUBLISHED') return null;
        throw new Error(`Variation listing publish offer ${child.sku} payload mismatch.`);
      }
      return asJson({ offerId: offer.offerId, listingId: offer.listingId, sku: offer.sku });
    };
    const pre = async (): Promise<Json | null> => await identifyOffer('UNPUBLISHED');
    const after = async (): Promise<Json | null> => await identifyOffer('PUBLISHED');
    const mutate = async (): Promise<void> => {
      const read = await identifyOffer('UNPUBLISHED');
      if (read === null) throw new Error(`Variation listing publish offer ${child.sku} is absent before publish.`);
      const result = await requireActiveMethod(input.mutations, 'publishOffer')(offerId);
      if (!result.listingId || result.listingId !== frozenListingId) throw new Error(`Variation listing publish offer ${child.sku} returned a different listing ID.`);
    };
    await executeActiveOperation(input, history, operationKey, after, pre, mutate);
  }

  // Final exact aggregate read is the sole confirmation gate.
  const finalGroup = await input.remote.getInventoryItemGroup(desiredBundle.groupKey);
  if (activeGroup(finalGroup, desiredBundle.group) === null) throw new Error('Variation listing final group is absent.');
  const listingIds = new Set<string>();
  for (const child of desiredBundle.children) {
    if (activeItem(await input.remote.getInventoryItem(child.sku), child, desiredBundle.groupKey, true) === null) throw new Error(`Variation listing final item ${child.sku} is absent.`);
    const prior = previousByVariation.has(child.variationId);
    const offerId = prior ? priorOfferIds[child.sku] : newOfferIdsByVariation.get(child.variationId) ?? null;
    if (!offerId) throw new Error(`Variation listing final offer ${child.sku} has no durable offer ID.`);
    const read = await input.remote.getOffers(child.sku, child.offer.marketplaceId);
    const evidence = activeOffer(read, child.offer, { offerId, listingId: frozenListingId }, 'PUBLISHED', true);
    if (!evidence) throw new Error(`Variation listing final offer ${child.sku} is absent.`);
    listingIds.add(frozenListingId);
  }
  if (listingIds.size !== 1) throw new Error('Variation listing final reconciliation does not resolve one listing ID.');

  const reconcileKey = 'revision-reconcile';
  const reconcileRows = history.get(reconcileKey)!;
  const reconcileLatest = activeLatest(reconcileRows);
  const reconcileEvidence = asJson({
    listingId: frozenListingId,
    skus: desiredBundle.children.map((child) => child.sku),
  });
  if (!reconcileLatest) {
    await activeAppend(input, history, reconcileKey, 'started', 1, 1, {});
    await activeAppend(input, history, reconcileKey, 'confirmed_complete', 1, 2, reconcileEvidence, 'present');
  } else if (reconcileLatest.state === 'started') {
    await activeAppend(input, history, reconcileKey, 'confirmed_complete', reconcileLatest.attempt_number, reconcileLatest.checkpoint_number + 1, reconcileEvidence, 'present');
  } else if (reconcileLatest.state === 'unknown' || reconcileLatest.observed_remote_state === 'unknown') {
    await activeAppend(input, history, reconcileKey, 'confirmed_complete', reconcileLatest.attempt_number + 1, 1, reconcileEvidence, 'present');
  } else if (reconcileLatest.state === 'retry_authorized' || reconcileLatest.state === 'retry_exhausted') {
    throw new Error('Variation listing final reconciliation has invalid retry state.');
  }

  const current = await input.transaction.loadAggregate(input.frozen.captureInput.groupId);
  if (!current) throw new Error('Variation listing group disappeared before active revision confirmation.');
  if (current.group.desired_revision < input.frozen.captureInput.capturedDesiredRevision) {
    throw new Error('Variation listing active revision desired revision regressed before confirmation.');
  }
  // A prior invocation may already have committed this exact revision after
  // remote reconciliation. Return idempotently before enforcing the frozen
  // prior-watermark CAS (which is necessarily stale in that case).
  if (current.group.last_confirmed_revision === input.frozen.captureInput.capturedDesiredRevision) {
    if (current.group.lifecycle_state !== 'active') throw new Error('Variation listing active revision watermark is confirmed in an invalid lifecycle.');
    return {
      confirmedRevision: input.frozen.captureInput.capturedDesiredRevision,
      listingId: frozenListingId,
      revisionId: input.frozen.captureInput.revisionId,
    };
  }
  if (current.group.last_confirmed_revision !== input.frozen.snapshot.aggregate.group.last_confirmed_revision) {
    throw new Error('Variation listing active revision confirmation conflicts with a newer confirmed watermark.');
  }
  const confirmed = await input.transaction.confirmRevision({
    confirmedRevision: input.frozen.captureInput.capturedDesiredRevision,
    expectedPreviousConfirmedRevision: input.frozen.snapshot.aggregate.group.last_confirmed_revision,
    groupId: input.frozen.captureInput.groupId,
  });
  if (confirmed.last_confirmed_revision !== input.frozen.captureInput.capturedDesiredRevision || confirmed.group_id !== input.frozen.captureInput.groupId || confirmed.desired_revision < input.frozen.captureInput.capturedDesiredRevision || confirmed.lifecycle_state !== 'active') {
    throw new Error('Variation listing active revision confirmation did not preserve expected lifecycle/watermarks.');
  }
  return {
    confirmedRevision: input.frozen.captureInput.capturedDesiredRevision,
    listingId: frozenListingId,
    revisionId: input.frozen.captureInput.revisionId,
  };
}

export const executeVariationListingActiveRevisionPublication = executeVariationListingActiveRevision;
