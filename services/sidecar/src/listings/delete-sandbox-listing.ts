import { DEFAULT_APP_SETTINGS_ID, deleteR2Objects, type ListingRow } from '@ebay-inventory/data';

import { getSidecarDataAccess, type SidecarDataAccess } from '@/data/sidecar-data.js';
import {
  performSandboxCleanup,
  resolveSandboxCleanupApi,
  resolveSandboxCleanupCandidateSelection,
  resolveSandboxCleanupPlan,
  type SandboxCleanupDeleteOutcome,
  type SandboxCleanupDependencies,
  type SandboxCleanupInput,
  type SandboxCleanupPlan,
  type SandboxCleanupResolvedPlan,
} from '@/ebay/sandbox-cleanup.js';
import {
  ListingCleanupConfigurationError,
  normalizeExactR2ObjectKeys,
  removeListingCleanupWatcherDirectory,
  resolveListingCleanupProcessedRoot,
  resolveListingCleanupWatcherDirectory,
} from '@/listings/listing-cleanup-artifacts.js';

const ACTIVE_JOB_STATUSES = new Set(['queued', 'running']);
const ELIGIBLE_STATUSES = new Set(['exported', 'listed']);

export type SandboxListingDeletionErrorCode =
  | 'not_found'
  | 'sandbox_cleanup_active_job'
  | 'sandbox_cleanup_configuration_error'
  | 'sandbox_cleanup_local_failed'
  | 'sandbox_cleanup_order_exists'
  | 'sandbox_cleanup_remote_failed'
  | 'sandbox_cleanup_remote_orphan'
  | 'sandbox_cleanup_sku_ambiguous'
  | 'sandbox_cleanup_sku_mismatch'
  | 'sandbox_cleanup_sold_listing'
  | 'sandbox_cleanup_state_stale'
  | 'sandbox_cleanup_status_unsupported'
  | 'sandbox_cleanup_trace_missing'
  | 'sandbox_environment_required';

export class SandboxListingDeletionError extends Error {
  readonly code: SandboxListingDeletionErrorCode;
  readonly statusCode: 404 | 409 | 500 | 502;

  constructor(
    code: SandboxListingDeletionErrorCode,
    statusCode: 404 | 409 | 500 | 502,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'SandboxListingDeletionError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface SandboxListingLocalOutcome {
  databaseDeleted: boolean;
  errorCode?: SandboxListingDeletionErrorCode;
  listingId?: string;
  r2ObjectCount: number;
  sku: string;
  stage?: 'database' | 'filesystem' | 'r2';
  status: 'already_missing' | 'deleted' | 'eligible' | 'failed' | 'preserved';
  watcherDirectoryRemoved: boolean;
}

export interface SandboxListingCleanupRunResult extends SandboxCleanupPlan {
  localOutcomes: SandboxListingLocalOutcome[];
  mode: 'delete' | 'dry-run';
  outcomes: SandboxCleanupDeleteOutcome[];
  success: boolean;
}

export interface DeleteSandboxListingByIdInput {
  expectedSku: string;
  expectedUpdatedAt: string;
  listingId: string;
}

export interface DeleteSandboxListingSuccess {
  deleted: true;
  listingId: string;
  localOutcome: {
    databaseDeleted: true;
    r2ObjectCount: number;
    status: 'deleted';
    watcherDirectoryRemoved: true;
  };
  remoteOutcome: {
    deletedInventoryItem: boolean;
    deletedOfferCount: number;
    endedListingCount: number;
    missingResourceCount: number;
    status: 'deleted' | 'skipped';
  };
  sku: string;
}

export interface SandboxListingCleanupDependencies extends Partial<SandboxCleanupDependencies> {
  dataAccess?: SidecarDataAccess;
  deleteObjects?: (objectKeys: readonly string[]) => Promise<void>;
  removeDirectory?: (directoryPath: string) => Promise<void>;
}

interface LocalCleanupPlan {
  listing?: ListingRow;
  objectKeys: string[];
  processedRoot?: string;
  sku: string;
  watcherDirectory?: string;
}

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
    listing.exported_at !== null
  );
}

