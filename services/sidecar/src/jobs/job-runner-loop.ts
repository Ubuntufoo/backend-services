import { getSidecarDataAccess, type SidecarDataAccess } from '@/data/sidecar-data.js';
import type { Json } from '@ebay-inventory/data';
import {
  publishListing as publishApprovedListing,
  type PublishListingDependencies,
  type PublishListingResult,
} from '@/ebay/publish-listing.js';
import { PublishListingError } from '@/ebay/publish-validation.js';
import {
  runSidecarJob,
  type RunSidecarJobOptions,
  type RunSidecarJobResult,
} from './run-job.js';
import {
  createRetryExhaustedError,
  createStaleWorkerError,
  SidecarJobError,
  toJobErrorUpdateInput,
  toListingErrorContext,
} from './job-errors.js';
import { getNextRetryAt, getStaleLeaseMs, hasAttemptsRemaining } from './retry-policy.js';

const DEFAULT_BATCH_SIZE = 1;
const DEFAULT_POLL_INTERVAL_MS = 5_000;

type RunJobFn = (jobId: string, options?: RunSidecarJobOptions) => Promise<RunSidecarJobResult>;
type PublishListingFn = (
  listingId: string,
  dependencies?: Partial<PublishListingDependencies>
) => Promise<PublishListingResult>;

export interface SidecarJobRunnerLogger {
  error(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
}

export interface RunQueuedSidecarJobsOnceOptions extends RunSidecarJobOptions {
  batchSize?: number;
  dataAccess?: SidecarDataAccess;
  logger?: SidecarJobRunnerLogger;
  publishListing?: PublishListingFn;
  runJob?: RunJobFn;
}

export interface RunQueuedSidecarJobsOnceResult {
  claimedCount: number;
  executedCount: number;
  failedCount: number;
  publishClaimedCount: number;
  publishExecutedCount: number;
  publishFailedCount: number;
  publishQueuedCount: number;
  publishSkippedCount: number;
  queuedCount: number;
  skippedCount: number;
}

export interface StartSidecarJobRunnerLoopOptions extends RunQueuedSidecarJobsOnceOptions {
  pollIntervalMs?: number;
  runOnce?: (options?: RunQueuedSidecarJobsOnceOptions) => Promise<RunQueuedSidecarJobsOnceResult>;
}

export interface SidecarJobRunnerLoopHandle {
  isRunning(): boolean;
  stop(): void;
}

interface ActiveLoopState {
  handle: SidecarJobRunnerLoopHandle;
  stopped: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

const defaultLogger: SidecarJobRunnerLogger = {
  info(message, context) {
    console.log(formatLogMessage(message, context));
  },
  error(message, context) {
    console.error(formatLogMessage(message, context));
  },
};

let activeLoopState: ActiveLoopState | null = null;

function formatLogMessage(message: string, context?: Record<string, unknown>): string {
  if (!context || Object.keys(context).length === 0) {
    return message;
  }

  return `${message} ${JSON.stringify(context)}`;
}

function asErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
}

function asErrorStage(error: unknown): string | undefined {
  if (
    typeof error === 'object' &&
    error !== null &&
    'context' in error &&
    typeof error.context === 'object' &&
    error.context !== null &&
    'stage' in error.context &&
    typeof error.context.stage === 'string'
  ) {
    return error.context.stage;
  }

  return undefined;
}

function asErrorIssues(error: unknown): string[] | undefined {
  if (
    typeof error === 'object' &&
    error !== null &&
    'context' in error &&
    typeof error.context === 'object' &&
    error.context !== null &&
    'issues' in error.context &&
    Array.isArray(error.context.issues)
  ) {
    return error.context.issues.filter((issue): issue is string => typeof issue === 'string');
  }

  return undefined;
}

function isFinalizationError(error: unknown): error is PublishListingError {
  return error instanceof PublishListingError && error.code === 'EXPORT_STATE_PERSIST_FAILED';
}

function asIsoTimestamp(now: () => Date): string {
  return now().toISOString();
}

function getLogger(logger?: SidecarJobRunnerLogger): SidecarJobRunnerLogger {
  return logger ?? defaultLogger;
}

function stopLoopState(state: ActiveLoopState): void {
  state.stopped = true;

  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }

