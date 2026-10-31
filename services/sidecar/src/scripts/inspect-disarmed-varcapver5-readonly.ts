#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildVariationListingHistoricalInventoryPayloadBundle, buildVariationListingInventoryPayloadBundle } from '@/ebay/variation-listing-payloads.js';
import {
  classifyVariationListingStatus,
  inventoryItemSemanticMismatch,
  offerSemanticMismatch,
  projectInventoryItemSemanticSnapshot,
  projectOfferSemanticSnapshot,
} from '@/ebay/variation-listing-sandbox-pilot.js';
import { loadEbayOAuthValidationConfig } from '@/ebay/config.js';
import { exchangeRefreshTokenForAccessToken } from '@/ebay/oauth-client.js';
import { loadRootEnvironment } from '@/config/env-paths.js';
import { reconstructConfirmedRemoteIdentity } from '@/ebay/variation-listing-active-revision.js';

export const DISARMED_VARCAPVER5_GROUP_ID = 'd92dd52d-e817-449c-b957-e3b3e0acc36b' as const;
export const DISARMED_VARCAPVER5_GROUP_KEY = 'VL-G-D92DD52DE817449CB957E3B3E0ACC36B' as const;
export const DISARMED_VARCAPVER5_REVISION_ID = 'a95e470b-c8c1-45c0-a063-64be56d78770' as const;
export const DISARMED_VARCAPVER5_CONFIRMED_REVISION_ID = '760707da-e846-47cc-b655-3cd29c8b075f' as const;
export const DISARMED_VARCAPVER5_LISTING_ID = '110591479471' as const;
export const DISARMED_VARCAPVER5_TARGET_SKU = 'BSKBL-DisarmedVarCapVer5-000002' as const;
export const DISARMED_VARCAPVER5_TARGET_VARIATION_ID = 'bf858d09-a2e5-4265-9dd0-e82d66c13264' as const;
export const DISARMED_VARCAPVER5_CAPTURED_DESIRED_REVISION = 25 as const;
export const DISARMED_VARCAPVER5_LAST_CONFIRMED_REVISION = 23 as const;
export const DISARMED_VARCAPVER5_MARKETPLACE = 'EBAY_US' as const;
export const DISARMED_VARCAPVER5_CONTENT_LANGUAGE = 'en-US' as const;
export const DISARMED_VARCAPVER5_SANDBOX_ORIGIN = 'https://api.sandbox.ebay.com' as const;
export const DISARMED_VARCAPVER5_OAUTH_URL = `${DISARMED_VARCAPVER5_SANDBOX_ORIGIN}/identity/v1/oauth2/token` as const;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonRecord = Record<string, unknown>;

interface ReadOnlyRevision { source?: JsonRecord; [key: string]: unknown }
interface ReadOnlyCheckpoint { source?: JsonRecord; [key: string]: unknown }
interface ReadOnlyDataAccess {
  variationListings: {
    listRevisionsByGroupId(groupId: string): Promise<ReadOnlyRevision[]>;
    listCheckpointsByRevisionId(revisionId: string): Promise<ReadOnlyCheckpoint[]>;
  };
}

interface ReadOnlyDependencies {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  loadRootEnvironment?: () => void;
  createDataAccess?: () => Promise<ReadOnlyDataAccess> | ReadOnlyDataAccess;
  print?: (value: string) => void;
}

interface ReadOnlySandboxApi {
  getGroup(groupKey: string): Promise<JsonRecord>;
  getItem(sku: string): Promise<JsonRecord>;
  getOffers(sku: string, marketplaceId: string): Promise<JsonRecord[]>;
  getTradingUser(): Promise<{ userId: string }>;
  getTradingItem(listingId: string): Promise<JsonRecord>;
}

function record(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as JsonRecord;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as JsonRecord)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function digestJson(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function requiredInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`${label} must be a safe integer.`);
  return value as number;
}

function requiredNonNegativeInteger(value: unknown, label: string): number {
  const parsed = requiredInteger(value, label);
  if (parsed < 0 || parsed > 2_147_483_647) throw new Error(`${label} must be a non-negative int32.`);
  return parsed;
}

function safeWatermark(value: unknown): number | string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) return value;
  return null;
}

function safeOperationText(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value) ? value : null;
}

function sourceOf(value: ReadOnlyRevision | ReadOnlyCheckpoint): JsonRecord {
  return value.source ?? value;
}

function exactSandboxUrl(value: string, label: string, expectedPath?: string): void {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error(`${label} is not a valid URL.`); }
  if (
    parsed.origin !== DISARMED_VARCAPVER5_SANDBOX_ORIGIN ||
    (expectedPath !== undefined && parsed.pathname !== expectedPath) ||
    parsed.username || parsed.password || parsed.search || parsed.hash
  ) throw new Error(`${label} must resolve exactly to the Sandbox eBay endpoint.`);
}

/** Pure guard. Never prints credential material and rejects production provenance. */
export function validateDisarmedVarcapVer5Environment(env: NodeJS.ProcessEnv): void {
  if (env.EBAY_ENVIRONMENT !== 'sandbox') throw new Error('Sandbox environment is required.');
  if ((env.EBAY_MARKETPLACE_ID ?? DISARMED_VARCAPVER5_MARKETPLACE).trim() !== DISARMED_VARCAPVER5_MARKETPLACE) throw new Error('EBAY_MARKETPLACE_ID must be EBAY_US.');
  if ((env.EBAY_CONTENT_LANGUAGE ?? DISARMED_VARCAPVER5_CONTENT_LANGUAGE).trim() !== DISARMED_VARCAPVER5_CONTENT_LANGUAGE) throw new Error('EBAY_CONTENT_LANGUAGE must resolve to en-US.');
  if (Object.entries(env).some(([name, value]) => name.includes('EBAY') && name.includes('PRODUCTION') && Boolean(value?.trim()))) throw new Error('Production eBay credential material is forbidden.');
  if (env.SUPABASE_PROJECT_REF !== 'fmiliwxthjonjwywuqta') throw new Error('The canonical Supabase project is required.');
  let supabaseUrl: URL;
  try { supabaseUrl = new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? ''); } catch { throw new Error('The canonical Supabase URL is required.'); }
  if (supabaseUrl.protocol !== 'https:' || supabaseUrl.hostname !== 'fmiliwxthjonjwywuqta.supabase.co' || supabaseUrl.pathname !== '/' || supabaseUrl.search || supabaseUrl.hash) throw new Error('The canonical Supabase URL is required.');
  if (!(env.EBAY_REFRESH_TOKEN?.trim() || env.EBAY_USER_REFRESH_TOKEN?.trim())) throw new Error('A Sandbox refresh token is required.');
  exactSandboxUrl(env.EBAY_API_BASE_URL?.trim() ?? DISARMED_VARCAPVER5_SANDBOX_ORIGIN, 'EBAY_API_BASE_URL', '/');
  exactSandboxUrl(env.EBAY_OAUTH_BASE_URL?.trim() ?? DISARMED_VARCAPVER5_OAUTH_URL, 'EBAY_OAUTH_BASE_URL', '/identity/v1/oauth2/token');
}

