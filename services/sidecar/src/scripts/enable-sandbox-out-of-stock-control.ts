#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadEbayOAuthValidationConfig } from '@/ebay/config.js';
import { exchangeRefreshTokenForAccessToken } from '@/ebay/oauth-client.js';

export const OUT_OF_STOCK_SANDBOX_ORIGIN = 'https://api.sandbox.ebay.com' as const;
export const OUT_OF_STOCK_SANDBOX_OAUTH_URL =
  `${OUT_OF_STOCK_SANDBOX_ORIGIN}/identity/v1/oauth2/token` as const;
export const OUT_OF_STOCK_SANDBOX_TRADING_URL =
  `${OUT_OF_STOCK_SANDBOX_ORIGIN}/ws/api.dll` as const;
export const OUT_OF_STOCK_MARKETPLACE = 'EBAY_US' as const;

export const QTY_REGRESSION_GROUP_ID = '9203d8fb-8873-461d-a653-f893e557dfa2' as const;
export const QTY_REGRESSION_TARGET_SKU = 'BSKBL-QtyRegression01-000001' as const;
export const QTY_REGRESSION_TARGET_OFFER_ID = '11996375010' as const;
export const QTY_REGRESSION_LISTING_ID = '110591486626' as const;
export const QTY_REGRESSION_FAILED_REVISION_ID = 'bf19368a-3434-4bdf-99da-b35955d497a0' as const;
export const QTY_REGRESSION_TARGET_VARIATION_ID = 'af1bce8c-84ac-4c32-80e4-d533d1ec2bb1' as const;
export const QTY_REGRESSION_FAILED_OPERATION_KEY = `child-offer:${QTY_REGRESSION_TARGET_VARIATION_ID}` as const;

type JsonRecord = Record<string, unknown>;

export interface DurableListingDataAccess {
  variationListings: {
    listGroups(): Promise<readonly JsonRecord[]>;
    listRevisionsByGroupId(groupId: string): Promise<readonly JsonRecord[]>;
    listCheckpointsByRevisionId(revisionId: string): Promise<readonly JsonRecord[]>;
  };
}

export interface SandboxSellerApi {
  getTradingUser(): Promise<{ userId: string }>;
  getTradingItem(itemId: string): Promise<{ itemId: string; sellerUserId: string }>;
  getUserPreferences(): Promise<{ outOfStockControl: boolean }>;
  setUserPreferences(): Promise<{ ack: string }>;
}

export interface EnableOutOfStockDependencies {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  loadRootEnvironment?: () => void;
  createApi?: (env: NodeJS.ProcessEnv, fetchImpl?: typeof fetch) => Promise<SandboxSellerApi> | SandboxSellerApi;
  createDataAccess?: () => Promise<DurableListingDataAccess> | DurableListingDataAccess;
  print?: (value: string) => void;
}

export interface EnableOutOfStockReport {
  status: 'verified' | 'blocked';
  environment: 'sandbox';
  sellerUserId: string;
  listingId: string;
  before: boolean | null;
  setUserPreferencesCalls: 0 | 1;
  setAck: string | null;
  after: boolean | null;
  reason?: string;
}

function asRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as JsonRecord;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} is missing.`);
  return value.trim();
}

function exactSandboxUrl(value: string, label: string, expected: string): void {
  let parsed: URL;
  let expectedUrl: URL;
  try {
    parsed = new URL(value);
    expectedUrl = new URL(expected);
  } catch {
    throw new Error(`${label} must be the exact Sandbox eBay endpoint.`);
  }
  if (
    parsed.origin !== expectedUrl.origin ||
    parsed.pathname !== expectedUrl.pathname ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(`${label} must be the exact Sandbox eBay endpoint.`);
  }
}

/** Guard all credential provenance before loading an OAuth helper. */
export function validateOutOfStockEnvironment(env: NodeJS.ProcessEnv): void {
  if (env.EBAY_ENVIRONMENT !== 'sandbox') throw new Error('EBAY_ENVIRONMENT must be explicitly sandbox.');
  if (env.EBAY_MARKETPLACE_ID !== OUT_OF_STOCK_MARKETPLACE) {
    throw new Error('EBAY_MARKETPLACE_ID must be EBAY_US.');
  }
  if (Object.entries(env).some(([name, value]) => /EBAY.*PRODUCTION|PRODUCTION.*EBAY/i.test(name) && Boolean(value?.trim()))) {
    throw new Error('Production eBay credential material is forbidden.');
  }
  const refreshToken = env.EBAY_REFRESH_TOKEN?.trim() ?? '';
  const userRefreshToken = env.EBAY_USER_REFRESH_TOKEN?.trim() ?? '';
  if (refreshToken && userRefreshToken) {
    throw new Error('Set exactly one user OAuth refresh-token source.');
  }
  if (!refreshToken && !userRefreshToken) {
    throw new Error('A user OAuth refresh token is required.');
  }
  if (env.EBAY_API_BASE_URL !== undefined) {
    exactSandboxUrl(env.EBAY_API_BASE_URL.trim(), 'EBAY_API_BASE_URL', OUT_OF_STOCK_SANDBOX_ORIGIN);
  }
  if (env.EBAY_OAUTH_BASE_URL !== undefined) {
    exactSandboxUrl(env.EBAY_OAUTH_BASE_URL.trim(), 'EBAY_OAUTH_BASE_URL', OUT_OF_STOCK_SANDBOX_OAUTH_URL);
  }
}

function parseXmlTag(xml: string, tag: string): string[] {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...xml.matchAll(new RegExp(`<(?:(?:[A-Za-z0-9_-]+):)?${escaped}\\b[^>]*>([^<]*)<\\/(?:(?:[A-Za-z0-9_-]+):)?${escaped}>`, 'gi'))]
    .map((match) => match[1]?.trim() ?? '')
    .filter(Boolean);
}

function parseTradingResponse(xml: string, callName: string): string {
  const normalized = xml.trim().replace(/^<\?xml[^>]*>\s*/i, '');
  const escaped = callName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const root = new RegExp(
    `^<(?:(?:[A-Za-z0-9_-]+):)?${escaped}Response\\s+xmlns=(['"])urn:ebay:apis:eBLBaseComponents\\1[^>]*>([\\s\\S]*)</(?:(?:[A-Za-z0-9_-]+):)?${escaped}Response>$`,
    'i'
  ).exec(normalized);
  if (!root?.[2] || new RegExp(`<(?:(?:[A-Za-z0-9_-]+):)?${escaped}Response\\b`, 'i').test(root[2])) {
    throw new Error(`Trading ${callName} response root is malformed or duplicated.`);
  }
  if (/<(?:(?:[A-Za-z0-9_-]+):)?Errors?\\b/i.test(root[2])) {
    throw new Error(`Trading ${callName} response contains an error payload.`);
  }
  return root[2];
}

function parseElement(xml: string, tag: string, label: string): string {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = [...xml.matchAll(new RegExp(`<(?:(?:[A-Za-z0-9_-]+):)?${escaped}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[A-Za-z0-9_-]+):)?${escaped}>`, 'gi'))];
  const content = matches[0]?.[1];
  if (matches.length !== 1 || content === undefined) throw new Error(`${label} is missing or ambiguous.`);
  return content;
}

function strictAck(xml: string, callName: string): string {
  const acks = parseXmlTag(xml, 'Ack');
  if (acks.length !== 1) throw new Error(`Trading ${callName} response has an ambiguous Ack.`);
  const ack = acks[0];
  if (ack !== 'Success') throw new Error(`Trading ${callName} returned Ack=${ack}.`);
  return ack;
}

function requireSellerId(value: unknown, label: string): string {
  const userId = nonEmptyString(value, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9._@-]{1,127}$/.test(userId) || /^(?:mock|placeholder|example|sample|unknown|test|sandbox|user)(?:[-_ ].*)?$/i.test(userId)) {
    throw new Error(`${label} is malformed or a placeholder.`);
  }
  return userId;
}

