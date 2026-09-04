export const DEFAULT_AI_GENERATION_MAX_ATTEMPTS = 3;
export const DEFAULT_RECOVERABLE_RETRY_DELAY_FIRST_MS = 60 * 1000;
export const DEFAULT_RECOVERABLE_RETRY_DELAY_NEXT_MS = 5 * 60 * 1000;

export function resolvePositiveIntegerSetting(
  rawValue: string | undefined,
  fallback: number
): number {
  const normalized = rawValue?.trim();
  if (!normalized) return fallback;
  const parsed = Number.parseInt(normalized, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getRecoverableRetryDelayMs(
  attemptsUsed: number,
  firstDelayMs = DEFAULT_RECOVERABLE_RETRY_DELAY_FIRST_MS,
  nextDelayMs = DEFAULT_RECOVERABLE_RETRY_DELAY_NEXT_MS
): number {
  return attemptsUsed <= 1 ? firstDelayMs : nextDelayMs;
}
