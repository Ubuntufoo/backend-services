import type { ListingRow } from '@ebay-inventory/data';
import { getActiveWatcherCaptureMode, type WatcherCaptureMode } from './config/index.js';
import type {
  CreateWatcherListingInput,
  WatcherAppSettingsRepository,
  WatcherListingIdRepository,
  WatcherListingRepository,
} from './data/index.js';
import { createWatcherListingRepository, isWatcherListingIdUniqueViolation } from './data/index.js';
import {
  moveGroupedImagesToProcessedListing,
  type ProcessedImageMoveFileSystem,
  type ProcessedImageMoveRecord,
  type ProcessedImageMoveResult,
  rollbackProcessedListingMove,
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
  listing: ListingRow;
}

export interface ProcessIncomingImageBatchResult {
  processedListings: ProcessedIncomingListing[];
  groupingState: WatcherGroupingState;
}

export interface ProcessIncomingImageBatchDependencies {
  getActiveWatcherCaptureMode(): Promise<WatcherCaptureMode>;
  consumeImageGrouping: typeof consumeImageGrouping;
  allocateNextListingId(captureMode: WatcherCaptureMode): Promise<string>;
  createWatcherListing(input: CreateWatcherListingInput): Promise<ListingRow>;
  isWatcherListingCollision(error: unknown): boolean;
  moveGroupedImagesToProcessedListing(
    input: ProcessedImageMoveInput
  ): Promise<ProcessedImageMoveResult>;
  rollbackProcessedListingMove(moveResult: ProcessedImageMoveResult): Promise<void>;
}

export interface CreateProcessIncomingImageBatchDependenciesInput {
  appSettingsRepository?: Pick<WatcherAppSettingsRepository, 'get'>;
  listingIdRepository?: Pick<WatcherListingIdRepository, 'getLatestByPrefix'>;
  watcherListingRepository?: Pick<WatcherListingRepository, 'createWatcherListing'>;
  fileSystem?: ProcessedImageMoveFileSystem;
}

export const WATCHER_LISTING_INSERT_MAX_ATTEMPTS = 5;

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
  const watcherListingRepository =
    input.watcherListingRepository ?? createWatcherListingRepository();

  return {
    getActiveWatcherCaptureMode: async () => await getActiveWatcherCaptureMode(input.appSettingsRepository),
    consumeImageGrouping,
    allocateNextListingId: async (captureMode) =>
      await allocateNextListingId(captureMode, input.listingIdRepository),
    createWatcherListing: async (listingInput) =>
      await watcherListingRepository.createWatcherListing(listingInput),
    isWatcherListingCollision: isWatcherListingIdUniqueViolation,
    moveGroupedImagesToProcessedListing: async (moveInput) =>
      await moveGroupedImagesToProcessedListing(moveInput, input.fileSystem),
    rollbackProcessedListingMove: async (moveResult) =>
      await rollbackProcessedListingMove(moveResult, input.fileSystem),
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function persistCompletedGroup(
  group: { captureMode: WatcherCaptureMode; images: readonly { path: string }[] },
  processedDirectory: string,
  allocateListingId: (captureMode: WatcherCaptureMode) => Promise<string>,
  dependencies: ProcessIncomingImageBatchDependencies
): Promise<ProcessedIncomingListing> {
  for (let attempt = 1; attempt <= WATCHER_LISTING_INSERT_MAX_ATTEMPTS; attempt += 1) {
    const listingId = await allocateListingId(group.captureMode);
    const processedMoveResult = await dependencies.moveGroupedImagesToProcessedListing({
      listingId,
      processedDirectory,
      images: group.images,
    });

    try {
      const listing = await dependencies.createWatcherListing({
        listingId: processedMoveResult.listingId,
        captureMode: group.captureMode,
        images: processedMoveResult.images,
      });

      return {
        listingId: processedMoveResult.listingId,
        captureMode: group.captureMode,
        processedDirectory: processedMoveResult.processedDirectory,
        images: processedMoveResult.images,
        listing,
      };
    } catch (error) {
      try {
        await dependencies.rollbackProcessedListingMove(processedMoveResult);
      } catch (rollbackError) {
        throw new Error(
          `Watcher listing insert failed for ${listingId}: ${getErrorMessage(
            error
          )}. ${getErrorMessage(rollbackError)}`
        );
      }

      if (!dependencies.isWatcherListingCollision(error)) {
        throw error;
      }

      if (attempt === WATCHER_LISTING_INSERT_MAX_ATTEMPTS) {
        throw new Error(
          `Watcher listing insert hit retry cap (${WATCHER_LISTING_INSERT_MAX_ATTEMPTS}) after listing_id collision. Last listing_id: ${listingId}.`
        );
      }
    }
  }

  throw new Error('Watcher listing insert retry loop terminated unexpectedly.');
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
    processedListings.push(
      await persistCompletedGroup(
        group,
        input.processedDirectory,
        allocateListingId,
        dependencies
      )
    );
  }

  return {
    processedListings,
    groupingState: groupingResult.state,
  };
}
