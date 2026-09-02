import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import {
  VariationListingTransactionConflictError,
  type VariationListingAggregateSnapshot,
  type VariationListingPublishingCheckpoint,
  type VariationListingRevision,
} from '@ebay-inventory/data';

import {
  createVariationListingApiRouter,
  type VariationListingApiDataAccess,
} from '@/http/variation-listing-router.js';

const groupId = '11111111-1111-4111-8111-111111111111';
const variationA = '22222222-2222-4222-8222-222222222222';
const variationB = '33333333-3333-4333-8333-333333333333';
const copyA = '44444444-4444-4444-8444-444444444444';
const copyB = '55555555-5555-4555-8555-555555555555';
const now = '2026-09-02T02:00:00.000Z';

function aggregate(): VariationListingAggregateSnapshot {
  return {
    group: {
      group_id: groupId,
      group_key: 'VL-G-11111111111141118111111111111111',
      sku_category_code: 'BSKBL',
      sku_bucket_token: 'McGrady',
      next_inventory_serial: 3,
      lifecycle_state: 'active',
      selector_name: 'Card',
      title: 'Tracy McGrady Cards',
      description: 'Pick your card.',
      derived_common_ebay_aspects: { Sport: ['Basketball'] },
      category_id: '261328',
      marketplace_id: 'EBAY_US',
      listing_format: 'FIXED_PRICE',
      merchant_location_key: 'main',
      fulfillment_policy_id: 'fulfillment',
      payment_policy_id: 'payment',
      return_policy_id: 'returns',
      condition_id: '4000',
      condition_token: 'VERY_GOOD',
      condition_description: null,
      condition_descriptors: [],
      desired_revision: 4,
      last_confirmed_revision: 3,
      created_at: now,
      updated_at: now,
    },
    variations: [
      {
        variation_id: variationB,
        group_id: groupId,
        inventory_serial: 2,
        sku: 'BSKBL-McGrady-000002',
        position: 1,
        selector_value: '2003 Topps Chrome',
        price_amount: 1.49,
        price_currency: 'USD',
        representative_copy_id: copyB,
        variation_metadata: { year: '2003' },
        created_at: now,
        updated_at: now,
      },
      {
        variation_id: variationA,
        group_id: groupId,
        inventory_serial: 1,
        sku: 'BSKBL-McGrady-000001',
        position: 0,
        selector_value: '1998 Topps',
        price_amount: 0.99,
        price_currency: 'USD',
        representative_copy_id: copyA,
        variation_metadata: { year: '1998' },
        created_at: now,
        updated_at: now,
      },
    ],
    copies: [
      {
        copy_id: copyA,
        variation_id: variationA,
        availability_state: 'available',
        condition_token: 'VERY_GOOD',
        condition_notes: null,
        front_r2_key: 'variation-listing/a/front-a.jpg',
        back_r2_key: 'variation-listing/a/back-a.jpg',
        capture_source_key: 'camera',
        capture_pair_id: '66666666-6666-4666-8666-666666666666',
        capture_front_source_ref: 'front-a',
        capture_back_source_ref: 'back-a',
        capture_started_at: now,
        captured_at: now,
        created_at: now,
        updated_at: now,
      },
      {
        copy_id: copyB,
        variation_id: variationB,
        availability_state: 'unavailable',
        condition_token: 'VERY_GOOD',
        condition_notes: null,
        front_r2_key: 'variation-listing/b/front-b.jpg',
        back_r2_key: 'variation-listing/b/back-b.jpg',
        capture_source_key: 'camera',
        capture_pair_id: '77777777-7777-4777-8777-777777777777',
        capture_front_source_ref: 'front-b',
        capture_back_source_ref: 'back-b',
        capture_started_at: now,
        captured_at: now,
        created_at: now,
        updated_at: now,
      },
    ],
  } as unknown as VariationListingAggregateSnapshot;
}

function latestRevision(): VariationListingRevision {
  return {
    capturedDesiredRevision: 4,
    groupId,
    operationCount: 2,
    operationPlan: [
      {
        sequence_no: 1,
        operation_key: 'child-offer:1',
        operation_kind: 'child_offer_write',
        target_ref: 'BSKBL-McGrady-000001',
        intent_version: 1,
        intent_digest: 'a'.repeat(64),
        intent: {},
      },
      {
        sequence_no: 2,
        operation_key: 'reconcile',
        operation_kind: 'revision_reconcile',
        target_ref: 'VL-G-11111111111141118111111111111111',
        intent_version: 1,
        intent_digest: 'b'.repeat(64),
        intent: {},
      },
    ],
    revisionId: '88888888-8888-4888-8888-888888888888',
    snapshotDigest: 'c'.repeat(64),
    source: { captured_at: now },
  } as unknown as VariationListingRevision;
}

