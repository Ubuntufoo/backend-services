import type {
  Json,
  VariationListingCopyRow,
  VariationListingGroupRow,
  VariationListingIntakeSessionRow,
  VariationListingPublishingCheckpointRow,
  VariationListingRevisionPlanOperation,
  VariationListingRevisionRow,
  VariationListingVariationRow,
} from './database.js';
import type { VariationListingManualPriceAmount } from './variation-listing-pricing.js';
import type { VariationListingCopyConditionToken } from './variation-listing-condition.js';

export const VARIATION_LISTING_CAPTURE_SOURCE_KEY_ENV_VAR = 'WATCHER_CAPTURE_SOURCE_KEY' as const;

export type VariationListingCaptureSourceKeyEnvironment = {
  readonly [VARIATION_LISTING_CAPTURE_SOURCE_KEY_ENV_VAR]?: string;
};

/**
 * Resolve the optional station/camera identity shared by the watcher and sidecar.
 * The value is intentionally not normalized: the durable key is exact once it is set.
 */
export function readVariationListingCaptureSourceKey(
  env: VariationListingCaptureSourceKeyEnvironment = process.env
): string | null {
  const value = env[VARIATION_LISTING_CAPTURE_SOURCE_KEY_ENV_VAR];
  if (value === undefined) return null;
  if (value.length === 0 || value.trim() === '' || value !== value.trim()) {
    throw new Error(
      `${VARIATION_LISTING_CAPTURE_SOURCE_KEY_ENV_VAR} must be a non-empty outer-trimmed string when set.`
    );
  }
  return value;
}

export function requireVariationListingCaptureSourceKey(
  env: VariationListingCaptureSourceKeyEnvironment = process.env
): string {
  const value = readVariationListingCaptureSourceKey(env);
  if (value === null) {
    throw new Error(
      `${VARIATION_LISTING_CAPTURE_SOURCE_KEY_ENV_VAR} is required for variation-listing intake.`
    );
  }
  return value;
}

export interface VariationListingAggregateSnapshot {
  copies: VariationListingCopyRow[];
  group: VariationListingGroupRow;
  variations: VariationListingVariationRow[];
}

export interface VariationListingRevisionPlanOperationInput {
  intent: Json;
  intentDigest: string;
  intentVersion: number;
  operationKey: string;
  operationKind: string;
  sequenceNo: number;
  targetRef: string;
}

export interface CaptureVariationListingRevisionInput {
  capturedDesiredRevision: number;
  groupId: string;
  operationPlan: VariationListingRevisionPlanOperationInput[];
  revisionId: string;
  snapshot: Json;
  snapshotDigest: string;
  snapshotVersion: number;
}

export interface CaptureVariationListingRevisionResult {
  revision: VariationListingRevisionRow;
}

export interface AppendVariationListingJournalCheckpointInput {
  attemptNumber: number;
  checkpointId: string;
  checkpointNumber: number;
  evidence: Json;
  observedRemoteState?: 'present' | 'proven_absent' | 'unknown' | null;
  operationKey: string;
  revisionId: string;
  state: 'started' | 'unknown' | 'retry_authorized' | 'retry_exhausted' | 'confirmed_complete' | 'confirmed_no_op';
}

export interface AppendVariationListingJournalCheckpointResult {
  checkpoint: VariationListingPublishingCheckpointRow;
}

export interface ConfirmVariationListingRevisionInput {
  confirmedRevision: number;
  expectedPreviousConfirmedRevision: number | null;
  groupId: string;
}

export interface ApplyVariationListingGroupReviewDraftInput {
  derivedCommonEbayAspects: Json;
  description: string;
  expectedDesiredRevision: number;
  groupId: string;
  title: string;
}

export interface MarkVariationListingPublishReadyInput {
  expectedDesiredRevision: number;
  groupId: string;
}

export interface ReserveVariationListingActionRevisionInput {
  expectedDesiredRevision: number;
  groupId: string;
}

export interface UpdateVariationListingManualPriceInput {
  expectedDesiredRevision: number;
  groupId: string;
  priceAmount: VariationListingManualPriceAmount;
  variationId: string;
}

export interface UpdateVariationListingSelectorValueInput {
  expectedDesiredRevision: number;
  groupId: string;
  selectorValue: string;
  variationId: string;
}