export function parseDisarmedVarcapVer5Args(argv: readonly string[]): void {
  if (argv.length !== 0) throw new Error('This command accepts no arguments and is read-only.');
}

function safePathDiff(actual: unknown, expected: unknown, prefix = '', output: string[] = []): string[] {
  if (output.length >= 80) return output;
  if (actual !== null && expected !== null && typeof actual === 'object' && typeof expected === 'object' && !Array.isArray(actual) && !Array.isArray(expected)) {
    const keys = new Set([...Object.keys(actual as JsonRecord), ...Object.keys(expected as JsonRecord)]);
    for (const key of [...keys].sort()) {
      const next = prefix ? `${prefix}.${key}` : key;
      if (!(key in (actual as JsonRecord))) output.push(`${next}:missing_actual`);
      else if (!(key in (expected as JsonRecord))) output.push(`${next}:unexpected_actual`);
      else safePathDiff((actual as JsonRecord)[key], (expected as JsonRecord)[key], next, output);
      if (output.length >= 80) break;
    }
    return output;
  }
  if (canonicalJson(actual) !== canonicalJson(expected)) output.push(prefix || 'value');
  return output;
}

function quantityFromItem(value: JsonRecord): number {
  const availability = record(value.availability, 'Inventory Item availability');
  const ship = record(availability.shipToLocationAvailability, 'Inventory Item shipToLocationAvailability');
  return requiredNonNegativeInteger(ship.quantity, 'Inventory Item quantity');
}

function quantityFromOffer(value: JsonRecord): number {
  return requiredNonNegativeInteger(value.availableQuantity, 'Offer availableQuantity');
}

function listingIdFromOffer(value: JsonRecord): string | null {
  const listing = value.listing;
  if (listing !== undefined && listing !== null) {
    const nested = requiredString(record(listing, 'Offer listing').listingId, 'Offer listingId');
    if (value.listingId !== undefined && requiredString(value.listingId, 'Offer top-level listingId') !== nested) {
      throw new Error('Offer listing identity aliases conflict.');
    }
    return nested;
  }
  return typeof value.listingId === 'string' && value.listingId.trim() ? value.listingId.trim() : null;
}

function listingStatusFromOffer(value: JsonRecord): string | null {
  const listing = value.listing;
  if (listing !== undefined && listing !== null) {
    const row = record(listing, 'Offer listing');
    if (row.listingStatus !== undefined && row.status !== undefined && String(row.listingStatus).trim().toUpperCase() !== String(row.status).trim().toUpperCase()) {
      throw new Error('Offer listing status aliases conflict.');
    }
    const status = row.listingStatus ?? row.status;
    return typeof status === 'string' && status.trim() ? status.trim().toUpperCase() : null;
  }
  return null;
}

function normalizeRemoteOffer(value: JsonRecord, expectedSku: string, expectedMarketplace: string): JsonRecord {
  const status = requiredString(value.status, 'Offer status').toUpperCase();
  if (status !== 'PUBLISHED' && status !== 'UNPUBLISHED') throw new Error('Offer status is unsupported.');
  const listingId = listingIdFromOffer(value);
  const listingStatus = listingStatusFromOffer(value);
  const lifecycle = classifyVariationListingStatus(listingStatus as never).lifecycleClass;
  const quantity = quantityFromOffer(value);
  const sku = requiredString(value.sku, 'Offer sku');
  const marketplaceId = requiredString(value.marketplaceId, 'Offer marketplaceId');
  if (sku !== expectedSku || marketplaceId !== expectedMarketplace) throw new Error('Offer response contains an ambiguous SKU or marketplace identity.');
  return {
    offerId: requiredString(value.offerId, 'Offer offerId'),
    sku,
    marketplaceId,
    status,
    listingId,
    listingStatus,
    lifecycleClass: lifecycle,
    availableQuantity: quantity,
    semanticMismatch: null,
  };
}

function offerPayloadDifferences(actual: JsonRecord | undefined, expected: JsonRecord): string[] {
  if (!actual) return ['offer absent'];
  try {
    return safePathDiff(projectOfferSemanticSnapshot(actual), projectOfferSemanticSnapshot(expected));
  } catch {
    return ['payload shape'];
  }
}

function parseTag(xml: string, tag: string): string | undefined {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`<(?:(?:[A-Za-z0-9_-]+):)?${escaped}[^>]*>([^<]*)</(?:(?:[A-Za-z0-9_-]+):)?${escaped}>`, 'i').exec(xml);
  return match?.[1]?.trim();
}

function parseTagAttribute(xml: string, tag: string, attribute: string): string | undefined {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedAttribute = attribute.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`<(?:(?:[A-Za-z0-9_-]+):)?${escapedTag}[^>]*\\b${escapedAttribute}=["']([^"']+)["']`, 'i').exec(xml);
  return match?.[1]?.trim();
}

function parseTradingItem(xml: string, listingId: string): JsonRecord {
  const observedListingId = parseTag(xml, 'ItemID');
  if (observedListingId !== listingId) throw new Error(`Trading GetItem returned listing ${String(observedListingId)} instead of the frozen listing.`);
  const variationContainer = /<(?:(?:[A-Za-z0-9_-]+):)?Variations[^>]*>([\s\S]*?)<\/(?:(?:[A-Za-z0-9_-]+):)?Variations>/i.exec(xml)?.[1];
  if (!variationContainer) throw new Error('Trading GetItem response has no Variations container.');
  const rows = [...variationContainer.matchAll(/<(?:(?:[A-Za-z0-9_-]+):)?Variation[^>]*>([\s\S]*?)<\/(?:(?:[A-Za-z0-9_-]+):)?Variation>/gi)].map((match) => match[1]);
  if (rows.length === 0) throw new Error('Trading GetItem response has no Variation rows.');
  const variations = rows.map((row) => {
    const sku = parseTag(row, 'SKU');
    const quantityRaw = parseTag(row, 'Quantity');
    const soldRaw = parseTag(row, 'QuantitySold');
    const startPrice = parseTag(row, 'StartPrice');
    const currency = parseTagAttribute(row, 'StartPrice', 'currencyID') ?? parseTagAttribute(row, 'StartPrice', 'CurrencyID');
    const quantity = Number(quantityRaw);
    const sold = Number(soldRaw);
    const numericPrice = Number(startPrice);
    if (
      !sku || !quantityRaw || !soldRaw ||
      !Number.isSafeInteger(quantity) || quantity < 0 || quantity > 2_147_483_647 ||
      !Number.isSafeInteger(sold) || sold < 0 || sold > quantity ||
      !startPrice || !Number.isFinite(numericPrice) || numericPrice < 0 || !currency
    ) throw new Error('Trading GetItem variation has malformed quantity or price.');
    return { sku, quantity, quantitySold: sold, sellableQuantity: quantity - sold, price: { currency: currency.toUpperCase(), value: numericPrice.toFixed(2) } };
  });
  if (new Set(variations.map((row) => row.sku)).size !== variations.length) throw new Error('Trading GetItem response contains duplicate variation SKUs.');
  return { listingId, variations };
}