  if (activeLoopState === state) {
    activeLoopState = null;
  }
}

async function markPublishInconsistency(
  dataAccess: SidecarDataAccess,
  listingId: string,
  errorAt: string,
  error: unknown
): Promise<void> {
  const context = Object.fromEntries(
    Object.entries({
      code: asErrorCode(error),
      stage: asErrorStage(error),
    }).filter(([, value]) => value !== undefined)
  ) as Json;

  await dataAccess.listings.update(listingId, {
    last_error_at: errorAt,
    last_error_code: asErrorCode(error) ?? 'publish_inconsistent',
    last_error_context: context,
    last_error_message: asErrorMessage(error),
  });
}

async function repairGenerateAiListing(
  dataAccess: SidecarDataAccess,
  listingId: string,
  error: SidecarJobError,
  errorAt: string
): Promise<void> {
  await dataAccess.listings.update(listingId, {
    last_error_at: errorAt,
    last_error_code: error.code,
    last_error_context: toListingErrorContext(error),
    last_error_message: error.message,
    status: 'assets_ready',
    sub_status: 'ready_to_generate',
  });
}

async function recoverStaleGenerateAiJob(
  dataAccess: SidecarDataAccess,
  job: RunSidecarJobResult['job'],
  now: () => Date,
  logger: SidecarJobRunnerLogger
): Promise<void> {
  const errorAt = asIsoTimestamp(now);
  const listingId = job.listing_id;
  const staleError = createStaleWorkerError(job);

  if (listingId) {
    try {
      await repairGenerateAiListing(dataAccess, listingId, staleError, errorAt);
    } catch (error) {
      logger.error('Failed to repair stale generate_ai listing.', {
        error: asErrorMessage(error),
        jobId: job.id,
        listingId,
      });
    }
  }

  if (hasAttemptsRemaining(job)) {
    await dataAccess.jobs.requeue(
      job.id,
      toJobErrorUpdateInput(staleError, errorAt),
      getNextRetryAt(job.attempts, now())
    );
    return;
  }

  const exhaustedError = createRetryExhaustedError(job, staleError);
  await dataAccess.jobs.fail(job.id, toJobErrorUpdateInput(exhaustedError, errorAt));
}

async function recoverStaleProcessImagesJob(
  dataAccess: SidecarDataAccess,
  job: RunSidecarJobResult['job'],
  now: () => Date
): Promise<void> {
  const errorAt = asIsoTimestamp(now);
  const staleError = createStaleWorkerError(job);

  if (hasAttemptsRemaining(job)) {
    await dataAccess.jobs.requeue(
      job.id,
      toJobErrorUpdateInput(staleError, errorAt),
      getNextRetryAt(job.attempts, now())
    );
    return;
  }

  const exhaustedError = createRetryExhaustedError(job, staleError);
  await dataAccess.jobs.fail(job.id, toJobErrorUpdateInput(exhaustedError, errorAt));
}

async function recoverStaleRunningJobs(
  dataAccess: SidecarDataAccess,
  now: () => Date,
  logger: SidecarJobRunnerLogger
): Promise<void> {
  const cutoff = new Date(now().getTime() - getStaleLeaseMs()).toISOString();
  const staleJobs = await dataAccess.jobs.listStaleRunning(cutoff);

  for (const job of staleJobs) {
    if (job.job_type === 'generate_ai') {
      await recoverStaleGenerateAiJob(dataAccess, job, now, logger);
      continue;
    }

    if (job.job_type === 'process_images') {
      await recoverStaleProcessImagesJob(dataAccess, job, now);
    }
  }
}

async function runApprovedListingPublishesOnce(
  options: RunQueuedSidecarJobsOnceOptions,
  logger: SidecarJobRunnerLogger
): Promise<Pick<
  RunQueuedSidecarJobsOnceResult,
  | 'publishClaimedCount'
  | 'publishExecutedCount'
  | 'publishFailedCount'
  | 'publishQueuedCount'
  | 'publishSkippedCount'
