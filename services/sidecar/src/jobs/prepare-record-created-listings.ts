import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, resolve } from 'node:path';

import type { ListingRow, ListingUpdate } from '@ebay-inventory/data';
import {
  processListingImages,
  type ProcessListingImagesInput,
  type ProcessListingImagesResult,
} from '@ebay-inventory/image-service';

import { getSidecarDataAccess, type SidecarDataAccess } from '@/data/sidecar-data.js';

import {
  createR2ImageUploader,
  type R2ImageUploader,
  type R2UploadedListingImage,
} from './r2-image-uploader.js';

const RECORD_CREATED_STATUS = 'record_created';
const ASSETS_READY_STATUS = 'assets_ready';
const READY_TO_GENERATE_SUB_STATUS = 'ready_to_generate';
const DEFAULT_IMAGE_PROCESSING_MODE: ProcessListingImagesInput['processingMode'] = 'strip_exif';
const IMAGE_SERVICE_OUTPUT_DIRECTORY_NAME = '.image-service-output';

const LISTING_ERROR_CODE_MISSING_SOURCE_IMAGES = 'record_created_missing_source_images';
const LISTING_ERROR_CODE_ASSET_STATE_CONFLICT = 'record_created_asset_state_conflict';
const LISTING_ERROR_CODE_INVALID_SOURCE_IMAGES = 'record_created_invalid_source_images';
const LISTING_ERROR_CODE_IMAGE_PROCESSING_FAILED = 'record_created_image_processing_failed';
const LISTING_ERROR_CODE_R2_UPLOAD_FAILED = 'record_created_r2_upload_failed';
const LISTING_ERROR_CODE_ASSET_PERSISTENCE_FAILED = 'record_created_asset_persistence_failed';

type ProcessListingImagesFn = (
  input: ProcessListingImagesInput
) => Promise<ProcessListingImagesResult>;

export interface PrepareRecordCreatedListingsOptions {
  createRunId?: () => string;
  dataAccess?: SidecarDataAccess;
  imageProcessor?: ProcessListingImagesFn;
  imageUploader?: R2ImageUploader;
  now?: () => Date;
}

export interface PrepareRecordCreatedListingsFailure {
  errorCode: string;
  listingId: string;
  message: string;
}

export interface PrepareRecordCreatedListingsResult {
  failed: PrepareRecordCreatedListingsFailure[];
  processed: ListingRow[];
}

class ListingAssetPreparationError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ListingAssetPreparationError';
    this.code = code;
  }
}

function asIsoTimestamp(now: () => Date): string {
  return now().toISOString();
}

function asTrimmedStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function isRemoteAssetPath(pathValue: string): boolean {
  try {
    const parsed = new URL(pathValue);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function getSourceImagePaths(listing: ListingRow): string[] {
  const sourceImagePaths = asTrimmedStringArray(listing.image_urls);
  const existingObjectKeys = asTrimmedStringArray(listing.r2_object_keys);

  if (sourceImagePaths.length === 0) {
    throw new ListingAssetPreparationError(
      LISTING_ERROR_CODE_MISSING_SOURCE_IMAGES,
      `Listing "${listing.listing_id}" does not have watcher-managed local image paths.`
    );
  }

  if (
    existingObjectKeys.length > 0 ||
    sourceImagePaths.some((pathValue) => isRemoteAssetPath(pathValue))
  ) {
    throw new ListingAssetPreparationError(
      LISTING_ERROR_CODE_ASSET_STATE_CONFLICT,
      `Listing "${listing.listing_id}" already has persisted asset metadata and cannot be reprocessed safely.`
    );
  }

  if (sourceImagePaths.some((pathValue) => !isAbsolute(pathValue))) {
    throw new ListingAssetPreparationError(
      LISTING_ERROR_CODE_INVALID_SOURCE_IMAGES,
      `Listing "${listing.listing_id}" has non-absolute local image paths.`
    );
  }

  if (new Set(sourceImagePaths).size !== sourceImagePaths.length) {
    throw new ListingAssetPreparationError(
      LISTING_ERROR_CODE_INVALID_SOURCE_IMAGES,
      `Listing "${listing.listing_id}" has duplicate local image paths.`
    );
  }

  return sourceImagePaths;
}

function getProcessedOutputDirectory(
  listingId: string,
  sourceImagePaths: readonly string[],
  createRunId: () => string
): string {
  const sourceDirectories = new Set(sourceImagePaths.map((pathValue) => dirname(pathValue)));

  if (sourceDirectories.size !== 1) {
    throw new ListingAssetPreparationError(
      LISTING_ERROR_CODE_INVALID_SOURCE_IMAGES,
      `Listing "${listingId}" image paths must share one watcher-processed directory.`
    );
  }

  const [sourceDirectory] = [...sourceDirectories];
  return resolve(sourceDirectory, IMAGE_SERVICE_OUTPUT_DIRECTORY_NAME, createRunId());
}

function buildSuccessUpdate(uploadedImages: readonly R2UploadedListingImage[]): ListingUpdate {
  return {
    image_urls: uploadedImages.map((image) => image.publicUrl),
    last_error_at: null,
    last_error_code: null,
    last_error_context: {},
    last_error_message: null,
    r2_object_keys: uploadedImages.map((image) => image.objectKey),
    status: ASSETS_READY_STATUS,
    sub_status: READY_TO_GENERATE_SUB_STATUS,
  };
}

function buildFailureUpdate(errorCode: string, errorAt: string, message: string): ListingUpdate {
  return {
    last_error_at: errorAt,
    last_error_code: errorCode,
    last_error_message: message,
  };
}

function toListingAssetPreparationError(
  error: unknown,
  errorCode: string,
  listingId: string
): ListingAssetPreparationError {
  if (error instanceof ListingAssetPreparationError) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  return new ListingAssetPreparationError(
    errorCode,
    `Listing "${listingId}" failed asset preparation: ${message}`,
    {
      cause: error instanceof Error ? error : undefined,
    }
  );
}

function getOrderedUploadedImages(
  listingId: string,
  processedImages: ProcessListingImagesResult['images'],
  uploadedImages: readonly R2UploadedListingImage[]
): R2UploadedListingImage[] {
  if (uploadedImages.length !== processedImages.length) {
    throw new ListingAssetPreparationError(
      LISTING_ERROR_CODE_R2_UPLOAD_FAILED,
      `Listing "${listingId}" upload result count does not match processed image count.`
    );
  }

  const uploadedByFilename = new Map<string, R2UploadedListingImage>();

  for (const uploadedImage of uploadedImages) {
    if (uploadedByFilename.has(uploadedImage.filename)) {
      throw new ListingAssetPreparationError(
        LISTING_ERROR_CODE_R2_UPLOAD_FAILED,
        `Listing "${listingId}" received duplicate uploaded filenames for ${uploadedImage.filename}.`
      );
    }

    uploadedByFilename.set(uploadedImage.filename, uploadedImage);
  }

  return processedImages.map((processedImage) => {
    const uploadedImage = uploadedByFilename.get(processedImage.filename);

    if (!uploadedImage) {
      throw new ListingAssetPreparationError(
        LISTING_ERROR_CODE_R2_UPLOAD_FAILED,
        `Listing "${listingId}" upload results are missing ${processedImage.filename}.`
      );
    }

    return uploadedImage;
  });
}

async function persistFailure(
  dataAccess: SidecarDataAccess,
  listing: ListingRow,
  error: ListingAssetPreparationError,
  errorAt: string
): Promise<void> {
  try {
    await dataAccess.listings.update(
      listing.listing_id,
      buildFailureUpdate(error.code, errorAt, error.message)
    );
  } catch {
    // Best effort only. Preserve primary failure result.
  }
}

async function prepareListingAssets(
  listing: ListingRow,
  options: Required<
    Pick<
      PrepareRecordCreatedListingsOptions,
      'createRunId' | 'dataAccess' | 'imageProcessor' | 'imageUploader'
    >
  >
): Promise<ListingRow> {
  const sourceImagePaths = getSourceImagePaths(listing);
  const outputDirectory = getProcessedOutputDirectory(
    listing.listing_id,
    sourceImagePaths,
    options.createRunId
  );

  let processedImages: ProcessListingImagesResult;

  try {
    processedImages = await options.imageProcessor({
      listingId: listing.listing_id,
      inputImagePaths: sourceImagePaths,
      outputDirectory,
      processingMode: DEFAULT_IMAGE_PROCESSING_MODE,
    });
  } catch (error) {
    throw toListingAssetPreparationError(
      error,
      LISTING_ERROR_CODE_IMAGE_PROCESSING_FAILED,
      listing.listing_id
    );
  }

  let uploadedImages: R2UploadedListingImage[];

  try {
    uploadedImages = await options.imageUploader.uploadListingImages({
      listingId: listing.listing_id,
      images: processedImages.images.map((image) => ({
        filename: image.filename,
        localPath: image.outputPath,
      })),
    });
  } catch (error) {
    throw toListingAssetPreparationError(
      error,
      LISTING_ERROR_CODE_R2_UPLOAD_FAILED,
      listing.listing_id
    );
  }

  const orderedUploadedImages = getOrderedUploadedImages(
    listing.listing_id,
    processedImages.images,
    uploadedImages
  );

  try {
    return await options.dataAccess.listings.update(
      listing.listing_id,
      buildSuccessUpdate(orderedUploadedImages)
    );
  } catch (error) {
    throw toListingAssetPreparationError(
      error,
      LISTING_ERROR_CODE_ASSET_PERSISTENCE_FAILED,
      listing.listing_id
    );
  }
}

export async function prepareRecordCreatedListings(
  options: PrepareRecordCreatedListingsOptions = {}
): Promise<PrepareRecordCreatedListingsResult> {
  const dataAccess = options.dataAccess ?? getSidecarDataAccess();
  const imageProcessor = options.imageProcessor ?? processListingImages;
  const imageUploader = options.imageUploader ?? createR2ImageUploader();
  const now = options.now ?? (() => new Date());
  const createRunId = options.createRunId ?? (() => randomUUID());
  const listings = await dataAccess.listings.list();
  const eligibleListings = listings.filter((listing) => listing.status === RECORD_CREATED_STATUS);
  const processed: ListingRow[] = [];
  const failed: PrepareRecordCreatedListingsFailure[] = [];

  for (const listing of eligibleListings) {
    try {
      processed.push(
        await prepareListingAssets(listing, {
          createRunId,
          dataAccess,
          imageProcessor,
          imageUploader,
        })
      );
    } catch (error) {
      const assetPreparationError = toListingAssetPreparationError(
        error,
        LISTING_ERROR_CODE_ASSET_PERSISTENCE_FAILED,
        listing.listing_id
      );
      const errorAt = asIsoTimestamp(now);
      await persistFailure(dataAccess, listing, assetPreparationError, errorAt);

      failed.push({
        errorCode: assetPreparationError.code,
        listingId: listing.listing_id,
        message: assetPreparationError.message,
      });
    }
  }

  return {
    failed,
    processed,
  };
}
