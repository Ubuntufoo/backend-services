import { randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import * as fs from 'node:fs/promises';
import { basename, dirname, normalize, resolve } from 'node:path';

import sharp from 'sharp';

import { selectCropConsensus } from './internal/crop-consensus.js';

import {
  isSupportedImageServiceExtension,
  isSupportedImageServicePath,
  normalizeImageServiceExtension,
  type ImageServiceSupportedExtension,
} from './image-extensions.js';

export type ImageProcessingMode = 'passthrough' | 'strip_exif' | 'enhance_crop';

export interface ProcessListingImagesInput {
  listingId: string;
  inputImagePaths: readonly string[];
  outputDirectory: string;
  processingMode: ImageProcessingMode;
}

export interface ProcessedListingImage {
  sourcePath: string;
  outputPath: string;
  filename: string;
  sizeBytes: number;
  processingMode: ImageProcessingMode;
}

export interface ProcessListingImagesResult {
  listingId: string;
  outputDirectory: string;
  processingMode: ImageProcessingMode;
  images: ProcessedListingImage[];
}

export interface ImageServiceFileSystem {
  access: typeof fs.access;
  copyFile: typeof fs.copyFile;
  lstat: typeof fs.lstat;
  mkdir: typeof fs.mkdir;
  realpath: typeof fs.realpath;
  rename: typeof fs.rename;
  stat: typeof fs.stat;
  unlink: typeof fs.unlink;
}

export interface ProcessListingImagesDependencies {
  fileSystem: ImageServiceFileSystem;
  stripExif(sourcePath: string, tempPath: string): Promise<void>;
}

interface PreparedListingImage {
  sourcePath: string;
  canonicalSourcePath: string;
  outputPath: string;
  filename: string;
  normalizedExtension: ImageServiceSupportedExtension;
}

interface AnalysisImage {
  data: Buffer;
  width: number;
  height: number;
  channels: number;
}

interface CropCandidate {
  left: number;
  top: number;
  right: number;
  bottom: number;
  contrast: number;
  support: number;
  symmetry: number;
  areaReduction: number;
}

interface CropDecision {
  candidate?: CropCandidate;
}

const CROP_ANALYSIS_WIDTHS = [320, 480] as const;
const CROP_PRIMARY_FACTORS = [0.8, 1, 1.2] as const;
const CROP_GRADIENT_FACTORS = [0.85, 1, 1.25] as const;
const CROP_MARGIN_RATIO = 0.03;
const CROP_MIN_MARGIN = 48;

function median(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(fraction * (sorted.length - 1))];
}

function pixelRgb(image: AnalysisImage, x: number, y: number): [number, number, number] {
  const index = (y * image.width + x) * image.channels;
  return [image.data[index] ?? 0, image.data[index + 1] ?? 0, image.data[index + 2] ?? 0];
}

function luma(rgb: readonly [number, number, number]): number {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function analysisLuma(image: AnalysisImage): Float64Array {
  const result = new Float64Array(image.width * image.height);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      result[y * image.width + x] = luma(pixelRgb(image, x, y));
    }
  }
  return result;
}

function edgeGradientThreshold(values: Float64Array, width: number, height: number): number {
  const gradients: number[] = [];
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      gradients.push(
        0.5 * Math.abs(values[y * width + x + 1] - values[y * width + x - 1]),
        0.5 * Math.abs(values[(y + 1) * width + x] - values[(y - 1) * width + x])
      );
    }
  }
  return Math.max(8, percentile(gradients, 0.75) * 1.05);
}

