import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { consumeImageGrouping, createEmptyWatcherGroupingState, startWatcherRuntime } from '../../src/index.js';

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

  it('survives batch failures without requeueing the failed snapshot', async () => {
    const fakeWatcher = new FakeWatcher();
    const logger = createLogger();
    const processIncomingImageBatch = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
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
    await flushMicrotasks();
    expect(processIncomingImageBatch).toHaveBeenCalledTimes(1);
    expect(runtime.state.groupingState).toEqual({ pending: [] });
    expect(logger.error).toHaveBeenCalledWith(
      'batch_failed',
      expect.objectContaining({
        error: 'boom',
      })
    );

    fakeWatcher.emitAdd('/watcher/incoming/two.jpg');
    await flushMicrotasks();
    await flushMicrotasks();
    await runtime.close();

    expect(processIncomingImageBatch).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        incoming: ['/watcher/incoming/two.jpg'],
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
