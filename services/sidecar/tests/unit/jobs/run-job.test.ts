import type { AiModelAttemptRow, JobRow, ListingRow } from '@ebay-inventory/data';
import { describe, expect, it, vi } from 'vitest';

import type { SidecarDataAccess } from '@/data/sidecar-data.js';
import { PublishListingError, PublishListingValidationError } from '@/ebay/publish-validation.js';
import { runSidecarJob } from '@/jobs/index.js';

const queuedGenerateAiJob: JobRow = {
  attempts: 0,
  created_at: '2026-05-20T12:00:00.000Z',
  gemini_attempt_count: 0,
  gemini_attempts: [],
  gemini_selected_model: null,
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
  gemini_attempt_count: 0,
  gemini_attempts: [],
  gemini_selected_model: null,
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

const queuedPublishJob: JobRow = {
  attempts: 0,
  created_at: '2026-05-20T12:00:00.000Z',
  gemini_attempt_count: 0,
  gemini_attempts: [],
  gemini_selected_model: null,
  id: 'job-publish',
  job_type: 'publish',
  last_error: null,
  last_error_at: null,
  last_error_code: null,
  listing_id: 'LIST-001',
  max_attempts: 3,
  next_run_at: null,
  status: 'queued',
  updated_at: '2026-05-20T12:00:00.000Z',
};

const startedAiModelAttemptRow: AiModelAttemptRow = {
  attempt_order: 1,
  created_at: '2026-05-20T13:00:00.000Z',
  duration_ms: null,
  failure_code: null,
  failure_message: null,
  finished_at: null,
  id: 'ai-model-attempt-row-id',
  job_id: 'job-generate-ai',
  listing_id: 'LIST-001',
  metadata: {},
  model_name: 'gemini-3.1-flash-lite',
  provider: 'google',
  provider_model_id: 'gemini-3.1-flash-lite',
  routing_source: 'direct_gemini',
  started_at: '2026-05-20T13:00:00.000Z',
  status: 'started',
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
  aiModelAttemptError,
  geminiAttemptAuditError,
  onListingsUpdate,
  workflowStates = [],
}: {
  job?: JobRow | null;
  listing?: ListingRow | null;
  aiModelAttemptError?: Error;
  geminiAttemptAuditError?: Error;
  onListingsUpdate?: (changes: Partial<ListingRow>, current: ListingRow) => void;
  workflowStates?: ListingRow[];
} = {}): SidecarDataAccess {
  const listingStates = workflowStates.length > 0 ? [...workflowStates] : listing ? [listing] : [];
  let jobState = job ? { ...job } : null;
  let aiModelAttemptState: AiModelAttemptRow | null = null;

  const jobsGetById = vi.fn(async () => (jobState ? { ...jobState } : null));
  const jobsCreate = vi.fn();
  const jobsListByListingId = vi.fn(async (listingId: string) =>
    jobState && jobState.listing_id === listingId ? [{ ...jobState }] : []
  );
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
  const listingsGetByOfferId = vi.fn(async () => listingStates.at(-1) ?? null);
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
    aiModelAttempts: {
      create: vi.fn(async (input) => {
        if (aiModelAttemptError) {
          throw aiModelAttemptError;
        }

        aiModelAttemptState = {
          ...startedAiModelAttemptRow,
          attempt_order: input.attempt_order ?? 1,
          created_at: input.started_at ?? startedAiModelAttemptRow.created_at,
          job_id: input.job_id ?? null,
          listing_id: input.listing_id,
          metadata: input.metadata ?? {},
          model_name: input.model_name,
          provider: input.provider,
          provider_model_id: input.provider_model_id ?? null,
          routing_source: input.routing_source ?? null,
          started_at: input.started_at ?? startedAiModelAttemptRow.started_at,
          status: input.status ?? 'started',
        };

        return { ...aiModelAttemptState };
      }),
      listByListingId: vi.fn(async (listingId: string) =>
        aiModelAttemptState && aiModelAttemptState.listing_id === listingId ? [{ ...aiModelAttemptState }] : []
      ),
      markFailed: vi.fn(async (input) => {
        if (aiModelAttemptError) {
          throw aiModelAttemptError;
        }

        if (!aiModelAttemptState) {
          throw new Error('ai model attempt missing');
        }

        aiModelAttemptState = {
          ...aiModelAttemptState,
          duration_ms: input.duration_ms ?? null,
          failure_code: input.failure_code ?? null,
          failure_message: input.failure_message ?? null,
          finished_at: input.finished_at,
          status: 'failed',
        };

        return { ...aiModelAttemptState };
      }),
      markSucceeded: vi.fn(async (input) => {
        if (aiModelAttemptError) {
          throw aiModelAttemptError;
        }

        if (!aiModelAttemptState) {
          throw new Error('ai model attempt missing');
        }

        aiModelAttemptState = {
          ...aiModelAttemptState,
          duration_ms: input.duration_ms ?? null,
          finished_at: input.finished_at,
          status: 'succeeded',
        };

        return { ...aiModelAttemptState };
      }),
    },
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
      enqueuePublish: vi.fn(async () => ({
        alreadyQueued: false,
        job: {
          ...queuedProcessImagesJob,
          id: 'job-publish',
          job_type: 'publish',
          listing_id: 'LIST-001',
          max_attempts: 3,
        },
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
      resetForManualRetry: vi.fn(async () => null),
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
      updateGeminiAttemptAudit: vi.fn(async (_jobId: string, audit) => {
        if (!jobState) {
          throw new Error('job missing');
        }

        if (geminiAttemptAuditError) {
          throw geminiAttemptAuditError;
        }

        jobState = {
          ...jobState,
          ...audit,
        };

        return { ...jobState };
      }),
      update: jobsUpdate,
    },
    listings: {
      claimApprovedForPublish: vi.fn(async (listingId: string) => {
        const current = listingStates.at(-1);
        if (
          !current ||
          current.listing_id !== listingId ||
          current.status !== 'approved_for_export' ||
          current.sub_status !== 'publish_queued'
        ) {
          return null;
        }

        const nextState = {
          ...current,
          last_error_at: null,
          last_error_code: null,
          last_error_context: {},
          last_error_message: null,
          sub_status: 'publishing_to_ebay',
        } as ListingRow;
        listingStates.push(nextState);
        return nextState;
      }),
      create: listingsCreate,
      getByOfferId: listingsGetByOfferId,
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
      cardConditionNote: 'Visible edge wear and light corner wear.',
      cardConditionToken: 'VG',
      conditionSuggestion: 'Ungraded',
      aspects: {
        Franchise: 'Utah Jazz',
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
        category_id: '183050',
        condition_id: '4000',
        condition_notes: 'Visible edge wear and light corner wear.',
        description: 'Ungraded single card with visible edge wear.',
        item_specifics: {
          'Card Condition': 'VG',
          Franchise: 'Utah Jazz',
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
    expect(dataAccess.jobs.updateGeminiAttemptAudit).toHaveBeenNthCalledWith(1, 'job-generate-ai', {
      gemini_attempt_count: 1,
      gemini_attempts: [
        {
          attempt_order: 1,
          completed_at: null,
          duration_ms: null,
          failure_code: null,
          failure_message: null,
          model_name: 'gemini-3.1-flash-lite',
          started_at: '2026-05-20T13:00:00.000Z',
          status: 'started',
        },
      ],
      gemini_selected_model: null,
    });
    expect(dataAccess.jobs.updateGeminiAttemptAudit).toHaveBeenNthCalledWith(2, 'job-generate-ai', {
      gemini_attempt_count: 1,
      gemini_attempts: [
        {
          attempt_order: 1,
          completed_at: '2026-05-20T13:00:00.000Z',
          duration_ms: 0,
          failure_code: null,
          failure_message: null,
          model_name: 'gemini-3.1-flash-lite',
          started_at: '2026-05-20T13:00:00.000Z',
          status: 'succeeded',
        },
      ],
      gemini_selected_model: 'gemini-3.1-flash-lite',
    });
    expect(dataAccess.aiModelAttempts.create).toHaveBeenCalledWith({
      job_id: 'job-generate-ai',
      listing_id: 'LIST-001',
      model_name: 'gemini-3.1-flash-lite',
      provider: 'google',
      provider_model_id: 'gemini-3.1-flash-lite',
      routing_source: 'direct_gemini',
      started_at: '2026-05-20T13:00:00.000Z',
      status: 'started',
    });
    expect(dataAccess.aiModelAttempts.markSucceeded).toHaveBeenCalledWith({
      duration_ms: 0,
      finished_at: '2026-05-20T13:00:00.000Z',
      id: 'ai-model-attempt-row-id',
    });
    expect(dataAccess.listings.updateWorkflowState).toHaveBeenCalledTimes(1);
    expect(result.listing?.status).toBe('needs_review');
    expect(result.listing?.sub_status).toBe('review_pending');
    expect(result.job.status).toBe('completed');
    expect(result.job.gemini_attempt_count).toBe(1);
    expect(result.job.gemini_selected_model).toBe('gemini-3.1-flash-lite');
    expect(result.job.gemini_attempts).toEqual([
      expect.objectContaining({
        attempt_order: 1,
        model_name: 'gemini-3.1-flash-lite',
        status: 'succeeded',
      }),
    ]);
  });

  it('resolves category and condition ids from Gemini suggestions only for trading card singles', async () => {
    const dataAccess = createDataAccess({
      listing: createListingRow({
        listing_type: 'single',
        title: 'Bo Jackson card',
      }),
    });
    const generateListingDraftMock = vi.fn(async () => ({
      title: '1990 Score Bo Jackson',
      description: 'Single raw card.',
      categorySuggestion: 'Sports Trading Cards',
      cardConditionNote: 'No grading evidence visible.',
      cardConditionToken: 'EX',
      conditionSuggestion: 'Ungraded',
      aspects: {},
      priceSuggestion: 19.99,
      confidence: {},
      warnings: [],
      rawModelResponse: { id: 'raw-response-2' },
    }));

    await runSidecarJob('job-generate-ai', {
      dataAccess,
      generateListingDraft: generateListingDraftMock,
      now: () => new Date('2026-05-20T13:00:00.000Z'),
    });

    expect(dataAccess.listings.update).toHaveBeenCalledWith(
      'LIST-001',
      expect.objectContaining({
        category_id: '183050',
        condition_id: '4000',
        status: 'needs_review',
        sub_status: 'review_pending',
      })
    );
  });

  it('does not resolve category id for non-single trading card listings', async () => {
    const dataAccess = createDataAccess({
      listing: createListingRow({
        listing_type: 'lot',
      }),
    });
    const generateListingDraftMock = vi.fn(async () => ({
      title: '1990 Score Bo Jackson',
      description: 'Card lot.',
      categorySuggestion: 'Sports Trading Cards',
      cardConditionNote: 'Estimated from limited photos.',
      cardConditionToken: 'GOOD',
      conditionSuggestion: 'Ungraded',
      aspects: {},
      priceSuggestion: 19.99,
      confidence: {},
      warnings: [],
      rawModelResponse: { id: 'raw-response-3' },
    }));

    await runSidecarJob('job-generate-ai', {
      dataAccess,
      generateListingDraft: generateListingDraftMock,
      now: () => new Date('2026-05-20T13:00:00.000Z'),
    });

    expect(dataAccess.listings.update).toHaveBeenCalledWith(
      'LIST-001',
      expect.objectContaining({
        category_id: null,
        condition_id: '4000',
      })
    );
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
    expect(dataAccess.jobs.updateGeminiAttemptAudit).toHaveBeenNthCalledWith(1, 'job-generate-ai', {
      gemini_attempt_count: 1,
      gemini_attempts: [
        {
          attempt_order: 1,
          completed_at: null,
          duration_ms: null,
          failure_code: null,
          failure_message: null,
          model_name: 'gemini-3.1-flash-lite',
          started_at: '2026-05-20T13:00:00.000Z',
          status: 'started',
        },
      ],
      gemini_selected_model: null,
    });
    expect(dataAccess.jobs.updateGeminiAttemptAudit).toHaveBeenNthCalledWith(2, 'job-generate-ai', {
      gemini_attempt_count: 1,
      gemini_attempts: [
        {
          attempt_order: 1,
          completed_at: '2026-05-20T13:00:00.000Z',
          duration_ms: 0,
          failure_code: 'generate_ai_failed',
          failure_message: 'Gemini timed out',
          model_name: 'gemini-3.1-flash-lite',
          started_at: '2026-05-20T13:00:00.000Z',
          status: 'failed',
        },
      ],
      gemini_selected_model: null,
    });
    expect(dataAccess.aiModelAttempts.create).toHaveBeenCalledWith({
      job_id: 'job-generate-ai',
      listing_id: 'LIST-001',
      model_name: 'gemini-3.1-flash-lite',
      provider: 'google',
      provider_model_id: 'gemini-3.1-flash-lite',
      routing_source: 'direct_gemini',
      started_at: '2026-05-20T13:00:00.000Z',
      status: 'started',
    });
    expect(dataAccess.aiModelAttempts.markFailed).toHaveBeenCalledWith({
      duration_ms: 0,
      failure_code: 'generate_ai_failed',
      failure_message: 'Gemini timed out',
      finished_at: '2026-05-20T13:00:00.000Z',
      id: 'ai-model-attempt-row-id',
    });
    expect(result.job.gemini_attempt_count).toBe(1);
    expect(result.job.gemini_selected_model).toBeNull();
    expect(result.job.gemini_attempts).toEqual([
      expect.objectContaining({
        attempt_order: 1,
        failure_code: 'generate_ai_failed',
        failure_message: 'Gemini timed out',
        model_name: 'gemini-3.1-flash-lite',
        status: 'failed',
      }),
    ]);
  });

  it('keeps generate_ai success when Gemini audit persistence fails', async () => {
    const dataAccess = createDataAccess({
      geminiAttemptAuditError: new Error('audit write failed'),
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

    expect(generateListingDraftMock).toHaveBeenCalledTimes(1);
    expect(dataAccess.jobs.updateGeminiAttemptAudit).toHaveBeenCalledTimes(2);
    expect(dataAccess.aiModelAttempts.create).not.toHaveBeenCalled();
    expect(dataAccess.aiModelAttempts.markSucceeded).not.toHaveBeenCalled();
    expect(result.job.status).toBe('completed');
    expect(result.job.last_error_code).toBeNull();
    expect(result.listing?.status).toBe('needs_review');
    expect(result.listing?.sub_status).toBe('review_pending');
  });

  it('keeps generate_ai success when ai model audit persistence fails', async () => {
    const dataAccess = createDataAccess({
      aiModelAttemptError: new Error('ai audit write failed'),
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

    expect(generateListingDraftMock).toHaveBeenCalledTimes(1);
    expect(dataAccess.aiModelAttempts.create).toHaveBeenCalledTimes(1);
    expect(dataAccess.aiModelAttempts.markSucceeded).not.toHaveBeenCalled();
    expect(result.job.status).toBe('completed');
    expect(result.job.last_error_code).toBeNull();
    expect(result.listing?.status).toBe('needs_review');
    expect(result.listing?.sub_status).toBe('review_pending');
  });

  it('preserves the Gemini failure when Gemini audit persistence fails', async () => {
    const dataAccess = createDataAccess({
      geminiAttemptAuditError: new Error('audit write failed'),
    });
    const generateListingDraftMock = vi.fn(async () => {
      throw new Error('Gemini timed out');
    });

    const result = await runSidecarJob('job-generate-ai', {
      dataAccess,
      generateListingDraft: generateListingDraftMock,
      now: () => new Date('2026-05-20T13:00:00.000Z'),
    });

    expect(generateListingDraftMock).toHaveBeenCalledTimes(1);
    expect(dataAccess.jobs.updateGeminiAttemptAudit).toHaveBeenCalledTimes(2);
    expect(dataAccess.aiModelAttempts.create).not.toHaveBeenCalled();
    expect(dataAccess.aiModelAttempts.markFailed).not.toHaveBeenCalled();
    expect(result.job.status).toBe('queued');
    expect(result.job.last_error_code).toBe('generate_ai_failed');
    expect(result.job.last_error).toContain('Gemini timed out');
    expect(result.job.last_error).not.toContain('audit write failed');
    expect(result.listing?.last_error_code).toBe('generate_ai_failed');
  });

  it('preserves Gemini failure when ai model audit persistence fails', async () => {
    const dataAccess = createDataAccess({
      aiModelAttemptError: new Error('ai audit write failed'),
    });
    const generateListingDraftMock = vi.fn(async () => {
      throw new Error('Gemini timed out');
    });

    const result = await runSidecarJob('job-generate-ai', {
      dataAccess,
      generateListingDraft: generateListingDraftMock,
      now: () => new Date('2026-05-20T13:00:00.000Z'),
    });

    expect(generateListingDraftMock).toHaveBeenCalledTimes(1);
    expect(dataAccess.aiModelAttempts.create).toHaveBeenCalledTimes(1);
    expect(dataAccess.aiModelAttempts.markFailed).not.toHaveBeenCalled();
    expect(result.job.status).toBe('queued');
    expect(result.job.last_error_code).toBe('generate_ai_failed');
    expect(result.job.last_error).toContain('Gemini timed out');
    expect(result.job.last_error).not.toContain('ai audit write failed');
    expect(result.listing?.last_error_code).toBe('generate_ai_failed');
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

  it('claims publish jobs, runs publish orchestration, and completes on success', async () => {
    const dataAccess = createDataAccess({
      job: queuedPublishJob,
      listing: createListingRow({
        status: 'approved_for_export',
        sub_status: 'publish_queued',
      }),
    });
    const publishListingMock = vi.fn(async (listingId: string, dependencies?: { dataAccess?: SidecarDataAccess }) => {
      await dependencies?.dataAccess?.listings.update(listingId, {
        ebay_listing_id: 'EBAY-001',
        exported_at: '2026-05-20T13:00:00.000Z',
        last_error_at: null,
        last_error_code: null,
        last_error_context: {},
        last_error_message: null,
        status: 'exported',
        sub_status: 'idle',
      });

      return {
        ebayListingId: 'EBAY-001',
        exportedAt: '2026-05-20T13:00:00.000Z',
        listingId,
        offerId: 'OFFER-001',
        reusedExistingOffer: false,
        sku: 'LIST-001',
        status: 'exported' as const,
      };
    });

    const result = await runSidecarJob('job-publish', {
      dataAccess,
      now: () => new Date('2026-05-20T13:00:00.000Z'),
      publishListing: publishListingMock,
    });

    expect(dataAccess.listings.claimApprovedForPublish).toHaveBeenCalledWith('LIST-001');
    expect(publishListingMock).toHaveBeenCalledWith(
      'LIST-001',
      expect.objectContaining({
        dataAccess,
        now: expect.any(Function),
      })
    );
    expect(result.job.status).toBe('completed');
    expect(result.listing).toMatchObject({
      ebay_listing_id: 'EBAY-001',
      status: 'exported',
      sub_status: 'idle',
    });
  });

  it('requeues recoverable publish failures and restores listing to publish_queued', async () => {
    const dataAccess = createDataAccess({
      job: queuedPublishJob,
      listing: createListingRow({
        status: 'approved_for_export',
        sub_status: 'publish_queued',
      }),
    });
    const publishListingMock = vi.fn(async () => {
      throw new PublishListingError('OFFER_PUBLISH_FAILED', 'Sandbox unavailable', {
        listingId: 'LIST-001',
        stage: 'publish',
      });
    });

    const result = await runSidecarJob('job-publish', {
      dataAccess,
      now: () => new Date('2026-05-20T13:00:00.000Z'),
      publishListing: publishListingMock,
    });

    expect(result.job.status).toBe('queued');
    expect(result.job.last_error_code).toBe('publish_offer_publish_failed');
    expect(result.job.next_run_at).toBe('2026-05-20T13:01:00.000Z');
    expect(result.listing).toMatchObject({
      last_error_code: 'publish_offer_publish_failed',
      status: 'approved_for_export',
      sub_status: 'publish_queued',
    });
  });

  it('returns local listing-data publish validation errors to needs_review/review_pending', async () => {
    const dataAccess = createDataAccess({
      job: queuedPublishJob,
      listing: createListingRow({
        category_id: '1234',
        condition_id: '4000',
        image_urls: ['https://cdn.example.com/front.jpg'],
        price: 24.5,
        status: 'approved_for_export',
        sub_status: 'publish_queued',
        title: 'Vintage puzzle',
      }),
    });
    const publishListingMock = vi.fn(async () => {
      throw new PublishListingError('LISTING_NOT_READY', 'Missing title.', {
        listingId: 'LIST-001',
        issues: ['Missing title.'],
        stage: 'validate',
      });
    });

    const result = await runSidecarJob('job-publish', {
      dataAccess,
      now: () => new Date('2026-05-20T13:00:00.000Z'),
      publishListing: publishListingMock,
    });

    expect(result.job.status).toBe('failed');
    expect(result.job.last_error_code).toBe('publish_listing_not_ready');
    expect(result.listing).toMatchObject({
      category_id: '1234',
      condition_id: '4000',
      image_urls: ['https://cdn.example.com/front.jpg'],
      last_error_code: 'publish_listing_not_ready',
      last_error_context: expect.objectContaining({
        category: 'user_fixable',
        validation_scope: 'listing',
      }),
      price: 24.5,
      status: 'needs_review',
      sub_status: 'review_pending',
      title: 'Vintage puzzle',
    });
  });

  it('returns over-length local title validation errors to needs_review/review_pending', async () => {
    const dataAccess = createDataAccess({
      job: queuedPublishJob,
      listing: createListingRow({
        category_id: '1234',
        condition_id: '4000',
        image_urls: ['https://cdn.example.com/front.jpg'],
        item_specifics: { Brand: 'Acme' },
        price: 24.5,
        status: 'approved_for_export',
        sub_status: 'publish_queued',
        title: 'a'.repeat(81),
      }),
    });
    const publishListingMock = vi.fn(async () => {
      throw new PublishListingValidationError('LIST-001', [
        'Listing "LIST-001" title must be 80 characters or fewer for eBay publish. Current length: 81.',
      ]);
    });

    const result = await runSidecarJob('job-publish', {
      dataAccess,
      now: () => new Date('2026-05-20T13:00:00.000Z'),
      publishListing: publishListingMock,
    });

    expect(result.job.status).toBe('failed');
    expect(result.job.last_error_code).toBe('publish_listing_not_ready');
    expect(result.listing).toMatchObject({
      category_id: '1234',
      condition_id: '4000',
      image_urls: ['https://cdn.example.com/front.jpg'],
      item_specifics: { Brand: 'Acme' },
      last_error_code: 'publish_listing_not_ready',
      last_error_context: expect.objectContaining({
        category: 'user_fixable',
        validation_scope: 'listing',
      }),
      price: 24.5,
      status: 'needs_review',
      sub_status: 'review_pending',
      title: 'a'.repeat(81),
    });
  });

  it('returns eBay title-length publish failures to needs_review/review_pending', async () => {
    const dataAccess = createDataAccess({
      job: queuedPublishJob,
      listing: createListingRow({
        category_id: '1234',
        condition_id: '4000',
        image_urls: ['https://cdn.example.com/front.jpg'],
        item_specifics: { Brand: 'Acme' },
        price: 24.5,
        status: 'approved_for_export',
        sub_status: 'publish_queued',
        title: 'Vintage puzzle title that is too long for eBay but should remain editable.',
      }),
    });
    const publishListingMock = vi.fn(async () => {
      throw new PublishListingError(
        'OFFER_PUBLISH_FAILED',
        'Failed to publish offer for listing "LIST-001".',
        {
          ebayErrors: [
            {
              category: 'REQUEST',
              domain: 'API_INVENTORY',
              errorId: 25718,
              longMessage:
                'Invalid value for title. The length should be between 1 and 80 characters.',
              message: 'Invalid value for title.',
            },
          ],
          listingId: 'LIST-001',
          stage: 'publish',
        }
      );
    });

    const result = await runSidecarJob('job-publish', {
      dataAccess,
      now: () => new Date('2026-05-20T13:00:00.000Z'),
      publishListing: publishListingMock,
    });

    expect(result.job.status).toBe('failed');
    expect(result.job.last_error_code).toBe('publish_offer_publish_failed');
    expect(result.listing).toMatchObject({
      category_id: '1234',
      condition_id: '4000',
      image_urls: ['https://cdn.example.com/front.jpg'],
      item_specifics: { Brand: 'Acme' },
      last_error_code: 'publish_offer_publish_failed',
      last_error_context: expect.objectContaining({
        category: 'user_fixable',
        validation_scope: 'listing',
      }),
      price: 24.5,
      status: 'needs_review',
      sub_status: 'review_pending',
      title: 'Vintage puzzle title that is too long for eBay but should remain editable.',
    });
    expect(result.listing?.last_error_context).toMatchObject({
      ebayErrors: [
        expect.objectContaining({
          category: 'REQUEST',
          domain: 'API_INVENTORY',
          errorId: 25718,
        }),
      ],
    });
  });

  it('persists enriched finalize failure context on terminal publish errors', async () => {
    const dataAccess = createDataAccess({
      job: queuedPublishJob,
      listing: createListingRow({
        status: 'approved_for_export',
        sub_status: 'publish_queued',
      }),
    });
    const publishListingMock = vi.fn(async () => {
      throw new PublishListingError(
        'EXPORT_STATE_PERSIST_FAILED',
        'Published offer but local finalize failed.',
        {
          attemptedFields: ['ebay_offer_id', 'ebay_listing_id', 'last_error_context'],
          causeMessage: 'null value in column "last_error_context"',
          listingId: 'LIST-001',
          offerId: 'OFFER-001',
          publishOfferListingId: 'EBAY-001',
          stage: 'finalize',
        }
      );
    });

    const result = await runSidecarJob('job-publish', {
      dataAccess,
      now: () => new Date('2026-05-20T13:00:00.000Z'),
      publishListing: publishListingMock,
    });

    expect(result.job.status).toBe('failed');
    expect(result.job.last_error_code).toBe('publish_export_state_persist_failed');
    expect(result.listing?.last_error_context).toMatchObject({
      attemptedFields: ['ebay_offer_id', 'ebay_listing_id', 'last_error_context'],
      causeMessage: 'null value in column "last_error_context"',
      category: 'terminal',
      offerId: 'OFFER-001',
      publishOfferListingId: 'EBAY-001',
      publish_error_code: 'EXPORT_STATE_PERSIST_FAILED',
      stage: 'finalize',
    });
  });

  it('does not overwrite listing errors when a duplicate stale publish job finds approved_for_export/idle', async () => {
    const priorFailedPublishJob: JobRow = {
      ...queuedPublishJob,
      id: 'job-publish-prior-failed',
      last_error: 'Missing title.',
      last_error_at: '2026-05-20T12:55:00.000Z',
      last_error_code: 'publish_listing_not_ready',
      status: 'failed',
      updated_at: '2026-05-20T12:55:00.000Z',
    };
    const listing = createListingRow({
      last_error_at: '2026-05-20T12:55:00.000Z',
      last_error_code: 'publish_listing_not_ready',
      last_error_context: {
        issues: ['Missing title.'],
      },
      last_error_message: 'Missing title.',
      status: 'approved_for_export',
      sub_status: 'idle',
    });
    const dataAccess = createDataAccess({
      job: queuedPublishJob,
      listing,
    });
    dataAccess.jobs.listByListingId = vi.fn(async () => [
      queuedPublishJob,
      priorFailedPublishJob,
    ]);
    const publishListingMock = vi.fn();

    const result = await runSidecarJob('job-publish', {
      dataAccess,
      now: () => new Date('2026-05-20T13:00:00.000Z'),
      publishListing: publishListingMock,
    });

    expect(result.job.status).toBe('failed');
    expect(result.job.last_error_code).toBe('job_not_runnable');
    expect(result.listing).toMatchObject({
      last_error_at: '2026-05-20T12:55:00.000Z',
      last_error_code: 'publish_listing_not_ready',
      last_error_message: 'Missing title.',
      status: 'approved_for_export',
      sub_status: 'idle',
    });
    expect(dataAccess.listings.update).not.toHaveBeenCalledWith(
      'LIST-001',
      expect.objectContaining({
        last_error_code: 'publish_listing_not_eligible',
      })
    );
    expect(publishListingMock).not.toHaveBeenCalled();
  });

  it('keeps standard not-eligible behavior when no duplicate publish history exists', async () => {
    const dataAccess = createDataAccess({
      job: queuedPublishJob,
      listing: createListingRow({
        status: 'approved_for_export',
        sub_status: 'idle',
      }),
    });

    const result = await runSidecarJob('job-publish', {
      dataAccess,
      now: () => new Date('2026-05-20T13:00:00.000Z'),
      publishListing: vi.fn(),
    });

    expect(result.job.status).toBe('failed');
    expect(result.job.last_error_code).toBe('publish_listing_not_eligible');
    expect(result.listing).toMatchObject({
      last_error_code: 'publish_listing_not_eligible',
      status: 'approved_for_export',
      sub_status: 'idle',
    });
  });

  it('fails exhausted recoverable publish retries with retry_exhausted', async () => {
    const dataAccess = createDataAccess({
      job: {
        ...queuedPublishJob,
        attempts: 3,
        status: 'running',
      },
      listing: createListingRow({
        status: 'approved_for_export',
        sub_status: 'publishing_to_ebay',
      }),
    });
    const publishListingMock = vi.fn(async () => {
      throw new PublishListingError('OFFER_PUBLISH_FAILED', 'Still unavailable', {
        listingId: 'LIST-001',
        stage: 'publish',
      });
    });

    const result = await runSidecarJob('job-publish', {
      dataAccess,
      now: () => new Date('2026-05-20T13:00:00.000Z'),
      publishListing: publishListingMock,
    });

    expect(result.job.status).toBe('failed');
    expect(result.job.last_error_code).toBe('retry_exhausted');
    expect(result.listing).toMatchObject({
      last_error_code: 'retry_exhausted',
      status: 'approved_for_export',
      sub_status: 'idle',
    });
  });

  it('preserves ebay_offer_id when publish fails after offer creation', async () => {
    const dataAccess = createDataAccess({
      job: queuedPublishJob,
      listing: createListingRow({
        status: 'approved_for_export',
        sub_status: 'publish_queued',
      }),
    });
    const publishListingMock = vi.fn(async (listingId: string, dependencies?: { dataAccess?: SidecarDataAccess }) => {
      await dependencies?.dataAccess?.listings.update(listingId, {
        ebay_offer_id: 'OFFER-001',
        sku: 'LIST-001',
      });

      throw new PublishListingError('OFFER_PUBLISH_FAILED', 'Sandbox unavailable', {
        listingId: 'LIST-001',
        stage: 'publish',
      });
    });

    const result = await runSidecarJob('job-publish', {
      dataAccess,
      now: () => new Date('2026-05-20T13:00:00.000Z'),
      publishListing: publishListingMock,
    });

    expect(result.job.status).toBe('queued');
    expect(result.listing).toMatchObject({
      ebay_offer_id: 'OFFER-001',
      last_error_code: 'publish_offer_publish_failed',
      status: 'approved_for_export',
      sub_status: 'publish_queued',
    });
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

  it('reports a claim race as not claimable when a queued job cannot be claimed', async () => {
    const dataAccess = createDataAccess({
      job: queuedGenerateAiJob,
    });
    dataAccess.jobs.claimDueQueued = vi.fn(async () => null);

    await expect(
      runSidecarJob('job-generate-ai', {
        dataAccess,
        now: () => new Date('2026-05-20T13:00:00.000Z'),
      })
    ).rejects.toMatchObject({
      code: 'job_not_claimable',
      message:
        'Job "job-generate-ai" is queued but could not be claimed for execution. It may not be due yet or another worker already claimed it.',
    });
  });
});
