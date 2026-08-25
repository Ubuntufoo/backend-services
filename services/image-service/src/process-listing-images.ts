import { randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import * as fs from 'node:fs/promises';
import { basename, dirname, normalize, resolve } from 'node:path';

import sharp from 'sharp';

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
  primary: boolean;
}

interface CropDecision {
  candidate?: CropCandidate;
}

interface DeskewLine {
  slope: number;
  position: number;
  support: number;
  residual: number;
  residualRatio: number;
}

interface DeskewEstimate {
  /** Physical card angle in image coordinates; positive slopes down to the right. */
  angleDegrees: number;
  confidence: number;
}

const CROP_ANALYSIS_WIDTHS = [320, 480] as const;
const CROP_PRIMARY_FACTORS = [0.8, 1, 1.2] as const;
const CROP_GRADIENT_FACTORS = [0.85, 1, 1.25] as const;
const CROP_MARGIN_RATIO = 0.03;
const CROP_MIN_MARGIN = 48;
// Deliberately loose sanity bounds. Operator review is the final quality gate;
// only empty/tiny or destructive detector output is rejected automatically.
const CROP_MIN_DIMENSION_RATIO = 0.08;
const CROP_MIN_AREA_RATIO = 0.08;
const DESKEW_ANALYSIS_WIDTH = 960;
const DESKEW_MAX_ANGLE_DEGREES = 8;
const DESKEW_MIN_ANGLE_DEGREES = 0.2;
const DESKEW_MAX_LINE_DISAGREEMENT_DEGREES = 2;
const POST_DESKEW_BACKGROUND_DISTANCE = 42;
const POST_DESKEW_FOREGROUND_FRACTION = 0.55;
const POST_DESKEW_TRANSITION_RUN = 3;
const POST_DESKEW_SAMPLE_TRIM_RATIO = 0.12;

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
  const start = Math.max(2, Math.ceil(extent * 0.02));
  const end = Math.min(extent - 3, Math.floor(extent * 0.98));

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
      if (right.position <= left.position || right.position - left.position < image.width * CROP_MIN_DIMENSION_RATIO) continue;
      if (left.position < image.width * 0.01 || right.position > image.width * 0.99) continue;
      for (const top of yPeaks) {
        for (const bottom of yPeaks) {
          if (bottom.position <= top.position || bottom.position - top.position < image.height * CROP_MIN_DIMENSION_RATIO) continue;
          if (top.position < image.height * 0.01 || bottom.position > image.height * 0.99) continue;
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
  const calibratedThreshold = estimateBackgroundDistanceThreshold(
    image,
    { r: background[0], g: background[1], b: background[2] },
    20
  );
  const threshold = Math.max(20, 1.15 * p90 * thresholdFactor + 10, calibratedThreshold);
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
  const rows = rowCounts.map((count, index) => (count > 0.05 * image.width ? index : -1)).filter((index) => index >= 0);
  const columns = columnCounts.map((count, index) => (count > 0.05 * image.height ? index : -1)).filter((index) => index >= 0);
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

function fitDeskewLine(points: readonly { along: number; position: number; weight: number }[], extent: number): DeskewLine | undefined {
  if (points.length < 12) return undefined;

  const totalWeight = points.reduce((sum, point) => sum + point.weight, 0);
  if (totalWeight <= 0) return undefined;
  const meanAlong = points.reduce((sum, point) => sum + point.along * point.weight, 0) / totalWeight;
  const meanPosition = points.reduce((sum, point) => sum + point.position * point.weight, 0) / totalWeight;
  const denominator = points.reduce((sum, point) => sum + (point.along - meanAlong) ** 2 * point.weight, 0);
  if (denominator <= 0) return undefined;

  const slope = points.reduce(
    (sum, point) => sum + (point.along - meanAlong) * (point.position - meanPosition) * point.weight,
    0
  ) / denominator;
  const residual = Math.sqrt(
    points.reduce((sum, point) => sum + (point.position - (meanPosition + slope * (point.along - meanAlong))) ** 2, 0) /
      points.length
  );
  return {
    slope,
    position: meanPosition,
    support: Math.min(1, points.length / Math.max(24, Math.min(240, Math.floor(extent / 2)))),
    residual,
    residualRatio: residual / Math.max(1, extent),
  };
}

function deskewBackgroundEdgeLine(
  image: AnalysisImage,
  candidate: CropCandidate,
  edge: 'top' | 'bottom' | 'left' | 'right',
  background: RgbColor,
  backgroundDistanceThreshold: number
): DeskewLine | undefined {
  const horizontal = edge === 'top' || edge === 'bottom';
  const alongStart = horizontal ? candidate.left * image.width : candidate.top * image.height;
  const alongEnd = horizontal ? candidate.right * image.width : candidate.bottom * image.height;
  const alongExtent = Math.max(1, alongEnd - alongStart);
  const normalExtent = horizontal ? image.height : image.width;
  const alongPadding = Math.max(4, Math.round(alongExtent * 0.1));
  const firstAlong = Math.ceil(alongStart + alongPadding);
  const lastAlong = Math.floor(alongEnd - alongPadding);
  const alongStep = Math.max(1, Math.round(alongExtent / 180));
  // The rough crop candidate can follow an inner printed border or a backdrop
  // shadow. Search from the actual image boundary so it cannot hide the true
  // outer card edge from deskew estimation.
  const firstPosition = 1;
  const lastPosition = normalExtent - 2;
  const forward = edge === 'left' || edge === 'top';
  const points: Array<{ along: number; position: number; weight: number }> = [];

  for (let along = firstAlong; along <= lastAlong; along += alongStep) {
    let runStart: number | undefined;
    let runLength = 0;
    let runWeight = 0;
    for (
      let position = forward ? firstPosition : lastPosition;
      forward ? position <= lastPosition : position >= firstPosition;
      position += forward ? 1 : -1
    ) {
      const x = horizontal ? clamp(Math.round(along), 1, image.width - 2) : position;
      const y = horizontal ? position : clamp(Math.round(along), 1, image.height - 2);
      const distance = backgroundColorDistance(pixelRgb(image, x, y), background);
      if (distance >= backgroundDistanceThreshold) {
        if (runLength === 0) {
          runStart = position;
          runWeight = 0;
        }
        runLength += 1;
        runWeight += distance;
        if (runLength >= POST_DESKEW_TRANSITION_RUN && runStart !== undefined) {
          points.push({
            along,
            position: runStart,
            weight: Math.max(1, runWeight / runLength),
          });
          break;
        }
      } else {
        runStart = undefined;
        runLength = 0;
        runWeight = 0;
      }
    }
  }

  return fitDeskewLine(points, alongExtent);
}

function estimateDeskew(
  image: AnalysisImage,
  candidate: CropCandidate,
  background: RgbColor,
  backgroundDistanceThreshold: number
): DeskewEstimate | undefined {
  const edges = ['top', 'bottom', 'left', 'right'] as const;
  const reliable = edges.flatMap((edge) => {
    const line = deskewBackgroundEdgeLine(
      image,
      candidate,
      edge,
      background,
      backgroundDistanceThreshold
    );
    if (!line || line.residualRatio > 0.02) return [];
    const angleDegrees = edge === 'top' || edge === 'bottom'
      ? Math.atan(line.slope) * 180 / Math.PI
      : -Math.atan(line.slope) * 180 / Math.PI;
    return [{ edge, line, angleDegrees }];
  });
  if (reliable.length < 2) return undefined;

  // Use the largest mutually consistent cluster of physical-edge angles.
  // This avoids the previous top/bottom-first behavior, where one accidental
  // near-horizontal pair could suppress stronger skew evidence elsewhere.
  const sorted = [...reliable].sort((a, b) => a.angleDegrees - b.angleDegrees);
  let selected: typeof reliable = [];
  for (let start = 0; start < sorted.length; start += 1) {
    const cluster = [sorted[start]];
    for (let index = start + 1; index < sorted.length; index += 1) {
      if (sorted[index].angleDegrees - cluster[0].angleDegrees > DESKEW_MAX_LINE_DISAGREEMENT_DEGREES) break;
      cluster.push(sorted[index]);
    }
    if (cluster.length > selected.length) {
      selected = cluster;
    } else if (cluster.length === selected.length && cluster.length > 0) {
      const clusterResidual = Math.max(...cluster.map((entry) => entry.line.residualRatio));
      const selectedResidual = Math.max(...selected.map((entry) => entry.line.residualRatio));
      if (clusterResidual < selectedResidual) selected = cluster;
    }
  }
  if (selected.length < 2) return undefined;

  const angles = selected.map((entry) => entry.angleDegrees);
  const angleDegrees = median(angles);
  const disagreement = Math.max(...angles) - Math.min(...angles);
  const quality = Math.min(...selected.map((entry) => entry.line.support)) *
    Math.min(1, 0.02 / Math.max(0.001, Math.max(...selected.map((entry) => entry.line.residualRatio))));
  if (!Number.isFinite(angleDegrees) || Math.abs(angleDegrees) > DESKEW_MAX_ANGLE_DEGREES ||
    Math.abs(angleDegrees) < DESKEW_MIN_ANGLE_DEGREES ||
    disagreement > DESKEW_MAX_LINE_DISAGREEMENT_DEGREES || quality < 0.25) {
    return undefined;
  }
  return { angleDegrees, confidence: quality };
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
    const primaryBox = primaryCandidate(image, primaryFactor);
    const isPlausibleBox = (value: [number, number, number, number] | undefined) => value !== undefined &&
      value.every(Number.isFinite) && value[0] >= 0 && value[1] >= 0 && value[2] <= image.width && value[3] <= image.height &&
      value[2] > value[0] && value[3] > value[1] && value[2] - value[0] >= image.width * CROP_MIN_DIMENSION_RATIO &&
      value[3] - value[1] >= image.height * CROP_MIN_DIMENSION_RATIO;
    const usesPrimary = isPlausibleBox(primaryBox);
    const box = usesPrimary ? primaryBox : gradientCandidate(image, gradientFactor);
    if (!box) continue;
    const metrics = edgeMetrics(image, box);
    const [left, top, right, bottom] = box;
    const normalized: [number, number, number, number] = [left / image.width, top / image.height, right / image.width, bottom / image.height];
    const marginX = Math.max(CROP_MARGIN_RATIO * sourceWidth, CROP_MIN_MARGIN);
    const marginY = Math.max(CROP_MARGIN_RATIO * sourceHeight, CROP_MIN_MARGIN);
    const cropWidth = clamp(normalized[2] * sourceWidth + marginX, 0, sourceWidth) - clamp(normalized[0] * sourceWidth - marginX, 0, sourceWidth);
    const cropHeight = clamp(normalized[3] * sourceHeight + marginY, 0, sourceHeight) - clamp(normalized[1] * sourceHeight - marginY, 0, sourceHeight);
    const areaReduction = 1 - (cropWidth * cropHeight) / (sourceWidth * sourceHeight);
    const widthRatio = normalized[2] - normalized[0];
    const heightRatio = normalized[3] - normalized[1];
    const finiteAndContained = [normalized[0], normalized[1], normalized[2], normalized[3]].every(Number.isFinite) &&
      normalized[0] >= 0 && normalized[1] >= 0 && normalized[2] <= 1 && normalized[3] <= 1 &&
      normalized[2] > normalized[0] && normalized[3] > normalized[1];
    if (!finiteAndContained || widthRatio < CROP_MIN_DIMENSION_RATIO || heightRatio < CROP_MIN_DIMENSION_RATIO ||
      (widthRatio * heightRatio) < CROP_MIN_AREA_RATIO || cropWidth <= 0 || cropHeight <= 0) {
      continue;
    }
    candidates.push({ candidate: {
      left: normalized[0], top: normalized[1], right: normalized[2], bottom: normalized[3],
      ...metrics, areaReduction, primary: usesPrimary,
    }, imageIndex });
  }
  if (candidates.length === 0) return {};
  // Stable quality ordering: primary detector wins ties, then stronger geometry
  // signals, then the first analysis image. Metrics rank candidates but never
  // veto otherwise-sane geometry.
  candidates.sort((left, right) => {
    const a = left.candidate;
    const b = right.candidate;
    const detectedAreaA = (a.right - a.left) * (a.bottom - a.top);
    const detectedAreaB = (b.right - b.left) * (b.bottom - b.top);
    const scoreA = (a.primary ? 1_000 : 0) + detectedAreaA * 100 + a.support * 10 + a.symmetry * 2 + a.contrast * 0.01;
    const scoreB = (b.primary ? 1_000 : 0) + detectedAreaB * 100 + b.support * 10 + b.symmetry * 2 + b.contrast * 0.01;
    return scoreB - scoreA || left.imageIndex - right.imageIndex;
  });
  return { candidate: candidates[0]?.candidate };
}

function cropBounds(candidate: CropCandidate, sourceWidth: number, sourceHeight: number) {
  const marginX = Math.max(CROP_MARGIN_RATIO * sourceWidth, CROP_MIN_MARGIN);
  const marginY = Math.max(CROP_MARGIN_RATIO * sourceHeight, CROP_MIN_MARGIN);
  const left = Math.max(0, Math.floor(candidate.left * sourceWidth - marginX));
  const top = Math.max(0, Math.floor(candidate.top * sourceHeight - marginY));
  const right = Math.min(sourceWidth, Math.ceil(candidate.right * sourceWidth + marginX));
  const bottom = Math.min(sourceHeight, Math.ceil(candidate.bottom * sourceHeight + marginY));
  return { left, top, width: right - left, height: bottom - top };
}

type SharpPipeline = ReturnType<typeof sharp>;
type RgbColor = { r: number; g: number; b: number };

async function createAnalysisImage(
  image: SharpPipeline,
  width: number,
  flattenBackground?: RgbColor
): Promise<AnalysisImage> {
  let pipeline = image.clone();
  if (flattenBackground) pipeline = pipeline.flatten({ background: flattenBackground });
  const analysis = await pipeline
    .resize({ width, fit: 'inside' })
    .blur(0.8)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    data: analysis.data,
    width: analysis.info.width,
    height: analysis.info.height,
    channels: analysis.info.channels,
  };
}

