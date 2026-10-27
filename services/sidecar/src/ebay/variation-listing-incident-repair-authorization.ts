import { randomUUID } from 'node:crypto';

import type {
  IncidentRepairPlan,
} from '@/ebay/variation-listing-incident-repair.js';

export type IncidentRepairAuthorizationPhase = 'prepare' | 'one-put' | 'resolve-post';
export const C2B_REMOVAL01_PROJECT_REF = 'fmiliwxthjonjwywuqta';
export type IncidentRepairTargetEnvironment = 'sandbox';
export type IncidentRepairAuthorityMode = 'offline-test';
export type IncidentRepairAuthorizationAction = 'prepare' | 'start' | 'one-put' | 'markUnknown' | 'markPost' | 'appendTerminalC2';

/** The immutable identity an attestation must cover. */
export interface IncidentRepairAuthorizationBinding {
  runId: string;
  phase: IncidentRepairAuthorizationPhase;
  targetEnvironment: IncidentRepairTargetEnvironment;
  authorityMode: IncidentRepairAuthorityMode;
  projectRef: typeof C2B_REMOVAL01_PROJECT_REF;
  repairId: string;
  revisionId: string;
  groupId: string;
  groupKey: string;
  sellerUserId: string;
  marketplaceId: string;
  listingId: string;
  targetVariationId: string;
  snapshotDigest: string;
  correctedPayloadDigest: string;
  desiredRevision: number;
  confirmedRevision: number;
  targetSku: string;
  targetOfferId: string;
  targetQuantity: number;
  survivorSkus: readonly string[];
  survivorOfferIds: readonly string[];
  survivorQuantities: readonly number[];
  allowedActions: readonly IncidentRepairAuthorizationAction[];
}
/** An offline operator attestation. It is intentionally not a live credential. */
export interface IncidentRepairAuthorizationAttestation extends IncidentRepairAuthorizationBinding {
  attestationId: string;
  issuedAt: number;
  expiresAt: number;
}

