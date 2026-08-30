import { describe, expect, it } from 'vitest';
import type {
  VariationListingOperationAttemptRow,
  VariationListingOperationRow,
} from '../src/index.js';
import {
  assertVariationListingJournalCanContinue,
  inspectVariationListingJournal,
} from '../src/index.js';

function operationRow(
  overrides: Partial<VariationListingOperationRow> = {}
): VariationListingOperationRow {
  return {
    created_at: '2026-08-30T00:00:00.000Z',
    current_evidence: null,
    current_evidence_state: null,
    current_state: 'planned',
    intent: {},
    intent_digest: 'a'.repeat(64),
    intent_version: 1,
    latest_attempt_number: 0,
    operation_id: 'operation-1',
    operation_key: 'group-replace',
    operation_kind: 'complete_group_replace',
    revision_id: 'revision-1',
    sequence_no: 1,
    target_ref: 'group-1',
    updated_at: '2026-08-30T00:00:00.000Z',
    ...overrides,
  };
}

function attemptRow(
  overrides: Partial<VariationListingOperationAttemptRow> = {}
): VariationListingOperationAttemptRow {
  return {
    attempt_number: 1,
    checkpoint_id: 'checkpoint-1',
    checkpoint_number: 1,
    created_at: '2026-08-30T00:00:00.000Z',
    decision: null,
    error_evidence: null,
    evidence_version: 1,
    observed_remote_state: null,
    operation_id: 'operation-1',
    post_evidence: null,
    pre_evidence: null,
    remote_identity: null,
    response_evidence: null,
    state: 'started',
    ...overrides,
  };
}

