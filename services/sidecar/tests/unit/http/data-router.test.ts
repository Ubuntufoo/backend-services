import express, { type Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ListingInsert,
  ListingUpdate,
  ListingWorkflowTransitionInput,
} from '@ebay-inventory/data';
import { ListingWorkflowTransitionConflictError } from '@ebay-inventory/data';
import { createDataApiRouter } from '@/http/data-router.js';
import type { SidecarDataAccess } from '@/data/sidecar-data.js';
import type { PricingAnalyst } from '@/pricing/index.js';

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

const pricingWarning = {
  analyst: 'google_pricing_reasoning',
  code: 'llm_analysis_failed',
  failure: {
    errorCode: 'MODEL_OVERLOADED',
    errorStatus: 'UNAVAILABLE',
    message: 'should stay private',
    provider: 'google',
    reason: 'HIGH_DEMAND',
    retryable: true,
    statusCode: 503,
  },
  modelName: 'gemma-4-31b-it',
  reason: 'llm_analysis_failed',
  retryable: true,
  severity: 'warning',
  summary: 'LLM pricing analysis failed. Deterministic price used.',
};

const latestPricingResearchRow = {
  comps: [],
  confidence: null,
  created_at: '2026-06-17T16:00:00.000Z',
  error_code: null,
  error_message: null,
  id: 'pricing-research-001',
  listing_id: 'LIST-001',
  llm_price_explanation: null,
  llm_reasoning_json: {
    failure: pricingWarning.failure,
    warnings: [pricingWarning],
  },
  llm_rejected_comp_ids: [],
  median_sold_price: null,
  pricing_model_name: null,
  provider: 'apify',
  query: null,
  raw_result_json: {},
  sold_count: null,
  status: 'succeeded',
  suggested_price: null,
  updated_at: '2026-06-17T16:00:00.000Z',
};

const geminiUsageSummary = {
  effectiveLimit: 540,
  remaining: 519,
  resetAt: '2026-06-02T07:00:00.000Z',
  resetTimeZone: 'America/Los_Angeles',
  usageDate: '2026-06-01',
  used: 21,
};

const geminiUsageLastAttempt = {
  display_name: 'Gemini 3.5 Flash',
  finished_at: '2026-06-01T06:59:12.000Z',
  model_name: 'gemini-3.5-flash',
  provider: 'google',
  started_at: '2026-06-01T06:59:00.000Z',
  status: 'succeeded',
};

const appSettingsRow = {
  capture_mode: 'single_2_image',
  default_fulfillment_policy_id: null,
  default_package_type: null,
  default_payment_policy_id: null,
  default_return_policy_id: null,
  default_shipping_profile: null,
  ebay_marketplace_id: 'EBAY_US',
  ebay_publish_config: null,
  gemini_daily_limit: 500,
  handling_days: 2,
  id: 'default',
  incoming_folder_path: '/incoming',
  max_order_syncs_per_day: 25,
  merchant_location_key: null,
  office_location_name: null,
  pricing_provider_mode: 'soldcomps',
  processed_folder_path: '/processed',
  r2_retention_days_after_sold: 30,
  soldcomps_usage_snapshot: {
    limit: 50,
    source: 'headers',
    updatedAt: '2026-06-16T16:30:00.000Z',
    used: 43,
  },
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
      getLatestGeminiUsageAttempt: vi.fn(async () => null),
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
      approveForExport: vi.fn(async (listingId: string) => ({
        ...listingRow,
        listing_id: listingId,
        sku: `OTHER-${listingId}`,
        status: 'approved_for_export',
        sub_status: 'publish_queued',
      })),
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
      enqueueResearchPrice: vi.fn(),
      fail: vi.fn(),
      getActiveGenerateAiByListingId: vi.fn(),
      getById: vi.fn(),
      listDueQueued: vi.fn(),
      listByListingId: vi.fn(),
      listByListingIds: vi.fn(),
      listStaleRunning: vi.fn(),
      resetForManualRetry: vi.fn(),
      requeue: vi.fn(),
      updateGeminiAttemptAudit: vi.fn(),
      update: vi.fn(),
    },
    listingPriceResearch: {
      create: vi.fn(),
      getLatestByListingId: vi.fn(async () => null),
      listLatestByListingIds: vi.fn(async () => []),
      markFailed: vi.fn(),
      markSucceeded: vi.fn(),
    },
    orders: {
      create: vi.fn(),
      getByOrderId: vi.fn(),
      update: vi.fn(),
    },
    appSettings: {
      create: vi.fn(),
      get: vi.fn(async () => appSettingsRow),
      update: vi.fn(async (changes) => ({
        ...appSettingsRow,
        ...changes,
      })),
    },
  };
}

