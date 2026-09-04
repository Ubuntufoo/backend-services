import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  consumeImageGrouping,
  createEmptyWatcherGroupingState,
  startWatcherRuntime,
  VariationListingSidecarRetryableError,
  WatcherBatchProcessingError,
} from '../../src/index.js';

class FakeWatcher {
  private addListeners: Array<(pathValue: string) => void> = [];
  private errorListeners: Array<(error: unknown) => void> = [];
  private readyListeners: Array<() => void> = [];

  readonly close = vi.fn(async () => undefined);

  on(event: 'add' | 'error' | 'ready', listener: ((pathValue: string) => void) | ((error: unknown) => void) | (() => void)): this {
    if (event === 'add') {
      this.addListeners.push(listener as (pathValue: string) => void);
      return this;
    }

    if (event === 'error') {
      this.errorListeners.push(listener as (error: unknown) => void);
      return this;
    }

    this.readyListeners.push(listener as () => void);
    return this;
  }

  emitAdd(pathValue: string): void {
    for (const listener of this.addListeners) {
      listener(pathValue);
    }
  }

  emitError(error: unknown): void {
    for (const listener of this.errorListeners) {
      listener(error);
    }
  }

  emitReady(): void {
    for (const listener of this.readyListeners) {
      listener();
    }
  }
}

function createDeferred<T>() {
  let resolveValue!: (value: T | PromiseLike<T>) => void;
  let rejectValue!: (reason?: unknown) => void;

  const promise = new Promise<T>((resolve, reject) => {
    resolveValue = resolve;
    rejectValue = reject;
  });

  return {
    promise,
    reject: rejectValue,
    resolve: resolveValue,
  };
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => {
    queueMicrotask(resolve);
  });
}

function createLogger() {
  return {
    error: vi.fn(),
    info: vi.fn(),
  };
}

