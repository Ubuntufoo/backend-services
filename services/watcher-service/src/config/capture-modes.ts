import { CAPTURE_MODES, type CaptureMode } from '../../../../packages/types/build/index.js';

export const WATCHER_CAPTURE_MODES = CAPTURE_MODES;
export type WatcherCaptureMode = CaptureMode;

const WATCHER_CAPTURE_MODE_SET = new Set<WatcherCaptureMode>(WATCHER_CAPTURE_MODES);

export function isSupportedWatcherCaptureMode(value: string): value is WatcherCaptureMode {
  return WATCHER_CAPTURE_MODE_SET.has(value as WatcherCaptureMode);
}
