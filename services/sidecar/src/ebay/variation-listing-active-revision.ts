import { createHash, randomUUID } from 'node:crypto';

import type {
  CaptureVariationListingRevisionInput,
  Json,
  VariationListingAggregateSnapshot,
  VariationListingPublishingCheckpointRow,
  VariationListingRevisionPlanOperationInput,
  VariationListingRevisionRow,
  VariationListingTransactionGateway,
  VariationListingVariationRow,
} from '@ebay-inventory/data';

import {
  buildVariationListingHistoricalInventoryPayloadBundle,
  buildVariationListingInventoryPayloadBundle,
  deriveVariationListingRawCardConditionDescriptors,
  variationListingEpsImageUrlSchema,
  type VariationListingInventoryPayloadBundle,
  type VariationListingRepresentativeImage,
} from '@/ebay/variation-listing-payloads.js';
import {
  type VariationListingMediaResource,
  type VariationListingPublicationReadGateway,
  type VariationListingRemoteOffer,
  type VariationListingRemoteMedia,
} from '@/ebay/variation-listing-publication.js';

const SNAPSHOT_VERSION = 3;
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

export interface VariationListingConfirmedRemoteQuantity {
  inventoryItemQuantity: number;
  offerQuantity: number;
  sellableQuantity: number;
}

export interface VariationListingConfirmedRemoteIdentity {
  listingId: string;
  offerIdsBySku: Record<string, string>;
  /** Present on YP8.2+ active revisions. A missing map is legacy intent and
   * is rejected before active execution rather than resuming local counts. */
  quantitiesBySku?: Record<string, VariationListingConfirmedRemoteQuantity>;
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

export function revisionSnapshotAggregate(revision: VariationListingRevisionRow): VariationListingAggregateSnapshot {
  const root = object(revision.snapshot, 'confirmed revision snapshot');
  if (revision.snapshot_version === 1) {
    const aggregate = object(root.aggregate, 'confirmed revision aggregate');
    return validateSnapshotAggregate(aggregate as unknown as VariationListingAggregateSnapshot);
  }
  if (revision.snapshot_version !== SNAPSHOT_VERSION) {
    throw new Error(`Unsupported confirmed variation listing snapshot version ${revision.snapshot_version}.`);
  }
  const aggregate = object(root.aggregate, 'confirmed active revision aggregate');
  const confirmed = object(root.confirmed, 'confirmed active revision parent');
  const confirmedAggregate = object(confirmed.aggregate, 'confirmed active revision parent aggregate');
  validateSnapshotAggregate(confirmedAggregate as unknown as VariationListingAggregateSnapshot);
  return validateSnapshotAggregate(aggregate as unknown as VariationListingAggregateSnapshot);
}

function quantityAdjustmentCounter(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < -2147483648 || value > 2147483647) {
    throw new Error(`Variation listing ${label} quantity adjustment counter must be an int32.`);
  }
  return value;
}

