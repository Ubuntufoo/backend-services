import type { JobRow, ListingRow, ListingUpdate } from '@ebay-inventory/data';
import type { SidecarDataAccess } from '@/data/sidecar-data.js';
import {
  createDuplicateActiveJobError,
  createManualRetryNotAllowedError,
  isManualRetryAllowedStoredError,
  JOB_ERROR_CODES,
  SidecarJobError,
} from './job-errors.js';

export type ManualRetryWorkflow = 'generate_ai' | 'publish';

export interface ManualRetryListingWorkflowResult {
  alreadyQueued: boolean;
  workflow: ManualRetryWorkflow;
  job: JobRow;
  listing: ListingRow;
}

export interface ManualRetryListingWorkflowOptions {
  dataAccess: SidecarDataAccess;
  listingId: string;
  now?: () => Date;
}

type ListingRetryState = 'missing' | 'orphan' | 'safe';

function asIsoTimestamp(now: () => Date): string {
  return now().toISOString();
}

function sortJobsNewestFirst(jobs: JobRow[]): JobRow[] {
  return [...jobs].sort((left, right) => {
    const updatedOrder = right.updated_at.localeCompare(left.updated_at);
    return updatedOrder !== 0 ? updatedOrder : right.created_at.localeCompare(left.created_at);
  });
}

function getWorkflowJobType(workflow: ManualRetryWorkflow): JobRow['job_type'] {
  return workflow;
}

function getWorkflowJobs(
  jobs: JobRow[],
  workflow: ManualRetryWorkflow
): JobRow[] {
  const jobType = getWorkflowJobType(workflow);
  return sortJobsNewestFirst(jobs).filter((job) => job.job_type === jobType);
}

function getActiveWorkflowJob(
  jobs: JobRow[],
  workflow: ManualRetryWorkflow
): JobRow | null {
  return (
    getWorkflowJobs(jobs, workflow).find(
      (job) => job.status === 'queued' || job.status === 'running'
    ) ?? null
  );
}

function getLatestWorkflowJob(
  jobs: JobRow[],
  workflow: ManualRetryWorkflow
): JobRow | null {
  return getWorkflowJobs(jobs, workflow)[0] ?? null;
}

function getGenerateAiRetryState(listing: ListingRow): ListingRetryState {
  if (listing.status === 'assets_ready' && listing.sub_status === 'ready_to_generate') {
    return 'safe';
  }

  if (listing.status === 'generating') {
    return 'orphan';
  }

  if (listing.status === 'needs_review') {
    return 'orphan';
  }

  return 'missing';
}

function getPublishRetryState(listing: ListingRow): ListingRetryState {
  if (
    listing.status === 'approved_for_export' &&
    (listing.sub_status === 'idle' || listing.sub_status === 'publish_queued')
  ) {
    return 'safe';
  }

  if (listing.status === 'approved_for_export' && listing.sub_status === 'publishing_to_ebay') {
    return 'orphan';
  }

  return 'missing';
}

function resolveWorkflow(listing: ListingRow): ManualRetryWorkflow {
  if (
    listing.status === 'assets_ready' ||
    listing.status === 'generating' ||
    listing.status === 'needs_review'
  ) {
    return 'generate_ai';
  }

  if (listing.status === 'approved_for_export') {
    return 'publish';
  }

  throw createManualRetryNotAllowedError(
    `Listing "${listing.listing_id}" cannot be retried from status "${listing.status}/${listing.sub_status}".`,
    {
      listing_id: listing.listing_id,
      listing_status: listing.status,
      listing_sub_status: listing.sub_status,
    }
  );
}

function getRetryState(
  listing: ListingRow,
  workflow: ManualRetryWorkflow
): ListingRetryState {
  return workflow === 'generate_ai'
    ? getGenerateAiRetryState(listing)
    : getPublishRetryState(listing);
}

function buildListingRetryUpdate(workflow: ManualRetryWorkflow): ListingUpdate {
  if (workflow === 'generate_ai') {
    return {
      last_error_at: null,
      last_error_code: null,
      last_error_context: {},
      last_error_message: null,
      status: 'assets_ready',
      sub_status: 'ready_to_generate',
    };
  }

  return {
    last_error_at: null,
    last_error_code: null,
    last_error_context: {},
    last_error_message: null,
    status: 'approved_for_export',
    sub_status: 'publish_queued',
  };
}

