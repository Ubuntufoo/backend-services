import type { SupabaseDataClient } from './client.js';
import type {
  Json,
  VariationListingGroupRow,
  VariationListingOperationAttemptRow,
  VariationListingOperationRow,
  VariationListingRevisionRow,
} from './database.js';
import type { SingleResult } from './repositories/shared.js';
import {
  getVariationListingGroupById,
  listVariationListingCopiesByVariationId,
  listVariationListingVariationsByGroupId,
} from './repositories/variation-listings.js';
import type {
  AppendVariationListingJournalCheckpointInput,
  AppendVariationListingJournalCheckpointResult,
  CaptureVariationListingRevisionInput,
  CaptureVariationListingRevisionResult,
  ConfirmVariationListingRevisionInput,
  VariationListingAggregateSnapshot,
  VariationListingTransactionGateway,
} from './variation-listing-transactions.js';

/**
 * Stable error for a variation-listing transaction conflict surfaced by the
 * RPC seam (revision/confirmation CAS mismatch, journal attempt/checkpoint
 * regression, or clearing an ambiguous outcome without exact reconciliation).
 */
export class VariationListingTransactionConflictError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'VariationListingTransactionConflictError';
    this.code = code;
  }
}

type JsonRecord = Record<string, Json>;

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
const OPERATION_STATES = new Set(['planned', 'started', 'confirmed_complete', 'confirmed_no_op', 'unknown']);
const ATTEMPT_STATES = new Set(['started', 'confirmed_complete', 'confirmed_no_op', 'unknown']);
const EVIDENCE_STATES = new Set(['present', 'proven_absent', 'unknown']);
const GROUP_LIFECYCLE_STATES = new Set([
  'intake',
  'draft',
  'review',
  'publish-ready',
  'publishing',
  'active',
  'withdrawn',
  'abandoned',
  'cleanup',
  'terminal-absent',
]);
const LISTING_FORMATS = new Set(['FIXED_PRICE']);
const CONDITION_TOKENS = new Set(['NEAR_MINT_OR_BETTER', 'EXCELLENT', 'VERY_GOOD', 'POOR']);

function asRecord(value: Json, label: string): JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Variation listing RPC ${label} must be a JSON object.`);
  }

  return value as JsonRecord;
}

function requiredString(record: JsonRecord, key: string): string {
  const value = record[key];
  if (typeof value !== 'string') {
    throw new Error(`Variation listing RPC field "${key}" must be a string.`);
  }

  return value;
}

function nullableString(record: JsonRecord, key: string): string | null {
  const value = record[key];
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new Error(`Variation listing RPC field "${key}" must be a string or null.`);
  }

  return value;
}

function requiredNumber(record: JsonRecord, key: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Variation listing RPC field "${key}" must be a number.`);
  }

  return value;
}

function positiveInteger(record: JsonRecord, key: string): number {
  const value = requiredNumber(record, key);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Variation listing RPC field "${key}" must be a positive integer.`);
  }
  return value;
}

function nonNegativeInteger(record: JsonRecord, key: string): number {
  const value = requiredNumber(record, key);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Variation listing RPC field "${key}" must be a non-negative integer.`);
  }
  return value;
}

