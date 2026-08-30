import { describe, expect, it, vi } from 'vitest';
import type { SupabaseDataClient } from '../src/index.js';
import {
  VariationListingTransactionConflictError,
  createSupabaseVariationListingTransactionGateway,
} from '../src/index.js';

function revisionJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    revision_id: 'revision-1',
    group_id: 'group-1',
    captured_desired_revision: 3,
    snapshot_version: 1,
    snapshot_digest: 'a'.repeat(64),
    snapshot: { group_id: 'group-1' },
    operation_count: 1,
    captured_at: '2026-08-30T00:00:00.000Z',
    ...overrides,
  };
}

function operationJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    operation_id: 'operation-1',
    revision_id: 'revision-1',
    sequence_no: 1,
    operation_key: 'group-1',
    operation_kind: 'complete_group_replace',
    target_ref: 'group/group-1',
    intent_version: 1,
    intent_digest: 'b'.repeat(64),
    intent: { group_id: 'group-1' },
    current_state: 'planned',
    current_evidence_state: null,
    current_evidence: null,
    latest_attempt_number: 0,
    created_at: '2026-08-30T00:00:00.000Z',
    updated_at: '2026-08-30T00:00:00.000Z',
    ...overrides,
  };
}

function attemptJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    checkpoint_id: 'checkpoint-1',
    operation_id: 'operation-1',
    attempt_number: 1,
    checkpoint_number: 1,
    state: 'started',
    evidence_version: 1,
    pre_evidence: null,
    response_evidence: null,
    post_evidence: null,
    error_evidence: null,
    remote_identity: null,
    decision: null,
    observed_remote_state: null,
    created_at: '2026-08-30T00:00:00.000Z',
    ...overrides,
  };
}

function groupJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    group_id: 'group-1',
    group_key: 'VL-G-1',
    sku_category_code: 'BSKBL',
    sku_bucket_token: 'BinderA',
    next_inventory_serial: 2,
    lifecycle_state: 'review',
    recovery_required: false,
    selector_name: 'Card',
    title: null,
    description: null,
    derived_common_ebay_aspects: {},
    category_id: '183454',
    marketplace_id: 'EBAY_US',
    listing_format: 'FIXED_PRICE',
    merchant_location_key: 'loc',
    fulfillment_policy_id: 'fulfill',
    payment_policy_id: 'pay',
    return_policy_id: 'return',
    condition_id: '1000',
    condition_token: 'NEAR_MINT_OR_BETTER',
    condition_description: null,
    condition_descriptors: [],
    desired_revision: 3,
    last_confirmed_revision: 3,
    created_at: '2026-08-30T00:00:00.000Z',
    updated_at: '2026-08-30T00:00:00.000Z',
    ...overrides,
  };
}

type RpcResponse = {
  data: unknown;
  error: { code?: string; message: string } | null;
};

function createRpcClient(
  handlers: Record<string, (args: Record<string, unknown>) => RpcResponse>
): SupabaseDataClient {
  return {
    from: vi.fn(() => {
      throw new Error('from() is not expected in the transaction gateway');
    }),
    rpc: vi.fn((fn: string, args: Record<string, unknown>) => {
      const handler = handlers[fn];
      if (!handler) {
        throw new Error(`unexpected rpc call: ${fn}`);
      }

      return {
        single: vi.fn(() => Promise.resolve(handler(args))),
      };
    }),
  } as unknown as SupabaseDataClient;
}

