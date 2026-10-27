import { createHash } from 'node:crypto';

import type { Json } from '@ebay-inventory/data';

import { variationListingInventoryItemGroupPayloadSchema } from '@/ebay/variation-listing-payloads.js';

/**
 * The incident manifest is deliberately code-owned.  A caller cannot select
 * another group, revision, seller, or marketplace by passing a request body.
 * Selector values and the complete frozen payload are supplied by the
 * immutable revision store; inventing them here would be unsafe.
 */
export const C2B_REMOVAL01_MANIFEST = {
  sellerUserId: 'testuser_variationbuyer',
  marketplaceId: 'EBAY_US',
  listingId: '110591443545',
  groupId: '586051b7-970a-45bd-a53a-1d1a10285b42',
  groupKey: 'VL-G-586051B7970A45BDA53A1D1A10285B42',
  revisionId: '0f8a4786-12a3-45d9-b293-63e2a6318260',
  snapshotDigest: '602f38a42f0beb0f940a6f222c105ffa0914bbe0b0d3eff03a2830a0a6737727',
  desiredRevision: 6,
  confirmedRevision: 5,
  target: { sku: 'BSKBL-C2BRemoval01-000001', offerId: '11951367010', quantity: 0 },
  survivors: [
    { sku: 'BSKBL-C2BRemoval01-000002', offerId: '11951368010', quantity: 1 },
    { sku: 'BSKBL-C2BRemoval01-000003', offerId: '11951369010', quantity: 1 },
  ],
} as const;

export type IncidentRepairState =
  | 'planned'
  | 'started'
  | 'reconciled_post'
  | 'confirmed_post'
  | 'unknown';
export type IncidentLedgerState = IncidentRepairState | 'absent';
export type IncidentRemoteState = 'EXACT_PRE' | 'EXACT_CORRECTED_POST' | 'MIXED' | 'UNKNOWN';

export interface IncidentGroupRead { payload: Json; variantSKUs: string[] }
export interface IncidentItemRead {
  sku: string;
  groupKeys: string[] | null;
  payload: Json;
  quantity: number;
}
export interface IncidentOfferRead {
  offerId: string;
  sku: string;
  marketplaceId: string;
  status: 'PUBLISHED' | 'UNPUBLISHED';
  listingId: string | null;
  listingStatus?: string | null;
  availableQuantity: number;
  payload: Json;
}
export interface IncidentRemoteGateway {
  readSeller(): Promise<{ userId: string }>;
  readGroup(groupKey: string): Promise<IncidentGroupRead>;
  readItem(sku: string): Promise<IncidentItemRead>;
  readAllOffers(sku: string): Promise<{ complete: boolean; offers: IncidentOfferRead[] }>;
  replaceGroup(groupKey: string, payload: Json): Promise<void>;
}

/** Read-only remote capability. Inspection/classification cannot obtain a PUT method. */
export type IncidentReadOnlyRemoteGateway = Omit<IncidentRemoteGateway, 'replaceGroup'>;

export interface IncidentFrozenEvidence {
  /**
   * Canonical digest returned by the trusted immutable-revision store. This
   * pure module binds the value to the incident manifest; the SQL adapter is
   * responsible for proving the digest against the stored snapshot before
   * prepare succeeds (the module never pretends to reconstruct that snapshot).
   */
  originalSnapshotDigest: string;
  /** Immutable local target variation identity from the frozen v3 aggregate. */
  targetVariationId: string;
  /** Complete frozen group response, including all common fields. */
  groupPayload: Json;
  /** Immutable application-order mapping, never reconstructed from live UI. */
  selectorBySku: Readonly<Record<string, string>>;
  itemPayloadWithoutQuantityBySku: Readonly<Record<string, Json>>;
  offerPayloadWithoutQuantityBySku: Readonly<Record<string, Json>>;
}

export interface IncidentRepairPlan {
  /** Stable incident repair identity; intentionally equals the frozen revision id. */
  repairId: string;
  manifest: typeof C2B_REMOVAL01_MANIFEST;
  frozen: IncidentFrozenEvidence;
  correctedGroupPayload: Json;
  correctedPayloadDigest: string;
}

export interface IncidentRepairRecord {
  /** SQL-backed rows expose both keys; legacy injected fixtures may omit this alias. */
  repairId?: string;
  revisionId: string;
  state: IncidentRepairState;
  correctedPayloadDigest: string;
  evidence?: Json;
}