function createApp(
  dataAccess: SidecarDataAccess,
  pricingAnalyst?: PricingAnalyst
): Express {
  const app = express();
  app.use(express.json());
  app.use('/api', createDataApiRouter({ dataAccess, pricingAnalyst }));
  return app;
}

describe('data API router', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      EBAY_CLIENT_ID: 'client-id-secret',
      EBAY_CLIENT_SECRET: 'client-secret-secret',
      EBAY_REDIRECT_URI: 'https://example.com/return',
      EBAY_REFRESH_TOKEN: 'refresh-token-secret',
      EBAY_USER_ACCESS_TOKEN: 'access-token-secret',
      EBAY_USER_REFRESH_TOKEN: 'user-refresh-token-secret',
    } as NodeJS.ProcessEnv;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('lists listings through the shared data access layer', async () => {
    const dataAccess = createDataAccess();
    const app = createApp(dataAccess);

    const response = await request(app).get('/api/listings');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      listings: [
        {
          ...listingRow,
          pricing_analysis_warnings: [],
        },
      ],
    });
    expect(dataAccess.listings.list).toHaveBeenCalledOnce();
    expect(dataAccess.listingPriceResearch.listLatestByListingIds).toHaveBeenCalledWith(['LIST-001']);
  });

  it('fetches one listing by listing id', async () => {
    const dataAccess = createDataAccess();
    const app = createApp(dataAccess);

    const response = await request(app).get('/api/listings/LIST-001');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ...listingRow,
      pricing_analysis_warnings: [],
    });
    expect(dataAccess.listings.getByListingId).toHaveBeenCalledWith('LIST-001');
    expect(dataAccess.listingPriceResearch.getLatestByListingId).toHaveBeenCalledWith('LIST-001');
  });

  it('returns Gemini daily usage summary', async () => {
    const dataAccess = createDataAccess();
    dataAccess.aiModelAttempts.getLatestGeminiUsageAttempt = vi.fn(async () => geminiUsageLastAttempt);
    const app = createApp(dataAccess);

    const response = await request(app).get('/api/gemini-usage');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      effective_limit: 540,
      last_attempt: geminiUsageLastAttempt,
      remaining: 519,
      reset_at: '2026-06-02T07:00:00.000Z',
      reset_time_zone: 'America/Los_Angeles',
      usage_date: '2026-06-01',
      used: 21,
    });
    expect(dataAccess.dailyUsage.getGeminiSummary).toHaveBeenCalledOnce();
    expect(dataAccess.aiModelAttempts.getLatestGeminiUsageAttempt).toHaveBeenCalledOnce();
  });

  it('returns null Gemini last attempt cleanly', async () => {
    const dataAccess = createDataAccess();
    dataAccess.aiModelAttempts.getLatestGeminiUsageAttempt = vi.fn(async () => null);
    const app = createApp(dataAccess);

    const response = await request(app).get('/api/gemini-usage');

    expect(response.status).toBe(200);
    expect(response.body.last_attempt).toBeNull();
  });

  it('keeps Gemini usage available when the latest-attempt lookup fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const dataAccess = createDataAccess();
    dataAccess.aiModelAttempts.getLatestGeminiUsageAttempt = vi.fn(async () => {
      throw new Error('attempt lookup failed');
    });
    const app = createApp(dataAccess);

    const response = await request(app).get('/api/gemini-usage');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      effective_limit: 540,
      last_attempt: null,
      remaining: 519,
      reset_at: '2026-06-02T07:00:00.000Z',
      reset_time_zone: 'America/Los_Angeles',
      usage_date: '2026-06-01',
      used: 21,
    });
    expect(warnSpy).toHaveBeenCalledOnce();
    warnSpy.mockRestore();
  });

  it('returns safe eBay environment data for sandbox', async () => {
    const dataAccess = createDataAccess();
    process.env.EBAY_ENVIRONMENT = 'sandbox';
    process.env.EBAY_MARKETPLACE_ID = 'EBAY_US';
    const app = createApp(dataAccess);

    const response = await request(app).get('/api/ebay-environment');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      api_base_url: 'https://api.sandbox.ebay.com',
      environment: 'sandbox',
      marketplace_id: 'EBAY_US',
      oauth_base_url: 'https://auth.sandbox.ebay.com',
    });
  });

  it('returns safe eBay environment data for production', async () => {
    const dataAccess = createDataAccess();
    process.env.EBAY_ENVIRONMENT = 'production';
    process.env.EBAY_MARKETPLACE_ID = 'EBAY_GB';
    const app = createApp(dataAccess);

    const response = await request(app).get('/api/ebay-environment');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      api_base_url: 'https://api.ebay.com',
      environment: 'production',
      marketplace_id: 'EBAY_GB',
      oauth_base_url: 'https://auth.ebay.com',
    });
  });

  it('does not leak client credentials or tokens', async () => {
    const dataAccess = createDataAccess();
    process.env.EBAY_ENVIRONMENT = 'sandbox';
    process.env.EBAY_MARKETPLACE_ID = 'EBAY_US';
    const app = createApp(dataAccess);

    const response = await request(app).get('/api/ebay-environment');
    const body = JSON.stringify(response.body);

    expect(response.status).toBe(200);
    expect(body).not.toContain('client-id-secret');
    expect(body).not.toContain('client-secret-secret');
    expect(body).not.toContain('refresh-token-secret');
    expect(body).not.toContain('access-token-secret');
    expect(body).not.toContain('user-refresh-token-secret');
    expect(body).not.toContain('https://example.com/return');
  });

  it('lists multiple listings without AI attempt summary fields', async () => {
    const dataAccess = createDataAccess();
    dataAccess.listings.list.mockResolvedValueOnce([listingRow, secondListingRow]);
    const app = createApp(dataAccess);

    const response = await request(app).get('/api/listings');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      listings: [
        {
          ...listingRow,
          pricing_analysis_warnings: [],
        },
        {
          ...secondListingRow,
          pricing_analysis_warnings: [],
        },
      ],
    });
  });

  it('exposes sanitized pricing analysis warnings on listing responses', async () => {
    const dataAccess = createDataAccess();
    dataAccess.listingPriceResearch.getLatestByListingId = vi.fn(async () => latestPricingResearchRow);
    dataAccess.listingPriceResearch.listLatestByListingIds = vi.fn(async () => [latestPricingResearchRow]);
    const app = createApp(dataAccess);

    const listResponse = await request(app).get('/api/listings');
    const detailResponse = await request(app).get('/api/listings/LIST-001');

    const expectedWarning = {
      analyst: 'google_pricing_reasoning',
      code: 'llm_analysis_failed',
      failure: {
        error_code: 'MODEL_OVERLOADED',
        error_status: 'UNAVAILABLE',
        provider: 'google',
        reason: 'HIGH_DEMAND',
        retryable: true,
        status_code: 503,
      },
      listing_id: 'LIST-001',
      model_name: 'gemma-4-31b-it',
      reason: 'llm_analysis_failed',
      research_id: 'pricing-research-001',
      retryable: true,
      severity: 'warning',
      summary: 'LLM pricing analysis failed. Deterministic price used.',
    };

    expect(listResponse.status).toBe(200);
    expect(detailResponse.status).toBe(200);
    expect(listResponse.body.listings[0]?.pricing_analysis_warnings).toEqual([expectedWarning]);
    expect(detailResponse.body.pricing_analysis_warnings).toEqual([expectedWarning]);
    expect(JSON.stringify(detailResponse.body.pricing_analysis_warnings)).not.toContain(
      'should stay private'
    );
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

  it('creates listing with merged pricing modifier defaults preserved in item specifics', async () => {
    const dataAccess = createDataAccess();
    const app = createApp(dataAccess);

    const response = await request(app).post('/api/listings').send({
      itemSpecifics: {
        Brand: 'Acme',
        Manufacturer: 'Acme',
      },
      pricingModifierOptions: {
        excludeAutographs: false,
      },
    });

    expect(response.status).toBe(201);
    expect(dataAccess.listings.create).toHaveBeenCalledWith(
      expect.objectContaining({
        item_specifics: {
          Brand: 'Acme',
          Manufacturer: 'Acme',
          pricingModifierOptions: {
            excludeAutographs: false,
            excludeGraded: true,
            excludeVariants: false,
          },
        },
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
      pricingModifierOptions: {
        excludeAutographs: false,
        excludeGraded: true,
      },
      sellerHints: 'Ship in original packaging',
      title: 'Updated title',
    });

    expect(response.status).toBe(200);
    expect(dataAccess.listings.update).toHaveBeenCalledWith('LIST-001', {
      category_id: 'CATEGORY-001',
      condition_id: 'CONDITION-001',
      condition_notes: 'Minor wear',
      description: 'Updated description',
      item_specifics: {
        Brand: 'Acme',
        pricingModifierOptions: {
          excludeAutographs: false,
          excludeGraded: true,
          excludeVariants: false,
        },
      },
      price: 19.99,
      seller_hints: 'Ship in original packaging',
      title: 'Updated title',
    });
  });

  it('passes manual skuCategoryCode review overrides through itemSpecifics without dropping sibling keys', async () => {
    const dataAccess = createDataAccess();
    const app = createApp(dataAccess);

    const response = await request(app).patch('/api/listings/LIST-001').send({
      itemSpecifics: {
        Brand: 'Topps',
        Manufacturer: 'Topps',
        skuCategoryCode: 'BSKBL',
      },
    });

    expect(response.status).toBe(200);
    expect(dataAccess.listings.update).toHaveBeenCalledWith('LIST-001', {
      item_specifics: {
        Brand: 'Topps',
        Manufacturer: 'Topps',
        skuCategoryCode: 'BSKBL',
      },
    });
  });

  it('merges pricing modifier options into existing listing item specifics on seller patch', async () => {
    const dataAccess = createDataAccess();
    dataAccess.listings.getByListingId = vi.fn(async () => ({
      ...listingRow,
      item_specifics: {
        Brand: 'Topps',
        Manufacturer: 'Topps',
      },
    }));
    const app = createApp(dataAccess);

    const response = await request(app).patch('/api/listings/LIST-001').send({
      pricingModifierOptions: {
        excludeAutographs: false,
        excludeGraded: false,
      },
    });

    expect(response.status).toBe(200);
    expect(dataAccess.listings.update).toHaveBeenCalledWith('LIST-001', {
      item_specifics: {
        Brand: 'Topps',
        Manufacturer: 'Topps',
        pricingModifierOptions: {
          excludeAutographs: false,
          excludeGraded: false,
          excludeVariants: false,
        },
      },
    });
  });

  it('rejects review patch attempts that try to authoritatively set a full sku', async () => {
    const dataAccess = createDataAccess();
    const app = createApp(dataAccess);

    const response = await request(app).patch('/api/listings/LIST-001').send({
      itemSpecifics: {
        skuCategoryCode: 'BSKBL',
      },
      sku: 'BSKBL-Single-000001',
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      details: [
        {
          message: "Unrecognized key(s) in object: 'sku'",
          path: '',
        },
      ],
      error: 'invalid_request',
    });
    expect(dataAccess.listings.update).not.toHaveBeenCalled();
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
      pricing_analysis_warnings: [],
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
    expect(dataAccess.listings.approveForExport).toHaveBeenCalledWith('LIST-001');
    expect(dataAccess.listings.updateWorkflowState).not.toHaveBeenCalled();
    expect(dataAccess.jobs.enqueuePublish).toHaveBeenCalledWith('LIST-001');
  });

  it('rejects workflow-state requests with extra fields such as FE-provided sku text', async () => {
    const dataAccess = createDataAccess();
    const app = createApp(dataAccess);

    const response = await request(app).patch('/api/listings/LIST-001/workflow-state').send({
      status: 'approved_for_export',
      subStatus: 'publish_queued',
      sku: 'ARBITRARY-FE-SKU',
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('invalid_request');
    expect(dataAccess.listings.updateWorkflowState).not.toHaveBeenCalled();
    expect(dataAccess.listings.approveForExport).not.toHaveBeenCalled();
    expect(dataAccess.jobs.enqueuePublish).not.toHaveBeenCalled();
  });

  it('returns listing_state_stale when approval no longer targets needs_review', async () => {
    const dataAccess = createDataAccess();
    dataAccess.listings.approveForExport = vi.fn(async () => {
      throw new ListingWorkflowTransitionConflictError(
        'Listing "LIST-001" must be in needs_review before approval for export. Current status: "exported".'
      );
    });
    const app = createApp(dataAccess);

    const response = await request(app).patch('/api/listings/LIST-001/workflow-state').send({
      status: 'approved_for_export',
      subStatus: 'publish_queued',
    });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: 'listing_state_stale',
      message:
        'Listing "LIST-001" must be in needs_review before approval for export. Current status: "exported".',
    });
    expect(dataAccess.listings.updateWorkflowState).not.toHaveBeenCalled();
    expect(dataAccess.jobs.enqueuePublish).not.toHaveBeenCalled();
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
      listing: {
        ...preparedListing,
        pricing_analysis_warnings: [],
      },
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
    expect(response.body).toEqual({
      ...Object.fromEntries(
        Object.entries(appSettingsRow).filter(([key]) => key !== 'soldcomps_usage_snapshot')
      ),
      soldcomps_usage: {
        limit: 50,
        updatedAt: '2026-06-16T16:30:00.000Z',
        used: 43,
      },
    });
    expect(response.body).not.toHaveProperty('soldcomps_usage_snapshot');
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

  it('normalizes pricing provider mode in app settings responses', async () => {
    const dataAccess = createDataAccess();
    dataAccess.appSettings.get = vi.fn(async () => ({
      ...appSettingsRow,
      pricing_provider_mode: null,
    }));
    const app = createApp(dataAccess);

    const response = await request(app).get('/api/app-settings');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: 'default',
      pricing_provider_mode: 'soldcomps',
      soldcomps_usage: {
        limit: 50,
        updatedAt: '2026-06-16T16:30:00.000Z',
        used: 43,
      },
    });
  });

  it('returns null public SoldComps usage when persisted snapshot malformed', async () => {
    const dataAccess = createDataAccess();
    dataAccess.appSettings.get = vi.fn(async () => ({
      ...appSettingsRow,
      soldcomps_usage_snapshot: {
        limit: 'fifty',
      },
    }));
    const app = createApp(dataAccess);

    const response = await request(app).get('/api/app-settings');

    expect(response.status).toBe(200);
    expect(response.body.soldcomps_usage).toBeNull();
    expect(response.body).not.toHaveProperty('soldcomps_usage_snapshot');
  });

  it('updates pricing_provider_mode through app settings', async () => {
    const dataAccess = createDataAccess();
    const app = createApp(dataAccess);

    const response = await request(app).patch('/api/app-settings').send({
      pricingProviderMode: 'off',
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: 'default',
      pricing_provider_mode: 'off',
    });
    expect(dataAccess.appSettings.update).toHaveBeenCalledWith(
      {
        pricing_provider_mode: 'off',
      },
      'default'
    );
  });

  it('rejects invalid app settings update payloads', async () => {
    const dataAccess = createDataAccess();
    const app = createApp(dataAccess);

    const invalidModeResponse = await request(app).patch('/api/app-settings').send({
      pricingProviderMode: 'fixture',
    });
    const legacyFieldResponse = await request(app).patch('/api/app-settings').send({
      pricingServiceEnabled: false,
    });
    const emptyBodyResponse = await request(app).patch('/api/app-settings').send({});

    expect(invalidModeResponse.status).toBe(400);
    expect(invalidModeResponse.body).toEqual({
      error: 'invalid_request',
      details: [
        {
          message: "Invalid enum value. Expected 'off' | 'soldcomps' | 'apify', received 'fixture'",
          path: 'pricingProviderMode',
        },
      ],
    });
    expect(legacyFieldResponse.status).toBe(400);
    expect(legacyFieldResponse.body).toEqual({
      error: 'invalid_request',
      details: [
        {
          message: 'pricingProviderMode is required',
          path: 'pricingProviderMode',
        },
        {
          message: "Unrecognized key(s) in object: 'pricingServiceEnabled'",
          path: '',
        },
      ],
    });
    expect(emptyBodyResponse.status).toBe(400);
    expect(emptyBodyResponse.body).toEqual({
      error: 'invalid_request',
      details: [
        {
          message: 'pricingProviderMode is required',
          path: 'pricingProviderMode',
        },
      ],
    });
    expect(dataAccess.appSettings.update).not.toHaveBeenCalled();
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

  describe('retry-pricing-analysis', () => {
    const retryWarning = {
      analyst: 'google_pricing_reasoning',
      code: 'llm_analysis_failed',
      failure: {
        errorCode: 'MODEL_OVERLOADED',
        errorStatus: 'UNAVAILABLE',
        provider: 'google',
        retryable: true,
        statusCode: 503,
      },
      modelName: 'gemma-4-31b-it',
      reason: 'llm_analysis_failed',
      retryable: true,
      severity: 'warning' as const,
      summary: 'LLM pricing analysis failed. Deterministic price used.',
    };

    const retryableResearchRow = {
      ...latestPricingResearchRow,
      comps: [
        {
          condition: null,
          id: 'comp-1',
          listingUrl: null,
          price: { currency: 'USD', value: 20 },
          shippingPrice: null,
          soldDate: '2026-06-01T10:00:00.000Z',
          source: 'provider',
          title: 'Test Comp 1',
          totalPrice: { currency: 'USD', value: 20 },
        },
        {
          condition: null,
          id: 'comp-2',
          listingUrl: null,
          price: { currency: 'USD', value: 22 },
          shippingPrice: null,
          soldDate: '2026-05-31T10:00:00.000Z',
          source: 'provider',
          title: 'Test Comp 2',
          totalPrice: { currency: 'USD', value: 22 },
        },
        {
          condition: null,
          id: 'comp-3',
          listingUrl: null,
          price: { currency: 'USD', value: 24 },
          shippingPrice: null,
          soldDate: '2026-05-30T10:00:00.000Z',
          source: 'provider',
          title: 'Test Comp 3',
          totalPrice: { currency: 'USD', value: 24 },
        },
      ],
      listing_id: 'LIST-001',
      llm_reasoning_json: {
        fallback: 'llm_analysis_failed',
        modelName: 'gemma-4-31b-it',
        status: 'succeeded',
        warnings: [retryWarning],
      },
      median_sold_price: 22,
      sold_count: 3,
      status: 'succeeded',
      suggested_price: 22,
    };

    it('returns warning_resolved true and updated listing on successful retry', async () => {
      const dataAccess = createDataAccess();
      // Use listing with condition token and comps with condition terms so
      // the allowed-adjustment window is eligible.
      dataAccess.listings.getByListingId = vi.fn(async () => ({
        ...listingRow,
        item_specifics: {
          'Card Condition': 'EXCELLENT',
        },
      }));
      dataAccess.listingPriceResearch.getLatestByListingId = vi.fn(
        async () => ({
          ...retryableResearchRow,
          comps: [
            {
              condition: null,
              id: 'comp-c1',
              listingUrl: null,
              price: { currency: 'USD', value: 22 },
              shippingPrice: null,
              soldDate: '2026-06-01T10:00:00.000Z',
              source: 'provider',
              title: 'Test Comp 1 EX',
              totalPrice: { currency: 'USD', value: 22 },
            },
            {
              condition: null,
              id: 'comp-c2',
              listingUrl: null,
              price: { currency: 'USD', value: 22 },
              shippingPrice: null,
              soldDate: '2026-05-31T10:00:00.000Z',
              source: 'provider',
              title: 'Test Comp 2 EX',
              totalPrice: { currency: 'USD', value: 22 },
            },
            {
              condition: null,
              id: 'comp-c3',
              listingUrl: null,
              price: { currency: 'USD', value: 22 },
              shippingPrice: null,
              soldDate: '2026-05-30T10:00:00.000Z',
              source: 'provider',
              title: 'Test Comp 3 EX',
              totalPrice: { currency: 'USD', value: 22 },
            },
          ],
        })
      );
      dataAccess.listingPriceResearch.markSucceeded = vi.fn(
        async () => retryableResearchRow
      );
      dataAccess.listings.update = vi.fn(async (_listingId, changes) => ({
        ...listingRow,
        ...changes,
        listing_id: 'LIST-001',
        price: changes.price ?? 22,
      }));

      const mockAnalyst: PricingAnalyst = {
        analyze: vi.fn().mockResolvedValue({
          modelName: 'gemma-4-31b-it',
          prompt: { systemInstruction: 'test', userPrompt: 'test' },
          rawOutput: {},
          reasoning: {
            ambiguousConditionTerms: [],
            compNotes: [],
            conditionAdjustedPrice: 22, // same as deterministic median → delta=0 → target=22
            conditionAdjustmentPercent: 0,
            conditionAdjustmentReason: 'Same condition.',
            confidence: 'high' as const,
            priceExplanation: 'No adjustment needed.',
            rejectedCompIds: [],
            reviewWarnings: [],
            selectedCompIds: ['comp-c1', 'comp-c2', 'comp-c3'],
          },
        }),
        name: 'google_pricing_reasoning',
      };

      const app = createApp(dataAccess, mockAnalyst);

      const response = await request(app)
        .post('/api/listings/LIST-001/retry-pricing-analysis')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.warning_resolved).toBe(true);
      expect(response.body.listing).toMatchObject({
        listing_id: 'LIST-001',
        price: 22,
      });
    });

    it('returns 404 when listing does not exist', async () => {
      const dataAccess = createDataAccess();
      dataAccess.listings.getByListingId = vi.fn(async () => null);
      const app = createApp(dataAccess);

      const response = await request(app)
        .post('/api/listings/LIST-404/retry-pricing-analysis')
        .send({});

      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({
        error: 'not_found',
      });
    });

    it('returns 422 when no pricing research exists', async () => {
      const dataAccess = createDataAccess();
      dataAccess.listingPriceResearch.getLatestByListingId = vi.fn(
        async () => null
      );
      const app = createApp(dataAccess);

      const response = await request(app)
        .post('/api/listings/LIST-001/retry-pricing-analysis')
        .send({});

      expect(response.status).toBe(422);
      expect(response.body).toMatchObject({
        error: 'no_research',
      });
    });

    it('returns 422 when latest research is not succeeded', async () => {
      const dataAccess = createDataAccess();
      dataAccess.listingPriceResearch.getLatestByListingId = vi.fn(
        async () => ({
          ...retryableResearchRow,
          status: 'failed',
        })
      );
      const app = createApp(dataAccess);

      const response = await request(app)
        .post('/api/listings/LIST-001/retry-pricing-analysis')
        .send({});

      expect(response.status).toBe(422);
      expect(response.body).toMatchObject({
        error: 'research_not_succeeded',
      });
    });

    it('returns 409 when no retryable warnings exist', async () => {
      const dataAccess = createDataAccess();
      dataAccess.listingPriceResearch.getLatestByListingId = vi.fn(
        async () => ({
          ...retryableResearchRow,
          llm_reasoning_json: {
            status: 'succeeded',
            warnings: [],
          },
        })
      );
      const app = createApp(dataAccess);

      const response = await request(app)
        .post('/api/listings/LIST-001/retry-pricing-analysis')
        .send({});

      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({
        error: 'no_retryable_warning',
      });
    });

    it('returns 422 when research has no persisted comps', async () => {
      const dataAccess = createDataAccess();
      dataAccess.listingPriceResearch.getLatestByListingId = vi.fn(
        async () => ({
          ...retryableResearchRow,
          comps: [],
        })
      );
      const app = createApp(dataAccess);

      const response = await request(app)
        .post('/api/listings/LIST-001/retry-pricing-analysis')
        .send({});

      expect(response.status).toBe(422);
      expect(response.body).toMatchObject({
        error: 'no_comps',
      });
    });
  });
});
