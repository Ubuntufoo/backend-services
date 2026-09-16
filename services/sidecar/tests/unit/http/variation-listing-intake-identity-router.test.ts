import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { GeminiDraftServiceError } from '@/gemini/contracts.js';
import { GeminiFallbackExecutionError } from '@/gemini/gemini-model-router.js';
import { VariationListingIntakeIdentitySourceUnavailableError } from '@/gemini/variation-listing-intake-identity.js';

import {
  createVariationListingApiRouter,
  type VariationListingApiDataAccess,
} from '@/http/variation-listing-router.js';
import {
  clearVariationListingIntakeProcessingStatus,
  getVariationListingIntakeProcessingStatus,
  setVariationListingIntakeProcessingStatus,
} from '@/http/variation-listing-intake-status.js';

const variationId = '22222222-2222-4222-8222-222222222222';
const groupId = '11111111-1111-4111-8111-111111111111';
const pairId = '33333333-3333-4333-8333-333333333333';
const sourceKey = 'station-main';
const startedAt = '2026-09-15T21:00:00.000Z';

function pendingIntakeDataAccess(overrides: Partial<VariationListingApiDataAccess> = {}): VariationListingApiDataAccess {
  return {
    ...unusedDataAccess(),
    getIntakeSession: vi.fn(async () => ({
      captureSourceKey: sourceKey,
      mode: 'new_variation',
      targetGroupId: groupId,
      targetVariationId: null,
      copyConditionToken: null,
      stickyPriceAmount: 1.49,
      stickyPriceCurrency: 'USD',
      pendingPair: {
        pair_id: pairId,
        mode: 'new_variation',
        target_group_id: groupId,
        target_variation_id: null,
        price_amount: 1.49,
        price_currency: 'USD',
        condition_token: null,
        front_source_ref: '/incoming/front.jpg',
        started_at: startedAt,
        expected_desired_revision: 4,
      },
      source: {created_at: startedAt, updated_at: startedAt},
    } as never)),
    ...overrides,
  } as VariationListingApiDataAccess;
}

function unusedDataAccess(): VariationListingApiDataAccess {
  const notUsed = vi.fn(async () => {
    throw new Error('unexpected data access');
  });
  return {
    listGroups: notUsed,
    loadAggregate: notUsed,
    listRevisionsByGroupId: notUsed,
    listCheckpointsByRevisionId: notUsed,
    getIntakeSession: notUsed,
    configureIntake: notUsed,
    createGroup: notUsed,
    applyGroupReviewDraft: notUsed,
    updateVariationPrice: notUsed,
    updateCopyAvailability: notUsed,
    updateRepresentativeCopy: notUsed,
  } as unknown as VariationListingApiDataAccess;
}

