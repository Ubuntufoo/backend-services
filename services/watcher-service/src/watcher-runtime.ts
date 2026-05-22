import chokidar, { type FSWatcher, type WatchOptions } from 'chokidar';
import { basename, isAbsolute, normalize, resolve } from 'node:path';

import { createWatcherServiceConfig, type WatcherServiceConfig, type WatcherServiceConfigInput } from './config/index.js';
import { createEmptyWatcherGroupingState, type WatcherGroupingState } from './image-grouping.js';
import {
  createProcessIncomingImageBatchDependencies,
  processIncomingImageBatch,
  WatcherBatchProcessingError,
  type ProcessIncomingImageBatchDependencies,
} from './process-image-batch.js';

export interface WatcherRuntimeState {
  pendingQueue: string[];
  groupingState: WatcherGroupingState;
  isProcessing: boolean;
  isClosed: boolean;
}

export interface WatcherRuntime {
  state: WatcherRuntimeState;
  close(): Promise<void>;
}

export interface WatcherRuntimeLogger {
  info(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

export interface WatcherRuntimeWatcher {
  on(event: 'add', listener: (path: string) => void): this;
  on(event: 'error', listener: (error: unknown) => void): this;
  on(event: 'ready', listener: () => void): this;
  close(): Promise<void>;
}

export interface StartWatcherRuntimeInput {
  config?: WatcherServiceConfig;
  configInput?: WatcherServiceConfigInput;
  initialGroupingState?: WatcherGroupingState;
  logger?: WatcherRuntimeLogger;
  watch?: (path: string, options: WatchOptions) => WatcherRuntimeWatcher;
  processIncomingImageBatch?: typeof processIncomingImageBatch;
  processIncomingImageBatchDependencies?: ProcessIncomingImageBatchDependencies;
}

function shouldIgnoreWatcherPath(filePath: string): boolean {
  const fileName = basename(filePath);
  const lowerFileName = fileName.toLowerCase();

  return (
    fileName.startsWith('.') ||
    fileName.endsWith('~') ||
    fileName.startsWith('~$') ||
    lowerFileName === '.ds_store' ||
    lowerFileName.endsWith('.tmp') ||
    lowerFileName.endsWith('.temp') ||
    lowerFileName.endsWith('.part') ||
    lowerFileName.endsWith('.crdownload') ||
    lowerFileName.endsWith('.download') ||
    lowerFileName.endsWith('.swp') ||
    lowerFileName.endsWith('.swx')
  );
}

function normalizeWatcherRuntimePath(filePath: string): string {
  return normalize(isAbsolute(filePath) ? filePath : resolve(filePath));
}

function cloneWatcherGroupingState(state: WatcherGroupingState): WatcherGroupingState {
  return {
    pending: state.pending.map((image) => ({ path: image.path })),
  };
}

function cloneWatcherInputs(inputs: readonly string[]): string[] {
  return [...inputs];
}

function toSerializableFields(fields?: Record<string, unknown>): Record<string, unknown> {
  if (!fields) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => {
      if (value instanceof Error) {
        return [
          key,
          {
            message: value.message,
            stack: value.stack,
          },
        ];
      }

      return [key, value];
    })
  );
}

function createDefaultWatcherRuntimeLogger(): WatcherRuntimeLogger {
  function writeLog(level: 'info' | 'error', event: string, fields?: Record<string, unknown>): void {
    const payload = {
      level,
      service: 'watcher-service',
      event,
      ...toSerializableFields(fields),
    };
    const serialized = JSON.stringify(payload);

    if (level === 'error') {
      console.error(serialized);
      return;
    }

    console.info(serialized);
  }

  return {
    info: (event, fields) => {
      writeLog('info', event, fields);
    },
    error: (event, fields) => {
      writeLog('error', event, fields);
    },
  };
}

function createWatcherFactory(): (path: string, options: WatchOptions) => WatcherRuntimeWatcher {
  return (path, options) => chokidar.watch(path, options) as unknown as FSWatcher as WatcherRuntimeWatcher;
}

export const WATCHER_RUNTIME_WATCH_OPTIONS = {
  awaitWriteFinish: true,
  depth: 0,
  ignoreInitial: true,
  ignored: (pathValue: string) => shouldIgnoreWatcherPath(pathValue),
} as const satisfies WatchOptions;