describe('watcher runtime', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('enqueues normalized absolute paths from add events', async () => {
    // Existing legacy-path coverage remains below; variation-specific runtime coverage is intentionally narrow.
    const fakeWatcher = new FakeWatcher();
    const logger = createLogger();
    const processIncomingImageBatch = vi.fn(async (input) => ({
      groupingState: createEmptyWatcherGroupingState(),
      processedListings: [],
      ...input,
    }));

    const runtime = startWatcherRuntime({
      config: {
        baseDirectory: '/watcher',
        incomingDirectory: '/watcher/incoming',
        processedDirectory: '/watcher/processed',
        supportedCaptureModes: ['single_2_image', 'lot_3_image'],
        supportedImageExtensions: ['.jpg', '.jpeg', '.png', '.webp'],
      },
      logger,
      processIncomingImageBatch,
      watch: () => fakeWatcher,
    });

    fakeWatcher.emitAdd('/watcher/incoming/nested/../photo.jpg');
    await flushMicrotasks();
    await runtime.close();

    expect(processIncomingImageBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        incoming: [path.normalize('/watcher/incoming/photo.jpg')],
      }),
      undefined
    );
    expect(logger.info).toHaveBeenCalledWith(
      'file_detected',
      expect.objectContaining({
        path: path.normalize('/watcher/incoming/photo.jpg'),
      })
    );
  });

  it('routes an armed variation image through the variation processor without touching legacy grouping', async () => {
    const fakeWatcher = new FakeWatcher();
    const processIncomingImageBatch = vi.fn();
    const variationListingRuntimeProcessor = {
      process: vi.fn(async () => ({
        kind: 'started' as const,
        groupId: '11111111-1111-4111-8111-111111111111',
        pairId: '22222222-2222-4222-8222-222222222222',
      })),
    };
    const runtime = startWatcherRuntime({
      config: {
        baseDirectory: '/watcher',
        incomingDirectory: '/watcher/incoming',
        processedDirectory: '/watcher/processed',
        variationListingCaptureSourceKey: 'station-main',
        supportedCaptureModes: ['single_2_image', 'lot_3_image'],
        supportedImageExtensions: ['.jpg', '.jpeg', '.png', '.webp'],
      },
      logger: createLogger(),
      processIncomingImageBatch,
      variationListingRuntimeProcessor,
      watch: () => fakeWatcher,
    });

    fakeWatcher.emitAdd('/watcher/incoming/front.jpg');
    await flushMicrotasks();
    await runtime.close();

    expect(variationListingRuntimeProcessor.process).toHaveBeenCalledWith('/watcher/incoming/front.jpg');
    expect(processIncomingImageBatch).not.toHaveBeenCalled();
  });

  it('keeps legacy-only behavior when no capture source key is configured, even with an injected processor', async () => {
    const fakeWatcher = new FakeWatcher();
    const processIncomingImageBatch = vi.fn(async () => ({
      groupingState: createEmptyWatcherGroupingState(),
      processedListings: [],
    }));
    const variationListingRuntimeProcessor = {
      process: vi.fn(async () => ({ kind: 'started' as const, groupId: 'group', pairId: 'pair' })),
    };
    const runtime = startWatcherRuntime({
      config: {
        baseDirectory: '/watcher',
        incomingDirectory: '/watcher/incoming',
        processedDirectory: '/watcher/processed',
        supportedCaptureModes: ['single_2_image', 'lot_3_image'],
        supportedImageExtensions: ['.jpg', '.jpeg', '.png', '.webp'],
      },
      logger: createLogger(),
      processIncomingImageBatch,
      variationListingRuntimeProcessor,
      watch: () => fakeWatcher,
    });

    fakeWatcher.emitAdd('/watcher/incoming/front.jpg');
    await flushMicrotasks();
    await runtime.close();

    expect(variationListingRuntimeProcessor.process).not.toHaveBeenCalled();
    expect(processIncomingImageBatch).toHaveBeenCalledWith(
      expect.objectContaining({ incoming: ['/watcher/incoming/front.jpg'] }),
      undefined
    );
  });

  it('falls back to the unchanged legacy batch when the variation processor returns legacy', async () => {
    const fakeWatcher = new FakeWatcher();
    const processIncomingImageBatch = vi.fn(async () => ({
      groupingState: createEmptyWatcherGroupingState(),
      processedListings: [],
    }));
    const runtime = startWatcherRuntime({
      config: {
        baseDirectory: '/watcher',
        incomingDirectory: '/watcher/incoming',
        processedDirectory: '/watcher/processed',
        variationListingCaptureSourceKey: 'station-main',
        supportedCaptureModes: ['single_2_image', 'lot_3_image'],
        supportedImageExtensions: ['.jpg', '.jpeg', '.png', '.webp'],
      },
      logger: createLogger(),
      processIncomingImageBatch,
      variationListingRuntimeProcessor: { process: vi.fn(async () => ({ kind: 'legacy' as const })) },
      watch: () => fakeWatcher,
    });

    fakeWatcher.emitAdd('/watcher/incoming/front.jpg');
    await flushMicrotasks();
    await runtime.close();

    expect(processIncomingImageBatch).toHaveBeenCalledWith(
      expect.objectContaining({ incoming: ['/watcher/incoming/front.jpg'] }),
      undefined
    );
  });

  it('retains only the failed and unprocessed variation suffix for retry', async () => {
    const fakeWatcher = new FakeWatcher();
    const logger = createLogger();
    const processor = {
      process: vi
        .fn()
        .mockResolvedValueOnce({ kind: 'duplicate_front' as const, pairId: 'pair-a' })
        .mockRejectedValueOnce(new Error('variation failure')),
    };
    const runtime = startWatcherRuntime({
      config: {
        baseDirectory: '/watcher',
        incomingDirectory: '/watcher/incoming',
        processedDirectory: '/watcher/processed',
        variationListingCaptureSourceKey: 'station-main',
        supportedCaptureModes: ['single_2_image', 'lot_3_image'],
        supportedImageExtensions: ['.jpg', '.jpeg', '.png', '.webp'],
      },
      logger,
      processIncomingImageBatch: vi.fn(),
      variationListingRuntimeProcessor: processor,
      watch: () => fakeWatcher,
    });

    fakeWatcher.emitAdd('/watcher/incoming/one.jpg');
    fakeWatcher.emitAdd('/watcher/incoming/two.jpg');
    await flushMicrotasks();
    await flushMicrotasks();

    expect(runtime.state.pendingQueue).toEqual(['/watcher/incoming/two.jpg']);
    expect(logger.error).toHaveBeenCalledWith(
      'batch_failed',
      expect.objectContaining({ retainedRetryInputCount: 1 })
    );
    await runtime.close();
  });

  it('retains legacy-classified prefix inputs with the failed variation suffix, excluding consumed variation images', async () => {
    const fakeWatcher = new FakeWatcher();
    const processor = {
      process: vi
        .fn()
        .mockResolvedValueOnce({ kind: 'legacy' as const })
        .mockResolvedValueOnce({ kind: 'started' as const, groupId: 'group', pairId: 'pair' })
        .mockRejectedValueOnce(new Error('variation failure')),
    };
    const runtime = startWatcherRuntime({
      config: {
        baseDirectory: '/watcher',
        incomingDirectory: '/watcher/incoming',
        processedDirectory: '/watcher/processed',
        variationListingCaptureSourceKey: 'station-main',
        supportedCaptureModes: ['single_2_image', 'lot_3_image'],
        supportedImageExtensions: ['.jpg', '.jpeg', '.png', '.webp'],
      },
      logger: createLogger(),
      processIncomingImageBatch: vi.fn(async () => ({
        groupingState: createEmptyWatcherGroupingState(),
        processedListings: [],
      })),
      variationListingRuntimeProcessor: processor,
      watch: () => fakeWatcher,
    });

    runtime.state.pendingQueue.push(
      '/watcher/incoming/legacy.jpg',
      '/watcher/incoming/consumed.jpg',
      '/watcher/incoming/failed.jpg',
      '/watcher/incoming/unprocessed.jpg'
    );
    fakeWatcher.emitAdd('/watcher/incoming/trigger.jpg');
    await flushMicrotasks();
    await flushMicrotasks();
    await flushMicrotasks();

    expect(runtime.state.pendingQueue).toEqual([
      '/watcher/incoming/legacy.jpg',
      '/watcher/incoming/failed.jpg',
      '/watcher/incoming/unprocessed.jpg',
      '/watcher/incoming/trigger.jpg',
    ]);
    await runtime.close();
  });

  it('automatically requeues retryable variation identity failures with the shared 1m/5m policy', async () => {
    vi.useFakeTimers();
    try {
      const fakeWatcher = new FakeWatcher();
      const logger = createLogger();
      const processor = {
        process: vi
          .fn()
          .mockRejectedValueOnce(new VariationListingSidecarRetryableError('all Gemini routes unavailable'))
          .mockRejectedValueOnce(new VariationListingSidecarRetryableError('all Gemini routes unavailable'))
          .mockResolvedValueOnce({
            kind: 'completed' as const,
            completionKind: 'new_variation' as const,
            copyId: 'copy',
            groupId: 'group',
            status: 'completed' as const,
            variationId: 'variation',
          }),
      };
      const runtime = startWatcherRuntime({
        config: {
          baseDirectory: '/watcher',
          incomingDirectory: '/watcher/incoming',
          processedDirectory: '/watcher/processed',
          variationListingCaptureSourceKey: 'station-main',
          supportedCaptureModes: ['single_2_image', 'lot_3_image'],
          supportedImageExtensions: ['.jpg', '.jpeg', '.png', '.webp'],
        },
        configInput: {
          env: {
            SIDECAR_JOB_MAX_ATTEMPTS_GENERATE_AI: '3',
            SIDECAR_JOB_RETRY_DELAY_FIRST_MS: '60000',
            SIDECAR_JOB_RETRY_DELAY_NEXT_MS: '300000',
          },
        },
        logger,
        processIncomingImageBatch: vi.fn(),
        variationListingRuntimeProcessor: processor,
        watch: () => fakeWatcher,
      });

      fakeWatcher.emitAdd('/watcher/incoming/back.jpg');
      await vi.runAllTicks();
      expect(processor.process).toHaveBeenCalledTimes(1);
      expect(runtime.state.pendingQueue).toEqual(['/watcher/incoming/back.jpg']);
      expect(logger.info).toHaveBeenCalledWith(
        'variation_retry_scheduled',
        expect.objectContaining({ delayMs: 60000, attemptsUsed: 1 })
      );

      await vi.advanceTimersByTimeAsync(60000);
      expect(processor.process).toHaveBeenCalledTimes(2);
      expect(logger.info).toHaveBeenCalledWith(
        'variation_retry_scheduled',
        expect.objectContaining({ delayMs: 300000, attemptsUsed: 2 })
      );

      await vi.advanceTimersByTimeAsync(300000);
      expect(processor.process).toHaveBeenCalledTimes(3);
      expect(runtime.state.pendingQueue).toEqual([]);
      await runtime.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('merges process retry settings with explicit watcher overrides', async () => {
    vi.useFakeTimers();
    const originalNextDelay = process.env.SIDECAR_JOB_RETRY_DELAY_NEXT_MS;
    process.env.SIDECAR_JOB_RETRY_DELAY_NEXT_MS = '20';
    try {
      const fakeWatcher = new FakeWatcher();
      const logger = createLogger();
      const processor = {
        process: vi
          .fn()
          .mockRejectedValueOnce(new VariationListingSidecarRetryableError('unavailable'))
          .mockRejectedValueOnce(new VariationListingSidecarRetryableError('unavailable'))
          .mockResolvedValueOnce({
            kind: 'completed' as const,
            completionKind: 'new_variation' as const,
            copyId: 'copy',
            groupId: 'group',
            status: 'completed' as const,
            variationId: 'variation',
          }),
      };
      const runtime = startWatcherRuntime({
        config: {
          baseDirectory: '/watcher',
          incomingDirectory: '/watcher/incoming',
          processedDirectory: '/watcher/processed',
          variationListingCaptureSourceKey: 'station-main',
          supportedCaptureModes: ['single_2_image', 'lot_3_image'],
          supportedImageExtensions: ['.jpg', '.jpeg', '.png', '.webp'],
        },
        configInput: {
          env: {
            SIDECAR_JOB_RETRY_DELAY_FIRST_MS: '10',
          },
        },
        logger,
        processIncomingImageBatch: vi.fn(),
        variationListingRuntimeProcessor: processor,
        watch: () => fakeWatcher,
      });

      fakeWatcher.emitAdd('/watcher/incoming/back.jpg');
      await vi.runAllTicks();
      await vi.advanceTimersByTimeAsync(10);
      expect(logger.info).toHaveBeenCalledWith(
        'variation_retry_scheduled',
        expect.objectContaining({ attemptsUsed: 2, delayMs: 20 })
      );

      await runtime.close();
    } finally {
      if (originalNextDelay === undefined) delete process.env.SIDECAR_JOB_RETRY_DELAY_NEXT_MS;
      else process.env.SIDECAR_JOB_RETRY_DELAY_NEXT_MS = originalNextDelay;
      vi.useRealTimers();
    }
  });

  it('does not let a new add bypass an active variation retry backoff', async () => {
    vi.useFakeTimers();
    try {
      const fakeWatcher = new FakeWatcher();
      const processor = {
        process: vi
          .fn()
          .mockRejectedValueOnce(new VariationListingSidecarRetryableError('all Gemini routes unavailable'))
          .mockResolvedValueOnce({
            kind: 'completed' as const,
            completionKind: 'new_variation' as const,
            copyId: 'copy',
            groupId: 'group',
            status: 'completed' as const,
            variationId: 'variation',
          })
          .mockResolvedValueOnce({ kind: 'started' as const, groupId: 'group-2', pairId: 'pair-2' }),
      };
      const runtime = startWatcherRuntime({
        config: {
          baseDirectory: '/watcher',
          incomingDirectory: '/watcher/incoming',
          processedDirectory: '/watcher/processed',
          variationListingCaptureSourceKey: 'station-main',
          supportedCaptureModes: ['single_2_image', 'lot_3_image'],
          supportedImageExtensions: ['.jpg', '.jpeg', '.png', '.webp'],
        },
        configInput: {
          env: {
            SIDECAR_JOB_MAX_ATTEMPTS_GENERATE_AI: '3',
            SIDECAR_JOB_RETRY_DELAY_FIRST_MS: '60000',
            SIDECAR_JOB_RETRY_DELAY_NEXT_MS: '300000',
          },
        },
        logger: createLogger(),
        processIncomingImageBatch: vi.fn(),
        variationListingRuntimeProcessor: processor,
        watch: () => fakeWatcher,
      });

      fakeWatcher.emitAdd('/watcher/incoming/back.jpg');
      await vi.runAllTicks();
      expect(processor.process).toHaveBeenCalledTimes(1);
      expect(runtime.state.pendingQueue).toEqual(['/watcher/incoming/back.jpg']);

      fakeWatcher.emitAdd('/watcher/incoming/new-front.jpg');
      await vi.runAllTicks();
      expect(processor.process).toHaveBeenCalledTimes(1);
      expect(runtime.state.pendingQueue).toEqual([
        '/watcher/incoming/back.jpg',
        '/watcher/incoming/new-front.jpg',
      ]);

      await vi.advanceTimersByTimeAsync(59999);
      expect(processor.process).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(processor.process).toHaveBeenCalledTimes(3);
      expect(processor.process).toHaveBeenNthCalledWith(2, '/watcher/incoming/back.jpg');
      expect(processor.process).toHaveBeenNthCalledWith(3, '/watcher/incoming/new-front.jpg');
      expect(runtime.state.pendingQueue).toEqual([]);
      await runtime.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not replay a consumed variation path added while its drain is active', async () => {
    const fakeWatcher = new FakeWatcher();
    const first = createDeferred<{ kind: 'started'; groupId: string; pairId: string }>();
    const processor = {
      process: vi.fn(async () => await first.promise),
    };
    const runtime = startWatcherRuntime({
      config: {
        baseDirectory: '/watcher',
        incomingDirectory: '/watcher/incoming',
        processedDirectory: '/watcher/processed',
        variationListingCaptureSourceKey: 'station-main',
        supportedCaptureModes: ['single_2_image', 'lot_3_image'],
        supportedImageExtensions: ['.jpg', '.jpeg', '.png', '.webp'],
      },
      logger: createLogger(),
      processIncomingImageBatch: vi.fn(),
      variationListingRuntimeProcessor: processor,
      watch: () => fakeWatcher,
    });

    fakeWatcher.emitAdd('/watcher/incoming/front.jpg');
    await flushMicrotasks();
    expect(processor.process).toHaveBeenCalledTimes(1);

    fakeWatcher.emitAdd('/watcher/incoming/front.jpg');
    expect(runtime.state.pendingQueue).toEqual(['/watcher/incoming/front.jpg']);
    first.resolve({ kind: 'started', groupId: 'group', pairId: 'pair' });
    await flushMicrotasks();
    await flushMicrotasks();
    expect(processor.process).toHaveBeenCalledTimes(1);
    expect(runtime.state.pendingQueue).toEqual([]);
    await runtime.close();
  });

  it('retains non-retryable variation failures without automatically retrying on later adds', async () => {
    const fakeWatcher = new FakeWatcher();
    const processor = {
      process: vi.fn().mockRejectedValue(new Error('invalid variation state')),
    };
    const runtime = startWatcherRuntime({
      config: {
        baseDirectory: '/watcher',
        incomingDirectory: '/watcher/incoming',
        processedDirectory: '/watcher/processed',
        variationListingCaptureSourceKey: 'station-main',
        supportedCaptureModes: ['single_2_image', 'lot_3_image'],
        supportedImageExtensions: ['.jpg', '.jpeg', '.png', '.webp'],
      },
      logger: createLogger(),
      processIncomingImageBatch: vi.fn(),
      variationListingRuntimeProcessor: processor,
      watch: () => fakeWatcher,
    });

    fakeWatcher.emitAdd('/watcher/incoming/back.jpg');
    await flushMicrotasks();
    expect(processor.process).toHaveBeenCalledTimes(1);
    expect(runtime.state.pendingQueue).toEqual(['/watcher/incoming/back.jpg']);

    fakeWatcher.emitAdd('/watcher/incoming/new-front.jpg');
    await flushMicrotasks();
    expect(processor.process).toHaveBeenCalledTimes(1);
    expect(runtime.state.pendingQueue).toEqual([
      '/watcher/incoming/back.jpg',
      '/watcher/incoming/new-front.jpg',
    ]);
    await runtime.close();
  });

  it('stops a retryable variation after exactly three total waterfalls', async () => {
    vi.useFakeTimers();
    try {
      const fakeWatcher = new FakeWatcher();
      const processor = {
        process: vi.fn().mockRejectedValue(new VariationListingSidecarRetryableError('unavailable')),
      };
      const runtime = startWatcherRuntime({
        config: {
          baseDirectory: '/watcher',
          incomingDirectory: '/watcher/incoming',
          processedDirectory: '/watcher/processed',
          variationListingCaptureSourceKey: 'station-main',
          supportedCaptureModes: ['single_2_image', 'lot_3_image'],
          supportedImageExtensions: ['.jpg', '.jpeg', '.png', '.webp'],
        },
        configInput: {
          env: {
            SIDECAR_JOB_MAX_ATTEMPTS_GENERATE_AI: '3',
            SIDECAR_JOB_RETRY_DELAY_FIRST_MS: '10',
            SIDECAR_JOB_RETRY_DELAY_NEXT_MS: '20',
          },
        },
        logger: createLogger(),
        processIncomingImageBatch: vi.fn(),
        variationListingRuntimeProcessor: processor,
        watch: () => fakeWatcher,
      });

      fakeWatcher.emitAdd('/watcher/incoming/back.jpg');
      await vi.runAllTicks();
      await vi.advanceTimersByTimeAsync(10);
      await vi.advanceTimersByTimeAsync(20);
      expect(processor.process).toHaveBeenCalledTimes(3);
      expect(runtime.state.pendingQueue).toEqual(['/watcher/incoming/back.jpg']);

      fakeWatcher.emitAdd('/watcher/incoming/new-front.jpg');
      await vi.runAllTicks();
      expect(processor.process).toHaveBeenCalledTimes(3);
      expect(runtime.state.pendingQueue).toEqual([
        '/watcher/incoming/back.jpg',
        '/watcher/incoming/new-front.jpg',
      ]);
      await runtime.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not replay consumed fronts when a later pair fails', async () => {
    vi.useFakeTimers();
    try {
      const fakeWatcher = new FakeWatcher();
      const processor = {
        process: vi
          .fn()
          .mockResolvedValueOnce({ kind: 'started' as const, groupId: 'group-1', pairId: 'pair-1' })
          .mockResolvedValueOnce({
            kind: 'completed' as const,
            completionKind: 'new_variation' as const,
            copyId: 'copy-1',
            groupId: 'group-1',
            status: 'completed' as const,
            variationId: 'variation-1',
          })
          .mockResolvedValueOnce({ kind: 'started' as const, groupId: 'group-2', pairId: 'pair-2' })
          .mockRejectedValueOnce(new VariationListingSidecarRetryableError('unavailable'))
          .mockResolvedValueOnce({
            kind: 'completed' as const,
            completionKind: 'new_variation' as const,
            copyId: 'copy-2',
            groupId: 'group-2',
            status: 'completed' as const,
            variationId: 'variation-2',
          }),
      };
      const runtime = startWatcherRuntime({
        config: {
          baseDirectory: '/watcher',
          incomingDirectory: '/watcher/incoming',
          processedDirectory: '/watcher/processed',
          variationListingCaptureSourceKey: 'station-main',
          supportedCaptureModes: ['single_2_image', 'lot_3_image'],
          supportedImageExtensions: ['.jpg', '.jpeg', '.png', '.webp'],
        },
        configInput: {
          env: {
            SIDECAR_JOB_MAX_ATTEMPTS_GENERATE_AI: '3',
            SIDECAR_JOB_RETRY_DELAY_FIRST_MS: '1',
            SIDECAR_JOB_RETRY_DELAY_NEXT_MS: '2',
          },
        },
        logger: createLogger(),
        processIncomingImageBatch: vi.fn(),
        variationListingRuntimeProcessor: processor,
        watch: () => fakeWatcher,
      });

      runtime.state.pendingQueue.push(
        '/watcher/incoming/front-1.jpg',
        '/watcher/incoming/back-1.jpg',
        '/watcher/incoming/front-2.jpg',
        '/watcher/incoming/back-2.jpg'
      );
      fakeWatcher.emitAdd('/watcher/incoming/front-1.jpg');
      await vi.runAllTicks();
      await flushMicrotasks();
      await flushMicrotasks();
      await flushMicrotasks();
      expect(processor.process).toHaveBeenCalledTimes(4);
      expect(runtime.state.pendingQueue).toEqual(['/watcher/incoming/back-2.jpg']);

      await vi.advanceTimersByTimeAsync(1);
      expect(processor.process).toHaveBeenCalledTimes(5);
      expect(processor.process).toHaveBeenNthCalledWith(5, '/watcher/incoming/back-2.jpg');
      expect(runtime.state.pendingQueue).toEqual([]);
      await runtime.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels a pending variation retry timer on close', async () => {
    vi.useFakeTimers();
    try {
      const fakeWatcher = new FakeWatcher();
      const processor = {
        process: vi
          .fn()
          .mockRejectedValue(new VariationListingSidecarRetryableError('unavailable')),
      };
      const runtime = startWatcherRuntime({
        config: {
          baseDirectory: '/watcher',
          incomingDirectory: '/watcher/incoming',
          processedDirectory: '/watcher/processed',
          variationListingCaptureSourceKey: 'station-main',
          supportedCaptureModes: ['single_2_image', 'lot_3_image'],
          supportedImageExtensions: ['.jpg', '.jpeg', '.png', '.webp'],
        },
        configInput: { env: { SIDECAR_JOB_RETRY_DELAY_FIRST_MS: '10' } },
        logger: createLogger(),
        processIncomingImageBatch: vi.fn(),
        variationListingRuntimeProcessor: processor,
        watch: () => fakeWatcher,
      });

      fakeWatcher.emitAdd('/watcher/incoming/back.jpg');
      await vi.runAllTicks();
      expect(processor.process).toHaveBeenCalledTimes(1);
      await runtime.close();
      await vi.advanceTimersByTimeAsync(100);
      expect(processor.process).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not create a retry timer when an in-flight variation fails during close', async () => {
    vi.useFakeTimers();
    try {
      const fakeWatcher = new FakeWatcher();
      const deferred = createDeferred<never>();
      const processor = { process: vi.fn(async () => await deferred.promise) };
      const runtime = startWatcherRuntime({
        config: {
          baseDirectory: '/watcher',
          incomingDirectory: '/watcher/incoming',
          processedDirectory: '/watcher/processed',
          variationListingCaptureSourceKey: 'station-main',
          supportedCaptureModes: ['single_2_image', 'lot_3_image'],
          supportedImageExtensions: ['.jpg', '.jpeg', '.png', '.webp'],
        },
        configInput: { env: { SIDECAR_JOB_RETRY_DELAY_FIRST_MS: '10' } },
        logger: createLogger(),
        processIncomingImageBatch: vi.fn(),
        variationListingRuntimeProcessor: processor,
        watch: () => fakeWatcher,
      });

      fakeWatcher.emitAdd('/watcher/incoming/back.jpg');
      await flushMicrotasks();
      const closePromise = runtime.close();
      deferred.reject(new VariationListingSidecarRetryableError('unavailable'));
      await closePromise;
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(100);
      expect(processor.process).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves a previously legacy-classified prefix across variation retries', async () => {
    vi.useFakeTimers();
    try {
      const fakeWatcher = new FakeWatcher();
      const processor = {
        process: vi
          .fn()
          .mockResolvedValueOnce({ kind: 'legacy' as const })
          .mockRejectedValueOnce(new VariationListingSidecarRetryableError('unavailable'))
          .mockResolvedValueOnce({ kind: 'started' as const, groupId: 'group', pairId: 'pair' }),
      };
      const processIncomingImageBatch = vi.fn(async (input) => ({
        groupingState: createEmptyWatcherGroupingState(),
        processedListings: [],
        incoming: input.incoming,
      }));
      const runtime = startWatcherRuntime({
        config: {
          baseDirectory: '/watcher',
          incomingDirectory: '/watcher/incoming',
          processedDirectory: '/watcher/processed',
          variationListingCaptureSourceKey: 'station-main',
          supportedCaptureModes: ['single_2_image', 'lot_3_image'],
          supportedImageExtensions: ['.jpg', '.jpeg', '.png', '.webp'],
        },
        configInput: {
          env: {
            SIDECAR_JOB_MAX_ATTEMPTS_GENERATE_AI: '3',
            SIDECAR_JOB_RETRY_DELAY_FIRST_MS: '1',
            SIDECAR_JOB_RETRY_DELAY_NEXT_MS: '2',
          },
        },
        logger: createLogger(),
        processIncomingImageBatch,
        variationListingRuntimeProcessor: processor,
        watch: () => fakeWatcher,
      });

      runtime.state.pendingQueue.push('/watcher/incoming/legacy.jpg', '/watcher/incoming/back.jpg');
      fakeWatcher.emitAdd('/watcher/incoming/back.jpg');
      await vi.runAllTicks();
      expect(processor.process).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(processor.process).toHaveBeenCalledTimes(3);
      expect(processor.process).toHaveBeenNthCalledWith(3, '/watcher/incoming/back.jpg');
      expect(processIncomingImageBatch).toHaveBeenLastCalledWith(
        expect.objectContaining({ incoming: ['/watcher/incoming/legacy.jpg'] }),
        undefined
      );
      await runtime.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps an in-flight duplicate legacy add on the legacy path after the first batch accepts it', async () => {
    const fakeWatcher = new FakeWatcher();
    const firstBatch = createDeferred<{ groupingState: { pending: never[] }; processedListings: never[] }>();
    const processor = {
      process: vi.fn(async () => ({ kind: 'legacy' as const })),
    };
    const processIncomingImageBatch = vi
      .fn()
      .mockImplementationOnce(async () => await firstBatch.promise)
      .mockResolvedValueOnce({
        groupingState: createEmptyWatcherGroupingState(),
        processedListings: [],
      });
    const runtime = startWatcherRuntime({
      config: {
        baseDirectory: '/watcher',
        incomingDirectory: '/watcher/incoming',
        processedDirectory: '/watcher/processed',
        variationListingCaptureSourceKey: 'station-main',
        supportedCaptureModes: ['single_2_image', 'lot_3_image'],
        supportedImageExtensions: ['.jpg', '.jpeg', '.png', '.webp'],
      },
      logger: createLogger(),
      processIncomingImageBatch,
      variationListingRuntimeProcessor: processor,
      watch: () => fakeWatcher,
    });

    fakeWatcher.emitAdd('/watcher/incoming/legacy.jpg');
    await flushMicrotasks();
    expect(processor.process).toHaveBeenCalledTimes(1);
    expect(processIncomingImageBatch).toHaveBeenCalledTimes(1);

    fakeWatcher.emitAdd('/watcher/incoming/legacy.jpg');
    firstBatch.resolve({ groupingState: createEmptyWatcherGroupingState(), processedListings: [] });
    await flushMicrotasks();
    await flushMicrotasks();
    expect(processor.process).toHaveBeenCalledTimes(1);
    expect(processIncomingImageBatch).toHaveBeenCalledTimes(2);
    await runtime.close();
  });

  it('logs completed watcher groups and persisted listing rows', async () => {
    const fakeWatcher = new FakeWatcher();
    const logger = createLogger();
    const processIncomingImageBatch = vi.fn(async () => ({
      groupingState: createEmptyWatcherGroupingState(),
      processedListings: [
        {
          captureMode: 'single_2_image' as const,
          images: [
            { processedPath: '/watcher/processed/Single-000001/Single-000001_01.jpg' },
            { processedPath: '/watcher/processed/Single-000001/Single-000001_02.jpg' },
          ],
          listing: {
            status: 'record_created',
            sub_status: 'idle',
          },
          listingId: 'Single-000001',
          processedDirectory: '/watcher/processed/Single-000001',
        },
      ],
    }));

    const runtime = startWatcherRuntime({
      config: {
        baseDirectory: '/watcher',
        incomingDirectory: '/watcher/incoming',
        processedDirectory: '/watcher/processed',
        supportedCaptureModes: ['single_2_image', 'lot_3_image'],
        supportedImageExtensions: ['.jpg', '.jpeg', '.png', '.webp'],
      },
      logger,
      processIncomingImageBatch,
      watch: () => fakeWatcher,
    });

    fakeWatcher.emitAdd('/watcher/incoming/one.jpg');
    await flushMicrotasks();
    await runtime.close();

    expect(logger.info).toHaveBeenCalledWith('watcher_group_completed', {
      captureMode: 'single_2_image',
      imageCount: 2,
      listingId: 'Single-000001',
      processedDirectory: '/watcher/processed/Single-000001',
    });
    expect(logger.info).toHaveBeenCalledWith('watcher_listing_persisted', {
      imageCount: 2,
      listingId: 'Single-000001',
      status: 'record_created',
      subStatus: 'idle',
    });
  });

  it('drains sequentially and prevents overlapping orchestration calls', async () => {
    const fakeWatcher = new FakeWatcher();
    const firstBatch = createDeferred<{ groupingState: { pending: never[] }; processedListings: never[] }>();
    const secondBatch = createDeferred<{ groupingState: { pending: never[] }; processedListings: never[] }>();
    const processIncomingImageBatch = vi
      .fn()
      .mockImplementationOnce(async () => await firstBatch.promise)
      .mockImplementationOnce(async () => await secondBatch.promise);

    const runtime = startWatcherRuntime({
      config: {
        baseDirectory: '/watcher',
        incomingDirectory: '/watcher/incoming',
        processedDirectory: '/watcher/processed',
        supportedCaptureModes: ['single_2_image', 'lot_3_image'],
        supportedImageExtensions: ['.jpg', '.jpeg', '.png', '.webp'],
      },
      logger: createLogger(),
      processIncomingImageBatch,
      watch: () => fakeWatcher,
    });

    fakeWatcher.emitAdd('/watcher/incoming/one.jpg');
    await flushMicrotasks();
    expect(processIncomingImageBatch).toHaveBeenCalledTimes(1);

    fakeWatcher.emitAdd('/watcher/incoming/two.jpg');
    await flushMicrotasks();
    expect(processIncomingImageBatch).toHaveBeenCalledTimes(1);
    expect(runtime.state.pendingQueue).toEqual(['/watcher/incoming/two.jpg']);

    firstBatch.resolve({
      groupingState: createEmptyWatcherGroupingState(),
      processedListings: [],
    });
    await flushMicrotasks();
    expect(processIncomingImageBatch).toHaveBeenCalledTimes(2);
    expect(processIncomingImageBatch).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        incoming: ['/watcher/incoming/two.jpg'],
      }),
      undefined
    );

    secondBatch.resolve({
      groupingState: createEmptyWatcherGroupingState(),
      processedListings: [],
    });
    await runtime.close();
  });

  it('preserves grouping state across batches', async () => {
    const fakeWatcher = new FakeWatcher();
    const processIncomingImageBatch = vi
      .fn()
      .mockResolvedValueOnce({
        groupingState: {
          pending: [{ path: '/watcher/incoming/one.jpg' }],
        },
        processedListings: [],
      })
      .mockResolvedValueOnce({
        groupingState: createEmptyWatcherGroupingState(),
        processedListings: [],
      });

    const runtime = startWatcherRuntime({
      config: {
        baseDirectory: '/watcher',
        incomingDirectory: '/watcher/incoming',
        processedDirectory: '/watcher/processed',
        supportedCaptureModes: ['single_2_image', 'lot_3_image'],
        supportedImageExtensions: ['.jpg', '.jpeg', '.png', '.webp'],
      },
      logger: createLogger(),
      processIncomingImageBatch,
      watch: () => fakeWatcher,
    });

    fakeWatcher.emitAdd('/watcher/incoming/one.jpg');
    await flushMicrotasks();
    await flushMicrotasks();
    fakeWatcher.emitAdd('/watcher/incoming/two.jpg');
    await flushMicrotasks();
    await flushMicrotasks();
    await runtime.close();

    expect(processIncomingImageBatch).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        groupingState: {
          pending: [{ path: '/watcher/incoming/one.jpg' }],
        },
      }),
      undefined
    );
    expect(runtime.state.groupingState).toEqual({ pending: [] });
  });

  it('relies on the existing grouping layer to ignore unsupported files', async () => {
    const fakeWatcher = new FakeWatcher();
    const processIncomingImageBatch = vi.fn(async (input) => {
      const result = consumeImageGrouping('single_2_image', input.incoming, input.groupingState);

      return {
        groupingState: result.state,
        processedListings: result.completedGroups.map((group, index) => ({
          captureMode: group.captureMode,
          images: [],
          listing: null,
          listingId: `Single-${String(index + 1).padStart(6, '0')}`,
          processedDirectory: '/watcher/processed',
        })),
      };
    });

    const runtime = startWatcherRuntime({
      config: {
        baseDirectory: '/watcher',
        incomingDirectory: '/watcher/incoming',
        processedDirectory: '/watcher/processed',
        supportedCaptureModes: ['single_2_image', 'lot_3_image'],
        supportedImageExtensions: ['.jpg', '.jpeg', '.png', '.webp'],
      },
      logger: createLogger(),
      processIncomingImageBatch,
      watch: () => fakeWatcher,
    });

    fakeWatcher.emitAdd('/watcher/incoming/skip.txt');
    await flushMicrotasks();
    await flushMicrotasks();
    expect(runtime.state.groupingState).toEqual({ pending: [] });

    fakeWatcher.emitAdd('/watcher/incoming/one.jpg');
    await flushMicrotasks();
    await flushMicrotasks();
    expect(runtime.state.groupingState).toEqual({
      pending: [{ path: '/watcher/incoming/one.jpg' }],
    });

    await runtime.close();
  });

  it('commits partial batch progress and requeues retry inputs without replaying successes', async () => {
    const fakeWatcher = new FakeWatcher();
    const logger = createLogger();
    const processIncomingImageBatch = vi
      .fn()
      .mockRejectedValueOnce(
        new WatcherBatchProcessingError('boom', {
          cause: new Error('boom'),
          groupingState: createEmptyWatcherGroupingState(),
          processedListings: [
            {
              captureMode: 'single_2_image',
              images: [],
              listing: null as never,
              listingId: 'Single-000001',
              processedDirectory: '/watcher/processed/Single-000001',
            },
          ],
          retryInputs: ['/watcher/incoming/two.jpg', '/watcher/incoming/three.jpg'],
        })
      )
      .mockResolvedValueOnce({
        groupingState: createEmptyWatcherGroupingState(),
        processedListings: [],
      });

    const runtime = startWatcherRuntime({
      config: {
        baseDirectory: '/watcher',
        incomingDirectory: '/watcher/incoming',
        processedDirectory: '/watcher/processed',
        supportedCaptureModes: ['single_2_image', 'lot_3_image'],
        supportedImageExtensions: ['.jpg', '.jpeg', '.png', '.webp'],
      },
      logger,
      processIncomingImageBatch,
      watch: () => fakeWatcher,
    });

    fakeWatcher.emitAdd('/watcher/incoming/one.jpg');
    await flushMicrotasks();
    expect(processIncomingImageBatch).toHaveBeenCalledTimes(1);
    expect(runtime.state.groupingState).toEqual({ pending: [] });
    expect(runtime.state.pendingQueue).toEqual([
      '/watcher/incoming/two.jpg',
      '/watcher/incoming/three.jpg',
    ]);
    expect(logger.error).toHaveBeenCalledWith(
      'batch_failed',
      expect.objectContaining({
        error: 'boom',
        partialProcessedListingCount: 1,
        retainedRetryInputCount: 2,
      })
    );

    fakeWatcher.emitAdd('/watcher/incoming/four.jpg');
    await flushMicrotasks();
    await flushMicrotasks();
    await runtime.close();

    expect(processIncomingImageBatch).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        incoming: [
          '/watcher/incoming/two.jpg',
          '/watcher/incoming/three.jpg',
          '/watcher/incoming/four.jpg',
        ],
      }),
      undefined
    );
  });

  it('closes the watcher and ignores later events', async () => {
    const fakeWatcher = new FakeWatcher();
    const processIncomingImageBatch = vi.fn(async () => ({
      groupingState: createEmptyWatcherGroupingState(),
      processedListings: [],
    }));

    const runtime = startWatcherRuntime({
      config: {
        baseDirectory: '/watcher',
        incomingDirectory: '/watcher/incoming',
        processedDirectory: '/watcher/processed',
        supportedCaptureModes: ['single_2_image', 'lot_3_image'],
        supportedImageExtensions: ['.jpg', '.jpeg', '.png', '.webp'],
      },
      logger: createLogger(),
      processIncomingImageBatch,
      watch: () => fakeWatcher,
    });

    await runtime.close();
    fakeWatcher.emitAdd('/watcher/incoming/late.jpg');
    await flushMicrotasks();

    expect(fakeWatcher.close).toHaveBeenCalledTimes(1);
    expect(processIncomingImageBatch).not.toHaveBeenCalled();
    expect(runtime.state.isClosed).toBe(true);
  });
});