function gradientProfiles(
  values: Float64Array,
  width: number,
  height: number,
  axis: 'x' | 'y',
  thresholdFactor: number
): { positions: number[]; means: number[]; supports: number[] } {
  const gradients: number[] = [];
  const positions: number[] = [];
  const means: number[] = [];
  const supports: number[] = [];
  const extent = axis === 'x' ? width : height;
  const start = Math.max(2, Math.ceil(extent * 0.06));
  const end = Math.min(extent - 3, Math.floor(extent * 0.94));

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const gx = 0.5 * Math.abs(values[y * width + x + 1] - values[y * width + x - 1]);
      const gy = 0.5 * Math.abs(values[(y + 1) * width + x] - values[(y - 1) * width + x]);
      gradients.push(axis === 'x' ? gx : gy);
    }
  }

  const p75 = percentile(gradients, 0.75);
  const threshold = Math.max(8, p75 * thresholdFactor);
  for (let position = start; position <= end; position += 1) {
    const samples: number[] = [];
    if (axis === 'x') {
      for (let y = 1; y < height - 1; y += 1) {
        let sum = 0;
        for (let offset = -1; offset <= 1; offset += 1) {
          const x = clamp(position + offset, 1, width - 2);
          sum += 0.5 * Math.abs(values[y * width + x + 1] - values[y * width + x - 1]);
        }
        samples.push(sum / 3);
      }
    } else {
      for (let x = 1; x < width - 1; x += 1) {
        let sum = 0;
        for (let offset = -1; offset <= 1; offset += 1) {
          const y = clamp(position + offset, 1, height - 2);
          sum += 0.5 * Math.abs(values[(y + 1) * width + x] - values[(y - 1) * width + x]);
        }
        samples.push(sum / 3);
      }
    }
    const mean = samples.reduce((sum, value) => sum + value, 0) / Math.max(1, samples.length);
    const support = samples.filter((value) => value > threshold).length / Math.max(1, samples.length);
    positions.push(position);
    means.push(mean);
    supports.push(support);
  }

  return { positions, means, supports };
}

function gradientCandidate(image: AnalysisImage, factor: number): [number, number, number, number] | undefined {
  const values = analysisLuma(image);
  const vertical = gradientProfiles(values, image.width, image.height, 'x', factor);
  const horizontal = gradientProfiles(values, image.width, image.height, 'y', factor);
  const pairEdgeThreshold = edgeGradientThreshold(values, image.width, image.height);
  const peaks = (profile: { positions: number[]; means: number[]; supports: number[] }, dimension: number) => {
    const selected: Array<{ position: number; mean: number; support: number; score: number; index: number }> = [];
    for (let index = 3; index < profile.positions.length - 3; index += 1) {
      const score = profile.means[index] * (0.55 + profile.supports[index]);
      if (
        score >= profile.means[index - 1] * (0.55 + profile.supports[index - 1]) &&
        score >= profile.means[index + 1] * (0.55 + profile.supports[index + 1])
      ) {
        selected.push({
          position: profile.positions[index],
          mean: profile.means[index],
          support: profile.supports[index],
          score,
          index,
        });
      }
    }
    selected.sort((a, b) => b.score - a.score || a.index - b.index);
    const kept: typeof selected = [];
    const minimumDistance = Math.max(8, Math.round(dimension * 0.04));
    for (const peak of selected) {
      if (kept.every((existing) => Math.abs(existing.position - peak.position) >= minimumDistance)) {
        kept.push(peak);
      }
      if (kept.length === 8) break;
    }
    return kept;
  };
  const xPeaks = peaks({
    ...vertical,
    means: vertical.means.map((value) => value),
    supports: vertical.supports.map((value) => value),
  }, image.width);
  const yPeaks = peaks({
    ...horizontal,
    means: horizontal.means.map((value) => value),
    supports: horizontal.supports.map((value) => value),
  }, image.height);
  const pairs: Array<{ left: number; top: number; right: number; bottom: number; score: number; order: number }> = [];
  let pairOrder = 0;
  for (const left of xPeaks) {
    for (const right of xPeaks) {
      if (right.position <= left.position || right.position - left.position < image.width * 0.2) continue;
      if (left.position < image.width * 0.04 || right.position > image.width * 0.96) continue;
      for (const top of yPeaks) {
        for (const bottom of yPeaks) {
          if (bottom.position <= top.position || bottom.position - top.position < image.height * 0.2) continue;
          if (top.position < image.height * 0.04 || bottom.position > image.height * 0.96) continue;
          const pairMetrics = edgeMetrics(
            image,
            [left.position, top.position, right.position, bottom.position],
            values,
            pairEdgeThreshold
          );
          pairs.push({
            left: left.position,
            top: top.position,
            right: right.position,
            bottom: bottom.position,
            order: pairOrder++,
            score: Math.min(left.support, right.support, top.support, bottom.support) * 120 +
              (left.support + right.support + top.support + bottom.support) * 20 +
              pairMetrics.contrast * 0.8 +
              (left.mean + right.mean + top.mean + bottom.mean) * 0.08,
          });
        }
      }
    }
  }
  pairs.sort((a, b) => b.score - a.score || a.order - b.order);
  const result = pairs[0];
  return result ? [result.left, result.top, result.right, result.bottom] : undefined;
}

