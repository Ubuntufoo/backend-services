import type { JobRow, ListingRow } from '@ebay-inventory/data';
import { describe, expect, it, vi } from 'vitest';

import type { SidecarDataAccess } from '@/data/sidecar-data.js';
import { runSidecarJob } from '@/jobs/index.js';

const queuedGenerateAiJob: JobRow = {
  attempts: 0,
  created_at: '2026-05-20T12:00:00.000Z',
  id: 'job-generate-ai',
  job_type: 'generate_ai',
  last_error: null,
  last_error_at: null,
  last_error_code: null,
  listing_id: 'LIST-001',
  max_attempts: 3,
  next_run_at: null,
  status: 'queued',
  updated_at: '2026-05-20T12:00:00.000Z',
};

const queuedProcessImagesJob: JobRow = {
  attempts: 0,
  created_at: '2026-05-20T12:00:00.000Z',
  id: 'job-process-images',
  job_type: 'process_images',
  last_error: null,
  last_error_at: null,
  last_error_code: null,
  listing_id: null,
  max_attempts: 2,
  next_run_at: null,
  status: 'queued',
  updated_at: '2026-05-20T12:00:00.000Z',
};

const runningProcessImagesJob: JobRow = {
  ...queuedProcessImagesJob,
  status: 'running',
};

function createListingRow(overrides: Partial<ListingRow> = {}): ListingRow {
  return {
    approved_for_export_at: null,
    capture_mode: null,
    category_id: null,
    condition_id: null,
    condition_notes: null,
    created_at: '2026-05-20T12:00:00.000Z',
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
    image_urls: ['https://cdn.example.com/front.jpg', 'https://cdn.example.com/back.jpg'],
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
    seller_hints: 'Focus on centering and corners.',
    shipping_profile: null,
    sku: 'SKU-001',
    sold_at: null,
    status: 'assets_ready',
    sub_status: 'ready_to_generate',
    title: null,
    updated_at: '2026-05-20T12:00:00.000Z',
    ...overrides,
  };
}

