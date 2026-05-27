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
    attempts: 0,
    created_at: '2026-05-22T12:00:00.000Z',
    id: 'job-process-images',
    job_type: 'process_images',
    last_error: null,
    last_error_at: null,
    last_error_code: null,
    listing_id: null,
    max_attempts: 2,
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
    category_id: '1234',
    condition_id: '3000',
    condition_notes: null,
    created_at: '2026-05-22T12:00:00.000Z',
    description: 'Detailed listing description.',
    ebay_listing_id: null,
    ebay_listing_status: null,
    ebay_listing_url: null,
    ebay_offer_id: null,
    ese_eligible: null,
    estimated_weight_oz: 8,
    exported_at: null,
    generated_at: '2026-05-22T11:00:00.000Z',
    handling_days: 2,
    id: 'listing-row-id',
    image_urls: ['https://cdn.example.com/front.jpg'],
    item_specifics: {},
    last_error_at: null,
    last_error_code: null,
    last_error_context: {},
    last_error_message: null,
    listing_id: 'LIST-001',
    listing_type: 'single',
    merchant_location_key: null,
    package_type: 'BOX',
    price: 24.5,
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
    title: 'Vintage puzzle',
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
  listings: ListingRow[] = [createListingRow()],
  options: {
    claimApprovedForPublish?: (listingId: string, current: ListingRow | null) => ListingRow | null;
    claimDueQueued?: (jobId: string, current: JobRow | null) => JobRow | null;
    markPublishFailed?: (listingId: string, errorAt: string, error: unknown, current: ListingRow) => ListingRow;
  } = {}
): {
  dataAccess: SidecarDataAccess;
  jobStates: Map<string, JobRow>;
  listingStates: Map<string, ListingRow>;
} {
  const jobStates = new Map(jobs.map((job) => [job.id, { ...job }]));
  const listingStates = new Map(listings.map((listing) => [listing.listing_id, { ...listing }]));

  const dataAccess: SidecarDataAccess = {
    appSettings: {
      create: vi.fn(),
      get: vi.fn(),
      update: vi.fn(),
    },
    jobs: {
      claimDueQueued: vi.fn(async (jobId: string) => {
        const current = jobStates.get(jobId) ?? null;
        const claimed = options.claimDueQueued?.(jobId, current);
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
          attempts: current.attempts + 1,
          next_run_at: null,
          status: 'running',
        } as JobRow;
        jobStates.set(jobId, next);
        return { ...next };
      }),
      complete: vi.fn(async (jobId: string) => {
        const current = jobStates.get(jobId);
        if (!current) {
          throw new Error(`Missing job ${jobId}`);
        }

        const next = {
          ...current,
          last_error: null,
          last_error_at: null,
          last_error_code: null,
          next_run_at: null,
          status: 'completed',
        } as JobRow;
        jobStates.set(jobId, next);
        return { ...next };
      }),
      create: vi.fn(),
      enqueueGenerateAi: vi.fn(),
      enqueueProcessImages: vi.fn(),
      enqueuePublish: vi.fn(async (listingId: string) => {
        const existingJob = [...jobStates.values()].find(
          (job) =>
            job.job_type === 'publish' &&
            job.listing_id === listingId &&
            (job.status === 'queued' || job.status === 'running')
        );

        if (existingJob) {
          return {
            alreadyQueued: true,
            job: { ...existingJob },
          };
        }

        const next = createJobRow({
          id: `job-publish-${listingId}`,
          job_type: 'publish',
          listing_id: listingId,
          max_attempts: 3,
        });
        jobStates.set(next.id, next);

        return {
          alreadyQueued: false,
          job: { ...next },
        };
      }),
      fail: vi.fn(async (jobId: string, error: { errorAt: string; errorCode: string; errorMessage: string }) => {
        const current = jobStates.get(jobId);
        if (!current) {
          throw new Error(`Missing job ${jobId}`);
        }

        const next = {
          ...current,
          last_error: error.errorMessage,
          last_error_at: error.errorAt,
          last_error_code: error.errorCode,
          next_run_at: null,
          status: 'failed',
        } as JobRow;
        jobStates.set(jobId, next);
        return { ...next };
      }),
      getActiveGenerateAiByListingId: vi.fn(),
      getById: vi.fn(async (jobId: string) => {
        const current = jobStates.get(jobId);
        return current ? { ...current } : null;
      }),
      listDueQueued: vi.fn(async (_now: string, { limit = 1 } = {}) =>
        [...jobStates.values()]
          .filter((job) => job.status === 'queued')
          .filter((job) => job.next_run_at === null || job.next_run_at <= '2026-05-22T13:00:00.000Z')
          .sort((left, right) => left.created_at.localeCompare(right.created_at))
          .slice(0, limit)
          .map((job) => ({ ...job }))
      ),
      listByListingId: vi.fn(async (listingId: string) =>
        [...jobStates.values()]
          .filter((job) => job.listing_id === listingId)
          .map((job) => ({ ...job }))
      ),
      listStaleRunning: vi.fn(async (cutoff: string) =>
        [...jobStates.values()]
          .filter((job) => job.status === 'running')
          .filter((job) => job.updated_at < cutoff)
          .map((job) => ({ ...job }))
      ),
      resetForManualRetry: vi.fn(async (jobId: string) => {
        const current = jobStates.get(jobId);
        if (!current || current.status !== 'failed') {
          return null;
        }

        const next = {
          ...current,
          attempts: 0,
          last_error: null,
          last_error_at: null,
          last_error_code: null,
          next_run_at: null,
          status: 'queued',
        } as JobRow;
        jobStates.set(jobId, next);
        return { ...next };
      }),
      requeue: vi.fn(async (jobId: string, error: { errorAt: string; errorCode: string; errorMessage: string }, nextRunAt: string) => {
        const current = jobStates.get(jobId);
        if (!current) {
          throw new Error(`Missing job ${jobId}`);
        }

        const next = {
          ...current,
          last_error: error.errorMessage,
          last_error_at: error.errorAt,
          last_error_code: error.errorCode,
          next_run_at: nextRunAt,
          status: 'queued',
        } as JobRow;
        jobStates.set(jobId, next);
        return { ...next };
      }),
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
      claimApprovedForPublish: vi.fn(async (listingId: string) => {
        const current = listingStates.get(listingId) ?? null;
        const claimed = options.claimApprovedForPublish?.(listingId, current);
        if (claimed !== undefined) {
          if (claimed) {
            listingStates.set(listingId, { ...claimed });
            return { ...claimed };
          }

          return null;
        }

        if (
          !current ||
          current.status !== 'approved_for_export' ||
          current.sub_status !== 'publish_queued'
        ) {
          return null;
        }

        const next = {
          ...current,
          last_error_at: null,
          last_error_code: null,
          last_error_context: {},
          last_error_message: null,
          sub_status: 'publishing_to_ebay',
        } as ListingRow;
        listingStates.set(listingId, next);
        return { ...next };
      }),
      create: vi.fn(),
      getByListingId: vi.fn(async (listingId: string) => {
        const current = listingStates.get(listingId);
        return current ? { ...current } : null;
      }),
      listApprovedForExport: vi.fn(async ({ limit, queuedOnly = false }) =>
        [...listingStates.values()]
          .filter((listing) => listing.status === 'approved_for_export')
          .filter((listing) => !queuedOnly || listing.sub_status === 'publish_queued')
          .sort((left, right) => left.created_at.localeCompare(right.created_at))
          .slice(0, limit)
          .map((listing) => ({ ...listing }))
      ),
      list: vi.fn(async () => [...listingStates.values()].map((listing) => ({ ...listing }))),
      listByStatus: vi.fn(async (status: ListingRow['status'], { limit, offset, orderByCreatedAt }) =>
        [...listingStates.values()]
          .filter((listing) => listing.status === status)
          .sort((left, right) =>
            orderByCreatedAt === 'desc'
              ? right.created_at.localeCompare(left.created_at)
              : left.created_at.localeCompare(right.created_at)
          )
          .slice(offset, offset + limit)
          .map((listing) => ({ ...listing }))
      ),
      markPublishFailed: vi.fn(async (listingId: string, errorAt: string, error: unknown) => {
        const current = listingStates.get(listingId);
        if (!current) {
          throw new Error(`Missing listing ${listingId}`);
        }

        const next =
          options.markPublishFailed?.(listingId, errorAt, error, current) ??
          ({
            ...current,
            last_error_at: errorAt,
            last_error_code:
              typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
                ? error.code
                : 'publish_failed',
            last_error_context: {
              code:
                typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
                  ? error.code
                  : undefined,
              issues:
                typeof error === 'object' &&
                error !== null &&
                'context' in error &&
                typeof error.context === 'object' &&
                error.context !== null &&
                'issues' in error.context &&
                Array.isArray(error.context.issues)
                  ? error.context.issues
                  : undefined,
              message: error instanceof Error ? error.message : String(error),
              name:
                error instanceof Error && typeof error.name === 'string' && error.name.length > 0
                  ? error.name
                  : undefined,
              stage:
                typeof error === 'object' &&
                error !== null &&
                'context' in error &&
                typeof error.context === 'object' &&
                error.context !== null &&
                'stage' in error.context &&
                typeof error.context.stage === 'string'
                  ? error.context.stage
                  : undefined,
            },
            last_error_message: error instanceof Error ? error.message : String(error),
            status: 'approved_for_export',
            sub_status: 'publish_queued',
          } as ListingRow);

        listingStates.set(listingId, next);
        return { ...next };
      }),
      saveImageMetadata: vi.fn(),
      update: vi.fn(async (listingId: string, changes: Partial<ListingRow>) => {
        const current = listingStates.get(listingId);
        if (!current) {
          throw new Error(`Missing listing ${listingId}`);
        }

        const next = {
          ...current,
          ...changes,
        } as ListingRow;
        listingStates.set(listingId, next);
        return { ...next };
      }),
      updateWorkflowState: vi.fn(async () => {
        throw new Error('unexpected workflow update');
      }),
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
    listingStates,
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
        processed: [
          createListingRow({
            image_urls: ['https://cdn.example.com/front.jpg', 'https://cdn.example.com/back.jpg'],
            listing_id: 'LIST-ASSETS-001',
            r2_object_keys: ['listings/LIST-ASSETS-001/front.jpg', 'listings/LIST-ASSETS-001/back.jpg'],
            status: 'assets_ready',
            sub_status: 'ready_to_generate',
          }),
        ],
        skipped: [],
      })),
    });

    expect(result).toEqual({
      claimedCount: 1,
      executedCount: 1,
      failedCount: 0,
      publishClaimedCount: 0,
      publishExecutedCount: 0,
      publishFailedCount: 0,
      publishQueuedCount: 0,
      publishSkippedCount: 0,
      queuedCount: 1,
      skippedCount: 0,
    });
    expect(jobStates.get('job-process-images')?.status).toBe('completed');
    expect(logger.info).toHaveBeenCalledWith(
      'Listing moved to assets_ready.',
      expect.objectContaining({
        imageUrlCount: 2,
        listingId: 'LIST-ASSETS-001',
        r2ObjectKeyCount: 2,
        status: 'assets_ready',
        subStatus: 'ready_to_generate',
      })
    );
  });

  it('logs generate_ai job start and completion at listing transitions', async () => {
    const logger = createLogger();
    const generateAiJob = createJobRow({
      id: 'job-generate-ai',
      job_type: 'generate_ai',
      listing_id: 'LIST-GEN-001',
    });
    const { dataAccess } = createDataAccess([generateAiJob]);

    const result = await runQueuedSidecarJobsOnce({
      dataAccess,
      logger,
      runJob: vi.fn(async () => ({
        job: {
          ...generateAiJob,
          status: 'completed',
        },
        listing: createListingRow({
          listing_id: 'LIST-GEN-001',
          status: 'needs_review',
          sub_status: 'review_pending',
        }),
      })),
    });

    expect(result.executedCount).toBe(1);
    expect(logger.info).toHaveBeenCalledWith(
      'Starting generate_ai job.',
      expect.objectContaining({
        jobId: 'job-generate-ai',
        jobType: 'generate_ai',
        listingId: 'LIST-GEN-001',
      })
    );
    expect(logger.info).toHaveBeenCalledWith(
      'Finished generate_ai job.',
      expect.objectContaining({
        jobId: 'job-generate-ai',
        jobType: 'generate_ai',
        listingId: 'LIST-GEN-001',
        status: 'completed',
        listingStatus: 'needs_review',
        listingSubStatus: 'review_pending',
      })
    );
  });

  it('backfills missing publish jobs for approved queued listings and executes them through normal queueing', async () => {
    const logger = createLogger();
    const approvedListing = createListingRow({
      listing_id: 'LIST-PUBLISH-001',
      status: 'approved_for_export',
      sub_status: 'publish_queued',
    });
    const { dataAccess, listingStates } = createDataAccess([], [approvedListing]);
    const runJob = vi.fn(async (jobId: string) => {
      const job = await dataAccess.jobs.getById(jobId);
      const listing = await dataAccess.listings.update('LIST-PUBLISH-001', {
        ebay_listing_id: 'EBAY-001',
        ebay_offer_id: 'OFFER-001',
        exported_at: '2026-05-22T13:00:00.000Z',
        status: 'exported',
        sub_status: 'idle',
      });
      const completedJob = await dataAccess.jobs.complete(jobId);

      return {
        job: completedJob,
        listing,
      };
    });

    const result = await runQueuedSidecarJobsOnce({
      dataAccess,
      logger,
      now: () => new Date('2026-05-22T13:00:00.000Z'),
      runJob,
    });

    expect(result).toEqual({
      claimedCount: 1,
      executedCount: 1,
      failedCount: 0,
      publishClaimedCount: 1,
      publishExecutedCount: 1,
      publishFailedCount: 0,
      publishQueuedCount: 1,
      publishSkippedCount: 0,
      queuedCount: 1,
      skippedCount: 0,
    });
    expect(dataAccess.jobs.enqueuePublish).toHaveBeenCalledWith('LIST-PUBLISH-001');
    expect(runJob).toHaveBeenCalledWith(
      'job-publish-LIST-PUBLISH-001',
      expect.objectContaining({
        dataAccess,
        now: expect.any(Function),
      })
    );
    expect(logger.info).toHaveBeenCalledWith(
      'Starting publish job.',
      expect.objectContaining({
        jobId: 'job-publish-LIST-PUBLISH-001',
        jobType: 'publish',
        listingId: 'LIST-PUBLISH-001',
      })
    );
    expect(logger.info).toHaveBeenCalledWith(
      'Finished publish job.',
      expect.objectContaining({
        jobId: 'job-publish-LIST-PUBLISH-001',
        jobType: 'publish',
        listingId: 'LIST-PUBLISH-001',
        listingStatus: 'exported',
        listingSubStatus: 'idle',
        status: 'completed',
      })
    );
    expect(listingStates.get('LIST-PUBLISH-001')).toMatchObject({
      ebay_listing_id: 'EBAY-001',
      ebay_offer_id: 'OFFER-001',
      status: 'exported',
      sub_status: 'idle',
    });
  });

  it('ignores ineligible approved listings when queued-only pickup is enabled', async () => {
    const logger = createLogger();
    const { dataAccess } = createDataAccess([], [
      createListingRow({
        listing_id: 'LIST-IDLE',
        status: 'approved_for_export',
        sub_status: 'idle',
      }),
      createListingRow({
        listing_id: 'LIST-REVIEW',
        status: 'needs_review',
        sub_status: 'review_pending',
      }),
    ]);
    const runJob = vi.fn();

    const result = await runQueuedSidecarJobsOnce({
      dataAccess,
      logger,
      runJob,
    });

    expect(result.publishQueuedCount).toBe(0);
    expect(result.publishExecutedCount).toBe(0);
    expect(dataAccess.jobs.enqueuePublish).not.toHaveBeenCalled();
    expect(runJob).not.toHaveBeenCalled();
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
      publishClaimedCount: 0,
      publishExecutedCount: 0,
      publishFailedCount: 0,
      publishQueuedCount: 0,
      publishSkippedCount: 0,
      queuedCount: 0,
      skippedCount: 0,
    });
    expect(runJob).not.toHaveBeenCalled();
  });

  it('skips jobs already claimed by another runner', async () => {
    const logger = createLogger();
    const { dataAccess, jobStates } = createDataAccess([createJobRow()], undefined, {
      claimDueQueued: () => null,
    });

    const result = await runQueuedSidecarJobsOnce({
      dataAccess,
      logger,
    });

    expect(result).toEqual({
      claimedCount: 0,
      executedCount: 0,
      failedCount: 0,
      publishClaimedCount: 0,
      publishExecutedCount: 0,
      publishFailedCount: 0,
      publishQueuedCount: 0,
      publishSkippedCount: 0,
      queuedCount: 1,
      skippedCount: 1,
    });
    expect(jobStates.get('job-process-images')?.status).toBe('queued');
  });

  it('does not create duplicate active publish jobs during repeated backfill', async () => {
    const logger = createLogger();
    const approvedListing = createListingRow({
      listing_id: 'LIST-STALE',
      status: 'approved_for_export',
      sub_status: 'publish_queued',
    });
    const existingPublishJob = createJobRow({
      id: 'job-publish-existing',
      job_type: 'publish',
      listing_id: 'LIST-STALE',
      max_attempts: 3,
      next_run_at: '2026-05-22T13:05:00.000Z',
    });
    const { dataAccess, jobStates } = createDataAccess([existingPublishJob], [approvedListing]);
    const runJob = vi.fn();

    const result = await runQueuedSidecarJobsOnce({
      dataAccess,
      logger,
      runJob,
    });

    expect(result.publishQueuedCount).toBe(0);
    expect(dataAccess.jobs.enqueuePublish).toHaveBeenCalledWith('LIST-STALE');
    expect(jobStates.size).toBe(1);
  });

  it('repairs orphan generating listings back to assets_ready/ready_to_generate', async () => {
    const logger = createLogger();
    const orphanListing = createListingRow({
      listing_id: 'LIST-GENERATING-ORPHAN',
      status: 'generating',
      sub_status: 'ai_call_in_progress',
    });
    const failedGenerateAiJob = createJobRow({
      id: 'job-generate-ai-failed',
      job_type: 'generate_ai',
      listing_id: 'LIST-GENERATING-ORPHAN',
      max_attempts: 3,
      status: 'failed',
      last_error_code: 'retry_exhausted',
    });
    const { dataAccess, listingStates } = createDataAccess([failedGenerateAiJob], [orphanListing]);

    await runQueuedSidecarJobsOnce({
      dataAccess,
      logger,
      now: () => new Date('2026-05-22T13:00:00.000Z'),
    });

    expect(listingStates.get('LIST-GENERATING-ORPHAN')).toMatchObject({
      last_error_code: 'orphan_active_state',
      status: 'assets_ready',
      sub_status: 'ready_to_generate',
    });
  });

  it('repairs orphan publishing listings back to approved_for_export/idle', async () => {
    const logger = createLogger();
    const orphanListing = createListingRow({
      listing_id: 'LIST-PUBLISH-ORPHAN',
      status: 'approved_for_export',
      sub_status: 'publishing_to_ebay',
    });
    const failedPublishJob = createJobRow({
      id: 'job-publish-failed',
      job_type: 'publish',
      listing_id: 'LIST-PUBLISH-ORPHAN',
      max_attempts: 3,
      status: 'failed',
      last_error_code: 'retry_exhausted',
    });
    const { dataAccess, listingStates } = createDataAccess([failedPublishJob], [orphanListing]);

    await runQueuedSidecarJobsOnce({
      dataAccess,
      logger,
      now: () => new Date('2026-05-22T13:00:00.000Z'),
    });

    expect(listingStates.get('LIST-PUBLISH-ORPHAN')).toMatchObject({
      last_error_code: 'orphan_active_state',
      status: 'approved_for_export',
      sub_status: 'idle',
    });
  });

  it('skips orphan repair when active workflow jobs still exist', async () => {
    const logger = createLogger();
    const generatingListing = createListingRow({
      listing_id: 'LIST-GENERATING-ACTIVE',
      status: 'generating',
      sub_status: 'ai_call_in_progress',
    });
    const publishingListing = createListingRow({
      listing_id: 'LIST-PUBLISH-ACTIVE',
      status: 'approved_for_export',
      sub_status: 'publishing_to_ebay',
    });
    const activeGenerateAiJob = createJobRow({
      id: 'job-generate-ai-active',
      job_type: 'generate_ai',
      listing_id: 'LIST-GENERATING-ACTIVE',
      max_attempts: 3,
      status: 'running',
      updated_at: '2026-05-22T12:59:00.000Z',
    });
    const activePublishJob = createJobRow({
      id: 'job-publish-active',
      job_type: 'publish',
      listing_id: 'LIST-PUBLISH-ACTIVE',
      max_attempts: 3,
      status: 'running',
      updated_at: '2026-05-22T12:59:00.000Z',
    });
    const { dataAccess, listingStates } = createDataAccess(
      [activeGenerateAiJob, activePublishJob],
      [generatingListing, publishingListing]
    );

    await runQueuedSidecarJobsOnce({
      dataAccess,
      logger,
      now: () => new Date('2026-05-22T13:00:00.000Z'),
    });

    expect(listingStates.get('LIST-GENERATING-ACTIVE')).toMatchObject({
      status: 'generating',
      sub_status: 'ai_call_in_progress',
    });
    expect(listingStates.get('LIST-PUBLISH-ACTIVE')).toMatchObject({
      status: 'approved_for_export',
      sub_status: 'publishing_to_ebay',
    });
  });

  it('requeues stale running publish jobs and repairs listing state when attempts remain', async () => {
    const logger = createLogger();
    const staleListing = createListingRow({
      listing_id: 'LIST-FAIL',
      status: 'approved_for_export',
      sub_status: 'publishing_to_ebay',
    });
    const staleJob = createJobRow({
      id: 'job-publish-stale',
      job_type: 'publish',
      listing_id: 'LIST-FAIL',
      max_attempts: 3,
      status: 'running',
      updated_at: '2026-05-22T11:00:00.000Z',
    });
    const { dataAccess, jobStates, listingStates } = createDataAccess([staleJob], [staleListing]);

    const result = await runQueuedSidecarJobsOnce({
      dataAccess,
      logger,
      now: () => new Date('2026-05-22T13:00:00.000Z'),
    });

    expect(result.publishQueuedCount).toBe(0);
    expect(jobStates.get('job-publish-stale')).toMatchObject({
      status: 'queued',
      last_error_code: 'stale_worker',
      next_run_at: '2026-05-22T13:01:00.000Z',
    });
    expect(listingStates.get('LIST-FAIL')).toMatchObject({
      last_error_code: 'stale_worker',
      status: 'approved_for_export',
      sub_status: 'publish_queued',
    });
  });

  it('fails exhausted stale publish jobs and parks listing at approved_for_export/idle', async () => {
    const logger = createLogger();
    const staleListing = createListingRow({
      listing_id: 'LIST-INCONSISTENT',
      status: 'approved_for_export',
      sub_status: 'publishing_to_ebay',
    });
    const staleJob = createJobRow({
      attempts: 3,
      id: 'job-publish-exhausted',
      job_type: 'publish',
      listing_id: 'LIST-INCONSISTENT',
      max_attempts: 3,
      status: 'running',
      updated_at: '2026-05-22T11:00:00.000Z',
    });
    const { dataAccess, jobStates, listingStates } = createDataAccess([staleJob], [staleListing]);

    const result = await runQueuedSidecarJobsOnce({
      dataAccess,
      logger,
      now: () => new Date('2026-05-22T13:00:00.000Z'),
    });

    expect(result.publishQueuedCount).toBe(0);
    expect(jobStates.get('job-publish-exhausted')).toMatchObject({
      status: 'failed',
      last_error_code: 'retry_exhausted',
    });
    expect(listingStates.get('LIST-INCONSISTENT')).toMatchObject({
      last_error_code: 'retry_exhausted',
      status: 'approved_for_export',
      sub_status: 'idle',
    });
    expect(result.publishFailedCount).toBe(0);
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
      publishClaimedCount: 0,
      publishExecutedCount: 0,
      publishFailedCount: 0,
      publishQueuedCount: 0,
      publishSkippedCount: 0,
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
      publishClaimedCount: 0,
      publishExecutedCount: 0,
      publishFailedCount: 0,
      publishQueuedCount: 0,
      publishSkippedCount: 0,
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