function checkpoint(): VariationListingPublishingCheckpoint {
  return {
    attemptNumber: 1,
    checkpointId: '99999999-9999-4999-8999-999999999999',
    checkpointNumber: 2,
    evidence: { exact: true },
    observedRemoteState: 'present',
    operationKey: 'child-offer:1',
    revisionId: '88888888-8888-4888-8888-888888888888',
    source: {},
    state: 'confirmed_complete',
  } as unknown as VariationListingPublishingCheckpoint;
}

function dataAccess(overrides: Partial<VariationListingApiDataAccess> = {}): VariationListingApiDataAccess {
  const current = aggregate();
  return {
    listGroups: vi.fn(async () => [
      { groupId, source: current.group } as unknown as Awaited<ReturnType<VariationListingApiDataAccess['listGroups']>>[number],
    ]),
    loadAggregate: vi.fn(async () => current),
    listRevisionsByGroupId: vi.fn(async () => [latestRevision()]),
    listCheckpointsByRevisionId: vi.fn(async () => [checkpoint()]),
    createGroup: vi.fn(async () => current.group),
    applyGroupReviewDraft: vi.fn(async () => current.group),
    updateVariationPrice: vi.fn(async () => ({ group: current.group, variation: current.variations[0]! })),
    updateCopyAvailability: vi.fn(async () => ({ group: current.group, copy: current.copies[0]! })),
    updateRepresentativeCopy: vi.fn(async () => ({ group: current.group, variation: current.variations[0]! })),
    ...overrides,
  };
}

function app(access: VariationListingApiDataAccess, createId?: () => string) {
  const instance = express();
  instance.use(express.json());
  instance.use('/api/variation-listings', createVariationListingApiRouter({ dataAccess: access, createId }));
  return instance;
}

