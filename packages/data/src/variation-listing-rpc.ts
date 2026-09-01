import type { SupabaseDataClient } from './client.js';
import type { Json, VariationListingCopyRow, VariationListingGroupRow, VariationListingIntakeSessionRow, VariationListingPublishingCheckpointRow, VariationListingRevisionRow, VariationListingVariationRow } from './database.js';
import { getVariationListingGroupById, listVariationListingCopiesByVariationId, listVariationListingVariationsByGroupId, validateVariationListingCheckpointEvidence, validateVariationListingOperationPlan, validateVariationListingPendingPair } from './repositories/variation-listings.js';
import type { SingleResult } from './repositories/shared.js';
import type { AppendVariationListingJournalCheckpointInput, AppendVariationListingJournalCheckpointResult, ApplyVariationListingGroupReviewDraftInput, UpdateVariationListingManualPriceInput, CaptureVariationListingRevisionInput, CaptureVariationListingRevisionResult, ConfirmVariationListingRevisionInput, CreateVariationListingGroupInput, ConfigureVariationListingIntakeInput, StartVariationListingIntakePairInput, CompleteVariationListingNewVariationInput, CompleteVariationListingDuplicateCopyInput, VariationListingAggregateSnapshot, VariationListingTransactionGateway } from './variation-listing-transactions.js';
import { isVariationListingManualPriceAmount } from './variation-listing-pricing.js';