export interface IncidentRepairAuthorizationAuthority {
  /** Consume exactly one phase attestation, or throw before any write. */
  consume(attestation: IncidentRepairAuthorizationAttestation, expected: IncidentRepairAuthorizationBinding, now?: number): void;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function sameBinding(actual: IncidentRepairAuthorizationBinding, expected: IncidentRepairAuthorizationBinding): boolean {
  const bindingKeys: (keyof IncidentRepairAuthorizationBinding)[] = [
    'runId', 'phase', 'targetEnvironment', 'authorityMode', 'projectRef', 'repairId', 'revisionId',
    'groupId', 'groupKey', 'sellerUserId', 'marketplaceId', 'listingId',
    'targetVariationId', 'snapshotDigest', 'correctedPayloadDigest',
    'desiredRevision', 'confirmedRevision', 'targetSku', 'targetOfferId', 'targetQuantity',
    'survivorSkus', 'survivorOfferIds', 'survivorQuantities', 'allowedActions',
  ];
  const projected = Object.fromEntries(bindingKeys.map((key) => [key, actual[key]]));
  return canonical(projected) === canonical(expected);
}

function assertBinding(binding: IncidentRepairAuthorizationBinding): void {
  const bindingKeys: (keyof IncidentRepairAuthorizationBinding)[] = [
    'runId', 'phase', 'targetEnvironment', 'authorityMode', 'projectRef', 'repairId', 'revisionId',
    'groupId', 'groupKey', 'sellerUserId', 'marketplaceId', 'listingId',
    'targetVariationId', 'snapshotDigest', 'correctedPayloadDigest',
  ];
  for (const key of bindingKeys) {
    const value = binding[key];
    if (typeof value !== 'string' || value.trim() === '') throw new Error(`authorization ${key} is required.`);
  }
  if (binding.targetEnvironment !== 'sandbox' || binding.authorityMode !== 'offline-test') throw new Error('authorization environment/mode is not permitted.');
  if (binding.projectRef !== C2B_REMOVAL01_PROJECT_REF) throw new Error('authorization project is not canonical.');
  if (!['prepare', 'one-put', 'resolve-post'].includes(binding.phase)) throw new Error('authorization phase is not permitted.');
  if (!Number.isSafeInteger(binding.desiredRevision) || !Number.isSafeInteger(binding.confirmedRevision)
    || !Number.isSafeInteger(binding.targetQuantity) || binding.targetQuantity < 0
    || !Array.isArray(binding.survivorSkus) || !Array.isArray(binding.survivorOfferIds)
    || !Array.isArray(binding.survivorQuantities) || binding.survivorSkus.length !== 2
    || binding.survivorOfferIds.length !== 2 || binding.survivorQuantities.length !== 2
    || binding.survivorSkus.some((value) => typeof value !== 'string' || value.trim() === '')
    || binding.survivorOfferIds.some((value) => typeof value !== 'string' || value.trim() === '')
    || binding.survivorQuantities.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new Error('authorization immutable quantity/revision binding is invalid.');
  }
  const expectedActions: Record<IncidentRepairAuthorizationPhase, readonly IncidentRepairAuthorizationAction[]> = {
    prepare: ['prepare'],
    'one-put': ['start', 'one-put', 'markUnknown'],
    'resolve-post': ['markPost', 'appendTerminalC2'],
  };
  const actions = binding.allowedActions;
  if (!Array.isArray(actions) || canonical(actions) !== canonical(expectedActions[binding.phase])) {
    throw new Error('authorization action allowlist is not exact.');
  }
}

export function incidentRepairAuthorizationBinding(
  plan: IncidentRepairPlan,
  runId: string,
  phase: IncidentRepairAuthorizationPhase,
  projectRef: typeof C2B_REMOVAL01_PROJECT_REF = C2B_REMOVAL01_PROJECT_REF,
  targetEnvironment: IncidentRepairTargetEnvironment = 'sandbox',
  authorityMode: IncidentRepairAuthorityMode = 'offline-test',
): IncidentRepairAuthorizationBinding {
  const binding: IncidentRepairAuthorizationBinding = {
    runId,
    phase,
    targetEnvironment,
    authorityMode,
    projectRef,
    repairId: plan.repairId,
    revisionId: plan.manifest.revisionId,
    groupId: plan.manifest.groupId,
    groupKey: plan.manifest.groupKey,
    sellerUserId: plan.manifest.sellerUserId,
    marketplaceId: plan.manifest.marketplaceId,
    listingId: plan.manifest.listingId,
    targetVariationId: plan.frozen.targetVariationId,
    snapshotDigest: plan.manifest.snapshotDigest,
    correctedPayloadDigest: plan.correctedPayloadDigest,
    desiredRevision: plan.manifest.desiredRevision,
    confirmedRevision: plan.manifest.confirmedRevision,
    targetSku: plan.manifest.target.sku,
    targetOfferId: plan.manifest.target.offerId,
    targetQuantity: plan.manifest.target.quantity,
    survivorSkus: plan.manifest.survivors.map((survivor) => survivor.sku),
    survivorOfferIds: plan.manifest.survivors.map((survivor) => survivor.offerId),
    survivorQuantities: plan.manifest.survivors.map((survivor) => survivor.quantity),
    allowedActions: phase === 'prepare' ? ['prepare'] : phase === 'one-put' ? ['start', 'one-put', 'markUnknown'] : ['markPost', 'appendTerminalC2'],
  };
  assertBinding(binding);
  return binding;
}

export interface IssueOfflineIncidentRepairAuthorizationInput extends IncidentRepairAuthorizationBinding {
  issuedAt?: number;
  expiresAt: number;
}

/**
 * Creates a test-only attestation. The gateway remains disabled unless an
 * explicitly injected offline authority is supplied; this helper is not a
 * production approval mechanism.
 */
export function issueOfflineIncidentRepairAuthorization(
  input: IssueOfflineIncidentRepairAuthorizationInput,
): IncidentRepairAuthorizationAttestation {
  assertBinding(input);
  const issuedAt = input.issuedAt ?? Date.now();
  if (!Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(input.expiresAt) || input.expiresAt <= issuedAt) {
    throw new Error('authorization expiry is invalid.');
  }
  const attestation = {
    ...input,
    attestationId: randomUUID(),
    issuedAt,
    survivorSkus: Object.freeze([...input.survivorSkus]),
    survivorOfferIds: Object.freeze([...input.survivorOfferIds]),
    survivorQuantities: Object.freeze([...input.survivorQuantities]),
    allowedActions: Object.freeze([...input.allowedActions]),
  };
  return Object.freeze(attestation);
}

/** In-memory single-use authority for offline integration tests only. */
export class InMemoryIncidentRepairAuthorizationAuthority implements IncidentRepairAuthorizationAuthority {
  private readonly consumed = new Set<string>();

  consume(attestation: IncidentRepairAuthorizationAttestation, expected: IncidentRepairAuthorizationBinding, now = Date.now()): void {
    assertBinding(attestation);
    if (!attestation.attestationId || typeof attestation.attestationId !== 'string') throw new Error('authorization id is required.');
    if (!Number.isSafeInteger(attestation.issuedAt) || !Number.isSafeInteger(attestation.expiresAt) || now >= attestation.expiresAt || now < attestation.issuedAt) {
      throw new Error('authorization is expired or not yet valid.');
    }
    if (!sameBinding(attestation, expected)) throw new Error('authorization binding does not match the incident phase.');
    const key = `${attestation.attestationId}:${expected.phase}`;
    if (this.consumed.has(key)) throw new Error('authorization has already been consumed.');
    this.consumed.add(key);
  }
}
