#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createSupabaseServiceClient } from '@ebay-inventory/data';

import { EbaySellerApi, type InventoryApi } from '@/api/index.js';
import { EbayApiRequestError } from '@/api/client.js';
import { getEbayConfig } from '@/config/environment.js';
import { loadRootEnvironment } from '@/config/env-paths.js';
import {
  getLiveReadinessDiagnostic,
  type LiveReadinessReport,
} from '@/ebay/live-readiness-diagnostic.js';
import { loadEbayOAuthValidationConfig } from '@/ebay/config.js';
import { getSidecarDataAccess } from '@/data/sidecar-data.js';
import { setLogLevel } from '@/utils/logger.js';

const EXPECTED_GROUP_COUNT = 10;
const EXPECTED_SKU_COUNT = 53;
const EXPECTED_MARKETPLACE = 'EBAY_US';
const EXPECTED_API_BASE_URL = 'https://api.ebay.com';

type ReadMethod = 'getInventoryItemGroup' | 'getInventoryItem' | 'getOffers' | 'getOffer';

/** Deliberately excludes every InventoryApi mutation method. */
export type ReadOnlyInventoryApi = Pick<InventoryApi, ReadMethod>;

type ReadState = 'present' | 'proven_absent' | 'unknown';

interface ReadResult<T> {
  state: ReadState;
  value?: T;
}

interface OfferSummary {
  offerId: string;
  sku: string;
  marketplaceId: string;
  status: string;
  listingId: string | null;
  listingStatus: string | null;
  live: boolean;
}

interface DurableIdentity {
  offerIdsBySku: Map<string, Set<string>>;
  unscopedOfferIds: Set<string>;
  listingIds: Set<string>;
  hasPublishedHistory: boolean;
  malformed: boolean;
}

interface HistoricalNamespace {
  groupKey: string;
  skuBucketToken: string;
  skus: string[];
}

/* eslint-disable @typescript-eslint/naming-convention -- Supabase column aliases stay snake_case. */
interface RawVariationGroup {
  group_id: string;
  group_key: string;
  marketplace_id: string;
  sku_bucket_token: string;
}

interface RawVariation {
  group_id: string;
  sku: string;
}

interface RawRevision {
  group_id: string;
  operation_plan: unknown;
  revision_id: string;
  snapshot: unknown;
}

interface RawCheckpoint {
  evidence: unknown;
  revision_id: string;
}

interface SupabaseQueryResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}
/* eslint-enable @typescript-eslint/naming-convention */

