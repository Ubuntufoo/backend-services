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
    item_specifics: {
      'Card Number': '98',
      Manufacturer: 'Topps',
      Player: 'Johnny Riddle',
      Set: 'Topps',
      Year: '1955',
    },
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
    title: '1955 Topps Johnny Riddle #98 St. Louis Cardinals',
    updated_at: '2026-06-11T12:00:00.000Z',
    ...overrides,
  };
}

describe('smoke soldcomps pricing script', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let originalExitCode: number | undefined;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    originalEnv = { ...process.env };
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
    process.env.SOLDCOMPS_API_KEY = 'soldcomps-secret-token';
    delete process.env.SOLDCOMPS_PRICE_TIMEOUT_SECONDS;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = originalEnv;
    process.exitCode = originalExitCode;
  });

  it('uses production soldcomps adapter shape and requests 50 comps by default', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const runRequest = vi.fn().mockResolvedValue({
      body: {
        hasNextPage: false,
        items: [
          {
            categoryId: '261328',
            condition: 'Pre-Owned',
            conditionId: 3000,
            endedAt: '2026-06-14T18:42:00.000Z',
            epid: null,
            itemId: '256123456789',
            scrapedAt: '2026-06-15T12:00:00.000Z',
            sellerFeedbackScore: 100,
            sellerPositivePercent: 100,
            sellerType: 'private',
            sellerUsername: 'seller-a',
            shippingCurrency: 'USD',
            shippingPrice: '1.99',
            shippingType: 'paid',
            soldCurrency: 'USD',
            soldPrice: '14.50',
            thumbnailUrl: 'https://example.com/thumb.jpg',
            title: '1955 Topps Johnny Riddle #98 St. Louis Cardinals',
            totalPrice: '16.49',
            url: 'https://www.ebay.com/itm/256123456789?nordt=true',
          },
        ],
        keyword: 'Johnny Riddle 1955 Topps #98',
        page: 1,
        totalItems: 1,
      },
      responseHeaders: {
        'x-usage-limit': '2000',
      },
      status: 200,
    });

    const { createSoldCompsPricingProvider } = await import('@/pricing/index.js');
    const provider = createSoldCompsPricingProvider(
      {
        apiKey: 'soldcomps-secret-token',
      },
      {
        runRequest,
      }
    );

    const { runSmokeSoldCompsPricingCli } = await import(
      '@/scripts/smoke-soldcomps-pricing.js'
    );
    await runSmokeSoldCompsPricingCli(['--listing-id', 'Single-000123'], {
      createDataAccess: () =>
        ({
          appSettings: {
            get: vi.fn().mockResolvedValue({
              pricing_provider_mode: 'soldcomps',
            }),
          },
          listings: {
            getByListingId: vi.fn().mockResolvedValue(createListing()),
          },
        }) as never,
      resolvePricingProvider: () => provider,
    });

    expect(runRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        count: 50,
        page: 1,
      })
    );

    const payload = JSON.parse(logSpy.mock.calls[0][0] as string) as {
      overallStatus: string;
      provider: string;
      rawResultSummary: { input: { request: { count: number } } };
      requestedCompCount: number;
      selectedProviderMode: string;
      soldCompCount: number;
    };

    expect(payload).toMatchObject({
      overallStatus: 'pass',
      provider: 'soldcomps',
      requestedCompCount: 50,
      selectedProviderMode: 'soldcomps',
      soldCompCount: 1,
    });
    expect(payload.rawResultSummary.input.request.count).toBe(50);
    expect(process.exitCode).toBeUndefined();
  });

  it('prints redacted provider failure payload', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { SoldCompsPricingProviderError } = await import('@/pricing/index.js');
    const { runSmokeSoldCompsPricingCli } = await import(
      '@/scripts/smoke-soldcomps-pricing.js'
    );

    await runSmokeSoldCompsPricingCli(['--listing-id', 'Single-000123'], {
      createDataAccess: () =>
        ({
          appSettings: {
            get: vi.fn().mockResolvedValue({
              pricing_provider_mode: 'soldcomps',
            }),
          },
          listings: {
            getByListingId: vi.fn().mockResolvedValue(createListing()),
          },
        }) as never,
      resolvePricingProvider: () =>
        ({
          fetchSoldComps: vi.fn().mockRejectedValue(
            new SoldCompsPricingProviderError(
              'soldcomps_auth_failed',
              'auth_config',
              'Bearer super-secret-token token=secret-value',
              'token=secret-value'
            )
          ),
          name: 'soldcomps',
        }) as never,
    });

    const payload = JSON.parse(logSpy.mock.calls[0][0] as string) as {
      failure: { category: string; code: string; message: string; query: string };
      overallStatus: string;
      provider: string;
      workflow_safe: boolean;
    };

    expect(payload).toMatchObject({
      failure: {
        category: 'auth_config',
        code: 'soldcomps_auth_failed',
      },
      overallStatus: 'fail',
      provider: 'soldcomps',
      workflow_safe: true,
    });
    expect(payload.failure.message).not.toContain('super-secret-token');
    expect(payload.failure.query).not.toContain('secret-value');
    expect(process.exitCode).toBe(1);
  });
});
