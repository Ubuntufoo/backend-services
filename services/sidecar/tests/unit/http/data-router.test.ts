import express, { type Express } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type {
  ListingInsert,
  ListingUpdate,
  ListingWorkflowTransitionInput,
} from '@ebay-inventory/data';
import { createDataApiRouter } from '@/http/data-router.js';
import type { SidecarDataAccess } from '@/data/sidecar-data.js';

const listingRow = {
  approved_for_export_at: null,
  capture_mode: null,
  category_id: null,
  condition_id: null,
  condition_notes: null,
  created_at: '2026-05-17T00:00:00.000Z',
  description: null,
  ebay_listing_id: null,
  ebay_listing_status: null,
  ebay_listing_url: null,
  ebay_offer_id: null,
  ese_eligible: null,
  estimated_weight_oz: null,
  exported_at: null,
  handling_days: null,
  id: 'listing-row-id',
  image_urls: [],
  item_specifics: {},
  last_error_at: null,
  last_error_code: null,
  listing_id: 'LIST-001',
  listing_type: null,
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
  updated_at: '2026-05-17T00:00:00.000Z',
};

const secondListingRow = {
  ...listingRow,
  listing_id: 'LIST-002',
  sku: 'SKU-002',
};

const geminiUsageSummary = {
  effectiveLimit: 540,
  remaining: 519,
  resetAt: '2026-06-02T07:00:00.000Z',
  resetTimeZone: 'America/Los_Angeles',
  usageDate: '2026-06-01',
  used: 21,
};

const appSettingsRow = {
  capture_mode: 'single_2_image',
  default_fulfillment_policy_id: null,
  default_package_type: null,
  default_payment_policy_id: null,
  default_return_policy_id: null,
  default_shipping_profile: null,
  ebay_marketplace_id: 'EBAY_US',
  gemini_daily_limit: 500,
  handling_days: 2,
  id: 'default',
  incoming_folder_path: '/incoming',
  max_order_syncs_per_day: 25,
  merchant_location_key: null,
  office_location_name: null,
  processed_folder_path: '/processed',
  r2_retention_days_after_sold: 30,
  updated_at: '2026-05-17T00:00:00.000Z',
};

function createDataAccess(): SidecarDataAccess {
  return {
    aiModelRoutes: {
      resolveForTask: vi.fn(async () => []),
      resolvePrimaryForTask: vi.fn(),
    },
    aiModelAttempts: {
      create: vi.fn(),
      listByListingId: vi.fn(),
      listByListingIds: vi.fn(async () => []),
      markFailed: vi.fn(),
      markSucceeded: vi.fn(),
    },
    dailyUsage: {
      getEffectiveGeminiLimit: vi.fn(),
      getEffectiveOrderSyncLimit: vi.fn(),
      getGeminiSummary: vi.fn(async () => geminiUsageSummary),
      getOrCreate: vi.fn(),
      incrementGeminiCallsUsed: vi.fn(),
      incrementOrderSyncCount: vi.fn(),
    },
    listings: {
      claimApprovedForPublish: vi.fn(async () => null),
      create: vi.fn(async (input: ListingInsert) => ({
        ...listingRow,
        ...input,
      })),
      getByListingId: vi.fn(async () => listingRow),
      listApprovedForExport: vi.fn(async () => []),
      list: vi.fn(async () => [listingRow]),
      listByStatus: vi.fn(async () => [listingRow]),
      markPublishFailed: vi.fn(async () => listingRow),
      prepareForGenerateAi: vi.fn(async () => listingRow),
      saveImageMetadata: vi.fn(async (_input) => ({
        ...listingRow,
      })),
      update: vi.fn(async (_listingId: string, changes: ListingUpdate) => ({
        ...listingRow,
        ...changes,
      })),
      updateWorkflowState: vi.fn(async (input: ListingWorkflowTransitionInput) => ({
        ...listingRow,
        listing_id: input.listingId,
        status: input.status,
        sub_status: input.subStatus,
      })),
    },
    jobs: {
      claimDueQueued: vi.fn(),
      complete: vi.fn(),
      create: vi.fn(),
      enqueueGenerateAi: vi.fn(),
      enqueueProcessImages: vi.fn(),
      enqueuePublish: vi.fn(),
      fail: vi.fn(),
      getActiveGenerateAiByListingId: vi.fn(),
      getById: vi.fn(),
      listDueQueued: vi.fn(),
      listByListingId: vi.fn(),
      listStaleRunning: vi.fn(),
      resetForManualRetry: vi.fn(),
      requeue: vi.fn(),
      update: vi.fn(),
    },
    orders: {
      create: vi.fn(),
      getByOrderId: vi.fn(),
      update: vi.fn(),
    },
    appSettings: {
      create: vi.fn(),
      get: vi.fn(async () => appSettingsRow),
      update: vi.fn(),
    },
  };
}

