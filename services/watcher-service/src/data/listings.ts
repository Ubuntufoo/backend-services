import { createSupabaseServiceClient, type ListingRow, type SupabaseDataClient } from '@ebay-inventory/data';
import { LISTING_IDLE_SUB_STATUS, type CaptureMode } from '@ebay-inventory/types';

export interface WatcherListingImageMetadata {
  processedPath: string;
}

export interface CreateWatcherListingInput {
  captureMode: CaptureMode;
  images: readonly WatcherListingImageMetadata[];
  listingId: string;
}

interface SupabaseErrorLike {
  code?: string;
  details?: string;
  hint?: string;
  message: string;
}

export class WatcherListingRepositoryError extends Error {
  code?: string;
  details?: string;
  hint?: string;

  constructor(message: string, options: Omit<SupabaseErrorLike, 'message'> = {}) {
    super(message);
    this.name = 'WatcherListingRepositoryError';
    this.code = options.code;
    this.details = options.details;
    this.hint = options.hint;
  }
}

export interface WatcherListingRepository {
  createWatcherListing(input: CreateWatcherListingInput): Promise<ListingRow>;
}

function getListingType(captureMode: CaptureMode): 'single' | 'lot' {
  return captureMode.startsWith('lot') ? 'lot' : 'single';
}

function asWatcherListingRepositoryError(error: SupabaseErrorLike): WatcherListingRepositoryError {
  return new WatcherListingRepositoryError(error.message, {
    code: error.code,
    details: error.details,
    hint: error.hint,
  });
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === 'string' ? message : String(message);
  }

  return String(error);
}

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}

export function isWatcherListingIdUniqueViolation(error: unknown): boolean {
  if (!isUniqueViolation(error)) {
    return false;
  }

  const message = getErrorMessage(error);
  return (
    message.includes('listings_listing_id_key') ||
    message.includes('public_listings_listing_id_key') ||
    message.includes('Key (listing_id)=') ||
    (message.includes('public.listings') && message.includes('listing_id'))
  );
}

async function insertWatcherListing(
  client: SupabaseDataClient,
  input: CreateWatcherListingInput
): Promise<ListingRow> {
  const result = (await client
    .from('listings')
    .insert({
      capture_mode: input.captureMode,
      image_urls: input.images.map((image) => image.processedPath),
      item_specifics: {},
      listing_id: input.listingId,
      listing_type: getListingType(input.captureMode),
      r2_object_keys: [],
      status: 'record_created',
      sub_status: LISTING_IDLE_SUB_STATUS,
    })
    .select()
    .single()) as {
    data: ListingRow | null;
    error: SupabaseErrorLike | null;
  };

  if (result.error) {
    throw asWatcherListingRepositoryError(result.error);
  }

  if (!result.data) {
    throw new WatcherListingRepositoryError(`Watcher listing "${input.listingId}" was not created.`);
  }

  return result.data;
}

export function createWatcherListingRepository(
  env: NodeJS.ProcessEnv = process.env
): WatcherListingRepository {
  const client = createSupabaseServiceClient(env);

  return {
    createWatcherListing: async (input) => await insertWatcherListing(client, input),
  };
}
