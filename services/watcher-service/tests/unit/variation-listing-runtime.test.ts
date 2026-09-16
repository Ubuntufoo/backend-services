import {describe, expect, it, vi} from 'vitest';

import type {VariationListingIntakeSessionRow} from '@ebay-inventory/data';

import {
  createVariationListingRuntimeProcessor,
} from '../../src/variation-listing-runtime.js';
import {VariationListingStoragePreparationError} from '../../src/variation-listing-intake.js';
import {VariationListingSidecarRetryableError} from '../../src/variation-listing-sidecar.js';

const groupId = '11111111-1111-4111-8111-111111111111';
const pairId = '22222222-2222-4222-8222-222222222222';

function startRoute() {
  return {
    kind: 'start_pair' as const,
    captureSourceKey: 'station-main',
    frontSourceRef: '/incoming/front.jpg',
    frozenMode: 'new_variation' as const,
    frozenConditionToken: null,
    frozenPriceAmount: 1.49 as const,
    frozenPriceCurrency: 'USD' as const,
    frozenTargetGroupId: groupId,
    frozenTargetVariationId: null,
    pairId,
    startedAt: '2026-09-08T20:00:00.000Z',
  };
}

function completionRoute() {
  return {
    backSourceRef: '/incoming/back.jpg',
    captureSourceKey: 'station-main',
    completionKind: 'new_variation' as const,
    kind: 'completion_candidate' as const,
    pendingPair: {
      conditionToken: null,
      expectedDesiredRevision: 3,
      frontSourceRef: '/incoming/front.jpg',
      mode: 'new_variation' as const,
      pairId,
      priceAmount: 1.49 as const,
      priceCurrency: 'USD' as const,
      startedAt: '2026-09-08T20:00:00.000Z',
      targetGroupId: groupId,
      targetVariationId: null,
    },
  };
}

function preparedMedia(copyId: string, variationId: string) {
  return {
    backR2Key: 'variation-listing/group/variation/copy/back.jpg',
    backSourceRef: '/incoming/back.jpg',
    copyId,
    frontR2Key: 'variation-listing/group/variation/copy/front.jpg',
    frontSourceRef: '/incoming/front.jpg',
    variationId,
  };
}

