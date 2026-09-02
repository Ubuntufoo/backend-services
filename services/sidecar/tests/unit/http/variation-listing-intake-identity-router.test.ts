import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import {
  createVariationListingApiRouter,
  type VariationListingApiDataAccess,
} from '@/http/variation-listing-router.js';

const variationId = '22222222-2222-4222-8222-222222222222';

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