function validateSnapshotAggregate(aggregate: VariationListingAggregateSnapshot): VariationListingAggregateSnapshot {
  if (!Array.isArray(aggregate.variations)) {
    throw new Error('Variation listing confirmed revision aggregate variations must be an array.');
  }
  return {
    ...aggregate,
    variations: aggregate.variations.map((variation) => {
      const rawCounter = (variation as VariationListingVariationRow & { quantity_adjustment_counter?: unknown }).quantity_adjustment_counter;
      if (rawCounter === undefined) {
        throw new Error(`Variation listing confirmed revision variation ${variation.variation_id} is missing quantity_adjustment_counter.`);
      }
      return { ...variation, quantity_adjustment_counter: quantityAdjustmentCounter(rawCounter, `confirmed revision variation ${variation.variation_id}`) };
    }),
  };
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
  if (input.revision.snapshot_version === 1) {
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
  if (input.revision.snapshot_version !== SNAPSHOT_VERSION) {
    throw new Error(`Unsupported confirmed variation listing snapshot version ${input.revision.snapshot_version}.`);
  }
  if (!Array.isArray(root.representativeImages)) {
    throw new Error('Variation listing version-3 confirmed snapshot is missing representativeImages.');
  }
  const images = root.representativeImages.map((entry, index) =>
    parseRepresentativeImage(entry, `confirmed representative image ${index}`)
  );
  if (new Set(images.map((image) => image.copyId)).size !== images.length) {
    throw new Error('Variation listing confirmed representative image copy IDs must be unique.');
  }
  // A v3 snapshot may have captured a desired representative refresh before
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

const MAX_ACTIVE_QUANTITY = 2_147_483_647;

function requireRemoteQuantity(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > MAX_ACTIVE_QUANTITY) {
    throw new Error(`Variation listing ${label} must be a nonnegative int32.`);
  }
  return value;
}

function inventoryItemQuantity(payload: Json, sku: string): number {
  const root = object(payload, `remote inventory item ${sku}`);
  const availability = object(root.availability, `remote inventory item ${sku} availability`);
  const ship = object(availability.shipToLocationAvailability, `remote inventory item ${sku} shipToLocationAvailability`);
  return requireRemoteQuantity(ship.quantity, `remote inventory item ${sku} quantity`);
}

function offerQuantity(payload: Json, sku: string): number {
  return requireRemoteQuantity(object(payload, `remote offer ${sku}`).availableQuantity, `remote offer ${sku} availableQuantity`);
}

function inventoryPayloadWithoutQuantity(payload: Json, sku: string): Json {
  const clone = structuredClone(payload);
  const root = object(clone, `inventory item ${sku}`);
  const availability = object(root.availability, `inventory item ${sku} availability`);
  const ship = object(availability.shipToLocationAvailability, `inventory item ${sku} shipToLocationAvailability`);
  delete ship.quantity;
  return clone;
}

function offerPayloadWithoutQuantity(payload: Json, sku: string): Json {
  const clone = structuredClone(payload);
  delete object(clone, `offer ${sku}`).availableQuantity;
  return clone;
}

function parseConfirmedRemoteQuantity(value: unknown, sku: string): VariationListingConfirmedRemoteQuantity {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Variation listing frozen remote quantity for ${sku} must be an object.`);
  }
  const row = value as Record<string, unknown>;
  const inventoryItemQuantityValue = requireRemoteQuantity(row.inventoryItemQuantity, `frozen inventory item ${sku} quantity`);
  const offerQuantityValue = requireRemoteQuantity(row.offerQuantity, `frozen offer ${sku} quantity`);
  const sellableQuantity = requireRemoteQuantity(row.sellableQuantity, `frozen sellable ${sku} quantity`);
  if (sellableQuantity !== Math.min(inventoryItemQuantityValue, offerQuantityValue)) {
    throw new Error(`Variation listing frozen sellable quantity for ${sku} is inconsistent with eBay quantity authority.`);
  }
  return { inventoryItemQuantity: inventoryItemQuantityValue, offerQuantity: offerQuantityValue, sellableQuantity };
}

export function applyVariationListingConfirmedRemoteQuantities(
  bundle: VariationListingInventoryPayloadBundle,
  quantitiesBySku?: Record<string, VariationListingConfirmedRemoteQuantity>
): VariationListingInventoryPayloadBundle {
  const clone = structuredClone(bundle);
  if (!quantitiesBySku) return clone;
  for (const child of clone.children) {
    const quantity = parseConfirmedRemoteQuantity(quantitiesBySku[child.sku], child.sku);
    child.inventoryItem.availability.shipToLocationAvailability.quantity = quantity.inventoryItemQuantity;
    child.offer.availableQuantity = quantity.offerQuantity;
    child.quantity = quantity.sellableQuantity;
  }
  return clone;
}

function applyUniformActiveQuantities(
  bundle: VariationListingInventoryPayloadBundle,
  quantitiesBySku: Readonly<Record<string, number>>
): VariationListingInventoryPayloadBundle {
  const clone = structuredClone(bundle);
  for (const child of clone.children) {
    const quantity = requireRemoteQuantity(quantitiesBySku[child.sku], `desired ${child.sku} quantity`);
    child.inventoryItem.availability.shipToLocationAvailability.quantity = quantity;
    child.offer.availableQuantity = quantity;
    child.quantity = quantity;
  }
  return clone;
}

function desiredActiveQuantities(
  current: VariationListingAggregateSnapshot,
  previous: VariationListingAggregateSnapshot,
  remoteQuantities: Readonly<Record<string, VariationListingConfirmedRemoteQuantity>>
): Record<string, number> {
  const previousVariationsById = new Map(previous.variations.map((variation) => [variation.variation_id, variation]));
  const quantities: Record<string, number> = {};
  for (const variation of current.variations) {
    const currentCounter = quantityAdjustmentCounter(
      (variation as VariationListingVariationRow & { quantity_adjustment_counter?: unknown }).quantity_adjustment_counter,
      `current variation ${variation.variation_id}`
    );
    const copies = current.copies.filter((copy) => copy.variation_id === variation.variation_id);
    const previousVariation = previousVariationsById.get(variation.variation_id);
    if (!previousVariation) {
      quantities[variation.sku] = copies.filter((copy) => copy.availability_state === 'available').length;
      continue;
    }

    const previousCounter = quantityAdjustmentCounter(
      (previousVariation as VariationListingVariationRow & { quantity_adjustment_counter?: unknown }).quantity_adjustment_counter,
      `previous variation ${variation.sku}`
    );

    const baseline = parseConfirmedRemoteQuantity(remoteQuantities[variation.sku], variation.sku).sellableQuantity;
    const adjustmentDelta = currentCounter - previousCounter;
    if (!Number.isSafeInteger(adjustmentDelta)) {
      throw new Error(`Variation listing quantity adjustment delta for ${variation.sku} is invalid.`);
    }
    const desired = baseline + adjustmentDelta;
    if (!Number.isSafeInteger(desired) || desired < 0) {
      throw new Error(`Variation listing desired quantity for ${variation.sku} cannot be negative.`);
    }
    if (desired > MAX_ACTIVE_QUANTITY) {
      throw new Error(`Variation listing desired quantity for ${variation.sku} exceeds the supported int32 range.`);
    }
    quantities[variation.sku] = desired;
  }
  return quantities;
}

export async function reconcilePublishedQuantityBaseline(
  remote: VariationListingPublicationReadGateway,
  expected: VariationListingInventoryPayloadBundle,
  expectedRemoteIdentity?: Pick<VariationListingConfirmedRemoteIdentity, 'listingId' | 'offerIdsBySku'>
): Promise<{
  listingId: string;
  offers: VariationListingRemoteOffer[];
  quantitiesBySku: Record<string, VariationListingConfirmedRemoteQuantity>;
}> {
  if (activeGroup(await remote.getInventoryItemGroup(expected.groupKey), expected.group) === null) {
    throw new Error('Variation listing confirmed group no longer matches the last confirmed structural revision.');
  }

  const offers: VariationListingRemoteOffer[] = [];
  const quantitiesBySku: Record<string, VariationListingConfirmedRemoteQuantity> = {};
  const listingIds = new Set<string>();
  const offerIds = new Set<string>();
  for (const child of expected.children) {
    const itemRead = await remote.getInventoryItem(child.sku);
    if (itemRead.state === 'unknown') throw new Error(`Variation listing item ${child.sku} read is unknown: ${itemRead.reason}`);
    if (itemRead.state === 'proven_absent') throw new Error(`Variation listing confirmed item ${child.sku} is proven absent.`);
    if (itemRead.value.sku !== child.sku || itemRead.value.groupKeys?.length !== 1 || itemRead.value.groupKeys[0] !== expected.groupKey) {
      throw new Error(`Variation listing confirmed item ${child.sku} identity/group association changed.`);
    }
    if (canonicalJson(inventoryPayloadWithoutQuantity(itemRead.value.payload, child.sku)) !== canonicalJson(inventoryPayloadWithoutQuantity(asJson(child.inventoryItem), child.sku))) {
      throw new Error(`Variation listing confirmed item ${child.sku} changed outside quantity.`);
    }

    const offerRead = await remote.getOffers(child.sku, child.offer.marketplaceId);
    if (offerRead.state === 'unknown') throw new Error(`Variation listing offer ${child.sku} read is unknown: ${offerRead.reason}`);
    if (offerRead.state === 'proven_absent' || offerRead.value.length !== 1) {
      throw new Error(`Variation listing confirmed SKU ${child.sku} must have exactly one remote offer.`);
    }
    const offer = offerRead.value[0]!;
    if (
      offer.sku !== child.sku ||
      offer.marketplaceId !== child.offer.marketplaceId ||
      offer.status !== 'PUBLISHED' ||
      offer.lifecycleClass !== 'active' ||
      !offer.listingId
    ) {
      throw new Error(`Variation listing confirmed offer ${child.sku} is not one active owned offer.`);
    }
    if (
      expectedRemoteIdentity &&
      (offer.offerId !== expectedRemoteIdentity.offerIdsBySku[child.sku] || offer.listingId !== expectedRemoteIdentity.listingId)
    ) {
      throw new Error(`Variation listing confirmed offer ${child.sku} does not match the durable previous revision identity.`);
    }
    if (canonicalJson(offerPayloadWithoutQuantity(offer.payload, child.sku)) !== canonicalJson(offerPayloadWithoutQuantity(asJson(child.offer), child.sku))) {
      throw new Error(`Variation listing confirmed offer ${child.sku} changed outside quantity.`);
    }
    if (offerIds.has(offer.offerId)) throw new Error('Variation listing remote offer IDs must be unique.');
    offerIds.add(offer.offerId);
    listingIds.add(offer.listingId);
    offers.push(offer);

    const inventoryQuantity = inventoryItemQuantity(itemRead.value.payload, child.sku);
    const currentOfferQuantity = offerQuantity(offer.payload, child.sku);
    quantitiesBySku[child.sku] = {
      inventoryItemQuantity: inventoryQuantity,
      offerQuantity: currentOfferQuantity,
      // eBay documents the effective listing quantity as the lower value when
      // both Inventory Item and Offer quantities are populated.
      sellableQuantity: Math.min(inventoryQuantity, currentOfferQuantity),
    };
  }
  if (listingIds.size !== 1) throw new Error('Variation listing confirmed offers do not resolve to one listing ID.');
  return { listingId: [...listingIds][0]!, offers, quantitiesBySku };
}

function requiredEvidenceObject(row: VariationListingPublishingCheckpointRow, operationKey: string): Record<string, Json> {
  if (row.state !== 'confirmed_complete' && row.state !== 'confirmed_no_op') {
    throw new Error(`Variation listing previous revision operation ${operationKey} has no terminal identity evidence.`);
  }
  if (row.observed_remote_state !== 'present') {
    throw new Error(`Variation listing previous revision operation ${operationKey} terminal evidence is not confirmed present.`);
  }
  return object(row.evidence, `previous revision operation ${operationKey} evidence`);
}

function durableCheckpoint(
  checkpointsByOperation: Map<string, VariationListingPublishingCheckpointRow[]>,
  operationKey: string
): VariationListingPublishingCheckpointRow {
  const rows = checkpointsByOperation.get(operationKey);
  if (!rows || rows.length === 0) {
    throw new Error(`Variation listing previous revision is missing terminal checkpoint ${operationKey}.`);
  }
  const ordered = [...rows].sort((left, right) => left.attempt_number - right.attempt_number || left.checkpoint_number - right.checkpoint_number);
  const row = ordered.at(-1)!;
  requiredEvidenceObject(row, operationKey);
  return row;
}

function optionalEvidenceString(value: Json | undefined, label: string): string | null {
  if (value === undefined || value === null) return null;
  return activeString(value, label);
}

/** Reconstruct the last-confirmed remote identities from its immutable
 * operation/checkpoint evidence. Current eBay reads are only accepted when
 * they match these durable IDs; they are never an identity-adoption source. */
export function reconstructConfirmedRemoteIdentity(
  revision: VariationListingRevisionRow,
  checkpoints: readonly VariationListingPublishingCheckpointRow[]
): Pick<VariationListingConfirmedRemoteIdentity, 'listingId' | 'offerIdsBySku'> {
  const aggregate = revisionSnapshotAggregate(revision);
  const operations = Array.isArray(revision.operation_plan)
    ? revision.operation_plan as unknown as { operation_key: string; operation_kind: string; target_ref?: string }[]
    : [];
  const normalizedOperations = operations.map((operation) => ({
    key: operation.operation_key,
    kind: operation.operation_kind,
    targetRef: operation.target_ref,
  }));
  const byKey = new Map<string, { key: string; kind: string }>();
  for (const operation of normalizedOperations) {
    if (!operation.key || byKey.has(operation.key)) throw new Error('Variation listing previous revision operation keys must be unique.');
    byKey.set(operation.key, operation);
  }
  if (revision.operation_count !== normalizedOperations.length) {
    throw new Error('Variation listing previous revision operation count does not match its durable plan.');
  }
  const checkpointsByOperation = new Map<string, VariationListingPublishingCheckpointRow[]>();
  for (const checkpoint of checkpoints) {
    if (checkpoint.revision_id !== revision.revision_id || !byKey.has(checkpoint.operation_key)) {
      throw new Error('Variation listing previous revision checkpoint does not belong to its durable operation plan.');
    }
    checkpointsByOperation.set(checkpoint.operation_key, [...(checkpointsByOperation.get(checkpoint.operation_key) ?? []), checkpoint]);
  }

  const expectedVariationIds = new Set(aggregate.variations.map((variation) => variation.variation_id));
  const expectedSkus = new Set(aggregate.variations.map((variation) => variation.sku));
  const childOfferOperations = normalizedOperations.filter((operation) => operation.kind === 'child_offer_write');
  const offerIdsBySku: Record<string, string> = {};
  const listingIds = new Set<string>();
  const terminalOfferIds = new Map<string, string>();

  // v3 active revisions inherit the previously confirmed remote IDs in their
  // immutable snapshot. Sparse active plans therefore only need journal
  // evidence for offers that actually changed or were newly created.
  if (revision.snapshot_version === SNAPSHOT_VERSION) {
    const root = object(revision.snapshot, 'confirmed active revision snapshot');
    const confirmed = object(root.confirmed, 'confirmed active revision parent');
    const remote = object(confirmed.remote, 'confirmed active revision remote identity');
    const inheritedListingId = activeString(remote.listingId, 'confirmed active revision listingId');
    const inheritedOfferIds = object(remote.offerIdsBySku, 'confirmed active revision offerIdsBySku');
    listingIds.add(inheritedListingId);
    for (const [sku, rawOfferId] of Object.entries(inheritedOfferIds)) {
      if (!expectedSkus.has(sku)) {
        throw new Error(`Variation listing previous revision inherited an unknown SKU ${sku}.`);
      }
      const offerId = activeString(rawOfferId, `confirmed active revision offerIdsBySku.${sku}`);
      if (Object.values(offerIdsBySku).includes(offerId)) {
        throw new Error('Variation listing previous revision inherited offer IDs must be unique.');
      }
      offerIdsBySku[sku] = offerId;
    }
  } else if (childOfferOperations.length !== expectedVariationIds.size) {
    throw new Error('Variation listing previous revision child-offer operation coverage is incomplete.');
  }
  for (const operation of childOfferOperations) {
    const variationId = operation.key.startsWith('child-offer:') ? operation.key.slice('child-offer:'.length) : '';
    if (!expectedVariationIds.has(variationId)) throw new Error(`Variation listing previous revision has an unknown child-offer operation ${operation.key}.`);
    const evidence = requiredEvidenceObject(durableCheckpoint(checkpointsByOperation, operation.key), operation.key);
    // Active price revisions record Offer identity beside Trading price proof;
    // older checkpoints record the Offer identity directly.
    const offerEvidence = Object.prototype.hasOwnProperty.call(evidence, 'offer')
      ? object(evidence.offer, `previous revision ${operation.key} offer evidence`)
      : evidence;
    if (offerEvidence !== evidence && ('offerId' in evidence || 'sku' in evidence || 'listingId' in evidence)) {
      throw new Error(`Variation listing previous revision ${operation.key} contains ambiguous Offer identity evidence.`);
    }
    const offerId = activeString(offerEvidence.offerId, `previous revision ${operation.key} offerId`);
    const sku = activeString(offerEvidence.sku, `previous revision ${operation.key} sku`);
    const variation = aggregate.variations.find((candidate) => candidate.variation_id === variationId)!;
    if (sku !== variation.sku || operation.targetRef !== variation.sku || !expectedSkus.has(sku)) throw new Error(`Variation listing previous revision ${operation.key} SKU coverage is invalid.`);
    const inheritedOfferId = offerIdsBySku[sku];
    if (inheritedOfferId && inheritedOfferId !== offerId) {
      throw new Error(`Variation listing previous revision ${operation.key} changed an existing offer identity.`);
    }
    if (!inheritedOfferId && Object.values(offerIdsBySku).includes(offerId)) {
      throw new Error('Variation listing previous revision offer IDs must be unique.');
    }
    offerIdsBySku[sku] = offerId;
    terminalOfferIds.set(variationId, offerId);
    const listingId = optionalEvidenceString(offerEvidence.listingId, `previous revision ${operation.key} listingId`);
    if (listingId) listingIds.add(listingId);
  }

  for (const operation of normalizedOperations.filter((entry) => entry.key.startsWith('publish-offer:'))) {
    const variationId = operation.key.slice('publish-offer:'.length);
    if (!expectedVariationIds.has(variationId)) throw new Error(`Variation listing previous revision has an unknown publish-offer operation ${operation.key}.`);
    const evidence = requiredEvidenceObject(durableCheckpoint(checkpointsByOperation, operation.key), operation.key);
    const offerId = activeString(evidence.offerId, `previous revision ${operation.key} offerId`);
    const sku = activeString(evidence.sku, `previous revision ${operation.key} sku`);
    const variation = aggregate.variations.find((candidate) => candidate.variation_id === variationId)!;
    if (sku !== variation.sku || terminalOfferIds.get(variationId) !== offerId) throw new Error(`Variation listing previous revision ${operation.key} identity does not match its child-offer evidence.`);
    const listingId = optionalEvidenceString(evidence.listingId, `previous revision ${operation.key} listingId`);
    if (!listingId) throw new Error(`Variation listing previous revision ${operation.key} is missing listingId evidence.`);
    listingIds.add(listingId);
  }

  const listingIdentityOperations = normalizedOperations.filter((operation) => operation.key === 'group-publish' || operation.key === 'revision-reconcile');
  for (const operation of listingIdentityOperations) {
    const evidence = requiredEvidenceObject(durableCheckpoint(checkpointsByOperation, operation.key), operation.key);
    const listingId = activeString(evidence.listingId, `previous revision ${operation.key} listingId`);
    listingIds.add(listingId);
  }
  if (Object.keys(offerIdsBySku).length !== expectedSkus.size || listingIds.size !== 1) {
    throw new Error('Variation listing previous revision remote identity evidence does not cover exact SKUs and one listing.');
  }
  return { listingId: [...listingIds][0]!, offerIdsBySku };
}

async function verifyFrozenRemoteBaseline(
  input: VariationListingActiveRevisionExecutionInput,
  reprepareOnQuantityDrift: boolean,
): Promise<void> {
  const frozenQuantities = input.frozen.snapshot.confirmed.remote.quantitiesBySku;
  if (!frozenQuantities) return;
  let observed: Awaited<ReturnType<typeof reconcilePublishedQuantityBaseline>>;
  try {
    observed = await reconcilePublishedQuantityBaseline(
      input.remote,
      input.frozen.confirmedBundle,
      input.frozen.snapshot.confirmed.remote
    );
  } catch (error) {
    if (reprepareOnQuantityDrift) {
      throw new Error(`active_revision_reprepare_required: ${error instanceof Error ? error.message : String(error)}`);
    }
    throw error;
  }
  if (canonicalJson(asJson(observed.quantitiesBySku)) !== canonicalJson(asJson(frozenQuantities))) {
    if (reprepareOnQuantityDrift) {
      throw new Error('active_revision_reprepare_required: Variation listing active revision remote quantity changed after freeze; stage a new change and prepare again before mutation.');
    }
    throw new Error('Variation listing active revision remote quantity changed after freeze; capture is forbidden until the revision is reprepared.');
  }
}

/** Trading GetItem is the listing-facing price authority.  Verify the entire
 * frozen sibling set before the first active-revision write so a stale price
 * cannot be hidden by a successful Item/Offer quantity update.  Existing
 * operation history is intentionally handled by the journal/reconciliation
 * path; this gate only protects a clean revision before remote mutation. */
async function verifyFrozenListingPriceBaseline(
  input: VariationListingActiveRevisionExecutionInput,
): Promise<void> {
  const getListing = input.remote.getListing;
  if (!getListing) {
    throw new Error('Variation listing active revision requires a listing-facing Trading GetItem read before mutation.');
  }
  const listingId = input.frozen.snapshot.confirmed.remote.listingId;
  const listing = await getListing(listingId);
  const confirmedVariationIds = new Set(
    input.frozen.snapshot.confirmed.aggregate.variations.map((variation) => variation.variation_id),
  );
  const hasNewVariation = input.frozen.snapshot.aggregate.variations.some(
    (variation) => !confirmedVariationIds.has(variation.variation_id),
  );
  if (hasNewVariation) {
    // A newly staged child is expected to be absent until its create/publish
    // operations run. Validate every frozen sellable sibling without treating
    // that not-yet-owned SKU (or a collision) as an existing listing member.
    const prices = listingVariationPrices(listing, listingId, true);
    const confirmedSkus = new Set(input.frozen.confirmedBundle.children.map((child) => child.sku));
    const stagedNewSkus = new Set(
      input.frozen.snapshot.aggregate.variations
        .filter((variation) => !confirmedVariationIds.has(variation.variation_id))
        .map((variation) => variation.sku),
    );
    const confirmedSellableSkus = new Set(
      input.frozen.confirmedBundle.children
        .filter((child) => child.quantity > 0)
        .map((child) => child.sku),
    );
    const unexpectedSku = [...prices.keys()].find((sku) => !confirmedSellableSkus.has(sku));
    if (unexpectedSku && stagedNewSkus.has(unexpectedSku)) {
      throw new Error(`Variation listing new offer ${unexpectedSku} must be absent before create.`);
    }
    if (unexpectedSku && !confirmedSkus.has(unexpectedSku)) {
      throw new Error('Variation listing frozen active revision pre-state SKU set contains an unknown listing-facing sibling.');
    }
    if (unexpectedSku) {
      throw new Error('Variation listing frozen active revision pre-state SKU set does not match sellable listing-facing siblings.');
    }
    for (const child of input.frozen.confirmedBundle.children.filter((candidate) => candidate.quantity > 0)) {
      const observed = prices.get(child.sku);
      const expected = expectedOfferPrice(child);
      if (!observed || observed.currency !== expected.currency || observed.value !== expected.value) {
        throw new Error(`Variation listing frozen active revision pre-state price ${child.sku} does not match the frozen listing-facing sibling.`);
      }
    }
    return;
  }
  assertListingPriceSet(
    listing,
    listingId,
    input.frozen.confirmedBundle.children,
    'frozen active revision pre-state',
    false,
    true,
  );
}

function hasActiveRemoteMutation(
  frozen: VariationListingFrozenActiveRevision,
): boolean {
  return frozen.captureInput.operationPlan.some((operation) =>
    !['revision_reconcile', 'final_absence_verification'].includes(operation.operationKind)
  );
}

export async function prepareVariationListingFrozenActiveRevision(
  input: PrepareVariationListingActiveRevisionInput
): Promise<VariationListingFrozenActiveRevision> {
  const current = structuredClone(input.currentAggregate);
  current.group.condition_descriptors = deriveVariationListingRawCardConditionDescriptors(
    current.group.category_id,
    current.group.condition_token
  );
  if (current.group.lifecycle_state !== 'active') {
    throw new Error('Variation listing active revision requires lifecycle_state active.');
  }
  if (current.group.last_confirmed_revision === null) {
    throw new Error('Variation listing active revision requires a confirmed revision watermark.');
  }
  if (current.group.desired_revision <= current.group.last_confirmed_revision) {
    throw new Error('Variation listing active revision requires staged desired changes.');
  }
  // YP9.6c1: a locally staged permanent removal must not be mistaken for a
  // regular active revision until its remote-removal executor is implemented.
  if (current.variations.some((variation) =>
    (variation as typeof variation & { pending_removal_at?: unknown }).pending_removal_at != null
  )) {
    throw new Error('permanent_removal_not_implemented: staged variation removal cannot be published yet.');
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
  const localConfirmedBundle = buildVariationListingHistoricalInventoryPayloadBundle({
    aggregate: previousAggregate,
    representativeImages: previousImages,
  });
  const durableRemoteIdentity = reconstructConfirmedRemoteIdentity(input.previousRevision, input.previousCheckpoints);
  const confirmedRemote = await reconcilePublishedQuantityBaseline(input.remote, localConfirmedBundle, durableRemoteIdentity);
  const remoteIdentity = {
    listingId: durableRemoteIdentity.listingId,
    offerIdsBySku: durableRemoteIdentity.offerIdsBySku,
    quantitiesBySku: confirmedRemote.quantitiesBySku,
  } satisfies VariationListingConfirmedRemoteIdentity;
  const confirmedBundle = applyVariationListingConfirmedRemoteQuantities(
    localConfirmedBundle,
    remoteIdentity.quantitiesBySku
  );
  const desiredQuantitiesBySku = desiredActiveQuantities(
    current,
    previousAggregate,
    confirmedRemote.quantitiesBySku
  );

  const mediaResources = structuredClone([...(input.mediaResources ?? [])]);
  const desiredImages = resolveDesiredRepresentativeImages({
    current,
    previous: previousAggregate,
    previousImages,
    mediaResources,
  });
  const planningImages = new Map(desiredImages.representativeImages.map((image) => [image.copyId, image]));
  for (const copyId of desiredImages.unresolvedMediaCopyIds) {
    const token = digestJson(copyId).slice(0, 24);
    planningImages.set(copyId, {
      copyId,
      frontEpsUrl: `https://i.ebayimg.com/images/g/${token}-front/s-l1600.jpg`,
      backEpsUrl: `https://i.ebayimg.com/images/g/${token}-back/s-l1600.jpg`,
    });
  }
  const planningRepresentativeImages = [...new Set(current.variations.map((variation) => variation.representative_copy_id))].map((copyId) => {
    if (!copyId) throw new Error('Variation listing active revision has a missing representative copy.');
    const image = planningImages.get(copyId);
    if (!image) throw new Error(`Variation listing representative copy ${copyId} has no structural image input.`);
    return image;
  });
  const desiredBundleForPlanning = applyUniformActiveQuantities(
    buildVariationListingInventoryPayloadBundle({
      aggregate: current,
      representativeImages: planningRepresentativeImages,
    }),
    desiredQuantitiesBySku
  );
  const desiredBundlePreview = desiredImages.unresolvedMediaCopyIds.length === 0
    ? desiredBundleForPlanning
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
  const unresolvedMediaCopyIds = new Set(desiredImages.unresolvedMediaCopyIds);
  const confirmedChildByVariation = new Map(confirmedBundle.children.map((child) => [child.variationId, child]));
  const desiredChildByVariation = new Map(desiredBundleForPlanning.children.map((child) => [child.variationId, child]));
  for (const variation of [...current.variations].sort((a, b) => a.position - b.position)) {
    const existed = previousAggregate.variations.some((candidate) => candidate.variation_id === variation.variation_id);
    const previousChild = confirmedChildByVariation.get(variation.variation_id);
    const desiredChild = desiredChildByVariation.get(variation.variation_id);
    if (!desiredChild) throw new Error(`Variation listing desired payload is missing variation ${variation.variation_id}.`);
    const representativeNeedsMedia = variation.representative_copy_id !== null && unresolvedMediaCopyIds.has(variation.representative_copy_id);
    const itemChanged = !existed || !previousChild || representativeNeedsMedia ||
      canonicalJson(asJson(previousChild.inventoryItem)) !== canonicalJson(asJson(desiredChild.inventoryItem));
    const offerChanged = !existed || !previousChild ||
      canonicalJson(asJson(previousChild.offer)) !== canonicalJson(asJson(desiredChild.offer));
    if (itemChanged) {
      operations.push(operation({
        sequenceNo: sequenceNo++,
        key: `child-item:${variation.variation_id}`,
        kind: 'child_inventory_item_write',
        targetRef: variation.sku,
        intent: asJson({ existed, sku: variation.sku, variationId: variation.variation_id }),
      }));
    }
    if (offerChanged) {
      operations.push(operation({
        sequenceNo: sequenceNo++,
        key: `child-offer:${variation.variation_id}`,
        kind: 'child_offer_write',
        targetRef: variation.sku,
        intent: asJson({ existed, sku: variation.sku, variationId: variation.variation_id }),
      }));
    }
  }
  const groupChanged = canonicalJson(asJson(confirmedBundle.group)) !== canonicalJson(asJson(desiredBundleForPlanning.group));
  if (groupChanged) {
    operations.push(operation({
      sequenceNo: sequenceNo++,
      key: 'complete-group',
      kind: 'complete_group_replace',
      targetRef: current.group.group_key,
      intent: asJson({ groupId: current.group.group_id, groupKey: current.group.group_key }),
    }));
  }
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

