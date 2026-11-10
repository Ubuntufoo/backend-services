import type {RemovedSkuCleanupResourceKind, RemovedSkuCleanupResourceState} from '@/ebay/variation-listing-removed-sku-cleanup-journal.js';

/** Minimal RPC shape used by Supabase's client; no destructive operation is exposed. */
export interface RemovedSkuCleanupRpcClient {
  rpc(name: string, args: Record<string, unknown>): Promise<{data: unknown; error: unknown | null}>;
}

export interface RemovedSkuCleanupJournalPlanInput {
  groupId: string;
  revisionId: string;
  targetVariationId: string;
  targetSku: string;
  localPaths: readonly string[];
  r2Keys: readonly string[];
}

export interface RemovedSkuCleanupResourceResult {
  state: RemovedSkuCleanupResourceState;
  attemptCount: number;
  version: number;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && typeof (error as {message?: unknown}).message === 'string') {
    return (error as {message: string}).message;
  }
  return 'Cleanup journal RPC failed.';
}

function requireUuid(data: unknown): string {
  if (typeof data === 'string' && data.length > 0) return data;
  throw new Error('Cleanup journal RPC returned an invalid journal id.');
}

function safeNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function requireResourceResult(data: unknown): RemovedSkuCleanupResourceResult {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') throw new Error('Cleanup journal RPC returned no resource result.');
  const value = row as Record<string, unknown>;
  const attemptCount = value.attempt_count;
  const version = value.version;
  if (typeof value.state !== 'string' ||
      !['planned', 'attempting', 'removed', 'already_absent', 'failed', 'unknown'].includes(value.state) ||
      !safeNonNegativeInteger(attemptCount) ||
      !safeNonNegativeInteger(version)) {
    throw new Error('Cleanup journal RPC returned a malformed resource result.');
  }
  return {
    state: value.state as RemovedSkuCleanupResourceState,
    attemptCount,
    version,
  };
}

async function call<T>(client: RemovedSkuCleanupRpcClient, name: string, args: Record<string, unknown>, parse: (data: unknown) => T): Promise<T> {
  const {data, error} = await client.rpc(name, args);
  if (error !== null) throw new Error(errorMessage(error));
  return parse(data);
}

/**
 * Persistence-only seam for a future executor. The SQL RPCs persist intent and
 * CAS transitions; this object never calls a provider or grants authorization.
 */
export function createRemovedSkuCleanupPersistence(client: RemovedSkuCleanupRpcClient) {
  return {
    createPlan(input: RemovedSkuCleanupJournalPlanInput): Promise<string> {
      return call(client, 'create_variation_listing_removed_sku_cleanup_journal', {
        p_group_id: input.groupId,
        p_revision_id: input.revisionId,
        p_target_variation_id: input.targetVariationId,
        p_target_sku: input.targetSku,
        p_local_paths: [...input.localPaths],
        p_r2_keys: [...input.r2Keys],
      }, requireUuid);
    },
    beginAttempt(input: {
      journalId: string;
      resourceKind: RemovedSkuCleanupResourceKind;
      resourceIdentity: string;
      expectedVersion: number;
    }): Promise<RemovedSkuCleanupResourceResult> {
      return call(client, 'transition_variation_listing_removed_sku_cleanup_resource', {
        p_journal_id: input.journalId,
        p_resource_kind: input.resourceKind,
        p_resource_identity: input.resourceIdentity,
        p_expected_state: 'planned',
        p_next_state: 'attempting',
        p_expected_version: input.expectedVersion,
        p_last_error: null,
      }, requireResourceResult);
    },
    recordOutcome(input: {
      journalId: string;
      resourceKind: RemovedSkuCleanupResourceKind;
      resourceIdentity: string;
      expectedVersion: number;
      nextState: 'removed' | 'already_absent' | 'failed' | 'unknown';
      lastError?: string;
    }): Promise<RemovedSkuCleanupResourceResult> {
      return call(client, 'transition_variation_listing_removed_sku_cleanup_resource', {
        p_journal_id: input.journalId,
        p_resource_kind: input.resourceKind,
        p_resource_identity: input.resourceIdentity,
        p_expected_state: 'attempting',
        p_next_state: input.nextState,
        p_expected_version: input.expectedVersion,
        p_last_error: input.lastError ?? null,
      }, requireResourceResult);
    },
    recoverInterrupted(input: {
      journalId: string;
      resourceKind: RemovedSkuCleanupResourceKind;
      resourceIdentity: string;
      expectedVersion: number;
    }): Promise<RemovedSkuCleanupResourceResult> {
      return call(client, 'recover_variation_listing_removed_sku_cleanup_resource', {
        p_journal_id: input.journalId,
        p_resource_kind: input.resourceKind,
        p_resource_identity: input.resourceIdentity,
        p_expected_version: input.expectedVersion,
      }, requireResourceResult);
    },
  };
}
