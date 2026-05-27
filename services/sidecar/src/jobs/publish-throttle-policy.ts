const DEFAULT_PUBLISH_MAX_PER_TICK = 1;
const DEFAULT_PUBLISH_MIN_INTERVAL_MS = 10_000;

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

export interface PublishThrottlePolicy {
  maxPerTick: number;
  minIntervalMs: number;
}

export function getPublishThrottlePolicy(
  env: NodeJS.ProcessEnv = process.env
): PublishThrottlePolicy {
  return {
    maxPerTick: readPositiveIntegerEnv(env, 'SIDECAR_PUBLISH_MAX_PER_TICK', DEFAULT_PUBLISH_MAX_PER_TICK),
    minIntervalMs: readPositiveIntegerEnv(
      env,
      'SIDECAR_PUBLISH_MIN_INTERVAL_MS',
      DEFAULT_PUBLISH_MIN_INTERVAL_MS
    ),
  };
}

export function getNextPublishEligibleAt(now: Date, policy: PublishThrottlePolicy): string {
  return new Date(now.getTime() + policy.minIntervalMs).toISOString();
}
