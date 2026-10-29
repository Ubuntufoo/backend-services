import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Json, VariationListingAggregateSnapshot, VariationListingRevisionRow } from '@ebay-inventory/data';

import {
  buildVariationListingPermanentRemovalPlan,
  executeVariationListingPermanentRemoval,
  hydrateVariationListingPermanentRemovalPlan,
  type VariationListingPermanentRemovalRemote,
} from '@/ebay/variation-listing-permanent-removal.js';
import { reconstructConfirmedRemoteIdentity } from '@/ebay/variation-listing-active-revision.js';
import type { VariationListingRemoteOffer, VariationListingRemoteRead } from '@/ebay/variation-listing-publication.js';

const groupId = '11111111-1111-4111-8111-111111111111';
const targetId = '22222222-2222-4222-8222-222222222222';
const targetSku = 'BSKBL-Test-000001';
const survivorSkus = ['BSKBL-Test-000002', 'BSKBL-Test-000003'];
const groupKey = 'VL-G-11111111111141118111111111111111';

function canonicalUtf8(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalUtf8).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8')))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalUtf8(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function digestUtf8(value: Json): string {
  return createHash('sha256').update(canonicalUtf8(value)).digest('hex');
}

const selectorBySku: Record<string, string> = {
  [targetSku]: 'Card 1',
  [survivorSkus[0]!]: 'Card 2',
  [survivorSkus[1]!]: 'Card 3',
};

function groupPayload(variantSKUs: readonly string[], selectorValues: readonly string[] = variantSKUs.map((sku) => selectorBySku[sku]!)): Json {
  return {
    inventoryItemGroupKey: groupKey,
    title: 'Basketball Cards',
    description: 'Three basketball trading cards',
    aspects: { Sport: ['Basketball'] },
    variantSKUs: [...variantSKUs],
    variesBy: {
      aspectsImageVariesBy: ['Card'],
      specifications: [{ name: 'Card', values: [...selectorValues] }],
    },
  };
}

function aggregate(): VariationListingAggregateSnapshot {
  const now = '2026-10-22T00:00:00.000Z';
  return {
    group: {
      group_id: groupId,
      group_key: groupKey,
      sku_category_code: 'BSKBL',
      sku_bucket_token: 'Test',
      next_inventory_serial: 4,
      lifecycle_state: 'active',
      selector_name: 'Card',
      title: 'Cards',
      description: 'Cards',
      derived_common_ebay_aspects: { Sport: ['Basketball'] },
      category_id: '261328',
      marketplace_id: 'EBAY_US',
      listing_format: 'FIXED_PRICE',
      merchant_location_key: 'main',
      fulfillment_policy_id: 'f',
      payment_policy_id: 'p',
      return_policy_id: 'r',
      condition_id: '4000',
      condition_token: 'VERY_GOOD',
      condition_description: null,
      condition_descriptors: [],
      desired_revision: 4,
      last_confirmed_revision: 3,
      created_at: now,
      updated_at: now,
    },
    variations: [targetId, ...survivorSkus.map((_, index) => `33333333-3333-4333-8333-33333333333${index + 1}`)].map((variationId, index) => ({
      variation_id: variationId,
      group_id: groupId,
      inventory_serial: index + 1,
      sku: index === 0 ? targetSku : survivorSkus[index - 1]!,
      position: index,
      selector_value: `Card ${index + 1}`,
      price_amount: 1.49,
      price_currency: 'USD',
      representative_copy_id: null,
      variation_metadata: {},
      quantity_adjustment_counter: 0,
      pending_removal_at: index === 0 ? '2026-10-22T00:00:00.000Z' : null,
      created_at: now,
      updated_at: now,
    })) as unknown as VariationListingAggregateSnapshot['variations'],
    copies: [],
  };
}

function remoteHarness(options: {
  failReplace?: boolean;
  failReplaceCount?: number;
  ungroupTargetAfterReplace?: boolean;
  foreignTargetAfterReplace?: boolean;
  postReadLoss?: boolean;
  targetListingIdAfterReplace?: string | null;
  targetLifecycleClassAfterReplace?: VariationListingRemoteOffer['lifecycleClass'];
  publishedTargetAfterReplace?: boolean;
  groupReadLossAfterReplace?: boolean;
  initialSelectorValues?: string[];
  initialGroupSkus?: string[];
  itemSelectorBySku?: Partial<Record<string, string>>;
  groupImageUrls?: string[];
  postGroupMetadataMismatch?: boolean;
  unknownGroupMetadata?: 'group' | 'variesBy';
} = {}) {
  const quantities: Record<string, number> = { [targetSku]: 0, [survivorSkus[0]!]: 1, [survivorSkus[1]!]: 2 };
  let groupSkus = options.initialGroupSkus ? [...options.initialGroupSkus] : [targetSku, ...survivorSkus];
  let groupValues = options.initialSelectorValues ? [...options.initialSelectorValues] : groupSkus.map((sku) => selectorBySku[sku]!);
  let failReplace = options.failReplace ?? false;
  let failReplaceCount = options.failReplaceCount ?? 0;
  let replaced = false;
  let postReadLoss = options.postReadLoss ?? false;
  let groupReadLossAfterReplace = options.groupReadLossAfterReplace ?? false;
  const read = <T>(value: T): VariationListingRemoteRead<T> => ({ state: 'present', value });
  const item = (sku: string) => ({ sku, groupKeys: [groupKey], payload: {
    availability: { shipToLocationAvailability: { quantity: quantities[sku] } },
    product: { aspects: { Card: [options.itemSelectorBySku?.[sku] ?? selectorBySku[sku]!] } },
  } });
  const offer = (sku: string): VariationListingRemoteOffer => ({ sku, marketplaceId: 'EBAY_US', offerId: `offer-${sku}`, listingId: replaced && sku === targetSku ? (options.targetListingIdAfterReplace !== undefined ? options.targetListingIdAfterReplace : null) : 'listing-1', status: replaced && sku === targetSku && !options.publishedTargetAfterReplace ? 'UNPUBLISHED' : 'PUBLISHED', lifecycleClass: replaced && sku === targetSku ? (options.targetLifecycleClassAfterReplace !== undefined ? options.targetLifecycleClassAfterReplace : 'not-listed') : 'active', payload: { availableQuantity: quantities[sku] } });
  const remote: VariationListingPermanentRemovalRemote = {
    getInventoryItemGroup: vi.fn(async () => {
      if (replaced && groupReadLossAfterReplace) {
        groupReadLossAfterReplace = false;
        throw new Error('post-group-read unavailable');
      }
      const payload = groupPayload(groupSkus, groupValues) as Record<string, Json>;
      if (options.groupImageUrls !== undefined) payload.imageUrls = [...options.groupImageUrls];
      if (replaced && options.postGroupMetadataMismatch) payload.title = 'Unexpected metadata drift';
      if (options.unknownGroupMetadata === 'group') payload.unexpectedMetadata = 'reject';
      if (options.unknownGroupMetadata === 'variesBy') {
        (payload.variesBy as Record<string, Json>).unexpectedMetadata = 'reject';
      }
      return read({ variantSKUs: [...groupSkus], payload });
    }),
    getInventoryItem: vi.fn(async (sku: string) => {
      if (replaced && postReadLoss) {
        postReadLoss = false;
        throw new Error('post-read unavailable');
      }
      const value = item(sku);
      if (replaced && options.ungroupTargetAfterReplace && sku === targetSku) value.groupKeys = null;
      if (replaced && options.foreignTargetAfterReplace && sku === targetSku) value.groupKeys = ['OTHER-GROUP'];
      return read(value);
    }),
    getOffers: vi.fn(async (sku: string) => read([offer(sku)])),
    getAllOffersForSku: vi.fn(async (sku: string) => [{
      offerId: `offer-${sku}`,
      sku,
      marketplaceId: 'EBAY_US',
      status: replaced && sku === targetSku && !options.publishedTargetAfterReplace ? 'UNPUBLISHED' as const : 'PUBLISHED' as const,
      listingId: replaced && sku === targetSku ? (options.targetListingIdAfterReplace !== undefined ? options.targetListingIdAfterReplace : null) : 'listing-1',
      availableQuantity: quantities[sku]!,
    }]),
    getMedia: vi.fn(async () => ({ state: 'proven_absent' })),
    replaceInventoryItemGroup: vi.fn(async (_key: string, payload: Json) => {
      if (failReplace || failReplaceCount > 0) {
        failReplace = false;
        failReplaceCount = Math.max(0, failReplaceCount - 1);
        throw new Error('response lost');
      }
      const replacement = payload as { variantSKUs?: unknown; variesBy?: { specifications?: Array<{ values?: unknown }> } };
      const replacementSkus = replacement.variantSKUs;
      const replacementValues = replacement.variesBy?.specifications?.[0]?.values;
      if (!Array.isArray(replacementSkus) || !Array.isArray(replacementValues) ||
          replacementSkus.length !== replacementValues.length || replacementSkus.length < 2 ||
          replacementSkus.some((sku) => typeof sku !== 'string') ||
          replacementValues.some((value) => typeof value !== 'string') ||
          replacementValues.some((value, index) => value !== selectorBySku[replacementSkus[index] as string])) {
        throw new Error('malformed group replacement must update matching SKU and Card selector arrays');
      }
      groupSkus = [...replacementSkus] as string[];
      groupValues = [...replacementValues] as string[];
      replaced = true;
    }),
  };
  return {
    remote,
    getGroupSkus: () => groupSkus,
    setGroupSkus: (next: string[]) => {
      groupSkus = [...next];
      const applicationOrder = [targetSku, ...survivorSkus];
      groupValues = applicationOrder.filter((sku) => next.includes(sku)).map((sku) => selectorBySku[sku]!);
      replaced = !next.includes(targetSku);
    },
    setGroupValues: (next: string[]) => { groupValues = [...next]; },
  };
}

