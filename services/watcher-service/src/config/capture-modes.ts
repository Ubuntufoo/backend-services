import { CAPTURE_MODES, type CaptureMode } from '@ebay-inventory/types';

export const WATCHER_CAPTURE_MODES = CAPTURE_MODES;
export type WatcherCaptureMode = CaptureMode;

const WATCHER_CAPTURE_MODE_SET = new Set<WatcherCaptureMode>(WATCHER_CAPTURE_MODES);

export function isSupportedWatcherCaptureMode(value: string): value is WatcherCaptureMode {
  return WATCHER_CAPTURE_MODE_SET.has(value as WatcherCaptureMode);
}

export function requireSupportedWatcherCaptureMode(
  value: string | null | undefined
): WatcherCaptureMode {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(
      `Watcher app settings are missing capture_mode. Supported values: ${WATCHER_CAPTURE_MODES.join(', ')}.`
    );
  }

  if (!isSupportedWatcherCaptureMode(value)) {
    throw new Error(
      `Unsupported watcher capture_mode "${value}". Supported values: ${WATCHER_CAPTURE_MODES.join(', ')}.`
    );
  }

  return value;
}