describe('Supabase variation listing transaction gateway', () => {
  it('captures a revision by mapping camelCase inputs to RPC args and validating returned rows', async () => {
    let capturedArgs: Record<string, unknown> | undefined;
    const client = createRpcClient({
      capture_variation_listing_revision: (args) => {
        capturedArgs = args;
        return {
          data: { revision: revisionJson(), operations: [operationJson()] },
          error: null,
        };
      },
    });

    const gateway = createSupabaseVariationListingTransactionGateway(client);
    const result = await gateway.captureRevision({
      groupId: 'group-1',
      revisionId: 'revision-1',
      capturedDesiredRevision: 3,
      snapshotVersion: 1,
      snapshotDigest: 'a'.repeat(64),
      snapshot: { group_id: 'group-1' },
      operations: [
        {
          operationId: 'operation-1',
          operationKey: 'group-1',
          operationKind: 'complete_group_replace',
          targetRef: 'group/group-1',
          sequenceNo: 1,
          intentVersion: 1,
          intentDigest: 'b'.repeat(64),
          intent: { group_id: 'group-1' },
        },
      ],
    });

    expect(capturedArgs).toEqual({
      p_group_id: 'group-1',
      p_revision_id: 'revision-1',
      p_captured_desired_revision: 3,
      p_snapshot_version: 1,
      p_snapshot_digest: 'a'.repeat(64),
      p_snapshot: { group_id: 'group-1' },
      p_operations: [
        {
          operation_id: 'operation-1',
          operation_key: 'group-1',
          operation_kind: 'complete_group_replace',
          target_ref: 'group/group-1',
          sequence_no: 1,
          intent_version: 1,
          intent_digest: 'b'.repeat(64),
          intent: { group_id: 'group-1' },
        },
      ],
    });
    expect(result.revision.revision_id).toBe('revision-1');
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].operation_id).toBe('operation-1');
  });

  it('rejects capture responses whose returned plan identity differs from the request', async () => {
    const client = createRpcClient({
      capture_variation_listing_revision: () => ({
        data: {
          revision: revisionJson({ revision_id: 'other-revision' }),
          operations: [operationJson({ operation_id: 'other-operation' })],
        },
        error: null,
      }),
    });
    const gateway = createSupabaseVariationListingTransactionGateway(client);

    await expect(
      gateway.captureRevision({
        groupId: 'group-1',
        revisionId: 'revision-1',
        capturedDesiredRevision: 3,
        snapshotVersion: 1,
        snapshotDigest: 'a'.repeat(64),
        snapshot: { group_id: 'group-1' },
        operations: [
          {
            operationId: 'operation-1',
            operationKey: 'group-1',
            operationKind: 'complete_group_replace',
            targetRef: 'group/group-1',
            sequenceNo: 1,
            intentVersion: 1,
            intentDigest: 'b'.repeat(64),
            intent: { group_id: 'group-1' },
          },
        ],
      })
    ).rejects.toThrow('response parity mismatch');
  });

  it('rejects capture responses whose returned operation intent differs from its digest plan', async () => {
    const client = createRpcClient({
      capture_variation_listing_revision: () => ({
        data: {
          revision: revisionJson(),
          operations: [operationJson({ intent: { group_id: 'different-group' } })],
        },
        error: null,
      }),
    });
    const gateway = createSupabaseVariationListingTransactionGateway(client);

    await expect(
      gateway.captureRevision({
        groupId: 'group-1',
        revisionId: 'revision-1',
        capturedDesiredRevision: 3,
        snapshotVersion: 1,
        snapshotDigest: 'a'.repeat(64),
        snapshot: { group_id: 'group-1' },
        operations: [
          {
            operationId: 'operation-1',
            operationKey: 'group-1',
            operationKind: 'complete_group_replace',
            targetRef: 'group/group-1',
            sequenceNo: 1,
            intentVersion: 1,
            intentDigest: 'b'.repeat(64),
            intent: { group_id: 'group-1' },
          },
        ],
      })
    ).rejects.toThrow('response parity mismatch');
  });

  it('appends a journal checkpoint by mapping every nullable field and parsing the returned rows', async () => {
    let capturedArgs: Record<string, unknown> | undefined;
    const client = createRpcClient({
      append_variation_listing_journal_checkpoint: (args) => {
        capturedArgs = args;
        return {
          data: {
            operation: operationJson({ current_state: 'started', latest_attempt_number: 1 }),
            attempt: attemptJson(),
          },
          error: null,
        };
      },
    });

    const gateway = createSupabaseVariationListingTransactionGateway(client);
    const result = await gateway.appendJournalCheckpoint({
      operationId: 'operation-1',
      checkpointId: 'checkpoint-1',
      attemptNumber: 1,
      checkpointNumber: 1,
      state: 'started',
      evidenceVersion: 1,
      currentState: 'started',
      currentEvidenceState: null,
      currentEvidence: null,
    });

    expect(capturedArgs).toEqual({
      p_operation_id: 'operation-1',
      p_checkpoint_id: 'checkpoint-1',
      p_attempt_number: 1,
      p_checkpoint_number: 1,
      p_state: 'started',
      p_evidence_version: 1,
      p_pre_evidence: null,
      p_response_evidence: null,
      p_post_evidence: null,
      p_error_evidence: null,
      p_remote_identity: null,
      p_decision: null,
      p_observed_remote_state: null,
      p_current_state: 'started',
      p_current_evidence_state: null,
      p_current_evidence: null,
    });
    expect(result.attempt.checkpoint_id).toBe('checkpoint-1');
    expect(result.operation.latest_attempt_number).toBe(1);
  });

  it('rejects append responses whose operation and attempt identities disagree', async () => {
    const client = createRpcClient({
      append_variation_listing_journal_checkpoint: () => ({
        data: {
          operation: operationJson({ operation_id: 'other-operation', latest_attempt_number: 9 }),
          attempt: attemptJson({ operation_id: 'other-operation', attempt_number: 9 }),
        },
        error: null,
      }),
    });
    const gateway = createSupabaseVariationListingTransactionGateway(client);

    await expect(
      gateway.appendJournalCheckpoint({
        operationId: 'operation-1',
        checkpointId: 'checkpoint-1',
        attemptNumber: 1,
        checkpointNumber: 1,
        state: 'started',
        evidenceVersion: 1,
        currentState: 'started',
        currentEvidenceState: null,
        currentEvidence: null,
      })
    ).rejects.toThrow('response parity mismatch');
  });

  it('rejects confirmation responses whose group watermark differs from the request', async () => {
    const client = createRpcClient({
      confirm_variation_listing_revision: () => ({
        data: { group_row: groupJson({ last_confirmed_revision: 2 }) },
        error: null,
      }),
    });
    const gateway = createSupabaseVariationListingTransactionGateway(client);

    await expect(
      gateway.confirmRevision({
        groupId: 'group-1',
        expectedPreviousConfirmedRevision: null,
        confirmedRevision: 3,
      })
    ).rejects.toThrow('response parity mismatch');
  });

  it('confirms a revision and parses the returned group row', async () => {
    let capturedArgs: Record<string, unknown> | undefined;
    const client = createRpcClient({
      confirm_variation_listing_revision: (args) => {
        capturedArgs = args;
        return { data: { group_row: groupJson() }, error: null };
      },
    });

    const gateway = createSupabaseVariationListingTransactionGateway(client);
    const result = await gateway.confirmRevision({
      groupId: 'group-1',
      expectedPreviousConfirmedRevision: null,
      confirmedRevision: 3,
    });

    expect(capturedArgs).toEqual({
      p_group_id: 'group-1',
      p_expected_previous_confirmed_revision: null,
      p_confirmed_revision: 3,
    });
    expect(result.group_id).toBe('group-1');
    expect(result.last_confirmed_revision).toBe(3);
  });

  it('surfaces stale CAS conflicts as a stable typed error', async () => {
    const client = createRpcClient({
      confirm_variation_listing_revision: () => ({
        data: null,
        error: { code: 'VR001', message: 'variation listing confirmation CAS mismatch' },
      }),
    });

    const gateway = createSupabaseVariationListingTransactionGateway(client);

    await expect(
      gateway.confirmRevision({
        groupId: 'group-1',
        expectedPreviousConfirmedRevision: 1,
        confirmedRevision: 2,
      })
    ).rejects.toBeInstanceOf(VariationListingTransactionConflictError);
  });

  it('surfaces unresolved-revision authority failures as a stable typed error', async () => {
    const client = createRpcClient({
      confirm_variation_listing_revision: () => ({
        data: null,
        error: {
          code: 'VR004',
          message: 'variation listing revision 2 is not captured for group group-1',
        },
      }),
    });

    const gateway = createSupabaseVariationListingTransactionGateway(client);

    await expect(
      gateway.confirmRevision({
        groupId: 'group-1',
        expectedPreviousConfirmedRevision: null,
        confirmedRevision: 2,
      })
    ).rejects.toBeInstanceOf(VariationListingTransactionConflictError);
  });

  it('rejects a malformed RPC return instead of blindly trusting it', async () => {
    const client = createRpcClient({
      confirm_variation_listing_revision: () => ({
        data: { group_row: { group_id: 42 } },
        error: null,
      }),
    });

    const gateway = createSupabaseVariationListingTransactionGateway(client);

    await expect(
      gateway.confirmRevision({
        groupId: 'group-1',
        expectedPreviousConfirmedRevision: null,
        confirmedRevision: 1,
      })
    ).rejects.toThrow('must be a string');
  });

  it('rejects a non-array operation plan instead of treating it as empty success', async () => {
    const client = createRpcClient({
      capture_variation_listing_revision: () => ({
        data: { revision: revisionJson(), operations: {} },
        error: null,
      }),
    });
    const gateway = createSupabaseVariationListingTransactionGateway(client);

    await expect(
      gateway.captureRevision({
        groupId: 'group-1',
        revisionId: 'revision-1',
        capturedDesiredRevision: 3,
        snapshotVersion: 1,
        snapshotDigest: 'a'.repeat(64),
        snapshot: { group_id: 'group-1' },
        operations: [],
      })
    ).rejects.toThrow('operations');
  });

  it('rejects an empty operation plan whose revision claims work', async () => {
    const client = createRpcClient({
      capture_variation_listing_revision: () => ({
        data: { revision: revisionJson({ operation_count: 1 }), operations: [] },
        error: null,
      }),
    });
    const gateway = createSupabaseVariationListingTransactionGateway(client);

    await expect(
      gateway.captureRevision({
        groupId: 'group-1',
        revisionId: 'revision-1',
        capturedDesiredRevision: 3,
        snapshotVersion: 1,
        snapshotDigest: 'a'.repeat(64),
        snapshot: { group_id: 'group-1' },
        operations: [],
      })
    ).rejects.toThrow('operations');
  });

  it('rejects invalid state and evidence enums in RPC rows', async () => {
    const client = createRpcClient({
      append_variation_listing_journal_checkpoint: () => ({
        data: {
          operation: operationJson({ current_state: 'not-a-state' }),
          attempt: attemptJson({ observed_remote_state: 'not-a-state' }),
        },
        error: null,
      }),
    });
    const gateway = createSupabaseVariationListingTransactionGateway(client);

    await expect(
      gateway.appendJournalCheckpoint({
        operationId: 'operation-1',
        checkpointId: 'checkpoint-1',
        attemptNumber: 1,
        checkpointNumber: 1,
        state: 'started',
        evidenceVersion: 1,
        currentState: 'started',
        currentEvidenceState: null,
        currentEvidence: null,
      })
    ).rejects.toThrow('invalid value');
  });
});
