export type VariationListingIntakeProcessingPhase =
  | 'waiting_for_back'
  | 'generating_identity'
  | 'saving'
  | 'ready'
  | 'failed';

export type VariationListingIntakeFailureKind =
  | 'gemini'
  | 'storage'
  | 'gemini_and_storage'
  | 'persistence';

export interface VariationListingIntakeProcessingStatus {
  captureSourceKey: string;
  targetGroupId: string;
  pairId: string;
  phase: VariationListingIntakeProcessingPhase;
  completionKind: 'new_variation' | 'duplicate_copy';
  message: string | null;
  failureKind: VariationListingIntakeFailureKind | null;
  retryable: boolean;
  retryRequested: boolean;
  updatedAt: string;
}

const statuses = new Map<string, VariationListingIntakeProcessingStatus>();

export function setVariationListingIntakeProcessingStatus(
  status: Omit<VariationListingIntakeProcessingStatus, 'updatedAt' | 'retryRequested' | 'failureKind' | 'retryable'> & {
    failureKind?: VariationListingIntakeFailureKind | null;
    retryable?: boolean;
    retryRequested?: boolean;
  },
  now: () => Date = () => new Date()
): VariationListingIntakeProcessingStatus {
  const previous = statuses.get(status.captureSourceKey);
  const next = {
    ...status,
    failureKind: status.failureKind ?? null,
    retryable: status.retryable ?? false,
    retryRequested: status.retryRequested ?? (previous?.pairId === status.pairId ? previous.retryRequested : false),
    updatedAt: now().toISOString(),
  };
  statuses.set(status.captureSourceKey, next);
  return next;
}

export function getVariationListingIntakeProcessingStatus(
  captureSourceKey: string
): VariationListingIntakeProcessingStatus | null {
  return statuses.get(captureSourceKey) ?? null;
}

export function requestVariationListingIntakeRetry(
  captureSourceKey: string,
  pairId: string,
  now: () => Date = () => new Date(),
): VariationListingIntakeProcessingStatus | null {
  const current = statuses.get(captureSourceKey);
  if (!current || current.pairId !== pairId || current.phase !== 'failed' || !current.retryable) return null;
  const next = { ...current, retryRequested: true, updatedAt: now().toISOString() };
  statuses.set(captureSourceKey, next);
  return next;
}

export function claimVariationListingIntakeRetry(
  captureSourceKey: string,
  pairId: string,
  options: { canRetry: boolean },
  now: () => Date = () => new Date(),
): { approved: boolean; status: VariationListingIntakeProcessingStatus | null } {
  const current = statuses.get(captureSourceKey) ?? null;
  if (!current || current.pairId !== pairId || current.phase !== 'failed') {
    return { approved: false, status: current };
  }
  if (!options.canRetry && current.retryable) {
    const exhausted = { ...current, retryRequested: false, retryable: false, updatedAt: now().toISOString() };
    statuses.set(captureSourceKey, exhausted);
    return { approved: false, status: exhausted };
  }
  if (!current.retryRequested) return { approved: false, status: current };
  const next = {
    ...current,
    retryRequested: false,
    retryable: current.retryable,
    updatedAt: now().toISOString(),
  };
  statuses.set(captureSourceKey, next);
  return { approved: options.canRetry && current.retryable, status: next };
}

export function clearVariationListingIntakeProcessingStatus(
  captureSourceKey: string
): void {
  statuses.delete(captureSourceKey);
}
