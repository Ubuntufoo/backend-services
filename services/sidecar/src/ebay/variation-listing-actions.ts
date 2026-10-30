import { createHash, randomUUID } from 'node:crypto';

import {
  VariationListingTransactionConflictError,
  buildPublicImageUrl,
  inspectVariationListingJournal,
  loadR2ImageStorageConfig,
  type Json,
  type VariationListingAggregateSnapshot,
  type VariationListingPublishingCheckpointRow,
  type VariationListingRevisionRow,
} from '@ebay-inventory/data';

import { EbaySellerApi } from '@/api/index.js';
import { getEbayConfig } from '@/config/environment.js';
import { withExpectedApiNotFound } from '@/utils/logger.js';
import {
  buildVariationListingInventoryPayloadBundle,
  buildVariationListingHistoricalInventoryPayloadBundle,
  validateVariationListingNewPublicationPayload,
  type VariationListingInventoryPayloadBundle,
} from '@/ebay/variation-listing-payloads.js';
import {
  buildVariationListingFrozenPublicationRevision,
  executeVariationListingPublication,
  type VariationListingFrozenPublicationRevision,
  type VariationListingMediaResource,
  type VariationListingPublicationMutationGateway,
  type VariationListingPublicationRemoteGateway,
  type VariationListingRemoteRead,
} from '@/ebay/variation-listing-publication.js';
import { validateVariationListingMerchantLocation } from '@/ebay/inventory-location-validation.js';
import {
  applyVariationListingConfirmedRemoteQuantities,
  executeVariationListingActiveRevisionPublication,
  prepareVariationListingFrozenActiveRevision,
  reconcilePublishedQuantityBaseline,
  reconstructConfirmedRemoteIdentity,
  reconstructVariationListingConfirmedRepresentativeImages,
  revisionSnapshotAggregate,
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
import {
  buildVariationListingPermanentRemovalPlan,
  executeVariationListingPermanentRemoval,
  hydrateVariationListingPermanentRemovalPlan,
  type VariationListingPermanentRemovalRemote,
} from '@/ebay/variation-listing-permanent-removal.js';
import { hasEffectiveVariationListingPendingChanges } from '@/ebay/variation-listing-pending-changes.js';
import {
  executeRemovedSkuRemoteRetirement,
  type RemovedSkuRetirementRemote,
  type RemovedSkuRetirementStore,
} from '@/ebay/variation-listing-removed-sku-remote-retirement.js';

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
  /** Durable c2b Item/Offer retirement state; absent only in read-only test harnesses. */
  remoteRetirementStore?: RemovedSkuRetirementStore;
  loadAggregate(groupId: string): Promise<VariationListingAggregateSnapshot | null>;
  listRevisionsByGroupId(groupId: string): Promise<Array<{ source: VariationListingRevisionRow }>>;
  listCheckpointsByRevisionId(revisionId: string): Promise<Array<{ source: VariationListingPublishingCheckpointRow }>>;
  markPublishReady(input: { groupId: string; expectedDesiredRevision: number }): Promise<unknown>;
  reserveActionRevision(input: import('@ebay-inventory/data').ReserveVariationListingActionRevisionInput): Promise<import('@ebay-inventory/data').VariationListingGroupRow>;
  captureRevision: import('@ebay-inventory/data').VariationListingTransactionGateway['captureRevision'];
  capturePermanentRemovalRevision: import('@ebay-inventory/data').VariationListingTransactionGateway['capturePermanentRemovalRevision'];
  appendJournalCheckpoint: import('@ebay-inventory/data').VariationListingTransactionGateway['appendJournalCheckpoint'];
  confirmRevision: import('@ebay-inventory/data').VariationListingTransactionGateway['confirmRevision'];
  confirmPermanentRemoval: import('@ebay-inventory/data').VariationListingTransactionGateway['confirmPermanentRemoval'];
  advanceCleanupLifecycle: import('@ebay-inventory/data').VariationListingTransactionGateway['advanceCleanupLifecycle'];
  abandonUntouchedGroup: import('@ebay-inventory/data').VariationListingTransactionGateway['abandonUntouchedGroup'];
  returnToReview: import('@ebay-inventory/data').VariationListingTransactionGateway['returnToReview'];
}

export interface VariationListingQuantityStatusVariation {
  variationId: string;
  sku: string;
  ebayQuantity: number;
  pendingAdjustment: number;
  afterPublish: number;
  /** Public, fail-closed hint only; the staging RPC re-reads both remote sources. */
  soldOutRemovalEligible: boolean;
  /** Internal opt-in: never infer a removal-safe zero from only the lower sellable quantity. */
  inventoryItemQuantity?: number;
  offerQuantity?: number;
}

export interface VariationListingQuantityStatus {
  groupId: string;
  desiredRevision: number;
  lastConfirmedRevision: number;
  variations: VariationListingQuantityStatusVariation[];
}

export interface VariationListingActionServiceOptions {
  data: VariationListingActionDataAccess;
  remoteFactory?: () => Promise<{
    mutations: VariationListingPublicationMutationGateway & {
      deleteInventoryItem(sku: string): Promise<void>;
      deleteInventoryItemGroup(groupKey: string): Promise<void>;
      deleteOffer(offerId: string): Promise<void>;
      publishOffer(offerId: string): Promise<{ listingId: string }>;
      bulkUpdatePriceQuantity?(payload: Json): Promise<Json | void>;
      updateOffer(offerId: string, payload: Json): Promise<void>;
      withdrawInventoryItemGroup(groupKey: string, marketplaceId: string): Promise<void>;
      /** Exhaustive, all-marketplace Offer read for removed-SKU ownership proof. */
      getAllOffersForSku?(sku: string): Promise<Array<{
        offerId: string;
        sku: string;
        marketplaceId: string;
        status: 'PUBLISHED' | 'UNPUBLISHED';
        listingId: string | null;
        availableQuantity: number;
      }>>;
    };
    remote: VariationListingPublicationRemoteGateway;
    assertMerchantLocation?: (merchantLocationKey: string) => Promise<void>;
  }>;
  publicImageBaseUrl?: string;
  createId?: () => string;
}

type RevisionKind = 'initial' | 'active' | 'permanent_removal' | 'cleanup';

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

function remoteRead<T>(
  operation: () => Promise<T>,
  options?: { expectedNotFound?: boolean }
): Promise<VariationListingRemoteRead<T>> {
  const execute = options?.expectedNotFound === true
    ? () => withExpectedApiNotFound(operation)
    : operation;
  return execute()
    .then((value) => ({ state: 'present', value }) as const)
    .catch((error) => statusCode(error) === 404
      ? ({ state: 'proven_absent' } as const)
      : ({ state: 'unknown', reason: conciseDiagnostic(error) } as const));
}

function readString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return typeof value === 'string' ? value.trim() : '';
}

export interface RemovedSkuExhaustiveOffer {
  offerId: string;
  sku: string;
  marketplaceId: string;
  status: 'PUBLISHED' | 'UNPUBLISHED';
  listingId: string | null;
  availableQuantity: number;
}

/**
 * Normalize the raw all-marketplace Offer response used by c2b ownership
 * proof. A 404 means the Item/Offer collection is already absent; every other
 * read failure remains unknown and must block a destructive retry. The OAS
 * omits `listing` for UNPUBLISHED offers, so that field is a valid null
 * identity, while malformed present containers fail closed.
 */
export async function readRemovedSkuExhaustiveOffers(
  read: () => Promise<unknown>,
): Promise<RemovedSkuExhaustiveOffer[]> {
  let response: unknown;
  try {
    response = await withExpectedApiNotFound(read);
  } catch (error) {
    if (statusCode(error) === 404) return [];
    throw error;
  }
  if (response === null || typeof response !== 'object' || Array.isArray(response)) {
    throw new Error('eBay exhaustive Offer response must be an object.');
  }
  const root = response as Record<string, unknown>;
  const next = root.next;
  if (next !== undefined && next !== null && typeof next !== 'string') {
    throw new Error('eBay exhaustive Offer response contains an invalid pagination cursor.');
  }
  if (typeof next === 'string' && next.trim() !== '') {
    throw new Error('eBay exhaustive Offer response is not complete; more pages remain.');
  }
  const total = root.total;
  if (total !== undefined && (!Number.isSafeInteger(total) || (total as number) < 0)) {
    throw new Error('eBay exhaustive Offer response contains an invalid total.');
  }
  const size = root.size;
  if (size !== undefined && (!Number.isSafeInteger(size) || (size as number) < 0)) {
    throw new Error('eBay exhaustive Offer response contains an invalid size.');
  }
  const rawOffers = root.offers;
  if (rawOffers === undefined || rawOffers === null) {
    if (total !== 0 || size !== undefined && size !== 0) {
      throw new Error('eBay exhaustive Offer response is missing its complete offers collection.');
    }
    return [];
  }
  if (!Array.isArray(rawOffers)) throw new Error('eBay exhaustive Offer response contains invalid offers.');
  if (size !== undefined && size !== rawOffers.length) {
    throw new Error('eBay exhaustive Offer response size does not match its offers collection.');
  }
  if (total !== undefined && total !== rawOffers.length) {
    throw new Error('eBay exhaustive Offer response total does not match its offers collection.');
  }
  return rawOffers.map((offer) => {
    const row = record(offer);
    const hasListingContainer = row.listing !== undefined;
    if (hasListingContainer &&
      (row.listing === null || typeof row.listing !== 'object' || Array.isArray(row.listing))) {
      throw new Error('eBay exhaustive Offer response contains a malformed listing container.');
    }
    const listing = !hasListingContainer
      ? null
      : row.listing as Record<string, unknown>;
    const status = readString(row, 'status').toUpperCase();
    if (status !== 'PUBLISHED' && status !== 'UNPUBLISHED') throw new Error('eBay offer status is unsupported.');
    const listingId = listing ? readString(listing, 'listingId') : null;
    if (hasListingContainer && !listingId) {
      throw new Error('eBay exhaustive Offer response contains a listing container without a listingId.');
    }
    if (status === 'UNPUBLISHED' && hasListingContainer) {
      throw new Error('eBay unpublished Offer response must omit the listing container.');
    }
    if (status === 'PUBLISHED' && !listingId) {
      throw new Error('eBay published Offer response is missing its listingId.');
    }
    const offerId = readString(row, 'offerId');
    const offerSku = readString(row, 'sku');
    const marketplaceId = readString(row, 'marketplaceId');
    const availableQuantity = row.availableQuantity;
    if (!offerId || !offerSku || !marketplaceId || !Number.isSafeInteger(availableQuantity) || (availableQuantity as number) < 0) {
      throw new Error('eBay exhaustive Offer response is missing a required identity or quantity.');
    }
    return {
      offerId,
      sku: offerSku,
      marketplaceId,
      status,
      listingId,
      availableQuantity: availableQuantity as number,
    };
  });
}

