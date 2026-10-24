import type { Json } from '@ebay-inventory/data';
import type {VariationListingPermanentRemovalPlan} from '@/ebay/variation-listing-permanent-removal.js';

export type RemovedSkuRetirementState = 'ready' | 'started' | 'unknown' | 'confirmed_complete';

export interface RemovedSkuRetirementRecord {
  revisionId: string;
  groupId: string;
  targetVariationId?: string;
  targetSku: string;
  targetOfferId: string;
  marketplaceId?: string;
  listingId?: string;
  c2ConfirmedRevision?: number;
  c2TerminalCheckpointId?: string;
  state: RemovedSkuRetirementState;
  evidence?: Json | null;
}

export interface RemovedSkuRetirementPrepareInput {
  revisionId: string;
  groupId: string;
  targetVariationId: string;
  targetSku: string;
}

export type RemovedSkuRetirementEvidence = Json;

/**
 * The store must derive and verify the identity from the immutable v3
 * removal revision and its terminal c2 checkpoint in ONE DB transaction.
 * start() persists intent before the eBay mutation; unknown states must
 * survive restarts and cannot initiate another blind delete.
 */
export interface RemovedSkuRetirementStore {
  load(revisionId: string): Promise<RemovedSkuRetirementRecord | null>;
  prepare(input: RemovedSkuRetirementPrepareInput): Promise<RemovedSkuRetirementRecord>;
  start(revisionId: string): Promise<RemovedSkuRetirementRecord>;
  markUnknown(revisionId: string, evidence: RemovedSkuRetirementEvidence): Promise<RemovedSkuRetirementRecord>;
  markComplete(revisionId: string, evidence: RemovedSkuRetirementEvidence): Promise<RemovedSkuRetirementRecord>;
}

export interface RemovedSkuRetirementOffer {
  offerId: string;
  sku: string;
  marketplaceId: string;
  status: 'PUBLISHED' | 'UNPUBLISHED';
  listingId: string | null;
  availableQuantity: number;
}

/**
 * readAllOffers MUST be an exhaustive all-marketplace read, not the existing
 * marketplace-scoped getOffers method. Unknown/partial pagination blocks.
 */
export interface RemovedSkuRetirementRemote {
  readItem(sku: string): Promise<{state: 'present'; sku: string; groupKeys: string[] | null; quantity: number} | {state: 'absent'}>;
  readAllOffers(sku: string): Promise<{complete: boolean; offers: RemovedSkuRetirementOffer[]}>;
  verifySurvivors(plan: VariationListingPermanentRemovalPlan): Promise<boolean>;
  deleteInventoryItem(sku: string): Promise<void>;
}

export interface RemovedSkuRetirementResult {
  revisionId: string;
  targetSku: string;
  state: 'confirmed_complete';
  /** All target eBay resource deletion was verified, not inferred from a 204. */
  itemAbsent: true;
  offerAbsent: true;
}

export class RemovedSkuRetirementBlocked extends Error {
  constructor(message: string) { super(message); this.name = 'RemovedSkuRetirementBlocked'; }
}

function assertRecord(record: RemovedSkuRetirementRecord, plan: VariationListingPermanentRemovalPlan): void {
  const offer = plan.offerIdsBySku[plan.targetSku];
  if (!offer || record.revisionId !== plan.captureInput.revisionId ||
      record.groupId !== plan.captureInput.groupId ||
      (record.targetVariationId !== undefined && record.targetVariationId !== plan.targetVariationId) ||
      record.targetSku !== plan.targetSku || record.targetOfferId !== offer ||
      (record.marketplaceId !== undefined && record.marketplaceId !== plan.marketplaceId) ||
      (record.listingId !== undefined && record.listingId !== plan.listingId) ||
      (record.c2ConfirmedRevision !== undefined && record.c2ConfirmedRevision !== plan.captureInput.capturedDesiredRevision) ||
      (record.c2TerminalCheckpointId !== undefined && record.c2TerminalCheckpointId.trim() === '') ||
      !['ready','started','unknown','confirmed_complete'].includes(record.state)) {
    throw new RemovedSkuRetirementBlocked('Durable remote retirement identity/state conflicts with the frozen v3 removal.');
  }
}

function assertQuantityZero(plan: VariationListingPermanentRemovalPlan): void {
  const q = plan.quantitiesBySku[plan.targetSku];
  if (!q || q.inventoryItemQuantity !== 0 || q.offerQuantity !== 0 || q.sellableQuantity !== 0 ||
      !plan.survivorSkus.length || plan.survivorSkus.includes(plan.targetSku)) {
    throw new RemovedSkuRetirementBlocked('Frozen removal is not an exact zero-quantity, distinct-target removal.');
  }
}

function completionEvidence(plan: VariationListingPermanentRemovalPlan, targetOfferId: string): RemovedSkuRetirementEvidence {
  return {
    revisionId: plan.captureInput.revisionId,
    targetSku: plan.targetSku,
    targetOfferId,
    marketplaceId: plan.marketplaceId,
    listingId: plan.listingId,
    item: { state: 'absent', sku: plan.targetSku },
    offers: { complete: true, offers: [] },
    survivors: { exact: true, skus: [...plan.survivorSkus] },
  };
}

