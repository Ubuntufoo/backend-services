import type { JobRow } from '@ebay-inventory/data';

const DEFAULT_GENERATE_AI_MAX_ATTEMPTS = 3;
const DEFAULT_PROCESS_IMAGES_MAX_ATTEMPTS = 2;
const DEFAULT_STALE_LEASE_MS = 15 * 60 * 1000;
const DEFAULT_RETRY_DELAY_FIRST_MS = 60 * 1000;
const DEFAULT_RETRY_DELAY_NEXT_MS = 5 * 60 * 1000;

function readPositiveIntegerEnv(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number
): number {
  const rawValue = env[key]?.trim();

  if (!rawValue) {
    return fallback;
  }

  const parsed = Number.parseInt(rawValue, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getDefaultMaxAttempts(
  jobType: JobRow['job_type'],
  env: NodeJS.ProcessEnv = process.env
): number {
  if (jobType === 'process_images') {
    return readPositiveIntegerEnv(
      env,
      'SIDECAR_JOB_MAX_ATTEMPTS_PROCESS_IMAGES',
      DEFAULT_PROCESS_IMAGES_MAX_ATTEMPTS
    );
  }

  if (jobType === 'generate_ai') {
    return readPositiveIntegerEnv(
      env,
      'SIDECAR_JOB_MAX_ATTEMPTS_GENERATE_AI',
      DEFAULT_GENERATE_AI_MAX_ATTEMPTS
    );
  }

  return DEFAULT_GENERATE_AI_MAX_ATTEMPTS;
}

export function getJobMaxAttempts(
  job: Pick<JobRow, 'job_type' | 'max_attempts'>,
  env: NodeJS.ProcessEnv = process.env
): number {
  return job.max_attempts > 0 ? job.max_attempts : getDefaultMaxAttempts(job.job_type, env);
}

export function hasAttemptsRemaining(
  job: Pick<JobRow, 'attempts' | 'job_type' | 'max_attempts'>,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return job.attempts < getJobMaxAttempts(job, env);
}

export function getNextRetryAt(
  attemptsUsed: number,
  now: Date,
  env: NodeJS.ProcessEnv = process.env
): string {
  const firstDelayMs = readPositiveIntegerEnv(
    env,
    'SIDECAR_JOB_RETRY_DELAY_FIRST_MS',
    DEFAULT_RETRY_DELAY_FIRST_MS
  );
  const nextDelayMs = readPositiveIntegerEnv(
    env,
    'SIDECAR_JOB_RETRY_DELAY_NEXT_MS',
    DEFAULT_RETRY_DELAY_NEXT_MS
  );
  const delayMs = attemptsUsed <= 1 ? firstDelayMs : nextDelayMs;

  return new Date(now.getTime() + delayMs).toISOString();
}

export function getStaleLeaseMs(env: NodeJS.ProcessEnv = process.env): number {
  return readPositiveIntegerEnv(env, 'SIDECAR_JOB_LEASE_MS', DEFAULT_STALE_LEASE_MS);
}

export function isJobStale(
  job: Pick<JobRow, 'status' | 'updated_at'>,
  now: Date,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (job.status !== 'running') {
    return false;
  }

  const updatedAtMs = Date.parse(job.updated_at);

  if (Number.isNaN(updatedAtMs)) {
    return false;
  }

  return updatedAtMs < now.getTime() - getStaleLeaseMs(env);
}
