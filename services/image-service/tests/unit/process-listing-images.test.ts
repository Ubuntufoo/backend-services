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

interface CropFixtureOptions {
  width?: number;
  height?: number;
  itemWidth?: number;
  itemHeight?: number;
  itemLeft?: number;
  itemTop?: number;
  background?: { r: number; g: number; b: number };
  item?: { r: number; g: number; b: number };
  orientation?: number;
  backgroundImperfections?: 'none' | 'patches';
  nestedBoundaries?: boolean;
  marginMarkers?: boolean;
}

async function createCropFixture(directory: string, filename: string, options: CropFixtureOptions = {}) {
  const width = options.width ?? 800;
  const height = options.height ?? 600;
  const background = options.background ?? { r: 245, g: 245, b: 245 };
  const item = options.item ?? { r: 20, g: 30, b: 40 };
  const itemWidth = options.itemWidth ?? 280;
  const itemHeight = options.itemHeight ?? 220;
  const itemLeft = options.itemLeft ?? Math.round((width - itemWidth) / 2);
  const itemTop = options.itemTop ?? Math.round((height - itemHeight) / 2);
  const itemBuffer = await sharp({
    create: { width: itemWidth, height: itemHeight, channels: 3, background: item },
  })
    .png()
    .toBuffer();
  const composites: sharp.OverlayOptions[] = [{ input: itemBuffer, left: itemLeft, top: itemTop }];
  if (options.backgroundImperfections === 'patches') {
    const patch = await sharp({
      create: { width: Math.max(24, Math.round(width * 0.2)), height, channels: 3, background: { r: 0, g: 0, b: 0 } },
    }).png().toBuffer();
    composites.push({ input: patch, left: 0, top: 0 });
  }
  if (options.nestedBoundaries) {
    const nested = await sharp({
      create: { width: Math.max(12, Math.round(itemWidth * 0.76)), height: Math.max(12, Math.round(itemHeight * 0.76)), channels: 3, background: { r: 70, g: 80, b: 90 } },
    }).png().toBuffer();
    composites.push({ input: nested, left: itemLeft + Math.round(itemWidth * 0.12), top: itemTop + Math.round(itemHeight * 0.12) });
    const decoy = await sharp({
      create: { width: Math.max(32, Math.round(itemWidth * 0.6)), height: Math.max(32, Math.round(itemHeight * 0.6)), channels: 3, background: { r: 60, g: 70, b: 80 } },
    }).png().toBuffer();
    composites.push({ input: decoy, left: Math.round(width * 0.08), top: Math.round(height * 0.08) });
  }
  if (options.marginMarkers) {
    // Orientation 6 maps these source-space patches into the four expected
    // corners of the natural-margin crop. Their distinct colors make a
    // fabricated border distinguishable from source-derived pixels.
    const markerSize = 16;
    const markers: Array<{ left: number; top: number; background: { r: number; g: number; b: number } }> = [
      { left: 212 - markerSize / 2, top: 457 - markerSize / 2, background: { r: 205, g: 245, b: 245 } },
      { left: 212 - markerSize / 2, top: 141 - markerSize / 2, background: { r: 245, g: 205, b: 245 } },
      { left: 588 - markerSize / 2, top: 457 - markerSize / 2, background: { r: 245, g: 245, b: 205 } },
      { left: 588 - markerSize / 2, top: 141 - markerSize / 2, background: { r: 205, g: 205, b: 245 } },
    ];
    for (const marker of markers) {
      const markerBuffer = await sharp({
        create: { width: markerSize, height: markerSize, channels: 3, background: marker.background },
      }).png().toBuffer();
      composites.push({ input: markerBuffer, left: marker.left, top: marker.top });
    }
  }
  const sourcePath = path.join(directory, filename);
  await sharp({
    create: { width, height, channels: 3, background },
  })
    .composite(composites)
    .jpeg()
    .withMetadata({ orientation: options.orientation ?? 6 })
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

function findDarkBounds(image: { data: Buffer; info: { width: number; height: number; channels: number } }) {
  let left = image.info.width;
  let top = image.info.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < image.info.height; y += 1) {
    for (let x = 0; x < image.info.width; x += 1) {
      const offset = (y * image.info.width + x) * image.info.channels;
      if ((image.data[offset] ?? 255) < 100 && (image.data[offset + 1] ?? 255) < 110 && (image.data[offset + 2] ?? 255) < 120) {
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
  }
  return { left, top, right, bottom };
}

function readJpegQuantizationTables(bytes: Buffer): number[][] {
  const tables: number[][] = [];
  let offset = 2; // SOI
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset] ?? 0;
    offset += 1;
    if (marker === 0xda) break; // SOS: compressed scan follows
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > bytes.length) break;
    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
    if (marker === 0xdb) {
      let tableOffset = offset + 2;
      const segmentEnd = offset + segmentLength;
      while (tableOffset < segmentEnd) {
        const precisionAndId = bytes[tableOffset] ?? 0;
        tableOffset += 1;
        const precisionBytes = precisionAndId >> 4 === 1 ? 2 : 1;
        const table: number[] = [];
        for (let index = 0; index < 64 && tableOffset + precisionBytes <= segmentEnd; index += 1) {
          table.push(precisionBytes === 2 ? bytes.readUInt16BE(tableOffset) : (bytes[tableOffset] ?? 0));
          tableOffset += precisionBytes;
        }
        if (table.length === 64) tables.push(table);
      }
    }
    offset += segmentLength;
  }
  return tables;
}

