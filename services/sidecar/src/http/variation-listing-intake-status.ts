export type VariationListingIntakeProcessingPhase =
  | 'waiting_for_back'
  | 'generating_identity'
  | 'saving'
  | 'ready'
  | 'failed';

export interface VariationListingIntakeProcessingStatus {
  captureSourceKey: string;
  targetGroupId: string;
  pairId: string;
  phase: VariationListingIntakeProcessingPhase;
  completionKind: 'new_variation' | 'duplicate_copy';
  message: string | null;
  updatedAt: string;
}

const statuses = new Map<string, VariationListingIntakeProcessingStatus>();

export function setVariationListingIntakeProcessingStatus(
  status: Omit<VariationListingIntakeProcessingStatus, 'updatedAt'>,
  now: () => Date = () => new Date()
): VariationListingIntakeProcessingStatus {
  const next = {
    ...status,
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

export function clearVariationListingIntakeProcessingStatus(
  captureSourceKey: string
): void {
  statuses.delete(captureSourceKey);
}
