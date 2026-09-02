import { describe, expect, it, vi } from 'vitest';
import type { VariationListingAggregateSnapshot, VariationListingPublishingCheckpointRow, VariationListingRevisionRow } from '@ebay-inventory/data';

import { createVariationListingActionService, VariationListingActionError } from '@/ebay/variation-listing-actions.js';
import { subscribeVariationListingActionEvents } from '@/ebay/variation-listing-action-events.js';
import { buildVariationListingInventoryPayloadBundle } from '@/ebay/variation-listing-payloads.js';
import { VariationListingTransactionConflictError } from '@ebay-inventory/data';

const groupId = '11111111-1111-4111-8111-111111111111';
const variationId = '22222222-2222-4222-8222-222222222222';
const copyId = '33333333-3333-4333-8333-333333333333';
const revisionId = '44444444-4444-4444-8444-444444444444';
const variationBId = '66666666-6666-4666-8666-666666666666';
const copyBId = '77777777-7777-4777-8777-777777777777';
const withdrawalRevisionId = '88888888-8888-4888-8888-888888888888';

function aggregate(overrides: Partial<VariationListingAggregateSnapshot['group']> = {}): VariationListingAggregateSnapshot {
  return {
    group: {
      group_id: groupId,
      group_key: 'VL-G-11111111111141118111111111111111',
      sku_category_code: 'BSKBL',
      sku_bucket_token: 'McGrady',
      category_id: '261328',
      marketplace_id: 'EBAY_US',
      merchant_location_key: 'main',
      fulfillment_policy_id: 'fulfill',
      payment_policy_id: 'pay',
      return_policy_id: 'returns',
      condition_id: '4000',
      condition_token: 'VERY_GOOD',
      condition_description: null,
      condition_descriptors: [],
      derived_common_ebay_aspects: { Sport: ['Basketball'] },
      description: 'Description',
      desired_revision: 3,
      last_confirmed_revision: null,
      lifecycle_state: 'publish-ready',
      listing_format: 'FIXED_PRICE',
      selector_name: 'Card',
      next_inventory_serial: 2,
      title: 'Cards',
      created_at: '2026-09-02T00:00:00Z',
      updated_at: '2026-09-02T00:00:00Z',
      ...overrides,
    },
    variations: [{
      variation_id: variationId,
      group_id: groupId,
      inventory_serial: 1,
      position: 0,
      sku: 'BSKBL-McGrady-000001',
      selector_value: 'Card A',
      price_amount: 1.49,
      price_currency: 'USD',
      representative_copy_id: copyId,
      variation_metadata: {},
      created_at: '2026-09-02T00:00:00Z',
      updated_at: '2026-09-02T00:00:00Z',
    }],
    copies: [{
      copy_id: copyId,
      variation_id: variationId,
      availability_state: 'available',
      condition_token: 'VERY_GOOD',
      condition_notes: null,
      front_r2_key: 'variation/front.jpg',
      back_r2_key: 'variation/back.jpg',
      capture_source_key: 'camera',
      capture_pair_id: 'pair',
      capture_front_source_ref: 'front',
      capture_back_source_ref: 'back',
      capture_started_at: '2026-09-02T00:00:00Z',
      captured_at: '2026-09-02T00:00:01Z',
      created_at: '2026-09-02T00:00:01Z',
      updated_at: '2026-09-02T00:00:01Z',
    }],
  };
}

function revision(snapshotVersion = 1): VariationListingRevisionRow {
  return {
    revision_id: revisionId,
    group_id: groupId,
    captured_desired_revision: 3,
    snapshot_version: snapshotVersion,
    snapshot_digest: 'a'.repeat(64),
    snapshot: { aggregate: aggregate() },
    operation_plan: [{
      sequence_no: 1,
      operation_key: 'child-item:one',
      operation_kind: 'child_inventory_item_write',
      target_ref: 'sku',
      intent_version: 1,
      intent_digest: 'b'.repeat(64),
      intent: {},
    }],
    operation_count: 1,
    captured_at: '2026-09-02T00:00:00Z',
  };
}

function checkpoint(state: VariationListingPublishingCheckpointRow['state'], observed: VariationListingPublishingCheckpointRow['observed_remote_state']): VariationListingPublishingCheckpointRow {
  return {
    checkpoint_id: '55555555-5555-4555-8555-555555555555',
    revision_id: revisionId,
    operation_key: 'child-item:one',
    attempt_number: 1,
    checkpoint_number: state === 'started' ? 1 : 2,
    state,
    observed_remote_state: observed,
    evidence: state === 'started' ? {} : { reason: 'test' },
    created_at: '2026-09-02T00:00:00Z',
  };
}