function nullableNumber(record: JsonRecord, key: string): number | null {
  const value = record[key];
  if (value === null) {
    return null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Variation listing RPC field "${key}" must be a number or null.`);
  }

  return value;
}

function nullablePositiveInteger(record: JsonRecord, key: string): number | null {
  const value = nullableNumber(record, key);
  if (value !== null && (!Number.isInteger(value) || value < 1)) {
    throw new Error(`Variation listing RPC field "${key}" must be a positive integer or null.`);
  }
  return value;
}

function requiredBoolean(record: JsonRecord, key: string): boolean {
  const value = record[key];
  if (typeof value !== 'boolean') {
    throw new Error(`Variation listing RPC field "${key}" must be a boolean.`);
  }

  return value;
}

function requiredJson(record: JsonRecord, key: string): Json {
  const value = record[key];
  if (value === null || value === undefined) {
    throw new Error(`Variation listing RPC field "${key}" must be present.`);
  }

  return value;
}

function nullableJson(record: JsonRecord, key: string): Json | null {
  if (!Object.prototype.hasOwnProperty.call(record, key)) {
    throw new Error(`Variation listing RPC field "${key}" must be present.`);
  }
  const value = record[key];
  if (value === null) {
    return null;
  }

  return value;
}

function objectJson(record: JsonRecord, key: string): Json {
  const value = requiredJson(record, key);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Variation listing RPC field "${key}" must be a JSON object.`);
  }
  return value;
}

function nullableObjectJson(record: JsonRecord, key: string): Json | null {
  const value = nullableJson(record, key);
  if (value !== null && (typeof value !== 'object' || Array.isArray(value))) {
    throw new Error(`Variation listing RPC field "${key}" must be a JSON object or null.`);
  }
  return value;
}

function arrayJson(record: JsonRecord, key: string): Json {
  const value = requiredJson(record, key);
  if (!Array.isArray(value)) {
    throw new Error(`Variation listing RPC field "${key}" must be a JSON array.`);
  }
  return value;
}

function enumString(record: JsonRecord, key: string, allowed: ReadonlySet<string>): string {
  const value = requiredString(record, key);
  if (!allowed.has(value)) {
    throw new Error(`Variation listing RPC field "${key}" has invalid value "${value}".`);
  }
  return value;
}

function nullableEnumString(
  record: JsonRecord,
  key: string,
  allowed: ReadonlySet<string>
): string | null {
  const value = nullableString(record, key);
  if (value !== null && !allowed.has(value)) {
    throw new Error(`Variation listing RPC field "${key}" has invalid value "${value}".`);
  }
  return value;
}

function parseRevisionRow(value: Json): VariationListingRevisionRow {
  const record = asRecord(value, 'revision');
  return {
    revision_id: requiredString(record, 'revision_id'),
    group_id: requiredString(record, 'group_id'),
    captured_desired_revision: positiveInteger(record, 'captured_desired_revision'),
    snapshot_version: positiveInteger(record, 'snapshot_version'),
    snapshot_digest: requiredString(record, 'snapshot_digest'),
    snapshot: objectJson(record, 'snapshot'),
    operation_count: positiveInteger(record, 'operation_count'),
    captured_at: requiredString(record, 'captured_at'),
  };
}

function parseOperationRow(value: Json): VariationListingOperationRow {
  const record = asRecord(value, 'operation');
  return {
    operation_id: requiredString(record, 'operation_id'),
    revision_id: requiredString(record, 'revision_id'),
    sequence_no: positiveInteger(record, 'sequence_no'),
    operation_key: requiredString(record, 'operation_key'),
    operation_kind: enumString(record, 'operation_kind', OPERATION_KINDS),
    target_ref: requiredString(record, 'target_ref'),
    intent_version: positiveInteger(record, 'intent_version'),
    intent_digest: requiredString(record, 'intent_digest'),
    intent: objectJson(record, 'intent'),
    current_state: enumString(record, 'current_state', OPERATION_STATES),
    current_evidence_state: nullableEnumString(record, 'current_evidence_state', EVIDENCE_STATES),
    current_evidence: nullableObjectJson(record, 'current_evidence'),
    latest_attempt_number: nonNegativeInteger(record, 'latest_attempt_number'),
    created_at: requiredString(record, 'created_at'),
    updated_at: requiredString(record, 'updated_at'),
  };
}

