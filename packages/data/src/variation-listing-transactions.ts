import type {
  Json,
  VariationListingCopyRow,
  VariationListingGroupRow,
  VariationListingOperationAttemptRow,
  VariationListingOperationRow,
  VariationListingRevisionRow,
  VariationListingVariationRow,
} from './database.js';

export interface VariationListingAggregateSnapshot {
  copies: VariationListingCopyRow[];
  group: VariationListingGroupRow;
  variations: VariationListingVariationRow[];
}

export interface VariationListingRevisionPlanOperationInput {
  intent: Json;
  intentDigest: string;
  intentVersion: number;
  operationId: string;
  operationKey: string;
  operationKind: VariationListingOperationRow['operation_kind'];
  sequenceNo: number;
  targetRef: string;
}

export interface CaptureVariationListingRevisionInput {
  capturedDesiredRevision: number;
  groupId: string;
  operations: VariationListingRevisionPlanOperationInput[];
  revisionId: string;
  snapshot: Json;
  snapshotDigest: string;
  snapshotVersion: number;
}

export interface CaptureVariationListingRevisionResult {
  operations: VariationListingOperationRow[];
  revision: VariationListingRevisionRow;
}

export interface AppendVariationListingJournalCheckpointInput {
  attemptNumber: number;
  checkpointId: string;
  checkpointNumber: number;
  currentEvidence: Json | null;
  currentEvidenceState: VariationListingOperationRow['current_evidence_state'];
  currentState: VariationListingOperationRow['current_state'];
  decision?: string | null;
  errorEvidence?: Json | null;
  evidenceVersion: number;
  observedRemoteState?: VariationListingOperationAttemptRow['observed_remote_state'];
  operationId: string;
  postEvidence?: Json | null;
  preEvidence?: Json | null;
  remoteIdentity?: Json | null;
  responseEvidence?: Json | null;
  state: VariationListingOperationAttemptRow['state'];
}

export interface AppendVariationListingJournalCheckpointResult {
  attempt: VariationListingOperationAttemptRow;
  operation: VariationListingOperationRow;
}

export interface ConfirmVariationListingRevisionInput {
  confirmedRevision: number;
  expectedPreviousConfirmedRevision: number | null;
  groupId: string;
}

export interface VariationListingTransactionGateway {
  appendJournalCheckpoint(
    input: AppendVariationListingJournalCheckpointInput
  ): Promise<AppendVariationListingJournalCheckpointResult>;
  captureRevision(
    input: CaptureVariationListingRevisionInput
  ): Promise<CaptureVariationListingRevisionResult>;
  confirmRevision(input: ConfirmVariationListingRevisionInput): Promise<VariationListingGroupRow>;
  loadAggregate(groupId: string): Promise<VariationListingAggregateSnapshot | null>;
}

export interface VariationListingJournalInspection {
  hasConflictingProjection: boolean;
  hasUnknownHistory: boolean;
  latestAttemptNumber: number;
  latestCheckpoint: VariationListingOperationAttemptRow | null;
  requiresReconciliation: boolean;
}

const OPERATION_STATES = new Set(['planned', 'started', 'confirmed_complete', 'confirmed_no_op', 'unknown']);
const ATTEMPT_STATES = new Set(['started', 'confirmed_complete', 'confirmed_no_op', 'unknown']);
const EVIDENCE_STATES = new Set(['present', 'proven_absent', 'unknown']);
const OPERATION_KINDS = new Set([
  'media_ingest',
  'child_inventory_item_write',
  'child_offer_write',
  'complete_group_replace',
  'group_publish',
  'revision_reconcile',
  'withdrawal',
  'cleanup_offer',
  'cleanup_group',
  'cleanup_child_inventory_item',
  'final_absence_verification',
]);
const READ_ONLY_OPERATION_KINDS = new Set(['revision_reconcile', 'final_absence_verification']);

function assertEnum(value: string | null, allowed: ReadonlySet<string>, label: string): void {
  if (value !== null && !allowed.has(value)) {
    throw new Error(`Variation listing journal ${label} has invalid value "${value}".`);
  }
}

function assertRequiredEnum(value: string | null, allowed: ReadonlySet<string>, label: string): void {
  if (value === null || !allowed.has(value)) {
    throw new Error(`Variation listing journal ${label} has invalid value "${String(value)}".`);
  }
}

