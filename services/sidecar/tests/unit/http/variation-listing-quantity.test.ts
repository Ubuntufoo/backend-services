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
import { normalizeItem, normalizeOffers, readVariationListingQuantityStatus } from '@/ebay/variation-listing-actions.js';
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

function quantityStatusHarness(
  quantityAdjustmentCounter: number,
  remoteQuantity: number,
  includeUnresolvedRevision = false,
  unresolvedState: 'started' | 'unknown' | 'retry_exhausted' = 'started',
  positions: [number, number, number] = [0, 1, 2],
) {
  const sku = 'BSKBL-Test-000001';
  const skuB = 'BSKBL-Test-000002';
  const skuC = 'BSKBL-Test-000003';
  const copyId = '44444444-4444-4444-8444-444444444444';
  const copyBId = '77777777-7777-4777-8777-777777777777';
  const copyCId = '88888888-8888-4888-8888-888888888888';
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
      next_inventory_serial: 4,
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
        pending_removal_at: null,
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
        pending_removal_at: null,
      },
      {
        variation_id: '99999999-9999-4999-8999-999999999999',
        group_id: groupId,
        inventory_serial: 3,
        position: 2,
        sku: skuC,
        selector_value: 'Card C',
        price_amount: 1.49,
        price_currency: 'USD',
        representative_copy_id: copyCId,
        variation_metadata: {},
        quantity_adjustment_counter: 0,
        pending_removal_at: null,
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
      {
        copy_id: copyCId,
        variation_id: '99999999-9999-4999-8999-999999999999',
        availability_state: 'available',
        condition_token: 'VERY_GOOD',
        condition_notes: null,
        front_r2_key: 'variation/front-c.jpg',
        back_r2_key: 'variation/back-c.jpg',
        capture_source_key: 'camera',
        capture_pair_id: 'pair-c',
        capture_front_source_ref: 'front-c',
        capture_back_source_ref: 'back-c',
        capture_started_at: now,
        captured_at: now,
        created_at: now,
        updated_at: now,
      },
    ],
  } as unknown as VariationListingAggregateSnapshot;
  current.variations.forEach((variation, index) => {
    variation.position = positions[index]!;
  });
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
  }, {
    copyId: copyCId,
    frontEpsUrl: 'https://i.ebayimg.com/images/g/front-c/s-l1600.jpg',
    backEpsUrl: 'https://i.ebayimg.com/images/g/back-c/s-l1600.jpg',
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
          offerIdsBySku: { [sku]: 'offer-1', [skuB]: 'offer-2', [skuC]: 'offer-3' },
          quantitiesBySku: {
            [sku]: { inventoryItemQuantity: remoteQuantity, offerQuantity: remoteQuantity, sellableQuantity: remoteQuantity },
            [skuB]: { inventoryItemQuantity: remoteQuantity, offerQuantity: remoteQuantity, sellableQuantity: remoteQuantity },
            [skuC]: { inventoryItemQuantity: remoteQuantity, offerQuantity: remoteQuantity, sellableQuantity: remoteQuantity },
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
  const unresolvedRevision = includeUnresolvedRevision
    ? {
      ...revisionSource,
      revision_id: '77777777-7777-4777-8777-777777777777',
      captured_desired_revision: 4,
      operation_plan: [{
        sequence_no: 1,
        operation_key: 'child-offer:variation-A',
        operation_kind: 'child_offer_write',
        target_ref: sku,
        intent_version: 1,
        intent_digest: 'c'.repeat(64),
        intent: {},
      }],
      operation_count: 1,
    } as unknown as VariationListingRevisionRow
    : null;
  const unresolvedCheckpoint = unresolvedRevision
    ? {
      ...checkpoint,
      revision_id: unresolvedRevision.revision_id,
      operation_key: 'child-offer:variation-A',
      state: unresolvedState,
      observed_remote_state: unresolvedState === 'retry_exhausted' ? 'unknown' : null,
      checkpoint_number: 1,
    } as unknown as VariationListingPublishingCheckpointRow
    : null;
  const remote = {
    getInventoryItemGroup: async () => ({ state: 'present' as const, value: { payload: bundle.group as never, variantSKUs: [sku, skuB, skuC] } }),
    getInventoryItem: async (requestedSku: string) => {
      const child = bundle.children.find((entry) => entry.sku === requestedSku)!;
      return { state: 'present' as const, value: { sku: requestedSku, groupKeys: [bundle.groupKey], payload: child.inventoryItem } };
    },
    getOffers: async (requestedSku: string) => {
      const child = bundle.children.find((entry) => entry.sku === requestedSku)!;
      return { state: 'present' as const, value: [{ sku: requestedSku, marketplaceId: 'EBAY_US', offerId: requestedSku === sku ? 'offer-1' : requestedSku === skuB ? 'offer-2' : 'offer-3', listingId: 'listing-1', status: 'PUBLISHED' as const, lifecycleClass: 'active' as const, payload: child.offer }] };
    },
  };
  return {
    data: {
      loadAggregate: async () => current,
      listRevisionsByGroupId: async () => [{ source: revisionSource }, ...(unresolvedRevision ? [{ source: unresolvedRevision }] : [])],
      listCheckpointsByRevisionId: async (revisionId: string) => revisionId === unresolvedRevision?.revision_id
        ? [{ source: unresolvedCheckpoint! }]
        : [{ source: checkpoint }],
    },
    remoteFactory: async () => ({ remote, mutations: {} as never }),
  };
}

function successfulQuantityDataAccess(initialCounter: -1 | 1) {
  const harness = quantityStatusHarness(initialCounter, 0);
  const updateVariationQuantityAdjustment = vi.fn(async ({ delta }: { delta: -1 | 1 }) => {
    const aggregate = await harness.data.loadAggregate(groupId);
    const variation = aggregate!.variations.find((row) => row.variation_id === variationId)!;
    variation.quantity_adjustment_counter += delta;
    return { group: aggregate!.group, variation };
  });
  const dataAccess = {
    loadAggregate: harness.data.loadAggregate,
    listRevisionsByGroupId: async (requestedGroupId: string) => {
      const rows = await harness.data.listRevisionsByGroupId(requestedGroupId);
      return rows.map(({ source }) => ({
        revisionId: source.revision_id,
        groupId: source.group_id,
        capturedDesiredRevision: source.captured_desired_revision,
        operationCount: source.operation_count,
        operationPlan: source.operation_plan,
        snapshotDigest: source.snapshot_digest,
        source,
      }));
    },
    listCheckpointsByRevisionId: harness.data.listCheckpointsByRevisionId,
    updateVariationQuantityAdjustment,
  } as unknown as VariationListingApiDataAccess;
  return { dataAccess, updateVariationQuantityAdjustment };
}

describe('YP10.11 confirmed condition descriptor read fallback', () => {
  it('treats explicit null descriptors as malformed rather than omitted', () => {
    expect(() => normalizeItem({
      sku: 'SKU-1',
      availability: { shipToLocationAvailability: { quantity: 0 } },
      condition: 'USED',
      conditionDescriptors: null,
      product: { aspects: {} },
    }, 'SKU-1')).toThrow();
  });

  function descriptorHarness(options: {
    listing?: unknown;
    omitted?: boolean;
    nonDescriptorDrift?: boolean;
  } = {}) {
    const harness = quantityStatusHarness(0, 1);
    const originalRevisions = harness.data.listRevisionsByGroupId;
    harness.data.listRevisionsByGroupId = async (requestedGroupId) => {
      const rows = await originalRevisions(requestedGroupId);
      return rows.map(({ source }) => {
        const revision = structuredClone(source);
        const snapshot = revision.snapshot as unknown as {
          aggregate: VariationListingAggregateSnapshot;
          confirmed: { aggregate: VariationListingAggregateSnapshot };
        };
        const descriptors = [{ name: '40001', values: ['400012'] }];
        snapshot.aggregate.group.condition_descriptors = descriptors;
        snapshot.confirmed.aggregate.group.condition_descriptors = descriptors;
        return { source: revision };
      });
    };
    const listing = options.listing ?? {
      ItemID: 'listing-1',
      ConditionID: 4000,
      ConditionDescriptors: { ConditionDescriptor: { Name: 40001, Value: [400012] } },
    };
    const getListing = vi.fn(async () => listing);
    const originalRemoteFactory = harness.remoteFactory;
    harness.remoteFactory = async () => {
      const dependencies = await originalRemoteFactory();
      const getInventoryItem = dependencies.remote.getInventoryItem;
      return {
        ...dependencies,
        remote: {
          ...dependencies.remote,
          getInventoryItem: async (sku: string) => {
            const result = await getInventoryItem(sku);
            if (result.state !== 'present') return result;
            const item = structuredClone(result.value);
            if (options.nonDescriptorDrift) {
              (item.payload as { condition: string }).condition = 'DIFFERENT';
            }
            return {
              state: 'present' as const,
              value: { ...item, conditionDescriptorsOmitted: options.omitted ?? true },
            };
          },
          getListing,
        },
      };
    };
    return { harness, getListing };
  }

  it('accepts only an omitted descriptor verified by Trading for the same listing (one read for all siblings)', async () => {
    const { harness, getListing } = descriptorHarness();
    const status = await readVariationListingQuantityStatus(harness, groupId);
    expect(status.variations).toHaveLength(3);
    expect(getListing).toHaveBeenCalledTimes(1);
    expect(getListing).toHaveBeenCalledWith('listing-1');
  });

  it('reads confirmed quantity status when surviving positions contain a deletion gap', async () => {
    const harness = quantityStatusHarness(0, 1, false, 'started', [0, 2, 3]);
    const status = await readVariationListingQuantityStatus(harness, groupId);
    expect(status.variations.map((variation) => variation.sku)).toEqual([
      'BSKBL-Test-000001',
      'BSKBL-Test-000002',
      'BSKBL-Test-000003',
    ]);
  });

  it.each([
    ['changed descriptor', { ConditionDescriptor: { Name: 40001, Value: [400011] } }],
    ['missing descriptor', {}],
  ])('rejects %s from Trading', async (_name, conditionDescriptors) => {
    const { harness } = descriptorHarness({
      listing: { ItemID: 'listing-1', ConditionID: 4000, ConditionDescriptors: conditionDescriptors },
    });
    await expect(readVariationListingQuantityStatus(harness, groupId)).rejects.toThrow('cannot be verified');
  });

  it('rejects Trading condition or listing identity changes', async () => {
    for (const listing of [
      { ItemID: 'wrong-listing', ConditionID: 4000, ConditionDescriptors: { ConditionDescriptor: { Name: 40001, Value: [400012] } } },
      { ItemID: 'listing-1', ConditionID: 2750, ConditionDescriptors: { ConditionDescriptor: { Name: 40001, Value: [400012] } } },
    ]) {
      const { harness } = descriptorHarness({ listing });
      await expect(readVariationListingQuantityStatus(harness, groupId)).rejects.toThrow('cannot be verified');
    }
  });

  it('rejects missing omission evidence and unrelated Item drift before Trading lookup', async () => {
    for (const options of [{ omitted: false }, { nonDescriptorDrift: true }]) {
      const { harness, getListing } = descriptorHarness(options);
      await expect(readVariationListingQuantityStatus(harness, groupId)).rejects.toThrow('changed outside quantity');
      expect(getListing).not.toHaveBeenCalled();
    }
  });

  it('fails closed if Trading is unavailable', async () => {
    const { harness } = descriptorHarness();
    const factory = harness.remoteFactory;
    harness.remoteFactory = async () => {
      const dependencies = await factory();
      return { ...dependencies, remote: { ...dependencies.remote, getListing: undefined } };
    };
    await expect(readVariationListingQuantityStatus(harness, groupId)).rejects.toThrow('changed outside quantity');
  });
});

describe('YP10.11 Offer read boundary policy safety', () => {
  const offer = {
    sku: 'BSKBL-Test-000001',
    offerId: 'offer-1',
    marketplaceId: 'EBAY_US',
    format: 'FIXED_PRICE',
    categoryId: '261328',
    merchantLocationKey: 'main',
    availableQuantity: 1,
    pricingSummary: { price: { currency: 'USD', value: '1.49' } },
    status: 'PUBLISHED',
    listing: { listingId: 'listing-1', listingStatus: 'ACTIVE' },
    listingPolicies: { eBayPlusIfEligible: false },
  };
  const verified = {
    listingId: 'listing-1',
    fulfillmentPolicyId: 'fulfillment',
    paymentPolicyId: 'payment',
    returnPolicyId: 'returns',
  };
  it('allows only independently verified omission, never normal Offer normalization', () => {
    expect(() => normalizeOffers({ offers: [offer] })).toThrow('fulfillment policy ID');
    expect(normalizeOffers({ offers: [offer] }, verified)[0]?.payload).toMatchObject({
      listingPolicies: {
        fulfillmentPolicyId: 'fulfillment',
        paymentPolicyId: 'payment',
        returnPolicyId: 'returns',
      },
    });
  });
  it('rejects explicit conflicting policy IDs and unrelated listing identities', () => {
    expect(() => normalizeOffers({
      offers: [{ ...offer, listingPolicies: { ...offer.listingPolicies, fulfillmentPolicyId: 'different' } }],
    }, verified)).toThrow('conflicts');
    expect(() => normalizeOffers({ offers: [offer] }, { ...verified, listingId: 'other' }))
      .toThrow('Offer policy omission lacks exact verified listing or removed-target identity.');
  });

  it('rejects incomplete Offer pagination metadata', () => {
    expect(() => normalizeOffers({ offers: [offer], next: '/offer?offset=1' }, verified)).toThrow('pagination');
    expect(() => normalizeOffers({ offers: [offer], total: 2 }, verified)).toThrow('total');
  });
});

describe('YP10.11 verified Offer policy fallback', () => {
  function harnessWithOmittedPolicies(listing: unknown = {
    ItemID: 'listing-1',
    SellerProfiles: {
      SellerShippingProfile: { ShippingProfileID: 'fulfillment' },
      SellerPaymentProfile: { PaymentProfileID: 'payment' },
      SellerReturnProfile: { ReturnProfileID: 'returns' },
    },
  }) {
    const harness = quantityStatusHarness(0, 1);
    const originalFactory = harness.remoteFactory;
    const getListing = vi.fn(async () => listing);
    const getOffersWithVerifiedPolicies = vi.fn(async (
      sku: string, _marketplace: string, verified: {
        listingId: string; fulfillmentPolicyId: string; paymentPolicyId: string; returnPolicyId: string;
      }
    ) => {
      if (verified.listingId !== 'listing-1' || verified.fulfillmentPolicyId !== 'fulfillment' ||
          verified.paymentPolicyId !== 'payment' || verified.returnPolicyId !== 'returns') {
        throw Error('Unexpected policy proof');
      }
      const original = await (await originalFactory()).remote.getOffers(sku);
      if (original.state !== 'present' || original.value.length !== 1) return original;
      const normalized = original.value[0]!;
      const rawOffer = {
        ...normalized.payload,
        offerId: normalized.offerId,
        status: normalized.status,
        listing: { listingId: normalized.listingId, listingStatus: 'ACTIVE' },
        listingPolicies: { eBayPlusIfEligible: false },
      };
      return {
        state: 'present' as const,
        value: normalizeOffers({ offers: [rawOffer] }, verified),
      };
    });
    const remoteFactory = async () => {
      const dependencies = await originalFactory();
      return {
        ...dependencies,
        remote: {
          ...dependencies.remote,
          getOffers: async () => ({ state: 'unknown' as const, reason: 'Inventory item semantic offer fulfillment policy ID is missing or invalid.' }),
          getOffersWithVerifiedPolicies,
          getListing,
        },
      };
    };
    return { harness: { ...harness, remoteFactory }, getListing, getOffersWithVerifiedPolicies };
  }

  it('accepts exact Trading policies and makes one listing read across sibling offers', async () => {
    const { harness, getListing, getOffersWithVerifiedPolicies } = harnessWithOmittedPolicies();
    const status = await readVariationListingQuantityStatus(harness, groupId);
    expect(status.variations).toHaveLength(3);
    expect(getListing).toHaveBeenCalledTimes(1);
    expect(getOffersWithVerifiedPolicies).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['incorrect policy', { ItemID: 'listing-1', SellerProfiles: {
      SellerShippingProfile: { ShippingProfileID: 'different' },
      SellerPaymentProfile: { PaymentProfileID: 'payment' },
      SellerReturnProfile: { ReturnProfileID: 'returns' },
    } }],
    ['missing policies', { ItemID: 'listing-1', SellerProfiles: {} }],
    ['wrong listing', { ItemID: 'other-listing', SellerProfiles: {
      SellerShippingProfile: { ShippingProfileID: 'fulfillment' },
      SellerPaymentProfile: { PaymentProfileID: 'payment' },
      SellerReturnProfile: { ReturnProfileID: 'returns' },
    } }],
  ])('rejects %s before Offer fallback', async (_name, listing) => {
    const { harness, getOffersWithVerifiedPolicies } = harnessWithOmittedPolicies(listing);
    await expect(readVariationListingQuantityStatus(harness, groupId)).rejects.toThrow('policies cannot be verified');
    expect(getOffersWithVerifiedPolicies).not.toHaveBeenCalled();
  });

  it('does not apply the policy fallback for unrelated Offer errors', async () => {
    const { harness, getListing } = harnessWithOmittedPolicies();
    const factory = harness.remoteFactory;
    const remoteFactory = async () => {
      const dependencies = await factory();
      return {
        ...dependencies,
        remote: {
          ...dependencies.remote,
          getOffers: async () => ({ state: 'unknown' as const, reason: 'Unrelated read failure' }),
        },
      };
    };
    await expect(readVariationListingQuantityStatus({ ...harness, remoteFactory }, groupId)).rejects.toThrow('Unrelated read failure');
    expect(getListing).not.toHaveBeenCalled();
  });
});

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

  it('rejects +1 staging for an authoritative terminal-zero SKU', async () => {
    const { dataAccess, updateVariationQuantityAdjustment } = quantityDataAccess();
    const readQuantityStatus = vi.fn(async () => ({
      groupId,
      desiredRevision: 4,
      lastConfirmedRevision: 3,
      variations: [{
        variationId,
        sku: 'BSKBL-Test-000001',
        ebayQuantity: 0,
        pendingAdjustment: 0,
        afterPublish: 0,
        soldOutRemovalEligible: false,
      }],
    }));
    const app = express();
    app.use(express.json());
    app.use('/api/variation-listings', createVariationListingApiRouter({ dataAccess, readQuantityStatus }));

    const response = await request(app)
      .patch(`/api/variation-listings/${groupId}/variations/${variationId}/quantity-adjustment`)
      .send({ expectedDesiredRevision: 4, delta: 1 });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('terminal_zero_sku_restock_forbidden');
    expect(updateVariationQuantityAdjustment).not.toHaveBeenCalled();
    expect(readQuantityStatus).toHaveBeenCalledWith(groupId, { cancelNegativeAdjustmentForVariationId: variationId });
  });

  it('rejects stale authoritative quantity evidence before +1 staging', async () => {
    const { dataAccess, updateVariationQuantityAdjustment } = quantityDataAccess();
    const readQuantityStatus = vi.fn(async () => ({
      groupId,
      desiredRevision: 5,
      lastConfirmedRevision: 3,
      variations: [{ variationId, sku: 'BSKBL-Test-000001', ebayQuantity: 1, pendingAdjustment: 0, afterPublish: 1, soldOutRemovalEligible: false }],
    }));
    const app = express();
    app.use(express.json());
    app.use('/api/variation-listings', createVariationListingApiRouter({ dataAccess, readQuantityStatus }));

    const response = await request(app)
      .patch(`/api/variation-listings/${groupId}/variations/${variationId}/quantity-adjustment`)
      .send({ expectedDesiredRevision: 4, delta: 1 });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('variation_listing_state_stale');
    expect(updateVariationQuantityAdjustment).not.toHaveBeenCalled();
  });

  it.each([
    ['remote zero', 0, 0],
    ['staged quantity already zero', 1, -1],
  ] as const)('rejects -1 staging when %s', async (_label, ebayQuantity, pendingAdjustment) => {
    const { dataAccess, updateVariationQuantityAdjustment } = quantityDataAccess();
    const readQuantityStatus = vi.fn(async () => ({
      groupId,
      desiredRevision: 4,
      lastConfirmedRevision: 3,
      variations: [{
        variationId, sku: 'BSKBL-Test-000001', ebayQuantity, pendingAdjustment,
        afterPublish: ebayQuantity + pendingAdjustment, soldOutRemovalEligible: false,
      }],
    }));
    const app = express();
    app.use(express.json());
    app.use('/api/variation-listings', createVariationListingApiRouter({ dataAccess, readQuantityStatus }));
    const response = await request(app)
      .patch(`/api/variation-listings/${groupId}/variations/${variationId}/quantity-adjustment`)
      .send({ expectedDesiredRevision: 4, delta: -1 });
    expect(response.status).toBe(409);
    expect(response.body.error).toBe('quantity_adjustment_below_zero');
    expect(updateVariationQuantityAdjustment).not.toHaveBeenCalled();
    expect(readQuantityStatus).toHaveBeenCalledWith(groupId, { cancelNegativeAdjustmentForVariationId: variationId });
  });

  it('blocks any quantity staging while permanent removal is pending', async () => {
    const { dataAccess, updateVariationQuantityAdjustment } = quantityDataAccess();
    const original = dataAccess.loadAggregate;
    dataAccess.loadAggregate = vi.fn(async (requestedGroupId) => {
      const value = await original(requestedGroupId);
      return { ...value, variations: value.variations.map((row) => ({ ...row, pending_removal_at: '2026-11-05T00:00:00Z' })) };
    }) as typeof dataAccess.loadAggregate;
    const readQuantityStatus = vi.fn();
    const app = express();
    app.use(express.json());
    app.use('/api/variation-listings', createVariationListingApiRouter({ dataAccess, readQuantityStatus }));
    const response = await request(app)
      .patch(`/api/variation-listings/${groupId}/variations/${variationId}/quantity-adjustment`)
      .send({ expectedDesiredRevision: 4, delta: 1 });
    expect(response.status).toBe(409);
    expect(response.body.error).toBe('quantity_adjustment_pending_permanent_removal');
    expect(updateVariationQuantityAdjustment).not.toHaveBeenCalled();
    expect(readQuantityStatus).not.toHaveBeenCalled();
  });

  it('permits the private exact -1 cancellation preflight while public negative status still fails closed', async () => {
    const harness = quantityStatusHarness(-1, 0);
    await expect(readVariationListingQuantityStatus(harness, groupId)).rejects.toThrow('cannot be negative');
    const status = await readVariationListingQuantityStatus({
      ...harness,
      cancelNegativeAdjustmentForVariationId: variationId,
    }, groupId);
    expect(status.variations[0]).toMatchObject({
      variationId, ebayQuantity: 0, pendingAdjustment: -1, afterPublish: -1,
    });
    await expect(readVariationListingQuantityStatus({
      ...quantityStatusHarness(-2, 0),
      cancelNegativeAdjustmentForVariationId: variationId,
    }, groupId)).rejects.toThrow('cannot be negative');
    await expect(readVariationListingQuantityStatus({
      ...quantityStatusHarness(-1, 0, true),
      cancelNegativeAdjustmentForVariationId: variationId,
    }, groupId)).rejects.toMatchObject({
      status: { code: 'quantity_projection_unavailable_reconciliation_required' },
    });
  });

  it.each([
    ['started', 'pending -1', -1, 1],
    ['started', 'pending +1', 1, -1],
    ['retry exhausted', 'pending -1', -1, 1, 'retry_exhausted'],
    ['retry exhausted', 'pending +1', 1, -1, 'retry_exhausted'],
  ] as const)('blocks exact cancellation with an older %s journal (%s)', async (_state, _label, counter, delta, unresolvedState = 'started') => {
    const harness = quantityStatusHarness(counter, 0, true, unresolvedState);
    const updateVariationQuantityAdjustment = vi.fn();
    const dataAccess = {
      ...harness.data,
      updateVariationQuantityAdjustment,
    } as unknown as VariationListingApiDataAccess;
    const readQuantityStatus = vi.fn(async (
      requestedGroupId: string,
      statusOptions?: { cancelNegativeAdjustmentForVariationId?: string },
    ) => await readVariationListingQuantityStatus({ ...harness, ...statusOptions }, requestedGroupId));
    const app = express();
    app.use(express.json());
    app.use('/api/variation-listings', createVariationListingApiRouter({ dataAccess, readQuantityStatus }));

    const response = await request(app)
      .patch(`/api/variation-listings/${groupId}/variations/${variationId}/quantity-adjustment`)
      .send({ expectedDesiredRevision: 4, delta });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe(unresolvedState === 'retry_exhausted'
      ? 'retry_exhausted'
      : 'quantity_projection_unavailable_reconciliation_required');
    expect(updateVariationQuantityAdjustment).not.toHaveBeenCalled();
    expect(readQuantityStatus).toHaveBeenCalledWith(groupId, { cancelNegativeAdjustmentForVariationId: variationId });
  });

  it.each([
    ['cancel pending +1 at remote zero', -1, 0, 1, 1, 0, true],
    ['cancel pending -1 at remote zero', 1, 0, -1, -1, 0, true],
    ['ordinary restock remains forbidden', 1, 0, 0, 0, 409, false],
    ['ordinary zero decrement remains forbidden', -1, 0, 0, 0, 409, false],
    ['multi-unit pending increase cannot be canceled past zero', -1, 0, 2, 2, 409, false],
  ] as const)('%s', async (_label, delta, ebayQuantity, pendingAdjustment, afterPublish, expectedCode, allowed) => {
    const { dataAccess, updateVariationQuantityAdjustment } = allowed
      ? successfulQuantityDataAccess(pendingAdjustment as -1 | 1)
      : quantityDataAccess();
    const readQuantityStatus = vi.fn(async () => ({
      groupId, desiredRevision: 4, lastConfirmedRevision: 3,
      variations: [{
        variationId, sku: 'BSKBL-Test-000001', ebayQuantity, pendingAdjustment,
        afterPublish, soldOutRemovalEligible: false,
      }],
    }));
    const app = express();
    app.use(express.json());
    app.use('/api/variation-listings', createVariationListingApiRouter({ dataAccess, readQuantityStatus }));
    const response = await request(app)
      .patch(`/api/variation-listings/${groupId}/variations/${variationId}/quantity-adjustment`)
      .send({ expectedDesiredRevision: 4, delta });
    expect(updateVariationQuantityAdjustment).toHaveBeenCalledTimes(allowed ? 1 : 0);
    expect(response.status).toBe(allowed ? 200 : expectedCode);
    expect(readQuantityStatus).toHaveBeenCalledWith(groupId, { cancelNegativeAdjustmentForVariationId: variationId });
  });

  it.each([
    ['cancels pending +1 at remote zero', -1, 1],
    ['cancels pending -1 at remote zero', 1, -1],
  ] as const)('returns HTTP 200 and the updated aggregate when it %s', async (_label, initialCounter, delta) => {
    const { dataAccess, updateVariationQuantityAdjustment } = successfulQuantityDataAccess(initialCounter);
    const readQuantityStatus = vi.fn(async () => ({
      groupId, desiredRevision: 4, lastConfirmedRevision: 3,
      variations: [{
        variationId, sku: 'BSKBL-Test-000001', ebayQuantity: 0,
        pendingAdjustment: initialCounter, afterPublish: initialCounter,
        soldOutRemovalEligible: false,
      }],
    }));
    const app = express();
    app.use(express.json());
    app.use('/api/variation-listings', createVariationListingApiRouter({ dataAccess, readQuantityStatus }));

    const response = await request(app)
      .patch(`/api/variation-listings/${groupId}/variations/${variationId}/quantity-adjustment`)
      .send({ expectedDesiredRevision: 4, delta });

    expect(response.status).toBe(200);
    expect(response.body.variations.find((row: { variationId: string }) => row.variationId === variationId))
      .toMatchObject({ variationId, quantityAdjustmentCounter: 0 });
    expect(updateVariationQuantityAdjustment).toHaveBeenCalledWith({
      groupId, variationId, expectedDesiredRevision: 4, delta,
    });
    expect(readQuantityStatus).toHaveBeenCalledWith(groupId, { cancelNegativeAdjustmentForVariationId: variationId });
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

  it.each([
    ['both sources zero', 0, 0, 0, true],
    ['Item zero but Offer stocked', 0, 1, 0, false],
    ['Offer zero but Item stocked', 1, 0, 0, false],
    ['both sources stocked', 1, 1, 0, false],
    ['pending positive adjustment', 0, 0, 1, false],
    ['staged removal', 0, 0, 0, false],
  ] as const)('exposes removal eligibility only for %s', async (_label, itemQty, offerQty, counter, expected) => {
    const harness = quantityStatusHarness(counter, 0);
    const aggregate = await harness.data.loadAggregate(groupId);
    const confirmed = (await harness.data.listRevisionsByGroupId(groupId))[0]!.source;
    aggregate.group.desired_revision = counter === 0 ? 3 : 4;
    if (_label === 'staged removal') aggregate.variations[0]!.pending_removal_at = '2026-10-22T00:00:00.000Z';
    // Exercise both actual remote payload quantities while keeping the
    // lower sellable quantity at zero in EVERY row.
    const remote = (await harness.remoteFactory()).remote;
    const originalItem = remote.getInventoryItem;
    const originalOffers = remote.getOffers;
    remote.getInventoryItem = async (sku: string) => {
      const result = await originalItem(sku);
      if (sku === 'BSKBL-Test-000001' && result.state === 'present') {
        (result.value.payload.availability.shipToLocationAvailability as {quantity: number}).quantity = itemQty;
      }
      return result;
    };
    remote.getOffers = async (sku: string) => {
      const result = await originalOffers(sku);
      if (sku === 'BSKBL-Test-000001' && result.state === 'present') result.value[0]!.payload.availableQuantity = offerQty;
      return result;
    };
    harness.remoteFactory = async () => ({remote, mutations: {} as never});
    const status = await readVariationListingQuantityStatus(harness, groupId);
    expect(status.variations.find((entry) => entry.variationId === variationId)?.soldOutRemovalEligible).toBe(expected);
    expect(confirmed.captured_desired_revision).toBe(3);
  });

  it('rejects a negative projection but permits recovery after a later +1', async () => {
    await expect(readVariationListingQuantityStatus(
      quantityStatusHarness(-1, 0),
      groupId,
    )).rejects.toThrow('Variation listing projected quantity for BSKBL-Test-000001 cannot be negative.');

    const recovered = await readVariationListingQuantityStatus(quantityStatusHarness(0, 0), groupId);
    expect(recovered.variations[0]?.afterPublish).toBe(0);
  });

  it('returns a structured 409 when a negative projection has an unresolved publication', async () => {
    const harness = quantityStatusHarness(-1, 0, true);
    await expect(readVariationListingQuantityStatus(harness, groupId)).rejects.toMatchObject({
      httpStatus: 409,
      status: {
        code: 'quantity_projection_unavailable_reconciliation_required',
        operationKey: 'child-offer:variation-A',
        revisionId: '77777777-7777-4777-8777-777777777777',
        remoteState: 'unknown',
        requiresReconciliation: true,
        retryStatus: 'reconciliation_required',
      },
    });

    const app = express();
    app.use(express.json());
    app.use('/api/variation-listings', createVariationListingApiRouter({
      readQuantityStatus: async (requestedGroupId) => readVariationListingQuantityStatus(harness, requestedGroupId),
    }));
    const response = await request(app).get(`/api/variation-listings/${groupId}/quantity-status`);
    expect(response.status).toBe(409);
    expect(response.body.error).toBe('quantity_projection_unavailable_reconciliation_required');
    expect(response.body.status.operationKey).toBe('child-offer:variation-A');
    expect(response.body.status.revisionId).toBe('77777777-7777-4777-8777-777777777777');
  });

  it.each([
    ['missing final proof', false, 'unknown', true, 'reconciliation_required'],
    ['terminal final proof with stale watermark', true, 'known_changed', false, 'safe_to_retry'],
  ] as const)('returns a structured 409 for remote zero plus staged -1 with %s', async (_label, terminal, remoteState, requiresReconciliation, retryStatus) => {
    const harness = quantityStatusHarness(-1, 0);
    const rows = await harness.data.listRevisionsByGroupId(groupId);
    const confirmed = rows[0]!.source;
    const newer = structuredClone(confirmed);
    newer.revision_id = `synthetic-${terminal ? 'terminal' : 'missing'}`;
    newer.captured_desired_revision = 4;
    newer.operation_plan = [
      { sequence_no: 1, operation_key: 'child-offer:variation-A', operation_kind: 'child_offer_write', target_ref: 'BSKBL-Test-000001', intent_version: 1, intent_digest: 'c'.repeat(64), intent: {} },
      { sequence_no: 2, operation_key: 'revision-reconcile', operation_kind: 'revision_reconcile', target_ref: 'group', intent_version: 1, intent_digest: 'd'.repeat(64), intent: {} },
    ];
    newer.operation_count = 2;
    const child = { ...(await harness.data.listCheckpointsByRevisionId(confirmed.revision_id))[0]!.source, revision_id: newer.revision_id, operation_key: 'child-offer:variation-A', state: 'confirmed_complete' as const, observed_remote_state: 'present' as const };
    const final = { ...child, operation_key: 'revision-reconcile' };
    harness.data.listRevisionsByGroupId = async () => [{ source: confirmed }, { source: newer }];
    harness.data.listCheckpointsByRevisionId = async (revisionId: string) => revisionId === newer.revision_id
      ? [{ source: child }, ...(terminal ? [{ source: final }] : [])]
      : await quantityStatusHarness(-1, 0).data.listCheckpointsByRevisionId(revisionId);

    await expect(readVariationListingQuantityStatus({ ...harness, cancelNegativeAdjustmentForVariationId: variationId }, groupId)).rejects.toMatchObject({
      httpStatus: 409,
      status: {
        code: 'quantity_projection_unavailable_reconciliation_required',
        operationKey: 'revision-reconcile',
        remoteState,
        requiresReconciliation,
        retryStatus,
      },
    });
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
        soldOutRemovalEligible: false,
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
        soldOutRemovalEligible: false,
      }],
    });
  });
});