function normalizeGroup(raw: unknown, groupKey: string) {
  const row = record(raw);
  const rawGroupKey = row.inventoryItemGroupKey ?? row.groupKey;
  if (rawGroupKey !== undefined && (typeof rawGroupKey !== 'string' || rawGroupKey.trim() !== groupKey)) {
    throw new Error(`eBay inventory item group identity mismatch for ${groupKey}.`);
  }
  const rawVariantSKUs = Array.isArray(row.variantSKUs) ? row.variantSKUs : [];
  if (rawVariantSKUs.some((value) => typeof value !== 'string' || value.trim() !== value || value === '') || new Set(rawVariantSKUs).size !== rawVariantSKUs.length) {
    throw new Error('eBay group response contains malformed variant SKUs.');
  }
  const variantSKUs = rawVariantSKUs as string[];
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

export function normalizeItem(raw: unknown, sku: string) {
  const row = record(raw);
  const rawSku = row.sku;
  if (rawSku !== undefined && (typeof rawSku !== 'string' || rawSku.trim() !== sku)) {
    throw new Error(`eBay inventory item identity mismatch for ${sku}.`);
  }
  const semanticSource = {
    ...row,
    // eBay may omit conditionDescriptors from GET responses when the persisted
    // descriptor list is empty. Normalize that transport omission to [] only
    // at the remote-read boundary; the later semantic comparison still fails
    // closed if the frozen publication intent expected any real descriptors.
    conditionDescriptors: row.conditionDescriptors ?? [],
    sku: typeof rawSku === 'string' && rawSku.trim() ? rawSku : sku,
  };
  const semantic = projectInventoryItemSemanticSnapshot(semanticSource);
  const aliases = ['groupIds', 'inventoryItemGroupKeys']
    .filter((key) => key in row)
    .map((key) => {
      if (!Array.isArray(row[key])) {
        throw new Error(`eBay inventory item ${sku} has a malformed ${key} alias.`);
      }
      const values = (row[key] as unknown[]).map((value) => {
        if (typeof value !== 'string' || value.trim() === '') {
          throw new Error(`eBay inventory item ${sku} has a malformed ${key} alias.`);
        }
        return value.trim();
      });
      if (new Set(values).size !== values.length) {
        throw new Error(`eBay inventory item ${sku} has duplicate ${key} aliases.`);
      }
      return values;
    });
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

/** Validate the documented 200 JSON body before treating a bulk mutation as
 * accepted. A combined SKU/item+offer request returns one result per target. */
export function assertBulkPriceQuantitySuccess(raw: unknown, sku: string, offerId: string, expectsInventoryItem: boolean): void {
  const body = record(raw);
  if (Object.prototype.hasOwnProperty.call(body, 'statusCode')) {
    throw new Error(`eBay bulk price/quantity response for ${sku} has an unsupported top-level status.`);
  }
  const responses = body.responses;
  const expectedResponseCount = expectsInventoryItem ? 2 : 1;
  if (!Array.isArray(responses) || responses.length !== expectedResponseCount) {
    throw new Error(`eBay bulk price/quantity response for ${sku} is missing its expected ${expectedResponseCount} result${expectedResponseCount === 1 ? '' : 's'}.`);
  }
  let offerResult = false;
  let inventoryResult = false;
  for (const rawResult of responses) {
    const result = record(rawResult);
    if (readString(result, 'sku') !== sku) {
      throw new Error(`eBay bulk price/quantity response identity does not match SKU ${sku}.`);
    }
    const hasOfferId = Object.prototype.hasOwnProperty.call(result, 'offerId');
    const resultOfferId = readString(result, 'offerId');
    if (hasOfferId) {
      if (!resultOfferId || offerResult || resultOfferId !== offerId) {
        throw new Error(`eBay bulk price/quantity response identity does not match ${sku}/${offerId}.`);
      }
      offerResult = true;
    } else {
      if (inventoryResult) throw new Error(`eBay bulk price/quantity response contains duplicate inventory result for ${sku}.`);
      inventoryResult = true;
    }
    if (result.statusCode !== 200) {
      throw new Error(`eBay bulk price/quantity update for ${sku} was not accepted (status ${String(result.statusCode)}).`);
    }
    if ('errors' in result && (!Array.isArray(result.errors) || result.errors.length > 0)) {
      throw new Error(`eBay bulk price/quantity update for ${sku} returned errors.`);
    }
  }
  if (!offerResult || (expectsInventoryItem && !inventoryResult) || (!expectsInventoryItem && inventoryResult)) {
    throw new Error(`eBay bulk price/quantity response for ${sku} does not cover the requested offer/item identity.`);
  }
}

let productionRemotePromise: ReturnType<NonNullable<VariationListingActionServiceOptions['remoteFactory']>> | undefined;

export async function assertVariationListingMerchantLocation(
  getInventoryLocation: (merchantLocationKey: string) => Promise<unknown>,
  merchantLocationKey: string
): Promise<void> {
  const location = await getInventoryLocation(merchantLocationKey);
  if (!validateVariationListingMerchantLocation(location, merchantLocationKey).valid) {
    throw new Error(`Variation listing merchant location ${merchantLocationKey} is not an exact enabled eBay inventory location with a usable shipping address.`);
  }
}

async function createProductionRemote() {
  productionRemotePromise ??= (async () => {
    const api = new EbaySellerApi(getEbayConfig());
    await api.initialize();
    const headers = { headers: { 'Content-Language': 'en-US' } };
    const remote: VariationListingPublicationRemoteGateway = {
      getInventoryItem: async (sku, options) => await remoteRead(
        async () => normalizeItem(await api.inventory.getInventoryItem(sku), sku),
        options
      ),
      getInventoryItemGroup: async (groupKey, options) => await remoteRead(
        async () => normalizeGroup(await api.inventory.getInventoryItemGroup(groupKey), groupKey),
        options
      ),
      getOffers: async (sku, marketplaceId, options) => {
        const read = await remoteRead(
          async () => normalizeOffers(await api.inventory.getOffers(sku, marketplaceId)),
          options
        );
        return read.state === 'proven_absent' ? { state: 'present', value: [] } : read;
      },
      getListing: async (listingId) => await api.trading.getListing(listingId),
      getMedia: async (location) => await remoteRead(async () => await api.media.getImage(location)),
    };
    return {
      remote,
      assertMerchantLocation: async (merchantLocationKey) =>
        await assertVariationListingMerchantLocation(
          async (key) => await api.inventory.getInventoryLocation(key),
          merchantLocationKey
        ),
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
        bulkUpdatePriceQuantity: async (payload) => {
          const request = record(payload);
          const requests = Array.isArray(request.requests) ? request.requests : [];
          if (requests.length !== 1) throw new Error('eBay bulk price/quantity update requires one request.');
          const row = record(requests[0]);
          const sku = readString(row, 'sku');
          const offers = Array.isArray(row.offers) ? row.offers : [];
          const offerId = offers.length === 1 ? readString(record(offers[0]), 'offerId') : '';
          if (!sku || !offerId) throw new Error('eBay bulk price/quantity update request lacks exact SKU/offer identity.');
          const raw = await api.inventory.bulkUpdatePriceQuantity(payload as Record<string, unknown>, headers);
          assertBulkPriceQuantitySuccess(raw, sku, offerId, Object.prototype.hasOwnProperty.call(row, 'shipToLocationAvailability'));
          return raw as Json;
        },
        updateOffer: async (offerId, payload) => { await api.inventory.updateOffer(offerId, payload as Record<string, unknown>); },
        withdrawInventoryItemGroup: async (groupKey, marketplaceId) => { await api.inventory.withdrawOfferByInventoryItemGroup({ inventoryItemGroupKey: groupKey, marketplaceId }, headers); },
        deleteOffer: async (offerId) => await api.inventory.deleteOffer(offerId, headers),
        deleteInventoryItemGroup: async (groupKey) => await api.inventory.deleteInventoryItemGroup(groupKey, headers),
        deleteInventoryItem: async (sku) => await api.inventory.deleteInventoryItem(sku, headers),
        getAllOffersForSku: async (sku) => await readRemovedSkuExhaustiveOffers(
          () => api.inventory.getAllOffersForSku(sku),
        ),
      },
    };
  })();
  return await productionRemotePromise;
}

type RemovedSkuActionDependencies = Awaited<ReturnType<NonNullable<VariationListingActionServiceOptions['remoteFactory']>>>;

function quantityFromInventoryPayload(payload: Json): number {
  const availability = record(payload).availability;
  const shipTo = record(availability).shipToLocationAvailability;
  const quantity = record(shipTo).quantity;
  if (!Number.isSafeInteger(quantity) || (quantity as number) < 0) throw new Error('eBay inventory item quantity is unavailable.');
  return quantity as number;
}

function quantityFromOfferPayload(payload: Json): number {
  const quantity = record(payload).availableQuantity;
  if (!Number.isSafeInteger(quantity) || (quantity as number) < 0) throw new Error('eBay Offer quantity is unavailable.');
  return quantity as number;
}

function inventoryPayloadWithoutQuantity(payload: Json): Json {
  const root = record(payload);
  const availability = record(root.availability);
  const shipTo = record(availability.shipToLocationAvailability);
  return { ...root, availability: { ...availability, shipToLocationAvailability: { ...shipTo, quantity: undefined } } } as Json;
}

function offerPayloadWithoutQuantity(payload: Json): Json {
  return { ...record(payload), availableQuantity: undefined } as Json;
}

function groupPayloadWithoutMembership(payload: Json): Json {
  const group = record(payload);
  // eBay may return an explicit empty group image collection even though the
  // publication contract omits group-level images. Treat that transport form
  // as semantic absence while preserving nonempty/malformed values so the
  // frozen replacement comparison remains fail-closed.
  const imageUrls = group.imageUrls;
  return {
    ...group,
    variantSKUs: undefined,
    imageUrls: Array.isArray(imageUrls) && imageUrls.length === 0 ? undefined : imageUrls,
  } as Json;
}

function removedSkuRemote(deps: RemovedSkuActionDependencies): RemovedSkuRetirementRemote {
  const allOffers = deps.mutations.getAllOffersForSku;
  if (!allOffers) throw new Error('Exhaustive all-marketplace Offer read is unavailable for removed-SKU retirement.');
  return {
    readItem: async (sku) => {
      const read = await deps.remote.getInventoryItem(sku, { expectedNotFound: true });
      if (read.state === 'proven_absent') return { state: 'absent' };
      if (read.state !== 'present') throw new Error(`eBay Inventory Item read is unknown: ${read.reason}`);
      return {
        state: 'present',
        sku: read.value.sku,
        groupKeys: read.value.groupKeys,
        quantity: quantityFromInventoryPayload(read.value.payload),
      };
    },
    readAllOffers: async (sku) => ({
      complete: true,
      offers: (await allOffers(sku)).map((offer) => ({
        offerId: offer.offerId,
        sku: offer.sku,
        marketplaceId: offer.marketplaceId,
        status: offer.status,
        listingId: offer.listingId,
        availableQuantity: offer.availableQuantity,
      })),
    }),
    verifySurvivors: async (plan) => {
      const group = await deps.remote.getInventoryItemGroup(plan.groupKey, { expectedNotFound: true });
      if (group.state !== 'present' || canonicalJson([...group.value.variantSKUs].sort()) !== canonicalJson([...plan.survivorSkus].sort()) || canonicalJson(groupPayloadWithoutMembership(group.value.payload)) !== canonicalJson(groupPayloadWithoutMembership(plan.replacementGroupPayload))) return false;
      for (const sku of plan.survivorSkus) {
        const item = await deps.remote.getInventoryItem(sku, { expectedNotFound: true });
        if (item.state !== 'present' || canonicalJson(item.value.groupKeys) !== canonicalJson([plan.groupKey]) || canonicalJson(inventoryPayloadWithoutQuantity(item.value.payload)) !== canonicalJson(plan.inventoryItemPayloadsBySku[sku]) || quantityFromInventoryPayload(item.value.payload) !== plan.quantitiesBySku[sku]?.inventoryItemQuantity) return false;
        // The marketplace-scoped read below is retained for the frozen full
        // offer payload and lifecycle comparison. First prove that the
        // complete unfiltered Offer collection contains exactly the one
        // frozen survivor Offer; otherwise a foreign marketplace Offer could
        // be hidden by the scoped read and target deletion could proceed.
        const exhaustiveOffers = await allOffers(sku);
        if (!Array.isArray(exhaustiveOffers) || exhaustiveOffers.length !== 1) return false;
        const exhaustiveOffer = exhaustiveOffers[0]!;
        if (exhaustiveOffer.sku !== sku || exhaustiveOffer.offerId !== plan.offerIdsBySku[sku] || exhaustiveOffer.marketplaceId !== plan.marketplaceId || exhaustiveOffer.status !== 'PUBLISHED' || exhaustiveOffer.listingId !== plan.listingId || exhaustiveOffer.availableQuantity !== plan.quantitiesBySku[sku]?.offerQuantity) return false;
        const offers = await deps.remote.getOffers(sku, plan.marketplaceId, { expectedNotFound: true });
        if (offers.state !== 'present' || offers.value.length !== 1) return false;
        const offer = offers.value[0]!;
        if (offer.offerId !== plan.offerIdsBySku[sku] || offer.status !== 'PUBLISHED' || offer.lifecycleClass !== 'active' || offer.listingId !== plan.listingId || quantityFromOfferPayload(offer.payload) !== plan.quantitiesBySku[sku]?.offerQuantity || canonicalJson(offerPayloadWithoutQuantity(offer.payload)) !== canonicalJson(plan.offerPayloadsBySku[sku])) return false;
      }
      return true;
    },
    deleteInventoryItem: async (sku) => await deps.mutations.deleteInventoryItem(sku),
  };
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
  if (snapshot.aggregate.variations.some((variation) =>
    (variation as typeof variation & { pending_removal_at?: unknown }).pending_removal_at != null
  )) {
    throw new Error('permanent_removal_not_implemented: staged variation removal cannot be hydrated for remote publication.');
  }
  return {
    snapshot,
    historicalPayload: true,
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
  revisionSnapshotAggregate(row);
  const snapshot = row.snapshot as unknown as VariationListingFrozenActiveRevision['snapshot'];
  if (snapshot.aggregate.variations.some((variation) =>
    (variation as typeof variation & { pending_removal_at?: unknown }).pending_removal_at != null
  )) {
    throw new Error('permanent_removal_not_implemented: staged variation removal cannot be hydrated for remote publication.');
  }
  const historicalConfirmedBundle = buildVariationListingHistoricalInventoryPayloadBundle({
    aggregate: snapshot.confirmed.aggregate,
    representativeImages: snapshot.confirmed.representativeImages,
  });
  return {
    snapshot,
    confirmedBundle: applyVariationListingConfirmedRemoteQuantities(
      historicalConfirmedBundle,
      snapshot.confirmed.remote.quantitiesBySku
    ),
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
  if (kinds.has('permanent_removal_group_membership')) {
    if (row.snapshot_version !== 3) throw new Error(`Unsupported variation listing permanent-removal snapshot version ${row.snapshot_version}.`);
    return 'permanent_removal';
  }
  const cleanup = [...kinds].some((kind) => kind.startsWith('cleanup_') || kind === 'withdrawal' || kind === 'final_absence_verification');
  if (cleanup) {
    if (row.snapshot_version !== 1) throw new Error(`Unsupported variation listing cleanup snapshot version ${row.snapshot_version}.`);
    return 'cleanup';
  }
  if (row.snapshot_version === 3) return 'active';
  if (row.snapshot_version === 1) return 'initial';
  throw new Error(`Unsupported variation listing revision snapshot version ${row.snapshot_version}.`);
}

function snapshotAggregate(row: VariationListingRevisionRow): VariationListingAggregateSnapshot {
  if (row.snapshot_version === 1 || row.snapshot_version === 3) return revisionSnapshotAggregate(row);
  const root = row.snapshot as unknown as { aggregate?: VariationListingAggregateSnapshot };
  if (!root.aggregate) throw new Error('Frozen variation listing revision lacks aggregate snapshot.');
  return root.aggregate;
}

function durableOfferIds(
  revision: VariationListingRevisionRow,
  history: readonly VariationListingPublishingCheckpointRow[]
): Record<string, string> {
  const ids: Record<string, string> = {};
  const plan = operationPlan(revision);
  const allowedOperationKeys = new Set(plan.map((operation) => operation.operationKey));
  if (history.some((checkpoint) => checkpoint.revision_id !== revision.revision_id || !allowedOperationKeys.has(checkpoint.operation_key))) {
    throw new Error('Frozen variation listing offer history contains a checkpoint outside its captured revision plan.');
  }
  const inspections = new Map<string, ReturnType<typeof inspectVariationListingJournal>>();
  for (const operation of plan) {
    const operationHistory = history.filter((checkpoint) => checkpoint.operation_key === operation.operationKey);
    if (operationHistory.length === 0) continue;
    inspections.set(operation.operationKey, inspectVariationListingJournal({
      intent: operation.intent,
      intent_digest: operation.intentDigest,
      intent_version: operation.intentVersion,
      operation_key: operation.operationKey,
      operation_kind: operation.operationKind,
      sequence_no: operation.sequenceNo,
      target_ref: operation.targetRef,
    }, operationHistory));
  }
  for (const operation of plan.filter((candidate) => candidate.operationKind === 'child_offer_write')) {
    const operationHistory = history.filter((checkpoint) => checkpoint.operation_key === operation.operationKey);
    // An offer operation with no checkpoint never started and therefore owns
    // no durable remote identity. Keep the empty case distinct from a
    // partially written journal: any non-empty history must satisfy the
    // shared journal grammar before cleanup can infer ownership.
    if (operationHistory.length === 0) continue;
    const inspection = inspections.get(operation.operationKey)!;
    const latest = inspection.latestCheckpoint;
    if (!latest || !['confirmed_complete', 'confirmed_no_op'].includes(latest.state)) {
      throw new Error(`Frozen variation listing offer operation ${operation.operationKey} lacks a terminal durable checkpoint.`);
    }
    const evidence = record(latest.evidence);
    const offerId = readString(evidence, 'offerId');
    const sku = readString(evidence, 'sku');
    if (!sku || sku !== operation.targetRef) {
      throw new Error(`Frozen variation listing offer operation ${operation.operationKey} identity evidence is missing or mismatched.`);
    }
    if (latest.state === 'confirmed_complete' && (latest.observed_remote_state !== 'present' || !offerId)) {
      throw new Error(`Frozen variation listing offer operation ${operation.operationKey} confirmed completion lacks exact offer identity evidence.`);
    }
    if (latest.state === 'confirmed_no_op' && latest.observed_remote_state === 'present' && !offerId) {
      throw new Error(`Frozen variation listing offer operation ${operation.operationKey} no-op present evidence lacks exact offer identity.`);
    }
    if (latest.observed_remote_state === 'proven_absent' && offerId) {
      throw new Error(`Frozen variation listing offer operation ${operation.operationKey} absent evidence cannot carry an offer identity.`);
    }
    if (offerId) ids[sku] = offerId;
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

function latestUnresolvedOperation(
  checkpoints: readonly VariationListingPublishingCheckpointRow[],
  operationOrder?: readonly { operationKey: string; sequenceNo: number }[],
) {
  const latest = new Map<string, VariationListingPublishingCheckpointRow>();
  for (const row of checkpoints) {
    const prior = latest.get(row.operation_key);
    if (!prior || row.attempt_number > prior.attempt_number || (row.attempt_number === prior.attempt_number && row.checkpoint_number > prior.checkpoint_number)) latest.set(row.operation_key, row);
  }
  const unresolved = [...latest.values()].filter((row) => ['started', 'unknown', 'retry_authorized', 'retry_exhausted'].includes(row.state));
  if (!operationOrder) return unresolved[0];
  const sequenceByKey = new Map(operationOrder.map((operation) => [operation.operationKey, operation.sequenceNo]));
  return unresolved.sort((left, right) =>
    (sequenceByKey.get(left.operation_key) ?? Number.MAX_SAFE_INTEGER) -
    (sequenceByKey.get(right.operation_key) ?? Number.MAX_SAFE_INTEGER)
  )[0];
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
    remoteState: exhausted
      ? operation.observed_remote_state === 'unknown'
        ? 'unknown'
        : operation.observed_remote_state === 'present' ? 'known_changed' : 'known_unchanged'
      : 'unknown',
    requiresReconciliation: exhausted ? operation.observed_remote_state === 'unknown' : true,
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

function permanentRemovalEligibilityError(groupId: string, summary: string): VariationListingActionError {
  return new VariationListingActionError(409, {
    action: 'publish_changes',
    affected: { groupId },
    category: 'state',
    code: 'permanent_removal_ineligible',
    issues: [],
    recommendedActions: ['refresh_group', 'review_confirmed_quantities'],
    remoteState: 'known_unchanged',
    requiresReconciliation: false,
    retryStatus: 'not_applicable',
    severity: 'error',
    stage: 'permanent_removal_preflight',
    summary,
    userActionRequired: true,
  });
}

function assertNoPendingPermanentRemoval(
  action: VariationListingActionName,
  groupId: string,
  aggregate: VariationListingAggregateSnapshot,
): void {
  const pending = aggregate.variations.find((variation) => {
    const marker = (variation as typeof variation & { pending_removal_at?: unknown }).pending_removal_at;
    return marker !== undefined && marker !== null;
  });
  if (pending) {
    throw validationError(
      action,
      groupId,
      'permanent_removal_not_implemented',
      'A variation is staged for permanent removal; this action is disabled until safe remote removal is implemented.',
      ['refresh_group'],
      { variationId: pending.variation_id, sku: pending.sku },
    );
  }
}

function activeRevisionReprepareError(action: VariationListingActionName, groupId: string, summary: string) {
  return new VariationListingActionError(409, {
    action,
    affected: { groupId },
    category: 'state',
    code: 'active_revision_reprepare_required',
    issues: [],
    recommendedActions: ['refresh_group', 'stage_new_change'],
    remoteState: 'known_changed',
    requiresReconciliation: false,
    retryStatus: 'not_applicable',
    severity: 'error',
    stage: 'preflight',
    summary,
    userActionRequired: true,
  });
}

function quantityAdjustmentEligibilityError(
  groupId: string,
  variationId: string,
  code: string,
  summary: string,
): VariationListingActionError {
  return new VariationListingActionError(409, {
    action: 'reconcile',
    affected: { groupId, variationId },
    category: 'state',
    code,
    issues: [],
    recommendedActions: ['refresh_group', 'select_confirmed_variation'],
    remoteState: 'known_unchanged',
    requiresReconciliation: false,
    retryStatus: 'not_applicable',
    severity: 'error',
    stage: 'quantity_adjustment',
    summary,
    userActionRequired: true,
  });
}

export async function assertVariationListingQuantityAdjustmentEligible(
  options: {
    data: Pick<VariationListingActionDataAccess, 'loadAggregate' | 'listRevisionsByGroupId'>;
  },
  input: { groupId: string; variationId: string; expectedDesiredRevision: number },
): Promise<void> {
  const aggregate = await options.data.loadAggregate(input.groupId);
  if (!aggregate) throw new Error(`Variation listing group ${input.groupId} was not found.`);
  if (aggregate.group.desired_revision !== input.expectedDesiredRevision) {
    throw new VariationListingTransactionConflictError(
      'variation_listing_state_stale',
      'Variation listing desired revision changed; refresh the group before staging a quantity adjustment.',
    );
  }
  if (aggregate.group.lifecycle_state !== 'active' || aggregate.group.last_confirmed_revision === null) {
    throw quantityAdjustmentEligibilityError(
      input.groupId,
      input.variationId,
      'quantity_adjustment_requires_confirmed_active_group',
      'Quantity adjustment is available only for a confirmed active variation listing.',
    );
  }

  const revisions = (await options.data.listRevisionsByGroupId(input.groupId)).map((revision) => revision.source);
  const confirmedRevision = revisions.find(
    (revision) => revision.captured_desired_revision === aggregate.group.last_confirmed_revision,
  );
  if (!confirmedRevision) {
    throw new Error(`Variation listing confirmed revision ${aggregate.group.last_confirmed_revision} was not found.`);
  }
  const confirmedAggregate = revisionSnapshotAggregate(confirmedRevision);
  const currentVariation = aggregate.variations.find((variation) => variation.variation_id === input.variationId);
  const confirmedVariation = confirmedAggregate.variations.find((variation) => variation.variation_id === input.variationId);
  if (!currentVariation || !confirmedVariation || currentVariation.sku !== confirmedVariation.sku) {
    throw quantityAdjustmentEligibilityError(
      input.groupId,
      input.variationId,
      'quantity_adjustment_requires_confirmed_variation',
      'Quantity adjustment is available only for variations already confirmed by eBay.',
    );
  }
}

export async function readVariationListingQuantityStatus(
  options: {
    data: Pick<VariationListingActionDataAccess, 'loadAggregate' | 'listRevisionsByGroupId' | 'listCheckpointsByRevisionId'>;
    remoteFactory?: VariationListingActionServiceOptions['remoteFactory'];
    /** For private eligibility checks only. Public quantity-status JSON stays unchanged. */
    includeComponentQuantities?: boolean;
  },
  groupId: string
): Promise<VariationListingQuantityStatus> {
  const aggregate = await options.data.loadAggregate(groupId);
  if (!aggregate) throw new Error(`Variation listing group ${groupId} was not found.`);
  if (aggregate.group.lifecycle_state !== 'active' || aggregate.group.last_confirmed_revision === null) {
    throw new VariationListingActionError(409, {
      action: 'reconcile',
      affected: { groupId },
      category: 'state',
      code: 'quantity_adjustment_requires_confirmed_active_group',
      issues: [],
      recommendedActions: ['publish_or_select_active_group'],
      remoteState: 'known_unchanged',
      requiresReconciliation: false,
      retryStatus: 'not_applicable',
      severity: 'error',
      stage: 'quantity_status',
      summary: 'Quantity adjustment is available only for a confirmed active variation listing.',
      userActionRequired: true,
    });
  }

  const revisions = (await options.data.listRevisionsByGroupId(groupId)).map((revision) => revision.source);
  const confirmedRevision = revisions.find(
    (revision) => revision.captured_desired_revision === aggregate.group.last_confirmed_revision
  );
  if (!confirmedRevision) {
    throw new Error(`Variation listing confirmed revision ${aggregate.group.last_confirmed_revision} was not found.`);
  }
  const checkpoints = (await options.data.listCheckpointsByRevisionId(confirmedRevision.revision_id))
    .map((checkpoint) => checkpoint.source);
  const confirmedAggregate = revisionSnapshotAggregate(confirmedRevision);
  const representativeImages = reconstructVariationListingConfirmedRepresentativeImages({
    revision: confirmedRevision,
    checkpoints,
  });
  const confirmedBundle = buildVariationListingHistoricalInventoryPayloadBundle({
    aggregate: confirmedAggregate,
    representativeImages,
  });
  const durableRemoteIdentity = reconstructConfirmedRemoteIdentity(confirmedRevision, checkpoints);
  const dependencies = await (options.remoteFactory ?? createProductionRemote)();
  const observed = await reconcilePublishedQuantityBaseline(
    dependencies!.remote,
    confirmedBundle,
    durableRemoteIdentity
  );

  // A publication can confirm a new revision without advancing desired_revision.
  // Re-read the local watermark after the remote reads so a response never
  // combines a fresh eBay baseline with an older confirmed counter.
  const refreshedAggregate = await options.data.loadAggregate(groupId);
  if (
    !refreshedAggregate ||
    refreshedAggregate.group.group_id !== aggregate.group.group_id ||
    refreshedAggregate.group.desired_revision !== aggregate.group.desired_revision ||
    refreshedAggregate.group.last_confirmed_revision !== aggregate.group.last_confirmed_revision ||
    refreshedAggregate.group.lifecycle_state !== aggregate.group.lifecycle_state
  ) {
    throw new VariationListingTransactionConflictError(
      'variation_listing_state_stale',
      'Variation listing quantity status changed while eBay quantities were being read; refresh the group and retry.',
    );
  }

  const currentById = new Map(aggregate.variations.map((variation) => [variation.variation_id, variation]));
  const variations: VariationListingQuantityStatusVariation[] = [];
  for (const confirmedVariation of [...confirmedAggregate.variations].sort((a, b) => a.position - b.position)) {
    const currentVariation = currentById.get(confirmedVariation.variation_id);
    if (!currentVariation) {
      throw new Error(`Variation listing confirmed variation ${confirmedVariation.variation_id} is missing from the current aggregate.`);
    }
    if (currentVariation.sku !== confirmedVariation.sku) {
      throw new Error(`Variation listing confirmed variation ${confirmedVariation.variation_id} SKU identity changed.`);
    }
    const currentCounter = currentVariation.quantity_adjustment_counter;
    const confirmedCounter = confirmedVariation.quantity_adjustment_counter;
    if (
      !Number.isInteger(currentCounter) ||
      !Number.isInteger(confirmedCounter) ||
      currentCounter < -2_147_483_648 ||
      currentCounter > 2_147_483_647 ||
      confirmedCounter < -2_147_483_648 ||
      confirmedCounter > 2_147_483_647
    ) {
      throw new Error(`Variation listing quantity adjustment counter for ${currentVariation.sku} is invalid.`);
    }
    const pendingAdjustment = currentCounter - confirmedCounter;
    if (!Number.isSafeInteger(pendingAdjustment)) {
      throw new Error(`Variation listing pending quantity adjustment for ${currentVariation.sku} is invalid.`);
    }
    const remoteQuantity = observed.quantitiesBySku[currentVariation.sku]?.sellableQuantity;
    if (
      typeof remoteQuantity !== 'number' ||
      !Number.isSafeInteger(remoteQuantity) ||
      remoteQuantity < 0 ||
      remoteQuantity > 2_147_483_647
    ) {
      throw new Error(`Variation listing eBay quantity for ${currentVariation.sku} is unavailable.`);
    }
    const afterPublish = remoteQuantity + pendingAdjustment;
    if (!Number.isSafeInteger(afterPublish) || afterPublish > 2_147_483_647) {
      throw new Error(`Variation listing projected quantity for ${currentVariation.sku} is invalid.`);
    }
    const exactQuantities = observed.quantitiesBySku[currentVariation.sku];
    variations.push({
      variationId: currentVariation.variation_id,
      sku: currentVariation.sku,
      ebayQuantity: remoteQuantity,
      pendingAdjustment,
      afterPublish,
      soldOutRemovalEligible:
        aggregate.group.desired_revision === aggregate.group.last_confirmed_revision &&
        aggregate.variations.length >= 3 &&
        aggregate.variations.every((row) => row.pending_removal_at === null) &&
        exactQuantities?.inventoryItemQuantity === 0 &&
        exactQuantities?.offerQuantity === 0 &&
        pendingAdjustment === 0 && afterPublish === 0,
      ...(options.includeComponentQuantities
        ? { inventoryItemQuantity: exactQuantities?.inventoryItemQuantity, offerQuantity: exactQuantities?.offerQuantity }
        : {}),
    });
  }

  return {
    groupId,
    desiredRevision: aggregate.group.desired_revision,
    lastConfirmedRevision: aggregate.group.last_confirmed_revision,
    variations,
  };
}

/**
 * Read-only YP9.6c2 stage preflight: remove is permitted ONLY when both eBay
 * quantity sources are already zero. Staging itself does not write to eBay.
 * The later Publish Changes executor must independently repeat this check.
 */
export async function assertVariationListingSoldOutRemovalEligible(
  options: {
    data: Pick<VariationListingActionDataAccess, 'loadAggregate' | 'listRevisionsByGroupId' | 'listCheckpointsByRevisionId'>;
    remoteFactory?: VariationListingActionServiceOptions['remoteFactory'];
  },
  input: { groupId: string; variationId: string; expectedDesiredRevision: number },
): Promise<void> {
  const aggregate = await options.data.loadAggregate(input.groupId);
  if (!aggregate || aggregate.group.desired_revision !== input.expectedDesiredRevision) {
    throw new VariationListingTransactionConflictError(
      'variation_listing_state_stale',
      'Variation listing changed; refresh before staging sold-out removal.',
    );
  }
  if (
    aggregate.group.lifecycle_state !== 'active' ||
    aggregate.group.last_confirmed_revision === null ||
    aggregate.group.desired_revision !== aggregate.group.last_confirmed_revision ||
    aggregate.variations.length < 3
  ) {
    throw permanentRemovalEligibilityError(input.groupId, 'Sold-out removal requires a confirmed active group with at least two survivors and no pending changes.');
  }
  const target = aggregate.variations.find((variation) => variation.variation_id === input.variationId);
  if (!target || target.group_id !== input.groupId || target.pending_removal_at != null) {
    throw permanentRemovalEligibilityError(input.groupId, 'Sold-out removal requires exactly one confirmed, unstaged target variation.');
  }
  let status: VariationListingQuantityStatus;
  try {
    status = await readVariationListingQuantityStatus({
      ...options,
      includeComponentQuantities: true,
    }, input.groupId);
  } catch (error) {
    if (error instanceof VariationListingTransactionConflictError) throw error;
    if (error instanceof VariationListingActionError && error.status.code === 'quantity_adjustment_requires_confirmed_active_group') {
      throw error;
    }
    throw permanentRemovalEligibilityError(input.groupId, 'Sold-out removal requires an unambiguous current eBay Item and Offer quantity read. Refresh and retry after remote state is available.');
  }
  if (
    status.desiredRevision !== input.expectedDesiredRevision ||
    status.lastConfirmedRevision !== aggregate.group.last_confirmed_revision
  ) {
    throw new VariationListingTransactionConflictError(
      'variation_listing_state_stale',
      'Variation listing changed during sold-out quantity verification.',
    );
  }
  const rows = status.variations.filter((row) => row.variationId === input.variationId && row.sku === target.sku);
  if (
    rows.length !== 1 ||
    rows[0]!.inventoryItemQuantity !== 0 ||
    rows[0]!.offerQuantity !== 0 ||
    rows[0]!.pendingAdjustment !== 0 ||
    rows[0]!.afterPublish !== 0
  ) {
    throw permanentRemovalEligibilityError(input.groupId, 'Sold-out removal is allowed only for a confirmed SKU whose Inventory Item and Offer are both already at quantity zero, with no pending replenishment.');
  }
}

export function createVariationListingActionService(options: VariationListingActionServiceOptions) {
  const ids = options.createId ?? randomUUID;
  const publicBaseUrl = () => options.publicImageBaseUrl ?? loadR2ImageStorageConfig().publicBaseUrl;
  const dependencies = options.remoteFactory ?? createProductionRemote;
  const assertPublicationMutationEnabled = (action: 'publish' | 'publish_changes' | 'retry' | 'reconcile', groupId: string): void => {
    // Dependency-injected remotes are explicit test/harness boundaries. The
    // default gateway is the real configured eBay environment and must honor
    // the same authorized publish-window guard as Standard publishing.
    if (options.remoteFactory !== undefined) return;
    if (process.env.EBAY_PUBLISH_ENABLED === 'true') return;
    throw validationError(
      action,
      groupId,
      'publish_disabled',
      'eBay publishing is disabled. Set EBAY_PUBLISH_ENABLED=true only for an authorized publish window.',
      ['enable_publish_window'],
    );
  };
  const resolveDependencies = async () => {
    const resolved = await dependencies();
    if (!resolved) throw new Error('Variation listing remote dependencies were not created.');
    return resolved;
  };
  const transaction = {
    loadAggregate: options.data.loadAggregate,
    captureRevision: options.data.captureRevision,
    capturePermanentRemovalRevision: options.data.capturePermanentRemovalRevision,
    appendJournalCheckpoint: options.data.appendJournalCheckpoint,
    confirmRevision: options.data.confirmRevision,
    confirmPermanentRemoval: options.data.confirmPermanentRemoval,
    advanceCleanupLifecycle: options.data.advanceCleanupLifecycle,
    abandonUntouchedGroup: options.data.abandonUntouchedGroup,
  };

  const rows = async (groupId: string) => (await options.data.listRevisionsByGroupId(groupId)).map((revision) => revision.source);
  const checkpoints = async (revisionId: string) => (await options.data.listCheckpointsByRevisionId(revisionId)).map((checkpoint) => checkpoint.source);
  const newestFirst = (revisions: VariationListingRevisionRow[]) =>
    [...revisions].sort((left, right) => right.captured_desired_revision - left.captured_desired_revision);
  const unresolvedRevision = async (revisions: VariationListingRevisionRow[]) => {
    for (const revision of newestFirst(revisions)) {
      const unresolved = latestUnresolvedOperation(await checkpoints(revision.revision_id), operationPlan(revision));
      if (unresolved) return { operation: unresolved, revision };
    }
    return null;
  };
  const assertTerminalUnpublishedCleanup = async (
    action: VariationListingActionName,
    groupId: string,
    revision: VariationListingRevisionRow,
    expectedIdentity: { groupKey: string; marketplaceId: string; skuCategoryCode: string; skuBucketToken: string },
  ): Promise<void> => {
    if (revisionKind(revision) !== 'cleanup') {
      throw validationError(action, groupId, 'unpublished_cleanup_missing', 'A durable unpublished cleanup revision is required before this action can continue.', ['cleanup_failed_initial_publication']);
    }
    const snapshot = record(revision.snapshot);
    if (snapshot.terminalLifecycle !== 'abandoned') {
      throw validationError(action, groupId, 'unpublished_cleanup_invalid', 'Only an unpublished cleanup revision may be reused for this action.', ['cleanup_failed_initial_publication']);
    }
    const plan = operationPlan(revision);
    const invalid = (message: string): never => {
      throw validationError(action, groupId, 'unpublished_cleanup_invalid', message, ['cleanup_failed_initial_publication']);
    };
    const final = plan.at(-1);
    const ownedRemote = record(snapshot.ownedRemote);
    const observed = record(snapshot.observed);
    const orderedSkus = Array.isArray(snapshot.orderedSkus) && snapshot.orderedSkus.every((sku) => typeof sku === 'string' && sku.trim() === sku && sku !== '')
      ? snapshot.orderedSkus as string[]
      : null;
    const rawOfferIdsBySku = ownedRemote.offerIdsBySku;
    const offerIdsBySku = record(ownedRemote.offerIdsBySku);
    if (snapshot.planVersion !== 1 || snapshot.groupKey !== expectedIdentity.groupKey || snapshot.marketplaceId !== expectedIdentity.marketplaceId ||
      !orderedSkus || new Set(orderedSkus).size !== orderedSkus.length || orderedSkus.some((sku) => {
        const prefix = `${expectedIdentity.skuCategoryCode}-${expectedIdentity.skuBucketToken}-`;
        const suffix = sku.slice(prefix.length);
        return !sku.startsWith(prefix) || !/^\d{6}$/.test(suffix) || suffix === '000000';
      }) || snapshot.terminalLifecycle !== 'abandoned' || ownedRemote.publicationHistoryExists !== false || ownedRemote.listingId !== null ||
      !snapshot.ownedRemote || Array.isArray(snapshot.ownedRemote) || rawOfferIdsBySku === null || typeof rawOfferIdsBySku !== 'object' || Array.isArray(rawOfferIdsBySku) || Object.keys(offerIdsBySku).some((sku) => !orderedSkus.includes(sku) || typeof offerIdsBySku[sku] !== 'string' || String(offerIdsBySku[sku]).trim() === '') ||
      !snapshot.observed || Array.isArray(snapshot.observed) || observed.activeListingId !== null ||
      typeof observed.groupPresent !== 'boolean' || !Array.isArray(observed.itemPresentSkus) || !Array.isArray(observed.offerPresentSkus) ||
      !['absent', 'inactive-or-unpublished'].includes(String(observed.state))) {
      invalid('The durable cleanup revision snapshot is incompatible with unpublished cleanup reuse.');
    }
    if (!final || final.operationKind !== 'final_absence_verification' || revision.operation_count !== plan.length || plan.length < 1 ||
      plan.some((operation) => operation.operationKind === 'withdrawal')) {
      invalid('The durable cleanup revision has invalid lifecycle operations.');
    }
    const groupKey = expectedIdentity.groupKey;
    const validatedOrderedSkus = orderedSkus ?? [];
    if (new Set(plan.map((operation) => operation.operationKey)).size !== plan.length ||
      plan.some((operation, index) => operation.sequenceNo !== index + 1)) {
      invalid('The durable cleanup revision operation identities are invalid.');
    }
    let seenGroup = false;
    let seenItem = false;
    for (const operation of plan) {
      const intent = record(operation.intent);
      const digest = createHash('sha256').update(canonicalJson(operation.intent)).digest('hex');
      if (digest !== operation.intentDigest) {
        invalid('The durable cleanup revision intent digest does not match its operation intent.');
      }
      const intentGroupKey = typeof intent.groupKey === 'string' ? intent.groupKey : null;
      const intentSku = typeof intent.sku === 'string' ? intent.sku : null;
      const intentOfferId = typeof intent.offerId === 'string' ? intent.offerId : null;
      const intentKeys = Object.keys(intent);
      const identityMatches =
        operation.operationKind === 'cleanup_offer'
          ? intentKeys.length === 2 && intentKeys.includes('offerId') && intentKeys.includes('sku') &&
            operation.operationKey === `cleanup-offer:${intentSku}` && operation.targetRef === intentOfferId &&
            Boolean(intentSku) && validatedOrderedSkus.includes(intentSku!) && offerIdsBySku[intentSku!] === intentOfferId && !seenGroup && !seenItem
          : operation.operationKind === 'cleanup_group'
            ? intentKeys.length === 1 && intentKeys[0] === 'groupKey' && operation.operationKey === 'cleanup-group' && operation.targetRef === groupKey && intentGroupKey === groupKey && !seenItem
            : operation.operationKind === 'cleanup_child_inventory_item'
              ? intentKeys.length === 1 && intentKeys[0] === 'sku' && operation.operationKey === `cleanup-item:${intentSku}` && operation.targetRef === intentSku && Boolean(intentSku) && validatedOrderedSkus.includes(intentSku!)
              : operation.operationKind === 'final_absence_verification'
                ? intentKeys.length === 5 && ['groupKey', 'marketplaceId', 'offerIdsBySku', 'orderedSkus', 'terminalLifecycle'].every((key) => intentKeys.includes(key)) &&
                  operation.operationKey === 'final-absence' && operation.targetRef === groupKey && intentGroupKey === groupKey &&
                  intent.marketplaceId === expectedIdentity.marketplaceId && canonicalJson(intent.offerIdsBySku) === canonicalJson(offerIdsBySku) &&
                  canonicalJson(intent.orderedSkus) === canonicalJson(validatedOrderedSkus) && intent.terminalLifecycle === 'abandoned'
                : false;
      if (!identityMatches) {
        invalid('The durable cleanup revision operation intent does not match its target identity.');
      }
      if (operation.operationKind === 'cleanup_group') seenGroup = true;
      if (operation.operationKind === 'cleanup_child_inventory_item') seenItem = true;
    }
    const history = await checkpoints(revision.revision_id);
    for (const operation of plan) {
      const operationHistory = history.filter((checkpoint) => checkpoint.operation_key === operation.operationKey);
      try {
        inspectVariationListingJournal({
          intent: operation.intent,
          intent_digest: operation.intentDigest,
          intent_version: operation.intentVersion,
          operation_key: operation.operationKey,
          operation_kind: operation.operationKind,
          sequence_no: operation.sequenceNo,
          target_ref: operation.targetRef,
        }, operationHistory);
      } catch (error) {
        invalid(error instanceof Error ? error.message : 'The durable cleanup revision journal history is invalid.');
      }
      const latest = [...operationHistory]
        .sort((left, right) => left.attempt_number - right.attempt_number || left.checkpoint_number - right.checkpoint_number)
        .at(-1);
      if (!latest || !['confirmed_complete', 'confirmed_no_op'].includes(latest.state)) {
        throw unresolvedError(action, groupId, revision, latest ?? {
          checkpoint_id: '', revision_id: revision.revision_id, operation_key: operation.operationKey,
          attempt_number: 1, checkpoint_number: 1, state: 'started', observed_remote_state: null, evidence: {}, created_at: revision.captured_at,
        });
      }
      if (latest.observed_remote_state !== 'proven_absent') {
        if (operation.operationKind === 'final_absence_verification') {
          throw validationError(action, groupId, 'unpublished_cleanup_absence_unproven', 'This action requires durable proof that the unpublished remote state is absent.', ['cleanup_failed_initial_publication']);
        }
        throw validationError(action, groupId, 'unpublished_cleanup_invalid', 'The durable cleanup revision lacks exact terminal evidence for every operation.', ['cleanup_failed_initial_publication']);
      }
      if (latest.evidence === null || typeof latest.evidence !== 'object' || Array.isArray(latest.evidence) || Object.keys(latest.evidence).length === 0) {
        throw validationError(action, groupId, 'unpublished_cleanup_invalid', 'The durable cleanup revision lacks exact terminal evidence for every operation.', ['cleanup_failed_initial_publication']);
      }
      const terminalIntent = record(operation.intent);
      const terminalOfferId = readString(terminalIntent, 'offerId');
      const terminalSku = readString(terminalIntent, 'sku');
      const expectedEvidence = operation.operationKind === 'cleanup_offer'
        ? { offerId: terminalOfferId, state: 'proven_absent' }
        : operation.operationKind === 'cleanup_group'
          ? { groupKey, state: 'proven_absent' }
          : operation.operationKind === 'cleanup_child_inventory_item'
            ? { sku: terminalSku, state: 'proven_absent' }
            : { groupKey, offersBySku: offerIdsBySku, skus: validatedOrderedSkus, state: 'proven_absent' };
      if (canonicalJson(latest.evidence) !== canonicalJson(expectedEvidence)) {
        throw validationError(action, groupId, 'unpublished_cleanup_invalid', 'The durable cleanup revision terminal evidence does not match the exact executor proof.', ['cleanup_failed_initial_publication']);
      }
      if (latest.state === 'confirmed_no_op' && operationHistory.some((checkpoint) => checkpoint.state === 'unknown' || checkpoint.observed_remote_state === 'unknown')) {
        throw validationError(action, groupId, 'unpublished_cleanup_invalid', 'A cleanup operation reconciled to no effect after an unknown outcome and cannot be reused safely.', ['cleanup_failed_initial_publication']);
      }
    }
  };
  const assertNoOlderUnresolved = async (
    action: VariationListingActionName,
    groupId: string,
    revisions: VariationListingRevisionRow[],
    desiredRevision: number,
  ): Promise<void> => {
    for (const revision of newestFirst(revisions)) {
      if (revision.captured_desired_revision >= desiredRevision) continue;
      const unresolved = latestUnresolvedOperation(await checkpoints(revision.revision_id), operationPlan(revision));
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
    if (error instanceof Error && error.message.startsWith('active_revision_reprepare_required:')) {
      return activeRevisionReprepareError(
        action,
        groupId,
        error.message.slice('active_revision_reprepare_required:'.length).trim()
      );
    }
    const revisions = await rows(groupId).catch(() => [] as VariationListingRevisionRow[]);
    const revision = [...revisions].sort((left, right) => right.captured_desired_revision - left.captured_desired_revision)[0];
    const history = revision ? await checkpoints(revision.revision_id).catch(() => [] as VariationListingPublishingCheckpointRow[]) : [];
    const unresolved = latestUnresolvedOperation(history, revision ? operationPlan(revision) : undefined);
    const unknown = unresolved?.state === 'unknown' || unresolved?.observed_remote_state === 'unknown' || unresolved?.state === 'started';
    const exhausted = unresolved?.state === 'retry_exhausted';
    const issues = eBayIssues(error);
    // Preflight is read-only. A generic validation/journal failure before any
    // operation is unresolved cannot represent an ambiguous eBay mutation and
    // must not lock every action behind reconciliation.
    const noMutationAmbiguity = stage === 'preflight' && !unresolved && issues.length === 0;
    const knownUnchanged = issues.length > 0 || noMutationAmbiguity;
    const reconciliationRequired = !knownUnchanged || unknown;
    return new VariationListingActionError(noMutationAmbiguity || reconciliationRequired ? 409 : 502, {
      action,
      affected: { groupId },
      category: exhausted ? 'terminal' : reconciliationRequired ? 'reconciliation' : noMutationAmbiguity ? 'state' : 'remote',
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
      retryStatus: exhausted ? 'retry_exhausted' : reconciliationRequired ? 'reconciliation_required' : noMutationAmbiguity ? 'not_applicable' : 'safe_to_retry',
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

  const executeInitial = async (
    aggregate: VariationListingAggregateSnapshot,
    existing?: VariationListingRevisionRow,
    inheritedRepresentativeImages?: ReturnType<typeof reconstructVariationListingConfirmedRepresentativeImages>,
    reconcileOnly = false
  ) => {
    const deps = await resolveDependencies();
    const frozen = existing
      ? hydrateInitial(existing)
      : inheritedRepresentativeImages
        ? buildVariationListingFrozenPublicationRevision({
            aggregate,
            representativeImages: inheritedRepresentativeImages,
            revisionId: ids(),
          })
        : buildVariationListingFrozenPublicationRevision({
            aggregate,
            mediaResources: mediaResourcesForAggregate(aggregate, publicBaseUrl()),
            revisionId: ids(),
          });
    if (!reconcileOnly && deps.assertMerchantLocation) {
      await deps.assertMerchantLocation(frozen.snapshot.aggregate.group.merchant_location_key);
    }
    return await executeVariationListingPublication({
      frozen,
      journal: journalFor(existing),
      mutations: deps.mutations,
      remote: deps.remote,
      reconcileOnly,
      transaction,
    });
  };

  const executePermanentRemoval = async (
    aggregate: VariationListingAggregateSnapshot,
    targetVariationId: string,
    existing: VariationListingRevisionRow | undefined,
    progress: (stage: string, status?: unknown) => void,
    finalizeLocal = true,
  ) => {
    const deps = await resolveDependencies();
    const remote: VariationListingPermanentRemovalRemote = {
      ...deps.remote,
      replaceInventoryItemGroup: deps.mutations.createOrReplaceInventoryItemGroup,
      getAllOffersForSku: async (sku) => {
        if (!deps.mutations.getAllOffersForSku) {
          throw new Error('Exhaustive all-marketplace Offer read is unavailable for permanent removal.');
        }
        return await deps.mutations.getAllOffersForSku(sku);
      },
    };
    let plan;
    if (existing) {
      plan = hydrateVariationListingPermanentRemovalPlan(existing);
    } else {
      const revisions = await rows(aggregate.group.group_id);
      const previous = revisions.find((revision) =>
        revision.captured_desired_revision === aggregate.group.last_confirmed_revision &&
        revisionKind(revision) !== 'cleanup'
      );
      if (!previous || aggregate.group.last_confirmed_revision === null) {
        throw validationError('publish_changes', aggregate.group.group_id, 'confirmed_revision_missing', 'The last confirmed publication revision is missing.', ['inspect_group_history']);
      }
      plan = await buildVariationListingPermanentRemovalPlan({
        aggregate,
        previousConfirmedRevision: aggregate.group.last_confirmed_revision,
        previousRevisionId: previous.revision_id,
        previousRevision: previous,
        previousCheckpoints: await checkpoints(previous.revision_id),
        remote,
        revisionId: ids(),
        targetVariationId,
      });
    }
    progress(existing ? 'reconcile_existing_removal_revision' : 'execute_permanent_removal');
    const priorHistory = await checkpoints(plan.captureInput.revisionId);
    const latestMembershipCheckpoint = [...priorHistory]
      .filter((checkpoint) => checkpoint.operation_key === 'remove-group-membership')
      .sort((left, right) => left.attempt_number - right.attempt_number || left.checkpoint_number - right.checkpoint_number)
      .at(-1);
    // Once c2 membership is terminal, replaying its exact remote read is
    // unsafe after c2b has already deleted the target Item. c2b owns the
    // crash/history reconciliation from this point forward.
    const membershipResult = latestMembershipCheckpoint &&
      ['confirmed_complete', 'confirmed_no_op'].includes(latestMembershipCheckpoint.state)
      ? { revisionId: plan.captureInput.revisionId, membershipConfirmed: true as const }
      : await executeVariationListingPermanentRemoval({
        plan,
        journal: journalFor(existing),
        remote,
        transaction,
      });
    const retirementStore = options.data.remoteRetirementStore;
    if (!retirementStore) throw new Error('Durable removed-SKU remote-retirement store is unavailable.');
    progress('retire_removed_sku_remote_item');
    const retirementResult = await executeRemovedSkuRemoteRetirement({
      plan,
      store: retirementStore,
      remote: removedSkuRemote(deps),
    });
    const targetStillPresent = aggregate.variations.some((variation) =>
      variation.variation_id === plan.targetVariationId || variation.sku === plan.targetSku
    );
    const localWatermarkCoversRevision =
      aggregate.group.desired_revision >= plan.captureInput.capturedDesiredRevision &&
      aggregate.group.last_confirmed_revision !== null &&
      aggregate.group.last_confirmed_revision >= plan.captureInput.capturedDesiredRevision;
    if (!targetStillPresent && localWatermarkCoversRevision) {
      // A historical c2 row may already have finalized locally (including a
      // latest c2 retry after a later desired-revision advance). The durable
      // remote retirement is safe to complete against that frozen identity,
      // but local finalization must never regress a newer watermark.
      return {
        ...membershipResult,
        remoteRetirement: retirementResult,
        historicalRemoteRetirement: true,
        imageCleanup: { pending: true, confirmation: 'Remote Item/Offer retirement is confirmed; local c2 finalization was already durable; image cleanup remains a separate operation.' },
      };
    }
    if (!finalizeLocal) {
      throw validationError('retry', plan.captureInput.groupId, 'historical_permanent_removal_finalizer_required', 'Historical remote retirement cannot proceed while its frozen target remains locally present or its confirmed watermark is behind the c2 revision.', ['inspect_group_history']);
    }
    // c2b proves Item/Offer absence before the existing c2 finalizer removes
    // local Variation/Copy rows. Keep image/R2 cleanup separate and explicit.
    const confirmed = await transaction.confirmPermanentRemoval({
      groupId: plan.captureInput.groupId,
      revisionId: plan.captureInput.revisionId,
      expectedPreviousConfirmedRevision: plan.captureInput.capturedDesiredRevision - 1,
      confirmedRevision: plan.captureInput.capturedDesiredRevision,
      targetVariationId: plan.targetVariationId,
      targetSku: plan.targetSku,
    });
    return {
      ...membershipResult,
      confirmedRevision: plan.captureInput.capturedDesiredRevision,
      group: confirmed,
      remoteRetirement: retirementResult,
      imageCleanup: { pending: true, confirmation: 'Remote Item/Offer retirement is confirmed; image cleanup remains a separate operation.' },
    };
  };

  const publish = (groupId: string, expectedDesiredRevision: number) => run('publish', groupId, async (progress) => {
    assertPublicationMutationEnabled('publish', groupId);
    let aggregate = await requireAggregate(groupId, 'publish', expectedDesiredRevision);
    assertNoPendingPermanentRemoval('publish', groupId, aggregate);
    if (aggregate.group.last_confirmed_revision !== null) throw validationError('publish', groupId, 'initial_publish_already_completed', 'This group is already published. Use Publish Changes for staged updates.', ['publish_changes']);
    if (aggregate.group.lifecycle_state === 'review') {
      try {
        validateVariationListingNewPublicationPayload(aggregate);
      } catch (error) {
        throw validationError(
          'publish',
          groupId,
          'initial_publish_content_invalid',
          error instanceof Error ? error.message : 'Variation listing content does not satisfy the new-publication contract.',
          ['complete_group_review'],
        );
      }
      progress('mark_publish_ready');
      await options.data.markPublishReady({ groupId, expectedDesiredRevision });
      aggregate = await requireAggregate(groupId, 'publish', expectedDesiredRevision);
    }
    if (aggregate.group.lifecycle_state !== 'publish-ready') throw validationError('publish', groupId, 'initial_publish_lifecycle_blocked', `Initial publication is not allowed from lifecycle ${aggregate.group.lifecycle_state}.`, ['complete_group_review']);
    const revisions = await rows(groupId);
    const existing = revisions.find((revision) => revision.captured_desired_revision === expectedDesiredRevision && revisionKind(revision) === 'initial');
    if (!existing) await assertNoOlderUnresolved('publish', groupId, revisions, expectedDesiredRevision);
    let inheritedRepresentativeImages: ReturnType<typeof reconstructVariationListingConfirmedRepresentativeImages> | undefined;
    if (!existing) {
      const cleanupRevision = newestFirst(revisions).find((revision) =>
        revision.captured_desired_revision < expectedDesiredRevision && revisionKind(revision) === 'cleanup'
      );
      const priorInitial = cleanupRevision
        ? newestFirst(revisions).find((revision) => revision.captured_desired_revision < cleanupRevision.captured_desired_revision && revisionKind(revision) === 'initial')
        : undefined;
      if (cleanupRevision) {
        if (!priorInitial) {
          throw validationError('publish', groupId, 'publish_cleanup_lineage_missing', 'A prior unpublished cleanup has no matching initial publication revision for safe Media reuse.', ['inspect_group_history']);
        }
        await assertTerminalUnpublishedCleanup('publish', groupId, cleanupRevision, {
          groupKey: aggregate.group.group_key,
          marketplaceId: aggregate.group.marketplace_id,
          skuCategoryCode: aggregate.group.sku_category_code,
          skuBucketToken: aggregate.group.sku_bucket_token,
        });
        inheritedRepresentativeImages = reconstructVariationListingConfirmedRepresentativeImages({
          revision: priorInitial,
          checkpoints: await checkpoints(priorInitial.revision_id),
        });
      }
    }
    progress(existing ? 'reconcile_existing_revision' : inheritedRepresentativeImages ? 'execute_publication_reusing_media' : 'execute_publication');
    return await executeInitial(aggregate, existing, inheritedRepresentativeImages);
  });

  const publishChanges = (groupId: string, expectedDesiredRevision: number) => run('publish_changes', groupId, async (progress) => {
    assertPublicationMutationEnabled('publish_changes', groupId);
    const aggregate = await requireAggregate(groupId, 'publish_changes', expectedDesiredRevision);
    if (aggregate.group.lifecycle_state !== 'active' || aggregate.group.last_confirmed_revision === null) throw validationError('publish_changes', groupId, 'publish_changes_lifecycle_blocked', 'Publish Changes requires an active published variation listing.', ['refresh_group']);
    if (aggregate.group.desired_revision <= aggregate.group.last_confirmed_revision) throw validationError('publish_changes', groupId, 'no_pending_changes', 'There are no staged changes to publish.', ['edit_group_or_variations']);
    const revisions = await rows(groupId);
    const pendingRemovals = aggregate.variations.filter((variation) => variation.pending_removal_at != null);
    if (pendingRemovals.length > 1) {
      throw validationError('publish_changes', groupId, 'permanent_removal_multiple_targets', 'Publish Changes supports exactly one staged permanent-removal target at a time.', ['review_pending_changes']);
    }
    const existingKind: RevisionKind = pendingRemovals.length === 1 ? 'permanent_removal' : 'active';
    const existing = revisions.find((revision) =>
      revision.captured_desired_revision === expectedDesiredRevision && revisionKind(revision) === existingKind
    );
    const previous = revisions.find((revision) =>
      revision.captured_desired_revision === aggregate.group.last_confirmed_revision
    );
    if (!existing) {
      await assertNoOlderUnresolved('publish_changes', groupId, revisions, expectedDesiredRevision);
      if (!previous) throw validationError('publish_changes', groupId, 'confirmed_revision_missing', 'The last confirmed publication revision is missing.', ['inspect_group_history']);
      if (!hasEffectiveVariationListingPendingChanges(aggregate, previous)) {
        throw validationError('publish_changes', groupId, 'no_pending_changes', 'There are no staged changes to publish.', ['edit_group_or_variations']);
      }
    }
    if (pendingRemovals.length === 1) {
      const target = pendingRemovals[0]!;
      return await executePermanentRemoval(aggregate, target.variation_id, existing, progress);
    }
    const deps = await resolveDependencies();
    let frozen: VariationListingFrozenActiveRevision;
    if (existing) {
      frozen = hydrateActive(existing);
      progress('reconcile_existing_revision');
    } else {
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
    if (deps.assertMerchantLocation) {
      await deps.assertMerchantLocation(frozen.snapshot.aggregate.group.merchant_location_key);
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
    const unresolved = latestUnresolvedOperation(history, operationPlan(revision));
    if (!unresolved) {
      // A remote removal can be complete while the local finalizer response is
      // lost. The terminal journal is then durable, but the staged marker and
      // confirmed watermark still require the idempotent finalization step.
      // Only the latest frozen revision may drive retry recovery; an older
      // terminal removal must not hijack an unrelated later publication.
      const terminalRemoval = revisionKind(revision) === 'permanent_removal' ? revision : undefined;
      if (terminalRemoval) {
        const terminalHistory = await checkpoints(terminalRemoval.revision_id);
        const latest = [...terminalHistory].sort((left, right) => left.attempt_number - right.attempt_number || left.checkpoint_number - right.checkpoint_number).at(-1);
        if (latest && ['confirmed_complete', 'confirmed_no_op'].includes(latest.state)) {
          assertPublicationMutationEnabled('retry', groupId);
          // Historical c2 rows may already have advanced the local watermark
          // and removed the target Variation. Hydrate the frozen c2 identity
          // instead of requiring a live pending marker; c2b prepare/reconcile
          // remains the durable gate before the idempotent local finalizer.
          const frozenTargetVariationId = hydrateVariationListingPermanentRemovalPlan(terminalRemoval).targetVariationId;
          return await executePermanentRemoval(aggregate, frozenTargetVariationId, terminalRemoval, progress);
        }
      }
      // A pre-c2b terminal removal may be followed by later revisions in
      // historical databases that predate the pending-retirement guard. Keep
      // the latest revision/status identity intact, but queue the newest older
      // terminal c2 revision whose durable c2b row is absent or nonterminal.
      const retirementStore = options.data.remoteRetirementStore;
      if (retirementStore) {
        const historicalCandidates = newestFirst(revisions)
          .filter((candidate) => candidate.revision_id !== revision.revision_id && revisionKind(candidate) === 'permanent_removal');
        for (const candidate of historicalCandidates) {
          const candidatePlan = operationPlan(candidate);
          const membershipOperation = candidatePlan.find((operation) => operation.operationKind === 'permanent_removal_group_membership');
          if (!membershipOperation) continue;
          const candidateHistory = await checkpoints(candidate.revision_id);
          const latestMembership = [...candidateHistory]
            .filter((checkpoint) => checkpoint.operation_key === membershipOperation.operationKey)
            .sort((left, right) => left.attempt_number - right.attempt_number || left.checkpoint_number - right.checkpoint_number)
            .at(-1);
          if (!latestMembership || !['confirmed_complete', 'confirmed_no_op'].includes(latestMembership.state)) continue;
          const durable = await retirementStore.load(candidate.revision_id);
          if (durable?.state === 'confirmed_complete') continue;
          const frozen = hydrateVariationListingPermanentRemovalPlan(candidate);
          const targetStillPresent = aggregate.variations.some((variation) =>
            variation.variation_id === frozen.targetVariationId || variation.sku === frozen.targetSku
          );
          const localWatermarkCoversRevision =
            aggregate.group.desired_revision >= frozen.captureInput.capturedDesiredRevision &&
            aggregate.group.last_confirmed_revision !== null &&
            aggregate.group.last_confirmed_revision >= frozen.captureInput.capturedDesiredRevision;
          if (targetStillPresent || !localWatermarkCoversRevision) {
            throw validationError('retry', groupId, 'historical_permanent_removal_finalizer_required', 'Historical remote retirement is blocked because its local target or confirmed watermark is not already finalized.', ['inspect_group_history']);
          }
          assertPublicationMutationEnabled('retry', groupId);
          return await executePermanentRemoval(aggregate, frozen.targetVariationId, candidate, progress, false);
        }
      }
      throw validationError('retry', groupId, 'retry_not_required', 'The latest action revision has no unresolved operation.', ['refresh_group']);
    }
    if (unresolved.state === 'retry_exhausted') throw new VariationListingActionError(409, {
      action: 'retry',
      affected: { groupId },
      category: 'terminal',
      code: 'retry_exhausted',
      issues: [],
      operationKey: unresolved.operation_key,
      recommendedActions: ['inspect_remote_state', 'resolve_manually'],
      remoteState: unresolved.observed_remote_state === 'unknown'
        ? 'unknown'
        : unresolved.observed_remote_state === 'present' ? 'known_changed' : 'known_unchanged',
      requiresReconciliation: unresolved.observed_remote_state === 'unknown',
      retryStatus: 'retry_exhausted',
      revisionId: revision.revision_id,
      severity: 'error',
      stage: 'preflight',
      summary: 'The one bounded replay is exhausted; another automatic retry is not permitted.',
      userActionRequired: true,
    });
    if (revisionKind(revision) === 'permanent_removal') {
      assertPublicationMutationEnabled('retry', groupId);
      const target = aggregate.variations.find((variation) => variation.pending_removal_at != null);
      if (!target) {
        const frozen = record(revision.snapshot);
        const confirmed = record(frozen.confirmed);
        const confirmedAggregate = confirmed.aggregate as unknown as VariationListingAggregateSnapshot | undefined;
        const currentIds = new Set(aggregate.variations.map((variation) => variation.variation_id));
        const targetFromSnapshot = confirmedAggregate?.variations.find((variation) => !currentIds.has(variation.variation_id));
        if (!targetFromSnapshot) throw validationError('retry', groupId, 'permanent_removal_target_missing', 'The frozen permanent-removal revision no longer identifies its target variation.', ['inspect_action_status']);
        return await executePermanentRemoval(aggregate, targetFromSnapshot.variation_id, revision, progress);
      }
      return await executePermanentRemoval(aggregate, target.variation_id, revision, progress);
    }
    assertNoPendingPermanentRemoval('retry', groupId, aggregate);
    if (revisionKind(revision) === 'initial' || revisionKind(revision) === 'active') {
      assertPublicationMutationEnabled('retry', groupId);
    }
    if (unresolved.state !== 'retry_authorized') {
    if (revisionKind(revision) === 'initial' || revisionKind(revision) === 'active') {
        throw unresolvedError('retry', groupId, revision, unresolved);
      }
    }
    const deps = await resolveDependencies();
    progress('reconcile_remote_state', { operationKey: unresolved.operation_key, revisionId: revision.revision_id });
    if (revisionKind(revision) === 'initial') return await executeInitial(aggregate, revision);
    if (revisionKind(revision) === 'active') {
      const frozen = hydrateActive(revision);
      if (deps.assertMerchantLocation) {
        await deps.assertMerchantLocation(frozen.snapshot.aggregate.group.merchant_location_key);
      }
      return await executeVariationListingActiveRevisionPublication({ frozen, journal: journalFor(revision), mutations: deps.mutations, remote: deps.remote, transaction });
    }
    const cleanupFrozen = hydrateCleanup(revision, aggregate.group.last_confirmed_revision);
    if (aggregate.group.last_confirmed_revision !== null) {
      const unresolvedPlanOperation = operationPlan(revision).find((operation) => operation.operationKey === unresolved.operation_key);
      if (unresolvedPlanOperation?.operationKind !== 'withdrawal') {
        throw validationError('retry', groupId, 'published_cleanup_forbidden', 'Published groups must remain retained after withdrawal; destructive cleanup is unavailable.', ['keep_group_withdrawn']);
      }
      return await executeVariationListingWithdrawal({ frozen: cleanupFrozen, journal: journalFor(revision), mutations: deps.mutations, remote: deps.remote, transaction });
    }
    return await executeVariationListingCleanup({ frozen: cleanupFrozen, journal: journalFor(revision), mutations: deps.mutations, remote: deps.remote, transaction });
  });

  const reconcile = (groupId: string) => run('reconcile', groupId, async (progress) => {
    const aggregate = await requireAggregate(groupId, 'reconcile');
    assertNoPendingPermanentRemoval('reconcile', groupId, aggregate);
    const pending = await unresolvedRevision(await rows(groupId));
    if (!pending) {
      throw validationError('reconcile', groupId, 'reconcile_not_required', 'No unresolved operation requires reconciliation.', ['refresh_group']);
    }
    progress('reconcile_remote_state', { operationKey: pending.operation.operation_key, revisionId: pending.revision.revision_id });
    if (revisionKind(pending.revision) === 'active') {
      const deps = await resolveDependencies();
      const frozen = hydrateActive(pending.revision);
      return await executeVariationListingActiveRevisionPublication({
        frozen,
        journal: journalFor(pending.revision),
        mutations: deps.mutations,
        remote: deps.remote,
        transaction,
        readOnlyReconcile: true,
      });
    }
    if (revisionKind(pending.revision) !== 'initial') {
      throw validationError('reconcile', groupId, 'reconcile_revision_unsupported', 'This recovery revision is not supported by read-only reconciliation.', ['inspect_remote_state']);
    }
    return await executeInitial(aggregate, pending.revision, undefined, true);
  });

  async function exactOwnedHistory(groupId: string, aggregate: VariationListingAggregateSnapshot, deps: Awaited<ReturnType<typeof resolveDependencies>>) {
    const revisions = (await rows(groupId))
      .filter((revision) =>
        aggregate.group.last_confirmed_revision !== null &&
        revision.captured_desired_revision <= aggregate.group.last_confirmed_revision &&
        revisionKind(revision) !== 'cleanup'
      )
      .sort((a, b) => a.captured_desired_revision - b.captured_desired_revision);
    if (revisions.length === 0 || revisions.at(-1)?.captured_desired_revision !== aggregate.group.last_confirmed_revision) {
      throw validationError('withdraw', groupId, 'published_revision_history_missing', 'Published remote ownership cannot be reconstructed from the latest confirmed revision.', ['inspect_group_history']);
    }
    const bundles: VariationListingInventoryPayloadBundle[] = [];
    for (const revision of revisions) {
      const images = reconstructVariationListingConfirmedRepresentativeImages({ revision, checkpoints: await checkpoints(revision.revision_id) });
      bundles.push(buildVariationListingHistoricalInventoryPayloadBundle({ aggregate: snapshotAggregate(revision), representativeImages: images }));
    }
    const last = revisions.at(-1)!;
    const lastCheckpoints = await checkpoints(last.revision_id);
    let durableIdentity: ReturnType<typeof reconstructConfirmedRemoteIdentity>;
    try {
      durableIdentity = reconstructConfirmedRemoteIdentity(last, lastCheckpoints);
    } catch (error) {
      throw validationError('withdraw', groupId, 'published_revision_history_missing', error instanceof Error ? error.message : 'Published remote ownership cannot be reconstructed from durable checkpoints.', ['inspect_group_history']);
    }
    // Withdrawal ownership reads intentionally ignore quantity-only eBay drift
    // (sales) while retaining exact non-quantity payload, group, SKU, and
    // durable offer/listing identity checks. Destructive cleanup uses its
    // strict default reader and is not weakened by this path.
    const published = await prepareVariationListingCleanupPlan({
      ownedBundles: bundles,
      ownedRemote: {
        listingId: durableIdentity.listingId,
        offerIdsBySku: durableIdentity.offerIdsBySku,
        publicationHistoryExists: true,
      },
      protection: { state: 'clear' },
      remote: deps.remote,
    });
    return { bundles, ownedRemote: published.snapshot.ownedRemote };
  }

  const withdraw = (groupId: string, expectedDesiredRevision: number) => run('withdraw', groupId, async (progress) => {
    const loadedAggregate = await options.data.loadAggregate(groupId);
    let aggregate: VariationListingAggregateSnapshot = loadedAggregate ?? await requireAggregate(groupId, 'withdraw', expectedDesiredRevision);
    assertNoPendingPermanentRemoval('withdraw', groupId, aggregate);
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
        const sourceUnresolved = latestUnresolvedOperation(sourceHistory, operationPlan(source));
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
    assertNoPendingPermanentRemoval('withdraw', groupId, aggregate);
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
        assertNoPendingPermanentRemoval('withdraw', groupId, aggregate);
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
        const sourceUnresolved = latestUnresolvedOperation(sourceHistory, operationPlan(source));
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
        action === 'cleanup' ? 'published_cleanup_forbidden' : 'abandon_published_group_forbidden',
        action === 'cleanup'
          ? 'Published groups must remain retained after withdrawal; destructive cleanup is unavailable.'
          : 'Published groups cannot be abandoned; withdraw the group to end buyer-facing availability.',
        action === 'cleanup' ? ['keep_group_withdrawn'] : ['withdraw_group']
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
      const sourceUnresolved = latestUnresolvedOperation(sourceHistory, operationPlan(source));
      if (sourceUnresolved) throw unresolvedError(action, groupId, source, sourceUnresolved);
      deps = await resolveDependencies();
      const images = reconstructVariationListingConfirmedRepresentativeImages({ revision: source, checkpoints: sourceHistory });
      const bundle = buildVariationListingHistoricalInventoryPayloadBundle({ aggregate: snapshotAggregate(source), representativeImages: images });
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

  const returnToReview = (groupId: string, expectedDesiredRevision: number) =>
    run('return_to_review', groupId, async (progress) => {
      const aggregate = await requireAggregate(groupId, 'return_to_review', expectedDesiredRevision);
      if (aggregate.group.last_confirmed_revision !== null) {
        throw validationError('return_to_review', groupId, 'return_to_review_published_forbidden', 'Published variation listings cannot return to unpublished review.', ['withdraw_group']);
      }
      if (!['publish-ready', 'abandoned'].includes(aggregate.group.lifecycle_state)) {
        throw validationError('return_to_review', groupId, 'return_to_review_lifecycle_blocked', 'Return to Review requires an unpublished publish-ready or already-cleaned group.', ['refresh_group']);
      }
      let cleaned = aggregate;
      let cleanupRevisionId: string;
      if (aggregate.group.lifecycle_state === 'abandoned') {
        const cleanupRevision = newestFirst(await rows(groupId)).find((revision) =>
          revision.captured_desired_revision === aggregate.group.desired_revision && revisionKind(revision) === 'cleanup'
        );
        if (!cleanupRevision) {
          throw validationError('return_to_review', groupId, 'return_to_review_cleanup_missing', 'A durable unpublished cleanup revision is required before returning to review.', ['cleanup_failed_initial_publication']);
        }
        await assertTerminalUnpublishedCleanup('return_to_review', groupId, cleanupRevision, {
          groupKey: aggregate.group.group_key,
          marketplaceId: aggregate.group.marketplace_id,
          skuCategoryCode: aggregate.group.sku_category_code,
          skuBucketToken: aggregate.group.sku_bucket_token,
        });
        cleanupRevisionId = cleanupRevision.revision_id;
      } else {
        const revisionsBefore = await rows(groupId);
        const unresolved = await unresolvedRevision(revisionsBefore);
        if (unresolved) throw unresolvedError('return_to_review', groupId, unresolved.revision, unresolved.operation);

        progress('cleanup_failed_initial_publication');
        const cleanupResult = await performUnpublishedAbandon('cleanup', groupId, expectedDesiredRevision, progress);
        cleaned = await requireAggregate(groupId, 'return_to_review');
        if (cleaned.group.lifecycle_state !== 'abandoned' || cleaned.group.last_confirmed_revision !== null) {
          throw new Error('Variation listing failed-initial cleanup did not reach exact unpublished abandonment.');
        }
        const revisionId = record(cleanupResult).revisionId;
        if (typeof revisionId !== 'string' || revisionId.trim() === '') {
          throw new Error('Variation listing failed-initial cleanup returned no durable revision identity.');
        }
        cleanupRevisionId = revisionId;
      }
      progress('return_to_review');
      const reopened = await options.data.returnToReview({
        cleanupRevisionId,
        expectedDesiredRevision: cleaned.group.desired_revision,
        groupId,
      });
      return { desiredRevision: reopened.desired_revision, lifecycleState: reopened.lifecycle_state, cleanupRevisionId };
    });

  const abandon = (groupId: string, expectedDesiredRevision: number) =>
    run('abandon', groupId, async (progress) => await performUnpublishedAbandon('abandon', groupId, expectedDesiredRevision, progress));

  const cleanup = (groupId: string, expectedDesiredRevision: number) =>
    run('cleanup', groupId, async (progress) => await performUnpublishedAbandon('cleanup', groupId, expectedDesiredRevision, progress));

  return { abandon, cleanup, publish, publishChanges, reconcile, retry, returnToReview, withdraw };
}