function data(input: { aggregate?: VariationListingAggregateSnapshot; revisions?: VariationListingRevisionRow[]; checkpoints?: VariationListingPublishingCheckpointRow[] } = {}) {
  const updateCopyAvailability = vi.fn().mockResolvedValue({});
  return {
    value: {
      loadAggregate: vi.fn().mockResolvedValue(input.aggregate ?? aggregate()),
      listRevisionsByGroupId: vi.fn().mockResolvedValue((input.revisions ?? []).map((source) => ({ source }))),
      listCheckpointsByRevisionId: vi.fn().mockResolvedValue((input.checkpoints ?? []).map((source) => ({ source }))),
      markPublishReady: vi.fn().mockResolvedValue({}),
      reserveActionRevision: vi.fn().mockResolvedValue({ ...aggregate().group, desired_revision: 4 }),
      updateCopyAvailability,
      captureRevision: vi.fn(),
      appendJournalCheckpoint: vi.fn(),
      confirmRevision: vi.fn(),
      advanceCleanupLifecycle: vi.fn(),
      abandonUntouchedGroup: vi.fn(),
    },
    updateCopyAvailability,
  };
}

function activeWithdrawalHarness(options: { pending?: boolean; unresolved?: boolean; failWithdrawalOnce?: boolean; unpublished?: boolean } = {}) {
  const current = aggregate({ lifecycle_state: options.unpublished ? 'publish-ready' : 'active', desired_revision: options.unpublished ? 3 : options.pending ? 4 : 3, last_confirmed_revision: options.unpublished ? null : 3, next_inventory_serial: 3 });
  const secondVariation = { ...current.variations[0]!, variation_id: variationBId, selector_value: 'Card B', sku: 'BSKBL-McGrady-000002', representative_copy_id: copyBId, inventory_serial: 2, position: 1 };
  const secondCopy = { ...current.copies[0]!, copy_id: copyBId, variation_id: variationBId, front_r2_key: 'variation/front-b.jpg', back_r2_key: 'variation/back-b.jpg' };
  current.variations = [current.variations[0]!, secondVariation];
  current.copies = [current.copies[0]!, secondCopy];
  const representativeImages = [
    { copyId, frontEpsUrl: 'https://i.ebayimg.com/images/g/front-a/s-l1600.jpg', backEpsUrl: 'https://i.ebayimg.com/images/g/back-a/s-l1600.jpg' },
    { copyId: copyBId, frontEpsUrl: 'https://i.ebayimg.com/images/g/front-b/s-l1600.jpg', backEpsUrl: 'https://i.ebayimg.com/images/g/back-b/s-l1600.jpg' },
  ];
  const bundle = buildVariationListingInventoryPayloadBundle({ aggregate: current, representativeImages });
  const confirmedRevision: VariationListingRevisionRow = {
    revision_id: revisionId, group_id: groupId, captured_desired_revision: 3, snapshot_version: 1, snapshot_digest: 'a'.repeat(64),
    snapshot: { aggregate: current, representativeImages }, operation_plan: [{ sequence_no: 1, operation_key: 'group-publish', operation_kind: 'group_publish', target_ref: current.group.group_key, intent_version: 1, intent_digest: 'b'.repeat(64), intent: {} }], operation_count: 1, captured_at: '2026-09-02T00:00:00Z',
  };
  const offerBySku = new Map(bundle.children.map((child) => [child.sku, { offerId: `offer-${child.sku}`, lifecycleClass: 'active' as const, listingId: 'listing-1', marketplaceId: child.offer.marketplaceId, payload: child.offer, sku: child.sku, status: 'PUBLISHED' as const }]));
  let groupPresent = !options.unpublished;
  let failWithdrawal = options.failWithdrawalOnce ?? false;
  let aggregateState = current;
  let captured: VariationListingRevisionRow | null = null;
  const journal: VariationListingPublishingCheckpointRow[] = options.unresolved ? [{ checkpoint_id: 'old', revision_id: revisionId, operation_key: 'group-publish', attempt_number: 1, checkpoint_number: 1, state: 'unknown', observed_remote_state: 'unknown', evidence: { reason: 'ambiguous' }, created_at: '2026-09-02T00:00:00Z' }] : [];
  const access = data({ aggregate: aggregateState, revisions: [confirmedRevision], checkpoints: journal });
  access.value.loadAggregate.mockImplementation(async () => ({ ...aggregateState, group: { ...aggregateState.group } }));
  access.value.listRevisionsByGroupId.mockImplementation(async () => [{ source: captured ?? confirmedRevision }]);
  access.value.listCheckpointsByRevisionId.mockImplementation(async (id) => journal.filter((entry) => entry.revision_id === id).map((source) => ({ source })));
  access.value.reserveActionRevision.mockImplementation(async ({ expectedDesiredRevision }) => {
    if (aggregateState.group.desired_revision !== expectedDesiredRevision) throw new VariationListingTransactionConflictError('VR001', 'reservation CAS mismatch');
    aggregateState = { ...aggregateState, group: { ...aggregateState.group, desired_revision: expectedDesiredRevision + 1 } };
    return aggregateState.group;
  });
  access.value.captureRevision.mockImplementation(async (input) => {
    captured = { revision_id: input.revisionId, group_id: input.groupId, captured_desired_revision: input.capturedDesiredRevision, snapshot_version: input.snapshotVersion, snapshot_digest: input.snapshotDigest, snapshot: input.snapshot, operation_plan: input.operationPlan.map((entry) => ({ sequence_no: entry.sequenceNo, operation_key: entry.operationKey, operation_kind: entry.operationKind, target_ref: entry.targetRef, intent_version: entry.intentVersion, intent_digest: entry.intentDigest, intent: entry.intent })), operation_count: input.operationPlan.length, captured_at: '2026-09-02T00:00:00Z' } as VariationListingRevisionRow;
    return { revision: captured };
  });
  access.value.appendJournalCheckpoint.mockImplementation(async (input) => {
    const source = { checkpoint_id: input.checkpointId, revision_id: input.revisionId, operation_key: input.operationKey, attempt_number: input.attemptNumber, checkpoint_number: input.checkpointNumber, state: input.state, observed_remote_state: input.observedRemoteState ?? null, evidence: input.evidence, created_at: '2026-09-02T00:00:00Z' } as VariationListingPublishingCheckpointRow;
    journal.push(source);
    return { checkpoint: source };
  });
  access.value.advanceCleanupLifecycle.mockImplementation(async ({ targetLifecycle }) => {
    aggregateState = { ...aggregateState, group: { ...aggregateState.group, lifecycle_state: targetLifecycle } };
    return aggregateState.group;
  });
  const remote = {
    getInventoryItemGroup: vi.fn(async () => groupPresent ? { state: 'present' as const, value: { payload: bundle.group, variantSKUs: [...bundle.group.variantSKUs].reverse() } } : { state: 'proven_absent' as const }),
    getInventoryItem: vi.fn(async (sku: string) => { const child = bundle.children.find((entry) => entry.sku === sku)!; return groupPresent ? { state: 'present' as const, value: { sku, groupKeys: [bundle.groupKey], payload: child.inventoryItem } } : { state: 'proven_absent' as const }; }),
    getOffers: vi.fn(async (sku: string) => { const offer = groupPresent ? offerBySku.get(sku) : undefined; return { state: 'present' as const, value: offer ? [offer] : [] }; }),
    getMedia: vi.fn(async () => ({ state: 'proven_absent' as const })),
  };
  const deletes: string[] = [];
  const remoteFactory = vi.fn(async () => ({ remote, mutations: {
    createMedia: vi.fn(), createOrReplaceInventoryItem: vi.fn(), createOffer: vi.fn(), createOrReplaceInventoryItemGroup: vi.fn(), publishInventoryItemGroup: vi.fn(), publishOffer: vi.fn(), updateOffer: vi.fn(),
    withdrawInventoryItemGroup: vi.fn(async () => { if (failWithdrawal) { failWithdrawal = false; throw new Error('withdraw transport lost'); } groupPresent = true; for (const offer of offerBySku.values()) offer.lifecycleClass = 'ended'; }),
    deleteInventoryItem: vi.fn(async (sku: string) => { deletes.push(`item:${sku}`); }), deleteInventoryItemGroup: vi.fn(async () => { deletes.push('group'); }), deleteOffer: vi.fn(async (id: string) => { deletes.push(`offer:${id}`); }),
  } }));
  return { access, remoteFactory, remote, journal, deletes, aggregate: () => aggregateState, captured: () => captured };
}