async function planFixture(remote: VariationListingPermanentRemovalRemote, options: { previousMedia?: boolean; targetCopy?: boolean; omitFrozenTargetCopy?: boolean; tamperCurrent?: (current: VariationListingAggregateSnapshot) => void; tamperPrevious?: (previousRevision: VariationListingRevisionRow) => void } = {}) {
  const prior = aggregate();
  const current = aggregate();
  prior.group.desired_revision = 3;
  options.tamperCurrent?.(current);
  if (options.targetCopy) {
    const targetCopy = {
      copy_id: '44444444-4444-4444-8444-444444444444',
      variation_id: targetId,
      front_r2_key: 'cards/target/front.webp',
      back_r2_key: 'cards/target/back.webp',
      condition_token: 'VERY_GOOD',
    };
    current.copies = [targetCopy] as unknown as typeof current.copies;
    if (!options.omitFrozenTargetCopy) prior.copies = [targetCopy] as unknown as typeof prior.copies;
  }
  const previousMedia = options.previousMedia ? [
    { copyId: 'prior-copy', role: 'front' },
    { copyId: 'prior-copy', role: 'back' },
  ] : [];
  const previousOperationPlan = options.previousMedia ? previousMedia.map((media, index) => ({
    operation_key: `media:${media.copyId}:${media.role}`,
    operation_kind: 'media_ingest',
    target_ref: `${media.copyId}:${media.role}`,
    sequence_no: index + 1,
    intent_version: 1,
    intent_digest: '0'.repeat(64),
    intent: {},
  })) : [];
  const previousCheckpoints = options.previousMedia ? previousMedia.map((media, index) => ({
    revision_id: '55555555-5555-4555-8555-555555555555',
    operation_key: `media:${media.copyId}:${media.role}`,
    attempt_number: 1,
    checkpoint_number: 1,
    state: 'confirmed_complete',
    observed_remote_state: 'present',
    evidence: {
      imageId: `image-${media.role}`,
      location: `location-${media.role}`,
      expirationDate: '2027-01-01T00:00:00.000Z',
      imageUrl: `https://i.ebayimg.com/images/g/prior-${media.role}/s-l1600.jpg`,
    },
    created_at: '2026-10-22T00:00:00.000Z',
  })) : [];
  const previousSnapshot = {
    aggregate: prior,
    confirmed: {
      aggregate: prior,
      representativeImages: [],
      remote: {
        listingId: 'listing-1',
        offerIdsBySku: {
          [targetSku]: `offer-${targetSku}`,
          [survivorSkus[0]!]: `offer-${survivorSkus[0]}`,
          [survivorSkus[1]!]: `offer-${survivorSkus[1]}`,
        },
        quantitiesBySku: {
          [targetSku]: { inventoryItemQuantity: 3, offerQuantity: 3, sellableQuantity: 3 },
          [survivorSkus[0]!]: { inventoryItemQuantity: 1, offerQuantity: 1, sellableQuantity: 1 },
          [survivorSkus[1]!]: { inventoryItemQuantity: 2, offerQuantity: 2, sellableQuantity: 2 },
        },
      },
      revisionId: '55555555-5555-4555-8555-555555555555',
    },
    mediaResources: previousMedia,
    representativeImages: [],
  };
  const previousRevision = {
    revision_id: '55555555-5555-4555-8555-555555555555',
    group_id: groupId,
    captured_desired_revision: 3,
    snapshot_version: 3,
    snapshot_digest: digestUtf8(previousSnapshot as unknown as Json),
    snapshot: previousSnapshot,
    operation_plan: previousOperationPlan,
    operation_count: previousOperationPlan.length,
    captured_at: '2026-10-22T00:00:00.000Z',
  } as unknown as VariationListingRevisionRow;
  options.tamperPrevious?.(previousRevision);
  return await buildVariationListingPermanentRemovalPlan({
    aggregate: current,
    targetVariationId: targetId,
    revisionId: '44444444-4444-4444-8444-444444444444',
    previousConfirmedRevision: 3,
    previousRevisionId: '55555555-5555-4555-8555-555555555555',
    previousRevision,
    previousCheckpoints,
    remote,
  });
}

function transactionHarness(options: { failConfirmOnce?: boolean } = {}) {
  const checkpoints: any[] = [];
  let revision: any = null;
  let failConfirmOnce = options.failConfirmOnce ?? false;
  const transaction = {
    capturePermanentRemovalRevision: vi.fn(async (input: any) => {
      revision = {
        revision_id: input.revisionId,
        group_id: input.groupId,
        captured_desired_revision: input.capturedDesiredRevision,
        snapshot_version: 3,
        snapshot_digest: input.snapshotDigest,
        snapshot: input.snapshot,
        operation_plan: input.operationPlan.map((operation: any) => ({ operation_key: operation.operationKey, operation_kind: operation.operationKind, target_ref: operation.targetRef, sequence_no: operation.sequenceNo, intent_version: operation.intentVersion, intent_digest: operation.intentDigest, intent: operation.intent })),
        operation_count: input.operationPlan.length,
      };
      return { revision };
    }),
    appendJournalCheckpoint: vi.fn(async (input: any) => {
      const checkpoint = {
        checkpoint_id: input.checkpointId,
        revision_id: input.revisionId,
        operation_key: input.operationKey,
        attempt_number: input.attemptNumber,
        checkpoint_number: input.checkpointNumber,
        state: input.state,
        observed_remote_state: input.observedRemoteState ?? null,
        evidence: input.evidence,
        created_at: '2026-10-22T00:00:00.000Z',
      };
      checkpoints.push(checkpoint);
      return { checkpoint };
    }),
    confirmPermanentRemoval: vi.fn(async () => {
      if (failConfirmOnce) {
        failConfirmOnce = false;
        throw new Error('finalizer response lost');
      }
      return aggregate().group;
    }),
  };
  return { transaction, checkpoints, journal: { loadRevision: vi.fn(async () => revision), listCheckpoints: vi.fn(async () => checkpoints) } };
}

