import type { SupabaseDataClient } from '../client.js';
import type {
  VariationListingCopyRow,
  VariationListingGroupRow,
  VariationListingIntakeSessionRow,
  VariationListingOperationAttemptRow,
  VariationListingOperationRow,
  VariationListingRevisionRow,
  VariationListingVariationRow,
} from '../database.js';
import { type MultiResult, requireOptionalResult, type SingleResult } from './shared.js';

export interface VariationListingGroup {
  desiredRevision: number;
  groupId: string;
  groupKey: string;
  lastConfirmedRevision: number | null;
  lifecycleState: string;
  recoveryRequired: boolean;
  source: VariationListingGroupRow;
}

export interface VariationListingVariation {
  groupId: string;
  position: number;
  representativeCopyId: string | null;
  selectorValue: string;
  sku: string;
  source: VariationListingVariationRow;
  variationId: string;
}

export interface VariationListingCopy {
  availabilityState: string;
  copyId: string;
  source: VariationListingCopyRow;
  variationId: string;
}

export interface VariationListingIntakeSession {
  captureSourceKey: string;
  mode: string;
  sessionVersion: number;
  source: VariationListingIntakeSessionRow;
  targetGroupId: string | null;
  targetVariationId: string | null;
}

export interface VariationListingRevision {
  capturedDesiredRevision: number;
  groupId: string;
  operationCount: number;
  revisionId: string;
  snapshotDigest: string;
  source: VariationListingRevisionRow;
}

export interface VariationListingOperation {
  currentEvidenceState: string | null;
  currentState: string;
  latestAttemptNumber: number;
  operationId: string;
  operationKind: string;
  revisionId: string;
  sequenceNo: number;
  source: VariationListingOperationRow;
}

export interface VariationListingOperationAttempt {
  attemptNumber: number;
  checkpointId: string;
  checkpointNumber: number;
  observedRemoteState: string | null;
  operationId: string;
  source: VariationListingOperationAttemptRow;
  state: string;
}

function rowsOrThrow<TData>(result: MultiResult<TData>): TData[] {
  if (result.error) {
    throw new Error(result.error.message);
  }

  return result.data ?? [];
}

async function mapOptional<TRow, TDomain>(
  result: PromiseLike<SingleResult<TRow>>,
  mapper: (row: TRow) => TDomain
): Promise<TDomain | null> {
  const row = requireOptionalResult(await result);
  return row ? mapper(row) : null;
}

export function mapVariationListingGroupRow(row: VariationListingGroupRow): VariationListingGroup {
  return {
    desiredRevision: row.desired_revision,
    groupId: row.group_id,
    groupKey: row.group_key,
    lastConfirmedRevision: row.last_confirmed_revision,
    lifecycleState: row.lifecycle_state,
    recoveryRequired: row.recovery_required,
    source: row,
  };
}

export function mapVariationListingVariationRow(row: VariationListingVariationRow): VariationListingVariation {
  return {
    groupId: row.group_id,
    position: row.position,
    representativeCopyId: row.representative_copy_id,
    selectorValue: row.selector_value,
    sku: row.sku,
    source: row,
    variationId: row.variation_id,
  };
}

export function mapVariationListingCopyRow(row: VariationListingCopyRow): VariationListingCopy {
  return {
    availabilityState: row.availability_state,
    copyId: row.copy_id,
    source: row,
    variationId: row.variation_id,
  };
}

export function mapVariationListingIntakeSessionRow(
  row: VariationListingIntakeSessionRow
): VariationListingIntakeSession {
  return {
    captureSourceKey: row.capture_source_key,
    mode: row.mode,
    sessionVersion: row.session_version,
    source: row,
    targetGroupId: row.target_group_id,
    targetVariationId: row.target_variation_id,
  };
}

export function mapVariationListingRevisionRow(row: VariationListingRevisionRow): VariationListingRevision {
  return {
    capturedDesiredRevision: row.captured_desired_revision,
    groupId: row.group_id,
    operationCount: row.operation_count,
    revisionId: row.revision_id,
    snapshotDigest: row.snapshot_digest,
    source: row,
  };
}

export function mapVariationListingOperationRow(row: VariationListingOperationRow): VariationListingOperation {
  return {
    currentEvidenceState: row.current_evidence_state,
    currentState: row.current_state,
    latestAttemptNumber: row.latest_attempt_number,
    operationId: row.operation_id,
    operationKind: row.operation_kind,
    revisionId: row.revision_id,
    sequenceNo: row.sequence_no,
    source: row,
  };
}

export function mapVariationListingOperationAttemptRow(
  row: VariationListingOperationAttemptRow
): VariationListingOperationAttempt {
  return {
    attemptNumber: row.attempt_number,
    checkpointId: row.checkpoint_id,
    checkpointNumber: row.checkpoint_number,
    observedRemoteState: row.observed_remote_state,
    operationId: row.operation_id,
    source: row,
    state: row.state,
  };
}

