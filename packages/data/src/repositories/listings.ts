import type { ListingInsert, ListingRow, ListingUpdate } from '../database.js';
import type { SupabaseDataClient } from '../client.js';
import {
  type MultiResult,
  requireOptionalResult,
  requireSingleResult,
  type SingleResult,
} from './shared.js';

export interface ListingArtifactsUpdate {
  imageUrls: string[];
  listingId: string;
  r2DeleteAfter?: string | null;
  r2DeletedAt?: string | null;
  r2ObjectKeys: string[];
  r2RetentionPolicy?: string | null;
}

export interface GeneratedListingFieldsUpdate {
  captureMode?: ListingUpdate['capture_mode'];
  categoryId?: ListingUpdate['category_id'];
  conditionId?: ListingUpdate['condition_id'];
  conditionNotes?: ListingUpdate['condition_notes'];
  description?: ListingUpdate['description'];
  eseEligible?: ListingUpdate['ese_eligible'];
  estimatedWeightOz?: ListingUpdate['estimated_weight_oz'];
  handlingDays?: ListingUpdate['handling_days'];
  itemSpecifics?: ListingUpdate['item_specifics'];
  listingId: string;
  listingType?: ListingUpdate['listing_type'];
  merchantLocationKey?: ListingUpdate['merchant_location_key'];
  packageType?: ListingUpdate['package_type'];
  price?: ListingUpdate['price'];
  sellerHints?: ListingUpdate['seller_hints'];
  shippingProfile?: ListingUpdate['shipping_profile'];
  title?: ListingUpdate['title'];
}

export interface PublishedListingUpdate {
  ebayListingId?: ListingUpdate['ebay_listing_id'];
  ebayListingStatus?: ListingUpdate['ebay_listing_status'];
  ebayListingUrl?: ListingUpdate['ebay_listing_url'];
  ebayOfferId?: ListingUpdate['ebay_offer_id'];
  exportedAt?: ListingUpdate['exported_at'];
  listingId: string;
}

function mapGeneratedListingFieldsUpdate(
  input: GeneratedListingFieldsUpdate
): ListingUpdate {
  return {
    capture_mode: input.captureMode,
    category_id: input.categoryId,
    condition_id: input.conditionId,
    condition_notes: input.conditionNotes,
    description: input.description,
    ese_eligible: input.eseEligible,
    estimated_weight_oz: input.estimatedWeightOz,
    handling_days: input.handlingDays,
    item_specifics: input.itemSpecifics,
    listing_type: input.listingType,
    merchant_location_key: input.merchantLocationKey,
    package_type: input.packageType,
    price: input.price,
    seller_hints: input.sellerHints,
    shipping_profile: input.shippingProfile,
    title: input.title,
  };
}

function mapPublishedListingUpdate(input: PublishedListingUpdate): ListingUpdate {
  return {
    ebay_listing_id: input.ebayListingId,
    ebay_listing_status: input.ebayListingStatus,
    ebay_listing_url: input.ebayListingUrl,
    ebay_offer_id: input.ebayOfferId,
    exported_at: input.exportedAt,
  };
}

export async function createListing(
  client: SupabaseDataClient,
  input: ListingInsert
): Promise<ListingRow> {
  const result = (await client
    .from('listings')
    .insert(input)
    .select()
    .single()) as SingleResult<ListingRow>;

  return requireSingleResult(result, `Listing "${input.listing_id}" was not created.`);
}

export async function getListingByListingId(
  client: SupabaseDataClient,
  listingId: string
): Promise<ListingRow | null> {
  const result = (await client
    .from('listings')
    .select('*')
    .eq('listing_id', listingId)
    .maybeSingle()) as SingleResult<ListingRow>;

  return requireOptionalResult(result);
}

export async function listListings(client: SupabaseDataClient): Promise<ListingRow[]> {
  const result = (await client
    .from('listings')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(100)) as MultiResult<ListingRow>;

  if (result.error) {
    throw new Error(result.error.message);
  }

  return result.data ?? [];
}

export async function updateListing(
  client: SupabaseDataClient,
  listingId: string,
  changes: ListingUpdate
): Promise<ListingRow> {
  const result = (await client
    .from('listings')
    .update(changes)
    .eq('listing_id', listingId)
    .select()
    .single()) as SingleResult<ListingRow>;

  return requireSingleResult(result, `Listing "${listingId}" was not updated.`);
}

export async function saveListingArtifacts(
  client: SupabaseDataClient,
  input: ListingArtifactsUpdate
): Promise<ListingRow> {
  return await updateListing(client, input.listingId, {
    image_urls: input.imageUrls,
    r2_delete_after: input.r2DeleteAfter,
    r2_deleted_at: input.r2DeletedAt,
    r2_object_keys: input.r2ObjectKeys,
    r2_retention_policy: input.r2RetentionPolicy,
  });
}

export async function saveGeneratedListingFields(
  client: SupabaseDataClient,
  input: GeneratedListingFieldsUpdate
): Promise<ListingRow> {
  const { listingId } = input;

  return await updateListing(client, listingId, mapGeneratedListingFieldsUpdate(input));
}

export async function savePublishedListing(
  client: SupabaseDataClient,
  input: PublishedListingUpdate
): Promise<ListingRow> {
  const { listingId } = input;

  return await updateListing(client, listingId, mapPublishedListingUpdate(input));
}
