import type {
  Json,
  VariationListingAggregateSnapshot,
  VariationListingGroupRow,
  VariationListingPublishingCheckpointRow,
  VariationListingRevisionRow,
  VariationListingVariationRow,
  VariationListingCopyRow,
} from '@ebay-inventory/data';
import { describe, expect, it } from 'vitest';

import { buildVariationListingInventoryPayloadBundle } from '@/ebay/variation-listing-payloads.js';
import {
  buildVariationListingFrozenPublicationRevision,
  executeVariationListingPublication,
  reconcileVariationListingExactPublished,
  type VariationListingRemoteInventoryItem,
  type VariationListingRemoteMedia,
  type VariationListingRemoteOffer,
  type VariationListingRemoteGroup,
} from '@/ebay/variation-listing-publication.js';

const image = (key: string) => `https://i.ebayimg.com/images/g/${key}/s-l1600.jpg`;

function aggregate(): VariationListingAggregateSnapshot {
  const group: VariationListingGroupRow = {
    category_id: '261328', condition_description: null, condition_descriptors: [], condition_id: '4000', condition_token: 'VERY_GOOD', created_at: '2026-09-01T00:00:00Z', derived_common_ebay_aspects: { Sport: ['Baseball'] }, description: 'Two cards.', desired_revision: 1, fulfillment_policy_id: 'fulfillment', group_id: 'group-1', group_key: 'GROUP-1', last_confirmed_revision: null, lifecycle_state: 'publish-ready', listing_format: 'FIXED_PRICE', marketplace_id: 'EBAY_US', merchant_location_key: 'warehouse', next_inventory_serial: 3, payment_policy_id: 'payment', return_policy_id: 'return', selector_name: 'Card', sku_bucket_token: 'bucket', sku_category_code: 'sports', title: 'Two cards', updated_at: '2026-09-01T00:00:00Z',
  };
  const variation = (id: string, position: number, price: number): VariationListingVariationRow => ({ created_at: group.created_at, group_id: group.group_id, inventory_serial: position + 1, position, price_amount: price as 0.99 | 2.49, price_currency: 'USD', representative_copy_id: `copy-${id}`, selector_value: `Card ${id}`, sku: `SKU-${id}`, updated_at: group.updated_at, variation_id: `variation-${id}`, variation_metadata: {} });
  const copy = (id: string): VariationListingCopyRow => ({ availability_state: 'available', back_r2_key: `r2/${id}/back`, capture_back_source_ref: `source/${id}/back`, capture_front_source_ref: `source/${id}/front`, capture_pair_id: `pair-${id}`, capture_source_key: `capture-${id}`, capture_started_at: group.created_at, captured_at: group.created_at, condition_notes: null, condition_token: 'VERY_GOOD', copy_id: `copy-${id}`, created_at: group.created_at, front_r2_key: `r2/${id}/front`, updated_at: group.updated_at, variation_id: `variation-${id}` });
  return { group, variations: [variation('B', 1, 2.49), variation('A', 0, 0.99)], copies: [copy('A'), copy('B')] };
}

function frozen(withMedia = false) {
  const media = withMedia
    ? [
        { copyId: 'copy-A', role: 'front' as const, sourceUrl: 'https://source.test/A/front' },
        { copyId: 'copy-A', role: 'back' as const, sourceUrl: 'https://source.test/A/back' },
        { copyId: 'copy-B', role: 'front' as const, sourceUrl: 'https://source.test/B/front' },
        { copyId: 'copy-B', role: 'back' as const, sourceUrl: 'https://source.test/B/back' },
      ]
    : undefined;
  return buildVariationListingFrozenPublicationRevision({
    aggregate: aggregate(),
    mediaResources: media,
    ...(withMedia
      ? {}
      : {
          representativeImages: [
            { copyId: 'copy-A', frontEpsUrl: image('AF'), backEpsUrl: image('AB') },
            { copyId: 'copy-B', frontEpsUrl: image('BF'), backEpsUrl: image('BB') },
          ],
        }),
    revisionId: 'revision-1',
  });
}