>> {
  const dataAccess = options.dataAccess ?? getSidecarDataAccess();
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const publishListing = options.publishListing ?? publishApprovedListing;
  const approvedListings = await dataAccess.listings.listApprovedForExport({
    limit: batchSize,
    queuedOnly: true,
  });

  let publishClaimedCount = 0;
  let publishExecutedCount = 0;
  let publishFailedCount = 0;
  let publishSkippedCount = 0;

  for (const listing of approvedListings) {
    const claimedListing = await dataAccess.listings.claimApprovedForPublish(listing.listing_id);

    if (!claimedListing) {
      publishSkippedCount += 1;
      logger.info('Skipped publish listing claim (already claimed or no longer queued).', {
        listingId: listing.listing_id,
      });
      continue;
    }

    publishClaimedCount += 1;
    logger.info('Starting listing publish.', {
      listingId: claimedListing.listing_id,
      status: claimedListing.status,
      subStatus: claimedListing.sub_status,
    });

    try {
      const result = await publishListing(claimedListing.listing_id, {
        dataAccess,
        now: options.now,
      });

      publishExecutedCount += 1;
      logger.info('Finished listing publish.', {
        ebayListingId: result.ebayListingId,
        exportedAt: result.exportedAt,
        listingId: claimedListing.listing_id,
        offerId: result.offerId,
        sku: result.sku,
        status: result.status,
      });
    } catch (error) {
      publishFailedCount += 1;

      if (isFinalizationError(error)) {
        logger.error('Listing publish finalized externally but failed local persistence.', {
          error: asErrorMessage(error),
          errorCode: error.code,
          listingId: claimedListing.listing_id,
          stage: error.context.stage,
        });

        try {
          await markPublishInconsistency(
            dataAccess,
            claimedListing.listing_id,
            (options.now ?? (() => new Date()))().toISOString(),
            error
          );
        } catch (cleanupError) {
          logger.error('Failed to persist listing publish inconsistency.', {
            cleanupError: asErrorMessage(cleanupError),
            error: asErrorMessage(error),
            errorCode: error.code,
            listingId: claimedListing.listing_id,
            stage: error.context.stage,
          });
        }

        continue;
      }

      try {
        await dataAccess.listings.markPublishFailed(
          claimedListing.listing_id,
          (options.now ?? (() => new Date()))().toISOString(),
          error
        );
      } catch (cleanupError) {
        logger.error('Failed to persist listing publish failure.', {
          cleanupError: asErrorMessage(cleanupError),
          error: asErrorMessage(error),
          errorCode: asErrorCode(error),
          issues: asErrorIssues(error),
          listingId: claimedListing.listing_id,
          stage: asErrorStage(error),
        });
        continue;
      }

      logger.error('Listing publish failed.', {
        error: asErrorMessage(error),
        errorCode: asErrorCode(error),
        issues: asErrorIssues(error),
        listingId: claimedListing.listing_id,
        stage: asErrorStage(error),
      });
    }
  }

  return {
    publishClaimedCount,
    publishExecutedCount,
    publishFailedCount,
    publishQueuedCount: approvedListings.length,
    publishSkippedCount,
  };
}

