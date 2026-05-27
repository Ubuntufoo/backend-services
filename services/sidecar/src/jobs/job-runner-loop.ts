import { getSidecarDataAccess, type SidecarDataAccess } from '@/data/sidecar-data.js';
import {
  runSidecarJob,
  type RunSidecarJobOptions,
  type RunSidecarJobResult,
} from './run-job.js';
import {
  createOrphanActiveStateError,
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

export interface SidecarJobRunnerLogger {
  error(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
}

export interface RunQueuedSidecarJobsOnceOptions extends RunSidecarJobOptions {
  batchSize?: number;
  dataAccess?: SidecarDataAccess;
  logger?: SidecarJobRunnerLogger;
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

function asIsoTimestamp(now: () => Date): string {
  return now().toISOString();
}

function getLatestWorkflowJob(
  jobs: RunSidecarJobResult['job'][],
  workflow: 'generate_ai' | 'publish'
): RunSidecarJobResult['job'] | null {
  return (
    [...jobs]
      .filter((job) => job.job_type === workflow)
      .sort((left, right) => {
        const updatedOrder = right.updated_at.localeCompare(left.updated_at);
        return updatedOrder !== 0 ? updatedOrder : right.created_at.localeCompare(left.created_at);
      })[0] ?? null
  );
}

function hasActiveWorkflowJob(
  jobs: RunSidecarJobResult['job'][],
  workflow: 'generate_ai' | 'publish'
): boolean {
  return jobs.some(
    (job) =>
      job.job_type === workflow && (job.status === 'queued' || job.status === 'running')
  );
}

async function loadJobsByListingIds(
  dataAccess: SidecarDataAccess,
  listingIds: string[]
): Promise<Map<string, RunSidecarJobResult['job'][]>> {
  if (listingIds.length === 0) {
    return new Map();
  }

  const jobs = dataAccess.jobs.listByListingIds
    ? await dataAccess.jobs.listByListingIds(listingIds)
    : (await Promise.all(listingIds.map(async (listingId) => dataAccess.jobs.listByListingId(listingId)))).flat();

  const groupedJobs = new Map<string, RunSidecarJobResult['job'][]>();

  for (const job of jobs) {
    if (!job.listing_id) {
      continue;
    }

    const existingJobs = groupedJobs.get(job.listing_id) ?? [];
    existingJobs.push(job);
    groupedJobs.set(job.listing_id, existingJobs);
  }

  return groupedJobs;
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

async function repairPublishListing(
  dataAccess: SidecarDataAccess,
  listingId: string,
  error: SidecarJobError,
  errorAt: string,
  subStatus: 'idle' | 'publish_queued'
): Promise<void> {
  const listing = await dataAccess.listings.getByListingId(listingId);

  if (!listing || listing.status !== 'approved_for_export') {
    return;
  }

  await dataAccess.listings.update(listingId, {
    last_error_at: errorAt,
    last_error_code: error.code,
    last_error_context: toListingErrorContext(error),
    last_error_message: error.message,
    status: 'approved_for_export',
    sub_status: subStatus,
  });
}

async function recoverStalePublishJob(
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
      await repairPublishListing(
        dataAccess,
        listingId,
        hasAttemptsRemaining(job) ? staleError : createRetryExhaustedError(job, staleError),
        errorAt,
        hasAttemptsRemaining(job) ? 'publish_queued' : 'idle'
      );
    } catch (error) {
      logger.error('Failed to repair stale publish listing.', {
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
      continue;
    }
    if (job.job_type === 'publish') {
      await recoverStalePublishJob(dataAccess, job, now, logger);
    }
  }
}

async function repairOrphanedGenerateAiListings(
  dataAccess: SidecarDataAccess,
  limit: number,
  errorAt: string,
  logger: SidecarJobRunnerLogger
): Promise<void> {
  const generatingListings = await dataAccess.listings.listByStatus('generating', {
    limit,
    offset: 0,
    orderByCreatedAt: 'asc',
  });
  const jobsByListingId = await loadJobsByListingIds(
    dataAccess,
    generatingListings.map((listing) => listing.listing_id)
  );

  for (const listing of generatingListings) {
    const jobs = jobsByListingId.get(listing.listing_id) ?? [];

    if (hasActiveWorkflowJob(jobs, 'generate_ai')) {
      continue;
    }

    const latestGenerateAiJob = getLatestWorkflowJob(jobs, 'generate_ai');

    if (latestGenerateAiJob && latestGenerateAiJob.status !== 'failed') {
      continue;
    }

    const orphanError = createOrphanActiveStateError(
      'generate_ai',
      listing,
      latestGenerateAiJob ? 'failed' : 'missing'
    );

    try {
      await dataAccess.listings.update(listing.listing_id, {
        last_error_at: errorAt,
        last_error_code: orphanError.code,
        last_error_context: toListingErrorContext(orphanError),
        last_error_message: orphanError.message,
        status: 'assets_ready',
        sub_status: 'ready_to_generate',
      });
    } catch (error) {
      logger.error('Failed to repair orphan generate_ai listing.', {
        error: asErrorMessage(error),
        listingId: listing.listing_id,
      });
    }
  }
}

async function repairOrphanedPublishListings(
  dataAccess: SidecarDataAccess,
  limit: number,
  errorAt: string,
  logger: SidecarJobRunnerLogger
): Promise<void> {
  const approvedListings = await dataAccess.listings.listApprovedForExport({
    limit,
    queuedOnly: false,
  });
  const orphanPublishListingIds = approvedListings
    .filter((listing) => listing.sub_status === 'publishing_to_ebay')
    .map((listing) => listing.listing_id);
  const jobsByListingId = await loadJobsByListingIds(dataAccess, orphanPublishListingIds);

  for (const listing of approvedListings) {
    if (listing.sub_status !== 'publishing_to_ebay') {
      continue;
    }

    const jobs = jobsByListingId.get(listing.listing_id) ?? [];

    if (hasActiveWorkflowJob(jobs, 'publish')) {
      continue;
    }

    const latestPublishJob = getLatestWorkflowJob(jobs, 'publish');

    if (latestPublishJob && latestPublishJob.status !== 'failed') {
      continue;
    }

    const orphanError = createOrphanActiveStateError(
      'publish',
      listing,
      latestPublishJob ? 'failed' : 'missing'
    );

    try {
      await dataAccess.listings.update(listing.listing_id, {
        last_error_at: errorAt,
        last_error_code: orphanError.code,
        last_error_context: toListingErrorContext(orphanError),
        last_error_message: orphanError.message,
        status: 'approved_for_export',
        sub_status: 'idle',
      });
    } catch (error) {
      logger.error('Failed to repair orphan publish listing.', {
        error: asErrorMessage(error),
        listingId: listing.listing_id,
      });
    }
  }
}

async function repairOrphanedWorkflowStates(
  dataAccess: SidecarDataAccess,
  limit: number,
  now: () => Date,
  logger: SidecarJobRunnerLogger
): Promise<void> {
  const errorAt = asIsoTimestamp(now);
  await repairOrphanedGenerateAiListings(dataAccess, limit, errorAt, logger);
  await repairOrphanedPublishListings(dataAccess, limit, errorAt, logger);
}

async function backfillQueuedPublishJobs(
  dataAccess: SidecarDataAccess,
  limit: number,
  logger: SidecarJobRunnerLogger
): Promise<void> {
  const approvedListings = await dataAccess.listings.listApprovedForExport({
    limit,
    queuedOnly: true,
  });

  for (const listing of approvedListings) {
    const enqueueResult = await dataAccess.jobs.enqueuePublish(listing.listing_id);

    if (!enqueueResult.alreadyQueued) {
      logger.info('Backfilled publish job.', {
        jobId: enqueueResult.job.id,
        listingId: listing.listing_id,
      });
    }
  }
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
  await repairOrphanedWorkflowStates(dataAccess, batchSize, now, logger);
  await backfillQueuedPublishJobs(dataAccess, batchSize, logger);

  const queuedJobs = await dataAccess.jobs.listDueQueued(asIsoTimestamp(now), { limit: batchSize });

  let claimedCount = 0;
  let executedCount = 0;
  let failedCount = 0;
  const publishQueuedCount = queuedJobs.filter((job) => job.job_type === 'publish').length;
  let publishClaimedCount = 0;
  let publishExecutedCount = 0;
  let publishFailedCount = 0;
  let publishSkippedCount = 0;
  let skippedCount = 0;

  for (const queuedJob of queuedJobs) {
    const claimedJob = await dataAccess.jobs.claimDueQueued(queuedJob.id, asIsoTimestamp(now));

    if (!claimedJob) {
      skippedCount += 1;
      if (queuedJob.job_type === 'publish') {
        publishSkippedCount += 1;
      }
      logger.info('Skipped already-claimed sidecar job.', {
        jobId: queuedJob.id,
        jobType: queuedJob.job_type,
      });
      continue;
    }

    claimedCount += 1;
    if (claimedJob.job_type === 'publish') {
      publishClaimedCount += 1;
    }

    if (claimedJob.job_type === 'generate_ai') {
      logger.info('Starting generate_ai job.', {
        jobId: claimedJob.id,
        jobType: claimedJob.job_type,
        listingId: claimedJob.listing_id,
      });
    } else if (claimedJob.job_type === 'publish') {
      logger.info('Starting publish job.', {
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
        publishListing: options.publishListing,
        prepareRecordCreatedListings: options.prepareRecordCreatedListings,
      });

      executedCount += 1;
      if (claimedJob.job_type === 'publish') {
        publishExecutedCount += 1;
      }

      if (claimedJob.job_type === 'generate_ai') {
        logger.info('Finished generate_ai job.', {
          jobId: claimedJob.id,
          jobType: claimedJob.job_type,
          listingId: claimedJob.listing_id,
          status: result.job.status,
          listingStatus: result.listing?.status,
          listingSubStatus: result.listing?.sub_status,
        });
      } else if (claimedJob.job_type === 'publish') {
        logger.info('Finished publish job.', {
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
      if (claimedJob.job_type === 'publish') {
        publishFailedCount += 1;
      }
      logger.error('Sidecar job crashed.', {
        error: asErrorMessage(error),
        jobId: claimedJob.id,
        jobType: claimedJob.job_type,
      });
    }
  }

  return {
    claimedCount,
    executedCount,
    failedCount,
    publishClaimedCount,
    publishExecutedCount,
    publishFailedCount,
    publishQueuedCount,
    publishSkippedCount,
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
