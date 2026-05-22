import { chmodSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createProcessListingImagesDependencies,
  processListingImages,
  type ImageServiceFileSystem,
} from '../../src/index.js';

async function createFixtureImages(directory: string) {
  const jpegPath = path.join(directory, 'Photo-One.JPG');
  const pngPath = path.join(directory, 'second-image.png');
  const webpPath = path.join(directory, 'third-image.webp');

  await sharp({
    create: {
      width: 1,
      height: 2,
      channels: 3,
      background: { r: 255, g: 0, b: 0 },
    },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toFile(jpegPath);

  await sharp({
    create: {
      width: 2,
      height: 1,
      channels: 4,
      background: { r: 0, g: 255, b: 0, alpha: 1 },
    },
  })
    .png()
    .toFile(pngPath);

  await sharp({
    create: {
      width: 2,
      height: 2,
      channels: 3,
      background: { r: 0, g: 0, b: 255 },
    },
  })
    .webp()
    .toFile(webpPath);

  return { jpegPath, pngPath, webpPath };
}

function createFileSystem(
  overrides: Partial<ImageServiceFileSystem> = {}
): ImageServiceFileSystem {
  return {
    access: fsPromises.access.bind(fsPromises),
    copyFile: fsPromises.copyFile.bind(fsPromises),
    lstat: fsPromises.lstat.bind(fsPromises),
    mkdir: fsPromises.mkdir.bind(fsPromises),
    realpath: fsPromises.realpath.bind(fsPromises),
    rename: fsPromises.rename.bind(fsPromises),
    stat: fsPromises.stat.bind(fsPromises),
    unlink: fsPromises.unlink.bind(fsPromises),
    ...overrides,
  };
}

describe('processListingImages', () => {
  let tempDir: string | undefined;
  let unreadableFilePath: string | undefined;

  afterEach(() => {
    vi.restoreAllMocks();

    if (unreadableFilePath) {
      chmodSync(unreadableFilePath, 0o644);
      unreadableFilePath = undefined;
    }

    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  async function createTempLayout() {
    tempDir = mkdtempSync(path.join(tmpdir(), 'image-service-process-'));

    const sourceDirectory = path.join(tempDir, 'source');
    const secondSourceDirectory = path.join(tempDir, 'source-2');
    const outputDirectory = path.join(tempDir, 'processed');

    await fsPromises.mkdir(sourceDirectory);
    await fsPromises.mkdir(secondSourceDirectory);

    return { sourceDirectory, secondSourceDirectory, outputDirectory };
  }

  it('copies bytes unchanged in passthrough mode and preserves watcher filenames', async () => {
    const { sourceDirectory, outputDirectory } = await createTempLayout();
    const { jpegPath } = await createFixtureImages(sourceDirectory);
    const sourceBytes = await fsPromises.readFile(jpegPath);

    const result = await processListingImages({
      listingId: 'Single-000001',
      inputImagePaths: [jpegPath],
      outputDirectory,
      processingMode: 'passthrough',
    });

    const outputBytes = await fsPromises.readFile(path.join(outputDirectory, 'Photo-One.JPG'));

    expect(outputBytes.equals(sourceBytes)).toBe(true);
    expect(result).toEqual({
      listingId: 'Single-000001',
      outputDirectory,
      processingMode: 'passthrough',
      images: [
        {
          sourcePath: jpegPath,
          outputPath: path.join(outputDirectory, 'Photo-One.JPG'),
          filename: 'Photo-One.JPG',
          sizeBytes: outputBytes.length,
          processingMode: 'passthrough',
        },
      ],
    });
  });

  it('strips metadata, auto-orients jpeg output, and preserves filename', async () => {
    const { sourceDirectory, outputDirectory } = await createTempLayout();
    const { jpegPath } = await createFixtureImages(sourceDirectory);
    const sourceMetadata = await sharp(jpegPath).metadata();

    const result = await processListingImages({
      listingId: 'Single-000002',
      inputImagePaths: [jpegPath],
      outputDirectory,
      processingMode: 'strip_exif',
    });

    const outputPath = path.join(outputDirectory, 'Photo-One.JPG');
    const outputMetadata = await sharp(outputPath).metadata();

    expect(sourceMetadata.orientation).toBe(6);
    expect(sourceMetadata.exif).toBeDefined();
    expect(outputMetadata.orientation).toBeUndefined();
    expect(outputMetadata.exif).toBeUndefined();
    expect(outputMetadata.width).toBe(2);
    expect(outputMetadata.height).toBe(1);
    expect(result.images[0]).toEqual({
      sourcePath: jpegPath,
      outputPath,
      filename: 'Photo-One.JPG',
      sizeBytes: expect.any(Number),
      processingMode: 'strip_exif',
    });
  });

  it('accepts mixed supported extensions', async () => {
    const { sourceDirectory, outputDirectory } = await createTempLayout();
    const { jpegPath, pngPath, webpPath } = await createFixtureImages(sourceDirectory);

    const result = await processListingImages({
      listingId: 'Lot-000001',
      inputImagePaths: [jpegPath, pngPath, webpPath],
      outputDirectory,
      processingMode: 'passthrough',
    });

    expect(result.images.map((image) => image.filename)).toEqual([
      'Photo-One.JPG',
      'second-image.png',
      'third-image.webp',
    ]);
  });

  it('creates missing output directories during preflight', async () => {
    const { sourceDirectory, outputDirectory } = await createTempLayout();
    const { pngPath } = await createFixtureImages(sourceDirectory);
    const nestedOutputDirectory = path.join(outputDirectory, 'nested', 'final');

    const result = await processListingImages({
      listingId: 'Single-000003',
      inputImagePaths: [pngPath],
      outputDirectory: nestedOutputDirectory,
      processingMode: 'passthrough',
    });

    await expect(fsPromises.access(path.join(nestedOutputDirectory, 'second-image.png'))).resolves.toBeUndefined();
    expect(result.outputDirectory).toBe(nestedOutputDirectory);
  });

  it('fails clearly on missing source files', async () => {
    const { outputDirectory } = await createTempLayout();
    const missingPath = path.join(tempDir as string, 'missing.jpg');

    await expect(
      processListingImages({
        listingId: 'Single-000004',
        inputImagePaths: [missingPath],
        outputDirectory,
        processingMode: 'passthrough',
      })
    ).rejects.toThrow(`Source image is missing or unreadable: ${missingPath}`);
  });

  it('fails clearly on unsupported extensions', async () => {
    const { sourceDirectory, outputDirectory } = await createTempLayout();
    const gifPath = path.join(sourceDirectory, 'anim.gif');
    writeFileSync(gifPath, 'gif89a', 'utf-8');

    await expect(
      processListingImages({
        listingId: 'Single-000005',
        inputImagePaths: [gifPath],
        outputDirectory,
        processingMode: 'passthrough',
      })
    ).rejects.toThrow(`Unsupported image extension for ${gifPath}`);
  });

  it('fails clearly on directory inputs', async () => {
    const { sourceDirectory, outputDirectory } = await createTempLayout();
    const directoryInput = path.join(sourceDirectory, 'nested.png');
    mkdirSync(directoryInput);

    await expect(
      processListingImages({
        listingId: 'Single-000006',
        inputImagePaths: [directoryInput],
        outputDirectory,
        processingMode: 'passthrough',
      })
    ).rejects.toThrow(`Source image is not a file: ${directoryInput}.`);
  });

  it('fails clearly on unreadable files', async () => {
    const { sourceDirectory, outputDirectory } = await createTempLayout();
    const { pngPath } = await createFixtureImages(sourceDirectory);

    unreadableFilePath = pngPath;
    chmodSync(pngPath, 0o000);

    await expect(
      processListingImages({
        listingId: 'Single-000007',
        inputImagePaths: [pngPath],
        outputDirectory,
        processingMode: 'passthrough',
      })
    ).rejects.toThrow(`Source image is missing or unreadable: ${pngPath}`);
  });

  it('fails clearly on invalid output paths', async () => {
    const { sourceDirectory } = await createTempLayout();
    const { pngPath } = await createFixtureImages(sourceDirectory);
    const invalidOutputPath = path.join(sourceDirectory, 'output-file');
    writeFileSync(invalidOutputPath, 'not dir', 'utf-8');

    await expect(
      processListingImages({
        listingId: 'Single-000008',
        inputImagePaths: [pngPath],
        outputDirectory: invalidOutputPath,
        processingMode: 'passthrough',
      })
    ).rejects.toThrow(`Output directory could not be created: ${invalidOutputPath}`);
  });

  it('fails on duplicate destination basenames from different source directories', async () => {
    const { sourceDirectory, secondSourceDirectory, outputDirectory } = await createTempLayout();
    const firstPath = path.join(sourceDirectory, 'duplicate.jpg');
    const secondPath = path.join(secondSourceDirectory, 'duplicate.jpg');

    writeFileSync(firstPath, 'one', 'utf-8');
    writeFileSync(secondPath, 'two', 'utf-8');

    await expect(
      processListingImages({
        listingId: 'Single-000009',
        inputImagePaths: [firstPath, secondPath],
        outputDirectory,
        processingMode: 'passthrough',
      })
    ).rejects.toThrow('Duplicate destination filename after preserving watcher names: duplicate.jpg.');
  });

  it('fails when destination file already exists', async () => {
    const { sourceDirectory, outputDirectory } = await createTempLayout();
    const { webpPath } = await createFixtureImages(sourceDirectory);
    await fsPromises.mkdir(outputDirectory, { recursive: true });
    writeFileSync(path.join(outputDirectory, 'third-image.webp'), 'existing', 'utf-8');

    await expect(
      processListingImages({
        listingId: 'Single-000010',
        inputImagePaths: [webpPath],
        outputDirectory,
        processingMode: 'passthrough',
      })
    ).rejects.toThrow('Output image already exists and cannot be overwritten');
  });

  it('rejects output directory matching source parent before writing output', async () => {
    const { sourceDirectory } = await createTempLayout();
    const { pngPath } = await createFixtureImages(sourceDirectory);

    await expect(
      processListingImages({
        listingId: 'Single-000011',
        inputImagePaths: [pngPath],
        outputDirectory: sourceDirectory,
        processingMode: 'passthrough',
      })
    ).rejects.toThrow(`Output directory must differ from source parent directory: ${sourceDirectory}.`);

    expect((await fsPromises.readdir(sourceDirectory)).every((entry) => !entry.startsWith('.'))).toBe(true);
  });

  it('rejects symlink-alias source directories that resolve to the output directory', async () => {
    const { outputDirectory } = await createTempLayout();
    const realSourceDirectory = path.join(tempDir as string, 'real-source');
    const aliasedSourceDirectory = path.join(tempDir as string, 'source-alias');

    await fsPromises.mkdir(realSourceDirectory);
    symlinkSync(realSourceDirectory, aliasedSourceDirectory, 'dir');

    const { pngPath } = await createFixtureImages(realSourceDirectory);
    const aliasedSourcePath = path.join(aliasedSourceDirectory, path.basename(pngPath));

    await expect(
      processListingImages({
        listingId: 'Single-000011',
        inputImagePaths: [aliasedSourcePath],
        outputDirectory: realSourceDirectory,
        processingMode: 'passthrough',
      })
    ).rejects.toThrow(`Output directory must differ from source parent directory: ${realSourceDirectory}.`);

    expect(await fsPromises.readdir(realSourceDirectory)).toEqual([
      'Photo-One.JPG',
      'second-image.png',
      'third-image.webp',
    ]);
  });

  it('cleans temp files and written outputs after mid-batch failure', async () => {
    const { sourceDirectory, outputDirectory } = await createTempLayout();
    const { pngPath, webpPath } = await createFixtureImages(sourceDirectory);
    const fileSystem = createFileSystem({
      copyFile: vi.fn(async (sourcePath, destinationPath, mode) => {
        if (sourcePath === webpPath) {
          throw new Error('disk full');
        }

        return await fsPromises.copyFile(sourcePath, destinationPath, mode);
      }),
    });

    await expect(
      processListingImages(
        {
          listingId: 'Single-000012',
          inputImagePaths: [pngPath, webpPath],
          outputDirectory,
          processingMode: 'passthrough',
        },
        createProcessListingImagesDependencies({ fileSystem })
      )
    ).rejects.toThrow('disk full');

    await expect(fsPromises.access(path.join(outputDirectory, 'second-image.png'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect((await fsPromises.readdir(outputDirectory)).length).toBe(0);
  });
});
