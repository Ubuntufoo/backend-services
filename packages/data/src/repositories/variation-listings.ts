import type { SupabaseDataClient } from '../client.js';
import type { Json, VariationListingCopyRow, VariationListingGroupRow, VariationListingIntakeSessionRow, VariationListingPublishingCheckpointRow, VariationListingRevisionRow, VariationListingRevisionPlanOperation, VariationListingVariationRow } from '../database.js';
import { type MultiResult, requireOptionalResult, type SingleResult } from './shared.js';
import {
  isVariationListingManualPriceAmount,
  type VariationListingManualPriceAmount,
} from '../variation-listing-pricing.js';

export interface VariationListingGroup { desiredRevision: number; groupId: string; groupKey: string; lastConfirmedRevision: number | null; lifecycleState: string; source: VariationListingGroupRow; }
export interface VariationListingVariation { groupId: string; position: number; priceAmount: VariationListingManualPriceAmount; priceCurrency: 'USD'; representativeCopyId: string | null; selectorValue: string; sku: string; source: VariationListingVariationRow; variationId: string; }
export interface VariationListingCopy { availabilityState: string; copyId: string; source: VariationListingCopyRow; variationId: string; }
export interface VariationListingIntakeSession { captureSourceKey: string; mode: 'idle' | 'new_variation' | 'duplicate_copy'; pendingPair: Record<string, unknown> | null; source: VariationListingIntakeSessionRow; stickyPriceAmount: VariationListingManualPriceAmount; stickyPriceCurrency: 'USD'; targetGroupId: string | null; targetVariationId: string | null; }
export interface VariationListingRevision { capturedDesiredRevision: number; groupId: string; operationCount: number; operationPlan: VariationListingRevisionPlanOperation[]; revisionId: string; snapshotDigest: string; source: VariationListingRevisionRow; }
export interface VariationListingPublishingCheckpoint { attemptNumber: number; checkpointId: string; checkpointNumber: number; evidence: Record<string, unknown> | null; observedRemoteState: string | null; operationKey: string; revisionId: string; source: VariationListingPublishingCheckpointRow; state: string; }

const object = (value: Json, label: string): Record<string, Json> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Variation listing ${label} must be a JSON object.`);
  }
  return value as Record<string, Json>;
};

const requiredString = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`Variation listing ${label} must be a non-empty string.`);
  return value;
};
const requiredTrimmedString = (value: unknown, label: string): string => {
  const text = requiredString(value, label);
  if (text !== text.trim()) throw new Error(`Variation listing ${label} must be outer-trimmed.`);
  return text;
};
const nullableString = (value: unknown, label: string): string | null => value === null ? null : requiredString(value, label);
const finiteNumber = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Variation listing ${label} must be a finite number.`);
  return value;
};
const positiveInteger = (value: unknown, label: string): number => {
  const n = finiteNumber(value, label);
  if (!Number.isInteger(n) || n < 1) throw new Error(`Variation listing ${label} must be a positive integer.`);
  return n;
};
const nonNegativeInteger = (value: unknown, label: string): number => {
  const n = finiteNumber(value, label);
  if (!Number.isInteger(n) || n < 0) throw new Error(`Variation listing ${label} must be a non-negative integer.`);
  return n;
};

const OPERATION_KINDS = new Set([
  'media_ingest', 'child_inventory_item_write', 'child_offer_write',
  'complete_group_replace', 'group_publish', 'revision_reconcile', 'withdrawal',
  'cleanup_offer', 'cleanup_group', 'cleanup_child_inventory_item',
  'final_absence_verification',
]);
const DIGEST = /^[0-9a-f]{64}$/;

