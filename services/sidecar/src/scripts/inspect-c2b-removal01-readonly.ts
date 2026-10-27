#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const C2B_REMOVAL01_SANDBOX_ORIGIN = 'https://api.sandbox.ebay.com' as const;
export const C2B_REMOVAL01_MARKETPLACE = 'EBAY_US' as const;
export const C2B_REMOVAL01_GROUP_KEY = 'VL-G-586051B7970A45BDA53A1D1A10285B42' as const;
export const C2B_REMOVAL01_GROUP_ID = '586051b7-970a-45bd-a53a-1d1a10285b42' as const;
export const C2B_REMOVAL01_REVISION_ID = '0f8a4786-12a3-45d9-b293-63e2a6318260' as const;
export const C2B_REMOVAL01_SNAPSHOT_DIGEST = '602f38a42f0beb0f940a6f222c105ffa0914bbe0b0d3eff03a2830a0a6737727' as const;
export const C2B_REMOVAL01_LISTING_ID = '110591443545' as const;
export const C2B_REMOVAL01_SKUS = [
  'BSKBL-C2BRemoval01-000001',
  'BSKBL-C2BRemoval01-000002',
  'BSKBL-C2BRemoval01-000003',
] as const;
export const C2B_REMOVAL01_OFFER_IDS = {
  'BSKBL-C2BRemoval01-000001': '11951367010',
  'BSKBL-C2BRemoval01-000002': '11951368010',
  'BSKBL-C2BRemoval01-000003': '11951369010',
} as const;

type JsonRecord = Record<string, unknown>;

export interface ReadOnlyInventoryApi {
  getInventoryItemGroup(groupKey: string): Promise<unknown>;
  getInventoryItem(sku: string): Promise<unknown>;
  getOffers(sku?: string, marketplaceId?: string, limit?: number, offset?: number): Promise<unknown>;
}

export interface ReadOnlySellerApi {
  trading: { getCurrentUserIdentity(): Promise<{ userId: string; username?: string }> };
  inventory: ReadOnlyInventoryApi;
}

export interface ReadOnlyRevision {
  revisionId?: string;
  groupId?: string;
  snapshotDigest?: string;
  operationCount?: number;
  operationPlan?: unknown[];
  source?: JsonRecord;
}

export interface ReadOnlyCheckpoint {
  revisionId?: string;
  checkpointNumber?: number;
  state?: string;
  operationKey?: string;
  source?: JsonRecord;
}

export interface ReadOnlyRetirement {
  state?: string;
}

export interface ReadOnlyDataAccess {
  variationListings: {
    listRevisionsByGroupId(groupId: string): Promise<ReadOnlyRevision[]>;
    listCheckpointsByRevisionId(revisionId: string): Promise<ReadOnlyCheckpoint[]>;
    remoteRetirementStore: { load(revisionId: string): Promise<ReadOnlyRetirement | null> };
  };
}

export interface C2BRemoval01Dependencies {
  env?: NodeJS.ProcessEnv;
  loadRootEnvironment?: () => void;
  createApi?: () => Promise<ReadOnlySellerApi> | ReadOnlySellerApi;
  fetchImpl?: typeof fetch;
  createDataAccess?: () => Promise<ReadOnlyDataAccess> | ReadOnlyDataAccess;
  print?: (value: string) => void;
}

export interface OfferPageEvidence {
  page: number;
  offset: number;
  total: number;
  size: number;
  next: boolean;
  offers: {
    offerId: string | null;
    marketplaceId: string | null;
    status: string | null;
    listingId: string | null;
    listingStatus: string | null;
    availableQuantity: number | null;
  }[];
}

function asRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as JsonRecord;
}

function exactOrigin(value: string, label: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} is not a valid URL.`);
  }
  if (parsed.origin !== C2B_REMOVAL01_SANDBOX_ORIGIN || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${label} must resolve to the Sandbox eBay origin.`);
  }
}