function primaryCandidate(image: AnalysisImage, thresholdFactor: number): [number, number, number, number] | undefined {
  const border = Math.max(3, Math.round(0.05 * Math.min(image.width, image.height)));
  const borderPixels: Array<[number, number, number]> = [];
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (x < border || x >= image.width - border || y < border || y >= image.height - border) {
        borderPixels.push(pixelRgb(image, x, y));
      }
    }
  }
  const background: [number, number, number] = [
    median(borderPixels.map((value) => value[0])),
    median(borderPixels.map((value) => value[1])),
    median(borderPixels.map((value) => value[2])),
  ];
  const distances = borderPixels.map((value) =>
    Math.hypot(value[0] - background[0], value[1] - background[1], value[2] - background[2])
  );
  const p90 = percentile(distances, 0.9);
  const threshold = Math.max(20, 1.15 * p90 * thresholdFactor + 10);
  const rowCounts = new Array<number>(image.height).fill(0);
  const columnCounts = new Array<number>(image.width).fill(0);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const rgb = pixelRgb(image, x, y);
      const distance = Math.hypot(rgb[0] - background[0], rgb[1] - background[1], rgb[2] - background[2]);
      if (distance >= threshold) {
        rowCounts[y] += 1;
        columnCounts[x] += 1;
      }
    }
  }
  const rows = rowCounts.map((count, index) => (count > 0.15 * image.width ? index : -1)).filter((index) => index >= 0);
  const columns = columnCounts.map((count, index) => (count > 0.15 * image.height ? index : -1)).filter((index) => index >= 0);
  if (rows.length === 0 || columns.length === 0) return undefined;
  return [columns[0], rows[0], columns[columns.length - 1] + 1, rows[rows.length - 1] + 1];
}

function edgeMetrics(
  image: AnalysisImage,
  candidate: [number, number, number, number],
  precomputedValues?: Float64Array,
  precomputedThreshold?: number
) {
  const values = precomputedValues ?? analysisLuma(image);
  const threshold = precomputedThreshold ?? edgeGradientThreshold(values, image.width, image.height);
  const [left, top, right, bottom] = candidate;
  const strengths: number[] = [];
  const supports: number[] = [];
  const contrasts: number[] = [];
  const sampleEdge = (axis: 'x' | 'y', position: number, start: number, end: number, direction: 1 | -1) => {
    const insideValues: number[] = [];
    const outsideValues: number[] = [];
    const edgeSamples: number[] = [];
    for (let offset = Math.ceil((end - start) * 0.12); offset <= Math.floor((end - start) * 0.88); offset += 2) {
      const along = start + offset;
      const coordinate = clamp(position - (direction === -1 ? 1 : 0), 1, (axis === 'x' ? image.width : image.height) - 2);
      let gradient = 0;
      for (let normalOffset = -1; normalOffset <= 1; normalOffset += 1) {
        const normalCoordinate = clamp(
          coordinate + normalOffset,
          1,
          (axis === 'x' ? image.width : image.height) - 2
        );
        gradient += axis === 'x'
          ? 0.5 * Math.abs(values[along * image.width + normalCoordinate + 1] - values[along * image.width + normalCoordinate - 1])
          : 0.5 * Math.abs(values[(normalCoordinate + 1) * image.width + along] - values[(normalCoordinate - 1) * image.width + along]);
      }
      edgeSamples.push(gradient / 3);
      const insideStart = clamp(position + direction * 5, 0, (axis === 'x' ? image.width : image.height) - 1);
      const insideEnd = clamp(position + direction * 10, 0, (axis === 'x' ? image.width : image.height) - 1);
      const outsideStart = clamp(position - direction * 5, 0, (axis === 'x' ? image.width : image.height) - 1);
      const outsideEnd = clamp(position - direction * 10, 0, (axis === 'x' ? image.width : image.height) - 1);
      for (let strip = Math.min(insideStart, insideEnd); strip <= Math.max(insideStart, insideEnd); strip += 4) {
        if (axis === 'x') insideValues.push(values[along * image.width + strip]);
        else insideValues.push(values[strip * image.width + along]);
      }
      for (let strip = Math.min(outsideStart, outsideEnd); strip <= Math.max(outsideStart, outsideEnd); strip += 4) {
        if (axis === 'x') outsideValues.push(values[along * image.width + strip]);
        else outsideValues.push(values[strip * image.width + along]);
      }
    }
    strengths.push(edgeSamples.reduce((sum, value) => sum + value, 0) / Math.max(1, edgeSamples.length));
    supports.push(edgeSamples.filter((value) => value > threshold).length / Math.max(1, edgeSamples.length));
    contrasts.push(Math.abs(median(insideValues) - median(outsideValues)));
  };
  sampleEdge('x', left, top, bottom, 1);
  sampleEdge('x', right, top, bottom, -1);
  sampleEdge('y', top, left, right, 1);
  sampleEdge('y', bottom, left, right, -1);
  return {
    contrast: Math.min(...contrasts),
    support: Math.min(...supports),
    symmetry: (Math.min(strengths[0], strengths[1]) / Math.max(strengths[0], strengths[1], 0.01)) *
      (Math.min(strengths[2], strengths[3]) / Math.max(strengths[2], strengths[3], 0.01)),
  };
}