async function readTarget(
  plan: VariationListingPermanentRemovalPlan,
  remote: RemovedSkuRetirementRemote,
): Promise<'present' | 'absent'> {
  const [item, offerResult] = await Promise.all([
    remote.readItem(plan.targetSku),
    remote.readAllOffers(plan.targetSku),
  ]);
  if (!offerResult.complete || !Array.isArray(offerResult.offers)) {
    throw new RemovedSkuRetirementBlocked('All-marketplace Offer coverage is incomplete.');
  }
  if (offerResult.offers.some((offer) =>
    offer.sku !== plan.targetSku ||
    !offer.offerId || !offer.marketplaceId ||
    !Number.isSafeInteger(offer.availableQuantity) || offer.availableQuantity < 0 ||
    !['PUBLISHED','UNPUBLISHED'].includes(offer.status)
  )) throw new RemovedSkuRetirementBlocked('The eBay Offer read contains unknown or conflicting identities.');
  const ids = offerResult.offers.map((offer) => offer.offerId);
  if (new Set(ids).size !== ids.length) throw new RemovedSkuRetirementBlocked('Duplicate eBay Offer IDs cannot be reconciled.');

  if (item.state === 'absent') {
    if (offerResult.offers.length) {
      throw new RemovedSkuRetirementBlocked('Inventory Item is absent but associated eBay Offers still exist.');
    }
    return 'absent';
  }
  if (item.state !== 'present' || item.sku !== plan.targetSku ||
      !(item.groupKeys === null || (Array.isArray(item.groupKeys) && item.groupKeys.length === 0)) || item.quantity !== 0 ||
      offerResult.offers.length !== 1) {
    throw new RemovedSkuRetirementBlocked('Target eBay Item/Offer resources are not in the exact removable state.');
  }
  const offer = offerResult.offers[0]!;
  if (offer.offerId !== plan.offerIdsBySku[plan.targetSku] ||
      offer.marketplaceId !== plan.marketplaceId || offer.status !== 'UNPUBLISHED' ||
      offer.availableQuantity !== 0 ||
      offer.listingId !== null) {
    throw new RemovedSkuRetirementBlocked('The target SKU has a foreign, active, mismatched, or nonzero Offer.');
  }
  return 'present';
}

/**
 * New resource-deletion phase, deliberately independent of the terminal
 * one-operation c2 group-membership journal. No image deletion happens here.
 * The persistent store MUST guarantee atomic transitions and original c2
 * terminal evidence; this orchestrator never fabricates database authority.
 */
export async function executeRemovedSkuRemoteRetirement(input: {
  plan: VariationListingPermanentRemovalPlan;
  store: RemovedSkuRetirementStore;
  remote: RemovedSkuRetirementRemote;
}): Promise<RemovedSkuRetirementResult> {
  const {plan, store, remote} = input;
  assertQuantityZero(plan);
  const targetOfferId = plan.offerIdsBySku[plan.targetSku];
  if (!targetOfferId) throw new RemovedSkuRetirementBlocked('Frozen removal is missing the target Offer identity.');
  let record = await store.prepare({
    revisionId: plan.captureInput.revisionId,
    groupId: plan.captureInput.groupId,
    targetVariationId: plan.targetVariationId,
    targetSku: plan.targetSku,
  });
  assertRecord(record, plan);

  // Every entry/recovery checks survivors and exact remote resources, including
  // when the prior HTTP response was lost. Never blindly issue a second DELETE.
  if (!await remote.verifySurvivors(plan)) {
    throw new RemovedSkuRetirementBlocked('The active group/listing or surviving variations changed.');
  }
  const initialState = await readTarget(plan, remote);
  if (initialState === 'absent') {
    record = await store.markComplete(plan.captureInput.revisionId, completionEvidence(plan, targetOfferId));
    assertRecord(record, plan);
    if (record.state !== 'confirmed_complete') {
      throw new RemovedSkuRetirementBlocked('Remote absence could not be durably confirmed.');
    }
    return {revisionId: record.revisionId, targetSku: plan.targetSku, state: 'confirmed_complete', itemAbsent:true, offerAbsent:true};
  }
  if (record.state === 'confirmed_complete') {
    throw new RemovedSkuRetirementBlocked('Completed remote deletion journal contradicts the live eBay Item.');
  }
  if (record.state !== 'ready') {
    throw new RemovedSkuRetirementBlocked('A previous remote delete is unresolved; exact absence or manual resolution is required.');
  }

  record = await store.start(record.revisionId);
  assertRecord(record, plan);
  if (record.state !== 'started') throw new RemovedSkuRetirementBlocked('Remote delete intent was not durably started.');

  try {
    await remote.deleteInventoryItem(plan.targetSku);
  } catch (error) {
    await store.markUnknown(record.revisionId, {
      phase: 'delete', state: 'unknown', targetSku: plan.targetSku, targetOfferId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new RemovedSkuRetirementBlocked('eBay Inventory Item deletion outcome is unknown; reconcile before retry.');
  }

  // A successful HTTP response is not final proof. A failed read must persist
  // ambiguity, not replay or report success.
  try {
    if (!await remote.verifySurvivors(plan) || await readTarget(plan, remote) !== 'absent') {
      throw new RemovedSkuRetirementBlocked('eBay deletion returned but exact remote absence is unproven.');
    }
  } catch (error) {
    await store.markUnknown(record.revisionId, {
      phase: 'post_delete_reconcile', state: 'unknown', targetSku: plan.targetSku, targetOfferId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  record = await store.markComplete(record.revisionId, completionEvidence(plan, targetOfferId));
  assertRecord(record, plan);
  if (record.state !== 'confirmed_complete') throw new RemovedSkuRetirementBlocked('Remote deletion completed without durable confirmation.');
  return {revisionId: record.revisionId, targetSku: plan.targetSku, state: 'confirmed_complete', itemAbsent:true, offerAbsent:true};
}
