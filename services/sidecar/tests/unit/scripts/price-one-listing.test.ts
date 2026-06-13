import type { ListingRow } from '@ebay-inventory/data';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loadRootEnvironmentMock = vi.fn();

vi.mock('@/config/env-paths.js', () => ({
  loadRootEnvironment: loadRootEnvironmentMock,
}));

function createListing(overrides: Partial<ListingRow> = {}): ListingRow {
  return {
    approved_for_export_at: null,
    capture_mode: null,
    category_id: '261328',
    condition_id: '2750',
    condition_notes: null,
    created_at: '2026-06-11T12:00:00.000Z',
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
    image_urls: [],
    item_specifics: {},
    last_error_at: null,
    last_error_code: null,
    last_error_context: {},
    last_error_message: null,
    listing_id: 'Single-000123',
    listing_type: 'single',
    merchant_location_key: null,
    package_type: null,
    price: null,
    r2_delete_after: null,
    r2_deleted_at: null,
    r2_object_keys: [],
    r2_retention_policy: null,
    seller_hints: null,
    shipping_profile: null,
    sku: 'Single-000123',
    sold_at: null,
    status: 'needs_review',
    sub_status: 'review_pending',
    title: 'Test listing',
    updated_at: '2026-06-11T12:00:00.000Z',
    ...overrides,
  };
}

describe('price one listing script', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let originalExitCode: number | undefined;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    originalEnv = { ...process.env };
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
    process.env.APIFY_ENABLED = 'true';
    process.env.APIFY_TOKEN = 'secret-token';
    process.env.APIFY_PRICE_ACTOR_ID = 'actor-123';
    delete process.env.APIFY_MIN_SOLD_COMPS;
    delete process.env.APIFY_PRICE_TIMEOUT_SECONDS;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = originalEnv;
    process.exitCode = originalExitCode;
  });

  it('requires explicit --listing-id', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { runPriceOneListingCli } = await import('@/scripts/price-one-listing.js');
    await runPriceOneListingCli([]);

    const payload = JSON.parse(logSpy.mock.calls[0][0] as string) as {
      failure: { code: string; message: string };
      overallStatus: string;
      usage: { selectors: string[] };
    };

    expect(payload).toMatchObject({
      failure: {
        code: 'invalid_arguments',
        message: 'Exactly one --listing-id required.',
      },
      overallStatus: 'fail',
      usage: {
        selectors: ['--listing-id <listing_id>'],
      },
    });
    expect(process.exitCode).toBe(1);
  });

  it('calls canonical pricing function and prints compact success summary', async () => {
    const runPriceListingNow = vi.fn().mockResolvedValue({
      acceptedCompCount: 3,
      listing: createListing({ price: 27.5 }),
      listingPriceResearchUpdated: true,
      provider: 'apify',
      rawCompCount: 5,
      suggestedPrice: 27.5,
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { runPriceOneListingCli } = await import('@/scripts/price-one-listing.js');
    await runPriceOneListingCli(['--listing-id', 'Single-000123'], {
      createDataAccess: () => ({}) as never,
      runPriceListingNow,
    });

    expect(runPriceListingNow).toHaveBeenCalledWith(
      'Single-000123',
      expect.objectContaining({
        createPricingProvider: expect.any(Function),
        dataAccess: {},
        now: expect.any(Function),
      })
    );

    const payload = JSON.parse(logSpy.mock.calls[0][0] as string) as {
      accepted_comp_count: number;
      db_updated: boolean;
      listing_id: string;
      listing_price_updated: boolean;
      overallStatus: string;
      provider: string;
      raw_comp_count: number;
      suggested_price: number;
    };

    expect(payload).toEqual({
      accepted_comp_count: 3,
      db_updated: true,
      listing_id: 'Single-000123',
      listing_price_updated: true,
      overallStatus: 'pass',
      provider: 'apify',
      raw_comp_count: 5,
      suggested_price: 27.5,
    });
    expect(process.exitCode).toBeUndefined();
  });
});