export interface IncidentRepairLedger {
  load(revisionId: string): Promise<IncidentRepairRecord | null>;
  prepare(plan: IncidentRepairPlan): Promise<IncidentRepairRecord>;
  start(revisionId: string): Promise<IncidentRepairRecord>;
  markPost(revisionId: string, state: 'reconciled_post' | 'confirmed_post', evidence: Json): Promise<IncidentRepairRecord>;
  markUnknown(revisionId: string, evidence: Json): Promise<IncidentRepairRecord>;
  /** Durable guarded bridge; this function, not the caller, appends c2. */
  appendTerminalC2(revisionId: string, evidence: Json): Promise<void>;
}

export class IncidentRepairCasConflictError extends Error {
  readonly code = 'INCIDENT_REPAIR_CAS_CONFLICT';

  constructor(message = 'incident repair CAS lost') {
    super(message);
    this.name = 'IncidentRepairCasConflictError';
  }
}

export function isIncidentRepairCasConflict(error: unknown): error is IncidentRepairCasConflictError {
  return error instanceof IncidentRepairCasConflictError
    || (error instanceof Error && (error as Error & { code?: unknown }).code === 'INCIDENT_REPAIR_CAS_CONFLICT');
}

/** Read-only ledger capability. This is the only ledger type accepted by inspection. */
export type IncidentReadOnlyLedger = Pick<IncidentRepairLedger, 'load'>;

export interface IncidentRepairResult {
  revisionId: string;
  remoteState: IncidentRemoteState;
  repairState: IncidentRepairState;
  putCount: number;
  c2TerminalAppended: boolean;
}

export interface IncidentInspectionResult extends Omit<IncidentRepairResult, 'repairState'> {
  /** True absence is distinct from an unpersisted/planned row. */
  repairState: IncidentLedgerState;
}

const MAX_QUANTITY = 2_147_483_647;
const digestHex = /^[0-9a-f]{64}$/;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([a], [b]) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function incidentJsonDigest(value: Json): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function obj(value: Json, label: string): Record<string, Json> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, Json>;
}

function exactJson(actual: unknown, expected: unknown): boolean {
  return canonical(actual) === canonical(expected);
}

function exactMembership(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length &&
    new Set(actual).size === actual.length &&
    new Set(expected).size === expected.length &&
    expected.every((value) => actual.includes(value));
}

function quantity(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > MAX_QUANTITY) throw new Error(`${label} quantity is invalid.`);
  return value as number;
}

function clone<T extends Json>(value: T): T { return structuredClone(value); }

function groupCollections(payload: Json): { group: Record<string, Json>; skus: string[]; values: string[] } {
  const group = obj(clone(payload), 'inventory item group');
  const skus = group.variantSKUs;
  const variesBy = obj(group.variesBy, 'group variesBy');
  const specs = variesBy.specifications;
  if (!Array.isArray(skus) || !Array.isArray(specs) || specs.length !== 1) throw new Error('group SKU/selector shape is invalid.');
  const spec = obj(specs[0], 'Card specification');
  const values = spec.values;
  if (spec.name !== 'Card' || !Array.isArray(values) || values.length !== skus.length || skus.length < 2) throw new Error('group Card selector shape is invalid.');
  if (skus.some((x) => typeof x !== 'string' || x.trim() !== x || !x) || values.some((x) => typeof x !== 'string' || x.trim() !== x || !x)) throw new Error('group SKU/selector values are malformed.');
  if (new Set(skus).size !== skus.length || new Set(values).size !== values.length) throw new Error('group SKU/selector values must be unique.');
  if (group.imageUrls !== undefined && (!Array.isArray(group.imageUrls) || group.imageUrls.length !== 0)) throw new Error('nonempty group image metadata is not safely projectable.');
  if (group.imageUrls !== undefined) delete group.imageUrls;
  // eBay returns group membership and allowed aspect values as independent
  // collections. Their indices do not define SKU-to-Card ownership: the
  // individual Inventory Item product.aspects.Card and frozen confirmed
  // variation identities do.
  return { group, skus: skus as string[], values: values as string[] };
}

function validateGroupContract(payload: Json): void {
  const candidate = groupCollections(payload).group;
  variationListingInventoryItemGroupPayloadSchema.parse(candidate);
}

function commonGroupPayload(payload: Json): Json {
  const { group } = groupCollections(payload);
  delete group.variantSKUs;
  const variesBy = obj(group.variesBy, 'group variesBy');
  const spec = obj((variesBy.specifications as Json[])[0], 'Card specification');
  delete spec.values;
  return group;
}

