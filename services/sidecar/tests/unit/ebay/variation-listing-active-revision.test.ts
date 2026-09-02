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

import { buildVariationListingInventoryPayloadBundle } from '@/ebay/variation-listing-payloads.js';
import {
  executeVariationListingActiveRevision,
  prepareVariationListingFrozenActiveRevision,
  reconstructVariationListingConfirmedRepresentativeImages,
  type VariationListingActiveMutationGateway,
  type VariationListingActiveRevisionExecutionInput,
  type VariationListingFrozenActiveRevision,
} from '@/ebay/variation-listing-active-revision.js';

const eps = (name: string): string => `https://i.ebayimg.com/images/g/${name}/s-l1600.jpg`;
const timestamp = '2026-09-01T00:00:00Z';

function group(overrides: Partial<VariationListingGroupRow> = {}): VariationListingGroupRow {
  return {
    category_id: '261328', condition_description: null, condition_descriptors: [], condition_id: '4000', condition_token: 'VERY_GOOD', created_at: timestamp, derived_common_ebay_aspects: { Sport: ['Baseball'] }, description: 'Cards', desired_revision: 2, fulfillment_policy_id: 'fulfillment', group_id: 'group-1', group_key: 'GROUP-1', last_confirmed_revision: 1, lifecycle_state: 'active', listing_format: 'FIXED_PRICE', marketplace_id: 'EBAY_US', merchant_location_key: 'warehouse', next_inventory_serial: 3, payment_policy_id: 'payment', return_policy_id: 'return', selector_name: 'Card', sku_bucket_token: 'bucket', sku_category_code: 'sports', title: 'Cards', updated_at: timestamp, ...overrides,
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
  return { captured_at: timestamp, captured_desired_revision: 1, group_id: 'group-1', operation_count: 1, operation_plan: [{ intent: {}, intent_digest: 'a'.repeat(64), intent_version: 1, operation_key: 'revision-reconcile', operation_kind: 'revision_reconcile', sequence_no: 1, target_ref: 'GROUP-1' }], revision_id: 'revision-1', snapshot, snapshot_digest: digest(snapshot), snapshot_version: 1 };
}
function remoteFor(previous: VariationListingAggregateSnapshot) {
  const images = [{ copyId: 'copy-A', frontEpsUrl: eps('AF'), backEpsUrl: eps('AB') }, { copyId: 'copy-B', frontEpsUrl: eps('BF'), backEpsUrl: eps('BB') }];
  const bundle = buildVariationListingInventoryPayloadBundle({ aggregate: previous, representativeImages: images });
  return {
    bundle,
    remote: {
      async getInventoryItem(sku: string) { const child = bundle.children.find((candidate) => candidate.sku === sku)!; return { state: 'present' as const, value: { groupKeys: [bundle.groupKey], payload: child.inventoryItem as unknown as Json, sku } }; },
      async getOffers(sku: string, marketplaceId: string) { const child = bundle.children.find((candidate) => candidate.sku === sku)!; return { state: 'present' as const, value: [{ lifecycleClass: 'active' as const, listingId: 'listing-1', marketplaceId, offerId: `offer-${sku}`, payload: child.offer as unknown as Json, sku, status: 'PUBLISHED' as const }] }; },
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

describe('YP5.3 active revision preparation', () => {
  it('freezes a self-contained version-2 revision after exact confirmed active preflight', async () => {
    const previous = aggregate({ group: group({ desired_revision: 1, last_confirmed_revision: null, lifecycle_state: 'publish-ready' }) });
    const current = aggregate({ variations: [variation('A', 0, 'copy-A', 1.49), variation('B', 1)] });
    const { remote } = remoteFor(previous);
    const prepared = await prepareVariationListingFrozenActiveRevision({ currentAggregate: current, previousRevision: version1Revision(previous), previousCheckpoints: [], remote, revisionId: 'revision-2' });
    expect(prepared.captureInput.snapshotVersion).toBe(2);
    expect(prepared.snapshot.confirmed.remote.listingId).toBe('listing-1');
    expect(prepared.snapshot.confirmed.remote.offerIdsBySku).toEqual({ 'SKU-A': 'offer-SKU-A', 'SKU-B': 'offer-SKU-B' });
    expect(prepared.desiredBundlePreview?.children[0]?.offer.pricingSummary.price.value).toBe('1.49');
    expect(prepared.captureInput.operationPlan.at(-1)?.operationKind).toBe('revision_reconcile');
  });

  it('requires exact front/back Media intents when representative copy changes', async () => {
    const previous = aggregate({ group: group({ desired_revision: 1, last_confirmed_revision: null, lifecycle_state: 'publish-ready' }) });
    const current = aggregate({ variations: [variation('A', 0, 'copy-A2'), variation('B', 1)], copies: [copy('A'), copy('A2', 'variation-A'), copy('B')] });
    const { remote } = remoteFor(previous);
    await expect(prepareVariationListingFrozenActiveRevision({ currentAggregate: current, previousRevision: version1Revision(previous), previousCheckpoints: [], remote, revisionId: 'revision-2' })).rejects.toThrow('requires front/back Media source intents');
    const prepared = await prepareVariationListingFrozenActiveRevision({ currentAggregate: current, previousRevision: version1Revision(previous), previousCheckpoints: [], remote, revisionId: 'revision-2', mediaResources: [{ copyId: 'copy-A2', role: 'front', sourceUrl: 'https://source.test/A2/front' }, { copyId: 'copy-A2', role: 'back', sourceUrl: 'https://source.test/A2/back' }] });
    expect(prepared.desiredBundlePreview).toBeNull();
    expect(prepared.captureInput.operationPlan.slice(0, 2).map((op) => op.operationKind)).toEqual(['media_ingest', 'media_ingest']);
  });

  it('rejects deletion or identity drift of a previously confirmed variation', async () => {
    const previous = aggregate({ group: group({ desired_revision: 1, last_confirmed_revision: null, lifecycle_state: 'publish-ready' }) });
    const { remote } = remoteFor(previous);
    await expect(prepareVariationListingFrozenActiveRevision({ currentAggregate: aggregate({ variations: [variation('A', 0)], copies: [copy('A')] }), previousRevision: version1Revision(previous), previousCheckpoints: [], remote, revisionId: 'revision-2' })).rejects.toThrow('cannot remove confirmed variation');
    await expect(prepareVariationListingFrozenActiveRevision({ currentAggregate: aggregate({ variations: [{ ...variation('A', 0), sku: 'CHANGED' }, variation('B', 1)] }), previousRevision: version1Revision(previous), previousCheckpoints: [], remote, revisionId: 'revision-2' })).rejects.toThrow('identity changed');
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
    const current = aggregate({ copies: [{ ...copy('A'), availability_state: 'unavailable' }, copy('B')] });
    const { remote } = remoteFor(previous);
    const prepared = await prepareVariationListingFrozenActiveRevision({ currentAggregate: current, previousRevision: version1Revision(previous), previousCheckpoints: [], remote, revisionId: 'revision-2' });
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
    const prepared = await prepareVariationListingFrozenActiveRevision({ currentAggregate: current, previousRevision: version1Revision(previous), previousCheckpoints: [], remote, revisionId: 'revision-2' });
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
      previousCheckpoints: [],
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

  it('rejects malformed bounded-retry history and terminal evidence before any remote mutation', async () => {
    const previous = aggregate({ group: group({ desired_revision: 1, last_confirmed_revision: null, lifecycle_state: 'publish-ready' }) });
    const current = aggregate({ variations: [variation('A', 0, 'copy-A', 1.49), variation('B', 1)] });
    const base = remoteFor(previous);
    const prepared = await prepareVariationListingFrozenActiveRevision({ currentAggregate: current, previousRevision: version1Revision(previous), previousCheckpoints: [], remote: base.remote, revisionId: 'revision-2' });
    const revisions = { current: durableRevision(prepared), captureCalls: [] as number[] };
    const mutations: VariationListingActiveMutationGateway = {
      createOffer: async () => { throw new Error('must not mutate'); },
      createOrReplaceInventoryItem: async () => { throw new Error('must not mutate'); },
      createOrReplaceInventoryItemGroup: async () => { throw new Error('must not mutate'); },
      publishOffer: async () => { throw new Error('must not mutate'); },
      updateOffer: async () => { throw new Error('must not mutate'); },
    };
    const malformed = [
      checkpointFrom({ revisionId: 'revision-2', operationKey: 'child-item:variation-A', attemptNumber: 1, checkpointNumber: 1, state: 'started', observedRemoteState: null, evidence: {} }),
      checkpointFrom({ revisionId: 'revision-2', operationKey: 'child-item:variation-A', attemptNumber: 1, checkpointNumber: 2, state: 'unknown', observedRemoteState: 'unknown', evidence: { reason: 'lost response' } }),
      checkpointFrom({ revisionId: 'revision-2', operationKey: 'child-item:variation-A', attemptNumber: 2, checkpointNumber: 1, state: 'started', observedRemoteState: null, evidence: {} }),
    ];
    malformed[1] = checkpointFrom({ revisionId: 'revision-2', operationKey: 'child-item:variation-A', attemptNumber: 1, checkpointNumber: 2, state: 'retry_authorized', observedRemoteState: 'proven_absent', evidence: { absent: true } });
    await expect(executeVariationListingActiveRevision(activeExecutionInput(prepared, revisions, malformed, base.remote, mutations))).rejects.toThrow('started checkpoint must resolve on same attempt');
    malformed[1] = checkpointFrom({ revisionId: 'revision-2', operationKey: 'child-item:variation-A', attemptNumber: 1, checkpointNumber: 2, state: 'unknown', observedRemoteState: 'unknown', evidence: { reason: 'lost response' } });
    await expect(executeVariationListingActiveRevision(activeExecutionInput(prepared, revisions, malformed, base.remote, mutations))).rejects.toThrow('invalid reconciliation transition');
    malformed[2] = checkpointFrom({ revisionId: 'revision-2', operationKey: 'child-item:variation-A', attemptNumber: 2, checkpointNumber: 1, state: 'confirmed_complete', observedRemoteState: 'unknown', evidence: { payload: true } });
    await expect(executeVariationListingActiveRevision(activeExecutionInput(prepared, revisions, malformed, base.remote, mutations))).rejects.toThrow('terminal checkpoint requires present evidence');
  });

  it('captures once and resumes from the durable revision without recapturing', async () => {
    const previous = aggregate({ group: group({ desired_revision: 1, last_confirmed_revision: null, lifecycle_state: 'publish-ready' }) });
    const current = aggregate({ copies: [{ ...copy('A'), availability_state: 'unavailable' }, copy('B')] });
    const base = remoteFor(previous);
    const prepared = await prepareVariationListingFrozenActiveRevision({ currentAggregate: current, previousRevision: version1Revision(previous), previousCheckpoints: [], remote: base.remote, revisionId: 'revision-2' });
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


describe('YP5.3 active revision executor acceptance', () => {
  it('adds a new variation through createOffer, complete group replacement, publishOffer, and confirms on the same listing ID', async () => {
    const previous = aggregate({ group: group({ desired_revision: 1, last_confirmed_revision: null, lifecycle_state: 'publish-ready' }) });
    const current = aggregate({
      group: group({ desired_revision: 2, last_confirmed_revision: 1, lifecycle_state: 'active', next_inventory_serial: 4 }),
      variations: [variation('A', 0), variation('B', 1), variation('C', 2)],
      copies: [copy('A'), copy('B'), copy('C')],
    });
    const base = remoteFor(previous);
    const prepared = await prepareVariationListingFrozenActiveRevision({
      currentAggregate: current,
      previousRevision: version1Revision(previous),
      previousCheckpoints: [],
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
      async createOrReplaceInventoryItem(sku, payload) { calls.push(`item:${sku}`); items.set(sku, { groupKeys: null, payload, sku }); },
      async createOffer(payload) {
        const body = payload as { sku: string; marketplaceId: string };
        calls.push(`create-offer:${body.sku}`);
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

  it('authorizes exactly one replay after an unknown existing-offer update and then succeeds', async () => {
    const previous = aggregate({ group: group({ desired_revision: 1, last_confirmed_revision: null, lifecycle_state: 'publish-ready' }) });
    const current = aggregate({ variations: [variation('A', 0, 'copy-A', 1.49), variation('B', 1)] });
    const base = remoteFor(previous);
    const prepared = await prepareVariationListingFrozenActiveRevision({ currentAggregate: current, previousRevision: version1Revision(previous), previousCheckpoints: [], remote: base.remote, revisionId: 'revision-2' });
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
    const prepared = await prepareVariationListingFrozenActiveRevision({ currentAggregate: current, previousRevision: version1Revision(previous), previousCheckpoints: [], remote: base.remote, revisionId: 'revision-2' });
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
