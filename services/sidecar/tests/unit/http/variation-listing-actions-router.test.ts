import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { VariationListingAggregateSnapshot } from '@ebay-inventory/data';

import {
  createVariationListingApiRouter,
  type VariationListingApiActions,
  type VariationListingApiDataAccess,
} from '@/http/variation-listing-router.js';
import { VariationListingActionError } from '@/ebay/variation-listing-actions.js';

const groupId = '11111111-1111-4111-8111-111111111111';
const variationId = '22222222-2222-4222-8222-222222222222';
const copyId = '33333333-3333-4333-8333-333333333333';

function aggregate(): VariationListingAggregateSnapshot {
  return {
    group: {
      group_id: groupId, group_key: 'VL-G-11111111111141118111111111111111', sku_category_code: 'BSKBL', sku_bucket_token: 'Cards', next_inventory_serial: 2,
      lifecycle_state: 'active', selector_name: 'Card', title: 'Cards', description: 'Pick a card', derived_common_ebay_aspects: { Sport: ['Basketball'] },
      category_id: '261328', marketplace_id: 'EBAY_US', listing_format: 'FIXED_PRICE', merchant_location_key: 'main', fulfillment_policy_id: 'f', payment_policy_id: 'p', return_policy_id: 'r',
      condition_id: '4000', condition_token: 'VERY_GOOD', condition_description: null, condition_descriptors: [], desired_revision: 4, last_confirmed_revision: 3,
      created_at: '2026-09-02T00:00:00Z', updated_at: '2026-09-02T00:00:00Z',
    },
    variations: [{ variation_id: variationId, group_id: groupId, inventory_serial: 1, position: 0, sku: 'BSKBL-Cards-000001', selector_value: 'Card A', price_amount: 1.49, price_currency: 'USD', representative_copy_id: copyId, variation_metadata: {}, created_at: '2026-09-02T00:00:00Z', updated_at: '2026-09-02T00:00:00Z' }],
    copies: [{ copy_id: copyId, variation_id: variationId, availability_state: 'available', condition_token: 'VERY_GOOD', condition_notes: null, front_r2_key: 'front.jpg', back_r2_key: 'back.jpg', capture_source_key: 'camera', capture_pair_id: 'pair', capture_front_source_ref: 'front', capture_back_source_ref: 'back', capture_started_at: '2026-09-02T00:00:00Z', captured_at: '2026-09-02T00:00:00Z', created_at: '2026-09-02T00:00:00Z', updated_at: '2026-09-02T00:00:00Z' }],
  } as unknown as VariationListingAggregateSnapshot;
}

function access(): VariationListingApiDataAccess {
  const current = aggregate();
  return {
    listGroups: vi.fn(async () => []),
    loadAggregate: vi.fn(async () => current),
    listRevisionsByGroupId: vi.fn(async () => []),
    listCheckpointsByRevisionId: vi.fn(async () => []),
    createGroup: vi.fn(async () => current.group),
    applyGroupReviewDraft: vi.fn(async () => current.group),
    updateVariationPrice: vi.fn(async () => ({ group: current.group, variation: current.variations[0]! })),
    updateCopyAvailability: vi.fn(async () => ({ group: current.group, copy: current.copies[0]! })),
    updateRepresentativeCopy: vi.fn(async () => ({ group: current.group, variation: current.variations[0]! })),
  };
}

function actions(): VariationListingApiActions {
  return {
    publish: vi.fn(async () => ({ revisionId: 'initial' })),
    publishChanges: vi.fn(async () => ({ revisionId: 'changes' })),
    retry: vi.fn(async () => ({ reconciled: true })),
    quantity: vi.fn(async () => ({ staged: true })),
    withdraw: vi.fn(async () => ({ lifecycleState: 'withdrawn' })),
    abandon: vi.fn(async () => ({ lifecycleState: 'abandoned' })),
    cleanup: vi.fn(async () => ({ lifecycleState: 'terminal-absent' })),
  };
}

function app(dataAccess: VariationListingApiDataAccess, actionService: VariationListingApiActions) {
  const instance = express();
  instance.use(express.json());
  instance.use('/api/variation-listings', createVariationListingApiRouter({ dataAccess, actions: actionService }));
  return instance;
}

