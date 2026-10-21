import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type {
  VariationListingAggregateSnapshot,
  VariationListingPublishingCheckpointRow,
  VariationListingRevisionRow,
} from '@ebay-inventory/data';

import {
  createVariationListingApiRouter,
  type VariationListingApiDataAccess,
} from '@/http/variation-listing-router.js';
import { readVariationListingQuantityStatus } from '@/ebay/variation-listing-actions.js';
import { buildVariationListingHistoricalInventoryPayloadBundle } from '@/ebay/variation-listing-payloads.js';
import { updateVariationListingQuantityAdjustmentRequestSchema } from '@/schemas/variation-listing-api.js';

const groupId = '11111111-1111-4111-8111-111111111111';
const variationId = '22222222-2222-4222-8222-222222222222';
const confirmedVariationId = '33333333-3333-4333-8333-333333333333';

function quantityDataAccess(options: { desiredRevision?: number; confirmedId?: string } = {}) {
  const aggregate = {
    group: {
      group_id: groupId,
      desired_revision: options.desiredRevision ?? 4,
      last_confirmed_revision: 3,
      lifecycle_state: 'active',
    },
    variations: [{ variation_id: variationId, sku: 'BSKBL-Test-000001' }],
    copies: [],
  };
  const revision = {
    revision_id: '44444444-4444-4444-8444-444444444444',
    group_id: groupId,
    captured_desired_revision: 3,
    snapshot_version: 1,
    snapshot: {
      aggregate: {
        group: { group_id: groupId },
        variations: [{
          variation_id: options.confirmedId ?? variationId,
          sku: 'BSKBL-Test-000001',
          quantity_adjustment_counter: 0,
        }],
      },
    },
  };
  const updateVariationQuantityAdjustment = vi.fn(async () => ({
    group: aggregate.group,
    variation: aggregate.variations[0],
  }));
  const dataAccess = {
    loadAggregate: vi.fn(async () => aggregate),
    listRevisionsByGroupId: vi.fn(async () => [{ source: revision }]),
    updateVariationQuantityAdjustment,
  } as unknown as VariationListingApiDataAccess;
  return { dataAccess, updateVariationQuantityAdjustment };
}