function parseAttemptRow(value: Json): VariationListingOperationAttemptRow {
  const record = asRecord(value, 'attempt');
  return {
    checkpoint_id: requiredString(record, 'checkpoint_id'),
    operation_id: requiredString(record, 'operation_id'),
    attempt_number: positiveInteger(record, 'attempt_number'),
    checkpoint_number: positiveInteger(record, 'checkpoint_number'),
    state: enumString(record, 'state', ATTEMPT_STATES),
    evidence_version: positiveInteger(record, 'evidence_version'),
    pre_evidence: nullableObjectJson(record, 'pre_evidence'),
    response_evidence: nullableObjectJson(record, 'response_evidence'),
    post_evidence: nullableObjectJson(record, 'post_evidence'),
    error_evidence: nullableObjectJson(record, 'error_evidence'),
    remote_identity: nullableObjectJson(record, 'remote_identity'),
    decision: nullableString(record, 'decision'),
    observed_remote_state: nullableEnumString(record, 'observed_remote_state', EVIDENCE_STATES),
    created_at: requiredString(record, 'created_at'),
  };
}

function parseGroupRow(value: Json): VariationListingGroupRow {
  const record = asRecord(value, 'group');
  return {
    group_id: requiredString(record, 'group_id'),
    group_key: requiredString(record, 'group_key'),
    sku_category_code: requiredString(record, 'sku_category_code'),
    sku_bucket_token: requiredString(record, 'sku_bucket_token'),
    next_inventory_serial: positiveInteger(record, 'next_inventory_serial'),
    lifecycle_state: enumString(record, 'lifecycle_state', GROUP_LIFECYCLE_STATES),
    recovery_required: requiredBoolean(record, 'recovery_required'),
    selector_name: requiredString(record, 'selector_name'),
    title: nullableString(record, 'title'),
    description: nullableString(record, 'description'),
    derived_common_ebay_aspects: objectJson(record, 'derived_common_ebay_aspects'),
    category_id: requiredString(record, 'category_id'),
    marketplace_id: requiredString(record, 'marketplace_id'),
    listing_format: enumString(record, 'listing_format', LISTING_FORMATS),
    merchant_location_key: requiredString(record, 'merchant_location_key'),
    fulfillment_policy_id: requiredString(record, 'fulfillment_policy_id'),
    payment_policy_id: requiredString(record, 'payment_policy_id'),
    return_policy_id: requiredString(record, 'return_policy_id'),
    condition_id: requiredString(record, 'condition_id'),
    condition_token: enumString(record, 'condition_token', CONDITION_TOKENS),
    condition_description: nullableString(record, 'condition_description'),
    condition_descriptors: arrayJson(record, 'condition_descriptors'),
    desired_revision: nonNegativeInteger(record, 'desired_revision'),
    last_confirmed_revision: nullablePositiveInteger(record, 'last_confirmed_revision'),
    created_at: requiredString(record, 'created_at'),
    updated_at: requiredString(record, 'updated_at'),
  };
}

function unwrapRpcSingle<TData>(result: SingleResult<TData>, missingMessage: string): TData {
  if (result.error) {
    if (
      result.error.code === 'VR001' ||
      result.error.code === 'VR002' ||
      result.error.code === 'VR003' ||
      result.error.code === 'VR004'
    ) {
      throw new VariationListingTransactionConflictError(result.error.code, result.error.message);
    }

    throw new Error(result.error.message);
  }

  if (result.data === null) {
    throw new Error(missingMessage);
  }

  return result.data;
}

