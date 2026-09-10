import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { VariationListingIntakeSession } from '@ebay-inventory/data';

import {
  createVariationListingApiRouter,
  type VariationListingApiDataAccess,
} from '@/http/variation-listing-router.js';
import {
  clearVariationListingIntakeProcessingStatus,
  getVariationListingIntakeProcessingStatus,
  setVariationListingIntakeProcessingStatus,
} from '@/http/variation-listing-intake-status.js';

const captureSourceKey = 'station-main';
const groupId = '11111111-1111-4111-8111-111111111111';
const pairId = '66666666-6666-4666-8666-666666666666';
const now = '2026-09-10T20:00:00.000Z';

function intakeSession(): VariationListingIntakeSession {
  return {
    captureSourceKey,
    copyConditionToken: null,
    mode: 'new_variation',
    pendingPair: null,
    source: { created_at: now, updated_at: now } as VariationListingIntakeSession['source'],
    stickyPriceAmount: 1.49,
    stickyPriceCurrency: 'USD',
    targetGroupId: groupId,
    targetVariationId: null,
  };
}

function dataAccess(): VariationListingApiDataAccess {
  return {
    getIntakeSession: vi.fn(async () => intakeSession()),
  } as unknown as VariationListingApiDataAccess;
}

describe('variation listing intake status recovery transition', () => {
  afterEach(() => {
    clearVariationListingIntakeProcessingStatus(captureSourceKey);
  });

  it('allows failed to recover directly to ready when intermediate retry telemetry was missed', async () => {
    setVariationListingIntakeProcessingStatus({
      captureSourceKey,
      targetGroupId: groupId,
      pairId,
      phase: 'failed',
      completionKind: 'new_variation',
      message: 'temporary persistence failure',
    });

    const app = express();
    app.use(express.json());
    app.use(
      '/api/variation-listings',
      createVariationListingApiRouter({ dataAccess: dataAccess() })
    );

    const response = await request(app)
      .post('/api/variation-listings/intake-status')
      .send({
        captureSourceKey,
        targetGroupId: groupId,
        pairId,
        phase: 'ready',
        completionKind: 'new_variation',
        message: null,
      });

    expect(response.status).toBe(200);
    expect(getVariationListingIntakeProcessingStatus(captureSourceKey)?.phase).toBe('ready');
  });
});