/** Pure environment guard. It intentionally returns no credential material. */
export function validateC2BRemoval01Environment(env: NodeJS.ProcessEnv): void {
  if (env.EBAY_ENVIRONMENT !== 'sandbox') throw new Error('Sandbox environment is required.');
  if ((env.EBAY_MARKETPLACE_ID ?? 'EBAY_US').trim() !== C2B_REMOVAL01_MARKETPLACE) {
    throw new Error('EBAY_MARKETPLACE_ID must be EBAY_US.');
  }
  if ((env.EBAY_CONTENT_LANGUAGE ?? 'en-US').trim() !== 'en-US') {
    throw new Error('EBAY_CONTENT_LANGUAGE must resolve to en-US.');
  }
  if (
    Object.entries(env).some(
      ([name, value]) =>
        name.includes('EBAY') && name.includes('PRODUCTION') && Boolean(value?.trim())
    )
  ) {
    throw new Error('Production eBay credential material is forbidden.');
  }
  if (env.SUPABASE_PROJECT_REF !== 'fmiliwxthjonjwywuqta') {
    throw new Error('The canonical Supabase project is required.');
  }
  let supabaseUrl: URL;
  try { supabaseUrl = new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? ''); } catch { throw new Error('The canonical Supabase URL is required.'); }
  if (supabaseUrl.protocol !== 'https:' || supabaseUrl.hostname !== 'fmiliwxthjonjwywuqta.supabase.co') throw new Error('The canonical Supabase URL is required.');
  const refreshToken = env.EBAY_REFRESH_TOKEN?.trim() ?? '';
  const userRefreshToken = env.EBAY_USER_REFRESH_TOKEN?.trim() ?? '';
  if (!refreshToken && !userRefreshToken) {
    throw new Error('A Sandbox refresh token is required.');
  }
  exactOrigin(env.EBAY_API_BASE_URL?.trim() ?? C2B_REMOVAL01_SANDBOX_ORIGIN, 'EBAY_API_BASE_URL');
  exactOrigin(env.EBAY_OAUTH_BASE_URL?.trim() ?? C2B_REMOVAL01_SANDBOX_ORIGIN, 'EBAY_OAUTH_BASE_URL');
}

export function parseC2BRemoval01Args(argv: readonly string[]): void {
  if (argv.length !== 0) throw new Error('This command accepts no arguments and is read-only.');
}

export function validateC2BRemoval01OfferIdentity(
  sku: string,
  offers: OfferPageEvidence['offers']
): void {
  if (offers.length !== 1) throw new Error(`Expected exactly one Offer for ${sku}.`);
  const offer = offers[0];
  if (offer.offerId !== C2B_REMOVAL01_OFFER_IDS[sku as keyof typeof C2B_REMOVAL01_OFFER_IDS] || offer.marketplaceId !== C2B_REMOVAL01_MARKETPLACE || offer.listingId !== C2B_REMOVAL01_LISTING_ID) throw new Error(`Offer identity for ${sku} is not the frozen C2BRemoval01 identity.`);
}

function pickGroupMetadata(value: unknown): JsonRecord {
  const group = asRecord(value);
  const output: JsonRecord = {};
  const keys = [
    'title', 'description', 'aspects', 'variesBy', 'variantSKUs', 'marketplaceId',
    'categoryId', 'format', 'contentLanguage', 'merchantLocationKey', 'policies',
  ];
  for (const key of keys) if (group[key] !== undefined) output[key] = group[key];
  return output;
}

function readQuantity(item: JsonRecord): number | null {
  const availability = asRecord(item.availability);
  const ship = asRecord(availability.shipToLocationAvailability);
  return typeof ship.quantity === 'number' && Number.isSafeInteger(ship.quantity) ? ship.quantity : null;
}

function readCardAspect(item: JsonRecord): unknown {
  const product = asRecord(item.product);
  const aspects = asRecord(product.aspects);
  return aspects.Card;
}

function imageEvidence(value: unknown): { present: boolean; count: number; hosts: string[] } {
  if (!Array.isArray(value)) return { present: false, count: 0, hosts: [] };
  const hosts = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    try { hosts.add(new URL(entry).hostname); } catch { /* redact malformed URLs */ }
  }
  return { present: true, count: value.length, hosts: [...hosts].sort() };
}

function sanitizeItem(sku: string, value: unknown): JsonRecord {
  const item = asRecord(value);
  const groups = item.groupIds ?? item.inventoryItemGroupKeys ?? null;
  const product = asRecord(item.product);
  return { sku, groupKeys: Array.isArray(groups) ? groups : null, quantity: readQuantity(item), cardAspect: readCardAspect(item) ?? null, productImageEvidence: imageEvidence(product.imageUrls) };
}