function colorDistance(left: readonly number[], right: readonly number[]): number {
  return Math.hypot(left[0]! - right[0]!, left[1]! - right[1]!, left[2]! - right[2]!);
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
    const sourcePath = await createCropFixture(sourceDirectory, 'crop-accepted.jpg');
    const secondSourcePath = await createCropFixture(sourceDirectory, 'crop-accepted-2.jpg');
    const sourceBytes = await fsPromises.readFile(sourcePath);

    const result = await processListingImages({
      listingId: 'Single-000002A',
      inputImagePaths: [sourcePath, secondSourcePath],
      outputDirectory,
      processingMode: 'enhance_crop',
    });

    const outputPath = path.join(outputDirectory, 'crop-accepted.jpg');
    const outputMetadata = await sharp(outputPath).metadata();
    const outputBytes = await fsPromises.readFile(outputPath);
    expect(outputMetadata.format).toBe('jpeg');
    expect(outputMetadata.chromaSubsampling).toBe('4:2:0');
    expect(outputMetadata.orientation).toBeUndefined();
    expect(outputMetadata.exif).toBeUndefined();
    expect(outputMetadata.width).toBeLessThanOrEqual(600);
    expect(outputMetadata.height).toBeLessThan(800);
    expect((await fsPromises.readFile(sourcePath)).equals(sourceBytes)).toBe(true);

    const q95Reference = await sharp({
      create: { width: 16, height: 16, channels: 3, background: { r: 32, g: 48, b: 64 } },
    })
      .jpeg({ quality: 95, chromaSubsampling: '4:2:0' })
      .toBuffer();
    const q94Reference = await sharp({
      create: { width: 16, height: 16, channels: 3, background: { r: 32, g: 48, b: 64 } },
    })
      .jpeg({ quality: 94, chromaSubsampling: '4:2:0' })
      .toBuffer();
    expect(readJpegQuantizationTables(outputBytes)).toEqual(readJpegQuantizationTables(q95Reference));
    expect(readJpegQuantizationTables(outputBytes)).not.toEqual(readJpegQuantizationTables(q94Reference));

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
    expect(cornerValues.flat().every((value) => value >= 235 && value <= 250)).toBe(true);
    const itemBounds = findDarkBounds(outputPixels);
    expect(itemBounds.left).toBeGreaterThanOrEqual(44);
    expect(itemBounds.top).toBeGreaterThanOrEqual(44);
    expect(outputPixels.info.width - 1 - itemBounds.right).toBeGreaterThanOrEqual(44);
    expect(outputPixels.info.height - 1 - itemBounds.bottom).toBeGreaterThanOrEqual(44);
    // Orientation 6 turns the 280x220 source item into a 220x280 output
    // rectangle. Keep every edge within a small JPEG/threshold tolerance.
    expect(itemBounds.right - itemBounds.left + 1).toBeGreaterThanOrEqual(214);
    expect(itemBounds.bottom - itemBounds.top + 1).toBeGreaterThanOrEqual(274);
    expect(result.images.map((image) => image.filename)).toEqual(['crop-accepted.jpg', 'crop-accepted-2.jpg']);
    expect(result.images[0].processingMode).toBe('enhance_crop');
    expect(result.images[0].filename).toBe('crop-accepted.jpg');
  });

  it('enhance_crop allows a geometrically plausible low-contrast candidate', async () => {
    const { sourceDirectory, outputDirectory } = await createTempLayout();
    const sourcePath = await createCropFixture(sourceDirectory, 'crop-fallback.jpg', {
      background: { r: 150, g: 150, b: 150 },
      item: { r: 145, g: 145, b: 145 },
    });

    await processListingImages({
      listingId: 'Single-000002B',
      inputImagePaths: [sourcePath],
      outputDirectory,
      processingMode: 'enhance_crop',
    });

    const outputMetadata = await sharp(path.join(outputDirectory, 'crop-fallback.jpg')).metadata();
    expect(outputMetadata.format).toBe('jpeg');
    expect(outputMetadata.orientation).toBeUndefined();
    expect(outputMetadata.width).toBeLessThan(600);
    expect(outputMetadata.height).toBeLessThan(800);
    const reduction = 1 - ((outputMetadata.width ?? 0) * (outputMetadata.height ?? 0)) / (600 * 800);
    expect(reduction).toBeGreaterThan(0);
  });

  it('falls back to the full oriented frame when no candidate exists', async () => {
    const { sourceDirectory, outputDirectory } = await createTempLayout();
    const sourcePath = path.join(sourceDirectory, 'no-candidate.jpg');
    await sharp({
      create: { width: 600, height: 800, channels: 3, background: { r: 150, g: 150, b: 150 } },
    })
      .jpeg()
      .withMetadata({ orientation: 1 })
      .toFile(sourcePath);

    await processListingImages({
      listingId: 'Single-000002J',
      inputImagePaths: [sourcePath],
      outputDirectory,
      processingMode: 'enhance_crop',
    });

    const outputMetadata = await sharp(path.join(outputDirectory, 'no-candidate.jpg')).metadata();
    expect(outputMetadata.width).toBe(600);
    expect(outputMetadata.height).toBe(800);
  });

  it('enhance_crop accepts a conservative thin-pack crop', async () => {
    const { sourceDirectory, outputDirectory } = await createTempLayout();
    const sourcePath = await createCropFixture(sourceDirectory, 'thin-pack.jpg', {
      itemWidth: 420,
      itemHeight: 150,
    });

    await processListingImages({
      listingId: 'Single-000002D',
      inputImagePaths: [sourcePath],
      outputDirectory,
      processingMode: 'enhance_crop',
    });

    const outputMetadata = await sharp(path.join(outputDirectory, 'thin-pack.jpg')).metadata();
    expect(outputMetadata.width).toBeGreaterThan(150);
    expect(outputMetadata.width).toBeLessThan(600);
    expect(outputMetadata.height).toBeGreaterThan(420);
    expect(outputMetadata.height).toBeLessThan(800);
    expect(outputMetadata.chromaSubsampling).toBe('4:2:0');
  });

  it('rotates a landscape detected card to portrait output without rotating the source frame', async () => {
    const { sourceDirectory, outputDirectory } = await createTempLayout();
    const sourcePath = await createCropFixture(sourceDirectory, 'sideways-card.jpg', {
      width: 600,
      height: 800,
      itemWidth: 420,
      itemHeight: 180,
      orientation: 1,
    });

    await processListingImages({
      listingId: 'Single-000002H',
      inputImagePaths: [sourcePath],
      outputDirectory,
      processingMode: 'enhance_crop',
    });

    const outputMetadata = await sharp(path.join(outputDirectory, 'sideways-card.jpg')).metadata();
    expect(outputMetadata.width).toBeLessThan(400);
    expect(outputMetadata.height).toBeLessThan(800);
    expect(outputMetadata.height).toBeGreaterThan(outputMetadata.width ?? 0);
  });

  it('leaves an already portrait detected card unrotated', async () => {
    const { sourceDirectory, outputDirectory } = await createTempLayout();
    const sourcePath = await createCropFixture(sourceDirectory, 'portrait-card.jpg', {
      width: 600,
      height: 800,
      itemWidth: 180,
      itemHeight: 420,
      orientation: 1,
    });

    await processListingImages({
      listingId: 'Single-000002I',
      inputImagePaths: [sourcePath],
      outputDirectory,
      processingMode: 'enhance_crop',
    });

    const outputMetadata = await sharp(path.join(outputDirectory, 'portrait-card.jpg')).metadata();
    expect(outputMetadata.width).toBeLessThan(600);
    expect(outputMetadata.height).toBeLessThan(800);
    expect(outputMetadata.height).toBeGreaterThan(outputMetadata.width ?? 0);
  });

  it('keeps near-square detected cards portrait when margin expansion flips crop aspect', async () => {
    const { sourceDirectory, outputDirectory } = await createTempLayout();
    const sourcePath = await createCropFixture(sourceDirectory, 'near-square-card.jpg', {
      width: 1500,
      height: 2000,
      itemWidth: 600,
      itemHeight: 590,
      orientation: 1,
    });

    await processListingImages({
      listingId: 'Single-000002K',
      inputImagePaths: [sourcePath],
      outputDirectory,
      processingMode: 'enhance_crop',
    });

    const outputMetadata = await sharp(path.join(outputDirectory, 'near-square-card.jpg')).metadata();
    expect(outputMetadata.width).toBeLessThan(1500);
    expect(outputMetadata.height).toBeLessThan(2000);
    expect(outputMetadata.height).toBeGreaterThan(outputMetadata.width ?? 0);
  });

  it('accepts a valid crop reduction below the former 8 percent floor', async () => {
    const { sourceDirectory, outputDirectory } = await createTempLayout();
    const sourcePath = await createCropFixture(sourceDirectory, 'small-reduction.jpg', {
      itemWidth: 680,
      itemHeight: 500,
      itemLeft: 60,
      itemTop: 50,
    });

    await processListingImages({
      listingId: 'Single-000002L',
      inputImagePaths: [sourcePath],
      outputDirectory,
      processingMode: 'enhance_crop',
    });

    const outputMetadata = await sharp(path.join(outputDirectory, 'small-reduction.jpg')).metadata();
    const reduction = 1 - ((outputMetadata.width ?? 0) * (outputMetadata.height ?? 0)) / (600 * 800);
    expect(reduction).toBeGreaterThan(0);
    expect(reduction).toBeLessThan(0.08);
  });

  it('clamps margin at edge contact while retaining the complete detected item', async () => {
    const { sourceDirectory, outputDirectory } = await createTempLayout();
    const sourcePath = await createCropFixture(sourceDirectory, 'edge-contact-clamped.jpg', { itemLeft: 0 });

    await processListingImages({
      listingId: 'Single-000002M',
      inputImagePaths: [sourcePath],
      outputDirectory,
      processingMode: 'enhance_crop',
    });

    const outputPath = path.join(outputDirectory, 'edge-contact-clamped.jpg');
    const outputPixels = await sharp(outputPath).raw().toBuffer({ resolveWithObject: true });
    const outputMetadata = await sharp(outputPath).metadata();
    const bounds = findDarkBounds(outputPixels);
    expect(outputMetadata.width).toBeLessThan(600);
    expect(outputMetadata.height).toBeLessThan(800);
    expect(bounds.right - bounds.left + 1).toBeGreaterThanOrEqual(200);
    expect(bounds.bottom - bounds.top + 1).toBeGreaterThanOrEqual(200);
    expect([bounds.left, bounds.top, outputPixels.info.width - 1 - bounds.right, outputPixels.info.height - 1 - bounds.bottom])
      .toContain(0);
  });

  it.each([
    ['background imperfections', { backgroundImperfections: 'patches' as const }],
    ['edge contact', { itemLeft: 0 }],
    ['tight framing', { itemWidth: 680, itemHeight: 500, itemLeft: 60, itemTop: 50 }],
    ['conflicting nested boundaries', { nestedBoundaries: true }],
  ])('enhance_crop remains crop-first for disagreeing detector inputs: %s', async (_caseName, options) => {
    const { sourceDirectory, outputDirectory } = await createTempLayout();
    const sourcePath = await createCropFixture(sourceDirectory, `fallback-${_caseName.replaceAll(' ', '-')}.jpg`, options);

    await processListingImages({
      listingId: 'Single-000002E',
      inputImagePaths: [sourcePath],
      outputDirectory,
      processingMode: 'enhance_crop',
    });

    const outputMetadata = await sharp(path.join(outputDirectory, path.basename(sourcePath))).metadata();
    expect(outputMetadata.width).toBeLessThanOrEqual(600);
    expect(outputMetadata.height).toBeLessThan(800);
  });

  it('uses a plausible candidate without all-scale consensus or metric vetoes', async () => {
    const { sourceDirectory, outputDirectory } = await createTempLayout();
    const sourcePath = await createCropFixture(sourceDirectory, 'crop-first.jpg', {
      itemWidth: 300,
      itemHeight: 220,
      background: { r: 220, g: 220, b: 220 },
      item: { r: 205, g: 205, b: 205 },
    });

    await processListingImages({
      listingId: 'Single-000002G',
      inputImagePaths: [sourcePath],
      outputDirectory,
      processingMode: 'enhance_crop',
    });

    const outputMetadata = await sharp(path.join(outputDirectory, 'crop-first.jpg')).metadata();
    expect(outputMetadata.width).toBeLessThan(600);
    expect(outputMetadata.height).toBeLessThan(800);
  });

  it('retains source-derived margin signatures at all accepted-crop corners', async () => {
    const { sourceDirectory, outputDirectory } = await createTempLayout();
    const sourcePath = await createCropFixture(sourceDirectory, 'crop-margin-markers.jpg', { marginMarkers: true });

    await processListingImages({
      listingId: 'Single-000002F',
      inputImagePaths: [sourcePath],
      outputDirectory,
      processingMode: 'enhance_crop',
    });

    const outputPixels = await sharp(path.join(outputDirectory, 'crop-margin-markers.jpg')).raw().toBuffer({ resolveWithObject: true });
    const corners = [
      [0, 0],
      [outputPixels.info.width - 1, 0],
      [0, outputPixels.info.height - 1],
      [outputPixels.info.width - 1, outputPixels.info.height - 1],
    ].map(([x, y]) => {
      const offset = (y * outputPixels.info.width + x) * outputPixels.info.channels;
      return [outputPixels.data[offset] ?? 0, outputPixels.data[offset + 1] ?? 0, outputPixels.data[offset + 2] ?? 0];
    });
    const sourceMarkerColors = [
      [205, 245, 245],
      [245, 205, 245],
      [245, 245, 205],
      [205, 205, 245],
    ];
    corners.forEach((corner, index) => {
      expect(colorDistance(corner, sourceMarkerColors[index]!)).toBeLessThan(100);
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