/** Builds the only payload this incident may ever send. */
export function buildC2BRemoval01CorrectedGroupPayload(frozen: IncidentFrozenEvidence): Json {
  if (obj(frozen.groupPayload, 'frozen group').inventoryItemGroupKey !== C2B_REMOVAL01_MANIFEST.groupKey) throw new Error('frozen group key does not match the incident manifest.');
  validateGroupContract(frozen.groupPayload);
  const { group, skus, values } = groupCollections(frozen.groupPayload);
  const manifestSkus = [C2B_REMOVAL01_MANIFEST.target.sku, ...C2B_REMOVAL01_MANIFEST.survivors.map((s) => s.sku)];
  // eBay may return the original membership in a different order (the
  // authoritative preflight was B,C,A). Membership is set-like here, while
  // the frozen SKU-to-Card map remains the application-position authority.
  if (!exactMembership(skus, manifestSkus)) throw new Error('frozen group membership does not match the incident manifest.');
  const frozenSelectorSkus = Object.keys(frozen.selectorBySku);
  const frozenSelectorValues = manifestSkus.map((sku) => frozen.selectorBySku[sku]);
  if (!exactMembership(frozenSelectorSkus, manifestSkus) ||
      frozenSelectorValues.some((value) => typeof value !== 'string' || value.trim() !== value || !value) ||
      new Set(frozenSelectorValues).size !== frozenSelectorValues.length ||
      !exactMembership(Object.keys(frozen.itemPayloadWithoutQuantityBySku), manifestSkus) ||
      !exactMembership(Object.keys(frozen.offerPayloadWithoutQuantityBySku), manifestSkus)) {
    throw new Error('frozen incident evidence must cover exactly the three incident SKUs.');
  }
  // Group values are a set. Verify completeness, never zip them with
  // variantSKUs: Sandbox has returned B,C,A SKUs and A,B,C values.
  if (!exactMembership(values, frozenSelectorValues as string[])) {
    throw new Error('frozen group Card values conflict with immutable confirmed selectors.');
  }
  // The independently frozen Item aspects must bind each exact SKU to the
  // confirmed Card selector; group membership/value sets alone are not enough.
  for (const sku of manifestSkus) {
    const item = obj(frozen.itemPayloadWithoutQuantityBySku[sku]!, `frozen Item for ${sku}`);
    const product = obj(item.product, `frozen Item product for ${sku}`);
    const aspects = obj(product.aspects, `frozen Item aspects for ${sku}`);
    if (!exactJson(aspects.Card, [frozen.selectorBySku[sku]])) {
      throw new Error(`frozen Item Card aspect conflicts with confirmed selector for ${sku}.`);
    }
  }
  const corrected = clone(group);
  corrected.variantSKUs = C2B_REMOVAL01_MANIFEST.survivors.map((s) => s.sku);
  const variesBy = obj(corrected.variesBy, 'group variesBy');
  const spec = obj((variesBy.specifications as Json[])[0], 'Card specification');
  spec.values = C2B_REMOVAL01_MANIFEST.survivors.map((s) => frozen.selectorBySku[s.sku]!);
  // Current schema applies to the complete fresh payload and its projection.
  variationListingInventoryItemGroupPayloadSchema.parse(corrected);
  return corrected;
}

export function buildC2BRemoval01Plan(frozen: IncidentFrozenEvidence): IncidentRepairPlan {
  if (frozen.originalSnapshotDigest !== C2B_REMOVAL01_MANIFEST.snapshotDigest) throw new Error('frozen v3 snapshot digest is not the exact incident revision.');
  const correctedGroupPayload = buildC2BRemoval01CorrectedGroupPayload(frozen);
  const correctedPayloadDigest = incidentJsonDigest(correctedGroupPayload);
  if (!digestHex.test(correctedPayloadDigest)) throw new Error('corrected payload digest is invalid.');
  if (!digestHex.test(incidentJsonDigest(frozen.groupPayload))) throw new Error('frozen group payload digest is invalid.');
  return { repairId: C2B_REMOVAL01_MANIFEST.revisionId, manifest: C2B_REMOVAL01_MANIFEST, frozen, correctedGroupPayload, correctedPayloadDigest };
}

function nonQuantityOffer(payload: Json): Json {
  const value = obj(clone(payload), 'Offer payload');
  delete value.availableQuantity;
  return value;
}

function itemQuantity(payload: Json): number {
  const availability = obj(obj(payload, 'Item payload').availability, 'Item availability');
  return quantity(obj(availability.shipToLocationAvailability, 'Item ship-to availability').quantity, 'Item');
}

function nonQuantityItem(payload: Json): Json {
  const value = obj(clone(payload), 'Item payload');
  const availability = obj(value.availability, 'Item availability');
  const ship = obj(availability.shipToLocationAvailability, 'Item ship-to availability');
  delete ship.quantity;
  return value;
}

