import {describe, expect, it, vi} from 'vitest';

import type {VariationListingIntakeSessionRow} from '@ebay-inventory/data';

import {createVariationListingRuntimeProcessor} from '../../src/variation-listing-runtime.js';

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