function sanitizeOffer(value: unknown): OfferPageEvidence['offers'][number] {
  const offer = asRecord(value);
  const quantity = offer.availableQuantity;
  return {
    offerId: typeof offer.offerId === 'string' ? offer.offerId : null,
    marketplaceId: typeof offer.marketplaceId === 'string' ? offer.marketplaceId : null,
    status: typeof offer.status === 'string' ? offer.status : null,
    listingId: typeof offer.listingId === 'string' ? offer.listingId : typeof asRecord(offer.listing).listingId === 'string' ? asRecord(offer.listing).listingId as string : null,
    listingStatus: typeof asRecord(offer.listing).listingStatus === 'string' ? asRecord(offer.listing).listingStatus as string : typeof asRecord(offer.listing).status === 'string' ? asRecord(offer.listing).status as string : null,
    availableQuantity: typeof quantity === 'number' && Number.isSafeInteger(quantity) ? quantity : null,
  };
}

function validateNext(next: unknown, seen: Set<string>): boolean {
  if (next === undefined || next === null || next === '') return false;
  if (typeof next !== 'string') throw new Error('Offer pagination next URL is invalid.');
  let parsed: URL;
  try { parsed = new URL(next); } catch { throw new Error('Offer pagination next URL is invalid.'); }
  if (parsed.origin !== C2B_REMOVAL01_SANDBOX_ORIGIN || parsed.hostname !== 'api.sandbox.ebay.com') {
    throw new Error('Offer pagination next URL leaves the Sandbox host.');
  }
  if (seen.has(parsed.toString())) throw new Error('Offer pagination repeated a next URL.');
  seen.add(parsed.toString());
  return true;
}

export async function readAllC2BRemoval01Offers(
  inventory: ReadOnlyInventoryApi,
  sku: string,
  limit = 25
): Promise<{ offers: OfferPageEvidence['offers']; pages: OfferPageEvidence[]; total: number }> {
  const pages: OfferPageEvidence[] = [];
  const offers: OfferPageEvidence['offers'] = [];
  const seenNext = new Set<string>();
  let offset = 0;
  let total: number | undefined;
  for (let page = 1; page <= 1000; page += 1) {
    const response = asRecord(await inventory.getOffers(sku, undefined, limit, offset));
    const rawOffers = response.offers;
    if (!Array.isArray(rawOffers)) throw new Error('Offer response has no complete offers array.');
    const pageSize = response.size;
    const pageTotal = response.total;
    if (!Number.isSafeInteger(pageSize) || pageSize !== rawOffers.length) throw new Error('Offer response has an invalid page size.');
    if (typeof pageTotal !== 'number' || !Number.isSafeInteger(pageTotal) || pageTotal !== 1) throw new Error('Offer response does not contain exactly one Offer.');
    if (total !== undefined && total !== pageTotal) throw new Error('Offer total changed while paging.');
    total = pageTotal;
    const hasNext = validateNext(response.next, seenNext);
    const pageEvidence = { page, offset, total: pageTotal, size: pageSize, next: hasNext, offers: rawOffers.map(sanitizeOffer) };
    pages.push(pageEvidence);
    offers.push(...pageEvidence.offers);
    if (!hasNext) {
      if (offers.length !== pageTotal) throw new Error('Offer pagination ended before the advertised total.');
      validateC2BRemoval01OfferIdentity(sku, offers);
      return { offers, pages, total: pageTotal };
    }
    if (pageSize < 1) throw new Error('Offer pagination cannot advance from an empty page.');
    offset += 1;
  }
  throw new Error('Offer pagination exceeded the safety bound.');
}

function revisionSource(revision: ReadOnlyRevision): JsonRecord {
  return revision.source ?? revision as unknown as JsonRecord;
}

function checkpointSource(checkpoint: ReadOnlyCheckpoint): JsonRecord {
  return checkpoint.source ?? checkpoint as unknown as JsonRecord;
}

