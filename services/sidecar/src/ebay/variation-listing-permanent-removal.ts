import { createHash, randomUUID } from 'node:crypto';

import type {
  CaptureVariationListingRevisionInput,
  Json,
  VariationListingAggregateSnapshot,
  VariationListingGroupRow,
  VariationListingPublishingCheckpointRow,
  VariationListingRevisionPlanOperationInput,
  VariationListingRevisionRow,
  AppendVariationListingJournalCheckpointInput,
  AppendVariationListingJournalCheckpointResult,
  CaptureVariationListingRevisionResult,
} from '@ebay-inventory/data';

import {
  reconstructConfirmedRemoteIdentity,
  reconstructVariationListingConfirmedRepresentativeImages,
  revisionSnapshotAggregate,
} from '@/ebay/variation-listing-active-revision.js';

import type {
  VariationListingPublicationReadGateway,
  VariationListingRemoteOffer,
  VariationListingRemoteRead,
} from '@/ebay/variation-listing-publication.js';

const MAX_QUANTITY = 2_147_483_647;
const OPERATION_KEY = 'remove-group-membership';
const OPERATION_KIND = 'permanent_removal_group_membership';

export interface VariationListingPermanentRemovalRemote extends VariationListingPublicationReadGateway {
  /** Existing Inventory API group replacement endpoint. It must not write an Item or Offer. */
  replaceInventoryItemGroup(groupKey: string, payload: Json): Promise<void>;
}

export interface VariationListingPermanentRemovalJournal {
  listCheckpoints(revisionId: string): Promise<VariationListingPublishingCheckpointRow[]>;
  loadRevision(revisionId: string): Promise<VariationListingRevisionRow | null>;
}

export interface VariationListingPermanentRemovalTransaction {
  capturePermanentRemovalRevision(input: CaptureVariationListingRevisionInput): Promise<CaptureVariationListingRevisionResult>;
  appendJournalCheckpoint(input: AppendVariationListingJournalCheckpointInput): Promise<AppendVariationListingJournalCheckpointResult>;
  confirmPermanentRemoval(input: {
    groupId: string;
    revisionId: string;
    expectedPreviousConfirmedRevision: number;
    confirmedRevision: number;
    targetVariationId: string;
    targetSku: string;
  }): Promise<VariationListingGroupRow>;
}

export interface VariationListingPermanentRemovalPlan {
  captureInput: CaptureVariationListingRevisionInput;
  groupKey: string;
  targetVariationId: string;
  targetSku: string;
  marketplaceId: string;
  survivorSkus: string[];
  listingId: string;
  offerIdsBySku: Record<string, string>;
  quantitiesBySku: Record<string, { inventoryItemQuantity: number; offerQuantity: number; sellableQuantity: number }>;
  inventoryItemPayloadsBySku: Record<string, Json>;
  offerPayloadsBySku: Record<string, Json>;
  expectedGroupPayload: Json;
  replacementGroupPayload: Json;
}

export interface BuildVariationListingPermanentRemovalPlanInput {
  aggregate: VariationListingAggregateSnapshot;
  targetVariationId: string;
  revisionId: string;
  previousConfirmedRevision: number;
  previousRevisionId: string;
  /** Immutable last-confirmed revision used to hydrate the v3 survivor snapshot. */
  previousRevision: VariationListingRevisionRow;
  previousCheckpoints: readonly VariationListingPublishingCheckpointRow[];
  remote: VariationListingPermanentRemovalRemote;
  /** Optional durable v3 snapshot. When omitted a minimal v3 survivor snapshot is built. */
  snapshot?: Json;
}