function assertRpcParity(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Variation listing RPC response parity mismatch: ${message}.`);
  }
}

function canonicalJson(value: Json): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key] ?? null)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

interface CaptureRevisionRpcRow {
  operations: Json;
  revision: Json;
}

interface AppendCheckpointRpcRow {
  attempt: Json;
  operation: Json;
}

interface ConfirmRevisionRpcRow {
  group_row: Json;
}

async function loadAggregate(
  client: SupabaseDataClient,
  groupId: string
): Promise<VariationListingAggregateSnapshot | null> {
  const group = await getVariationListingGroupById(client, groupId);
  if (!group) {
    return null;
  }

  const variations = await listVariationListingVariationsByGroupId(client, groupId);
  const copies = (
    await Promise.all(
      variations.map((variation) =>
        listVariationListingCopiesByVariationId(client, variation.variationId)
      )
    )
  ).flatMap((variationCopies) => variationCopies.map((copy) => copy.source));

  return {
    copies,
    group: group.source,
    variations: variations.map((variation) => variation.source),
  };
}

async function captureRevision(
  client: SupabaseDataClient,
  input: CaptureVariationListingRevisionInput
): Promise<CaptureVariationListingRevisionResult> {
  const operations = input.operations.map((operation) => ({
    operation_id: operation.operationId,
    sequence_no: operation.sequenceNo,
    operation_key: operation.operationKey,
    operation_kind: operation.operationKind,
    target_ref: operation.targetRef,
    intent_version: operation.intentVersion,
    intent_digest: operation.intentDigest,
    intent: operation.intent,
  }));

  const result = (await client
    .rpc('capture_variation_listing_revision', {
      p_group_id: input.groupId,
      p_revision_id: input.revisionId,
      p_captured_desired_revision: input.capturedDesiredRevision,
      p_snapshot_version: input.snapshotVersion,
      p_snapshot_digest: input.snapshotDigest,
      p_snapshot: input.snapshot,
      p_operations: operations,
    })
    .single()) as SingleResult<CaptureRevisionRpcRow>;

  const row = unwrapRpcSingle(result, 'Variation listing revision capture returned no row.');

  if (!Array.isArray(row.operations) || row.operations.length === 0) {
    throw new Error('Variation listing RPC field "operations" must be an array.');
  }

  const revision = parseRevisionRow(row.revision);
  assertRpcParity(revision.revision_id === input.revisionId, 'revision id');
  assertRpcParity(revision.group_id === input.groupId, 'revision group id');
  assertRpcParity(
    revision.captured_desired_revision === input.capturedDesiredRevision,
    'captured desired revision'
  );
  assertRpcParity(revision.snapshot_version === input.snapshotVersion, 'snapshot version');
  assertRpcParity(revision.snapshot_digest === input.snapshotDigest, 'snapshot digest');
  assertRpcParity(revision.operation_count === input.operations.length, 'operation count');
  if (row.operations.length !== revision.operation_count) {
    throw new Error(
      `Variation listing RPC operation count ${row.operations.length} does not match revision ${revision.operation_count}.`
    );
  }

  const parsedOperations = row.operations.map(parseOperationRow);
  parsedOperations.forEach((operation, index) => {
    const expected = input.operations[index];
    assertRpcParity(Boolean(expected), `operation ${index + 1} exists`);
    if (!expected) return;
    assertRpcParity(operation.operation_id === expected.operationId, `operation ${index + 1} id`);
    assertRpcParity(operation.revision_id === input.revisionId, `operation ${index + 1} revision id`);
    assertRpcParity(operation.sequence_no === expected.sequenceNo, `operation ${index + 1} sequence`);
    assertRpcParity(operation.operation_key === expected.operationKey, `operation ${index + 1} key`);
    assertRpcParity(operation.operation_kind === expected.operationKind, `operation ${index + 1} kind`);
    assertRpcParity(operation.target_ref === expected.targetRef, `operation ${index + 1} target`);
    assertRpcParity(
      operation.intent_version === expected.intentVersion,
      `operation ${index + 1} intent version`
    );
    assertRpcParity(
      operation.intent_digest === expected.intentDigest,
      `operation ${index + 1} intent digest`
    );
    assertRpcParity(
      canonicalJson(operation.intent) === canonicalJson(expected.intent),
      `operation ${index + 1} intent`
    );
  });

  return { revision, operations: parsedOperations };
}

async function appendJournalCheckpoint(
  client: SupabaseDataClient,
  input: AppendVariationListingJournalCheckpointInput
): Promise<AppendVariationListingJournalCheckpointResult> {
  const result = (await client
    .rpc('append_variation_listing_journal_checkpoint', {
      p_operation_id: input.operationId,
      p_checkpoint_id: input.checkpointId,
      p_attempt_number: input.attemptNumber,
      p_checkpoint_number: input.checkpointNumber,
      p_state: input.state,
      p_evidence_version: input.evidenceVersion,
      p_pre_evidence: input.preEvidence ?? null,
      p_response_evidence: input.responseEvidence ?? null,
      p_post_evidence: input.postEvidence ?? null,
      p_error_evidence: input.errorEvidence ?? null,
      p_remote_identity: input.remoteIdentity ?? null,
      p_decision: input.decision ?? null,
      p_observed_remote_state: input.observedRemoteState ?? null,
      p_current_state: input.currentState,
      p_current_evidence_state: input.currentEvidenceState ?? null,
      p_current_evidence: input.currentEvidence ?? null,
    })
    .single()) as SingleResult<AppendCheckpointRpcRow>;

  const row = unwrapRpcSingle(result, 'Variation listing journal checkpoint returned no row.');

  const attempt = parseAttemptRow(row.attempt);
  const operation = parseOperationRow(row.operation);
  const expectedObservedState = input.observedRemoteState ?? null;
  const expectedCurrentEvidenceState = input.currentEvidenceState ?? null;
  assertRpcParity(attempt.checkpoint_id === input.checkpointId, 'checkpoint id');
  assertRpcParity(attempt.operation_id === input.operationId, 'attempt operation id');
  assertRpcParity(attempt.attempt_number === input.attemptNumber, 'attempt number');
  assertRpcParity(attempt.checkpoint_number === input.checkpointNumber, 'checkpoint number');
  assertRpcParity(attempt.state === input.state, 'attempt state');
  assertRpcParity(attempt.observed_remote_state === expectedObservedState, 'observed remote state');
  assertRpcParity(operation.operation_id === input.operationId, 'operation id');
  assertRpcParity(operation.latest_attempt_number === input.attemptNumber, 'latest attempt number');
  assertRpcParity(operation.current_state === input.currentState, 'current state');
  assertRpcParity(
    operation.current_evidence_state === expectedCurrentEvidenceState,
    'current evidence state'
  );
  assertRpcParity(operation.current_state === attempt.state, 'operation/attempt state');
  assertRpcParity(
    operation.current_evidence_state === attempt.observed_remote_state,
    'operation/attempt evidence state'
  );

  return {
    attempt,
    operation,
  };
}

async function confirmRevision(
  client: SupabaseDataClient,
  input: ConfirmVariationListingRevisionInput
): Promise<VariationListingGroupRow> {
  const result = (await client
    .rpc('confirm_variation_listing_revision', {
      p_group_id: input.groupId,
      p_expected_previous_confirmed_revision: input.expectedPreviousConfirmedRevision ?? null,
      p_confirmed_revision: input.confirmedRevision,
    })
    .single()) as SingleResult<ConfirmRevisionRpcRow>;

  const row = unwrapRpcSingle(result, 'Variation listing confirmation returned no row.');
  const group = parseGroupRow(row.group_row);
  assertRpcParity(group.group_id === input.groupId, 'confirmed group id');
  assertRpcParity(
    group.last_confirmed_revision === input.confirmedRevision,
    'confirmed revision watermark'
  );
  return group;
}

export function createSupabaseVariationListingTransactionGateway(
  client: SupabaseDataClient
): VariationListingTransactionGateway {
  return {
    appendJournalCheckpoint: (input) => appendJournalCheckpoint(client, input),
    captureRevision: (input) => captureRevision(client, input),
    confirmRevision: (input) => confirmRevision(client, input),
    loadAggregate: (groupId) => loadAggregate(client, groupId),
  };
}