export async function collectC2BRemoval01Evidence(
  api: ReadOnlySellerApi,
  data: ReadOnlyDataAccess,
  env: NodeJS.ProcessEnv
): Promise<JsonRecord> {
  validateC2BRemoval01Environment(env);
  const seller = await api.trading.getCurrentUserIdentity();
  assertVerifiedSellerIdentity(seller);
  const group = asRecord(await api.inventory.getInventoryItemGroup(C2B_REMOVAL01_GROUP_KEY));
  const items: JsonRecord[] = [];
  const offers: JsonRecord[] = [];
  for (const sku of C2B_REMOVAL01_SKUS) {
    items.push(sanitizeItem(sku, await api.inventory.getInventoryItem(sku)));
    const offerEvidence = await readAllC2BRemoval01Offers(api.inventory, sku);
    offers.push({ sku, total: offerEvidence.total, pageCount: offerEvidence.pages.length, pages: offerEvidence.pages });
  }

  const revisions = await data.variationListings.listRevisionsByGroupId(C2B_REMOVAL01_GROUP_ID);
  const revision = revisions.find((candidate) => (candidate.revisionId ?? revisionSource(candidate).revision_id) === C2B_REMOVAL01_REVISION_ID);
  if (!revision) throw new Error('Exact frozen c2 revision was not found.');
  const source = revisionSource(revision);
  const groupId = revision.groupId ?? source.group_id;
  if (groupId !== C2B_REMOVAL01_GROUP_ID) throw new Error('Frozen revision group identity mismatch.');
  const snapshotVersion = source.snapshot_version;
  const snapshotDigest = revision.snapshotDigest ?? source.snapshot_digest;
  const operationCount = revision.operationCount ?? source.operation_count;
  if (snapshotVersion !== 3 || snapshotDigest !== C2B_REMOVAL01_SNAPSHOT_DIGEST || operationCount !== 1) throw new Error('Frozen revision is not the exact v3 one-operation snapshot.');
  const checkpoints = (await data.variationListings.listCheckpointsByRevisionId(C2B_REMOVAL01_REVISION_ID)).sort((left, right) => Number(checkpointSource(left).checkpoint_number ?? left.checkpointNumber ?? 0) - Number(checkpointSource(right).checkpoint_number ?? right.checkpointNumber ?? 0));
  if (checkpoints.length !== 2 || checkpoints.some((checkpoint) => (checkpoint.revisionId ?? checkpointSource(checkpoint).revision_id) !== C2B_REMOVAL01_REVISION_ID)) throw new Error('The frozen c2 revision does not have exactly two checkpoints.');
  const checkpointEvidence = checkpoints.map((checkpoint) => {
    const value = checkpointSource(checkpoint);
    return { checkpointId: value.checkpoint_id ?? null, operationKey: value.operation_key ?? checkpoint.operationKey ?? null, state: value.state ?? checkpoint.state ?? null, observedRemoteState: value.observed_remote_state ?? checkpointSource(checkpoint).observedRemoteState ?? null };
  });
  if (checkpointEvidence[0]?.operationKey !== 'remove-group-membership' || checkpointEvidence[0].state !== 'started' || checkpointEvidence[0].observedRemoteState !== null || checkpointEvidence[1]?.operationKey !== 'remove-group-membership' || checkpointEvidence[1].state !== 'unknown' || checkpointEvidence[1].observedRemoteState !== 'unknown') throw new Error('Frozen c2 checkpoints do not match started then unknown/unknown progression.');
  const retirement = await data.variationListings.remoteRetirementStore.load(C2B_REMOVAL01_REVISION_ID);
  const operationPlan = revision.operationPlan ?? (source.operation_plan as unknown[] | undefined) ?? [];
  if (operationPlan.length !== 1) throw new Error('Frozen revision operation plan cardinality is not exactly one.');

  return {
    seller,
    group: { groupKey: C2B_REMOVAL01_GROUP_KEY, groupId: C2B_REMOVAL01_GROUP_ID, listingId: C2B_REMOVAL01_LISTING_ID, metadata: pickGroupMetadata(group), imageEvidence: imageEvidence(group.imageUrls) },
    items,
    offers,
    revision: {
      revisionId: C2B_REMOVAL01_REVISION_ID,
      snapshotVersion: snapshotVersion ?? null,
      snapshotDigest: snapshotDigest ?? null,
      operationCount: operationCount ?? null,
      planCardinality: operationPlan.length,
    },
    checkpoints: checkpointEvidence,
    retirement: { state: retirement?.state ?? null },
  };
}

function assertVerifiedSellerIdentity(identity: { userId: string }): void {
  const userId = identity.userId.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._@-]{1,127}$/.test(userId) || /^(?:mock|placeholder|example|sample|unknown)(?:[-_ ].*)?$|^(?:test|sandbox|user)(?:[-_ ]?\d*)?$/i.test(userId)) throw new Error('Trading GetUser returned an invalid or placeholder seller UserID.');
}