function assertSandboxEnvironment(env: NodeJS.ProcessEnv): void {
  if (env.EBAY_ENVIRONMENT !== 'sandbox') {
    throw new SandboxListingDeletionError(
      'sandbox_environment_required',
      409,
      'Sandbox listing deletion requires EBAY_ENVIRONMENT="sandbox".'
    );
  }
}

async function resolveLocalPlan(
  sku: string,
  input: { expectedListingId?: string; expectedUpdatedAt?: string },
  dataAccess: SidecarDataAccess,
  env: NodeJS.ProcessEnv
): Promise<LocalCleanupPlan> {
  let listing: ListingRow | null;

  try {
    listing = await dataAccess.listings.getBySku(sku);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith('Multiple local listings found')) {
      throw new SandboxListingDeletionError(
        'sandbox_cleanup_local_failed',
        500,
        `Local listing lookup failed for exact SKU "${sku}".`,
        { cause: error }
      );
    }

    throw new SandboxListingDeletionError(
      'sandbox_cleanup_sku_ambiguous',
      409,
      `Multiple local listings match exact SKU "${sku}". Cleanup was refused.`,
      { cause: error }
    );
  }

  if (!listing) {
    if (input.expectedListingId) {
      throw new SandboxListingDeletionError(
        'not_found',
        404,
        `Listing "${input.expectedListingId}" was not found.`
      );
    }

    return { objectKeys: [], sku };
  }

  if (input.expectedListingId && listing.listing_id !== input.expectedListingId) {
    throw new SandboxListingDeletionError(
      'sandbox_cleanup_sku_mismatch',
      409,
      `SKU "${sku}" belongs to a different listing. Refresh and retry.`
    );
  }

  if (input.expectedUpdatedAt && listing.updated_at !== input.expectedUpdatedAt) {
    throw new SandboxListingDeletionError(
      'sandbox_cleanup_state_stale',
      409,
      `Listing "${listing.listing_id}" changed. Refresh and retry.`
    );
  }

  if (!ELIGIBLE_STATUSES.has(listing.status)) {
    throw new SandboxListingDeletionError(
      'sandbox_cleanup_status_unsupported',
      409,
      `Listing "${listing.listing_id}" cannot be deleted from status "${listing.status}".`
    );
  }

  if (listing.sold_at !== null) {
    throw new SandboxListingDeletionError(
      'sandbox_cleanup_sold_listing',
      409,
      `Listing "${listing.listing_id}" is sold and cannot be deleted.`
    );
  }

  if (!hasEbayOrExportTrace(listing)) {
    throw new SandboxListingDeletionError(
      'sandbox_cleanup_trace_missing',
      409,
      `Listing "${listing.listing_id}" has no eBay or export trace. Cleanup was refused.`
    );
  }

  if (await dataAccess.orders.hasByListingId(listing.listing_id)) {
    throw new SandboxListingDeletionError(
      'sandbox_cleanup_order_exists',
      409,
      `Listing "${listing.listing_id}" has an associated order and cannot be deleted.`
    );
  }

  const jobs = await dataAccess.jobs.listByListingId(listing.listing_id);
  const activeJob = jobs.find((job) => ACTIVE_JOB_STATUSES.has(job.status));

  if (activeJob) {
    throw new SandboxListingDeletionError(
      'sandbox_cleanup_active_job',
      409,
      `Listing "${listing.listing_id}" has an active ${activeJob.status} job and cannot be deleted.`
    );
  }

  const appSettings = await dataAccess.appSettings.get(DEFAULT_APP_SETTINGS_ID);

  try {
    const processedRoot = resolveListingCleanupProcessedRoot({
      appSettingsProcessedRoot: appSettings?.processed_folder_path,
      env,
    });
    const watcherDirectory = resolveListingCleanupWatcherDirectory(
      processedRoot,
      listing.listing_id
    );

    return {
      listing,
      objectKeys: normalizeExactR2ObjectKeys(listing.r2_object_keys),
      processedRoot,
      sku,
      watcherDirectory,
    };
  } catch (error) {
    throw new SandboxListingDeletionError(
      'sandbox_cleanup_configuration_error',
      409,
      error instanceof ListingCleanupConfigurationError
        ? error.message
        : `Listing "${listing.listing_id}" cleanup configuration is unsafe.`,
      { cause: error }
    );
  }
}

