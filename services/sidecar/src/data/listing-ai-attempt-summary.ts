import type { AiModelAttemptRow, AiModelAttemptStatus } from '@ebay-inventory/data';

const AI_MODEL_ATTEMPT_STATUSES = new Set<AiModelAttemptStatus>([
  'failed',
  'skipped',
  'started',
  'succeeded',
]);

export interface AiAttemptSummary {
  attempt_count: number;
  latest_failure_code: string | null;
  latest_finished_at: string | null;
  latest_model_name: string | null;
  latest_provider: string | null;
  latest_started_at: string | null;
  latest_status: AiModelAttemptStatus | null;
}

export type AiAttemptSummaryByListingId = Map<string, AiAttemptSummary>;

function createEmptyAiAttemptSummary(): AiAttemptSummary {
  return {
    attempt_count: 0,
    latest_failure_code: null,
    latest_finished_at: null,
    latest_model_name: null,
    latest_provider: null,
    latest_started_at: null,
    latest_status: null,
  };
}

function getAiModelAttemptStatus(status: string): AiModelAttemptStatus | null {
  return AI_MODEL_ATTEMPT_STATUSES.has(status as AiModelAttemptStatus)
    ? (status as AiModelAttemptStatus)
    : null;
}

function isLaterAttempt(current: AiModelAttemptRow, previous: AiModelAttemptRow): boolean {
  if (current.created_at !== previous.created_at) {
    return current.created_at > previous.created_at;
  }

  if (current.attempt_order !== previous.attempt_order) {
    return current.attempt_order > previous.attempt_order;
  }

  return current.id > previous.id;
}

export function summarizeAiModelAttemptsByListingId(
  listingIds: string[],
  attempts: AiModelAttemptRow[]
): AiAttemptSummaryByListingId {
  const summaries = new Map<string, AiAttemptSummary & { latestAttempt?: AiModelAttemptRow }>();

  for (const listingId of new Set(listingIds)) {
    summaries.set(listingId, createEmptyAiAttemptSummary());
  }

  for (const attempt of attempts) {
    const summary = summaries.get(attempt.listing_id);

    if (!summary) {
      continue;
    }

    summary.attempt_count += 1;

    if (!summary.latestAttempt || isLaterAttempt(attempt, summary.latestAttempt)) {
      summary.latestAttempt = attempt;
      summary.latest_failure_code = attempt.failure_code;
      summary.latest_finished_at = attempt.finished_at;
      summary.latest_model_name = attempt.model_name;
      summary.latest_provider = attempt.provider;
      summary.latest_started_at = attempt.started_at;
      summary.latest_status = getAiModelAttemptStatus(attempt.status);
    }
  }

  return new Map(
    Array.from(summaries.entries()).map(([listingId, summary]) => {
      const { latestAttempt: _latestAttempt, ...publicSummary } = summary;
      return [listingId, publicSummary];
    })
  );
}