function quantityStatusHarness(quantityAdjustmentCounter: number, remoteQuantity: number) {
  const sku = 'BSKBL-Test-000001';
  const skuB = 'BSKBL-Test-000002';
  const copyId = '44444444-4444-4444-8444-444444444444';
  const copyBId = '77777777-7777-4777-8777-777777777777';
  const now = '2026-09-02T00:00:00.000Z';
  const current = {
    group: {
      group_id: groupId,
      group_key: 'VL-G-11111111111141118111111111111111',
      sku_category_code: 'BSKBL',
      sku_bucket_token: 'Test',
      category_id: '261328',
      marketplace_id: 'EBAY_US',
      merchant_location_key: 'main',
      fulfillment_policy_id: 'fulfillment',
      payment_policy_id: 'payment',
      return_policy_id: 'returns',
      condition_id: '4000',
      condition_token: 'VERY_GOOD',
      condition_description: null,
      condition_descriptors: [],
      derived_common_ebay_aspects: { Sport: ['Basketball'] },
      description: 'Cards',
      desired_revision: 4,
      last_confirmed_revision: 3,
      lifecycle_state: 'active',
      listing_format: 'FIXED_PRICE',
      selector_name: 'Card',
      next_inventory_serial: 2,
      title: 'Cards',
      created_at: now,
      updated_at: now,
    },
    variations: [
      {
        variation_id: variationId,
        group_id: groupId,
        inventory_serial: 1,
        position: 0,
        sku,
        selector_value: 'Card A',
        price_amount: 1.49,
        price_currency: 'USD',
        representative_copy_id: copyId,
        variation_metadata: {},
        quantity_adjustment_counter: quantityAdjustmentCounter,
        created_at: now,
        updated_at: now,
      },
      {
        variation_id: confirmedVariationId,
        group_id: groupId,
        inventory_serial: 2,
        position: 1,
        sku: skuB,
        selector_value: 'Card B',
        price_amount: 1.49,
        price_currency: 'USD',
        representative_copy_id: copyBId,
        variation_metadata: {},
        quantity_adjustment_counter: 0,
        created_at: now,
        updated_at: now,
      },
    ],
    copies: [
      {
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
        capture_started_at: now,
        captured_at: now,
        created_at: now,
        updated_at: now,
      },
      {
        copy_id: copyBId,
        variation_id: confirmedVariationId,
        availability_state: 'available',
        condition_token: 'VERY_GOOD',
        condition_notes: null,
        front_r2_key: 'variation/front-b.jpg',
        back_r2_key: 'variation/back-b.jpg',
        capture_source_key: 'camera',
        capture_pair_id: 'pair-b',
        capture_front_source_ref: 'front-b',
        capture_back_source_ref: 'back-b',
        capture_started_at: now,
        captured_at: now,
        created_at: now,
        updated_at: now,
      },
    ],
  } as unknown as VariationListingAggregateSnapshot;
  const confirmed = structuredClone(current);
  confirmed.group.desired_revision = 3;
  confirmed.variations[0]!.quantity_adjustment_counter = 0;
  const representativeImages = [{
    copyId,
    frontEpsUrl: 'https://i.ebayimg.com/images/g/front/s-l1600.jpg',
    backEpsUrl: 'https://i.ebayimg.com/images/g/back/s-l1600.jpg',
  }, {
    copyId: copyBId,
    frontEpsUrl: 'https://i.ebayimg.com/images/g/front-b/s-l1600.jpg',
    backEpsUrl: 'https://i.ebayimg.com/images/g/back-b/s-l1600.jpg',
  }];
  const bundle = buildVariationListingHistoricalInventoryPayloadBundle({ aggregate: confirmed, representativeImages });
  for (const child of bundle.children) {
    (child.inventoryItem.availability.shipToLocationAvailability as Record<string, unknown>).quantity = remoteQuantity;
    child.offer.availableQuantity = remoteQuantity;
    child.quantity = remoteQuantity;
  }
  const revisionSource = {
    revision_id: '55555555-5555-4555-8555-555555555555',
    group_id: groupId,
    captured_desired_revision: 3,
    snapshot_version: 3,
    snapshot: {
      aggregate: confirmed,
      confirmed: {
        aggregate: confirmed,
        representativeImages,
        remote: {
          listingId: 'listing-1',
          offerIdsBySku: { [sku]: 'offer-1', [skuB]: 'offer-2' },
          quantitiesBySku: {
            [sku]: { inventoryItemQuantity: remoteQuantity, offerQuantity: remoteQuantity, sellableQuantity: remoteQuantity },
            [skuB]: { inventoryItemQuantity: remoteQuantity, offerQuantity: remoteQuantity, sellableQuantity: remoteQuantity },
          },
        },
        revisionId: '55555555-5555-4555-8555-555555555555',
      },
      mediaResources: [],
      representativeImages,
    },
    operation_plan: [{
      sequence_no: 1,
      operation_key: 'revision-reconcile',
      operation_kind: 'revision_reconcile',
      target_ref: bundle.groupKey,
      intent_version: 1,
      intent_digest: 'a'.repeat(64),
      intent: {},
    }],
    operation_count: 1,
    snapshot_digest: 'b'.repeat(64),
    captured_at: now,
  } as unknown as VariationListingRevisionRow;
  const checkpoint = {
    revision_id: revisionSource.revision_id,
    operation_key: 'revision-reconcile',
    checkpoint_id: '66666666-6666-4666-8666-666666666666',
    attempt_number: 1,
    checkpoint_number: 1,
    state: 'confirmed_complete',
    observed_remote_state: 'present',
    evidence: { listingId: 'listing-1' },
    created_at: now,
  } as unknown as VariationListingPublishingCheckpointRow;
  const remote = {
    getInventoryItemGroup: async () => ({ state: 'present' as const, value: { payload: bundle.group as never, variantSKUs: [sku, skuB] } }),
    getInventoryItem: async (requestedSku: string) => {
      const child = bundle.children.find((entry) => entry.sku === requestedSku)!;
      return { state: 'present' as const, value: { sku: requestedSku, groupKeys: [bundle.groupKey], payload: child.inventoryItem } };
    },
    getOffers: async (requestedSku: string) => {
      const child = bundle.children.find((entry) => entry.sku === requestedSku)!;
      return { state: 'present' as const, value: [{ sku: requestedSku, marketplaceId: 'EBAY_US', offerId: requestedSku === sku ? 'offer-1' : 'offer-2', listingId: 'listing-1', status: 'PUBLISHED' as const, lifecycleClass: 'active' as const, payload: child.offer }] };
    },
  };
  return {
    data: {
      loadAggregate: async () => current,
      listRevisionsByGroupId: async () => [{ source: revisionSource }],
      listCheckpointsByRevisionId: async () => [{ source: checkpoint }],
    },
    remoteFactory: async () => ({ remote, mutations: {} as never }),
  };
}