export interface VariationListingLiveStatusReport {
  checkedAt: string;
  configuration: {
    environment: string;
    apiBaseUrl: string;
    marketplaceId: string;
    productionPublishEnabled: boolean;
    readiness: 'pass' | 'fail';
  };
  groupsChecked: number;
  skusChecked: number;
  remoteGroups: { present: number; absent: number; unknown: number };
  inventoryItems: { present: number; absent: number; unknown: number };
  offersFound: number;
  listingIds: string[];
  activeLiveListingCount: number;
  unknownCount: number;
  unknownReasons: string[];
  retainedHistoricalNamespaces: HistoricalNamespace[];
  result: 'GO' | 'NO-GO';
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

export function isNotFound(error: unknown): boolean {
  const seen = new Set<object>();
  let current: unknown = error;
  for (let depth = 0; depth < 16 && current !== null && current !== undefined; depth += 1) {
    if ((typeof current === 'object' || typeof current === 'function') && current !== null) {
      const objectValue = current;
      if (seen.has(objectValue)) return false;
      seen.add(objectValue);
    }
    if (current instanceof EbayApiRequestError && current.statusCode === 404) return true;
    const row = record(current);
    if (row.statusCode === 404 || record(row.response).status === 404) return true;
    current = row.cause;
  }
  return false;
}

async function read<T>(operation: () => Promise<T>): Promise<ReadResult<T>> {
  try {
    return { state: 'present', value: await operation() };
  } catch (error) {
    return isNotFound(error) ? { state: 'proven_absent' } : { state: 'unknown' };
  }
}

function addIdentity(identity: DurableIdentity, sku: string | null, offerId: string | null): void {
  if (!sku || !offerId) return;
  const ids = identity.offerIdsBySku.get(sku) ?? new Set<string>();
  ids.add(offerId);
  identity.offerIdsBySku.set(sku, ids);
}

export function recordDurableOfferOwner(
  owners: Map<string, string>,
  offerId: string,
  sku: string
): boolean {
  const previousSku = owners.get(offerId);
  if (previousSku && previousSku !== sku) return false;
  owners.set(offerId, sku);
  return true;
}

function validatePublicationHistoryRecord(
  identity: DurableIdentity,
  row: Record<string, unknown>,
  expectedSkus?: Set<string>
): void {
  const publicationHistoryExists = row.publicationHistoryExists;
  if (typeof publicationHistoryExists !== 'boolean') {
    identity.malformed = true;
    return;
  }
  if (publicationHistoryExists) identity.hasPublishedHistory = true;
  const hasOwn = (key: string): boolean => Object.prototype.hasOwnProperty.call(row, key);
  const rawListingId = row.listingId;
  const listingId = nonEmptyString(rawListingId);
  if (
    publicationHistoryExists
      ? !hasOwn('listingId') || !listingId
      : !hasOwn('listingId') || rawListingId !== null
  ) {
    identity.malformed = true;
  }

  const rawOfferIdsBySku = row.offerIdsBySku;
  if (
    !hasOwn('offerIdsBySku') ||
    rawOfferIdsBySku === null ||
    typeof rawOfferIdsBySku !== 'object' ||
    Array.isArray(rawOfferIdsBySku)
  ) {
    identity.malformed = true;
    return;
  }
  const offerIdsBySku = rawOfferIdsBySku as Record<string, unknown>;
  const entries = Object.entries(offerIdsBySku);
  const seenOfferIds = new Set<string>();
  for (const [mappedSku, rawOfferId] of entries) {
    const offerId = nonEmptyString(rawOfferId);
    if (
      !offerId ||
      seenOfferIds.has(offerId) ||
      (expectedSkus !== undefined && !expectedSkus.has(mappedSku))
    ) {
      identity.malformed = true;
      continue;
    }
    seenOfferIds.add(offerId);
  }
  if (publicationHistoryExists && expectedSkus !== undefined) {
    if (entries.length !== expectedSkus.size) identity.malformed = true;
    for (const sku of expectedSkus) {
      if (!nonEmptyString(offerIdsBySku[sku])) identity.malformed = true;
    }
  }
}

export function collectDurableIdentity(
  identity: DurableIdentity,
  value: unknown,
  inheritedSku: string | null = null,
  expectedSkus?: Set<string>
): void {
  if (Array.isArray(value)) {
    for (const child of value) collectDurableIdentity(identity, child, inheritedSku, expectedSkus);
    return;
  }
  if (value === null || typeof value !== 'object') return;

  const row = value as Record<string, unknown>;
  const hasOwn = (key: string): boolean => Object.prototype.hasOwnProperty.call(row, key);
  const rawSku = row.sku;
  const explicitSku = hasOwn('sku') ? nonEmptyString(rawSku) : null;
  if (hasOwn('sku') && rawSku !== null && rawSku !== undefined && !explicitSku)
    identity.malformed = true;
  const sku = explicitSku ?? inheritedSku;

  if (hasOwn('offerId')) {
    const rawOfferId = row.offerId;
    if (rawOfferId !== null && rawOfferId !== undefined) {
      const offerId = nonEmptyString(rawOfferId);
      if (!offerId) identity.malformed = true;
      else if (sku) addIdentity(identity, sku, offerId);
      else identity.unscopedOfferIds.add(offerId);
    }
  }
  if (hasOwn('listingId')) {
    const rawListingId = row.listingId;
    if (rawListingId !== null && rawListingId !== undefined) {
      const listingId = nonEmptyString(rawListingId);
      if (!listingId) identity.malformed = true;
      else identity.listingIds.add(listingId);
    }
  }

  if (hasOwn('publicationHistoryExists'))
    validatePublicationHistoryRecord(identity, row, expectedSkus);

  if (hasOwn('offerIdsBySku')) {
    const offerIdsBySku = row.offerIdsBySku;
    if (
      offerIdsBySku === null ||
      typeof offerIdsBySku !== 'object' ||
      Array.isArray(offerIdsBySku)
    ) {
      identity.malformed = true;
    } else {
      for (const [mappedSku, mappedOfferId] of Object.entries(offerIdsBySku)) {
        const normalizedSku = nonEmptyString(mappedSku);
        const normalizedOfferId = nonEmptyString(mappedOfferId);
        if (!normalizedSku || !normalizedOfferId) {
          identity.malformed = true;
          continue;
        }
        addIdentity(identity, normalizedSku, normalizedOfferId);
      }
    }
  }
  for (const child of Object.values(row))
    collectDurableIdentity(identity, child, sku, expectedSkus);
}

export function durableIdentityFor(
  revisions: RawRevision[],
  checkpointsByRevision: Map<string, RawCheckpoint[]>,
  expectedSkus: Set<string>
): DurableIdentity {
  const identity: DurableIdentity = {
    offerIdsBySku: new Map(),
    unscopedOfferIds: new Set(),
    listingIds: new Set(),
    hasPublishedHistory: false,
    malformed: false,
  };
  for (const revision of revisions) {
    collectDurableIdentity(identity, revision.snapshot, null, expectedSkus);
    validateKnownPublishedRemote(identity, revision.snapshot, expectedSkus);
    collectDurableIdentity(identity, revision.operation_plan, null, expectedSkus);
    for (const checkpoint of checkpointsByRevision.get(revision.revision_id) ?? []) {
      collectDurableIdentity(identity, checkpoint.evidence, null, expectedSkus);
    }
  }
  const offerOwners = new Map<string, string>();
  for (const [sku, ids] of identity.offerIdsBySku) {
    if (!expectedSkus.has(sku)) identity.malformed = true;
    for (const offerId of ids) {
      const previousSku = offerOwners.get(offerId);
      if (previousSku && previousSku !== sku) identity.malformed = true;
      else offerOwners.set(offerId, sku);
    }
  }
  for (const offerId of identity.unscopedOfferIds) {
    if (!offerOwners.has(offerId)) identity.malformed = true;
  }
  return identity;
}

function validateKnownPublishedRemote(
  identity: DurableIdentity,
  snapshot: unknown,
  expectedSkus: Set<string>
): void {
  const root = record(snapshot);
  if (!Object.prototype.hasOwnProperty.call(root, 'confirmed')) return;
  const rawConfirmed = root.confirmed;
  if (rawConfirmed === null || rawConfirmed === undefined) {
    identity.malformed = true;
    return;
  }
  if (typeof rawConfirmed !== 'object' || Array.isArray(rawConfirmed)) {
    identity.malformed = true;
    return;
  }
  const confirmed = rawConfirmed as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(confirmed, 'remote')) {
    identity.malformed = true;
    return;
  }
  const rawRemote = confirmed.remote;
  if (rawRemote === null || typeof rawRemote !== 'object' || Array.isArray(rawRemote)) {
    identity.malformed = true;
    return;
  }
  identity.hasPublishedHistory = true;
  const remote = rawRemote as Record<string, unknown>;
  const listingId = nonEmptyString(remote.listingId);
  const rawOfferIdsBySku = remote.offerIdsBySku;
  if (
    !Object.prototype.hasOwnProperty.call(remote, 'listingId') ||
    !listingId ||
    rawOfferIdsBySku === null ||
    typeof rawOfferIdsBySku !== 'object' ||
    Array.isArray(rawOfferIdsBySku)
  ) {
    identity.malformed = true;
    return;
  }
  const offerIdsBySku = rawOfferIdsBySku as Record<string, unknown>;
  const entries = Object.entries(offerIdsBySku);
  const seenOfferIds = new Set<string>();
  if (entries.length !== expectedSkus.size) identity.malformed = true;
  for (const [sku, rawOfferId] of entries) {
    const offerId = nonEmptyString(rawOfferId);
    if (!expectedSkus.has(sku) || !offerId || seenOfferIds.has(offerId)) {
      identity.malformed = true;
      continue;
    }
    seenOfferIds.add(offerId);
  }
  for (const sku of expectedSkus) {
    const rawOfferId = offerIdsBySku[sku];
    if (!nonEmptyString(rawOfferId)) identity.malformed = true;
  }
}