function createDataAccess({
  job = queuedGenerateAiJob,
  listing = createListingRow(),
  onListingsUpdate,
  workflowStates = [],
}: {
  job?: JobRow | null;
  listing?: ListingRow | null;
  onListingsUpdate?: (changes: Partial<ListingRow>, current: ListingRow) => void;
  workflowStates?: ListingRow[];
} = {}): SidecarDataAccess {
  const listingStates = workflowStates.length > 0 ? [...workflowStates] : listing ? [listing] : [];
  let jobState = job ? { ...job } : null;

  const jobsGetById = vi.fn(async () => (jobState ? { ...jobState } : null));
  const jobsCreate = vi.fn();
  const jobsListByListingId = vi.fn();
  const jobsUpdate = vi.fn(async (_jobId: string, changes: Partial<JobRow>) => {
    if (!jobState) {
      throw new Error('job missing');
    }

    jobState = {
      ...jobState,
      ...changes,
    };

    return { ...jobState };
  });
  const listingsCreate = vi.fn();
  const listingsList = vi.fn();
  const listingsListByStatus = vi.fn();
  const listingsSaveImageMetadata = vi.fn();
  const listingsGetByListingId = vi.fn(async () => listingStates.at(-1) ?? null);
  const listingsUpdate = vi.fn(async (_listingId: string, changes: Partial<ListingRow>) => {
    const current = listingStates.at(-1);
    if (!current) {
      throw new Error('listing missing');
    }

    onListingsUpdate?.(changes, current);

    const nextState = {
      ...current,
      ...changes,
    } as ListingRow;
    listingStates.push(nextState);
    return nextState;
  });
  const listingsUpdateWorkflowState = vi.fn(async (input: {
    listingId: string;
    status: ListingRow['status'];
    subStatus: ListingRow['sub_status'];
  }) => {
    const current = listingStates.at(-1);
    if (!current) {
      throw new Error('listing missing');
    }

    const nextState = {
      ...current,
      listing_id: input.listingId,
      status: input.status,
      sub_status: input.subStatus,
    } as ListingRow;
    listingStates.push(nextState);
    return nextState;
  });
  const ordersCreate = vi.fn();
  const ordersGetByOrderId = vi.fn();
  const ordersUpdate = vi.fn();
  const appSettingsCreate = vi.fn();
  const appSettingsGet = vi.fn();
  const appSettingsUpdate = vi.fn();

  return {
    appSettings: {
      create: appSettingsCreate,
      get: appSettingsGet,
      update: appSettingsUpdate,
    },
    jobs: {
      claimDueQueued: vi.fn(async () => {
        if (!jobState || jobState.status !== 'queued') {
          return null;
        }

        jobState = {
          ...jobState,
          attempts: jobState.attempts + 1,
          next_run_at: null,
          status: 'running',
        };

        return { ...jobState };
      }),
      complete: vi.fn(async () => {
        if (!jobState) {
          throw new Error('job missing');
        }

        jobState = {
          ...jobState,
          last_error: null,
          last_error_at: null,
          last_error_code: null,
          next_run_at: null,
          status: 'completed',
        };

        return { ...jobState };
      }),
      create: jobsCreate,
      enqueueGenerateAi: vi.fn(async () => ({
        alreadyQueued: false,
        job: queuedGenerateAiJob,
      })),
      enqueueProcessImages: vi.fn(async () => ({
        alreadyQueued: false,
        job: queuedProcessImagesJob,
      })),
      fail: vi.fn(async (_jobId: string, error) => {
        if (!jobState) {
          throw new Error('job missing');
        }

        jobState = {
          ...jobState,
          last_error: error.errorMessage,
          last_error_at: error.errorAt,
          last_error_code: error.errorCode,
          next_run_at: null,
          status: 'failed',
        };

        return { ...jobState };
      }),
      getActiveGenerateAiByListingId: vi.fn(async () => queuedGenerateAiJob),
      getById: jobsGetById,
      listDueQueued: vi.fn(async () => []),
      listByListingId: jobsListByListingId,
      listStaleRunning: vi.fn(async () => []),
      requeue: vi.fn(async (_jobId: string, error, nextRunAt) => {
        if (!jobState) {
          throw new Error('job missing');
        }

        jobState = {
          ...jobState,
          last_error: error.errorMessage,
          last_error_at: error.errorAt,
          last_error_code: error.errorCode,
          next_run_at: nextRunAt,
          status: 'queued',
        };

        return { ...jobState };
      }),
      update: jobsUpdate,
    },
    listings: {
      claimApprovedForPublish: vi.fn(),
      create: listingsCreate,
      getByListingId: listingsGetByListingId,
      listApprovedForExport: vi.fn(async () => []),
      list: listingsList,
      listByStatus: listingsListByStatus,
      markPublishFailed: vi.fn(),
      saveImageMetadata: listingsSaveImageMetadata,
      update: listingsUpdate,
      updateWorkflowState: listingsUpdateWorkflowState,
    },
    orders: {
      create: ordersCreate,
      getByOrderId: ordersGetByOrderId,
      update: ordersUpdate,
    },
  };
}