function assertListingRetryable(
  listing: ListingRow,
  workflow: ManualRetryWorkflow,
  latestWorkflowJob: JobRow | null
): void {
  const retryState = getRetryState(listing, workflow);

  if (retryState === 'missing') {
    throw createManualRetryNotAllowedError(
      `Listing "${listing.listing_id}" is not in a retryable ${workflow} state.`,
      {
        listing_id: listing.listing_id,
        listing_status: listing.status,
        listing_sub_status: listing.sub_status,
        workflow,
      }
    );
  }

  if (!latestWorkflowJob) {
    if (listing.status === 'needs_review') {
      throw createManualRetryNotAllowedError(
        `Listing "${listing.listing_id}" needs a failed generate_ai job before manual retry is allowed.`,
        {
          listing_id: listing.listing_id,
          workflow,
        }
      );
    }

    if (retryState === 'safe' || retryState === 'orphan') {
      return;
    }

    throw createManualRetryNotAllowedError(
      `Listing "${listing.listing_id}" does not have a retryable ${workflow} job history.`,
      {
        listing_id: listing.listing_id,
        workflow,
      }
    );
  }

  if (latestWorkflowJob.status === 'completed') {
    throw createManualRetryNotAllowedError(
      `Listing "${listing.listing_id}" already completed ${workflow} and cannot be manually retried.`,
      {
        job_id: latestWorkflowJob.id,
        listing_id: listing.listing_id,
        workflow,
      }
    );
  }

  if (latestWorkflowJob.status !== 'failed') {
    if (retryState === 'safe' || retryState === 'orphan') {
      return;
    }

    throw createManualRetryNotAllowedError(
      `Listing "${listing.listing_id}" does not have a failed ${workflow} job to retry.`,
      {
        job_id: latestWorkflowJob.id,
        job_status: latestWorkflowJob.status,
        listing_id: listing.listing_id,
        workflow,
      }
    );
  }

  const allowed = isManualRetryAllowedStoredError(
    latestWorkflowJob.last_error_code ?? listing.last_error_code,
    listing.last_error_context
  );

  if (!allowed) {
    throw createManualRetryNotAllowedError(
      `Latest ${workflow} failure for listing "${listing.listing_id}" is not manually retryable.`,
      {
        job_id: latestWorkflowJob.id,
        job_last_error_code: latestWorkflowJob.last_error_code,
        listing_id: listing.listing_id,
        workflow,
      }
    );
  }
}

async function enqueueWorkflowJob(
  dataAccess: SidecarDataAccess,
  listingId: string,
  workflow: ManualRetryWorkflow
): Promise<{ alreadyQueued: boolean; job: JobRow }> {
  if (workflow === 'generate_ai') {
    return await dataAccess.jobs.enqueueGenerateAi(listingId);
  }

  return await dataAccess.jobs.enqueuePublish(listingId);
}

export async function retryListingWorkflow(
  options: ManualRetryListingWorkflowOptions
): Promise<ManualRetryListingWorkflowResult> {
  const now = options.now ?? (() => new Date());
  const listing = await options.dataAccess.listings.getByListingId(options.listingId);

  if (!listing) {
    throw new SidecarJobError(
      JOB_ERROR_CODES.JOB_NOT_FOUND,
      'terminal',
      `Listing "${options.listingId}" was not found.`
    );
  }

  const jobs = await options.dataAccess.jobs.listByListingId(options.listingId);
  const workflow = resolveWorkflow(listing);
  const activeJob = getActiveWorkflowJob(jobs, workflow);

  if (activeJob) {
    createDuplicateActiveJobError(workflow, listing.listing_id, activeJob.id);
    return {
      alreadyQueued: true,
      workflow,
      job: activeJob,
      listing,
    };
  }

  const latestWorkflowJob = getLatestWorkflowJob(jobs, workflow);
  assertListingRetryable(listing, workflow, latestWorkflowJob);

  const repairedListing = await options.dataAccess.listings.update(
    listing.listing_id,
    buildListingRetryUpdate(workflow)
  );

  if (latestWorkflowJob?.status === 'failed') {
    const resetJob = await options.dataAccess.jobs.resetForManualRetry(
      latestWorkflowJob.id,
      asIsoTimestamp(now)
    );

    if (resetJob) {
      return {
        alreadyQueued: false,
        workflow,
        job: resetJob,
        listing: repairedListing,
      };
    }
  }

  const enqueueResult = await enqueueWorkflowJob(options.dataAccess, listing.listing_id, workflow);
  return {
    alreadyQueued: enqueueResult.alreadyQueued,
    workflow,
    job: enqueueResult.job,
    listing: repairedListing,
  };
}
