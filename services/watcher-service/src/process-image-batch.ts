import { getActiveWatcherCaptureMode, type WatcherCaptureMode } from './config/index.js';
import type { WatcherAppSettingsRepository, WatcherListingIdRepository } from './data/index.js';
import {
  moveGroupedImagesToProcessedListing,
  type ProcessedImageMoveFileSystem,
  type ProcessedImageMoveRecord,
  type ProcessedImageMoveResult,
} from './file-move.js';
import {
  consumeImageGrouping,
  createEmptyWatcherGroupingState,
  type WatcherGroupingInput,
  type WatcherGroupingState,
} from './image-grouping.js';
import {
  allocateNextListingId,
  getListingIdPrefixForCaptureMode,
  getNextListingIdFromLatest,
  type ListingIdPrefix,
} from './listing-id.js';
import type { ProcessedImageMoveInput } from './processed-paths.js';

export interface ProcessIncomingImageBatchInput {
  incoming: readonly WatcherGroupingInput[];
  processedDirectory: string;
  groupingState?: WatcherGroupingState;
}

export interface ProcessedIncomingListing {
  listingId: string;
  captureMode: WatcherCaptureMode;
  processedDirectory: string;
  images: ProcessedImageMoveRecord[];
}

export interface ProcessIncomingImageBatchResult {
  processedListings: ProcessedIncomingListing[];
  groupingState: WatcherGroupingState;
}

export interface ProcessIncomingImageBatchDependencies {
  getActiveWatcherCaptureMode(): Promise<WatcherCaptureMode>;
  consumeImageGrouping: typeof consumeImageGrouping;
  allocateNextListingId(captureMode: WatcherCaptureMode): Promise<string>;
  moveGroupedImagesToProcessedListing(
    input: ProcessedImageMoveInput
  ): Promise<ProcessedImageMoveResult>;
}

export interface CreateProcessIncomingImageBatchDependenciesInput {
  appSettingsRepository?: Pick<WatcherAppSettingsRepository, 'get'>;
  listingIdRepository?: Pick<WatcherListingIdRepository, 'getLatestByPrefix'>;
  fileSystem?: ProcessedImageMoveFileSystem;
}

function cloneWatcherGroupingState(state: WatcherGroupingState): WatcherGroupingState {
  return {
    pending: state.pending.map((image) => ({ path: image.path })),
  };
}

function createBatchListingIdAllocator(
  dependencies: Pick<ProcessIncomingImageBatchDependencies, 'allocateNextListingId'>
): (captureMode: WatcherCaptureMode) => Promise<string> {
  const latestListingIdByPrefix = new Map<ListingIdPrefix, string>();

  return async (captureMode) => {
    const prefix = getListingIdPrefixForCaptureMode(captureMode);
    const latestListingId = latestListingIdByPrefix.get(prefix);
    const nextListingId =
      latestListingId === undefined
        ? await dependencies.allocateNextListingId(captureMode)
        : getNextListingIdFromLatest(prefix, latestListingId);

    latestListingIdByPrefix.set(prefix, nextListingId);

    return nextListingId;
  };
}

export function createProcessIncomingImageBatchDependencies(
  input: CreateProcessIncomingImageBatchDependenciesInput = {}
): ProcessIncomingImageBatchDependencies {
  return {
    getActiveWatcherCaptureMode: async () => await getActiveWatcherCaptureMode(input.appSettingsRepository),
    consumeImageGrouping,
    allocateNextListingId: async (captureMode) =>
      await allocateNextListingId(captureMode, input.listingIdRepository),
    moveGroupedImagesToProcessedListing: async (moveInput) =>
      await moveGroupedImagesToProcessedListing(moveInput, input.fileSystem),
  };
}

export async function processIncomingImageBatch(
  input: ProcessIncomingImageBatchInput,
  dependencies: ProcessIncomingImageBatchDependencies = createProcessIncomingImageBatchDependencies()
): Promise<ProcessIncomingImageBatchResult> {
  const captureMode = await dependencies.getActiveWatcherCaptureMode();
  const initialGroupingState = cloneWatcherGroupingState(
    input.groupingState ?? createEmptyWatcherGroupingState()
  );
  const groupingResult = dependencies.consumeImageGrouping(
    captureMode,
    input.incoming,
    initialGroupingState
  );
  const allocateListingId = createBatchListingIdAllocator(dependencies);
  const processedListings: ProcessedIncomingListing[] = [];

  for (const group of groupingResult.completedGroups) {
    const listingId = await allocateListingId(group.captureMode);
    const processedMoveResult = await dependencies.moveGroupedImagesToProcessedListing({
      listingId,
      processedDirectory: input.processedDirectory,
      images: group.images,
    });

    processedListings.push({
      listingId: processedMoveResult.listingId,
      captureMode: group.captureMode,
      processedDirectory: processedMoveResult.processedDirectory,
      images: processedMoveResult.images,
    });
  }

  return {
    processedListings,
    groupingState: groupingResult.state,
  };
}
