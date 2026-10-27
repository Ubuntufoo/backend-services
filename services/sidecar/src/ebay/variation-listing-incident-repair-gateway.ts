import type {
  IncidentInspectionResult,
  IncidentReadOnlyLedger,
  IncidentReadOnlyRemoteGateway,
  IncidentRepairLedger,
  IncidentRepairPlan,
  IncidentRepairRecord,
  IncidentRepairResult,
  IncidentRemoteGateway,
} from '@/ebay/variation-listing-incident-repair.js';
import type { Json } from '@ebay-inventory/data';
import {
  classifyC2BRemoval01,
  C2B_REMOVAL01_MANIFEST,
  buildC2BRemoval01CorrectedGroupPayload,
  incidentJsonDigest,
  inspectC2BRemoval01,
  isIncidentRepairCasConflict,
} from '@/ebay/variation-listing-incident-repair.js';
import {
  incidentRepairAuthorizationBinding,
  C2B_REMOVAL01_PROJECT_REF,
  type IncidentRepairAuthorizationAttestation,
  type IncidentRepairAuthorizationAuthority,
  type IncidentRepairAuthorityMode,
  type IncidentRepairTargetEnvironment,
  type IncidentRepairAuthorizationPhase,
} from '@/ebay/variation-listing-incident-repair-authorization.js';

export { IncidentRepairCasConflictError, isIncidentRepairCasConflict } from '@/ebay/variation-listing-incident-repair.js';

export interface IncidentRepairGateway {
  inspect(): Promise<IncidentInspectionResult>;
  prepare(authorization: IncidentRepairAuthorizationAttestation): Promise<IncidentRepairRecord>;
  executeOnePut(authorization: IncidentRepairAuthorizationAttestation): Promise<IncidentRepairResult>;
  resolvePost(authorization: IncidentRepairAuthorizationAttestation): Promise<IncidentRepairResult | IncidentInspectionResult>;
}
export interface CreateIncidentRepairGatewayOptions {
  /** Must be explicitly true; omitted/default is disabled. */
  enabled?: boolean;
  runId: string;
  targetEnvironment?: IncidentRepairTargetEnvironment;
  authorityMode?: IncidentRepairAuthorityMode;
  projectRef?: string;
  plan: IncidentRepairPlan;
  authority: IncidentRepairAuthorizationAuthority;
  remote: IncidentRemoteGateway;
  ledger: IncidentRepairLedger;
  now?: () => number;
}

function assertRecord(plan: IncidentRepairPlan, record: IncidentRepairRecord | null): IncidentRepairRecord | null {
  if (record && ((record.repairId !== undefined && record.repairId !== plan.repairId)
    || record.revisionId !== plan.repairId
    || record.correctedPayloadDigest !== plan.correctedPayloadDigest)) {
    throw new Error('incident repair ledger identity/digest mismatch.');
  }
  return record;
}

function evidenceJson(plan: IncidentRepairPlan, state: string, reason?: string): Json {
  return {
    revisionId: plan.manifest.revisionId,
    groupId: plan.manifest.groupId,
    sellerUserId: plan.manifest.sellerUserId,
    marketplaceId: plan.manifest.marketplaceId,
    listingId: plan.manifest.listingId,
    targetSku: plan.manifest.target.sku,
    targetOfferId: plan.manifest.target.offerId,
    survivorSkus: plan.manifest.survivors.map((survivor) => survivor.sku),
    survivorOfferIds: plan.manifest.survivors.map((survivor) => survivor.offerId),
    remoteState: state,
    originalSnapshotDigest: plan.manifest.snapshotDigest,
    correctedPayloadDigest: plan.correctedPayloadDigest,
    reason: reason ?? null,
  };
}

function result(plan: IncidentRepairPlan, remoteState: IncidentRepairResult['remoteState'], repairState: IncidentRepairResult['repairState'], putCount = 0, c2TerminalAppended = false): IncidentRepairResult {
  return { revisionId: plan.repairId, remoteState, repairState, putCount, c2TerminalAppended };
}

function assertCorrectedPayloadDigest(plan: IncidentRepairPlan): void {
  if (incidentJsonDigest(plan.correctedGroupPayload) !== plan.correctedPayloadDigest) {
    throw new Error('incident corrected payload digest drifted after authorization binding.');
  }
}

