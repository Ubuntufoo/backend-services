import { createHash, randomUUID } from 'node:crypto';

import { inspectVariationListingJournal } from '@ebay-inventory/data';
import type {
  CaptureVariationListingRevisionInput,
  Json,
  VariationListingAggregateSnapshot,
  VariationListingGroupRow,
  VariationListingPublishingCheckpointRow,
  VariationListingRevisionRow,
  VariationListingRevisionPlanOperation,
  VariationListingRevisionPlanOperationInput,
  VariationListingTransactionGateway,
} from '@ebay-inventory/data';

import type { VariationListingInventoryPayloadBundle } from '@/ebay/variation-listing-payloads.js';
import type {
  VariationListingPublicationReadGateway,
  VariationListingRemoteGroup,
  VariationListingRemoteInventoryItem,
  VariationListingRemoteOffer,
} from '@/ebay/variation-listing-publication.js';

const CLEANUP_PLAN_VERSION = 1;
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

function asJson<T>(value: T): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

function groupPayloadWithoutMembership(payload: Json): Json {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const { variantSKUs: _variantSKUs, ...rest } = payload as Record<string, Json>;
  return rest;
}

function sameMembership(left: readonly string[], right: readonly string[]): boolean {
  if (new Set(left).size !== left.length || new Set(right).size !== right.length || left.length !== right.length) return false;
  const set = new Set(left);
  return right.every((value) => set.has(value));
}

