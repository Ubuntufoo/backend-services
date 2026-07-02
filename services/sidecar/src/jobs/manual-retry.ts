import type { JobRow, ListingPriceResearchRow, ListingRow, ListingUpdate } from '@ebay-inventory/data';
import type { SidecarDataAccess } from '@/data/sidecar-data.js';
import {
  createDuplicateActiveJobError,
  createManualRetryNotAllowedError,
  isManualRetryAllowedStoredError,
  JOB_ERROR_CODES,
  type JobErrorContext,
  SidecarJobError,
} from './job-errors.js';
import { isResearchPriceListingEligible } from './research-price-job.js';

export type ManualRetryWorkflow = 'generate_ai' | 'publish';
export type PricingRetryWorkflow = 'research_price';

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

export interface RetryPricingReviewResult {
  alreadyQueued: false;
  job: JobRow;
  listing: ListingRow;
  workflow: PricingRetryWorkflow;
}

export type RetryPricingReviewErrorCode =
  | 'duplicate_active_job'
  | 'ineligible_listing'
  | 'no_failed_pricing_evidence'
  | 'non_retryable_pricing_failure'
  | 'not_found';

export class RetryPricingReviewError extends Error {
  readonly code: RetryPricingReviewErrorCode;

  constructor(code: RetryPricingReviewErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RetryPricingReviewError';
    this.code = code;
  }
}

type ListingRetryState = 'missing' | 'orphan' | 'safe';

type ListingErrorFields = Pick<
  ListingUpdate,
  'last_error_at' | 'last_error_code' | 'last_error_context' | 'last_error_message'
>;

function asIsoTimestamp(now: () => Date): string {
  return now().toISOString();
}

function sortJobsNewestFirst(jobs: JobRow[]): JobRow[] {
  return [...jobs].sort((left, right) => {
    const updatedOrder = right.updated_at.localeCompare(left.updated_at);
    return updatedOrder !== 0 ? updatedOrder : right.created_at.localeCompare(left.created_at);
  });
}

function getWorkflowJobs(
  jobs: JobRow[],
  workflow: ManualRetryWorkflow | PricingRetryWorkflow
): JobRow[] {
  return sortJobsNewestFirst(jobs.filter((job) => job.job_type === workflow));
}

function getActiveWorkflowJob(
  jobs: JobRow[],
  workflow: ManualRetryWorkflow | PricingRetryWorkflow
): JobRow | null {
  return (
    getWorkflowJobs(jobs, workflow).find(
      (job) => job.status === 'queued' || job.status === 'running'
    ) ?? null
  );
}

function getLatestWorkflowJob(
  jobs: JobRow[],
  workflow: ManualRetryWorkflow | PricingRetryWorkflow
): JobRow | null {
  return getWorkflowJobs(jobs, workflow)[0] ?? null;
}

function getLatestFailedPricingResearch(
  research: ListingPriceResearchRow | null
): ListingPriceResearchRow | null {
  return research?.status === 'failed' ? research : null;
}

function isRetryablePricingFailureCode(
  code: string | null | undefined
): code is typeof JOB_ERROR_CODES.RESEARCH_PRICE_SUGGESTED_PRICE_INVALID {
  return code === JOB_ERROR_CODES.RESEARCH_PRICE_SUGGESTED_PRICE_INVALID;
}

