import { describe, expect, it, vi } from 'vitest';
import type {
  Json,
  VariationListingCopyRow,
  VariationListingGroupRow,
  VariationListingIntakeSessionRow,
  VariationListingTransactionGateway,
  VariationListingVariationRow,
} from '@ebay-inventory/data';
import {
  findCompletedVariationListingCapturePair,
  persistVariationListingCompletion,
  startVariationListingIntakePersistence,
  type VariationListingPersistenceReader,
  type VariationListingStorageReadyCompletionCommand,
} from '../../src/index.js';

const GROUP_ID = '11111111-1111-4111-8111-111111111111';
const VARIATION_ID = '22222222-2222-4222-8222-222222222222';
const COPY_ID = '33333333-3333-4333-8333-333333333333';
const PAIR_ID = '44444444-4444-4444-8444-444444444444';

const group = {
  group_id: GROUP_ID,
  group_key: 'VL-G',
} as VariationListingGroupRow;
const variation = {
  group_id: GROUP_ID,
  price_amount: 1.49,
  price_currency: 'USD',
  selector_value: 'Card A',
  variation_id: VARIATION_ID,
  variation_metadata: { set: 'Topps', year: 2003 },
} as VariationListingVariationRow;
const copy = {
  back_r2_key: `variation-listing/${GROUP_ID}/${VARIATION_ID}/${COPY_ID}/back-b.png`,
  capture_back_source_ref: '/incoming/back.png',
  capture_front_source_ref: '/incoming/front.jpg',
  capture_pair_id: PAIR_ID,
  capture_source_key: 'camera-1',
  capture_started_at: '2026-09-01T05:00:00.000Z',
  captured_at: '2026-09-01T05:01:00.000Z',
  condition_token: 'EXCELLENT',
  copy_id: COPY_ID,
  front_r2_key: `variation-listing/${GROUP_ID}/${VARIATION_ID}/${COPY_ID}/front-a.jpg`,
  variation_id: VARIATION_ID,
} as VariationListingCopyRow;

function newVariationCommand(
  overrides: Partial<VariationListingStorageReadyCompletionCommand> = {}
): VariationListingStorageReadyCompletionCommand {
  return {
    backR2Key: copy.back_r2_key,
    backSourceRef: copy.capture_back_source_ref,
    capturePairId: PAIR_ID,
    captureSourceKey: copy.capture_source_key,
    captureStartedAt: '2026-09-01T01:00:00-04:00',
    capturedAt: copy.captured_at,
    completionKind: 'new_variation',
    conditionToken: 'EXCELLENT',
    copyId: COPY_ID,
    expectedDesiredRevision: 7,
    frontR2Key: copy.front_r2_key,
    frontSourceRef: copy.capture_front_source_ref,
    frozenPriceAmount: 1.49,
    frozenPriceCurrency: 'USD',
    selectorValue: 'Card A',
    targetGroupId: GROUP_ID,
    variationId: VARIATION_ID,
    variationMetadata: { year: 2003, set: 'Topps' } as Json,
    ...overrides,
  } as VariationListingStorageReadyCompletionCommand;
}

function duplicateCommand(
  overrides: Partial<VariationListingStorageReadyCompletionCommand> = {}
): VariationListingStorageReadyCompletionCommand {
  return {
    backR2Key: copy.back_r2_key,
    backSourceRef: copy.capture_back_source_ref,
    capturePairId: PAIR_ID,
    captureSourceKey: copy.capture_source_key,
    captureStartedAt: copy.capture_started_at,
    capturedAt: copy.captured_at,
    completionKind: 'duplicate_copy',
    conditionToken: 'EXCELLENT',
    copyId: COPY_ID,
    expectedDesiredRevision: 7,
    frontR2Key: copy.front_r2_key,
    frontSourceRef: copy.capture_front_source_ref,
    frozenPriceAmount: 2.49,
    frozenPriceCurrency: 'USD',
    targetGroupId: GROUP_ID,
    variationId: VARIATION_ID,
    ...overrides,
  } as VariationListingStorageReadyCompletionCommand;
}

function reader(existing: VariationListingCopyRow | null = null): VariationListingPersistenceReader {
  return {
    getCopyByCapturePairId: vi.fn(async () => existing),
    getGroupById: vi.fn(async () => group),
    getVariationById: vi.fn(async () => variation),
  };
}

