import type {
  C2bRemoval01IncidentRepairRecord,
  C2bRemoval01IncidentRepairStore,
  Json,
  VariationListingRevisionRow,
} from '@ebay-inventory/data';

import type {
  IncidentFrozenEvidence,
  IncidentRepairLedger,
  IncidentRepairPlan,
  IncidentRepairRecord,
} from '@/ebay/variation-listing-incident-repair.js';

import {
  buildC2BRemoval01Plan,
  C2B_REMOVAL01_MANIFEST,
  incidentJsonDigest,
} from '@/ebay/variation-listing-incident-repair.js';

type JsonRecord = Record<string, Json>;

function object(value: Json, label: string): JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value as JsonRecord;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function requiredArray(value: unknown, label: string): Json[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value as Json[];
}

function exactJson(actual: unknown, expected: unknown): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function exactKeys(value: JsonRecord, expected: readonly string[], label: string): void {
  const keys = Object.keys(value).sort();
  const expectedKeys = [...expected].sort();
  if (!exactJson(keys, expectedKeys)) throw new Error(`${label} must cover exactly the incident SKUs.`);
}

function quantity(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} quantity must be a non-negative integer.`);
  }
  return value;
}

/**
 * Durable c2 snapshots store the semantic eBay payloads without mutable
 * quantities. Re-apply that boundary here so a future row carrying a
 * quantity field cannot be accidentally compared as immutable identity.
 */
function stripQuantity(payload: Json, kind: 'item' | 'offer', label: string): Json {
  const clone = structuredClone(payload);
  const row = object(clone, label);
  if (kind === 'offer') {
    delete row.availableQuantity;
    return clone;
  }
  const availability = row.availability;
  if (availability !== undefined) {
    const availabilityRow = object(availability, `${label} availability`);
    const ship = availabilityRow.shipToLocationAvailability;
    if (ship !== undefined) {
      const shipRow = object(ship, `${label} shipToLocationAvailability`);
      delete shipRow.quantity;
    }
  }
  return clone;
}

function readQuantity(payload: Json, kind: 'item' | 'offer', label: string): number | null {
  const row = object(payload, label);
  if (kind === 'offer') return row.availableQuantity === undefined ? null : quantity(row.availableQuantity, `${label} availableQuantity`);
  const availability = row.availability;
  if (availability === undefined) return null;
  const ship = object(availability, `${label} availability`).shipToLocationAvailability;
  if (ship === undefined) return null;
  const value = object(ship, `${label} shipToLocationAvailability`).quantity;
  return value === undefined ? null : quantity(value, `${label} quantity`);
}

function payloadMap(value: Json, kind: 'item' | 'offer', skus: readonly string[]): Record<string, Json> {
  const rows = object(value, `${kind} payload map`);
  exactKeys(rows, skus, `${kind} payload map`);
  return Object.fromEntries(skus.map((sku) => [sku, stripQuantity(rows[sku]!, kind, `${kind} payload ${sku}`)]));
}

function confirmedSelectorBySku(snapshot: Json, skus: readonly string[]): { targetVariationId: string; selectorBySku: Record<string, string> } {
  const root = object(snapshot, 'C2BRemoval01 snapshot');
  const confirmed = object(root.confirmed, 'C2BRemoval01 confirmed snapshot');
  const aggregate = object(confirmed.aggregate, 'C2BRemoval01 confirmed aggregate');
  const confirmedGroup = object(aggregate.group, 'C2BRemoval01 confirmed group');
  if (confirmedGroup.group_id !== C2B_REMOVAL01_MANIFEST.groupId
    || confirmedGroup.group_key !== C2B_REMOVAL01_MANIFEST.groupKey
    || confirmedGroup.marketplace_id !== C2B_REMOVAL01_MANIFEST.marketplaceId) {
    throw new Error('C2BRemoval01 confirmed aggregate group identity is not exact.');
  }
  const variations = requiredArray(aggregate.variations, 'C2BRemoval01 confirmed variations').map((value, index) => object(value, `C2BRemoval01 confirmed variation ${index}`));
  if (variations.length !== skus.length) throw new Error('C2BRemoval01 confirmed aggregate must contain exactly three variations.');
  const ordered = [...variations].sort((left, right) => quantity(left.position, 'variation position') - quantity(right.position, 'variation position'));
  const positions = ordered.map((variation) => quantity(variation.position, 'variation position'));
  if (new Set(positions).size !== positions.length) throw new Error('C2BRemoval01 confirmed variation positions must be unique.');
  const actualSkus = ordered.map((variation) => requiredString(variation.sku, 'variation SKU'));
  if (!exactJson([...actualSkus].sort(), [...skus].sort())) throw new Error('C2BRemoval01 confirmed aggregate SKU membership is not exact.');
  const selectorBySku: Record<string, string> = {};
  for (const variation of ordered) {
    const sku = requiredString(variation.sku, 'variation SKU');
    const selector = requiredString(variation.selector_value, `selector for ${sku}`);
    if (selectorBySku[sku] !== undefined) throw new Error(`C2BRemoval01 confirmed selector mapping duplicates ${sku}.`);
    selectorBySku[sku] = selector;
  }
  if (new Set(Object.values(selectorBySku)).size !== skus.length) throw new Error('C2BRemoval01 confirmed selectors must be unique.');
  const target = ordered.find((variation) => variation.sku === C2B_REMOVAL01_MANIFEST.target.sku);
  if (!target) throw new Error('C2BRemoval01 confirmed target variation is missing.');
  return { targetVariationId: requiredString(target.variation_id, 'target variation ID'), selectorBySku };
}

export interface C2BRemoval01SellerVerifiedGroupRead {
  sellerUserId: string;
  /** Explicit resource identity; eBay's raw Group response may omit it. */
  groupKey: string;
  variantSKUs: string[];
  payload: Json;
}

/**
 * Hydrate the incident plan from immutable revision evidence plus a fresh,
 * seller-verified Group read. The held revision's expectedGroupPayload has
 * historical SKU/Card ordering that is not a trustworthy provider pairing;
 * neither it nor the malformed replacement is eligible plan input.
 */
export function buildC2BRemoval01PlanFromRevision(
  revision: VariationListingRevisionRow,
  sellerVerifiedGroup: C2BRemoval01SellerVerifiedGroupRead,
): IncidentRepairPlan {
  if (revision.revision_id !== C2B_REMOVAL01_MANIFEST.revisionId
    || revision.group_id !== C2B_REMOVAL01_MANIFEST.groupId
    || revision.snapshot_version !== 3
    || revision.snapshot_digest !== C2B_REMOVAL01_MANIFEST.snapshotDigest
    || revision.captured_desired_revision !== C2B_REMOVAL01_MANIFEST.desiredRevision
    || revision.operation_count !== 1) {
    throw new Error('C2BRemoval01 immutable revision identity/version/digest is not exact.');
  }
  if (incidentJsonDigest(revision.snapshot) !== C2B_REMOVAL01_MANIFEST.snapshotDigest) {
    throw new Error('C2BRemoval01 immutable revision snapshot digest does not match its canonical digest.');
  }
  if (!Array.isArray(revision.operation_plan) || revision.operation_plan.length !== 1) {
    throw new Error('C2BRemoval01 immutable revision operation plan is not exact.');
  }
  const operation = object(revision.operation_plan[0]!, 'C2BRemoval01 operation');
  if (operation.operation_key !== 'remove-group-membership'
    || operation.operation_kind !== 'permanent_removal_group_membership'
    || operation.target_ref !== C2B_REMOVAL01_MANIFEST.groupKey
    || operation.sequence_no !== 1
    || operation.intent_version !== 1) {
    throw new Error('C2BRemoval01 immutable revision operation identity is not exact.');
  }
  const intent = object(operation.intent, 'C2BRemoval01 operation intent');
  if (intent.groupKey !== C2B_REMOVAL01_MANIFEST.groupKey
    || intent.targetSku !== C2B_REMOVAL01_MANIFEST.target.sku
    || !exactJson(intent.survivorSkus, C2B_REMOVAL01_MANIFEST.survivors.map((survivor) => survivor.sku))) {
    throw new Error('C2BRemoval01 immutable revision operation intent is not exact.');
  }
  if (typeof operation.intent_digest !== 'string' || operation.intent_digest !== incidentJsonDigest(intent)) {
    throw new Error('C2BRemoval01 immutable revision operation intent digest is invalid.');
  }

  const root = object(revision.snapshot, 'C2BRemoval01 snapshot');
  const metadata = object(root.permanentRemoval, 'C2BRemoval01 permanentRemoval metadata');
  if (metadata.groupKey !== C2B_REMOVAL01_MANIFEST.groupKey
    || metadata.targetSku !== C2B_REMOVAL01_MANIFEST.target.sku
    || metadata.marketplaceId !== C2B_REMOVAL01_MANIFEST.marketplaceId
    || metadata.listingId !== C2B_REMOVAL01_MANIFEST.listingId
    || !exactJson(metadata.survivorSkus, C2B_REMOVAL01_MANIFEST.survivors.map((survivor) => survivor.sku))) {
    throw new Error('C2BRemoval01 permanentRemoval metadata identity is not exact.');
  }
  const skus = [C2B_REMOVAL01_MANIFEST.target.sku, ...C2B_REMOVAL01_MANIFEST.survivors.map((survivor) => survivor.sku)];
  const mapping = confirmedSelectorBySku(revision.snapshot, skus);
  const metadataTargetVariationId = requiredString(metadata.targetVariationId, 'C2BRemoval01 targetVariationId');
  if (metadataTargetVariationId !== mapping.targetVariationId) {
    throw new Error('C2BRemoval01 targetVariationId does not match confirmed application evidence.');
  }
  if (sellerVerifiedGroup.sellerUserId !== C2B_REMOVAL01_MANIFEST.sellerUserId
    || sellerVerifiedGroup.groupKey !== C2B_REMOVAL01_MANIFEST.groupKey) {
    throw new Error('C2BRemoval01 Group read is not seller-verified for the incident seller.');
  }
  const currentGroup = object(sellerVerifiedGroup.payload, 'C2BRemoval01 seller-verified Group payload');
  if (!exactJson(currentGroup.variantSKUs, sellerVerifiedGroup.variantSKUs)) {
    throw new Error('C2BRemoval01 seller-verified Group SKU metadata does not match its payload.');
  }
  if ((currentGroup.inventoryItemGroupKey !== undefined && currentGroup.inventoryItemGroupKey !== sellerVerifiedGroup.groupKey)
    || (currentGroup.groupKey !== undefined && currentGroup.groupKey !== sellerVerifiedGroup.groupKey)) {
    throw new Error('C2BRemoval01 seller-verified Group key is not exact.');
  }
  const normalizedGroupPayload = structuredClone(sellerVerifiedGroup.payload);
  object(normalizedGroupPayload, 'C2BRemoval01 normalized Group payload').inventoryItemGroupKey = sellerVerifiedGroup.groupKey;
  const itemPayloadRows = object(metadata.inventoryItemPayloadsBySku, 'C2BRemoval01 inventoryItemPayloadsBySku');
  const offerPayloadRows = object(metadata.offerPayloadsBySku, 'C2BRemoval01 offerPayloadsBySku');
  const itemPayloadWithoutQuantityBySku = payloadMap(itemPayloadRows, 'item', skus);
  const offerPayloadWithoutQuantityBySku = payloadMap(offerPayloadRows, 'offer', skus);
  const quantities = object(metadata.quantitiesBySku, 'C2BRemoval01 quantitiesBySku');
  exactKeys(quantities, skus, 'C2BRemoval01 quantitiesBySku');
  for (const sku of skus) {
    const quantityRow = object(quantities[sku]!, `C2BRemoval01 quantitiesBySku ${sku}`);
    const expected = sku === C2B_REMOVAL01_MANIFEST.target.sku ? 0 : 1;
    if (quantity(quantityRow.inventoryItemQuantity, `${sku} inventory quantity`) !== expected
      || quantity(quantityRow.offerQuantity, `${sku} offer quantity`) !== expected
      || quantity(quantityRow.sellableQuantity, `${sku} sellable quantity`) !== expected) {
      throw new Error(`C2BRemoval01 frozen quantity evidence for ${sku} is not exact.`);
    }
    const itemQuantity = readQuantity(itemPayloadRows[sku]!, 'item', `C2BRemoval01 item ${sku}`);
    const offerQuantity = readQuantity(offerPayloadRows[sku]!, 'offer', `C2BRemoval01 offer ${sku}`);
    if ((itemQuantity !== null && itemQuantity !== expected) || (offerQuantity !== null && offerQuantity !== expected)) {
      throw new Error(`C2BRemoval01 frozen payload quantity for ${sku} is not exact.`);
    }
  }
  const frozen: IncidentFrozenEvidence = {
    originalSnapshotDigest: revision.snapshot_digest,
    targetVariationId: mapping.targetVariationId,
    groupPayload: normalizedGroupPayload,
    selectorBySku: mapping.selectorBySku,
    itemPayloadWithoutQuantityBySku,
    offerPayloadWithoutQuantityBySku,
  };
  const plan = buildC2BRemoval01Plan(frozen);
  // The fresh Group supplies current independent membership/value collections,
  // while immutable expectedGroupPayload remains the SQL common-field witness.
  // Mirror the unapplied SQL projection exactly so prepare cannot discover a
  // title/description/aspect/image drift only after durable intent is needed.
  const expectedGroupPayload = structuredClone(metadata.expectedGroupPayload);
  const expectedGroup = object(expectedGroupPayload, 'C2BRemoval01 expectedGroupPayload');
  expectedGroup.variantSKUs = C2B_REMOVAL01_MANIFEST.survivors.map((survivor) => survivor.sku);
  const expectedVariesBy = object(expectedGroup.variesBy, 'C2BRemoval01 expectedGroupPayload variesBy');
  const expectedSpecifications = requiredArray(expectedVariesBy.specifications, 'C2BRemoval01 expectedGroupPayload specifications');
  if (expectedSpecifications.length !== 1) throw new Error('C2BRemoval01 expectedGroupPayload must have one Card specification.');
  const expectedSpecification = object(expectedSpecifications[0]!, 'C2BRemoval01 expectedGroupPayload Card specification');
  if (expectedSpecification.name !== 'Card') throw new Error('C2BRemoval01 expectedGroupPayload Card specification is not exact.');
  expectedSpecification.values = C2B_REMOVAL01_MANIFEST.survivors.map((survivor) => mapping.selectorBySku[survivor.sku]!);
  if (plan.correctedPayloadDigest !== incidentJsonDigest(expectedGroupPayload)) {
    throw new Error('C2BRemoval01 fresh Group common fields do not match the immutable SQL projection.');
  }
  // Malformed replacementGroupPayload is never read or hydrated.
  return plan;
}

function record(row: C2bRemoval01IncidentRepairRecord): IncidentRepairRecord {
  return {
    repairId: row.repairId,
    revisionId: row.revisionId,
    state: row.state,
    correctedPayloadDigest: row.correctedPayloadDigest,
    evidence: row.evidence,
  };
}

/**
 * Thin typed boundary between the pure incident state machine and the
 * service-role-only Supabase RPC store. It creates no client and performs no
 * I/O until the injected store is called.
 */
export function createC2bRemoval01IncidentRepairLedger(
  store: C2bRemoval01IncidentRepairStore,
): IncidentRepairLedger {
  return {
    load: async (repairId) => {
      const row = await store.load(repairId);
      return row === null ? null : record(row);
    },
    prepare: async (plan: IncidentRepairPlan) => record(await store.prepare({
      repairId: plan.repairId,
      groupId: plan.manifest.groupId,
      revisionId: plan.manifest.revisionId,
      targetVariationId: plan.frozen.targetVariationId,
      sellerUserId: plan.manifest.sellerUserId,
      marketplaceId: plan.manifest.marketplaceId,
      listingId: plan.manifest.listingId,
      snapshotDigest: plan.manifest.snapshotDigest,
      correctedGroupPayload: plan.correctedGroupPayload,
      correctedPayloadDigest: plan.correctedPayloadDigest,
    })),
    start: async (repairId) => record(await store.start(repairId)),
    markUnknown: async (repairId, evidence) => record(await store.markUnknown(repairId, evidence)),
    markPost: async (repairId, state, evidence) => record(await store.markPost(repairId, { state, evidence })),
    appendTerminalC2: async (repairId, evidence) => {
      await store.appendTerminalC2(repairId, evidence);
    },
  };
}
