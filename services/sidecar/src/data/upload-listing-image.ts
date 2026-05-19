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
  const listing = await dataAccess.listings.getByListingId(input.listingId);

  if (!listing) {
    throw new Error(`Listing "${input.listingId}" was not found.`);
  }

  const { objectKey, publicUrl } = await uploadImage(input);
  const imageUrls = [...asStringArray(listing.image_urls), publicUrl];
  const r2ObjectKeys = [...asStringArray(listing.r2_object_keys), objectKey];

  try {
    const updatedListing = await dataAccess.listings.saveImageMetadata({
      listingId: input.listingId,
      imageUrls,
      r2ObjectKeys,
    });

    return {
      listing: updatedListing,
      objectKey,
      publicUrl,
    };
  } catch (error) {
    throw new Error(
      `Failed to persist uploaded listing image metadata for listing "${input.listingId}" after uploading R2 object "${objectKey}".`,
      { cause: error }
    );
  }
}