export interface UpdateVariationListingCopyAvailabilityInput {
  availabilityState: 'available' | 'unavailable';
  copyId: string;
  expectedDesiredRevision: number;
  groupId: string;
  variationId: string;
}

export interface UpdateVariationListingRepresentativeCopyInput {
  copyId: string;
  expectedDesiredRevision: number;
  groupId: string;
  variationId: string;
}

export interface CreateVariationListingGroupInput {
  categoryId: string;
  conditionId: string;
  conditionToken: string;
  fulfillmentPolicyId: string;
  groupId: string;
  groupKey: string;
  marketplaceId: string;
  merchantLocationKey: string;
  paymentPolicyId: string;
  returnPolicyId: string;
  skuBucketToken: string;
  skuCategoryCode: string;
}

export interface ConfigureVariationListingIntakeInput {
  captureSourceKey: string;
  copyConditionToken: VariationListingCopyConditionToken | null;
  mode: 'idle' | 'new_variation' | 'duplicate_copy';
  stickyPriceAmount: VariationListingManualPriceAmount;
  targetGroupId: string | null;
  targetVariationId: string | null;
}

export interface StartVariationListingIntakePairInput {
  captureSourceKey: string;
  frontSourceRef: string;
  pairId: string;
  startedAt: string;
}

export interface CompleteVariationListingNewVariationInput {
  backR2Key: string;
  backSourceRef: string;
  capturePairId: string;
  captureSourceKey: string;
  capturedAt?: string;
  conditionToken: string;
  copyId: string;
  frontR2Key: string;
  selectorValue: string;
  variationId: string;
  variationMetadata: Json;
}

export interface CompleteVariationListingDuplicateCopyInput {
  backR2Key: string;
  backSourceRef: string;
  capturePairId: string;
  captureSourceKey: string;
  capturedAt?: string;
  conditionToken: string;
  copyId: string;
  frontR2Key: string;
  variationId: string;
}

export interface AbandonUntouchedVariationListingGroupInput {
  expectedDesiredRevision: 0;
  groupId: string;
}

export type VariationListingCleanupLifecycle =
  | 'withdrawn'
  | 'cleanup'
  | 'abandoned'
  | 'terminal-absent';

export interface AdvanceVariationListingCleanupLifecycleInput {
  expectedDesiredRevision: number;
  expectedPreviousConfirmedRevision: number | null;
  groupId: string;
  revisionId: string;
  targetLifecycle: VariationListingCleanupLifecycle;
}

export interface VariationListingTransactionGateway {
  abandonUntouchedGroup(
    input: AbandonUntouchedVariationListingGroupInput
  ): Promise<VariationListingGroupRow>;
  appendJournalCheckpoint(
    input: AppendVariationListingJournalCheckpointInput
  ): Promise<AppendVariationListingJournalCheckpointResult>;
  advanceCleanupLifecycle(
    input: AdvanceVariationListingCleanupLifecycleInput
  ): Promise<VariationListingGroupRow>;
  captureRevision(
    input: CaptureVariationListingRevisionInput
  ): Promise<CaptureVariationListingRevisionResult>;
  completeDuplicateCopy(
    input: CompleteVariationListingDuplicateCopyInput
  ): Promise<{ copy: VariationListingCopyRow; group: VariationListingGroupRow }>;
  completeNewVariation(
    input: CompleteVariationListingNewVariationInput
  ): Promise<{
    copy: VariationListingCopyRow;
    group: VariationListingGroupRow;
    variation: VariationListingVariationRow;
  }>;
  configureIntake(
    input: ConfigureVariationListingIntakeInput
  ): Promise<VariationListingIntakeSessionRow>;
  confirmRevision(input: ConfirmVariationListingRevisionInput): Promise<VariationListingGroupRow>;
  applyGroupReviewDraft(
    input: ApplyVariationListingGroupReviewDraftInput
  ): Promise<VariationListingGroupRow>;
  markPublishReady(
    input: MarkVariationListingPublishReadyInput
  ): Promise<VariationListingGroupRow>;
  reserveActionRevision(
    input: ReserveVariationListingActionRevisionInput
  ): Promise<VariationListingGroupRow>;
  updateVariationPrice(
    input: UpdateVariationListingManualPriceInput
  ): Promise<{ group: VariationListingGroupRow; variation: VariationListingVariationRow }>;
  updateVariationSelectorValue(
    input: UpdateVariationListingSelectorValueInput
  ): Promise<{ group: VariationListingGroupRow; variation: VariationListingVariationRow }>;
  updateCopyAvailability(
    input: UpdateVariationListingCopyAvailabilityInput
  ): Promise<{ copy: VariationListingCopyRow; group: VariationListingGroupRow }>;
  updateRepresentativeCopy(
    input: UpdateVariationListingRepresentativeCopyInput
  ): Promise<{ group: VariationListingGroupRow; variation: VariationListingVariationRow }>;
  createGroup(input: CreateVariationListingGroupInput): Promise<VariationListingGroupRow>;
  discardIntakePair(captureSourceKey: string): Promise<VariationListingIntakeSessionRow>;
  loadAggregate(groupId: string): Promise<VariationListingAggregateSnapshot | null>;
  startIntakePair(
    input: StartVariationListingIntakePairInput
  ): Promise<VariationListingIntakeSessionRow>;
}

