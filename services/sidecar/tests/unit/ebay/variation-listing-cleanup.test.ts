import type { Json, VariationListingAggregateSnapshot, VariationListingCopyRow, VariationListingGroupRow, VariationListingPublishingCheckpointRow, VariationListingRevisionRow, VariationListingVariationRow } from '@ebay-inventory/data';
import { describe, expect, it } from 'vitest';

import { abandonUntouchedVariationListingGroup, executeVariationListingCleanup, executeVariationListingWithdrawal, freezeVariationListingCleanupRevision, prepareVariationListingCleanupPlan } from '@/ebay/variation-listing-cleanup.js';
import { buildVariationListingInventoryPayloadBundle, type VariationListingRepresentativeImage } from '@/ebay/variation-listing-payloads.js';
import type { VariationListingPublicationReadGateway, VariationListingRemoteOffer } from '@/ebay/variation-listing-publication.js';

const timestamp = '2026-09-02T00:00:00Z';
const eps = (name: string): string => `https://i.ebayimg.com/images/g/${name}/s-l1600.jpg`;

function group(): VariationListingGroupRow {
  return { category_id: '261328', condition_description: null, condition_descriptors: [], condition_id: '4000', condition_token: 'VERY_GOOD', created_at: timestamp, derived_common_ebay_aspects: { Sport: ['Baseball'] }, description: 'Cards', desired_revision: 1, fulfillment_policy_id: 'fulfillment', group_id: 'group-1', group_key: 'GROUP-1', last_confirmed_revision: 1, lifecycle_state: 'active', listing_format: 'FIXED_PRICE', marketplace_id: 'EBAY_US', merchant_location_key: 'warehouse', next_inventory_serial: 4, payment_policy_id: 'payment', return_policy_id: 'return', selector_name: 'Card', sku_bucket_token: 'bucket', sku_category_code: 'sports', title: 'Cards', updated_at: timestamp };
}
function variation(id: string, position: number): VariationListingVariationRow {
  return { created_at: timestamp, group_id: 'group-1', inventory_serial: position + 1, position, price_amount: 0.99, price_currency: 'USD', representative_copy_id: `copy-${id}`, selector_value: `Card ${id}`, sku: `SKU-${id}`, updated_at: timestamp, variation_id: `variation-${id}`, variation_metadata: {} };
}
function copy(id: string): VariationListingCopyRow {
  return { availability_state: 'available', back_r2_key: `r2/${id}/back`, capture_back_source_ref: `source/${id}/back`, capture_front_source_ref: `source/${id}/front`, capture_pair_id: `pair-${id}`, capture_source_key: `capture-${id}`, capture_started_at: timestamp, captured_at: timestamp, condition_notes: null, condition_token: 'VERY_GOOD', copy_id: `copy-${id}`, created_at: timestamp, front_r2_key: `r2/${id}/front`, updated_at: timestamp, variation_id: `variation-${id}` };
}
function aggregate(ids: string[]): VariationListingAggregateSnapshot {
  return { group: group(), variations: ids.map((id, index) => variation(id, index)), copies: ids.map(copy) };
}
function images(ids: string[]): VariationListingRepresentativeImage[] {
  return ids.map((id) => ({ copyId: `copy-${id}`, frontEpsUrl: eps(`${id}F`), backEpsUrl: eps(`${id}B`) }));
}
function bundle(ids: string[]) {
  return buildVariationListingInventoryPayloadBundle({ aggregate: aggregate(ids), representativeImages: images(ids) });
}

