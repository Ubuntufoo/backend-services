import type { ListingInsert, ListingRow, ListingUpdate } from '../database.js';
import type { Json } from '../database.js';
import type { SupabaseDataClient } from '../client.js';
import { parseBaseSku, parseStructuredSku } from '@ebay-inventory/types';
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

export interface ListingImageMetadataUpdate {
  expectedUpdatedAt?: string;
  imageUrls: string[];
  listingId: string;
  r2ObjectKeys: string[];
}

export interface ListListingsByStatusOptions {
  limit: number;
  offset: number;
  orderByCreatedAt?: 'asc' | 'desc';
}

export interface ListApprovedForExportListingsOptions {
  limit: number;
  queuedOnly?: boolean;
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

export interface GenerateAiPreparationUpdate {
  expectedUpdatedAt?: string;
  listingId: string;
  sellerHints?: ListingUpdate['seller_hints'];
}

export interface PublishedListingUpdate {
  ebayListingId?: ListingUpdate['ebay_listing_id'];
  ebayListingStatus?: ListingUpdate['ebay_listing_status'];
  ebayListingUrl?: ListingUpdate['ebay_listing_url'];
  ebayOfferId?: ListingUpdate['ebay_offer_id'];
  exportedAt?: ListingUpdate['exported_at'];
  listingId: string;
}

interface ErrorWithCode {
  code?: unknown;
  context?: {
    issues?: unknown;
    stage?: unknown;
  };
  message?: unknown;
  name?: unknown;
}

function isErrorWithCode(value: unknown): value is ErrorWithCode {
  return typeof value === 'object' && value !== null;
}

function getOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function getOptionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const entries = value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);

  return entries.length > 0 ? entries : undefined;
}

function buildPublishFailureErrorContext(error: unknown): Json {
  if (!isErrorWithCode(error)) {
    return {};
  }

  const context = {
    code: getOptionalString(error.code),
    issues: getOptionalStringArray(error.context?.issues),
    message: getOptionalString(error.message),
    name: getOptionalString(error.name),
    stage: getOptionalString(error.context?.stage),
  };

  return Object.fromEntries(
    Object.entries(context).filter(([, value]) => value !== undefined)
  ) satisfies Json;
}