function decideCrop(
  images: readonly AnalysisImage[],
  sourceWidth: number,
  sourceHeight: number
): CropDecision {
  const candidates: Array<{ candidate: CropCandidate; imageIndex: number }> = [];
  for (let imageIndex = 0; imageIndex < images.length; imageIndex += 1) {
    const image = images[imageIndex];
    const primaryFactor = CROP_PRIMARY_FACTORS[imageIndex % CROP_PRIMARY_FACTORS.length];
    const gradientFactor = CROP_GRADIENT_FACTORS[imageIndex % CROP_GRADIENT_FACTORS.length];
    const box = primaryCandidate(image, primaryFactor) ?? gradientCandidate(image, gradientFactor);
    if (!box) return {};
    const metrics = edgeMetrics(image, box);
    const [left, top, right, bottom] = box;
    const normalized: [number, number, number, number] = [left / image.width, top / image.height, right / image.width, bottom / image.height];
    const marginX = Math.max(CROP_MARGIN_RATIO * sourceWidth, CROP_MIN_MARGIN);
    const marginY = Math.max(CROP_MARGIN_RATIO * sourceHeight, CROP_MIN_MARGIN);
    const available = normalized[0] * sourceWidth > 1.1 * marginX &&
      (1 - normalized[2]) * sourceWidth > 1.1 * marginX &&
      normalized[1] * sourceHeight > 1.1 * marginY &&
      (1 - normalized[3]) * sourceHeight > 1.1 * marginY;
    const cropWidth = clamp(normalized[2] * sourceWidth + marginX, 0, sourceWidth) - clamp(normalized[0] * sourceWidth - marginX, 0, sourceWidth);
    const cropHeight = clamp(normalized[3] * sourceHeight + marginY, 0, sourceHeight) - clamp(normalized[1] * sourceHeight - marginY, 0, sourceHeight);
    const areaReduction = 1 - (cropWidth * cropHeight) / (sourceWidth * sourceHeight);
    if (!available || metrics.contrast < 10 || metrics.support < 0.28 || metrics.symmetry < 0.3 ||
      right - left < image.width * 0.2 || bottom - top < image.height * 0.2 || areaReduction < 0.08 || areaReduction > 0.82) {
      return {};
    }
    candidates.push({ candidate: { left: normalized[0], top: normalized[1], right: normalized[2], bottom: normalized[3], ...metrics, areaReduction }, imageIndex });
  }
  const selected = selectCropConsensus(candidates.map(({ candidate }) => candidate));
  if (!selected) return {};
  return { candidate: selected };
}

