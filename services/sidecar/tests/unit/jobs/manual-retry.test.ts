import type {
  JobRow,
  ListingPriceResearchRow,
  ListingRow,
  ListingUpdate,
} from '@ebay-inventory/data';
import { describe, expect, it, vi } from 'vitest';

import type { SidecarDataAccess } from '@/data/sidecar-data.js';
import { JOB_ERROR_CODES } from '@/jobs/job-errors.js';
import { retryListingWorkflow, retryPricingReview } from '@/jobs/manual-retry.js';

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
  jobs: JobRow[],
  latestResearch: ListingPriceResearchRow | null = null
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
      enqueueResearchPrice: vi.fn(async () => ({
        alreadyQueued: false,
        job: createJobRow({
          id: 'job-research-price-enqueued',
          job_type: 'research_price',
          listing_id: listing.listing_id,
          status: 'queued',
        }),
      })),
      listByListingId: vi.fn(async () => jobs),
      resetForManualRetry,
    },
    listingPriceResearch: {
      getLatestByListingId: vi.fn(async () => latestResearch),
    },
  } as unknown as SidecarDataAccess;
}

function createResearchRow(
  overrides: Partial<ListingPriceResearchRow> = {}
): ListingPriceResearchRow {
  return {
    comps: [],
    confidence: null,
    created_at: '2026-05-22T12:00:00.000Z',
    dismissed_pricing_warning_codes: [],
    error_code: JOB_ERROR_CODES.RESEARCH_PRICE_SUGGESTED_PRICE_INVALID,
    error_message: 'No deterministic price.',
    id: 'research-row-id',
    listing_id: 'LIST-001',
    llm_price_explanation: null,
    llm_reasoning_json: {},
    llm_rejected_comp_ids: [],
    median_sold_price: null,
    pricing_model_name: null,
    provider: 'soldcomps',
    query: 'victor wembanyama 2023 prizm 136',
    raw_result_json: {},
    sold_count: null,
    status: 'failed',
    suggested_price: null,
    updated_at: '2026-05-22T12:01:00.000Z',
    ...overrides,
  };
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

describe('retryPricingReview', () => {
  it('resets latest failed research_price job for retryable deterministic pricing failure', async () => {
    const listing = createListingRow({
      status: 'needs_review',
      sub_status: 'review_pending',
    });
    const failedJob = createJobRow({
      id: 'job-research-price-failed',
      job_type: 'research_price',
      last_error_code: JOB_ERROR_CODES.RESEARCH_PRICE_SUGGESTED_PRICE_INVALID,
      status: 'failed',
      updated_at: '2026-05-22T12:01:00.000Z',
    });
    const dataAccess = createDataAccess(listing, [failedJob], createResearchRow());

    const result = await retryPricingReview({
      dataAccess,
      listingId: listing.listing_id,
      now: () => new Date('2026-05-22T12:05:00.000Z'),
    });

    expect(result).toMatchObject({
      alreadyQueued: false,
      listing,
      workflow: 'research_price',
    });
    expect(result.job).toMatchObject({
      id: 'job-research-price-failed',
      status: 'queued',
    });
    expect(dataAccess.jobs.resetForManualRetry).toHaveBeenCalledWith(
      'job-research-price-failed',
      '2026-05-22T12:05:00.000Z'
    );
    expect(dataAccess.jobs.enqueueResearchPrice).not.toHaveBeenCalled();
  });

  it('enqueues a new research_price job when failed pricing evidence exists but reset cannot be used', async () => {
    const listing = createListingRow({
      status: 'needs_review',
      sub_status: 'review_pending',
    });
    const failedJob = createJobRow({
      id: 'job-research-price-failed',
      job_type: 'research_price',
      last_error_code: JOB_ERROR_CODES.RESEARCH_PRICE_SUGGESTED_PRICE_INVALID,
      status: 'failed',
    });
    const dataAccess = createDataAccess(listing, [failedJob], createResearchRow());
    dataAccess.jobs.resetForManualRetry = vi.fn(async () => null);

    const result = await retryPricingReview({
      dataAccess,
      listingId: listing.listing_id,
    });

    expect(result.job).toMatchObject({
      id: 'job-research-price-enqueued',
      status: 'queued',
    });
    expect(dataAccess.jobs.enqueueResearchPrice).toHaveBeenCalledWith(listing.listing_id);
  });

  it('rejects missing listings', async () => {
    const dataAccess = createDataAccess(createListingRow(), []);
    dataAccess.listings.getByListingId = vi.fn(async () => null);

    await expect(
      retryPricingReview({
        dataAccess,
        listingId: 'LIST-404',
      })
    ).rejects.toMatchObject({
      code: 'not_found',
      message: 'Listing "LIST-404" was not found.',
    });
  });

  it('rejects ineligible listing status for pricing retry', async () => {
    const listing = createListingRow({
      status: 'approved_for_export',
      sub_status: 'idle',
    });
    const dataAccess = createDataAccess(listing, [], createResearchRow());

    await expect(
      retryPricingReview({
        dataAccess,
        listingId: listing.listing_id,
      })
    ).rejects.toMatchObject({
      code: 'ineligible_listing',
    });
  });

  it('rejects missing failed pricing evidence', async () => {
    const listing = createListingRow({
      status: 'needs_review',
      sub_status: 'review_pending',
    });
    const dataAccess = createDataAccess(listing, [], null);

    await expect(
      retryPricingReview({
        dataAccess,
        listingId: listing.listing_id,
      })
    ).rejects.toMatchObject({
      code: 'no_failed_pricing_evidence',
    });
  });

  it('rejects non-retryable pricing failures', async () => {
    const listing = createListingRow({
      status: 'needs_review',
      sub_status: 'review_pending',
    });
    const failedJob = createJobRow({
      id: 'job-research-price-failed',
      job_type: 'research_price',
      last_error_code: JOB_ERROR_CODES.RESEARCH_PRICE_FAILED,
      status: 'failed',
    });
    const dataAccess = createDataAccess(
      listing,
      [failedJob],
      createResearchRow({
        error_code: JOB_ERROR_CODES.RESEARCH_PRICE_FAILED,
      })
    );

    await expect(
      retryPricingReview({
        dataAccess,
        listingId: listing.listing_id,
      })
    ).rejects.toMatchObject({
      code: 'non_retryable_pricing_failure',
    });
  });

  it('rejects duplicate active research_price jobs', async () => {
    const listing = createListingRow({
      status: 'needs_review',
      sub_status: 'review_pending',
    });
    const activeJob = createJobRow({
      id: 'job-research-price-active',
      job_type: 'research_price',
      status: 'running',
    });
    const dataAccess = createDataAccess(listing, [activeJob], createResearchRow());

    await expect(
      retryPricingReview({
        dataAccess,
        listingId: listing.listing_id,
      })
    ).rejects.toMatchObject({
      code: JOB_ERROR_CODES.DUPLICATE_ACTIVE_JOB,
      message: 'Listing "LIST-001" already has an active research_price job.',
    });
  });
});