export function startWatcherRuntime(input: StartWatcherRuntimeInput = {}): WatcherRuntime {
  const config = input.config ?? createWatcherServiceConfig(input.configInput);
  const logger = input.logger ?? createDefaultWatcherRuntimeLogger();
  const watch = input.watch ?? createWatcherFactory();
  const processBatch = input.processIncomingImageBatch ?? processIncomingImageBatch;
  const batchDependencies =
    input.processIncomingImageBatchDependencies ??
    (input.processIncomingImageBatch ? undefined : createProcessIncomingImageBatchDependencies());
  const state: WatcherRuntimeState = {
    pendingQueue: [],
    groupingState: cloneWatcherGroupingState(
      input.initialGroupingState ?? createEmptyWatcherGroupingState()
    ),
    isProcessing: false,
    isClosed: false,
  };

  let activeDrainPromise: Promise<void> | null = null;
  let closePromise: Promise<void> | null = null;

  const watcher = watch(config.incomingDirectory, WATCHER_RUNTIME_WATCH_OPTIONS);

  async function drainQueue(): Promise<void> {
    if (state.isClosed || state.isProcessing || state.pendingQueue.length === 0) {
      return;
    }

    state.isProcessing = true;
    let shouldResumeDraining = true;
    activeDrainPromise = (async () => {
      try {
        while (!state.isClosed && state.pendingQueue.length > 0) {
          const snapshot = [...state.pendingQueue];
          state.pendingQueue.length = 0;

          try {
            const result = await processBatch(
              {
                incoming: snapshot,
                processedDirectory: config.processedDirectory,
                groupingState: state.groupingState,
              },
              batchDependencies
            );

            state.groupingState = cloneWatcherGroupingState(result.groupingState);
            logger.info('batch_processed', {
              fileCount: snapshot.length,
              pendingGroupSize: state.groupingState.pending.length,
              pendingQueueSize: state.pendingQueue.length,
              processedListingCount: result.processedListings.length,
            });
          } catch (error) {
            if (error instanceof WatcherBatchProcessingError) {
              state.groupingState = cloneWatcherGroupingState(error.groupingState);
              state.pendingQueue.unshift(...cloneWatcherInputs(error.retryInputs));
              shouldResumeDraining = false;
            }

            logger.error('batch_failed', {
              error: error instanceof Error ? error.message : String(error),
              fileCount: snapshot.length,
              partialProcessedListingCount:
                error instanceof WatcherBatchProcessingError ? error.processedListings.length : 0,
              pendingQueueSize: state.pendingQueue.length,
              pendingGroupSize: state.groupingState.pending.length,
              retainedRetryInputCount:
                error instanceof WatcherBatchProcessingError ? error.retryInputs.length : 0,
              stack: error instanceof Error ? error.stack : undefined,
            });

            if (error instanceof WatcherBatchProcessingError) {
              break;
            }
          }
        }
      } finally {
        state.isProcessing = false;
        activeDrainPromise = null;

        if (!state.isClosed && shouldResumeDraining && state.pendingQueue.length > 0) {
          void drainQueue();
        }
      }
    })();

    await activeDrainPromise;
  }

  function enqueuePath(pathValue: string): void {
    if (state.isClosed) {
      return;
    }

    const normalizedPath = normalizeWatcherRuntimePath(pathValue);
    state.pendingQueue.push(normalizedPath);
    logger.info('file_detected', {
      path: normalizedPath,
      pendingQueueSize: state.pendingQueue.length,
    });
    void drainQueue();
  }

  watcher.on('add', enqueuePath);
  watcher.on('error', (error) => {
    logger.error('watcher_error', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  });
  watcher.on('ready', () => {
    logger.info('watcher_ready', {
      incomingDirectory: config.incomingDirectory,
    });
  });

  logger.info('watcher_started', {
    incomingDirectory: config.incomingDirectory,
    processedDirectory: config.processedDirectory,
  });

  return {
    state,
    close: async () => {
      if (closePromise) {
        await closePromise;
        return;
      }

      closePromise = (async () => {
        state.isClosed = true;
        await watcher.close();

        if (activeDrainPromise) {
          await activeDrainPromise;
        }
      })();

      await closePromise;
    },
  };
}
