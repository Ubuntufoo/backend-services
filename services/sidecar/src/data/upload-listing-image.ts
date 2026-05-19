import {
  uploadImage,
  type ListingRow,
  type UploadImageInput,
} from '@ebay-inventory/data';
import { getSidecarDataAccess } from '@/data/sidecar-data.js';

export type UploadListingImageInput = UploadImageInput;

export interface UploadListingImageResult {
  listing: ListingRow;
  objectKey: string;
  publicUrl: string;
}

const MAX_METADATA_SAVE_RETRIES = 3;

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string');
}

export async function uploadListingImage(
  input: UploadListingImageInput
): Promise<UploadListingImageResult> {
  const dataAccess = getSidecarDataAccess();
  let listing = await dataAccess.listings.getByListingId(input.listingId);

  if (!listing) {
    throw new Error(`Listing "${input.listingId}" was not found.`);
  }

  const { objectKey, publicUrl } = await uploadImage(input);

  try {
    for (let attempt = 0; attempt <= MAX_METADATA_SAVE_RETRIES; attempt += 1) {
      const imageUrls = [...asStringArray(listing.image_urls), publicUrl];
      const r2ObjectKeys = [...asStringArray(listing.r2_object_keys), objectKey];
      const updatedListing = await dataAccess.listings.saveImageMetadata({
        listingId: input.listingId,
        expectedUpdatedAt: listing.updated_at,
        imageUrls,
        r2ObjectKeys,
      });

      if (updatedListing) {
        return {
          listing: updatedListing,
          objectKey,
          publicUrl,
        };
      }

      if (attempt === MAX_METADATA_SAVE_RETRIES) {
        throw new Error(
          `Exceeded metadata persistence retries for listing "${input.listingId}".`
        );
      }

      const refreshedListing = await dataAccess.listings.getByListingId(input.listingId);
      if (!refreshedListing) {
        throw new Error(
          `Listing "${input.listingId}" was deleted while persisting uploaded image metadata.`
        );
      }
      listing = refreshedListing;
    }

    throw new Error(`Failed to persist uploaded listing image metadata for listing "${input.listingId}".`);
  } catch (error) {
    throw new Error(
      `Failed to persist uploaded listing image metadata for listing "${input.listingId}" after uploading R2 object "${objectKey}".`,
      { cause: error }
    );
  }
}