function requestXml(callName: string, body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?><${callName}Request xmlns="urn:ebay:apis:eBLBaseComponents">${body}</${callName}Request>`;
}

export async function createSandboxApi(env: NodeJS.ProcessEnv, fetchImpl: typeof fetch = fetch): Promise<SandboxSellerApi> {
  validateOutOfStockEnvironment(env);
  const config = loadEbayOAuthValidationConfig(env);
  exactSandboxUrl(config.apiBaseUrl, 'resolved eBay REST base URL', OUT_OF_STOCK_SANDBOX_ORIGIN);
  exactSandboxUrl(config.oauthBaseUrl, 'resolved eBay OAuth base URL', OUT_OF_STOCK_SANDBOX_OAUTH_URL);
  const oauthFetch: typeof fetch = async (input, init) => {
    const requested = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (requested !== OUT_OF_STOCK_SANDBOX_OAUTH_URL) throw new Error('OAuth request left the exact Sandbox endpoint.');
    return await fetchImpl(input, { ...init, redirect: 'error' });
  };
  const token = await exchangeRefreshTokenForAccessToken(config, { fetchImpl: oauthFetch });

  const tradingPost = async (callName: 'GetUser' | 'GetItem' | 'GetUserPreferences' | 'SetUserPreferences', body: string): Promise<string> => {
    const response = await fetchImpl(OUT_OF_STOCK_SANDBOX_TRADING_URL, {
      method: 'POST',
      headers: {
        'X-EBAY-API-SITEID': '0',
        'X-EBAY-API-COMPATIBILITY-LEVEL': '1451',
        'X-EBAY-API-CALL-NAME': callName,
        'X-EBAY-API-IAF-TOKEN': token.accessToken,
        'Content-Type': 'text/xml',
      },
      body: requestXml(callName, body),
      redirect: 'error',
    });
    if (!response.ok) throw new Error(`Trading ${callName} request failed (${response.status}).`);
    if (response.url && response.url !== OUT_OF_STOCK_SANDBOX_TRADING_URL) {
      throw new Error(`Trading ${callName} response left the exact Sandbox endpoint.`);
    }
    return await response.text();
  };

  return {
    getTradingUser: async () => {
      const body = parseTradingResponse(await tradingPost('GetUser', ''), 'GetUser');
      strictAck(body, 'GetUser');
      const ids = parseXmlTag(parseElement(body, 'User', 'Trading GetUser User'), 'UserID');
      if (ids.length !== 1) throw new Error('Trading GetUser returned an ambiguous UserID.');
      return { userId: requireSellerId(ids[0], 'Trading GetUser UserID') };
    },
    getTradingItem: async (itemId) => {
      const expected = nonEmptyString(itemId, 'listing ID');
      if (!/^\d{1,32}$/.test(expected)) throw new Error('listing ID must be numeric.');
      const body = parseTradingResponse(await tradingPost('GetItem', `<ItemID>${expected}</ItemID><DetailLevel>ReturnAll</DetailLevel>`), 'GetItem');
      strictAck(body, 'GetItem');
      const item = parseElement(body, 'Item', 'Trading GetItem Item');
      const observedIds = parseXmlTag(item, 'ItemID');
      const sellerIds = parseXmlTag(parseElement(item, 'Seller', 'Trading GetItem Seller'), 'UserID');
      if (observedIds.length !== 1 || observedIds[0] !== expected || sellerIds.length !== 1) {
        throw new Error('Trading GetItem returned ambiguous listing ownership evidence.');
      }
      return { itemId: expected, sellerUserId: requireSellerId(sellerIds[0], 'Trading GetItem seller UserID') };
    },
    getUserPreferences: async () => {
      const body = parseTradingResponse(await tradingPost('GetUserPreferences', '<ShowOutOfStockControlPreference>true</ShowOutOfStockControlPreference>'), 'GetUserPreferences');
      strictAck(body, 'GetUserPreferences');
      const values = parseXmlTag(body, 'OutOfStockControlPreference');
      const value = values[0];
      if (values.length !== 1 || value === undefined || !/^(?:true|false)$/i.test(value)) {
        throw new Error('Trading GetUserPreferences returned an ambiguous OutOfStockControlPreference.');
      }
      return { outOfStockControl: value.toLowerCase() === 'true' };
    },
    setUserPreferences: async () => {
      const body = parseTradingResponse(await tradingPost('SetUserPreferences', '<OutOfStockControlPreference>true</OutOfStockControlPreference>'), 'SetUserPreferences');
      return { ack: strictAck(body, 'SetUserPreferences') };
    },
  };
}

function sourceOf(value: JsonRecord): JsonRecord {
  return asRecord(value.source) && Object.keys(asRecord(value.source)).length > 0 ? asRecord(value.source) : value;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Read only the immutable confirmed fixture identity; never adopts current eBay data. */
export async function resolveQtyRegressionListingId(data: DurableListingDataAccess): Promise<string> {
  const groups = await data.variationListings.listGroups();
  const matches = groups.filter((row) => {
    const source = sourceOf(row);
    return readString(row.groupId ?? source.group_id) === QTY_REGRESSION_GROUP_ID;
  });
  if (matches.length !== 1) throw new Error('QtyRegression01 durable group identity is missing or ambiguous.');
  const group = sourceOf(matches[0]);
  const confirmedRevision = group.lastConfirmedRevision ?? group.last_confirmed_revision;
  if (typeof confirmedRevision !== 'number' || !Number.isSafeInteger(confirmedRevision) || confirmedRevision < 1) {
    throw new Error('QtyRegression01 has no durable confirmed revision.');
  }
  const revisions = await data.variationListings.listRevisionsByGroupId(QTY_REGRESSION_GROUP_ID);
  const failedRevision = revisions.find((row) => {
    const source = sourceOf(row);
    return readString(row.groupId ?? source.group_id) === QTY_REGRESSION_GROUP_ID &&
      nonEmptyString(row.revisionId ?? source.revision_id, 'revision ID') === QTY_REGRESSION_FAILED_REVISION_ID;
  });
  if (!failedRevision) throw new Error('QtyRegression01 frozen failed revision is missing.');
  const failedSource = sourceOf(failedRevision);
  const failedPlan = failedRevision.operationPlan ?? failedSource.operation_plan;
  if (!Array.isArray(failedPlan) || !failedPlan.some((operation) => {
    const row = asRecord(operation);
    return row.operation_key === QTY_REGRESSION_FAILED_OPERATION_KEY &&
      row.target_ref === QTY_REGRESSION_TARGET_SKU;
  })) {
    throw new Error('QtyRegression01 frozen failed revision target operation is not proven.');
  }
  const candidates = revisions.filter((row) => {
    const source = sourceOf(row);
    return readString(row.groupId ?? source.group_id) === QTY_REGRESSION_GROUP_ID &&
      (row.capturedDesiredRevision ?? source.captured_desired_revision) === confirmedRevision;
  });
  if (candidates.length !== 1) throw new Error('QtyRegression01 durable confirmed revision is missing or ambiguous.');
  const revision = sourceOf(candidates[0]);
  const revisionId = nonEmptyString(candidates[0].revisionId ?? revision.revision_id, 'confirmed revision ID');
  const root = asRecord(revision.snapshot);
  const confirmed = asRecord(root.confirmed);
  const remote = asRecord(confirmed.remote);
  const listingId = nonEmptyString(remote.listingId, 'confirmed listing ID');
  if (listingId !== QTY_REGRESSION_LISTING_ID || !/^\d{1,32}$/.test(listingId)) {
    throw new Error('QtyRegression01 confirmed listing ID does not match the durable fixture.');
  }
  const offerIds = asRecord(remote.offerIdsBySku);
  if (offerIds[QTY_REGRESSION_TARGET_SKU] !== QTY_REGRESSION_TARGET_OFFER_ID) {
    throw new Error('QtyRegression01 durable target Offer identity does not match.');
  }
  const checkpoints = await data.variationListings.listCheckpointsByRevisionId(revisionId);
  const evidence = checkpoints.filter((checkpoint) => {
    const row = sourceOf(checkpoint);
    const state = checkpoint.state ?? row.state;
    const observed = checkpoint.observedRemoteState ?? row.observed_remote_state;
    const cpEvidence = asRecord(checkpoint.evidence ?? row.evidence);
    const nestedOffer = asRecord(cpEvidence.offer);
    const evidenceListingId = cpEvidence.listingId ?? nestedOffer.listingId;
    return (state === 'confirmed_complete' || state === 'confirmed_no_op') && observed === 'present' && evidenceListingId === listingId;
  });
  if (evidence.length === 0) throw new Error('QtyRegression01 confirmed revision lacks terminal listing evidence.');
  return listingId;
}

export function parseEnableOutOfStockArgs(argv: readonly string[]): 'dry-run' | 'execute' {
  if (argv.length !== 1 || (argv[0] !== '--dry-run' && argv[0] !== '--execute')) {
    throw new Error('Supply exactly one explicit --dry-run or --execute flag.');
  }
  return argv[0] === '--dry-run' ? 'dry-run' : 'execute';
}

export async function runEnableSandboxOutOfStockControlCli(
  argv: readonly string[] = process.argv.slice(2),
  dependencies: EnableOutOfStockDependencies = {}
): Promise<EnableOutOfStockReport> {
  const mode = parseEnableOutOfStockArgs(argv);
  const loadRootEnvironment = dependencies.loadRootEnvironment ?? (await import('@/config/env-paths.js')).loadRootEnvironment;
  loadRootEnvironment();
  const env = dependencies.env ?? process.env;
  validateOutOfStockEnvironment(env);
  const api = dependencies.createApi ? await dependencies.createApi(env, dependencies.fetchImpl) : await createSandboxApi(env, dependencies.fetchImpl);
  const data = dependencies.createDataAccess ? await dependencies.createDataAccess() : await (async () => {
    const { getSidecarDataAccess } = await import('@/data/sidecar-data.js');
    return getSidecarDataAccess() as unknown as DurableListingDataAccess;
  })();
  const seller = await api.getTradingUser();
  const sellerUserId = requireSellerId(seller.userId, 'Trading GetUser UserID');
  const listingId = await resolveQtyRegressionListingId(data);
  const listing = await api.getTradingItem(listingId);
  if (listing.itemId !== listingId || listing.sellerUserId !== sellerUserId) {
    throw new Error('Trading GetItem seller ownership does not match authenticated seller.');
  }
  const before = await api.getUserPreferences();
  if (typeof before.outOfStockControl !== 'boolean') throw new Error('GetUserPreferences returned an ambiguous preference.');
  if (before.outOfStockControl || mode === 'dry-run') {
    const report: EnableOutOfStockReport = {
      status: before.outOfStockControl ? 'verified' : 'blocked', environment: 'sandbox', sellerUserId, listingId,
      before: before.outOfStockControl, setUserPreferencesCalls: 0, setAck: null,
      after: before.outOfStockControl ? true : null, ...(mode === 'dry-run' && !before.outOfStockControl ? { reason: 'dry-run: mutation not attempted' } : {}),
    };
    (dependencies.print ?? console.log)(JSON.stringify(report, null, 2));
    return report;
  }
  let setAck: string | null = null;
  let after: boolean | null = null;
  let reason: string | undefined;
  try {
    setAck = (await api.setUserPreferences()).ack;
  } catch {
    reason = 'SetUserPreferences failed or returned an unknown response; no retry attempted.';
  }
  if (setAck === 'Success') {
    try {
      after = (await api.getUserPreferences()).outOfStockControl;
      if (after !== true) reason = 'Post-write GetUserPreferences did not confirm true.';
    } catch {
      reason = 'Post-write GetUserPreferences was ambiguous; no retry attempted.';
    }
  } else {
    try {
      after = (await api.getUserPreferences()).outOfStockControl;
    } catch {
      after = null;
    }
  }
  const report: EnableOutOfStockReport = {
    status: setAck === 'Success' && after === true ? 'verified' : 'blocked', environment: 'sandbox', sellerUserId, listingId,
    before: false, setUserPreferencesCalls: 1, setAck, after, ...(reason ? { reason } : {}),
  };
  (dependencies.print ?? console.log)(JSON.stringify(report, null, 2));
  return report;
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
const modulePath = resolve(fileURLToPath(import.meta.url));
if (entryPath && modulePath === entryPath) {
  runEnableSandboxOutOfStockControlCli().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Sandbox out-of-stock control failed.');
    process.exitCode = 1;
  });
}