export function validateVariationListingPendingPair(value: Json | null): Record<string, Json> | null {
  if (value === null) return null;
  const pair = object(value, 'pending pair');
  requiredString(pair.pair_id, 'pending pair pair_id');
  const mode = requiredString(pair.mode, 'pending pair mode');
  if (mode !== 'new_variation' && mode !== 'duplicate_copy') throw new Error('Variation listing pending pair mode is invalid.');
  requiredString(pair.target_group_id, 'pending pair target_group_id');
  if (mode === 'new_variation') {
    if (pair.target_variation_id !== null) throw new Error('Variation listing new-variation pending pair target_variation_id must be null.');
  } else requiredString(pair.target_variation_id, 'pending pair target_variation_id');
  const price = finiteNumber(pair.price_amount, 'pending pair price_amount');
  if (!isVariationListingManualPriceAmount(price)) throw new Error('Variation listing pending pair price_amount is invalid.');
  if (pair.price_currency !== 'USD') throw new Error('Variation listing pending pair price_currency must be USD.');
  requiredString(pair.front_source_ref, 'pending pair front_source_ref');
  requiredString(pair.started_at, 'pending pair started_at');
  nonNegativeInteger(pair.expected_desired_revision, 'pending pair expected_desired_revision');
  return pair;
}

export function validateVariationListingOperationPlan(value: Json, operationCount: number): VariationListingRevisionPlanOperation[] {
  if (!Array.isArray(value)) throw new Error('Variation listing operation_plan must be a JSON array.');
  if (value.length !== operationCount) throw new Error('Variation listing operation_plan count does not match operation_count.');
  const keys = new Set<string>();
  return value.map((entry, index) => {
    const op = object(entry, 'operation plan entry');
    if (op.sequence_no !== index + 1) throw new Error('Variation listing operation_plan sequence numbers must be contiguous.');
    const key = requiredTrimmedString(op.operation_key, 'operation plan operation_key');
    if (keys.has(key)) throw new Error('Variation listing operation_plan operation keys must be unique.');
    keys.add(key);
    const kind = requiredString(op.operation_kind, 'operation plan operation_kind');
    if (!OPERATION_KINDS.has(kind)) throw new Error('Variation listing operation_plan operation_kind is invalid.');
    const target = requiredTrimmedString(op.target_ref, 'operation plan target_ref');
    const version = positiveInteger(op.intent_version, 'operation plan intent_version');
    if (typeof op.intent_digest !== 'string' || !DIGEST.test(op.intent_digest)) throw new Error('Variation listing operation_plan intent_digest must be 64 lowercase hex characters.');
    const intent = object(op.intent, 'operation plan intent');
    return { sequence_no: index + 1, operation_key: key, operation_kind: kind, target_ref: target, intent_version: version, intent_digest: op.intent_digest, intent };
  });
}

export function validateVariationListingCheckpointEvidence(value: Json, label = 'checkpoint evidence'): Record<string, Json> {
  return object(value, label);
}