async function createReadOnlySandboxApi(env: NodeJS.ProcessEnv, fetchImpl: typeof fetch = fetch): Promise<ReadOnlySandboxApi> {
  validateDisarmedVarcapVer5Environment(env);
  const config = loadEbayOAuthValidationConfig(env);
  exactSandboxUrl(config.apiBaseUrl, 'resolved eBay REST base URL', '/');
  exactSandboxUrl(config.oauthBaseUrl, 'resolved eBay OAuth base URL', '/identity/v1/oauth2/token');
  const token = await exchangeRefreshTokenForAccessToken(config, { fetchImpl });
  const restGet = async (path: string, params?: Record<string, string | number>): Promise<JsonRecord> => {
    const url = new URL(`${DISARMED_VARCAPVER5_SANDBOX_ORIGIN}${path}`);
    for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, String(value));
    const response = await fetchImpl(url, { method: 'GET', headers: { Authorization: `Bearer ${token.accessToken}`, 'Accept-Language': DISARMED_VARCAPVER5_CONTENT_LANGUAGE, 'Content-Language': DISARMED_VARCAPVER5_CONTENT_LANGUAGE } });
    if (!response.ok) throw new Error(`Sandbox read ${path} failed (${response.status}).`);
    const body = await response.json();
    return record(body, 'Sandbox JSON response');
  };
  const tradingPost = async (callName: 'GetUser' | 'GetItem', body: string): Promise<string> => {
    const response = await fetchImpl(`${DISARMED_VARCAPVER5_SANDBOX_ORIGIN}/ws/api.dll`, {
      method: 'POST',
      headers: {
        'X-EBAY-API-SITEID': '0',
        'X-EBAY-API-COMPATIBILITY-LEVEL': '1451',
        'X-EBAY-API-CALL-NAME': callName,
        'X-EBAY-API-IAF-TOKEN': token.accessToken,
        'Content-Type': 'text/xml',
      },
      body,
    });
    if (!response.ok) throw new Error(`Sandbox Trading ${callName} read failed (${response.status}).`);
    const xml = await response.text();
    const ack = parseTag(xml, 'Ack');
    if (ack !== 'Success' && ack !== 'Warning') {
      throw new Error(`Sandbox Trading ${callName} returned ${ack ? `Ack=${ack}` : 'no Ack'}.`);
    }
    return xml;
  };
  return {
    getGroup: async (groupKey) => await restGet(`/sell/inventory/v1/inventory_item_group/${encodeURIComponent(groupKey)}`),
    getItem: async (sku) => await restGet(`/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`),
    getOffers: async (sku, marketplaceId) => {
      const offers: JsonRecord[] = [];
      const seen = new Set<string>();
      let offset = 0;
      let total: number | undefined;
      for (let page = 0; page < 1000; page += 1) {
        const response = await restGet('/sell/inventory/v1/offer', { sku, marketplace_id: marketplaceId, limit: 25, offset });
        const rows = response.offers;
        if (!Array.isArray(rows)) throw new Error('Offer response has no complete offers array.');
        const size = requiredNonNegativeInteger(response.size, 'Offer response size');
        const pageTotal = requiredNonNegativeInteger(response.total, 'Offer response total');
        if (size !== rows.length) throw new Error('Offer response size does not match its offers array.');
        if (total !== undefined && total !== pageTotal) throw new Error('Offer total changed while paging.');
        total = pageTotal;
        offers.push(...rows.map((value) => record(value, 'Offer row')));
        const next = response.next;
        if (next === undefined || next === null || next === '') {
          if (offers.length !== pageTotal) throw new Error('Offer pagination ended before the advertised total.');
          return offers;
        }
        if (typeof next !== 'string') throw new Error('Offer pagination next URL is invalid.');
        const nextUrl = new URL(next);
        if (nextUrl.origin !== DISARMED_VARCAPVER5_SANDBOX_ORIGIN || nextUrl.username || nextUrl.password || nextUrl.hash) throw new Error('Offer pagination next URL leaves the Sandbox host.');
        if (seen.has(nextUrl.toString())) throw new Error('Offer pagination repeated a next URL.');
        seen.add(nextUrl.toString());
        offset += size;
        if (size === 0) throw new Error('Offer pagination cannot advance from an empty page.');
      }
      throw new Error('Offer pagination exceeded the safety bound.');
    },
    getTradingUser: async () => {
      const xml = await tradingPost('GetUser', '<?xml version="1.0" encoding="utf-8"?><GetUserRequest xmlns="urn:ebay:apis:eBLBaseComponents" />');
      const userId = parseTag(xml, 'UserID');
      if (!userId || !/^[A-Za-z0-9][A-Za-z0-9._@-]{1,127}$/.test(userId) || /^(?:mock|placeholder|example|sample|unknown|test|sandbox|user)(?:[-_ ].*)?$/i.test(userId)) throw new Error('Trading GetUser returned an invalid or placeholder seller identity.');
      return { userId };
    },
    getTradingItem: async (listingId) => {
      const xml = await tradingPost('GetItem', `<?xml version="1.0" encoding="utf-8"?><GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ItemID>${listingId}</ItemID><DetailLevel>ReturnAll</DetailLevel></GetItemRequest>`);
      return parseTradingItem(xml, listingId);
    },
  };
}

function groupSummary(raw: JsonRecord, expected: JsonRecord): JsonRecord {
  const responseGroupKey = raw.inventoryItemGroupKey ?? raw.groupKey ?? null;
  const actualPayload = {
    title: raw.title,
    description: raw.description,
    aspects: raw.aspects,
    variantSKUs: raw.variantSKUs,
    variesBy: raw.variesBy,
    ...(raw.imageUrls === undefined ? {} : { imageUrls: raw.imageUrls }),
  };
  const { inventoryItemGroupKey: _inventoryItemGroupKey, groupKey: _groupKey, ...expectedPayload } = expected;
  return {
    requestedGroupKey: DISARMED_VARCAPVER5_GROUP_KEY,
    responseGroupKey,
    variantSKUs: Array.isArray(raw.variantSKUs) ? raw.variantSKUs : null,
    payloadDigest: digestJson(actualPayload),
    payloadDifferences: safePathDiff(actualPayload, expectedPayload),
  };
}