describe('variation listing intake identity route', () => {
  it('rejects stale or wrong-pair retry claims and allows one exact-pair claim', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/variation-listings', createVariationListingApiRouter({
      dataAccess: pendingIntakeDataAccess(),
    }));
    setVariationListingIntakeProcessingStatus({
      captureSourceKey: sourceKey,
      targetGroupId: groupId,
      pairId,
      phase: 'failed',
      completionKind: 'new_variation',
      message: 'Gemini unavailable',
      failureKind: 'gemini',
      retryable: true,
    });

    try {
      const requested = await request(app).post('/api/variation-listings/intake-session/retry');
      expect(requested.status).toBe(200);

      const stale = await request(app)
        .post('/api/variation-listings/intake-retry/claim')
        .send({captureSourceKey: sourceKey, pairId: variationId, canRetry: true});
      expect(stale.status).toBe(200);
      expect(stale.body).toEqual({approved: false});
      expect(getVariationListingIntakeProcessingStatus(sourceKey)?.retryRequested).toBe(true);

      const claimed = await request(app)
        .post('/api/variation-listings/intake-retry/claim')
        .send({captureSourceKey: sourceKey, pairId, canRetry: true});
      expect(claimed.body).toEqual({approved: true});

      const duplicate = await request(app)
        .post('/api/variation-listings/intake-retry/claim')
        .send({captureSourceKey: sourceKey, pairId, canRetry: true});
      expect(duplicate.body).toEqual({approved: false});
    } finally {
      clearVariationListingIntakeProcessingStatus(sourceKey);
    }
  });

  it('marks an exact-pair retry exhausted when the configured cap is reached', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/variation-listings', createVariationListingApiRouter({
      dataAccess: pendingIntakeDataAccess(),
    }));
    setVariationListingIntakeProcessingStatus({
      captureSourceKey: sourceKey,
      targetGroupId: groupId,
      pairId,
      phase: 'failed',
      completionKind: 'new_variation',
      message: 'Gemini unavailable',
      failureKind: 'gemini',
      retryable: true,
    });

    try {
      await request(app).post('/api/variation-listings/intake-session/retry');
      const exhausted = await request(app)
        .post('/api/variation-listings/intake-retry/claim')
        .send({captureSourceKey: sourceKey, pairId, canRetry: false});
      expect(exhausted.body).toEqual({approved: false});
      expect(getVariationListingIntakeProcessingStatus(sourceKey)).toMatchObject({
        retryable: false,
        retryRequested: false,
      });
    } finally {
      clearVariationListingIntakeProcessingStatus(sourceKey);
    }
  });

  it('delegates only the validated local-source identity handoff request', async () => {
    const generateIntakeIdentity = vi.fn(async () => ({
      selectorValue: '2003 Topps Tracy McGrady #1',
      variationMetadata: { Set: 'Topps' },
    }));
    const app = express();
    app.use(express.json());
    app.use(
      '/api/variation-listings',
      createVariationListingApiRouter({
        dataAccess: unusedDataAccess(),
        generateIntakeIdentity,
      })
    );

    const response = await request(app)
      .post('/api/variation-listings/intake-identity')
      .send({
        variationId,
        frontSourceRef: '/incoming/front.jpg',
        backSourceRef: '/incoming/back.jpg',
      });

    expect(response.status).toBe(200);
    expect(generateIntakeIdentity).toHaveBeenCalledWith({
      variationId,
      frontSourceRef: '/incoming/front.jpg',
      backSourceRef: '/incoming/back.jpg',
    });
    expect(response.body).toEqual({
      selectorValue: '2003 Topps Tracy McGrady #1',
      variationMetadata: { Set: 'Topps' },
    });
  });

  it('returns an explicit retryable conflict when an identity source file is temporarily missing', async () => {
    const generateIntakeIdentity = vi.fn(async () => {
      throw new VariationListingIntakeIdentitySourceUnavailableError('frontSourceRef');
    });
    const app = express();
    app.use(express.json());
    app.use('/api/variation-listings', createVariationListingApiRouter({
      dataAccess: unusedDataAccess(),
      generateIntakeIdentity,
    }));

    const response = await request(app)
      .post('/api/variation-listings/intake-identity')
      .send({
        variationId,
        frontSourceRef: '/incoming/front.jpg',
        backSourceRef: '/incoming/back.jpg',
      });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: 'variation_listing_identity_source_temporarily_unavailable',
      message: 'Variation listing intake identity source is temporarily unavailable: frontSourceRef.',
      retryable: true,
    });
  });

  it('returns the deterministic identity validation reason instead of a generic 500', async () => {
    const finalError = new GeminiDraftServiceError(
      'Variation identity does not contain enough proven components to construct a safe selector.'
    );
    const generateIntakeIdentity = vi.fn(async () => {
      throw new GeminiFallbackExecutionError({
        attempts: [
          {
            attemptOrder: 1,
            completedAt: '2026-09-15T21:00:01.000Z',
            durationMs: 1000,
            error: finalError,
            fallbackKind: 'none',
            route: {
              modelName: 'gemini-test',
            } as never,
            startedAt: '2026-09-15T21:00:00.000Z',
            status: 'failed',
          },
        ],
        fallbackExhausted: false,
        finalError,
      });
    });
    const app = express();
    app.use(express.json());
    app.use(
      '/api/variation-listings',
      createVariationListingApiRouter({
        dataAccess: unusedDataAccess(),
        generateIntakeIdentity,
      })
    );

    const response = await request(app)
      .post('/api/variation-listings/intake-identity')
      .send({
        variationId,
        frontSourceRef: '/incoming/front.jpg',
        backSourceRef: '/incoming/back.jpg',
      });

    expect(response.status).toBe(422);
    expect(response.body).toEqual({
      error: 'gemini_identity_validation_failed',
      message: 'Variation identity does not contain enough proven components to construct a safe selector.',
      retryable: false,
    });
  });

  it('does not misclassify an unrecognized Gemini service failure as identity validation', async () => {
    const finalError = new GeminiDraftServiceError(
      'Gemini variation identity generation failed for variation "fixture".'
    );
    const generateIntakeIdentity = vi.fn(async () => {
      throw new GeminiFallbackExecutionError({
        attempts: [
          {
            attemptOrder: 1,
            completedAt: '2026-09-15T21:00:01.000Z',
            durationMs: 1000,
            error: finalError,
            fallbackKind: 'none',
            route: { modelName: 'gemini-test' } as never,
            startedAt: '2026-09-15T21:00:00.000Z',
            status: 'failed',
          },
        ],
        fallbackExhausted: false,
        finalError,
      });
    });
    const app = express();
    app.use(express.json());
    app.use(
      '/api/variation-listings',
      createVariationListingApiRouter({
        dataAccess: unusedDataAccess(),
        generateIntakeIdentity,
      })
    );

    const response = await request(app)
      .post('/api/variation-listings/intake-identity')
      .send({
        variationId,
        frontSourceRef: '/incoming/front.jpg',
        backSourceRef: '/incoming/back.jpg',
      });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: 'server_error',
      message: 'An unexpected server error occurred.',
    });
  });

  it('rejects identical front/back source references before generation', async () => {
    const generateIntakeIdentity = vi.fn();
    const app = express();
    app.use(express.json());
    app.use(
      '/api/variation-listings',
      createVariationListingApiRouter({
        dataAccess: unusedDataAccess(),
        generateIntakeIdentity,
      })
    );

    const response = await request(app)
      .post('/api/variation-listings/intake-identity')
      .send({
        variationId,
        frontSourceRef: '/incoming/card.jpg',
        backSourceRef: '/incoming/card.jpg',
      });

    expect(response.status).toBe(400);
    expect(generateIntakeIdentity).not.toHaveBeenCalled();
  });
});