export function parseOffer(raw: unknown): OfferSummary | null {
  const row = record(raw);
  const hasOffersWrapper = Object.prototype.hasOwnProperty.call(row, 'offers');
  if (hasOffersWrapper && (!Array.isArray(row.offers) || row.offers.length !== 1)) return null;
  const nested = hasOffersWrapper ? record((row.offers as unknown[])[0]) : row;
  const hasListing = Object.prototype.hasOwnProperty.call(nested, 'listing');
  const rawListing = nested.listing;
  if (
    hasListing &&
    rawListing !== null &&
    rawListing !== undefined &&
    (typeof rawListing !== 'object' || Array.isArray(rawListing))
  )
    return null;
  const listing = record(rawListing);
  const offerId = nonEmptyString(nested.offerId);
  const explicitSku = nonEmptyString(nested.sku);
  const sku = explicitSku;
  const marketplaceId = nonEmptyString(nested.marketplaceId);
  const status = nonEmptyString(nested.status)?.toUpperCase() ?? null;
  const readOptionalIdentity = (
    source: Record<string, unknown>,
    key: string
  ): { valid: boolean; value: string | null } => {
    if (!Object.prototype.hasOwnProperty.call(source, key)) return { valid: true, value: null };
    const rawValue = source[key];
    if (rawValue === null || rawValue === undefined) return { valid: true, value: null };
    const value = nonEmptyString(rawValue);
    return { valid: value !== null, value };
  };
  const directListingIdResult = readOptionalIdentity(nested, 'listingId');
  const nestedListingIdResult = readOptionalIdentity(listing, 'listingId');
  const directListingStatusResult = readOptionalIdentity(nested, 'listingStatus');
  const nestedListingStatusResult = readOptionalIdentity(listing, 'listingStatus');
  if (
    !directListingIdResult.valid ||
    !nestedListingIdResult.valid ||
    !directListingStatusResult.valid ||
    !nestedListingStatusResult.valid
  )
    return null;
  const directListingId = directListingIdResult.value;
  const nestedListingId = nestedListingIdResult.value;
  const directListingStatus = directListingStatusResult.value?.toUpperCase() ?? null;
  const nestedListingStatus = nestedListingStatusResult.value?.toUpperCase() ?? null;
  const listingId = directListingId ?? nestedListingId;
  const listingStatus = directListingStatus ?? nestedListingStatus;
  if (
    !offerId ||
    !sku ||
    !marketplaceId ||
    !status ||
    !['PUBLISHED', 'UNPUBLISHED'].includes(status)
  )
    return null;

  if (
    (directListingId && nestedListingId && directListingId !== nestedListingId) ||
    (directListingStatus && nestedListingStatus && directListingStatus !== nestedListingStatus)
  )
    return null;

  if (status === 'PUBLISHED') {
    if (!listingId || !listingStatus || !['ACTIVE', 'OUT_OF_STOCK'].includes(listingStatus))
      return null;
  } else if (listingId || listingStatus) {
    return null;
  }

  const live = isOfferLive({ status, listingStatus, listingId });
  return { offerId, sku, marketplaceId, status, listingId, listingStatus, live };
}

