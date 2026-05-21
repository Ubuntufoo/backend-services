import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  consumeImageGrouping,
  createProcessIncomingImageBatchDependencies,
  processIncomingImageBatch,
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
        getActiveWatcherCaptureMode: vi.fn(async () => 'single_2_image'),
        consumeImageGrouping,
        allocateNextListingId,
        moveGroupedImagesToProcessedListing,
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
        getActiveWatcherCaptureMode,
        consumeImageGrouping,
        allocateNextListingId,
        moveGroupedImagesToProcessedListing,
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

    const batchPromise = processIncomingImageBatch(
      {
        incoming: ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg'],
        processedDirectory: '/processed',
      },
      {
        getActiveWatcherCaptureMode: vi.fn(async () => 'single_2_image'),
        consumeImageGrouping,
        allocateNextListingId: vi.fn(async () => 'Single-000001'),
        moveGroupedImagesToProcessedListing,
      }
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
      'start:Single-000002',
      'finish:Single-000002',
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
      {
        getActiveWatcherCaptureMode: vi.fn(async () => 'single_2_image'),
        consumeImageGrouping,
        allocateNextListingId: vi.fn(async () => 'Single-000001'),
        moveGroupedImagesToProcessedListing: vi.fn(async (input: ProcessedImageMoveInput) =>
          createMoveResult(input)
        ),
      }
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
      {
        getActiveWatcherCaptureMode: vi.fn(async () => 'single_2_image'),
        consumeImageGrouping,
        allocateNextListingId: vi.fn(async () => 'Single-000001'),
        moveGroupedImagesToProcessedListing: vi.fn(async (input: ProcessedImageMoveInput) =>
          createMoveResult(input)
        ),
      }
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
      {
        getActiveWatcherCaptureMode: vi.fn(async () => 'single_2_image'),
        consumeImageGrouping,
        allocateNextListingId: vi.fn(async () => 'Single-000001'),
        moveGroupedImagesToProcessedListing: vi.fn(async (input: ProcessedImageMoveInput) =>
          createMoveResult(input)
        ),
      }
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
        {
          getActiveWatcherCaptureMode: vi.fn(async () => 'single_2_image'),
          consumeImageGrouping,
          allocateNextListingId: vi.fn(async () => {
            throw new Error('listing allocation failed');
          }),
          moveGroupedImagesToProcessedListing,
        }
      )
    ).rejects.toThrow('listing allocation failed');

    expect(moveGroupedImagesToProcessedListing).not.toHaveBeenCalled();
  });

  it('bubbles move failures and leaves later groups untouched', async () => {
    const moveGroupedImagesToProcessedListing = vi.fn(async (input: ProcessedImageMoveInput) => {
      if (input.listingId === 'Single-000001') {
        throw new Error('processed move failed');
      }

      return createMoveResult(input);
    });

    await expect(
      processIncomingImageBatch(
        {
          incoming: ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg'],
          processedDirectory: '/processed',
        },
        {
          getActiveWatcherCaptureMode: vi.fn(async () => 'single_2_image'),
          consumeImageGrouping,
          allocateNextListingId: vi.fn(async () => 'Single-000001'),
          moveGroupedImagesToProcessedListing,
        }
      )
    ).rejects.toThrow('processed move failed');

    expect(moveGroupedImagesToProcessedListing).toHaveBeenCalledTimes(1);
  });

  it('keeps earlier group side effects intact when a later group move fails', async () => {
    const { incomingDirectory, processedRoot } = await createTempLayout();
    const first = writeSourceFile(incomingDirectory, 'one.jpg');
    const second = writeSourceFile(incomingDirectory, 'two.jpg');
    const third = writeSourceFile(incomingDirectory, 'three.jpg');
    const fourth = writeSourceFile(incomingDirectory, 'four.jpg');

    mkdirSync(path.join(processedRoot, 'Single-000002'));

    await expect(
      processIncomingImageBatch(
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
        })
      )
    ).rejects.toThrow(
      `Processed listing directory already exists and cannot be reused: ${path.join(
        processedRoot,
        'Single-000002'
      )}.`
    );

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
      {
        getActiveWatcherCaptureMode: vi.fn(async () => 'single_2_image'),
        consumeImageGrouping,
        allocateNextListingId: vi.fn(async () => 'Single-000001'),
        moveGroupedImagesToProcessedListing: vi.fn(async (input: ProcessedImageMoveInput) =>
          createMoveResult(input)
        ),
      }
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
});
