import type {
  Json,
  VariationListingAggregateSnapshot,
  VariationListingCopyRow,
  VariationListingGroupRow,
  VariationListingPublishingCheckpointRow,
  VariationListingRevisionRow,
  VariationListingVariationRow,
} from '@ebay-inventory/data';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  buildVariationListingHistoricalInventoryPayloadBundle,
  buildVariationListingInventoryPayloadBundle,
} from '@/ebay/variation-listing-payloads.js';
import {
  executeVariationListingActiveRevision,
  prepareVariationListingFrozenActiveRevision,
  reconstructConfirmedRemoteIdentity,
  reconstructVariationListingConfirmedRepresentativeImages,
  type VariationListingActiveMutationGateway,
  type VariationListingActiveRevisionExecutionInput,
  type VariationListingFrozenActiveRevision,
} from '@/ebay/variation-listing-active-revision.js';

const eps = (name: string): string => `https://i.ebayimg.com/images/g/${name}/s-l1600.jpg`;
const timestamp = '2026-09-01T00:00:00Z';

function group(overrides: Partial<VariationListingGroupRow> = {}): VariationListingGroupRow {
  return {
    category_id: '261328', condition_description: null, condition_descriptors: [{ name: '40001', values: ['400012'] }], condition_id: '4000', condition_token: 'VERY_GOOD', created_at: timestamp, derived_common_ebay_aspects: { Sport: ['Baseball'] }, description: 'Cards', desired_revision: 2, fulfillment_policy_id: 'fulfillment', group_id: 'group-1', group_key: 'GROUP-1', last_confirmed_revision: 1, lifecycle_state: 'active', listing_format: 'FIXED_PRICE', marketplace_id: 'EBAY_US', merchant_location_key: 'warehouse', next_inventory_serial: 3, payment_policy_id: 'payment', return_policy_id: 'return', selector_name: 'Card', sku_bucket_token: 'bucket', sku_category_code: 'sports', title: 'Cards', updated_at: timestamp, ...overrides,
  };
}
function variation(id: string, position: number, representativeCopyId = `copy-${id}`, price = 0.99): VariationListingVariationRow {
  return { created_at: timestamp, group_id: 'group-1', inventory_serial: position + 1, position, price_amount: price as 0.99 | 1.49, price_currency: 'USD', representative_copy_id: representativeCopyId, selector_value: `Card ${id}`, sku: `SKU-${id}`, updated_at: timestamp, variation_id: `variation-${id}`, variation_metadata: {} };
}
function copy(id: string, variationId = `variation-${id}`): VariationListingCopyRow {
  return { availability_state: 'available', back_r2_key: `r2/${id}/back`, capture_back_source_ref: `source/${id}/back`, capture_front_source_ref: `source/${id}/front`, capture_pair_id: `pair-${id}`, capture_source_key: `capture-${id}`, capture_started_at: timestamp, captured_at: timestamp, condition_notes: null, condition_token: 'VERY_GOOD', copy_id: `copy-${id}`, created_at: timestamp, front_r2_key: `r2/${id}/front`, updated_at: timestamp, variation_id: variationId };
}
function aggregate(overrides: Partial<VariationListingAggregateSnapshot> = {}): VariationListingAggregateSnapshot {
  return { group: group(), variations: [variation('A', 0), variation('B', 1)], copies: [copy('A'), copy('B')], ...overrides };
}
function digest(value: Json): string {
  const canonical = (v: Json): string => Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v !== null && typeof v === 'object' ? `{${Object.entries(v).sort(([a],[b]) => a.localeCompare(b)).map(([k,c]) => `${JSON.stringify(k)}:${canonical(c as Json)}`).join(',')}}` : JSON.stringify(v);
  return createHash('sha256').update(canonical(value)).digest('hex');
}
function version1Revision(previous: VariationListingAggregateSnapshot): VariationListingRevisionRow {
  const snapshot = { aggregate: previous, mediaResources: [], representativeImages: [{ copyId: 'copy-A', frontEpsUrl: eps('AF'), backEpsUrl: eps('AB') }, { copyId: 'copy-B', frontEpsUrl: eps('BF'), backEpsUrl: eps('BB') }] } as Json;
  const offerOperations = previous.variations.map((entry, index) => ({ intent: {}, intent_digest: digest({}), intent_version: 1, operation_key: `child-offer:${entry.variation_id}`, operation_kind: 'child_offer_write', sequence_no: index + 1, target_ref: entry.sku }));
  const operationPlan = [
    ...offerOperations,
    { intent: {}, intent_digest: digest({}), intent_version: 1, operation_key: 'group-publish', operation_kind: 'group_publish', sequence_no: offerOperations.length + 1, target_ref: previous.group.group_key },
    { intent: {}, intent_digest: digest({}), intent_version: 1, operation_key: 'revision-reconcile', operation_kind: 'revision_reconcile', sequence_no: offerOperations.length + 2, target_ref: previous.group.group_key },
  ];
  return { captured_at: timestamp, captured_desired_revision: 1, group_id: 'group-1', operation_count: operationPlan.length, operation_plan: operationPlan, revision_id: 'revision-1', snapshot, snapshot_digest: digest(snapshot), snapshot_version: 1 };
}

function version1Checkpoints(previous: VariationListingAggregateSnapshot): VariationListingPublishingCheckpointRow[] {
  const rows: VariationListingPublishingCheckpointRow[] = [];
  for (const entry of previous.variations) {
    rows.push(
      checkpointFrom({ revisionId: 'revision-1', operationKey: `child-offer:${entry.variation_id}`, attemptNumber: 1, checkpointNumber: 1, state: 'started', observedRemoteState: null, evidence: {} }),
      checkpointFrom({ revisionId: 'revision-1', operationKey: `child-offer:${entry.variation_id}`, attemptNumber: 1, checkpointNumber: 2, state: 'confirmed_complete', observedRemoteState: 'present', evidence: { listingId: null, offerId: `offer-${entry.sku}`, sku: entry.sku } }),
    );
  }
  for (const operationKey of ['group-publish', 'revision-reconcile']) {
    rows.push(
      checkpointFrom({ revisionId: 'revision-1', operationKey, attemptNumber: 1, checkpointNumber: 1, state: 'started', observedRemoteState: null, evidence: {} }),
      checkpointFrom({ revisionId: 'revision-1', operationKey, attemptNumber: 1, checkpointNumber: 2, state: 'confirmed_complete', observedRemoteState: 'present', evidence: { listingId: 'listing-1' } }),
    );
  }
  return rows;
}
function remoteFor(
  previous: VariationListingAggregateSnapshot,
  quantityOverrides: Record<string, { inventoryItemQuantity?: number; offerQuantity?: number }> = {},
  historicalConditionPayload = false
) {
  const images = [{ copyId: 'copy-A', frontEpsUrl: eps('AF'), backEpsUrl: eps('AB') }, { copyId: 'copy-B', frontEpsUrl: eps('BF'), backEpsUrl: eps('BB') }];
  const bundleBuilder = historicalConditionPayload
    ? buildVariationListingHistoricalInventoryPayloadBundle
    : buildVariationListingInventoryPayloadBundle;
  const bundle = bundleBuilder({ aggregate: previous, representativeImages: images });
  const items = new Map(bundle.children.map((child) => {
    const payload = structuredClone(child.inventoryItem) as unknown as Record<string, Json>;
    const quantity = quantityOverrides[child.sku]?.inventoryItemQuantity;
    if (quantity !== undefined) {
      const availability = payload.availability as Record<string, Json>;
      const ship = availability.shipToLocationAvailability as Record<string, Json>;
      ship.quantity = quantity;
    }
    return [child.sku, payload as Json] as const;
  }));
  const offers = new Map(bundle.children.map((child) => {
    const payload = structuredClone(child.offer) as unknown as Record<string, Json>;
    const quantity = quantityOverrides[child.sku]?.offerQuantity;
    if (quantity !== undefined) payload.availableQuantity = quantity;
    return [child.sku, payload as Json] as const;
  }));
  return {
    bundle,
    remote: {
      async getInventoryItem(sku: string) { const payload = items.get(sku); return { state: 'present' as const, value: { groupKeys: [bundle.groupKey], payload: payload!, sku } }; },
      async getOffers(sku: string, marketplaceId: string) { const payload = offers.get(sku); return { state: 'present' as const, value: [{ lifecycleClass: 'active' as const, listingId: 'listing-1', marketplaceId, offerId: `offer-${sku}`, payload: payload!, sku, status: 'PUBLISHED' as const }] }; },
      async getInventoryItemGroup(_groupKey: string) { return { state: 'present' as const, value: { payload: bundle.group as unknown as Json, variantSKUs: [...bundle.group.variantSKUs].reverse() } }; },
    },
  };
}

function durableRevision(frozen: VariationListingFrozenActiveRevision): VariationListingRevisionRow {
  const capture = frozen.captureInput;
  return {
    captured_at: timestamp,
    captured_desired_revision: capture.capturedDesiredRevision,
    group_id: capture.groupId,
    operation_count: capture.operationPlan.length,
    operation_plan: capture.operationPlan.map((operation) => ({
      intent: operation.intent,
      intent_digest: operation.intentDigest,
      intent_version: operation.intentVersion,
      operation_key: operation.operationKey,
      operation_kind: operation.operationKind,
      sequence_no: operation.sequenceNo,
      target_ref: operation.targetRef,
    })),
    revision_id: capture.revisionId,
    snapshot: capture.snapshot,
    snapshot_digest: capture.snapshotDigest,
    snapshot_version: capture.snapshotVersion,
  };
}

function checkpointFrom(input: {
  revisionId: string;
  operationKey: string;
  attemptNumber: number;
  checkpointNumber: number;
  state: VariationListingPublishingCheckpointRow['state'];
  observedRemoteState: VariationListingPublishingCheckpointRow['observed_remote_state'];
  evidence: Json;
}): VariationListingPublishingCheckpointRow {
  return {
    attempt_number: input.attemptNumber,
    checkpoint_id: `${input.operationKey}-${input.attemptNumber}-${input.checkpointNumber}`,
    checkpoint_number: input.checkpointNumber,
    created_at: timestamp,
    evidence: input.evidence,
    observed_remote_state: input.observedRemoteState,
    operation_key: input.operationKey,
    revision_id: input.revisionId,
    state: input.state,
  };
}

function activeExecutionInput(
  frozen: VariationListingFrozenActiveRevision,
  revisions: { current: VariationListingRevisionRow | null; captureCalls: number[] },
  checkpoints: VariationListingPublishingCheckpointRow[],
  remote: VariationListingActiveRevisionExecutionInput['remote'],
  mutations: VariationListingActiveMutationGateway,
  overrides: Partial<VariationListingActiveRevisionExecutionInput['transaction']> = {},
): VariationListingActiveRevisionExecutionInput {
  return {
    frozen,
    journal: {
      loadRevision: async () => revisions.current,
      listCheckpoints: async () => [...checkpoints],
    },
    mutations,
    remote,
    transaction: {
      appendJournalCheckpoint: async (input) => {
        const row = checkpointFrom({
          revisionId: input.revisionId,
          operationKey: input.operationKey,
          attemptNumber: input.attemptNumber,
          checkpointNumber: input.checkpointNumber,
          state: input.state,
          observedRemoteState: input.observedRemoteState ?? null,
          evidence: input.evidence,
        });
        checkpoints.push(row);
        return { checkpoint: row };
      },
      captureRevision: async (input) => {
        revisions.captureCalls.push(1);
        const revision = durableRevision({ ...frozen, captureInput: input });
        revisions.current = revision;
        return { revision };
      },
      confirmRevision: async () => ({ ...frozen.snapshot.aggregate.group, last_confirmed_revision: frozen.captureInput.capturedDesiredRevision }),
      loadAggregate: async () => frozen.snapshot.aggregate,
      ...overrides,
    },
  };
}

