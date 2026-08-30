import { describe, expect, it, vi } from 'vitest';
import type {
  SupabaseDataClient,
  VariationListingCopyRow,
  VariationListingGroupRow,
  VariationListingIntakeSessionRow,
  VariationListingOperationAttemptRow,
  VariationListingOperationRow,
  VariationListingRevisionRow,
  VariationListingVariationRow,
} from '../src/index.js';
import {
  listVariationListingOperationAttemptsByOperationId,
  listVariationListingOperationsByRevisionId,
  mapVariationListingCopyRow,
  mapVariationListingGroupRow,
  mapVariationListingIntakeSessionRow,
  mapVariationListingOperationAttemptRow,
  mapVariationListingOperationRow,
  mapVariationListingRevisionRow,
  mapVariationListingVariationRow,
} from '../src/index.js';

const groupRow = {
  desired_revision: 7,
  group_id: 'group-1',
  group_key: 'group-key-1',
  last_confirmed_revision: 5,
  lifecycle_state: 'review',
  recovery_required: false,
} as VariationListingGroupRow;

const variationRow = {
  group_id: 'group-1',
  position: 1,
  representative_copy_id: 'copy-1',
  selector_value: 'Card A',
  sku: 'sku-1',
  variation_id: 'variation-1',
} as VariationListingVariationRow;

const copyRow = {
  availability_state: 'available',
  copy_id: 'copy-1',
  variation_id: 'variation-1',
} as VariationListingCopyRow;

const sessionRow = {
  capture_source_key: 'camera-1',
  mode: 'new_variation',
  session_version: 3,
  target_group_id: 'group-1',
  target_variation_id: null,
} as VariationListingIntakeSessionRow;

const revisionRow = {
  captured_desired_revision: 7,
  group_id: 'group-1',
  operation_count: 2,
  revision_id: 'revision-1',
  snapshot_digest: 'digest-1',
} as VariationListingRevisionRow;

const operationRow = {
  current_evidence_state: 'unknown',
  current_state: 'unknown',
  latest_attempt_number: 2,
  operation_id: 'operation-1',
  operation_kind: 'complete_group_replace',
  revision_id: 'revision-1',
  sequence_no: 2,
} as VariationListingOperationRow;

const attemptRow = {
  attempt_number: 2,
  checkpoint_id: 'checkpoint-1',
  checkpoint_number: 1,
  observed_remote_state: 'unknown',
  operation_id: 'operation-1',
  state: 'unknown',
} as VariationListingOperationAttemptRow;

describe('variation listing row mappers', () => {
  it('maps the identity and lifecycle fields used by aggregate code and preserves the complete source row', () => {
    expect(mapVariationListingGroupRow(groupRow)).toEqual({
      desiredRevision: 7,
      groupId: 'group-1',
      groupKey: 'group-key-1',
      lastConfirmedRevision: 5,
      lifecycleState: 'review',
      recoveryRequired: false,
      source: groupRow,
    });
    expect(mapVariationListingVariationRow(variationRow)).toMatchObject({ source: variationRow, variationId: 'variation-1' });
    expect(mapVariationListingCopyRow(copyRow)).toMatchObject({ copyId: 'copy-1', source: copyRow });
    expect(mapVariationListingIntakeSessionRow(sessionRow)).toMatchObject({ captureSourceKey: 'camera-1', sessionVersion: 3, source: sessionRow });
  });

  it('maps immutable publishing revision and journal evidence fields without dropping the source rows', () => {
    expect(mapVariationListingRevisionRow(revisionRow)).toMatchObject({ capturedDesiredRevision: 7, revisionId: 'revision-1', source: revisionRow });
    expect(mapVariationListingOperationRow(operationRow)).toMatchObject({ currentState: 'unknown', operationId: 'operation-1', sequenceNo: 2, source: operationRow });
    expect(mapVariationListingOperationAttemptRow(attemptRow)).toMatchObject({ attemptNumber: 2, checkpointId: 'checkpoint-1', source: attemptRow });
  });
});

function createOrderedListClient(table: string, rows: unknown[], filters: Array<[string, string]>, orders: Array<[string, boolean]>): SupabaseDataClient {
  return {
    from: vi.fn((actualTable: string) => {
      expect(actualTable).toBe(table);
      return {
        select: vi.fn(() => {
          let filterIndex = 0;
          let orderIndex = 0;
          const query: Record<string, unknown> = {
            eq: vi.fn((column: string, value: string) => {
              expect([column, value]).toEqual(filters[filterIndex]);
              filterIndex += 1;
              return query;
            }),
            order: vi.fn((column: string, options: { ascending: boolean }) => {
              expect([column, options.ascending]).toEqual(orders[orderIndex]);
              orderIndex += 1;
              if (orderIndex === orders.length) {
                return Promise.resolve({ data: rows, error: null });
              }
              return query;
            }),
          };
          return query;
        }),
      };
    }),
  } as unknown as SupabaseDataClient;
}

describe('variation listing repository reads', () => {
  it('loads revision operations in authoritative sequence order', async () => {
    const client = createOrderedListClient(
      'variation_listing_operations',
      [operationRow],
      [['revision_id', 'revision-1']],
      [['sequence_no', true]]
    );

    await expect(listVariationListingOperationsByRevisionId(client, 'revision-1')).resolves.toEqual([
      mapVariationListingOperationRow(operationRow),
    ]);
  });

  it('loads append-only attempt history in attempt/checkpoint order', async () => {
    const client = createOrderedListClient(
      'variation_listing_operation_attempts',
      [attemptRow],
      [['operation_id', 'operation-1']],
      [['attempt_number', true], ['checkpoint_number', true]]
    );

    await expect(listVariationListingOperationAttemptsByOperationId(client, 'operation-1')).resolves.toEqual([
      mapVariationListingOperationAttemptRow(attemptRow),
    ]);
  });
});