export async function runInspectC2BRemoval01Cli(
  argv: readonly string[] = process.argv.slice(2),
  dependencies: C2BRemoval01Dependencies = {}
): Promise<void> {
  parseC2BRemoval01Args(argv);
  const loadRootEnvironment = dependencies.loadRootEnvironment ?? (await import('@/config/env-paths.js')).loadRootEnvironment;
  loadRootEnvironment();
  const env = dependencies.env ?? process.env;
  const createApi = dependencies.createApi ?? (async () => await createReadOnlySandboxApi(env, dependencies.fetchImpl));
  const createDataAccess = dependencies.createDataAccess ?? (async () => {
    const { getSidecarDataAccess } = await import('@/data/sidecar-data.js');
    return getSidecarDataAccess();
  });
  const evidence = await collectC2BRemoval01Evidence(await createApi(), await createDataAccess(), env);
  (dependencies.print ?? console.log)(JSON.stringify(evidence, null, 2));
}

/**
 * Native, non-persisting Sandbox client. It deliberately does not construct or
 * initialize EbaySellerApi: that client may refresh and persist tokens.
 */
export async function createReadOnlySandboxApi(
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch = fetch
): Promise<ReadOnlySellerApi> {
  validateC2BRemoval01Environment(env);
  const [{ loadEbayOAuthValidationConfig }, { exchangeRefreshTokenForAccessToken }] = await Promise.all([
    import('@/ebay/config.js'),
    import('@/ebay/oauth-client.js'),
  ]);
  const oauthConfig = loadEbayOAuthValidationConfig(env);
  exactOrigin(oauthConfig.apiBaseUrl, 'resolved eBay REST base URL');
  exactOrigin(oauthConfig.oauthBaseUrl, 'resolved eBay OAuth base URL');
  let token: { accessToken: string; tokenType: string };
  try {
    token = await exchangeRefreshTokenForAccessToken(oauthConfig, { fetchImpl });
  } catch {
    throw new Error('Sandbox OAuth refresh failed.');
  }
  const apiGet = async (path: string, params?: Record<string, string | number>): Promise<unknown> => {
    const url = new URL(`${C2B_REMOVAL01_SANDBOX_ORIGIN}${path}`);
    for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, String(value));
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        'Accept-Language': 'en-US',
        'Content-Language': 'en-US',
      },
    });
    if (!response.ok) throw new Error(`Sandbox read failed (${response.status}).`);
    try { return await response.json(); } catch { throw new Error('Sandbox read returned invalid JSON.'); }
  };
  const tradingIdentity = async (): Promise<{ userId: string; username?: string }> => {
    const request = '<?xml version="1.0" encoding="utf-8"?><GetUserRequest xmlns="urn:ebay:apis:eBLBaseComponents" />';
    const response = await fetchImpl(`${C2B_REMOVAL01_SANDBOX_ORIGIN}/ws/api.dll`, {
      method: 'POST',
      headers: {
        'X-EBAY-API-SITEID': '0',
        'X-EBAY-API-COMPATIBILITY-LEVEL': '1451',
        'X-EBAY-API-CALL-NAME': 'GetUser',
        'X-EBAY-API-IAF-TOKEN': token.accessToken,
        'Content-Type': 'text/xml',
      },
      body: request,
    });
    if (!response.ok) throw new Error(`Sandbox Trading identity read failed (${response.status}).`);
    const xml = await response.text();
    const userId = /<UserID>([^<]+)<\/UserID>/i.exec(xml)?.[1]?.trim();
    if (!userId) throw new Error('Trading GetUser did not return a seller UserID.');
    const username = /<UserName>([^<]+)<\/UserName>/i.exec(xml)?.[1]?.trim();
    return username ? { userId, username } : { userId };
  };
  return {
    trading: { getCurrentUserIdentity: tradingIdentity },
    inventory: {
      getInventoryItemGroup: async (groupKey) => await apiGet(`/sell/inventory/v1/inventory_item_group/${encodeURIComponent(groupKey)}`),
      getInventoryItem: async (sku) => await apiGet(`/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`),
      getOffers: async (sku, _marketplaceId, limit, offset) => await apiGet('/sell/inventory/v1/offer', { sku: sku ?? '', limit: limit ?? 25, offset: offset ?? 0 }),
    },
  };
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
const modulePath = resolve(fileURLToPath(import.meta.url));
if (entryPath && modulePath === entryPath) {
  runInspectC2BRemoval01Cli().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Read-only C2B preflight failed.');
    process.exitCode = 1;
  });
}
