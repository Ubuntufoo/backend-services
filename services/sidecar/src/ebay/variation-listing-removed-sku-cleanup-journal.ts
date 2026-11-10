/**
 * Offline state machine for a future independently authorized removed-SKU image purge.
 * No network, filesystem, database or deletion operations are performed here.
 */
export type RemovedSkuCleanupResourceKind = 'local' | 'r2';
export type RemovedSkuCleanupResourceState =
  'planned' | 'attempting' | 'removed' | 'already_absent' | 'failed' | 'unknown';

export interface RemovedSkuCleanupResource {
  kind: RemovedSkuCleanupResourceKind;
  identity: string;
  state: RemovedSkuCleanupResourceState;
  attemptCount: number;
  lastError: string | null;
}

export interface RemovedSkuCleanupJournal {
  groupId: string;
  revisionId: string;
  targetVariationId: string;
  targetSku: string;
  /** This record is a plan, not an operator confirmation or delete capability. */
  operatorConfirmed: false;
  deletionAuthorized: false;
  resources: RemovedSkuCleanupResource[];
}

export interface RemovedSkuCleanupTransition {
  kind: RemovedSkuCleanupResourceKind;
  identity: string;
  expectedState: RemovedSkuCleanupResourceState;
  nextState: RemovedSkuCleanupResourceState;
  lastError?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const terminal = new Set<RemovedSkuCleanupResourceState>(['removed', 'already_absent']);

function exactIdentity(identity: string): boolean {
  return typeof identity === 'string' && identity.length > 0 && identity.trim() === identity;
}

function validateJournal(journal: RemovedSkuCleanupJournal): void {
  if (!UUID.test(journal.groupId) || !UUID.test(journal.revisionId) ||
      !UUID.test(journal.targetVariationId) || !exactIdentity(journal.targetSku) ||
      journal.operatorConfirmed !== false || journal.deletionAuthorized !== false ||
      journal.resources.length < 2) {
    throw new Error('Removed-SKU cleanup journal identity or safety flags are invalid.');
  }
  const seen = new Set<string>();
  for (const resource of journal.resources) {
    if (!['local', 'r2'].includes(resource.kind) || !exactIdentity(resource.identity) ||
        !['planned', 'attempting', 'removed', 'already_absent', 'failed', 'unknown'].includes(resource.state) ||
        !Number.isSafeInteger(resource.attemptCount) || resource.attemptCount < 0 ||
        (resource.lastError !== null && !exactIdentity(resource.lastError))) {
      throw new Error('Removed-SKU cleanup journal resource is invalid.');
    }
    const key = JSON.stringify([resource.kind, resource.identity]);
    if (seen.has(key)) throw new Error('Removed-SKU cleanup journal contains a duplicate resource.');
    seen.add(key);
  }
}

export function planRemovedSkuCleanup(input: {
  groupId: string;
  revisionId: string;
  targetVariationId: string;
  targetSku: string;
  localPaths: readonly string[];
  r2Keys: readonly string[];
}): RemovedSkuCleanupJournal {
  const resources: RemovedSkuCleanupResource[] = [
    ...input.localPaths.map((identity) => ({
      kind: 'local' as const, identity, state: 'planned' as const,
      attemptCount: 0, lastError: null,
    })),
    ...input.r2Keys.map((identity) => ({
      kind: 'r2' as const, identity, state: 'planned' as const,
      attemptCount: 0, lastError: null,
    })),
  ];
  if (input.localPaths.length === 0 || input.r2Keys.length === 0) {
    throw new Error('Removed-SKU cleanup requires both local and R2 resource evidence.');
  }
  const journal: RemovedSkuCleanupJournal = {
    groupId: input.groupId, revisionId: input.revisionId,
    targetVariationId: input.targetVariationId, targetSku: input.targetSku,
    operatorConfirmed: false, deletionAuthorized: false, resources,
  };
  validateJournal(journal);
  return journal;
}

/**
 * Updates an in-memory copy only. A future executor must persist its journal
 * transactionally BEFORE invoking any destructive provider operation.
 *
 * An interrupted "attempting" state is recorded as "unknown" by recovery;
 * neither unknown nor failed may auto-retry without independent reconciliation.
 */
export function transitionRemovedSkuCleanup(
  journal: RemovedSkuCleanupJournal,
  transition: RemovedSkuCleanupTransition,
): RemovedSkuCleanupJournal {
  validateJournal(journal);
  const index = journal.resources.findIndex((resource) =>
    resource.kind === transition.kind && resource.identity === transition.identity);
  if (index < 0) throw new Error('Removed-SKU cleanup resource is not in the frozen plan.');
  const current = journal.resources[index]!;
  if (current.state !== transition.expectedState ||
      current.state !== 'planned' && current.state !== 'attempting' ||
      current.state === 'planned' && transition.nextState !== 'attempting' ||
      current.state === 'attempting' && !['removed', 'already_absent', 'failed', 'unknown'].includes(transition.nextState)) {
    throw new Error('Removed-SKU cleanup transition is stale, terminal, or requires independent reconciliation.');
  }
  if (transition.nextState === 'attempting' && current.attemptCount !== 0) {
    throw new Error('Removed-SKU cleanup cannot retry an existing attempt without reconciliation.');
  }
  if (transition.nextState === 'failed' || transition.nextState === 'unknown') {
    if (!exactIdentity(transition.lastError ?? '')) {
      throw new Error('Removed-SKU cleanup failure requires an explicit reason.');
    }
  } else if (transition.lastError !== undefined) {
    throw new Error('Removed-SKU cleanup successful transition cannot carry an error.');
  }
  const updated: RemovedSkuCleanupResource = {
    ...current,
    state: transition.nextState,
    attemptCount: current.attemptCount + (transition.nextState === 'attempting' ? 1 : 0),
    lastError: transition.lastError ?? null,
  };
  const result = {...journal, resources: journal.resources.map((item, i) => i === index ? updated : {...item})};
  validateJournal(result);
  return result;
}

export function recoverInterruptedRemovedSkuCleanup(journal: RemovedSkuCleanupJournal): RemovedSkuCleanupJournal {
  validateJournal(journal);
  const result: RemovedSkuCleanupJournal = {
    ...journal,
    resources: journal.resources.map((resource) => resource.state === 'attempting'
      ? {...resource, state: 'unknown', lastError: 'Interrupted operation; provider outcome requires reconciliation.'}
      : {...resource}),
  };
  validateJournal(result);
  return result;
}

export function summarizeRemovedSkuCleanupJournal(journal: RemovedSkuCleanupJournal): {
  terminal: number;
  pending: number;
  uncertain: number;
  deletionAuthorized: false;
} {
  validateJournal(journal);
  return {
    terminal: journal.resources.filter((resource) => terminal.has(resource.state)).length,
    pending: journal.resources.filter((resource) => resource.state === 'planned').length,
    uncertain: journal.resources.filter((resource) =>
      ['attempting', 'failed', 'unknown'].includes(resource.state)).length,
    deletionAuthorized: false,
  };
}
