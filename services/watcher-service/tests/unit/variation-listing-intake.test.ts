import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';
import type { Json, VariationListingIntakeSession } from '@ebay-inventory/data';

import {
  buildVariationListingR2ImageObjectKey,
  routeVariationListingWatcherEvent,
  storeVariationListingCompletionCandidate,
  type VariationListingWatcherEventRoute,
} from '../../src/index.js';

const GROUP_ID = '11111111-1111-4111-8111-111111111111';
const VARIATION_ID = '22222222-2222-4222-8222-222222222222';
const COPY_ID = '33333333-3333-4333-8333-333333333333';
const PAIR_ID = '44444444-4444-4444-8444-444444444444';
const NEW_VARIATION_ID = '55555555-5555-4555-8555-555555555555';

function createSession(
  overrides: Partial<VariationListingIntakeSession> = {}
): VariationListingIntakeSession {
  return {
    captureSourceKey: 'camera-1',
    mode: 'new_variation',
    pendingPair: null,
    source: {} as VariationListingIntakeSession['source'],
    stickyPriceAmount: 1.49,
    stickyPriceCurrency: 'USD',
    targetGroupId: GROUP_ID,
    targetVariationId: null,
    ...overrides,
  };
}

function pendingPair(mode: 'new_variation' | 'duplicate_copy' = 'new_variation') {
  return {
    pair_id: PAIR_ID,
    mode,
    target_group_id: GROUP_ID,
    target_variation_id: mode === 'duplicate_copy' ? VARIATION_ID : null,
    price_amount: 1.49,
    price_currency: 'USD',
    front_source_ref: '/incoming/front.JPG',
    started_at: '2026-09-01T01:00:00-04:00',
    expected_desired_revision: 7,
  };
}

function sessionReader(session: VariationListingIntakeSession | null) {
  return {
    getBySourceKey: vi.fn(async () => session),
  };
}

function completionCandidate(
  completionKind: 'new_variation' | 'duplicate_copy' = 'new_variation'
): Extract<VariationListingWatcherEventRoute, { kind: 'completion_candidate' }> {
  return {
    backSourceRef: '/incoming/back.png',
    captureSourceKey: 'camera-1',
    completionKind,
    kind: 'completion_candidate',
    pendingPair: {
      expectedDesiredRevision: 7,
      frontSourceRef: '/incoming/front.JPG',
      mode: completionKind,
      pairId: PAIR_ID,
      priceAmount: 1.49,
      priceCurrency: 'USD',
      startedAt: '2026-09-01T05:00:00.000Z',
      targetGroupId: GROUP_ID,
      targetVariationId: completionKind === 'duplicate_copy' ? VARIATION_ID : null,
    },
  };
}