function assertPricingReviewRetryable(input: {
  latestPricingJob: JobRow | null;
  latestResearch: ListingPriceResearchRow | null;
  listing: ListingRow;
}): void {
  if (!isResearchPriceListingEligible(input.listing)) {
    throw new RetryPricingReviewError(
      'ineligible_listing',
      `Listing "${input.listing.listing_id}" is not eligible for full pricing retry from "${input.listing.status}/${input.listing.sub_status}".`
    );
  }

  const failedResearch = getLatestFailedPricingResearch(input.latestResearch);
  if (!failedResearch) {
    throw new RetryPricingReviewError(
      'no_failed_pricing_evidence',
      `Listing "${input.listing.listing_id}" has no failed pricing research to retry.`
    );
  }

  if (!isRetryablePricingFailureCode(failedResearch.error_code)) {
    throw new RetryPricingReviewError(
      'non_retryable_pricing_failure',
      `Latest pricing failure for listing "${input.listing.listing_id}" is not eligible for full pricing retry.`
    );
  }

  if (
    input.latestPricingJob?.status === 'failed' &&
    isRetryablePricingFailureCode(input.latestPricingJob.last_error_code)
  ) {
    return;
  }

  if (!input.latestPricingJob || input.latestPricingJob.status === 'completed') {
    return;
  }

  if (input.latestPricingJob.status === 'queued' || input.latestPricingJob.status === 'running') {
    throw new RetryPricingReviewError(
      'duplicate_active_job',
      `Listing "${input.listing.listing_id}" already has an active research_price job.`
    );
  }

  throw new RetryPricingReviewError(
    'no_failed_pricing_evidence',
    `Listing "${input.listing.listing_id}" has no failed research_price job to retry.`
  );
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
  if (listing.status === 'assets_ready' || listing.status === 'generating') {
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

function assertNeedsReviewGenerateAiRetryable(
  listing: ListingRow,
  latestGenerateAiJob: JobRow | null
): void {
  if (!latestGenerateAiJob || latestGenerateAiJob.status !== 'failed') {
    const context = Object.fromEntries(
      Object.entries({
        job_id: latestGenerateAiJob?.id,
        job_status: latestGenerateAiJob?.status,
        listing_id: listing.listing_id,
        listing_status: listing.status,
        listing_sub_status: listing.sub_status,
        workflow: 'generate_ai',
      }).filter(([, value]) => value !== undefined)
    ) as JobErrorContext;

    throw createManualRetryNotAllowedError(
      `Listing "${listing.listing_id}" needs explicit failed generate_ai job evidence before manual retry is allowed from needs_review.`,
      context
    );
  }
}

function getRetryState(
  listing: ListingRow,
  workflow: ManualRetryWorkflow
): ListingRetryState {
  return workflow === 'generate_ai'
    ? getGenerateAiRetryState(listing)
    : getPublishRetryState(listing);
}

function buildClearedListingErrorFields(): ListingErrorFields {
  return {
    last_error_at: null,
    last_error_code: null,
    last_error_context: {},
    last_error_message: null,
  };
}

function buildListingRetryUpdate(workflow: ManualRetryWorkflow): ListingUpdate {
  if (workflow === 'generate_ai') {
    return {
      ...buildClearedListingErrorFields(),
      status: 'assets_ready',
      sub_status: 'ready_to_generate',
    };
  }

  return {
    ...buildClearedListingErrorFields(),
    status: 'approved_for_export',
    sub_status: 'publish_queued',
  };
}

function buildListingRetryRevertUpdate(listing: ListingRow): ListingUpdate {
  return {
    last_error_at: listing.last_error_at,
    last_error_code: listing.last_error_code,
    last_error_context: listing.last_error_context,
    last_error_message: listing.last_error_message,
    status: listing.status,
    sub_status: listing.sub_status,
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
    return dataAccess.jobs.enqueueGenerateAi(listingId);
  }

  return dataAccess.jobs.enqueuePublish(listingId);
}

export async function retryListingWorkflow(
  options: ManualRetryListingWorkflowOptions
): Promise<ManualRetryListingWorkflowResult> {
  const now = options.now ?? (() => new Date());
  const listing = await options.dataAccess.listings.getByListingId(options.listingId);

  if (!listing) {
    throw new SidecarJobError(
      JOB_ERROR_CODES.LISTING_NOT_FOUND,
      'terminal',
      `Listing "${options.listingId}" was not found.`
    );
  }

  const jobs = await options.dataAccess.jobs.listByListingId(options.listingId);
  const needsReviewGenerateAiJob =
    listing.status === 'needs_review' ? getLatestWorkflowJob(jobs, 'generate_ai') : null;

  if (listing.status === 'needs_review') {
    assertNeedsReviewGenerateAiRetryable(listing, needsReviewGenerateAiJob);
  }

  const workflow = listing.status === 'needs_review' ? 'generate_ai' : resolveWorkflow(listing);
  const activeJob = getActiveWorkflowJob(jobs, workflow);

  if (activeJob) {
    return {
      alreadyQueued: true,
      workflow,
      job: activeJob,
      listing,
    };
  }

  const latestWorkflowJob =
    workflow === 'generate_ai' && needsReviewGenerateAiJob
      ? needsReviewGenerateAiJob
      : getLatestWorkflowJob(jobs, workflow);
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

  if (enqueueResult.alreadyQueued) {
    const restoredListing = await options.dataAccess.listings.update(
      listing.listing_id,
      buildListingRetryRevertUpdate(listing)
    );

    return {
      alreadyQueued: true,
      workflow,
      job: enqueueResult.job,
      listing: restoredListing,
    };
  }

  return {
    alreadyQueued: enqueueResult.alreadyQueued,
    workflow,
    job: enqueueResult.job,
    listing: repairedListing,
  };
}

export async function retryPricingReview(options: {
  dataAccess: SidecarDataAccess;
  listingId: string;
  now?: () => Date;
}): Promise<RetryPricingReviewResult> {
  const now = options.now ?? (() => new Date());
  const listing = await options.dataAccess.listings.getByListingId(options.listingId);

  if (!listing) {
    throw new RetryPricingReviewError(
      'not_found',
      `Listing "${options.listingId}" was not found.`
    );
  }

  const [jobs, latestResearch] = await Promise.all([
    options.dataAccess.jobs.listByListingId(options.listingId),
    options.dataAccess.listingPriceResearch.getLatestByListingId(options.listingId),
  ]);
  const activeJob = getActiveWorkflowJob(jobs, 'research_price');
  if (activeJob) {
    throw createDuplicateActiveJobError('research_price', options.listingId, activeJob.id);
  }

  const latestPricingJob = getLatestWorkflowJob(jobs, 'research_price');
  assertPricingReviewRetryable({
    latestPricingJob,
    latestResearch,
    listing,
  });

  if (latestPricingJob?.status === 'failed') {
    const resetJob = await options.dataAccess.jobs.resetForManualRetry(
      latestPricingJob.id,
      asIsoTimestamp(now)
    );

    if (resetJob) {
      return {
        alreadyQueued: false,
        job: resetJob,
        listing,
        workflow: 'research_price',
      };
    }
  }

  const enqueueResult = await options.dataAccess.jobs.enqueueResearchPrice(options.listingId);
  if (enqueueResult.alreadyQueued) {
    throw createDuplicateActiveJobError(
      'research_price',
      options.listingId,
      enqueueResult.job.id
    );
  }

  return {
    alreadyQueued: false,
    job: enqueueResult.job,
    listing,
    workflow: 'research_price',
  };
}