function testHarness(withMedia = false) {
  const plan = frozen(withMedia);
  const expectedImages = [
    { copyId: 'copy-A', frontEpsUrl: image('AF'), backEpsUrl: image('AB') },
    { copyId: 'copy-B', frontEpsUrl: image('BF'), backEpsUrl: image('BB') },
  ];
  const bundle = buildVariationListingInventoryPayloadBundle({
    aggregate: plan.snapshot.aggregate,
    representativeImages: expectedImages,
  });
  const items = new Map<string, VariationListingRemoteInventoryItem>();
  const offers = new Map<string, VariationListingRemoteOffer[]>();
  const media = new Map<string, VariationListingRemoteMedia>();
  const journalRows: VariationListingPublishingCheckpointRow[] = [];
  let group: VariationListingRemoteGroup | null = null;
  let mutations = 0;
  let confirmations = 0;
  let lastConfirmedRevision: number | null = null;
  let failItem = false;
  const remote = {
    async getInventoryItem(sku: string) { return items.has(sku) ? { state: 'present' as const, value: items.get(sku)! } : { state: 'proven_absent' as const }; },
    async getOffers(sku: string, _marketplace: string) { return { state: 'present' as const, value: offers.get(sku) ?? [] }; },
    async getInventoryItemGroup(_groupKey: string) { return group ? { state: 'present' as const, value: group } : { state: 'proven_absent' as const }; },
    async getMedia(location: string) { return media.has(location) ? { state: 'present' as const, value: media.get(location)! } : { state: 'proven_absent' as const }; },
  };
  const mutationsApi = {
    async createMedia(sourceUrl: string) {
      mutations += 1;
      const resource = plan.snapshot.mediaResources.find((candidate) => candidate.sourceUrl === sourceUrl)!;
      const expected = expectedImages.find((candidate) => candidate.copyId === resource.copyId)!;
      const value = { expirationDate: '2026-10-01T00:00:00Z', imageId: `image-${resource.copyId}-${resource.role}`, imageUrl: resource.role === 'front' ? expected.frontEpsUrl : expected.backEpsUrl, location: `https://api.ebay.test/media/${resource.copyId}-${resource.role}` };
      media.set(value.location, value);
      return value;
    },
    async createOrReplaceInventoryItem(sku: string, payload: Json) {
      mutations += 1;
      if (failItem) throw new Error('transport lost');
      items.set(sku, { sku, groupKeys: null, payload });
    },
    async createOffer(payload: Json) {
      mutations += 1;
      const body = payload as { sku: string; marketplaceId: string };
      offers.set(body.sku, [{ offerId: `offer-${body.sku}`, lifecycleClass: null, listingId: null, marketplaceId: body.marketplaceId, payload, sku: body.sku, status: 'UNPUBLISHED' }]);
      return { offerId: `offer-${body.sku}` };
    },
    async createOrReplaceInventoryItemGroup(_groupKey: string, payload: Json) {
      mutations += 1;
      const reversedSkus = [...bundle.children].reverse().map((child) => child.sku);
      group = {
        payload: { ...(payload as Record<string, Json>), variantSKUs: reversedSkus } as Json,
        variantSKUs: reversedSkus,
      };
      for (const child of bundle.children) items.get(child.sku)!.groupKeys = [bundle.groupKey];
    },
    async publishInventoryItemGroup(_payload: Json) {
      mutations += 1;
      for (const child of bundle.children) {
        const offer = offers.get(child.sku)![0]!;
        offer.status = 'PUBLISHED';
        offer.listingId = 'listing-1';
        offer.lifecycleClass = 'active';
      }
      return { listingId: 'listing-1' };
    },
  };
  const transaction = {
    async captureRevision(input: typeof plan.captureInput) {
      return { revision: { revision_id: input.revisionId, snapshot_digest: input.snapshotDigest, operation_plan: input.operationPlan.map((operation) => ({ intent: operation.intent, intent_digest: operation.intentDigest, intent_version: operation.intentVersion, operation_key: operation.operationKey, operation_kind: operation.operationKind, sequence_no: operation.sequenceNo, target_ref: operation.targetRef })) } as VariationListingRevisionRow };
    },
    async loadAggregate(_groupId: string) {
      return { ...plan.snapshot.aggregate, group: { ...plan.snapshot.aggregate.group, last_confirmed_revision: lastConfirmedRevision } };
    },
    async appendJournalCheckpoint(input: { attemptNumber: number; checkpointId: string; checkpointNumber: number; evidence: Json; observedRemoteState?: 'present' | 'proven_absent' | 'unknown' | null; operationKey: string; revisionId: string; state: 'started' | 'unknown' | 'confirmed_complete' | 'confirmed_no_op' }) {
      const checkpoint = { attempt_number: input.attemptNumber, checkpoint_id: input.checkpointId, checkpoint_number: input.checkpointNumber, created_at: '2026-09-01T00:00:00Z', evidence: input.evidence, observed_remote_state: input.observedRemoteState ?? null, operation_key: input.operationKey, revision_id: input.revisionId, state: input.state } as VariationListingPublishingCheckpointRow;
      journalRows.push(checkpoint);
      return { checkpoint };
    },
    async confirmRevision(_input: { confirmedRevision: number }) {
      confirmations += 1;
      lastConfirmedRevision = 1;
      return { ...plan.snapshot.aggregate.group, last_confirmed_revision: 1 } as VariationListingGroupRow;
    },
  };
  return {
    group: () => group, items, journalRows, media, mutations: () => mutations, confirmations: () => confirmations,
    bundle, plan, remote, setFailItem: (value: boolean) => { failItem = value; }, mutationsApi, transaction,
    execute: () => executeVariationListingPublication({ frozen: plan, journal: { listCheckpoints: async () => [...journalRows] }, mutations: mutationsApi, remote, transaction, checkpointId: (() => { let n = 0; return () => `checkpoint-${++n}`; })() }),
  };
}