export interface VariationListingJournalInspection {
  hasUnknownHistory: boolean;
  latestAttemptNumber: number;
  latestCheckpoint: VariationListingPublishingCheckpointRow | null;
  requiresReconciliation: boolean;
  retryAuthorized: boolean;
  retryExhausted: boolean;
}

const CHECKPOINT_STATES = new Set([
  'started',
  'unknown',
  'retry_authorized',
  'retry_exhausted',
  'confirmed_complete',
  'confirmed_no_op',
]);
const EVIDENCE_STATES = new Set(['present', 'proven_absent', 'unknown']);
const TERMINAL_STATES = new Set(['confirmed_complete', 'confirmed_no_op']);
const READ_ONLY_OPERATION_KINDS = new Set(['revision_reconcile', 'final_absence_verification']);

function compareCheckpointOrder(
  left: VariationListingPublishingCheckpointRow,
  right: VariationListingPublishingCheckpointRow
): number {
  return (
    left.attempt_number - right.attempt_number ||
    left.checkpoint_number - right.checkpoint_number
  );
}

function hasExactRemoteEvidence(checkpoint: VariationListingPublishingCheckpointRow): boolean {
  return (
    checkpoint.observed_remote_state === 'present' ||
    checkpoint.observed_remote_state === 'proven_absent'
  );
}