function rowsOrThrow<T>(result: MultiResult<T>): T[] { if (result.error) throw new Error(result.error.message); return result.data ?? []; }
async function mapOptional<T, U>(result: PromiseLike<SingleResult<T>>, mapper: (row: T) => U): Promise<U | null> { const row = requireOptionalResult(await result); return row ? mapper(row) : null; }
export function mapVariationListingGroupRow(row: VariationListingGroupRow): VariationListingGroup { return { desiredRevision: row.desired_revision, groupId: row.group_id, groupKey: row.group_key, lastConfirmedRevision: row.last_confirmed_revision, lifecycleState: row.lifecycle_state, source: row }; }
export function mapVariationListingVariationRow(row: VariationListingVariationRow): VariationListingVariation { if (!isVariationListingManualPriceAmount(row.price_amount)) throw new Error('Variation listing variation price_amount is invalid.'); if (row.price_currency !== 'USD') throw new Error('Variation listing variation price_currency must be USD.'); return { groupId: row.group_id, position: row.position, priceAmount: row.price_amount, priceCurrency: row.price_currency, representativeCopyId: row.representative_copy_id, selectorValue: row.selector_value, sku: row.sku, source: row, variationId: row.variation_id }; }
export function mapVariationListingCopyRow(row: VariationListingCopyRow): VariationListingCopy { return { availabilityState: row.availability_state, copyId: row.copy_id, source: row, variationId: row.variation_id }; }
export function mapVariationListingIntakeSessionRow(row: VariationListingIntakeSessionRow): VariationListingIntakeSession { const pending = validateVariationListingPendingPair(row.pending_pair); if (row.mode !== 'idle' && row.mode !== 'new_variation' && row.mode !== 'duplicate_copy') throw new Error('Variation listing intake session mode is invalid.'); if (!isVariationListingManualPriceAmount(row.sticky_price_amount)) throw new Error('Variation listing intake session sticky_price_amount is invalid.'); if (row.sticky_price_currency !== 'USD') throw new Error('Variation listing intake session sticky_price_currency must be USD.'); return { captureSourceKey: row.capture_source_key, mode: row.mode, pendingPair: pending as Record<string, unknown> | null, source: row, stickyPriceAmount: row.sticky_price_amount, stickyPriceCurrency: row.sticky_price_currency, targetGroupId: row.target_group_id, targetVariationId: row.target_variation_id }; }
export function mapVariationListingRevisionRow(row: VariationListingRevisionRow): VariationListingRevision { const plan = validateVariationListingOperationPlan(row.operation_plan, row.operation_count); if (typeof row.snapshot_digest !== 'string' || !DIGEST.test(row.snapshot_digest)) throw new Error('Variation listing snapshot_digest must be 64 lowercase hex characters.'); return { capturedDesiredRevision: row.captured_desired_revision, groupId: row.group_id, operationCount: row.operation_count, operationPlan: plan, revisionId: row.revision_id, snapshotDigest: row.snapshot_digest, source: row }; }
export function mapVariationListingPublishingCheckpointRow(row: VariationListingPublishingCheckpointRow): VariationListingPublishingCheckpoint {
  const evidence = validateVariationListingCheckpointEvidence(row.evidence);
  positiveInteger(row.attempt_number, 'checkpoint attempt_number');
  positiveInteger(row.checkpoint_number, 'checkpoint checkpoint_number');
  if (!['started','unknown','confirmed_complete','confirmed_no_op'].includes(row.state)) throw new Error('Variation listing checkpoint state is invalid.');
  if (row.observed_remote_state !== null && !['present','proven_absent','unknown'].includes(row.observed_remote_state)) throw new Error('Variation listing checkpoint observed_remote_state is invalid.');
  if (row.state === 'started' && row.observed_remote_state !== null) throw new Error('Variation listing started checkpoint cannot claim remote evidence.');
  if (row.state === 'unknown' && row.observed_remote_state !== 'unknown') throw new Error('Variation listing unknown checkpoint requires ambiguity evidence.');
  if ((row.state === 'confirmed_complete' || row.state === 'confirmed_no_op') && row.observed_remote_state !== 'present' && row.observed_remote_state !== 'proven_absent') throw new Error('Variation listing terminal checkpoint requires exact remote evidence.');
  if ((row.state === 'unknown' || row.state === 'confirmed_complete' || row.state === 'confirmed_no_op') && Object.keys(evidence).length === 0) throw new Error('Variation listing resolved checkpoint requires non-empty evidence.');
  return { attemptNumber: row.attempt_number, checkpointId: row.checkpoint_id, checkpointNumber: row.checkpoint_number, evidence: evidence as Record<string, unknown>, observedRemoteState: row.observed_remote_state, operationKey: row.operation_key, revisionId: row.revision_id, source: row, state: row.state };
}