function gateway(): VariationListingTransactionGateway {
  return {
    appendJournalCheckpoint: vi.fn(),
    captureRevision: vi.fn(),
    completeDuplicateCopy: vi.fn(),
    completeNewVariation: vi.fn(),
    configureIntake: vi.fn(),
    confirmRevision: vi.fn(),
    createGroup: vi.fn(),
    discardIntakePair: vi.fn(),
    loadAggregate: vi.fn(),
    startIntakePair: vi.fn(),
  } as unknown as VariationListingTransactionGateway;
}

describe('variation listing persistence coordinator', () => {
  it('persists a start_pair through the typed gateway without changing source identity', async () => {
    const g = gateway();
    const session = { capture_source_key: 'camera-1' } as VariationListingIntakeSessionRow;
    vi.mocked(g.startIntakePair).mockResolvedValue(session);

    const result = await startVariationListingIntakePersistence(
      {
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
      },
      { gateway: g }
    );

    expect(result).toBe(session);
    expect(g.startIntakePair).toHaveBeenCalledWith({
      captureSourceKey: 'camera-1',
      frontSourceRef: '/incoming/front.JPG',
      pairId: PAIR_ID,
      startedAt: '2026-09-01T05:00:00.000Z',
    });
  });

  it('maps a new-variation command to only completeNewVariation', async () => {
    const g = gateway();
    vi.mocked(g.completeNewVariation).mockResolvedValue({ copy, group, variation });
    const r = reader(null);

    const result = await persistVariationListingCompletion(newVariationCommand(), {
      gateway: g,
      reader: r,
    });

    expect(result.status).toBe('completed');
    expect(result.completionKind).toBe('new_variation');
    expect(g.completeNewVariation).toHaveBeenCalledTimes(1);
    expect(g.completeDuplicateCopy).not.toHaveBeenCalled();
    expect(g.completeNewVariation).toHaveBeenCalledWith(
      expect.objectContaining({
        capturePairId: PAIR_ID,
        copyId: COPY_ID,
        selectorValue: 'Card A',
        variationId: VARIATION_ID,
      })
    );
  });

  it('maps a duplicate-copy command to only completeDuplicateCopy', async () => {
    const g = gateway();
    vi.mocked(g.completeDuplicateCopy).mockResolvedValue({ copy, group });
    const r = reader(null);

    const result = await persistVariationListingCompletion(duplicateCommand(), {
      gateway: g,
      reader: r,
    });

    expect(result.status).toBe('completed');
    expect(result.completionKind).toBe('duplicate_copy');
    expect(g.completeDuplicateCopy).toHaveBeenCalledTimes(1);
    expect(g.completeNewVariation).not.toHaveBeenCalled();
  });

  it('acknowledges an exact completed retry without invoking a completion RPC', async () => {
    const g = gateway();
    const result = await persistVariationListingCompletion(newVariationCommand(), {
      gateway: g,
      reader: reader(copy),
    });

    expect(result.status).toBe('already_completed');
    expect(g.completeNewVariation).not.toHaveBeenCalled();
    expect(g.completeDuplicateCopy).not.toHaveBeenCalled();
  });

  it('fails closed on persisted front-source mismatch before invoking a completion RPC', async () => {
    const g = gateway();
    await expect(
      persistVariationListingCompletion(
        newVariationCommand({ frontSourceRef: '/incoming/different-front.jpg' }),
        { gateway: g, reader: reader(copy) }
      )
    ).rejects.toThrow(/frontSourceRef/);
    expect(g.completeNewVariation).not.toHaveBeenCalled();
  });

  it('accepts semantically equal new-variation metadata with different object key order', async () => {
    const g = gateway();
    await expect(
      persistVariationListingCompletion(newVariationCommand(), {
        gateway: g,
        reader: reader(copy),
      })
    ).resolves.toMatchObject({ status: 'already_completed' });
  });

  it('returns unknown completion kind when only persisted capture-pair provenance is available', async () => {
    await expect(
      findCompletedVariationListingCapturePair(PAIR_ID, { reader: reader(copy) })
    ).resolves.toMatchObject({
      completionKind: 'unknown',
      copy: { copy_id: COPY_ID },
      status: 'already_completed',
      variation: { variation_id: VARIATION_ID },
    });
  });
});
