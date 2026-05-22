import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ListingRow } from '@ebay-inventory/data';

import {
  consumeImageGrouping,
  createProcessIncomingImageBatchDependencies,
  processIncomingImageBatch,
  WATCHER_LISTING_INSERT_MAX_ATTEMPTS,
  WatcherBatchProcessingError,
  type ProcessedImageMoveFileSystem,
  type ProcessedImageMoveInput,
  type ProcessedImageMoveResult,
  type WatcherCaptureMode,
} from '../../src/index.js';

function createMovedImageRecords(input: ProcessedImageMoveInput) {
  return input.images.map((image, index) => ({
    sourcePath: image.path,
    processedPath: path.join(
      input.processedDirectory,
      input.listingId,
      `${input.listingId}_${String(index + 1).padStart(2, '0')}${path.extname(image.path).toLowerCase()}`
    ),
    fileName: `${input.listingId}_${String(index + 1).padStart(2, '0')}${path.extname(image.path).toLowerCase()}`,
    order: index + 1,
    extension: path.extname(image.path).toLowerCase(),
  }));
}

function createMoveResult(input: ProcessedImageMoveInput): ProcessedImageMoveResult {
  return {
    listingId: input.listingId,
    processedDirectory: path.join(input.processedDirectory, input.listingId),
    images: createMovedImageRecords(input),
  };
}

function createListingRow(result: ProcessedImageMoveResult, captureMode: WatcherCaptureMode): ListingRow {
  return {
    approved_for_export_at: null,
    capture_mode: captureMode,
    category_id: null,
    condition_id: null,
    condition_notes: null,
    created_at: '2026-05-21T00:00:00.000Z',
    description: null,
    ebay_listing_id: null,
    ebay_listing_status: null,
    ebay_listing_url: null,
    ebay_offer_id: null,
    ese_eligible: null,
    estimated_weight_oz: null,
    exported_at: null,
    generated_at: null,
    handling_days: null,
    id: `row-${result.listingId}`,
    image_urls: result.images.map((image) => image.processedPath),
    item_specifics: {},
    last_error_at: null,
    last_error_code: null,
    last_error_context: {},
    last_error_message: null,
    listing_id: result.listingId,
    listing_type: captureMode.startsWith('lot') ? 'lot' : 'single',
    merchant_location_key: null,
    package_type: null,
    price: null,
    r2_delete_after: null,
    r2_deleted_at: null,
    r2_object_keys: [],
    r2_retention_policy: null,
    seller_hints: null,
    shipping_profile: null,
    sku: null,
    sold_at: null,
    status: 'record_created',
    sub_status: 'idle',
    title: null,
    updated_at: '2026-05-21T00:00:00.000Z',
  };
}

