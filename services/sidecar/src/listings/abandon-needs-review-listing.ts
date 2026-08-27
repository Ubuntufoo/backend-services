import { DEFAULT_APP_SETTINGS_ID, deleteR2Objects, type ListingRow } from '@ebay-inventory/data';

import { getSidecarDataAccess, type SidecarDataAccess } from '@/data/sidecar-data.js';
import {
  ListingCleanupConfigurationError,
  normalizeExactR2ObjectKeys,
  removeListingCleanupWatcherDirectory,
  resolveListingCleanupProcessedRoot,
  resolveListingCleanupWatcherDirectory,
} from '@/listings/listing-cleanup-artifacts.js';
import { createLogger, type ComponentLogger } from '@/utils/logger.js';

const abandonmentLogger = createLogger('ListingAbandonment');
const ACTIVE_JOB_STATUSES = new Set(['queued', 'running']);

export type ListingAbandonmentErrorCode =
  | 'listing_abandonment_active_job'
  | 'listing_abandonment_cleanup_failed'
  | 'listing_abandonment_configuration_error'
  | 'listing_abandonment_ebay_trace'
  | 'listing_abandonment_order_exists'
  | 'listing_abandonment_state_stale'
  | 'listing_abandonment_status_unsupported'
  | 'not_found';

export class ListingAbandonmentError extends Error {
  readonly code: ListingAbandonmentErrorCode;
  readonly statusCode: 404 | 409 | 500;