function compareCheckpointOrder(
  left: VariationListingOperationAttemptRow,
  right: VariationListingOperationAttemptRow
): number {
  if (left.attempt_number !== right.attempt_number) {
    return left.attempt_number - right.attempt_number;
  }

  return left.checkpoint_number - right.checkpoint_number;
}

export function inspectVariationListingJournal(
  operation: VariationListingOperationRow,
  attempts: readonly VariationListingOperationAttemptRow[]
): VariationListingJournalInspection {
  assertRequiredEnum(operation.current_state, OPERATION_STATES, 'operation state');
  assertEnum(operation.current_evidence_state, EVIDENCE_STATES, 'operation evidence state');
  assertEnum(operation.operation_kind, OPERATION_KINDS, 'operation kind');

  if (!Number.isInteger(operation.latest_attempt_number) || operation.latest_attempt_number < 0) {
    throw new Error('Variation listing operation latest attempt number must be a non-negative integer.');
  }

  for (const attempt of attempts) {
    if (
      attempt.operation_id !== operation.operation_id ||
      !Number.isInteger(attempt.attempt_number) ||
      attempt.attempt_number < 1 ||
      !Number.isInteger(attempt.checkpoint_number) ||
      attempt.checkpoint_number < 1
    ) {
      throw new Error(
        `Variation listing operation ${operation.operation_id} history contains invalid attempt identity/numbering.`
      );
    }
    assertRequiredEnum(attempt.state, ATTEMPT_STATES, 'attempt state');
    assertEnum(attempt.observed_remote_state, EVIDENCE_STATES, 'observed remote state');
  }

  for (let index = 1; index < attempts.length; index += 1) {
    const previous = attempts[index - 1];
    const current = attempts[index];

    if (!previous || !current || compareCheckpointOrder(previous, current) >= 0) {
      throw new Error(
        'Variation listing journal attempts must be strictly ordered by attempt/checkpoint.'
      );
    }

    const contiguous =
      (current.attempt_number === previous.attempt_number &&
        current.checkpoint_number === previous.checkpoint_number + 1) ||
      (current.attempt_number === previous.attempt_number + 1 && current.checkpoint_number === 1);
    if (!contiguous) {
      throw new Error(
        'Variation listing journal attempts must use contiguous attempt/checkpoint numbers.'
      );
    }
  }

  if (attempts.length > 0) {
    const first = attempts[0];
    if (!first || first.operation_id !== operation.operation_id) {
      throw new Error(
        `Variation listing operation ${operation.operation_id} history contains an attempt for another operation.`
      );
    }
    if (first.attempt_number !== 1 || first.checkpoint_number !== 1) {
      throw new Error('Variation listing journal history must begin at attempt 1/checkpoint 1.');
    }
    assertEnum(first.state, ATTEMPT_STATES, 'attempt state');
    assertEnum(first.observed_remote_state, EVIDENCE_STATES, 'observed remote state');

    // Every mutating operation must durably mark the external request as
    // started before recording an outcome. Read-only reconciliation may begin
    // with an exact terminal observation because it does not issue a mutation.
    if (!READ_ONLY_OPERATION_KINDS.has(operation.operation_kind) && first.state !== 'started') {
      throw new Error(
        `Variation listing mutation operation ${operation.operation_id} must begin with a started checkpoint.`
      );
    }
    if (
      (first.state === 'confirmed_complete' || first.state === 'confirmed_no_op') &&
      (first.observed_remote_state !== 'present' && first.observed_remote_state !== 'proven_absent')
    ) {
      throw new Error(
        `Variation listing terminal checkpoint for ${operation.operation_id} requires exact remote evidence.`
      );
    }
  }

  // Mirror the database transition matrix over the complete durable history:
  // started may resolve only at the next checkpoint of that same attempt;
  // unknown may resolve only at checkpoint 1 of the next attempt with exact
  // present/proven_absent evidence; terminal outcomes cannot be reopened.
  for (let index = 1; index < attempts.length; index += 1) {
    const previous = attempts[index - 1];
    const current = attempts[index];
    if (!previous || !current) continue;

    const terminal = (state: VariationListingOperationAttemptRow['state']) =>
      state === 'confirmed_complete' || state === 'confirmed_no_op';
    const previousAmbiguous =
      previous.state === 'unknown' || previous.observed_remote_state === 'unknown';

    if (
      terminal(current.state) &&
      current.observed_remote_state !== 'present' &&
      current.observed_remote_state !== 'proven_absent'
    ) {
      throw new Error(
        `Variation listing terminal checkpoint for ${operation.operation_id} requires exact remote evidence.`
      );
    }

    if (previous.state === 'started') {
      if (
        current.attempt_number !== previous.attempt_number ||
        current.checkpoint_number !== previous.checkpoint_number + 1 ||
        (current.state !== 'unknown' && !terminal(current.state))
      ) {
        throw new Error(
          `Variation listing operation ${operation.operation_id} started checkpoint must resolve on the same attempt before retry.`
        );
      }
    } else if (previousAmbiguous) {
      if (
        current.attempt_number !== previous.attempt_number + 1 ||
        current.checkpoint_number !== 1 ||
        !terminal(current.state) ||
        (current.observed_remote_state !== 'present' && current.observed_remote_state !== 'proven_absent')
      ) {
        throw new Error(
          `Variation listing operation ${operation.operation_id} ambiguous outcome requires an exact reconciliation checkpoint.`
        );
      }
    } else if (terminal(previous.state)) {
      throw new Error(
        `Variation listing operation ${operation.operation_id} is terminal and cannot be reopened.`
      );
    }
  }

  const latestCheckpoint = attempts.at(-1) ?? null;
  const latestAttemptNumber = latestCheckpoint?.attempt_number ?? 0;

  if (
    latestCheckpoint === null &&
    (operation.current_state !== 'planned' ||
      operation.current_evidence_state !== null ||
      operation.current_evidence !== null)
  ) {
    throw new Error(
      `Variation listing operation ${operation.operation_id} has a non-planned projection without durable checkpoint history.`
    );
  }

  if (operation.latest_attempt_number !== latestAttemptNumber) {
    throw new Error(
      `Variation listing operation ${operation.operation_id} projection attempt ${operation.latest_attempt_number} does not match append-only history ${latestAttemptNumber}.`
    );
  }

  const hasUnknownHistory = attempts.some(
    (attempt) => attempt.state === 'unknown' || attempt.observed_remote_state === 'unknown'
  );

  // A durable attempt that is still in flight (started) or whose outcome is
  // ambiguous (unknown) is unresolved; only a confirmed checkpoint with exact
  // evidence resolves the latest durable state. Historical unknown evidence is
  // preserved forever but does not permanently block continuation once a later
  // exact reconciliation checkpoint resolves the current state.
  const latestStateUnresolved = Boolean(
    latestCheckpoint &&
    (latestCheckpoint.state === 'started' ||
      latestCheckpoint.state === 'unknown' ||
      latestCheckpoint.observed_remote_state === 'unknown')
  );
  const projectionUnknown =
    operation.current_state === 'unknown' || operation.current_evidence_state === 'unknown';
  const hasConflictingProjection = Boolean(
    latestCheckpoint &&
    (operation.current_state !== latestCheckpoint.state ||
      operation.current_evidence_state !== latestCheckpoint.observed_remote_state)
  );

  return {
    hasConflictingProjection,
    hasUnknownHistory,
    latestAttemptNumber,
    latestCheckpoint,
    requiresReconciliation: Boolean(
      latestStateUnresolved || projectionUnknown || hasConflictingProjection
    ),
  };
}

export function assertVariationListingJournalCanContinue(
  operation: VariationListingOperationRow,
  attempts: readonly VariationListingOperationAttemptRow[]
): void {
  const inspection = inspectVariationListingJournal(operation, attempts);

  if (inspection.requiresReconciliation) {
    throw new Error(
      `Variation listing operation ${operation.operation_id} requires exact reconciliation before another remote mutation.`
    );
  }

  if (inspection.latestCheckpoint?.state === 'confirmed_complete' || inspection.latestCheckpoint?.state === 'confirmed_no_op') {
    throw new Error(
      `Variation listing operation ${operation.operation_id} is terminal and cannot be reopened for another remote mutation.`
    );
  }
}