function checkpointSummary(checkpoint: JsonRecord): JsonRecord {
  const evidence = checkpoint.evidence && typeof checkpoint.evidence === 'object' && !Array.isArray(checkpoint.evidence)
    ? checkpoint.evidence as JsonRecord
    : null;
  const rawError = typeof evidence?.error === 'string' ? evidence.error.trim() : '';
  const safeError = rawError && /^Variation listing [A-Za-z0-9][A-Za-z0-9._:-]{0,127} listing-facing price does not match the confirmed pre-state before quantity mutation\.$/.test(rawError)
    ? rawError
    : null;
  return {
    operationKey: checkpoint.operation_key ?? null,
    attemptNumber: checkpoint.attempt_number ?? null,
    checkpointNumber: checkpoint.checkpoint_number ?? null,
    state: checkpoint.state ?? null,
    observedRemoteState: checkpoint.observed_remote_state ?? null,
    createdAt: typeof checkpoint.created_at === 'string' ? checkpoint.created_at : null,
    evidenceKeys: evidence ? Object.keys(evidence).sort() : [],
    error: rawError ? { message: safeError, digest: digestJson(rawError), redacted: safeError === null } : null,
  };
}

function operationSummary(operation: JsonRecord): JsonRecord {
  const intent = operation.intent;
  return {
    operationKey: safeOperationText(operation.operation_key),
    operationKind: safeOperationText(operation.operation_kind),
    sequenceNo: safeWatermark(operation.sequence_no),
    targetRef: safeOperationText(operation.target_ref),
    intentDigest: typeof operation.intent_digest === 'string' && /^[a-f0-9]{64}$/.test(operation.intent_digest) ? operation.intent_digest : null,
    intentKeys: intent && typeof intent === 'object' && !Array.isArray(intent) ? Object.keys(intent as JsonRecord).sort() : null,
  };
}

function offerPredicate(
  actual: JsonRecord | undefined,
  actualRaw: JsonRecord | undefined,
  expected: JsonRecord,
  expectedOfferId: string | null,
  terminal: boolean,
): JsonRecord {
  if (!actual) return { predicate: terminal ? 'activeOfferIgnoringQuantity' : 'activeOffer', result: 'null', mismatch: 'proven_absent_or_empty' };
  const reasons: string[] = [];
  const actualOfferId = typeof actual.offerId === 'string' ? actual.offerId : null;
  if (!expectedOfferId) reasons.push('offer identity (frozen offerId unavailable)');
  else if (actualOfferId !== expectedOfferId) reasons.push('offer identity (offerId)');
  if (actual.sku !== expected.sku) reasons.push('offer identity (sku)');
  if (actual.marketplaceId !== expected.marketplaceId) reasons.push('offer identity (marketplaceId)');
  if (actual.status !== 'PUBLISHED') reasons.push('offer identity (status)');
  if (actual.listingId !== DISARMED_VARCAPVER5_LISTING_ID) reasons.push('offer identity (listingId)');
  if (actual.lifecycleClass !== 'active') reasons.push('offer identity (lifecycle)');
  let semanticMismatch: string | null = null;
  try { semanticMismatch = offerSemanticMismatch(projectOfferSemanticSnapshot(actualRaw), expected) as string | null; } catch { semanticMismatch = 'payload shape'; }
  if (semanticMismatch && !(terminal && semanticMismatch === 'available quantity')) reasons.push(`payload (${semanticMismatch})`);
  const quantity = typeof actual.availableQuantity === 'number' ? actual.availableQuantity : null;
  if (quantity === null || !Number.isSafeInteger(quantity) || quantity < 0 || quantity > 2_147_483_647) reasons.push('available quantity shape');
  return {
    predicate: terminal ? 'activeOfferIgnoringQuantity' : 'activeOffer',
    result: reasons.length === 0 ? 'match' : 'null',
    mismatch: reasons.length === 0 ? null : reasons,
    remote: { offerId: actualOfferId, availableQuantity: quantity, semanticMismatch, payloadDifferences: offerPayloadDifferences(actualRaw, expected) },
  };
}

function expectedQuantities(snapshot: JsonRecord): Record<string, { inventoryItemQuantity: number; offerQuantity: number; sellableQuantity: number }> {
  const remote = record(record(snapshot.confirmed, 'snapshot.confirmed').remote, 'snapshot.confirmed.remote');
  const values = record(remote.quantitiesBySku, 'snapshot.confirmed.remote.quantitiesBySku');
  const result: Record<string, { inventoryItemQuantity: number; offerQuantity: number; sellableQuantity: number }> = {};
  for (const [sku, raw] of Object.entries(values)) {
    const row = record(raw, `frozen remote quantity ${sku}`);
    const inventoryItemQuantity = requiredNonNegativeInteger(row.inventoryItemQuantity, `frozen Inventory Item quantity ${sku}`);
    const offerQuantity = requiredNonNegativeInteger(row.offerQuantity, `frozen Offer quantity ${sku}`);
    const sellableQuantity = requiredNonNegativeInteger(row.sellableQuantity, `frozen sellable quantity ${sku}`);
    if (sellableQuantity !== Math.min(inventoryItemQuantity, offerQuantity)) throw new Error(`Frozen sellable quantity ${sku} is inconsistent.`);
    result[sku] = { inventoryItemQuantity, offerQuantity, sellableQuantity };
  }
  return result;
}

