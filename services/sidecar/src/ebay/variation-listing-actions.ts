import { randomUUID } from 'node:crypto';

import {
  VariationListingTransactionConflictError,
  buildPublicImageUrl,
  loadR2ImageStorageConfig,
  type Json,
  type VariationListingAggregateSnapshot,
  type VariationListingPublishingCheckpointRow,
  type VariationListingRevisionRow,
} from '@ebay-inventory/data';

import { EbaySellerApi } from '@/api/index.js';
import { getEbayConfig } from '@/config/environment.js';
import {
  buildVariationListingInventoryPayloadBundle,
  type VariationListingInventoryPayloadBundle,
} from '@/ebay/variation-listing-payloads.js';
import {
  buildVariationListingFrozenPublicationRevision,
  executeVariationListingPublication,
  reconcileVariationListingExactPublished,
  type VariationListingFrozenPublicationRevision,
  type VariationListingMediaResource,
  type VariationListingPublicationMutationGateway,
  type VariationListingPublicationRemoteGateway,
  type VariationListingRemoteRead,
} from '@/ebay/variation-listing-publication.js';
import {
  executeVariationListingActiveRevisionPublication,
  prepareVariationListingFrozenActiveRevision,
  reconstructVariationListingConfirmedRepresentativeImages,
  type VariationListingFrozenActiveRevision,
} from '@/ebay/variation-listing-active-revision.js';
import {
  abandonUntouchedVariationListingGroup,
  executeVariationListingCleanup,
  executeVariationListingWithdrawal,
  freezeVariationListingCleanupRevision,
  prepareVariationListingCleanupPlan,
  type VariationListingFrozenCleanupRevision,
} from '@/ebay/variation-listing-cleanup.js';
import {
  classifyVariationListingStatus,
  projectInventoryItemSemanticSnapshot,
  projectOfferSemanticSnapshot,
  type VariationListingStatus,
} from '@/ebay/variation-listing-sandbox-pilot.js';
import {
  emitVariationListingActionEvent,
  type VariationListingActionName,
} from '@/ebay/variation-listing-action-events.js';

export type VariationListingRemoteStateCertainty = 'known_unchanged' | 'known_changed' | 'unknown';
export type VariationListingRetryStatus =
  | 'not_applicable'
  | 'safe_to_retry'
  | 'reconciliation_required'
  | 'retry_exhausted';

export interface VariationListingUiIssue {
  code?: string;
  field?: string;
  message: string;
  resource?: string;
}

export interface VariationListingActionStatus {
  action: VariationListingActionName;
  affected: { groupId: string; variationId?: string; sku?: string };
  category: 'validation' | 'state' | 'remote' | 'reconciliation' | 'terminal' | 'system';
  code: string;
  diagnostic?: string;
  issues: VariationListingUiIssue[];
  operationKey?: string;
  recommendedActions: string[];
  remoteState: VariationListingRemoteStateCertainty;
  requiresReconciliation: boolean;
  retryStatus: VariationListingRetryStatus;
  revisionId?: string;
  severity: 'error' | 'warning';
  stage: string;
  summary: string;
  userActionRequired: boolean;
}

export class VariationListingActionError extends Error {
  readonly httpStatus: number;
  readonly status: VariationListingActionStatus;
  constructor(httpStatus: number, status: VariationListingActionStatus) {
    super(status.summary);
    this.name = 'VariationListingActionError';
    this.httpStatus = httpStatus;
    this.status = status;
  }
}

export interface VariationListingActionDataAccess {
  loadAggregate(groupId: string): Promise<VariationListingAggregateSnapshot | null>;
  listRevisionsByGroupId(groupId: string): Promise<Array<{ source: VariationListingRevisionRow }>>;
  listCheckpointsByRevisionId(revisionId: string): Promise<Array<{ source: VariationListingPublishingCheckpointRow }>>;
  markPublishReady(input: { groupId: string; expectedDesiredRevision: number }): Promise<unknown>;
  reserveActionRevision(input: import('@ebay-inventory/data').ReserveVariationListingActionRevisionInput): Promise<import('@ebay-inventory/data').VariationListingGroupRow>;
  updateCopyAvailability(input: { groupId: string; variationId: string; copyId: string; expectedDesiredRevision: number; availabilityState: 'available' | 'unavailable' }): Promise<unknown>;
  captureRevision: import('@ebay-inventory/data').VariationListingTransactionGateway['captureRevision'];
  appendJournalCheckpoint: import('@ebay-inventory/data').VariationListingTransactionGateway['appendJournalCheckpoint'];
  confirmRevision: import('@ebay-inventory/data').VariationListingTransactionGateway['confirmRevision'];
  advanceCleanupLifecycle: import('@ebay-inventory/data').VariationListingTransactionGateway['advanceCleanupLifecycle'];
  abandonUntouchedGroup: import('@ebay-inventory/data').VariationListingTransactionGateway['abandonUntouchedGroup'];
}

export interface VariationListingActionServiceOptions {
  data: VariationListingActionDataAccess;
  remoteFactory?: () => Promise<{
    mutations: VariationListingPublicationMutationGateway & {
      deleteInventoryItem(sku: string): Promise<void>;
      deleteInventoryItemGroup(groupKey: string): Promise<void>;
      deleteOffer(offerId: string): Promise<void>;
      publishOffer(offerId: string): Promise<{ listingId: string }>;
      updateOffer(offerId: string, payload: Json): Promise<void>;
      withdrawInventoryItemGroup(groupKey: string): Promise<void>;
    };
    remote: VariationListingPublicationRemoteGateway;
  }>;
  publicImageBaseUrl?: string;
  createId?: () => string;
}

type RevisionKind = 'initial' | 'active' | 'cleanup';

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function semanticAggregateJson(snapshot: VariationListingAggregateSnapshot): string {
  const { desired_revision: _desired, last_confirmed_revision: _confirmed, updated_at: _groupUpdated, ...group } = snapshot.group;
  const variations = snapshot.variations
    .map(({ updated_at: _updated, ...variation }) => variation)
    .sort((left, right) => left.position - right.position || left.variation_id.localeCompare(right.variation_id));
  const copies = snapshot.copies
    .map(({ updated_at: _updated, ...copy }) => copy)
    .sort((left, right) => left.copy_id.localeCompare(right.copy_id));
  return canonicalJson({ group, variations, copies });
}

function semanticallyEqualAggregate(
  left: VariationListingAggregateSnapshot,
  right: VariationListingAggregateSnapshot,
  allowPublishConfirmationTransition = false
): boolean {
  if (allowPublishConfirmationTransition && left.group.lifecycle_state === 'active' && right.group.lifecycle_state === 'publish-ready') {
    right = { ...right, group: { ...right.group, lifecycle_state: 'active' } };
  }
  return semanticAggregateJson(left) === semanticAggregateJson(right);
}

function strictRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Frozen variation listing ${label} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Frozen variation listing ${label} must be a non-empty string.`);
  }
  return value;
}

function requiredPositiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`Frozen variation listing ${label} must be a positive integer.`);
  }
  return value;
}

function statusCode(error: unknown): number | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    const row = record(current);
    const response = record(row.response);
    const status = row.statusCode ?? response.status;
    if (typeof status === 'number') return status;
    current = row.cause;
  }
  return undefined;
}

function sanitizeUiText(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [redacted]')
    .replace(/(https?:\/\/)([^\s/@:]+):([^\s/@]+)@/gi, '$1[redacted]:[redacted]@')
    .replace(/(https?:\/\/[^\s?#]+)\?[^#\s]*/gi, '$1?[redacted]')
    .replace(/([?&](?:token|access_token|refresh_token|signature|sig|key|api_key|auth|password|secret|cookie|x-amz-[^=&\s]+)=)[^&#\s]*/gi, '$1[redacted]')
    .replace(/\b(token|access[_-]?token|refresh[_-]?token|signature|secret|password|cookie)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/\s+/g, ' ')
    .trim();
}

function conciseDiagnostic(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return sanitizeUiText(message).slice(0, 500);
}

function eBayIssues(error: unknown): VariationListingUiIssue[] {
  const candidates: unknown[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    const row = record(current);
    const response = record(row.response);
    const data = record(response.data);
    for (const source of [row.errors, data.errors]) {
      if (Array.isArray(source)) candidates.push(...source);
    }
    current = row.cause;
  }
  return candidates.slice(0, 20).map((candidate) => {
    const row = record(candidate);
    const parameters = Array.isArray(row.parameters) ? row.parameters.map(record) : [];
    const field = parameters
      .map((parameter) => typeof parameter.name === 'string' ? parameter.name.trim() : '')
      .find(Boolean);
    return {
      ...(row.errorId !== undefined ? { code: String(row.errorId) } : {}),
      ...(field ? { field } : {}),
      message: sanitizeUiText(String(row.longMessage ?? row.message ?? 'eBay rejected the request.')).slice(0, 300),
      ...(row.domain ? { resource: sanitizeUiText(String(row.domain)).slice(0, 120) } : {}),
    };
  });
}

function remoteRead<T>(operation: () => Promise<T>): Promise<VariationListingRemoteRead<T>> {
  return operation()
    .then((value) => ({ state: 'present', value }) as const)
    .catch((error) => statusCode(error) === 404
      ? ({ state: 'proven_absent' } as const)
      : ({ state: 'unknown', reason: conciseDiagnostic(error) } as const));
}

function readString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeGroup(raw: unknown, groupKey: string) {
  const row = record(raw);
  const rawGroupKey = row.inventoryItemGroupKey ?? row.groupKey;
  if (rawGroupKey !== undefined && (typeof rawGroupKey !== 'string' || rawGroupKey.trim() !== groupKey)) {
    throw new Error(`eBay inventory item group identity mismatch for ${groupKey}.`);
  }
  const variantSKUs = Array.isArray(row.variantSKUs)
    ? row.variantSKUs.map((value) => String(value).trim())
    : [];
  if (variantSKUs.some((value) => !value) || new Set(variantSKUs).size !== variantSKUs.length) {
    throw new Error('eBay group response contains malformed variant SKUs.');
  }
  return {
    variantSKUs,
    payload: {
      inventoryItemGroupKey: groupKey,
      title: row.title as Json,
      description: row.description as Json,
      aspects: row.aspects as Json,
      variantSKUs: variantSKUs as Json,
      variesBy: row.variesBy as Json,
      ...(row.imageUrls === undefined ? {} : { imageUrls: row.imageUrls as Json }),
    } as Json,
  };
}

function normalizeItem(raw: unknown, sku: string) {
  const row = record(raw);
  const rawSku = row.sku;
  if (rawSku !== undefined && (typeof rawSku !== 'string' || rawSku.trim() !== sku)) {
    throw new Error(`eBay inventory item identity mismatch for ${sku}.`);
  }
  const semantic = projectInventoryItemSemanticSnapshot({ ...row, sku: typeof rawSku === 'string' && rawSku.trim() ? rawSku : sku });
  const aliases = ['groupIds', 'inventoryItemGroupKeys']
    .filter((key) => key in row)
    .map((key) => Array.isArray(row[key]) ? (row[key] as unknown[]).map(String).map((value) => value.trim()) : []);
  const groupKeys = aliases.length === 0 ? null : aliases[0]!;
  if (aliases.some((values) => JSON.stringify([...values].sort()) !== JSON.stringify([...(groupKeys ?? [])].sort()))) {
    throw new Error(`eBay inventory item ${sku} group aliases conflict.`);
  }
  const payload: Record<string, Json> = {
    availability: semantic.availability as unknown as Json,
    condition: semantic.condition,
    conditionDescriptors: semantic.conditionDescriptors as unknown as Json,
    product: semantic.product as unknown as Json,
  };
  if (typeof row.conditionDescription === 'string' && row.conditionDescription.trim()) {
    payload.conditionDescription = row.conditionDescription.trim();
  }
  return { groupKeys, payload, sku };
}

function normalizeOffers(raw: unknown) {
  const rows = Array.isArray(record(raw).offers) ? record(raw).offers as unknown[] : [];
  return rows.map((candidate) => {
    const row = record(candidate);
    const semantic = projectOfferSemanticSnapshot(row);
    const listing = record(row.listing);
    const listingStatusRaw = readString(listing, 'listingStatus').toUpperCase();
    const supportedListingStatuses = new Set(['ACTIVE', 'OUT_OF_STOCK', 'INACTIVE', 'ENDED', 'EBAY_ENDED', 'NOT_LISTED']);
    if (listingStatusRaw && !supportedListingStatuses.has(listingStatusRaw)) throw new Error('eBay offer listing status is unsupported.');
    const listingStatus = listingStatusRaw ? listingStatusRaw as VariationListingStatus : null;
    const lifecycle = classifyVariationListingStatus(listingStatus);
    const status = readString(row, 'status').toUpperCase();
    const offerId = readString(row, 'offerId');
    if (status !== 'PUBLISHED' && status !== 'UNPUBLISHED') throw new Error('eBay offer status is unsupported.');
    if (!offerId) throw new Error('eBay offer response is missing offerId.');
    return {
      lifecycleClass: lifecycle.lifecycleClass,
      listingId: readString(listing, 'listingId') || null,
      marketplaceId: semantic.marketplaceId,
      offerId,
      payload: semantic as unknown as Json,
      sku: semantic.sku,
      status,
    } as const;
  });
}

let productionRemotePromise: ReturnType<NonNullable<VariationListingActionServiceOptions['remoteFactory']>> | undefined;
async function createProductionRemote() {
  productionRemotePromise ??= (async () => {
    const api = new EbaySellerApi(getEbayConfig());
    await api.initialize();
    const headers = { headers: { 'Content-Language': 'en-US' } };
    const remote: VariationListingPublicationRemoteGateway = {
      getInventoryItem: async (sku) => await remoteRead(async () => normalizeItem(await api.inventory.getInventoryItem(sku), sku)),
      getInventoryItemGroup: async (groupKey) => await remoteRead(async () => normalizeGroup(await api.inventory.getInventoryItemGroup(groupKey), groupKey)),
      getOffers: async (sku, marketplaceId) => {
        const read = await remoteRead(async () => normalizeOffers(await api.inventory.getOffers(sku, marketplaceId)));
        return read.state === 'proven_absent' ? { state: 'present', value: [] } : read;
      },
      getMedia: async (location) => await remoteRead(async () => await api.media.getImage(location)),
    };
    return {
      remote,
      mutations: {
        createMedia: async (sourceUrl) => await api.media.createImageFromUrl(sourceUrl),
        createOrReplaceInventoryItem: async (sku, payload) => { await api.inventory.createOrReplaceInventoryItem(sku, payload as never, headers); },
        createOffer: async (payload) => {
          const created = await api.inventory.createOffer(payload as never, headers);
          const offerId = created.offerId;
          if (typeof offerId !== 'string' || offerId.trim() === '') {
            throw new Error('eBay createOffer response is missing offerId.');
          }
          return { offerId };
        },
        createOrReplaceInventoryItemGroup: async (groupKey, payload) => { await api.inventory.createOrReplaceInventoryItemGroup(groupKey, payload as never, headers); },
        publishInventoryItemGroup: async (payload) => {
          const published = await api.inventory.publishOfferByInventoryItemGroup(payload as never, headers);
          const listingId = published.listingId;
          if (typeof listingId !== 'string' || listingId.trim() === '') {
            throw new Error('eBay publishOfferByInventoryItemGroup response is missing listingId.');
          }
          return { listingId };
        },
        publishOffer: async (offerId) => {
          const published = await api.inventory.publishOffer(offerId);
          const listingId = published.listingId;
          if (typeof listingId !== 'string' || listingId.trim() === '') {
            throw new Error('eBay publishOffer response is missing listingId.');
          }
          return { listingId };
        },
        updateOffer: async (offerId, payload) => { await api.inventory.updateOffer(offerId, payload as Record<string, unknown>); },
        withdrawInventoryItemGroup: async (groupKey) => { await api.inventory.withdrawOfferByInventoryItemGroup({ inventoryItemGroupKey: groupKey }, headers); },
        deleteOffer: async (offerId) => await api.inventory.deleteOffer(offerId, headers),
        deleteInventoryItemGroup: async (groupKey) => await api.inventory.deleteInventoryItemGroup(groupKey, headers),
        deleteInventoryItem: async (sku) => await api.inventory.deleteInventoryItem(sku, headers),
      },
    };
  })();
  return await productionRemotePromise;
}

function operationPlan(row: VariationListingRevisionRow) {
  if (!Array.isArray(row.operation_plan)) {
    throw new Error('Frozen variation listing revision operation_plan must be a JSON array.');
  }
  return row.operation_plan.map((value, index) => {
    const operation = strictRecord(value, `operation_plan[${index}]`);
    if (!('intent' in operation) || operation.intent === undefined) {
      throw new Error(`Frozen variation listing operation_plan[${index}] is missing intent.`);
    }
    const intentDigest = requiredString(operation.intent_digest, `operation_plan[${index}].intent_digest`);
    if (!/^[0-9a-f]{64}$/.test(intentDigest)) {
      throw new Error(`Frozen variation listing operation_plan[${index}].intent_digest must be 64 lowercase hex characters.`);
    }
    return {
      intent: operation.intent as Json,
      intentDigest,
      intentVersion: requiredPositiveInteger(operation.intent_version, `operation_plan[${index}].intent_version`),
      operationKey: requiredString(operation.operation_key, `operation_plan[${index}].operation_key`),
      operationKind: requiredString(operation.operation_kind, `operation_plan[${index}].operation_kind`),
      sequenceNo: requiredPositiveInteger(operation.sequence_no, `operation_plan[${index}].sequence_no`),
      targetRef: requiredString(operation.target_ref, `operation_plan[${index}].target_ref`),
    };
  });
}

function hydrateInitial(row: VariationListingRevisionRow): VariationListingFrozenPublicationRevision {
  const snapshot = row.snapshot as unknown as VariationListingFrozenPublicationRevision['snapshot'];
  return {
    snapshot,
    captureInput: {
      capturedDesiredRevision: row.captured_desired_revision,
      groupId: row.group_id,
      operationPlan: operationPlan(row),
      revisionId: row.revision_id,
      snapshot: row.snapshot,
      snapshotDigest: row.snapshot_digest,
      snapshotVersion: row.snapshot_version,
    },
  };
}

function hydrateActive(row: VariationListingRevisionRow): VariationListingFrozenActiveRevision {
  const snapshot = row.snapshot as unknown as VariationListingFrozenActiveRevision['snapshot'];
  return {
    snapshot,
    confirmedBundle: buildVariationListingInventoryPayloadBundle({
      aggregate: snapshot.confirmed.aggregate,
      representativeImages: snapshot.confirmed.representativeImages,
    }),
    desiredBundlePreview: null,
    captureInput: {
      capturedDesiredRevision: row.captured_desired_revision,
      groupId: row.group_id,
      operationPlan: operationPlan(row),
      revisionId: row.revision_id,
      snapshot: row.snapshot,
      snapshotDigest: row.snapshot_digest,
      snapshotVersion: row.snapshot_version,
    },
  };
}

function hydrateCleanup(row: VariationListingRevisionRow, expectedPreviousConfirmedRevision: number | null): VariationListingFrozenCleanupRevision {
  const snapshot = row.snapshot as unknown as VariationListingFrozenCleanupRevision['plan']['snapshot'];
  return {
    expectedPreviousConfirmedRevision,
    plan: { snapshot, snapshotDigest: row.snapshot_digest, operationPlan: operationPlan(row) },
    captureInput: {
      capturedDesiredRevision: row.captured_desired_revision,
      groupId: row.group_id,
      operationPlan: operationPlan(row),
      revisionId: row.revision_id,
      snapshot: row.snapshot,
      snapshotDigest: row.snapshot_digest,
      snapshotVersion: row.snapshot_version,
    },
  };
}

function revisionKind(row: VariationListingRevisionRow): RevisionKind {
  const kinds = new Set(operationPlan(row).map((operation) => operation.operationKind));
  const cleanup = [...kinds].some((kind) => kind.startsWith('cleanup_') || kind === 'withdrawal' || kind === 'final_absence_verification');
  if (cleanup) {
    if (row.snapshot_version !== 1) throw new Error(`Unsupported variation listing cleanup snapshot version ${row.snapshot_version}.`);
    return 'cleanup';
  }
  if (row.snapshot_version === 2) return 'active';
  if (row.snapshot_version === 1) return 'initial';
  throw new Error(`Unsupported variation listing revision snapshot version ${row.snapshot_version}.`);
}

function snapshotAggregate(row: VariationListingRevisionRow): VariationListingAggregateSnapshot {
  const root = row.snapshot as unknown as { aggregate?: VariationListingAggregateSnapshot };
  if (!root.aggregate) throw new Error('Frozen variation listing revision lacks aggregate snapshot.');
  return root.aggregate;
}

function durableOfferIds(
  revision: VariationListingRevisionRow,
  history: readonly VariationListingPublishingCheckpointRow[]
): Record<string, string> {
  const ids: Record<string, string> = {};
  for (const operation of operationPlan(revision).filter((candidate) => candidate.operationKind === 'child_offer_write')) {
    const latest = [...history]
      .filter((checkpoint) => checkpoint.operation_key === operation.operationKey)
      .sort((left, right) => left.attempt_number - right.attempt_number || left.checkpoint_number - right.checkpoint_number)
      .at(-1);
    if (!latest || !['confirmed_complete', 'confirmed_no_op'].includes(latest.state)) {
      throw new Error(`Frozen variation listing offer operation ${operation.operationKey} lacks a terminal durable checkpoint.`);
    }
    const evidence = record(latest.evidence);
    const offerId = readString(evidence, 'offerId');
    if (!offerId) continue;
    const sku = readString(evidence, 'sku') || operation.targetRef;
    if (sku !== operation.targetRef) throw new Error(`Frozen variation listing offer operation ${operation.operationKey} identity mismatch.`);
    ids[sku] = offerId;
  }
  return ids;
}

function mediaResourcesForAggregate(
  aggregate: VariationListingAggregateSnapshot,
  publicBaseUrl: string,
  previous?: VariationListingAggregateSnapshot
): VariationListingMediaResource[] {
  const previousById = new Map(previous?.variations.map((variation) => [variation.variation_id, variation]) ?? []);
  const copies = new Map(aggregate.copies.map((copy) => [copy.copy_id, copy]));
  return aggregate.variations.flatMap((variation) => {
    const copyId = variation.representative_copy_id;
    if (!copyId) throw new Error(`Variation ${variation.variation_id} has no representative copy.`);
    const prior = previousById.get(variation.variation_id);
    if (previous && prior?.representative_copy_id === copyId) return [];
    const copy = copies.get(copyId);
    if (!copy || copy.variation_id !== variation.variation_id) throw new Error(`Representative copy ${copyId} is not owned by variation ${variation.variation_id}.`);
    return [
      { copyId, role: 'front' as const, sourceUrl: buildPublicImageUrl(publicBaseUrl, copy.front_r2_key) },
      { copyId, role: 'back' as const, sourceUrl: buildPublicImageUrl(publicBaseUrl, copy.back_r2_key) },
    ];
  });
}

function latestUnresolvedOperation(checkpoints: readonly VariationListingPublishingCheckpointRow[]) {
  const latest = new Map<string, VariationListingPublishingCheckpointRow>();
  for (const row of checkpoints) {
    const prior = latest.get(row.operation_key);
    if (!prior || row.attempt_number > prior.attempt_number || (row.attempt_number === prior.attempt_number && row.checkpoint_number > prior.checkpoint_number)) latest.set(row.operation_key, row);
  }
  return [...latest.values()].find((row) => ['started', 'unknown', 'retry_authorized', 'retry_exhausted'].includes(row.state));
}

function unresolvedError(
  action: VariationListingActionName,
  groupId: string,
  revision: VariationListingRevisionRow,
  operation: VariationListingPublishingCheckpointRow
): VariationListingActionError {
  const exhausted = operation.state === 'retry_exhausted';
  return new VariationListingActionError(409, {
    action,
    affected: { groupId },
    category: exhausted ? 'terminal' : 'reconciliation',
    code: exhausted ? 'retry_exhausted' : 'variation_listing_remote_outcome_unknown',
    issues: [],
    operationKey: operation.operation_key,
    recommendedActions: exhausted
      ? ['inspect_remote_state', 'resolve_manually']
      : ['reconcile_remote_state', 'do_not_retry_blindly'],
    remoteState: exhausted && operation.observed_remote_state === 'present' ? 'known_changed' : exhausted ? 'known_unchanged' : 'unknown',
    requiresReconciliation: !exhausted,
    retryStatus: exhausted ? 'retry_exhausted' : 'reconciliation_required',
    revisionId: revision.revision_id,
    severity: 'error',
    stage: 'preflight',
    summary: exhausted
      ? 'An older action revision exhausted its bounded replay; reconcile it before starting a newer action.'
      : 'An older action revision has an unresolved remote outcome. Reconcile it before starting a newer action.',
    userActionRequired: true,
  });
}

function validationError(action: VariationListingActionName, groupId: string, code: string, summary: string, recommendedActions: string[], affected: { variationId?: string; sku?: string } = {}) {
  return new VariationListingActionError(409, {
    action,
    affected: { groupId, ...affected },
    category: 'state',
    code,
    issues: [],
    recommendedActions,
    remoteState: 'known_unchanged',
    requiresReconciliation: false,
    retryStatus: 'not_applicable',
    severity: 'error',
    stage: 'preflight',
    summary,
    userActionRequired: true,
  });
}

export function createVariationListingActionService(options: VariationListingActionServiceOptions) {
  const ids = options.createId ?? randomUUID;
  const publicBaseUrl = () => options.publicImageBaseUrl ?? loadR2ImageStorageConfig().publicBaseUrl;
  const dependencies = options.remoteFactory ?? createProductionRemote;
  const resolveDependencies = async () => {
    const resolved = await dependencies();
    if (!resolved) throw new Error('Variation listing remote dependencies were not created.');
    return resolved;
  };
  const transaction = {
    loadAggregate: options.data.loadAggregate,
    captureRevision: options.data.captureRevision,
    appendJournalCheckpoint: options.data.appendJournalCheckpoint,
    confirmRevision: options.data.confirmRevision,
    advanceCleanupLifecycle: options.data.advanceCleanupLifecycle,
    abandonUntouchedGroup: options.data.abandonUntouchedGroup,
  };

  const rows = async (groupId: string) => (await options.data.listRevisionsByGroupId(groupId)).map((revision) => revision.source);
  const checkpoints = async (revisionId: string) => (await options.data.listCheckpointsByRevisionId(revisionId)).map((checkpoint) => checkpoint.source);
  const newestFirst = (revisions: VariationListingRevisionRow[]) =>
    [...revisions].sort((left, right) => right.captured_desired_revision - left.captured_desired_revision);
  const unresolvedRevision = async (revisions: VariationListingRevisionRow[]) => {
    for (const revision of newestFirst(revisions)) {
      const unresolved = latestUnresolvedOperation(await checkpoints(revision.revision_id));
      if (unresolved) return { operation: unresolved, revision };
    }
    return null;
  };
  const assertNoOlderUnresolved = async (
    action: VariationListingActionName,
    groupId: string,
    revisions: VariationListingRevisionRow[],
    desiredRevision: number,
  ): Promise<void> => {
    for (const revision of newestFirst(revisions)) {
      if (revision.captured_desired_revision >= desiredRevision) continue;
      const unresolved = latestUnresolvedOperation(await checkpoints(revision.revision_id));
      if (unresolved) throw unresolvedError(action, groupId, revision, unresolved);
    }
  };
  const journalFor = (revision?: VariationListingRevisionRow) => ({
    listCheckpoints: checkpoints,
    loadRevision: async (revisionId: string) => revision && revisionId === revision.revision_id ? revision : null,
  });
  const requireAggregate = async (groupId: string, action: VariationListingActionName, expected?: number) => {
    const aggregate = await options.data.loadAggregate(groupId);
    if (!aggregate) throw new VariationListingActionError(404, {
      action, affected: { groupId }, category: 'state', code: 'variation_listing_not_found', issues: [], recommendedActions: ['refresh_group_list'], remoteState: 'known_unchanged', requiresReconciliation: false, retryStatus: 'not_applicable', severity: 'error', stage: 'preflight', summary: 'Variation listing group was not found.', userActionRequired: true,
    });
    if (expected !== undefined && aggregate.group.desired_revision !== expected) throw validationError(action, groupId, 'variation_listing_state_stale', 'The variation listing changed after this action was prepared.', ['refresh_group', 'review_pending_changes']);
    return aggregate;
  };

  async function enrichError(action: VariationListingActionName, groupId: string, stage: string, error: unknown): Promise<VariationListingActionError> {
    if (error instanceof VariationListingActionError) return error;
    if (error instanceof VariationListingTransactionConflictError) {
      return validationError(action, groupId, 'variation_listing_state_stale', error.message, ['refresh_group', 'review_pending_changes']);
    }
    const revisions = await rows(groupId).catch(() => [] as VariationListingRevisionRow[]);
    const revision = [...revisions].sort((left, right) => right.captured_desired_revision - left.captured_desired_revision)[0];
    const history = revision ? await checkpoints(revision.revision_id).catch(() => [] as VariationListingPublishingCheckpointRow[]) : [];
    const unresolved = latestUnresolvedOperation(history);
    const unknown = unresolved?.state === 'unknown' || unresolved?.observed_remote_state === 'unknown' || unresolved?.state === 'started';
    const exhausted = unresolved?.state === 'retry_exhausted';
    const issues = eBayIssues(error);
    const knownUnchanged = issues.length > 0;
    const reconciliationRequired = !knownUnchanged || unknown;
    return new VariationListingActionError(reconciliationRequired ? 409 : 502, {
      action,
      affected: { groupId },
      category: exhausted ? 'terminal' : reconciliationRequired ? 'reconciliation' : 'remote',
      code: exhausted ? 'retry_exhausted' : unknown ? 'variation_listing_remote_outcome_unknown' : issues.length ? 'ebay_validation_failed' : 'variation_listing_action_failed',
      diagnostic: conciseDiagnostic(error),
      issues,
      ...(unresolved ? { operationKey: unresolved.operation_key } : {}),
      recommendedActions: exhausted
        ? ['inspect_remote_state', 'resolve_manually']
        : unknown
          ? ['reconcile_remote_state', 'do_not_retry_blindly']
          : issues.length
            ? ['correct_reported_fields', 'retry_action']
            : ['refresh_group', 'inspect_action_status'],
      remoteState: reconciliationRequired ? 'unknown' : 'known_unchanged',
      requiresReconciliation: reconciliationRequired,
      retryStatus: exhausted ? 'retry_exhausted' : reconciliationRequired ? 'reconciliation_required' : 'safe_to_retry',
      ...(revision ? { revisionId: revision.revision_id } : {}),
      severity: 'error',
      stage,
      summary: unknown
        ? 'The remote eBay outcome is not known. Do not retry until exact reconciliation completes.'
        : issues[0]?.message ?? 'The variation listing action did not complete.',
      userActionRequired: true,
    });
  }

  async function run<T>(action: VariationListingActionName, groupId: string, handler: (progress: (stage: string, status?: unknown) => void) => Promise<T>): Promise<T> {
    emitVariationListingActionEvent({ action, at: new Date().toISOString(), groupId, kind: 'action_started', stage: 'preflight' });
    let stage = 'preflight';
    const progress = (nextStage: string, status?: unknown) => {
      stage = nextStage;
      emitVariationListingActionEvent({ action, at: new Date().toISOString(), groupId, kind: 'action_progress', stage, status });
    };
    try {
      const result = await handler(progress);
      emitVariationListingActionEvent({ action, at: new Date().toISOString(), groupId, kind: 'action_succeeded', stage: 'complete', status: result });
      return result;
    } catch (error) {
      const normalized = await enrichError(action, groupId, stage, error);
      emitVariationListingActionEvent({ action, at: new Date().toISOString(), groupId, kind: 'action_failed', stage: normalized.status.stage, status: normalized.status });
      throw normalized;
    }
  }

  const executeInitial = async (aggregate: VariationListingAggregateSnapshot, existing?: VariationListingRevisionRow) => {
    const deps = await resolveDependencies();
    const frozen = existing
      ? hydrateInitial(existing)
      : buildVariationListingFrozenPublicationRevision({
          aggregate,
          mediaResources: mediaResourcesForAggregate(aggregate, publicBaseUrl()),
          revisionId: ids(),
        });
    return await executeVariationListingPublication({
      frozen,
      journal: journalFor(existing),
      mutations: deps.mutations,
      remote: deps.remote,
      transaction,
    });
  };

  const publish = (groupId: string, expectedDesiredRevision: number) => run('publish', groupId, async (progress) => {
    let aggregate = await requireAggregate(groupId, 'publish', expectedDesiredRevision);
    if (aggregate.group.last_confirmed_revision !== null) throw validationError('publish', groupId, 'initial_publish_already_completed', 'This group is already published. Use Publish Changes for staged updates.', ['publish_changes']);
    if (aggregate.group.lifecycle_state === 'review') {
      progress('mark_publish_ready');
      await options.data.markPublishReady({ groupId, expectedDesiredRevision });
      aggregate = await requireAggregate(groupId, 'publish', expectedDesiredRevision);
    }
    if (aggregate.group.lifecycle_state !== 'publish-ready') throw validationError('publish', groupId, 'initial_publish_lifecycle_blocked', `Initial publication is not allowed from lifecycle ${aggregate.group.lifecycle_state}.`, ['complete_group_review']);
    const revisions = await rows(groupId);
    const existing = revisions.find((revision) => revision.captured_desired_revision === expectedDesiredRevision && revisionKind(revision) === 'initial');
    if (!existing) await assertNoOlderUnresolved('publish', groupId, revisions, expectedDesiredRevision);
    progress(existing ? 'reconcile_existing_revision' : 'execute_publication');
    return await executeInitial(aggregate, existing);
  });

  const publishChanges = (groupId: string, expectedDesiredRevision: number) => run('publish_changes', groupId, async (progress) => {
    const aggregate = await requireAggregate(groupId, 'publish_changes', expectedDesiredRevision);
    if (aggregate.group.lifecycle_state !== 'active' || aggregate.group.last_confirmed_revision === null) throw validationError('publish_changes', groupId, 'publish_changes_lifecycle_blocked', 'Publish Changes requires an active published variation listing.', ['refresh_group']);
    if (aggregate.group.desired_revision <= aggregate.group.last_confirmed_revision) throw validationError('publish_changes', groupId, 'no_pending_changes', 'There are no staged changes to publish.', ['edit_group_or_variations']);
    const revisions = await rows(groupId);
    const existing = revisions.find((revision) => revision.captured_desired_revision === expectedDesiredRevision && revisionKind(revision) === 'active');
    if (!existing) await assertNoOlderUnresolved('publish_changes', groupId, revisions, expectedDesiredRevision);
    const deps = await resolveDependencies();
    let frozen: VariationListingFrozenActiveRevision;
    if (existing) {
      frozen = hydrateActive(existing);
      progress('reconcile_existing_revision');
    } else {
      const previous = revisions.find((revision) => revision.captured_desired_revision === aggregate.group.last_confirmed_revision);
      if (!previous) throw validationError('publish_changes', groupId, 'confirmed_revision_missing', 'The last confirmed publication revision is missing.', ['inspect_group_history']);
      const previousCheckpoints = await checkpoints(previous.revision_id);
      const priorAggregate = snapshotAggregate(previous);
      frozen = await prepareVariationListingFrozenActiveRevision({
        currentAggregate: aggregate,
        previousRevision: previous,
        previousCheckpoints,
        remote: deps.remote,
        revisionId: ids(),
        mediaResources: mediaResourcesForAggregate(aggregate, publicBaseUrl(), priorAggregate),
      });
      progress('execute_publish_changes');
    }
    return await executeVariationListingActiveRevisionPublication({
      frozen,
      journal: journalFor(existing),
      mutations: deps.mutations,
      remote: deps.remote,
      transaction,
    });
  });

  const retry = (groupId: string) => run('retry', groupId, async (progress) => {
    const aggregate = await requireAggregate(groupId, 'retry');
    const revisions = await rows(groupId);
    const pending = await unresolvedRevision(revisions);
    const revision = pending?.revision ?? newestFirst(revisions)[0];
    if (!revision) throw validationError('retry', groupId, 'retry_revision_missing', 'There is no frozen action revision to reconcile or retry.', ['refresh_group']);
    const history = await checkpoints(revision.revision_id);
    const unresolved = latestUnresolvedOperation(history);
    if (!unresolved) throw validationError('retry', groupId, 'retry_not_required', 'The latest action revision has no unresolved operation.', ['refresh_group']);
    if (unresolved.state === 'retry_exhausted') throw new VariationListingActionError(409, {
      action: 'retry',
      affected: { groupId },
      category: 'terminal',
      code: 'retry_exhausted',
      issues: [],
      operationKey: unresolved.operation_key,
      recommendedActions: ['inspect_remote_state', 'resolve_manually'],
      remoteState: unresolved.observed_remote_state === 'present' ? 'known_changed' : 'known_unchanged',
      requiresReconciliation: false,
      retryStatus: 'retry_exhausted',
      revisionId: revision.revision_id,
      severity: 'error',
      stage: 'preflight',
      summary: 'The one bounded replay is exhausted; another automatic retry is not permitted.',
      userActionRequired: true,
    });
    const deps = await resolveDependencies();
    progress('reconcile_remote_state', { operationKey: unresolved.operation_key, revisionId: revision.revision_id });
    if (revisionKind(revision) === 'initial') return await executeInitial(aggregate, revision);
    if (revisionKind(revision) === 'active') {
      return await executeVariationListingActiveRevisionPublication({ frozen: hydrateActive(revision), journal: journalFor(revision), mutations: deps.mutations, remote: deps.remote, transaction });
    }
    const cleanupFrozen = hydrateCleanup(revision, aggregate.group.last_confirmed_revision);
    if (aggregate.group.last_confirmed_revision !== null) {
      const unresolvedPlanOperation = operationPlan(revision).find((operation) => operation.operationKey === unresolved.operation_key);
      if (unresolvedPlanOperation?.operationKind !== 'withdrawal') {
        throw validationError('retry', groupId, 'cleanup_sale_protection_pending', 'Published cleanup cannot continue until variation-SKU sale protection is proven in YP8.', ['keep_group_withdrawn', 'wait_for_order_reconciliation']);
      }
      return await executeVariationListingWithdrawal({ frozen: cleanupFrozen, journal: journalFor(revision), mutations: deps.mutations, remote: deps.remote, transaction });
    }
    return await executeVariationListingCleanup({ frozen: cleanupFrozen, journal: journalFor(revision), mutations: deps.mutations, remote: deps.remote, transaction });
  });

  const quantity = (groupId: string, input: { variationId: string; copyId: string; expectedDesiredRevision: number; availabilityState: 'available' | 'unavailable' }) => run('quantity', groupId, async (progress) => {
    const aggregate = await requireAggregate(groupId, 'quantity', input.expectedDesiredRevision);
    const variation = aggregate.variations.find((candidate) => candidate.variation_id === input.variationId);
    if (!variation) throw validationError('quantity', groupId, 'variation_not_found', 'The selected variation no longer exists.', ['refresh_group'], { variationId: input.variationId });
    const copy = aggregate.copies.find((candidate) => candidate.copy_id === input.copyId && candidate.variation_id === input.variationId);
    if (!copy) throw validationError('quantity', groupId, 'copy_not_found', 'The selected physical copy no longer belongs to this variation.', ['refresh_group'], { variationId: input.variationId, sku: variation.sku });
    progress('stage_copy_availability', { variationId: input.variationId, sku: variation.sku });
    await options.data.updateCopyAvailability({ groupId, variationId: input.variationId, copyId: input.copyId, expectedDesiredRevision: input.expectedDesiredRevision, availabilityState: input.availabilityState });
    return { desiredRevision: input.expectedDesiredRevision + 1, staged: true, variationId: input.variationId, sku: variation.sku };
  });

  async function exactOwnedHistory(groupId: string, aggregate: VariationListingAggregateSnapshot, deps: Awaited<ReturnType<typeof resolveDependencies>>) {
    const revisions = (await rows(groupId))
      .filter((revision) =>
        aggregate.group.last_confirmed_revision !== null &&
        revision.captured_desired_revision <= aggregate.group.last_confirmed_revision &&
        revisionKind(revision) !== 'cleanup'
      )
      .sort((a, b) => a.captured_desired_revision - b.captured_desired_revision);
    if (revisions.length === 0) throw validationError('withdraw', groupId, 'published_revision_history_missing', 'Published remote ownership cannot be reconstructed from durable revisions.', ['inspect_group_history']);
    const bundles: VariationListingInventoryPayloadBundle[] = [];
    for (const revision of revisions) {
      const images = reconstructVariationListingConfirmedRepresentativeImages({ revision, checkpoints: await checkpoints(revision.revision_id) });
      bundles.push(buildVariationListingInventoryPayloadBundle({ aggregate: snapshotAggregate(revision), representativeImages: images }));
    }
    const last = revisions.at(-1)!;
    const lastImages = reconstructVariationListingConfirmedRepresentativeImages({ revision: last, checkpoints: await checkpoints(last.revision_id) });
    const lastBundle = bundles.at(-1)!;
    const published = await reconcileVariationListingExactPublished(deps.remote, { captureInput: { capturedDesiredRevision: last.captured_desired_revision, groupId: last.group_id, operationPlan: [], revisionId: last.revision_id, snapshot: last.snapshot, snapshotDigest: last.snapshot_digest, snapshotVersion: last.snapshot_version }, snapshot: { aggregate: snapshotAggregate(last), mediaResources: [], representativeImages: lastImages } }, lastBundle);
    return { bundles, ownedRemote: { listingId: published.listingId, offerIdsBySku: Object.fromEntries(published.offers.map((offer) => [offer.sku, offer.offerId])), publicationHistoryExists: true } };
  }

  const withdraw = (groupId: string, expectedDesiredRevision: number) => run('withdraw', groupId, async (progress) => {
    const loadedAggregate = await options.data.loadAggregate(groupId);
    let aggregate: VariationListingAggregateSnapshot = loadedAggregate ?? await requireAggregate(groupId, 'withdraw', expectedDesiredRevision);
    const revisions = await rows(groupId);
    let recoveringReservation = false;
    if (aggregate.group.desired_revision !== expectedDesiredRevision) {
      const source = aggregate.group.desired_revision === expectedDesiredRevision + 1 &&
        aggregate.group.last_confirmed_revision === expectedDesiredRevision
        ? revisions.find((revision) => revision.captured_desired_revision === expectedDesiredRevision && revisionKind(revision) !== 'cleanup')
        : undefined;
      const occupied = revisions.some((revision) => revision.captured_desired_revision === expectedDesiredRevision + 1);
      if (source && !occupied) {
        const sourceHistory = await checkpoints(source.revision_id);
        const sourceUnresolved = latestUnresolvedOperation(sourceHistory);
        if (sourceUnresolved) throw unresolvedError('withdraw', groupId, source, sourceUnresolved);
        const sourceAggregate = snapshotAggregate(source);
        if (!semanticallyEqualAggregate(aggregate, sourceAggregate, true)) {
          throw validationError('withdraw', groupId, 'withdraw_pending_changes', 'Withdrawal reservation recovery is blocked because the group changed after the original reservation.', ['refresh_group', 'review_pending_changes']);
        }
        recoveringReservation = true;
      } else {
        aggregate = await requireAggregate(groupId, 'withdraw', expectedDesiredRevision);
      }
    }
    const existing = revisions.find((revision) =>
      revision.captured_desired_revision === aggregate.group.desired_revision &&
      revisionKind(revision) === 'cleanup' &&
      operationPlan(revision).some((operation) => operation.operationKind === 'withdrawal')
    );
    let frozen: VariationListingFrozenCleanupRevision;
    let deps: Awaited<ReturnType<typeof resolveDependencies>> | undefined = undefined;
    if (existing) {
      if (aggregate.group.last_confirmed_revision === null) {
        throw validationError('withdraw', groupId, 'withdraw_lifecycle_blocked', 'Withdrawal requires an active published variation listing.', ['refresh_group']);
      }
      frozen = hydrateCleanup(existing, aggregate.group.last_confirmed_revision);
      progress('reconcile_existing_revision');
    } else {
      if (aggregate.group.lifecycle_state !== 'active' || aggregate.group.last_confirmed_revision === null) {
        throw validationError('withdraw', groupId, 'withdraw_lifecycle_blocked', 'Withdrawal requires an active published variation listing.', ['refresh_group']);
      }
      if (!recoveringReservation && aggregate.group.desired_revision !== aggregate.group.last_confirmed_revision) {
        throw validationError('withdraw', groupId, 'withdraw_pending_changes', 'Withdrawal is blocked while staged local changes are pending. Publish or discard the pending changes first.', ['publish_changes', 'review_pending_changes']);
      }
      deps = await resolveDependencies();
      const history = await exactOwnedHistory(groupId, aggregate, deps);
      progress('prepare_withdrawal');
      const plan = await prepareVariationListingCleanupPlan({ ownedBundles: history.bundles, ownedRemote: history.ownedRemote, protection: { state: 'clear' }, remote: deps.remote });
      let capturedDesiredRevision: number;
      if (recoveringReservation) {
        capturedDesiredRevision = aggregate.group.desired_revision;
      } else {
        progress('reserve_action_revision');
        const reserved = await options.data.reserveActionRevision({ groupId, expectedDesiredRevision: aggregate.group.desired_revision });
        if (reserved.group_id !== groupId || reserved.desired_revision !== aggregate.group.desired_revision + 1 || reserved.last_confirmed_revision !== aggregate.group.last_confirmed_revision) {
          throw new Error('Variation listing withdrawal action revision reservation response was not an exact CAS result.');
        }
        aggregate = await requireAggregate(groupId, 'withdraw', reserved.desired_revision);
        if (aggregate.group.lifecycle_state !== 'active' || aggregate.group.last_confirmed_revision !== reserved.last_confirmed_revision) {
          throw new Error('Variation listing withdrawal aggregate changed during action revision reservation.');
        }
        capturedDesiredRevision = reserved.desired_revision;
      }
      frozen = freezeVariationListingCleanupRevision({ capturedDesiredRevision, expectedPreviousConfirmedRevision: aggregate.group.last_confirmed_revision, groupId, plan, revisionId: ids() });
    }
    const resolvedDeps = deps ?? await resolveDependencies();
    progress('withdraw_remote_group');
    return await executeVariationListingWithdrawal({ frozen, journal: journalFor(existing), mutations: resolvedDeps.mutations, remote: resolvedDeps.remote, transaction });
  });

  const performUnpublishedAbandon = async (
    action: 'abandon' | 'cleanup',
    groupId: string,
    expectedDesiredRevision: number,
    progress: (stage: string, status?: unknown) => void
  ) => {
    const loadedAggregate = await options.data.loadAggregate(groupId);
    let aggregate: VariationListingAggregateSnapshot = loadedAggregate ?? await requireAggregate(groupId, action, expectedDesiredRevision);
    const revisions = await rows(groupId);
    let recoveringReservation = false;
    let recoverySource: VariationListingRevisionRow | undefined;
    if (aggregate.group.desired_revision !== expectedDesiredRevision) {
      const source = aggregate.group.desired_revision === expectedDesiredRevision + 1 &&
        aggregate.group.last_confirmed_revision === null
        ? revisions.find((revision) => revision.captured_desired_revision === expectedDesiredRevision && revisionKind(revision) !== 'cleanup')
        : undefined;
      const occupied = revisions.some((revision) => revision.captured_desired_revision === expectedDesiredRevision + 1);
      if (source && !occupied) {
        recoverySource = source;
        const sourceHistory = await checkpoints(source.revision_id);
        const sourceUnresolved = latestUnresolvedOperation(sourceHistory);
        if (sourceUnresolved) throw unresolvedError(action, groupId, source, sourceUnresolved);
        if (!semanticallyEqualAggregate(aggregate, snapshotAggregate(source))) {
          throw validationError(action, groupId, 'variation_listing_state_stale', 'Cleanup reservation recovery is blocked because the group changed after the original reservation.', ['refresh_group', 'review_pending_changes']);
        }
        recoveringReservation = true;
      } else {
        aggregate = await requireAggregate(groupId, action, expectedDesiredRevision);
      }
    }
    if (aggregate.group.last_confirmed_revision !== null) {
      throw validationError(
        action,
        groupId,
        action === 'cleanup' ? 'cleanup_sale_protection_pending' : 'abandon_published_group_forbidden',
        action === 'cleanup'
          ? 'Destructive cleanup is blocked until YP8 proves variation-SKU sold/order protection.'
          : 'Published groups must be withdrawn and protected cleanup must wait for sold/order reconciliation.',
        action === 'cleanup' ? ['keep_group_withdrawn', 'wait_for_order_reconciliation'] : ['withdraw_group']
      );
    }
    if (aggregate.group.desired_revision === 0) {
      const deps = await resolveDependencies();
      progress('prove_remote_absence');
      return await abandonUntouchedVariationListingGroup({ groupId, protection: { state: 'clear' }, remote: deps.remote, transaction });
    }
    const existing = revisions.find((revision) =>
      revision.captured_desired_revision === aggregate.group.desired_revision &&
      revisionKind(revision) === 'cleanup' &&
      operationPlan(revision).every((operation) => operation.operationKind !== 'withdrawal')
    );
    let frozen: VariationListingFrozenCleanupRevision;
    let journalRevision: VariationListingRevisionRow | undefined;
    let deps: Awaited<ReturnType<typeof resolveDependencies>> | undefined = undefined;
    if (existing) {
      frozen = hydrateCleanup(existing, null);
      journalRevision = existing;
    } else {
      const source = recoverySource ?? revisions.find((revision) =>
        revision.captured_desired_revision === aggregate.group.desired_revision && revisionKind(revision) !== 'cleanup'
      );
      if (!source) throw validationError(action, groupId, 'abandon_requires_frozen_revision', 'This non-empty unpublished group has no frozen publication revision to prove exact ownership.', ['leave_group_in_review', 'publish_or_create_recovery_revision']);
      const sourceHistory = await checkpoints(source.revision_id);
      const sourceUnresolved = latestUnresolvedOperation(sourceHistory);
      if (sourceUnresolved) throw unresolvedError(action, groupId, source, sourceUnresolved);
      deps = await resolveDependencies();
      const images = reconstructVariationListingConfirmedRepresentativeImages({ revision: source, checkpoints: sourceHistory });
      const bundle = buildVariationListingInventoryPayloadBundle({ aggregate: snapshotAggregate(source), representativeImages: images });
      const plan = await prepareVariationListingCleanupPlan({ ownedBundles: [bundle], ownedRemote: { listingId: null, offerIdsBySku: durableOfferIds(source, sourceHistory), publicationHistoryExists: false }, protection: { state: 'clear' }, remote: deps.remote });
      let capturedDesiredRevision: number;
      if (recoveringReservation) {
        capturedDesiredRevision = aggregate.group.desired_revision;
      } else {
        progress('reserve_action_revision');
        const reserved = await options.data.reserveActionRevision({ groupId, expectedDesiredRevision: aggregate.group.desired_revision });
        if (reserved.group_id !== groupId || reserved.desired_revision !== aggregate.group.desired_revision + 1 || reserved.last_confirmed_revision !== null) {
          throw new Error('Variation listing cleanup action revision reservation response was not an exact CAS result.');
        }
        const refreshed = await requireAggregate(groupId, action, reserved.desired_revision);
        if (refreshed.group.last_confirmed_revision !== null) {
          throw new Error('Variation listing cleanup aggregate became published during action revision reservation.');
        }
        aggregate = refreshed;
        capturedDesiredRevision = refreshed.group.desired_revision;
      }
      frozen = freezeVariationListingCleanupRevision({ capturedDesiredRevision, expectedPreviousConfirmedRevision: null, groupId, plan, revisionId: ids() });
    }
    const resolvedDeps = deps ?? await resolveDependencies();
    progress('cleanup_unpublished_remote_state');
    return await executeVariationListingCleanup({ frozen, journal: journalFor(journalRevision), mutations: resolvedDeps.mutations, remote: resolvedDeps.remote, transaction });
  };

  const abandon = (groupId: string, expectedDesiredRevision: number) =>
    run('abandon', groupId, async (progress) => await performUnpublishedAbandon('abandon', groupId, expectedDesiredRevision, progress));

  const cleanup = (groupId: string, expectedDesiredRevision: number) =>
    run('cleanup', groupId, async (progress) => await performUnpublishedAbandon('cleanup', groupId, expectedDesiredRevision, progress));

  return { abandon, cleanup, publish, publishChanges, quantity, retry, withdraw };
}