export class VariationListingTransactionConflictError extends Error { readonly code: string; constructor(code: string, message: string) { super(message); this.name = 'VariationListingTransactionConflictError'; this.code = code; } }
type RecordJson = Record<string, Json>;
const record = (v: unknown, label: string): RecordJson => { if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error(`Variation listing RPC ${label} must be a JSON object.`); return v as RecordJson; };
const str = (r: RecordJson, k: string): string => { if (typeof r[k] !== 'string' || (r[k] as string).trim() === '') throw new Error(`Variation listing RPC field "${k}" must be a non-empty string.`); return r[k] as string; };
const nullableStr = (r: RecordJson, k: string): string | null => r[k] === null ? null : str(r, k);
const num = (r: RecordJson, k: string): number => { if (typeof r[k] !== 'number' || !Number.isFinite(r[k] as number)) throw new Error(`Variation listing RPC field "${k}" must be a finite number.`); return r[k] as number; };
const integer = (r: RecordJson, k: string, min = 0): number => { const value = num(r, k); if (!Number.isInteger(value) || value < min) throw new Error(`Variation listing RPC field "${k}" must be an integer >= ${min}.`); return value; };
const positive = (r: RecordJson, k: string): number => integer(r, k, 1);
const jsonObj = (r: RecordJson, k: string): Json => { const v = r[k]; if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error(`Variation listing RPC field "${k}" must be a JSON object.`); return v; };
const unwrap = <T>(result: SingleResult<T>, missing: string): T => { if (result.error) { if (/^VR00[1-4]$/.test(result.error.code ?? '')) throw new VariationListingTransactionConflictError(result.error.code!, result.error.message); throw new Error(result.error.message); } if (result.data === null) throw new Error(missing); return result.data; };
const parseRevision = (v: Json): VariationListingRevisionRow => {
  const r = record(v, 'revision');
  const operationCount = positive(r, 'operation_count');
  const plan = validateVariationListingOperationPlan(r.operation_plan, operationCount);
  const digest = str(r, 'snapshot_digest');
  if (!/^[0-9a-f]{64}$/.test(digest)) throw new Error('Variation listing RPC snapshot_digest must be 64 lowercase hex characters.');
  return { revision_id: str(r,'revision_id'), group_id: str(r,'group_id'), captured_desired_revision: positive(r,'captured_desired_revision'), snapshot_version: positive(r,'snapshot_version'), snapshot_digest: digest, snapshot: jsonObj(r,'snapshot'), operation_plan: plan, operation_count: operationCount, captured_at: str(r,'captured_at') } as unknown as VariationListingRevisionRow;
};
const parseCheckpoint = (v: Json): VariationListingPublishingCheckpointRow => {
  const r = record(v, 'checkpoint');
  const state = str(r, 'state');
  if (!['started','unknown','confirmed_complete','confirmed_no_op'].includes(state)) throw new Error('Variation listing RPC checkpoint state is invalid.');
  const observed = nullableStr(r, 'observed_remote_state');
  if (observed !== null && !['present','proven_absent','unknown'].includes(observed)) throw new Error('Variation listing RPC observed_remote_state is invalid.');
  if (state === 'started' && observed !== null) throw new Error('Variation listing RPC started checkpoint cannot claim remote evidence.');
  if (state === 'unknown' && observed !== 'unknown') throw new Error('Variation listing RPC unknown checkpoint requires ambiguity evidence.');
  if ((state === 'confirmed_complete' || state === 'confirmed_no_op') && (observed !== 'present' && observed !== 'proven_absent')) throw new Error('Variation listing RPC terminal checkpoint requires exact remote evidence.');
  const evidence = validateVariationListingCheckpointEvidence(r.evidence);
  if ((state === 'unknown' || state === 'confirmed_complete' || state === 'confirmed_no_op') && Object.keys(evidence).length === 0) throw new Error('Variation listing RPC resolved checkpoint requires non-empty evidence.');
  return { checkpoint_id: str(r,'checkpoint_id'), revision_id: str(r,'revision_id'), operation_key: str(r,'operation_key'), attempt_number: positive(r,'attempt_number'), checkpoint_number: positive(r,'checkpoint_number'), state, observed_remote_state: observed, evidence, created_at: str(r,'created_at') } as VariationListingPublishingCheckpointRow;
};
const parseGroup = (v: Json): VariationListingGroupRow => {
  const r = record(v,'group');
  str(r,'group_id'); str(r,'group_key'); str(r,'sku_category_code'); str(r,'sku_bucket_token'); str(r,'category_id'); str(r,'marketplace_id'); str(r,'merchant_location_key'); str(r,'fulfillment_policy_id'); str(r,'payment_policy_id'); str(r,'return_policy_id'); str(r,'condition_id'); str(r,'condition_token');
  integer(r,'desired_revision'); if (r.last_confirmed_revision !== null) positive(r,'last_confirmed_revision'); if (!['intake','draft','review','publish-ready','publishing','active','withdrawn','abandoned','cleanup','terminal-absent'].includes(str(r,'lifecycle_state'))) throw new Error('Variation listing RPC lifecycle_state is invalid.'); str(r,'listing_format'); if (r.listing_format !== 'FIXED_PRICE') throw new Error('Variation listing RPC listing_format is invalid.'); if (r.selector_name !== 'Card') throw new Error('Variation listing RPC selector_name is invalid.'); positive(r,'next_inventory_serial'); jsonObj(r,'derived_common_ebay_aspects'); if (!Array.isArray(r.condition_descriptors)) throw new Error('Variation listing RPC condition_descriptors must be an array.'); if (r.condition_description !== null) str(r,'condition_description'); if (r.description !== null) str(r,'description'); if (r.title !== null) str(r,'title'); str(r,'created_at'); str(r,'updated_at'); return r as unknown as VariationListingGroupRow;
};
const parseSession = (v: Json): VariationListingIntakeSessionRow => {
  const r = record(v,'session'); str(r,'capture_source_key'); const mode = str(r,'mode'); if (!['idle','new_variation','duplicate_copy'].includes(mode)) throw new Error('Variation listing RPC session mode is invalid.'); if (r.target_group_id !== null) str(r,'target_group_id'); if (r.target_variation_id !== null) str(r,'target_variation_id'); if (mode === 'idle' && (r.target_group_id !== null || r.target_variation_id !== null)) throw new Error('Variation listing RPC idle session cannot have targets.'); if (mode === 'new_variation' && (typeof r.target_group_id !== 'string' || r.target_variation_id !== null)) throw new Error('Variation listing RPC new-variation session targets are invalid.'); if (mode === 'duplicate_copy' && (typeof r.target_group_id !== 'string' || typeof r.target_variation_id !== 'string')) throw new Error('Variation listing RPC duplicate-copy session targets are invalid.'); const price = num(r,'sticky_price_amount'); if (!isVariationListingManualPriceAmount(price)) throw new Error('Variation listing RPC sticky_price_amount is invalid.'); if (r.sticky_price_currency !== 'USD') throw new Error('Variation listing RPC sticky_price_currency must be USD.'); validateVariationListingPendingPair(r.pending_pair as Json | null); str(r,'created_at'); str(r,'updated_at'); return r as unknown as VariationListingIntakeSessionRow;
};
const parseVariation = (v: Json): VariationListingVariationRow => {
  const r = record(v,'variation'); str(r,'variation_id'); str(r,'group_id'); positive(r,'inventory_serial'); integer(r,'position'); str(r,'sku'); str(r,'selector_value'); const price = num(r,'price_amount'); if (!isVariationListingManualPriceAmount(price)) throw new Error('Variation listing RPC price_amount is invalid.'); if (r.price_currency !== 'USD') throw new Error('Variation listing RPC price_currency must be USD.'); if (r.representative_copy_id !== null) str(r,'representative_copy_id'); jsonObj(r,'variation_metadata'); str(r,'created_at'); str(r,'updated_at'); return r as unknown as VariationListingVariationRow;
};
const parseCopy = (v: Json): VariationListingCopyRow => {
  const r = record(v,'copy'); str(r,'copy_id'); str(r,'variation_id'); str(r,'condition_token'); str(r,'front_r2_key'); str(r,'back_r2_key'); str(r,'capture_source_key'); str(r,'capture_pair_id'); str(r,'capture_front_source_ref'); str(r,'capture_back_source_ref'); str(r,'capture_started_at'); str(r,'captured_at'); str(r,'created_at'); str(r,'updated_at'); if (!['available','unavailable'].includes(str(r,'availability_state'))) throw new Error('Variation listing RPC availability_state is invalid.'); if (r.condition_notes !== null) str(r,'condition_notes'); return r as unknown as VariationListingCopyRow;
};
const rpcSingle = async <T>(client: SupabaseDataClient, fn: string, args: Record<string, unknown>, missing: string): Promise<T> => unwrap((await client.rpc(fn as never, args as never).single()) as SingleResult<T>, missing);
const canonicalJson = (value: Json): Json => {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value !== null && typeof value === 'object') {
    const normalized = Object.create(null) as Record<string, Json>;
    for (const key of Object.keys(value).sort()) {
      const child = value[key];
      if (child !== undefined) normalized[key] = canonicalJson(child);
    }
    return normalized;
  }
  return value;
};
export const variationListingJsonSemanticallyEqual = (actual: Json, expected: Json): boolean =>
  JSON.stringify(canonicalJson(actual)) === JSON.stringify(canonicalJson(expected));