describe('variation listing runtime lifecycle hardening', () => {
  it('keeps a queued legacy image on Standard even if Variation is armed later', async () => {
    const routeEvent = vi.fn();
    const processor = createVariationListingRuntimeProcessor(
      {captureSourceKey: 'station-main'},
      {routeEvent},
    );

    await expect(processor.process('/incoming/front.jpg', 'legacy')).resolves.toEqual({kind: 'legacy'});
    expect(routeEvent).not.toHaveBeenCalled();
  });

  it('keeps unsupported queued files ignored without routing them to Standard', async () => {
    const routeEvent = vi.fn(async () => ({
      image: { path: '/incoming/note.txt' },
      kind: 'ignored' as const,
      reason: 'unsupported_image' as const,
    }));
    const processor = createVariationListingRuntimeProcessor(
      {captureSourceKey: 'station-main'},
      {routeEvent},
    );

    await expect(processor.snapshot('/incoming/note.txt')).resolves.toBe('ignored');
    await expect(processor.process('/incoming/note.txt', 'ignored')).resolves.toEqual({
      kind: 'ignored',
      reason: 'unsupported_image',
    });
    expect(routeEvent).toHaveBeenCalledTimes(1);
  });

  it('fails closed when a queued Variation image is no longer Variation-owned', async () => {
    const startPersistence = vi.fn();
    const routeEvent = vi
      .fn()
      .mockResolvedValueOnce(startRoute())
      .mockResolvedValueOnce({
        image: { path: '/incoming/front.jpg' },
        kind: 'legacy' as const,
      });
    const processor = createVariationListingRuntimeProcessor(
      {captureSourceKey: 'station-main'},
      {
        routeEvent,
        startPersistence,
        getGroupCaptureState: vi.fn(async () => ({
          conditionToken: 'EXCELLENT' as const,
          lifecycleState: 'active',
        })),
      },
    );

    const ownership = await processor.snapshot('/incoming/front.jpg');
    expect(ownership).toEqual({
      kind: 'variation',
      mode: 'new_variation',
      targetGroupId: groupId,
      targetVariationId: null,
      conditionToken: null,
      priceAmount: 1.49,
      priceCurrency: 'USD',
    });
    await expect(processor.process('/incoming/front.jpg', ownership)).rejects.toThrow(
      'capture workspace ownership or target configuration changed',
    );
    expect(startPersistence).not.toHaveBeenCalled();
  });

  it('fails closed when a queued Variation image is re-targeted to another bucket before processing', async () => {
    const otherGroupId = '33333333-3333-4333-8333-333333333333';
    const startPersistence = vi.fn();
    const routeEvent = vi
      .fn()
      .mockResolvedValueOnce(startRoute())
      .mockResolvedValueOnce({...startRoute(), frozenTargetGroupId: otherGroupId});
    const processor = createVariationListingRuntimeProcessor(
      {captureSourceKey: 'station-main'},
      {
        routeEvent,
        startPersistence,
        getGroupCaptureState: vi.fn(async () => ({
          conditionToken: 'EXCELLENT' as const,
          lifecycleState: 'active',
        })),
      },
    );

    const ownership = await processor.snapshot('/incoming/front.jpg');
    await expect(processor.process('/incoming/front.jpg', ownership)).rejects.toThrow(
      'capture workspace ownership or target configuration changed',
    );
    expect(startPersistence).not.toHaveBeenCalled();
  });

  it('rejects a new capture before persistence when the durable target is withdrawn', async () => {
    const startPersistence = vi.fn();
    const processor = createVariationListingRuntimeProcessor(
      {captureSourceKey: 'station-main'},
      {
        routeEvent: vi.fn(async () => startRoute()),
        getGroupCaptureState: vi.fn(async () => ({
          conditionToken: 'EXCELLENT' as const,
          lifecycleState: 'withdrawn',
        })),
        startPersistence,
      },
    );

    await expect(processor.process('/incoming/front.jpg')).rejects.toThrow(
      'lifecycle "withdrawn" cannot accept capture',
    );
    expect(startPersistence).not.toHaveBeenCalled();
  });

  it('allows capture for an active target', async () => {
    const startPersistence = vi.fn(async () => undefined);
    const processor = createVariationListingRuntimeProcessor(
      {captureSourceKey: 'station-main'},
      {
        routeEvent: vi.fn(async () => startRoute()),
        getGroupCaptureState: vi.fn(async () => ({
          conditionToken: 'EXCELLENT' as const,
          lifecycleState: 'active',
        })),
        startPersistence,
      },
    );

    await expect(processor.process('/incoming/front.jpg')).resolves.toMatchObject({
      kind: 'started',
      groupId,
      pairId,
    });
    expect(startPersistence).toHaveBeenCalledTimes(1);
  });

  it('overlaps new-variation identity and media preparation before serialized persistence', async () => {
    const completionRoute = {
      backSourceRef: '/incoming/back.jpg',
      captureSourceKey: 'station-main',
      completionKind: 'new_variation' as const,
      kind: 'completion_candidate' as const,
      pendingPair: {
        conditionToken: null,
        expectedDesiredRevision: 3,
        frontSourceRef: '/incoming/front.jpg',
        mode: 'new_variation' as const,
        pairId,
        priceAmount: 1.49 as const,
        priceCurrency: 'USD' as const,
        startedAt: '2026-09-08T20:00:00.000Z',
        targetGroupId: groupId,
        targetVariationId: null,
      },
    };
    let resolveIdentity: ((value: {selectorValue: string; variationMetadata: Record<string, unknown>}) => void) | undefined;
    let resolveMedia: ((value: {
      backR2Key: string;
      backSourceRef: string;
      copyId: string;
      frontR2Key: string;
      frontSourceRef: string;
      variationId: string;
    }) => void) | undefined;
    let identityFinished = false;
    let mediaFinished = false;

    const requestIdentityHandoff = vi.fn(async () => await new Promise<{
      selectorValue: string;
      variationMetadata: Record<string, unknown>;
    }>((resolve) => {
      resolveIdentity = (value) => {
        identityFinished = true;
        resolve(value);
      };
    }));
    const prepareCompletionMedia = vi.fn(async (_route, ids: {copyId: string; variationId: string}) => await new Promise<{
      backR2Key: string;
      backSourceRef: string;
      copyId: string;
      frontR2Key: string;
      frontSourceRef: string;
      variationId: string;
    }>((resolve) => {
      resolveMedia = (value) => {
        mediaFinished = true;
        resolve(value);
      };
    }));
    const buildCompletionCommand = vi.fn((route, handoff, media) => ({
      ...media,
      capturePairId: route.pendingPair.pairId,
      captureSourceKey: route.captureSourceKey,
      captureStartedAt: route.pendingPair.startedAt,
      completionKind: 'new_variation' as const,
      conditionToken: handoff.conditionToken,
      expectedDesiredRevision: route.pendingPair.expectedDesiredRevision,
      frozenPriceAmount: route.pendingPair.priceAmount,
      frozenPriceCurrency: 'USD' as const,
      selectorValue: handoff.selectorValue,
      targetGroupId: route.pendingPair.targetGroupId,
      variationMetadata: handoff.variationMetadata,
    }));
    const persistCompletion = vi.fn(async () => {
      expect(identityFinished).toBe(true);
      expect(mediaFinished).toBe(true);
      return {status: 'completed' as const};
    });
    const processor = createVariationListingRuntimeProcessor(
      {captureSourceKey: 'station-main'},
      {
        routeEvent: vi.fn(async () => completionRoute),
        getGroupCaptureState: vi.fn(async () => ({
          conditionToken: 'EXCELLENT' as const,
          lifecycleState: 'active',
        })),
        requestIdentityHandoff,
        prepareCompletionMedia,
        buildCompletionCommand,
        persistCompletion,
        reportIntakeStatus: vi.fn(async () => undefined),
      },
    );

    const processing = processor.process('/incoming/back.jpg');
    await vi.waitFor(() => {
      expect(requestIdentityHandoff).toHaveBeenCalledTimes(1);
      expect(prepareCompletionMedia).toHaveBeenCalledTimes(1);
    });
    expect(persistCompletion).not.toHaveBeenCalled();

    resolveIdentity?.({selectorValue: 'Card', variationMetadata: {Set: 'Topps'}});
    await Promise.resolve();
    expect(persistCompletion).not.toHaveBeenCalled();

    const mediaIds = prepareCompletionMedia.mock.calls[0]?.[1];
    resolveMedia?.({
      backR2Key: 'back',
      backSourceRef: '/incoming/back.jpg',
      copyId: mediaIds!.copyId,
      frontR2Key: 'front',
      frontSourceRef: '/incoming/front.jpg',
      variationId: mediaIds!.variationId,
    });

    await expect(processing).resolves.toMatchObject({
      kind: 'completed',
      completionKind: 'new_variation',
      status: 'completed',
    });
    expect(buildCompletionCommand).toHaveBeenCalledTimes(1);
    expect(persistCompletion).toHaveBeenCalledTimes(1);
  });

  it('cleans prepared media after identity failure and exposes a retryable exact-pair error', async () => {
    const media = preparedMedia('33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444');
    const cleanupCompletionMedia = vi.fn(async () => undefined);
    const reportIntakeStatus = vi.fn(async () => undefined);
    const processor = createVariationListingRuntimeProcessor(
      {captureSourceKey: 'station-main'},
      {
        routeEvent: vi.fn(async () => completionRoute()),
        getGroupCaptureState: vi.fn(async () => ({conditionToken: 'EXCELLENT' as const, lifecycleState: 'active'})),
        requestIdentityHandoff: vi.fn(async () => {
          throw new VariationListingSidecarRetryableError('Gemini routes unavailable');
        }),
        prepareCompletionMedia: vi.fn(async () => media),
        cleanupCompletionMedia,
        persistCompletion: vi.fn(),
        reportIntakeStatus,
      },
    );

    await expect(processor.process('/incoming/back.jpg')).rejects.toMatchObject({
      name: 'VariationListingCaptureRetryableError',
      pairId,
      failureKind: 'gemini',
    });
    expect(cleanupCompletionMedia).toHaveBeenCalledWith(media);
    expect(reportIntakeStatus).toHaveBeenLastCalledWith(expect.objectContaining({
      failureKind: 'gemini',
      retryable: true,
    }));
  });

  it('makes cleanup failure terminal after identity failure', async () => {
    const media = preparedMedia('33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444');
    const cleanupCompletionMedia = vi.fn(async () => {
      throw new VariationListingStoragePreparationError('Prepared image cleanup failed.', {
        retryable: false,
        cleanupMessage: 'R2 delete denied',
      });
    });
    const reportIntakeStatus = vi.fn(async () => undefined);
    const processor = createVariationListingRuntimeProcessor(
      {captureSourceKey: 'station-main'},
      {
        routeEvent: vi.fn(async () => completionRoute()),
        getGroupCaptureState: vi.fn(async () => ({conditionToken: 'EXCELLENT' as const, lifecycleState: 'active'})),
        requestIdentityHandoff: vi.fn(async () => {
          throw new VariationListingSidecarRetryableError('Gemini routes unavailable');
        }),
        prepareCompletionMedia: vi.fn(async () => media),
        cleanupCompletionMedia,
        persistCompletion: vi.fn(),
        reportIntakeStatus,
      },
    );

    await expect(processor.process('/incoming/back.jpg')).rejects.toBeInstanceOf(VariationListingSidecarRetryableError);
    expect(reportIntakeStatus).toHaveBeenLastCalledWith(expect.objectContaining({
      failureKind: 'gemini',
      retryable: false,
      message: expect.stringContaining('Cleanup: R2 delete denied'),
    }));
  });

  it('fully settles combined Gemini and storage failures while preserving both reasons', async () => {
    const reportIntakeStatus = vi.fn(async () => undefined);
    const processor = createVariationListingRuntimeProcessor(
      {captureSourceKey: 'station-main'},
      {
        routeEvent: vi.fn(async () => completionRoute()),
        getGroupCaptureState: vi.fn(async () => ({conditionToken: 'EXCELLENT' as const, lifecycleState: 'active'})),
        requestIdentityHandoff: vi.fn(async () => {
          throw new VariationListingSidecarRetryableError('Gemini quota exhausted');
        }),
        prepareCompletionMedia: vi.fn(async () => {
          throw new VariationListingStoragePreparationError('R2 unavailable', {retryable: true});
        }),
        persistCompletion: vi.fn(),
        reportIntakeStatus,
      },
    );

    await expect(processor.process('/incoming/back.jpg')).rejects.toMatchObject({
      name: 'VariationListingCaptureRetryableError',
      pairId,
      failureKind: 'gemini_and_storage',
    });
    expect(reportIntakeStatus).toHaveBeenLastCalledWith(expect.objectContaining({
      failureKind: 'gemini_and_storage',
      retryable: true,
      message: expect.stringMatching(/Gemini: Gemini quota exhausted.*Image storage: R2 unavailable/),
    }));
  });

  it('cleans deterministic media when command construction fails', async () => {
    const media = preparedMedia('33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444');
    const cleanupCompletionMedia = vi.fn(async () => undefined);
    const reportIntakeStatus = vi.fn(async () => undefined);
    const processor = createVariationListingRuntimeProcessor(
      {captureSourceKey: 'station-main'},
      {
        routeEvent: vi.fn(async () => completionRoute()),
        getGroupCaptureState: vi.fn(async () => ({conditionToken: 'EXCELLENT' as const, lifecycleState: 'active'})),
        requestIdentityHandoff: vi.fn(async () => ({selectorValue: 'Card', variationMetadata: {}})),
        prepareCompletionMedia: vi.fn(async () => media),
        buildCompletionCommand: vi.fn(() => {
          throw new Error('invalid identity handoff');
        }),
        cleanupCompletionMedia,
        persistCompletion: vi.fn(),
        reportIntakeStatus,
      },
    );

    await expect(processor.process('/incoming/back.jpg')).rejects.toThrow('invalid identity handoff');
    expect(cleanupCompletionMedia).toHaveBeenCalledWith(media);
    expect(reportIntakeStatus).toHaveBeenLastCalledWith(expect.objectContaining({
      failureKind: 'storage',
      retryable: false,
    }));
  });

  it('fails closed if start persistence commits a different target than the routed arrival', async () => {
    const otherGroupId = '33333333-3333-4333-8333-333333333333';
    const startPersistence = vi.fn(async () => ({
      capture_source_key: 'station-main',
      mode: 'new_variation',
      target_group_id: otherGroupId,
      target_variation_id: null,
      sticky_price_amount: 1.49,
      sticky_price_currency: 'USD',
      copy_condition_token: null,
      pending_pair: {
        pair_id: pairId,
        mode: 'new_variation',
        target_group_id: otherGroupId,
        target_variation_id: null,
        price_amount: 1.49,
        price_currency: 'USD',
        condition_token: null,
        front_source_ref: '/incoming/front.jpg',
        started_at: '2026-09-08T20:00:00.000Z',
        expected_desired_revision: 0,
      },
    } as unknown as VariationListingIntakeSessionRow));
    const processor = createVariationListingRuntimeProcessor(
      {captureSourceKey: 'station-main'},
      {
        routeEvent: vi.fn(async () => startRoute()),
        getGroupCaptureState: vi.fn(async () => ({
          conditionToken: 'EXCELLENT' as const,
          lifecycleState: 'active',
        })),
        startPersistence,
      },
    );

    await expect(processor.process('/incoming/front.jpg')).rejects.toThrow(
      'durable pending pair disagrees with the arrival-time Variation route',
    );
    expect(startPersistence).toHaveBeenCalledTimes(1);
  });
});
