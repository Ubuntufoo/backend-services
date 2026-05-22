import type { JobRow, ListingRow } from '@ebay-inventory/data';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SidecarDataAccess } from '@/data/sidecar-data.js';
import {
  runQueuedSidecarJobsOnce,
  startSidecarJobRunnerLoop,
  stopSidecarJobRunnerLoop,
  type SidecarJobRunnerLogger,
} from '@/jobs/index.js';

function createJobRow(overrides: Partial<JobRow> = {}): JobRow {
  return {
    created_at: '2026-05-22T12:00:00.000Z',
    id: 'job-process-images',
    job_type: 'process_images',
    last_error: null,
    last_error_at: null,
    last_error_code: null,
    listing_id: null,
    next_run_at: null,
    status: 'queued',
    updated_at: '2026-05-22T12:00:00.000Z',
    ...overrides,
  };
}

function createListingRow(overrides: Partial<ListingRow> = {}): ListingRow {
  return {
    approved_for_export_at: null,
    capture_mode: null,
    category_id: null,
    condition_id: null,
    condition_notes: null,
    created_at: '2026-05-22T12:00:00.000Z',
    description: null,
    ebay_listing_id: null,
    ebay_listing_status: null,
    ebay_listing_url: null,
    ebay_offer_id: null,
    ese_eligible: null,
    estimated_weight_oz: null,
    exported_at: null,
    generated_at: null,
    handling_days: null,
    id: 'listing-row-id',
    image_urls: [],
    item_specifics: {},
    last_error_at: null,
    last_error_code: null,
    last_error_context: {},
    last_error_message: null,
    listing_id: 'LIST-001',
    listing_type: 'single',
    merchant_location_key: null,
    package_type: null,
    price: null,
    r2_delete_after: null,
    r2_deleted_at: null,
    r2_object_keys: [],
    r2_retention_policy: null,
    seller_hints: null,
    shipping_profile: null,
    sku: 'SKU-001',
    sold_at: null,
    status: 'record_created',
    sub_status: 'idle',
    title: null,
    updated_at: '2026-05-22T12:00:00.000Z',
    ...overrides,
  };
}

function createLogger(): SidecarJobRunnerLogger {
  return {
    error: vi.fn(),
    info: vi.fn(),
  };
}

function createDataAccess(
  jobs: JobRow[],
  options: {
    claimQueued?: (jobId: string, current: JobRow | null) => JobRow | null;
  } = {}
): {
  dataAccess: SidecarDataAccess;
  jobStates: Map<string, JobRow>;
} {
  const jobStates = new Map(jobs.map((job) => [job.id, { ...job }]));
  const listing = createListingRow();

  const dataAccess: SidecarDataAccess = {
    appSettings: {
      create: vi.fn(),
      get: vi.fn(),
      update: vi.fn(),
    },
    jobs: {
      claimQueued: vi.fn(async (jobId: string) => {
        const current = jobStates.get(jobId) ?? null;
        const claimed = options.claimQueued?.(jobId, current);
        if (claimed !== undefined) {
          if (claimed) {
            jobStates.set(jobId, { ...claimed });
            return { ...claimed };
          }

          return null;
        }

        if (!current || current.status !== 'queued') {
          return null;
        }

        const next = {
          ...current,
          last_error: null,
          last_error_at: null,
          last_error_code: null,
          status: 'running',
        } as JobRow;
        jobStates.set(jobId, next);
        return { ...next };
      }),
      create: vi.fn(),
      enqueueGenerateAi: vi.fn(),
      enqueueProcessImages: vi.fn(),
      getActiveGenerateAiByListingId: vi.fn(),
      getById: vi.fn(async (jobId: string) => {
        const current = jobStates.get(jobId);
        return current ? { ...current } : null;
      }),
      listQueued: vi.fn(async ({ limit = 1 } = {}) =>
        [...jobStates.values()]
          .filter((job) => job.status === 'queued')
          .sort((left, right) => left.created_at.localeCompare(right.created_at))
          .slice(0, limit)
          .map((job) => ({ ...job }))
      ),
      listByListingId: vi.fn(async () => []),
      update: vi.fn(async (jobId: string, changes: Partial<JobRow>) => {
        const current = jobStates.get(jobId);
        if (!current) {
          throw new Error(`Missing job ${jobId}`);
        }

        const next = {
          ...current,
          ...changes,
        } as JobRow;
        jobStates.set(jobId, next);
        return { ...next };
      }),
    },
    listings: {
      create: vi.fn(),
      getByListingId: vi.fn(async () => listing),
      list: vi.fn(async () => [listing]),
      listByStatus: vi.fn(async () => [listing]),
      saveImageMetadata: vi.fn(),
      update: vi.fn(async () => listing),
      updateWorkflowState: vi.fn(async () => listing),
    },
    orders: {
      create: vi.fn(),
      getByOrderId: vi.fn(),
      update: vi.fn(),
    },
  };

  return {
    dataAccess,
    jobStates,
  };
}

