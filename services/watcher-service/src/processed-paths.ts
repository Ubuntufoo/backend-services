import { basename } from 'node:path';

import type { WatcherImageDescriptor } from './image-grouping.js';
import { normalizeWatcherImageExtension } from './config/image-extensions.js';
import { resolveWatcherChildPath } from './config/paths.js';

export const PROCESSED_IMAGE_SEQUENCE_WIDTH = 2;

export interface ProcessedImageMoveInput {
  listingId: string;
  images: readonly WatcherImageDescriptor[];
  processedDirectory: string;
}

export interface ProcessedImageMovePlanRecord {
  sourcePath: string;
  processedPath: string;
  fileName: string;
  order: number;
  extension: string;
}

export function buildProcessedListingDirectory(
  processedDirectory: string,
  listingId: string
): string {
  return resolveWatcherChildPath(processedDirectory, listingId);
}

export function formatProcessedImageFilename(
  listingId: string,
  order: number,
  sourcePath: string
): string {
  if (!Number.isInteger(order) || order < 1) {
    throw new Error(`Processed image order must be a positive integer. Received: ${order}.`);
  }

  const extension = normalizeWatcherImageExtension(sourcePath);

  if (extension.length === 0) {
    throw new Error(`Processed image source path is missing an extension: ${sourcePath}.`);
  }

  return `${listingId}_${String(order).padStart(PROCESSED_IMAGE_SEQUENCE_WIDTH, '0')}${extension}`;
}

export function buildProcessedImageMovePlan(
  input: ProcessedImageMoveInput
): ProcessedImageMovePlanRecord[] {
  if (input.images.length === 0) {
    throw new Error(`Processed image move requires at least one source image for ${input.listingId}.`);
  }

  const processedListingDirectory = buildProcessedListingDirectory(
    input.processedDirectory,
    input.listingId
  );
  const seenSourcePaths = new Set<string>();
  const seenProcessedPaths = new Set<string>();

  return input.images.map((image, index) => {
    if (seenSourcePaths.has(image.path)) {
      throw new Error(`Duplicate source image path in processed move plan: ${image.path}.`);
    }

    seenSourcePaths.add(image.path);

    const order = index + 1;
    const fileName = formatProcessedImageFilename(input.listingId, order, image.path);
    const processedPath = resolveWatcherChildPath(processedListingDirectory, fileName);

    if (seenProcessedPaths.has(processedPath)) {
      throw new Error(
        `Duplicate processed destination path in move plan: ${processedPath} (${basename(image.path)}).`
      );
    }

    seenProcessedPaths.add(processedPath);

    return {
      sourcePath: image.path,
      processedPath,
      fileName,
      order,
      extension: normalizeWatcherImageExtension(image.path),
    };
  });
}