async function enhanceAndCropImage(sourcePath: string, tempPath: string): Promise<void> {
  const oriented = sharp(sourcePath).rotate();
  const orientedRaw = await oriented.clone().removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const sourceWidth = orientedRaw.info.width;
  const sourceHeight = orientedRaw.info.height;
  const analysisImages: AnalysisImage[] = [];

  for (const analysisWidth of CROP_ANALYSIS_WIDTHS) {
    // Reuse identical oriented pixels for each threshold-factor decision.
    for (let factorIndex = 0; factorIndex < CROP_PRIMARY_FACTORS.length; factorIndex += 1) {
      const analysis = await oriented
        .clone()
        .resize({ width: analysisWidth, fit: 'inside' })
        .blur(0.8)
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      analysisImages.push({
        data: analysis.data,
        width: analysis.info.width,
        height: analysis.info.height,
        channels: analysis.info.channels,
      });
    }
  }

  const decision = decideCrop(analysisImages, sourceWidth, sourceHeight);
  const output = decision.candidate
    ? oriented.extract({
        left: Math.max(0, Math.floor(decision.candidate.left * sourceWidth - Math.max(CROP_MARGIN_RATIO * sourceWidth, CROP_MIN_MARGIN))),
        top: Math.max(0, Math.floor(decision.candidate.top * sourceHeight - Math.max(CROP_MARGIN_RATIO * sourceHeight, CROP_MIN_MARGIN))),
        width: Math.min(sourceWidth, Math.ceil(decision.candidate.right * sourceWidth + Math.max(CROP_MARGIN_RATIO * sourceWidth, CROP_MIN_MARGIN))) -
          Math.max(0, Math.floor(decision.candidate.left * sourceWidth - Math.max(CROP_MARGIN_RATIO * sourceWidth, CROP_MIN_MARGIN))),
        height: Math.min(sourceHeight, Math.ceil(decision.candidate.bottom * sourceHeight + Math.max(CROP_MARGIN_RATIO * sourceHeight, CROP_MIN_MARGIN))) -
          Math.max(0, Math.floor(decision.candidate.top * sourceHeight - Math.max(CROP_MARGIN_RATIO * sourceHeight, CROP_MIN_MARGIN))),
      })
    : oriented;

  await output.jpeg({ quality: 95, chromaSubsampling: '4:2:0' }).toFile(tempPath);
}

const DEFAULT_IMAGE_SERVICE_FILE_SYSTEM: ImageServiceFileSystem = {
  access: fs.access.bind(fs),
  copyFile: fs.copyFile.bind(fs),
  lstat: fs.lstat.bind(fs),
  mkdir: fs.mkdir.bind(fs),
  realpath: fs.realpath.bind(fs),
  rename: fs.rename.bind(fs),
  stat: fs.stat.bind(fs),
  unlink: fs.unlink.bind(fs),
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolveImageServicePath(pathValue: string): string {
  return normalize(resolve(pathValue));
}

function createListingImageError(listingId: string, message: string): Error {
  return new Error(`Image processing failed for ${listingId}: ${message}`);
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT'
  );
}

async function assertPathDoesNotExist(
  pathValue: string,
  listingId: string,
  context: string,
  fileSystem: Pick<ImageServiceFileSystem, 'lstat'>
): Promise<void> {
  try {
    await fileSystem.lstat(pathValue);
  } catch (error) {
    if (isMissingPathError(error)) {
      return;
    }

    throw createListingImageError(
      listingId,
      `${context} check failed for ${pathValue}: ${getErrorMessage(error)}`
    );
  }

  throw createListingImageError(listingId, `${context}: ${pathValue}`);
}

async function assertReadableFile(
  sourcePath: string,
  listingId: string,
  fileSystem: Pick<ImageServiceFileSystem, 'access' | 'lstat'>
): Promise<void> {
  try {
    await fileSystem.access(sourcePath, fsConstants.R_OK);
  } catch (error) {
    throw createListingImageError(
      listingId,
      `Source image is missing or unreadable: ${sourcePath}. ${getErrorMessage(error)}`
    );
  }

  let stats;

  try {
    stats = await fileSystem.lstat(sourcePath);
  } catch (error) {
    throw createListingImageError(
      listingId,
      `Source image metadata could not be read: ${sourcePath}. ${getErrorMessage(error)}`
    );
  }

  if (!stats.isFile()) {
    throw createListingImageError(listingId, `Source image is not a file: ${sourcePath}.`);
  }
}