export function inspectVariationListingJournal(
  operation: VariationListingRevisionPlanOperation,
  checkpoints: readonly VariationListingPublishingCheckpointRow[]
): VariationListingJournalInspection {
  const ordered = [...checkpoints].sort(compareCheckpointOrder);

  for (const checkpoint of ordered) {
    if (
      checkpoint.operation_key !== operation.operation_key ||
      !Number.isInteger(checkpoint.attempt_number) ||
      checkpoint.attempt_number < 1 ||
      !Number.isInteger(checkpoint.checkpoint_number) ||
      checkpoint.checkpoint_number < 1 ||
      !CHECKPOINT_STATES.has(checkpoint.state) ||
      (checkpoint.observed_remote_state !== null &&
        !EVIDENCE_STATES.has(checkpoint.observed_remote_state))
    ) {
      throw new Error(
        `Variation listing operation ${operation.operation_key} history contains an invalid checkpoint.`
      );
    }

    if (checkpoint.state === 'started' && checkpoint.observed_remote_state !== null) {
      throw new Error('Variation listing started checkpoint cannot claim remote evidence.');
    }
    if (checkpoint.state === 'unknown' && checkpoint.observed_remote_state !== 'unknown') {
      throw new Error('Variation listing unknown checkpoint requires ambiguity evidence.');
    }
    if (
      (TERMINAL_STATES.has(checkpoint.state) ||
        checkpoint.state === 'retry_authorized' ||
        checkpoint.state === 'retry_exhausted') &&
      !hasExactRemoteEvidence(checkpoint)
    ) {
      throw new Error('Variation listing resolved checkpoint requires exact remote evidence.');
    }
  }

  const first = ordered[0];
  if (first) {
    if (first.attempt_number !== 1 || first.checkpoint_number !== 1) {
      throw new Error('Variation listing journal history must begin at attempt 1/checkpoint 1.');
    }
    if (READ_ONLY_OPERATION_KINDS.has(operation.operation_kind)) {
      if (first.state !== 'started' && !TERMINAL_STATES.has(first.state)) {
        throw new Error(
          `Variation listing read-only operation ${operation.operation_key} must begin with started or terminal checkpoint.`
        );
      }
    } else if (first.state !== 'started') {
      throw new Error(
        `Variation listing mutation operation ${operation.operation_key} must begin with a started checkpoint.`
      );
    }
  }

  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (!previous || !current) continue;

    const contiguous =
      (current.attempt_number === previous.attempt_number &&
        current.checkpoint_number === previous.checkpoint_number + 1) ||
      (current.attempt_number === previous.attempt_number + 1 &&
        current.checkpoint_number === 1);
    if (!contiguous) {
      throw new Error(
        'Variation listing journal checkpoints must use contiguous attempt/checkpoint numbers.'
      );
    }

    if (previous.state === 'started') {
      const isBoundedReplay = ordered
        .slice(0, index)
        .some((checkpoint) => checkpoint.state === 'retry_authorized');
      const allowedStartedResolution = isBoundedReplay
        ? current.state === 'unknown' || current.state === 'confirmed_complete'
        : current.state === 'unknown' || TERMINAL_STATES.has(current.state);
      if (
        current.attempt_number !== previous.attempt_number ||
        !allowedStartedResolution
      ) {
        throw new Error(
          `Variation listing operation ${operation.operation_key} started checkpoint must resolve on the same attempt before retry.`
        );
      }
    } else if (
      previous.state === 'unknown' ||
      previous.observed_remote_state === 'unknown'
    ) {
      const priorRetryAuthorized = ordered
        .slice(0, index)
        .some((checkpoint) => checkpoint.state === 'retry_authorized');
      const allowedResolutionStates = priorRetryAuthorized
        ? new Set(['confirmed_complete', 'retry_exhausted'])
        : new Set(['confirmed_complete', 'confirmed_no_op', 'retry_authorized']);
      if (
        current.attempt_number !== previous.attempt_number + 1 ||
        current.checkpoint_number !== 1 ||
        !allowedResolutionStates.has(current.state) ||
        !hasExactRemoteEvidence(current)
      ) {
        throw new Error(
          `Variation listing operation ${operation.operation_key} ambiguous outcome requires an exact bounded reconciliation checkpoint.`
        );
      }
    } else if (previous.state === 'retry_authorized') {
      if (
        current.attempt_number !== previous.attempt_number ||
        current.checkpoint_number !== previous.checkpoint_number + 1 ||
        current.state !== 'started'
      ) {
        throw new Error(
          `Variation listing operation ${operation.operation_key} retry authorization permits exactly one started replay.`
        );
      }
    } else if (TERMINAL_STATES.has(previous.state) || previous.state === 'retry_exhausted') {
      throw new Error(
        `Variation listing operation ${operation.operation_key} is terminal and cannot be reopened.`
      );
    }
  }

  const latestCheckpoint = ordered.at(-1) ?? null;
  return {
    hasUnknownHistory: ordered.some(
      (checkpoint) =>
        checkpoint.state === 'unknown' || checkpoint.observed_remote_state === 'unknown'
    ),
    latestAttemptNumber: latestCheckpoint?.attempt_number ?? 0,
    latestCheckpoint,
    requiresReconciliation: Boolean(
      latestCheckpoint &&
        (latestCheckpoint.state === 'started' ||
          latestCheckpoint.state === 'unknown' ||
          latestCheckpoint.observed_remote_state === 'unknown')
    ),
    retryAuthorized: latestCheckpoint?.state === 'retry_authorized',
    retryExhausted: latestCheckpoint?.state === 'retry_exhausted',
  };
}

export function assertVariationListingJournalCanContinue(
  operation: VariationListingRevisionPlanOperation,
  checkpoints: readonly VariationListingPublishingCheckpointRow[]
): void {
  const inspection = inspectVariationListingJournal(operation, checkpoints);
  if (inspection.requiresReconciliation) {
    throw new Error(
      `Variation listing operation ${operation.operation_key} requires exact reconciliation before another remote mutation.`
    );
  }
  if (inspection.retryExhausted) {
    throw new Error(
      `Variation listing operation ${operation.operation_key} exhausted its one bounded replay.`
    );
  }
  if (inspection.latestCheckpoint && TERMINAL_STATES.has(inspection.latestCheckpoint.state)) {
    throw new Error(
      `Variation listing operation ${operation.operation_key} is terminal and cannot be reopened for another remote mutation.`
    );
  }
}