describe('executeVariationListingPublication', () => {
  it('creates Media, ordered child resources, group, publishes, and confirms only after exact reconciliation', async () => {
    const h = testHarness(true);
    await expect(h.execute()).resolves.toEqual({ revisionId: 'revision-1', confirmedRevision: 1, listingId: 'listing-1' });
    expect(h.mutations()).toBe(10);
    expect(h.confirmations()).toBe(1);
    expect(h.journalRows.every((row) => row.state === 'started' || Object.keys(row.evidence).length > 0)).toBe(true);
    expect(h.journalRows.filter((row) => row.operation_key === 'group-publish').map((row) => row.state)).toEqual(['started', 'confirmed_complete']);
  });

  it('resumes an already exact publication without remote mutations', async () => {
    const h = testHarness();
    await h.execute();
    const calls = h.mutations();
    await h.execute();
    expect(h.mutations()).toBe(calls);
  });

  it('reconciles a crash after started from exact after-state without replaying the item write', async () => {
    const h = testHarness();
    const child = h.bundle.children[0]!;
    h.journalRows.push({ attempt_number: 1, checkpoint_id: 'old', checkpoint_number: 1, created_at: '2026-09-01T00:00:00Z', evidence: {}, observed_remote_state: null, operation_key: `child-item:${child.variationId}`, revision_id: 'revision-1', state: 'started' } as VariationListingPublishingCheckpointRow);
    await h.mutationsApi.createOrReplaceInventoryItem(child.sku, child.inventoryItem);
    const calls = h.mutations();
    await h.execute();
    expect(h.mutations()).toBe(calls + 5);
    expect(h.journalRows.filter((row) => row.operation_key === `child-item:${child.variationId}`).at(-1)?.state).toBe('confirmed_complete');
  });

  it('halts an unknown item outcome at proven absence instead of blindly replaying it', async () => {
    const h = testHarness();
    h.setFailItem(true);
    await expect(h.execute()).rejects.toThrow('transport lost');
    const calls = h.mutations();
    h.setFailItem(false);
    await expect(h.execute()).rejects.toThrow('new revision is required');
    expect(h.mutations()).toBe(calls);
  });

  it('rejects foreign, duplicate, and split-listing remote states while group membership remains set-based', async () => {
    const h = testHarness();
    await h.execute();
    const current = h.group()!;
    expect(current.variantSKUs).toEqual(['SKU-B', 'SKU-A']);
    await expect(reconcileVariationListingExactPublished(h.remote, h.plan)).resolves.toMatchObject({ listingId: 'listing-1' });

    const first = h.bundle.children[0]!;
    h.items.get(first.sku)!.groupKeys = ['FOREIGN'];
    await expect(reconcileVariationListingExactPublished(h.remote, h.plan)).rejects.toThrow('group association mismatch');
    h.items.get(first.sku)!.groupKeys = [h.bundle.groupKey];
    const offerRead = await h.remote.getOffers(first.sku, first.offer.marketplaceId);
    offerRead.value[0]!.listingId = 'other-listing';
    await expect(reconcileVariationListingExactPublished(h.remote, h.plan)).rejects.toThrow('one listing ID');
    offerRead.value.push({ ...offerRead.value[0]!, offerId: 'foreign-offer' });
    await expect(reconcileVariationListingExactPublished(h.remote, h.plan)).rejects.toThrow('exactly one offer');
  });

  it('rejects terminal Media resume when exact journaled EPS evidence changes', async () => {
    const h = testHarness(true);
    await h.execute();
    const calls = h.mutations();
    const terminal = h.journalRows.find(
      (row) => row.operation_key === 'media:copy-A:front' && row.state === 'confirmed_complete'
    )!;
    const location = (terminal.evidence as Record<string, Json>).location as string;
    h.media.get(location)!.imageUrl = image('CHANGED');

    await expect(h.execute()).rejects.toThrow('terminal identity no longer reconciles exactly');
    expect(h.mutations()).toBe(calls);
  });

  it('never replays a Media create that started without a captured identity', async () => {
    const h = testHarness(true);
    h.journalRows.push({ attempt_number: 1, checkpoint_id: 'old-media', checkpoint_number: 1, created_at: '2026-09-01T00:00:00Z', evidence: {}, observed_remote_state: null, operation_key: 'media:copy-A:front', revision_id: 'revision-1', state: 'started' } as VariationListingPublishingCheckpointRow);
    await expect(h.execute()).rejects.toThrow('replay is forbidden');
    expect(h.mutations()).toBe(0);
  });
});