/** Mutation seam used only by an already-active revision. The initial publish
 * executor remains in variation-listing-publication.ts; active revisions use
 * targeted offer/bulk price mutations and never call a fresh group publish for
 * an existing offer. */
export interface VariationListingActiveMutationGateway {
  createMedia?: (sourceUrl: string) => Promise<VariationListingRemoteMedia>;
  createOffer: (payload: Json) => Promise<{ offerId: string }>;
  createOrReplaceInventoryItem: (sku: string, payload: Json) => Promise<void>;
  createOrReplaceInventoryItemGroup: (groupKey: string, payload: Json) => Promise<void>;
  publishOffer: (offerId: string) => Promise<{ listingId: string }>;
  /** Update a published offer's price/quantity through the Inventory API's
   * listing-facing bulk endpoint. `updateOffer` remains the fallback for
   * offer fields that are not covered by this endpoint. */
  bulkUpdatePriceQuantity?: (payload: Json) => Promise<Json | void>;
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
    /** Trading GetItem listing-facing read. Inventory Offer reads are not
     * sufficient evidence that a published multi-variation price changed. */
    getListing?: (listingId: string) => Promise<unknown>;
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
  /** Reconcile an existing frozen revision using remote reads only. Never invoke an eBay mutation. */
  readOnlyReconcile?: boolean;
  checkpointId?: () => string;
}