describe('YP9.6c2 permanent removal executor', () => {
  it('hydrates the frozen v3 survivor plan without remote reads', async () => {
    const { remote } = remoteHarness();
    const plan = await planFixture(remote);
    const row = {
      revision_id: plan.captureInput.revisionId,
      group_id: plan.captureInput.groupId,
      captured_desired_revision: plan.captureInput.capturedDesiredRevision,
      snapshot_version: 3,
      snapshot_digest: plan.captureInput.snapshotDigest,
      snapshot: plan.captureInput.snapshot,
      operation_plan: plan.captureInput.operationPlan.map((operation) => ({
        operation_key: operation.operationKey,
        operation_kind: operation.operationKind,
        target_ref: operation.targetRef,
        sequence_no: operation.sequenceNo,
        intent_version: operation.intentVersion,
        intent_digest: operation.intentDigest,
        intent: operation.intent,
      })),
      operation_count: plan.captureInput.operationPlan.length,
      captured_at: '2026-10-22T00:00:00.000Z',
    } as unknown as VariationListingRevisionRow;
    const hydrated = hydrateVariationListingPermanentRemovalPlan(row);
    expect(hydrated.captureInput.snapshot).toEqual(plan.captureInput.snapshot);
    expect(hydrated.replacementGroupPayload).toEqual(plan.replacementGroupPayload);
    const confirmedRemote = reconstructConfirmedRemoteIdentity(row, []);
    expect(Object.keys(confirmedRemote.offerIdsBySku).sort()).toEqual([...survivorSkus].sort());
    expect(remote.getInventoryItemGroup).toHaveBeenCalledTimes(1);
  });

  it('hydrates snapshots whose SQL digest depends on bytewise case-key ordering', async () => {
    const { remote } = remoteHarness();
    const plan = await planFixture(remote);
    const snapshot = structuredClone(plan.captureInput.snapshot) as Json;
    (snapshot as Record<string, Json>).caseDistinct = { a: 1, A: 2 };
    const row = {
      revision_id: plan.captureInput.revisionId,
      group_id: plan.captureInput.groupId,
      captured_desired_revision: plan.captureInput.capturedDesiredRevision,
      snapshot_version: 3,
      snapshot_digest: digestUtf8(snapshot),
      snapshot,
      operation_plan: plan.captureInput.operationPlan.map((operation) => ({
        operation_key: operation.operationKey,
        operation_kind: operation.operationKind,
        target_ref: operation.targetRef,
        sequence_no: operation.sequenceNo,
        intent_version: operation.intentVersion,
        intent_digest: operation.intentDigest,
        intent: operation.intent,
      })),
      operation_count: plan.captureInput.operationPlan.length,
      captured_at: '2026-10-22T00:00:00.000Z',
    } as unknown as VariationListingRevisionRow;
    expect(hydrateVariationListingPermanentRemovalPlan(row).captureInput.snapshotDigest).toBe(row.snapshot_digest);
  });

  it('retains every target copy front/back R2 key in the immutable snapshot', async () => {
    const { remote } = remoteHarness();
    const plan = await planFixture(remote, { targetCopy: true });
    const snapshot = plan.captureInput.snapshot as Record<string, any>;
    const copies = snapshot.confirmed.aggregate.copies as Array<Record<string, unknown>>;
    expect(copies).toEqual(expect.arrayContaining([
      expect.objectContaining({
        variation_id: targetId,
        copy_id: '44444444-4444-4444-8444-444444444444',
        front_r2_key: 'cards/target/front.webp',
        back_r2_key: 'cards/target/back.webp',
      }),
    ]));
  });

  it('refuses capture when the prior immutable revision omitted a target copy key', async () => {
    const { remote } = remoteHarness();
    await expect(planFixture(remote, { targetCopy: true, omitFrozenTargetCopy: true })).rejects.toThrow('every target copy/R2 key');
  });

  it('rejects a forged durable c2 operation during hydration', async () => {
    const { remote } = remoteHarness();
    const plan = await planFixture(remote);
    const row = {
      revision_id: plan.captureInput.revisionId,
      group_id: plan.captureInput.groupId,
      captured_desired_revision: plan.captureInput.capturedDesiredRevision,
      snapshot_version: 3,
      snapshot_digest: plan.captureInput.snapshotDigest,
      snapshot: plan.captureInput.snapshot,
      operation_plan: plan.captureInput.operationPlan.map((operation) => ({
        operation_key: operation.operationKey,
        operation_kind: operation.operationKind,
        target_ref: operation.targetRef,
        sequence_no: operation.sequenceNo,
        intent_version: operation.intentVersion,
        intent_digest: operation.intentDigest,
        intent: operation.intent,
      })),
      operation_count: plan.captureInput.operationPlan.length,
      captured_at: '2026-10-22T00:00:00.000Z',
    } as unknown as VariationListingRevisionRow;
    (row.operation_plan[0] as Record<string, Json>).target_ref = 'FOREIGN-GROUP';
    await expect(() => hydrateVariationListingPermanentRemovalPlan(row)).toThrow('matching group-membership operation');
  });

  it('freezes fresh exact-zero quantities even when prior confirmation was stocked', async () => {
    const { remote } = remoteHarness();
    const plan = await planFixture(remote);
    expect(plan.quantitiesBySku[targetSku]).toEqual({ inventoryItemQuantity: 0, offerQuantity: 0, sellableQuantity: 0 });
  });

  it('rejects a tampered prior v3 snapshot digest before remote reads or capture', async () => {
    const { remote } = remoteHarness();
    await expect(planFixture(remote, {
      tamperPrevious: (previousRevision) => {
        const snapshot = previousRevision.snapshot as Record<string, Json>;
        const aggregate = snapshot.aggregate as Record<string, Json>;
        const group = aggregate.group as Record<string, Json>;
        group.title = 'Tampered after durable capture';
      },
    })).rejects.toThrow('snapshot digest');
    expect(remote.getInventoryItemGroup).not.toHaveBeenCalled();
    expect(remote.getInventoryItem).not.toHaveBeenCalled();
    expect(remote.getOffers).not.toHaveBeenCalled();
    expect(remote.replaceInventoryItemGroup).not.toHaveBeenCalled();
  });

  it('rejects a current selector mapping changed from the immutable confirmed aggregate before remote reads', async () => {
    const { remote } = remoteHarness();
    await expect(planFixture(remote, {
      tamperCurrent: (current) => { current.variations[1]!.selector_value = 'Card tampered'; },
    })).rejects.toThrow('immutable confirmed identity');
    expect(remote.getInventoryItemGroup).not.toHaveBeenCalled();
    expect(remote.getInventoryItem).not.toHaveBeenCalled();
    expect(remote.getOffers).not.toHaveBeenCalled();
    expect(remote.replaceInventoryItemGroup).not.toHaveBeenCalled();
  });

  it('rejects a current position and SKU mapping changed from the immutable confirmed aggregate before remote reads', async () => {
    const { remote } = remoteHarness();
    await expect(planFixture(remote, {
      tamperCurrent: (current) => {
        current.variations[1]!.position = 2;
        current.variations[1]!.sku = survivorSkus[1]!;
      },
    })).rejects.toThrow('immutable confirmed identity');
    expect(remote.getInventoryItemGroup).not.toHaveBeenCalled();
    expect(remote.getInventoryItem).not.toHaveBeenCalled();
    expect(remote.getOffers).not.toHaveBeenCalled();
    expect(remote.replaceInventoryItemGroup).not.toHaveBeenCalled();
  });

  it('does not carry prior confirmed Media intents into the c2 snapshot', async () => {
    const { remote } = remoteHarness();
    const plan = await planFixture(remote, { previousMedia: true });
    const snapshot = plan.captureInput.snapshot as { mediaResources?: unknown[] };
    expect(snapshot.mediaResources).toEqual([]);
  });

  it('requires exact zero target and preserves survivor remote state', async () => {
    const { remote, getGroupSkus } = remoteHarness();
    const plan = await planFixture(remote);
    const harness = transactionHarness();
    const result = await executeVariationListingPermanentRemoval({ plan, remote, ...harness });
    expect(result.membershipConfirmed).toBe(true);
    expect(getGroupSkus()).toEqual(survivorSkus);
    expect(remote.replaceInventoryItemGroup).toHaveBeenCalledTimes(1);
    const replacement = remote.replaceInventoryItemGroup.mock.calls[0]?.[1] as {
      variantSKUs: string[];
      variesBy: { specifications: [{ values: string[] }] };
    };
    expect(replacement.variantSKUs).toEqual(survivorSkus);
    expect(replacement.variesBy.specifications[0].values).toEqual(['Card 2', 'Card 3']);
    expect(replacement.variantSKUs).not.toContain(targetSku);
    expect(harness.transaction.confirmPermanentRemoval).not.toHaveBeenCalled();
    expect(harness.checkpoints.at(-1).state).toBe('confirmed_complete');
  });

  it('rejects duplicate or conflicting Card selector metadata before replacement', async () => {
    const duplicate = remoteHarness({ initialSelectorValues: ['Card 1', 'Card 2', 'Card 2'] });
    await expect(planFixture(duplicate.remote)).rejects.toThrow('exact unique pair');
    expect(duplicate.remote.replaceInventoryItemGroup).not.toHaveBeenCalled();

    const independentlyReordered = remoteHarness({ initialSelectorValues: ['Card 2', 'Card 1', 'Card 3'] });
    const reorderedPlan = await planFixture(independentlyReordered.remote);
    expect((reorderedPlan.replacementGroupPayload as any).variesBy.specifications[0].values).toEqual(['Card 2', 'Card 3']);
    expect(independentlyReordered.remote.replaceInventoryItemGroup).not.toHaveBeenCalled();
  });

  it('accepts a historical overlong Card selector while projecting the confirmed survivor values', async () => {
    const historicalSelector = `Card ${'legacy-selector-'.repeat(6)}`;
    const { remote } = remoteHarness({ initialSelectorValues: [historicalSelector, 'Card 2', 'Card 3'], itemSelectorBySku: { [targetSku]: historicalSelector } });
    const plan = await planFixture(remote, {
      tamperCurrent: (current) => { current.variations[0]!.selector_value = historicalSelector; },
      tamperPrevious: (previousRevision) => {
        const snapshot = previousRevision.snapshot as Record<string, Json>;
        const aggregate = snapshot.aggregate as unknown as VariationListingAggregateSnapshot;
        aggregate.variations[0]!.selector_value = historicalSelector;
        previousRevision.snapshot_digest = digestUtf8(snapshot);
      },
    });
    const harness = transactionHarness();
    await executeVariationListingPermanentRemoval({ plan, remote, ...harness });
    const replacement = remote.replaceInventoryItemGroup.mock.calls[0]?.[1] as { variesBy: { specifications: [{ values: string[] }] } };
    expect(replacement.variesBy.specifications[0].values).toEqual(['Card 2', 'Card 3']);
  });

  it('rejects unknown group and variesBy metadata before membership replacement', async () => {
    for (const unknownGroupMetadata of ['group', 'variesBy'] as const) {
      const { remote } = remoteHarness({ unknownGroupMetadata });
      await expect(planFixture(remote)).rejects.toThrow();
      expect(remote.replaceInventoryItemGroup).not.toHaveBeenCalled();
    }
  });

  it('rejects unproven group-level image mappings before replacement', async () => {
    const { remote } = remoteHarness({ groupImageUrls: ['https://i.ebayimg.com/images/g/group/s-l1600.jpg'] });
    await expect(planFixture(remote)).rejects.toThrow('Group-level images');
    expect(remote.replaceInventoryItemGroup).not.toHaveBeenCalled();
  });

  it('normalizes an omitted or explicitly empty group image collection', async () => {
    const { remote } = remoteHarness({ groupImageUrls: [] });
    const plan = await planFixture(remote);
    const harness = transactionHarness();
    await expect(executeVariationListingPermanentRemoval({ plan, remote, ...harness })).resolves.toMatchObject({ membershipConfirmed: true });
  });

  it('accepts an unpublished target retaining the original listing ID', async () => {
    const { remote } = remoteHarness({ targetListingIdAfterReplace: 'listing-1' });
    const plan = await planFixture(remote);
    const harness = transactionHarness();
    await executeVariationListingPermanentRemoval({ plan, remote, ...harness });
    expect(harness.checkpoints.at(-1).state).toBe('confirmed_complete');
  });

  it('accepts an unpublished target with no lifecycle classification', async () => {
    const { remote } = remoteHarness({ targetLifecycleClassAfterReplace: null });
    const plan = await planFixture(remote);
    const harness = transactionHarness();
    await executeVariationListingPermanentRemoval({ plan, remote, ...harness });
    expect(harness.checkpoints.at(-1).state).toBe('confirmed_complete');
  });

  it('rejects an ambiguous target lifecycle after replacement without replaying', async () => {
    const { remote } = remoteHarness({ targetLifecycleClassAfterReplace: 'ambiguous' });
    const plan = await planFixture(remote);
    const harness = transactionHarness();
    await expect(executeVariationListingPermanentRemoval({ plan, remote, ...harness })).rejects.toThrow('not the expected unpublished original Offer');
    expect(remote.replaceInventoryItemGroup).toHaveBeenCalledTimes(1);
    expect(harness.checkpoints.at(-1).state).toBe('unknown');
    await expect(executeVariationListingPermanentRemoval({ plan, remote, ...harness })).rejects.toThrow('not the expected unpublished original Offer');
    expect(remote.replaceInventoryItemGroup).toHaveBeenCalledTimes(1);
  });

  it('rejects an incorrect target Offer ID before replacement', async () => {
    const { remote } = remoteHarness();
    const plan = await planFixture(remote);
    const original = remote.getOffers;
    remote.getOffers = vi.fn(async (sku: string, marketplaceId: string) => {
      const result = await original(sku, marketplaceId);
      if (sku === targetSku && result.state === 'present' && result.value[0]) {
        result.value[0] = { ...result.value[0], offerId: 'foreign-offer' };
      }
      return result;
    });
    const harness = transactionHarness();
    await expect(executeVariationListingPermanentRemoval({ plan, remote, ...harness })).rejects.toThrow('identity changed');
    expect(remote.replaceInventoryItemGroup).not.toHaveBeenCalled();
    expect(harness.checkpoints.at(-1).state).toBe('unknown');
  });

  it('rejects duplicate Offer IDs while freezing the removal plan', async () => {
    const { remote } = remoteHarness();
    const original = remote.getOffers;
    remote.getOffers = vi.fn(async (sku: string, marketplaceId: string) => {
      const result = await original(sku, marketplaceId);
      if (sku === survivorSkus[0] && result.state === 'present' && result.value[0]) {
        result.value[0] = { ...result.value[0], offerId: `offer-${targetSku}` };
      }
      return result;
    });
    await expect(planFixture(remote)).rejects.toThrow("reuses another SKU's Offer ID");
    expect(remote.replaceInventoryItemGroup).not.toHaveBeenCalled();
  });

  it.each([targetSku, survivorSkus[0]])('blocks the Group PUT when exhaustive Offers include a foreign marketplace Offer for %s', async (foreignSku) => {
    const { remote } = remoteHarness();
    const original = remote.getAllOffersForSku!;
    remote.getAllOffersForSku = vi.fn(async (sku: string) => {
      const offers = await original(sku);
      return sku !== foreignSku ? offers : [...offers, {
        offerId: `foreign-${sku}`,
        sku,
        marketplaceId: 'EBAY_GB',
        status: 'PUBLISHED' as const,
        listingId: 'listing-foreign',
        availableQuantity: 0,
      }];
    });
    await expect(planFixture(remote)).rejects.toThrow('exactly one exhaustive Offer');
    expect(remote.replaceInventoryItemGroup).not.toHaveBeenCalled();
  });

  it.each(['status', 'listing', 'quantity'] as const)('blocks the Group PUT when exhaustive Offer %s differs from the scoped Offer', async (field) => {
    const { remote } = remoteHarness();
    const original = remote.getAllOffersForSku!;
    remote.getAllOffersForSku = vi.fn(async (sku: string) => {
      const offers = await original(sku);
      if (sku !== survivorSkus[0] || !offers[0]) return offers;
      const changed = { ...offers[0] };
      if (field === 'status') changed.status = 'UNPUBLISHED';
      if (field === 'listing') changed.listingId = 'listing-foreign';
      if (field === 'quantity') changed.availableQuantity += 1;
      return [changed];
    });
    await expect(planFixture(remote)).rejects.toThrow('foreign or changed exhaustive Offer');
    expect(remote.replaceInventoryItemGroup).not.toHaveBeenCalled();
  });

  it.each(['wrong', 'missing'] as const)('blocks the Group PUT when the %s Item Card aspect is not exact', async (mode) => {
    const { remote } = remoteHarness({ itemSelectorBySku: mode === 'wrong' ? { [survivorSkus[0]!]: 'Card wrong' } : undefined });
    if (mode === 'missing') {
      const original = remote.getInventoryItem;
      remote.getInventoryItem = vi.fn(async (sku: string) => {
        const read = await original(sku);
        if (sku === survivorSkus[0] && read.state === 'present') {
          const payload = read.value.payload as Record<string, any>;
          payload.product = { aspects: {} };
        }
        return read;
      });
    }
    await expect(planFixture(remote)).rejects.toThrow(/Card aspect/);
    expect(remote.replaceInventoryItemGroup).not.toHaveBeenCalled();
  });

  it('rejects duplicate Offer IDs after freezing without replacement', async () => {
    const { remote } = remoteHarness();
    const plan = await planFixture(remote);
    const snapshot = plan.captureInput.snapshot as Record<string, any>;
    snapshot.permanentRemoval.offerIdsBySku[survivorSkus[0]!] = snapshot.permanentRemoval.offerIdsBySku[targetSku]!;
    snapshot.confirmed.remote.offerIdsBySku[survivorSkus[0]!] = snapshot.permanentRemoval.offerIdsBySku[targetSku]!;
    plan.captureInput.snapshotDigest = digestUtf8(snapshot);
    const original = remote.getOffers;
    remote.getOffers = vi.fn(async (sku: string, marketplaceId: string) => {
      const result = await original(sku, marketplaceId);
      if (sku === survivorSkus[0] && result.state === 'present' && result.value[0]) {
        result.value[0] = { ...result.value[0], offerId: `offer-${targetSku}` };
      }
      return result;
    });
    const harness = transactionHarness();
    await expect(executeVariationListingPermanentRemoval({ plan, remote, ...harness })).rejects.toThrow("reuses another SKU's Offer ID");
    expect(remote.replaceInventoryItemGroup).not.toHaveBeenCalled();
    expect(harness.checkpoints.at(-1).state).toBe('unknown');
  });

  it('rejects a target that remains PUBLISHED after replacement without replaying', async () => {
    const { remote } = remoteHarness({ publishedTargetAfterReplace: true });
    const plan = await planFixture(remote);
    const harness = transactionHarness();
    await expect(executeVariationListingPermanentRemoval({ plan, remote, ...harness })).rejects.toThrow('not the expected unpublished original Offer');
    expect(remote.replaceInventoryItemGroup).toHaveBeenCalledTimes(1);
    expect(harness.checkpoints.at(-1).state).toBe('unknown');
    await expect(executeVariationListingPermanentRemoval({ plan, remote, ...harness })).rejects.toThrow('not the expected unpublished original Offer');
    expect(remote.replaceInventoryItemGroup).toHaveBeenCalledTimes(1);
  });

  it('rejects an unknown group read without issuing membership replacement', async () => {
    const { remote } = remoteHarness();
    const plan = await planFixture(remote);
    remote.getInventoryItemGroup = vi.fn(async () => ({ state: 'unknown' as const, reason: 'timeout' }));
    const harness = transactionHarness();
    await expect(executeVariationListingPermanentRemoval({ plan, remote, ...harness })).rejects.toThrow('read is unknown');
    expect(remote.replaceInventoryItemGroup).not.toHaveBeenCalled();
  });

  it('rejects a proven-absent group without issuing membership replacement', async () => {
    const { remote } = remoteHarness();
    const plan = await planFixture(remote);
    remote.getInventoryItemGroup = vi.fn(async () => ({ state: 'proven_absent' as const }));
    const harness = transactionHarness();
    await expect(executeVariationListingPermanentRemoval({ plan, remote, ...harness })).rejects.toThrow('is proven absent');
    expect(remote.replaceInventoryItemGroup).not.toHaveBeenCalled();
  });

  it('rejects an empty target Offer response and records unknown before replacement', async () => {
    const { remote } = remoteHarness();
    const plan = await planFixture(remote);
    const original = remote.getOffers;
    remote.getOffers = vi.fn(async (sku: string, marketplaceId: string) => sku === targetSku ? { state: 'present' as const, value: [] } : original(sku, marketplaceId));
    const harness = transactionHarness();
    await expect(executeVariationListingPermanentRemoval({ plan, remote, ...harness })).rejects.toThrow('must have exactly one offer');
    expect(remote.replaceInventoryItemGroup).not.toHaveBeenCalled();
    expect(harness.checkpoints.map((checkpoint) => checkpoint.state)).toEqual(['started', 'unknown']);
  });

  it('rejects a proven-absent target Offer response and records unknown before replacement', async () => {
    const { remote } = remoteHarness();
    const plan = await planFixture(remote);
    const original = remote.getOffers;
    remote.getOffers = vi.fn(async (sku: string, marketplaceId: string) => sku === targetSku ? { state: 'proven_absent' as const } : original(sku, marketplaceId));
    const harness = transactionHarness();
    await expect(executeVariationListingPermanentRemoval({ plan, remote, ...harness })).rejects.toThrow('is proven absent');
    expect(remote.replaceInventoryItemGroup).not.toHaveBeenCalled();
    expect(harness.checkpoints.map((checkpoint) => checkpoint.state)).toEqual(['started', 'unknown']);
  });

  it('rejects an unknown target Offer response and records unknown before replacement', async () => {
    const { remote } = remoteHarness();
    const plan = await planFixture(remote);
    const original = remote.getOffers;
    remote.getOffers = vi.fn(async (sku: string, marketplaceId: string) => sku === targetSku ? { state: 'unknown' as const, reason: 'timeout' } : original(sku, marketplaceId));
    const harness = transactionHarness();
    await expect(executeVariationListingPermanentRemoval({ plan, remote, ...harness })).rejects.toThrow('read is unknown');
    expect(remote.replaceInventoryItemGroup).not.toHaveBeenCalled();
    expect(harness.checkpoints.map((checkpoint) => checkpoint.state)).toEqual(['started', 'unknown']);
  });

  it('records durable unknown when the target Offer becomes unavailable after replacement', async () => {
    const { remote } = remoteHarness();
    const plan = await planFixture(remote);
    let replaced = false;
    const originalReplace = remote.replaceInventoryItemGroup;
    remote.replaceInventoryItemGroup = vi.fn(async (groupKey: string, payload: Json) => {
      await originalReplace(groupKey, payload);
      replaced = true;
    });
    const originalOffers = remote.getOffers;
    remote.getOffers = vi.fn(async (sku: string, marketplaceId: string) =>
      replaced && sku === targetSku
        ? { state: 'unknown' as const, reason: 'post-offer-read unavailable' }
        : originalOffers(sku, marketplaceId)
    );
    const harness = transactionHarness();
    await expect(executeVariationListingPermanentRemoval({ plan, remote, ...harness })).rejects.toThrow('read is unknown');
    expect(remote.replaceInventoryItemGroup).toHaveBeenCalledTimes(1);
    expect(harness.checkpoints.at(-1).state).toBe('unknown');
    await expect(executeVariationListingPermanentRemoval({ plan, remote, ...harness })).rejects.toThrow('read is unknown');
    expect(remote.replaceInventoryItemGroup).toHaveBeenCalledTimes(1);
  });

  it('records durable unknown when the target Offer is proven absent after replacement', async () => {
    const { remote } = remoteHarness();
    const plan = await planFixture(remote);
    let replaced = false;
    const originalReplace = remote.replaceInventoryItemGroup;
    remote.replaceInventoryItemGroup = vi.fn(async (groupKey: string, payload: Json) => {
      await originalReplace(groupKey, payload);
      replaced = true;
    });
    const originalOffers = remote.getOffers;
    remote.getOffers = vi.fn(async (sku: string, marketplaceId: string) =>
      replaced && sku === targetSku
        ? { state: 'proven_absent' as const }
        : originalOffers(sku, marketplaceId)
    );
    const harness = transactionHarness();
    await expect(executeVariationListingPermanentRemoval({ plan, remote, ...harness })).rejects.toThrow('is proven absent');
    expect(remote.replaceInventoryItemGroup).toHaveBeenCalledTimes(1);
    expect(harness.checkpoints.at(-1).state).toBe('unknown');
    await expect(executeVariationListingPermanentRemoval({ plan, remote, ...harness })).rejects.toThrow('is proven absent');
    expect(remote.replaceInventoryItemGroup).toHaveBeenCalledTimes(1);
  });

  it('rejects a survivor Offer that becomes UNPUBLISHED before replacement', async () => {
    const { remote } = remoteHarness();
    const plan = await planFixture(remote);
    const original = remote.getOffers;
    remote.getOffers = vi.fn(async (sku: string, marketplaceId: string) => {
      const result = await original(sku, marketplaceId);
      if (sku === survivorSkus[0] && result.state === 'present' && result.value[0]) {
        result.value[0] = { ...result.value[0], status: 'UNPUBLISHED', lifecycleClass: null, listingId: null };
      }
      return result;
    });
    const harness = transactionHarness();
    await expect(executeVariationListingPermanentRemoval({ plan, remote, ...harness })).rejects.toThrow(/foreign or changed exhaustive Offer|identity\/listing changed/);
    expect(remote.replaceInventoryItemGroup).not.toHaveBeenCalled();
    expect(harness.checkpoints.at(-1).state).toBe('unknown');
  });

  it('rejects a survivor Offer that changes listing identity before replacement', async () => {
    const { remote } = remoteHarness();
    const plan = await planFixture(remote);
    const original = remote.getOffers;
    remote.getOffers = vi.fn(async (sku: string, marketplaceId: string) => {
      const result = await original(sku, marketplaceId);
      if (sku === survivorSkus[0] && result.state === 'present' && result.value[0]) {
        result.value[0] = { ...result.value[0], listingId: 'foreign-listing' };
      }
      return result;
    });
    const harness = transactionHarness();
    await expect(executeVariationListingPermanentRemoval({ plan, remote, ...harness })).rejects.toThrow(/foreign or changed exhaustive Offer|identity\/listing changed/);
    expect(remote.replaceInventoryItemGroup).not.toHaveBeenCalled();
    expect(harness.checkpoints.at(-1).state).toBe('unknown');
  });

  it('rejects target Item quantity drift after the frozen plan', async () => {
    const { remote } = remoteHarness();
    const plan = await planFixture(remote);
    const original = remote.getInventoryItem;
    remote.getInventoryItem = vi.fn(async (sku: string) => {
      const result = await original(sku);
      if (sku === targetSku && result.state === 'present') {
        result.value.payload = { availability: { shipToLocationAvailability: { quantity: 1 } }, product: { aspects: { Card: [selectorBySku[sku]!] } } };
      }
      return result;
    });
    const harness = transactionHarness();
    await expect(executeVariationListingPermanentRemoval({ plan, remote, ...harness })).rejects.toThrow(/foreign or changed exhaustive Offer|remote state is unknown/);
    expect(remote.replaceInventoryItemGroup).not.toHaveBeenCalled();
    expect(harness.checkpoints.at(-1).state).toBe('unknown');
  });

  it('rejects target Offer quantity drift after the frozen plan', async () => {
    const { remote } = remoteHarness();
    const plan = await planFixture(remote);
    const original = remote.getOffers;
    remote.getOffers = vi.fn(async (sku: string, marketplaceId: string) => {
      const result = await original(sku, marketplaceId);
      if (sku === targetSku && result.state === 'present' && result.value[0]) {
        result.value[0] = { ...result.value[0], payload: { availableQuantity: 1 } };
      }
      return result;
    });
    const harness = transactionHarness();
    await expect(executeVariationListingPermanentRemoval({ plan, remote, ...harness })).rejects.toThrow(/foreign or changed exhaustive Offer|remote state is unknown/);
    expect(remote.replaceInventoryItemGroup).not.toHaveBeenCalled();
    expect(harness.checkpoints.at(-1).state).toBe('unknown');
  });

  it('rejects survivor Offer quantity drift after the frozen plan', async () => {
    const { remote } = remoteHarness();
    const plan = await planFixture(remote);
    const original = remote.getOffers;
    remote.getOffers = vi.fn(async (sku: string, marketplaceId: string) => {
      const result = await original(sku, marketplaceId);
      if (sku === survivorSkus[0] && result.state === 'present' && result.value[0]) {
        result.value[0] = { ...result.value[0], payload: { availableQuantity: 9 } };
      }
      return result;
    });
    const harness = transactionHarness();
    await expect(executeVariationListingPermanentRemoval({ plan, remote, ...harness })).rejects.toThrow(/foreign or changed exhaustive Offer|remote state is unknown/);
    expect(remote.replaceInventoryItemGroup).not.toHaveBeenCalled();
    expect(harness.checkpoints.at(-1).state).toBe('unknown');
  });

  it('rejects survivor Item quantity drift after the frozen plan', async () => {
    const { remote } = remoteHarness();
    const plan = await planFixture(remote);
    const original = remote.getInventoryItem;
    remote.getInventoryItem = vi.fn(async (sku: string) => {
      const result = await original(sku);
      if (sku === survivorSkus[0] && result.state === 'present') {
        result.value.payload = { availability: { shipToLocationAvailability: { quantity: 9 } }, product: { aspects: { Card: [selectorBySku[sku]!] } } };
      }
      return result;
    });
    const harness = transactionHarness();
    await expect(executeVariationListingPermanentRemoval({ plan, remote, ...harness })).rejects.toThrow('remote state is unknown');
    expect(remote.replaceInventoryItemGroup).not.toHaveBeenCalled();
    expect(harness.checkpoints.at(-1).state).toBe('unknown');
  });

  it('records unknown and refuses every later mutation replay', async () => {
    const { remote } = remoteHarness({ failReplace: true });
    const plan = await planFixture(remote);
    const harness = transactionHarness();
    await expect(executeVariationListingPermanentRemoval({ plan, remote, ...harness })).rejects.toThrow('response lost');
    expect(harness.checkpoints.map((checkpoint) => checkpoint.state)).toEqual(['started', 'unknown']);
    await expect(executeVariationListingPermanentRemoval({ plan, remote, ...harness })).rejects.toThrow('manual reconciliation');
    expect(remote.replaceInventoryItemGroup).toHaveBeenCalledTimes(1);
    expect(harness.checkpoints.map((checkpoint) => checkpoint.state)).toEqual(['started', 'unknown']);
  });

  it('reconciles retry-authorized exact post through started before confirmation', async () => {
    const { remote, setGroupSkus } = remoteHarness();
    const plan = await planFixture(remote);
    const harness = transactionHarness();
    harness.checkpoints.push(
      { revision_id: plan.captureInput.revisionId, operation_key: 'remove-group-membership', attempt_number: 1, checkpoint_number: 1, state: 'started', observed_remote_state: null, evidence: {} },
      { revision_id: plan.captureInput.revisionId, operation_key: 'remove-group-membership', attempt_number: 1, checkpoint_number: 2, state: 'unknown', observed_remote_state: 'unknown', evidence: { reason: 'response lost' } },
      { revision_id: plan.captureInput.revisionId, operation_key: 'remove-group-membership', attempt_number: 2, checkpoint_number: 1, state: 'retry_authorized', observed_remote_state: 'present', evidence: { reason: 'replay authorized' } },
    );
    setGroupSkus(survivorSkus);
    await executeVariationListingPermanentRemoval({ plan, remote, ...harness });
    expect(remote.replaceInventoryItemGroup).not.toHaveBeenCalled();
    expect(harness.checkpoints.slice(-2).map((checkpoint) => `${checkpoint.state}:${checkpoint.attempt_number}:${checkpoint.checkpoint_number}`)).toEqual(['started:2:2', 'confirmed_complete:2:3']);
  });

  it('treats remote group SKU order as non-authoritative for pre and post checks', async () => {
    const { remote, setGroupSkus } = remoteHarness();
    setGroupSkus([survivorSkus[1]!, targetSku, survivorSkus[0]!]);
    const plan = await planFixture(remote);
    const first = transactionHarness();
    await executeVariationListingPermanentRemoval({ plan, remote, ...first });
    expect(remote.replaceInventoryItemGroup).toHaveBeenCalledTimes(1);

    setGroupSkus([survivorSkus[1]!, survivorSkus[0]!]);
    const reconcile = transactionHarness();
    reconcile.checkpoints.push({ revision_id: plan.captureInput.revisionId, operation_key: 'remove-group-membership', attempt_number: 2, checkpoint_number: 1, state: 'retry_authorized', observed_remote_state: 'present', evidence: { reason: 'reconcile' } });
    await executeVariationListingPermanentRemoval({ plan, remote, ...reconcile });
    expect(remote.replaceInventoryItemGroup).toHaveBeenCalledTimes(1);
  });

  it('fails closed when post-replacement group metadata changes', async () => {
    const { remote } = remoteHarness({ postGroupMetadataMismatch: true });
    const plan = await planFixture(remote);
    const harness = transactionHarness();
    await expect(executeVariationListingPermanentRemoval({ plan, remote, ...harness })).rejects.toThrow('group differs');
    expect(remote.replaceInventoryItemGroup).toHaveBeenCalledTimes(1);
    expect(harness.checkpoints.at(-1).state).toBe('unknown');
  });

  it('confirms removal when the target Offer becomes UNPUBLISHED while survivors remain PUBLISHED', async () => {
    const { remote } = remoteHarness();
    const plan = await planFixture(remote);
    const harness = transactionHarness();
    await executeVariationListingPermanentRemoval({ plan, remote, ...harness });
    expect(harness.checkpoints.at(-1).state).toBe('confirmed_complete');
    expect((await remote.getOffers(targetSku, 'EBAY_US')).state).toBe('present');
    const targetOffers = await remote.getOffers(targetSku, 'EBAY_US');
    if (targetOffers.state !== 'present') throw new Error('target offer unexpectedly absent');
    expect(targetOffers.value[0]?.status).toBe('UNPUBLISHED');
    const survivorOffers = await remote.getOffers(survivorSkus[0]!, 'EBAY_US');
    if (survivorOffers.state !== 'present') throw new Error('survivor offer unexpectedly absent');
    expect(survivorOffers.value[0]?.status).toBe('PUBLISHED');
    await executeVariationListingPermanentRemoval({ plan, remote, ...harness });
    expect(remote.replaceInventoryItemGroup).toHaveBeenCalledTimes(1);
  });

  it('accepts the target Item becoming ungrouped after membership replacement', async () => {
    const { remote, getGroupSkus } = remoteHarness({ ungroupTargetAfterReplace: true });
    const plan = await planFixture(remote);
    const harness = transactionHarness();
    await executeVariationListingPermanentRemoval({ plan, remote, ...harness });
    expect(getGroupSkus()).toEqual(survivorSkus);
    expect(harness.checkpoints.at(-1).state).toBe('confirmed_complete');
  });

  it('accepts B,C,A Group SKU order with independently reordered Card values', async () => {
    const { remote } = remoteHarness({
      initialGroupSkus: [survivorSkus[0]!, survivorSkus[1]!, targetSku],
      initialSelectorValues: ['Card 1', 'Card 2', 'Card 3'],
    });
    const plan = await planFixture(remote);
    expect((plan.replacementGroupPayload as any).variantSKUs).toEqual(survivorSkus);
    expect((plan.replacementGroupPayload as any).variesBy.specifications[0].values).toEqual(['Card 2', 'Card 3']);
  });

  it('durably records unknown when the post-mutation read is lost', async () => {
    const { remote } = remoteHarness({ postReadLoss: true });
    const plan = await planFixture(remote);
    const harness = transactionHarness();
    await expect(executeVariationListingPermanentRemoval({ plan, remote, ...harness })).rejects.toThrow('post-read unavailable');
    expect(harness.checkpoints.at(-1).state).toBe('unknown');
    expect(remote.replaceInventoryItemGroup).toHaveBeenCalledTimes(1);
    await executeVariationListingPermanentRemoval({ plan, remote, ...harness });
    expect(remote.replaceInventoryItemGroup).toHaveBeenCalledTimes(1);
    expect(harness.checkpoints.at(-1).state).toBe('confirmed_complete');
  });

  it('durably records unknown when the post-mutation group read is lost', async () => {
    const { remote } = remoteHarness({ groupReadLossAfterReplace: true });
    const plan = await planFixture(remote);
    const harness = transactionHarness();
    await expect(executeVariationListingPermanentRemoval({ plan, remote, ...harness })).rejects.toThrow('post-group-read unavailable');
    expect(remote.replaceInventoryItemGroup).toHaveBeenCalledTimes(1);
    expect(harness.checkpoints.at(-1).state).toBe('unknown');
    await executeVariationListingPermanentRemoval({ plan, remote, ...harness });
    expect(remote.replaceInventoryItemGroup).toHaveBeenCalledTimes(1);
  });

  it('rejects a target post-read that adopts a foreign group', async () => {
    const { remote } = remoteHarness({ foreignTargetAfterReplace: true });
    const plan = await planFixture(remote);
    const harness = transactionHarness();
    await expect(executeVariationListingPermanentRemoval({ plan, remote, ...harness })).rejects.toThrow('replacement returned without exact post-state');
    expect(harness.checkpoints.at(-1).state).toBe('unknown');
  });

  it('fails closed on non-quantity payload drift before replacement', async () => {
    const { remote } = remoteHarness();
    const plan = await planFixture(remote);
    const original = remote.getInventoryItem;
    remote.getInventoryItem = vi.fn(async (sku: string) => {
      const result = await original(sku);
      if (sku === survivorSkus[0] && result.state === 'present') {
        result.value.payload = { ...result.value.payload as Record<string, Json>, unexpectedField: 'drift' };
      }
      return result;
    });
    const harness = transactionHarness();
    await expect(executeVariationListingPermanentRemoval({ plan, remote, ...harness })).rejects.toThrow('remote state is unknown');
    expect(remote.replaceInventoryItemGroup).not.toHaveBeenCalled();
    expect(harness.checkpoints.at(-1).state).toBe('unknown');
  });

  it('refuses a pre-existing started checkpoint even when exact pre remains', async () => {
    const { remote } = remoteHarness();
    const plan = await planFixture(remote);
    const harness = transactionHarness();
    harness.checkpoints.push({ revision_id: plan.captureInput.revisionId, operation_key: 'remove-group-membership', attempt_number: 1, checkpoint_number: 1, state: 'started', observed_remote_state: null, evidence: {} });
    await expect(executeVariationListingPermanentRemoval({ plan, remote, ...harness })).rejects.toThrow('manual reconciliation');
    expect(remote.replaceInventoryItemGroup).not.toHaveBeenCalled();
    expect(harness.checkpoints).toHaveLength(1);
  });

  it('rejects foreign journal identity before any membership write', async () => {
    const { remote } = remoteHarness();
    const plan = await planFixture(remote);
    const harness = transactionHarness();
    harness.checkpoints.push({
      revision_id: '66666666-6666-4666-8666-666666666666',
      operation_key: 'remove-group-membership',
      attempt_number: 1,
      checkpoint_number: 1,
      state: 'started',
      observed_remote_state: null,
      evidence: {},
    });
    await expect(executeVariationListingPermanentRemoval({ plan, remote, ...harness })).rejects.toThrow('another revision or operation');
    expect(remote.replaceInventoryItemGroup).not.toHaveBeenCalled();
  });

  it('never issues a second replacement after an ambiguous response', async () => {
    const { remote } = remoteHarness({ failReplaceCount: 2 });
    const plan = await planFixture(remote);
    const harness = transactionHarness();
    await expect(executeVariationListingPermanentRemoval({ plan, remote, ...harness })).rejects.toThrow('response lost');
    await expect(executeVariationListingPermanentRemoval({ plan, remote, ...harness })).rejects.toThrow('manual reconciliation');
    expect(remote.replaceInventoryItemGroup).toHaveBeenCalledTimes(1);
    expect(harness.checkpoints.at(-1).state).toBe('unknown');
    expect(harness.checkpoints.map((checkpoint) => `${checkpoint.attempt_number}:${checkpoint.checkpoint_number}`)).toEqual(['1:1', '1:2']);
  });

  it('fails closed when target is stocked', async () => {
    const { remote } = remoteHarness();
    const original = remote.getInventoryItem;
    remote.getInventoryItem = vi.fn(async (sku: string) => {
      const read = await original(sku);
      if (sku === targetSku && read.state === 'present') {
        read.value.payload = { availability: { shipToLocationAvailability: { quantity: 1 } }, product: { aspects: { Card: [selectorBySku[sku]!] } } };
      }
      return read;
    });
    await expect(planFixture(remote)).rejects.toThrow('must already be zero');
  });

  it('fails closed when a survivor quantity drifts after the frozen plan', async () => {
    const { remote } = remoteHarness();
    const plan = await planFixture(remote);
    const original = remote.getInventoryItem;
    remote.getInventoryItem = vi.fn(async (sku: string) => {
      const read = await original(sku);
      if (sku === survivorSkus[0] && read.state === 'present') {
        read.value.payload = { availability: { shipToLocationAvailability: { quantity: 9 } }, product: { aspects: { Card: [selectorBySku[sku]!] } } };
      }
      return read;
    });
    const harness = transactionHarness();
    await expect(executeVariationListingPermanentRemoval({ plan, remote, ...harness })).rejects.toThrow('remote state is unknown');
    expect(remote.replaceInventoryItemGroup).not.toHaveBeenCalled();
    expect(harness.checkpoints.at(-1).state).toBe('unknown');
  });

  it('reconciles terminal membership without invoking the c2 local finalizer', async () => {
    const { remote } = remoteHarness();
    const plan = await planFixture(remote);
    const harness = transactionHarness({ failConfirmOnce: true });
    await executeVariationListingPermanentRemoval({ plan, remote, ...harness });
    expect(remote.replaceInventoryItemGroup).toHaveBeenCalledTimes(1);

    await executeVariationListingPermanentRemoval({ plan, remote, ...harness });
    expect(remote.replaceInventoryItemGroup).toHaveBeenCalledTimes(1);
    expect(harness.transaction.confirmPermanentRemoval).not.toHaveBeenCalled();
  });

  it('refuses a malformed frozen replacement without remote reads or mutation', async () => {
    const { remote } = remoteHarness();
    const plan = await planFixture(remote);
    const malformed = structuredClone(plan) as typeof plan;
    const snapshot = malformed.captureInput.snapshot as Record<string, Json>;
    const metadata = snapshot.permanentRemoval as Record<string, Json>;
    const replacement = metadata.replacementGroupPayload as Record<string, Json>;
    const variesBy = replacement.variesBy as Record<string, Json>;
    const specifications = variesBy.specifications as Array<Record<string, Json>>;
    const specification = specifications[0]!;
    specification.values = ['Card 3', 'Card X'];
    malformed.captureInput.snapshotDigest = digestUtf8(snapshot);
    const harness = transactionHarness();
    remote.getInventoryItemGroup.mockClear();
    remote.replaceInventoryItemGroup.mockClear();
    await expect(executeVariationListingPermanentRemoval({ plan: malformed, remote, ...harness })).rejects.toThrow('malformed or conflicts');
    expect(remote.getInventoryItemGroup).not.toHaveBeenCalled();
    expect(remote.replaceInventoryItemGroup).not.toHaveBeenCalled();
  });
});
