import * as fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';

import {
  buildProcessedImageMovePlan,
  buildProcessedListingDirectory,
  type ProcessedImageMoveInput,
  type ProcessedImageMovePlanRecord,
} from './processed-paths.js';

export interface ProcessedImageMoveRecord extends ProcessedImageMovePlanRecord {}

export interface ProcessedImageMoveResult {
  listingId: string;
  processedDirectory: string;
  images: ProcessedImageMoveRecord[];
}

export interface ProcessedImageMoveFileSystem {
  copyFile: typeof fs.copyFile;
  lstat: typeof fs.lstat;
  mkdir: typeof fs.mkdir;
  readdir: typeof fs.readdir;
  rename: typeof fs.rename;
  rmdir: typeof fs.rmdir;
  unlink: typeof fs.unlink;
}

const DEFAULT_PROCESSED_IMAGE_MOVE_FILE_SYSTEM: ProcessedImageMoveFileSystem = {
  copyFile: fs.copyFile.bind(fs),
  lstat: fs.lstat.bind(fs),
  mkdir: fs.mkdir.bind(fs),
  readdir: fs.readdir.bind(fs),
  rename: fs.rename.bind(fs),
  rmdir: fs.rmdir.bind(fs),
  unlink: fs.unlink.bind(fs),
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT'
  );
}

function isCrossDeviceError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'EXDEV'
  );
}

async function assertPathDoesNotExist(
  pathValue: string,
  context: string,
  fileSystem: Pick<ProcessedImageMoveFileSystem, 'lstat'>
): Promise<void> {
  try {
    await fileSystem.lstat(pathValue);
  } catch (error) {
    if (isMissingPathError(error)) {
      return;
    }

    throw error;
  }

  throw new Error(`${context}: ${pathValue}.`);
}

async function moveFile(
  sourcePath: string,
  destinationPath: string,
  fileSystem: ProcessedImageMoveFileSystem
): Promise<void> {
  await assertPathDoesNotExist(
    destinationPath,
    'Processed image destination already exists and cannot be overwritten',
    fileSystem
  );

  try {
    await fileSystem.rename(sourcePath, destinationPath);
    return;
  } catch (error) {
    if (!isCrossDeviceError(error)) {
      throw error;
    }
  }

  try {
    await fileSystem.copyFile(sourcePath, destinationPath, fsConstants.COPYFILE_EXCL);
  } catch (copyError) {
    throw new Error(
      `Cross-device copy failed from ${sourcePath} to ${destinationPath}: ${getErrorMessage(copyError)}`
    );
  }

  try {
    await fileSystem.unlink(sourcePath);
  } catch (unlinkError) {
    try {
      await fileSystem.unlink(destinationPath);
    } catch {
      // Best effort cleanup before surfacing source unlink failure.
    }

    throw new Error(
      `Cross-device source cleanup failed for ${sourcePath} after copying to ${destinationPath}: ${getErrorMessage(
        unlinkError
      )}`
    );
  }
}

async function removeDirectoryIfEmpty(
  directoryPath: string,
  fileSystem: Pick<ProcessedImageMoveFileSystem, 'readdir' | 'rmdir'>
): Promise<void> {
  const entries = await fileSystem.readdir(directoryPath);

  if (entries.length === 0) {
    await fileSystem.rmdir(directoryPath);
  }
}

async function rollbackMovedFiles(
  records: readonly ProcessedImageMovePlanRecord[],
  fileSystem: ProcessedImageMoveFileSystem
): Promise<void> {
  for (const record of [...records].reverse()) {
    await moveFile(record.processedPath, record.sourcePath, fileSystem);
  }
}

export async function rollbackProcessedListingMove(
  moveResult: ProcessedImageMoveResult,
  fileSystem: ProcessedImageMoveFileSystem = DEFAULT_PROCESSED_IMAGE_MOVE_FILE_SYSTEM
): Promise<void> {
  try {
    await rollbackMovedFiles(moveResult.images, fileSystem);
    await removeDirectoryIfEmpty(moveResult.processedDirectory, fileSystem);
  } catch (error) {
    throw new Error(
      `Processed listing rollback failed for ${moveResult.listingId}: ${getErrorMessage(error)}.`
    );
  }
}

export async function moveGroupedImagesToProcessedListing(
  input: ProcessedImageMoveInput,
  fileSystem: ProcessedImageMoveFileSystem = DEFAULT_PROCESSED_IMAGE_MOVE_FILE_SYSTEM
): Promise<ProcessedImageMoveResult> {
  const images = buildProcessedImageMovePlan(input);
  const processedDirectory = buildProcessedListingDirectory(input.processedDirectory, input.listingId);

  await assertPathDoesNotExist(
    processedDirectory,
    'Processed listing directory already exists and cannot be reused',
    fileSystem
  );

  await fileSystem.mkdir(processedDirectory);

  const movedRecords: ProcessedImageMovePlanRecord[] = [];

  try {
    for (const image of images) {
      await moveFile(image.sourcePath, image.processedPath, fileSystem);
      movedRecords.push(image);
    }
  } catch (moveError) {
    try {
      await rollbackMovedFiles(movedRecords, fileSystem);
      await removeDirectoryIfEmpty(processedDirectory, fileSystem);
    } catch (rollbackError) {
      throw new Error(
        `Processed image move failed for ${input.listingId}: ${getErrorMessage(
          moveError
        )}. Rollback failed: ${getErrorMessage(rollbackError)}.`
      );
    }

    throw new Error(
      `Processed image move failed for ${input.listingId}: ${getErrorMessage(moveError)}.`
    );
  }

  return {
    listingId: input.listingId,
    processedDirectory,
    images,
  };
}