export async function getVariationListingGroupById(
  client: SupabaseDataClient,
  groupId: string
): Promise<VariationListingGroup | null> {
  return mapOptional(
    client.from('variation_listing_groups').select('*').eq('group_id', groupId).maybeSingle() as unknown as PromiseLike<SingleResult<VariationListingGroupRow>>,
    mapVariationListingGroupRow
  );
}

export async function listVariationListingGroups(client: SupabaseDataClient): Promise<VariationListingGroup[]> {
  const result = await client.from('variation_listing_groups').select('*').order('created_at', { ascending: true }) as unknown as MultiResult<VariationListingGroupRow>;
  return rowsOrThrow(result).map(mapVariationListingGroupRow);
}

export async function getVariationListingVariationById(
  client: SupabaseDataClient,
  variationId: string
): Promise<VariationListingVariation | null> {
  return mapOptional(
    client.from('variation_listing_variations').select('*').eq('variation_id', variationId).maybeSingle() as unknown as PromiseLike<SingleResult<VariationListingVariationRow>>,
    mapVariationListingVariationRow
  );
}

export async function listVariationListingVariationsByGroupId(
  client: SupabaseDataClient,
  groupId: string
): Promise<VariationListingVariation[]> {
  const result = await client.from('variation_listing_variations').select('*').eq('group_id', groupId).order('position', { ascending: true }) as unknown as MultiResult<VariationListingVariationRow>;
  return rowsOrThrow(result).map(mapVariationListingVariationRow);
}

export async function getVariationListingCopyById(
  client: SupabaseDataClient,
  copyId: string
): Promise<VariationListingCopy | null> {
  return mapOptional(
    client.from('variation_listing_copies').select('*').eq('copy_id', copyId).maybeSingle() as unknown as PromiseLike<SingleResult<VariationListingCopyRow>>,
    mapVariationListingCopyRow
  );
}

export async function listVariationListingCopiesByVariationId(
  client: SupabaseDataClient,
  variationId: string
): Promise<VariationListingCopy[]> {
  const result = await client.from('variation_listing_copies').select('*').eq('variation_id', variationId).order('created_at', { ascending: true }) as unknown as MultiResult<VariationListingCopyRow>;
  return rowsOrThrow(result).map(mapVariationListingCopyRow);
}

export async function getVariationListingIntakeSessionBySourceKey(
  client: SupabaseDataClient,
  captureSourceKey: string
): Promise<VariationListingIntakeSession | null> {
  return mapOptional(
    client.from('variation_listing_intake_sessions').select('*').eq('capture_source_key', captureSourceKey).maybeSingle() as unknown as PromiseLike<SingleResult<VariationListingIntakeSessionRow>>,
    mapVariationListingIntakeSessionRow
  );
}

export async function getVariationListingRevisionById(
  client: SupabaseDataClient,
  revisionId: string
): Promise<VariationListingRevision | null> {
  return mapOptional(
    client.from('variation_listing_revisions').select('*').eq('revision_id', revisionId).maybeSingle() as unknown as PromiseLike<SingleResult<VariationListingRevisionRow>>,
    mapVariationListingRevisionRow
  );
}

export async function listVariationListingRevisionsByGroupId(
  client: SupabaseDataClient,
  groupId: string
): Promise<VariationListingRevision[]> {
  const result = await client.from('variation_listing_revisions').select('*').eq('group_id', groupId).order('captured_desired_revision', { ascending: false }) as unknown as MultiResult<VariationListingRevisionRow>;
  return rowsOrThrow(result).map(mapVariationListingRevisionRow);
}

export async function getVariationListingOperationById(
  client: SupabaseDataClient,
  operationId: string
): Promise<VariationListingOperation | null> {
  return mapOptional(
    client.from('variation_listing_operations').select('*').eq('operation_id', operationId).maybeSingle() as unknown as PromiseLike<SingleResult<VariationListingOperationRow>>,
    mapVariationListingOperationRow
  );
}

export async function listVariationListingOperationsByRevisionId(
  client: SupabaseDataClient,
  revisionId: string
): Promise<VariationListingOperation[]> {
  const result = await client.from('variation_listing_operations').select('*').eq('revision_id', revisionId).order('sequence_no', { ascending: true }) as unknown as MultiResult<VariationListingOperationRow>;
  return rowsOrThrow(result).map(mapVariationListingOperationRow);
}

export async function listVariationListingOperationAttemptsByOperationId(
  client: SupabaseDataClient,
  operationId: string
): Promise<VariationListingOperationAttempt[]> {
  const result = await client.from('variation_listing_operation_attempts').select('*').eq('operation_id', operationId).order('attempt_number', { ascending: true }).order('checkpoint_number', { ascending: true }) as unknown as MultiResult<VariationListingOperationAttemptRow>;
  return rowsOrThrow(result).map(mapVariationListingOperationAttemptRow);
}