export async function getVariationListingGroupById(c: SupabaseDataClient, id: string) { return mapOptional(c.from('variation_listing_groups').select('*').eq('group_id', id).maybeSingle() as unknown as PromiseLike<SingleResult<VariationListingGroupRow>>, mapVariationListingGroupRow); }
export async function listVariationListingGroups(c: SupabaseDataClient) { const r = await c.from('variation_listing_groups').select('*').order('created_at', { ascending: true }) as unknown as MultiResult<VariationListingGroupRow>; return rowsOrThrow(r).map(mapVariationListingGroupRow); }
export async function getVariationListingVariationById(c: SupabaseDataClient, id: string) { return mapOptional(c.from('variation_listing_variations').select('*').eq('variation_id', id).maybeSingle() as unknown as PromiseLike<SingleResult<VariationListingVariationRow>>, mapVariationListingVariationRow); }
export async function listVariationListingVariationsByGroupId(c: SupabaseDataClient, id: string) { const r = await c.from('variation_listing_variations').select('*').eq('group_id', id).order('position', { ascending: true }) as unknown as MultiResult<VariationListingVariationRow>; return rowsOrThrow(r).map(mapVariationListingVariationRow); }
export async function getVariationListingCopyById(c: SupabaseDataClient, id: string) { return mapOptional(c.from('variation_listing_copies').select('*').eq('copy_id', id).maybeSingle() as unknown as PromiseLike<SingleResult<VariationListingCopyRow>>, mapVariationListingCopyRow); }
export async function getVariationListingCopyByCapturePairId(c: SupabaseDataClient, capturePairId: string) { return mapOptional(c.from('variation_listing_copies').select('*').eq('capture_pair_id', capturePairId).maybeSingle() as unknown as PromiseLike<SingleResult<VariationListingCopyRow>>, mapVariationListingCopyRow); }
export async function listVariationListingCopiesByVariationId(c: SupabaseDataClient, id: string) { const r = await c.from('variation_listing_copies').select('*').eq('variation_id', id).order('created_at', { ascending: true }) as unknown as MultiResult<VariationListingCopyRow>; return rowsOrThrow(r).map(mapVariationListingCopyRow); }
export async function getVariationListingIntakeSessionBySourceKey(c: SupabaseDataClient, key: string) { return mapOptional(c.from('variation_listing_intake_sessions').select('*').eq('capture_source_key', key).maybeSingle() as unknown as PromiseLike<SingleResult<VariationListingIntakeSessionRow>>, mapVariationListingIntakeSessionRow); }
export async function getVariationListingRevisionById(c: SupabaseDataClient, id: string) { return mapOptional(c.from('variation_listing_revisions').select('*').eq('revision_id', id).maybeSingle() as unknown as PromiseLike<SingleResult<VariationListingRevisionRow>>, mapVariationListingRevisionRow); }
export async function listVariationListingRevisionsByGroupId(c: SupabaseDataClient, id: string) { const r = await c.from('variation_listing_revisions').select('*').eq('group_id', id).order('captured_desired_revision', { ascending: false }) as unknown as MultiResult<VariationListingRevisionRow>; return rowsOrThrow(r).map(mapVariationListingRevisionRow); }
export async function listVariationListingPublishingCheckpointsByRevisionId(c: SupabaseDataClient, id: string) { const r = await c.from('variation_listing_publishing_checkpoints').select('*').eq('revision_id', id).order('operation_key', { ascending: true }).order('attempt_number', { ascending: true }).order('checkpoint_number', { ascending: true }) as unknown as MultiResult<VariationListingPublishingCheckpointRow>; return rowsOrThrow(r).map(mapVariationListingPublishingCheckpointRow); }
export async function listVariationListingPublishingCheckpointsByOperationKey(c: SupabaseDataClient, revisionId: string, operationKey: string) { const r = await c.from('variation_listing_publishing_checkpoints').select('*').eq('revision_id', revisionId).eq('operation_key', operationKey).order('attempt_number', { ascending: true }).order('checkpoint_number', { ascending: true }) as unknown as MultiResult<VariationListingPublishingCheckpointRow>; return rowsOrThrow(r).map(mapVariationListingPublishingCheckpointRow); }