describe('variation listing watcher routing', () => {
  it('leaves legacy watcher behavior authoritative when no variation session exists', async () => {
    const result = await routeVariationListingWatcherEvent(
      {
        captureSourceKey: 'camera-1',
        image: { path: '/incoming/front.jpg' },
      },
      { sessionReader: sessionReader(null) }
    );

    expect(result).toEqual({
      image: { path: '/incoming/front.jpg' },
      kind: 'legacy',
    });
  });

  it('emits a start-pair instruction without mutating persistence for the first armed image', async () => {
    const result = await routeVariationListingWatcherEvent(
      {
        captureSourceKey: 'camera-1',
        image: { path: '/incoming/front.JPG' },
      },
      {
        createPairId: () => PAIR_ID,
        now: () => new Date('2026-09-01T01:00:00-04:00'),
        sessionReader: sessionReader(createSession()),
      }
    );

    expect(result).toEqual({
      captureSourceKey: 'camera-1',
      frontSourceRef: '/incoming/front.JPG',
      frozenMode: 'new_variation',
      frozenPriceAmount: 1.49,
      frozenPriceCurrency: 'USD',
      frozenTargetGroupId: GROUP_ID,
      frozenTargetVariationId: null,
      kind: 'start_pair',
      pairId: PAIR_ID,
      startedAt: '2026-09-01T05:00:00.000Z',
    });
  });

  it('resumes from durable pending state and ignores an exact duplicate front notification', async () => {
    const result = await routeVariationListingWatcherEvent(
      {
        captureSourceKey: 'camera-1',
        image: { path: '/incoming/front.JPG' },
      },
      {
        sessionReader: sessionReader(
          createSession({ pendingPair: pendingPair() as Record<string, unknown> })
        ),
      }
    );

    expect(result.kind).toBe('duplicate_front');
    if (result.kind !== 'duplicate_front') throw new Error('expected duplicate front route');
    expect(result.pendingPair).toMatchObject({
      frontSourceRef: '/incoming/front.JPG',
      pairId: PAIR_ID,
      startedAt: '2026-09-01T05:00:00.000Z',
    });
  });

  it('routes a different supported source as the back image using the frozen pending target', async () => {
    const result = await routeVariationListingWatcherEvent(
      {
        captureSourceKey: 'camera-1',
        image: { path: '/incoming/back.png' },
      },
      {
        sessionReader: sessionReader(
          createSession({ pendingPair: pendingPair() as Record<string, unknown> })
        ),
      }
    );

    expect(result).toMatchObject({
      backSourceRef: '/incoming/back.png',
      captureSourceKey: 'camera-1',
      completionKind: 'new_variation',
      kind: 'completion_candidate',
      pendingPair: {
        expectedDesiredRevision: 7,
        frontSourceRef: '/incoming/front.JPG',
        targetGroupId: GROUP_ID,
      },
    });
  });

  it('fails closed when mutable session state disagrees with the frozen pending pair', async () => {
    await expect(
      routeVariationListingWatcherEvent(
        {
          captureSourceKey: 'camera-1',
          image: { path: '/incoming/back.png' },
        },
        {
          sessionReader: sessionReader(
            createSession({
              pendingPair: pendingPair() as Record<string, unknown>,
              stickyPriceAmount: 2.49,
            })
          ),
        }
      )
    ).rejects.toThrow(/pending pair price disagrees/);
  });

  it('ignores unsupported files without consulting variation persistence', async () => {
    const reader = sessionReader(createSession());
    const result = await routeVariationListingWatcherEvent(
      {
        captureSourceKey: 'camera-1',
        image: { path: '/incoming/note.txt' },
      },
      { sessionReader: reader }
    );

    expect(result).toEqual({
      image: { path: '/incoming/note.txt' },
      kind: 'ignored',
      reason: 'unsupported_image',
    });
    expect(reader.getBySourceKey).not.toHaveBeenCalled();
  });
});