describe('YP6.1 variation listing API router', () => {
  it('returns ordered variations, derived quantities, readiness, and a concise journal summary', async () => {
    const response = await request(app(dataAccess())).get(`/api/variation-listings/${groupId}`);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      groupId,
      lifecycleState: 'active',
      desiredRevision: 4,
      lastConfirmedRevision: 3,
      variationCount: 2,
      totalAvailableQuantity: 1,
      validation: { hasPendingChanges: true },
      journal: {
        latestRevision: {
          capturedDesiredRevision: 4,
          operationCount: 2,
          hasUnknownOutcome: false,
          retryExhausted: false,
        },
      },
    });
    expect(response.body.variations.map((variation: { variationId: string }) => variation.variationId)).toEqual([
      variationA,
      variationB,
    ]);
    expect(response.body.variations[0]).toMatchObject({ priceAmount: 0.99, availableQuantity: 1, copyCount: 1 });
    expect(response.body.variations[1]).toMatchObject({ priceAmount: 1.49, availableQuantity: 0, copyCount: 1 });
    expect(JSON.stringify(response.body)).not.toContain('soldcomps');
    expect(JSON.stringify(response.body)).not.toContain('browsePricing');
  });

  it('blocks initial readiness when required common Sport is not truthful', async () => {
    const current = aggregate();
    current.group.derived_common_ebay_aspects = {};
    const response = await request(
      app(dataAccess({ loadAggregate: vi.fn(async () => current) }))
    ).get(`/api/variation-listings/${groupId}`);

    expect(response.status).toBe(200);
    expect(response.body.validation.initialPublicationReady).toBe(false);
    expect(response.body.validation.blockers).toContain(
      'Required common eBay aspect Sport has no truthful value across every variation.'
    );
  });

  it('blocks initial readiness when an available copy is below group condition', async () => {
    const current = aggregate();
    current.group.condition_token = 'EXCELLENT';
    const response = await request(
      app(dataAccess({ loadAggregate: vi.fn(async () => current) }))
    ).get(`/api/variation-listings/${groupId}`);

    expect(response.status).toBe(200);
    expect(response.body.validation.initialPublicationReady).toBe(false);
    expect(response.body.validation.blockers).toContain(
      '1 available physical copy/copies are below the group\'s shared condition tier.'
    );
  });

  it('serializes an empty intake group without invoking review validation', async () => {
    const current = aggregate();
    current.variations = [];
    current.copies = [];
    const access = dataAccess({ loadAggregate: vi.fn(async () => current) });
    const response = await request(app(access)).get(`/api/variation-listings/${groupId}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      variationCount: 0,
      totalAvailableQuantity: 0,
      validation: {
        initialPublicationReady: false,
        blockers: ['Variation listing publish readiness requires at least two variations.'],
      },
    });
  });

  it('creates group identity server-side and delegates only the approved creation contract', async () => {
    const access = dataAccess();
    const response = await request(app(access, () => groupId))
      .post('/api/variation-listings')
      .send({
        skuCategoryCode: 'BSKBL',
        skuBucketToken: 'McGrady',
        merchantLocationKey: 'main',
        fulfillmentPolicyId: 'fulfillment',
        paymentPolicyId: 'payment',
        returnPolicyId: 'returns',
        conditionId: '4000',
        conditionToken: 'VERY_GOOD',
      });
    expect(response.status).toBe(201);
    expect(access.createGroup).toHaveBeenCalledWith({
      groupId,
      groupKey: 'VL-G-11111111111141118111111111111111',
      skuCategoryCode: 'BSKBL',
      skuBucketToken: 'McGrady',
      categoryId: '261328',
      marketplaceId: 'EBAY_US',
      merchantLocationKey: 'main',
      fulfillmentPolicyId: 'fulfillment',
      paymentPolicyId: 'payment',
      returnPolicyId: 'returns',
      conditionId: '4000',
      conditionToken: 'VERY_GOOD',
    });
  });

  it('maps manual price edits and rejects unsupported tiers before persistence', async () => {
    const access = dataAccess();
    const good = await request(app(access))
      .patch(`/api/variation-listings/${groupId}/variations/${variationA}/price`)
      .send({ expectedDesiredRevision: 4, priceAmount: 1.99 });
    expect(good.status).toBe(200);
    expect(access.updateVariationPrice).toHaveBeenCalledWith({
      groupId,
      variationId: variationA,
      expectedDesiredRevision: 4,
      priceAmount: 1.99,
    });

    vi.mocked(access.updateVariationPrice).mockClear();
    const invalid = await request(app(access))
      .patch(`/api/variation-listings/${groupId}/variations/${variationA}/price`)
      .send({ expectedDesiredRevision: 4, priceAmount: 2.99 });
    expect(invalid.status).toBe(400);
    expect(access.updateVariationPrice).not.toHaveBeenCalled();
  });

  it('maps stale CAS edits to a stable 409 response', async () => {
    const access = dataAccess({
      updateCopyAvailability: vi.fn(async () => {
        throw new VariationListingTransactionConflictError('VR001', 'stale desired revision');
      }),
    });
    const response = await request(app(access))
      .patch(`/api/variation-listings/${groupId}/variations/${variationA}/copies/${copyA}/availability`)
      .send({ expectedDesiredRevision: 3, availabilityState: 'unavailable' });
    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: 'variation_listing_state_stale',
      message: 'stale desired revision',
    });
  });

  it('maps representative-copy and review-draft edits through existing RPC-shaped seams', async () => {
    const access = dataAccess();
    const representative = await request(app(access))
      .patch(`/api/variation-listings/${groupId}/variations/${variationA}/representative-copy`)
      .send({ expectedDesiredRevision: 4, copyId: copyA });
    expect(representative.status).toBe(200);
    expect(access.updateRepresentativeCopy).toHaveBeenCalledWith({
      groupId,
      variationId: variationA,
      copyId: copyA,
      expectedDesiredRevision: 4,
    });

    const review = await request(app(access))
      .patch(`/api/variation-listings/${groupId}/review-draft`)
      .send({
        expectedDesiredRevision: 4,
        title: 'Updated title',
        description: 'Updated description',
        derivedCommonEbayAspects: { Manufacturer: 'Topps' },
      });
    expect(review.status).toBe(200);
    expect(access.applyGroupReviewDraft).toHaveBeenCalledWith({
      groupId,
      expectedDesiredRevision: 4,
      title: 'Updated title',
      description: 'Updated description',
      derivedCommonEbayAspects: { Manufacturer: 'Topps' },
    });
  });
});
