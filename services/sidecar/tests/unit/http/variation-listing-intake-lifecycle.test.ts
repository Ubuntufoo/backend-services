import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

import express from 'express';
import request from 'supertest';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {
  VariationListingAggregateSnapshot,
  VariationListingIntakeSession,
} from '@ebay-inventory/data';

import {
  createVariationListingApiRouter,
  type VariationListingApiActions,
  type VariationListingApiDataAccess,
} from '@/http/variation-listing-router.js';

const groupId = '11111111-1111-4111-8111-111111111111';
const variationId = '22222222-2222-4222-8222-222222222222';

let tempIncoming: string | undefined;
const originalIncoming = process.env.WATCHER_INCOMING_DIR;

beforeEach(() => {
  tempIncoming = mkdtempSync(path.join(tmpdir(), 'variation-intake-lifecycle-'));
  process.env.WATCHER_INCOMING_DIR = tempIncoming;
});

afterEach(() => {
  if (tempIncoming) rmSync(tempIncoming, {recursive: true, force: true});
  tempIncoming = undefined;
  if (originalIncoming === undefined) delete process.env.WATCHER_INCOMING_DIR;
  else process.env.WATCHER_INCOMING_DIR = originalIncoming;
});

function group(lifecycleState: string = 'active'): VariationListingAggregateSnapshot {
  return {
    group: {
      group_id: groupId,
      lifecycle_state: lifecycleState,
      desired_revision: 4,
      last_confirmed_revision: 3,
    },
    variations: [],
    copies: [],
  } as unknown as VariationListingAggregateSnapshot;
}

function session(overrides: Partial<VariationListingIntakeSession> = {}): VariationListingIntakeSession {
  return {
    captureSourceKey: 'station-main',
    mode: 'idle',
    targetGroupId: null,
    targetVariationId: null,
    copyConditionToken: null,
    stickyPriceAmount: 1.49,
    stickyPriceCurrency: 'USD',
    pendingPair: null,
    source: {} as VariationListingIntakeSession['source'],
    ...overrides,
  };
}

function access(input: {
  aggregate?: VariationListingAggregateSnapshot;
  intake?: VariationListingIntakeSession | null;
} = {}) {
  const configureIntake = vi.fn(async () => session());
  const dataAccess = {
    loadAggregate: vi.fn(async () => input.aggregate ?? group()),
    getIntakeSession: vi.fn(async () => input.intake ?? null),
    configureIntake,
    listRevisionsByGroupId: vi.fn(async () => []),
    listCheckpointsByRevisionId: vi.fn(async () => []),
  } as unknown as VariationListingApiDataAccess;
  return {configureIntake, dataAccess};
}

function actions(): VariationListingApiActions {
  return {
    publish: vi.fn(),
    publishChanges: vi.fn(),
    retry: vi.fn(),
    withdraw: vi.fn(async () => ({lifecycleState: 'withdrawn'})),
    abandon: vi.fn(async () => ({lifecycleState: 'abandoned'})),
    cleanup: vi.fn(async () => ({lifecycleState: 'terminal-absent'})),
    returnToReview: vi.fn(),
  };
}

function app(dataAccess: VariationListingApiDataAccess, actionService: VariationListingApiActions = actions()) {
  const instance = express();
  instance.use(express.json());
  instance.use('/api/variation-listings', createVariationListingApiRouter({
    dataAccess,
    actions: actionService,
  }));
  return instance;
}

describe('variation listing intake lifecycle hardening', () => {
  it('reports no intake session when Variation capture is unconfigured', async () => {
    const {dataAccess} = access();
    vi.mocked(dataAccess.getIntakeSession).mockRejectedValue(
      new Error('WATCHER_CAPTURE_SOURCE_KEY is required.'),
    );

    const response = await request(app(dataAccess)).get('/api/variation-listings/intake-session');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({session: null});
  });

  it('rejects Variation arming while a Standard image group is pending', async () => {
    const front = path.join(tempIncoming!, 'standard-front.jpg');
    writeFileSync(front, 'front');
    writeFileSync(
      path.join(tempIncoming!, '.standard-capture-pending.json'),
      JSON.stringify({version: 1, pending: [front]}),
    );
    const {configureIntake, dataAccess} = access();

    const response = await request(app(dataAccess))
      .patch('/api/variation-listings/intake-session')
      .send({
        mode: 'new_variation',
        targetGroupId: groupId,
        targetVariationId: null,
        copyConditionToken: null,
        stickyPriceAmount: 1.49,
      });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('standard_capture_pair_pending');
    expect(configureIntake).not.toHaveBeenCalled();
  });

  it('rejects arming a withdrawn group before intake persistence', async () => {
    const {configureIntake, dataAccess} = access({aggregate: group('withdrawn')});

    const response = await request(app(dataAccess))
      .patch('/api/variation-listings/intake-session')
      .send({
        mode: 'new_variation',
        targetGroupId: groupId,
        targetVariationId: null,
        copyConditionToken: null,
        stickyPriceAmount: 1.49,
      });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('variation_listing_intake_target_unavailable');
    expect(response.body.message).toContain('withdrawn');
    expect(configureIntake).not.toHaveBeenCalled();
  });

  it('blocks withdrawal while its targeted variation pair is pending', async () => {
    const {dataAccess} = access({
      intake: session({
        mode: 'new_variation',
        targetGroupId: groupId,
        pendingPair: {pair_id: 'pending'} as never,
      }),
    });
    const actionService = actions();

    const response = await request(app(dataAccess, actionService))
      .post(`/api/variation-listings/${groupId}/actions/withdraw`)
      .send({expectedDesiredRevision: 4});

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('variation_listing_intake_pending');
    expect(actionService.withdraw).not.toHaveBeenCalled();
  });

  it('disarms a targeted intake session before withdrawal starts', async () => {
    const armed = session({
      mode: 'duplicate_copy',
      targetGroupId: groupId,
      targetVariationId: variationId,
      copyConditionToken: 'EXCELLENT',
    });
    const {configureIntake, dataAccess} = access({intake: armed});
    const actionService = actions();

    const response = await request(app(dataAccess, actionService))
      .post(`/api/variation-listings/${groupId}/actions/withdraw`)
      .send({expectedDesiredRevision: 4});

    expect(response.status).toBe(200);
    expect(actionService.withdraw).toHaveBeenCalledWith(groupId, 4);
    expect(configureIntake).toHaveBeenCalledWith({
      mode: 'idle',
      targetGroupId: null,
      targetVariationId: null,
      copyConditionToken: null,
      stickyPriceAmount: 1.49,
    });
  });

  it('fails closed when the capture source configuration is malformed', async () => {
    const {dataAccess} = access({
      intake: session({targetGroupId: groupId}),
    });
    vi.mocked(dataAccess.getIntakeSession).mockRejectedValue(
      new Error('WATCHER_CAPTURE_SOURCE_KEY must be a non-empty outer-trimmed string when set.')
    );
    const actionService = actions();

    const response = await request(app(dataAccess, actionService))
      .post(`/api/variation-listings/${groupId}/actions/withdraw`)
      .send({expectedDesiredRevision: 4});

    expect(response.status).toBe(503);
    expect(response.body.error).toBe('variation_listing_capture_source_unconfigured');
    expect(actionService.withdraw).not.toHaveBeenCalled();
  });
});
