import type {
  AiModelAttemptRow,
  JobRow,
  ListingPriceResearchRow,
  ListingRow,
  ResolvedAiModelRoute,
} from '@ebay-inventory/data';
import { describe, expect, it, vi } from 'vitest';

import type { SidecarDataAccess } from '@/data/sidecar-data.js';
import {
  PublishListingError,
  PublishRequiredItemSpecificsValidationError,
  PublishListingValidationError,
  PublishRequiredFieldValidationError,
} from '@/ebay/publish-validation.js';
import { PublishImageUrlReadinessValidationError } from '@/ebay/image-url-readiness.js';
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

const queuedResearchPriceJob: JobRow = {
  attempts: 0,
  created_at: '2026-05-20T12:00:00.000Z',
  gemini_attempt_count: 0,
  gemini_attempts: [],
  gemini_selected_model: null,
  id: 'job-research-price',
  job_type: 'research_price',
  last_error: null,
  last_error_at: null,
  last_error_code: null,
  listing_id: 'LIST-001',
  max_attempts: 1,
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

function createResolvedAiModelRoute(
  overrides: Partial<ResolvedAiModelRoute> = {}
): ResolvedAiModelRoute {
  return {
    displayName: 'Gemini 3.1 Flash Lite',
    fallbackOnQuotaExceeded: true,
    fallbackOnRateLimit: true,
    fallbackOnUnavailable: true,
    freeTierStatus: 'unknown',
    isFreeTierEligible: true,
    modelName: 'gemini-3.1-flash-lite',
    provider: 'google',
    routeOrder: 1,
    supportsImages: true,
    supportsJsonOutput: true,
    supportsStructuredOutput: true,
    supportsText: true,
    taskType: 'listing_draft_generation',
    ...overrides,
  };
}

const resolvedAiModelRoute = createResolvedAiModelRoute();

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

function createListingPriceResearchRow(
  overrides: Partial<ListingPriceResearchRow> = {}
): ListingPriceResearchRow {
  return {
    comps: [],
    confidence: null,
    created_at: '2026-05-20T13:00:00.000Z',
    error_code: null,
    error_message: null,
    id: 'listing-price-research-1',
    listing_id: 'LIST-001',
    llm_price_explanation: null,
    llm_reasoning_json: {},
    llm_rejected_comp_ids: [],
    llm_selected_comp_ids: [],
    median_sold_price: null,
    pricing_model_name: null,
    provider: 'fixture',
    query: null,
    raw_result_json: {},
    sold_count: null,
    status: 'pending',
    suggested_price: null,
    updated_at: '2026-05-20T13:00:00.000Z',
    ...overrides,
  };
}

function expectPricingFailureToPreserveListingWorkflow(
  listing: ListingRow,
  resultListing: ListingRow | null
): void {
  expect(resultListing).toMatchObject({
    last_error_at: listing.last_error_at,
    last_error_code: listing.last_error_code,
    last_error_context: listing.last_error_context,
    last_error_message: listing.last_error_message,
    price: listing.price,
    status: listing.status,
    sub_status: listing.sub_status,
  });
}

function expectNoWorkflowErrorFieldsWritten(
  updates: Array<[string, Partial<ListingRow>]>
): void {
  for (const [, changes] of updates) {
    expect(changes).not.toHaveProperty('last_error_at');
    expect(changes).not.toHaveProperty('last_error_code');
    expect(changes).not.toHaveProperty('last_error_context');
    expect(changes).not.toHaveProperty('last_error_message');
    expect(changes).not.toHaveProperty('status');
    expect(changes).not.toHaveProperty('sub_status');
  }
}

function createDataAccess({
  job = queuedGenerateAiJob,
  listing = createListingRow(),
  aiModelAttemptError,
  aiModelRoute = resolvedAiModelRoute,
  aiModelRoutes = [aiModelRoute],
  aiModelRouteError,
  dailyUsageIncrementError,
  dailyUsageIncrementErrors,
  geminiAttemptAuditError,
  onListingsUpdate,
  workflowStates = [],
}: {
  job?: JobRow | null;
  listing?: ListingRow | null;
  aiModelAttemptError?: Error;
  aiModelRoute?: ResolvedAiModelRoute;
  aiModelRoutes?: ResolvedAiModelRoute[];
  aiModelRouteError?: Error;
  dailyUsageIncrementError?: Error;
  dailyUsageIncrementErrors?: (Error | undefined)[];
  geminiAttemptAuditError?: Error;
  onListingsUpdate?: (changes: Partial<ListingRow>, current: ListingRow) => void;
  workflowStates?: ListingRow[];
} = {}): SidecarDataAccess {
  const listingStates = workflowStates.length > 0 ? [...workflowStates] : listing ? [listing] : [];
  let jobState = job ? { ...job } : null;
  const aiModelAttemptStates: AiModelAttemptRow[] = [];
  const listingPriceResearchStates: ListingPriceResearchRow[] = [];
  let aiModelAttemptIdCounter = 0;
  let listingPriceResearchIdCounter = 0;
  const dailyUsageErrors = [...(dailyUsageIncrementErrors ?? [])];

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
  const listingPriceResearchCreate = vi.fn(async (input) => {
    listingPriceResearchIdCounter += 1;
    const state = createListingPriceResearchRow({
      ...input,
      id: `listing-price-research-${listingPriceResearchIdCounter}`,
    });
    listingPriceResearchStates.push(state);
    return { ...state };
  });
  const listingPriceResearchMarkFailed = vi.fn(async (input) => {
    const current = listingPriceResearchStates.find((candidate) => candidate.id === input.id);
    if (!current) {
      throw new Error('listing price research missing');
    }

    const nextState = {
      ...current,
      ...input,
      status: 'failed',
    } as ListingPriceResearchRow;
    listingPriceResearchStates[listingPriceResearchStates.indexOf(current)] = nextState;
    return { ...nextState };
  });
  const listingPriceResearchMarkSucceeded = vi.fn(async (input) => {
    const current = listingPriceResearchStates.find((candidate) => candidate.id === input.id);
    if (!current) {
      throw new Error('listing price research missing');
    }

    const nextState = {
      ...current,
      ...input,
      error_code: null,
      error_message: null,
      status: 'succeeded',
    } as ListingPriceResearchRow;
    listingPriceResearchStates[listingPriceResearchStates.indexOf(current)] = nextState;
    return { ...nextState };
  });
  const ordersCreate = vi.fn();
  const ordersGetByOrderId = vi.fn();
  const ordersUpdate = vi.fn();
  const appSettingsCreate = vi.fn();
  const appSettingsGet = vi.fn();
  const appSettingsUpdate = vi.fn();

  return {
    aiModelRoutes: {
      resolveForTask: vi.fn(async () => {
        if (aiModelRouteError) {
          throw aiModelRouteError;
        }

        return aiModelRoutes;
      }),
      resolvePrimaryForTask: vi.fn(async () => {
        if (aiModelRouteError) {
          throw aiModelRouteError;
        }

        return aiModelRoute;
      }),
    },
    dailyUsage: {
      getEffectiveGeminiLimit: vi.fn(async () => ({
        effectiveLimit: 500,
        source: 'app_settings' as const,
        usage: {
          gemini_calls_used: 0,
          gemini_daily_limit: 500,
          order_sync_count: 0,
          usage_date: '2026-05-20',
        },
      })),
      getEffectiveOrderSyncLimit: vi.fn(async () => ({
        effectiveLimit: 25,
        source: 'app_settings' as const,
        usage: {
          gemini_calls_used: 0,
          gemini_daily_limit: 500,
          order_sync_count: 0,
          usage_date: '2026-05-20',
        },
      })),
      getGeminiSummary: vi.fn(async () => ({
        effectiveLimit: 500,
        remaining: 500,
        resetAt: '2026-05-21T07:00:00.000Z',
        resetTimeZone: 'America/Los_Angeles' as const,
        usageDate: '2026-05-20',
        used: 0,
      })),
      getOrCreate: vi.fn(async () => ({
        gemini_calls_used: 0,
        gemini_daily_limit: 500,
        order_sync_count: 0,
        usage_date: '2026-05-20',
      })),
      incrementGeminiCallsUsed: vi.fn(async () => {
        const nextError = dailyUsageErrors.shift();
        if (nextError) {
          throw nextError;
        }

        if (dailyUsageIncrementError) {
          throw dailyUsageIncrementError;
        }

        return {
          effectiveLimit: 500,
          resource: 'gemini' as const,
          source: 'app_settings' as const,
          updatedUsage: {
            gemini_calls_used: 1,
            gemini_daily_limit: 500,
            order_sync_count: 0,
            usage_date: '2026-05-20',
          },
          usage: {
            gemini_calls_used: 0,
            gemini_daily_limit: 500,
            order_sync_count: 0,
            usage_date: '2026-05-20',
          },
        };
      }),
      incrementOrderSyncCount: vi.fn(),
    },
    aiModelAttempts: {
      create: vi.fn(async (input) => {
        if (aiModelAttemptError) {
          throw aiModelAttemptError;
        }

        aiModelAttemptIdCounter += 1;
        const aiModelAttemptState = {
          ...startedAiModelAttemptRow,
          attempt_order: input.attempt_order ?? 1,
          created_at: input.started_at ?? startedAiModelAttemptRow.created_at,
          id:
            aiModelAttemptIdCounter === 1
              ? 'ai-model-attempt-row-id'
              : `ai-model-attempt-row-id-${aiModelAttemptIdCounter}`,
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
        aiModelAttemptStates.push(aiModelAttemptState);

        return { ...aiModelAttemptState };
      }),
      listByListingId: vi.fn(async (listingId: string) =>
        aiModelAttemptStates
          .filter((attempt) => attempt.listing_id === listingId)
          .map((attempt) => ({ ...attempt }))
      ),
      markFailed: vi.fn(async (input) => {
        if (aiModelAttemptError) {
          throw aiModelAttemptError;
        }

        const index = aiModelAttemptStates.findIndex((attempt) => attempt.id === input.id);
        if (index === -1) {
          throw new Error('ai model attempt missing');
        }

        const aiModelAttemptState = {
          ...aiModelAttemptStates[index],
          duration_ms: input.duration_ms ?? null,
          failure_code: input.failure_code ?? null,
          failure_message: input.failure_message ?? null,
          finished_at: input.finished_at,
          status: 'failed',
        };
        aiModelAttemptStates[index] = aiModelAttemptState;

        return { ...aiModelAttemptState };
      }),
      markSucceeded: vi.fn(async (input) => {
        if (aiModelAttemptError) {
          throw aiModelAttemptError;
        }

        const index = aiModelAttemptStates.findIndex((attempt) => attempt.id === input.id);
        if (index === -1) {
          throw new Error('ai model attempt missing');
        }

        const aiModelAttemptState = {
          ...aiModelAttemptStates[index],
          duration_ms: input.duration_ms ?? null,
          finished_at: input.finished_at,
          status: 'succeeded',
        };
        aiModelAttemptStates[index] = aiModelAttemptState;

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
    listingPriceResearch: {
      create: listingPriceResearchCreate,
      markFailed: listingPriceResearchMarkFailed,
      markSucceeded: listingPriceResearchMarkSucceeded,
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

  it('fails generate_ai jobs when no eligible AI model route is configured', async () => {
    const dataAccess = createDataAccess({
      aiModelRoutes: [],
    });
    const generateListingDraftMock = vi.fn();

    const result = await runSidecarJob('job-generate-ai', {
      dataAccess,
      generateListingDraft: generateListingDraftMock,
      now: () => new Date('2026-05-20T13:00:00.000Z'),
    });

    expect(result.job.status).toBe('queued');
    expect(result.job.last_error_code).toBe('AI_MODEL_ROUTE_NOT_CONFIGURED');
    expect(result.job.next_run_at).toBe('2026-05-20T13:01:00.000Z');
    expect(result.listing?.status).toBe('assets_ready');
    expect(result.listing?.sub_status).toBe('ready_to_generate');
    expect(result.listing?.last_error_code).toBe('AI_MODEL_ROUTE_NOT_CONFIGURED');
    expect(result.listing?.last_error_context).toEqual(
      expect.objectContaining({
        category: 'recoverable',
        free_tier_only: true,
        provider: 'google',
        require_images: true,
        require_json_output: true,
        require_structured_output: true,
        task_type: 'listing_draft_generation',
      })
    );
    expect(dataAccess.aiModelRoutes.resolveForTask).toHaveBeenCalledWith({
      freeTierOnly: true,
      provider: 'google',
      requireImages: true,
      requireJsonOutput: true,
      requireStructuredOutput: true,
      taskType: 'listing_draft_generation',
    });
    expect(dataAccess.dailyUsage.incrementGeminiCallsUsed).not.toHaveBeenCalled();
    expect(generateListingDraftMock).not.toHaveBeenCalled();
    expect(dataAccess.jobs.updateGeminiAttemptAudit).not.toHaveBeenCalled();
    expect(dataAccess.aiModelAttempts.create).not.toHaveBeenCalled();
    expect(dataAccess.listings.updateWorkflowState).not.toHaveBeenCalled();
  });

  it('does not start provider attempts when Gemini preflight fails', async () => {
    const dataAccess = createDataAccess();
    const prepareListingDraftMock = vi.fn(async () => {
      throw new Error('preflight image fetch failed');
    });

    const result = await runSidecarJob('job-generate-ai', {
      dataAccess,
      now: () => new Date('2026-05-20T13:00:00.000Z'),
      prepareListingDraft: prepareListingDraftMock,
    });

    expect(result.job.status).toBe('queued');
    expect(result.job.last_error_code).toBe('generate_ai_failed');
    expect(dataAccess.dailyUsage.incrementGeminiCallsUsed).not.toHaveBeenCalled();
    expect(dataAccess.jobs.updateGeminiAttemptAudit).not.toHaveBeenCalled();
    expect(dataAccess.aiModelAttempts.create).not.toHaveBeenCalled();
    expect(dataAccess.listings.updateWorkflowState).not.toHaveBeenCalled();
  });

  it('transitions generate_ai listings to needs_review and persists draft fields once', async () => {
    const dataAccess = createDataAccess({
      job: {
        ...queuedGenerateAiJob,
        listing_id: 'Single-000001',
      },
      listing: createListingRow({
        listing_id: 'Single-000001',
        sku: 'Single-000001',
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
      cardConditionToken: 'VERY_GOOD',
      conditionSuggestion: 'Ungraded',
      skuCategoryCode: 'BSKBL',
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

    expect(dataAccess.dailyUsage.incrementGeminiCallsUsed).toHaveBeenCalledTimes(1);
    expect(dataAccess.listings.updateWorkflowState).toHaveBeenNthCalledWith(1, {
      listingId: 'Single-000001',
      status: 'generating',
      subStatus: 'ai_call_in_progress',
    });
    expect(dataAccess.aiModelRoutes.resolveForTask).toHaveBeenCalledWith({
      freeTierOnly: true,
      provider: 'google',
      requireImages: true,
      requireJsonOutput: true,
      requireStructuredOutput: true,
      taskType: 'listing_draft_generation',
    });
    expect(generateListingDraftMock).toHaveBeenCalledWith(
      {
        imageUrls: ['https://cdn.example.com/front.jpg', 'https://cdn.example.com/back.jpg'],
        listingId: 'Single-000001',
        userHints: {
          aspects: {
            Player: 'Michael Jordan',
            Team: ['Chicago Bulls'],
          },
          notes: 'Card appears ungraded.',
          price: 199.99,
          title: 'Possible Jordan insert',
        },
      },
      { model: 'gemini-3.1-flash-lite' }
    );
    expect(dataAccess.listings.update).toHaveBeenCalledWith(
      'Single-000001',
      expect.objectContaining({
        category_id: '183050',
        condition_id: '4000',
        condition_notes: 'Visible edge wear and light corner wear.',
        description: 'Ungraded single card with visible edge wear.',
        item_specifics: {
          'Card Condition': 'VERY_GOOD',
          Franchise: 'Utah Jazz',
          Player: 'Michael Jordan',
          Manufacturer: 'Upper Deck',
          CategorySuggestion: 'Sports Trading Cards',
          ConditionSuggestion: 'Ungraded',
          skuCategoryCode: 'BSKBL',
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
      attempt_order: 1,
      job_id: 'job-generate-ai',
      listing_id: 'Single-000001',
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
    expect(result.listing?.item_specifics).toMatchObject({
      skuCategoryCode: 'BSKBL',
    });
    expect(result.listing?.sku).toBe('Single-000001');
    expect(result.listing?.listing_id).toBe('Single-000001');
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

  it('persists BSBL skuCategoryCode suggestions without changing listing sku or listing_id', async () => {
    const dataAccess = createDataAccess({
      job: {
        ...queuedGenerateAiJob,
        listing_id: 'Single-000001',
      },
      listing: createListingRow({
        listing_id: 'Single-000001',
        sku: 'Single-000001',
      }),
    });
    const generateListingDraftMock = vi.fn(async () => ({
      title: '1989 Upper Deck Ken Griffey Jr.',
      description: 'Baseball single card.',
      categorySuggestion: 'Sports Trading Cards',
      cardConditionNote: null,
      cardConditionToken: null,
      conditionSuggestion: null,
      skuCategoryCode: 'BSBL',
      aspects: {
        Player: 'Ken Griffey Jr.',
        Sport: 'Baseball',
      },
      priceSuggestion: null,
      confidence: {},
      warnings: [],
      rawModelResponse: { id: 'raw-response-baseball' },
    }));

    const result = await runSidecarJob('job-generate-ai', {
      dataAccess,
      generateListingDraft: generateListingDraftMock,
      now: () => new Date('2026-05-20T13:00:00.000Z'),
    });

    expect(result.listing?.item_specifics).toMatchObject({
      skuCategoryCode: 'BSBL',
    });
    expect(result.listing?.sku).toBe('Single-000001');
    expect(result.listing?.listing_id).toBe('Single-000001');
  });

  it('persists OTHER skuCategoryCode suggestions without changing listing sku or listing_id', async () => {
    const dataAccess = createDataAccess({
      job: {
        ...queuedGenerateAiJob,
        listing_id: 'Single-000001',
      },
      listing: createListingRow({
        listing_id: 'Single-000001',
        sku: 'Single-000001',
      }),
    });
    const generateListingDraftMock = vi.fn(async () => ({
      title: 'Pokemon lot',
      description: 'Mixed lot.',
      categorySuggestion: 'Collectible Card Games',
      cardConditionNote: null,
      cardConditionToken: null,
      conditionSuggestion: null,
      skuCategoryCode: 'OTHER',
      aspects: {
        Franchise: 'Pokémon',
      },
      priceSuggestion: null,
      confidence: {},
      warnings: [],
      rawModelResponse: { id: 'raw-response-other' },
    }));

    const result = await runSidecarJob('job-generate-ai', {
      dataAccess,
      generateListingDraft: generateListingDraftMock,
      now: () => new Date('2026-05-20T13:00:00.000Z'),
    });

    expect(result.listing?.item_specifics).toMatchObject({
      skuCategoryCode: 'OTHER',
    });
    expect(result.listing?.sku).toBe('Single-000001');
    expect(result.listing?.listing_id).toBe('Single-000001');
  });

  it('falls back to a second configured Gemini route and records both attempts', async () => {
    const secondRoute = createResolvedAiModelRoute({
      displayName: 'Gemini 3.1 Pro',
      modelName: 'gemini-3.1-pro',
      routeOrder: 2,
    });
    const dataAccess = createDataAccess({
      aiModelRoutes: [resolvedAiModelRoute, secondRoute],
    });
    const generateListingDraftMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('429 too many requests'))
      .mockResolvedValueOnce({
        title: '1991 Upper Deck Michael Jordan',
        description: 'Recovered on fallback model.',
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
        warnings: ['Fallback route used.'],
        rawModelResponse: { id: 'raw-response-fallback' },
      });

    const result = await runSidecarJob('job-generate-ai', {
      dataAccess,
      generateListingDraft: generateListingDraftMock,
      now: () => new Date('2026-05-20T13:00:00.000Z'),
    });

    expect(dataAccess.aiModelRoutes.resolveForTask).toHaveBeenCalledWith({
      freeTierOnly: true,
      provider: 'google',
      requireImages: true,
      requireJsonOutput: true,
      requireStructuredOutput: true,
      taskType: 'listing_draft_generation',
    });
    expect(dataAccess.dailyUsage.incrementGeminiCallsUsed).toHaveBeenCalledTimes(2);
    expect(generateListingDraftMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        listingId: 'LIST-001',
      }),
      { model: 'gemini-3.1-flash-lite' }
    );
    expect(generateListingDraftMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        listingId: 'LIST-001',
      }),
      { model: 'gemini-3.1-pro' }
    );
    expect(dataAccess.aiModelAttempts.create).toHaveBeenNthCalledWith(1, {
      attempt_order: 1,
      job_id: 'job-generate-ai',
      listing_id: 'LIST-001',
      model_name: 'gemini-3.1-flash-lite',
      provider: 'google',
      provider_model_id: 'gemini-3.1-flash-lite',
      routing_source: 'direct_gemini',
      started_at: '2026-05-20T13:00:00.000Z',
      status: 'started',
    });
    expect(dataAccess.aiModelAttempts.create).toHaveBeenNthCalledWith(2, {
      attempt_order: 2,
      job_id: 'job-generate-ai',
      listing_id: 'LIST-001',
      model_name: 'gemini-3.1-pro',
      provider: 'google',
      provider_model_id: 'gemini-3.1-pro',
      routing_source: 'direct_gemini',
      started_at: '2026-05-20T13:00:00.000Z',
      status: 'started',
    });
    expect(dataAccess.aiModelAttempts.markFailed).toHaveBeenCalledWith({
      duration_ms: 0,
      failure_code: 'generate_ai_failed',
      failure_message: '429 too many requests',
      finished_at: '2026-05-20T13:00:00.000Z',
      id: 'ai-model-attempt-row-id',
    });
    expect(dataAccess.aiModelAttempts.markSucceeded).toHaveBeenCalledWith({
      duration_ms: 0,
      finished_at: '2026-05-20T13:00:00.000Z',
      id: 'ai-model-attempt-row-id-2',
    });
    expect(result.job.status).toBe('completed');
    expect(result.job.gemini_attempt_count).toBe(2);
    expect(result.job.gemini_selected_model).toBe('gemini-3.1-pro');
    expect(result.job.gemini_attempts).toEqual([
      expect.objectContaining({
        attempt_order: 1,
        failure_code: 'generate_ai_failed',
        model_name: 'gemini-3.1-flash-lite',
        status: 'failed',
      }),
      expect.objectContaining({
        attempt_order: 2,
        model_name: 'gemini-3.1-pro',
        status: 'succeeded',
      }),
    ]);
    expect(result.listing?.status).toBe('needs_review');
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
      cardConditionToken: 'EXCELLENT',
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
      cardConditionToken: 'VERY_GOOD',
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

    expect(dataAccess.dailyUsage.incrementGeminiCallsUsed).toHaveBeenCalledTimes(1);
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
      attempt_order: 1,
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

  it('stops fallback before a second provider call when daily Gemini usage is exhausted', async () => {
    const { DailyUsageLimitExceededError } = await import('@ebay-inventory/data');
    const dataAccess = createDataAccess({
      aiModelRoutes: [
        resolvedAiModelRoute,
        createResolvedAiModelRoute({
          displayName: 'Gemini 3.1 Pro',
          modelName: 'gemini-3.1-pro',
          routeOrder: 2,
        }),
      ],
      dailyUsageIncrementErrors: [
        undefined,
        new DailyUsageLimitExceededError({
          effectiveLimit: 500,
          resource: 'gemini',
          source: 'app_settings',
          usageDate: '2026-05-20',
          used: 500,
        }),
      ],
    });
    const generateListingDraftMock = vi.fn(async () => {
      throw new Error('429 too many requests');
    });

    const result = await runSidecarJob('job-generate-ai', {
      dataAccess,
      generateListingDraft: generateListingDraftMock,
      now: () => new Date('2026-05-20T13:00:00.000Z'),
    });

    expect(result.job.status).toBe('queued');
    expect(result.job.last_error_code).toBe('DAILY_GEMINI_LIMIT_EXCEEDED');
    expect(result.listing?.last_error_context).toEqual(
      expect.objectContaining({
        attempt_count: 1,
        attempted_models: ['gemini-3.1-flash-lite'],
        final_failure_code: 'DAILY_GEMINI_LIMIT_EXCEEDED',
        final_fallback_kind: 'rate_limit',
      })
    );
    expect(dataAccess.dailyUsage.incrementGeminiCallsUsed).toHaveBeenCalledTimes(2);
    expect(generateListingDraftMock).toHaveBeenCalledTimes(1);
    expect(dataAccess.aiModelAttempts.create).toHaveBeenCalledTimes(1);
    expect(dataAccess.aiModelAttempts.create).toHaveBeenCalledWith({
      attempt_order: 1,
      job_id: 'job-generate-ai',
      listing_id: 'LIST-001',
      model_name: 'gemini-3.1-flash-lite',
      provider: 'google',
      provider_model_id: 'gemini-3.1-flash-lite',
      routing_source: 'direct_gemini',
      started_at: '2026-05-20T13:00:00.000Z',
      status: 'started',
    });
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
    expect(dataAccess.dailyUsage.incrementGeminiCallsUsed).toHaveBeenCalledTimes(1);
    expect(dataAccess.jobs.updateGeminiAttemptAudit).toHaveBeenCalledTimes(2);
    expect(dataAccess.aiModelAttempts.create).toHaveBeenCalledTimes(1);
    expect(dataAccess.aiModelAttempts.markSucceeded).toHaveBeenCalledTimes(1);
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
    expect(dataAccess.dailyUsage.incrementGeminiCallsUsed).toHaveBeenCalledTimes(1);
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
    expect(dataAccess.dailyUsage.incrementGeminiCallsUsed).toHaveBeenCalledTimes(1);
    expect(dataAccess.jobs.updateGeminiAttemptAudit).toHaveBeenCalledTimes(2);
    expect(dataAccess.aiModelAttempts.create).toHaveBeenCalledTimes(1);
    expect(dataAccess.aiModelAttempts.markFailed).toHaveBeenCalledTimes(1);
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
    expect(dataAccess.dailyUsage.incrementGeminiCallsUsed).toHaveBeenCalledTimes(1);
    expect(dataAccess.aiModelAttempts.create).toHaveBeenCalledTimes(1);
    expect(dataAccess.aiModelAttempts.markFailed).not.toHaveBeenCalled();
    expect(result.job.status).toBe('queued');
    expect(result.job.last_error_code).toBe('generate_ai_failed');
    expect(result.job.last_error).toContain('Gemini timed out');
    expect(result.job.last_error).not.toContain('ai audit write failed');
    expect(result.listing?.last_error_code).toBe('generate_ai_failed');
  });

  it('blocks generate_ai jobs when Gemini daily usage limit is exhausted before provider attempt', async () => {
    const dataAccess = createDataAccess({
      dailyUsageIncrementError: new Error('placeholder'),
    });
    const generateListingDraftMock = vi.fn();

    dataAccess.dailyUsage.incrementGeminiCallsUsed = vi.fn(async () => {
      const { DailyUsageLimitExceededError } = await import('@ebay-inventory/data');

      throw new DailyUsageLimitExceededError({
        effectiveLimit: 500,
        resource: 'gemini',
        source: 'app_settings',
        usageDate: '2026-05-20',
        used: 500,
      });
    });

    const result = await runSidecarJob('job-generate-ai', {
      dataAccess,
      generateListingDraft: generateListingDraftMock,
      now: () => new Date('2026-05-20T13:00:00.000Z'),
    });

    expect(result.job.status).toBe('queued');
    expect(result.job.last_error_code).toBe('DAILY_GEMINI_LIMIT_EXCEEDED');
    expect(result.job.next_run_at).toBe('2026-05-20T13:01:00.000Z');
    expect(result.listing?.status).toBe('assets_ready');
    expect(result.listing?.sub_status).toBe('ready_to_generate');
    expect(result.listing?.last_error_code).toBe('DAILY_GEMINI_LIMIT_EXCEEDED');
    expect(result.listing?.last_error_context).toEqual(
      expect.objectContaining({
        category: 'recoverable',
        guardrail_type: 'quota_guardrail',
        resource: 'gemini',
      })
    );
    expect(dataAccess.dailyUsage.incrementGeminiCallsUsed).toHaveBeenCalledTimes(1);
    expect(generateListingDraftMock).not.toHaveBeenCalled();
    expect(dataAccess.jobs.updateGeminiAttemptAudit).not.toHaveBeenCalled();
    expect(dataAccess.aiModelAttempts.create).not.toHaveBeenCalled();
    expect(dataAccess.listings.updateWorkflowState).not.toHaveBeenCalled();
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

  it('completes publish retries without duplicating trace-backed listings', async () => {
    const dataAccess = createDataAccess({
      job: queuedPublishJob,
      listing: createListingRow({
        ebay_listing_id: 'EBAY-EXISTING',
        ebay_listing_url: 'https://www.ebay.com/itm/EBAY-EXISTING',
        ebay_offer_id: 'OFFER-EXISTING',
        exported_at: '2026-05-20T12:59:00.000Z',
        sku: 'SKU-KEEP',
        status: 'approved_for_export',
        sub_status: 'publish_queued',
      }),
    });
    const publishListingMock = vi.fn(async (listingId: string, dependencies?: { dataAccess?: SidecarDataAccess }) => {
      const listing = await dependencies?.dataAccess?.listings.getByListingId(listingId);

      expect(listing).toMatchObject({
        ebay_listing_id: 'EBAY-EXISTING',
        ebay_offer_id: 'OFFER-EXISTING',
        sku: 'SKU-KEEP',
      });

      await dependencies?.dataAccess?.listings.update(listingId, {
        status: 'exported',
        sub_status: 'idle',
      });

      return {
        ebayListingId: 'EBAY-EXISTING',
        exportedAt: '2026-05-20T12:59:00.000Z',
        listingId,
        offerId: 'OFFER-EXISTING',
        reusedExistingOffer: true,
        sku: 'SKU-KEEP',
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
      ebay_listing_id: 'EBAY-EXISTING',
      ebay_offer_id: 'OFFER-EXISTING',
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

  it('returns structured required-field publish validation errors to needs_review/review_pending without wiping listing data', async () => {
    const dataAccess = createDataAccess({
      job: queuedPublishJob,
      listing: createListingRow({
        category_id: '1234',
        condition_id: '4000',
        description: 'Detailed listing description.',
        image_urls: ['https://cdn.example.com/front.jpg'],
        item_specifics: { Brand: 'Acme' },
        price: 24.5,
        sku: 'LIST-001',
        status: 'approved_for_export',
        sub_status: 'publish_queued',
        title: 'Vintage puzzle',
      }),
    });
    const publishListingMock = vi.fn(async () => {
      throw new PublishRequiredFieldValidationError('LIST-001', [
        {
          field: 'marketplaceId',
          message: 'Marketplace ID is required before publishing.',
          scope: 'publish_config',
        },
        {
          field: 'paymentPolicyId',
          message: 'Payment policy ID is required before publishing.',
          scope: 'publish_config',
        },
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
      description: 'Detailed listing description.',
      image_urls: ['https://cdn.example.com/front.jpg'],
      item_specifics: { Brand: 'Acme' },
      last_error_code: 'publish_listing_not_ready',
      last_error_context: expect.objectContaining({
        category: 'user_fixable',
        fields: [
          {
            field: 'marketplaceId',
            message: 'Marketplace ID is required before publishing.',
            scope: 'publish_config',
          },
          {
            field: 'paymentPolicyId',
            message: 'Payment policy ID is required before publishing.',
            scope: 'publish_config',
          },
        ],
        validation_code: 'PUBLISH_REQUIRED_FIELD_MISSING',
        validation_scope: 'app_settings',
      }),
      price: 24.5,
      sku: 'LIST-001',
      status: 'needs_review',
      sub_status: 'review_pending',
      title: 'Vintage puzzle',
    });
  });

  it('returns structured category-required item-specific validation errors to needs_review/review_pending', async () => {
    const dataAccess = createDataAccess({
      job: queuedPublishJob,
      listing: createListingRow({
        category_id: '183050',
        condition_id: '4000',
        description: 'Detailed listing description.',
        image_urls: ['https://cdn.example.com/front.jpg'],
        item_specifics: {
          'Card Condition': 'NEAR_MINT_OR_BETTER',
          Player: 'Michael Jordan',
        },
        price: 24.5,
        sku: 'LIST-001',
        status: 'approved_for_export',
        sub_status: 'publish_queued',
        title: 'Vintage puzzle',
      }),
    });
    const publishListingMock = vi.fn(async () => {
      throw new PublishRequiredItemSpecificsValidationError('LIST-001', [
        {
          acceptedKeys: ['Manufacturer', 'Card Manufacturer'],
          aspectName: 'Manufacturer',
          field: 'item_specifics.Manufacturer',
          message: 'Manufacturer is required for this eBay category before publishing.',
          scope: 'listing',
        },
        {
          acceptedKeys: ['Player/Athlete', 'Player', 'Athlete'],
          aspectName: 'Player/Athlete',
          field: 'item_specifics.Player/Athlete',
          message: 'Player/Athlete is required for this eBay category before publishing.',
          scope: 'listing',
        },
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
      category_id: '183050',
      condition_id: '4000',
      description: 'Detailed listing description.',
      image_urls: ['https://cdn.example.com/front.jpg'],
      item_specifics: {
        'Card Condition': 'NEAR_MINT_OR_BETTER',
        Player: 'Michael Jordan',
      },
      last_error_code: 'publish_listing_not_ready',
      last_error_context: expect.objectContaining({
        category: 'user_fixable',
        fields: [
          {
            acceptedKeys: ['Manufacturer', 'Card Manufacturer'],
            aspectName: 'Manufacturer',
            field: 'item_specifics.Manufacturer',
            message: 'Manufacturer is required for this eBay category before publishing.',
            scope: 'listing',
          },
          {
            acceptedKeys: ['Player/Athlete', 'Player', 'Athlete'],
            aspectName: 'Player/Athlete',
            field: 'item_specifics.Player/Athlete',
            message: 'Player/Athlete is required for this eBay category before publishing.',
            scope: 'listing',
          },
        ],
        validation_code: 'CATEGORY_REQUIRED_ITEM_SPECIFICS_MISSING',
        validation_scope: 'listing',
      }),
      price: 24.5,
      sku: 'LIST-001',
      status: 'needs_review',
      sub_status: 'review_pending',
      title: 'Vintage puzzle',
    });
  });

  it('persists structured image URL readiness validation errors through the job failure path', async () => {
    const dataAccess = createDataAccess({
      job: queuedPublishJob,
      listing: createListingRow({
        category_id: '1234',
        condition_id: '4000',
        description: 'Detailed listing description.',
        image_urls: ['https://cdn.example.com/front.jpg'],
        item_specifics: { Brand: 'Acme' },
        price: 24.5,
        sku: 'LIST-001',
        status: 'approved_for_export',
        sub_status: 'publish_queued',
        title: 'Vintage puzzle',
      }),
    });
    const publishListingMock = vi.fn(async () => {
      throw new PublishImageUrlReadinessValidationError('LIST-001', [
        {
          field: 'image_urls[0]',
          message: 'Image URL must use HTTPS before publishing.',
          scope: 'listing',
          url: 'http://cdn.example.com/front.jpg',
        },
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
      last_error_code: 'publish_listing_not_ready',
      last_error_context: expect.objectContaining({
        category: 'user_fixable',
        fields: [
          {
            field: 'image_urls[0]',
            message: 'Image URL must use HTTPS before publishing.',
            scope: 'listing',
            url: 'http://cdn.example.com/front.jpg',
          },
        ],
        validation_code: 'IMAGE_URL_NOT_READY_FOR_EBAY',
        validation_scope: 'listing',
      }),
      status: 'needs_review',
      sub_status: 'review_pending',
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

  it('runs fixture pricing for a needs_review single listing and stores succeeded research', async () => {
    const writeOrder: string[] = [];
    const dataAccess = createDataAccess({
      job: queuedResearchPriceJob,
      listing: createListingRow({
        category_id: '261328',
        condition_id: '2750',
        item_specifics: {
          'Card Number': '136',
          Manufacturer: 'Panini',
          Player: 'Victor Wembanyama',
          Set: 'Prizm',
          Year: '2023',
        },
        price: 9.99,
        status: 'needs_review',
        sub_status: 'review_pending',
        title: '2023 Panini Prizm Victor Wembanyama Rookie Card',
      }),
      onListingsUpdate: () => {
        writeOrder.push('listing_update');
      },
    });
    vi.mocked(dataAccess.listingPriceResearch.markSucceeded).mockImplementationOnce(async (input) => {
      writeOrder.push('research_success');
      return createListingPriceResearchRow({
        ...input,
        id: input.id,
        status: 'succeeded',
      });
    });

    const result = await runSidecarJob('job-research-price', {
      dataAccess,
      now: () => new Date('2026-05-20T13:00:00.000Z'),
    });

    expect(result.job.status).toBe('completed');
    expect(result.listing).toMatchObject({
      status: 'needs_review',
      sub_status: 'review_pending',
    });
    expect(dataAccess.listingPriceResearch.create).toHaveBeenCalledWith({
      listing_id: 'LIST-001',
      provider: 'fixture',
      status: 'pending',
    });
    expect(dataAccess.listingPriceResearch.markSucceeded).toHaveBeenCalledWith(
      expect.objectContaining({
        confidence: expect.stringMatching(/^(low|medium|high)$/),
        comps: expect.arrayContaining([
          expect.objectContaining({
            id: expect.any(String),
            source: 'provider',
          }),
        ]),
        llm_price_explanation: null,
        llm_reasoning_json: {},
        llm_rejected_comp_ids: [],
        llm_selected_comp_ids: [],
        median_sold_price: expect.any(Number),
        pricing_model_name: 'deterministic-fixture-v1',
        raw_result_json: expect.objectContaining({
          provider: 'fixture',
        }),
        sold_count: expect.any(Number),
        suggested_price: expect.any(Number),
      })
    );

    const markSucceededInput = vi.mocked(dataAccess.listingPriceResearch.markSucceeded).mock
      .calls[0]?.[0];
    expect(markSucceededInput?.suggested_price).toBe(result.listing?.price);
    expect(markSucceededInput?.query).toContain('category:');
    expect(markSucceededInput?.query).toContain('condition:');
    expect(markSucceededInput?.query).toContain('player:Victor Wembanyama');
    expect(markSucceededInput?.query).toContain('year:2023');
    expect(markSucceededInput?.query).toContain('manufacturer:Panini');
    expect(markSucceededInput?.query).toContain('card_number:136');
    expect(markSucceededInput?.raw_result_json).toMatchObject({
      listingId: 'LIST-001',
      returnedSoldComps: expect.any(Number),
    });
    expect(markSucceededInput?.comps).not.toHaveLength(0);
    expect(markSucceededInput).not.toHaveProperty('recommendation');
    expect(dataAccess.listings.update).toHaveBeenCalledWith('LIST-001', {
      price: markSucceededInput?.suggested_price,
    });
    expect(writeOrder).toEqual(['research_success', 'listing_update']);
  });

  it('fails research_price for lot listings without changing listing state', async () => {
    const listing = createListingRow({
      last_error_at: '2026-05-19T12:00:00.000Z',
      last_error_code: 'existing_error',
      last_error_message: 'keep me',
      listing_type: 'lot',
      status: 'needs_review',
      sub_status: 'review_pending',
      title: 'Mixed card lot',
    });
    const dataAccess = createDataAccess({
      job: queuedResearchPriceJob,
      listing,
    });

    const result = await runSidecarJob('job-research-price', {
      dataAccess,
      now: () => new Date('2026-05-20T13:00:00.000Z'),
    });

    expect(result.job.status).toBe('failed');
    expect(result.job.last_error_code).toBe('research_price_listing_not_eligible');
    expectPricingFailureToPreserveListingWorkflow(listing, result.listing);
    expect(result.listing?.listing_type).toBe('lot');
    expect(dataAccess.listingPriceResearch.create).not.toHaveBeenCalled();
    expect(dataAccess.listings.update).not.toHaveBeenCalled();
    expect(dataAccess.listings.updateWorkflowState).not.toHaveBeenCalled();
  });

  it('fails research_price for non-needs_review listings without changing listing state', async () => {
    const listing = createListingRow({
      last_error_at: '2026-05-19T12:00:00.000Z',
      last_error_code: 'existing_error',
      last_error_message: 'keep me',
      status: 'approved_for_export',
      sub_status: 'publish_queued',
      title: 'Already approved listing',
    });
    const dataAccess = createDataAccess({
      job: queuedResearchPriceJob,
      listing,
    });

    const result = await runSidecarJob('job-research-price', {
      dataAccess,
      now: () => new Date('2026-05-20T13:00:00.000Z'),
    });

    expect(result.job.status).toBe('failed');
    expect(result.job.last_error_code).toBe('research_price_listing_not_eligible');
    expectPricingFailureToPreserveListingWorkflow(listing, result.listing);
    expect(dataAccess.listingPriceResearch.create).not.toHaveBeenCalled();
    expect(dataAccess.listings.update).not.toHaveBeenCalled();
    expect(dataAccess.listings.updateWorkflowState).not.toHaveBeenCalled();
  });

  it('fails research_price when listing is missing', async () => {
    const dataAccess = createDataAccess({
      job: queuedResearchPriceJob,
      listing: null,
    });

    const result = await runSidecarJob('job-research-price', {
      dataAccess,
      now: () => new Date('2026-05-20T13:00:00.000Z'),
    });

    expect(result.job.status).toBe('failed');
    expect(result.job.last_error_code).toBe('research_price_listing_not_found');
    expect(result.listing).toBeNull();
    expect(dataAccess.listingPriceResearch.create).not.toHaveBeenCalled();
  });

  it('marks listing price research failed when deterministic suggested price is missing', async () => {
    const listing = createListingRow({
      last_error_at: '2026-05-19T12:00:00.000Z',
      last_error_code: 'existing_error',
      last_error_message: 'keep me',
      status: 'needs_review',
      sub_status: 'review_pending',
      title: 'Price me',
    });
    const dataAccess = createDataAccess({
      job: queuedResearchPriceJob,
      listing,
    });

    const result = await runSidecarJob('job-research-price', {
      dataAccess,
      now: () => new Date('2026-05-20T13:00:00.000Z'),
      researchPrice: {
        computeStats: vi.fn(() => ({
          currency: 'USD',
          deterministicSuggestedPrice: null,
          highSoldPrice: 20,
          ignored: [],
          lowSoldPrice: 10,
          medianSoldPrice: 15,
          soldCount: 12,
        })),
      },
    });

    expect(result.job.status).toBe('failed');
    expect(result.job.last_error_code).toBe('research_price_suggested_price_invalid');
    expectPricingFailureToPreserveListingWorkflow(listing, result.listing);
    expect(dataAccess.listingPriceResearch.markFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        error_code: 'research_price_suggested_price_invalid',
        llm_reasoning_json: {},
        pricing_model_name: 'deterministic-fixture-v1',
      })
    );
    expect(dataAccess.listings.update).not.toHaveBeenCalled();
    expect(dataAccess.listings.updateWorkflowState).not.toHaveBeenCalled();
  });

  it('does not update listing price when markSucceeded fails and preserves listing last_error fields', async () => {
    const listing = createListingRow({
      last_error_at: '2026-05-19T12:00:00.000Z',
      last_error_code: 'existing_error',
      last_error_message: 'keep me',
      price: 9.99,
      status: 'needs_review',
      sub_status: 'review_pending',
      title: 'Mark succeeded failure listing',
    });
    const dataAccess = createDataAccess({
      job: queuedResearchPriceJob,
      listing,
    });
    vi.mocked(dataAccess.listingPriceResearch.markSucceeded).mockImplementationOnce(async () => {
      throw new Error('write succeeded row failed');
    });

    const result = await runSidecarJob('job-research-price', {
      dataAccess,
      now: () => new Date('2026-05-20T13:00:00.000Z'),
    });

    expect(result.job.status).toBe('failed');
    expect(result.job.last_error_code).toBe('research_price_failed');
    expectPricingFailureToPreserveListingWorkflow(listing, result.listing);
    expect(dataAccess.listings.update).not.toHaveBeenCalled();
    expect(dataAccess.listingPriceResearch.markFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        error_code: 'research_price_failed',
        error_message: 'write succeeded row failed',
      })
    );
    expect(dataAccess.listings.updateWorkflowState).not.toHaveBeenCalled();
  });

  it('marks listing price research failed on provider errors without writing listing last_error fields', async () => {
    const listing = createListingRow({
      last_error_at: '2026-05-19T12:00:00.000Z',
      last_error_code: 'existing_error',
      last_error_message: 'keep me',
      status: 'needs_review',
      sub_status: 'review_pending',
      title: 'Broken provider listing',
    });
    const dataAccess = createDataAccess({
      job: queuedResearchPriceJob,
      listing,
    });

    const result = await runSidecarJob('job-research-price', {
      dataAccess,
      now: () => new Date('2026-05-20T13:00:00.000Z'),
      researchPrice: {
        pricingProvider: {
          fetchSoldComps: vi.fn(async () => {
            throw new Error('fixture exploded');
          }),
          name: 'fixture',
        },
      },
    });

    expect(result.job.status).toBe('failed');
    expect(result.job.last_error_code).toBe('research_price_failed');
    expectPricingFailureToPreserveListingWorkflow(listing, result.listing);
    expect(dataAccess.listingPriceResearch.create).toHaveBeenCalledTimes(1);
    expect(dataAccess.listingPriceResearch.markFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        error_code: 'research_price_failed',
        error_message: 'fixture exploded',
      })
    );
    expect(dataAccess.listingPriceResearch.markSucceeded).not.toHaveBeenCalled();
    expect(dataAccess.listings.update).not.toHaveBeenCalled();
    expect(dataAccess.listings.updateWorkflowState).not.toHaveBeenCalled();
  });

  it('marks listing price research failed on normalizer errors without writing listing workflow errors', async () => {
    const listing = createListingRow({
      last_error_at: '2026-05-19T12:00:00.000Z',
      last_error_code: 'existing_error',
      last_error_message: 'keep me',
      status: 'needs_review',
      sub_status: 'review_pending',
      title: 'Broken normalizer listing',
    });
    const dataAccess = createDataAccess({
      job: queuedResearchPriceJob,
      listing,
    });

    const result = await runSidecarJob('job-research-price', {
      dataAccess,
      now: () => new Date('2026-05-20T13:00:00.000Z'),
      researchPrice: {
        normalizeComps: vi.fn(() => {
          throw new Error('normalize exploded');
        }),
      },
    });

    expect(result.job.status).toBe('failed');
    expect(result.job.last_error_code).toBe('research_price_failed');
    expectPricingFailureToPreserveListingWorkflow(listing, result.listing);
    expect(dataAccess.listingPriceResearch.create).toHaveBeenCalledTimes(1);
    expect(dataAccess.listingPriceResearch.markFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        error_code: 'research_price_failed',
        error_message: 'normalize exploded',
      })
    );
    expect(dataAccess.listingPriceResearch.markSucceeded).not.toHaveBeenCalled();
    expect(dataAccess.listings.update).not.toHaveBeenCalled();
    expect(dataAccess.listings.updateWorkflowState).not.toHaveBeenCalled();
  });

  it('marks listing price research failed on stats errors without writing workflow fields', async () => {
    const listing = createListingRow({
      last_error_at: '2026-05-19T12:00:00.000Z',
      last_error_code: 'existing_error',
      last_error_context: { source: 'publish' },
      last_error_message: 'keep me',
      status: 'needs_review',
      sub_status: 'review_pending',
      title: 'Broken stats listing',
    });
    const dataAccess = createDataAccess({
      job: queuedResearchPriceJob,
      listing,
    });

    const result = await runSidecarJob('job-research-price', {
      dataAccess,
      now: () => new Date('2026-05-20T13:00:00.000Z'),
      researchPrice: {
        computeStats: vi.fn(() => {
          throw new Error('stats exploded');
        }),
      },
    });

    expect(result.job.status).toBe('failed');
    expect(result.job.last_error_code).toBe('research_price_failed');
    expectPricingFailureToPreserveListingWorkflow(listing, result.listing);
    expect(dataAccess.listingPriceResearch.create).toHaveBeenCalledTimes(1);
    expect(dataAccess.listingPriceResearch.markFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        error_code: 'research_price_failed',
        error_message: 'stats exploded',
      })
    );
    expect(dataAccess.listingPriceResearch.markSucceeded).not.toHaveBeenCalled();
    expect(dataAccess.listings.update).not.toHaveBeenCalled();
    expect(dataAccess.listings.updateWorkflowState).not.toHaveBeenCalled();
  });

  it('marks listing price research failed on confidence errors without writing workflow fields', async () => {
    const listing = createListingRow({
      last_error_at: '2026-05-19T12:00:00.000Z',
      last_error_code: 'existing_error',
      last_error_context: { source: 'publish' },
      last_error_message: 'keep me',
      status: 'needs_review',
      sub_status: 'review_pending',
      title: 'Broken confidence listing',
    });
    const dataAccess = createDataAccess({
      job: queuedResearchPriceJob,
      listing,
    });

    const result = await runSidecarJob('job-research-price', {
      dataAccess,
      now: () => new Date('2026-05-20T13:00:00.000Z'),
      researchPrice: {
        computeConfidence: vi.fn(() => {
          throw new Error('confidence exploded');
        }),
      },
    });

    expect(result.job.status).toBe('failed');
    expect(result.job.last_error_code).toBe('research_price_failed');
    expectPricingFailureToPreserveListingWorkflow(listing, result.listing);
    expect(dataAccess.listingPriceResearch.create).toHaveBeenCalledTimes(1);
    expect(dataAccess.listingPriceResearch.markFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        error_code: 'research_price_failed',
        error_message: 'confidence exploded',
      })
    );
    expect(dataAccess.listingPriceResearch.markSucceeded).not.toHaveBeenCalled();
    expect(dataAccess.listings.update).not.toHaveBeenCalled();
    expect(dataAccess.listings.updateWorkflowState).not.toHaveBeenCalled();
  });

  it('fails unsupported pricing providers clearly before mutating research or listing state', async () => {
    const listing = createListingRow({
      last_error_at: '2026-05-19T12:00:00.000Z',
      last_error_code: 'existing_error',
      last_error_message: 'keep me',
      status: 'needs_review',
      sub_status: 'review_pending',
      title: 'Unsupported provider listing',
    });
    const dataAccess = createDataAccess({
      job: queuedResearchPriceJob,
      listing,
    });

    const result = await runSidecarJob('job-research-price', {
      dataAccess,
      now: () => new Date('2026-05-20T13:00:00.000Z'),
      researchPrice: {
        pricingProvider: {
          fetchSoldComps: vi.fn(async () => {
            throw new Error('should not run');
          }),
          name: 'apify',
        },
      },
    });

    expect(result.job.status).toBe('failed');
    expect(result.job.last_error_code).toBe('research_price_failed');
    expect(result.job.last_error).toContain('Unsupported pricing provider "apify"');
    expectPricingFailureToPreserveListingWorkflow(listing, result.listing);
    expect(dataAccess.listingPriceResearch.create).not.toHaveBeenCalled();
    expect(dataAccess.listingPriceResearch.markFailed).not.toHaveBeenCalled();
    expect(dataAccess.listings.update).not.toHaveBeenCalled();
    expect(dataAccess.listings.updateWorkflowState).not.toHaveBeenCalled();
  });

  it('pricing failure never writes workflow or listing error fields through listings.update', async () => {
    const listing = createListingRow({
      last_error_at: '2026-05-19T12:00:00.000Z',
      last_error_code: 'existing_error',
      last_error_context: { preserved: true },
      last_error_message: 'keep me',
      status: 'needs_review',
      sub_status: 'review_pending',
      title: 'Mutation guard listing',
    });
    const dataAccess = createDataAccess({
      job: queuedResearchPriceJob,
      listing,
    });

    await runSidecarJob('job-research-price', {
      dataAccess,
      now: () => new Date('2026-05-20T13:00:00.000Z'),
      researchPrice: {
        computeConfidence: vi.fn(() => {
          throw new Error('confidence exploded');
        }),
      },
    });

    expectNoWorkflowErrorFieldsWritten(
      vi.mocked(dataAccess.listings.update).mock.calls as Array<[string, Partial<ListingRow>]>
    );
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