export function isOfferLive(
  offer: Pick<OfferSummary, 'status' | 'listingStatus' | 'listingId'>
): boolean {
  return (
    offer.status === 'PUBLISHED' &&
    !!offer.listingId &&
    !!offer.listingStatus &&
    ['ACTIVE', 'OUT_OF_STOCK'].includes(offer.listingStatus)
  );
}

export function normalizeOffers(raw: unknown, fallbackSku: string): OfferSummary[] | null {
  const response = record(raw);
  const rows = response.offers;
  if (!Array.isArray(rows)) return null;
  const next = response.next;
  const previous = response.prev;
  if ((next !== null && next !== undefined) || (previous !== null && previous !== undefined))
    return null;
  for (const key of ['total', 'size'] as const) {
    const value = response[key];
    if (value !== null && value !== undefined) {
      if (
        typeof value !== 'number' ||
        !Number.isInteger(value) ||
        value < 0 ||
        value !== rows.length
      )
        return null;
    }
  }
  const offers: OfferSummary[] = [];
  for (const row of rows) {
    const offer = parseOffer(row);
    if (offer?.sku !== fallbackSku) return null;
    offers.push(offer);
  }
  return offers;
}

export function countUniqueLiveListingIds(offers: Iterable<OfferSummary>): number {
  return new Set(
    [...offers].filter((offer) => offer.live && offer.listingId).map((offer) => offer.listingId!)
  ).size;
}

async function queryRows<T>(query: PromiseLike<unknown>): Promise<T[]> {
  const result = (await query) as SupabaseQueryResult<T>;
  if (result.error) throw new Error(`Supabase read failed: ${result.error.message}`);
  return result.data ?? [];
}