async function createAnalysisImages(image: SharpPipeline, flattenBackground?: RgbColor): Promise<AnalysisImage[]> {
  const analysisImages: AnalysisImage[] = [];
  for (const analysisWidth of CROP_ANALYSIS_WIDTHS) {
    // Reuse identical oriented pixels for each threshold-factor decision.
    for (let factorIndex = 0; factorIndex < CROP_PRIMARY_FACTORS.length; factorIndex += 1) {
      analysisImages.push(await createAnalysisImage(image, analysisWidth, flattenBackground));
    }
  }
  return analysisImages;
}

function estimateBorderBackground(image: AnalysisImage): RgbColor {
  const border = Math.max(2, Math.round(Math.min(image.width, image.height) * 0.05));
  const red: number[] = [];
  const green: number[] = [];
  const blue: number[] = [];
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (x < border || x >= image.width - border || y < border || y >= image.height - border) {
        const rgb = pixelRgb(image, x, y);
        red.push(rgb[0]);
        green.push(rgb[1]);
        blue.push(rgb[2]);
      }
    }
  }
  return { r: Math.round(median(red)), g: Math.round(median(green)), b: Math.round(median(blue)) };
}

function estimateBackgroundDistanceThreshold(
  image: AnalysisImage,
  background: RgbColor,
  minimum = POST_DESKEW_BACKGROUND_DISTANCE
): number {
  const cornerSize = Math.max(2, Math.round(Math.min(image.width, image.height) * 0.08));
  const cornerStarts = [
    [0, 0],
    [image.width - cornerSize, 0],
    [0, image.height - cornerSize],
    [image.width - cornerSize, image.height - cornerSize],
  ] as const;
  const cornerDistances = cornerStarts.map(([startX, startY]) => {
    const distances: number[] = [];
    for (let y = startY; y < startY + cornerSize; y += 1) {
      for (let x = startX; x < startX + cornerSize; x += 1) {
        distances.push(backgroundColorDistance(pixelRgb(image, x, y), background));
      }
    }
    return distances;
  });

  // Exclude the noisiest corner so a card touching one corner cannot inflate
  // the threshold. The remaining three corners capture real backdrop texture
  // and illumination changes that the fixed minimum alone cannot distinguish.
  cornerDistances.sort((left, right) => percentile(left, 0.9) - percentile(right, 0.9));
  const representativeDistances = cornerDistances.slice(0, 3).flat();
  return Math.max(minimum, percentile(representativeDistances, 0.99) + 8);
}