function applyQuantities(bundle: JsonRecord, current: JsonRecord, confirmed: JsonRecord, quantities: Record<string, { sellableQuantity: number }>): JsonRecord {
  const clone = structuredClone(bundle) as JsonRecord;
  const currentVariations = Array.isArray(current.variations) ? current.variations : [];
  const confirmedById = new Map((Array.isArray(confirmed.variations) ? confirmed.variations : []).map((row) => {
    const entry = record(row, 'confirmed variation');
    return [requiredString(entry.variation_id, 'confirmed variation_id'), entry];
  }));
  const children = Array.isArray(clone.children) ? clone.children : [];
  for (const childRaw of children) {
    const child = record(childRaw, 'bundle child');
    const sku = requiredString(child.sku, 'bundle child sku');
    const variationId = requiredString(child.variationId, `bundle child ${sku} variationId`);
    const currentRow = currentVariations.map((row) => record(row, 'current variation')).find((row) => row.variation_id === variationId);
    const previousRow = confirmedById.get(variationId);
    if (!currentRow) throw new Error(`Frozen quantity evidence is missing variation ${variationId}.`);
    const currentCounter = requiredInteger(currentRow.quantity_adjustment_counter, `current quantity counter ${sku}`);
    let desired: number;
    if (!previousRow) {
      const copies = Array.isArray(current.copies) ? current.copies : [];
      desired = copies.filter((copy) => {
        const row = record(copy, `current copy ${sku}`);
        return row.variation_id === variationId && row.availability_state === 'available';
      }).length;
    } else {
      const baseline = quantities[sku]?.sellableQuantity;
      if (baseline === undefined) throw new Error(`Frozen quantity evidence is missing SKU ${sku}.`);
      const previousCounter = requiredInteger(previousRow.quantity_adjustment_counter, `confirmed quantity counter ${sku}`);
      desired = baseline + currentCounter - previousCounter;
    }
    if (!Number.isSafeInteger(desired) || desired < 0 || desired > 2_147_483_647) throw new Error(`Frozen desired quantity ${sku} is invalid.`);
    const item = record(child.inventoryItem, `bundle item ${sku}`);
    const availability = record(item.availability, `bundle item availability ${sku}`);
    const ship = record(availability.shipToLocationAvailability, `bundle item ship ${sku}`);
    ship.quantity = desired;
    const offer = record(child.offer, `bundle offer ${sku}`);
    offer.availableQuantity = desired;
    child.quantity = desired;
  }
  return clone;
}

function applyRemoteQuantities(
  bundle: JsonRecord,
  quantities: Record<string, { inventoryItemQuantity: number; offerQuantity: number; sellableQuantity: number }>,
): JsonRecord {
  const clone = structuredClone(bundle) as JsonRecord;
  const children = Array.isArray(clone.children) ? clone.children : [];
  for (const childRaw of children) {
    const child = record(childRaw, 'remote quantity bundle child');
    const sku = requiredString(child.sku, 'remote quantity bundle child sku');
    const quantity = quantities[sku];
    if (!quantity) throw new Error(`Frozen remote quantity is missing SKU ${sku}.`);
    const item = record(child.inventoryItem, `remote quantity item ${sku}`);
    const availability = record(item.availability, `remote quantity item availability ${sku}`);
    const ship = record(availability.shipToLocationAvailability, `remote quantity item ship ${sku}`);
    ship.quantity = quantity.inventoryItemQuantity;
    const offer = record(child.offer, `remote quantity offer ${sku}`);
    offer.availableQuantity = quantity.offerQuantity;
    child.quantity = quantity.sellableQuantity;
  }
  return clone;
}