describe('YP6.2 action routes', () => {
  it('delegates Publish Changes and quantity with strict request contracts', async () => {
    const dataAccess = access();
    const actionService = actions();
    const publish = await request(app(dataAccess, actionService))
      .post(`/api/variation-listings/${groupId}/actions/publish-changes`)
      .send({ expectedDesiredRevision: 4 });
    expect(publish.status).toBe(200);
    expect(actionService.publishChanges).toHaveBeenCalledWith(groupId, 4);
    expect(publish.body).toMatchObject({ action: { revisionId: 'changes' }, group: { groupId } });

    const quantity = await request(app(dataAccess, actionService))
      .post(`/api/variation-listings/${groupId}/actions/quantity`)
      .send({ expectedDesiredRevision: 4, variationId, copyId, availabilityState: 'unavailable' });
    expect(quantity.status).toBe(200);
    expect(actionService.quantity).toHaveBeenCalledWith(groupId, { expectedDesiredRevision: 4, variationId, copyId, availabilityState: 'unavailable' });
  });

  it('serializes the UI-ready action status and omits raw stack traces', async () => {
    const actionService = actions();
    vi.mocked(actionService.cleanup).mockRejectedValue(new VariationListingActionError(409, {
      action: 'cleanup', affected: { groupId }, category: 'reconciliation', code: 'variation_listing_remote_outcome_unknown', issues: [], operationKey: 'cleanup-group',
      recommendedActions: ['reconcile_remote_state', 'do_not_retry_blindly'], remoteState: 'unknown', requiresReconciliation: true, retryStatus: 'reconciliation_required', revisionId: 'rev', severity: 'error', stage: 'cleanup_remote', summary: 'Remote outcome is unknown.', userActionRequired: true,
    }));
    const response = await request(app(access(), actionService))
      .post(`/api/variation-listings/${groupId}/actions/cleanup`)
      .send({ expectedDesiredRevision: 4 });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ error: 'variation_listing_remote_outcome_unknown', status: { operationKey: 'cleanup-group', remoteState: 'unknown', requiresReconciliation: true } });
    expect(JSON.stringify(response.body)).not.toContain('stack');
  });

  it('returns the structured UI-ready status for malformed action bodies before calling the action service', async () => {
    const actionService = actions();
    const response = await request(app(access(), actionService))
      .post(`/api/variation-listings/${groupId}/actions/quantity`)
      .send({ expectedDesiredRevision: 4, variationId, copyId, availabilityState: 'invalid' });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: 'invalid_request',
      status: {
        action: 'quantity',
        affected: { groupId },
        category: 'validation',
        code: 'invalid_request',
        remoteState: 'known_unchanged',
        requiresReconciliation: false,
        retryStatus: 'not_applicable',
        stage: 'request_validation',
        userActionRequired: true,
      },
    });
    expect(response.body.status.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'availabilityState' }),
    ]));
    expect(actionService.quantity).not.toHaveBeenCalled();
  });

  it('preserves successful action outcome when post-action group refresh fails', async () => {
    const dataAccess = access();
    vi.mocked(dataAccess.loadAggregate).mockRejectedValueOnce(new Error('database unavailable token=supersecret'));
    const actionService = actions();
    const response = await request(app(dataAccess, actionService))
      .post(`/api/variation-listings/${groupId}/actions/publish-changes`)
      .send({ expectedDesiredRevision: 4 });

    expect(response.status).toBe(200);
    expect(actionService.publishChanges).toHaveBeenCalledWith(groupId, 4);
    expect(response.body).toMatchObject({
      action: { revisionId: 'changes' },
      group: null,
      warning: {
        action: 'publish_changes',
        affected: { groupId },
        category: 'system',
        code: 'group_refresh_required',
        remoteState: 'known_changed',
        requiresReconciliation: false,
        retryStatus: 'not_applicable',
        severity: 'warning',
        stage: 'response_refresh',
        userActionRequired: true,
      },
    });
    expect(response.body.warning.recommendedActions).toEqual(expect.arrayContaining(['refresh_group', 'do_not_retry_action']));
    expect(JSON.stringify(response.body)).not.toContain('supersecret');
  });
});
