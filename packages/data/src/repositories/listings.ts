import type { ListingInsert, ListingRow, ListingUpdate } from '../database.js';
import type { SupabaseDataClient } from '../client.js';
import {
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
  capture_mode?: ListingUpdate['capture_mode'];
  category_id?: ListingUpdate['category_id'];
  condition_id?: ListingUpdate['condition_id'];
  condition_notes?: ListingUpdate['condition_notes'];
  description?: ListingUpdate['description'];
  ese_eligible?: ListingUpdate['ese_eligible'];
  estimated_weight_oz?: ListingUpdate['estimated_weight_oz'];
  handling_days?: ListingUpdate['handling_days'];
  item_specifics?: ListingUpdate['item_specifics'];
  listingId: string;
  listing_type?: ListingUpdate['listing_type'];
  merchant_location_key?: ListingUpdate['merchant_location_key'];
  package_type?: ListingUpdate['package_type'];
  price?: ListingUpdate['price'];
  seller_hints?: ListingUpdate['seller_hints'];
  shipping_profile?: ListingUpdate['shipping_profile'];
  title?: ListingUpdate['title'];
}

export interface PublishedListingUpdate {
  ebay_listing_id?: ListingUpdate['ebay_listing_id'];
  ebay_listing_status?: ListingUpdate['ebay_listing_status'];
  ebay_listing_url?: ListingUpdate['ebay_listing_url'];
  ebay_offer_id?: ListingUpdate['ebay_offer_id'];
  exported_at?: ListingUpdate['exported_at'];
  listingId: string;
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
  const { listingId, ...changes } = input;

  return await updateListing(client, listingId, changes);
}

export async function savePublishedListing(
  client: SupabaseDataClient,
  input: PublishedListingUpdate
): Promise<ListingRow> {
  const { listingId, ...changes } = input;

  return await updateListing(client, listingId, changes);
}