afterEach(() => {
  stopSidecarJobRunnerLoop();
  vi.useRealTimers();
});

describe('job runner loop', () => {
  it('runs a queued process_images job once and completes it', async () => {
    const logger = createLogger();
    const { dataAccess, jobStates } = createDataAccess([createJobRow()]);

    const result = await runQueuedSidecarJobsOnce({
      dataAccess,
      logger,
      now: () => new Date('2026-05-22T13:00:00.000Z'),
      prepareRecordCreatedListings: vi.fn(async () => ({
        exhaustedCandidates: true,
        failed: [],
        processed: [],
        skipped: [],
      })),
    });

    expect(result).toEqual({
      claimedCount: 1,
      executedCount: 1,
      failedCount: 0,
      queuedCount: 1,
      skippedCount: 0,
    });
    expect(jobStates.get('job-process-images')?.status).toBe('completed');
  });

  it('does nothing when no queued jobs exist', async () => {
    const logger = createLogger();
    const runJob = vi.fn();
    const { dataAccess } = createDataAccess([]);

    const result = await runQueuedSidecarJobsOnce({
      dataAccess,
      logger,
      runJob,
    });

    expect(result).toEqual({
      claimedCount: 0,
      executedCount: 0,
      failedCount: 0,
      queuedCount: 0,
      skippedCount: 0,
    });
    expect(runJob).not.toHaveBeenCalled();
  });

  it('skips jobs already claimed by another runner', async () => {
    const logger = createLogger();
    const { dataAccess, jobStates } = createDataAccess([createJobRow()], {
      claimQueued: () => null,
    });

    const result = await runQueuedSidecarJobsOnce({
      dataAccess,
      logger,
    });

    expect(result).toEqual({
      claimedCount: 0,
      executedCount: 0,
      failedCount: 0,
      queuedCount: 1,
      skippedCount: 1,
    });
    expect(jobStates.get('job-process-images')?.status).toBe('queued');
  });

  it('catches crashed job executions and keeps loop work alive', async () => {
    const logger = createLogger();
    const { dataAccess, jobStates } = createDataAccess([createJobRow()]);

    const result = await runQueuedSidecarJobsOnce({
      dataAccess,
      logger,
      runJob: vi.fn(async () => {
        throw new Error('runner exploded');
      }),
    });

    expect(result).toEqual({
      claimedCount: 1,
      executedCount: 0,
      failedCount: 1,
      queuedCount: 1,
      skippedCount: 0,
    });
    expect(jobStates.get('job-process-images')?.status).toBe('running');
    expect(logger.error).toHaveBeenCalledWith(
      'Sidecar job crashed.',
      expect.objectContaining({
        error: 'runner exploded',
        jobId: 'job-process-images',
      })
    );
  });

  it('starts and stops cleanly', async () => {
    vi.useFakeTimers();
    const logger = createLogger();
    const runOnce = vi.fn(async () => ({
      claimedCount: 0,
      executedCount: 0,
      failedCount: 0,
      queuedCount: 0,
      skippedCount: 0,
    }));

    const handle = startSidecarJobRunnerLoop({
      logger,
      pollIntervalMs: 1_000,
      runOnce,
    });

    expect(handle.isRunning()).toBe(true);

    await vi.runOnlyPendingTimersAsync();
    expect(runOnce).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(runOnce).toHaveBeenCalledTimes(2);

    handle.stop();
    expect(handle.isRunning()).toBe(false);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(runOnce).toHaveBeenCalledTimes(2);
  });
});