function createApp(dataAccess: SidecarDataAccess): Express {
  const app = express();
  app.use(express.json());
  app.use('/api', createDataApiRouter({ dataAccess }));
  return app;
}

describe('data API router', () => {
  it('lists listings through the shared data access layer', async () => {
    const dataAccess = createDataAccess();
    const app = createApp(dataAccess);

    const response = await request(app).get('/api/listings');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      listings: [listingRow],
    });
    expect(dataAccess.listings.list).toHaveBeenCalledOnce();
  });

  it('fetches one listing by listing id', async () => {
    const dataAccess = createDataAccess();
    const app = createApp(dataAccess);

    const response = await request(app).get('/api/listings/LIST-001');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(listingRow);
    expect(dataAccess.listings.getByListingId).toHaveBeenCalledWith('LIST-001');
  });

  it('returns Gemini daily usage summary', async () => {
    const dataAccess = createDataAccess();
    const app = createApp(dataAccess);

    const response = await request(app).get('/api/gemini-usage');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      effective_limit: 540,
      remaining: 519,
      reset_at: '2026-06-02T07:00:00.000Z',
      reset_time_zone: 'America/Los_Angeles',
      usage_date: '2026-06-01',
      used: 21,
    });
    expect(dataAccess.dailyUsage.getGeminiSummary).toHaveBeenCalledOnce();
  });

  it('lists multiple listings without AI attempt summary fields', async () => {
    const dataAccess = createDataAccess();
    dataAccess.listings.list.mockResolvedValueOnce([listingRow, secondListingRow]);
    const app = createApp(dataAccess);

    const response = await request(app).get('/api/listings');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      listings: [listingRow, secondListingRow],
    });
  });

  it('creates a listing with workflow defaults', async () => {
    const dataAccess = createDataAccess();
    const app = createApp(dataAccess);

    const response = await request(app).post('/api/listings').send({});

    expect(response.status).toBe(201);
    expect(response.body).toEqual(
      expect.objectContaining({
        listing_id: expect.any(String),
        status: 'record_created',
        sub_status: 'idle',
        image_urls: [],
        r2_object_keys: [],
        item_specifics: {},
      })
    );
    expect(dataAccess.listings.create).toHaveBeenCalledWith(
      expect.objectContaining({
        listing_id: expect.any(String),
        status: 'record_created',
        sub_status: 'idle',
        image_urls: [],
        r2_object_keys: [],
        item_specifics: {},
      })
    );
  });

  it('rejects create requests with unknown fields', async () => {
    const dataAccess = createDataAccess();
    const app = createApp(dataAccess);

    const response = await request(app).post('/api/listings').send({
      status: 'needs_review',
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'invalid_request',
      details: [
        {
          message: "Unrecognized key(s) in object: 'status'",
          path: '',
        },
      ],
    });
    expect(dataAccess.listings.create).not.toHaveBeenCalled();
  });

  it('rejects create requests with removed capture modes', async () => {
    const dataAccess = createDataAccess();
    const app = createApp(dataAccess);

    const response = await request(app).post('/api/listings').send({
      captureMode: 'single_legacy_image',
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'invalid_request',
      details: [
        {
          message: expect.stringContaining('Invalid enum value'),
          path: 'captureMode',
        },
      ],
    });
    expect(dataAccess.listings.create).not.toHaveBeenCalled();
  });

  it('rejects non-allowlisted editable field updates', async () => {
    const dataAccess = createDataAccess();
    const app = createApp(dataAccess);

    const response = await request(app).patch('/api/listings/LIST-001').send({
      shippingProfile: 'fast-shipping',
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('invalid_request');
    expect(dataAccess.listings.update).not.toHaveBeenCalled();
  });

  it('rejects workflow fields on the seller-editable listing patch', async () => {
    const dataAccess = createDataAccess();
    const app = createApp(dataAccess);

    const response = await request(app).patch('/api/listings/LIST-001').send({
      status: 'listed',
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('invalid_request');
    expect(dataAccess.listings.update).not.toHaveBeenCalled();
  });

  it('keeps imageUrls out of the seller-editable listing patch', async () => {
    const dataAccess = createDataAccess();
    const app = createApp(dataAccess);

    const response = await request(app).patch('/api/listings/LIST-001').send({
      imageUrls: ['https://example.com/front.jpg'],
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('invalid_request');
    expect(dataAccess.listings.update).not.toHaveBeenCalled();
  });

  it('updates only the seller-editable fields with the repository payload shape', async () => {
    const dataAccess = createDataAccess();
    const app = createApp(dataAccess);

    const response = await request(app).patch('/api/listings/LIST-001').send({
      categoryId: 'CATEGORY-001',
      conditionNotes: 'Minor wear',
      conditionId: 'CONDITION-001',
      description: 'Updated description',
      itemSpecifics: { Brand: 'Acme' },
      price: 19.99,
      sellerHints: 'Ship in original packaging',
      title: 'Updated title',
    });

    expect(response.status).toBe(200);
    expect(dataAccess.listings.update).toHaveBeenCalledWith('LIST-001', {
      category_id: 'CATEGORY-001',
      condition_id: 'CONDITION-001',
      condition_notes: 'Minor wear',
      description: 'Updated description',
      item_specifics: { Brand: 'Acme' },
      price: 19.99,
      seller_hints: 'Ship in original packaging',
      title: 'Updated title',
    });
  });

  it('returns immediately when listing params are invalid before body validation', async () => {
    const dataAccess = createDataAccess();
    const app = createApp(dataAccess);

    const response = await request(app).patch('/api/listings/%20').send({
      status: 'listed',
    });

    expect(response.status).toBe(400);
    expect(dataAccess.listings.update).not.toHaveBeenCalled();
  });

  it('updates listing image_urls through the dedicated test-only route', async () => {
    const dataAccess = createDataAccess();
    dataAccess.listings.getByListingId = vi.fn(async () => ({
      ...listingRow,
      image_urls: ['https://old.example.com/front.jpg'],
      r2_object_keys: ['listings/LIST-001/existing.jpg'],
    }));
    dataAccess.listings.saveImageMetadata = vi.fn(async (input) => ({
      ...listingRow,
      image_urls: input.imageUrls,
      r2_object_keys: input.r2ObjectKeys,
    }));
    const app = createApp(dataAccess);

    const response = await request(app).patch('/api/listings/LIST-001/image-urls').send({
      imageUrls: ['https://example.com/front.jpg', 'https://example.com/back.jpg'],
    });

    expect(response.status).toBe(200);
    expect(dataAccess.listings.getByListingId).toHaveBeenCalledWith('LIST-001');
    expect(dataAccess.listings.saveImageMetadata).toHaveBeenCalledWith({
      listingId: 'LIST-001',
      imageUrls: ['https://example.com/front.jpg', 'https://example.com/back.jpg'],
      r2ObjectKeys: ['listings/LIST-001/existing.jpg'],
    });
    expect(response.body).toEqual({
      ...listingRow,
      image_urls: ['https://example.com/front.jpg', 'https://example.com/back.jpg'],
      r2_object_keys: ['listings/LIST-001/existing.jpg'],
    });
  });

  it('rejects invalid image URL payloads on the dedicated image route', async () => {
    const dataAccess = createDataAccess();
    const app = createApp(dataAccess);

    const response = await request(app).patch('/api/listings/LIST-001/image-urls').send({
      imageUrls: ['file:///tmp/front.jpg'],
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('invalid_request');
    expect(dataAccess.listings.getByListingId).not.toHaveBeenCalled();
    expect(dataAccess.listings.saveImageMetadata).not.toHaveBeenCalled();
  });

  it('returns not_found when the image URL route targets a missing listing', async () => {
    const dataAccess = createDataAccess();
    dataAccess.listings.getByListingId = vi.fn(async () => null);
    const app = createApp(dataAccess);

    const response = await request(app).patch('/api/listings/LIST-404/image-urls').send({
      imageUrls: ['https://example.com/front.jpg'],
    });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: 'not_found',
      message: 'Listing "LIST-404" was not found.',
    });
    expect(dataAccess.listings.saveImageMetadata).not.toHaveBeenCalled();
  });

  it('rejects invalid workflow-state pairs before persistence', async () => {
    const dataAccess = createDataAccess();
    const app = createApp(dataAccess);

    const response = await request(app).patch('/api/listings/LIST-001/workflow-state').send({
      status: 'record_created',
      subStatus: 'publish_queued',
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('invalid_request');
    expect(dataAccess.listings.updateWorkflowState).not.toHaveBeenCalled();
  });

  it('updates workflow state through the shared workflow helper', async () => {
    const dataAccess = createDataAccess();
    const app = createApp(dataAccess);

    const response = await request(app).patch('/api/listings/LIST-001/workflow-state').send({
      status: 'approved_for_export',
      subStatus: 'publish_queued',
    });

    expect(response.status).toBe(200);
    expect(dataAccess.listings.updateWorkflowState).toHaveBeenCalledWith({
      listingId: 'LIST-001',
      status: 'approved_for_export',
      subStatus: 'publish_queued',
    });
    expect(dataAccess.jobs.enqueuePublish).toHaveBeenCalledWith('LIST-001');
  });

  it('enqueues generate_ai from assets_ready and persists optional seller hints', async () => {
    const listingState = {
      ...listingRow,
      seller_hints: null,
      status: 'assets_ready',
      sub_status: 'waiting_for_seller_hints',
      updated_at: '2026-05-17T01:00:00.000Z',
    } as const;
    const preparedListing = {
      ...listingState,
      seller_hints: 'Use padded envelope',
      sub_status: 'ready_to_generate',
    };
    const dataAccess = createDataAccess();
    dataAccess.listings.getByListingId = vi.fn(async () => listingState);
    dataAccess.listings.prepareForGenerateAi = vi.fn(async (input) => {
      expect(input).toEqual({
        expectedUpdatedAt: '2026-05-17T01:00:00.000Z',
        listingId: 'LIST-001',
        sellerHints: 'Use padded envelope',
      });
      return preparedListing;
    });
    dataAccess.jobs.enqueueGenerateAi = vi.fn(async (listingId: string) => {
      expect(listingId).toBe('LIST-001');
      return {
        alreadyQueued: false,
        job: {
          created_at: '2026-05-17T01:00:01.000Z',
          id: 'job-generate-ai-row-id',
          job_type: 'generate_ai',
          last_error: null,
          last_error_at: null,
          last_error_code: null,
          listing_id: 'LIST-001',
          next_run_at: null,
          status: 'queued',
          updated_at: '2026-05-17T01:00:01.000Z',
        },
      };
    });
    const app = createApp(dataAccess);

    const response = await request(app).post('/api/listings/LIST-001/generate-ai').send({
      sellerHints: 'Use padded envelope',
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      alreadyQueued: false,
      job: {
        created_at: '2026-05-17T01:00:01.000Z',
        id: 'job-generate-ai-row-id',
        job_type: 'generate_ai',
        last_error: null,
        last_error_at: null,
        last_error_code: null,
        listing_id: 'LIST-001',
        next_run_at: null,
        status: 'queued',
        updated_at: '2026-05-17T01:00:01.000Z',
      },
      listing: preparedListing,
    });
    expect(dataAccess.listings.getByListingId).toHaveBeenCalledWith('LIST-001');
    expect(dataAccess.listings.prepareForGenerateAi).toHaveBeenCalledOnce();
    expect(dataAccess.jobs.enqueueGenerateAi).toHaveBeenCalledOnce();
  });

  it('rejects generate_ai enqueue requests when listing is not assets_ready', async () => {
    const dataAccess = createDataAccess();
    dataAccess.listings.getByListingId = vi.fn(async () => ({
      ...listingRow,
      status: 'needs_review',
      sub_status: 'review_pending',
    }));
    const app = createApp(dataAccess);

    const response = await request(app).post('/api/listings/LIST-001/generate-ai').send({});

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: 'listing_not_assets_ready',
      message: 'Listing "LIST-001" must be assets_ready before generate_ai can be enqueued.',
    });
    expect(dataAccess.listings.prepareForGenerateAi).not.toHaveBeenCalled();
    expect(dataAccess.jobs.enqueueGenerateAi).not.toHaveBeenCalled();
  });

  it('rejects stale generate_ai enqueue attempts after the listing changes in flight', async () => {
    const dataAccess = createDataAccess();
    dataAccess.listings.getByListingId = vi.fn(async () => ({
      ...listingRow,
      status: 'assets_ready',
      sub_status: 'ready_to_generate',
      updated_at: '2026-05-17T01:00:00.000Z',
    }));
    dataAccess.listings.prepareForGenerateAi = vi.fn(async () => null);
    const app = createApp(dataAccess);

    const response = await request(app).post('/api/listings/LIST-001/generate-ai').send({});

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: 'listing_state_stale',
      message:
        'Listing "LIST-001" changed before generate_ai could be enqueued. Refresh and retry.',
    });
    expect(dataAccess.jobs.enqueueGenerateAi).not.toHaveBeenCalled();
  });

  it('returns the active generate_ai job when enqueue hits the duplicate guard', async () => {
    const dataAccess = createDataAccess();
    dataAccess.listings.getByListingId = vi.fn(async () => ({
      ...listingRow,
      status: 'assets_ready',
      sub_status: 'ready_to_generate',
      updated_at: '2026-05-17T01:00:00.000Z',
    }));
    dataAccess.listings.prepareForGenerateAi = vi.fn(async () => ({
      ...listingRow,
      status: 'assets_ready',
      sub_status: 'ready_to_generate',
      updated_at: '2026-05-17T01:00:00.000Z',
    }));
    dataAccess.jobs.enqueueGenerateAi = vi.fn(async () => ({
      alreadyQueued: true,
      job: {
        created_at: '2026-05-17T01:00:00.000Z',
        id: 'job-generate-ai-active',
        job_type: 'generate_ai',
        last_error: null,
        last_error_at: null,
        last_error_code: null,
        listing_id: 'LIST-001',
        next_run_at: null,
        status: 'running',
        updated_at: '2026-05-17T01:00:00.000Z',
      },
    }));
    const app = createApp(dataAccess);

    const response = await request(app).post('/api/listings/LIST-001/generate-ai').send({});

    expect(response.status).toBe(200);
    expect(response.body.alreadyQueued).toBe(true);
    expect(response.body.job).toMatchObject({
      id: 'job-generate-ai-active',
      job_type: 'generate_ai',
      status: 'running',
    });
  });

  it('manually retries failed recoverable generate_ai jobs asynchronously', async () => {
    const dataAccess = createDataAccess();
    dataAccess.listings.getByListingId = vi.fn(async () => ({
      ...listingRow,
      image_urls: ['https://example.com/front.jpg'],
      last_error_code: 'generate_ai_failed',
      last_error_context: { category: 'recoverable' },
      last_error_message: 'Gemini timeout',
      status: 'assets_ready',
      sub_status: 'ready_to_generate',
    }));
    dataAccess.listings.update = vi.fn(async (_listingId, changes) => ({
      ...listingRow,
      image_urls: ['https://example.com/front.jpg'],
      ...changes,
    }));
    dataAccess.jobs.listByListingId = vi.fn(async () => [
      {
        attempts: 3,
        created_at: '2026-05-17T01:00:00.000Z',
        id: 'job-generate-ai-failed',
        job_type: 'generate_ai',
        last_error: 'Gemini timeout',
        last_error_at: '2026-05-17T01:05:00.000Z',
        last_error_code: 'generate_ai_failed',
        listing_id: 'LIST-001',
        max_attempts: 3,
        next_run_at: null,
        status: 'failed',
        updated_at: '2026-05-17T01:05:00.000Z',
      },
    ]);
    dataAccess.jobs.resetForManualRetry = vi.fn(async () => ({
      attempts: 0,
      created_at: '2026-05-17T01:00:00.000Z',
      id: 'job-generate-ai-failed',
      job_type: 'generate_ai',
      last_error: null,
      last_error_at: null,
      last_error_code: null,
      listing_id: 'LIST-001',
      max_attempts: 3,
      next_run_at: null,
      status: 'queued',
      updated_at: '2026-05-17T02:00:00.000Z',
    }));
    const app = createApp(dataAccess);

    const response = await request(app).post('/api/listings/LIST-001/retry').send({});

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      alreadyQueued: false,
      workflow: 'generate_ai',
      job: expect.objectContaining({
        id: 'job-generate-ai-failed',
        status: 'queued',
      }),
      listing: expect.objectContaining({
        last_error_at: null,
        last_error_code: null,
        last_error_message: null,
        status: 'assets_ready',
        sub_status: 'ready_to_generate',
      }),
    });
    expect(dataAccess.jobs.claimDueQueued).not.toHaveBeenCalled();
    expect(dataAccess.listings.claimApprovedForPublish).not.toHaveBeenCalled();
  });

  it('serves retry only on the mounted /api/listings/:listingId/retry path', async () => {
    const dataAccess = createDataAccess();
    dataAccess.listings.getByListingId = vi.fn(async () => ({
      ...listingRow,
      last_error_code: 'generate_ai_missing_image_urls',
      last_error_context: { category: 'user_fixable' },
      status: 'assets_ready',
      sub_status: 'ready_to_generate',
    }));
    dataAccess.jobs.listByListingId = vi.fn(async () => [
      {
        attempts: 1,
        created_at: '2026-05-17T01:00:00.000Z',
        id: 'job-generate-ai-user-fixable',
        job_type: 'generate_ai',
        last_error: 'Missing images',
        last_error_at: '2026-05-17T01:05:00.000Z',
        last_error_code: 'generate_ai_missing_image_urls',
        listing_id: 'LIST-001',
        max_attempts: 3,
        next_run_at: null,
        status: 'failed',
        updated_at: '2026-05-17T01:05:00.000Z',
      },
    ]);
    dataAccess.jobs.resetForManualRetry = vi.fn(async () => ({
      attempts: 0,
      created_at: '2026-05-17T01:00:00.000Z',
      id: 'job-generate-ai-user-fixable',
      job_type: 'generate_ai',
      last_error: null,
      last_error_at: null,
      last_error_code: null,
      listing_id: 'LIST-001',
      max_attempts: 3,
      next_run_at: null,
      status: 'queued',
      updated_at: '2026-05-17T02:00:00.000Z',
    }));
    const app = createApp(dataAccess);

    const mountedResponse = await request(app).post('/api/listings/LIST-001/retry').send({});
    const bareResponse = await request(app).post('/listings/LIST-001/retry').send({});

    expect(mountedResponse.status).toBe(200);
    expect(bareResponse.status).toBe(404);
  });

  it('manually retries failed user-fixable generate_ai jobs after correction', async () => {
    const dataAccess = createDataAccess();
    dataAccess.listings.getByListingId = vi.fn(async () => ({
      ...listingRow,
      image_urls: ['https://example.com/front.jpg'],
      last_error_code: 'generate_ai_missing_image_urls',
      last_error_context: { category: 'user_fixable' },
      last_error_message: 'Missing images',
      status: 'assets_ready',
      sub_status: 'ready_to_generate',
    }));
    dataAccess.listings.update = vi.fn(async (_listingId, changes) => ({
      ...listingRow,
      image_urls: ['https://example.com/front.jpg'],
      ...changes,
    }));
    dataAccess.jobs.listByListingId = vi.fn(async () => [
      {
        attempts: 1,
        created_at: '2026-05-17T01:00:00.000Z',
        id: 'job-generate-ai-user-fixable',
        job_type: 'generate_ai',
        last_error: 'Missing images',
        last_error_at: '2026-05-17T01:05:00.000Z',
        last_error_code: 'generate_ai_missing_image_urls',
        listing_id: 'LIST-001',
        max_attempts: 3,
        next_run_at: null,
        status: 'failed',
        updated_at: '2026-05-17T01:05:00.000Z',
      },
    ]);
    dataAccess.jobs.resetForManualRetry = vi.fn(async () => ({
      attempts: 0,
      created_at: '2026-05-17T01:00:00.000Z',
      id: 'job-generate-ai-user-fixable',
      job_type: 'generate_ai',
      last_error: null,
      last_error_at: null,
      last_error_code: null,
      listing_id: 'LIST-001',
      max_attempts: 3,
      next_run_at: null,
      status: 'queued',
      updated_at: '2026-05-17T02:00:00.000Z',
    }));
    const app = createApp(dataAccess);

    const response = await request(app).post('/api/listings/LIST-001/retry').send({});

    expect(response.status).toBe(200);
    expect(response.body.workflow).toBe('generate_ai');
    expect(response.body.alreadyQueued).toBe(false);
    expect(dataAccess.jobs.resetForManualRetry).toHaveBeenCalledWith(
      'job-generate-ai-user-fixable',
      expect.any(String)
    );
  });

  it('rejects terminal generate_ai retry attempts', async () => {
    const dataAccess = createDataAccess();
    dataAccess.listings.getByListingId = vi.fn(async () => ({
      ...listingRow,
      last_error_code: 'generate_ai_listing_not_found',
      last_error_context: { category: 'terminal' },
      status: 'assets_ready',
      sub_status: 'ready_to_generate',
    }));
    dataAccess.jobs.listByListingId = vi.fn(async () => [
      {
        attempts: 1,
        created_at: '2026-05-17T01:00:00.000Z',
        id: 'job-generate-ai-terminal',
        job_type: 'generate_ai',
        last_error: 'listing missing',
        last_error_at: '2026-05-17T01:05:00.000Z',
        last_error_code: 'generate_ai_listing_not_found',
        listing_id: 'LIST-001',
        max_attempts: 3,
        next_run_at: null,
        status: 'failed',
        updated_at: '2026-05-17T01:05:00.000Z',
      },
    ]);
    const app = createApp(dataAccess);

    const response = await request(app).post('/api/listings/LIST-001/retry').send({});

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('manual_retry_not_allowed');
    expect(dataAccess.jobs.resetForManualRetry).not.toHaveBeenCalled();
  });

  it('returns alreadyQueued for active generate_ai retry requests', async () => {
    const dataAccess = createDataAccess();
    dataAccess.listings.getByListingId = vi.fn(async () => ({
      ...listingRow,
      status: 'generating',
      sub_status: 'ai_call_in_progress',
    }));
    dataAccess.jobs.listByListingId = vi.fn(async () => [
      {
        attempts: 1,
        created_at: '2026-05-17T01:00:00.000Z',
        id: 'job-generate-ai-active',
        job_type: 'generate_ai',
        last_error: null,
        last_error_at: null,
        last_error_code: null,
        listing_id: 'LIST-001',
        max_attempts: 3,
        next_run_at: null,
        status: 'running',
        updated_at: '2026-05-17T01:05:00.000Z',
      },
    ]);
    const app = createApp(dataAccess);

    const response = await request(app).post('/api/listings/LIST-001/retry').send({});

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      alreadyQueued: true,
      workflow: 'generate_ai',
      job: expect.objectContaining({
        id: 'job-generate-ai-active',
        status: 'running',
      }),
      listing: expect.objectContaining({
        status: 'generating',
        sub_status: 'ai_call_in_progress',
      }),
    });
    expect(dataAccess.listings.update).not.toHaveBeenCalled();
  });

  it('manually retries failed recoverable publish jobs asynchronously', async () => {
    const dataAccess = createDataAccess();
    dataAccess.listings.getByListingId = vi.fn(async () => ({
      ...listingRow,
      last_error_code: 'publish_offer_publish_failed',
      last_error_context: { category: 'recoverable' },
      status: 'approved_for_export',
      sub_status: 'idle',
    }));
    dataAccess.listings.update = vi.fn(async (_listingId, changes) => ({
      ...listingRow,
      ...changes,
    }));
    dataAccess.jobs.listByListingId = vi.fn(async () => [
      {
        attempts: 2,
        created_at: '2026-05-17T01:00:00.000Z',
        id: 'job-publish-failed',
        job_type: 'publish',
        last_error: 'publish failed',
        last_error_at: '2026-05-17T01:05:00.000Z',
        last_error_code: 'publish_offer_publish_failed',
        listing_id: 'LIST-001',
        max_attempts: 3,
        next_run_at: null,
        status: 'failed',
        updated_at: '2026-05-17T01:05:00.000Z',
      },
    ]);
    dataAccess.jobs.resetForManualRetry = vi.fn(async () => ({
      attempts: 0,
      created_at: '2026-05-17T01:00:00.000Z',
      id: 'job-publish-failed',
      job_type: 'publish',
      last_error: null,
      last_error_at: null,
      last_error_code: null,
      listing_id: 'LIST-001',
      max_attempts: 3,
      next_run_at: null,
      status: 'queued',
      updated_at: '2026-05-17T02:00:00.000Z',
    }));
    const app = createApp(dataAccess);

    const response = await request(app).post('/api/listings/LIST-001/retry').send({});

    expect(response.status).toBe(200);
    expect(response.body.workflow).toBe('publish');
    expect(response.body.job).toMatchObject({
      id: 'job-publish-failed',
      status: 'queued',
    });
    expect(dataAccess.jobs.claimDueQueued).not.toHaveBeenCalled();
    expect(dataAccess.listings.claimApprovedForPublish).not.toHaveBeenCalled();
  });

  it('returns alreadyQueued for active publish retry requests', async () => {
    const dataAccess = createDataAccess();
    dataAccess.listings.getByListingId = vi.fn(async () => ({
      ...listingRow,
      status: 'approved_for_export',
      sub_status: 'publishing_to_ebay',
    }));
    dataAccess.jobs.listByListingId = vi.fn(async () => [
      {
        attempts: 1,
        created_at: '2026-05-17T01:00:00.000Z',
        id: 'job-publish-active',
        job_type: 'publish',
        last_error: null,
        last_error_at: null,
        last_error_code: null,
        listing_id: 'LIST-001',
        max_attempts: 3,
        next_run_at: null,
        status: 'queued',
        updated_at: '2026-05-17T01:05:00.000Z',
      },
    ]);
    const app = createApp(dataAccess);

    const response = await request(app).post('/api/listings/LIST-001/retry').send({});

    expect(response.status).toBe(200);
    expect(response.body.alreadyQueued).toBe(true);
    expect(response.body.workflow).toBe('publish');
    expect(dataAccess.jobs.resetForManualRetry).not.toHaveBeenCalled();
  });

  it('does not clear publish failure context when manual retry loses to an active publish job race', async () => {
    const dataAccess = createDataAccess();
    dataAccess.listings.getByListingId = vi.fn(async () => ({
      ...listingRow,
      last_error_at: '2026-05-17T01:05:00.000Z',
      last_error_code: 'publish_offer_publish_failed',
      last_error_context: { category: 'recoverable' },
      last_error_message: 'publish failed',
      status: 'approved_for_export',
      sub_status: 'idle',
    }));
    dataAccess.listings.update = vi.fn(async (_listingId, changes) => ({
      ...listingRow,
      last_error_at: '2026-05-17T01:05:00.000Z',
      last_error_code: 'publish_offer_publish_failed',
      last_error_context: { category: 'recoverable' },
      last_error_message: 'publish failed',
      status: 'approved_for_export',
      sub_status: 'idle',
      ...changes,
    }));
    dataAccess.jobs.listByListingId = vi.fn(async () => [
      {
        attempts: 2,
        created_at: '2026-05-17T01:00:00.000Z',
        id: 'job-publish-failed',
        job_type: 'publish',
        last_error: 'publish failed',
        last_error_at: '2026-05-17T01:05:00.000Z',
        last_error_code: 'publish_offer_publish_failed',
        listing_id: 'LIST-001',
        max_attempts: 3,
        next_run_at: null,
        status: 'failed',
        updated_at: '2026-05-17T01:05:00.000Z',
      },
    ]);
    dataAccess.jobs.resetForManualRetry = vi.fn(async () => null);
    dataAccess.jobs.enqueuePublish = vi.fn(async () => ({
      alreadyQueued: true,
      job: {
        attempts: 0,
        created_at: '2026-05-17T02:00:00.000Z',
        id: 'job-publish-active',
        job_type: 'publish',
        last_error: null,
        last_error_at: null,
        last_error_code: null,
        listing_id: 'LIST-001',
        max_attempts: 3,
        next_run_at: null,
        status: 'queued',
        updated_at: '2026-05-17T02:00:00.000Z',
      },
    }));
    const app = createApp(dataAccess);

    const response = await request(app).post('/api/listings/LIST-001/retry').send({});

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      alreadyQueued: true,
      workflow: 'publish',
      job: expect.objectContaining({
        id: 'job-publish-active',
        status: 'queued',
      }),
      listing: expect.objectContaining({
        last_error_code: 'publish_offer_publish_failed',
        status: 'approved_for_export',
        sub_status: 'idle',
      }),
    });
    expect(dataAccess.listings.update).toHaveBeenNthCalledWith(
      1,
      'LIST-001',
      expect.objectContaining({
        last_error_code: null,
        status: 'approved_for_export',
        sub_status: 'publish_queued',
      })
    );
    expect(dataAccess.listings.update).toHaveBeenNthCalledWith(
      2,
      'LIST-001',
      expect.objectContaining({
        last_error_code: 'publish_offer_publish_failed',
        status: 'approved_for_export',
        sub_status: 'idle',
      })
    );
  });

  it('rejects retry for exported, listed, and sold listings', async () => {
    const dataAccess = createDataAccess();
    const app = createApp(dataAccess);
    dataAccess.jobs.listByListingId = vi.fn(async () => []);

    for (const status of ['exported', 'listed', 'sold'] as const) {
      dataAccess.listings.getByListingId = vi.fn(async () => ({
        ...listingRow,
        status,
        sub_status: 'idle',
      }));

      const response = await request(app).post('/api/listings/LIST-001/retry').send({});

      expect(response.status).toBe(409);
      expect(response.body.error).toBe('manual_retry_not_allowed');
    }
  });

  it('returns immediately when workflow params are invalid before body validation', async () => {
    const dataAccess = createDataAccess();
    const app = createApp(dataAccess);

    const response = await request(app).patch('/api/listings/%20/workflow-state').send({
      status: 'record_created',
      subStatus: 'publish_queued',
    });

    expect(response.status).toBe(400);
    expect(dataAccess.listings.updateWorkflowState).not.toHaveBeenCalled();
  });

  it('reads app settings through the shared repository access', async () => {
    const dataAccess = createDataAccess();
    const app = createApp(dataAccess);

    const response = await request(app).get('/api/app-settings');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(appSettingsRow);
    expect(dataAccess.appSettings.get).toHaveBeenCalledWith('default');
  });

  it('returns not_found when app settings are missing', async () => {
    const dataAccess = createDataAccess();
    dataAccess.appSettings.get = vi.fn(async () => null);
    const app = createApp(dataAccess);

    const response = await request(app).get('/api/app-settings');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: 'not_found',
      message: 'App settings "default" were not found.',
    });
  });

  it('returns not_found when a listing lookup misses', async () => {
    const dataAccess = createDataAccess();
    dataAccess.listings.getByListingId = vi.fn(async () => null);
    const app = createApp(dataAccess);

    const response = await request(app).get('/api/listings/LIST-404');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: 'not_found',
      message: 'Listing "LIST-404" was not found.',
    });
  });

  it('returns a generic message for server errors', async () => {
    const dataAccess = createDataAccess();
    dataAccess.listings.list = vi.fn(async () => {
      throw new Error('duplicate key value violates unique constraint "listings_pkey"');
    });
    const app = createApp(dataAccess);

    const response = await request(app).get('/api/listings');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: 'server_error',
      message: 'An unexpected server error occurred.',
    });
  });
});
