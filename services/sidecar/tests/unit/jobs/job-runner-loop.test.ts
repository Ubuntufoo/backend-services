import type { JobRow, ListingRow } from '@ebay-inventory/data';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SidecarDataAccess } from '@/data/sidecar-data.js';
import { PublishListingError } from '@/ebay/publish-validation.js';
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
    claimQueued?: (jobId: string, current: JobRow | null) => JobRow | null;
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
      listByStatus: vi.fn(async () => []),
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
        processed: [],
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
  });

  it('publishes approved queued listings after processing regular jobs', async () => {
    const logger = createLogger();
    const approvedListing = createListingRow({
      listing_id: 'LIST-PUBLISH-001',
      status: 'approved_for_export',
      sub_status: 'publish_queued',
    });
    const { dataAccess, listingStates } = createDataAccess([], [approvedListing]);
    const publishListing = vi.fn(async (listingId: string, dependencies?: { dataAccess?: SidecarDataAccess }) => {
      await dependencies?.dataAccess?.listings.update(listingId, {
        ebay_listing_id: 'EBAY-001',
        ebay_listing_url: 'https://www.ebay.com/itm/EBAY-001',
        ebay_offer_id: 'OFFER-001',
        exported_at: '2026-05-22T13:00:00.000Z',
        status: 'exported',
        sub_status: 'idle',
      });

      return {
        ebayListingId: 'EBAY-001',
        exportedAt: '2026-05-22T13:00:00.000Z',
        listingId,
        offerId: 'OFFER-001',
        reusedExistingOffer: false,
        sku: 'LIST-PUBLISH-001',
        status: 'exported' as const,
      };
    });

    const result = await runQueuedSidecarJobsOnce({
      dataAccess,
      logger,
      now: () => new Date('2026-05-22T13:00:00.000Z'),
      publishListing,
    });

    expect(result).toEqual({
      claimedCount: 0,
      executedCount: 0,
      failedCount: 0,
      publishClaimedCount: 1,
      publishExecutedCount: 1,
      publishFailedCount: 0,
      publishQueuedCount: 1,
      publishSkippedCount: 0,
      queuedCount: 0,
      skippedCount: 0,
    });
    expect(publishListing).toHaveBeenCalledWith(
      'LIST-PUBLISH-001',
      expect.objectContaining({
        dataAccess,
        now: expect.any(Function),
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
    const publishListing = vi.fn();

    const result = await runQueuedSidecarJobsOnce({
      dataAccess,
      logger,
      publishListing,
    });

    expect(result.publishQueuedCount).toBe(0);
    expect(result.publishExecutedCount).toBe(0);
    expect(publishListing).not.toHaveBeenCalled();
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

  it('skips stale listing claims without publishing twice', async () => {
    const logger = createLogger();
    const approvedListing = createListingRow({
      listing_id: 'LIST-STALE',
      status: 'approved_for_export',
      sub_status: 'publish_queued',
    });
    const { dataAccess, listingStates } = createDataAccess([], [approvedListing], {
      claimApprovedForPublish: () => null,
    });
    const publishListing = vi.fn();

    const result = await runQueuedSidecarJobsOnce({
      dataAccess,
      logger,
      publishListing,
    });

    expect(result.publishQueuedCount).toBe(1);
    expect(result.publishSkippedCount).toBe(1);
    expect(result.publishClaimedCount).toBe(0);
    expect(publishListing).not.toHaveBeenCalled();
    expect(listingStates.get('LIST-STALE')?.sub_status).toBe('publish_queued');
  });

  it('requeues failed listing publishes with error details', async () => {
    const logger = createLogger();
    const approvedListing = createListingRow({
      listing_id: 'LIST-FAIL',
      status: 'approved_for_export',
      sub_status: 'publish_queued',
    });
    const { dataAccess, listingStates } = createDataAccess([], [approvedListing]);
    const publishListing = vi.fn(async () => {
      throw new PublishListingError('OFFER_PUBLISH_FAILED', 'Sandbox unavailable', {
        listingId: 'LIST-FAIL',
        stage: 'publish',
      });
    });

    const result = await runQueuedSidecarJobsOnce({
      dataAccess,
      logger,
      now: () => new Date('2026-05-22T13:00:00.000Z'),
      publishListing,
    });

    expect(result.publishFailedCount).toBe(1);
    expect(dataAccess.listings.markPublishFailed).toHaveBeenCalledWith(
      'LIST-FAIL',
      '2026-05-22T13:00:00.000Z',
      expect.any(PublishListingError)
    );
    expect(listingStates.get('LIST-FAIL')).toMatchObject({
      last_error_code: 'OFFER_PUBLISH_FAILED',
      last_error_message: 'Sandbox unavailable',
      status: 'approved_for_export',
      sub_status: 'publish_queued',
    });
  });

  it('logs finalization inconsistencies without requeueing duplicate-prone publishes', async () => {
    const logger = createLogger();
    const approvedListing = createListingRow({
      listing_id: 'LIST-INCONSISTENT',
      status: 'approved_for_export',
      sub_status: 'publish_queued',
    });
    const { dataAccess, listingStates } = createDataAccess([], [approvedListing]);
    const publishListing = vi.fn(async () => {
      throw new PublishListingError(
        'EXPORT_STATE_PERSIST_FAILED',
        'Published offer for listing "LIST-INCONSISTENT" but failed to persist exported state.',
        {
          listingId: 'LIST-INCONSISTENT',
          stage: 'finalize',
        }
      );
    });

    const result = await runQueuedSidecarJobsOnce({
      dataAccess,
      logger,
      now: () => new Date('2026-05-22T13:00:00.000Z'),
      publishListing,
    });

    expect(result.publishFailedCount).toBe(1);
    expect(dataAccess.listings.markPublishFailed).not.toHaveBeenCalled();
    expect(listingStates.get('LIST-INCONSISTENT')).toMatchObject({
      last_error_code: 'EXPORT_STATE_PERSIST_FAILED',
      last_error_message:
        'Published offer for listing "LIST-INCONSISTENT" but failed to persist exported state.',
      status: 'approved_for_export',
      sub_status: 'publishing_to_ebay',
    });
    expect(logger.error).toHaveBeenCalledWith(
      'Listing publish finalized externally but failed local persistence.',
      expect.objectContaining({
        errorCode: 'EXPORT_STATE_PERSIST_FAILED',
        listingId: 'LIST-INCONSISTENT',
        stage: 'finalize',
      })
    );
    expect(publishListing).toHaveBeenCalledTimes(1);
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