async function ensureOutputDirectory(
  outputDirectory: string,
  listingId: string,
  fileSystem: Pick<ImageServiceFileSystem, 'mkdir' | 'lstat'>
): Promise<void> {
  try {
    await fileSystem.mkdir(outputDirectory, { recursive: true });
  } catch (error) {
    throw createListingImageError(
      listingId,
      `Output directory could not be created: ${outputDirectory}. ${getErrorMessage(error)}`
    );
  }

  let stats;

  try {
    stats = await fileSystem.lstat(outputDirectory);
  } catch (error) {
    throw createListingImageError(
      listingId,
      `Output directory could not be inspected: ${outputDirectory}. ${getErrorMessage(error)}`
    );
  }

  if (!stats.isDirectory()) {
    throw createListingImageError(listingId, `Output path is not a directory: ${outputDirectory}.`);
  }
}

async function resolveCanonicalExistingPath(
  pathValue: string,
  listingId: string,
  context: string,
  fileSystem: Pick<ImageServiceFileSystem, 'realpath'>
): Promise<string> {
  try {
    return await fileSystem.realpath(pathValue);
  } catch (error) {
    throw createListingImageError(
      listingId,
      `${context} could not be canonicalized: ${pathValue}. ${getErrorMessage(error)}`
    );
  }
}

function createTempOutputPath(outputDirectory: string, filename: string, extension: string): string {
  return resolve(outputDirectory, `.${filename}.${randomUUID()}${extension}`);
}

async function cleanupFilePaths(
  filePaths: readonly string[],
  fileSystem: Pick<ImageServiceFileSystem, 'unlink'>
): Promise<void> {
  for (const filePath of [...filePaths].reverse()) {
    try {
      await fileSystem.unlink(filePath);
    } catch (error) {
      if (!isMissingPathError(error)) {
        // Best effort cleanup only.
      }
    }
  }
}

function prepareListingImages(
  input: ProcessListingImagesInput,
  fileSystem: Pick<ImageServiceFileSystem, 'access' | 'lstat' | 'mkdir' | 'realpath'>
): Promise<{ outputDirectory: string; preparedImages: PreparedListingImage[] }> {
  return (async () => {
    const listingId = input.listingId.trim();

    if (listingId.length === 0) {
      throw createListingImageError(input.listingId, 'listingId must be non-empty.');
    }

    if (input.inputImagePaths.length === 0) {
      throw createListingImageError(listingId, 'inputImagePaths must include at least one image.');
    }

    const outputDirectory = resolveImageServicePath(input.outputDirectory);
    const seenSourcePaths = new Set<string>();
    const seenCanonicalSourcePaths = new Set<string>();
    const seenOutputPaths = new Set<string>();
    const preparedImages: PreparedListingImage[] = [];

    for (const inputImagePath of input.inputImagePaths) {
      const sourcePath = resolveImageServicePath(inputImagePath);
      const normalizedExtension = normalizeImageServiceExtension(sourcePath);

      if (!isSupportedImageServicePath(sourcePath) || !isSupportedImageServiceExtension(normalizedExtension)) {
        throw createListingImageError(
          listingId,
          `Unsupported image extension for ${sourcePath}. Supported: .jpg, .jpeg, .png, .webp.`
        );
      }

      if (
        input.processingMode === 'enhance_crop' &&
        normalizedExtension !== '.jpg' &&
        normalizedExtension !== '.jpeg'
      ) {
        throw createListingImageError(
          listingId,
          `enhance_crop requires JPEG input (.jpg or .jpeg): ${sourcePath}.`
        );
      }

      if (seenSourcePaths.has(sourcePath)) {
        throw createListingImageError(listingId, `Duplicate source image path: ${sourcePath}.`);
      }

      seenSourcePaths.add(sourcePath);

      await assertReadableFile(sourcePath, listingId, fileSystem);

      const canonicalSourcePath = await resolveCanonicalExistingPath(
        sourcePath,
        listingId,
        'Source image path',
        fileSystem
      );

      if (seenCanonicalSourcePaths.has(canonicalSourcePath)) {
        throw createListingImageError(
          listingId,
          `Duplicate source image path after canonicalization: ${canonicalSourcePath}.`
        );
      }

      seenCanonicalSourcePaths.add(canonicalSourcePath);

      const filename = basename(sourcePath);
      const outputPath = resolve(outputDirectory, filename);

      if (seenOutputPaths.has(outputPath)) {
        throw createListingImageError(
          listingId,
          `Duplicate destination filename after preserving watcher names: ${filename}.`
        );
      }

      seenOutputPaths.add(outputPath);

      preparedImages.push({
        sourcePath,
        canonicalSourcePath,
        outputPath,
        filename,
        normalizedExtension,
      });
    }

    await ensureOutputDirectory(outputDirectory, listingId, fileSystem);

    const canonicalOutputDirectory = await resolveCanonicalExistingPath(
      outputDirectory,
      listingId,
      'Output directory',
      fileSystem
    );

    for (const image of preparedImages) {
      if (dirname(image.canonicalSourcePath) === canonicalOutputDirectory) {
        throw createListingImageError(
          listingId,
          `Output directory must differ from source parent directory: ${outputDirectory}.`
        );
      }
    }

    for (const image of preparedImages) {
      await assertPathDoesNotExist(
        image.outputPath,
        listingId,
        'Output image already exists and cannot be overwritten',
        fileSystem
      );
    }

    return {
      outputDirectory,
      preparedImages,
    };
  })();
}