describe('runSidecarJob', () => {
  it('rejects generate_ai jobs when listing is not assets_ready', async () => {
    const dataAccess = createDataAccess({
      listing: createListingRow({
        status: 'needs_review',
        sub_status: 'review_pending',
      }),
    });
    const generateListingDraftMock = vi.fn();

    const result = await runSidecarJob('job-generate-ai', {
      dataAccess,
      generateListingDraft: generateListingDraftMock,
      now: () => new Date('2026-05-20T13:00:00.000Z'),
    });

    expect(result.job.status).toBe('failed');
    expect(result.job.last_error_code).toBe('generate_ai_listing_not_eligible');
    expect(generateListingDraftMock).not.toHaveBeenCalled();
    expect(dataAccess.listings.updateWorkflowState).not.toHaveBeenCalled();
  });

  it('fails generate_ai jobs with no image URLs and keeps listing retryable', async () => {
    const dataAccess = createDataAccess({
      listing: createListingRow({
        image_urls: [],
      }),
    });
    const generateListingDraftMock = vi.fn();

    const result = await runSidecarJob('job-generate-ai', {
      dataAccess,
      generateListingDraft: generateListingDraftMock,
      now: () => new Date('2026-05-20T13:00:00.000Z'),
    });

    expect(result.job.status).toBe('failed');
    expect(result.job.last_error_code).toBe('generate_ai_missing_image_urls');
    expect(dataAccess.listings.update).toHaveBeenCalledWith(
      'LIST-001',
      expect.objectContaining({
        last_error_at: '2026-05-20T13:00:00.000Z',
        last_error_code: 'generate_ai_missing_image_urls',
      })
    );
    expect(generateListingDraftMock).not.toHaveBeenCalled();
  });

  it('transitions generate_ai listings to needs_review and persists draft fields once', async () => {
    const dataAccess = createDataAccess({
      listing: createListingRow({
        item_specifics: {
          Player: 'Michael Jordan',
          Team: ['Chicago Bulls'],
          Invalid: 23,
        },
        price: 199.99,
        seller_hints: 'Card appears ungraded.',
        title: 'Possible Jordan insert',
      }),
    });
    const generateListingDraftMock = vi.fn(async () => ({
      title: '1991 Upper Deck Michael Jordan',
      description: 'Ungraded single card with visible edge wear.',
      categorySuggestion: 'Sports Trading Cards',
      conditionSuggestion: 'Ungraded',
      aspects: {
        Player: 'Michael Jordan',
        Manufacturer: 'Upper Deck',
      },
      priceSuggestion: 249.99,
      confidence: {
        title: 0.91,
      },
      warnings: ['Condition inferred from visible wear only.'],
      rawModelResponse: { id: 'raw-response-1' },
    }));

    const result = await runSidecarJob('job-generate-ai', {
      dataAccess,
      generateListingDraft: generateListingDraftMock,
      now: () => new Date('2026-05-20T13:00:00.000Z'),
    });

    expect(dataAccess.listings.updateWorkflowState).toHaveBeenNthCalledWith(1, {
      listingId: 'LIST-001',
      status: 'generating',
      subStatus: 'ai_call_in_progress',
    });
    expect(generateListingDraftMock).toHaveBeenCalledWith({
      imageUrls: ['https://cdn.example.com/front.jpg', 'https://cdn.example.com/back.jpg'],
      listingId: 'LIST-001',
      userHints: {
        aspects: {
          Player: 'Michael Jordan',
          Team: ['Chicago Bulls'],
        },
        notes: 'Card appears ungraded.',
        price: 199.99,
        title: 'Possible Jordan insert',
      },
    });
    expect(dataAccess.listings.update).toHaveBeenCalledWith(
      'LIST-001',
      expect.objectContaining({
        description: 'Ungraded single card with visible edge wear.',
        item_specifics: {
          Player: 'Michael Jordan',
          Manufacturer: 'Upper Deck',
          CategorySuggestion: 'Sports Trading Cards',
          ConditionSuggestion: 'Ungraded',
        },
        last_error_at: null,
        last_error_code: null,
        last_error_context: {},
        last_error_message: null,
        price: 249.99,
        status: 'needs_review',
        sub_status: 'review_pending',
        title: '1991 Upper Deck Michael Jordan',
      })
    );
    expect(dataAccess.listings.updateWorkflowState).toHaveBeenCalledTimes(1);
    expect(result.listing?.status).toBe('needs_review');
    expect(result.listing?.sub_status).toBe('review_pending');
    expect(result.job.status).toBe('completed');
  });

  it('requeues recoverable generate_ai failures with next_run_at', async () => {
    const dataAccess = createDataAccess();
    const generateListingDraftMock = vi.fn(async () => {
      throw new Error('Gemini timed out');
    });

    const result = await runSidecarJob('job-generate-ai', {
      dataAccess,
      generateListingDraft: generateListingDraftMock,
      now: () => new Date('2026-05-20T13:00:00.000Z'),
    });

    expect(dataAccess.listings.updateWorkflowState).toHaveBeenCalledWith({
      listingId: 'LIST-001',
      status: 'generating',
      subStatus: 'ai_call_in_progress',
    });
    expect(dataAccess.listings.update).toHaveBeenCalledWith(
      'LIST-001',
      expect.objectContaining({
        last_error_at: '2026-05-20T13:00:00.000Z',
        last_error_code: 'generate_ai_failed',
        last_error_context: expect.objectContaining({
          category: 'recoverable',
        }),
        last_error_message: 'Gemini timed out',
        status: 'assets_ready',
        sub_status: 'ready_to_generate',
      })
    );
    expect(result.job.status).toBe('queued');
    expect(result.job.last_error_code).toBe('generate_ai_failed');
    expect(result.job.last_error).toContain('Gemini timed out');
    expect(result.job.next_run_at).toBe('2026-05-20T13:01:00.000Z');
    expect(result.listing?.status).toBe('assets_ready');
    expect(result.listing?.sub_status).toBe('ready_to_generate');
  });

  it('returns asset prep summary for process_images jobs and does not fail batch on per-listing errors', async () => {
    const dataAccess = createDataAccess({
      job: queuedProcessImagesJob,
    });
    const prepareRecordCreatedListingsMock = vi.fn(async () => ({
      exhaustedCandidates: false,
      failed: [
        {
          errorCode: 'record_created_image_processing_failed',
          listingId: 'LIST-002',
          message: 'sharp exploded',
        },
      ],
      processed: [
        createListingRow({
          listing_id: 'LIST-001',
          status: 'assets_ready',
          sub_status: 'ready_to_generate',
        }),
      ],
      skipped: [
        {
          listingId: 'test-123',
          reason: 'record_created_skip_non_local_source_images',
        },
      ],
    }));

    const result = await runSidecarJob('job-process-images', {
      dataAccess,
      now: () => new Date('2026-05-20T13:00:00.000Z'),
      prepareRecordCreatedListings: prepareRecordCreatedListingsMock,
    });

    expect(prepareRecordCreatedListingsMock).toHaveBeenCalledWith({
      dataAccess,
      now: expect.any(Function),
    });
    expect(result.listing).toBeNull();
    expect(result.assetPrepSummary).toEqual({
      exhaustedCandidates: false,
      failedCount: 1,
      processedCount: 1,
      skippedCount: 1,
    });
    expect(result.job.status).toBe('completed');
    expect(result.job.last_error).toBeNull();
  });

  it('requeues recoverable process_images failures with next_run_at', async () => {
    const dataAccess = createDataAccess({
      job: queuedProcessImagesJob,
    });
    const prepareRecordCreatedListingsMock = vi.fn(async () => {
      throw new Error('Supabase unavailable');
    });

    const result = await runSidecarJob('job-process-images', {
      dataAccess,
      now: () => new Date('2026-05-20T13:00:00.000Z'),
      prepareRecordCreatedListings: prepareRecordCreatedListingsMock,
    });

    expect(result.listing).toBeNull();
    expect(result.assetPrepSummary).toBeUndefined();
    expect(result.job.status).toBe('queued');
    expect(result.job.last_error_code).toBe('process_images_failed');
    expect(result.job.last_error).toContain('Supabase unavailable');
    expect(result.job.next_run_at).toBe('2026-05-20T13:01:00.000Z');
  });

  it('runs already-claimed jobs without re-marking them running', async () => {
    const dataAccess = createDataAccess({
      job: runningProcessImagesJob,
    });
    const prepareRecordCreatedListingsMock = vi.fn(async () => ({
      exhaustedCandidates: true,
      failed: [],
      processed: [],
      skipped: [],
    }));

    const result = await runSidecarJob('job-process-images', {
      dataAccess,
      now: () => new Date('2026-05-20T13:00:00.000Z'),
      prepareRecordCreatedListings: prepareRecordCreatedListingsMock,
    });

    expect(result.job.status).toBe('completed');
    expect(dataAccess.jobs.complete).toHaveBeenCalledWith('job-process-images');
  });

  it('fails unsupported job types without touching listing workflow', async () => {
    const dataAccess = createDataAccess({
      job: {
        ...queuedGenerateAiJob,
        job_type: 'publish_ebay',
      },
    });
    const generateListingDraftMock = vi.fn();

    const result = await runSidecarJob('job-generate-ai', {
      dataAccess,
      generateListingDraft: generateListingDraftMock,
      now: () => new Date('2026-05-20T13:00:00.000Z'),
    });

    expect(result.job.status).toBe('failed');
    expect(result.job.last_error_code).toBe('unsupported_job_type');
    expect(generateListingDraftMock).not.toHaveBeenCalled();
    expect(dataAccess.listings.updateWorkflowState).not.toHaveBeenCalled();
  });
});