export async function collectDisarmedVarcapVer5Evidence(api: ReadOnlySandboxApi, data: ReadOnlyDataAccess, env: NodeJS.ProcessEnv): Promise<JsonRecord> {
  validateDisarmedVarcapVer5Environment(env);
  await api.getTradingUser();
  const revisions = await data.variationListings.listRevisionsByGroupId(DISARMED_VARCAPVER5_GROUP_ID);
  const revision = revisions.find((candidate) => sourceOf(candidate).revision_id === DISARMED_VARCAPVER5_REVISION_ID);
  if (!revision) throw new Error('Exact frozen rev25 revision was not found.');
  const source = sourceOf(revision);
  if (source.group_id !== DISARMED_VARCAPVER5_GROUP_ID || source.captured_desired_revision !== DISARMED_VARCAPVER5_CAPTURED_DESIRED_REVISION || source.snapshot_version !== 3) throw new Error('Frozen revision identity/version/watermark mismatch.');
  const snapshot = record(source.snapshot, 'frozen revision snapshot');
  const snapshotDigest = requiredString(source.snapshot_digest, 'frozen revision snapshot_digest');
  if (digestJson(snapshot) !== snapshotDigest) throw new Error('Frozen revision snapshot digest mismatch.');
  const operationPlan = Array.isArray(source.operation_plan) ? source.operation_plan.map((entry) => record(entry, 'frozen operation plan entry')) : [];
  if (requiredNonNegativeInteger(source.operation_count, 'frozen operation_count') !== operationPlan.length || operationPlan.length === 0) throw new Error('Frozen operation plan cardinality mismatch.');
  const operationKeys = operationPlan.map((operation) => requiredString(operation.operation_key, 'frozen operation_key'));
  if (new Set(operationKeys).size !== operationKeys.length) throw new Error('Frozen operation plan contains duplicate operation keys.');
  const operationSummaries = operationPlan.map(operationSummary);
  for (const operation of operationPlan) {
    const hasIntent = Object.prototype.hasOwnProperty.call(operation, 'intent');
    const hasIntentDigest = Object.prototype.hasOwnProperty.call(operation, 'intent_digest');
    if (hasIntent !== hasIntentDigest || (hasIntent && (typeof operation.intent_digest !== 'string' || !/^[a-f0-9]{64}$/.test(operation.intent_digest) || digestJson(operation.intent) !== operation.intent_digest))) {
      throw new Error(`Frozen operation intent digest mismatch: ${JSON.stringify({ operation: operationSummary(operation), operations: operationSummaries })}.`);
    }
  }
  const current = record(snapshot.aggregate, 'snapshot.aggregate');
  const confirmedSnapshot = record(snapshot.confirmed, 'snapshot.confirmed');
  const confirmed = record(confirmedSnapshot.aggregate, 'snapshot.confirmed.aggregate');
  const currentGroup = record(current.group, 'snapshot.aggregate.group');
  const confirmedGroup = record(confirmed.group, 'snapshot.confirmed.aggregate.group');
  const confirmedRevisionId = typeof confirmedSnapshot.revisionId === 'string' ? confirmedSnapshot.revisionId : '';
  const confirmedRevision = revisions.find((candidate) => sourceOf(candidate).revision_id === confirmedRevisionId);
  const confirmedRevisionSource = confirmedRevision ? sourceOf(confirmedRevision) : undefined;
  const confirmedRevisionSnapshot = confirmedRevisionSource?.snapshot;
  const confirmedRevisionSnapshotDigest = confirmedRevisionSource?.snapshot_digest;
  let confirmedRevisionDigestValid = false;
  if (confirmedRevisionSnapshot !== undefined && typeof confirmedRevisionSnapshotDigest === 'string') {
    try { confirmedRevisionDigestValid = digestJson(record(confirmedRevisionSnapshot, 'confirmed revision snapshot')) === confirmedRevisionSnapshotDigest; } catch { confirmedRevisionDigestValid = false; }
  }
  const observedWatermarks = {
    revisionCapturedDesiredRevision: safeWatermark(source.captured_desired_revision),
    currentGroupDesiredRevision: safeWatermark(currentGroup.desired_revision),
    currentGroupLastConfirmedRevision: safeWatermark(currentGroup.last_confirmed_revision),
    confirmedRevisionId: safeWatermark(confirmedRevisionId),
    confirmedRevisionCapturedDesiredRevision: safeWatermark(confirmedRevisionSource?.captured_desired_revision),
    confirmedRevisionSnapshotDigest: typeof confirmedRevisionSnapshotDigest === 'string' ? confirmedRevisionSnapshotDigest : null,
    confirmedRevisionSnapshotDigestValid: confirmedRevisionDigestValid,
    confirmedGroupDesiredRevision: safeWatermark(confirmedGroup.desired_revision),
    confirmedGroupLastConfirmedRevision: safeWatermark(confirmedGroup.last_confirmed_revision),
  };
  if (
    currentGroup.group_id !== DISARMED_VARCAPVER5_GROUP_ID ||
    confirmedGroup.group_id !== DISARMED_VARCAPVER5_GROUP_ID ||
    source.captured_desired_revision !== DISARMED_VARCAPVER5_CAPTURED_DESIRED_REVISION ||
    source.snapshot_version !== 3 ||
    currentGroup.desired_revision !== DISARMED_VARCAPVER5_CAPTURED_DESIRED_REVISION ||
    confirmedRevisionId.trim() === '' ||
    currentGroup.last_confirmed_revision !== DISARMED_VARCAPVER5_LAST_CONFIRMED_REVISION ||
    confirmedGroup.desired_revision !== DISARMED_VARCAPVER5_LAST_CONFIRMED_REVISION ||
    confirmedRevisionId !== DISARMED_VARCAPVER5_CONFIRMED_REVISION_ID ||
    !confirmedRevisionSource ||
    confirmedRevisionSource.group_id !== DISARMED_VARCAPVER5_GROUP_ID ||
    confirmedRevisionSource.captured_desired_revision !== DISARMED_VARCAPVER5_LAST_CONFIRMED_REVISION ||
    !confirmedRevisionDigestValid
  ) {
    throw new Error(`Frozen rev25 current/confirmed aggregate watermark mismatch: ${JSON.stringify(observedWatermarks)}.`);
  }
  const confirmedRemote = record(confirmedSnapshot.remote, 'snapshot.confirmed.remote');
  if (confirmedRemote.listingId !== DISARMED_VARCAPVER5_LISTING_ID) throw new Error('Frozen listing identity mismatch.');
  const loadedConfirmedSnapshot = record(confirmedRevisionSource!.snapshot, 'loaded confirmed revision snapshot');
  if (
    canonicalJson(confirmed) !== canonicalJson(record(loadedConfirmedSnapshot.aggregate, 'loaded confirmed revision aggregate')) ||
    canonicalJson(confirmedSnapshot.representativeImages) !== canonicalJson(loadedConfirmedSnapshot.representativeImages)
  ) throw new Error('Embedded confirmed revision aggregate or representative images do not match durable rev23.');
  const confirmedRevisionCheckpoints = (await data.variationListings.listCheckpointsByRevisionId(confirmedRevisionId)).map(sourceOf);
  const reconstructedConfirmedRemote = reconstructConfirmedRemoteIdentity(
    confirmedRevisionSource as never,
    confirmedRevisionCheckpoints as never,
  );
  const embeddedConfirmedIdentity = {
    listingId: confirmedRemote.listingId,
    offerIdsBySku: confirmedRemote.offerIdsBySku,
  };
  if (canonicalJson(reconstructedConfirmedRemote) !== canonicalJson(embeddedConfirmedIdentity)) {
    throw new Error(`Embedded confirmed remote identity does not match durable rev23 checkpoints: ${JSON.stringify(safePathDiff(reconstructedConfirmedRemote, embeddedConfirmedIdentity))}.`);
  }
  const checkpoints = (await data.variationListings.listCheckpointsByRevisionId(DISARMED_VARCAPVER5_REVISION_ID)).map(sourceOf).sort((left, right) => Number(left.attempt_number ?? 0) - Number(right.attempt_number ?? 0) || Number(left.checkpoint_number ?? 0) - Number(right.checkpoint_number ?? 0));
  if (checkpoints.some((checkpoint) => checkpoint.revision_id !== DISARMED_VARCAPVER5_REVISION_ID)) throw new Error('Checkpoint belongs to a different revision.');
  if (checkpoints.some((checkpoint) => !operationKeys.includes(requiredString(checkpoint.operation_key, 'checkpoint operation_key')))) throw new Error('Checkpoint does not belong to the frozen operation plan.');
  const targetOperation = operationPlan.find((operation) =>
    operation.operation_kind === 'child_offer_write' &&
    operation.target_ref === DISARMED_VARCAPVER5_TARGET_SKU
  );
  const targetIntent = targetOperation?.intent;
  const targetIntentRecord = targetIntent && typeof targetIntent === 'object' && !Array.isArray(targetIntent) ? targetIntent as JsonRecord : null;
  if (
    !targetOperation ||
    requiredString(targetOperation.operation_key, 'target operation_key').trim() !== `child-offer:${DISARMED_VARCAPVER5_TARGET_VARIATION_ID}` ||
    !targetIntentRecord ||
    targetIntentRecord.sku !== DISARMED_VARCAPVER5_TARGET_SKU ||
    targetIntentRecord.variationId !== DISARMED_VARCAPVER5_TARGET_VARIATION_ID
  ) {
    throw new Error(`Frozen target operation mismatch: ${JSON.stringify({
      matching: targetOperation ? operationSummary(targetOperation) : null,
      intent: targetIntentRecord ? {
        sku: safeWatermark(targetIntentRecord.sku),
        variationId: safeWatermark(targetIntentRecord.variationId),
        operationKeyMatches: requiredString(targetOperation?.operation_key, 'target operation_key').trim() === `child-offer:${DISARMED_VARCAPVER5_TARGET_VARIATION_ID}`,
        skuMatches: targetIntentRecord.sku === DISARMED_VARCAPVER5_TARGET_SKU,
        variationIdMatches: targetIntentRecord.variationId === DISARMED_VARCAPVER5_TARGET_VARIATION_ID,
      } : null,
      operations: operationSummaries,
    })}.`);
  }
  const targetCheckpoints = checkpoints.filter((checkpoint) => checkpoint.operation_key === targetOperation.operation_key);
  if (targetCheckpoints.length === 0) throw new Error('Frozen target child-offer checkpoints are missing.');
  const remoteQuantities = expectedQuantities(snapshot);
  const offerIds = record(confirmedRemote.offerIdsBySku, 'frozen offerIdsBySku');
  let targetOfferId = typeof offerIds[DISARMED_VARCAPVER5_TARGET_SKU] === 'string' ? offerIds[DISARMED_VARCAPVER5_TARGET_SKU] as string : null;
  for (const checkpoint of targetCheckpoints) {
    const evidence = checkpoint.evidence;
    if (evidence && typeof evidence === 'object' && !Array.isArray(evidence)) {
      const evidenceRecord = evidence as JsonRecord;
      const nestedOffer = evidenceRecord.offer && typeof evidenceRecord.offer === 'object' && !Array.isArray(evidenceRecord.offer) ? evidenceRecord.offer as JsonRecord : undefined;
      if (nestedOffer?.offerId !== undefined && evidenceRecord.offerId !== undefined && nestedOffer.offerId !== evidenceRecord.offerId) {
        throw new Error('Frozen target checkpoint offer identity aliases conflict.');
      }
      const candidate = nestedOffer?.offerId ?? evidenceRecord.offerId;
      if (candidate !== undefined) {
        if (typeof candidate !== 'string' || !candidate.trim() || (targetOfferId && targetOfferId !== candidate)) throw new Error('Frozen target offer identity evidence conflicts.');
        targetOfferId = candidate;
      }
    }
  }
  const confirmedBundleBase = buildVariationListingHistoricalInventoryPayloadBundle({ aggregate: confirmed as never, representativeImages: record(snapshot.confirmed, 'snapshot.confirmed').representativeImages as never[] });
  const confirmedBundle = applyRemoteQuantities(confirmedBundleBase as unknown as JsonRecord, remoteQuantities);
  const desiredBundle = applyQuantities(
    buildVariationListingInventoryPayloadBundle({ aggregate: current as never, representativeImages: snapshot.representativeImages as never[] }) as unknown as JsonRecord,
    current,
    confirmed,
    remoteQuantities,
  );
  const expectedBeforeChild = (confirmedBundle.children as unknown as JsonRecord[]).find((child) => child.sku === DISARMED_VARCAPVER5_TARGET_SKU);
  const expectedAfterChild = (desiredBundle.children as unknown as JsonRecord[]).find((child) => child.sku === DISARMED_VARCAPVER5_TARGET_SKU);
  if (!expectedBeforeChild || !expectedAfterChild) throw new Error('Frozen target SKU is missing from PRE/AFTER payloads.');
  const expectedBeforeOffer = record(expectedBeforeChild.offer, 'frozen PRE Offer');
  const expectedAfterOffer = record(expectedAfterChild.offer, 'frozen AFTER Offer');
  const groupRaw = await api.getGroup(DISARMED_VARCAPVER5_GROUP_KEY);
  const currentSkus = Array.isArray(current.variations) ? current.variations.map((row) => requiredString(record(row, 'current variation').sku, 'current SKU')) : [];
  if (currentSkus.length < 2 || currentSkus.length > 3 || new Set(currentSkus).size !== currentSkus.length || !currentSkus.includes(DISARMED_VARCAPVER5_TARGET_SKU)) throw new Error('Frozen current variation SKU set is ambiguous or missing the target.');
  if (
    groupRaw.inventoryItemGroupKey !== undefined && groupRaw.groupKey !== undefined &&
    groupRaw.inventoryItemGroupKey !== groupRaw.groupKey
  ) throw new Error('Remote group identity aliases conflict.');
  const remoteGroupKey = groupRaw.inventoryItemGroupKey ?? groupRaw.groupKey;
  if (remoteGroupKey !== undefined && remoteGroupKey !== DISARMED_VARCAPVER5_GROUP_KEY) throw new Error('Remote group identity does not match the frozen group key.');
  const items: JsonRecord[] = [];
  const offers: JsonRecord[] = [];
  const rawOffersBySku = new Map<string, JsonRecord[]>();
  const remoteOfferIds = new Set<string>();
  for (const sku of currentSkus) {
    const expectedChild = (confirmedBundle.children as unknown as JsonRecord[]).find((child) => child.sku === sku);
    const desiredChild = (desiredBundle.children as unknown as JsonRecord[]).find((child) => child.sku === sku);
    if (!expectedChild || !desiredChild) throw new Error(`Frozen SKU ${sku} missing from payload bundle.`);
    const rawItem = await api.getItem(sku);
    if (rawItem.sku !== undefined && requiredString(rawItem.sku, `Inventory Item ${sku} sku`) !== sku) throw new Error(`Inventory Item ${sku} identity mismatch.`);
    if (
      rawItem.groupIds !== undefined && rawItem.inventoryItemGroupKeys !== undefined &&
      canonicalJson(rawItem.groupIds) !== canonicalJson(rawItem.inventoryItemGroupKeys)
    ) throw new Error(`Inventory Item ${sku} group aliases conflict.`);
    const itemGroups = rawItem.groupIds ?? rawItem.inventoryItemGroupKeys;
    if (!Array.isArray(itemGroups) || itemGroups.length !== 1 || itemGroups[0] !== DISARMED_VARCAPVER5_GROUP_KEY) throw new Error(`Inventory Item ${sku} group association is ambiguous or mismatched.`);
    const itemSemantic = projectInventoryItemSemanticSnapshot({ ...rawItem, sku });
    const expectedItem = { ...record(expectedChild.inventoryItem, `frozen PRE Item ${sku}`), sku };
    const desiredItem = { ...record(desiredChild.inventoryItem, `frozen AFTER Item ${sku}`), sku };
    items.push({ sku, groupKeys: Array.isArray(rawItem.groupIds) ? rawItem.groupIds : Array.isArray(rawItem.inventoryItemGroupKeys) ? rawItem.inventoryItemGroupKeys : null, quantity: quantityFromItem(rawItem), preSemanticMismatch: inventoryItemSemanticMismatch(itemSemantic, expectedItem), afterSemanticMismatch: inventoryItemSemanticMismatch(itemSemantic, desiredItem) });
    const rawOffers = await api.getOffers(sku, DISARMED_VARCAPVER5_MARKETPLACE);
    rawOffersBySku.set(sku, rawOffers);
    const normalized = rawOffers.map((offer) => normalizeRemoteOffer(offer, sku, DISARMED_VARCAPVER5_MARKETPLACE));
    if (normalized.length > 1) throw new Error(`Offer response for ${sku} is ambiguous: multiple offers.`);
    for (const offer of normalized) {
      const offerId = requiredString(offer.offerId, `Offer ${sku} offerId`);
      if (remoteOfferIds.has(offerId)) throw new Error('Remote Offer identity is duplicated across SKUs.');
      remoteOfferIds.add(offerId);
      const raw = rawOffers.find((candidate) => candidate.offerId === offer.offerId)!;
      try { offer.semanticMismatch = offerSemanticMismatch(projectOfferSemanticSnapshot(raw), record(expectedChild.offer, `frozen PRE Offer ${sku}`)); } catch { offer.semanticMismatch = 'payload shape'; }
      offer.prePayloadDifferences = offerPayloadDifferences(raw, record(expectedChild.offer, `frozen PRE Offer ${sku}`));
      offer.afterSemanticMismatch = (() => { try { return offerSemanticMismatch(projectOfferSemanticSnapshot(raw), record(desiredChild.offer, `frozen AFTER Offer ${sku}`)); } catch { return 'payload shape'; } })();
      offer.afterPayloadDifferences = offerPayloadDifferences(raw, record(desiredChild.offer, `frozen AFTER Offer ${sku}`));
    }
    offers.push({ sku, count: normalized.length, offers: normalized });
  }
  const targetOfferRows = (offers.find((entry) => entry.sku === DISARMED_VARCAPVER5_TARGET_SKU)?.offers as JsonRecord[] | undefined) ?? [];
  if (targetOfferRows.length > 1) throw new Error('Target Offer identity is ambiguous.');
  const targetOffer = targetOfferRows[0];
  const targetRawOffers = rawOffersBySku.get(DISARMED_VARCAPVER5_TARGET_SKU) ?? [];
  const targetRawOffer = targetRawOffers[0];
  const targetPredicate = offerPredicate(targetOffer, targetRawOffer, expectedAfterOffer, targetOfferId, targetCheckpoints.at(-1)?.state === 'confirmed_complete' || targetCheckpoints.at(-1)?.state === 'confirmed_no_op');
  const listing = await api.getTradingItem(DISARMED_VARCAPVER5_LISTING_ID);
  const listingRows = Array.isArray(listing.variations) ? listing.variations as JsonRecord[] : [];
  const listingTarget = listingRows.find((row) => row.sku === DISARMED_VARCAPVER5_TARGET_SKU);
  const expectedListingRows = (desiredBundle.children as unknown as JsonRecord[])
    .filter((child) => requiredNonNegativeInteger(child.quantity, 'frozen desired listing quantity') > 0)
    .map((child) => {
      const offer = record(child.offer, 'frozen desired listing Offer');
      const pricing = record(offer.pricingSummary, 'frozen desired listing pricingSummary');
      const price = record(pricing.price, 'frozen desired listing price');
      return {
        sku: requiredString(child.sku, 'frozen desired listing SKU'),
        sellableQuantity: requiredNonNegativeInteger(child.quantity, 'frozen desired listing quantity'),
        price: {
          currency: requiredString(price.currency, 'frozen desired listing currency').toUpperCase(),
          value: Number(requiredString(price.value, 'frozen desired listing price value')).toFixed(2),
        },
      };
    })
    .sort((left, right) => left.sku.localeCompare(right.sku));
  const actualListingRows = listingRows
    .map((row) => ({ sku: row.sku, sellableQuantity: row.sellableQuantity, price: row.price }))
    .sort((left, right) => String(left.sku).localeCompare(String(right.sku)));
  const listingDifferences = safePathDiff(actualListingRows, expectedListingRows);
  const targetItem = items.find((entry) => entry.sku === DISARMED_VARCAPVER5_TARGET_SKU);
  const targetItemQuantity = typeof targetItem?.quantity === 'number' ? targetItem.quantity : null;
  const targetOfferQuantity = typeof targetOffer?.availableQuantity === 'number' ? targetOffer.availableQuantity : null;
  return {
    environment: { ebay: 'sandbox', marketplaceId: DISARMED_VARCAPVER5_MARKETPLACE, contentLanguage: DISARMED_VARCAPVER5_CONTENT_LANGUAGE, sellerIdentityVerified: true },
    target: { groupId: DISARMED_VARCAPVER5_GROUP_ID, groupKey: DISARMED_VARCAPVER5_GROUP_KEY, revisionId: DISARMED_VARCAPVER5_REVISION_ID, capturedDesiredRevision: DISARMED_VARCAPVER5_CAPTURED_DESIRED_REVISION, lastConfirmedRevision: DISARMED_VARCAPVER5_LAST_CONFIRMED_REVISION, listingId: DISARMED_VARCAPVER5_LISTING_ID, sku: DISARMED_VARCAPVER5_TARGET_SKU, variationId: DISARMED_VARCAPVER5_TARGET_VARIATION_ID, offerId: targetOfferId },
    frozen: { snapshotDigest, watermarks: observedWatermarks, operationPlan: operationPlan.map(operationSummary), checkpoints: checkpoints.map(checkpointSummary), targetPre: { quantity: quantityFromOffer(expectedBeforeOffer), nonQuantityPayloadDigest: digestJson({ ...expectedBeforeOffer, availableQuantity: undefined }) }, targetAfter: { quantity: quantityFromOffer(expectedAfterOffer), nonQuantityPayloadDigest: digestJson({ ...expectedAfterOffer, availableQuantity: undefined }) } },
    remote: { group: groupSummary(groupRaw, record(confirmedBundle.group, 'frozen group')), inventoryItems: items, offers, trading: { listingId: listing.listingId, variationCount: listingRows.length, expectedVariationCount: expectedListingRows.length, listingDifferences, siblingStability: listingDifferences.length === 0 ? 'exact' : 'mismatch', target: listingTarget ? { present: true, quantity: listingTarget.quantity, quantitySold: listingTarget.quantitySold, sellableQuantity: listingTarget.sellableQuantity, price: listingTarget.price } : { present: false, representation: 'omitted_from_listing' } } },
    classification: { offerAfter: targetPredicate, zeroStockRepresentation: { inventoryItemQuantity: targetItemQuantity, offerQuantity: targetOfferQuantity, tradingTargetPresent: Boolean(listingTarget), state: targetItemQuantity === 0 && targetOfferQuantity === 0 ? 'exact_zero' : 'partial_remote_mismatch' } },
  };
}

export async function runInspectDisarmedVarcapVer5Cli(argv: readonly string[] = process.argv.slice(2), dependencies: ReadOnlyDependencies = {}): Promise<void> {
  parseDisarmedVarcapVer5Args(argv);
  const loadEnv = dependencies.loadRootEnvironment ?? loadRootEnvironment;
  loadEnv();
  const env = dependencies.env ?? process.env;
  const api = await createReadOnlySandboxApi(env, dependencies.fetchImpl);
  const data = dependencies.createDataAccess ? await dependencies.createDataAccess() : await (async () => { const { getSidecarDataAccess } = await import('@/data/sidecar-data.js'); return getSidecarDataAccess().variationListings as unknown as ReadOnlyDataAccess['variationListings']; })().then((variationListings) => ({ variationListings }));
  const evidence = await collectDisarmedVarcapVer5Evidence(api, data, env);
  (dependencies.print ?? console.log)(JSON.stringify(evidence, null, 2));
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
const modulePath = resolve(fileURLToPath(import.meta.url));
if (entryPath && modulePath === entryPath) {
  runInspectDisarmedVarcapVer5Cli().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Read-only DisarmedVarCapVer5 inspection failed.');
    process.exitCode = 1;
  });
}