function remoteState(input: {
  bundles: ReturnType<typeof bundle>[];
  groupBundleIndex?: number | null;
  items?: string[];
  offers?: Record<string, VariationListingRemoteOffer>;
}): VariationListingPublicationReadGateway {
  const newest = input.bundles.at(-1)!;
  const items = new Set(input.items ?? []);
  return {
    async getInventoryItem(sku) {
      if (!items.has(sku)) return { state: 'proven_absent' as const };
      const child = [...input.bundles].reverse().flatMap((candidate) => candidate.children).find((candidate) => candidate.sku === sku)!;
      const groupIndex = input.groupBundleIndex ?? null;
      const grouped = groupIndex !== null && input.bundles[groupIndex]!.children.some((candidate) => candidate.sku === sku);
      return { state: 'present' as const, value: { groupKeys: grouped ? [newest.groupKey] : null, payload: child.inventoryItem as unknown as Json, sku } };
    },
    async getOffers(sku) {
      const offer = input.offers?.[sku];
      return { state: 'present' as const, value: offer ? [offer] : [] };
    },
    async getInventoryItemGroup() {
      const index = input.groupBundleIndex ?? null;
      if (index === null) return { state: 'proven_absent' as const };
      const selected = input.bundles[index]!;
      return { state: 'present' as const, value: { payload: selected.group as unknown as Json, variantSKUs: [...selected.group.variantSKUs].reverse() } };
    },
  };
}

function offerFor(candidate: ReturnType<typeof bundle>, sku: string, overrides: Partial<VariationListingRemoteOffer> = {}): VariationListingRemoteOffer {
  const child = candidate.children.find((entry) => entry.sku === sku)!;
  return { lifecycleClass: 'active', listingId: 'listing-1', marketplaceId: child.offer.marketplaceId, offerId: `offer-${sku}`, payload: child.offer as unknown as Json, sku, status: 'PUBLISHED', ...overrides };
}

const ownedRemote = (skus: string[], publicationHistoryExists = true) => ({
  listingId: publicationHistoryExists ? 'listing-1' : null,
  offerIdsBySku: Object.fromEntries(skus.map((sku) => [sku, `offer-${sku}`])),
  publicationHistoryExists,
});

