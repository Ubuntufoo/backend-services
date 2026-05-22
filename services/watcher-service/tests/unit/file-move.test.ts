import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  moveGroupedImagesToProcessedListing,
  ProcessedListingDirectoryCollisionError,
  type ProcessedImageMoveFileSystem,
} from '../../src/index.js';

describe('processed file move execution', () => {
  let tempDir: string | undefined;

  afterEach(() => {
    vi.restoreAllMocks();

    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  async function createTempLayout() {
    tempDir = mkdtempSync(path.join(tmpdir(), 'watcher-processed-move-'));

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

  function createFileSystem(
    overrides: Partial<ProcessedImageMoveFileSystem> = {}
  ): ProcessedImageMoveFileSystem {
    return {
      copyFile: fsPromises.copyFile.bind(fsPromises),
      lstat: fsPromises.lstat.bind(fsPromises),
      mkdir: fsPromises.mkdir.bind(fsPromises),
      readdir: fsPromises.readdir.bind(fsPromises),
      rename: fsPromises.rename.bind(fsPromises),
      rmdir: fsPromises.rmdir.bind(fsPromises),
      unlink: fsPromises.unlink.bind(fsPromises),
      ...overrides,
    };
  }

  it('creates processed folder and moves files with deterministic names', async () => {
    const { incomingDirectory, processedRoot } = await createTempLayout();
    const first = writeSourceFile(incomingDirectory, 'cam-2.JPG');
    const second = writeSourceFile(incomingDirectory, 'cam-1.jpeg');

    const result = await moveGroupedImagesToProcessedListing({
      listingId: 'Single-000123',
      processedDirectory: processedRoot,
      images: [{ path: first }, { path: second }],
    });

    expect(result).toEqual({
      listingId: 'Single-000123',
      processedDirectory: path.join(processedRoot, 'Single-000123'),
      images: [
        {
          sourcePath: first,
          processedPath: path.join(processedRoot, 'Single-000123', 'Single-000123_01.jpg'),
          fileName: 'Single-000123_01.jpg',
          order: 1,
          extension: '.jpg',
        },
        {
          sourcePath: second,
          processedPath: path.join(processedRoot, 'Single-000123', 'Single-000123_02.jpeg'),
          fileName: 'Single-000123_02.jpeg',
          order: 2,
          extension: '.jpeg',
        },
      ],
    });

    await expect(fsPromises.readFile(result.images[0].processedPath, 'utf-8')).resolves.toBe('cam-2.JPG');
    await expect(fsPromises.readFile(result.images[1].processedPath, 'utf-8')).resolves.toBe(
      'cam-1.jpeg'
    );
    await expect(fsPromises.access(first)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fsPromises.access(second)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('preserves supported extension types while normalizing case', async () => {
    const { incomingDirectory, processedRoot } = await createTempLayout();
    const jpg = writeSourceFile(incomingDirectory, 'one.JPG');
    const jpeg = writeSourceFile(incomingDirectory, 'two.JPEG');
    const png = writeSourceFile(incomingDirectory, 'three.PNG');
    const webp = writeSourceFile(incomingDirectory, 'four.WEBP');

    const result = await moveGroupedImagesToProcessedListing({
      listingId: 'Lot-000456',
      processedDirectory: processedRoot,
      images: [{ path: jpg }, { path: jpeg }, { path: png }, { path: webp }],
    });

    expect(result.images.map((image) => image.fileName)).toEqual([
      'Lot-000456_01.jpg',
      'Lot-000456_02.jpeg',
      'Lot-000456_03.png',
      'Lot-000456_04.webp',
    ]);
  });

  it('rejects existing processed folders before moving anything', async () => {
    const { incomingDirectory, processedRoot } = await createTempLayout();
    const sourcePath = writeSourceFile(incomingDirectory, 'one.jpg');
    await fsPromises.mkdir(path.join(processedRoot, 'Single-000123'));

    await expect(
      moveGroupedImagesToProcessedListing({
        listingId: 'Single-000123',
        processedDirectory: processedRoot,
        images: [{ path: sourcePath }],
      })
    ).rejects.toBeInstanceOf(ProcessedListingDirectoryCollisionError);

    await expect(fsPromises.readFile(sourcePath, 'utf-8')).resolves.toBe('one.jpg');
  });

  it('rejects duplicate source paths before creating destination folder', async () => {
    const { incomingDirectory, processedRoot } = await createTempLayout();
    const sourcePath = writeSourceFile(incomingDirectory, 'one.jpg');

    await expect(
      moveGroupedImagesToProcessedListing({
        listingId: 'Single-000123',
        processedDirectory: processedRoot,
        images: [{ path: sourcePath }, { path: sourcePath }],
      })
    ).rejects.toThrow('Duplicate source image path in processed move plan:');

    await expect(
      fsPromises.access(path.join(processedRoot, 'Single-000123'))
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects destination collisions without overwriting files', async () => {
    const { incomingDirectory, processedRoot } = await createTempLayout();
    const sourcePath = writeSourceFile(incomingDirectory, 'one.jpg');
    const destinationPath = path.join(
      processedRoot,
      'Single-000123',
      'Single-000123_01.jpg'
    );
    const fileSystem = createFileSystem({
      rename: async (from, to) => {
        if (from === sourcePath && to === destinationPath) {
          writeFileSync(destinationPath, 'foreign file', 'utf-8');
          const error = new Error('destination exists');
          Object.assign(error, { code: 'EEXIST' });
          throw error;
        }

        return fsPromises.rename(from, to);
      },
    });

    await expect(
      moveGroupedImagesToProcessedListing({
        listingId: 'Single-000123',
        processedDirectory: processedRoot,
        images: [{ path: sourcePath }],
      }, fileSystem)
    ).rejects.toThrow('Processed image move failed for Single-000123:');

    await expect(fsPromises.readFile(sourcePath, 'utf-8')).resolves.toBe('one.jpg');
    await expect(fsPromises.readFile(destinationPath, 'utf-8')).resolves.toBe('foreign file');
  });

  it('falls back to copy and unlink on cross-device rename errors', async () => {
    const { incomingDirectory, processedRoot } = await createTempLayout();
    const sourcePath = writeSourceFile(incomingDirectory, 'one.JPG');
    const fileSystem = createFileSystem({
      rename: async (from, to) => {
        if (from === sourcePath) {
          const error = new Error('cross-device');
          Object.assign(error, { code: 'EXDEV' });
          throw error;
        }

        return fsPromises.rename(from, to);
      },
    });

    const result = await moveGroupedImagesToProcessedListing({
      listingId: 'Single-000123',
      processedDirectory: processedRoot,
      images: [{ path: sourcePath }],
    }, fileSystem);

    await expect(fsPromises.readFile(result.images[0].processedPath, 'utf-8')).resolves.toBe('one.JPG');
    await expect(fsPromises.access(sourcePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rolls back already moved files when a later move fails', async () => {
    const { incomingDirectory, processedRoot } = await createTempLayout();
    const first = writeSourceFile(incomingDirectory, 'one.jpg');
    const second = writeSourceFile(incomingDirectory, 'two.jpg');
    const fileSystem = createFileSystem({
      rename: async (from, to) => {
        if (from === second) {
          throw new Error('disk full');
        }

        return fsPromises.rename(from, to);
      },
    });

    await expect(
      moveGroupedImagesToProcessedListing({
        listingId: 'Single-000123',
        processedDirectory: processedRoot,
        images: [{ path: first }, { path: second }],
      }, fileSystem)
    ).rejects.toThrow('Processed image move failed for Single-000123: disk full.');

    await expect(fsPromises.readFile(first, 'utf-8')).resolves.toBe('one.jpg');
    await expect(fsPromises.readFile(second, 'utf-8')).resolves.toBe('two.jpg');
    await expect(
      fsPromises.access(path.join(processedRoot, 'Single-000123'))
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('fails on second run after success because processed folder already exists', async () => {
    const { incomingDirectory, processedRoot } = await createTempLayout();
    const firstRunSource = writeSourceFile(incomingDirectory, 'one.jpg');

    await moveGroupedImagesToProcessedListing({
      listingId: 'Single-000123',
      processedDirectory: processedRoot,
      images: [{ path: firstRunSource }],
    });

    const secondRunSource = writeSourceFile(incomingDirectory, 'two.jpg');

    await expect(
      moveGroupedImagesToProcessedListing({
        listingId: 'Single-000123',
        processedDirectory: processedRoot,
        images: [{ path: secondRunSource }],
      })
    ).rejects.toBeInstanceOf(ProcessedListingDirectoryCollisionError);

    await expect(fsPromises.readFile(secondRunSource, 'utf-8')).resolves.toBe('two.jpg');
  });
});