export async function runQueuedSidecarJobsOnce(
  options: RunQueuedSidecarJobsOnceOptions = {}
): Promise<RunQueuedSidecarJobsOnceResult> {
  const dataAccess = options.dataAccess ?? getSidecarDataAccess();
  const logger = getLogger(options.logger);
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const runJob = options.runJob ?? runSidecarJob;
  const now = options.now ?? (() => new Date());

  await recoverStaleRunningJobs(dataAccess, now, logger);

  const queuedJobs = await dataAccess.jobs.listDueQueued(asIsoTimestamp(now), { limit: batchSize });

  let claimedCount = 0;
  let executedCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  for (const queuedJob of queuedJobs) {
    const claimedJob = await dataAccess.jobs.claimDueQueued(queuedJob.id, asIsoTimestamp(now));

    if (!claimedJob) {
      skippedCount += 1;
      logger.info('Skipped already-claimed sidecar job.', {
        jobId: queuedJob.id,
        jobType: queuedJob.job_type,
      });
      continue;
    }

    claimedCount += 1;
    if (claimedJob.job_type === 'generate_ai') {
      logger.info('Starting generate_ai job.', {
        jobId: claimedJob.id,
        jobType: claimedJob.job_type,
        listingId: claimedJob.listing_id,
      });
    } else {
      logger.info('Starting sidecar job.', {
        jobId: claimedJob.id,
        jobType: claimedJob.job_type,
      });
    }

    try {
      const result = await runJob(claimedJob.id, {
        dataAccess,
        generateListingDraft: options.generateListingDraft,
        now: options.now,
        prepareRecordCreatedListings: options.prepareRecordCreatedListings,
      });

      executedCount += 1;
      if (claimedJob.job_type === 'generate_ai') {
        logger.info('Finished generate_ai job.', {
          jobId: claimedJob.id,
          jobType: claimedJob.job_type,
          listingId: claimedJob.listing_id,
          status: result.job.status,
          listingStatus: result.listing?.status,
          listingSubStatus: result.listing?.sub_status,
        });
      } else {
        logger.info('Finished sidecar job.', {
          jobId: claimedJob.id,
          jobType: claimedJob.job_type,
          status: result.job.status,
        });
      }

      if (claimedJob.job_type === 'process_images' && result.processedListings) {
        for (const listing of result.processedListings) {
          logger.info('Listing moved to assets_ready.', {
            imageUrlCount: listing.image_urls.length,
            listingId: listing.listing_id,
            r2ObjectKeyCount: listing.r2_object_keys.length,
            status: listing.status,
            subStatus: listing.sub_status,
          });
        }
      }
    } catch (error) {
      failedCount += 1;
      logger.error('Sidecar job crashed.', {
        error: asErrorMessage(error),
        jobId: claimedJob.id,
        jobType: claimedJob.job_type,
      });
    }
  }

  const publishResult = await runApprovedListingPublishesOnce({ ...options, dataAccess }, logger);

  return {
    claimedCount,
    executedCount,
    failedCount,
    publishClaimedCount: publishResult.publishClaimedCount,
    publishExecutedCount: publishResult.publishExecutedCount,
    publishFailedCount: publishResult.publishFailedCount,
    publishQueuedCount: publishResult.publishQueuedCount,
    publishSkippedCount: publishResult.publishSkippedCount,
    queuedCount: queuedJobs.length,
    skippedCount,
  };
}

export function startSidecarJobRunnerLoop(
  options: StartSidecarJobRunnerLoopOptions = {}
): SidecarJobRunnerLoopHandle {
  if (activeLoopState && !activeLoopState.stopped) {
    return activeLoopState.handle;
  }

  const logger = getLogger(options.logger);
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const runOnce = options.runOnce ?? runQueuedSidecarJobsOnce;

  const state = {} as ActiveLoopState;

  const tick = async (): Promise<void> => {
    if (state.stopped) {
      return;
    }

    try {
      await runOnce({
        batchSize: options.batchSize,
        dataAccess: options.dataAccess,
        generateListingDraft: options.generateListingDraft,
        logger,
        now: options.now,
        prepareRecordCreatedListings: options.prepareRecordCreatedListings,
        runJob: options.runJob,
      });
    } catch (error) {
      logger.error('Sidecar job runner loop tick failed.', {
        error: asErrorMessage(error),
      });
    } finally {
      if (!state.stopped) {
        state.timer = setTimeout(() => {
          void tick();
        }, pollIntervalMs);
      }
    }
  };

  state.handle = {
    isRunning: () => activeLoopState === state && !state.stopped,
    stop: () => stopLoopState(state),
  };
  state.stopped = false;
  state.timer = setTimeout(() => {
    void tick();
  }, 0);

  activeLoopState = state;
  logger.info('Started sidecar job runner loop.', {
    batchSize: options.batchSize ?? DEFAULT_BATCH_SIZE,
    pollIntervalMs,
  });

  return state.handle;
}

export function stopSidecarJobRunnerLoop(): void {
  if (activeLoopState) {
    activeLoopState.handle.stop();
  }
}