function previewLocalOutcome(plan: LocalCleanupPlan): SandboxListingLocalOutcome {
  return {
    databaseDeleted: false,
    listingId: plan.listing?.listing_id,
    r2ObjectCount: plan.objectKeys.length,
    sku: plan.sku,
    status: plan.listing ? 'eligible' : 'already_missing',
    watcherDirectoryRemoved: false,
  };
}

async function performLocalCleanup(
  plan: LocalCleanupPlan,
  dependencies: SandboxListingCleanupDependencies
): Promise<SandboxListingLocalOutcome> {
  const listing = plan.listing;
  if (!listing) {
    return previewLocalOutcome(plan);
  }

  try {
    await (dependencies.deleteObjects ?? deleteR2Objects)(plan.objectKeys);
  } catch (error) {
    return {
      ...previewLocalOutcome(plan),
      errorCode: 'sandbox_cleanup_local_failed',
      stage: 'r2',
      status: 'failed',
    };
  }

  try {
    if (dependencies.removeDirectory) {
      await dependencies.removeDirectory(plan.watcherDirectory!);
    } else {
      await removeListingCleanupWatcherDirectory(plan.processedRoot!, listing.listing_id);
    }
  } catch (error) {
    return {
      ...previewLocalOutcome(plan),
      errorCode: 'sandbox_cleanup_local_failed',
      stage: 'filesystem',
      status: 'failed',
    };
  }

  let deletedListing: ListingRow | null;

  try {
    deletedListing = await (
      dependencies.dataAccess ?? getSidecarDataAccess()
    ).listings.deleteSandboxCleaned({
      expectedSku: plan.sku,
      expectedUpdatedAt: listing.updated_at,
      listingId: listing.listing_id,
    });
  } catch (error) {
    return {
      ...previewLocalOutcome(plan),
      errorCode: 'sandbox_cleanup_local_failed',
      stage: 'database',
      status: 'failed',
      watcherDirectoryRemoved: true,
    };
  }

  if (!deletedListing) {
    return {
      ...previewLocalOutcome(plan),
      errorCode: 'sandbox_cleanup_state_stale',
      stage: 'database',
      status: 'failed',
      watcherDirectoryRemoved: true,
    };
  }

  return {
    databaseDeleted: true,
    listingId: listing.listing_id,
    r2ObjectCount: plan.objectKeys.length,
    sku: plan.sku,
    status: 'deleted',
    watcherDirectoryRemoved: true,
  };
}