describe('YP9.6b2 quantity API', () => {
  it.each([-1, 1] as const)('accepts delta %i and rejects arbitrary quantity edits', (delta) => {
    expect(updateVariationListingQuantityAdjustmentRequestSchema.safeParse({
      expectedDesiredRevision: 4,
      delta,
    }).success).toBe(true);
  });

  it('rejects a delta outside ±1', () => {
    expect(updateVariationListingQuantityAdjustmentRequestSchema.safeParse({
      expectedDesiredRevision: 4,
      delta: 2,
    }).success).toBe(false);
  });

  it('rejects a stale desired revision before invoking the quantity CAS RPC', async () => {
    const { dataAccess, updateVariationQuantityAdjustment } = quantityDataAccess({ desiredRevision: 5 });
    const app = express();
    app.use(express.json());
    app.use('/api/variation-listings', createVariationListingApiRouter({ dataAccess }));

    const response = await request(app)
      .patch(`/api/variation-listings/${groupId}/variations/${variationId}/quantity-adjustment`)
      .send({ expectedDesiredRevision: 4, delta: 1 });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('variation_listing_state_stale');
    expect(updateVariationQuantityAdjustment).not.toHaveBeenCalled();
  });

  it('rejects a newly added variation before invoking the quantity CAS RPC', async () => {
    const { dataAccess, updateVariationQuantityAdjustment } = quantityDataAccess({ confirmedId: confirmedVariationId });
    const app = express();
    app.use(express.json());
    app.use('/api/variation-listings', createVariationListingApiRouter({ dataAccess }));

    const response = await request(app)
      .patch(`/api/variation-listings/${groupId}/variations/${variationId}/quantity-adjustment`)
      .send({ expectedDesiredRevision: 4, delta: -1 });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('quantity_adjustment_requires_confirmed_variation');
    expect(updateVariationQuantityAdjustment).not.toHaveBeenCalled();
  });

  it('rejects a positive projection above the signed int32 maximum', async () => {
    await expect(readVariationListingQuantityStatus(
      quantityStatusHarness(2_147_483_647, 1),
      groupId,
    )).rejects.toThrow('projected quantity');
  });

  it('rejects an out-of-range remote eBay quantity', async () => {
    await expect(readVariationListingQuantityStatus(
      quantityStatusHarness(0, 2_147_483_648),
      groupId,
    )).rejects.toThrow('quantity');
  });

  it('retains a negative projection for recovery with a later +1', async () => {
    const status = await readVariationListingQuantityStatus(quantityStatusHarness(-1, 0), groupId);
    expect(status.variations[0]?.afterPublish).toBe(-1);
  });

  it('fails closed when the confirmed watermark changes during the eBay read', async () => {
    const harness = quantityStatusHarness(1, 1);
    const initial = await harness.data.loadAggregate(groupId);
    if (!initial) throw new Error('test aggregate missing');
    harness.data.loadAggregate = vi.fn()
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce({
        ...initial,
        group: { ...initial.group, last_confirmed_revision: 4 },
      });

    await expect(readVariationListingQuantityStatus(harness, groupId)).rejects.toMatchObject({
      name: 'VariationListingTransactionConflictError',
      code: 'variation_listing_state_stale',
    });
  });

  it('returns injected read-only authoritative quantity status', async () => {
    const groupId = '11111111-1111-4111-8111-111111111111';
    const readQuantityStatus = vi.fn(async () => ({
      groupId,
      desiredRevision: 4,
      lastConfirmedRevision: 3,
      variations: [{
        variationId: '22222222-2222-4222-8222-222222222222',
        sku: 'BSKBL-Test-000001',
        ebayQuantity: 1,
        pendingAdjustment: 1,
        afterPublish: 2,
      }],
    }));
    const app = express();
    app.use(express.json());
    app.use('/api/variation-listings', createVariationListingApiRouter({readQuantityStatus}));

    const response = await request(app).get(`/api/variation-listings/${groupId}/quantity-status`);

    expect(response.status).toBe(200);
    expect(readQuantityStatus).toHaveBeenCalledWith(groupId);
    expect(response.body).toEqual({
      groupId,
      desiredRevision: 4,
      lastConfirmedRevision: 3,
      variations: [{
        variationId: '22222222-2222-4222-8222-222222222222',
        sku: 'BSKBL-Test-000001',
        ebayQuantity: 1,
        pendingAdjustment: 1,
        afterPublish: 2,
      }],
    });
  });
});