function classifyOffer(offer: IncidentOfferRead, expected: { sku: string; offerId: string; quantity: number }, post: boolean, manifest: typeof C2B_REMOVAL01_MANIFEST): boolean {
  let payloadQuantity: number;
  try { payloadQuantity = quantity(obj(offer.payload, 'Offer payload').availableQuantity, `Offer ${expected.sku}`); } catch { return false; }
  if (offer.sku !== expected.sku || offer.offerId !== expected.offerId || offer.marketplaceId !== manifest.marketplaceId || offer.availableQuantity !== expected.quantity || payloadQuantity !== expected.quantity || offer.availableQuantity !== payloadQuantity) return false;
  if (expected.sku === manifest.target.sku) {
    return post
      ? offer.status === 'UNPUBLISHED' && (offer.listingId === null || offer.listingId === manifest.listingId) && (offer.listingStatus === undefined || offer.listingStatus === null || offer.listingStatus === 'NOT_LISTED')
      : offer.status === 'PUBLISHED' && offer.listingId === manifest.listingId && (offer.listingStatus === undefined || offer.listingStatus === null || offer.listingStatus === 'OUT_OF_STOCK');
  }
  return offer.status === 'PUBLISHED' && offer.listingId === manifest.listingId && (offer.listingStatus === undefined || offer.listingStatus === null || offer.listingStatus === 'ACTIVE');
}

export interface IncidentObservedEvidence {
  sellerUserId: string;
  group: IncidentGroupRead;
  items: Record<string, IncidentItemRead>;
  offers: Record<string, { complete: boolean; offers: IncidentOfferRead[] }>;
}

async function readObserved(remote: IncidentReadOnlyRemoteGateway, plan: IncidentRepairPlan): Promise<IncidentObservedEvidence> {
  const seller = await remote.readSeller();
  if (!seller || typeof seller.userId !== 'string' || !seller.userId.trim()) throw new Error('seller identity is unavailable.');
  const group = await remote.readGroup(plan.manifest.groupKey);
  const items: Record<string, IncidentItemRead> = {};
  const offers: Record<string, { complete: boolean; offers: IncidentOfferRead[] }> = {};
  const skus = [plan.manifest.target.sku, ...plan.manifest.survivors.map((s) => s.sku)];
  for (const sku of skus) {
    items[sku] = await remote.readItem(sku);
    offers[sku] = await remote.readAllOffers(sku);
  }
  return { sellerUserId: seller.userId, group, items, offers };
}

function compareState(plan: IncidentRepairPlan, evidence: IncidentObservedEvidence): IncidentRemoteState {
  if (evidence.sellerUserId !== plan.manifest.sellerUserId) return 'MIXED';
  let actualGroup: ReturnType<typeof groupCollections>;
  try {
    validateGroupContract(evidence.group.payload);
    actualGroup = groupCollections(evidence.group.payload);
  } catch { return 'MIXED'; }
  if (actualGroup.group.inventoryItemGroupKey !== plan.manifest.groupKey) return 'MIXED';
  if (!exactMembership(actualGroup.skus, evidence.group.variantSKUs)) return 'MIXED';
  if (!exactJson(commonGroupPayload(evidence.group.payload), commonGroupPayload(plan.frozen.groupPayload))) return 'MIXED';
  const expectedSkus = [plan.manifest.target.sku, ...plan.manifest.survivors.map((s) => s.sku)];
  const survivors = plan.manifest.survivors.map((s) => s.sku);
  // Neither array exposes positional SKU-to-selector ownership.
  const pre = exactMembership(actualGroup.skus, expectedSkus) &&
    exactMembership(actualGroup.values, expectedSkus.map((sku) => plan.frozen.selectorBySku[sku]!));
  const post = exactMembership(actualGroup.skus, survivors) &&
    exactMembership(actualGroup.values, survivors.map((sku) => plan.frozen.selectorBySku[sku]!)) &&
    exactJson(commonGroupPayload(evidence.group.payload), commonGroupPayload(plan.correctedGroupPayload));
  if (!pre && !post) return 'MIXED';
  for (const sku of expectedSkus) {
    const item = evidence.items[sku];
    const offerSet = evidence.offers[sku];
    if (!item || !offerSet || !Array.isArray(offerSet.offers)) return 'UNKNOWN';
    if (!offerSet.complete) throw new Error(`Offer pagination for ${sku} is incomplete.`);
    if (offerSet.offers.length !== 1) return 'MIXED';
    const expected = sku === plan.manifest.target.sku ? plan.manifest.target : plan.manifest.survivors.find((s) => s.sku === sku)!;
    let payloadQuantity: number;
    try { payloadQuantity = itemQuantity(item.payload); } catch { return 'MIXED'; }
    if (item.sku !== sku || !exactJson(nonQuantityItem(item.payload), plan.frozen.itemPayloadWithoutQuantityBySku[sku]) || item.quantity !== expected.quantity || payloadQuantity !== expected.quantity || item.quantity !== payloadQuantity) return 'MIXED';
    // Verify independent Item-specific Card ownership, not an array index
    // from InventoryItemGroup.variesBy.
    try {
      const aspects = obj(obj(item.payload, `Item ${sku}`).product, `Item product ${sku}`);
      if (!exactJson(obj(aspects.aspects, `Item aspects ${sku}`).Card, [plan.frozen.selectorBySku[sku]])) return 'MIXED';
    } catch { return 'MIXED'; }
    const offer = offerSet.offers[0]!;
    if (!classifyOffer(offer, expected, post, plan.manifest) || !exactJson(nonQuantityOffer(offer.payload), plan.frozen.offerPayloadWithoutQuantityBySku[sku])) return 'MIXED';
    const expectedGroups = sku === plan.manifest.target.sku && post ? (item.groupKeys === null || item.groupKeys.length === 0) : exactJson(item.groupKeys, [plan.manifest.groupKey]);
    if (!expectedGroups) return 'MIXED';
  }
  return post ? 'EXACT_CORRECTED_POST' : 'EXACT_PRE';
}