describe('YP8.2 active revision preparation', () => {
  it('freezes a self-contained version-2 revision after exact confirmed active preflight', async () => {
    const previous = aggregate({ group: group({ desired_revision: 1, last_confirmed_revision: null, lifecycle_state: 'publish-ready' }) });
    const current = aggregate({ variations: [variation('A', 0, 'copy-A', 1.49), variation('B', 1)] });
    const { remote } = remoteFor(previous);
    const prepared = await prepareVariationListingFrozenActiveRevision({ currentAggregate: current, previousRevision: version1Revision(previous), previousCheckpoints: version1Checkpoints(previous), remote, revisionId: 'revision-2' });
    expect(prepared.captureInput.snapshotVersion).toBe(2);
    expect(prepared.snapshot.confirmed.remote.listingId).toBe('listing-1');
    expect(prepared.snapshot.confirmed.remote.offerIdsBySku).toEqual({ 'SKU-A': 'offer-SKU-A', 'SKU-B': 'offer-SKU-B' });
    expect(prepared.desiredBundlePreview?.children[0]?.offer.pricingSummary.price.value).toBe('1.49');
    expect(prepared.captureInput.operationPlan.at(-1)?.operationKind).toBe('revision_reconcile');
  });

  it('reconciles a legacy empty-descriptor listing and stages the corrected Card Condition descriptor', async () => {
    const previous = aggregate({
      group: group({
        condition_descriptors: [],
        desired_revision: 1,
        last_confirmed_revision: null,
        lifecycle_state: 'publish-ready',
      }),
    });
    const current = aggregate({
      group: group({
        condition_descriptors: [],
        desired_revision: 2,
        last_confirmed_revision: 1,
        lifecycle_state: 'active',
      }),
      variations: [variation('A', 0, 'copy-A', 1.49), variation('B', 1)],
    });
    const { remote } = remoteFor(previous, {}, true);

    const prepared = await prepareVariationListingFrozenActiveRevision({
      currentAggregate: current,
      previousRevision: version1Revision(previous),
      previousCheckpoints: version1Checkpoints(previous),
      remote,
      revisionId: 'revision-2',
    });

    expect(prepared.confirmedBundle.children[0]?.inventoryItem.conditionDescriptors).toEqual([]);
    expect(prepared.desiredBundlePreview?.children[0]?.inventoryItem.conditionDescriptors).toEqual([
      { name: '40001', values: ['400012'] },
    ]);
    expect(prepared.snapshot.aggregate.group.condition_descriptors).toEqual([
      { name: '40001', values: ['400012'] },
    ]);
  });

  it('uses the lower live Inventory Item/Offer quantity and adds exactly one eligible new copy', async () => {
    const previous = aggregate({ group: group({ desired_revision: 1, last_confirmed_revision: null, lifecycle_state: 'publish-ready' }) });
    const current = aggregate({
      group: group({ desired_revision: 2, last_confirmed_revision: 1, lifecycle_state: 'active' }),
      copies: [copy('A'), copy('A2', 'variation-A'), copy('B')],
    });
    const { remote } = remoteFor(previous, {
      'SKU-A': { inventoryItemQuantity: 1, offerQuantity: 2 },
      'SKU-B': { inventoryItemQuantity: 2, offerQuantity: 2 },
    });
    const prepared = await prepareVariationListingFrozenActiveRevision({ currentAggregate: current, previousRevision: version1Revision(previous), previousCheckpoints: version1Checkpoints(previous), remote, revisionId: 'revision-2' });
    expect(prepared.snapshot.confirmed.remote.quantitiesBySku).toEqual({
      'SKU-A': { inventoryItemQuantity: 1, offerQuantity: 2, sellableQuantity: 1 },
      'SKU-B': { inventoryItemQuantity: 2, offerQuantity: 2, sellableQuantity: 2 },
    });
    const childA = prepared.desiredBundlePreview?.children.find((child) => child.sku === 'SKU-A');
    expect(childA?.quantity).toBe(2);
    expect(childA?.inventoryItem.availability.shipToLocationAvailability.quantity).toBe(2);
    expect(childA?.offer.availableQuantity).toBe(2);
  });

  it('plans only changed child resources for duplicate replenishment and preserves full inherited remote identity', async () => {
    const previous = aggregate({ group: group({ desired_revision: 1, last_confirmed_revision: null, lifecycle_state: 'publish-ready' }) });
    const current = aggregate({
      group: group({ desired_revision: 2, last_confirmed_revision: 1, lifecycle_state: 'active' }),
      copies: [copy('A'), copy('A2', 'variation-A'), copy('B')],
    });
    const { remote } = remoteFor(previous);
    const prepared = await prepareVariationListingFrozenActiveRevision({
      currentAggregate: current,
      previousRevision: version1Revision(previous),
      previousCheckpoints: version1Checkpoints(previous),
      remote,
      revisionId: 'revision-2',
    });

    expect(prepared.captureInput.operationPlan.map((entry) => entry.operationKey)).toEqual([
      'child-item:variation-A',
      'child-offer:variation-A',
      'revision-reconcile',
    ]);

    const revision = durableRevision(prepared);
    const identityCheckpoints = [
      checkpointFrom({
        revisionId: 'revision-2',
        operationKey: 'child-offer:variation-A',
        attemptNumber: 1,
        checkpointNumber: 2,
        state: 'confirmed_complete',
        observedRemoteState: 'present',
        evidence: { offerId: 'offer-SKU-A', listingId: 'listing-1', sku: 'SKU-A' },
      }),
      checkpointFrom({
        revisionId: 'revision-2',
        operationKey: 'revision-reconcile',
        attemptNumber: 1,
        checkpointNumber: 2,
        state: 'confirmed_complete',
        observedRemoteState: 'present',
        evidence: { listingId: 'listing-1', skus: ['SKU-A', 'SKU-B'] },
      }),
    ];
    expect(reconstructConfirmedRemoteIdentity(revision, identityCheckpoints)).toEqual({
      listingId: 'listing-1',
      offerIdsBySku: { 'SKU-A': 'offer-SKU-A', 'SKU-B': 'offer-SKU-B' },
    });
  });

  it('uses a sparse version-2 revision as the next confirmed parent without losing untouched identities', async () => {
    const initial = aggregate({ group: group({ desired_revision: 1, last_confirmed_revision: null, lifecycle_state: 'publish-ready' }) });
    const sparseAggregate = aggregate({
      group: group({ desired_revision: 2, last_confirmed_revision: 1, lifecycle_state: 'active' }),
      copies: [copy('A'), copy('A2', 'variation-A'), copy('B')],
    });
    const { remote } = remoteFor(initial);
    const sparse = await prepareVariationListingFrozenActiveRevision({
      currentAggregate: sparseAggregate,
      previousRevision: version1Revision(initial),
      previousCheckpoints: version1Checkpoints(initial),
      remote,
      revisionId: 'revision-2',
    });
    const sparseRevision = durableRevision(sparse);
    const sparseCheckpoints = [
      checkpointFrom({
        revisionId: 'revision-2',
        operationKey: 'child-item:variation-A',
        attemptNumber: 1,
        checkpointNumber: 2,
        state: 'confirmed_complete',
        observedRemoteState: 'present',
        evidence: { sku: 'SKU-A' },
      }),
      checkpointFrom({
        revisionId: 'revision-2',
        operationKey: 'child-offer:variation-A',
        attemptNumber: 1,
        checkpointNumber: 2,
        state: 'confirmed_complete',
        observedRemoteState: 'present',
        evidence: { offerId: 'offer-SKU-A', listingId: 'listing-1', sku: 'SKU-A' },
      }),
      checkpointFrom({
        revisionId: 'revision-2',
        operationKey: 'revision-reconcile',
        attemptNumber: 1,
        checkpointNumber: 2,
        state: 'confirmed_complete',
        observedRemoteState: 'present',
        evidence: { listingId: 'listing-1', skus: ['SKU-A', 'SKU-B'] },
      }),
    ];
    const nextAggregate = {
      ...sparseAggregate,
      group: group({ desired_revision: 3, last_confirmed_revision: 2, lifecycle_state: 'active' }),
      variations: [variation('A', 0, 'copy-A', 1.49), variation('B', 1)],
    };
    const next = await prepareVariationListingFrozenActiveRevision({
      currentAggregate: nextAggregate,
      previousRevision: sparseRevision,
      previousCheckpoints: sparseCheckpoints,
      remote,
      revisionId: 'revision-3',
    });

    expect(next.snapshot.confirmed.remote).toMatchObject({
      listingId: 'listing-1',
      offerIdsBySku: { 'SKU-A': 'offer-SKU-A', 'SKU-B': 'offer-SKU-B' },
    });
    expect(next.captureInput.operationPlan.map((entry) => entry.operationKey)).toEqual([
      'child-offer:variation-A',
      'revision-reconcile',
    ]);
  });

  it('plans an offer-only mutation for a price-only edit', async () => {
    const previous = aggregate({ group: group({ desired_revision: 1, last_confirmed_revision: null, lifecycle_state: 'publish-ready' }) });
    const current = aggregate({
      group: group({ desired_revision: 2, last_confirmed_revision: 1, lifecycle_state: 'active' }),
      variations: [variation('A', 0, 'copy-A', 1.49), variation('B', 1)],
    });
    const { remote } = remoteFor(previous);
    const prepared = await prepareVariationListingFrozenActiveRevision({
      currentAggregate: current,
      previousRevision: version1Revision(previous),
      previousCheckpoints: version1Checkpoints(previous),
      remote,
      revisionId: 'revision-2',
    });

    expect(prepared.captureInput.operationPlan.map((entry) => entry.operationKey)).toEqual([
      'child-offer:variation-A',
      'revision-reconcile',
    ]);
  });

  it('preserves the lower live baseline when a price-only edit adds no eligible copy', async () => {
    const previous = aggregate({ group: group({ desired_revision: 1, last_confirmed_revision: null, lifecycle_state: 'publish-ready' }) });
    const current = aggregate({
      group: group({ desired_revision: 2, last_confirmed_revision: 1, lifecycle_state: 'active' }),
      variations: [variation('A', 0, 'copy-A', 1.49), variation('B', 1)],
    });
    const { remote } = remoteFor(previous, { 'SKU-A': { inventoryItemQuantity: 1, offerQuantity: 2 } });
    const prepared = await prepareVariationListingFrozenActiveRevision({ currentAggregate: current, previousRevision: version1Revision(previous), previousCheckpoints: version1Checkpoints(previous), remote, revisionId: 'revision-2' });
    const childA = prepared.desiredBundlePreview?.children.find((child) => child.sku === 'SKU-A');
    expect(childA?.quantity).toBe(1);
    expect(childA?.offer.availableQuantity).toBe(1);
    expect((childA?.offer.pricingSummary as { price: { value: string } }).price.value).toBe('1.49');
  });

  it('rejects identical-payload foreign offer or listing identities instead of adopting them', async () => {
    const previous = aggregate({ group: group({ desired_revision: 1, last_confirmed_revision: null, lifecycle_state: 'publish-ready' }) });
    const current = aggregate({ group: group({ desired_revision: 2, last_confirmed_revision: 1, lifecycle_state: 'active' }) });
    const base = remoteFor(previous);
    const foreignOfferRemote = {
      ...base.remote,
      async getOffers(sku: string, marketplaceId: string) {
        const read = await base.remote.getOffers(sku, marketplaceId);
        if (sku === 'SKU-A' && read.state === 'present') {
          return { state: 'present' as const, value: [{ ...read.value[0]!, offerId: 'foreign-offer-SKU-A' }] };
        }
        return read;
      },
    };
    await expect(prepareVariationListingFrozenActiveRevision({ currentAggregate: current, previousRevision: version1Revision(previous), previousCheckpoints: version1Checkpoints(previous), remote: foreignOfferRemote, revisionId: 'revision-2' })).rejects.toThrow('durable previous revision identity');

    const foreignListingRemote = {
      ...base.remote,
      async getOffers(sku: string, marketplaceId: string) {
        const read = await base.remote.getOffers(sku, marketplaceId);
        if (sku === 'SKU-A' && read.state === 'present') {
          return { state: 'present' as const, value: [{ ...read.value[0]!, listingId: 'foreign-listing' }] };
        }
        return read;
      },
    };
    await expect(prepareVariationListingFrozenActiveRevision({ currentAggregate: current, previousRevision: version1Revision(previous), previousCheckpoints: version1Checkpoints(previous), remote: foreignListingRemote, revisionId: 'revision-2' })).rejects.toThrow('durable previous revision identity');
  });

  it('requires exact front/back Media intents when representative copy changes', async () => {
    const previous = aggregate({ group: group({ desired_revision: 1, last_confirmed_revision: null, lifecycle_state: 'publish-ready' }) });
    const current = aggregate({ variations: [variation('A', 0, 'copy-A2'), variation('B', 1)], copies: [copy('A'), copy('A2', 'variation-A'), copy('B')] });
    const { remote } = remoteFor(previous);
    await expect(prepareVariationListingFrozenActiveRevision({ currentAggregate: current, previousRevision: version1Revision(previous), previousCheckpoints: version1Checkpoints(previous), remote, revisionId: 'revision-2' })).rejects.toThrow('requires front/back Media source intents');
    const prepared = await prepareVariationListingFrozenActiveRevision({ currentAggregate: current, previousRevision: version1Revision(previous), previousCheckpoints: version1Checkpoints(previous), remote, revisionId: 'revision-2', mediaResources: [{ copyId: 'copy-A2', role: 'front', sourceUrl: 'https://source.test/A2/front' }, { copyId: 'copy-A2', role: 'back', sourceUrl: 'https://source.test/A2/back' }] });
    expect(prepared.desiredBundlePreview).toBeNull();
    expect(prepared.captureInput.operationPlan.slice(0, 2).map((op) => op.operationKind)).toEqual(['media_ingest', 'media_ingest']);
  });

  it('rejects deletion or identity drift of a previously confirmed variation', async () => {
    const previous = aggregate({ group: group({ desired_revision: 1, last_confirmed_revision: null, lifecycle_state: 'publish-ready' }) });
    const { remote } = remoteFor(previous);
    await expect(prepareVariationListingFrozenActiveRevision({ currentAggregate: aggregate({ variations: [variation('A', 0)], copies: [copy('A')] }), previousRevision: version1Revision(previous), previousCheckpoints: version1Checkpoints(previous), remote, revisionId: 'revision-2' })).rejects.toThrow('cannot remove confirmed variation');
    await expect(prepareVariationListingFrozenActiveRevision({ currentAggregate: aggregate({ variations: [{ ...variation('A', 0), sku: 'CHANGED' }, variation('B', 1)] }), previousRevision: version1Revision(previous), previousCheckpoints: version1Checkpoints(previous), remote, revisionId: 'revision-2' })).rejects.toThrow('identity changed');
  });

  it('reconstructs version-1 Media EPS output only from exact terminal journal evidence', () => {
    const previous = aggregate({ group: group({ desired_revision: 1, last_confirmed_revision: null, lifecycle_state: 'publish-ready' }) });
    const revision = version1Revision(previous);
    revision.snapshot = { aggregate: previous, mediaResources: [{ copyId: 'copy-A', role: 'front', sourceUrl: 'https://source/A/front' }, { copyId: 'copy-A', role: 'back', sourceUrl: 'https://source/A/back' }, { copyId: 'copy-B', role: 'front', sourceUrl: 'https://source/B/front' }, { copyId: 'copy-B', role: 'back', sourceUrl: 'https://source/B/back' }], representativeImages: null } as Json;
    const checkpoints = ['A:front:AF','A:back:AB','B:front:BF','B:back:BB'].map((entry, index) => {
      const [copyId, role, imageName] = entry.split(':');
      return { attempt_number: 1, checkpoint_id: `cp-${index}`, checkpoint_number: 2, created_at: timestamp, evidence: { imageId: `image-${index}`, location: `https://api.ebay.test/${index}`, imageUrl: eps(imageName!), expirationDate: '2026-10-01T00:00:00Z' }, observed_remote_state: 'present', operation_key: `media:copy-${copyId}:${role}`, revision_id: 'revision-1', state: 'confirmed_complete' } as VariationListingPublishingCheckpointRow;
    });
    expect(reconstructVariationListingConfirmedRepresentativeImages({ revision, checkpoints })).toEqual([{ copyId: 'copy-A', frontEpsUrl: eps('AF'), backEpsUrl: eps('AB') }, { copyId: 'copy-B', frontEpsUrl: eps('BF'), backEpsUrl: eps('BB') }]);
  });

  it('does not confirm a started operation from its pre-state after a crash', async () => {
    const previous = aggregate({ group: group({ desired_revision: 1, last_confirmed_revision: null, lifecycle_state: 'publish-ready' }) });
    const current = aggregate({ copies: [copy('A'), copy('A2', 'variation-A'), copy('B')] });
    const { remote } = remoteFor(previous);
    const prepared = await prepareVariationListingFrozenActiveRevision({ currentAggregate: current, previousRevision: version1Revision(previous), previousCheckpoints: version1Checkpoints(previous), remote, revisionId: 'revision-2' });
    const checkpoints = [checkpointFrom({ revisionId: 'revision-2', operationKey: 'child-item:variation-A', attemptNumber: 1, checkpointNumber: 1, state: 'started', observedRemoteState: null, evidence: {} })];
    const revisions = { current: durableRevision(prepared), captureCalls: [] };
    let mutationCalls = 0;
    const mutations: VariationListingActiveMutationGateway = {
      createOffer: async () => { mutationCalls += 1; return { offerId: 'unexpected' }; },
      createOrReplaceInventoryItem: async () => { mutationCalls += 1; },
      createOrReplaceInventoryItemGroup: async () => { mutationCalls += 1; },
      publishOffer: async () => { mutationCalls += 1; return { listingId: 'listing-1' }; },
      updateOffer: async () => { mutationCalls += 1; },
    };
    await expect(executeVariationListingActiveRevision(activeExecutionInput(prepared, revisions, checkpoints, remote, mutations))).rejects.toThrow('unknown mutation outcome');
    expect(mutationCalls).toBe(0);
    expect(checkpoints.at(-1)).toMatchObject({ operation_key: 'child-item:variation-A', state: 'unknown', observed_remote_state: 'unknown' });
    expect(checkpoints.at(-1)?.evidence).toMatchObject({ sku: 'SKU-A' });
  });

  it('rejects a tampered frozen snapshot before capture or mutation', async () => {
    const previous = aggregate({ group: group({ desired_revision: 1, last_confirmed_revision: null, lifecycle_state: 'publish-ready' }) });
    const current = aggregate({ variations: [variation('A', 0, 'copy-A', 1.49), variation('B', 1)] });
    const { remote } = remoteFor(previous);
    const prepared = await prepareVariationListingFrozenActiveRevision({ currentAggregate: current, previousRevision: version1Revision(previous), previousCheckpoints: version1Checkpoints(previous), remote, revisionId: 'revision-2' });
    const tampered = structuredClone(prepared);
    (tampered.captureInput.snapshot as Record<string, Json>).tampered = true;
    const revisions = { current: null, captureCalls: [] as number[] };
    let mutationCalls = 0;
    const mutations: VariationListingActiveMutationGateway = {
      createOffer: async () => { mutationCalls += 1; return { offerId: 'unexpected' }; },
      createOrReplaceInventoryItem: async () => { mutationCalls += 1; },
      createOrReplaceInventoryItemGroup: async () => { mutationCalls += 1; },
      publishOffer: async () => { mutationCalls += 1; return { listingId: 'listing-1' }; },
      updateOffer: async () => { mutationCalls += 1; },
    };
    await expect(executeVariationListingActiveRevision(activeExecutionInput(tampered, revisions, [], remote, mutations))).rejects.toThrow('Frozen active revision snapshot does not exactly match');
    expect(revisions.captureCalls).toHaveLength(0);
    expect(mutationCalls).toBe(0);
  });

  it('fails closed on non-quantity remote drift before capturing the active revision', async () => {
    const previous = aggregate({ group: group({ desired_revision: 1, last_confirmed_revision: null, lifecycle_state: 'publish-ready' }) });
    const current = aggregate({ group: group({ desired_revision: 2, last_confirmed_revision: 1, lifecycle_state: 'active' }) });
    const base = remoteFor(previous);
    const prepared = await prepareVariationListingFrozenActiveRevision({ currentAggregate: current, previousRevision: version1Revision(previous), previousCheckpoints: version1Checkpoints(previous), remote: base.remote, revisionId: 'revision-2' });
    const changed = structuredClone(base.bundle.children.find((child) => child.sku === 'SKU-A')!.inventoryItem) as unknown as Record<string, Json>;
    (changed.product as Record<string, Json>).title = 'foreign title';
    const remote = {
      ...base.remote,
      async getInventoryItem(sku: string) {
        if (sku === 'SKU-A') return { state: 'present' as const, value: { groupKeys: [base.bundle.groupKey], payload: changed as Json, sku } };
        return await base.remote.getInventoryItem(sku);
      },
    };
    const revisions = { current: null as VariationListingRevisionRow | null, captureCalls: [] as number[] };
    let mutationCalls = 0;
    const mutations: VariationListingActiveMutationGateway = {
      createOffer: async () => { mutationCalls += 1; return { offerId: 'unexpected' }; },
      createOrReplaceInventoryItem: async () => { mutationCalls += 1; },
      createOrReplaceInventoryItemGroup: async () => { mutationCalls += 1; },
      publishOffer: async () => { mutationCalls += 1; return { listingId: 'listing-1' }; },
      updateOffer: async () => { mutationCalls += 1; },
    };
    await expect(executeVariationListingActiveRevision(activeExecutionInput(prepared, revisions, [], remote, mutations))).rejects.toThrow('changed outside quantity');
    expect(revisions.captureCalls).toHaveLength(0);
    expect(mutationCalls).toBe(0);
  });

  it('requires a fresh staged revision when a clean captured baseline quantity drifts', async () => {
    const previous = aggregate({ group: group({ desired_revision: 1, last_confirmed_revision: null, lifecycle_state: 'publish-ready' }) });
    const current = aggregate({ group: group({ desired_revision: 2, last_confirmed_revision: 1, lifecycle_state: 'active' }) });
    const base = remoteFor(previous);
    const prepared = await prepareVariationListingFrozenActiveRevision({ currentAggregate: current, previousRevision: version1Revision(previous), previousCheckpoints: version1Checkpoints(previous), remote: base.remote, revisionId: 'revision-2' });
    const changed = structuredClone(base.bundle.children.find((child) => child.sku === 'SKU-A')!.inventoryItem) as unknown as Record<string, Json>;
    const availability = changed.availability as Record<string, Json>;
    const ship = availability.shipToLocationAvailability as Record<string, Json>;
    ship.quantity = 0;
    const remote = {
      ...base.remote,
      async getInventoryItem(sku: string) {
        if (sku === 'SKU-A') return { state: 'present' as const, value: { groupKeys: [base.bundle.groupKey], payload: changed as Json, sku } };
        return await base.remote.getInventoryItem(sku);
      },
    };
    const revisions = { current: durableRevision(prepared), captureCalls: [] as number[] };
    let mutationCalls = 0;
    const mutations: VariationListingActiveMutationGateway = {
      createOffer: async () => { mutationCalls += 1; return { offerId: 'unexpected' }; },
      createOrReplaceInventoryItem: async () => { mutationCalls += 1; },
      createOrReplaceInventoryItemGroup: async () => { mutationCalls += 1; },
      publishOffer: async () => { mutationCalls += 1; return { listingId: 'listing-1' }; },
      updateOffer: async () => { mutationCalls += 1; },
    };
    await expect(executeVariationListingActiveRevision(activeExecutionInput(prepared, revisions, [], remote, mutations))).rejects.toThrow('active_revision_reprepare_required');
    expect(revisions.captureCalls).toHaveLength(0);
    expect(mutationCalls).toBe(0);
  });

  it('marks clean captured identity drift as known changed and reprepare-required', async () => {
    const previous = aggregate({ group: group({ desired_revision: 1, last_confirmed_revision: null, lifecycle_state: 'publish-ready' }) });
    const current = aggregate({ group: group({ desired_revision: 2, last_confirmed_revision: 1, lifecycle_state: 'active' }) });
    const base = remoteFor(previous);
    const prepared = await prepareVariationListingFrozenActiveRevision({ currentAggregate: current, previousRevision: version1Revision(previous), previousCheckpoints: version1Checkpoints(previous), remote: base.remote, revisionId: 'revision-2' });
    const remote = {
      ...base.remote,
      async getOffers(sku: string, marketplaceId: string) {
        const read = await base.remote.getOffers(sku, marketplaceId);
        if (sku === 'SKU-A' && read.state === 'present') return { state: 'present' as const, value: [{ ...read.value[0]!, listingId: 'foreign-listing' }] };
        return read;
      },
    };
    const revisions = { current: durableRevision(prepared), captureCalls: [] as number[] };
    let mutationCalls = 0;
    const mutations: VariationListingActiveMutationGateway = {
      createOffer: async () => { mutationCalls += 1; return { offerId: 'unexpected' }; },
      createOrReplaceInventoryItem: async () => { mutationCalls += 1; },
      createOrReplaceInventoryItemGroup: async () => { mutationCalls += 1; },
      publishOffer: async () => { mutationCalls += 1; return { listingId: 'listing-1' }; },
      updateOffer: async () => { mutationCalls += 1; },
    };
    await expect(executeVariationListingActiveRevision(activeExecutionInput(prepared, revisions, [], remote, mutations))).rejects.toThrow('active_revision_reprepare_required');
    expect(revisions.captureCalls).toHaveLength(0);
    expect(mutationCalls).toBe(0);
  });

  it('rejects a legacy version-2 snapshot without frozen remote quantities before any write', async () => {
    const previous = aggregate({ group: group({ desired_revision: 1, last_confirmed_revision: null, lifecycle_state: 'publish-ready' }) });
    const current = aggregate({ group: group({ desired_revision: 2, last_confirmed_revision: 1, lifecycle_state: 'active' }) });
    const base = remoteFor(previous);
    const prepared = await prepareVariationListingFrozenActiveRevision({ currentAggregate: current, previousRevision: version1Revision(previous), previousCheckpoints: version1Checkpoints(previous), remote: base.remote, revisionId: 'revision-2' });
    const tampered = structuredClone(prepared);
    delete tampered.snapshot.confirmed.remote.quantitiesBySku;
    tampered.captureInput.snapshot = tampered.snapshot as unknown as Json;
    tampered.captureInput.snapshotDigest = digest(tampered.captureInput.snapshot);
    const revisions = { current: null as VariationListingRevisionRow | null, captureCalls: [] as number[] };
    let mutationCalls = 0;
    const mutations: VariationListingActiveMutationGateway = {
      createOffer: async () => { mutationCalls += 1; return { offerId: 'unexpected' }; },
      createOrReplaceInventoryItem: async () => { mutationCalls += 1; },
      createOrReplaceInventoryItemGroup: async () => { mutationCalls += 1; },
      publishOffer: async () => { mutationCalls += 1; return { listingId: 'listing-1' }; },
      updateOffer: async () => { mutationCalls += 1; },
    };
    await expect(executeVariationListingActiveRevision(activeExecutionInput(tampered, revisions, [], base.remote, mutations))).rejects.toThrow('active_revision_reprepare_required');
    expect(revisions.captureCalls).toHaveLength(0);
    expect(mutationCalls).toBe(0);
  });

  it('keeps legacy snapshots on reprepare when a new-child operation is missing', async () => {
    const previous = aggregate({ group: group({ desired_revision: 1, last_confirmed_revision: null, lifecycle_state: 'publish-ready' }) });
    const current = aggregate({
      group: group({ desired_revision: 2, last_confirmed_revision: 1, lifecycle_state: 'active', next_inventory_serial: 4 }),
      variations: [variation('A', 0), variation('B', 1), variation('C', 2)],
      copies: [copy('A'), copy('B'), copy('C'), copy('C2', 'variation-C')],
    });
    const base = remoteFor(previous);
    const prepared = await prepareVariationListingFrozenActiveRevision({
      currentAggregate: current,
      previousRevision: version1Revision(previous),
      previousCheckpoints: version1Checkpoints(previous),
      remote: base.remote,
      revisionId: 'revision-2',
      mediaResources: [
        { copyId: 'copy-C', role: 'front', sourceUrl: 'https://source.test/C/front' },
        { copyId: 'copy-C', role: 'back', sourceUrl: 'https://source.test/C/back' },
      ],
    });
    const malformed = structuredClone(prepared);
    delete malformed.snapshot.confirmed.remote.quantitiesBySku;
    malformed.captureInput.operationPlan = malformed.captureInput.operationPlan
      .filter((operation) => operation.operationKey !== 'child-item:variation-C')
      .map((operation, index) => ({ ...operation, sequenceNo: index + 1 }));
    malformed.captureInput.snapshot = malformed.snapshot as unknown as Json;
    malformed.captureInput.snapshotDigest = digest(malformed.captureInput.snapshot);
    const revisions = { current: null as VariationListingRevisionRow | null, captureCalls: [] as number[] };
    const checkpoints: VariationListingPublishingCheckpointRow[] = [];
    let mutationCalls = 0;
    const mutations: VariationListingActiveMutationGateway = {
      createMedia: async () => { mutationCalls += 1; return { imageId: 'unexpected', location: 'https://api.ebay.test/unexpected', imageUrl: eps('unexpected'), expirationDate: '2026-10-01T00:00:00Z' }; },
      createOffer: async () => { mutationCalls += 1; return { offerId: 'unexpected' }; },
      createOrReplaceInventoryItem: async () => { mutationCalls += 1; },
      createOrReplaceInventoryItemGroup: async () => { mutationCalls += 1; },
      publishOffer: async () => { mutationCalls += 1; return { listingId: 'listing-1' }; },
      updateOffer: async () => { mutationCalls += 1; },
    };

    await expect(
      executeVariationListingActiveRevision(
        activeExecutionInput(malformed, revisions, checkpoints, base.remote, mutations)
      )
    ).rejects.toThrow('active_revision_reprepare_required');
    expect(revisions.captureCalls).toHaveLength(0);
    expect(checkpoints).toHaveLength(0);
    expect(mutationCalls).toBe(0);
  });

  it('records an unresolved checkpoint when a later child pre-state drifts after earlier writes', async () => {
    const previous = aggregate({ group: group({ desired_revision: 1, last_confirmed_revision: null, lifecycle_state: 'publish-ready' }) });
    const current = aggregate({
      group: group({ desired_revision: 2, last_confirmed_revision: 1, lifecycle_state: 'active' }),
      copies: [copy('A'), copy('A2', 'variation-A'), copy('B'), copy('B2', 'variation-B')],
    });
    const base = remoteFor(previous);
    const prepared = await prepareVariationListingFrozenActiveRevision({ currentAggregate: current, previousRevision: version1Revision(previous), previousCheckpoints: version1Checkpoints(previous), remote: base.remote, revisionId: 'revision-2' });
    const terminalKeys = ['child-item:variation-A', 'child-offer:variation-A'];
    const checkpoints = terminalKeys.flatMap((operationKey) => [
      checkpointFrom({ revisionId: 'revision-2', operationKey, attemptNumber: 1, checkpointNumber: 1, state: 'started', observedRemoteState: null, evidence: {} }),
      checkpointFrom({ revisionId: 'revision-2', operationKey, attemptNumber: 1, checkpointNumber: 2, state: 'confirmed_complete', observedRemoteState: 'present', evidence: { confirmed: true } }),
    ]);
    const revisions = { current: durableRevision(prepared), captureCalls: [] as number[] };
    const remote = {
      ...base.remote,
      async getInventoryItem(sku: string) {
        if (sku === 'SKU-B') {
          const read = await base.remote.getInventoryItem(sku);
          if (read.state === 'present') {
            const payload = structuredClone(read.value.payload) as unknown as Record<string, Json>;
            (payload.availability as Record<string, Json>).shipToLocationAvailability = { quantity: 0 };
            return { state: 'present' as const, value: { ...read.value, payload: payload as Json } };
          }
        }
        return base.remote.getInventoryItem(sku);
      },
    };
    let mutationCalls = 0;
    const mutations: VariationListingActiveMutationGateway = {
      createOffer: async () => { mutationCalls += 1; return { offerId: 'unexpected' }; },
      createOrReplaceInventoryItem: async () => { mutationCalls += 1; },
      createOrReplaceInventoryItemGroup: async () => { mutationCalls += 1; },
      publishOffer: async () => { mutationCalls += 1; return { listingId: 'listing-1' }; },
      updateOffer: async () => { mutationCalls += 1; },
    };
    await expect(executeVariationListingActiveRevision(activeExecutionInput(prepared, revisions, checkpoints, remote, mutations))).rejects.toThrow('pre-state is not exact');
    expect(mutationCalls).toBe(0);
    expect(checkpoints.filter((row) => row.operation_key === 'child-item:variation-B').at(-1)).toMatchObject({ state: 'unknown', observed_remote_state: 'unknown' });
  });

  it('requires reprepare, without an unresolved marker, when an earlier child was only a no-op', async () => {
    const previous = aggregate({ group: group({ desired_revision: 1, last_confirmed_revision: null, lifecycle_state: 'publish-ready' }) });
    const current = aggregate({ group: group({ desired_revision: 2, last_confirmed_revision: 1, lifecycle_state: 'active' }) });
    const base = remoteFor(previous);
    const prepared = await prepareVariationListingFrozenActiveRevision({ currentAggregate: current, previousRevision: version1Revision(previous), previousCheckpoints: version1Checkpoints(previous), remote: base.remote, revisionId: 'revision-2' });
    const checkpoints = ['child-item:variation-A', 'child-offer:variation-A'].flatMap((operationKey) => [
      checkpointFrom({ revisionId: 'revision-2', operationKey, attemptNumber: 1, checkpointNumber: 1, state: 'started', observedRemoteState: null, evidence: {} }),
      checkpointFrom({ revisionId: 'revision-2', operationKey, attemptNumber: 1, checkpointNumber: 2, state: 'confirmed_no_op', observedRemoteState: 'present', evidence: { confirmed: true } }),
    ]);
    const revisions = { current: durableRevision(prepared), captureCalls: [] as number[] };
    const remote = {
      ...base.remote,
      async getInventoryItem(sku: string) {
        if (sku === 'SKU-B') {
          const read = await base.remote.getInventoryItem(sku);
          if (read.state === 'present') {
            const payload = structuredClone(read.value.payload) as unknown as Record<string, Json>;
            (payload.availability as Record<string, Json>).shipToLocationAvailability = { quantity: 0 };
            return { state: 'present' as const, value: { ...read.value, payload: payload as Json } };
          }
        }
        return base.remote.getInventoryItem(sku);
      },
    };
    let mutationCalls = 0;
    const mutations: VariationListingActiveMutationGateway = {
      createOffer: async () => { mutationCalls += 1; return { offerId: 'unexpected' }; },
      createOrReplaceInventoryItem: async () => { mutationCalls += 1; },
      createOrReplaceInventoryItemGroup: async () => { mutationCalls += 1; },
      publishOffer: async () => { mutationCalls += 1; return { listingId: 'listing-1' }; },
      updateOffer: async () => { mutationCalls += 1; },
    };
    await expect(executeVariationListingActiveRevision(activeExecutionInput(prepared, revisions, checkpoints, remote, mutations))).rejects.toThrow('active_revision_reprepare_required');
    expect(mutationCalls).toBe(0);
    expect(checkpoints.some((row) => row.operation_key === 'child-item:variation-B')).toBe(false);
  });

  it('blocks an existing Inventory Item write when its paired frozen Offer changes after pre-state', async () => {
    const previous = aggregate({ group: group({ desired_revision: 1, last_confirmed_revision: null, lifecycle_state: 'publish-ready' }) });
    const current = aggregate({ copies: [copy('A'), copy('A2', 'variation-A'), copy('B')] });
    const base = remoteFor(previous);
    const prepared = await prepareVariationListingFrozenActiveRevision({ currentAggregate: current, previousRevision: version1Revision(previous), previousCheckpoints: version1Checkpoints(previous), remote: base.remote, revisionId: 'revision-2' });
    let offerReads = 0;
    const changedOffer = structuredClone(base.bundle.children.find((child) => child.sku === 'SKU-A')!.offer) as unknown as Record<string, Json>;
    changedOffer.availableQuantity = 0;
    const remote = {
      ...base.remote,
      async getOffers(sku: string, marketplaceId: string) {
        if (sku === 'SKU-A') {
          offerReads += 1;
          if (offerReads === 2) {
            return { state: 'present' as const, value: [{ lifecycleClass: 'active' as const, listingId: 'listing-1', marketplaceId, offerId: `offer-${sku}`, payload: changedOffer as Json, sku, status: 'PUBLISHED' as const }] };
          }
        }
        return await base.remote.getOffers(sku, marketplaceId);
      },
    };
    const revisions = { current: null as VariationListingRevisionRow | null, captureCalls: [] as number[] };
    const checkpoints: VariationListingPublishingCheckpointRow[] = [];
    let mutationCalls = 0;
    const mutations: VariationListingActiveMutationGateway = {
      createOffer: async () => ({ offerId: 'unexpected' }),
      createOrReplaceInventoryItem: async () => { mutationCalls += 1; },
      createOrReplaceInventoryItemGroup: async () => { mutationCalls += 1; },
      publishOffer: async () => ({ listingId: 'listing-1' }),
      updateOffer: async () => { mutationCalls += 1; },
    };
    await expect(executeVariationListingActiveRevision(activeExecutionInput(prepared, revisions, checkpoints, remote, mutations))).rejects.toThrow('paired offer SKU-A changed before the Inventory Item mutation');
    expect(mutationCalls).toBe(0);
    expect(checkpoints.at(-1)).toMatchObject({ operation_key: 'child-item:variation-A', state: 'unknown', observed_remote_state: 'unknown' });
  });

  it('blocks an existing Offer write when its paired desired Inventory Item changes after pre-state', async () => {
    const previous = aggregate({ group: group({ desired_revision: 1, last_confirmed_revision: null, lifecycle_state: 'publish-ready' }) });
    const current = aggregate({
      group: group({ desired_revision: 2, last_confirmed_revision: 1, lifecycle_state: 'active' }),
      variations: [variation('A', 0, 'copy-A', 1.49), variation('B', 1)],
    });
    const base = remoteFor(previous);
    const prepared = await prepareVariationListingFrozenActiveRevision({ currentAggregate: current, previousRevision: version1Revision(previous), previousCheckpoints: version1Checkpoints(previous), remote: base.remote, revisionId: 'revision-2' });
    let itemReads = 0;
    const changedItem = structuredClone(base.bundle.children.find((child) => child.sku === 'SKU-A')!.inventoryItem) as unknown as Record<string, Json>;
    const availability = changedItem.availability as Record<string, Json>;
    const ship = availability.shipToLocationAvailability as Record<string, Json>;
    ship.quantity = 0;
    const remote = {
      ...base.remote,
      async getInventoryItem(sku: string) {
        if (sku === 'SKU-A') {
          itemReads += 1;
          if (itemReads >= 2) {
            return { state: 'present' as const, value: { groupKeys: [base.bundle.groupKey], payload: changedItem as Json, sku } };
          }
        }
        return await base.remote.getInventoryItem(sku);
      },
    };
    const revisions = { current: null as VariationListingRevisionRow | null, captureCalls: [] as number[] };
    const checkpoints: VariationListingPublishingCheckpointRow[] = [];
    let updateOfferCalls = 0;
    const mutations: VariationListingActiveMutationGateway = {
      createOffer: async () => ({ offerId: 'unexpected' }),
      createOrReplaceInventoryItem: async () => { throw new Error('item mutation should be a no-op'); },
      createOrReplaceInventoryItemGroup: async () => {},
      publishOffer: async () => ({ listingId: 'listing-1' }),
      updateOffer: async () => { updateOfferCalls += 1; },
    };
    await expect(executeVariationListingActiveRevision(activeExecutionInput(prepared, revisions, checkpoints, remote, mutations))).rejects.toThrow('paired Inventory Item SKU-A changed before the Offer mutation');
    expect(updateOfferCalls).toBe(0);
    expect(checkpoints.at(-1)).toMatchObject({ operation_key: 'child-offer:variation-A', state: 'unknown', observed_remote_state: 'unknown' });
  });

  it('blocks an existing Inventory Item write when its own frozen pre-state changes after pre()', async () => {
    const previous = aggregate({ group: group({ desired_revision: 1, last_confirmed_revision: null, lifecycle_state: 'publish-ready' }) });
    const current = aggregate({ copies: [copy('A'), copy('A2', 'variation-A'), copy('B')] });
    const base = remoteFor(previous);
    const prepared = await prepareVariationListingFrozenActiveRevision({ currentAggregate: current, previousRevision: version1Revision(previous), previousCheckpoints: version1Checkpoints(previous), remote: base.remote, revisionId: 'revision-2' });
    const changed = structuredClone(base.bundle.children.find((child) => child.sku === 'SKU-A')!.inventoryItem) as unknown as Record<string, Json>;
    (changed.product as Record<string, Json>).title = 'changed after pre';
    let itemReads = 0;
    const remote = {
      ...base.remote,
      async getInventoryItem(sku: string) {
        if (sku === 'SKU-A') {
          itemReads += 1;
          if (itemReads >= 4) return { state: 'present' as const, value: { groupKeys: [base.bundle.groupKey], payload: changed as Json, sku } };
        }
        return base.remote.getInventoryItem(sku);
      },
    };
    const revisions = { current: null as VariationListingRevisionRow | null, captureCalls: [] as number[] };
    const checkpoints: VariationListingPublishingCheckpointRow[] = [];
    let mutationCalls = 0;
    const mutations: VariationListingActiveMutationGateway = {
      createOffer: async () => ({ offerId: 'unexpected' }),
      createOrReplaceInventoryItem: async () => { mutationCalls += 1; },
      createOrReplaceInventoryItemGroup: async () => { mutationCalls += 1; },
      publishOffer: async () => ({ listingId: 'listing-1' }),
      updateOffer: async () => { mutationCalls += 1; },
    };
    await expect(executeVariationListingActiveRevision(activeExecutionInput(prepared, revisions, checkpoints, remote, mutations))).rejects.toThrow('Inventory Item SKU-A changed before its mutation');
    expect(mutationCalls).toBe(0);
    expect(checkpoints.at(-1)).toMatchObject({ operation_key: 'child-item:variation-A', state: 'unknown', observed_remote_state: 'unknown' });
  });

  it('blocks an existing Offer write when its own frozen pre-state changes after pre()', async () => {
    const previous = aggregate({ group: group({ desired_revision: 1, last_confirmed_revision: null, lifecycle_state: 'publish-ready' }) });
    const current = aggregate({ variations: [variation('A', 0, 'copy-A', 1.49), variation('B', 1)] });
    const base = remoteFor(previous);
    const prepared = await prepareVariationListingFrozenActiveRevision({ currentAggregate: current, previousRevision: version1Revision(previous), previousCheckpoints: version1Checkpoints(previous), remote: base.remote, revisionId: 'revision-2' });
    const changed = structuredClone(base.bundle.children.find((child) => child.sku === 'SKU-A')!.offer) as unknown as Record<string, Json>;
    (changed.pricingSummary as Record<string, Json>).price = { value: '99.99', currency: 'USD' };
    let offerReads = 0;
    const remote = {
      ...base.remote,
      async getOffers(sku: string, marketplaceId: string) {
        if (sku === 'SKU-A') {
          offerReads += 1;
          if (offerReads >= 4) return { state: 'present' as const, value: [{ lifecycleClass: 'active' as const, listingId: 'listing-1', marketplaceId, offerId: `offer-${sku}`, payload: changed as Json, sku, status: 'PUBLISHED' as const }] };
        }
        return base.remote.getOffers(sku, marketplaceId);
      },
    };
    const revisions = { current: null as VariationListingRevisionRow | null, captureCalls: [] as number[] };
    const checkpoints: VariationListingPublishingCheckpointRow[] = [];
    let updateOfferCalls = 0;
    const mutations: VariationListingActiveMutationGateway = {
      createOffer: async () => ({ offerId: 'unexpected' }),
      createOrReplaceInventoryItem: async () => {},
      createOrReplaceInventoryItemGroup: async () => {},
      publishOffer: async () => ({ listingId: 'listing-1' }),
      updateOffer: async () => { updateOfferCalls += 1; },
    };
    await expect(executeVariationListingActiveRevision(activeExecutionInput(prepared, revisions, checkpoints, remote, mutations))).rejects.toThrow('Offer SKU-A changed before its mutation');
    expect(updateOfferCalls).toBe(0);
    expect(checkpoints.at(-1)).toMatchObject({ operation_key: 'child-offer:variation-A', state: 'unknown', observed_remote_state: 'unknown' });
  });

  it('does not resume Media from a forged proven-absent terminal checkpoint', async () => {
    const previous = aggregate({ group: group({ desired_revision: 1, last_confirmed_revision: null, lifecycle_state: 'publish-ready' }) });
    const current = aggregate({
      variations: [variation('A', 0, 'copy-A2'), variation('B', 1)],
      copies: [copy('A'), copy('A2', 'variation-A'), copy('B')],
    });
    const base = remoteFor(previous);
    const prepared = await prepareVariationListingFrozenActiveRevision({
      currentAggregate: current,
      previousRevision: version1Revision(previous),
      previousCheckpoints: version1Checkpoints(previous),
      remote: base.remote,
      revisionId: 'revision-2',
      mediaResources: [
        { copyId: 'copy-A2', role: 'front', sourceUrl: 'https://source.test/A2/front' },
        { copyId: 'copy-A2', role: 'back', sourceUrl: 'https://source.test/A2/back' },
      ],
    });
    const checkpoints = [checkpointFrom({
      revisionId: 'revision-2',
      operationKey: 'media:copy-A2:front',
      attemptNumber: 1,
      checkpointNumber: 1,
      state: 'started',
      observedRemoteState: null,
      evidence: {},
    }), checkpointFrom({
      revisionId: 'revision-2',
      operationKey: 'media:copy-A2:front',
      attemptNumber: 1,
      checkpointNumber: 2,
      state: 'confirmed_no_op',
      observedRemoteState: 'proven_absent',
      evidence: { imageId: 'forged', location: 'https://api.ebay.test/forged', imageUrl: eps('forged'), expirationDate: '2026-10-01T00:00:00Z' },
    })];
    const revisions = { current: durableRevision(prepared), captureCalls: [] as number[] };
    let mutationCalls = 0;
    const mutations: VariationListingActiveMutationGateway = {
      createMedia: async () => { mutationCalls += 1; return { imageId: 'unexpected', location: 'https://api.ebay.test/unexpected', imageUrl: eps('unexpected'), expirationDate: '2026-10-01T00:00:00Z' }; },
      createOffer: async () => ({ offerId: 'unexpected' }),
      createOrReplaceInventoryItem: async () => { mutationCalls += 1; },
      createOrReplaceInventoryItemGroup: async () => { mutationCalls += 1; },
      publishOffer: async () => ({ listingId: 'listing-1' }),
      updateOffer: async () => { mutationCalls += 1; },
    };
    const remote = {
      ...base.remote,
      async getMedia() { return { state: 'proven_absent' as const }; },
    };
    await expect(executeVariationListingActiveRevision(activeExecutionInput(prepared, revisions, checkpoints, remote, mutations))).rejects.toThrow('confirmed-present identity');
    expect(mutationCalls).toBe(0);
  });

  it('keeps the whole-baseline quantity guard active across Media-only terminal history', async () => {
    const previous = aggregate({ group: group({ desired_revision: 1, last_confirmed_revision: null, lifecycle_state: 'publish-ready' }) });
    const current = aggregate({
      variations: [variation('A', 0, 'copy-A2'), variation('B', 1)],
      copies: [copy('A'), copy('A2', 'variation-A'), copy('B')],
    });
    const base = remoteFor(previous);
    const prepared = await prepareVariationListingFrozenActiveRevision({
      currentAggregate: current,
      previousRevision: version1Revision(previous),
      previousCheckpoints: version1Checkpoints(previous),
      remote: base.remote,
      revisionId: 'revision-2',
      mediaResources: [
        { copyId: 'copy-A2', role: 'front', sourceUrl: 'https://source.test/A2/front' },
        { copyId: 'copy-A2', role: 'back', sourceUrl: 'https://source.test/A2/back' },
      ],
    });
    const mediaEvidence = {
      front: { imageId: 'image-A2-front', location: 'https://api.ebay.test/A2-front', imageUrl: eps('A2F'), expirationDate: '2026-10-01T00:00:00Z' },
      back: { imageId: 'image-A2-back', location: 'https://api.ebay.test/A2-back', imageUrl: eps('A2B'), expirationDate: '2026-10-01T00:00:00Z' },
    };
    const checkpoints = (['front', 'back'] as const).flatMap((role) => [
      checkpointFrom({ revisionId: 'revision-2', operationKey: `media:copy-A2:${role}`, attemptNumber: 1, checkpointNumber: 1, state: 'started', observedRemoteState: null, evidence: {} }),
      checkpointFrom({ revisionId: 'revision-2', operationKey: `media:copy-A2:${role}`, attemptNumber: 1, checkpointNumber: 2, state: 'confirmed_complete', observedRemoteState: 'present', evidence: mediaEvidence[role] }),
    ]);
    const revisions = { current: durableRevision(prepared), captureCalls: [] as number[] };
    const drifted = structuredClone(base.bundle.children.find((child) => child.sku === 'SKU-A')!.inventoryItem) as unknown as Record<string, Json>;
    (drifted.availability as Record<string, Json>).shipToLocationAvailability = { quantity: 0 };
    const remote = {
      ...base.remote,
      async getInventoryItem(sku: string) {
        if (sku === 'SKU-A') return { state: 'present' as const, value: { groupKeys: [base.bundle.groupKey], payload: drifted as Json, sku } };
        return base.remote.getInventoryItem(sku);
      },
      async getMedia(location: string) {
        const value = location.endsWith('A2-front') ? mediaEvidence.front : mediaEvidence.back;
        return { state: 'present' as const, value };
      },
    };
    let mutationCalls = 0;
    const mutations: VariationListingActiveMutationGateway = {
      createMedia: async () => { mutationCalls += 1; return mediaEvidence.front; },
      createOffer: async () => { mutationCalls += 1; return { offerId: 'unexpected' }; },
      createOrReplaceInventoryItem: async () => { mutationCalls += 1; },
      createOrReplaceInventoryItemGroup: async () => { mutationCalls += 1; },
      publishOffer: async () => { mutationCalls += 1; return { listingId: 'listing-1' }; },
      updateOffer: async () => { mutationCalls += 1; },
    };
    await expect(executeVariationListingActiveRevision(activeExecutionInput(prepared, revisions, checkpoints, remote, mutations))).rejects.toThrow('active_revision_reprepare_required');
    expect(mutationCalls).toBe(0);
  });

  it('rejects malformed bounded-retry history and terminal evidence before any remote mutation', async () => {
    const previous = aggregate({ group: group({ desired_revision: 1, last_confirmed_revision: null, lifecycle_state: 'publish-ready' }) });
    const current = aggregate({ variations: [variation('A', 0, 'copy-A', 1.49), variation('B', 1)] });
    const base = remoteFor(previous);
    const prepared = await prepareVariationListingFrozenActiveRevision({ currentAggregate: current, previousRevision: version1Revision(previous), previousCheckpoints: version1Checkpoints(previous), remote: base.remote, revisionId: 'revision-2' });
    const revisions = { current: durableRevision(prepared), captureCalls: [] as number[] };
    const mutations: VariationListingActiveMutationGateway = {
      createOffer: async () => { throw new Error('must not mutate'); },
      createOrReplaceInventoryItem: async () => { throw new Error('must not mutate'); },
      createOrReplaceInventoryItemGroup: async () => { throw new Error('must not mutate'); },
      publishOffer: async () => { throw new Error('must not mutate'); },
      updateOffer: async () => { throw new Error('must not mutate'); },
    };
    const malformed = [
      checkpointFrom({ revisionId: 'revision-2', operationKey: 'child-offer:variation-A', attemptNumber: 1, checkpointNumber: 1, state: 'started', observedRemoteState: null, evidence: {} }),
      checkpointFrom({ revisionId: 'revision-2', operationKey: 'child-offer:variation-A', attemptNumber: 1, checkpointNumber: 2, state: 'unknown', observedRemoteState: 'unknown', evidence: { reason: 'lost response' } }),
      checkpointFrom({ revisionId: 'revision-2', operationKey: 'child-offer:variation-A', attemptNumber: 2, checkpointNumber: 1, state: 'started', observedRemoteState: null, evidence: {} }),
    ];
    malformed[1] = checkpointFrom({ revisionId: 'revision-2', operationKey: 'child-offer:variation-A', attemptNumber: 1, checkpointNumber: 2, state: 'retry_authorized', observedRemoteState: 'proven_absent', evidence: { absent: true } });
    await expect(executeVariationListingActiveRevision(activeExecutionInput(prepared, revisions, malformed, base.remote, mutations))).rejects.toThrow('started checkpoint must resolve on same attempt');
    malformed[1] = checkpointFrom({ revisionId: 'revision-2', operationKey: 'child-offer:variation-A', attemptNumber: 1, checkpointNumber: 2, state: 'unknown', observedRemoteState: 'unknown', evidence: { reason: 'lost response' } });
    await expect(executeVariationListingActiveRevision(activeExecutionInput(prepared, revisions, malformed, base.remote, mutations))).rejects.toThrow('invalid reconciliation transition');
    malformed[2] = checkpointFrom({ revisionId: 'revision-2', operationKey: 'child-offer:variation-A', attemptNumber: 2, checkpointNumber: 1, state: 'confirmed_complete', observedRemoteState: 'unknown', evidence: { payload: true } });
    await expect(executeVariationListingActiveRevision(activeExecutionInput(prepared, revisions, malformed, base.remote, mutations))).rejects.toThrow('terminal checkpoint requires present evidence');
  });

  it('captures once and resumes from the durable revision without recapturing', async () => {
    const previous = aggregate({ group: group({ desired_revision: 1, last_confirmed_revision: null, lifecycle_state: 'publish-ready' }) });
    const current = aggregate({ copies: [copy('A'), copy('A2', 'variation-A'), copy('B')] });
    const base = remoteFor(previous);
    const prepared = await prepareVariationListingFrozenActiveRevision({ currentAggregate: current, previousRevision: version1Revision(previous), previousCheckpoints: version1Checkpoints(previous), remote: base.remote, revisionId: 'revision-2' });
    const revisions = { current: null as VariationListingRevisionRow | null, captureCalls: [] as number[] };
    const checkpoints: VariationListingPublishingCheckpointRow[] = [];
    const desiredBundle = buildVariationListingInventoryPayloadBundle({ aggregate: current, representativeImages: prepared.snapshot.confirmed.representativeImages });
    let itemA = base.bundle.children.find((child) => child.variationId === 'variation-A')!.inventoryItem as unknown as Json;
    let offerA = base.bundle.children.find((child) => child.variationId === 'variation-A')!.offer as unknown as Json;
    const originalGetItem = base.remote.getInventoryItem;
    const originalGetOffers = base.remote.getOffers;
    const remote = {
      ...base.remote,
      async getInventoryItem(sku: string) {
        if (sku === 'SKU-A') return { state: 'present' as const, value: { groupKeys: [desiredBundle.groupKey], payload: itemA, sku } };
        return await originalGetItem(sku);
      },
      async getOffers(sku: string, marketplaceId: string) {
        if (sku === 'SKU-A') return { state: 'present' as const, value: [{ lifecycleClass: 'active' as const, listingId: 'listing-1', marketplaceId, offerId: 'offer-SKU-A', payload: offerA, sku, status: 'PUBLISHED' as const }] };
        return await originalGetOffers(sku, marketplaceId);
      },
    };
    let firstMutation = true;
    const mutations: VariationListingActiveMutationGateway = {
      createOffer: async () => ({ offerId: 'unexpected' }),
      createOrReplaceInventoryItem: async (sku, payload) => {
        if (sku === 'SKU-A') itemA = payload;
        if (firstMutation) {
          firstMutation = false;
          throw new Error('simulated process crash');
        }
      },
      createOrReplaceInventoryItemGroup: async () => {},
      publishOffer: async () => ({ listingId: 'listing-1' }),
      updateOffer: async (offerId, payload) => {
        if (offerId === 'offer-SKU-A') offerA = payload;
      },
    };
    const makeInput = (): VariationListingActiveRevisionExecutionInput => activeExecutionInput(prepared, revisions, checkpoints, remote, mutations, {
      loadAggregate: async () => ({ ...current, group: { ...current.group, last_confirmed_revision: 1 } }),
      confirmRevision: async () => ({ ...current.group, last_confirmed_revision: 2 }),
    });
    await expect(executeVariationListingActiveRevision(makeInput())).rejects.toThrow('simulated process crash');
    expect(revisions.captureCalls).toHaveLength(1);
    await expect(executeVariationListingActiveRevision(makeInput())).resolves.toMatchObject({ confirmedRevision: 2, revisionId: 'revision-2' });
    expect(revisions.captureCalls).toHaveLength(1);
    expect(checkpoints.some((row) => row.operation_key === 'child-item:variation-A' && row.state === 'unknown')).toBe(true);
  });
});