const failingRemote = (error: unknown) => async () => { throw error; };

describe('YP6.2 variation listing actions', () => {
  it('stages quantity only through physical-copy availability and emits action events', async () => {
    const access = data();
    const events: string[] = [];
    const unsubscribe = subscribeVariationListingActionEvents(groupId, (event) => events.push(event.kind));
    const service = createVariationListingActionService({ data: access.value, publicImageBaseUrl: 'https://images.example.test' });
    await expect(service.quantity(groupId, { variationId, copyId, expectedDesiredRevision: 3, availabilityState: 'unavailable' })).resolves.toMatchObject({ staged: true, sku: 'BSKBL-McGrady-000001' });
    unsubscribe();
    expect(access.updateCopyAvailability).toHaveBeenCalledWith({ groupId, variationId, copyId, expectedDesiredRevision: 3, availabilityState: 'unavailable' });
    expect(events).toEqual(['action_started', 'action_progress', 'action_succeeded']);
  });

  it('returns a stable lifecycle error before remote publication', async () => {
    const access = data({ aggregate: aggregate({ lifecycle_state: 'active', last_confirmed_revision: 2 }) });
    const remoteFactory = vi.fn();
    const service = createVariationListingActionService({ data: access.value, publicImageBaseUrl: 'https://images.example.test', remoteFactory });
    await expect(service.publish(groupId, 3)).rejects.toMatchObject({
      status: { code: 'initial_publish_already_completed', remoteState: 'known_unchanged', userActionRequired: true },
    });
    expect(remoteFactory).not.toHaveBeenCalled();
  });

  it('normalizes eBay validation issues into a UI-ready failure without stack leakage', async () => {
    const access = data();
    const ebayError = { response: { status: 400, data: { errors: [{ errorId: 25002, message: 'Invalid aspect', parameters: [{ name: 'Sport' }], domain: 'API_INVENTORY' }] } } };
    const service = createVariationListingActionService({ data: access.value, publicImageBaseUrl: 'https://images.example.test', remoteFactory: failingRemote(ebayError) });
    let caught: unknown;
    try { await service.publish(groupId, 3); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(VariationListingActionError);
    const status = (caught as VariationListingActionError).status;
    expect(status).toMatchObject({ code: 'ebay_validation_failed', category: 'remote', remoteState: 'known_unchanged' });
    expect(status.issues[0]).toMatchObject({ code: '25002', field: 'Sport', message: 'Invalid aspect' });
    expect(JSON.stringify(status)).not.toContain('stack');
  });

  it('distinguishes an unknown remote outcome and forbids blind retry messaging', async () => {
    const access = data({ revisions: [revision()], checkpoints: [checkpoint('unknown', 'unknown')] });
    const service = createVariationListingActionService({ data: access.value, publicImageBaseUrl: 'https://images.example.test', remoteFactory: failingRemote(new Error('network timeout')) });
    await expect(service.publish(groupId, 3)).rejects.toMatchObject({
      status: {
        code: 'variation_listing_remote_outcome_unknown',
        remoteState: 'unknown',
        requiresReconciliation: true,
        retryStatus: 'reconciliation_required',
        recommendedActions: expect.arrayContaining(['do_not_retry_blindly']),
      },
    });
  });

  it('reports bounded retry exhaustion as terminal', async () => {
    const access = data({ revisions: [revision()], checkpoints: [checkpoint('retry_exhausted', 'proven_absent')] });
    const service = createVariationListingActionService({ data: access.value, publicImageBaseUrl: 'https://images.example.test' });
    await expect(service.retry(groupId)).rejects.toMatchObject({ status: { code: 'retry_exhausted', category: 'terminal', retryStatus: 'retry_exhausted' } });
  });

  it('blocks destructive published cleanup until YP8 sale protection exists', async () => {
    const access = data({ aggregate: aggregate({ lifecycle_state: 'withdrawn', last_confirmed_revision: 2 }) });
    const remoteFactory = vi.fn();
    const service = createVariationListingActionService({ data: access.value, publicImageBaseUrl: 'https://images.example.test', remoteFactory });
    await expect(service.cleanup(groupId, 3)).rejects.toMatchObject({ status: { code: 'cleanup_sale_protection_pending', remoteState: 'known_unchanged' } });
    expect(remoteFactory).not.toHaveBeenCalled();
  });

  it('reserves one clean active withdrawal revision after exact ownership planning and stops at withdrawn', async () => {
    const harness = activeWithdrawalHarness();
    const service = createVariationListingActionService({ data: harness.access.value, publicImageBaseUrl: 'https://images.example.test', remoteFactory: harness.remoteFactory, createId: () => withdrawalRevisionId });
    await expect(service.withdraw(groupId, 3)).resolves.toMatchObject({ lifecycleState: 'withdrawn', revisionId: withdrawalRevisionId });
    expect(harness.access.value.reserveActionRevision).toHaveBeenCalledWith({ groupId, expectedDesiredRevision: 3 });
    expect(harness.access.value.captureRevision).toHaveBeenCalledWith(expect.objectContaining({ groupId, capturedDesiredRevision: 4, revisionId: withdrawalRevisionId }));
    expect(harness.access.value.advanceCleanupLifecycle).toHaveBeenCalledWith(expect.objectContaining({ targetLifecycle: 'withdrawn', expectedDesiredRevision: 4 }));
    expect(harness.deletes).toEqual([]);
    expect(harness.remoteFactory).toHaveBeenCalledTimes(1);
  });

  it('recovers an orphaned withdrawal reservation without reserving a second revision', async () => {
    const harness = activeWithdrawalHarness();
    const source = (await harness.access.value.listRevisionsByGroupId(groupId))[0]!.source;
    const sourceSnapshot = source.snapshot as { aggregate: VariationListingAggregateSnapshot };
    source.snapshot = { ...sourceSnapshot, aggregate: { ...sourceSnapshot.aggregate, group: { ...sourceSnapshot.aggregate.group, lifecycle_state: 'publish-ready' } } };
    harness.access.value.captureRevision.mockImplementationOnce(async () => { throw new Error('capture interrupted before insert'); });
    const service = createVariationListingActionService({ data: harness.access.value, publicImageBaseUrl: 'https://images.example.test', remoteFactory: harness.remoteFactory, createId: () => withdrawalRevisionId });
    await expect(service.withdraw(groupId, 3)).rejects.toMatchObject({ status: { remoteState: 'unknown', requiresReconciliation: true } });
    await expect(service.withdraw(groupId, 3)).resolves.toMatchObject({ lifecycleState: 'withdrawn', revisionId: withdrawalRevisionId });
    expect(harness.access.value.reserveActionRevision).toHaveBeenCalledTimes(1);
    expect(harness.access.value.captureRevision).toHaveBeenCalledTimes(2);
    expect(harness.deletes).toEqual([]);
  });

  it('blocks orphaned withdrawal recovery when a semantic group edit is present', async () => {
    const harness = activeWithdrawalHarness();
    harness.access.value.captureRevision.mockImplementationOnce(async () => { throw new Error('capture interrupted before insert'); });
    const service = createVariationListingActionService({ data: harness.access.value, publicImageBaseUrl: 'https://images.example.test', remoteFactory: harness.remoteFactory });
    await expect(service.withdraw(groupId, 3)).rejects.toMatchObject({ status: { remoteState: 'unknown', requiresReconciliation: true } });
    harness.aggregate().group.title = 'Edited after reservation';
    await expect(service.withdraw(groupId, 3)).rejects.toMatchObject({ status: { code: 'withdraw_pending_changes', remoteState: 'known_unchanged' } });
    expect(harness.access.value.reserveActionRevision).toHaveBeenCalledTimes(1);
    expect(harness.remoteFactory).toHaveBeenCalledTimes(1);
  });

  it('recovers an orphaned unpublished cleanup reservation without a second revision', async () => {
    const harness = activeWithdrawalHarness({ unpublished: true });
    harness.access.value.captureRevision.mockImplementationOnce(async () => { throw new Error('capture interrupted before insert'); });
    const service = createVariationListingActionService({ data: harness.access.value, publicImageBaseUrl: 'https://images.example.test', remoteFactory: harness.remoteFactory, createId: () => withdrawalRevisionId });
    await expect(service.cleanup(groupId, 3)).rejects.toMatchObject({ status: { remoteState: 'unknown', requiresReconciliation: true } });
    await expect(service.cleanup(groupId, 3)).resolves.toMatchObject({ lifecycleState: 'abandoned', revisionId: withdrawalRevisionId });
    expect(harness.access.value.reserveActionRevision).toHaveBeenCalledTimes(1);
    expect(harness.access.value.captureRevision).toHaveBeenCalledTimes(2);
    expect(harness.deletes).toEqual([]);
  });

  it('fails cleanly on pending active local changes before remote factory or revision reservation', async () => {
    const harness = activeWithdrawalHarness({ pending: true });
    const service = createVariationListingActionService({ data: harness.access.value, publicImageBaseUrl: 'https://images.example.test', remoteFactory: harness.remoteFactory });
    await expect(service.withdraw(groupId, 4)).rejects.toMatchObject({ status: { code: 'withdraw_pending_changes', remoteState: 'known_unchanged' } });
    expect(harness.remoteFactory).not.toHaveBeenCalled();
    expect(harness.access.value.reserveActionRevision).not.toHaveBeenCalled();
  });

  it('resumes an older unresolved withdrawal revision without reserving or capturing a second revision', async () => {
    const harness = activeWithdrawalHarness({ failWithdrawalOnce: true });
    const service = createVariationListingActionService({ data: harness.access.value, publicImageBaseUrl: 'https://images.example.test', remoteFactory: harness.remoteFactory, createId: () => withdrawalRevisionId });
    await expect(service.withdraw(groupId, 3)).rejects.toMatchObject({ status: { remoteState: 'unknown', requiresReconciliation: true } });
    await expect(service.retry(groupId)).resolves.toMatchObject({ lifecycleState: 'withdrawn', revisionId: withdrawalRevisionId });
    expect(harness.access.value.reserveActionRevision).toHaveBeenCalledTimes(1);
    expect(harness.access.value.captureRevision).toHaveBeenCalledTimes(1);
    expect(harness.deletes).toEqual([]);
  });

  it('blocks newer publish when an older revision has unresolved remote work', async () => {
    const access = data({ aggregate: aggregate({ desired_revision: 4, lifecycle_state: 'publish-ready' }), revisions: [revision()] });
    access.value.listCheckpointsByRevisionId.mockResolvedValue([{ source: { ...checkpoint('unknown', 'unknown'), operation_key: 'child-item:one' } }]);
    const remoteFactory = vi.fn();
    const service = createVariationListingActionService({ data: access.value, publicImageBaseUrl: 'https://images.example.test', remoteFactory });
    await expect(service.publish(groupId, 4)).rejects.toMatchObject({ status: { code: 'variation_listing_remote_outcome_unknown', requiresReconciliation: true } });
    expect(remoteFactory).not.toHaveBeenCalled();
  });

  it('fails closed instead of classifying an unsupported revision snapshot as initial publication', async () => {
    const access = data({ revisions: [revision(3)] });
    const remoteFactory = vi.fn();
    const service = createVariationListingActionService({ data: access.value, publicImageBaseUrl: 'https://images.example.test', remoteFactory });
    await expect(service.publish(groupId, 3)).rejects.toMatchObject({
      status: {
        code: 'variation_listing_action_failed',
        diagnostic: 'Unsupported variation listing revision snapshot version 3.',
        remoteState: 'unknown',
        requiresReconciliation: true,
      },
    });
    expect(remoteFactory).not.toHaveBeenCalled();
  });

  it('redacts bearer, signed URL query, userinfo, and provider payload fields from action events', async () => {
    const access = data();
    const events: unknown[] = [];
    const unsubscribe = subscribeVariationListingActionEvents(groupId, (event) => events.push(event));
    const service = createVariationListingActionService({ data: access.value, publicImageBaseUrl: 'https://images.example.test', remoteFactory: failingRemote(new Error('Bearer abc123 https://user:pass@example.test/path?X-Goog-Signature=secret&foo=bar')) });
    await expect(service.publish(groupId, 3)).rejects.toBeInstanceOf(VariationListingActionError);
    unsubscribe();
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain('abc123');
    expect(serialized).not.toContain('user:pass');
    expect(serialized).not.toContain('X-Goog-Signature=secret');
    expect(serialized).not.toContain('stack');
    expect(serialized).not.toContain('response');
  });

  it('maps a reservation CAS conflict to the stable state-stale action error', async () => {
    const harness = activeWithdrawalHarness();
    harness.access.value.reserveActionRevision.mockRejectedValue(new VariationListingTransactionConflictError('VR001', 'CAS mismatch'));
    const service = createVariationListingActionService({ data: harness.access.value, publicImageBaseUrl: 'https://images.example.test', remoteFactory: harness.remoteFactory });
    await expect(service.withdraw(groupId, 3)).rejects.toMatchObject({ status: { code: 'variation_listing_state_stale', category: 'state', remoteState: 'known_unchanged' } });
  });
});