describe('YP5.4 variation listing cleanup planning', () => {
  it('plans active withdrawal before reverse dependency cleanup and final absence', async () => {
    const current = bundle(['A', 'B']);
    const remote = remoteState({
      bundles: [current],
      groupBundleIndex: 0,
      items: ['SKU-A', 'SKU-B'],
      offers: { 'SKU-A': offerFor(current, 'SKU-A'), 'SKU-B': offerFor(current, 'SKU-B') },
    });
    const plan = await prepareVariationListingCleanupPlan({ ownedBundles: [current], ownedRemote: ownedRemote(['SKU-A', 'SKU-B']), protection: { state: 'clear' }, remote });
    expect(plan.snapshot.observed).toMatchObject({ state: 'active', activeListingId: 'listing-1', groupPresent: true });
    expect(plan.snapshot.terminalLifecycle).toBe('terminal-absent');
    expect(plan.operationPlan.map((entry) => entry.operationKind)).toEqual([
      'withdrawal', 'cleanup_offer', 'cleanup_offer', 'cleanup_group', 'cleanup_child_inventory_item', 'cleanup_child_inventory_item', 'final_absence_verification',
    ]);
    expect(plan.operationPlan.map((entry) => entry.operationKey)).toEqual([
      'withdraw-group', 'cleanup-offer:SKU-B', 'cleanup-offer:SKU-A', 'cleanup-group', 'cleanup-item:SKU-B', 'cleanup-item:SKU-A', 'final-absence',
    ]);
    expect(plan.operationPlan.some((entry) => entry.operationKind === 'media_ingest')).toBe(false);
  });

  it('plans exact unpublished partial staging cleanup without withdrawal and ends abandoned', async () => {
    const current = bundle(['A', 'B']);
    const remote = remoteState({
      bundles: [current],
      groupBundleIndex: null,
      items: ['SKU-A'],
      offers: { 'SKU-A': offerFor(current, 'SKU-A', { lifecycleClass: null, listingId: null, status: 'UNPUBLISHED' }) },
    });
    const plan = await prepareVariationListingCleanupPlan({ ownedBundles: [current], ownedRemote: ownedRemote(['SKU-A', 'SKU-B'], false), protection: { state: 'clear' }, remote });
    expect(plan.snapshot.observed.state).toBe('inactive-or-unpublished');
    expect(plan.snapshot.terminalLifecycle).toBe('abandoned');
    expect(plan.operationPlan.map((entry) => entry.operationKey)).toEqual(['cleanup-offer:SKU-A', 'cleanup-item:SKU-A', 'final-absence']);
  });

  it('accepts exact unpublished staged additions outside the still-active confirmed group', async () => {
    const prior = bundle(['A', 'B']);
    const desired = bundle(['A', 'B', 'C']);
    const remote = remoteState({
      bundles: [prior, desired],
      groupBundleIndex: 0,
      items: ['SKU-A', 'SKU-B', 'SKU-C'],
      offers: {
        'SKU-A': offerFor(prior, 'SKU-A'),
        'SKU-B': offerFor(prior, 'SKU-B'),
        'SKU-C': offerFor(desired, 'SKU-C', { lifecycleClass: null, listingId: null, status: 'UNPUBLISHED' }),
      },
    });
    const plan = await prepareVariationListingCleanupPlan({ ownedBundles: [prior, desired], ownedRemote: ownedRemote(['SKU-A', 'SKU-B', 'SKU-C']), protection: { state: 'clear' }, remote });
    expect(plan.snapshot.observed.state).toBe('active');
    expect(plan.operationPlan[0]?.operationKind).toBe('withdrawal');
    expect(plan.operationPlan.some((entry) => entry.operationKey === 'cleanup-offer:SKU-C')).toBe(true);
    expect(plan.operationPlan.some((entry) => entry.operationKey === 'cleanup-item:SKU-C')).toBe(true);
  });

  it('treats exact total absence as abandonment evidence when publication never occurred', async () => {
    const current = bundle(['A', 'B']);
    const plan = await prepareVariationListingCleanupPlan({
      ownedBundles: [current],
      ownedRemote: ownedRemote(['SKU-A', 'SKU-B'], false),
      protection: { state: 'clear' },
      remote: remoteState({ bundles: [current], groupBundleIndex: null }),
    });
    expect(plan.snapshot.observed.state).toBe('absent');
    expect(plan.snapshot.terminalLifecycle).toBe('abandoned');
    expect(plan.operationPlan.map((entry) => entry.operationKind)).toEqual(['final_absence_verification']);
  });

  it('fails closed on foreign offer identity, split lifecycle, and sale/order protection', async () => {
    const current = bundle(['A', 'B']);
    const exactRemote = remoteState({
      bundles: [current], groupBundleIndex: 0, items: ['SKU-A', 'SKU-B'],
      offers: { 'SKU-A': offerFor(current, 'SKU-A'), 'SKU-B': offerFor(current, 'SKU-B') },
    });
    await expect(prepareVariationListingCleanupPlan({ ownedBundles: [current], ownedRemote: ownedRemote(['SKU-A', 'SKU-B']), protection: { state: 'protected', variationIds: ['variation-A'] }, remote: exactRemote })).rejects.toThrow('protected variation history');
    await expect(prepareVariationListingCleanupPlan({ ownedBundles: [current], ownedRemote: ownedRemote(['SKU-A', 'SKU-B']), protection: { state: 'unknown', reason: 'order reconciliation unavailable' }, remote: exactRemote })).rejects.toThrow('protection is unknown');

    const foreignRemote = remoteState({
      bundles: [current], groupBundleIndex: 0, items: ['SKU-A', 'SKU-B'],
      offers: { 'SKU-A': offerFor(current, 'SKU-A', { offerId: 'foreign-offer' }), 'SKU-B': offerFor(current, 'SKU-B') },
    });
    await expect(prepareVariationListingCleanupPlan({ ownedBundles: [current], ownedRemote: ownedRemote(['SKU-A', 'SKU-B']), protection: { state: 'clear' }, remote: foreignRemote })).rejects.toThrow('durable owned offer ID');

    const splitRemote = remoteState({
      bundles: [current], groupBundleIndex: 0, items: ['SKU-A', 'SKU-B'],
      offers: { 'SKU-A': offerFor(current, 'SKU-A'), 'SKU-B': offerFor(current, 'SKU-B', { lifecycleClass: 'ended' }) },
    });
    await expect(prepareVariationListingCleanupPlan({ ownedBundles: [current], ownedRemote: ownedRemote(['SKU-A', 'SKU-B']), protection: { state: 'clear' }, remote: splitRemote })).rejects.toThrow('incompatible active and inactive');
  });

  it('rejects remote group semantics that do not match any exact owned complete snapshot', async () => {
    const current = bundle(['A', 'B']);
    const tampered = structuredClone(current.group) as unknown as Record<string, Json>;
    tampered.title = 'foreign title';
    const remote: VariationListingPublicationReadGateway = {
      async getInventoryItem() { return { state: 'proven_absent' as const }; },
      async getOffers() { return { state: 'present' as const, value: [] }; },
      async getInventoryItemGroup() { return { state: 'present' as const, value: { payload: tampered as Json, variantSKUs: [...current.group.variantSKUs] } }; },
    };
    await expect(prepareVariationListingCleanupPlan({ ownedBundles: [current], ownedRemote: ownedRemote(['SKU-A', 'SKU-B']), protection: { state: 'clear' }, remote })).rejects.toThrow('does not match any exact owned complete-group state');
  });

  it('plans definitive ended publication without withdrawal while retaining terminal-absence ownership', async () => {
    const current = bundle(['A', 'B']);
    const remote = remoteState({
      bundles: [current],
      groupBundleIndex: 0,
      items: ['SKU-A', 'SKU-B'],
      offers: {
        'SKU-A': offerFor(current, 'SKU-A', { lifecycleClass: 'ended' }),
        'SKU-B': offerFor(current, 'SKU-B', { lifecycleClass: 'ended' }),
      },
    });
    const plan = await prepareVariationListingCleanupPlan({ ownedBundles: [current], ownedRemote: ownedRemote(['SKU-A', 'SKU-B']), protection: { state: 'clear' }, remote });
    expect(plan.snapshot.observed).toMatchObject({ state: 'inactive-or-unpublished', activeListingId: null });
    expect(plan.snapshot.terminalLifecycle).toBe('terminal-absent');
    expect(plan.operationPlan.some((entry) => entry.operationKind === 'withdrawal')).toBe(false);
  });

  it('journals already-absent ended cleanup mutations as started then confirmed no-op', async () => {
    const current = bundle(['A', 'B']);
    const plan = await prepareVariationListingCleanupPlan({
      ownedBundles: [current],
      ownedRemote: ownedRemote(['SKU-A', 'SKU-B']),
      protection: { state: 'clear' },
      remote: remoteState({
        bundles: [current], groupBundleIndex: 0, items: ['SKU-A', 'SKU-B'],
        offers: {
          'SKU-A': offerFor(current, 'SKU-A', { lifecycleClass: 'ended' }),
          'SKU-B': offerFor(current, 'SKU-B', { lifecycleClass: 'ended' }),
        },
      }),
    });
    const frozen = freezeVariationListingCleanupRevision({ capturedDesiredRevision: 1, expectedPreviousConfirmedRevision: 1, groupId: 'group-1', plan, revisionId: 'cleanup-revision-ended' });
    const checkpoints: VariationListingPublishingCheckpointRow[] = [];
    let durableRevision: VariationListingRevisionRow | null = null;
    let checkpointNo = 0;
    const calls: string[] = [];
    await expect(executeVariationListingCleanup({
      frozen,
      remote: remoteState({ bundles: [current], groupBundleIndex: null }),
      journal: { listCheckpoints: async () => [...checkpoints], loadRevision: async () => durableRevision },
      mutations: {
        withdrawInventoryItemGroup: async () => { calls.push('withdraw'); },
        deleteOffer: async () => { calls.push('offer'); },
        deleteInventoryItemGroup: async () => { calls.push('group'); },
        deleteInventoryItem: async () => { calls.push('item'); },
      },
      transaction: {
        loadAggregate: async () => aggregate(['A', 'B']),
        captureRevision: async (input) => {
          durableRevision = {
            captured_at: timestamp, captured_desired_revision: input.capturedDesiredRevision, group_id: input.groupId,
            operation_count: input.operationPlan.length,
            operation_plan: input.operationPlan.map((operation) => ({ intent: operation.intent, intent_digest: operation.intentDigest, intent_version: operation.intentVersion, operation_key: operation.operationKey, operation_kind: operation.operationKind, sequence_no: operation.sequenceNo, target_ref: operation.targetRef })),
            revision_id: input.revisionId, snapshot: input.snapshot, snapshot_digest: input.snapshotDigest, snapshot_version: input.snapshotVersion,
          } as unknown as VariationListingRevisionRow;
          return { revision: durableRevision };
        },
        appendJournalCheckpoint: async (input) => {
          const checkpoint = { checkpoint_id: `checkpoint-${++checkpointNo}`, revision_id: input.revisionId, operation_key: input.operationKey, attempt_number: input.attemptNumber, checkpoint_number: input.checkpointNumber, state: input.state, observed_remote_state: input.observedRemoteState ?? null, evidence: input.evidence, created_at: timestamp } as VariationListingPublishingCheckpointRow;
          checkpoints.push(checkpoint);
          return { checkpoint };
        },
        advanceCleanupLifecycle: async (input) => {
          calls.push(`lifecycle:${input.targetLifecycle}`);
          return { ...group(), lifecycle_state: input.targetLifecycle };
        },
      },
      checkpointId: () => `checkpoint-id-${checkpointNo + 1}`,
    })).resolves.toEqual({ lifecycleState: 'terminal-absent', revisionId: 'cleanup-revision-ended' });
    expect(calls).toEqual(['lifecycle:cleanup', 'lifecycle:terminal-absent']);
    for (const operation of frozen.captureInput.operationPlan.filter((entry) => entry.operationKind !== 'final_absence_verification')) {
      expect(checkpoints.filter((checkpoint) => checkpoint.operation_key === operation.operationKey).map((checkpoint) => ({ attempt: checkpoint.attempt_number, checkpoint: checkpoint.checkpoint_number, state: checkpoint.state }))).toEqual([
        { attempt: 1, checkpoint: 1, state: 'started' },
        { attempt: 1, checkpoint: 2, state: 'confirmed_no_op' },
      ]);
    }
  });

  it('abandons only a truly untouched revision-0 intake group after exact remote group absence', async () => {
    const untouched = aggregate([]);
    untouched.group.desired_revision = 0;
    untouched.group.last_confirmed_revision = null;
    untouched.group.lifecycle_state = 'intake';
    untouched.group.next_inventory_serial = 1;
    const calls: string[] = [];
    const result = await abandonUntouchedVariationListingGroup({
      groupId: untouched.group.group_id,
      protection: { state: 'clear' },
      remote: { async getInventoryItemGroup(groupKey) { calls.push(`read:${groupKey}`); return { state: 'proven_absent' as const }; } },
      transaction: {
        loadAggregate: async () => untouched,
        abandonUntouchedGroup: async (input) => { calls.push(`abandon:${input.expectedDesiredRevision}`); return { ...untouched.group, lifecycle_state: 'abandoned' }; },
      },
    });
    expect(result.lifecycle_state).toBe('abandoned');
    expect(calls).toEqual([`read:${untouched.group.group_key}`, 'abandon:0']);
  });

  it('fails untouched abandonment on remote presence or allocated local state', async () => {
    const untouched = aggregate([]);
    untouched.group.desired_revision = 0;
    untouched.group.last_confirmed_revision = null;
    untouched.group.lifecycle_state = 'intake';
    untouched.group.next_inventory_serial = 1;
    await expect(abandonUntouchedVariationListingGroup({
      groupId: untouched.group.group_id,
      protection: { state: 'clear' },
      remote: { async getInventoryItemGroup() { return { state: 'present' as const, value: { payload: {}, variantSKUs: [] } }; } },
      transaction: { loadAggregate: async () => untouched, abandonUntouchedGroup: async () => ({ ...untouched.group, lifecycle_state: 'abandoned' }) },
    })).rejects.toThrow('exact remote group absence');
    const allocated = structuredClone(untouched);
    allocated.group.next_inventory_serial = 2;
    await expect(abandonUntouchedVariationListingGroup({
      groupId: allocated.group.group_id,
      protection: { state: 'clear' },
      remote: { async getInventoryItemGroup() { return { state: 'proven_absent' as const }; } },
      transaction: { loadAggregate: async () => allocated, abandonUntouchedGroup: async () => ({ ...allocated.group, lifecycle_state: 'abandoned' }) },
    })).rejects.toThrow('empty revision-0 intake group');
  });

  it('rejects withdrawal resume when the durable operation plan differs from the frozen intent', async () => {
    const current = bundle(['A', 'B']);
    const remote = remoteState({
      bundles: [current],
      groupBundleIndex: 0,
      items: ['SKU-A', 'SKU-B'],
      offers: { 'SKU-A': offerFor(current, 'SKU-A'), 'SKU-B': offerFor(current, 'SKU-B') },
    });
    const plan = await prepareVariationListingCleanupPlan({
      ownedBundles: [current],
      ownedRemote: ownedRemote(['SKU-A', 'SKU-B']),
      protection: { state: 'clear' },
      remote,
    });
    const frozen = freezeVariationListingCleanupRevision({
      capturedDesiredRevision: 1,
      expectedPreviousConfirmedRevision: 1,
      groupId: 'group-1',
      plan,
      revisionId: 'withdrawal-revision-plan-mismatch',
    });
    const operationPlan = frozen.captureInput.operationPlan.map((operation) => ({
      intent: operation.intent,
      intent_digest: operation.intentDigest,
      intent_version: operation.intentVersion,
      operation_key: operation.operationKey,
      operation_kind: operation.operationKind,
      sequence_no: operation.sequenceNo,
      target_ref: operation.targetRef,
    }));
    operationPlan[0] = { ...operationPlan[0]!, target_ref: 'FOREIGN-GROUP' };
    const durableRevision = {
      captured_at: timestamp,
      captured_desired_revision: frozen.captureInput.capturedDesiredRevision,
      group_id: frozen.captureInput.groupId,
      operation_count: operationPlan.length,
      operation_plan: operationPlan,
      revision_id: frozen.captureInput.revisionId,
      snapshot: frozen.captureInput.snapshot,
      snapshot_digest: frozen.captureInput.snapshotDigest,
      snapshot_version: frozen.captureInput.snapshotVersion,
    } as unknown as VariationListingRevisionRow;

    await expect(executeVariationListingWithdrawal({
      frozen,
      remote,
      journal: {
        listCheckpoints: async () => [],
        loadRevision: async () => durableRevision,
      },
      mutations: {
        withdrawInventoryItemGroup: async () => {},
        deleteOffer: async () => {},
        deleteInventoryItemGroup: async () => {},
        deleteInventoryItem: async () => {},
      },
      transaction: {
        loadAggregate: async () => aggregate(['A', 'B']),
        captureRevision: async () => ({ revision: durableRevision }),
        appendJournalCheckpoint: async () => { throw new Error('checkpoint append must not run'); },
        advanceCleanupLifecycle: async () => { throw new Error('lifecycle advance must not run'); },
      },
    })).rejects.toThrow('withdrawal durable revision does not match the frozen intent');
  });

  it('journals active withdrawal then exact reverse cleanup and terminal absence without deleting Media', async () => {
    const current = bundle(['A', 'B']);
    let groupPresent = true;
    const items = new Set(['SKU-A', 'SKU-B']);
    const offers = new Map<string, VariationListingRemoteOffer>([
      ['SKU-A', offerFor(current, 'SKU-A')],
      ['SKU-B', offerFor(current, 'SKU-B')],
    ]);
    const remote: VariationListingPublicationReadGateway = {
      async getInventoryItem(sku) {
        if (!items.has(sku)) return { state: 'proven_absent' as const };
        const child = current.children.find((entry) => entry.sku === sku)!;
        return { state: 'present' as const, value: { groupKeys: groupPresent ? [current.groupKey] : null, payload: child.inventoryItem as unknown as Json, sku } };
      },
      async getOffers(sku) {
        const offer = offers.get(sku);
        return { state: 'present' as const, value: offer ? [offer] : [] };
      },
      async getInventoryItemGroup() {
        return groupPresent
          ? { state: 'present' as const, value: { payload: current.group as unknown as Json, variantSKUs: [...current.group.variantSKUs] } }
          : { state: 'proven_absent' as const };
      },
    };
    const plan = await prepareVariationListingCleanupPlan({ ownedBundles: [current], ownedRemote: ownedRemote(['SKU-A', 'SKU-B']), protection: { state: 'clear' }, remote });
    const frozen = freezeVariationListingCleanupRevision({ capturedDesiredRevision: 1, expectedPreviousConfirmedRevision: 1, groupId: 'group-1', plan, revisionId: 'cleanup-revision-1' });
    const checkpoints: VariationListingPublishingCheckpointRow[] = [];
    let durableRevision: VariationListingRevisionRow | null = null;
    const calls: string[] = [];
    let checkpointNo = 0;
    await expect(executeVariationListingCleanup({
      frozen,
      remote,
      journal: {
        listCheckpoints: async () => [...checkpoints],
        loadRevision: async () => durableRevision,
      },
      mutations: {
        withdrawInventoryItemGroup: async () => { calls.push('withdraw'); for (const [sku, offer] of offers) offers.set(sku, { ...offer, lifecycleClass: 'ended' }); },
        deleteOffer: async (offerId) => { calls.push(`offer:${offerId}`); for (const [sku, offer] of offers) if (offer.offerId === offerId) offers.delete(sku); },
        deleteInventoryItemGroup: async () => { calls.push('group'); groupPresent = false; },
        deleteInventoryItem: async (sku) => { calls.push(`item:${sku}`); items.delete(sku); },
      },
      transaction: {
        loadAggregate: async () => aggregate(['A', 'B']),
        captureRevision: async (input) => {
          durableRevision = {
            captured_at: timestamp,
            captured_desired_revision: input.capturedDesiredRevision,
            group_id: input.groupId,
            operation_count: input.operationPlan.length,
            operation_plan: input.operationPlan.map((operation) => ({ intent: operation.intent, intent_digest: operation.intentDigest, intent_version: operation.intentVersion, operation_key: operation.operationKey, operation_kind: operation.operationKind, sequence_no: operation.sequenceNo, target_ref: operation.targetRef })),
            revision_id: input.revisionId,
            snapshot: input.snapshot,
            snapshot_digest: input.snapshotDigest,
            snapshot_version: input.snapshotVersion,
          } as unknown as VariationListingRevisionRow;
          return { revision: durableRevision };
        },
        appendJournalCheckpoint: async (input) => {
          const checkpoint = { checkpoint_id: `checkpoint-${++checkpointNo}`, revision_id: input.revisionId, operation_key: input.operationKey, attempt_number: input.attemptNumber, checkpoint_number: input.checkpointNumber, state: input.state, observed_remote_state: input.observedRemoteState ?? null, evidence: input.evidence, created_at: timestamp } as VariationListingPublishingCheckpointRow;
          checkpoints.push(checkpoint);
          return { checkpoint };
        },
        advanceCleanupLifecycle: async (input) => {
          calls.push(`lifecycle:${input.targetLifecycle}`);
          return { ...aggregate(['A', 'B']).group, lifecycle_state: input.targetLifecycle };
        },
      },
      checkpointId: () => `checkpoint-id-${checkpointNo + 1}`,
    })).resolves.toEqual({ lifecycleState: 'terminal-absent', revisionId: 'cleanup-revision-1' });
    expect(calls).toEqual([
      'withdraw', 'lifecycle:withdrawn', 'lifecycle:cleanup',
      'offer:offer-SKU-B', 'offer:offer-SKU-A', 'group', 'item:SKU-B', 'item:SKU-A',
      'lifecycle:terminal-absent',
    ]);
    expect(checkpoints.at(-1)).toMatchObject({ operation_key: 'final-absence', state: 'confirmed_complete', observed_remote_state: 'proven_absent' });
  });
});