function assertCodeOwnedIncidentPlan(plan: IncidentRepairPlan): void {
  const manifest = C2B_REMOVAL01_MANIFEST;
  const actual = plan.manifest;
  if (plan.repairId !== manifest.revisionId
    || actual.sellerUserId !== manifest.sellerUserId
    || actual.marketplaceId !== manifest.marketplaceId
    || actual.listingId !== manifest.listingId
    || actual.groupId !== manifest.groupId
    || actual.groupKey !== manifest.groupKey
    || actual.revisionId !== manifest.revisionId
    || actual.snapshotDigest !== manifest.snapshotDigest
    || actual.desiredRevision !== manifest.desiredRevision
    || actual.confirmedRevision !== manifest.confirmedRevision
    || actual.target.sku !== manifest.target.sku
    || actual.target.offerId !== manifest.target.offerId
    || actual.target.quantity !== manifest.target.quantity
    || actual.survivors.length !== manifest.survivors.length
    || actual.survivors.some((survivor, index) => survivor.sku !== manifest.survivors[index]!.sku
      || survivor.offerId !== manifest.survivors[index]!.offerId
      || survivor.quantity !== manifest.survivors[index]!.quantity)
    || plan.frozen.originalSnapshotDigest !== manifest.snapshotDigest
    || typeof plan.frozen.targetVariationId !== 'string' || plan.frozen.targetVariationId.trim() === '') {
    throw new Error('incident gateway plan does not match the code-owned C2BRemoval01 manifest.');
  }
  assertCorrectedPayloadDigest(plan);
  try {
    const expectedPayload = buildC2BRemoval01CorrectedGroupPayload(plan.frozen);
    if (incidentJsonDigest(expectedPayload) !== plan.correctedPayloadDigest
      || incidentJsonDigest(expectedPayload) !== incidentJsonDigest(plan.correctedGroupPayload)) {
      throw new Error('incident corrected payload is not the exact code-owned projection.');
    }
  } catch (error) {
    if (error instanceof Error && /code-owned projection/.test(error.message)) throw error;
    throw new Error('incident gateway plan cannot prove the exact corrected payload projection.');
  }
}

/**
 * Incident-specific offline composition root. No clients are constructed here;
 * callers must inject read/ledger adapters and explicitly enable the fixture
 * gateway. The default is permanently read-only/disabled.
 */