function createDependencies(overrides: Partial<Parameters<typeof processIncomingImageBatch>[1]> = {}) {
  const moveGroupedImagesToProcessedListing = vi.fn(async (input: ProcessedImageMoveInput) =>
    createMoveResult(input)
  );
  const createWatcherListing = vi.fn(async (input) =>
    createListingRow(createMoveResult({
      listingId: input.listingId,
      processedDirectory: '/processed',
      images: input.images.map((image) => ({ path: image.processedPath })),
    }), input.captureMode)
  );

  return {
    getActiveWatcherCaptureMode: vi.fn(async () => 'single_2_image' as const),
    consumeImageGrouping,
    allocateNextListingId: vi.fn(async () => 'Single-000001'),
    createWatcherListing,
    isWatcherListingCollision: vi.fn(() => false),
    isProcessedListingCollision: vi.fn(() => false),
    moveGroupedImagesToProcessedListing,
    rollbackProcessedListingMove: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('processIncomingImageBatch', () => {
  let tempDir: string | undefined;

  afterEach(() => {
    vi.restoreAllMocks();

    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  async function createTempLayout() {
    tempDir = mkdtempSync(path.join(tmpdir(), 'watcher-process-image-batch-'));

    const incomingDirectory = path.join(tempDir, 'incoming');
    const processedRoot = path.join(tempDir, 'processed');

    await fsPromises.mkdir(incomingDirectory);
    await fsPromises.mkdir(processedRoot);

    return { incomingDirectory, processedRoot };
  }

  function writeSourceFile(directory: string, fileName: string, contents = fileName): string {
    const filePath = path.join(directory, fileName);
    writeFileSync(filePath, contents, 'utf-8');
    return filePath;
  }

  function createMissingPathError(pathValue: string) {
    const error = new Error(`ENOENT: no such file or directory, lstat '${pathValue}'`);
    return Object.assign(error, { code: 'ENOENT' });
  }

  it('defaults groupingState to a fresh empty state when omitted', async () => {
    const allocateNextListingId = vi.fn(async () => 'Single-000001');
    const moveGroupedImagesToProcessedListing = vi.fn(async (input: ProcessedImageMoveInput) =>
      createMoveResult(input)
    );

    const result = await processIncomingImageBatch(
      {
        incoming: ['a.jpg'],
        processedDirectory: '/processed',
      },
      {
        ...createDependencies({
          allocateNextListingId,
          moveGroupedImagesToProcessedListing,
        }),
      }
    );

    expect(result).toEqual({
      processedListings: [],
      groupingState: {
        pending: [{ path: 'a.jpg' }],
      },
    });
    expect(allocateNextListingId).not.toHaveBeenCalled();
    expect(moveGroupedImagesToProcessedListing).not.toHaveBeenCalled();
  });

  it('loads capture mode exactly once per batch', async () => {
    const getActiveWatcherCaptureMode = vi.fn(async (): Promise<WatcherCaptureMode> => 'single_2_image');
    const allocateNextListingId = vi.fn(async () => 'Single-000001');
    const moveGroupedImagesToProcessedListing = vi.fn(async (input: ProcessedImageMoveInput) =>
      createMoveResult(input)
    );

    const result = await processIncomingImageBatch(
      {
        incoming: ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg'],
        processedDirectory: '/processed',
      },
      {
        ...createDependencies({
          getActiveWatcherCaptureMode,
          allocateNextListingId,
          moveGroupedImagesToProcessedListing,
        }),
      }
    );

    expect(getActiveWatcherCaptureMode).toHaveBeenCalledTimes(1);
    expect(allocateNextListingId).toHaveBeenCalledTimes(1);
    expect(result.processedListings.map((listing) => listing.listingId)).toEqual([
      'Single-000001',
      'Single-000002',
    ]);
  });

  it('allocates listing ids and moves files for a completed group', async () => {
    const { incomingDirectory, processedRoot } = await createTempLayout();
    const first = writeSourceFile(incomingDirectory, 'one.JPG');
    const second = writeSourceFile(incomingDirectory, 'two.png');
    const dependencies = createProcessIncomingImageBatchDependencies({
      appSettingsRepository: {
        get: vi.fn(async () => ({ capture_mode: 'single_2_image' } as never)),
      },
      listingIdRepository: {
        getLatestByPrefix: vi.fn(async () => null),
      },
      watcherListingRepository: {
        createWatcherListing: vi.fn(async (input) =>
          createListingRow(createMoveResult({
            listingId: input.listingId,
            processedDirectory: processedRoot,
            images: input.images.map((image) => ({ path: image.processedPath })),
          }), input.captureMode)
        ),
      },
    });

    const result = await processIncomingImageBatch({
      incoming: [first, second],
      processedDirectory: processedRoot,
    }, dependencies);

    expect(result).toEqual({
      processedListings: [
        {
          listingId: 'Single-000001',
          captureMode: 'single_2_image',
          processedDirectory: path.join(processedRoot, 'Single-000001'),
          images: [
            {
              sourcePath: first,
              processedPath: path.join(
                processedRoot,
                'Single-000001',
                'Single-000001_01.jpg'
              ),
              fileName: 'Single-000001_01.jpg',
              order: 1,
              extension: '.jpg',
            },
            {
              sourcePath: second,
              processedPath: path.join(
                processedRoot,
                'Single-000001',
                'Single-000001_02.png'
              ),
              fileName: 'Single-000001_02.png',
              order: 2,
              extension: '.png',
            },
          ],
          listing: expect.objectContaining({
            listing_id: 'Single-000001',
            capture_mode: 'single_2_image',
            image_urls: [
              path.join(processedRoot, 'Single-000001', 'Single-000001_01.jpg'),
              path.join(processedRoot, 'Single-000001', 'Single-000001_02.png'),
            ],
            status: 'record_created',
          }),
        },
      ],
      groupingState: {
        pending: [],
      },
    });
  });

  it('processes completed groups sequentially and preserves ordering', async () => {
    let releaseFirstMove: (() => void) | undefined;
    const firstMoveFinished = new Promise<void>((resolve) => {
      releaseFirstMove = resolve;
    });
    const callOrder: string[] = [];
    const moveGroupedImagesToProcessedListing = vi.fn(async (input: ProcessedImageMoveInput) => {
      callOrder.push(`start:${input.listingId}`);

      if (input.listingId === 'Single-000001') {
        await firstMoveFinished;
      }

      callOrder.push(`finish:${input.listingId}`);
      return createMoveResult(input);
    });

    const createWatcherListing = vi.fn(async (input) => {
      callOrder.push(`insert:${input.listingId}`);
      return createListingRow(createMoveResult({
        listingId: input.listingId,
        processedDirectory: '/processed',
        images: input.images.map((image) => ({ path: image.processedPath })),
      }), input.captureMode);
    });
    const batchPromise = processIncomingImageBatch(
      {
        incoming: ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg'],
        processedDirectory: '/processed',
      },
      createDependencies({
        allocateNextListingId: vi.fn(async () => 'Single-000001'),
        moveGroupedImagesToProcessedListing,
        createWatcherListing,
      })
    );

    await vi.waitFor(() => {
      expect(moveGroupedImagesToProcessedListing).toHaveBeenCalledTimes(1);
    });
    expect(callOrder).toEqual(['start:Single-000001']);

    releaseFirstMove?.();

    const result = await batchPromise;

    expect(callOrder).toEqual([
      'start:Single-000001',
      'finish:Single-000001',
      'insert:Single-000001',
      'start:Single-000002',
      'finish:Single-000002',
      'insert:Single-000002',
    ]);
    expect(result.processedListings.map((listing) => listing.listingId)).toEqual([
      'Single-000001',
      'Single-000002',
    ]);
  });

  it('preserves ordering across prior pending state and new incoming images', async () => {
    const result = await processIncomingImageBatch(
      {
        incoming: ['a.jpg', 'b.jpg'],
        processedDirectory: '/processed',
        groupingState: {
          pending: [{ path: 'z.jpg' }],
        },
      },
      createDependencies()
    );

    expect(result.processedListings).toHaveLength(1);
    expect(result.processedListings[0].images.map((image) => image.sourcePath)).toEqual([
      'z.jpg',
      'a.jpg',
    ]);
    expect(result.groupingState.pending).toEqual([{ path: 'b.jpg' }]);
  });

  it('clones grouping state and never mutates caller-owned state', async () => {
    const groupingState = {
      pending: [{ path: 'z.jpg' }],
    };

    const result = await processIncomingImageBatch(
      {
        incoming: ['a.jpg', 'b.jpg'],
        processedDirectory: '/processed',
        groupingState,
      },
      createDependencies()
    );

    expect(groupingState).toEqual({
      pending: [{ path: 'z.jpg' }],
    });
    expect(result.groupingState).not.toBe(groupingState);
    expect(result.groupingState.pending).not.toBe(groupingState.pending);
  });

  it('ignores unsupported files through grouping layer', async () => {
    const result = await processIncomingImageBatch(
      {
        incoming: ['a.jpg', 'skip.gif', 'b.png'],
        processedDirectory: '/processed',
      },
      createDependencies()
    );

    expect(result.processedListings[0].images.map((image) => image.sourcePath)).toEqual([
      'a.jpg',
      'b.png',
    ]);
  });

  it('bubbles allocation failures and leaves later groups untouched', async () => {
    const moveGroupedImagesToProcessedListing = vi.fn(async (input: ProcessedImageMoveInput) =>
      createMoveResult(input)
    );

    await expect(
      processIncomingImageBatch(
        {
          incoming: ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg'],
          processedDirectory: '/processed',
        },
        createDependencies({
          allocateNextListingId: vi.fn(async () => {
            throw new Error('listing allocation failed');
          }),
          moveGroupedImagesToProcessedListing,
        })
      )
    ).rejects.toThrow('listing allocation failed');

    expect(moveGroupedImagesToProcessedListing).not.toHaveBeenCalled();
  });

  it('exposes partial progress when a later group move fails', async () => {
    const moveGroupedImagesToProcessedListing = vi.fn(async (input: ProcessedImageMoveInput) => {
      if (input.listingId === 'Single-000002') {
        throw new Error('processed move failed');
      }

      return createMoveResult(input);
    });

    try {
      await processIncomingImageBatch(
        {
          incoming: ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg'],
          processedDirectory: '/processed',
        },
        createDependencies({
          allocateNextListingId: vi.fn(async () => 'Single-000001'),
          moveGroupedImagesToProcessedListing,
        })
      );
      throw new Error('expected processIncomingImageBatch to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(WatcherBatchProcessingError);
      expect((error as WatcherBatchProcessingError).message).toBe('processed move failed');
      expect((error as WatcherBatchProcessingError).processedListings.map((listing) => listing.listingId)).toEqual([
        'Single-000001',
      ]);
      expect((error as WatcherBatchProcessingError).groupingState).toEqual({ pending: [] });
      expect((error as WatcherBatchProcessingError).retryInputs).toEqual(['c.jpg', 'd.jpg']);
    }

    expect(moveGroupedImagesToProcessedListing).toHaveBeenCalledTimes(2);
  });

  it('keeps earlier group side effects intact and exposes retry inputs when a later group insert fails', async () => {
    const { incomingDirectory, processedRoot } = await createTempLayout();
    const first = writeSourceFile(incomingDirectory, 'one.jpg');
    const second = writeSourceFile(incomingDirectory, 'two.jpg');
    const third = writeSourceFile(incomingDirectory, 'three.jpg');
    const fourth = writeSourceFile(incomingDirectory, 'four.jpg');
    const createWatcherListing = vi
      .fn(async (input) => {
        if (input.listingId === 'Single-000002') {
          throw new Error('db offline');
        }

        return createListingRow(createMoveResult({
          listingId: input.listingId,
          processedDirectory: processedRoot,
          images: input.images.map((image) => ({ path: image.processedPath })),
        }), input.captureMode);
      });

    let batchError: WatcherBatchProcessingError | null = null;

    try {
      await processIncomingImageBatch(
        {
          incoming: [first, second, third, fourth],
          processedDirectory: processedRoot,
        },
        createProcessIncomingImageBatchDependencies({
          appSettingsRepository: {
            get: vi.fn(async () => ({ capture_mode: 'single_2_image' } as never)),
          },
          listingIdRepository: {
            getLatestByPrefix: vi.fn(async () => null),
          },
          watcherListingRepository: {
            createWatcherListing,
          },
        })
      );
      throw new Error('expected processIncomingImageBatch to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(WatcherBatchProcessingError);
      batchError = error as WatcherBatchProcessingError;
    }

    expect(batchError?.processedListings.map((listing) => listing.listingId)).toEqual([
      'Single-000001',
    ]);
    expect(batchError?.groupingState).toEqual({ pending: [] });
    expect(batchError?.retryInputs).toEqual([third, fourth]);
    expect(batchError?.cause).toBeInstanceOf(Error);

    await expect(
      fsPromises.readFile(
        path.join(processedRoot, 'Single-000001', 'Single-000001_01.jpg'),
        'utf-8'
      )
    ).resolves.toBe('one.jpg');
    await expect(
      fsPromises.readFile(
        path.join(processedRoot, 'Single-000001', 'Single-000001_02.jpg'),
        'utf-8'
      )
    ).resolves.toBe('two.jpg');
    await expect(fsPromises.access(first)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fsPromises.access(second)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fsPromises.readFile(third, 'utf-8')).resolves.toBe('three.jpg');
    await expect(fsPromises.readFile(fourth, 'utf-8')).resolves.toBe('four.jpg');
    await expect(
      fsPromises.access(path.join(processedRoot, 'Single-000002'))
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('retries processed directory collisions with a fresh listing_id', async () => {
    const moveGroupedImagesToProcessedListing = vi
      .fn()
      .mockRejectedValueOnce(new Error('processed dir exists'))
      .mockResolvedValueOnce(
        createMoveResult({
          listingId: 'Single-000002',
          processedDirectory: '/processed',
          images: [{ path: 'a.jpg' }, { path: 'b.jpg' }],
        })
      );

    const result = await processIncomingImageBatch(
      {
        incoming: ['a.jpg', 'b.jpg'],
        processedDirectory: '/processed',
      },
      createDependencies({
        allocateNextListingId: vi.fn(async () => 'Single-000001'),
        moveGroupedImagesToProcessedListing,
        isProcessedListingCollision: vi.fn((error) => (error as Error).message === 'processed dir exists'),
      })
    );

    expect(moveGroupedImagesToProcessedListing).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ listingId: 'Single-000001' })
    );
    expect(moveGroupedImagesToProcessedListing).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ listingId: 'Single-000002' })
    );
    expect(result.processedListings[0].listingId).toBe('Single-000002');
  });

  it('applies the retry cap to repeated processed directory collisions', async () => {
    const collisionError = new Error('processed dir exists');

    await expect(
      processIncomingImageBatch(
        {
          incoming: ['a.jpg', 'b.jpg'],
          processedDirectory: '/processed',
        },
        createDependencies({
          moveGroupedImagesToProcessedListing: vi.fn(async () => {
            throw collisionError;
          }),
          isProcessedListingCollision: vi.fn((error) => error === collisionError),
        })
      )
    ).rejects.toThrow(`Watcher listing insert hit retry cap (${WATCHER_LISTING_INSERT_MAX_ATTEMPTS})`);
  });

  it('returns updated grouping state for mixed complete and incomplete input', async () => {
    const result = await processIncomingImageBatch(
      {
        incoming: ['a.jpg', 'b.jpg'],
        processedDirectory: '/processed',
        groupingState: {
          pending: [{ path: 'z.jpg' }],
        },
      },
      createDependencies()
    );

    expect(result.groupingState).toEqual({
      pending: [{ path: 'b.jpg' }],
    });
  });

  it('wires injected repositories and file system through dependency helper', async () => {
    const appSettingsRepository = {
      get: vi.fn(async () => ({ capture_mode: 'single_2_image' } as never)),
    };
    const listingIdRepository = {
      getLatestByPrefix: vi.fn(async () => null),
    };
    const fileSystem: ProcessedImageMoveFileSystem = {
      copyFile: vi.fn(async () => undefined),
      lstat: vi.fn(async (pathValue: string) => {
        throw createMissingPathError(pathValue);
      }) as unknown as ProcessedImageMoveFileSystem['lstat'],
      mkdir: vi.fn(async () => undefined),
      readdir: vi.fn(async () => []),
      rename: vi.fn(async () => undefined),
      rmdir: vi.fn(async () => undefined),
      unlink: vi.fn(async () => undefined),
    };

    const dependencies = createProcessIncomingImageBatchDependencies({
      appSettingsRepository,
      listingIdRepository,
      watcherListingRepository: {
        createWatcherListing: vi.fn(async (input) =>
          createListingRow(createMoveResult({
            listingId: input.listingId,
            processedDirectory: '/processed',
            images: input.images.map((image) => ({ path: image.processedPath })),
          }), input.captureMode)
        ),
      },
      fileSystem,
    });

    const result = await processIncomingImageBatch(
      {
        incoming: ['/incoming/a.jpg', '/incoming/b.png'],
        processedDirectory: '/processed',
      },
      dependencies
    );

    expect(result.processedListings[0].listingId).toBe('Single-000001');
    expect(appSettingsRepository.get).toHaveBeenCalledTimes(1);
    expect(listingIdRepository.getLatestByPrefix).toHaveBeenCalledWith('Single');
    expect(fileSystem.mkdir).toHaveBeenCalledWith('/processed/Single-000001');
    expect(fileSystem.rename).toHaveBeenCalledTimes(2);
    expect(fileSystem.rename).toHaveBeenNthCalledWith(
      1,
      '/incoming/a.jpg',
      '/processed/Single-000001/Single-000001_01.jpg'
    );
    expect(fileSystem.rename).toHaveBeenNthCalledWith(
      2,
      '/incoming/b.png',
      '/processed/Single-000001/Single-000001_02.png'
    );
  });

  it('retries unique collisions with fresh listing_id and fresh processed folder', async () => {
    const { incomingDirectory, processedRoot } = await createTempLayout();
    const first = writeSourceFile(incomingDirectory, 'one.jpg');
    const second = writeSourceFile(incomingDirectory, 'two.jpg');
    const createWatcherListing = vi
      .fn()
      .mockRejectedValueOnce({
        code: '23505',
        message: 'duplicate key value violates unique constraint "listings_listing_id_key"',
      })
      .mockImplementationOnce(async (input) =>
        createListingRow(createMoveResult({
          listingId: input.listingId,
          processedDirectory: processedRoot,
          images: input.images.map((image) => ({ path: image.processedPath })),
        }), input.captureMode)
      );

    const result = await processIncomingImageBatch(
      {
        incoming: [first, second],
        processedDirectory: processedRoot,
      },
      createProcessIncomingImageBatchDependencies({
        appSettingsRepository: {
          get: vi.fn(async () => ({ capture_mode: 'single_2_image' } as never)),
        },
        listingIdRepository: {
          getLatestByPrefix: vi.fn(async () => null),
        },
        watcherListingRepository: {
          createWatcherListing,
        },
      })
    );

    expect(createWatcherListing).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ listingId: 'Single-000001' })
    );
    expect(createWatcherListing).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ listingId: 'Single-000002' })
    );
    expect(result.processedListings[0].listingId).toBe('Single-000002');
    await expect(
      fsPromises.access(path.join(processedRoot, 'Single-000001'))
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      fsPromises.readFile(
        path.join(processedRoot, 'Single-000002', 'Single-000002_01.jpg'),
        'utf-8'
      )
    ).resolves.toBe('one.jpg');
  });

  it('fails loudly at retry cap after repeated listing_id collisions', async () => {
    const collisionError = {
      code: '23505',
      message: 'duplicate key value violates unique constraint "listings_listing_id_key"',
    };

    await expect(
      processIncomingImageBatch(
        {
          incoming: ['a.jpg', 'b.jpg'],
          processedDirectory: '/processed',
        },
        createDependencies({
          createWatcherListing: vi.fn(async () => {
            throw collisionError;
          }),
          isWatcherListingCollision: vi.fn((error) => error === collisionError),
        })
      )
    ).rejects.toThrow(`Watcher listing insert hit retry cap (${WATCHER_LISTING_INSERT_MAX_ATTEMPTS})`);
  });

  it('rolls back processed folder before bubbling non-unique insert errors', async () => {
    const { incomingDirectory, processedRoot } = await createTempLayout();
    const first = writeSourceFile(incomingDirectory, 'one.jpg');
    const second = writeSourceFile(incomingDirectory, 'two.jpg');

    await expect(
      processIncomingImageBatch(
        {
          incoming: [first, second],
          processedDirectory: processedRoot,
        },
        createProcessIncomingImageBatchDependencies({
          appSettingsRepository: {
            get: vi.fn(async () => ({ capture_mode: 'single_2_image' } as never)),
          },
          listingIdRepository: {
            getLatestByPrefix: vi.fn(async () => null),
          },
          watcherListingRepository: {
            createWatcherListing: vi.fn(async () => {
              throw new Error('db offline');
            }),
          },
        })
      )
    ).rejects.toThrow('db offline');

    await expect(fsPromises.readFile(first, 'utf-8')).resolves.toBe('one.jpg');
    await expect(fsPromises.readFile(second, 'utf-8')).resolves.toBe('two.jpg');
    await expect(
      fsPromises.access(path.join(processedRoot, 'Single-000001'))
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