export interface ExecuteVariationListingPermanentRemovalInput {
  plan: VariationListingPermanentRemovalPlan;
  remote: VariationListingPermanentRemovalRemote;
  journal: VariationListingPermanentRemovalJournal;
  transaction: VariationListingPermanentRemovalTransaction;
  checkpointId?: () => string;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      // Match PostgreSQL canonical JSON's COLLATE "C" byte ordering. JS
      // localeCompare is locale-sensitive and can order case-distinct keys
      // differently from the durable SQL digest.
      .sort(([a], [b]) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8')))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function asJson<T>(value: T): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

function digest(value: Json): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function object(value: Json, label: string): Record<string, Json> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, Json>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function quantity(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > MAX_QUANTITY) {
    throw new Error(`${label} must be a nonnegative int32.`);
  }
  return value;
}

function remoteQuantity(payload: Json, sku: string): { inventoryItemQuantity: number; offerQuantity: number; sellableQuantity: number } {
  const item = object(payload, `remote inventory item ${sku}`);
  const availability = object(item.availability, `remote inventory item ${sku} availability`);
  const ship = object(availability.shipToLocationAvailability, `remote inventory item ${sku} shipToLocationAvailability`);
  return {
    inventoryItemQuantity: quantity(ship.quantity, `remote inventory item ${sku} quantity`),
    offerQuantity: 0,
    sellableQuantity: 0,
  };
}

function readOfferQuantity(payload: Json, sku: string): number {
  return quantity(object(payload, `remote offer ${sku}`).availableQuantity, `remote offer ${sku} availableQuantity`);
}

function payloadWithoutQuantity(payload: Json, kind: 'item' | 'offer'): Json {
  const clone = structuredClone(payload);
  if (kind === 'offer') {
    const row = object(clone, 'remote offer payload');
    delete row.availableQuantity;
    return clone;
  }
  const row = object(clone, 'remote inventory item payload');
  const availability = row.availability;
  if (availability !== null && typeof availability === 'object' && !Array.isArray(availability)) {
    const availabilityObject = availability as Record<string, Json>;
    const ship = availabilityObject.shipToLocationAvailability;
    if (ship !== null && typeof ship === 'object' && !Array.isArray(ship)) {
      delete (ship as Record<string, Json>).quantity;
    }
  }
  return clone;
}

function exactPresent<T>(read: VariationListingRemoteRead<T>, label: string): T {
  if (read.state === 'unknown') throw new Error(`${label} read is unknown: ${read.reason}`);
  if (read.state === 'proven_absent') throw new Error(`${label} is proven absent.`);
  return read.value;
}

function exactGroupPayload(payload: Json, survivorSkus: readonly string[]): Json {
  const clone = structuredClone(payload);
  const group = object(clone, 'remote inventory item group payload');
  group.variantSKUs = [...survivorSkus];
  return clone;
}

function exactSkuSet(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && new Set(actual).size === actual.length && new Set(expected).size === expected.length && expected.every((sku) => actual.includes(sku));
}

function exactRemovedOfferLifecycle(lifecycleClass: VariationListingRemoteOffer['lifecycleClass']): boolean {
  // An UNPUBLISHED offer may carry no listing-status evidence (null) or an
  // explicit NOT_LISTED classification. Active/ended/ambiguous evidence is
  // not an exact permanent-removal after-state.
  return lifecycleClass === null || lifecycleClass === 'not-listed';
}

function survivorAggregate(aggregate: VariationListingAggregateSnapshot, targetVariationId: string): VariationListingAggregateSnapshot {
  const variations = aggregate.variations.filter((variation) => variation.variation_id !== targetVariationId);
  const ids = new Set(variations.map((variation) => variation.variation_id));
  return {
    ...structuredClone(aggregate),
    variations,
    copies: aggregate.copies.filter((copy) => ids.has(copy.variation_id)),
  };
}

function removalSnapshot(input: {
  aggregate: VariationListingAggregateSnapshot;
  targetVariationId: string;
  previousRevision: VariationListingRevisionRow;
  previousCheckpoints: readonly VariationListingPublishingCheckpointRow[];
  listingId: string;
  offerIdsBySku: Record<string, string>;
  quantitiesBySku: Record<string, { inventoryItemQuantity: number; offerQuantity: number; sellableQuantity: number }>;
}): Json {
  const previousAggregate = revisionSnapshotAggregate(input.previousRevision);
  const previousImages = reconstructVariationListingConfirmedRepresentativeImages({
    revision: input.previousRevision,
    checkpoints: input.previousCheckpoints,
  });
  const survivor = survivorAggregate(input.aggregate, input.targetVariationId);
  const survivorCopyIds = new Set(survivor.variations.map((variation) => variation.representative_copy_id).filter((copyId): copyId is string => typeof copyId === 'string'));
  const representativeImages = previousImages.filter((image) => survivorCopyIds.has(image.copyId));
  // c2 performs no Media mutation. Representative EPS identities are already
  // reconstructed from the prior confirmed lineage, so carrying prior Media
  // intents would make the next active executor incorrectly seek c2-owned
  // checkpoints that can never exist.
  const mediaResources: Json[] = [];
  const survivorSkus = new Set(survivor.variations.map((variation) => variation.sku));
  const survivorOfferIdsBySku = Object.fromEntries(
    [...survivorSkus].map((sku) => [sku, input.offerIdsBySku[sku]])
  );
  const survivorQuantitiesBySku = Object.fromEntries(
    [...survivorSkus].map((sku) => [sku, input.quantitiesBySku[sku]])
  );
  const remote = {
    listingId: input.listingId,
    offerIdsBySku: survivorOfferIdsBySku,
    quantitiesBySku: survivorQuantitiesBySku,
  };
  return asJson({
    aggregate: survivor,
    confirmed: {
      aggregate: previousAggregate,
      representativeImages: previousImages,
      remote,
      revisionId: input.previousRevision.revision_id,
    },
    mediaResources,
    representativeImages,
  });
}

function operationIntent(plan: { groupKey: string; targetSku: string; survivorSkus: readonly string[] }): Json {
  return asJson({ groupKey: plan.groupKey, targetSku: plan.targetSku, survivorSkus: [...plan.survivorSkus] });
}

const removalMetadataKey = 'permanentRemoval';

function removalMetadata(plan: Omit<VariationListingPermanentRemovalPlan, 'captureInput'>): Json {
  return asJson({
    version: 1,
    groupKey: plan.groupKey,
    targetVariationId: plan.targetVariationId,
    targetSku: plan.targetSku,
    marketplaceId: plan.marketplaceId,
    survivorSkus: plan.survivorSkus,
    listingId: plan.listingId,
    offerIdsBySku: plan.offerIdsBySku,
    quantitiesBySku: plan.quantitiesBySku,
    inventoryItemPayloadsBySku: plan.inventoryItemPayloadsBySku,
    offerPayloadsBySku: plan.offerPayloadsBySku,
    expectedGroupPayload: plan.expectedGroupPayload,
    replacementGroupPayload: plan.replacementGroupPayload,
  });
}

function parseRemovalMetadata(snapshot: Json): Omit<VariationListingPermanentRemovalPlan, 'captureInput'> {
  const root = object(snapshot, 'permanent-removal snapshot');
  const metadata = object(root[removalMetadataKey], 'permanent-removal frozen metadata');
  if (metadata.version !== 1) throw new Error('Unsupported permanent-removal frozen metadata version.');
  const groupKey = requiredString(metadata.groupKey, 'permanent-removal groupKey');
  const targetVariationId = requiredString(metadata.targetVariationId, 'permanent-removal targetVariationId');
  const targetSku = requiredString(metadata.targetSku, 'permanent-removal targetSku');
  const marketplaceId = requiredString(metadata.marketplaceId, 'permanent-removal marketplaceId');
  if (!Array.isArray(metadata.survivorSkus) || metadata.survivorSkus.length < 2) throw new Error('Permanent-removal frozen survivorSkus are invalid.');
  const survivorSkus = metadata.survivorSkus.map((sku, index) => requiredString(sku, `permanent-removal survivorSkus[${index}]`));
  if (new Set(survivorSkus).size !== survivorSkus.length || survivorSkus.includes(targetSku)) throw new Error('Permanent-removal frozen survivorSkus must be unique and exclude target.');
  const listingId = requiredString(metadata.listingId, 'permanent-removal listingId');
  const offerRows = object(metadata.offerIdsBySku, 'permanent-removal offerIdsBySku');
  const offerIdsBySku: Record<string, string> = {};
  for (const [sku, offerId] of Object.entries(offerRows)) offerIdsBySku[sku] = requiredString(offerId, `permanent-removal offerIdsBySku.${sku}`);
  const quantityRows = object(metadata.quantitiesBySku, 'permanent-removal quantitiesBySku');
  const quantitiesBySku: VariationListingPermanentRemovalPlan['quantitiesBySku'] = {};
  for (const [sku, value] of Object.entries(quantityRows)) {
    const row = object(value, `permanent-removal quantitiesBySku.${sku}`);
    quantitiesBySku[sku] = {
      inventoryItemQuantity: quantity(row.inventoryItemQuantity, `permanent-removal ${sku} inventoryItemQuantity`),
      offerQuantity: quantity(row.offerQuantity, `permanent-removal ${sku} offerQuantity`),
      sellableQuantity: quantity(row.sellableQuantity, `permanent-removal ${sku} sellableQuantity`),
    };
  }
  const expectedGroupPayload = metadata.expectedGroupPayload;
  const replacementGroupPayload = metadata.replacementGroupPayload;
  if (expectedGroupPayload === undefined || replacementGroupPayload === undefined) {
    throw new Error('Permanent-removal frozen group payloads are missing.');
  }
  const inventoryItemPayloadRows = object(metadata.inventoryItemPayloadsBySku, 'permanent-removal inventoryItemPayloadsBySku');
  const offerPayloadRows = object(metadata.offerPayloadsBySku, 'permanent-removal offerPayloadsBySku');
  const inventoryItemPayloadsBySku: Record<string, Json> = {};
  const offerPayloadsBySku: Record<string, Json> = {};
  for (const [sku, payload] of Object.entries(inventoryItemPayloadRows)) inventoryItemPayloadsBySku[sku] = payload;
  for (const [sku, payload] of Object.entries(offerPayloadRows)) offerPayloadsBySku[sku] = payload;
  return {
    groupKey,
    targetVariationId,
    targetSku,
    marketplaceId,
    survivorSkus,
    listingId,
    offerIdsBySku,
    quantitiesBySku,
    inventoryItemPayloadsBySku,
    offerPayloadsBySku,
    expectedGroupPayload,
    replacementGroupPayload,
  };
}

function operationPlanFromRevision(revision: VariationListingRevisionRow): VariationListingRevisionPlanOperationInput[] {
  if (!Array.isArray(revision.operation_plan)) throw new Error('Permanent-removal durable operation plan must be an array.');
  return revision.operation_plan.map((raw, index) => {
    const row = object(raw, `permanent-removal operation ${index}`);
    return {
      operationKey: requiredString(row.operation_key, `permanent-removal operation ${index} operation_key`),
      operationKind: requiredString(row.operation_kind, `permanent-removal operation ${index} operation_kind`),
      targetRef: requiredString(row.target_ref, `permanent-removal operation ${index} target_ref`),
      sequenceNo: quantity(row.sequence_no, `permanent-removal operation ${index} sequence_no`),
      intentVersion: quantity(row.intent_version, `permanent-removal operation ${index} intent_version`),
      intentDigest: requiredString(row.intent_digest, `permanent-removal operation ${index} intent_digest`),
      intent: row.intent ?? null,
    };
  });
}

function planFromSnapshotMetadata(input: {
  snapshot: Json;
  groupId: string;
  revisionId: string;
  capturedDesiredRevision: number;
  snapshotDigest: string;
  operationPlan: VariationListingRevisionPlanOperationInput[];
}): VariationListingPermanentRemovalPlan {
  const metadata = parseRemovalMetadata(input.snapshot);
  const root = object(input.snapshot, 'permanent-removal snapshot');
  const aggregate = object(root.aggregate, 'permanent-removal survivor aggregate');
  const group = object(aggregate.group, 'permanent-removal survivor group');
  if (group.group_key !== metadata.groupKey || group.marketplace_id !== metadata.marketplaceId) {
    throw new Error('Permanent-removal survivor snapshot group identity does not match frozen metadata.');
  }
  const confirmed = object(root.confirmed, 'permanent-removal confirmed parent');
  const remote = object(confirmed.remote, 'permanent-removal confirmed remote identity');
  if (remote.listingId !== metadata.listingId) throw new Error('Permanent-removal confirmed listing identity does not match frozen metadata.');
  const remoteOffers = object(remote.offerIdsBySku, 'permanent-removal confirmed offer IDs');
  const remoteQuantities = object(remote.quantitiesBySku, 'permanent-removal confirmed quantities');
  const expectedSurvivorOffers: Record<string, Json> = {};
  const expectedSurvivorQuantities: Record<string, Json> = {};
  for (const sku of metadata.survivorSkus) {
    if (remoteOffers[sku] === undefined || remoteQuantities[sku] === undefined) throw new Error(`Permanent-removal confirmed remote identity is missing survivor ${sku}.`);
    expectedSurvivorOffers[sku] = metadata.offerIdsBySku[sku]!;
    expectedSurvivorQuantities[sku] = metadata.quantitiesBySku[sku]! as unknown as Json;
  }
  if (Object.keys(remoteOffers).length !== metadata.survivorSkus.length || Object.keys(remoteQuantities).length !== metadata.survivorSkus.length || canonicalJson(remoteOffers) !== canonicalJson(expectedSurvivorOffers) || canonicalJson(remoteQuantities) !== canonicalJson(expectedSurvivorQuantities)) {
    throw new Error('Permanent-removal confirmed survivor remote identity does not match frozen metadata.');
  }
  return {
    ...metadata,
    captureInput: {
      groupId: input.groupId,
      revisionId: input.revisionId,
      capturedDesiredRevision: input.capturedDesiredRevision,
      snapshotVersion: 3,
      snapshot: input.snapshot,
      snapshotDigest: input.snapshotDigest,
      operationPlan: input.operationPlan,
    },
  };
}

/**
 * The finalizer deletes target copies in the same transaction as the target
 * variation. Keep their exact R2 identities inside the immutable confirmed
 * revision, and fail before capture if the prior revision dropped any key.
 */
function assertFrozenTargetCopyKeys(
  snapshot: Json,
  aggregate: VariationListingAggregateSnapshot,
  targetVariationId: string,
): void {
  const root = object(snapshot, 'permanent-removal snapshot');
  const confirmed = object(root.confirmed, 'permanent-removal confirmed parent');
  const confirmedAggregate = object(confirmed.aggregate, 'permanent-removal confirmed aggregate');
  const frozenCopies = confirmedAggregate.copies;
  if (!Array.isArray(frozenCopies)) throw new Error('Permanent-removal confirmed aggregate copies are missing.');
  const targetCopies = aggregate.copies.filter((copy) => copy.variation_id === targetVariationId);
  const frozenTargetCopies = frozenCopies.filter((copy) => object(copy, 'permanent-removal frozen copy').variation_id === targetVariationId);
  if (frozenTargetCopies.length !== targetCopies.length) {
    throw new Error('Permanent-removal frozen revision does not retain every target copy/R2 key.');
  }
  for (const copy of targetCopies) {
    const match = frozenTargetCopies.find((candidate) => {
      const row = object(candidate, 'permanent-removal frozen copy');
      return row.copy_id === copy.copy_id && row.front_r2_key === copy.front_r2_key && row.back_r2_key === copy.back_r2_key;
    });
    if (!match) throw new Error('Permanent-removal frozen revision does not retain every target copy/R2 key.');
  }
}

function assertFrozenTargetCopyShape(snapshot: Json, targetVariationId: string): void {
  const root = object(snapshot, 'permanent-removal snapshot');
  const confirmed = object(root.confirmed, 'permanent-removal confirmed parent');
  const confirmedAggregate = object(confirmed.aggregate, 'permanent-removal confirmed aggregate');
  const frozenCopies = confirmedAggregate.copies;
  if (!Array.isArray(frozenCopies)) throw new Error('Permanent-removal confirmed aggregate copies are missing.');
  for (const candidate of frozenCopies) {
    const copy = object(candidate, 'permanent-removal frozen copy');
    if (copy.variation_id !== targetVariationId) continue;
    requiredString(copy.copy_id, 'permanent-removal frozen target copy_id');
    requiredString(copy.front_r2_key, 'permanent-removal frozen target front_r2_key');
    requiredString(copy.back_r2_key, 'permanent-removal frozen target back_r2_key');
  }
}

/** Hydrate a frozen c2 plan from its immutable captured revision. No remote
 * reads are performed; the executor performs exact pre/post reconciliation. */
export function hydrateVariationListingPermanentRemovalPlan(revision: VariationListingRevisionRow): VariationListingPermanentRemovalPlan {
  if (revision.snapshot_version !== 3) throw new Error('Permanent-removal hydration requires snapshot version 3.');
  if (digest(revision.snapshot) !== revision.snapshot_digest) throw new Error('Permanent-removal frozen snapshot digest does not match its durable revision.');
  const plan = planFromSnapshotMetadata({
    snapshot: revision.snapshot,
    groupId: revision.group_id,
    revisionId: revision.revision_id,
    capturedDesiredRevision: revision.captured_desired_revision,
    snapshotDigest: revision.snapshot_digest,
    operationPlan: operationPlanFromRevision(revision),
  });
  assertFrozenTargetCopyShape(revision.snapshot, plan.targetVariationId);
  if (plan.captureInput.operationPlan.length !== revision.operation_count) throw new Error('Permanent-removal durable operation count does not match its plan.');
  const operation = plan.captureInput.operationPlan[0];
  const expectedIntent = operationIntent(plan);
  if (
    plan.captureInput.operationPlan.length !== 1 ||
    !operation ||
    operation.operationKey !== OPERATION_KEY ||
    operation.operationKind !== OPERATION_KIND ||
    operation.targetRef !== plan.groupKey ||
    operation.sequenceNo !== 1 ||
    operation.intentVersion !== 1 ||
    canonicalJson(operation.intent) !== canonicalJson(expectedIntent) ||
    operation.intentDigest !== digest(expectedIntent)
  ) throw new Error('Permanent-removal durable plan must contain exactly one matching group-membership operation.');
  return plan;
}

async function exactRemoteState(
  plan: VariationListingPermanentRemovalPlan,
  remote: VariationListingPermanentRemovalRemote,
): Promise<{ groupPayload: Json; groupSkus: string[]; targetPresent: boolean; listingId: string; offerIdsBySku: Record<string, string>; quantitiesBySku: Record<string, { inventoryItemQuantity: number; offerQuantity: number; sellableQuantity: number }>; groupKeysBySku: Record<string, string[] | null>; inventoryItemPayloadsBySku: Record<string, Json>; offerPayloadsBySku: Record<string, Json> }> {
  const group = exactPresent(await remote.getInventoryItemGroup(plan.groupKey), `Variation listing group ${plan.groupKey}`);
  const expected = object(plan.expectedGroupPayload, 'frozen group payload');
  const actual = object(group.payload, 'remote group payload');
  const actualWithoutMembership = { ...actual, variantSKUs: undefined };
  const expectedWithoutMembership = { ...expected, variantSKUs: undefined };
  if (canonicalJson(actualWithoutMembership) !== canonicalJson(expectedWithoutMembership)) throw new Error('Variation listing group payload changed outside membership.');
  const groupSkus = [...group.variantSKUs];
  const survivorSet = new Set(plan.survivorSkus);
  const targetPresent = groupSkus.includes(plan.targetSku);
  if (groupSkus.some((sku) => !survivorSet.has(sku) && sku !== plan.targetSku) || new Set(groupSkus).size !== groupSkus.length) {
    throw new Error('Variation listing group contains an unexpected SKU.');
  }
  const listingId = plan.listingId;
  const offerIdsBySku: Record<string, string> = {};
  const quantitiesBySku: Record<string, { inventoryItemQuantity: number; offerQuantity: number; sellableQuantity: number }> = {};
  const groupKeysBySku: Record<string, string[] | null> = {};
  const inventoryItemPayloadsBySku: Record<string, Json> = {};
  const offerPayloadsBySku: Record<string, Json> = {};
  const seenOfferIds = new Set<string>();
  for (const sku of [plan.targetSku, ...plan.survivorSkus]) {
    const item = exactPresent(await remote.getInventoryItem(sku), `Variation listing item ${sku}`);
    if (item.sku !== sku) throw new Error(`Variation listing item ${sku} identity changed.`);
    groupKeysBySku[sku] = item.groupKeys ? [...item.groupKeys] : null;
    inventoryItemPayloadsBySku[sku] = payloadWithoutQuantity(item.payload, 'item');
    const offers = exactPresent(await remote.getOffers(sku, plan.marketplaceId), `Variation listing offers ${sku}`);
    if (offers.length !== 1) throw new Error(`Variation listing SKU ${sku} must have exactly one offer.`);
    const offer = offers[0]!;
    if (offer.sku !== sku || offer.marketplaceId !== plan.marketplaceId || offer.offerId !== plan.offerIdsBySku[sku]) {
      throw new Error(`Variation listing offer ${sku} identity changed.`);
    }
    if (seenOfferIds.has(offer.offerId)) throw new Error(`Variation listing offer ${sku} reuses another SKU's Offer ID.`);
    seenOfferIds.add(offer.offerId);
    if (sku === plan.targetSku && !targetPresent) {
      // eBay's Inventory API retains the removed SKU's Offer but changes its
      // status PUBLISHED -> UNPUBLISHED after group membership replacement.
      // The old listingId may be omitted on an unpublished Offer; if eBay
      // returns one, it must still be the original listing, never another.
      if (offer.status !== 'UNPUBLISHED' || !exactRemovedOfferLifecycle(offer.lifecycleClass) || (offer.listingId !== null && offer.listingId !== listingId)) {
        throw new Error(`Variation listing removed offer ${sku} is not the expected unpublished original Offer.`);
      }
    } else if (offer.status !== 'PUBLISHED' || offer.lifecycleClass !== 'active' || offer.listingId !== listingId) {
      // Before removal the target is still published; after removal every
      // survivor must remain published on the exact original listing.
      throw new Error(`Variation listing offer ${sku} identity/listing changed.`);
    }
    offerIdsBySku[sku] = offer.offerId;
    offerPayloadsBySku[sku] = payloadWithoutQuantity(offer.payload, 'offer');
    const itemQuantity = remoteQuantity(item.payload, sku);
    const offerQuantity = readOfferQuantity(offer.payload, sku);
    quantitiesBySku[sku] = { inventoryItemQuantity: itemQuantity.inventoryItemQuantity, offerQuantity, sellableQuantity: Math.min(itemQuantity.inventoryItemQuantity, offerQuantity) };
  }
  return { groupPayload: group.payload, groupSkus, targetPresent, listingId, offerIdsBySku, quantitiesBySku, groupKeysBySku, inventoryItemPayloadsBySku, offerPayloadsBySku };
}

export async function buildVariationListingPermanentRemovalPlan(input: BuildVariationListingPermanentRemovalPlanInput): Promise<VariationListingPermanentRemovalPlan> {
  if (input.aggregate.group.last_confirmed_revision !== input.previousConfirmedRevision) throw new Error('Variation listing removal plan previous confirmed watermark does not match the aggregate.');
  requiredString(input.previousRevisionId, 'previous confirmed revision ID');
  if (input.previousRevision.revision_id !== input.previousRevisionId) throw new Error('Variation listing removal plan previous revision ID does not match the immutable revision row.');
  if (input.previousRevision.group_id !== input.aggregate.group.group_id) throw new Error('Variation listing removal plan previous revision belongs to another group.');
  if (input.snapshot !== undefined) {
    const root = object(input.snapshot, 'permanent-removal snapshot');
    if (root[removalMetadataKey] !== undefined) {
      const metadata = parseRemovalMetadata(input.snapshot);
      const intent = operationIntent(metadata);
      const operationPlan = [{ operationKey: OPERATION_KEY, operationKind: OPERATION_KIND, targetRef: metadata.groupKey, sequenceNo: 1, intentVersion: 1, intentDigest: digest(intent), intent }];
      return planFromSnapshotMetadata({
        snapshot: input.snapshot,
        groupId: input.aggregate.group.group_id,
        revisionId: input.revisionId,
        capturedDesiredRevision: input.aggregate.group.desired_revision,
        snapshotDigest: digest(input.snapshot),
        operationPlan,
      });
    }
    throw new Error('Existing permanent-removal revision is missing frozen metadata; rebuild is forbidden.');
  }
  const target = input.aggregate.variations.find((variation) => variation.variation_id === input.targetVariationId);
  if (!target) throw new Error('Variation listing removal target is not in the aggregate.');
  const survivors = input.aggregate.variations.filter((variation) => variation.variation_id !== input.targetVariationId);
  if (survivors.length < 2) throw new Error('Variation listing removal requires at least two survivors.');
  const group = exactPresent(await input.remote.getInventoryItemGroup(input.aggregate.group.group_key), 'Variation listing group');
  const expectedCurrentSkus = [target.sku, ...survivors.sort((a, b) => a.position - b.position).map((variation) => variation.sku)];
  if (!exactSkuSet(group.variantSKUs, expectedCurrentSkus)) throw new Error('Variation listing group membership does not exactly match the frozen aggregate.');
  const listingIds = new Set<string>();
  const offerIdsBySku: Record<string, string> = {};
  const quantitiesBySku: Record<string, { inventoryItemQuantity: number; offerQuantity: number; sellableQuantity: number }> = {};
  const inventoryItemPayloadsBySku: Record<string, Json> = {};
  const offerPayloadsBySku: Record<string, Json> = {};
  const seenOfferIds = new Set<string>();
  for (const variation of input.aggregate.variations) {
    const item = exactPresent(await input.remote.getInventoryItem(variation.sku), `Variation listing item ${variation.sku}`);
    if (item.sku !== variation.sku || !item.groupKeys || item.groupKeys.length !== 1 || item.groupKeys[0] !== input.aggregate.group.group_key) throw new Error(`Variation listing item ${variation.sku} identity/group association changed.`);
    const offers = exactPresent(await input.remote.getOffers(variation.sku, input.aggregate.group.marketplace_id), `Variation listing offers ${variation.sku}`);
    if (offers.length !== 1) throw new Error(`Variation listing SKU ${variation.sku} must have exactly one offer.`);
    const offer = offers[0]!;
    if (offer.sku !== variation.sku || offer.marketplaceId !== input.aggregate.group.marketplace_id || offer.status !== 'PUBLISHED' || offer.lifecycleClass !== 'active' || !offer.listingId) throw new Error(`Variation listing offer ${variation.sku} is not one active published offer.`);
    if (seenOfferIds.has(offer.offerId)) throw new Error(`Variation listing offer ${variation.sku} reuses another SKU's Offer ID.`);
    seenOfferIds.add(offer.offerId);
    listingIds.add(offer.listingId);
    offerIdsBySku[variation.sku] = offer.offerId;
    inventoryItemPayloadsBySku[variation.sku] = payloadWithoutQuantity(item.payload, 'item');
    offerPayloadsBySku[variation.sku] = payloadWithoutQuantity(offer.payload, 'offer');
    const itemQuantity = remoteQuantity(item.payload, variation.sku);
    const offerQuantity = readOfferQuantity(offer.payload, variation.sku);
    quantitiesBySku[variation.sku] = { inventoryItemQuantity: itemQuantity.inventoryItemQuantity, offerQuantity, sellableQuantity: Math.min(itemQuantity.inventoryItemQuantity, offerQuantity) };
  }
  if (listingIds.size !== 1) throw new Error('Variation listing offers do not resolve to one listing.');
  const targetQuantity = quantitiesBySku[target.sku]!;
  if (targetQuantity.inventoryItemQuantity !== 0 || targetQuantity.offerQuantity !== 0 || targetQuantity.sellableQuantity !== 0) throw new Error('Variation listing removal target must already be zero in Item and Offer.');
  const survivorSkus = survivors.sort((a, b) => a.position - b.position).map((variation) => variation.sku);
  const replacementGroupPayload = exactGroupPayload(group.payload, survivorSkus);
  const previousIdentity = reconstructConfirmedRemoteIdentity(input.previousRevision, input.previousCheckpoints);
  if (previousIdentity.listingId !== [...listingIds][0]) throw new Error('Variation listing previous confirmed listing identity changed.');
  for (const variation of input.aggregate.variations) {
    if (previousIdentity.offerIdsBySku[variation.sku] !== offerIdsBySku[variation.sku]) throw new Error(`Variation listing previous confirmed offer identity changed for ${variation.sku}.`);
  }
  const baseSnapshot = removalSnapshot({
    aggregate: input.aggregate,
    targetVariationId: input.targetVariationId,
    previousRevision: input.previousRevision,
    previousCheckpoints: input.previousCheckpoints,
    listingId: previousIdentity.listingId,
    offerIdsBySku,
    quantitiesBySku,
  });
  const intent = operationIntent({ groupKey: input.aggregate.group.group_key, targetSku: target.sku, survivorSkus });
  const operationPlan = [{ operationKey: OPERATION_KEY, operationKind: OPERATION_KIND, targetRef: input.aggregate.group.group_key, sequenceNo: 1, intentVersion: 1, intentDigest: digest(intent), intent }];
  const metadata = removalMetadata({
    groupKey: input.aggregate.group.group_key,
    targetVariationId: input.targetVariationId,
    targetSku: target.sku,
    marketplaceId: input.aggregate.group.marketplace_id,
    survivorSkus,
    listingId: [...listingIds][0]!,
    offerIdsBySku,
    quantitiesBySku,
    inventoryItemPayloadsBySku,
    offerPayloadsBySku,
    expectedGroupPayload: group.payload,
    replacementGroupPayload,
  });
  const snapshot = asJson({ ...object(baseSnapshot, 'permanent-removal snapshot'), [removalMetadataKey]: metadata });
  assertFrozenTargetCopyKeys(snapshot, input.aggregate, input.targetVariationId);
  const captureInput: CaptureVariationListingRevisionInput = {
    groupId: input.aggregate.group.group_id,
    revisionId: input.revisionId,
    capturedDesiredRevision: input.aggregate.group.desired_revision,
    snapshotVersion: 3,
    snapshot,
    snapshotDigest: digest(snapshot),
    operationPlan,
  };
  return {
    captureInput,
    groupKey: input.aggregate.group.group_key,
    targetVariationId: input.targetVariationId,
    targetSku: target.sku,
    marketplaceId: input.aggregate.group.marketplace_id,
    survivorSkus,
    listingId: [...listingIds][0]!,
    offerIdsBySku,
    quantitiesBySku,
    inventoryItemPayloadsBySku,
    offerPayloadsBySku,
    expectedGroupPayload: group.payload,
    replacementGroupPayload,
  };
}

function terminal(checkpoint: VariationListingPublishingCheckpointRow | null): boolean {
  return checkpoint?.state === 'confirmed_complete' || checkpoint?.state === 'confirmed_no_op';
}

function validateHistory(
  checkpoints: readonly VariationListingPublishingCheckpointRow[],
  revisionId: string
): VariationListingPublishingCheckpointRow[] {
  const ordered = [...checkpoints].sort((a, b) => a.attempt_number - b.attempt_number || a.checkpoint_number - b.checkpoint_number);
  for (const checkpoint of ordered) {
    if (checkpoint.revision_id !== revisionId || checkpoint.operation_key !== OPERATION_KEY) {
      throw new Error('Permanent-removal journal contains a checkpoint for another revision or operation.');
    }
  }
  return ordered;
}

async function append(input: ExecuteVariationListingPermanentRemovalInput, state: AppendVariationListingJournalCheckpointInput['state'], attemptNumber: number, checkpointNumber: number, evidence: Json, observedRemoteState: AppendVariationListingJournalCheckpointInput['observedRemoteState']): Promise<VariationListingPublishingCheckpointRow> {
  const result = await input.transaction.appendJournalCheckpoint({ revisionId: input.plan.captureInput.revisionId, operationKey: OPERATION_KEY, checkpointId: (input.checkpointId ?? randomUUID)(), attemptNumber, checkpointNumber, state, evidence, observedRemoteState });
  return result.checkpoint;
}

function exactPost(plan: VariationListingPermanentRemovalPlan, state: Awaited<ReturnType<typeof exactRemoteState>>): boolean {
  const targetGroupKeys = state.groupKeysBySku[plan.targetSku];
  const targetUngrouped = targetGroupKeys === null || targetGroupKeys.length === 0;
  const targetRepresentationKnown = targetUngrouped || canonicalJson(targetGroupKeys) === canonicalJson([plan.groupKey]);
  return !state.targetPresent && targetRepresentationKnown && exactSkuSet(state.groupSkus, plan.survivorSkus) && state.quantitiesBySku[plan.targetSku]?.inventoryItemQuantity === 0 && state.quantitiesBySku[plan.targetSku]?.offerQuantity === 0 && state.offerIdsBySku[plan.targetSku] === plan.offerIdsBySku[plan.targetSku] && canonicalJson(state.inventoryItemPayloadsBySku[plan.targetSku]) === canonicalJson(plan.inventoryItemPayloadsBySku[plan.targetSku]) && canonicalJson(state.offerPayloadsBySku[plan.targetSku]) === canonicalJson(plan.offerPayloadsBySku[plan.targetSku]) && plan.survivorSkus.every((sku) => canonicalJson(state.quantitiesBySku[sku]) === canonicalJson(plan.quantitiesBySku[sku]) && state.offerIdsBySku[sku] === plan.offerIdsBySku[sku] && canonicalJson(state.groupKeysBySku[sku]) === canonicalJson([plan.groupKey]) && canonicalJson(state.inventoryItemPayloadsBySku[sku]) === canonicalJson(plan.inventoryItemPayloadsBySku[sku]) && canonicalJson(state.offerPayloadsBySku[sku]) === canonicalJson(plan.offerPayloadsBySku[sku]));
}

function exactPre(plan: VariationListingPermanentRemovalPlan, state: Awaited<ReturnType<typeof exactRemoteState>>): boolean {
  const skus = [plan.targetSku, ...plan.survivorSkus];
  const itemsExact = skus.every((sku) => canonicalJson(state.groupKeysBySku[sku]) === canonicalJson([plan.groupKey]) && canonicalJson(state.inventoryItemPayloadsBySku[sku]) === canonicalJson(plan.inventoryItemPayloadsBySku[sku]) && canonicalJson(state.offerPayloadsBySku[sku]) === canonicalJson(plan.offerPayloadsBySku[sku]));
  return state.targetPresent && itemsExact && exactSkuSet(state.groupSkus, [plan.targetSku, ...plan.survivorSkus]) && canonicalJson(state.quantitiesBySku[plan.targetSku]) === canonicalJson(plan.quantitiesBySku[plan.targetSku]) && state.offerIdsBySku[plan.targetSku] === plan.offerIdsBySku[plan.targetSku] && state.quantitiesBySku[plan.targetSku]?.sellableQuantity === 0 && plan.survivorSkus.every((sku) => canonicalJson(state.quantitiesBySku[sku]) === canonicalJson(plan.quantitiesBySku[sku]) && state.offerIdsBySku[sku] === plan.offerIdsBySku[sku]);
}

export async function executeVariationListingPermanentRemoval(input: ExecuteVariationListingPermanentRemovalInput): Promise<{ revisionId: string; membershipConfirmed: true }> {
  const existing = await input.journal.loadRevision(input.plan.captureInput.revisionId);
  const captured = existing ?? (await input.transaction.capturePermanentRemovalRevision(input.plan.captureInput)).revision;
  if (captured.revision_id !== input.plan.captureInput.revisionId || captured.group_id !== input.plan.captureInput.groupId || captured.captured_desired_revision !== input.plan.captureInput.capturedDesiredRevision || captured.snapshot_version !== 3 || captured.snapshot_digest !== input.plan.captureInput.snapshotDigest || canonicalJson(captured.operation_plan) !== canonicalJson(input.plan.captureInput.operationPlan.map((operation) => ({ operation_key: operation.operationKey, operation_kind: operation.operationKind, target_ref: operation.targetRef, sequence_no: operation.sequenceNo, intent_version: operation.intentVersion, intent_digest: operation.intentDigest, intent: operation.intent })))) throw new Error('Captured permanent-removal revision does not match frozen plan.');
  // The immutable durable revision is the sole c2 proof and later image-key
  // source. Rehydrate it after capture instead of continuing with a mutable
  // in-memory plan assembled from the pre-capture aggregate.
  input = { ...input, plan: hydrateVariationListingPermanentRemovalPlan(captured) };
  const history = validateHistory(
    await input.journal.listCheckpoints(input.plan.captureInput.revisionId),
    input.plan.captureInput.revisionId
  );
  let current = history.at(-1) ?? null;
  if (current && current.operation_key !== OPERATION_KEY) throw new Error('Permanent-removal journal contains an unexpected operation.');
  if (current?.state === 'retry_exhausted') throw new Error('Permanent-removal bounded replay is exhausted; reconcile manually.');
  if (terminal(current)) {
    const state = await exactRemoteState(input.plan, input.remote);
    if (!exactPost(input.plan, state)) throw new Error('Permanent-removal terminal journal no longer reconciles to exact post-state.');
    return { revisionId: input.plan.captureInput.revisionId, membershipConfirmed: true };
  }
  let startedThisInvocation = false;
  if (!current) {
    current = await append(input, 'started', 1, 1, {}, null);
    startedThisInvocation = true;
  }
  let state: Awaited<ReturnType<typeof exactRemoteState>>;
  try {
    state = await exactRemoteState(input.plan, input.remote);
  } catch (error) {
    // A started operation with an unavailable or identity-conflicting read
    // has an unknown remote outcome. Persist that ambiguity before surfacing
    // the read failure; recovery may then reconcile once, but never blind
    // retry from an unresolved started checkpoint.
    if (current.state === 'started') {
      await append(input, 'unknown', current.attempt_number, current.checkpoint_number + 1, { reason: 'exact remote state read failed', error: error instanceof Error ? error.message : String(error) }, 'unknown');
    }
    throw error;
  }
  if (exactPost(input.plan, state)) {
    if (current.state === 'retry_authorized') {
      current = await append(input, 'started', current.attempt_number, current.checkpoint_number + 1, { reason: 'exact post-state observed during authorized replay reconciliation' }, null);
    }
    current = await append(input, 'confirmed_complete', current.attempt_number, current.checkpoint_number + 1, { listingId: state.listingId, survivorSkus: input.plan.survivorSkus, targetSku: input.plan.targetSku, state: 'removed' }, 'present');
    return { revisionId: input.plan.captureInput.revisionId, membershipConfirmed: true };
  }
  if (!exactPre(input.plan, state)) {
    await append(input, 'unknown', current.attempt_number, current.checkpoint_number + 1, { reason: 'remote state is neither exact pre-state nor exact post-state' }, 'unknown');
    throw new Error('Permanent-removal remote state is unknown; reconcile before retry.');
  }
  if (current.state === 'started' && current.attempt_number > 1) {
    throw new Error('Permanent-removal replay is already in progress; reconcile before another mutation.');
  }
  let replayAuthorized = current.state === 'unknown' || current.state === 'retry_authorized';
  if (current.state === 'started' && !startedThisInvocation) {
    current = await append(input, 'unknown', current.attempt_number, current.checkpoint_number + 1, { reason: 'prior execution may have started a mutation; bounded replay requires reconciliation checkpoint' }, 'unknown');
    current = await append(input, 'retry_authorized', current.attempt_number + 1, 1, { reason: 'exact pre-state permits one bounded replay after crash recovery' }, 'present');
    replayAuthorized = true;
  }
  if (replayAuthorized) {
    if (current.state === 'unknown') current = await append(input, 'retry_authorized', current.attempt_number + 1, 1, { reason: 'exact pre-state permits one bounded replay' }, 'present');
    current = await append(input, 'started', current.attempt_number, current.checkpoint_number + 1, {}, null);
  }
  try {
    await input.remote.replaceInventoryItemGroup(input.plan.groupKey, input.plan.replacementGroupPayload);
  } catch (error) {
    const afterError = error instanceof Error ? error.message : String(error);
    if (replayAuthorized) {
      // A second ambiguous write is terminal for this frozen revision. The
      // durable journal migration/parser must permit retry_exhausted with
      // unknown evidence; never claim an exact remote state from an exception.
      await append(input, 'retry_exhausted', current.attempt_number, current.checkpoint_number + 1, { error: afterError, reason: 'bounded replay returned an unknown outcome' }, 'unknown');
    } else {
      await append(input, 'unknown', current.attempt_number, current.checkpoint_number + 1, { error: afterError }, 'unknown');
    }
    throw error;
  }
  let after: Awaited<ReturnType<typeof exactRemoteState>>;
  try {
    after = await exactRemoteState(input.plan, input.remote);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await append(input, replayAuthorized ? 'retry_exhausted' : 'unknown', current.attempt_number, current.checkpoint_number + 1, { reason: 'post-mutation reconciliation read failed', error: reason }, 'unknown');
    throw error;
  }
  if (!exactPost(input.plan, after)) {
    await append(input, replayAuthorized ? 'retry_exhausted' : 'unknown', replayAuthorized ? current.attempt_number : current.attempt_number, replayAuthorized ? current.checkpoint_number + 1 : current.checkpoint_number + 1, { reason: 'replacement returned without exact post-state' }, replayAuthorized ? 'unknown' : 'unknown');
    throw new Error('Permanent-removal replacement returned without exact post-state.');
  }
  await append(input, 'confirmed_complete', replayAuthorized ? current.attempt_number : current.attempt_number, replayAuthorized ? current.checkpoint_number + 1 : 2, { listingId: after.listingId, survivorSkus: input.plan.survivorSkus, targetSku: input.plan.targetSku, state: 'removed' }, 'present');
  return { revisionId: input.plan.captureInput.revisionId, membershipConfirmed: true };
}