export async function classifyC2BRemoval01(remote: IncidentReadOnlyRemoteGateway, plan: IncidentRepairPlan): Promise<{ state: IncidentRemoteState; evidence?: IncidentObservedEvidence; reason?: string }> {
  try {
    const evidence = await readObserved(remote, plan);
    return { state: compareState(plan, evidence), evidence };
  } catch (error) {
    return { state: 'UNKNOWN', reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Read-only incident inspection. In particular, a missing row stays absent;
 * inspection never prepares, starts, marks, appends, or replaces anything.
 */
export async function inspectC2BRemoval01(input: {
  plan: IncidentRepairPlan;
  remote: IncidentReadOnlyRemoteGateway;
  ledger: IncidentReadOnlyLedger;
}): Promise<IncidentInspectionResult> {
  const { plan, remote, ledger } = input;
  const record = await ledger.load(plan.repairId);
  if (record && ((record.repairId !== undefined && record.repairId !== plan.repairId)
    || record.revisionId !== plan.repairId
    || record.correctedPayloadDigest !== plan.correctedPayloadDigest)) {
    throw new Error('incident repair ledger identity/digest mismatch.');
  }
  const classified = await classifyC2BRemoval01(remote, plan);
  return {
    revisionId: plan.repairId,
    remoteState: classified.state,
    repairState: record?.state ?? 'absent',
    putCount: 0,
    c2TerminalAppended: false,
  };
}

function evidenceJson(state: IncidentRemoteState, observed: IncidentObservedEvidence | undefined, reason: string | undefined, plan: IncidentRepairPlan): Json {
  return {
    revisionId: plan.manifest.revisionId,
    groupId: plan.manifest.groupId,
    sellerUserId: observed?.sellerUserId ?? plan.manifest.sellerUserId,
    marketplaceId: plan.manifest.marketplaceId,
    listingId: plan.manifest.listingId,
    targetSku: plan.manifest.target.sku,
    targetOfferId: plan.manifest.target.offerId,
    survivorSkus: plan.manifest.survivors.map((s) => s.sku),
    survivorOfferIds: plan.manifest.survivors.map((s) => s.offerId),
    remoteState: state,
    originalSnapshotDigest: plan.manifest.snapshotDigest,
    correctedPayloadDigest: plan.correctedPayloadDigest,
    reason: reason ?? null,
  } as Json;
}

/**
 * Incident-only recovery. The default gate is intentionally disabled. A
 * started/unknown row is always GET-only, which is what makes the one-write
 * property survive process crashes and restarts.
 */
export async function executeC2BRemoval01Repair(input: {
  plan: IncidentRepairPlan;
  remote: IncidentReadOnlyRemoteGateway;
  ledger: IncidentReadOnlyLedger;
}): Promise<IncidentInspectionResult> {
  // Kept as a source-compatible name for callers being migrated to the
  // incident gateway. This function is read-only and can never prepare,
  // start, mark, append, or PUT.
  return inspectC2BRemoval01(input);
}