function operation(input: {
  kind: 'withdrawal' | 'cleanup_offer' | 'cleanup_group' | 'cleanup_child_inventory_item' | 'final_absence_verification';
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

export type VariationListingCleanupProtection =
  | { state: 'clear' }
  | { state: 'protected'; variationIds: string[] }
  | { state: 'unknown'; reason: string };

export interface VariationListingCleanupOwnedRemoteIdentity {
  listingId: string | null;
  offerIdsBySku: Record<string, string>;
  publicationHistoryExists: boolean;
}

export interface VariationListingCleanupObservedState {
  activeListingId: string | null;
  groupPresent: boolean;
  itemPresentSkus: string[];
  offerPresentSkus: string[];
  state: 'absent' | 'active' | 'inactive-or-unpublished';
}

export interface VariationListingCleanupSnapshot {
  planVersion: 1;
  groupKey: string;
  marketplaceId: string;
  /** Complete historical payloads are frozen solely to make resumed exact
   * ownership reads possible. Media is intentionally not part of this plan. */
  ownedPayloadBundles: Json[];
  orderedSkus: string[];
  ownedRemote: VariationListingCleanupOwnedRemoteIdentity;
  observed: VariationListingCleanupObservedState;
  terminalLifecycle: 'abandoned' | 'terminal-absent';
}

export interface VariationListingFrozenCleanupPlan {
  snapshot: VariationListingCleanupSnapshot;
  snapshotDigest: string;
  operationPlan: VariationListingRevisionPlanOperationInput[];
}

export interface PrepareVariationListingCleanupPlanInput {
  /** Chronological exact owned payload states, oldest to newest. The newest
   * bundle owns the complete current application SKU set; older bundles may
   * differ in price/quantity/images or contain a subset before later additions. */
  ownedBundles: readonly VariationListingInventoryPayloadBundle[];
  ownedRemote: VariationListingCleanupOwnedRemoteIdentity;
  protection: VariationListingCleanupProtection;
  remote: VariationListingPublicationReadGateway;
}

function requireCleanupProtectionClear(protection: VariationListingCleanupProtection): void {
  if (protection.state === 'unknown') {
    throw new Error(`Variation listing cleanup sale/order protection is unknown: ${protection.reason}`);
  }
  if (protection.state === 'protected') {
    throw new Error(`Variation listing cleanup is blocked by protected variation history: ${protection.variationIds.join(', ')}`);
  }
}

function validateOwnedBundles(bundles: readonly VariationListingInventoryPayloadBundle[]): {
  groupKey: string;
  marketplaceId: string;
  orderedSkus: string[];
} {
  if (bundles.length === 0) throw new Error('Variation listing cleanup requires at least one exact owned payload bundle.');
  const newest = bundles.at(-1)!;
  const orderedSkus = newest.children.map((child) => child.sku);
  if (new Set(orderedSkus).size !== orderedSkus.length) throw new Error('Variation listing cleanup newest bundle contains duplicate SKUs.');
  const newestSkuSet = new Set(orderedSkus);
  const marketplaceId = newest.children[0]?.offer.marketplaceId;
  if (!marketplaceId) throw new Error('Variation listing cleanup bundle has no marketplace identity.');

  for (const bundle of bundles) {
    if (bundle.groupKey !== newest.groupKey) throw new Error('Variation listing cleanup bundles disagree on group key.');
    const skus = bundle.children.map((child) => child.sku);
    if (new Set(skus).size !== skus.length) throw new Error('Variation listing cleanup bundle contains duplicate SKUs.');
    if (skus.some((sku) => !newestSkuSet.has(sku))) {
      throw new Error('Variation listing cleanup historical bundle contains a SKU absent from the newest owned bundle.');
    }
    if (bundle.children.some((child) => child.offer.marketplaceId !== marketplaceId)) {
      throw new Error('Variation listing cleanup bundles disagree on marketplace identity.');
    }
  }
  return { groupKey: newest.groupKey, marketplaceId, orderedSkus };
}

function validateOwnedRemoteIdentity(
  identity: VariationListingCleanupOwnedRemoteIdentity,
  orderedSkus: readonly string[]
): void {
  const expected = new Set(orderedSkus);
  const keys = Object.keys(identity.offerIdsBySku);
  if (keys.some((sku) => !expected.has(sku))) {
    throw new Error('Variation listing cleanup durable offer identities must not include foreign SKUs.');
  }
  const offerIds = keys.map((sku) => identity.offerIdsBySku[sku]);
  if (offerIds.some((offerId) => typeof offerId !== 'string' || offerId.trim() === '') || new Set(offerIds).size !== offerIds.length) {
    throw new Error('Variation listing cleanup durable offer identities must be unique non-empty strings.');
  }
  if (identity.publicationHistoryExists && (!identity.listingId || identity.listingId.trim() === '')) {
    throw new Error('Variation listing cleanup publication history requires its durable listing identity.');
  }
  if (!identity.publicationHistoryExists && identity.listingId !== null) {
    throw new Error('Variation listing cleanup unpublished history cannot carry a listing identity.');
  }
}

function candidateChildren(
  bundles: readonly VariationListingInventoryPayloadBundle[],
  sku: string
): VariationListingInventoryPayloadBundle['children'] {
  return bundles.flatMap((bundle) => bundle.children.filter((child) => child.sku === sku));
}

function exactOwnedItem(
  item: VariationListingRemoteInventoryItem,
  sku: string,
  groupKey: string,
  candidates: VariationListingInventoryPayloadBundle['children']
): void {
  if (item.sku !== sku) throw new Error(`Variation listing cleanup item ${sku} identity mismatch.`);
  if (item.groupKeys !== null && (item.groupKeys.length !== 1 || item.groupKeys[0] !== groupKey)) {
    throw new Error(`Variation listing cleanup item ${sku} has foreign group association.`);
  }
  if (!candidates.some((child) => canonicalJson(item.payload) === canonicalJson(asJson(child.inventoryItem)))) {
    throw new Error(`Variation listing cleanup item ${sku} does not match an exact owned payload state.`);
  }
}

function exactOwnedOffer(
  offer: VariationListingRemoteOffer,
  sku: string,
  marketplaceId: string,
  expectedOfferId: string | undefined,
  ownedListingId: string | null,
  candidates: VariationListingInventoryPayloadBundle['children']
): void {
  if (offer.sku !== sku || offer.marketplaceId !== marketplaceId) {
    throw new Error(`Variation listing cleanup offer ${sku} ownership mismatch.`);
  }
  if (!expectedOfferId || offer.offerId !== expectedOfferId) {
    throw new Error(`Variation listing cleanup offer ${sku} does not match its durable owned offer ID.`);
  }
  if (!candidates.some((child) => canonicalJson(offer.payload) === canonicalJson(asJson(child.offer)))) {
    throw new Error(`Variation listing cleanup offer ${sku} does not match an exact owned payload state.`);
  }
  if (offer.lifecycleClass === 'ambiguous') {
    throw new Error(`Variation listing cleanup offer ${sku} has ambiguous lifecycle evidence.`);
  }
  if (offer.status === 'PUBLISHED') {
    if (!offer.listingId || !ownedListingId || offer.listingId !== ownedListingId) {
      throw new Error(`Variation listing cleanup offer ${sku} has conflicting published listing identity.`);
    }
    if (offer.lifecycleClass !== 'active' && offer.lifecycleClass !== 'ended' && offer.lifecycleClass !== 'not-listed') {
      throw new Error(`Variation listing cleanup offer ${sku} has unsupported published lifecycle evidence.`);
    }
  } else {
    if (offer.listingId !== null || offer.lifecycleClass !== null) {
      throw new Error(`Variation listing cleanup offer ${sku} has conflicting unpublished lifecycle evidence.`);
    }
  }
}

export async function prepareVariationListingCleanupPlan(
  input: PrepareVariationListingCleanupPlanInput
): Promise<VariationListingFrozenCleanupPlan> {
  requireCleanupProtectionClear(input.protection);
  const { groupKey, marketplaceId, orderedSkus } = validateOwnedBundles(input.ownedBundles);
  validateOwnedRemoteIdentity(input.ownedRemote, orderedSkus);
  const newest = input.ownedBundles.at(-1)!;
  const orderedSkuSet = new Set(orderedSkus);

  const groupRead = await input.remote.getInventoryItemGroup(groupKey);
  if (groupRead.state === 'unknown') throw new Error(`Variation listing cleanup group read is unknown: ${groupRead.reason}`);
  let matchedGroupSkus: string[] = [];
  if (groupRead.state === 'present') {
    const matchingBundle = input.ownedBundles.find((bundle) =>
      sameMembership(groupRead.value.variantSKUs, bundle.group.variantSKUs) &&
      canonicalJson(groupPayloadWithoutMembership(groupRead.value.payload)) === canonicalJson(groupPayloadWithoutMembership(asJson(bundle.group)))
    );
    if (!matchingBundle) throw new Error('Variation listing cleanup group does not match any exact owned complete-group state.');
    if (groupRead.value.variantSKUs.some((sku) => !orderedSkuSet.has(sku))) {
      throw new Error('Variation listing cleanup group contains a foreign SKU.');
    }
    matchedGroupSkus = [...matchingBundle.group.variantSKUs];
  }

  const itemPresentSkus: string[] = [];
  const offerPresentSkus: string[] = [];
  const itemsBySku = new Map<string, VariationListingRemoteInventoryItem>();
  const offersBySku = new Map<string, VariationListingRemoteOffer>();

  for (const sku of orderedSkus) {
    const candidates = candidateChildren(input.ownedBundles, sku);
    if (candidates.length === 0) throw new Error(`Variation listing cleanup has no owned payload candidate for ${sku}.`);

    const itemRead = await input.remote.getInventoryItem(sku);
    if (itemRead.state === 'unknown') throw new Error(`Variation listing cleanup item ${sku} read is unknown: ${itemRead.reason}`);
    if (itemRead.state === 'present') {
      exactOwnedItem(itemRead.value, sku, groupKey, candidates);
      itemPresentSkus.push(sku);
      itemsBySku.set(sku, itemRead.value);
    }

    const offerRead = await input.remote.getOffers(sku, marketplaceId);
    if (offerRead.state === 'unknown') throw new Error(`Variation listing cleanup offer ${sku} read is unknown: ${offerRead.reason}`);
    if (offerRead.state === 'present' && offerRead.value.length > 1) {
      throw new Error(`Variation listing cleanup SKU ${sku} has duplicate offers.`);
    }
    const offer = offerRead.state === 'present' ? offerRead.value[0] : undefined;
    if (offer) {
      exactOwnedOffer(
        offer,
        sku,
        marketplaceId,
        input.ownedRemote.offerIdsBySku[sku],
        input.ownedRemote.listingId,
        candidates
      );
      offersBySku.set(sku, offer);
      offerPresentSkus.push(sku);
    }
  }

  const activeOffers = [...offersBySku.values()].filter((offer) => offer.status === 'PUBLISHED' && offer.lifecycleClass === 'active');
  const publishedInactiveOffers = [...offersBySku.values()].filter((offer) => offer.status === 'PUBLISHED' && offer.lifecycleClass !== 'active');
  let activeListingId: string | null = null;
  if (activeOffers.length > 0) {
    if (publishedInactiveOffers.length > 0) {
      throw new Error('Variation listing cleanup found incompatible active and inactive published offer lifecycles.');
    }
    const listingIds = new Set(activeOffers.map((offer) => offer.listingId));
    if (listingIds.size !== 1 || !input.ownedRemote.listingId || !listingIds.has(input.ownedRemote.listingId)) {
      throw new Error('Variation listing cleanup active offers do not resolve to the durable owned listing ID.');
    }
    if (groupRead.state !== 'present') {
      throw new Error('Variation listing cleanup cannot withdraw active offers without the exact owned group.');
    }
    activeListingId = input.ownedRemote.listingId;
    const activeGroupSet = new Set(matchedGroupSkus);
    for (const sku of matchedGroupSkus) {
      const offer = offersBySku.get(sku);
      if (!offer || offer.status !== 'PUBLISHED' || offer.lifecycleClass !== 'active' || offer.listingId !== activeListingId) {
        throw new Error(`Variation listing cleanup active group member ${sku} is not one exact active owned offer.`);
      }
      const item = itemsBySku.get(sku);
      if (!item || item.groupKeys === null || item.groupKeys.length !== 1 || item.groupKeys[0] !== groupKey) {
        throw new Error(`Variation listing cleanup active group member ${sku} is missing its exact owned inventory item.`);
      }
    }
    for (const [sku, offer] of offersBySku) {
      if (!activeGroupSet.has(sku) && offer.status === 'PUBLISHED') {
        throw new Error(`Variation listing cleanup staged SKU ${sku} unexpectedly has a published offer.`);
      }
    }
  }

  if ((activeOffers.length > 0 || publishedInactiveOffers.length > 0) && !input.ownedRemote.publicationHistoryExists) {
    throw new Error('Variation listing cleanup found published remote state without durable publication history.');
  }
  if (groupRead.state === 'present' && input.ownedRemote.publicationHistoryExists &&
      activeOffers.length === 0 && publishedInactiveOffers.length === 0) {
    throw new Error('Variation listing cleanup cannot classify a historically published group without definitive offer lifecycle evidence.');
  }

  const groupPresent = groupRead.state === 'present';
  const anyRemote = groupPresent || itemPresentSkus.length > 0 || offerPresentSkus.length > 0;
  const observedState: VariationListingCleanupObservedState['state'] = !anyRemote
    ? 'absent'
    : activeOffers.length > 0
      ? 'active'
      : 'inactive-or-unpublished';
  const terminalLifecycle = input.ownedRemote.publicationHistoryExists ? 'terminal-absent' : 'abandoned';

  const snapshot: VariationListingCleanupSnapshot = {
    planVersion: CLEANUP_PLAN_VERSION,
    groupKey,
    marketplaceId,
    ownedPayloadBundles: input.ownedBundles.map((bundle) => asJson(bundle)),
    orderedSkus,
    ownedRemote: structuredClone(input.ownedRemote),
    observed: {
      activeListingId,
      groupPresent,
      itemPresentSkus,
      offerPresentSkus,
      state: observedState,
    },
    terminalLifecycle,
  };

  const operationPlan: VariationListingRevisionPlanOperationInput[] = [];
  let sequenceNo = 1;
  if (activeListingId) {
    operationPlan.push(operation({
      sequenceNo: sequenceNo++,
      key: 'withdraw-group',
      kind: 'withdrawal',
      targetRef: groupKey,
      intent: asJson({ groupKey, listingId: activeListingId, marketplaceId }),
    }));
  }

  for (const sku of [...orderedSkus].reverse()) {
    if (!offerPresentSkus.includes(sku)) continue;
    const offerId = input.ownedRemote.offerIdsBySku[sku];
    if (!offerId) throw new Error(`Variation listing cleanup offer ${sku} lacks durable owned identity.`);
    operationPlan.push(operation({
      sequenceNo: sequenceNo++,
      key: `cleanup-offer:${sku}`,
      kind: 'cleanup_offer',
      targetRef: offerId,
      intent: asJson({ offerId, sku }),
    }));
  }

  if (groupPresent) {
    operationPlan.push(operation({
      sequenceNo: sequenceNo++,
      key: 'cleanup-group',
      kind: 'cleanup_group',
      targetRef: groupKey,
      intent: asJson({ groupKey }),
    }));
  }

  for (const sku of [...orderedSkus].reverse()) {
    if (!itemPresentSkus.includes(sku)) continue;
    operationPlan.push(operation({
      sequenceNo: sequenceNo++,
      key: `cleanup-item:${sku}`,
      kind: 'cleanup_child_inventory_item',
      targetRef: sku,
      intent: asJson({ sku }),
    }));
  }

  operationPlan.push(operation({
    sequenceNo,
    key: 'final-absence',
    kind: 'final_absence_verification',
    targetRef: groupKey,
    intent: asJson({
      groupKey,
      marketplaceId,
      offerIdsBySku: input.ownedRemote.offerIdsBySku,
      orderedSkus,
      terminalLifecycle,
    }),
  }));

  const snapshotJson = asJson(snapshot);
  return {
    snapshot,
    snapshotDigest: digestJson(snapshotJson),
    operationPlan,
  };
}

export interface VariationListingFrozenCleanupRevision {
  captureInput: CaptureVariationListingRevisionInput;
  expectedPreviousConfirmedRevision: number | null;
  plan: VariationListingFrozenCleanupPlan;
}

export function freezeVariationListingCleanupRevision(input: {
  capturedDesiredRevision: number;
  expectedPreviousConfirmedRevision: number | null;
  groupId: string;
  plan: VariationListingFrozenCleanupPlan;
  revisionId: string;
}): VariationListingFrozenCleanupRevision {
  if (!Number.isInteger(input.capturedDesiredRevision) || input.capturedDesiredRevision < 1) {
    throw new Error('Variation listing cleanup captured desired revision must be positive.');
  }
  return {
    captureInput: {
      capturedDesiredRevision: input.capturedDesiredRevision,
      groupId: input.groupId,
      operationPlan: input.plan.operationPlan,
      revisionId: input.revisionId,
      snapshot: asJson(input.plan.snapshot),
      snapshotDigest: input.plan.snapshotDigest,
      snapshotVersion: CLEANUP_PLAN_VERSION,
    },
    expectedPreviousConfirmedRevision: input.expectedPreviousConfirmedRevision,
    plan: input.plan,
  };
}

export interface VariationListingCleanupMutationGateway {
  deleteInventoryItem(sku: string): Promise<void>;
  deleteInventoryItemGroup(groupKey: string): Promise<void>;
  deleteOffer(offerId: string): Promise<void>;
  withdrawInventoryItemGroup(groupKey: string): Promise<void>;
}

export interface VariationListingCleanupJournalReader {
  listCheckpoints(revisionId: string): Promise<VariationListingPublishingCheckpointRow[]>;
  loadRevision(revisionId: string): Promise<VariationListingRevisionRow | null>;
}

export interface VariationListingCleanupLifecycleTransitionInput {
  expectedDesiredRevision: number;
  expectedPreviousConfirmedRevision: number | null;
  groupId: string;
  revisionId: string;
  targetLifecycle: 'withdrawn' | 'cleanup' | 'abandoned' | 'terminal-absent';
}

export interface AbandonUntouchedVariationListingGroupInput {
  expectedDesiredRevision: 0;
  groupId: string;
}

export interface VariationListingUntouchedAbandonmentInput {
  groupId: string;
  protection: VariationListingCleanupProtection;
  remote: Pick<VariationListingPublicationReadGateway, 'getInventoryItemGroup'>;
  transaction: Pick<VariationListingTransactionGateway, 'loadAggregate' | 'abandonUntouchedGroup'>;
}

/**
 * Untouched groups are the one cleanup case that intentionally does not use a
 * frozen revision. The publishing journal only accepts positive desired
 * revisions, while a just-created, never-allocated group is revision 0. There
 * is no remote mutation to recover: exact group-key absence is read first,
 * then a narrow CAS RPC may mark only a truly empty/unarmed revision-0 group
 * abandoned. Publication revision semantics remain unchanged.
 */
export async function abandonUntouchedVariationListingGroup(
  input: VariationListingUntouchedAbandonmentInput
): Promise<VariationListingGroupRow> {
  requireCleanupProtectionClear(input.protection);
  const aggregate = await input.transaction.loadAggregate(input.groupId);
  if (!aggregate) throw new Error('Variation listing untouched abandonment group was not found.');
  const group = aggregate.group;
  if (
    group.desired_revision !== 0 ||
    group.last_confirmed_revision !== null ||
    group.lifecycle_state !== 'intake' ||
    group.next_inventory_serial !== 1 ||
    aggregate.variations.length !== 0 ||
    aggregate.copies.length !== 0
  ) {
    throw new Error('Variation listing untouched abandonment requires an empty revision-0 intake group.');
  }
  const remoteGroup = await input.remote.getInventoryItemGroup(group.group_key);
  if (remoteGroup.state === 'unknown') {
    throw new Error(`Variation listing untouched abandonment remote group read is unknown: ${remoteGroup.reason}`);
  }
  if (remoteGroup.state === 'present') {
    throw new Error('Variation listing untouched abandonment requires exact remote group absence.');
  }
  const abandoned = await input.transaction.abandonUntouchedGroup({
    expectedDesiredRevision: 0,
    groupId: input.groupId,
  });
  if (
    abandoned.group_id !== input.groupId ||
    abandoned.group_key !== group.group_key ||
    abandoned.desired_revision !== 0 ||
    abandoned.last_confirmed_revision !== null ||
    abandoned.lifecycle_state !== 'abandoned'
  ) {
    throw new Error('Variation listing untouched abandonment durable response parity mismatch.');
  }
  return abandoned;
}

export interface VariationListingCleanupExecutionInput {
  frozen: VariationListingFrozenCleanupRevision;
  journal: VariationListingCleanupJournalReader;
  mutations: VariationListingCleanupMutationGateway;
  remote: VariationListingPublicationReadGateway;
  transaction: Pick<
    VariationListingTransactionGateway,
    'appendJournalCheckpoint' | 'captureRevision' | 'loadAggregate'
  > & {
    advanceCleanupLifecycle(input: VariationListingCleanupLifecycleTransitionInput): Promise<VariationListingGroupRow>;
  };
  checkpointId?: () => string;
}

export interface VariationListingCleanupExecutionResult {
  lifecycleState: 'abandoned' | 'terminal-absent';
  revisionId: string;
}

type CleanupCheckpointState =
  | 'started'
  | 'unknown'
  | 'retry_authorized'
  | 'retry_exhausted'
  | 'confirmed_complete'
  | 'confirmed_no_op';
type CleanupHistory = Map<string, VariationListingPublishingCheckpointRow[]>;
type CleanupEvidence = { evidence: Json; observed: 'present' | 'proven_absent' };

function cleanupLatest(rows: readonly VariationListingPublishingCheckpointRow[]): VariationListingPublishingCheckpointRow | null {
  return [...rows].sort((a, b) => a.attempt_number - b.attempt_number || a.checkpoint_number - b.checkpoint_number).at(-1) ?? null;
}

function cleanupTerminal(row: VariationListingPublishingCheckpointRow | null): boolean {
  return row?.state === 'confirmed_complete' || row?.state === 'confirmed_no_op' || row?.state === 'retry_exhausted';
}

function cleanupErrorEvidence(error: unknown): Json {
  return { error: error instanceof Error ? error.message : String(error) };
}

function cleanupBundles(snapshot: VariationListingCleanupSnapshot): VariationListingInventoryPayloadBundle[] {
  if (!Array.isArray(snapshot.ownedPayloadBundles) || snapshot.ownedPayloadBundles.length === 0) {
    throw new Error('Variation listing cleanup frozen snapshot has no owned payload bundles.');
  }
  return snapshot.ownedPayloadBundles as unknown as VariationListingInventoryPayloadBundle[];
}

function cleanupOperation(
  frozen: VariationListingFrozenCleanupRevision,
  key: string
): VariationListingRevisionPlanOperation {
  const operation = frozen.captureInput.operationPlan.find((candidate) => candidate.operationKey === key);
  if (!operation) throw new Error(`Variation listing frozen cleanup operation ${key} is missing.`);
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

function durableCleanupOperationPlan(frozen: VariationListingFrozenCleanupRevision): Json {
  return asJson(frozen.captureInput.operationPlan.map((operation) => ({
    intent: operation.intent,
    intent_digest: operation.intentDigest,
    intent_version: operation.intentVersion,
    operation_key: operation.operationKey,
    operation_kind: operation.operationKind,
    sequence_no: operation.sequenceNo,
    target_ref: operation.targetRef,
  })));
}

function cleanupHistory(
  frozen: VariationListingFrozenCleanupRevision,
  rows: readonly VariationListingPublishingCheckpointRow[]
): CleanupHistory {
  const plan = frozen.captureInput.operationPlan;
  const allowed = new Set(plan.map((operation) => operation.operationKey));
  const result: CleanupHistory = new Map(plan.map((operation) => [operation.operationKey, []]));
  for (const row of rows) {
    if (row.revision_id !== frozen.captureInput.revisionId || !allowed.has(row.operation_key)) {
      throw new Error('Variation listing cleanup journal history does not belong to its frozen revision.');
    }
    result.get(row.operation_key)!.push(row);
  }
  for (const operationInput of plan) {
    const operation = cleanupOperation(frozen, operationInput.operationKey);
    const ordered = [...result.get(operation.operation_key)!].sort(
      (a, b) => a.attempt_number - b.attempt_number || a.checkpoint_number - b.checkpoint_number
    );
    inspectVariationListingJournal(operation, ordered);
    for (const [index, row] of ordered.entries()) {
      if (row.evidence === null || typeof row.evidence !== 'object' || Array.isArray(row.evidence)) {
        throw new Error(`Variation listing cleanup operation ${operation.operation_key} has malformed evidence.`);
      }
      if (index === 0) {
        const readOnly = operation.operation_kind === 'final_absence_verification';
        if (row.attempt_number !== 1 || row.checkpoint_number !== 1 ||
          (row.state !== 'started' && !(readOnly && ['confirmed_complete', 'confirmed_no_op'].includes(row.state)))) {
          throw new Error(`Variation listing cleanup operation ${operation.operation_key} history must begin at 1/1.`);
        }
      } else {
        const previous = ordered[index - 1]!;
        const contiguous =
          (row.attempt_number === previous.attempt_number && row.checkpoint_number === previous.checkpoint_number + 1) ||
          (row.attempt_number === previous.attempt_number + 1 && row.checkpoint_number === 1);
        if (!contiguous || cleanupTerminal(previous)) {
          throw new Error(`Variation listing cleanup operation ${operation.operation_key} journal history is invalid.`);
        }
      }
      if (row.state === 'started' && row.observed_remote_state !== null) {
        throw new Error(`Variation listing cleanup operation ${operation.operation_key} started checkpoint cannot claim remote evidence.`);
      }
      if (row.state === 'unknown' && row.observed_remote_state !== 'unknown') {
        throw new Error(`Variation listing cleanup operation ${operation.operation_key} unknown checkpoint requires ambiguity evidence.`);
      }
      if (row.state !== 'started' && (row.observed_remote_state === null || Object.keys(row.evidence as Record<string, Json>).length === 0)) {
        throw new Error(`Variation listing cleanup operation ${operation.operation_key} resolved checkpoint requires evidence.`);
      }
    }
  }
  return result;
}

async function appendCleanupCheckpoint(
  input: VariationListingCleanupExecutionInput,
  history: CleanupHistory,
  operationKey: string,
  checkpoint: {
    attemptNumber: number;
    checkpointNumber: number;
    evidence: Json;
    observedRemoteState?: 'present' | 'proven_absent' | 'unknown';
    state: CleanupCheckpointState;
  }
): Promise<void> {
  if (checkpoint.evidence === null || typeof checkpoint.evidence !== 'object' || Array.isArray(checkpoint.evidence)) {
    throw new Error(`Variation listing cleanup operation ${operationKey} evidence must be an object.`);
  }
  const result = await input.transaction.appendJournalCheckpoint({
    attemptNumber: checkpoint.attemptNumber,
    checkpointId: (input.checkpointId ?? randomUUID)(),
    checkpointNumber: checkpoint.checkpointNumber,
    evidence: checkpoint.evidence,
    observedRemoteState: checkpoint.observedRemoteState,
    operationKey,
    revisionId: input.frozen.captureInput.revisionId,
    state: checkpoint.state,
  });
  history.get(operationKey)!.push(result.checkpoint);
}

interface CleanupOwnedRead {
  group: VariationListingRemoteGroup | null;
  items: Map<string, VariationListingRemoteInventoryItem>;
  offers: Map<string, VariationListingRemoteOffer>;
}

async function readCleanupOwnedState(
  snapshot: VariationListingCleanupSnapshot,
  remote: VariationListingPublicationReadGateway
): Promise<CleanupOwnedRead> {
  const bundles = cleanupBundles(snapshot);
  const groupRead = await remote.getInventoryItemGroup(snapshot.groupKey);
  if (groupRead.state === 'unknown') throw new Error(`Variation listing cleanup group read is unknown: ${groupRead.reason}`);
  let group: VariationListingRemoteGroup | null = null;
  if (groupRead.state === 'present') {
    const matching = bundles.find((bundle) =>
      sameMembership(groupRead.value.variantSKUs, bundle.group.variantSKUs) &&
      canonicalJson(groupPayloadWithoutMembership(groupRead.value.payload)) === canonicalJson(groupPayloadWithoutMembership(asJson(bundle.group)))
    );
    if (!matching || groupRead.value.variantSKUs.some((sku) => !snapshot.orderedSkus.includes(sku))) {
      throw new Error('Variation listing cleanup group is not an exact owned complete payload.');
    }
    group = groupRead.value;
  }
  const items = new Map<string, VariationListingRemoteInventoryItem>();
  const offers = new Map<string, VariationListingRemoteOffer>();
  for (const sku of snapshot.orderedSkus) {
    const candidates = candidateChildren(bundles, sku);
    const itemRead = await remote.getInventoryItem(sku);
    if (itemRead.state === 'unknown') throw new Error(`Variation listing cleanup item ${sku} read is unknown: ${itemRead.reason}`);
    if (itemRead.state === 'present') {
      exactOwnedItem(itemRead.value, sku, snapshot.groupKey, candidates);
      items.set(sku, itemRead.value);
    }
    const offerRead = await remote.getOffers(sku, snapshot.marketplaceId);
    if (offerRead.state === 'unknown') throw new Error(`Variation listing cleanup offer ${sku} read is unknown: ${offerRead.reason}`);
    if (offerRead.state === 'present' && offerRead.value.length > 1) {
      throw new Error(`Variation listing cleanup SKU ${sku} has duplicate offers.`);
    }
    const offer = offerRead.state === 'present' ? offerRead.value[0] : undefined;
    if (offer) {
      exactOwnedOffer(offer, sku, snapshot.marketplaceId, snapshot.ownedRemote.offerIdsBySku[sku], snapshot.ownedRemote.listingId, candidates);
      offers.set(sku, offer);
    }
  }
  return { group, items, offers };
}

function absentEvidence(label: string, identity: string): CleanupEvidence {
  return { evidence: asJson({ [label]: identity, state: 'proven_absent' }), observed: 'proven_absent' };
}

async function runCleanupMutation(
  input: VariationListingCleanupExecutionInput,
  history: CleanupHistory,
  operationKey: string,
  after: () => Promise<CleanupEvidence | null>,
  pre: () => Promise<CleanupEvidence | null>,
  mutate: () => Promise<void>
): Promise<void> {
  const rows = history.get(operationKey)!;
  let current = cleanupLatest(rows);
  if (current?.state === 'retry_exhausted') {
    throw new Error(`Variation listing cleanup operation ${operationKey} exhausted its one bounded replay.`);
  }
  if (current && cleanupTerminal(current)) {
    if (await after() === null) throw new Error(`Variation listing cleanup operation ${operationKey} terminal evidence no longer reconciles exactly.`);
    return;
  }
  if (current?.state === 'started') {
    const reconciledAfter = await after();
    if (reconciledAfter) {
      await appendCleanupCheckpoint(input, history, operationKey, { attemptNumber: current.attempt_number, checkpointNumber: current.checkpoint_number + 1, evidence: reconciledAfter.evidence, observedRemoteState: reconciledAfter.observed, state: 'confirmed_complete' });
      return;
    }
    const exactPre = await pre();
    if (!exactPre) {
      await appendCleanupCheckpoint(input, history, operationKey, { attemptNumber: current.attempt_number, checkpointNumber: current.checkpoint_number + 1, evidence: asJson({ reason: 'Neither exact before nor exact after state is proven.' }), observedRemoteState: 'unknown', state: 'unknown' });
      throw new Error(`Variation listing cleanup operation ${operationKey} has unresolved started mutation.`);
    }
    await appendCleanupCheckpoint(input, history, operationKey, { attemptNumber: current.attempt_number, checkpointNumber: current.checkpoint_number + 1, evidence: asJson({ reason: 'Started mutation requires bounded retry reconciliation.', pre: exactPre.evidence }), observedRemoteState: 'unknown', state: 'unknown' });
    current = cleanupLatest(rows);
  }
  if (current?.state === 'unknown') {
    const reconciledAfter = await after();
    if (reconciledAfter) {
      await appendCleanupCheckpoint(input, history, operationKey, { attemptNumber: current.attempt_number + 1, checkpointNumber: 1, evidence: reconciledAfter.evidence, observedRemoteState: reconciledAfter.observed, state: 'confirmed_complete' });
      return;
    }
    const exactPre = await pre();
    const replayAlreadyAuthorized = rows.some((row) => row.state === 'retry_authorized');
    if (!exactPre) throw new Error(`Variation listing cleanup operation ${operationKey} is ambiguous after an unknown outcome.`);
    if (replayAlreadyAuthorized) {
      await appendCleanupCheckpoint(input, history, operationKey, { attemptNumber: current.attempt_number + 1, checkpointNumber: 1, evidence: exactPre.evidence, observedRemoteState: exactPre.observed, state: 'retry_exhausted' });
      throw new Error(`Variation listing cleanup operation ${operationKey} exhausted its one bounded replay.`);
    }
    await appendCleanupCheckpoint(input, history, operationKey, { attemptNumber: current.attempt_number + 1, checkpointNumber: 1, evidence: exactPre.evidence, observedRemoteState: exactPre.observed, state: 'retry_authorized' });
    current = cleanupLatest(rows);
  }
  if (current?.state === 'retry_authorized') {
    await appendCleanupCheckpoint(input, history, operationKey, { attemptNumber: current.attempt_number, checkpointNumber: current.checkpoint_number + 1, evidence: {}, state: 'started' });
    current = cleanupLatest(rows);
  }
  if (!current) {
    const alreadyAfter = await after();
    if (alreadyAfter) {
      // Mutation operations must begin with `started` in the durable journal
      // grammar even when an authoritative read proves the target is already
      // in its exact after-state. Record a started/no-op pair without issuing
      // the remote mutation so PostgreSQL and in-memory recovery semantics stay
      // identical.
      await appendCleanupCheckpoint(input, history, operationKey, { attemptNumber: 1, checkpointNumber: 1, evidence: {}, state: 'started' });
      await appendCleanupCheckpoint(input, history, operationKey, { attemptNumber: 1, checkpointNumber: 2, evidence: alreadyAfter.evidence, observedRemoteState: alreadyAfter.observed, state: 'confirmed_no_op' });
      return;
    }
    const exactPre = await pre();
    if (!exactPre) throw new Error(`Variation listing cleanup operation ${operationKey} pre-state is not exact.`);
    await appendCleanupCheckpoint(input, history, operationKey, { attemptNumber: 1, checkpointNumber: 1, evidence: {}, state: 'started' });
    current = cleanupLatest(rows);
  }
  if (current?.state !== 'started') throw new Error(`Variation listing cleanup operation ${operationKey} has invalid journal state.`);
  try {
    await mutate();
  } catch (error) {
    await appendCleanupCheckpoint(input, history, operationKey, { attemptNumber: current.attempt_number, checkpointNumber: current.checkpoint_number + 1, evidence: cleanupErrorEvidence(error), observedRemoteState: 'unknown', state: 'unknown' });
    throw error;
  }
  const exactAfter = await after();
  if (!exactAfter) {
    await appendCleanupCheckpoint(input, history, operationKey, { attemptNumber: current.attempt_number, checkpointNumber: current.checkpoint_number + 1, evidence: asJson({ reason: 'Mutation returned without an exact after-state.' }), observedRemoteState: 'unknown', state: 'unknown' });
    throw new Error(`Variation listing cleanup operation ${operationKey} returned without an exact after-state.`);
  }
  await appendCleanupCheckpoint(input, history, operationKey, { attemptNumber: current.attempt_number, checkpointNumber: current.checkpoint_number + 1, evidence: exactAfter.evidence, observedRemoteState: exactAfter.observed, state: 'confirmed_complete' });
}

async function finalCleanupAbsence(
  snapshot: VariationListingCleanupSnapshot,
  remote: VariationListingPublicationReadGateway
): Promise<CleanupEvidence | null> {
  const state = await readCleanupOwnedState(snapshot, remote);
  if (state.group || state.items.size > 0 || state.offers.size > 0) return null;
  return { evidence: asJson({ groupKey: snapshot.groupKey, offersBySku: snapshot.ownedRemote.offerIdsBySku, skus: snapshot.orderedSkus, state: 'proven_absent' }), observed: 'proven_absent' };
}

async function executeFinalAbsence(
  input: VariationListingCleanupExecutionInput,
  history: CleanupHistory,
  snapshot: VariationListingCleanupSnapshot
): Promise<void> {
  const key = 'final-absence';
  const current = cleanupLatest(history.get(key)!);
  const absence = await finalCleanupAbsence(snapshot, input.remote);
  if (!absence) throw new Error('Variation listing cleanup final absence is not affirmatively proven.');
  if (current && cleanupTerminal(current)) return;
  if (current?.state === 'started') {
    await appendCleanupCheckpoint(input, history, key, { attemptNumber: current.attempt_number, checkpointNumber: current.checkpoint_number + 1, evidence: absence.evidence, observedRemoteState: absence.observed, state: 'confirmed_complete' });
    return;
  }
  if (current?.state === 'unknown') {
    await appendCleanupCheckpoint(input, history, key, { attemptNumber: current.attempt_number + 1, checkpointNumber: 1, evidence: absence.evidence, observedRemoteState: absence.observed, state: 'confirmed_complete' });
    return;
  }
  if (current) throw new Error('Variation listing cleanup final absence journal state is invalid.');
  await appendCleanupCheckpoint(input, history, key, { attemptNumber: 1, checkpointNumber: 1, evidence: absence.evidence, observedRemoteState: absence.observed, state: 'confirmed_complete' });
}

export interface VariationListingWithdrawalExecutionResult {
  lifecycleState: 'withdrawn';
  revisionId: string;
}

/** Execute only the frozen withdrawal operation and durably stop at withdrawn.
 * The same immutable cleanup revision remains resumable by executeVariationListingCleanup.
 */
export async function executeVariationListingWithdrawal(
  input: VariationListingCleanupExecutionInput
): Promise<VariationListingWithdrawalExecutionResult> {
  const aggregate = await input.transaction.loadAggregate(input.frozen.captureInput.groupId);
  if (!aggregate ||
      aggregate.group.desired_revision !== input.frozen.captureInput.capturedDesiredRevision ||
      aggregate.group.last_confirmed_revision !== input.frozen.expectedPreviousConfirmedRevision) {
    throw new Error('Variation listing withdrawal frozen intent is stale against the current durable aggregate.');
  }
  const snapshot = input.frozen.captureInput.snapshot as unknown as VariationListingCleanupSnapshot;
  if (snapshot.planVersion !== CLEANUP_PLAN_VERSION || input.frozen.captureInput.snapshotDigest !== digestJson(asJson(snapshot))) {
    throw new Error('Variation listing withdrawal frozen snapshot integrity check failed.');
  }
  const withdrawal = input.frozen.captureInput.operationPlan.find((operation) => operation.operationKey === 'withdraw-group');
  if (!withdrawal || withdrawal.operationKind !== 'withdrawal') {
    throw new Error('Variation listing withdrawal requires one frozen withdrawal operation.');
  }
  const existingRevision = await input.journal.loadRevision(input.frozen.captureInput.revisionId);
  if (existingRevision) {
    if (existingRevision.group_id !== input.frozen.captureInput.groupId ||
        existingRevision.captured_desired_revision !== input.frozen.captureInput.capturedDesiredRevision ||
        existingRevision.snapshot_version !== input.frozen.captureInput.snapshotVersion ||
        existingRevision.snapshot_digest !== input.frozen.captureInput.snapshotDigest ||
        existingRevision.operation_count !== input.frozen.captureInput.operationPlan.length ||
        canonicalJson(existingRevision.snapshot) !== canonicalJson(input.frozen.captureInput.snapshot) ||
        canonicalJson(existingRevision.operation_plan) !== canonicalJson(durableCleanupOperationPlan(input.frozen))) {
      throw new Error('Variation listing withdrawal durable revision does not match the frozen intent.');
    }
  } else {
    await input.transaction.captureRevision(input.frozen.captureInput);
  }
  const history = cleanupHistory(input.frozen, await input.journal.listCheckpoints(input.frozen.captureInput.revisionId));
  await runCleanupMutation(input, history, withdrawal.operationKey,
    async () => {
      const state = await readCleanupOwnedState(snapshot, input.remote);
      if (!state.group || [...state.offers.values()].some((offer) => offer.status === 'PUBLISHED' && offer.lifecycleClass === 'active')) return null;
      return { evidence: asJson({ groupKey: snapshot.groupKey, state: 'withdrawn' }), observed: 'present' };
    },
    async () => {
      const state = await readCleanupOwnedState(snapshot, input.remote);
      const active = [...state.offers.values()].filter((offer) => offer.status === 'PUBLISHED' && offer.lifecycleClass === 'active');
      return state.group && active.length > 0
        ? { evidence: asJson({ groupKey: snapshot.groupKey, listingId: snapshot.ownedRemote.listingId, state: 'active' }), observed: 'present' }
        : null;
    },
    () => input.mutations.withdrawInventoryItemGroup(snapshot.groupKey));
  await input.transaction.advanceCleanupLifecycle({
    expectedDesiredRevision: input.frozen.captureInput.capturedDesiredRevision,
    expectedPreviousConfirmedRevision: input.frozen.expectedPreviousConfirmedRevision,
    groupId: input.frozen.captureInput.groupId,
    revisionId: input.frozen.captureInput.revisionId,
    targetLifecycle: 'withdrawn',
  });
  return { lifecycleState: 'withdrawn', revisionId: input.frozen.captureInput.revisionId };
}

export async function executeVariationListingCleanup(
  input: VariationListingCleanupExecutionInput
): Promise<VariationListingCleanupExecutionResult> {
  const aggregate = await input.transaction.loadAggregate(input.frozen.captureInput.groupId);
  if (!aggregate || aggregate.group.desired_revision !== input.frozen.captureInput.capturedDesiredRevision ||
    aggregate.group.last_confirmed_revision !== input.frozen.expectedPreviousConfirmedRevision) {
    throw new Error('Variation listing cleanup frozen intent is stale against the current durable aggregate.');
  }
  const snapshot = input.frozen.captureInput.snapshot as unknown as VariationListingCleanupSnapshot;
  if (snapshot.planVersion !== CLEANUP_PLAN_VERSION || input.frozen.captureInput.snapshotDigest !== digestJson(asJson(snapshot))) {
    throw new Error('Variation listing cleanup frozen snapshot integrity check failed.');
  }
  const frozenBundleIdentity = validateOwnedBundles(cleanupBundles(snapshot));
  if (frozenBundleIdentity.groupKey !== snapshot.groupKey || frozenBundleIdentity.marketplaceId !== snapshot.marketplaceId ||
    canonicalJson(asJson(frozenBundleIdentity.orderedSkus)) !== canonicalJson(asJson(snapshot.orderedSkus))) {
    throw new Error('Variation listing cleanup frozen payload bundles do not match snapshot identity.');
  }
  validateOwnedRemoteIdentity(snapshot.ownedRemote, snapshot.orderedSkus);
  const allowedKinds = new Set(['withdrawal', 'cleanup_offer', 'cleanup_group', 'cleanup_child_inventory_item', 'final_absence_verification']);
  if (input.frozen.captureInput.operationPlan.some((operation) => !allowedKinds.has(operation.operationKind)) ||
    input.frozen.captureInput.operationPlan.at(-1)?.operationKind !== 'final_absence_verification' ||
    new Set(input.frozen.captureInput.operationPlan.map((operation) => operation.operationKey)).size !== input.frozen.captureInput.operationPlan.length) {
    throw new Error('Variation listing cleanup frozen operation plan is invalid.');
  }
  const existingRevision = await input.journal.loadRevision(input.frozen.captureInput.revisionId);
  if (existingRevision) {
    if (existingRevision.group_id !== input.frozen.captureInput.groupId ||
      existingRevision.captured_desired_revision !== input.frozen.captureInput.capturedDesiredRevision ||
      existingRevision.snapshot_version !== input.frozen.captureInput.snapshotVersion ||
      existingRevision.snapshot_digest !== input.frozen.captureInput.snapshotDigest ||
      canonicalJson(existingRevision.snapshot) !== canonicalJson(input.frozen.captureInput.snapshot) ||
      canonicalJson(existingRevision.operation_plan) !== canonicalJson(durableCleanupOperationPlan(input.frozen))) {
      throw new Error('Variation listing cleanup durable revision does not match the frozen intent.');
    }
  } else {
    await input.transaction.captureRevision(input.frozen.captureInput);
  }
  const history = cleanupHistory(input.frozen, await input.journal.listCheckpoints(input.frozen.captureInput.revisionId));
  if (aggregate.group.lifecycle_state === snapshot.terminalLifecycle) {
    if (!input.frozen.captureInput.operationPlan.every((operation) => {
      const latest = cleanupLatest(history.get(operation.operationKey)!);
      return latest?.state === 'confirmed_complete' || latest?.state === 'confirmed_no_op';
    }) ||
      await finalCleanupAbsence(snapshot, input.remote) === null) {
      throw new Error('Variation listing terminal cleanup lifecycle lacks durable final absence proof.');
    }
    return { lifecycleState: snapshot.terminalLifecycle, revisionId: input.frozen.captureInput.revisionId };
  }
  const transition = async (targetLifecycle: VariationListingCleanupLifecycleTransitionInput['targetLifecycle']) => {
    await input.transaction.advanceCleanupLifecycle({
      expectedDesiredRevision: input.frozen.captureInput.capturedDesiredRevision,
      expectedPreviousConfirmedRevision: input.frozen.expectedPreviousConfirmedRevision,
      groupId: input.frozen.captureInput.groupId,
      revisionId: input.frozen.captureInput.revisionId,
      targetLifecycle,
    });
  };

  const withdrawal = input.frozen.captureInput.operationPlan.find((operation) => operation.operationKey === 'withdraw-group');
  if (withdrawal) {
    await runCleanupMutation(input, history, withdrawal.operationKey,
      async () => {
        const state = await readCleanupOwnedState(snapshot, input.remote);
        if (!state.group || [...state.offers.values()].some((offer) => offer.status === 'PUBLISHED' && offer.lifecycleClass === 'active')) return null;
        return { evidence: asJson({ groupKey: snapshot.groupKey, state: 'withdrawn' }), observed: 'present' };
      },
      async () => {
        const state = await readCleanupOwnedState(snapshot, input.remote);
        const active = [...state.offers.values()].filter((offer) => offer.status === 'PUBLISHED' && offer.lifecycleClass === 'active');
        return state.group && active.length > 0 ? { evidence: asJson({ groupKey: snapshot.groupKey, listingId: snapshot.ownedRemote.listingId, state: 'active' }), observed: 'present' } : null;
      },
      () => input.mutations.withdrawInventoryItemGroup(snapshot.groupKey));
    await transition('withdrawn');
  }

  await transition('cleanup');
  for (const operation of input.frozen.captureInput.operationPlan) {
    if (operation.operationKind === 'cleanup_offer') {
      const sku = (operation.intent as Record<string, Json>).sku as string;
      const offerId = (operation.intent as Record<string, Json>).offerId as string;
      await runCleanupMutation(input, history, operation.operationKey,
        async () => (await readCleanupOwnedState(snapshot, input.remote)).offers.has(sku) ? null : absentEvidence('offerId', offerId),
        async () => (await readCleanupOwnedState(snapshot, input.remote)).offers.get(sku)?.offerId === offerId ? { evidence: asJson({ offerId, sku }), observed: 'present' } : null,
        () => input.mutations.deleteOffer(offerId));
    } else if (operation.operationKind === 'cleanup_group') {
      await runCleanupMutation(input, history, operation.operationKey,
        async () => (await readCleanupOwnedState(snapshot, input.remote)).group ? null : absentEvidence('groupKey', snapshot.groupKey),
        async () => { const state = await readCleanupOwnedState(snapshot, input.remote); return state.group && state.offers.size === 0 ? { evidence: asJson({ groupKey: snapshot.groupKey }), observed: 'present' } : null; },
        () => input.mutations.deleteInventoryItemGroup(snapshot.groupKey));
    } else if (operation.operationKind === 'cleanup_child_inventory_item') {
      const sku = (operation.intent as Record<string, Json>).sku as string;
      await runCleanupMutation(input, history, operation.operationKey,
        async () => (await readCleanupOwnedState(snapshot, input.remote)).items.has(sku) ? null : absentEvidence('sku', sku),
        async () => { const state = await readCleanupOwnedState(snapshot, input.remote); return state.items.has(sku) && !state.group ? { evidence: asJson({ sku }), observed: 'present' } : null; },
        () => input.mutations.deleteInventoryItem(sku));
    }
  }
  await executeFinalAbsence(input, history, snapshot);
  await transition(snapshot.terminalLifecycle);
  return { lifecycleState: snapshot.terminalLifecycle, revisionId: input.frozen.captureInput.revisionId };
}
