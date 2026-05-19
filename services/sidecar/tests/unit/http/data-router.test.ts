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

const appSettingsRow = {
  capture_mode: 'single_1_image',
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
    listings: {
      create: vi.fn(async (input: ListingInsert) => ({
        ...listingRow,
        ...input,
      })),
      getByListingId: vi.fn(async () => listingRow),
      list: vi.fn(async () => [listingRow]),
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
      create: vi.fn(),
      getById: vi.fn(),
      listByListingId: vi.fn(),
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

  it('creates a manual or test listing with workflow defaults', async () => {
    const dataAccess = createDataAccess();
    const app = createApp(dataAccess);

    const response = await request(app).post('/api/listings').send({
      mode: 'test',
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual(
      expect.objectContaining({
        listing_id: expect.stringMatching(/^test-/),
        status: 'record_created',
        sub_status: 'idle',
        image_urls: [],
        item_specifics: {},
      })
    );
    expect(dataAccess.listings.create).toHaveBeenCalledWith(
      expect.objectContaining({
        listing_id: expect.stringMatching(/^test-/),
        status: 'record_created',
        sub_status: 'idle',
        image_urls: [],
        item_specifics: {},
      })
    );
  });

  it('rejects create requests without the required mode field', async () => {
    const dataAccess = createDataAccess();
    const app = createApp(dataAccess);

    const response = await request(app).post('/api/listings').send({
      title: 'Test listing',
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'invalid_request',
      details: [
        {
          message: 'Required',
          path: 'mode',
        },
      ],
    });
    expect(dataAccess.listings.create).not.toHaveBeenCalled();
  });

  it('rejects create requests with unknown fields', async () => {
    const dataAccess = createDataAccess();
    const app = createApp(dataAccess);

    const response = await request(app).post('/api/listings').send({
      mode: 'test',
      status: 'needs_review',
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'invalid_request',
      details: [
        {
          message: 'Unrecognized key(s) in object: \'status\'',
          path: '',
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