const same = (actual: unknown, expected: unknown, label: string): void => {
  if (!variationListingJsonSemanticallyEqual(actual as Json, expected as Json)) throw new Error(`Variation listing RPC response ${label} parity mismatch.`);
};
const sameInstant = (actual: string, expected: string, label: string): void => {
  const actualTime = Date.parse(actual);
  const expectedTime = Date.parse(expected);
  if (Number.isNaN(actualTime) || Number.isNaN(expectedTime)) throw new Error(`Variation listing RPC response ${label} must be a valid timestamp.`);
  if (actualTime !== expectedTime) throw new Error(`Variation listing RPC response ${label} parity mismatch.`);
};
const assertGroupInput = (row: VariationListingGroupRow, input: CreateVariationListingGroupInput): void => {
  const fields: Array<[keyof CreateVariationListingGroupInput, keyof VariationListingGroupRow]> = [
    ['groupId','group_id'], ['groupKey','group_key'], ['skuCategoryCode','sku_category_code'], ['skuBucketToken','sku_bucket_token'], ['categoryId','category_id'], ['marketplaceId','marketplace_id'], ['merchantLocationKey','merchant_location_key'], ['fulfillmentPolicyId','fulfillment_policy_id'], ['paymentPolicyId','payment_policy_id'], ['returnPolicyId','return_policy_id'], ['conditionId','condition_id'], ['conditionToken','condition_token'],
  ];
  for (const [arg, field] of fields) same(row[field], input[arg], field);
};

