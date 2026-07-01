import type { JobRow, ListingRow, ListingUpdate } from '@ebay-inventory/data';
import { describe, expect, it, vi } from 'vitest';

import type { SidecarDataAccess } from '@/data/sidecar-data.js';
import { JOB_ERROR_CODES } from '@/jobs/job-errors.js';
import { retryListingWorkflow } from '@/jobs/manual-retry.js';

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

function createJobRow(overrides: Partial<JobRow> = {}): JobRow {
  return {
    attempts: 0,
    created_at: '2026-05-22T12:00:00.000Z',
    id: 'job-generate-ai',
    job_type: 'generate_ai',
    last_error: null,
    last_error_at: null,
    last_error_code: null,
    listing_id: 'LIST-001',
    max_attempts: 3,
    next_run_at: null,
    status: 'queued',
    updated_at: '2026-05-22T12:00:00.000Z',
    ...overrides,
  };
}

function createDataAccess(
  listing: ListingRow,
  jobs: JobRow[]
): SidecarDataAccess {
  const listingsUpdate = vi.fn(async (_listingId: string, changes: ListingUpdate) => ({
    ...listing,
    ...changes,
  }));
  const resetForManualRetry = vi.fn(async (jobId: string) => {
    const job = jobs.find((entry) => entry.id === jobId) ?? createJobRow({ id: jobId });
    return {
      ...job,
      attempts: 0,
      last_error: null,
      last_error_at: null,
      last_error_code: null,
      next_run_at: null,
      status: 'queued' as const,
      updated_at: '2026-05-22T12:05:00.000Z',
    };
  });

  return {
    listings: {
      getByListingId: vi.fn(async () => listing),
      update: listingsUpdate,
    },
    jobs: {
      enqueueGenerateAi: vi.fn(),
      enqueuePublish: vi.fn(),
      listByListingId: vi.fn(async () => jobs),
      resetForManualRetry,
    },
  } as unknown as SidecarDataAccess;
}

describe('retryListingWorkflow needs_review semantics', () => {
  it('allows manual retry from needs_review only for failed generate_ai recovery', async () => {
    const listing = createListingRow({
      last_error_code: 'generate_ai_failed',
      last_error_context: { category: 'recoverable' },
      last_error_message: 'Gemini timeout',
      status: 'needs_review',
      sub_status: 'review_pending',
    });
    const failedJob = createJobRow({
      id: 'job-generate-ai-failed',
      job_type: 'generate_ai',
      last_error: 'Gemini timeout',
      last_error_at: '2026-05-22T12:01:00.000Z',
      last_error_code: 'generate_ai_failed',
      status: 'failed',
      updated_at: '2026-05-22T12:01:00.000Z',
    });
    const dataAccess = createDataAccess(listing, [failedJob]);

    const result = await retryListingWorkflow({
      dataAccess,
      listingId: listing.listing_id,
      now: () => new Date('2026-05-22T12:05:00.000Z'),
    });

    expect(result.workflow).toBe('generate_ai');
    expect(result.alreadyQueued).toBe(false);
    expect(result.job).toMatchObject({
      id: 'job-generate-ai-failed',
      status: 'queued',
    });
    expect(dataAccess.listings.update).toHaveBeenCalledWith(listing.listing_id, {
      last_error_at: null,
      last_error_code: null,
      last_error_context: {},
      last_error_message: null,
      status: 'assets_ready',
      sub_status: 'ready_to_generate',
    });
    expect(dataAccess.jobs.resetForManualRetry).toHaveBeenCalledWith(
      'job-generate-ai-failed',
      '2026-05-22T12:05:00.000Z'
    );
  });

  it('blocks manual retry from needs_review without failed generate_ai evidence', async () => {
    const listing = createListingRow({
      status: 'needs_review',
      sub_status: 'review_pending',
    });
    const completedJob = createJobRow({
      id: 'job-generate-ai-completed',
      job_type: 'generate_ai',
      status: 'completed',
      updated_at: '2026-05-22T12:01:00.000Z',
    });
    const dataAccess = createDataAccess(listing, [completedJob]);

    await expect(
      retryListingWorkflow({
        dataAccess,
        listingId: listing.listing_id,
      })
    ).rejects.toMatchObject({
      code: JOB_ERROR_CODES.MANUAL_RETRY_NOT_ALLOWED,
      message:
        'Listing "LIST-001" needs explicit failed generate_ai job evidence before manual retry is allowed from needs_review.',
    });

    expect(dataAccess.listings.update).not.toHaveBeenCalled();
    expect(dataAccess.jobs.resetForManualRetry).not.toHaveBeenCalled();
    expect(dataAccess.jobs.enqueueGenerateAi).not.toHaveBeenCalled();
  });

  it('blocks active generate_ai jobs from using needs_review as a generic retry path', async () => {
    const listing = createListingRow({
      last_error_code: 'generate_ai_failed',
      last_error_context: { category: 'recoverable' },
      status: 'needs_review',
      sub_status: 'review_pending',
    });
    const activeJob = createJobRow({
      id: 'job-generate-ai-active',
      job_type: 'generate_ai',
      status: 'running',
      updated_at: '2026-05-22T12:01:00.000Z',
    });
    const dataAccess = createDataAccess(listing, [activeJob]);

    await expect(
      retryListingWorkflow({
        dataAccess,
        listingId: listing.listing_id,
      })
    ).rejects.toMatchObject({
      code: JOB_ERROR_CODES.MANUAL_RETRY_NOT_ALLOWED,
      message:
        'Listing "LIST-001" needs explicit failed generate_ai job evidence before manual retry is allowed from needs_review.',
    });

    expect(dataAccess.listings.update).not.toHaveBeenCalled();
    expect(dataAccess.jobs.resetForManualRetry).not.toHaveBeenCalled();
  });
});
