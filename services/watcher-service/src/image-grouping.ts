import type { WatcherCaptureMode } from './config/capture-modes.js';
import { isSupportedWatcherImagePath } from './config/image-extensions.js';

export interface WatcherImageDescriptor {
  path: string;
}

export type WatcherGroupingInput = string | WatcherImageDescriptor;

export interface WatcherImageGroup {
  captureMode: WatcherCaptureMode;
  images: WatcherImageDescriptor[];
}

export interface WatcherGroupingState {
  pending: WatcherImageDescriptor[];
}

export interface ConsumeImageGroupingResult {
  completedGroups: WatcherImageGroup[];
  state: WatcherGroupingState;
}

export const EMPTY_WATCHER_GROUPING_STATE: WatcherGroupingState = {
  pending: [],
};

export const GROUP_SIZE_BY_CAPTURE_MODE = {
  lot_3_image: 3,
  single_2_image: 2,
} as const satisfies Record<WatcherCaptureMode, number>;

export function createEmptyWatcherGroupingState(): WatcherGroupingState {
  return {
    pending: [],
  };
}

export function getGroupSizeForCaptureMode(captureMode: WatcherCaptureMode): number {
  return GROUP_SIZE_BY_CAPTURE_MODE[captureMode];
}

export function normalizeWatcherGroupingInput(
  input: WatcherGroupingInput
): WatcherImageDescriptor {
  return typeof input === 'string' ? { path: input } : { path: input.path };
}

export function isSupportedWatcherGroupingInput(input: WatcherGroupingInput): boolean {
  return isSupportedWatcherImagePath(normalizeWatcherGroupingInput(input).path);
}

export function consumeImageGrouping(
  captureMode: WatcherCaptureMode,
  incoming: readonly WatcherGroupingInput[],
  state: WatcherGroupingState = EMPTY_WATCHER_GROUPING_STATE
): ConsumeImageGroupingResult {
  const groupSize = getGroupSizeForCaptureMode(captureMode);
  const nextPending = state.pending.map((image) => ({ path: image.path }));
  const completedGroups: WatcherImageGroup[] = [];

  for (const item of incoming) {
    if (!isSupportedWatcherGroupingInput(item)) {
      continue;
    }

    nextPending.push(normalizeWatcherGroupingInput(item));

    if (nextPending.length === groupSize) {
      completedGroups.push({
        captureMode,
        images: nextPending.splice(0, groupSize),
      });
    }
  }

  return {
    completedGroups,
    state: {
      pending: nextPending,
    },
  };
}