describe('variation listing image ownership and storage', () => {
  it('builds deterministic copy-owned R2 keys from immutable IDs and content hash', () => {
    const body = Buffer.from('front-bytes');
    const hash = createHash('sha256').update(body).digest('hex').slice(0, 12);

    expect(
      buildVariationListingR2ImageObjectKey({
        body,
        copyId: COPY_ID,
        groupId: GROUP_ID,
        role: 'front',
        sourcePath: '/incoming/Card Front.JPG',
        variationId: VARIATION_ID,
      })
    ).toBe(
      `variation-listing/${GROUP_ID}/${VARIATION_ID}/${COPY_ID}/front-${hash}.jpg`
    );
  });

  it('stores both images and emits a storage-ready new-variation completion command only', async () => {
    const readImage = vi.fn(async (sourcePath: string) =>
      Buffer.from(sourcePath.includes('front') ? 'front-bytes' : 'back-bytes')
    );
    const uploadStoredImage = vi.fn(async (input: { objectKey: string }) => ({
      objectKey: input.objectKey,
      publicUrl: `https://images.example/${input.objectKey}`,
    }));
    const ids = [COPY_ID, NEW_VARIATION_ID];

    const result = await storeVariationListingCompletionCandidate(
      completionCandidate('new_variation'),
      {
        completionKind: 'new_variation',
        conditionToken: 'EXCELLENT',
        selectorValue: '1997-98 Metal Universe Marcus Camby #6',
        variationMetadata: { player: 'Marcus Camby' } as Json,
      },
      {
        createId: () => ids.shift() ?? 'unexpected',
        readImage,
        uploadStoredImage,
      }
    );

    expect(readImage).toHaveBeenNthCalledWith(1, '/incoming/front.JPG');
    expect(readImage).toHaveBeenNthCalledWith(2, '/incoming/back.png');
    expect(uploadStoredImage).toHaveBeenCalledTimes(2);
    expect(uploadStoredImage.mock.calls[0]?.[0]).toMatchObject({
      contentType: 'image/jpeg',
      sourcePath: '/incoming/front.JPG',
      targetGroupId: GROUP_ID,
    });
    expect(uploadStoredImage.mock.calls[1]?.[0]).toMatchObject({
      contentType: 'image/png',
      sourcePath: '/incoming/back.png',
      targetGroupId: GROUP_ID,
    });
    expect(result).toMatchObject({
      backSourceRef: '/incoming/back.png',
      capturePairId: PAIR_ID,
      captureSourceKey: 'camera-1',
      completionKind: 'new_variation',
      conditionToken: 'EXCELLENT',
      copyId: COPY_ID,
      expectedDesiredRevision: 7,
      frontSourceRef: '/incoming/front.JPG',
      frozenPriceAmount: 1.49,
      selectorValue: '1997-98 Metal Universe Marcus Camby #6',
      targetGroupId: GROUP_ID,
      variationId: NEW_VARIATION_ID,
      variationMetadata: { player: 'Marcus Camby' },
    });
    expect(result.frontR2Key).toMatch(
      new RegExp(`^variation-listing/${GROUP_ID}/${NEW_VARIATION_ID}/${COPY_ID}/front-[0-9a-f]{12}\\.jpg$`)
    );
    expect(result.backR2Key).toMatch(
      new RegExp(`^variation-listing/${GROUP_ID}/${NEW_VARIATION_ID}/${COPY_ID}/back-[0-9a-f]{12}\\.png$`)
    );
  });

  it('keeps duplicate-copy ownership under the frozen existing variation and emits no selector metadata', async () => {
    const uploadStoredImage = vi.fn(async (input: { objectKey: string }) => ({
      objectKey: input.objectKey,
      publicUrl: 'https://images.example/object',
    }));

    const result = await storeVariationListingCompletionCandidate(
      completionCandidate('duplicate_copy'),
      {
        completionKind: 'duplicate_copy',
        conditionToken: 'NEAR_MINT_OR_BETTER',
      },
      {
        createId: () => COPY_ID,
        readImage: async (sourcePath) => Buffer.from(sourcePath),
        uploadStoredImage,
      }
    );

    expect(result).toMatchObject({
      completionKind: 'duplicate_copy',
      copyId: COPY_ID,
      variationId: VARIATION_ID,
    });
    expect('selectorValue' in result).toBe(false);
    expect('variationMetadata' in result).toBe(false);
    expect(uploadStoredImage).toHaveBeenCalledTimes(2);
  });

  it('validates new-variation metadata before any storage side effect', async () => {
    const readImage = vi.fn(async () => Buffer.from('bytes'));
    const uploadStoredImage = vi.fn();

    await expect(
      storeVariationListingCompletionCandidate(
        completionCandidate('new_variation'),
        {
          completionKind: 'new_variation',
          conditionToken: 'EXCELLENT',
          selectorValue: '   ',
          variationMetadata: {} as Json,
        },
        {
          createId: () => COPY_ID,
          readImage,
          uploadStoredImage,
        }
      )
    ).rejects.toThrow(/selectorValue/);

    expect(readImage).not.toHaveBeenCalled();
    expect(uploadStoredImage).not.toHaveBeenCalled();
  });

  it.each([
    ['empty string', ''],
    ['null', null],
  ])('rejects supplied malformed capturedAt (%s) before storage side effects', async (_label, capturedAt) => {
    const readImage = vi.fn(async () => Buffer.from('bytes'));
    const uploadStoredImage = vi.fn();

    await expect(
      storeVariationListingCompletionCandidate(
        completionCandidate('duplicate_copy'),
        {
          completionKind: 'duplicate_copy',
          conditionToken: 'VERY_GOOD',
          capturedAt: capturedAt as unknown as string,
        },
        {
          createId: () => COPY_ID,
          readImage,
          uploadStoredImage,
        }
      )
    ).rejects.toThrow(/capturedAt/);

    expect(readImage).not.toHaveBeenCalled();
    expect(uploadStoredImage).not.toHaveBeenCalled();
  });

  it('stops on a storage failure and never invokes any persistence seam', async () => {
    const uploadStoredImage = vi.fn().mockRejectedValueOnce(new Error('R2 unavailable'));

    await expect(
      storeVariationListingCompletionCandidate(
        completionCandidate('duplicate_copy'),
        {
          completionKind: 'duplicate_copy',
          conditionToken: 'VERY_GOOD',
        },
        {
          createId: () => COPY_ID,
          readImage: async (sourcePath) => Buffer.from(sourcePath),
          uploadStoredImage,
        }
      )
    ).rejects.toThrow('R2 unavailable');

    expect(uploadStoredImage).toHaveBeenCalledTimes(1);
  });
});