interface CropBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

function detectedCardBounds(candidate: CropCandidate, sourceWidth: number, sourceHeight: number): CropBounds {
  const left = clamp(Math.floor(candidate.left * sourceWidth), 0, sourceWidth - 1);
  const top = clamp(Math.floor(candidate.top * sourceHeight), 0, sourceHeight - 1);
  const right = clamp(Math.ceil(candidate.right * sourceWidth) - 1, left, sourceWidth - 1);
  const bottom = clamp(Math.ceil(candidate.bottom * sourceHeight) - 1, top, sourceHeight - 1);
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

function cropBoundsFromCardBounds(cardBounds: CropBounds, sourceWidth: number, sourceHeight: number): CropBounds {
  const marginX = Math.max(CROP_MARGIN_RATIO * sourceWidth, CROP_MIN_MARGIN);
  const marginY = Math.max(CROP_MARGIN_RATIO * sourceHeight, CROP_MIN_MARGIN);
  const cardRight = cardBounds.left + cardBounds.width - 1;
  const cardBottom = cardBounds.top + cardBounds.height - 1;
  const left = Math.max(0, Math.floor(cardBounds.left - marginX));
  const top = Math.max(0, Math.floor(cardBounds.top - marginY));
  const right = Math.min(sourceWidth - 1, Math.ceil(cardRight + marginX));
  const bottom = Math.min(sourceHeight - 1, Math.ceil(cardBottom + marginY));
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

function backgroundColorDistance(rgb: readonly [number, number, number], background: RgbColor): number {
  return Math.hypot(rgb[0] - background.r, rgb[1] - background.g, rgb[2] - background.b);
}

function findPostDeskewBackgroundTransition(
  image: AnalysisImage,
  candidate: CropCandidate,
  edge: 'top' | 'bottom' | 'left' | 'right',
  background: RgbColor,
  backgroundDistanceThreshold: number
): number | undefined {
  const verticalEdge = edge === 'left' || edge === 'right';
  const normalExtent = verticalEdge ? image.width : image.height;
  const alongStart = verticalEdge ? candidate.top * image.height : candidate.left * image.width;
  const alongEnd = verticalEdge ? candidate.bottom * image.height : candidate.right * image.width;
  // Scan the full normal axis from the actual image boundary inward. The
  // rough detector is only used to define the along-edge sampling span; it
  // must not limit how far inward the true physical edge can be found.
  const firstPosition = 1;
  const lastPosition = normalExtent - 2;
  const alongExtent = Math.max(1, alongEnd - alongStart);
  const alongPadding = Math.max(4, Math.round(alongExtent * POST_DESKEW_SAMPLE_TRIM_RATIO));
  const firstAlong = Math.ceil(alongStart + alongPadding);
  const lastAlong = Math.floor(alongEnd - alongPadding);
  const alongStep = Math.max(1, Math.round(alongExtent / 180));
  if (lastAlong <= firstAlong) return undefined;

  const foregroundFractionAt = (position: number): number => {
    let foreground = 0;
    let samples = 0;
    for (let along = firstAlong; along <= lastAlong; along += alongStep) {
      const x = verticalEdge ? position : clamp(Math.round(along), 1, image.width - 2);
      const y = verticalEdge ? clamp(Math.round(along), 1, image.height - 2) : position;
      if (backgroundColorDistance(pixelRgb(image, x, y), background) >= backgroundDistanceThreshold) {
        foreground += 1;
      }
      samples += 1;
    }
    return samples > 0 ? foreground / samples : 0;
  };

  const forward = edge === 'left' || edge === 'top';
  let runStart: number | undefined;
  let runLength = 0;
  for (
    let position = forward ? firstPosition : lastPosition;
    forward ? position <= lastPosition : position >= firstPosition;
    position += forward ? 1 : -1
  ) {
    if (foregroundFractionAt(position) >= POST_DESKEW_FOREGROUND_FRACTION) {
      if (runLength === 0) runStart = position;
      runLength += 1;
      if (runLength >= POST_DESKEW_TRANSITION_RUN) return runStart;
    } else {
      runStart = undefined;
      runLength = 0;
    }
  }
  return undefined;
}

function refinePostDeskewCardBounds(
  image: AnalysisImage,
  candidate: CropCandidate,
  sourceWidth: number,
  sourceHeight: number,
  background: RgbColor,
  backgroundDistanceThreshold: number
): CropBounds {
  const rough = detectedCardBounds(candidate, sourceWidth, sourceHeight);
  const roughRight = rough.left + rough.width - 1;
  const roughBottom = rough.top + rough.height - 1;
  let left = rough.left;
  let right = roughRight;
  let top = rough.top;
  let bottom = roughBottom;

  // After deskew, refine the physical rectangle from the known backdrop inward.
  // This deliberately does not choose the strongest nearby gradient: shadows
  // and internal card artwork can be stronger than the true outer card edge.
  const transitions = {
    left: findPostDeskewBackgroundTransition(
      image,
      candidate,
      'left',
      background,
      backgroundDistanceThreshold
    ),
    right: findPostDeskewBackgroundTransition(
      image,
      candidate,
      'right',
      background,
      backgroundDistanceThreshold
    ),
    top: findPostDeskewBackgroundTransition(
      image,
      candidate,
      'top',
      background,
      backgroundDistanceThreshold
    ),
    bottom: findPostDeskewBackgroundTransition(
      image,
      candidate,
      'bottom',
      background,
      backgroundDistanceThreshold
    ),
  };

  const candidateLeft = transitions.left === undefined
    ? rough.left
    : Math.round((transitions.left / image.width) * sourceWidth);
  const candidateRight = transitions.right === undefined
    ? roughRight
    : Math.round((transitions.right / image.width) * sourceWidth);
  const candidateWidth = candidateRight - candidateLeft + 1;
  if (
    candidateRight > candidateLeft &&
    candidateWidth >= rough.width * 0.85 &&
    candidateWidth <= rough.width * 1.15
  ) {
    left = clamp(candidateLeft, 0, sourceWidth - 1);
    right = clamp(candidateRight, left, sourceWidth - 1);
  }

  const candidateTop = transitions.top === undefined
    ? rough.top
    : Math.round((transitions.top / image.height) * sourceHeight);
  const candidateBottom = transitions.bottom === undefined
    ? roughBottom
    : Math.round((transitions.bottom / image.height) * sourceHeight);
  const candidateHeight = candidateBottom - candidateTop + 1;
  if (
    candidateBottom > candidateTop &&
    candidateHeight >= rough.height * 0.85 &&
    candidateHeight <= rough.height * 1.15
  ) {
    top = clamp(candidateTop, 0, sourceHeight - 1);
    bottom = clamp(candidateBottom, top, sourceHeight - 1);
  }

  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

/**
 * Sharp's arbitrary-angle rotate expands the canvas and fills the corners.
 * Keep the final rectangle inside the fully opaque source polygon without
 * independently shaving one side. Opposing natural margins remain paired:
 * left/right use one shared margin and top/bottom use one shared margin.
 * If even the detected-card rectangle itself is not source-safe, fall back.
 */
async function sourceSafeCropBounds(
  image: SharpPipeline,
  bounds: CropBounds,
  cardBounds: CropBounds
): Promise<CropBounds | undefined> {
  const alpha = await image.clone().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const imageRight = alpha.info.width - 1;
  const imageBottom = alpha.info.height - 1;
  const alphaAt = (x: number, y: number): number => alpha.data[(y * alpha.info.width + x) * alpha.info.channels + 3] ?? 0;

  const cardLeft = clamp(cardBounds.left, 0, imageRight);
  const cardTop = clamp(cardBounds.top, 0, imageBottom);
  const cardRight = clamp(cardBounds.left + cardBounds.width - 1, cardLeft, imageRight);
  const cardBottom = clamp(cardBounds.top + cardBounds.height - 1, cardTop, imageBottom);
  if (cardRight <= cardLeft || cardBottom <= cardTop) return undefined;

  const requestedLeft = clamp(bounds.left, 0, cardLeft);
  const requestedTop = clamp(bounds.top, 0, cardTop);
  const requestedRight = clamp(bounds.left + bounds.width - 1, cardRight, imageRight);
  const requestedBottom = clamp(bounds.top + bounds.height - 1, cardBottom, imageBottom);
  const maxMarginX = Math.max(0, Math.min(cardLeft - requestedLeft, requestedRight - cardRight));
  const maxMarginY = Math.max(0, Math.min(cardTop - requestedTop, requestedBottom - cardBottom));

  let best: CropBounds | undefined;
  let bestArea = -1;
  for (let marginX = maxMarginX; marginX >= 0; marginX -= 1) {
    const left = cardLeft - marginX;
    const cropRight = cardRight + marginX;
    for (let marginY = maxMarginY; marginY >= 0; marginY -= 1) {
      const top = cardTop - marginY;
      const cropBottom = cardBottom + marginY;
      const area = (cropRight - left + 1) * (cropBottom - top + 1);
      if (area <= bestArea) continue;
      const corners = [
        alphaAt(left, top),
        alphaAt(cropRight, top),
        alphaAt(left, cropBottom),
        alphaAt(cropRight, cropBottom),
      ];
      if (corners.every((value) => value >= 255)) {
        best = { left, top, width: cropRight - left + 1, height: cropBottom - top + 1 };
        bestArea = area;
      }
    }
  }
  return best;
}

async function enhanceAndCropImage(sourcePath: string, tempPath: string): Promise<void> {
  const oriented = sharp(sourcePath).rotate();
  const orientedRaw = await oriented.clone().removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const sourceWidth = orientedRaw.info.width;
  const sourceHeight = orientedRaw.info.height;

  const orientedAnalysis = await createAnalysisImages(oriented);
  const preDeskewDecision = decideCrop(orientedAnalysis, sourceWidth, sourceHeight);
  let processingImage = oriented;
  let processingWidth = sourceWidth;
  let processingHeight = sourceHeight;
  let fillSafeCrop = false;
  let analysisBackground: RgbColor | undefined;
  let analysisBackgroundDistanceThreshold = POST_DESKEW_BACKGROUND_DISTANCE;
  if (preDeskewDecision.candidate) {
    const deskewAnalysis = await createAnalysisImage(oriented, DESKEW_ANALYSIS_WIDTH);
    analysisBackground = estimateBorderBackground(deskewAnalysis);
    analysisBackgroundDistanceThreshold = estimateBackgroundDistanceThreshold(
      deskewAnalysis,
      analysisBackground
    );
    const deskewEstimate = estimateDeskew(
      deskewAnalysis,
      preDeskewDecision.candidate,
      analysisBackground,
      analysisBackgroundDistanceThreshold
    );
    if (deskewEstimate) {
      const deskewed = oriented.clone().rotate(-deskewEstimate.angleDegrees, {
        background: { r: 255, g: 255, b: 255, alpha: 0 },
      });
      const deskewedRaw = await deskewed.clone().removeAlpha().raw().toBuffer({ resolveWithObject: true });
      processingImage = deskewed;
      processingWidth = deskewedRaw.info.width;
      processingHeight = deskewedRaw.info.height;
      fillSafeCrop = true;
    }
  }

  const analysisImages = processingImage === oriented
    ? orientedAnalysis
    : await createAnalysisImages(processingImage, analysisBackground);
  const decision = decideCrop(analysisImages, processingWidth, processingHeight);
  let output = oriented;
  let hasCrop = false;
  if (decision.candidate) {
    let cardBounds = detectedCardBounds(decision.candidate, processingWidth, processingHeight);
    let bounds = cropBounds(decision.candidate, processingWidth, processingHeight);
    if (fillSafeCrop) {
      const refinementAnalysis = await createAnalysisImage(
        processingImage,
        DESKEW_ANALYSIS_WIDTH,
        analysisBackground
      );
      const refinementBackground = analysisBackground ?? estimateBorderBackground(refinementAnalysis);
      const refinementBackgroundDistanceThreshold = Math.max(
        analysisBackgroundDistanceThreshold,
        estimateBackgroundDistanceThreshold(refinementAnalysis, refinementBackground)
      );
      cardBounds = refinePostDeskewCardBounds(
        refinementAnalysis,
        decision.candidate,
        processingWidth,
        processingHeight,
        refinementBackground,
        refinementBackgroundDistanceThreshold
      );
      bounds = cropBoundsFromCardBounds(cardBounds, processingWidth, processingHeight);
      const safeBounds = await sourceSafeCropBounds(
        processingImage,
        bounds,
        cardBounds
      );
      if (!safeBounds) {
        // If rotation produced no safe crop, preserve the original oriented
        // source rather than returning a frame containing synthetic pixels.
        output = oriented;
      } else {
        bounds = safeBounds;
        output = processingImage.extract(bounds).removeAlpha();
        hasCrop = true;
      }
    } else {
      output = processingImage.extract(bounds).removeAlpha();
      hasCrop = true;
    }
    // Captures are portrait-frame after EXIF orientation. Normalize only a
    // detected sideways card; never rotate a no-candidate full-frame fallback.
    const detectedLandscape = (decision.candidate.right - decision.candidate.left) * processingWidth >
      (decision.candidate.bottom - decision.candidate.top) * processingHeight;
    if (hasCrop && detectedLandscape && bounds.width > bounds.height) output = output.rotate(90);
  }

  await output.removeAlpha().jpeg({ quality: 95, chromaSubsampling: '4:2:0' }).toFile(tempPath);
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
