import { getSidecarDataAccess, type SidecarDataAccess } from '@/data/sidecar-data.js';
import {
  runSidecarJob,
  type RunSidecarJobOptions,
  type RunSidecarJobResult,
} from './run-job.js';

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

export async function runQueuedSidecarJobsOnce(
  options: RunQueuedSidecarJobsOnceOptions = {}
): Promise<RunQueuedSidecarJobsOnceResult> {
  const dataAccess = options.dataAccess ?? getSidecarDataAccess();
  const logger = getLogger(options.logger);
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const runJob = options.runJob ?? runSidecarJob;
  const queuedJobs = await dataAccess.jobs.listQueued({ limit: batchSize });

  let claimedCount = 0;
  let executedCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  for (const queuedJob of queuedJobs) {
    const claimedJob = await dataAccess.jobs.claimQueued(queuedJob.id);

    if (!claimedJob) {
      skippedCount += 1;
      logger.info('Skipped already-claimed sidecar job.', {
        jobId: queuedJob.id,
        jobType: queuedJob.job_type,
      });
      continue;
    }

    claimedCount += 1;
    logger.info('Starting sidecar job.', {
      jobId: claimedJob.id,
      jobType: claimedJob.job_type,
    });

    try {
      const result = await runJob(claimedJob.id, {
        dataAccess,
        generateListingDraft: options.generateListingDraft,
        now: options.now,
        prepareRecordCreatedListings: options.prepareRecordCreatedListings,
      });

      executedCount += 1;
      logger.info('Finished sidecar job.', {
        jobId: claimedJob.id,
        jobType: claimedJob.job_type,
        status: result.job.status,
      });
    } catch (error) {
      failedCount += 1;
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
