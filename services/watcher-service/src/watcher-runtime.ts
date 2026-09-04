import chokidar, { type FSWatcher, type WatchOptions } from 'chokidar';
import { basename, isAbsolute, normalize, resolve } from 'node:path';
import {
  DEFAULT_AI_GENERATION_MAX_ATTEMPTS,
  DEFAULT_RECOVERABLE_RETRY_DELAY_FIRST_MS,
  DEFAULT_RECOVERABLE_RETRY_DELAY_NEXT_MS,
  getRecoverableRetryDelayMs,
  resolvePositiveIntegerSetting,
} from '@ebay-inventory/types';

import { createWatcherServiceConfig, type WatcherServiceConfig, type WatcherServiceConfigInput } from './config/index.js';
import { createEmptyWatcherGroupingState, type WatcherGroupingState } from './image-grouping.js';
import {
  createProcessIncomingImageBatchDependencies,
  processIncomingImageBatch,
  WatcherBatchProcessingError,
  type ProcessIncomingImageBatchDependencies,
} from './process-image-batch.js';
import {
  createVariationListingRuntimeProcessor,
  type VariationListingRuntimeProcessor,
} from './variation-listing-runtime.js';
import { VariationListingSidecarRetryableError } from './variation-listing-sidecar.js';

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
  variationListingRuntimeProcessor?: VariationListingRuntimeProcessor;
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
  const captureSourceKey = config.variationListingCaptureSourceKey;
  const variationRuntime =
    typeof captureSourceKey === 'string' && captureSourceKey.length > 0
      ? input.variationListingRuntimeProcessor ??
        createVariationListingRuntimeProcessor({
          captureSourceKey,
          // Keep process credentials/configuration while allowing the explicit
          // config input to override watcher-local values in tests/embedders.
          env: {
            ...process.env,
            ...(input.configInput?.env ?? {}),
          },
        })
      : null;
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
  const variationRetryAttempts = new Map<string, number>();
  let variationRetryTimer: ReturnType<typeof setTimeout> | null = null;
  let blockedVariationPath: string | null = null;
  const consumedVariationPaths = new Set<string>();
  const legacyPathHints = new Set<string>();

  const watcher = watch(config.incomingDirectory, WATCHER_RUNTIME_WATCH_OPTIONS);

  function scheduleVariationRetry(sourcePath: string): boolean {
    if (state.isClosed) return false;
    const attemptsUsed = (variationRetryAttempts.get(sourcePath) ?? 0) + 1;
    variationRetryAttempts.set(sourcePath, attemptsUsed);
    // Preserve process-level retry settings while allowing explicit watcher
    // embedder/test overrides to win on a per-key basis.
    const retryEnv = {
      ...process.env,
      ...(input.configInput?.env ?? {}),
    } as NodeJS.ProcessEnv;
    const maxAttempts = resolvePositiveIntegerSetting(
      retryEnv.SIDECAR_JOB_MAX_ATTEMPTS_GENERATE_AI,
      DEFAULT_AI_GENERATION_MAX_ATTEMPTS
    );
    if (attemptsUsed >= maxAttempts) {
      logger.error('variation_retry_exhausted', { sourcePath, attemptsUsed, maxAttempts });
      return false;
    }
    const firstDelayMs = resolvePositiveIntegerSetting(
      retryEnv.SIDECAR_JOB_RETRY_DELAY_FIRST_MS,
      DEFAULT_RECOVERABLE_RETRY_DELAY_FIRST_MS
    );
    const nextDelayMs = resolvePositiveIntegerSetting(
      retryEnv.SIDECAR_JOB_RETRY_DELAY_NEXT_MS,
      DEFAULT_RECOVERABLE_RETRY_DELAY_NEXT_MS
    );
    const delayMs = getRecoverableRetryDelayMs(attemptsUsed, firstDelayMs, nextDelayMs);
    logger.info('variation_retry_scheduled', { sourcePath, attemptsUsed, maxAttempts, delayMs });
    // There is one authoritative retry deadline. New add events append to the
    // retained queue but never replace or bypass an existing timer.
    if (variationRetryTimer) return true;
    variationRetryTimer = setTimeout(() => {
      variationRetryTimer = null;
      void drainQueue();
    }, delayMs);
    return true;
  }

  function removeConsumedVariationInputs(): void {
    if (consumedVariationPaths.size === 0 || state.pendingQueue.length === 0) return;

    const retained = state.pendingQueue.filter((sourcePath) => !consumedVariationPaths.has(sourcePath));
    if (retained.length === state.pendingQueue.length) return;
    state.pendingQueue.length = 0;
    state.pendingQueue.push(...retained);
  }

  async function drainQueue(): Promise<void> {
    removeConsumedVariationInputs();
    if (state.isClosed || state.isProcessing || variationRetryTimer || state.pendingQueue.length === 0) {
      return;
    }
    if (blockedVariationPath) {
      // A terminal variation failure is retained for operator recovery. The
      // retained path is always unshifted ahead of newly arrived inputs; only
      // explicit removal by an operator clears the terminal gate.
      if (state.pendingQueue.includes(blockedVariationPath)) return;
      variationRetryAttempts.delete(blockedVariationPath);
      blockedVariationPath = null;
    }

    state.isProcessing = true;
    let shouldResumeDraining = true;
    activeDrainPromise = (async () => {
      try {
        while (!state.isClosed && state.pendingQueue.length > 0) {
          const snapshot = [...state.pendingQueue];
          state.pendingQueue.length = 0;

          let variationRetryInputs: string[] = [];
          let variationRetrySource: string | null = null;
          let variationRetryable = false;
          let legacyInputsForBatch: string[] = [];
          try {
            const legacyInputs: string[] = [];
            let variationProcessedCount = 0;
            for (const [sourceIndex, sourcePath] of snapshot.entries()) {
              if (!variationRuntime) {
                legacyInputs.push(sourcePath);
                continue;
              }
              if (consumedVariationPaths.has(sourcePath)) {
                continue;
              }
              if (legacyPathHints.has(sourcePath)) {
                legacyInputs.push(sourcePath);
                continue;
              }
              try {
                const outcome = await variationRuntime.process(sourcePath);
                if (outcome.kind === 'legacy') {
                  legacyInputs.push(sourcePath);
                  // Preserve the first classification across retries. A new
                  // durable variation session must not re-route this already
                  // classified legacy input.
                  legacyPathHints.add(sourcePath);
                  continue;
                }
                variationProcessedCount += 1;
                consumedVariationPaths.add(sourcePath);
                variationRetryAttempts.delete(sourcePath);
                logger.info(`variation_${outcome.kind}`, outcome);
              } catch (error) {
                variationRetryInputs = [...legacyInputs, ...snapshot.slice(sourceIndex)];
                variationRetrySource = sourcePath;
                variationRetryable = error instanceof VariationListingSidecarRetryableError;
                throw error;
              }
            }

            legacyInputsForBatch = legacyInputs;
            const result = legacyInputs.length > 0
              ? await processBatch(
                  {
                    incoming: legacyInputs,
                    processedDirectory: config.processedDirectory,
                    groupingState: state.groupingState,
                  },
                  batchDependencies
                )
              : {
                  groupingState: state.groupingState,
                  processedListings: [],
                };

            state.groupingState = cloneWatcherGroupingState(result.groupingState);
            for (const processedListing of result.processedListings) {
              logger.info('watcher_group_completed', {
                captureMode: processedListing.captureMode,
                imageCount: processedListing.images.length,
                listingId: processedListing.listingId,
                processedDirectory: processedListing.processedDirectory,
              });
              logger.info('watcher_listing_persisted', {
                imageCount: processedListing.images.length,
                listingId: processedListing.listingId,
                status: processedListing.listing.status,
                subStatus: processedListing.listing.sub_status,
              });
            }
            logger.info('batch_processed', {
              fileCount: snapshot.length,
              legacyFileCount: legacyInputs.length,
              variationProcessedCount,
              pendingGroupSize: state.groupingState.pending.length,
              pendingQueueSize: state.pendingQueue.length,
              processedListingCount: result.processedListings.length,
            });
            for (const sourcePath of legacyInputsForBatch) {
              if (!state.pendingQueue.includes(sourcePath)) {
                legacyPathHints.delete(sourcePath);
              }
            }
          } catch (error) {
            if (error instanceof WatcherBatchProcessingError) {
              const retryInputs = new Set(error.retryInputs);
              for (const sourcePath of legacyInputsForBatch) {
                if (!retryInputs.has(sourcePath) && !state.pendingQueue.includes(sourcePath)) {
                  legacyPathHints.delete(sourcePath);
                }
              }
              state.groupingState = cloneWatcherGroupingState(error.groupingState);
              state.pendingQueue.unshift(...cloneWatcherInputs(error.retryInputs));
              shouldResumeDraining = false;
            }
            if (!(error instanceof WatcherBatchProcessingError)) {
              state.pendingQueue.unshift(...variationRetryInputs);
              removeConsumedVariationInputs();
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
                error instanceof WatcherBatchProcessingError
                  ? error.retryInputs.length
                  : variationRetryInputs.length,
              stack: error instanceof Error ? error.stack : undefined,
            });

            if (variationRetryable && variationRetrySource) {
              if (!scheduleVariationRetry(variationRetrySource)) {
                blockedVariationPath = variationRetrySource;
              }
            } else if (variationRetrySource) {
              variationRetryAttempts.delete(variationRetrySource);
              blockedVariationPath = variationRetrySource;
            }

            if (error instanceof WatcherBatchProcessingError || variationRetryInputs.length > 0) {
              break;
            }
          }
        }
      } finally {
        state.isProcessing = false;
        activeDrainPromise = null;

        if (!state.isClosed && !variationRetryTimer && !blockedVariationPath && state.pendingQueue.length === 0) {
          // Keep duplicate suppression bounded to the active drain/retry
          // sequence; a later filesystem add may represent a replacement file.
          consumedVariationPaths.clear();
        }

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
    if (variationRuntime && consumedVariationPaths.has(normalizedPath)) {
      logger.info('variation_input_ignored_consumed', {
        path: normalizedPath,
      });
      return;
    }
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
        if (variationRetryTimer) {
          clearTimeout(variationRetryTimer);
          variationRetryTimer = null;
        }
        await watcher.close();

        if (activeDrainPromise) {
          await activeDrainPromise;
        }
      })();

      await closePromise;
    },
  };
}