async function listGroups(
  database: ReturnType<typeof createSupabaseServiceClient>
): Promise<RawVariationGroup[]> {
  return await queryRows<RawVariationGroup>(
    database
      .from('variation_listing_groups')
      .select('group_id,group_key,marketplace_id,sku_bucket_token')
      .order('created_at', { ascending: true })
  );
}

async function listVariations(
  database: ReturnType<typeof createSupabaseServiceClient>,
  groupId: string
): Promise<RawVariation[]> {
  return await queryRows<RawVariation>(
    database
      .from('variation_listing_variations')
      .select('group_id,sku')
      .eq('group_id', groupId)
      .order('position', { ascending: true })
  );
}

async function listRevisions(
  database: ReturnType<typeof createSupabaseServiceClient>,
  groupId: string
): Promise<RawRevision[]> {
  return await queryRows<RawRevision>(
    database
      .from('variation_listing_revisions')
      .select('group_id,operation_plan,revision_id,snapshot')
      .eq('group_id', groupId)
      .order('captured_desired_revision', { ascending: false })
  );
}

async function listCheckpoints(
  database: ReturnType<typeof createSupabaseServiceClient>,
  revisionId: string
): Promise<RawCheckpoint[]> {
  return await queryRows<RawCheckpoint>(
    database
      .from('variation_listing_publishing_checkpoints')
      .select('evidence,revision_id')
      .eq('revision_id', revisionId)
      .order('operation_key', { ascending: true })
      .order('attempt_number', { ascending: true })
      .order('checkpoint_number', { ascending: true })
  );
}

function namespaceFor(group: RawVariationGroup, skus: string[]): HistoricalNamespace {
  const bucket = nonEmptyString(group.sku_bucket_token) ?? '[missing]';
  return { groupKey: group.group_key, skuBucketToken: bucket, skus: [...skus] };
}

export function baseReport(
  configuration: VariationListingLiveStatusReport['configuration']
): VariationListingLiveStatusReport {
  return {
    checkedAt: new Date().toISOString(),
    configuration,
    groupsChecked: 0,
    skusChecked: 0,
    remoteGroups: { present: 0, absent: 0, unknown: 0 },
    inventoryItems: { present: 0, absent: 0, unknown: 0 },
    offersFound: 0,
    listingIds: [],
    activeLiveListingCount: 0,
    unknownCount: 0,
    unknownReasons: [],
    retainedHistoricalNamespaces: [],
    result: 'NO-GO',
  };
}

export function addUnknown(report: VariationListingLiveStatusReport, reason: string): void {
  report.unknownReasons.push(reason);
  report.unknownCount = report.unknownReasons.length;
}

function readinessPassed(
  report: LiveReadinessReport,
  environment: string,
  marketplaceId: string,
  publishEnabled: boolean
): boolean {
  const failedChecks = report.checks.some((check) => check.status === 'fail');
  const requiredChecksPassed = [
    'environment_config',
    'oauth_refresh',
    'seller_account_access',
    'publish_config_resolution',
  ].every((name) => report.checks.find((check) => check.name === name)?.status === 'pass');
  return (
    !failedChecks &&
    report.environment === 'production' &&
    environment === 'production' &&
    report.apiBaseUrl === EXPECTED_API_BASE_URL &&
    marketplaceId === EXPECTED_MARKETPLACE &&
    report.marketplaceId === EXPECTED_MARKETPLACE &&
    publishEnabled === false &&
    report.productionPublishEnabled === false &&
    requiredChecksPassed
  );
}

