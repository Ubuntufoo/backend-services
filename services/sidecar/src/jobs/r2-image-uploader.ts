import * as fs from 'node:fs/promises';
import { extname } from 'node:path';

import { uploadImage } from '@ebay-inventory/data';

export interface R2UploadListingImagesInput {
  listingId: string;
  images: {
    filename: string;
    localPath: string;
  }[];
}

export interface R2UploadedListingImage {
  filename: string;
  objectKey: string;
  publicUrl: string;
}

export interface R2ImageUploader {
  uploadListingImages(input: R2UploadListingImagesInput): Promise<R2UploadedListingImage[]>;
}

export interface CreateR2ImageUploaderOptions {
  readFile?: typeof fs.readFile;
  uploadSingleImage?: typeof uploadImage;
}

const IMAGE_CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

function sanitizePathSegment(value: string, fallback: string): string {
  const sanitized = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '')
    .toLowerCase();

  return sanitized || fallback;
}

function buildDeterministicAssetPrepObjectKey(listingId: string, filename: string): string {
  const listingSegment = sanitizePathSegment(listingId, 'listing');
  const filenameSegment = sanitizePathSegment(filename, 'image');

  return `listings/${listingSegment}/assets/${filenameSegment}`;
}

function getContentType(filename: string): string {
  const extension = extname(filename).toLowerCase();
  const contentType = IMAGE_CONTENT_TYPE_BY_EXTENSION[extension];

  if (!contentType) {
    throw new Error(`Unsupported R2 upload image extension for ${filename}.`);
  }

  return contentType;
}

export function createR2ImageUploader(
  options: CreateR2ImageUploaderOptions = {}
): R2ImageUploader {
  const readFile = options.readFile ?? fs.readFile.bind(fs);
  const uploadSingleImage = options.uploadSingleImage ?? uploadImage;

  return {
    uploadListingImages: async (input) => {
      const uploadedImages: R2UploadedListingImage[] = [];

      for (const image of input.images) {
        const body = await readFile(image.localPath);
        const { objectKey, publicUrl } = await uploadSingleImage(
          {
            listingId: input.listingId,
            filename: image.filename,
            contentType: getContentType(image.filename),
            body,
          },
          {
            objectKey: buildDeterministicAssetPrepObjectKey(input.listingId, image.filename),
          }
        );

        uploadedImages.push({
          filename: image.filename,
          objectKey,
          publicUrl,
        });
      }

      return uploadedImages;
    },
  };
}