export interface VariationListingActiveRevisionExecutionResult {
  confirmedRevision: number;
  listingId: string;
  revisionId: string;
}

/**
 * Read-only reconciliation deliberately has no provider mutation capability.
 * Keep this boundary inside the executor (rather than trusting callers to
 * pass a harmless gateway) so an accidental mutation path fails before it can
 * reach an eBay client.
 */
const readOnlyActiveMutationGateway: VariationListingActiveMutationGateway = {
  createMedia: async () => { throw new Error('Variation listing read-only reconciliation attempted Media mutation.'); },
  createOffer: async () => { throw new Error('Variation listing read-only reconciliation attempted Offer mutation.'); },
  createOrReplaceInventoryItem: async () => { throw new Error('Variation listing read-only reconciliation attempted Inventory Item mutation.'); },
  createOrReplaceInventoryItemGroup: async () => { throw new Error('Variation listing read-only reconciliation attempted Inventory Item Group mutation.'); },
  publishOffer: async () => { throw new Error('Variation listing read-only reconciliation attempted publish mutation.'); },
  bulkUpdatePriceQuantity: async () => { throw new Error('Variation listing read-only reconciliation attempted bulk price/quantity mutation.'); },
  updateOffer: async () => { throw new Error('Variation listing read-only reconciliation attempted Offer update mutation.'); },
};

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