  constructor(
    code: ListingAbandonmentErrorCode,
    statusCode: 404 | 409 | 500,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'ListingAbandonmentError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export type AbandonNeedsReviewListingOptions = {
  dataAccess?: SidecarDataAccess;
  deleteObjects?: (objectKeys: readonly string[]) => Promise<void>;
  env?: NodeJS.ProcessEnv;
  logger?: Pick<ComponentLogger, 'error' | 'info'>;
  removeDirectory?: (directoryPath: string) => Promise<void>;
};

function hasNonEmptyString(value: string | null): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasEbayOrExportTrace(listing: ListingRow): boolean {
  return (
    hasNonEmptyString(listing.ebay_offer_id) ||
    hasNonEmptyString(listing.ebay_listing_id) ||
    hasNonEmptyString(listing.ebay_listing_url) ||
    hasNonEmptyString(listing.ebay_listing_status) ||
    listing.approved_for_export_at !== null ||
    listing.exported_at !== null ||
    listing.sold_at !== null
  );
}

export function resolveWatcherProcessedRoot(input: {
  appSettingsProcessedRoot: string | null | undefined;
  env: NodeJS.ProcessEnv;
}): string {
  try {
    return resolveListingCleanupProcessedRoot(input);
  } catch (error) {
    throw new ListingAbandonmentError(
      'listing_abandonment_configuration_error',
      500,
      error instanceof ListingCleanupConfigurationError
        ? `${error.message.replace(/\.$/, '')} before listing abandonment can run.`
        : 'Listing abandonment configuration validation failed.',
      { cause: error }
    );
  }
}

export function resolveWatcherListingDirectory(processedRoot: string, listingId: string): string {
  try {
    return resolveListingCleanupWatcherDirectory(processedRoot, listingId);
  } catch (error) {
    throw new ListingAbandonmentError(
      'listing_abandonment_configuration_error',
      500,
      error instanceof ListingCleanupConfigurationError
        ? error.message
        : `Watcher directory for listing "${listingId}" is not safely contained by the processed root.`,
      { cause: error }
    );
  }
}

export async function removeWatcherListingDirectory(
  processedRoot: string,
  listingId: string
): Promise<void> {
  resolveWatcherListingDirectory(processedRoot, listingId);
  await removeListingCleanupWatcherDirectory(processedRoot, listingId);
}

function cleanupFailure(
  listingId: string,
  stage: 'database' | 'filesystem' | 'r2',
  cause: unknown
): ListingAbandonmentError {
  return new ListingAbandonmentError(
    'listing_abandonment_cleanup_failed',
    500,
    `Listing "${listingId}" abandonment failed during ${stage} cleanup.`,
    { cause }
  );
}

export async function abandonNeedsReviewListing(
  listingId: string,
  options: AbandonNeedsReviewListingOptions = {}
): Promise<{ abandoned: true; listingId: string }> {
  const dataAccess = options.dataAccess ?? getSidecarDataAccess();
  const logger = options.logger ?? abandonmentLogger;
  const listing = await dataAccess.listings.getByListingId(listingId);

  if (!listing) {
    throw new ListingAbandonmentError('not_found', 404, `Listing "${listingId}" was not found.`);
  }

  if (listing.status !== 'assets_ready' && listing.status !== 'needs_review') {
    throw new ListingAbandonmentError(
      'listing_abandonment_status_unsupported',
      409,
      `Listing "${listingId}" cannot be abandoned from status "${listing.status}".`
    );
  }

  if (hasEbayOrExportTrace(listing)) {
    throw new ListingAbandonmentError(
      'listing_abandonment_ebay_trace',
      409,
      `Listing "${listingId}" has eBay or export history and cannot be abandoned.`
    );
  }

  const jobs = await dataAccess.jobs.listByListingId(listingId);
  const activeJob = jobs.find((job) => ACTIVE_JOB_STATUSES.has(job.status));

  if (activeJob) {
    throw new ListingAbandonmentError(
      'listing_abandonment_active_job',
      409,
      `Listing "${listingId}" has an active ${activeJob.status} job and cannot be abandoned.`
    );
  }

  if (await dataAccess.orders.hasByListingId(listingId)) {
    throw new ListingAbandonmentError(
      'listing_abandonment_order_exists',
      409,
      `Listing "${listingId}" has an associated order and cannot be abandoned.`
    );
  }

  const appSettings = await dataAccess.appSettings.get(DEFAULT_APP_SETTINGS_ID);
  let processedRoot: string;
  let watcherDirectory: string;

  try {
    processedRoot = resolveWatcherProcessedRoot({
      appSettingsProcessedRoot: appSettings?.processed_folder_path,
      env: options.env ?? process.env,
    });
    watcherDirectory = resolveWatcherListingDirectory(processedRoot, listing.listing_id);
  } catch (error) {
    logger.error('Listing abandonment configuration validation failed.', {
      listingId,
      stage: 'configuration',
    });
    throw error;
  }

  const objectKeys = normalizeExactR2ObjectKeys(listing.r2_object_keys);

  try {
    await (options.deleteObjects ?? deleteR2Objects)(objectKeys);
  } catch (error) {
    logger.error('Listing abandonment cleanup failed.', {
      listingId,
      stage: 'r2',
    });
    throw cleanupFailure(listingId, 'r2', error);
  }

  try {
    if (options.removeDirectory) {
      await options.removeDirectory(watcherDirectory);
    } else {
      await removeWatcherListingDirectory(processedRoot, listing.listing_id);
    }
  } catch (error) {
    logger.error('Listing abandonment cleanup failed.', {
      listingId,
      stage: 'filesystem',
    });
    throw cleanupFailure(listingId, 'filesystem', error);
  }

  let deletedListing: ListingRow | null;

  try {
    deletedListing = await dataAccess.listings.deleteNeedsReview({
      expectedUpdatedAt: listing.updated_at,
      listingId: listing.listing_id,
    });
  } catch (error) {
    logger.error('Listing abandonment cleanup failed.', {
      listingId,
      stage: 'database',
    });
    throw cleanupFailure(listingId, 'database', error);
  }

  if (!deletedListing) {
    throw new ListingAbandonmentError(
      'listing_abandonment_state_stale',
      409,
      `Listing "${listingId}" changed before abandonment completed. Refresh and retry.`
    );
  }

  logger.info('Listing abandoned.', {
    listingId,
    r2ObjectCount: objectKeys.length,
  });

  return {
    abandoned: true,
    listingId,
  };
}