function buildPublishFailureUpdate(errorAt: string, error: unknown): ListingUpdate {
  const fallbackMessage = error instanceof Error ? error.message : String(error);
  const errorCode = isErrorWithCode(error) ? getOptionalString(error.code) : undefined;

  return {
    last_error_at: errorAt,
    last_error_code: errorCode ?? 'publish_failed',
    last_error_context: buildPublishFailureErrorContext(error),
    last_error_message: fallbackMessage,
    status: 'approved_for_export',
    sub_status: 'publish_queued',
  };
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

function validateListingId(listingId: string): void {
  parseBaseSku(listingId);
}

function validateSku(sku: string): void {
  try {
    parseBaseSku(sku);
    return;
  } catch {}

  parseStructuredSku(sku);
}

function validateListingInsert(input: ListingInsert): void {
  validateListingId(input.listing_id);

  if (typeof input.sku === 'string') {
    validateSku(input.sku);
  }
}

function validateListingUpdate(listingId: string, changes: ListingUpdate): void {
  if (typeof changes.listing_id === 'string') {
    throw new Error('Listing ID is immutable and cannot be changed.');
  }

  if (typeof changes.sku === 'string') {
    validateSku(changes.sku);
  }
}

export async function createListing(
  client: SupabaseDataClient,
  input: ListingInsert
): Promise<ListingRow> {
  validateListingInsert(input);

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

export async function getListingByOfferId(
  client: SupabaseDataClient,
  offerId: string
): Promise<ListingRow | null> {
  const result = (await client
    .from('listings')
    .select('*')
    .eq('ebay_offer_id', offerId)
    .limit(2)) as MultiResult<ListingRow>;

  if (result.error) {
    throw new Error(result.error.message);
  }

  const rows = result.data ?? [];

  if (rows.length === 0) {
    return null;
  }

  if (rows.length > 1) {
    throw new Error(`Multiple local listings found for ebay_offer_id "${offerId}".`);
  }

  return rows[0] ?? null;
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

export async function listListingsByStatus(
  client: SupabaseDataClient,
  status: ListingRow['status'],
  options: ListListingsByStatusOptions
): Promise<ListingRow[]> {
  const result = (await client
    .from('listings')
    .select('*')
    .eq('status', status)
    .order('created_at', {
      ascending: options.orderByCreatedAt !== 'desc',
    })
    .range(options.offset, options.offset + options.limit - 1)) as MultiResult<ListingRow>;

  if (result.error) {
    throw new Error(result.error.message);
  }

  return result.data ?? [];
}

export async function listApprovedForExportListings(
  client: SupabaseDataClient,
  options: ListApprovedForExportListingsOptions
): Promise<ListingRow[]> {
  let query = client
    .from('listings')
    .select('*')
    .eq('status', 'approved_for_export');

  if (options.queuedOnly) {
    query = query.eq('sub_status', 'publish_queued');
  }

  const result = (await query
    .order('created_at', { ascending: true })
    .limit(options.limit)) as MultiResult<ListingRow>;

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
  validateListingUpdate(listingId, changes);

  const result = (await client
    .from('listings')
    .update(changes)
    .eq('listing_id', listingId)
    .select()
    .single()) as SingleResult<ListingRow>;

  return requireSingleResult(result, `Listing "${listingId}" was not updated.`);
}

export async function claimApprovedListingForPublish(
  client: SupabaseDataClient,
  listingId: string
): Promise<ListingRow | null> {
  const result = (await client
    .from('listings')
    .update({
      last_error_at: null,
      last_error_code: null,
      last_error_context: {},
      last_error_message: null,
      sub_status: 'publishing_to_ebay',
    })
    .eq('listing_id', listingId)
    .eq('status', 'approved_for_export')
    .eq('sub_status', 'publish_queued')
    .select()
    .maybeSingle()) as SingleResult<ListingRow>;

  return requireOptionalResult(result);
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

export async function saveListingImageMetadata(
  client: SupabaseDataClient,
  input: ListingImageMetadataUpdate
): Promise<ListingRow | null> {
  if (!input.expectedUpdatedAt) {
    return await updateListing(client, input.listingId, {
      image_urls: input.imageUrls,
      r2_object_keys: input.r2ObjectKeys,
    });
  }

  const result = (await client
    .from('listings')
    .update({
      image_urls: input.imageUrls,
      r2_object_keys: input.r2ObjectKeys,
    })
    .eq('listing_id', input.listingId)
    .eq('updated_at', input.expectedUpdatedAt)
    .select()
    .maybeSingle()) as SingleResult<ListingRow>;

  if (result.error) {
    throw new Error(result.error.message);
  }

  return result.data ?? null;
}

export async function saveGeneratedListingFields(
  client: SupabaseDataClient,
  input: GeneratedListingFieldsUpdate
): Promise<ListingRow> {
  const { listingId } = input;

  return await updateListing(client, listingId, mapGeneratedListingFieldsUpdate(input));
}

export async function prepareListingForGenerateAi(
  client: SupabaseDataClient,
  input: GenerateAiPreparationUpdate
): Promise<ListingRow | null> {
  const changes: ListingUpdate = {
    status: 'assets_ready',
    sub_status: 'ready_to_generate',
  };

  if (input.sellerHints !== undefined) {
    changes.seller_hints = input.sellerHints;
  }

  if (!input.expectedUpdatedAt) {
    return await updateListing(client, input.listingId, changes);
  }

  const result = (await client
    .from('listings')
    .update(changes)
    .eq('listing_id', input.listingId)
    .eq('status', 'assets_ready')
    .eq('updated_at', input.expectedUpdatedAt)
    .select()
    .maybeSingle()) as SingleResult<ListingRow>;

  if (result.error) {
    throw new Error(result.error.message);
  }

  return result.data ?? null;
}

export async function savePublishedListing(
  client: SupabaseDataClient,
  input: PublishedListingUpdate
): Promise<ListingRow> {
  const { listingId } = input;

  return await updateListing(client, listingId, mapPublishedListingUpdate(input));
}

export async function markListingPublishFailed(
  client: SupabaseDataClient,
  listingId: string,
  errorAt: string,
  error: unknown
): Promise<ListingRow> {
  return await updateListing(client, listingId, buildPublishFailureUpdate(errorAt, error));
}