export function createProcessListingImagesDependencies(
  overrides: Partial<ProcessListingImagesDependencies> = {}
): ProcessListingImagesDependencies {
  return {
    fileSystem: DEFAULT_IMAGE_SERVICE_FILE_SYSTEM,
    stripExif: async (sourcePath, tempPath) => {
      await sharp(sourcePath).rotate().toFile(tempPath);
    },
    ...overrides,
  };
}

export async function processListingImages(
  input: ProcessListingImagesInput,
  dependencies: ProcessListingImagesDependencies = createProcessListingImagesDependencies()
): Promise<ProcessListingImagesResult> {
  const listingId = input.listingId.trim();
  const { fileSystem } = dependencies;
  const { outputDirectory, preparedImages } = await prepareListingImages(input, fileSystem);
  const writtenOutputPaths: string[] = [];
  const tempOutputPaths: string[] = [];
  const images: ProcessedListingImage[] = [];

  try {
    for (const image of preparedImages) {
      const tempOutputPath = createTempOutputPath(
        outputDirectory,
        image.filename,
        image.normalizedExtension
      );

      tempOutputPaths.push(tempOutputPath);

      if (input.processingMode === 'passthrough') {
        try {
          await fileSystem.copyFile(image.sourcePath, tempOutputPath, fsConstants.COPYFILE_EXCL);
        } catch (error) {
          throw createListingImageError(
            listingId,
            `Passthrough copy failed for ${image.sourcePath} -> ${tempOutputPath}. ${getErrorMessage(
              error
            )}`
          );
        }
      } else if (input.processingMode === 'enhance_crop') {
        try {
          await enhanceAndCropImage(image.sourcePath, tempOutputPath);
        } catch (error) {
          throw createListingImageError(
            listingId,
            `Enhance-and-crop processing failed for ${image.sourcePath} -> ${tempOutputPath}. ${getErrorMessage(
              error
            )}`
          );
        }
      } else {
        try {
          await dependencies.stripExif(image.sourcePath, tempOutputPath);
        } catch (error) {
          throw createListingImageError(
            listingId,
            `EXIF stripping failed for ${image.sourcePath} -> ${tempOutputPath}. ${getErrorMessage(
              error
            )}`
          );
        }
      }

      try {
        await fileSystem.rename(tempOutputPath, image.outputPath);
      } catch (error) {
        throw createListingImageError(
          listingId,
          `Atomic rename failed for ${tempOutputPath} -> ${image.outputPath}. ${getErrorMessage(error)}`
        );
      }

      tempOutputPaths.pop();
      writtenOutputPaths.push(image.outputPath);

      let stats;

      try {
        stats = await fileSystem.stat(image.outputPath);
      } catch (error) {
        throw createListingImageError(
          listingId,
          `Processed image stat failed for ${image.outputPath}. ${getErrorMessage(error)}`
        );
      }

      images.push({
        sourcePath: image.sourcePath,
        outputPath: image.outputPath,
        filename: image.filename,
        sizeBytes: stats.size,
        processingMode: input.processingMode,
      });
    }
  } catch (error) {
    await cleanupFilePaths(writtenOutputPaths, fileSystem);
    await cleanupFilePaths(tempOutputPaths, fileSystem);
    throw error;
  }

  return {
    listingId,
    outputDirectory,
    processingMode: input.processingMode,
    images,
  };
}