async function loadAggregate(client: SupabaseDataClient, groupId: string): Promise<VariationListingAggregateSnapshot | null> { const g = await getVariationListingGroupById(client, groupId); if (!g) return null; if (g.groupId !== groupId || g.source.group_id !== groupId) throw new Error('Variation listing aggregate group identity parity mismatch.'); const vars = await listVariationListingVariationsByGroupId(client, groupId); for (const v of vars) { if (v.groupId !== groupId || v.source.group_id !== groupId) throw new Error('Variation listing aggregate variation identity parity mismatch.'); } const copies = (await Promise.all(vars.map(v => listVariationListingCopiesByVariationId(client, v.variationId)))).flatMap(x => x.map(c => { if (!vars.some(v => v.variationId === c.variationId) || c.source.variation_id !== c.variationId) throw new Error('Variation listing aggregate copy identity parity mismatch.'); return c.source; })); return { group: g.source, variations: vars.map(v => v.source), copies }; }
async function captureRevision(client: SupabaseDataClient, input: CaptureVariationListingRevisionInput): Promise<CaptureVariationListingRevisionResult> { const operationPlan = input.operationPlan.map(op => ({ sequence_no: op.sequenceNo, operation_key: op.operationKey, operation_kind: op.operationKind, target_ref: op.targetRef, intent_version: op.intentVersion, intent_digest: op.intentDigest, intent: op.intent })); const row = await rpcSingle<{ revision: Json }>(client, 'capture_variation_listing_revision', { p_group_id: input.groupId, p_revision_id: input.revisionId, p_captured_desired_revision: input.capturedDesiredRevision, p_snapshot_version: input.snapshotVersion, p_snapshot_digest: input.snapshotDigest, p_snapshot: input.snapshot, p_operation_plan: operationPlan }, 'Variation listing revision capture returned no row.'); const revision = parseRevision(row.revision); if (revision.revision_id !== input.revisionId || revision.group_id !== input.groupId || revision.captured_desired_revision !== input.capturedDesiredRevision || revision.snapshot_version !== input.snapshotVersion || revision.snapshot_digest !== input.snapshotDigest || revision.operation_count !== input.operationPlan.length) throw new Error('Variation listing RPC response parity mismatch.'); same(revision.snapshot, input.snapshot, 'snapshot'); same(revision.operation_plan, operationPlan, 'operation_plan'); return { revision }; }
async function appendJournalCheckpoint(client: SupabaseDataClient, input: AppendVariationListingJournalCheckpointInput): Promise<AppendVariationListingJournalCheckpointResult> { const row = await rpcSingle<{ checkpoint: Json }>(client, 'append_variation_listing_journal_checkpoint', { p_revision_id: input.revisionId, p_operation_key: input.operationKey, p_checkpoint_id: input.checkpointId, p_attempt_number: input.attemptNumber, p_checkpoint_number: input.checkpointNumber, p_state: input.state, p_observed_remote_state: input.observedRemoteState ?? null, p_evidence: input.evidence }, 'Variation listing journal checkpoint returned no row.'); const checkpoint = parseCheckpoint(row.checkpoint); if (checkpoint.revision_id !== input.revisionId || checkpoint.operation_key !== input.operationKey || checkpoint.checkpoint_id !== input.checkpointId || checkpoint.attempt_number !== input.attemptNumber || checkpoint.checkpoint_number !== input.checkpointNumber || checkpoint.state !== input.state || checkpoint.observed_remote_state !== (input.observedRemoteState ?? null)) throw new Error('Variation listing RPC response parity mismatch.'); same(checkpoint.evidence, input.evidence, 'evidence'); return { checkpoint }; }
async function confirmRevision(client: SupabaseDataClient, input: ConfirmVariationListingRevisionInput) { const row = await rpcSingle<{ group_row: Json }>(client, 'confirm_variation_listing_revision', { p_group_id: input.groupId, p_expected_previous_confirmed_revision: input.expectedPreviousConfirmedRevision, p_confirmed_revision: input.confirmedRevision }, 'Variation listing confirmation returned no row.'); const group = parseGroup(row.group_row); if (group.group_id !== input.groupId || group.last_confirmed_revision !== input.confirmedRevision) throw new Error('Variation listing RPC response parity mismatch.'); return group; }
async function applyGroupReviewDraft(client: SupabaseDataClient, input: ApplyVariationListingGroupReviewDraftInput): Promise<VariationListingGroupRow> {
  if (!Number.isInteger(input.expectedDesiredRevision) || input.expectedDesiredRevision < 0) throw new Error('Variation listing review draft expected revision must be a non-negative integer.');
  const title = input.title.trim();
  const description = input.description.trim();
  if (!title || !description) throw new Error('Variation listing review draft title and description must be non-empty.');
  if (input.derivedCommonEbayAspects === null || typeof input.derivedCommonEbayAspects !== 'object' || Array.isArray(input.derivedCommonEbayAspects)) throw new Error('Variation listing review draft common aspects must be a JSON object.');
  const row = await rpcSingle<{ group_row: Json }>(client, 'apply_variation_listing_group_review_draft', {
    p_group_id: input.groupId,
    p_expected_desired_revision: input.expectedDesiredRevision,
    p_title: title,
    p_description: description,
    p_derived_common_ebay_aspects: input.derivedCommonEbayAspects,
  }, 'Variation listing review draft returned no row.');
  const group = parseGroup(row.group_row);
  if (group.group_id !== input.groupId || group.title !== title || group.description !== description || group.lifecycle_state !== 'review' || group.desired_revision !== input.expectedDesiredRevision + 1) throw new Error('Variation listing RPC response parity mismatch.');
  same(group.derived_common_ebay_aspects, input.derivedCommonEbayAspects, 'derived_common_ebay_aspects');
  return group;
}
async function updateVariationPrice(client: SupabaseDataClient, input: UpdateVariationListingManualPriceInput): Promise<{ group: VariationListingGroupRow; variation: VariationListingVariationRow }> {
  if (!Number.isInteger(input.expectedDesiredRevision) || input.expectedDesiredRevision < 0) throw new Error('Variation listing price edit expected revision must be a non-negative integer.');
  if (!isVariationListingManualPriceAmount(input.priceAmount)) throw new Error('Variation listing price edit amount is invalid.');
  const row = await rpcSingle<{ group_row: Json; variation_row: Json }>(client, 'update_variation_listing_manual_price', {
    p_group_id: input.groupId,
    p_variation_id: input.variationId,
    p_expected_desired_revision: input.expectedDesiredRevision,
    p_price_amount: input.priceAmount,
  }, 'Variation listing price edit returned no row.');
  const group = parseGroup(row.group_row);
  const variation = parseVariation(row.variation_row);
  if (group.group_id !== input.groupId || group.desired_revision !== input.expectedDesiredRevision + 1 || variation.group_id !== input.groupId || variation.variation_id !== input.variationId || variation.price_amount !== input.priceAmount || variation.price_currency !== 'USD') throw new Error('Variation listing RPC response parity mismatch.');
  return { group, variation };
}
const mutation = async <T>(client: SupabaseDataClient, fn: string, args: Record<string, unknown>, key: string): Promise<T> => { const row = await rpcSingle<Record<string, Json>>(client, fn, args, `Variation listing ${fn} returned no row.`); return row[key] as unknown as T; };
export function createSupabaseVariationListingTransactionGateway(client: SupabaseDataClient): VariationListingTransactionGateway { return {
  loadAggregate: id => loadAggregate(client,id), captureRevision: i => captureRevision(client,i), appendJournalCheckpoint: i => appendJournalCheckpoint(client,i), confirmRevision: i => confirmRevision(client,i), applyGroupReviewDraft: i => applyGroupReviewDraft(client,i), updateVariationPrice: i => updateVariationPrice(client,i),
  createGroup: async (i: CreateVariationListingGroupInput) => { const group = parseGroup(await mutation<Json>(client,'create_variation_listing_group',{ p_group_id:i.groupId,p_group_key:i.groupKey,p_sku_category_code:i.skuCategoryCode,p_sku_bucket_token:i.skuBucketToken,p_category_id:i.categoryId,p_marketplace_id:i.marketplaceId,p_merchant_location_key:i.merchantLocationKey,p_fulfillment_policy_id:i.fulfillmentPolicyId,p_payment_policy_id:i.paymentPolicyId,p_return_policy_id:i.returnPolicyId,p_condition_id:i.conditionId,p_condition_token:i.conditionToken },'group_row')); assertGroupInput(group, i); return group; },
  configureIntake: async (i: ConfigureVariationListingIntakeInput) => { const session = parseSession(await mutation<Json>(client,'configure_variation_listing_intake',{p_capture_source_key:i.captureSourceKey,p_mode:i.mode,p_target_group_id:i.targetGroupId,p_target_variation_id:i.targetVariationId,p_sticky_price_amount:i.stickyPriceAmount},'session_row')); if (session.capture_source_key !== i.captureSourceKey || session.mode !== i.mode || session.target_group_id !== i.targetGroupId || session.target_variation_id !== i.targetVariationId || session.sticky_price_amount !== i.stickyPriceAmount) throw new Error('Variation listing RPC response parity mismatch.'); return session; },
  startIntakePair: async (i: StartVariationListingIntakePairInput) => { const session = parseSession(await mutation<Json>(client,'start_variation_listing_intake_pair',{p_capture_source_key:i.captureSourceKey,p_pair_id:i.pairId,p_front_source_ref:i.frontSourceRef,p_started_at:i.startedAt},'session_row')); const pending = validateVariationListingPendingPair(session.pending_pair); if (session.capture_source_key !== i.captureSourceKey || !pending || pending.pair_id !== i.pairId || pending.mode !== session.mode || pending.target_group_id !== session.target_group_id || pending.target_variation_id !== session.target_variation_id || pending.price_amount !== session.sticky_price_amount || pending.price_currency !== session.sticky_price_currency || pending.front_source_ref !== i.frontSourceRef) throw new Error('Variation listing RPC response parity mismatch.'); sameInstant(pending.started_at as string, i.startedAt, 'started_at'); return session; },
  discardIntakePair: async source => { const session = parseSession(await mutation<Json>(client,'discard_variation_listing_intake_pair',{p_capture_source_key:source},'session_row')); if (session.capture_source_key !== source || session.pending_pair !== null) throw new Error('Variation listing RPC response parity mismatch.'); return session; },
  completeNewVariation: async (i: CompleteVariationListingNewVariationInput) => { const r = await rpcSingle<{group_row:Json;variation_row:Json;copy_row:Json}>(client,'complete_variation_listing_new_variation',{p_capture_source_key:i.captureSourceKey,p_copy_id:i.copyId,p_variation_id:i.variationId,p_capture_pair_id:i.capturePairId,p_condition_token:i.conditionToken,p_selector_value:i.selectorValue,p_variation_metadata:i.variationMetadata,p_front_r2_key:i.frontR2Key,p_back_r2_key:i.backR2Key,p_back_source_ref:i.backSourceRef,p_captured_at:i.capturedAt ?? null},'Variation listing completion returned no row.'); const group = parseGroup(r.group_row); const variation = parseVariation(r.variation_row); const copy = parseCopy(r.copy_row); if (variation.variation_id !== i.variationId || copy.copy_id !== i.copyId || copy.variation_id !== i.variationId || copy.capture_pair_id !== i.capturePairId || copy.capture_source_key !== i.captureSourceKey || copy.condition_token !== i.conditionToken || copy.front_r2_key !== i.frontR2Key || copy.back_r2_key !== i.backR2Key || copy.capture_back_source_ref !== i.backSourceRef || variation.group_id !== group.group_id) throw new Error('Variation listing RPC response parity mismatch.'); same(variation.selector_value, i.selectorValue, 'selector_value'); same(variation.variation_metadata, i.variationMetadata, 'variation_metadata'); return {group,variation,copy}; },
  completeDuplicateCopy: async (i: CompleteVariationListingDuplicateCopyInput) => { const r = await rpcSingle<{group_row:Json;copy_row:Json}>(client,'complete_variation_listing_duplicate_copy',{p_capture_source_key:i.captureSourceKey,p_copy_id:i.copyId,p_capture_pair_id:i.capturePairId,p_variation_id:i.variationId,p_condition_token:i.conditionToken,p_front_r2_key:i.frontR2Key,p_back_r2_key:i.backR2Key,p_back_source_ref:i.backSourceRef,p_captured_at:i.capturedAt ?? null},'Variation listing completion returned no row.'); const group = parseGroup(r.group_row); const copy = parseCopy(r.copy_row); if (copy.copy_id !== i.copyId || copy.variation_id !== i.variationId || copy.capture_pair_id !== i.capturePairId || copy.capture_source_key !== i.captureSourceKey || copy.condition_token !== i.conditionToken || copy.front_r2_key !== i.frontR2Key || copy.back_r2_key !== i.backR2Key || copy.capture_back_source_ref !== i.backSourceRef) throw new Error('Variation listing RPC response parity mismatch.'); return {group,copy}; },
}; }
