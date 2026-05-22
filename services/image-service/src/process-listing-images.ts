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

export type ImageProcessingMode = 'passthrough' | 'strip_exif';

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