export async function verifyVariationListingLiveStatus(): Promise<VariationListingLiveStatusReport> {
  setLogLevel('silent');
  loadRootEnvironment();
  const oauthConfig = loadEbayOAuthValidationConfig(process.env);
  const runtimeConfig = getEbayConfig();
  const configuration: VariationListingLiveStatusReport['configuration'] = {
    environment: oauthConfig.environment,
    apiBaseUrl: oauthConfig.apiBaseUrl,
    marketplaceId: oauthConfig.marketplaceId,
    productionPublishEnabled: oauthConfig.publishEnabled,
    readiness: 'fail',
  };
  const report = baseReport(configuration);
  const api = new EbaySellerApi(runtimeConfig);

  let readiness: LiveReadinessReport;
  try {
    await api.initialize();
    readiness = await getLiveReadinessDiagnostic({
      api,
      dataAccess: getSidecarDataAccess(),
      oauthConfig,
      runtimeConfig,
    });
  } catch {
    addUnknown(report, 'readiness_unknown');
    return report;
  }
  if (
    !readinessPassed(
      readiness,
      runtimeConfig.environment,
      oauthConfig.marketplaceId,
      oauthConfig.publishEnabled
    )
  )
    return report;
  report.configuration.readiness = 'pass';

  const database = createSupabaseServiceClient(process.env);
  const groups = await listGroups(database);
  report.groupsChecked = groups.length;
  const variationsByGroup = new Map<string, RawVariation[]>();
  const allSkus = new Set<string>();
  let skuRowCount = 0;
  for (const group of groups) {
    const variations = await listVariations(database, group.group_id);
    variationsByGroup.set(group.group_id, variations);
    report.retainedHistoricalNamespaces.push(
      namespaceFor(
        group,
        variations.map((variation) => variation.sku)
      )
    );
    for (const variation of variations) {
      skuRowCount += 1;
      allSkus.add(variation.sku);
    }
  }
  report.skusChecked = allSkus.size;
  if (
    groups.length !== EXPECTED_GROUP_COUNT ||
    skuRowCount !== EXPECTED_SKU_COUNT ||
    allSkus.size !== EXPECTED_SKU_COUNT ||
    report.retainedHistoricalNamespaces.some((entry) => entry.skus.length === 0) ||
    groups.some((group) => group.marketplace_id !== EXPECTED_MARKETPLACE)
  ) {
    addUnknown(report, 'authoritative_counts_mismatch');
    return report;
  }

  const readApi: ReadOnlyInventoryApi = api.inventory;
  const remoteOffers = new Map<string, OfferSummary>();
  const durableByGroup = new Map<string, DurableIdentity>();
  const durableOfferOwnerById = new Map<string, string>();
  for (const group of groups) {
    const variations = variationsByGroup.get(group.group_id)!;
    const expectedSkus = new Set(variations.map((variation) => variation.sku));
    const revisions = await listRevisions(database, group.group_id);
    const checkpointsByRevision = new Map<string, RawCheckpoint[]>();
    for (const revision of revisions) {
      checkpointsByRevision.set(
        revision.revision_id,
        await listCheckpoints(database, revision.revision_id)
      );
    }
    const durable = durableIdentityFor(revisions, checkpointsByRevision, expectedSkus);
    durableByGroup.set(group.group_id, durable);
    if (durable.malformed) addUnknown(report, `durable_identity_malformed:${group.group_key}`);
    for (const [sku, offerIds] of durable.offerIdsBySku) {
      for (const offerId of offerIds) {
        if (!recordDurableOfferOwner(durableOfferOwnerById, offerId, sku))
          addUnknown(report, `durable_offer_identity_conflict:${offerId}`);
      }
    }

    const groupRead = await read(() => readApi.getInventoryItemGroup(group.group_key));
    report.remoteGroups[
      groupRead.state === 'present'
        ? 'present'
        : groupRead.state === 'proven_absent'
          ? 'absent'
          : 'unknown'
    ] += 1;
    if (groupRead.state === 'unknown') addUnknown(report, `group_read_unknown:${group.group_key}`);
    if (groupRead.state === 'present') {
      const remoteGroup = record(groupRead.value);
      const remoteGroupKey =
        nonEmptyString(remoteGroup.inventoryItemGroupKey) ?? nonEmptyString(remoteGroup.groupKey);
      const variantSkus = remoteGroup.variantSKUs;
      const normalizedVariantSkus = Array.isArray(variantSkus)
        ? variantSkus.map((sku) => (typeof sku === 'string' ? sku.trim() : ''))
        : [];
      if (
        (remoteGroupKey && remoteGroupKey !== group.group_key) ||
        !Array.isArray(variantSkus) ||
        normalizedVariantSkus.some((sku) => sku === '') ||
        new Set(normalizedVariantSkus).size !== normalizedVariantSkus.length ||
        new Set(normalizedVariantSkus).size !== expectedSkus.size ||
        normalizedVariantSkus.some((sku) => !expectedSkus.has(sku))
      ) {
        addUnknown(report, `group_identity_conflict:${group.group_key}`);
      }
    }

    for (const variation of variations) {
      const itemRead = await read(() => readApi.getInventoryItem(variation.sku));
      report.inventoryItems[
        itemRead.state === 'present'
          ? 'present'
          : itemRead.state === 'proven_absent'
            ? 'absent'
            : 'unknown'
      ] += 1;
      if (itemRead.state === 'unknown') addUnknown(report, `item_read_unknown:${variation.sku}`);
      if (itemRead.state === 'present') {
        const remoteItemSku = nonEmptyString(record(itemRead.value).sku);
        if (remoteItemSku && remoteItemSku !== variation.sku)
          addUnknown(report, `item_identity_conflict:${variation.sku}`);
      }

      const offersRead = await read(() =>
        readApi.getOffers(variation.sku, oauthConfig.marketplaceId)
      );
      if (offersRead.state === 'unknown') {
        addUnknown(report, `offers_read_unknown:${variation.sku}`);
        continue;
      }
      if (offersRead.state === 'proven_absent') continue;
      const offers = normalizeOffers(offersRead.value, variation.sku);
      if (!offers) {
        addUnknown(report, `offers_payload_invalid:${variation.sku}`);
        continue;
      }
      for (const offer of offers) {
        if (offer.marketplaceId !== oauthConfig.marketplaceId) {
          addUnknown(report, `offer_marketplace_conflict:${offer.offerId}`);
          continue;
        }
        const existing = remoteOffers.get(offer.offerId);
        if (
          existing &&
          (existing.sku !== offer.sku ||
            existing.listingId !== offer.listingId ||
            existing.status !== offer.status ||
            existing.listingStatus !== offer.listingStatus)
        ) {
          addUnknown(report, `offer_identity_conflict:${offer.offerId}`);
          continue;
        }
        remoteOffers.set(offer.offerId, offer);
      }
    }
  }

  for (const [groupId, durable] of durableByGroup) {
    const variations = variationsByGroup.get(groupId)!;
    for (const [sku, ids] of durable.offerIdsBySku) {
      for (const expectedOfferId of ids) {
        const offerRead = await read(() => readApi.getOffer(expectedOfferId));
        if (offerRead.state === 'unknown') {
          addUnknown(report, `offer_read_unknown:${expectedOfferId}`);
          continue;
        }
        if (offerRead.state === 'present') {
          const offer = parseOffer(offerRead.value);
          if (offer?.offerId !== expectedOfferId || offer.sku !== sku)
            addUnknown(report, `offer_identity_mismatch:${expectedOfferId}`);
          else {
            if (offer.marketplaceId !== oauthConfig.marketplaceId) {
              addUnknown(report, `offer_marketplace_conflict:${expectedOfferId}`);
              continue;
            }
            const existing = remoteOffers.get(offer.offerId);
            if (
              existing &&
              (existing.sku !== offer.sku ||
                existing.listingId !== offer.listingId ||
                existing.status !== offer.status ||
                existing.listingStatus !== offer.listingStatus)
            ) {
              addUnknown(report, `offer_identity_conflict:${offer.offerId}`);
              continue;
            }
            remoteOffers.set(offer.offerId, offer);
          }
        }
      }
    }
    if (durable.listingIds.size > 0) {
      const observed = [...remoteOffers.values()].filter(
        (offer) => variations.some((variation) => variation.sku === offer.sku) && offer.listingId
      );
      if (observed.some((offer) => !durable.listingIds.has(offer.listingId!)))
        addUnknown(report, `listing_identity_conflict:${groupId}`);
    }
  }

  report.offersFound = remoteOffers.size;
  report.listingIds = [
    ...new Set(
      [...remoteOffers.values()].flatMap((offer) => (offer.listingId ? [offer.listingId] : []))
    ),
  ].sort();
  report.activeLiveListingCount = countUniqueLiveListingIds(remoteOffers.values());
  const hasPublished = [...remoteOffers.values()].some((offer) => offer.status === 'PUBLISHED');
  report.result =
    report.configuration.readiness === 'pass' && report.unknownCount === 0 && !hasPublished
      ? 'GO'
      : 'NO-GO';
  return report;
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
const modulePath = resolve(fileURLToPath(import.meta.url));

if (entryPath && modulePath === entryPath) {
  verifyVariationListingLiveStatus()
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
      if (report.result !== 'GO') process.exitCode = 1;
    })
    .catch(() => {
      const report = baseReport({
        environment: 'unknown',
        apiBaseUrl: 'unknown',
        marketplaceId: 'unknown',
        productionPublishEnabled: false,
        readiness: 'fail',
      });
      addUnknown(report, 'fatal_unknown');
      console.log(JSON.stringify(report, null, 2));
      process.exitCode = 1;
    });
}
