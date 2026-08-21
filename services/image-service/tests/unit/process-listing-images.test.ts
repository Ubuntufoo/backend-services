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

async function createCropFixture(directory: string, filename: string, contrast: boolean) {
  const background = contrast ? { r: 245, g: 245, b: 245 } : { r: 150, g: 150, b: 150 };
  const item = contrast ? { r: 20, g: 30, b: 40 } : { r: 145, g: 145, b: 145 };
  const itemBuffer = await sharp({
    create: { width: 280, height: 220, channels: 3, background: item },
  })
    .png()
    .toBuffer();
  const sourcePath = path.join(directory, filename);
  await sharp({
    create: { width: 800, height: 600, channels: 3, background },
  })
    .composite([{ input: itemBuffer, left: 260, top: 190 }])
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toFile(sourcePath);
  return sourcePath;
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

  it('enhance_crop accepts a high-contrast item and emits oriented q95 jpeg output', async () => {
    const { sourceDirectory, outputDirectory } = await createTempLayout();
    const sourcePath = await createCropFixture(sourceDirectory, 'crop-accepted.jpg', true);
    const secondSourcePath = await createCropFixture(sourceDirectory, 'crop-accepted-2.jpg', true);
    const sourceBytes = await fsPromises.readFile(sourcePath);

    const result = await processListingImages({
      listingId: 'Single-000002A',
      inputImagePaths: [sourcePath, secondSourcePath],
      outputDirectory,
      processingMode: 'enhance_crop',
    });

    const outputPath = path.join(outputDirectory, 'crop-accepted.jpg');
    const outputMetadata = await sharp(outputPath).metadata();
    expect(outputMetadata.format).toBe('jpeg');
    expect(outputMetadata.chromaSubsampling).toBe('4:2:0');
    expect(outputMetadata.orientation).toBeUndefined();
    expect(outputMetadata.exif).toBeUndefined();
    expect(outputMetadata.width).toBeLessThan(600);
    expect(outputMetadata.height).toBeLessThan(800);
    expect((await fsPromises.readFile(sourcePath)).equals(sourceBytes)).toBe(true);

    const outputPixels = await sharp(outputPath).raw().toBuffer({ resolveWithObject: true });
    const cornerValues = [
      [0, 0],
      [outputPixels.info.width - 1, 0],
      [0, outputPixels.info.height - 1],
      [outputPixels.info.width - 1, outputPixels.info.height - 1],
    ].map(([x, y]) => {
      const offset = (y * outputPixels.info.width + x) * outputPixels.info.channels;
      return [outputPixels.data[offset] ?? 0, outputPixels.data[offset + 1] ?? 0, outputPixels.data[offset + 2] ?? 0];
    });
    expect(cornerValues.flat().every((value) => value > 180)).toBe(true);
    expect(result.images.map((image) => image.filename)).toEqual(['crop-accepted.jpg', 'crop-accepted-2.jpg']);
    expect(result.images[0].processingMode).toBe('enhance_crop');
    expect(result.images[0].filename).toBe('crop-accepted.jpg');
  });

  it('enhance_crop falls back to uncropped oriented output when detection is ambiguous', async () => {
    const { sourceDirectory, outputDirectory } = await createTempLayout();
    const sourcePath = await createCropFixture(sourceDirectory, 'crop-fallback.jpg', false);

    await processListingImages({
      listingId: 'Single-000002B',
      inputImagePaths: [sourcePath],
      outputDirectory,
      processingMode: 'enhance_crop',
    });

    const outputMetadata = await sharp(path.join(outputDirectory, 'crop-fallback.jpg')).metadata();
    expect(outputMetadata.format).toBe('jpeg');
    expect(outputMetadata.orientation).toBeUndefined();
    expect(outputMetadata.width).toBe(600);
    expect(outputMetadata.height).toBe(800);
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

  it('rejects non-JPEG enhance_crop inputs before writing output', async () => {
    const { sourceDirectory, outputDirectory } = await createTempLayout();
    const { pngPath } = await createFixtureImages(sourceDirectory);

    await expect(
      processListingImages({
        listingId: 'Single-000002C',
        inputImagePaths: [pngPath],
        outputDirectory,
        processingMode: 'enhance_crop',
      })
    ).rejects.toThrow(`enhance_crop requires JPEG input (.jpg or .jpeg): ${pngPath}.`);

    await expect(fsPromises.access(outputDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
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