export function createC2BRemoval01IncidentRepairGateway(options: CreateIncidentRepairGatewayOptions): IncidentRepairGateway {
  if ((options.projectRef ?? C2B_REMOVAL01_PROJECT_REF) !== C2B_REMOVAL01_PROJECT_REF) throw new Error('incident gateway project is not canonical.');
  if ((options.targetEnvironment ?? 'sandbox') !== 'sandbox' || (options.authorityMode ?? 'offline-test') !== 'offline-test') throw new Error('incident gateway environment/mode is not permitted.');
  assertCodeOwnedIncidentPlan(options.plan);
  const enabled = options.enabled === true;
  const now = options.now ?? (() => Date.now());
  const runId = options.runId;
  const projectRef: typeof C2B_REMOVAL01_PROJECT_REF = C2B_REMOVAL01_PROJECT_REF;
  const targetEnvironment = options.targetEnvironment ?? 'sandbox';
  const authorityMode = options.authorityMode ?? 'offline-test';
  const readOnlyRemote: IncidentReadOnlyRemoteGateway = options.remote;
  const readOnlyLedger: IncidentReadOnlyLedger = options.ledger;
  const deepFreeze = <T>(value: T): T => {
    if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.freeze(value);
      for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    }
    return value;
  };
  const plan = deepFreeze(structuredClone(options.plan));

  const requireEnabled = (): void => {
    if (!enabled) throw new Error('incident repair gateway is disabled.');
  };

  const inspect = (): Promise<IncidentInspectionResult> => inspectC2BRemoval01({
    plan,
    remote: readOnlyRemote,
    ledger: readOnlyLedger,
  });

  const consume = (plan: IncidentRepairPlan, phase: IncidentRepairAuthorizationPhase, authorization: IncidentRepairAuthorizationAttestation): void => {
    options.authority.consume(authorization, incidentRepairAuthorizationBinding(plan, runId, phase, projectRef, targetEnvironment, authorityMode), now());
  };

  const prepare = async (authorization: IncidentRepairAuthorizationAttestation): Promise<IncidentRepairRecord> => {
    requireEnabled();
    const existing = assertRecord(plan, await options.ledger.load(plan.repairId));
    consume(plan, 'prepare', authorization);
    if (existing) return existing;
    assertCorrectedPayloadDigest(plan);
    return assertRecord(plan, await options.ledger.prepare(plan))!;
  };

  const executeOnePut = async (authorization: IncidentRepairAuthorizationAttestation): Promise<IncidentRepairResult> => {
    requireEnabled();
    let record = assertRecord(plan, await options.ledger.load(plan.repairId));
    if (!record) throw new Error('incident repair must be explicitly prepared before one-put execution.');
    if (record.state === 'started' || record.state === 'unknown' || record.state === 'reconciled_post' || record.state === 'confirmed_post') {
      const inspected = await inspect();
      return result(plan, inspected.remoteState, record.state);
    }
    const classified = await classifyC2BRemoval01(readOnlyRemote, plan);
    if (classified.state !== 'EXACT_PRE') return result(plan, classified.state, record.state);
    consume(plan, 'one-put', authorization);
    assertCorrectedPayloadDigest(plan);
    try {
      record = assertRecord(plan, await options.ledger.start(plan.repairId))!;
    } catch (error) {
      if (!isIncidentRepairCasConflict(error)) throw error;
      // A CAS loser reloads and inspects only; it never guesses whether it won.
      const inspected = await inspect();
      if (inspected.repairState === 'absent') throw new Error('incident repair row disappeared after a CAS conflict.');
      return result(plan, inspected.remoteState, inspected.repairState);
    }
    if (record.state !== 'started') {
      const inspected = await inspect();
      return result(plan, inspected.remoteState, record.state);
    }
    try {
      assertCorrectedPayloadDigest(plan);
      await options.remote.replaceGroup(plan.manifest.groupKey, structuredClone(plan.correctedGroupPayload));
    } catch (error) {
      const unknown = await options.ledger.markUnknown(plan.repairId, evidenceJson(plan, 'UNKNOWN', error instanceof Error ? error.message : String(error)));
      return result(plan, 'UNKNOWN', assertRecord(plan, unknown)!.state, 1);
    }
    // Post-state classification is deliberately read-only. Resolve-post is a
    // separate authorization and cannot be reached implicitly from one-put.
    const after = await classifyC2BRemoval01(readOnlyRemote, plan);
    if (after.state !== 'EXACT_CORRECTED_POST') {
      const unknown = await options.ledger.markUnknown(plan.repairId, evidenceJson(plan, after.state, after.reason));
      return result(plan, after.state, assertRecord(plan, unknown)!.state, 1);
    }
    return result(plan, after.state, record.state, 1);
  };

  const resolvePost = async (authorization: IncidentRepairAuthorizationAttestation): Promise<IncidentRepairResult | IncidentInspectionResult> => {
    requireEnabled();
    let record = assertRecord(plan, await options.ledger.load(plan.repairId));
    if (!record) {
      return await inspect();
    }
    const classified = await classifyC2BRemoval01(readOnlyRemote, plan);
    if (classified.state !== 'EXACT_CORRECTED_POST') return result(plan, classified.state, record.state);
    consume(plan, 'resolve-post', authorization);
    if (record.state === 'planned') {
      record = assertRecord(plan, await options.ledger.markPost(plan.repairId, 'reconciled_post', evidenceJson(plan, classified.state)))!;
    } else if (record.state === 'started' || record.state === 'unknown') {
      record = assertRecord(plan, await options.ledger.markPost(plan.repairId, 'confirmed_post', evidenceJson(plan, classified.state)))!;
    }
    if (record.state !== 'reconciled_post' && record.state !== 'confirmed_post') {
      return result(plan, classified.state, record.state);
    }
    await options.ledger.appendTerminalC2(plan.repairId, evidenceJson(plan, classified.state));
    return result(plan, classified.state, record.state, 0, true);
  };

  return { inspect, prepare, executeOnePut, resolvePost };
}