function hasListingMutationCheckpoint(
  frozen: VariationListingFrozenActiveRevision,
  checkpoints: readonly VariationListingPublishingCheckpointRow[]
): boolean {
  const listingMutationOperationKeys = new Set(
    frozen.captureInput.operationPlan
      .filter((operation) =>
        ['child_inventory_item_write', 'child_offer_write', 'complete_group_replace', 'group_publish']
          .includes(operation.operationKind)
      )
      .map((operation) => operation.operationKey)
  );
  const byOperation = new Map<string, VariationListingPublishingCheckpointRow[]>();
  for (const checkpoint of checkpoints) {
    if (!listingMutationOperationKeys.has(checkpoint.operation_key)) continue;
    byOperation.set(checkpoint.operation_key, [...(byOperation.get(checkpoint.operation_key) ?? []), checkpoint]);
  }
  return [...byOperation.values()].some((rows) => activeLatest(rows)?.state !== 'confirmed_no_op');
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

function validateFrozenActiveOperationPlanCompleteness(
  frozen: VariationListingFrozenActiveRevision
): void {
  const operationsByKey = new Map(
    frozen.captureInput.operationPlan.map((operation) => [operation.operationKey, operation])
  );
  const requireOperation = (operationKey: string, operationKind: string): void => {
    const operation = operationsByKey.get(operationKey);
    if (!operation || operation.operationKind !== operationKind) {
      throw new Error(
        `Variation listing active revision frozen plan is missing required ${operationKey} (${operationKind}) operation.`
      );
    }
  };

  const previousVariationIds = new Set(
    frozen.snapshot.confirmed.aggregate.variations.map((variation) => variation.variation_id)
  );
  const confirmedQuantities = frozen.snapshot.confirmed.remote.quantitiesBySku;
  // A malformed v3 snapshot without frozen eBay quantities must reach the
  // established reprepare/reconciliation gate below rather than fail here with
  // a misleading frozen-plan error.
  if (!confirmedQuantities) return;
  const desiredQuantities = desiredActiveQuantities(
    frozen.snapshot.aggregate,
    frozen.snapshot.confirmed.aggregate,
    confirmedQuantities
  );
  for (const variation of frozen.snapshot.aggregate.variations) {
    if (!previousVariationIds.has(variation.variation_id)) continue;
    const confirmed = parseConfirmedRemoteQuantity(confirmedQuantities[variation.sku], variation.sku);
    const desired = requireRemoteQuantity(
      desiredQuantities[variation.sku],
      `frozen desired ${variation.sku} quantity`
    );
    if (desired !== confirmed.inventoryItemQuantity) {
      requireOperation(`child-item:${variation.variation_id}`, 'child_inventory_item_write');
    }
    if (desired !== confirmed.offerQuantity) {
      requireOperation(`child-offer:${variation.variation_id}`, 'child_offer_write');
    }
  }

  const newVariations = frozen.snapshot.aggregate.variations.filter(
    (variation) => !previousVariationIds.has(variation.variation_id)
  );
  for (const variation of newVariations) {
    requireOperation(`child-item:${variation.variation_id}`, 'child_inventory_item_write');
    requireOperation(`child-offer:${variation.variation_id}`, 'child_offer_write');
    requireOperation(`publish-offer:${variation.variation_id}`, 'group_publish');
  }

  // New variations always alter group membership, so the group replacement
  // must be frozen alongside their child writes. Existing-child sparse plans
  // may omit this operation when no new child is present.
  if (newVariations.length > 0) {
    requireOperation('complete-group', 'complete_group_replace');
  }
}

function validateReadOnlyFrozenIdentity(
  frozen: VariationListingFrozenActiveRevision,
  history: ActiveHistory,
): void {
  const snapshot = frozen.snapshot;
  const orderedOperations = [...frozen.captureInput.operationPlan].sort((left, right) => left.sequenceNo - right.sequenceNo);
  if (orderedOperations.length === 0 || orderedOperations.some((operation, index) => operation.sequenceNo !== index + 1) || new Set(orderedOperations.map((operation) => operation.operationKey)).size !== orderedOperations.length) {
    throw new Error('Variation listing read-only reconciliation frozen operation identity is incomplete.');
  }
  const currentSkus = snapshot.aggregate.variations.map((variation) => variation.sku);
  const confirmedSkus = snapshot.confirmed.aggregate.variations.map((variation) => variation.sku);
  const unique = (values: readonly string[], label: string): Set<string> => {
    if (values.some((value) => typeof value !== 'string' || value.trim() === '') || new Set(values).size !== values.length) {
      throw new Error(`Variation listing read-only reconciliation ${label} identity is incomplete.`);
    }
    return new Set(values);
  };
  const currentSet = unique(currentSkus, 'current SKU');
  const confirmedSet = unique(confirmedSkus, 'confirmed SKU');
  if (![...confirmedSet].every((sku) => currentSet.has(sku))) {
    throw new Error('Variation listing read-only reconciliation frozen siblings do not cover every confirmed SKU.');
  }
  const listingId = snapshot.confirmed.remote.listingId;
  if (typeof listingId !== 'string' || listingId.trim() === '') {
    throw new Error('Variation listing read-only reconciliation is missing its frozen listing identity.');
  }
  const offerIds = snapshot.confirmed.remote.offerIdsBySku;
  const quantities = snapshot.confirmed.remote.quantitiesBySku;
  if (offerIds === null || typeof offerIds !== 'object' || Array.isArray(offerIds) || quantities === null || typeof quantities !== 'object' || Array.isArray(quantities)) {
    throw new Error('Variation listing read-only reconciliation is missing complete frozen remote identity.');
  }
  const offerIdKeys = Object.keys(offerIds);
  const quantityKeys = Object.keys(quantities);
  if (offerIdKeys.length !== confirmedSet.size || offerIdKeys.some((sku) => !confirmedSet.has(sku)) || new Set(Object.values(offerIds)).size !== offerIdKeys.length || quantityKeys.length !== confirmedSet.size || quantityKeys.some((sku) => !confirmedSet.has(sku))) {
    throw new Error('Variation listing read-only reconciliation frozen remote identity does not cover every confirmed sibling.');
  }
  for (const sku of confirmedSet) {
    const offerId = offerIds[sku];
    if (typeof offerId !== 'string' || offerId.trim() === '') throw new Error(`Variation listing read-only reconciliation is missing frozen offer identity for ${sku}.`);
    const quantity = quantities[sku];
    if (!quantity || !Number.isSafeInteger(quantity.inventoryItemQuantity) || quantity.inventoryItemQuantity < 0 || !Number.isSafeInteger(quantity.offerQuantity) || quantity.offerQuantity < 0 || !Number.isSafeInteger(quantity.sellableQuantity) || quantity.sellableQuantity < 0 || quantity.sellableQuantity !== Math.min(quantity.inventoryItemQuantity, quantity.offerQuantity)) {
      throw new Error(`Variation listing read-only reconciliation frozen quantity evidence for ${sku} is incomplete.`);
    }
  }
  const revisionReconcile = frozen.captureInput.operationPlan.filter((operation) => operation.operationKey === 'revision-reconcile' && operation.operationKind === 'revision_reconcile');
  if (revisionReconcile.length !== 1) throw new Error('Variation listing read-only reconciliation requires one frozen revision-reconcile operation.');
  for (const operation of frozen.captureInput.operationPlan.filter((candidate) => candidate.operationKey !== 'revision-reconcile')) {
    if ((history.get(operation.operationKey)?.length ?? 0) === 0) {
      throw new Error(`Variation listing read-only reconciliation operation ${operation.operationKey} history is incomplete.`);
    }
  }
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

function hasPriorRemoteProgress(
  frozen: VariationListingFrozenActiveRevision,
  history: ActiveHistory,
  operationKey: string
): boolean {
  const mutationKeys = new Set(
    frozen.captureInput.operationPlan
      .filter((operation) => ['child_inventory_item_write', 'child_offer_write', 'complete_group_replace', 'group_publish'].includes(operation.operationKind))
      .map((operation) => operation.operationKey)
  );
  for (const [key, rows] of history) {
    if (key === operationKey || !mutationKeys.has(key)) continue;
    // confirmed_no_op is a read-only proof and does not mean a prior remote
    // mutation happened. Any completed mutation, started/unknown outcome, or
    // bounded-retry state does require a durable unresolved marker if the next
    // operation's precondition drifts.
    if (rows.some((row) => !['started', 'confirmed_no_op'].includes(row.state))) return true;
  }
  return false;
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
  if (input.readOnlyReconcile) {
    if (!current) throw new Error(`Variation listing read-only reconciliation cannot adopt unstarted operation ${operationKey}.`);
    if (current.state === 'retry_exhausted') throw new Error(`Variation listing read-only reconciliation cannot recover exhausted operation ${operationKey}.`);
    const evidence = await after();
    if (evidence === null) throw new Error(`Variation listing read-only reconciliation cannot prove exact after-state for ${operationKey}; no eBay mutation attempted.`);
    if (current.state === 'confirmed_complete' || current.state === 'confirmed_no_op') return;
    if (current.state === 'started') {
      // A started operation resolves on the same attempt.  This preserves the
      // append-only journal grammar and proves that no replay was authorized.
      await activeAppend(input, history, operationKey, 'confirmed_complete', current.attempt_number, current.checkpoint_number + 1, evidence, 'present');
      return;
    }
    if (current.state === 'retry_authorized') {
      // A retry authorization is a write permission, not a read-only terminal
      // state.  Record the required replay start, then resolve it from the
      // exact after-state without invoking its mutation closure.
      await activeAppend(input, history, operationKey, 'started', current.attempt_number, current.checkpoint_number + 1, {});
      await activeAppend(input, history, operationKey, 'confirmed_complete', current.attempt_number, current.checkpoint_number + 2, evidence, 'present');
      return;
    }
    // Unknown outcomes reconcile on the next attempt.  Any other state is
    // malformed and must remain unresolved.
    if (current.state !== 'unknown' && current.observed_remote_state !== 'unknown') {
      throw new Error(`Variation listing read-only reconciliation cannot resolve invalid operation state ${current.state} for ${operationKey}.`);
    }
    await activeAppend(input, history, operationKey, 'confirmed_complete', current.attempt_number + 1, 1, evidence, 'present');
    return;
  }
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
    let replayAfter: Json | null;
    try {
      replayAfter = await after();
    } catch (error) {
      await activeAppend(input, history, operationKey, 'unknown', current.attempt_number, current.checkpoint_number + 2, activeErrorEvidence(error), 'unknown');
      throw error;
    }
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
    let preEvidence: Json | null;
    try {
      preEvidence = await pre();
    } catch (error) {
      if (hasPriorRemoteProgress(input.frozen, history, operationKey)) {
        await activeAppend(input, history, operationKey, 'started', 1, 1, {});
        await activeAppend(input, history, operationKey, 'unknown', 1, 2, activeErrorEvidence(error), 'unknown');
      }
      throw error;
    }
    if (preEvidence === null) {
      if (hasPriorRemoteProgress(input.frozen, history, operationKey)) {
        await activeAppend(input, history, operationKey, 'started', 1, 1, {});
        await activeAppend(input, history, operationKey, 'unknown', 1, 2, { reason: 'Exact pre-state changed after earlier remote operations.' }, 'unknown');
      }
      throw new Error(`Variation listing operation ${operationKey} pre-state is not exact.`);
    }
  await activeAppend(input, history, operationKey, 'started', 1, 1, {});
  try {
    await mutate();
  } catch (error) {
    await activeAppend(input, history, operationKey, 'unknown', 1, 2, activeErrorEvidence(error), 'unknown');
    throw error;
  }
  let mutationAfter: Json | null;
  try {
    mutationAfter = await after();
  } catch (error) {
    await activeAppend(input, history, operationKey, 'unknown', 1, 2, activeErrorEvidence(error), 'unknown');
    throw error;
  }
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
  offerQuantity(offer.payload, expected.sku);
  if (canonicalJson(offer.payload) !== canonicalJson(asJson(expected))) return null;
  return asJson({ offerId: offer.offerId, listingId: offer.listingId, payload: offer.payload, sku: offer.sku });
}

/** Reconcile an already-terminal offer without treating a later eBay sale as
 * a structural mismatch. Identity, marketplace, listing, lifecycle, and all
 * non-quantity payload fields remain exact; only availableQuantity may drift
 * after the write has been durably confirmed. */
function activeOfferIgnoringQuantity(
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
  offerQuantity(offer.payload, expected.sku);
  if (canonicalJson(offerPayloadWithoutQuantity(offer.payload, expected.sku)) !== canonicalJson(offerPayloadWithoutQuantity(asJson(expected), expected.sku))) return null;
  return asJson({ offerId: offer.offerId, listingId: offer.listingId, payload: offer.payload, sku: offer.sku });
}

type ListingVariationPrice = { currency: string; value: string };

function unknownRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Variation listing ${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function listingPrice(value: unknown, label: string): ListingVariationPrice {
  let currency: unknown;
  let rawValue: unknown = value;
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const row = value as Record<string, unknown>;
    rawValue = row['#text'] ?? row.value ?? row.Value;
    currency = row['@_currencyID'] ?? row.currencyID ?? row.CurrencyID ?? row.currency;
  }
  if (
    rawValue === null ||
    rawValue === undefined ||
    (typeof rawValue !== 'number' && typeof rawValue !== 'string') ||
    (typeof rawValue === 'string' && rawValue.trim() === '')
  ) {
    throw new Error(`Variation listing ${label} price is missing or malformed.`);
  }
  const numeric = typeof rawValue === 'number' ? rawValue : Number(rawValue);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new Error(`Variation listing ${label} price is malformed.`);
  }
  const normalizedCurrency = typeof currency === 'string' ? currency.trim().toUpperCase() : '';
  if (!normalizedCurrency) throw new Error(`Variation listing ${label} price currency is missing.`);
  return { currency: normalizedCurrency, value: numeric.toFixed(2) };
}

function listingVariationPrices(value: unknown, listingId: string, allowEmpty = false): Map<string, ListingVariationPrice> {
  const root = unknownRecord(value, 'Trading GetItem response');
  const itemCandidate = root.Item ?? root;
  const item = unknownRecord(itemCandidate, 'Trading GetItem item');
  const observedListingId = item.ItemID;
  if (observedListingId === undefined || String(observedListingId).trim() !== listingId) {
    throw new Error(`Variation listing Trading GetItem returned listing ${String(observedListingId)} instead of ${listingId}.`);
  }
  if ((item.Variations === undefined || item.Variations === null) && allowEmpty) return new Map();
  const variationsContainer = unknownRecord(item.Variations, 'Trading GetItem variations');
  const rawVariations = variationsContainer.Variation;
  if (rawVariations === undefined || rawVariations === null) {
    if (allowEmpty) return new Map();
    throw new Error('Variation listing Trading GetItem response has no variations.');
  }
  const rows = Array.isArray(rawVariations) ? rawVariations : [rawVariations];
  const prices = new Map<string, ListingVariationPrice>();
  for (const rawVariation of rows) {
    const variation = unknownRecord(rawVariation, 'Trading GetItem variation');
    const sku = String(variation.SKU ?? '').trim();
    if (!sku) throw new Error('Variation listing Trading GetItem variation is missing SKU.');
    if (prices.has(sku)) throw new Error(`Variation listing Trading GetItem returned duplicate SKU ${sku}.`);
    prices.set(sku, listingPrice(variation.StartPrice, `Trading GetItem variation ${sku}`));
  }
  if (prices.size === 0 && !allowEmpty) throw new Error('Variation listing Trading GetItem response has no variations.');
  return prices;
}

function listingVariationSellableQuantities(value: unknown, listingId: string, allowEmpty = false): Map<string, number> {
  const root = unknownRecord(value, 'Trading GetItem response');
  const item = unknownRecord(root.Item ?? root, 'Trading GetItem item');
  if (item.ItemID === undefined || String(item.ItemID).trim() !== listingId) {
    throw new Error(`Variation listing Trading GetItem returned listing ${String(item.ItemID)} instead of ${listingId}.`);
  }
  if ((item.Variations === undefined || item.Variations === null) && allowEmpty) return new Map();
  const container = unknownRecord(item.Variations, 'Trading GetItem variations');
  const rawVariations = container.Variation;
  if (rawVariations === undefined || rawVariations === null) {
    if (allowEmpty) return new Map();
    throw new Error('Variation listing Trading GetItem response has no variations.');
  }
  const rows = Array.isArray(rawVariations) ? rawVariations : [rawVariations];
  const quantities = new Map<string, number>();
  for (const rawVariation of rows) {
    const variation = unknownRecord(rawVariation, 'Trading GetItem variation');
    const sku = String(variation.SKU ?? '').trim();
    if (!sku || quantities.has(sku)) throw new Error('Variation listing Trading GetItem variation identity is malformed or duplicated.');
    const totalRaw = variation.Quantity;
    const status = unknownRecord(variation.SellingStatus, `Trading GetItem variation ${sku} SellingStatus`);
    const soldRaw = status.QuantitySold;
    const total = Number(totalRaw);
    const sold = Number(soldRaw);
    if ((typeof totalRaw !== 'number' && typeof totalRaw !== 'string') || (typeof soldRaw !== 'number' && typeof soldRaw !== 'string') || !Number.isSafeInteger(total) || total < 0 || !Number.isSafeInteger(sold) || sold < 0 || sold > total) {
      throw new Error(`Variation listing Trading GetItem variation ${sku} quantity is malformed.`);
    }
    quantities.set(sku, total - sold);
  }
  if (quantities.size === 0 && !allowEmpty) throw new Error('Variation listing Trading GetItem response has no variations.');
  return quantities;
}

function assertListingPriceSet(
  value: unknown,
  listingId: string,
  expectedChildren: readonly VariationListingInventoryPayloadBundle['children'][number][],
  label: string,
  checkQuantities = false,
  allowEmpty = false,
): void {
  const prices = listingVariationPrices(value, listingId, allowEmpty);
  const expected = expectedChildren.filter((child) => child.quantity > 0);
  const expectedSkus = new Set(expected.map((child) => child.sku));
  if (prices.size !== expectedSkus.size || [...prices.keys()].some((sku) => !expectedSkus.has(sku))) {
    throw new Error(`Variation listing ${label} SKU set does not match the frozen listing-facing siblings.`);
  }
  for (const child of expected) {
    const observed = prices.get(child.sku);
    const wanted = expectedOfferPrice(child);
    if (!observed || observed.currency !== wanted.currency || observed.value !== wanted.value) {
      throw new Error(`Variation listing ${label} sibling ${child.sku} price changed outside the frozen transition.`);
    }
  }
  if (checkQuantities) {
    const quantities = listingVariationSellableQuantities(value, listingId, allowEmpty);
    for (const child of expected) {
      if (quantities.get(child.sku) !== child.quantity) {
        throw new Error(`Variation listing ${label} sibling ${child.sku} quantity changed outside the frozen transition.`);
      }
    }
  }
}

/** Trading GetItem is the listing-facing authority for restoring a sold-out child.
 * An Inventory Item/Offer quantity of 1 is insufficient: eBay may still omit
 * the variation from the published listing. Do not infer quantities from the
 * group selector values, which retain out-of-stock children. */
function listingRestockEvidence(
  value: unknown,
  listingId: string,
  child: VariationListingInventoryPayloadBundle['children'][number]
): Json | null {
  const prices = listingVariationPrices(value, listingId);
  const price = prices.get(child.sku);
  const expectedPrice = expectedOfferPrice(child);
  if (!price || price.currency !== expectedPrice.currency || price.value !== expectedPrice.value) return null;
  const root = unknownRecord(value, 'Trading GetItem response');
  const item = unknownRecord(root.Item ?? root, 'Trading GetItem item');
  const rowsContainer = unknownRecord(item.Variations, 'Trading GetItem variations');
  const rawRows = rowsContainer.Variation;
  const rows = Array.isArray(rawRows) ? rawRows : [rawRows];
  const raw = rows.find((row) => row && typeof row === 'object' && !Array.isArray(row) && String((row as Record<string, unknown>).SKU ?? '').trim() === child.sku);
  if (!raw) return null;
  const variation = unknownRecord(raw, 'Trading GetItem restocked variation');
  const readQuantity = (rawQuantity: unknown, label: string): number => {
    if (typeof rawQuantity !== 'number' && (typeof rawQuantity !== 'string' || rawQuantity.trim() === '')) throw new Error(`Variation listing ${label} is missing.`);
    const quantity = Number(rawQuantity);
    if (!Number.isSafeInteger(quantity) || quantity < 0) throw new Error(`Variation listing ${label} is invalid.`);
    return quantity;
  };
  const total = readQuantity(variation.Quantity, `Trading GetItem ${child.sku} Quantity`);
  const status = unknownRecord(variation.SellingStatus, `Trading GetItem ${child.sku} SellingStatus`);
  const sold = readQuantity(status.QuantitySold, `Trading GetItem ${child.sku} QuantitySold`);
  if (sold > total || total - sold !== child.quantity || child.quantity < 1) return null;
  return asJson({ listingId, sku: child.sku, price, sellableQuantity: total - sold });
}

function expectedOfferPrice(child: VariationListingInventoryPayloadBundle['children'][number]): ListingVariationPrice {
  return {
    currency: child.offer.pricingSummary.price.currency.toUpperCase(),
    value: child.offer.pricingSummary.price.value,
  };
}

function listingPriceEvidence(
  value: unknown,
  listingId: string,
  child: VariationListingInventoryPayloadBundle['children'][number]
): Json | null {
  const prices = listingVariationPrices(value, listingId);
  const expected = expectedOfferPrice(child);
  const observed = prices.get(child.sku);
  if (!observed || observed.currency !== expected.currency || observed.value !== expected.value) return null;
  return asJson({ listingId, price: observed, sku: child.sku });
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
  inventoryItemQuantity(read.value.payload, expected.sku);
  if (canonicalJson(read.value.payload) !== canonicalJson(asJson(expected.inventoryItem))) return null;
  return asJson({ groupKeys: read.value.groupKeys, payload: read.value.payload, sku: read.value.sku });
}

/** Reconcile an already-terminal Inventory Item while tolerating only a
 * quantity-only eBay change. Group association, SKU, and every non-quantity
 * payload field remain exact. */
function activeItemIgnoringQuantity(
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
  inventoryItemQuantity(read.value.payload, expected.sku);
  if (canonicalJson(inventoryPayloadWithoutQuantity(read.value.payload, expected.sku)) !== canonicalJson(inventoryPayloadWithoutQuantity(asJson(expected.inventoryItem), expected.sku))) return null;
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
  validateFrozenActiveOperationPlanCompleteness(input.frozen);

  // The lookup is intentionally mandatory. The capture RPC rejects duplicate
  // revision rows, so skipping this read on restart would turn a resumable
  // execution into a second capture attempt.
  if (typeof input.journal.loadRevision !== 'function') {
    throw new Error('Variation listing active revision requires a durable revision lookup.');
  }
  const existingRevision = await input.journal.loadRevision(captureInput.revisionId);
  if (input.readOnlyReconcile && !existingRevision) {
    throw new Error('Variation listing read-only reconciliation requires an existing frozen revision; capture is forbidden.');
  }
  // A clean captured revision has no operation checkpoints yet, so its frozen
  // remote quantities are still the complete authority for the first write.
  // Re-read that whole baseline immediately before capture/mutation. If the
  // immutable row already exists, quantity-only drift cannot be superseded via
  // the current reserve RPC; fail with a stable reprepare instruction instead
  // of pinning the group to stale quantities or writing a counterpart blindly.
  const existingCheckpoints = await input.journal.listCheckpoints(captureInput.revisionId);
  // Active snapshots must carry the eBay-authoritative quantity
  // map. A missing map is legacy local-count intent and is never safe to
  // resume after a sale. A clean captured row can be reprepared; a row with
  // remote work already recorded must fail reconciliation rather than replay
  // stale quantities.
  if (!input.frozen.snapshot.confirmed.remote.quantitiesBySku) {
    if (!existingRevision || !hasListingMutationCheckpoint(input.frozen, existingCheckpoints)) {
      throw new Error('active_revision_reprepare_required: Variation listing active revision lacks frozen eBay quantities; stage a new change and prepare again before mutation.');
    }
    throw new Error('Variation listing active revision lacks frozen eBay quantities; reconciliation is required before resume.');
  }
  if (!existingRevision || !hasListingMutationCheckpoint(input.frozen, existingCheckpoints)) {
    await verifyFrozenRemoteBaseline(input, Boolean(existingRevision));
    if (hasActiveRemoteMutation(input.frozen)) {
      await verifyFrozenListingPriceBaseline(input);
    }
  }
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
  const history = makeActiveHistory(input.frozen, existingCheckpoints);
  if (input.readOnlyReconcile) validateReadOnlyFrozenIdentity(input.frozen, history);
  const mutationGateway = input.readOnlyReconcile ? readOnlyActiveMutationGateway : input.mutations;
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
    if (input.readOnlyReconcile) {
      throw new Error(`Variation listing read-only reconciliation cannot create missing Media ${operationKey}.`);
    }
    const createMedia = requireActiveMethod(mutationGateway, 'createMedia');
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
  const desiredBundleBase = buildVariationListingInventoryPayloadBundle({ aggregate: input.frozen.snapshot.aggregate, representativeImages });
  const remoteQuantities = input.frozen.snapshot.confirmed.remote.quantitiesBySku;
  const desiredBundle = remoteQuantities
    ? applyUniformActiveQuantities(
        desiredBundleBase,
        desiredActiveQuantities(
          input.frozen.snapshot.aggregate,
          input.frozen.snapshot.confirmed.aggregate,
          remoteQuantities
        )
      )
    : desiredBundleBase;
  const previousByVariation = new Map(input.frozen.snapshot.confirmed.aggregate.variations.map((variation) => [variation.variation_id, variation]));
  const priorOfferIds = input.frozen.snapshot.confirmed.remote.offerIdsBySku;
  const frozenListingId = input.frozen.snapshot.confirmed.remote.listingId;
  const newOfferIdsByVariation = new Map<string, string>();
  // Every active publication must match the listing-facing price of each
  // sellable variation, even when the frozen delta is quantity-only or a
  // series of staged edits nets to the confirmed price. Revision inequality
  // alone does not prove that Trading carries the correct price.
  let listingPriceVerificationRequired = true;

  for (const child of desiredBundle.children) {
    const priorVariation = previousByVariation.get(child.variationId);
    const priorChild = previousBundle.children.find((candidate) => candidate.variationId === child.variationId);
    const existed = Boolean(priorVariation);
    const priorOfferId = priorOfferIds[child.sku];
    const priceChanged = Boolean(
      existed &&
      priorChild &&
      canonicalJson(asJson(priorChild.offer.pricingSummary.price)) !== canonicalJson(asJson(child.offer.pricingSummary.price))
    );
    if (!existed || priceChanged) listingPriceVerificationRequired = true;
    // A 0 -> positive restock is not proven by Inventory/Offer quantities alone:
    // the Trading listing can continue to exclude the sold-out child.
    const frozenSellableQuantity = remoteQuantities?.[child.sku]
      ? parseConfirmedRemoteQuantity(remoteQuantities[child.sku], child.sku).sellableQuantity
      : priorChild?.quantity;
    const restoringSoldOut = Boolean(existed && frozenSellableQuantity === 0 && child.quantity > 0);
    if (restoringSoldOut) listingPriceVerificationRequired = true;
    const assertRestockPreListing = async (): Promise<void> => {
      const getListing = input.remote.getListing;
      if (!getListing) throw new Error(`Variation listing restock ${child.sku} requires a listing-facing Trading GetItem read before mutation.`);
      const listing = await getListing(frozenListingId);
      assertListingPriceSet(listing, frozenListingId, previousBundle.children, `restock ${child.sku} pre-state`, true, true);
      if (listingVariationPrices(listing, frozenListingId, true).has(child.sku)) {
        throw new Error(`Variation listing restock ${child.sku} already appears in Trading before its frozen 0-to-positive update.`);
      }
    };
    const assertRestockPreGroup = async (): Promise<void> => {
      if (activeGroup(await input.remote.getInventoryItemGroup(desiredBundle.groupKey), previousBundle.group) === null) {
        throw new Error(`Variation listing restock ${child.sku} has a missing or changed variation-specifics group before mutation.`);
      }
    };
    const itemOperationKey = `child-item:${child.variationId}`;
    const itemRows = history.get(itemOperationKey);
    if (itemRows) {
    const itemAfter = async (): Promise<Json | null> => {
      const terminal = activeTerminal(activeLatest(itemRows));
      return terminal
        ? activeItemIgnoringQuantity(await input.remote.getInventoryItem(child.sku), child, desiredBundle.groupKey, existed)
        : activeItem(await input.remote.getInventoryItem(child.sku), child, desiredBundle.groupKey, existed);
    };
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
      if (restoringSoldOut) {
        await assertRestockPreGroup();
        await assertRestockPreListing();
      }
      return activeItem(await input.remote.getInventoryItem(child.sku), priorChild, desiredBundle.groupKey, true);
    };
    const itemMutate = async (): Promise<void> => {
      // Re-read the target itself immediately before writing. The pre-state
      // read may be stale even when the paired Offer remains unchanged.
      const ownItemRead = await input.remote.getInventoryItem(child.sku);
      if (existed) {
        if (!priorChild || activeItem(ownItemRead, priorChild, desiredBundle.groupKey, true) === null) {
          throw new Error(`Variation listing Inventory Item ${child.sku} changed before its mutation.`);
        }
      } else if (ownItemRead.state !== 'proven_absent') {
        if (ownItemRead.state === 'unknown') throw new Error(`Variation listing new item ${child.sku} pre-state is unknown: ${ownItemRead.reason}`);
        throw new Error(`Variation listing new item ${child.sku} appeared before create.`);
      }
      if (restoringSoldOut) {
        await assertRestockPreGroup();
        await assertRestockPreListing();
      }
      if (existed) {
        if (!priorChild || !priorOfferId) {
          throw new Error(`Variation listing existing child ${child.sku} has no complete frozen counterpart identity.`);
        }
        // Re-read the paired frozen offer immediately before the Inventory
        // Item write. A sale/quantity change between itemPre and this closure
        // must block without touching either remote resource.
        const pairedOffer = activeOffer(
          await input.remote.getOffers(child.sku, child.offer.marketplaceId),
          priorChild.offer,
          { offerId: priorOfferId, listingId: frozenListingId },
          'PUBLISHED',
          true
        );
        if (pairedOffer === null) {
          throw new Error(`Variation listing paired offer ${child.sku} changed before the Inventory Item mutation.`);
        }
        if (!restoringSoldOut && (priorChild.quantity > 0 || priceChanged)) {
          // Keep the listing-facing price gate ahead of the Item write as well
          // as the Offer guard below.  A quantity-only or combined revision
          // must not leave a half-applied Item when Trading already drifted.
          const getListing = input.remote.getListing;
          if (!getListing) throw new Error(`Variation listing ${child.sku} publication requires a listing-facing Trading GetItem read before the Inventory Item mutation.`);
          if (!listingPriceEvidence(await getListing(frozenListingId), frozenListingId, priorChild)) {
            throw new Error(`Variation listing pre-state price ${child.sku} does not match the frozen active listing.`);
          }
        }
      }
      // A provider-side change after this final read and before the request is
      // an unavoidable API TOCTOU; the exact after-state read below records it
      // as unknown rather than permitting a blind retry.
      await mutationGateway.createOrReplaceInventoryItem(child.sku, asJson(child.inventoryItem));
    };
    await executeActiveOperation(input, history, itemOperationKey, guardedItemAfter, itemPre, itemMutate);
    } else if (!existed) {
      throw new Error(`Variation listing new item ${child.sku} is missing its frozen mutation operation.`);
    }

    const offerIdentity = { offerId: priorOfferId ?? '', listingId: frozenListingId };
    let returnedOfferId: string | null = null;
    const offerOperationKey = `child-offer:${child.variationId}`;
    const offerRows = history.get(offerOperationKey);
    if (offerRows) {
    const offerAfter = async (): Promise<Json | null> => {
      const read = await input.remote.getOffers(child.sku, child.offer.marketplaceId);
      if (!existed) {
        if (read.state === 'unknown') throw new Error(`Variation listing new offer ${child.sku} read is unknown: ${read.reason}`);
        if (read.state === 'proven_absent' || read.value.length === 0) return null;
        if (read.value.length !== 1) throw new Error(`Variation listing new offer ${child.sku} must have exactly one offer.`);
        const offer = read.value[0];
        if (offer.sku !== child.sku || offer.marketplaceId !== child.offer.marketplaceId) throw new Error(`Variation listing new offer ${child.sku} identity mismatch.`);
        const latestOfferRow = activeLatest(offerRows);
        const terminalOffer = latestOfferRow?.state === 'confirmed_complete' || latestOfferRow?.state === 'confirmed_no_op';
        if (canonicalJson(terminalOffer ? offerPayloadWithoutQuantity(offer.payload, child.sku) : offer.payload) !== canonicalJson(terminalOffer ? offerPayloadWithoutQuantity(asJson(child.offer), child.sku) : asJson(child.offer))) {
          throw new Error(`Variation listing new offer ${child.sku} payload mismatch.`);
        }
        // Before this operation has any durable history, any existing offer is
        // a collision rather than an adoptable after-state. executeActiveOperation
        // will then run the exact absence pre-read and fail closed.
        if (offerRows.length === 0) return null;
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
      const evidence = activeTerminal(activeLatest(offerRows))
        ? activeOfferIgnoringQuantity(read, child.offer, offerIdentity, 'PUBLISHED', true)
        : activeOffer(read, child.offer, offerIdentity, 'PUBLISHED', true);
      if (!evidence || (!priceChanged && !restoringSoldOut)) return evidence;
      const getListing = input.remote.getListing;
      if (!getListing) throw new Error(`Variation listing ${child.sku} publication requires a listing-facing Trading GetItem read.`);
      const listing = await getListing(frozenListingId);
      const listingEvidence = restoringSoldOut
        ? listingRestockEvidence(listing, frozenListingId, child)
        : listingPriceEvidence(listing, frozenListingId, child);
      if (!listingEvidence) return null;
      return asJson({ offer: evidence, listing: listingEvidence });
    };
    const offerPre = async (): Promise<Json | null> => {
      const read = await input.remote.getOffers(child.sku, child.offer.marketplaceId);
      if (!existed) {
        if (read.state === 'unknown') throw new Error(`Variation listing new offer ${child.sku} pre-state is unknown: ${read.reason}`);
        if (read.state === 'proven_absent' || read.value.length === 0) return { absent: true, sku: child.sku };
        throw new Error(`Variation listing new offer ${child.sku} must be absent before create.`);
      }
      if (!priorOfferId) throw new Error(`Variation listing existing offer ${child.sku} has no frozen offer ID.`);
      const expectedPriorChild = priorChild ?? previousBundle.children.find((candidate) => candidate.variationId === child.variationId);
      if (!expectedPriorChild) throw new Error(`Variation listing existing offer ${child.sku} lacks a frozen prior payload.`);
      // Updating the Inventory Item to 1 can cause eBay to report Offer
      // availableQuantity=1 before the Trading variation is relisted.
      // Accept that narrow quantity drift as a restock PRE-state only.
      const evidence = restoringSoldOut
        ? activeOfferIgnoringQuantity(read, expectedPriorChild.offer, offerIdentity, 'PUBLISHED', true)
        : activeOffer(read, expectedPriorChild.offer, offerIdentity, 'PUBLISHED', true);
      if (restoringSoldOut && evidence) {
        const amount = offerQuantity(object(evidence, `restock offer ${child.sku} evidence`).payload, child.sku);
        if (amount !== expectedPriorChild.offer.availableQuantity && amount !== child.offer.availableQuantity) return null;
      }
      if (!evidence || (!priceChanged && !restoringSoldOut)) return evidence;
      const getListing = input.remote.getListing;
      if (!getListing) throw new Error(`Variation listing ${child.sku} pre-state requires a listing-facing Trading GetItem read.`);
      const listing = await getListing(frozenListingId);
      if (restoringSoldOut) {
        await assertRestockPreListing();
      }
      if (priceChanged) {
        const listingEvidence = listingPriceEvidence(listing, frozenListingId, expectedPriorChild);
        if (!listingEvidence) throw new Error(`Variation listing pre-state price ${child.sku} changed before its bulk mutation; it does not match the frozen active listing.`);
        return asJson({ offer: evidence, listing: listingEvidence });
      }
      return evidence;
    };
    const offerMutate = async (): Promise<void> => {
      // Re-read the target Offer itself immediately before writing. This
      // closes the pre() -> mutate() gap independently of the paired Item
      // guard below.
      const ownOfferRead = await input.remote.getOffers(child.sku, child.offer.marketplaceId);
      if (existed) {
        const observedPriorOffer = priorChild && (restoringSoldOut
          ? activeOfferIgnoringQuantity(ownOfferRead, priorChild.offer, offerIdentity, 'PUBLISHED', true)
          : activeOffer(ownOfferRead, priorChild.offer, offerIdentity, 'PUBLISHED', true));
        if (!priorChild || observedPriorOffer === null) {
          throw new Error(`Variation listing Offer ${child.sku} changed before its mutation.`);
        }
        if (restoringSoldOut) {
          const observedOfferEvidence = object(observedPriorOffer as Json, `restock offer ${child.sku} evidence`);
          const amount = offerQuantity(observedOfferEvidence.payload as Json, child.sku);
          if (amount !== priorChild.offer.availableQuantity && amount !== child.offer.availableQuantity) {
            throw new Error(`Variation listing restock ${child.sku} Offer quantity changed outside the frozen 0-to-positive transition.`);
          }
        }
        // The Item operation may have completed while a concurrent eBay write
        // changed it again. Re-read the desired Item state immediately before
        // updating its paired Offer so we never overwrite a newer quantity or
        // payload with the frozen counterpart.
        const pairedItem = activeItem(
          await input.remote.getInventoryItem(child.sku),
          child,
          desiredBundle.groupKey,
          true
        );
        if (pairedItem === null) {
          throw new Error(`Variation listing paired Inventory Item ${child.sku} changed before the Offer mutation.`);
        }
        if (!priceChanged && !restoringSoldOut) {
          // This can be a quantity-only update OR a change/revert/restage
          // sequence whose net price is the previous confirmed price.
          // Never send updateOffer on top of a listing-facing price drift.
          const getListing = input.remote.getListing;
          if (!getListing) throw new Error(`Variation listing ${child.sku} quantity publication requires Trading GetItem price evidence.`);
          if (!priorChild || !listingPriceEvidence(await getListing(frozenListingId), frozenListingId, priorChild)) {
            throw new Error(`Variation listing ${child.sku} listing-facing price does not match the confirmed pre-state before quantity mutation.`);
          }
        }
        if (priceChanged || restoringSoldOut) {
          const getListing = input.remote.getListing;
          if (!getListing) throw new Error(`Variation listing price publication ${child.sku} requires a listing-facing Trading GetItem read.`);
          const expectedPriorChild = priorChild ?? previousBundle.children.find((candidate) => candidate.variationId === child.variationId);
          if (!expectedPriorChild) throw new Error(`Variation listing existing offer ${child.sku} lacks a frozen prior payload.`);
          const listing = await getListing(frozenListingId);
          const listingEvidence = priceChanged && !restoringSoldOut ? listingPriceEvidence(listing, frozenListingId, expectedPriorChild) : null;
          if (restoringSoldOut) {
            // Zero-stock children are omitted from Trading GetItem. If the
            // listing already contains this SKU, refuse a duplicate restock.
            await assertRestockPreListing();
          } else if (!listingEvidence) {
            throw new Error(`Variation listing pre-state price ${child.sku} changed before its bulk mutation.`);
          }
        }
        if (restoringSoldOut && activeGroup(await input.remote.getInventoryItemGroup(desiredBundle.groupKey), desiredBundle.group) === null) {
          throw new Error(`Variation listing restock ${child.sku} has a missing or changed variation-specifics group.`);
        }
        // A provider-side change after this final read and before the request
        // remains API TOCTOU; post-state mismatch is preserved as unknown.
        if (priceChanged || restoringSoldOut) {
          const payload = asJson({
            requests: [{
              offers: [{
                availableQuantity: child.offer.availableQuantity,
                offerId: priorOfferId,
                price: child.offer.pricingSummary.price,
              }],
              shipToLocationAvailability: {
                quantity: child.inventoryItem.availability.shipToLocationAvailability.quantity,
              },
              sku: child.sku,
            }],
          });
          await requireActiveMethod(mutationGateway, 'bulkUpdatePriceQuantity')(payload);
        } else {
          await requireActiveMethod(mutationGateway, 'updateOffer')(priorOfferId, asJson(child.offer));
        }
      } else {
        if (ownOfferRead.state === 'unknown') throw new Error(`Variation listing new offer ${child.sku} pre-state is unknown: ${ownOfferRead.reason}`);
        if (ownOfferRead.state !== 'proven_absent' && !(ownOfferRead.state === 'present' && ownOfferRead.value.length === 0)) {
          throw new Error(`Variation listing new offer ${child.sku} appeared before create.`);
        }
        const created = await mutationGateway.createOffer(asJson(child.offer));
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
    } else if (!existed) {
      throw new Error(`Variation listing new offer ${child.sku} is missing its frozen mutation operation.`);
    }
  }

  if (history.has('complete-group')) {
    const groupPre = async (): Promise<Json | null> => activeGroup(await input.remote.getInventoryItemGroup(desiredBundle.groupKey), previousBundle.group);
    const groupAfter = async (): Promise<Json | null> => activeGroup(await input.remote.getInventoryItemGroup(desiredBundle.groupKey), desiredBundle.group);
    await executeActiveOperation(input, history, 'complete-group', groupAfter, groupPre, () => mutationGateway.createOrReplaceInventoryItemGroup(desiredBundle.groupKey, asJson(desiredBundle.group)));
  }

  const newChildren = desiredBundle.children.filter((child) => !previousByVariation.has(child.variationId));
  for (const child of newChildren) {
    const offerId = newOfferIdsByVariation.get(child.variationId);
    if (!offerId) throw new Error(`Variation listing publish offer ${child.sku} has no durable created offer ID.`);
    const operationKey = `publish-offer:${child.variationId}`;
    // Once publishOffer has been durably started, eBay may decrement the
    // available quantity before the post-state read (for example, a buyer
    // sale racing the publish response). The operation owns that published
    // state, so tolerate quantity-only drift on PUBLISHED reads while keeping
    // the pre-publish UNPUBLISHED check exact.
    const publishReadAllowsQuantity = (status: 'UNPUBLISHED' | 'PUBLISHED'): boolean =>
      status === 'PUBLISHED' && activeLatest(history.get(operationKey)!) !== null;
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
      const quantityTolerant = publishReadAllowsQuantity(status);
      const payloadMatches = quantityTolerant
        ? canonicalJson(offerPayloadWithoutQuantity(offer.payload, child.sku)) === canonicalJson(offerPayloadWithoutQuantity(asJson(child.offer), child.sku))
        : canonicalJson(offer.payload) === canonicalJson(asJson(child.offer));
      if (quantityTolerant) offerQuantity(offer.payload, child.sku);
      if (!payloadMatches) {
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
      const result = await requireActiveMethod(mutationGateway, 'publishOffer')(offerId);
      if (!result.listingId || result.listingId !== frozenListingId) throw new Error(`Variation listing publish offer ${child.sku} returned a different listing ID.`);
    };
    await executeActiveOperation(input, history, operationKey, after, pre, mutate);
  }

  // Final exact aggregate read is the sole confirmation gate.
  const finalGroup = await input.remote.getInventoryItemGroup(desiredBundle.groupKey);
  if (activeGroup(finalGroup, desiredBundle.group) === null) throw new Error('Variation listing final group is absent.');
  const listingIds = new Set<string>();
  for (const child of desiredBundle.children) {
    if (activeItemIgnoringQuantity(await input.remote.getInventoryItem(child.sku), child, desiredBundle.groupKey, true) === null) throw new Error(`Variation listing final item ${child.sku} is absent or changed outside quantity.`);
    const prior = previousByVariation.has(child.variationId);
    const offerId = prior ? priorOfferIds[child.sku] : newOfferIdsByVariation.get(child.variationId) ?? null;
    if (!offerId) throw new Error(`Variation listing final offer ${child.sku} has no durable offer ID.`);
    const read = await input.remote.getOffers(child.sku, child.offer.marketplaceId);
    const evidence = activeOfferIgnoringQuantity(read, child.offer, { offerId, listingId: frozenListingId }, 'PUBLISHED', true);
    if (!evidence) {
      // An Offer can exist with the right identity yet retain an old price.
      // Never describe a payload mismatch as absence during reconciliation.
      throw new Error(`Variation listing final offer ${child.sku} does not match the desired non-quantity payload (including price); publication cannot be confirmed.`);
    }
    listingIds.add(frozenListingId);
  }
  if (listingIds.size !== 1) throw new Error('Variation listing final reconciliation does not resolve one listing ID.');
  if (listingPriceVerificationRequired) {
    const getListing = input.remote.getListing;
    if (!getListing) throw new Error('Variation listing price publication requires a listing-facing Trading GetItem read.');
    const prices = listingVariationPrices(await getListing(frozenListingId), frozenListingId, true);
    const listingChildren = desiredBundle.children.filter((child) => child.quantity > 0);
    const desiredSkus = new Set(listingChildren.map((child) => child.sku));
    if (prices.size !== desiredSkus.size || [...prices.keys()].some((sku) => !desiredSkus.has(sku))) {
      throw new Error('Variation listing final listing-facing SKU set does not match the desired children.');
    }
    for (const child of listingChildren) {
      const expected = expectedOfferPrice(child);
      const observed = prices.get(child.sku);
      if (!observed || observed.currency !== expected.currency || observed.value !== expected.value) {
        throw new Error(`Variation listing final listing-facing price ${child.sku} does not match the desired price.`);
      }
    }
  }

  // The Offer and Inventory API can both report positive stock even when
  // Trading GetItem still excludes a formerly sold-out child. Refuse local
  // confirmation until its listing-facing identity, price and quantity match.
  const restockedChildren = desiredBundle.children.filter((child) => {
    const previous = previousBundle.children.find((candidate) => candidate.variationId === child.variationId);
    const quantity = remoteQuantities?.[child.sku]
      ? parseConfirmedRemoteQuantity(remoteQuantities[child.sku], child.sku).sellableQuantity
      : previous?.quantity;
    return Boolean(previous && quantity === 0 && child.quantity > 0);
  });
  if (restockedChildren.length > 0) {
    const getListing = input.remote.getListing;
    if (!getListing) throw new Error('Variation listing restock final reconciliation requires Trading GetItem.');
    const listing = await getListing(frozenListingId);
    for (const child of restockedChildren) {
      assertListingPriceSet(listing, frozenListingId, desiredBundle.children, 'restock final state', true);
      if (listingRestockEvidence(listing, frozenListingId, child) === null) {
        throw new Error(`Variation listing restock ${child.sku} is not present with the exact listing-facing quantity and price.`);
      }
    }
  }

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