describe('variation listing journal inspection', () => {
  it('accepts a planned operation with no attempt history', () => {
    expect(inspectVariationListingJournal(operationRow(), [])).toMatchObject({
      hasConflictingProjection: false,
      hasUnknownHistory: false,
      latestAttemptNumber: 0,
      latestCheckpoint: null,
      requiresReconciliation: false,
    });
  });

  it('rejects a confirmed projection with no durable checkpoint history', () => {
    const operation = operationRow({
      current_evidence_state: 'present',
      current_state: 'confirmed_complete',
      current_evidence: { verified: true },
      latest_attempt_number: 0,
    });

    expect(() => inspectVariationListingJournal(operation, [])).toThrow(
      'non-planned projection without durable checkpoint history'
    );
  });

  it('fails closed when append-only history contains an unresolved unknown outcome', () => {
    const operation = operationRow({
      current_evidence_state: 'unknown',
      current_state: 'unknown',
      latest_attempt_number: 1,
    });
    const attempts = [
      attemptRow({ checkpoint_number: 1, state: 'started' }),
      attemptRow({
        checkpoint_id: 'checkpoint-2',
        checkpoint_number: 2,
        observed_remote_state: 'unknown',
        state: 'unknown',
      }),
    ];

    expect(inspectVariationListingJournal(operation, attempts).requiresReconciliation).toBe(true);
    expect(() => assertVariationListingJournalCanContinue(operation, attempts)).toThrow(
      'requires exact reconciliation'
    );
  });

  it('rejects a projection whose latest attempt number regresses behind durable history', () => {
    const operation = operationRow({ latest_attempt_number: 0 });
    const attempts = [attemptRow()];

    expect(() => inspectVariationListingJournal(operation, attempts)).toThrow(
      'does not match append-only history'
    );
  });

  it('rejects unordered checkpoint history', () => {
    const operation = operationRow({ latest_attempt_number: 1 });
    const attempts = [
      attemptRow({ checkpoint_id: 'checkpoint-2', checkpoint_number: 2 }),
      attemptRow({ checkpoint_id: 'checkpoint-1', checkpoint_number: 1 }),
    ];

    expect(() => inspectVariationListingJournal(operation, attempts)).toThrow(
      'strictly ordered by attempt/checkpoint'
    );
  });

  it('treats a confirmed checkpoint as terminal and blocks reopening', () => {
    const operation = operationRow({
      current_evidence_state: 'present',
      current_state: 'confirmed_complete',
      latest_attempt_number: 1,
    });
    const attempts = [
      attemptRow({
        state: 'started',
      }),
      attemptRow({
        checkpoint_id: 'checkpoint-2',
        checkpoint_number: 2,
        observed_remote_state: 'present',
        state: 'confirmed_complete',
      }),
    ];

    expect(inspectVariationListingJournal(operation, attempts)).toMatchObject({
      hasConflictingProjection: false,
      hasUnknownHistory: false,
      requiresReconciliation: false,
    });
    expect(() => assertVariationListingJournalCanContinue(operation, attempts)).toThrow(
      'terminal and cannot be reopened'
    );
  });

  it('blocks continuation while the latest attempt is still in flight (started)', () => {
    const operation = operationRow({ current_state: 'started', latest_attempt_number: 1 });
    const attempts = [attemptRow({ state: 'started' })];

    expect(inspectVariationListingJournal(operation, attempts).requiresReconciliation).toBe(true);
    expect(() => assertVariationListingJournalCanContinue(operation, attempts)).toThrow(
      'requires exact reconciliation'
    );
  });

  it('treats a confirmed no-op checkpoint as terminal and blocks reopening', () => {
    const operation = operationRow({
      current_evidence_state: 'proven_absent',
      current_state: 'confirmed_no_op',
      latest_attempt_number: 1,
    });
    const attempts = [
      attemptRow({ state: 'started' }),
      attemptRow({
        checkpoint_id: 'checkpoint-2',
        checkpoint_number: 2,
        observed_remote_state: 'proven_absent',
        state: 'confirmed_no_op',
      }),
    ];

    expect(inspectVariationListingJournal(operation, attempts)).toMatchObject({
      hasConflictingProjection: false,
      requiresReconciliation: false,
    });
    expect(() => assertVariationListingJournalCanContinue(operation, attempts)).toThrow(
      'terminal and cannot be reopened'
    );
  });

  it('fails closed when the projection disagrees with the latest durable state', () => {
    const operation = operationRow({ current_state: 'unknown', latest_attempt_number: 1 });
    const attempts = [
      attemptRow({ state: 'started' }),
      attemptRow({
        checkpoint_id: 'checkpoint-2',
        checkpoint_number: 2,
        observed_remote_state: 'present',
        state: 'confirmed_complete',
      }),
    ];

    const inspection = inspectVariationListingJournal(operation, attempts);
    expect(inspection.hasConflictingProjection).toBe(true);
    expect(inspection.requiresReconciliation).toBe(true);
    expect(() => assertVariationListingJournalCanContinue(operation, attempts)).toThrow(
      'requires exact reconciliation'
    );
  });

  it('resolves current ambiguity via a later exact reconciliation checkpoint without erasing history', () => {
    const operation = operationRow({
      current_evidence_state: 'present',
      current_state: 'confirmed_complete',
      latest_attempt_number: 2,
    });
    const attempts = [
      attemptRow({ state: 'started' }),
      attemptRow({
        checkpoint_id: 'checkpoint-unknown',
        checkpoint_number: 2,
        state: 'unknown',
        observed_remote_state: 'unknown',
      }),
      attemptRow({
        attempt_number: 2,
        checkpoint_id: 'checkpoint-3',
        checkpoint_number: 1,
        observed_remote_state: 'present',
        state: 'confirmed_complete',
      }),
    ];

    const inspection = inspectVariationListingJournal(operation, attempts);
    expect(inspection.hasUnknownHistory).toBe(true);
    expect(inspection.requiresReconciliation).toBe(false);
    expect(() => assertVariationListingJournalCanContinue(operation, attempts)).toThrow(
      'terminal and cannot be reopened'
    );
  });

  it('rejects projection evidence that disagrees with latest durable evidence', () => {
    const operation = operationRow({
      current_evidence_state: null,
      current_state: 'started',
      latest_attempt_number: 1,
    });
    const attempts = [attemptRow({ observed_remote_state: 'present', state: 'started' })];

    expect(inspectVariationListingJournal(operation, attempts)).toMatchObject({
      hasConflictingProjection: true,
      requiresReconciliation: true,
    });
    expect(() => assertVariationListingJournalCanContinue(operation, attempts)).toThrow(
      'requires exact reconciliation'
    );
  });

  it('rejects skipped attempt/checkpoint numbers in durable history', () => {
    const operation = operationRow({ current_state: 'started', latest_attempt_number: 2 });
    const attempts = [
      attemptRow({ state: 'started' }),
      attemptRow({ attempt_number: 2, checkpoint_number: 2, checkpoint_id: 'checkpoint-2' }),
    ];

    expect(() => inspectVariationListingJournal(operation, attempts)).toThrow(
      'contiguous attempt/checkpoint numbers'
    );
  });

  it('rejects a mutating history that starts with a terminal checkpoint', () => {
    const operation = operationRow({
      current_state: 'confirmed_complete',
      current_evidence_state: 'present',
      latest_attempt_number: 1,
    });
    expect(() =>
      inspectVariationListingJournal(operation, [
        attemptRow({ state: 'confirmed_complete', observed_remote_state: 'present' }),
      ])
    ).toThrow('must begin with a started checkpoint');
  });

  it('rejects started history that jumps directly to a new attempt', () => {
    const operation = operationRow({
      current_state: 'confirmed_complete',
      current_evidence_state: 'present',
      latest_attempt_number: 2,
    });
    expect(() =>
      inspectVariationListingJournal(operation, [
        attemptRow({ state: 'started' }),
        attemptRow({
          attempt_number: 2,
          checkpoint_id: 'checkpoint-2',
          state: 'confirmed_complete',
          observed_remote_state: 'present',
        }),
      ])
    ).toThrow('started checkpoint must resolve on the same attempt');
  });

  it('rejects a same-attempt terminal checkpoint with unknown evidence', () => {
    const operation = operationRow({
      current_state: 'confirmed_complete',
      current_evidence_state: 'unknown',
      latest_attempt_number: 1,
    });
    expect(() =>
      inspectVariationListingJournal(operation, [
        attemptRow({ state: 'started' }),
        attemptRow({
          checkpoint_number: 2,
          checkpoint_id: 'checkpoint-2',
          state: 'confirmed_complete',
          observed_remote_state: 'unknown',
        }),
      ])
    ).toThrow('requires exact remote evidence');
  });

  it('requires exact terminal evidence when resolving an unknown attempt', () => {
    const operation = operationRow({
      current_state: 'confirmed_complete',
      current_evidence_state: 'present',
      latest_attempt_number: 2,
    });
    expect(() =>
      inspectVariationListingJournal(operation, [
        attemptRow({ state: 'started' }),
        attemptRow({
          checkpoint_id: 'checkpoint-unknown',
          checkpoint_number: 2,
          state: 'unknown',
          observed_remote_state: 'unknown',
        }),
        attemptRow({
          attempt_number: 2,
          checkpoint_id: 'checkpoint-3',
          state: 'confirmed_complete',
          observed_remote_state: 'unknown',
        }),
      ])
    ).toThrow('requires exact remote evidence');
  });

  it('rejects unknown state enum values', () => {
    const operation = operationRow({ current_state: 'bogus' as VariationListingOperationRow['current_state'] });
    expect(() => inspectVariationListingJournal(operation, [])).toThrow('invalid value');
  });

  it('rejects unknown operation kind values even with no history', () => {
    const operation = operationRow({ operation_kind: 'bogus-kind' });
    expect(() => inspectVariationListingJournal(operation, [])).toThrow('invalid value');
  });
});