describe('YP8.2 active revision executor acceptance', () => {
  it.each([
    ['child-item:variation-A', 'child_inventory_item_write'],
    ['child-offer:variation-A', 'child_offer_write'],
  ] as const)(
    'rejects duplicate-replenishment frozen plan missing %s before capture or mutation',
    async (missingOperationKey, missingOperationKind) => {
      const previous = aggregate({ group: group({ desired_revision: 1, last_confirmed_revision: null, lifecycle_state: 'publish-ready' }) });
      const current = aggregate({
        group: group({ desired_revision: 2, last_confirmed_revision: 1, lifecycle_state: 'active' }),
        copies: [copy('A'), copy('A2', 'variation-A'), copy('B')],
      });
      const base = remoteFor(previous);
      const prepared = await prepareVariationListingFrozenActiveRevision({
        currentAggregate: current,
        previousRevision: version1Revision(previous),
        previousCheckpoints: version1Checkpoints(previous),
        remote: base.remote,
        revisionId: 'revision-2',
      });
      const malformed = structuredClone(prepared);
      malformed.captureInput.operationPlan = malformed.captureInput.operationPlan
        .filter((operation) => operation.operationKey !== missingOperationKey)
        .map((operation, index) => ({ ...operation, sequenceNo: index + 1 }));
      const revisions = { current: null as VariationListingRevisionRow | null, captureCalls: [] as number[] };
      const checkpoints: VariationListingPublishingCheckpointRow[] = [];
      let mutationCalls = 0;
      const mutations: VariationListingActiveMutationGateway = {
        createOffer: async () => { mutationCalls += 1; return { offerId: 'unexpected' }; },
        createOrReplaceInventoryItem: async () => { mutationCalls += 1; },
        createOrReplaceInventoryItemGroup: async () => { mutationCalls += 1; },
        publishOffer: async () => { mutationCalls += 1; return { listingId: 'listing-1' }; },
        updateOffer: async () => { mutationCalls += 1; },
      };

      await expect(
        executeVariationListingActiveRevision(
          activeExecutionInput(malformed, revisions, checkpoints, base.remote, mutations)
        )
      ).rejects.toThrow(`missing required ${missingOperationKey} (${missingOperationKind})`);
      expect(revisions.captureCalls).toHaveLength(0);
      expect(checkpoints).toHaveLength(0);
      expect(mutationCalls).toBe(0);
    }
  );
  it.each(['complete-group', 'publish-offer:variation-C'])(
    'rejects a new-variation frozen plan missing %s before any mutation',
    async (missingOperationKey) => {
      const previous = aggregate({ group: group({ desired_revision: 1, last_confirmed_revision: null, lifecycle_state: 'publish-ready' }) });
      const current = aggregate({
        group: group({ desired_revision: 2, last_confirmed_revision: 1, lifecycle_state: 'active', next_inventory_serial: 4 }),
        variations: [variation('A', 0), variation('B', 1), variation('C', 2)],
        copies: [copy('A'), copy('B'), copy('C'), copy('C2', 'variation-C')],
      });
      const base = remoteFor(previous);
      const prepared = await prepareVariationListingFrozenActiveRevision({
        currentAggregate: current,
        previousRevision: version1Revision(previous),
        previousCheckpoints: version1Checkpoints(previous),
        remote: base.remote,
        revisionId: 'revision-2',
        mediaResources: [
          { copyId: 'copy-C', role: 'front', sourceUrl: 'https://source.test/C/front' },
          { copyId: 'copy-C', role: 'back', sourceUrl: 'https://source.test/C/back' },
        ],
      });
      const malformed = structuredClone(prepared);
      malformed.captureInput.operationPlan = malformed.captureInput.operationPlan
        .filter((operation) => operation.operationKey !== missingOperationKey)
        .map((operation, index) => ({ ...operation, sequenceNo: index + 1 }));
      const revisions = { current: null as VariationListingRevisionRow | null, captureCalls: [] as number[] };
      const checkpoints: VariationListingPublishingCheckpointRow[] = [];
      let mutationCalls = 0;
      const mutations: VariationListingActiveMutationGateway = {
        createMedia: async () => { mutationCalls += 1; return { imageId: 'unexpected', location: 'https://api.ebay.test/unexpected', imageUrl: eps('unexpected'), expirationDate: '2026-10-01T00:00:00Z' }; },
        createOffer: async () => { mutationCalls += 1; return { offerId: 'unexpected' }; },
        createOrReplaceInventoryItem: async () => { mutationCalls += 1; },
        createOrReplaceInventoryItemGroup: async () => { mutationCalls += 1; },
        publishOffer: async () => { mutationCalls += 1; return { listingId: 'listing-1' }; },
        updateOffer: async () => { mutationCalls += 1; },
      };

      await expect(
        executeVariationListingActiveRevision(
          activeExecutionInput(malformed, revisions, checkpoints, base.remote, mutations)
        )
      ).rejects.toThrow(`missing required ${missingOperationKey}`);
      expect(mutationCalls).toBe(0);
    }
  );

  it('adds a new variation through createOffer, tolerates a sale inside publishOffer, and confirms on the same listing ID', async () => {
    const previous = aggregate({ group: group({ desired_revision: 1, last_confirmed_revision: null, lifecycle_state: 'publish-ready' }) });
    const current = aggregate({
      group: group({ desired_revision: 2, last_confirmed_revision: 1, lifecycle_state: 'active', next_inventory_serial: 4 }),
      variations: [variation('A', 0), variation('B', 1), variation('C', 2)],
      copies: [copy('A'), copy('B'), copy('C'), copy('C2', 'variation-C')],
    });
    const base = remoteFor(previous);
    const prepared = await prepareVariationListingFrozenActiveRevision({
      currentAggregate: current,
      previousRevision: version1Revision(previous),
      previousCheckpoints: version1Checkpoints(previous),
      remote: base.remote,
      revisionId: 'revision-2',
      mediaResources: [
        { copyId: 'copy-C', role: 'front', sourceUrl: 'https://source.test/C/front' },
        { copyId: 'copy-C', role: 'back', sourceUrl: 'https://source.test/C/back' },
      ],
    });
    const revisions = { current: null as VariationListingRevisionRow | null, captureCalls: [] as number[] };
    const checkpoints: VariationListingPublishingCheckpointRow[] = [];
    const items = new Map(base.bundle.children.map((child) => [child.sku, { groupKeys: [base.bundle.groupKey] as string[] | null, payload: child.inventoryItem as unknown as Json, sku: child.sku }]));
    const offers = new Map(base.bundle.children.map((child) => [child.sku, [{ lifecycleClass: 'active' as const, listingId: 'listing-1', marketplaceId: child.offer.marketplaceId, offerId: `offer-${child.sku}`, payload: child.offer as unknown as Json, sku: child.sku, status: 'PUBLISHED' as const }]]));
    let remoteGroup: { payload: Json; variantSKUs: string[] } = { payload: base.bundle.group as unknown as Json, variantSKUs: [...base.bundle.group.variantSKUs].reverse() };
    const media = new Map<string, { imageId: string; location: string; imageUrl: string; expirationDate: string }>();
    const calls: string[] = [];
    let createdItemPayloadAtCreate: Json | null = null;
    let createdOfferPayloadAtCreate: Json | null = null;
    const remote: VariationListingActiveRevisionExecutionInput['remote'] = {
      async getInventoryItem(sku) { const value = items.get(sku); return value ? { state: 'present' as const, value } : { state: 'proven_absent' as const }; },
      async getOffers(sku) { return { state: 'present' as const, value: offers.get(sku) ?? [] }; },
      async getInventoryItemGroup() { return { state: 'present' as const, value: remoteGroup }; },
      async getMedia(location) { const value = media.get(location); return value ? { state: 'present' as const, value } : { state: 'proven_absent' as const }; },
    };
    const mutations: VariationListingActiveMutationGateway = {
      async createMedia(sourceUrl) {
        calls.push(`media:${sourceUrl}`);
        const role = sourceUrl.endsWith('/front') ? 'front' : 'back';
        const value = { imageId: `image-C-${role}`, location: `https://api.ebay.test/C-${role}`, imageUrl: eps(role === 'front' ? 'CF' : 'CB'), expirationDate: '2026-10-01T00:00:00Z' };
        media.set(value.location, value);
        return value;
      },
      async createOrReplaceInventoryItem(sku, payload) {
        calls.push(`item:${sku}`);
        if (sku === 'SKU-C') createdItemPayloadAtCreate = structuredClone(payload);
        items.set(sku, { groupKeys: null, payload, sku });
      },
      async createOffer(payload) {
        const body = payload as { sku: string; marketplaceId: string };
        calls.push(`create-offer:${body.sku}`);
        if (body.sku === 'SKU-C') createdOfferPayloadAtCreate = structuredClone(payload);
        const offerId = `durable-offer-${body.sku}`;
        offers.set(body.sku, [{ lifecycleClass: null, listingId: null, marketplaceId: body.marketplaceId, offerId, payload, sku: body.sku, status: 'UNPUBLISHED' }]);
        return { offerId };
      },
      async updateOffer(offerId) { calls.push(`update-offer:${offerId}`); },
      async createOrReplaceInventoryItemGroup(_groupKey, payload) {
        calls.push('group-replace');
        const body = payload as Record<string, Json>;
        const variantSKUs = [...(body.variantSKUs as string[])];
        remoteGroup = { payload, variantSKUs: [...variantSKUs].reverse() };
        for (const sku of variantSKUs) {
          const item = items.get(sku)!;
          item.groupKeys = [current.group.group_key];
        }
      },
      async publishOffer(offerId) {
        calls.push(`publish:${offerId}`);
        const entry = [...offers.entries()].find(([, rows]) => rows[0]?.offerId === offerId);
        if (!entry) throw new Error('offer missing');
        const offer = entry[1][0]!;
        offer.status = 'PUBLISHED';
        offer.listingId = 'listing-1';
        offer.lifecycleClass = 'active';
        // Simulate a buyer sale after eBay accepted the publish but before
        // the post-state read. The publish operation already owns identity
        // and non-quantity payload, so this quantity-only drift is resumable.
        if (offerId === 'durable-offer-SKU-C') {
          const item = items.get('SKU-C');
          if (item) {
            const payload = structuredClone(item.payload) as Record<string, Json>;
            (payload.availability as Record<string, Json>).shipToLocationAvailability = { quantity: 1 };
            item.payload = payload as Json;
          }
          const payload = structuredClone(offer.payload) as Record<string, Json>;
          payload.availableQuantity = 1;
          offer.payload = payload as Json;
        }
        return { listingId: 'listing-1' };
      },
    };
    const collisionBundle = buildVariationListingInventoryPayloadBundle({
      aggregate: current,
      representativeImages: [
        ...prepared.snapshot.confirmed.representativeImages,
        { copyId: 'copy-C', frontEpsUrl: eps('CF'), backEpsUrl: eps('CB') },
      ],
    });
    const collisionChild = collisionBundle.children.find((child) => child.sku === 'SKU-C')!;
    offers.set('SKU-C', [{
      lifecycleClass: null,
      listingId: null,
      marketplaceId: collisionChild.offer.marketplaceId,
      offerId: 'foreign-collision-SKU-C',
      payload: collisionChild.offer as unknown as Json,
      sku: 'SKU-C',
      status: 'UNPUBLISHED' as const,
    }]);
    await expect(executeVariationListingActiveRevision(activeExecutionInput(prepared, revisions, checkpoints, remote, mutations, {
      loadAggregate: async () => current,
      confirmRevision: async () => ({ ...current.group, last_confirmed_revision: 2, lifecycle_state: 'active' }),
    }))).rejects.toThrow('must be absent before create');
    expect(calls).not.toContain('create-offer:SKU-C');
    offers.delete('SKU-C');
    items.delete('SKU-C');
    media.clear();
    checkpoints.splice(0, checkpoints.length);
    calls.splice(0, calls.length);
    const result = await executeVariationListingActiveRevision(activeExecutionInput(prepared, revisions, checkpoints, remote, mutations, {
      loadAggregate: async () => current,
      confirmRevision: async () => { calls.push('confirm'); return { ...current.group, last_confirmed_revision: 2, lifecycle_state: 'active' }; },
    }));
    expect(result).toEqual({ confirmedRevision: 2, listingId: 'listing-1', revisionId: 'revision-2' });
    expect(calls).toContain('create-offer:SKU-C');
    const createdItemC = createdItemPayloadAtCreate as Record<string, Json>;
    expect((createdItemC.availability as Record<string, Json>).shipToLocationAvailability).toMatchObject({ quantity: 2 });
    expect((createdOfferPayloadAtCreate as Record<string, Json>).availableQuantity).toBe(2);
    expect((items.get('SKU-C')!.payload as Record<string, Json>).availability).toMatchObject({ shipToLocationAvailability: { quantity: 1 } });
    expect((offers.get('SKU-C')![0]!.payload as Record<string, Json>).availableQuantity).toBe(1);
    expect(calls).toContain('group-replace');
    expect(calls).toContain('publish:durable-offer-SKU-C');
    expect(calls).not.toContain('update-offer:offer-SKU-C');
    expect(checkpoints.filter((row) => row.operation_key === 'child-offer:variation-C').at(-1)).toMatchObject({ state: 'confirmed_complete', evidence: { offerId: 'durable-offer-SKU-C' } });
    expect(checkpoints.filter((row) => row.operation_key === 'publish-offer:variation-C').at(-1)).toMatchObject({ state: 'confirmed_complete' });
    const mediaFront = calls.indexOf('media:https://source.test/C/front');
    const mediaBack = calls.indexOf('media:https://source.test/C/back');
    const childItem = calls.indexOf('item:SKU-C');
    const childOffer = calls.indexOf('create-offer:SKU-C');
    const groupReplace = calls.indexOf('group-replace');
    const publish = calls.indexOf('publish:durable-offer-SKU-C');
    const confirm = calls.indexOf('confirm');
    expect(mediaFront).toBeGreaterThanOrEqual(0);
    expect(mediaBack).toBeGreaterThan(mediaFront);
    expect(childItem).toBeGreaterThan(mediaBack);
    expect(childOffer).toBeGreaterThan(childItem);
    expect(groupReplace).toBeGreaterThan(childOffer);
    expect(publish).toBeGreaterThan(groupReplace);
    expect(confirm).toBeGreaterThan(publish);

    // A buyer sale may lower both quantities after the new offer was
    // published but before the revision watermark commit. Terminal journal
    // evidence allows a read-only resume that preserves identity and payload
    // while tolerating that quantity-only drift.
    const createdItem = items.get('SKU-C')!;
    const createdItemPayload = structuredClone(createdItem.payload) as unknown as Record<string, Json>;
    (createdItemPayload.availability as Record<string, Json>).shipToLocationAvailability = { quantity: 1 };
    createdItem.payload = createdItemPayload as Json;
    const createdOffer = offers.get('SKU-C')![0]!;
    const createdOfferPayload = structuredClone(createdOffer.payload) as unknown as Record<string, Json>;
    createdOfferPayload.availableQuantity = 1;
    createdOffer.payload = createdOfferPayload as Json;
    const callsBeforeSaleResume = calls.length;
    await expect(executeVariationListingActiveRevision(activeExecutionInput(prepared, revisions, checkpoints, remote, mutations, {
      loadAggregate: async () => ({ ...current, group: { ...current.group, last_confirmed_revision: 1 } }),
      confirmRevision: async () => ({ ...current.group, last_confirmed_revision: 2, lifecycle_state: 'active' }),
    }))).resolves.toMatchObject({ confirmedRevision: 2, listingId: 'listing-1' });
    expect(calls).toHaveLength(callsBeforeSaleResume);
    // Restore the exact frozen payload before the following foreign-identity
    // regression; that branch intentionally proves unknown history cannot
    // adopt a replacement offer.
    (createdItem.payload as Record<string, Json>).availability = (collisionChild.inventoryItem as Record<string, Json>).availability;
    (createdOffer.payload as Record<string, Json>).availableQuantity = 2;

    const terminalRows = [...checkpoints];
    const foreignOffer = {
      lifecycleClass: null,
      listingId: null,
      marketplaceId: current.group.marketplace_id,
      offerId: 'foreign-offer-SKU-C',
      payload: offers.get('SKU-C')![0]!.payload,
      sku: 'SKU-C',
      status: 'UNPUBLISHED' as const,
    };
    offers.set('SKU-C', [foreignOffer]);
    checkpoints.splice(
      0,
      checkpoints.length,
      ...terminalRows.filter((row) => row.operation_key !== 'child-offer:variation-C' && row.operation_key !== 'publish-offer:variation-C'),
      checkpointFrom({ revisionId: 'revision-2', operationKey: 'child-offer:variation-C', attemptNumber: 1, checkpointNumber: 1, state: 'started', observedRemoteState: null, evidence: {} }),
      checkpointFrom({ revisionId: 'revision-2', operationKey: 'child-offer:variation-C', attemptNumber: 1, checkpointNumber: 2, state: 'unknown', observedRemoteState: 'unknown', evidence: { reason: 'lost response' } }),
    );
    const callsBeforeUnknownResume = calls.length;
    await expect(executeVariationListingActiveRevision(activeExecutionInput(prepared, revisions, checkpoints, remote, mutations, {
      loadAggregate: async () => current,
      confirmRevision: async () => ({ ...current.group, last_confirmed_revision: 2, lifecycle_state: 'active' }),
    }))).rejects.toThrow('no durable offer identity for resume');
    expect(calls).toHaveLength(callsBeforeUnknownResume);

    checkpoints.splice(0, checkpoints.length, ...terminalRows);
    const callsBeforeReplacementResume = calls.length;
    await expect(executeVariationListingActiveRevision(activeExecutionInput(prepared, revisions, checkpoints, remote, mutations, {
      loadAggregate: async () => current,
      confirmRevision: async () => ({ ...current.group, last_confirmed_revision: 2, lifecycle_state: 'active' }),
    }))).rejects.toThrow('durable offer ID drifted');
    expect(calls).toHaveLength(callsBeforeReplacementResume);
  });

  it('resumes terminal child writes after a sale changes quantities before final reconciliation', async () => {
    const previous = aggregate({ group: group({ desired_revision: 1, last_confirmed_revision: null, lifecycle_state: 'publish-ready' }) });
    const current = aggregate({
      group: group({ desired_revision: 2, last_confirmed_revision: 1, lifecycle_state: 'active' }),
      variations: [variation('A', 0, 'copy-A', 1.49), variation('B', 1)],
    });
    const base = remoteFor(previous);
    const prepared = await prepareVariationListingFrozenActiveRevision({ currentAggregate: current, previousRevision: version1Revision(previous), previousCheckpoints: version1Checkpoints(previous), remote: base.remote, revisionId: 'revision-2' });
    const desired = buildVariationListingInventoryPayloadBundle({ aggregate: current, representativeImages: prepared.snapshot.confirmed.representativeImages });
    const terminalKeys = prepared.captureInput.operationPlan
      .filter((operation) => ['child_inventory_item_write', 'child_offer_write', 'complete_group_replace'].includes(operation.operationKind))
      .map((operation) => operation.operationKey);
    const checkpoints = terminalKeys.flatMap((operationKey) => [
      checkpointFrom({ revisionId: 'revision-2', operationKey, attemptNumber: 1, checkpointNumber: 1, state: 'started', observedRemoteState: null, evidence: {} }),
      checkpointFrom({ revisionId: 'revision-2', operationKey, attemptNumber: 1, checkpointNumber: 2, state: 'confirmed_complete', observedRemoteState: 'present', evidence: { confirmed: true } }),
    ]);
    const revisions = { current: durableRevision(prepared), captureCalls: [] as number[] };
    const desiredA = desired.children.find((child) => child.sku === 'SKU-A')!;
    const desiredB = desired.children.find((child) => child.sku === 'SKU-B')!;
    const remote: VariationListingActiveRevisionExecutionInput['remote'] = {
      async getInventoryItem(sku) {
        const child = sku === 'SKU-A' ? desiredA : desiredB;
        const payload = structuredClone(child.inventoryItem) as unknown as Record<string, Json>;
        if (sku === 'SKU-A') (payload.availability as Record<string, Json>).shipToLocationAvailability = { quantity: 0 };
        return { state: 'present' as const, value: { groupKeys: [desired.groupKey], payload: payload as Json, sku } };
      },
      async getOffers(sku, marketplaceId) {
        const child = sku === 'SKU-A' ? desiredA : desiredB;
        const payload = structuredClone(child.offer) as unknown as Record<string, Json>;
        if (sku === 'SKU-A') payload.availableQuantity = 0;
        return { state: 'present' as const, value: [{ lifecycleClass: 'active' as const, listingId: 'listing-1', marketplaceId, offerId: `offer-${sku}`, payload: payload as Json, sku, status: 'PUBLISHED' as const }] };
      },
      async getInventoryItemGroup() { return { state: 'present' as const, value: { payload: desired.group as unknown as Json, variantSKUs: [...desired.group.variantSKUs].reverse() } }; },
    };
    let mutationCalls = 0;
    const mutations: VariationListingActiveMutationGateway = {
      createOffer: async () => { mutationCalls += 1; throw new Error('terminal child offer must not replay'); },
      createOrReplaceInventoryItem: async () => { mutationCalls += 1; throw new Error('terminal child item must not replay'); },
      createOrReplaceInventoryItemGroup: async () => { mutationCalls += 1; throw new Error('terminal group must not replay'); },
      publishOffer: async () => { mutationCalls += 1; throw new Error('no new offer expected'); },
      updateOffer: async () => { mutationCalls += 1; throw new Error('terminal offer must not replay'); },
    };
    await expect(executeVariationListingActiveRevision(activeExecutionInput(prepared, revisions, checkpoints, remote, mutations, {
      loadAggregate: async () => current,
      confirmRevision: async () => ({ ...current.group, last_confirmed_revision: 2, lifecycle_state: 'active' }),
    }))).resolves.toMatchObject({ confirmedRevision: 2, listingId: 'listing-1' });
    expect(mutationCalls).toBe(0);
  });

  it('authorizes exactly one replay after an unknown existing-offer update and then succeeds', async () => {
    const previous = aggregate({ group: group({ desired_revision: 1, last_confirmed_revision: null, lifecycle_state: 'publish-ready' }) });
    const current = aggregate({ variations: [variation('A', 0, 'copy-A', 1.49), variation('B', 1)] });
    const base = remoteFor(previous);
    const prepared = await prepareVariationListingFrozenActiveRevision({ currentAggregate: current, previousRevision: version1Revision(previous), previousCheckpoints: version1Checkpoints(previous), remote: base.remote, revisionId: 'revision-2' });
    const revisions = { current: durableRevision(prepared), captureCalls: [] as number[] };
    const checkpoints: VariationListingPublishingCheckpointRow[] = [];
    const desired = buildVariationListingInventoryPayloadBundle({ aggregate: current, representativeImages: prepared.snapshot.confirmed.representativeImages });
    let offerA = base.bundle.children[0]!.offer as unknown as Json;
    let updateCalls = 0;
    const remote = {
      ...base.remote,
      async getOffers(sku: string, marketplaceId: string) {
        if (sku === 'SKU-A') return { state: 'present' as const, value: [{ lifecycleClass: 'active' as const, listingId: 'listing-1', marketplaceId, offerId: 'offer-SKU-A', payload: offerA, sku, status: 'PUBLISHED' as const }] };
        return base.remote.getOffers(sku, marketplaceId);
      },
    };
    const mutations: VariationListingActiveMutationGateway = {
      createOffer: async () => ({ offerId: 'unexpected' }),
      createOrReplaceInventoryItem: async () => {},
      createOrReplaceInventoryItemGroup: async () => {},
      publishOffer: async () => ({ listingId: 'listing-1' }),
      updateOffer: async (_offerId, payload) => {
        updateCalls += 1;
        if (updateCalls === 1) throw new Error('lost response');
        offerA = payload;
      },
    };
    const makeInput = () => activeExecutionInput(prepared, revisions, checkpoints, remote, mutations, {
      loadAggregate: async () => current,
      confirmRevision: async () => ({ ...current.group, last_confirmed_revision: 2, lifecycle_state: 'active' }),
    });
    await expect(executeVariationListingActiveRevision(makeInput())).rejects.toThrow('lost response');
    await expect(executeVariationListingActiveRevision(makeInput())).rejects.toThrow('retry authorized');
    await expect(executeVariationListingActiveRevision(makeInput())).resolves.toMatchObject({ confirmedRevision: 2 });
    expect(updateCalls).toBe(2);
    expect(offerA).toEqual(desired.children[0]!.offer);
    expect(checkpoints.filter((row) => row.operation_key === 'child-offer:variation-A').map((row) => row.state)).toEqual(['started', 'unknown', 'retry_authorized', 'started', 'confirmed_complete']);
  });

  it('exhausts after a second unknown replay and never permits a third mutation', async () => {
    const previous = aggregate({ group: group({ desired_revision: 1, last_confirmed_revision: null, lifecycle_state: 'publish-ready' }) });
    const current = aggregate({ variations: [variation('A', 0, 'copy-A', 1.49), variation('B', 1)] });
    const base = remoteFor(previous);
    const prepared = await prepareVariationListingFrozenActiveRevision({ currentAggregate: current, previousRevision: version1Revision(previous), previousCheckpoints: version1Checkpoints(previous), remote: base.remote, revisionId: 'revision-2' });
    const revisions = { current: durableRevision(prepared), captureCalls: [] as number[] };
    const checkpoints: VariationListingPublishingCheckpointRow[] = [];
    let updateCalls = 0;
    const mutations: VariationListingActiveMutationGateway = {
      createOffer: async () => ({ offerId: 'unexpected' }),
      createOrReplaceInventoryItem: async () => {},
      createOrReplaceInventoryItemGroup: async () => {},
      publishOffer: async () => ({ listingId: 'listing-1' }),
      updateOffer: async () => { updateCalls += 1; throw new Error(`lost response ${updateCalls}`); },
    };
    const makeInput = () => activeExecutionInput(prepared, revisions, checkpoints, base.remote, mutations, {
      loadAggregate: async () => current,
      confirmRevision: async () => ({ ...current.group, last_confirmed_revision: 2, lifecycle_state: 'active' }),
    });
    await expect(executeVariationListingActiveRevision(makeInput())).rejects.toThrow('lost response 1');
    await expect(executeVariationListingActiveRevision(makeInput())).rejects.toThrow('retry authorized');
    await expect(executeVariationListingActiveRevision(makeInput())).rejects.toThrow('lost response 2');
    await expect(executeVariationListingActiveRevision(makeInput())).rejects.toThrow('exhausted its one bounded replay');
    await expect(executeVariationListingActiveRevision(makeInput())).rejects.toThrow('exhausted its one bounded replay');
    expect(updateCalls).toBe(2);
    expect(checkpoints.filter((row) => row.operation_key === 'child-offer:variation-A').map((row) => row.state)).toEqual(['started', 'unknown', 'retry_authorized', 'started', 'unknown', 'retry_exhausted']);
  });
});