export async function runSandboxListingCleanup(
  input: SandboxCleanupInput & { expectedListingId?: string; expectedUpdatedAt?: string } = {},
  dependencies: SandboxListingCleanupDependencies = {}
): Promise<SandboxListingCleanupRunResult> {
  const env = dependencies.env ?? process.env;
  assertSandboxEnvironment(env);

  if (input.delete && !input.confirmSandboxCleanup) {
    throw new Error('Destructive sandbox cleanup requires --confirm-sandbox-cleanup.');
  }

  const selection = resolveSandboxCleanupCandidateSelection(input);
  const dataAccess = dependencies.dataAccess ?? getSidecarDataAccess();
  const localPlans: LocalCleanupPlan[] = [];

  for (const sku of selection.candidateSkus) {
    localPlans.push(
      await resolveLocalPlan(
        sku,
        {
          expectedListingId: input.expectedListingId,
          expectedUpdatedAt: input.expectedUpdatedAt,
        },
        dataAccess,
        env
      )
    );
  }

  let api: Awaited<ReturnType<typeof resolveSandboxCleanupApi>>;
  let remotePlan: SandboxCleanupResolvedPlan;

  try {
    api = await resolveSandboxCleanupApi(dependencies);
    remotePlan = await resolveSandboxCleanupPlan(input, { api, env });
  } catch (error) {
    throw new SandboxListingDeletionError(
      'sandbox_cleanup_remote_failed',
      502,
      'Remote eBay sandbox resources could not be inspected.',
      { cause: error }
    );
  }

  if (!input.delete) {
    const { inspections: _inspections, ...plan } = remotePlan;
    return {
      ...plan,
      localOutcomes: localPlans.map(previewLocalOutcome),
      mode: 'dry-run',
      outcomes: [],
      success: true,
    };
  }

  const remoteOrphan = remotePlan.inspections.find((inspection) => {
    const localPlan = localPlans.find((candidate) => candidate.sku === inspection.sku);
    return !localPlan?.listing && inspection.inventoryExists;
  });

  if (remoteOrphan) {
    throw new SandboxListingDeletionError(
      'sandbox_cleanup_remote_orphan',
      409,
      `Remote sandbox resources exist for SKU "${remoteOrphan.sku}" but no local listing row matches. Cleanup was refused.`
    );
  }

  const eligibleSkus = new Set(
    localPlans.filter((plan) => plan.listing !== undefined).map((plan) => plan.sku)
  );
  const outcomes = await performSandboxCleanup(
    api,
    remotePlan.inspections.filter(
      (inspection) => eligibleSkus.has(inspection.sku) || !inspection.inventoryExists
    )
  );
  const remoteFailed = outcomes.some((outcome) => outcome.status === 'failed');

  if (remoteFailed) {
    const { inspections: _inspections, ...plan } = remotePlan;
    return {
      ...plan,
      localOutcomes: localPlans.map((localPlan) => ({
        ...previewLocalOutcome(localPlan),
        status: localPlan.listing ? 'preserved' : 'already_missing',
      })),
      mode: 'delete',
      outcomes,
      success: false,
    };
  }

  const localOutcomes: SandboxListingLocalOutcome[] = [];
  for (const localPlan of localPlans) {
    localOutcomes.push(await performLocalCleanup(localPlan, { ...dependencies, dataAccess }));
  }

  const { inspections: _inspections, ...plan } = remotePlan;
  return {
    ...plan,
    localOutcomes,
    mode: 'delete',
    outcomes,
    success: localOutcomes.every((outcome) => outcome.status !== 'failed'),
  };
}

export async function deleteSandboxListingById(
  input: DeleteSandboxListingByIdInput,
  dependencies: SandboxListingCleanupDependencies = {}
): Promise<DeleteSandboxListingSuccess> {
  const report = await runSandboxListingCleanup(
    {
      confirmSandboxCleanup: true,
      delete: true,
      expectedListingId: input.listingId,
      expectedUpdatedAt: input.expectedUpdatedAt,
      skus: [input.expectedSku],
    },
    dependencies
  );
  const remoteOutcome = report.outcomes[0];
  const localOutcome = report.localOutcomes[0];

  if (!remoteOutcome || remoteOutcome.status === 'failed') {
    throw new SandboxListingDeletionError(
      'sandbox_cleanup_remote_failed',
      502,
      `Remote eBay cleanup failed for SKU "${input.expectedSku}".`
    );
  }

  if (!localOutcome || localOutcome.status !== 'deleted') {
    const stale = localOutcome?.errorCode === 'sandbox_cleanup_state_stale';
    throw new SandboxListingDeletionError(
      stale ? 'sandbox_cleanup_state_stale' : 'sandbox_cleanup_local_failed',
      stale ? 409 : 500,
      stale
        ? `Listing "${input.listingId}" changed before database deletion completed. Refresh and retry.`
        : `Local cleanup failed during ${localOutcome?.stage ?? 'unknown'} stage for listing "${input.listingId}".`
    );
  }

  return {
    deleted: true,
    listingId: input.listingId,
    localOutcome: {
      databaseDeleted: true,
      r2ObjectCount: localOutcome.r2ObjectCount,
      status: 'deleted',
      watcherDirectoryRemoved: true,
    },
    remoteOutcome: {
      deletedInventoryItem: remoteOutcome.deletedInventoryItem,
      deletedOfferCount: remoteOutcome.deletedOffers.length,
      endedListingCount: remoteOutcome.endedListings.length,
      missingResourceCount: remoteOutcome.skippedMissing.length,
      status: remoteOutcome.status,
    },
    sku: input.expectedSku,
  };
}
