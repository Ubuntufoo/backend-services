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
      'Card Number': '136',
      Manufacturer: 'Panini',
      Player: 'Victor Wembanyama',
      Set: 'Prizm',
      Year: '2023',
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
    title: '2023 Panini Prizm Victor Wembanyama Rookie Card',
    updated_at: '2026-06-11T12:00:00.000Z',
    ...overrides,
  };
}

describe('smoke apify pricing script', () => {
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

  it('refuses run when APIFY_ENABLED=false', async () => {
    process.env.APIFY_ENABLED = 'false';
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { runSmokeApifyPricingCli } = await import('@/scripts/smoke-apify-pricing.js');
    await runSmokeApifyPricingCli(['--listing-id', 'Single-000123']);

    const payload = JSON.parse(logSpy.mock.calls[0][0] as string) as {
      failure: { code: string; message: string };
      overallStatus: string;
      provider: string;
    };

    expect(payload).toMatchObject({
      failure: {
        code: 'apify_enabled',
        message: 'APIFY_ENABLED=true required.',
      },
      overallStatus: 'fail',
      provider: 'apify',
    });
    expect(process.exitCode).toBe(1);
  });

  it('refuses missing selector', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { runSmokeApifyPricingCli } = await import('@/scripts/smoke-apify-pricing.js');
    await runSmokeApifyPricingCli([]);

    const payload = JSON.parse(logSpy.mock.calls[0][0] as string) as {
      failure: { code: string; message: string };
      overallStatus: string;
      usage: { selectors: string[] };
    };

    expect(payload).toMatchObject({
      failure: {
        code: 'invalid_arguments',
        message: 'Exactly one selector required.',
      },
      overallStatus: 'fail',
      usage: {
        selectors: ['--listing-id <listing_id>'],
      },
    });
    expect(process.exitCode).toBe(1);
  });

  it('refuses multiple selectors', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { runSmokeApifyPricingCli } = await import('@/scripts/smoke-apify-pricing.js');
    await runSmokeApifyPricingCli([
      '--listing-id',
      'Single-000123',
      '--listing-id',
      'Single-000124',
    ]);

    const payload = JSON.parse(logSpy.mock.calls[0][0] as string) as {
      failure: { code: string; message: string };
      overallStatus: string;
    };

    expect(payload).toMatchObject({
      failure: {
        code: 'invalid_arguments',
        message: 'Multiple selectors supplied. Exactly one selector required.',
      },
      overallStatus: 'fail',
    });
    expect(process.exitCode).toBe(1);
  });

  it('fails safely when listing not found', async () => {
    const getByListingId = vi.fn().mockResolvedValue(null);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { runSmokeApifyPricingCli } = await import('@/scripts/smoke-apify-pricing.js');
    await runSmokeApifyPricingCli(['--listing-id', 'Single-000123'], {
      createDataAccess: () =>
        ({
          jobs: {
            enqueueResearchPrice: vi.fn(),
          },
          listingPriceResearch: {
            create: vi.fn(),
            markFailed: vi.fn(),
            markSucceeded: vi.fn(),
          },
          listings: {
            getByListingId,
            update: vi.fn(),
            updateWorkflowState: vi.fn(),
          },
        }) as never,
    });

    const payload = JSON.parse(logSpy.mock.calls[0][0] as string) as {
      failure: { message: string };
      listingId: string;
      overallStatus: string;
      provider: string;
    };

    expect(payload).toMatchObject({
      failure: {
        message: 'Listing "Single-000123" was not found.',
      },
      listingId: 'Single-000123',
      overallStatus: 'fail',
      provider: 'apify',
    });
    expect(process.exitCode).toBe(1);
  });

  it('prints success summary json only and avoids db writes', async () => {
    const getByListingId = vi.fn().mockResolvedValue(createListing({ category_id: '183050' }));
    const update = vi.fn();
    const updateWorkflowState = vi.fn();
    const enqueueResearchPrice = vi.fn();
    const createResearch = vi.fn();
    const markFailed = vi.fn();
    const markSucceeded = vi.fn();
    const fetchSoldComps = vi.fn().mockImplementation(async (input) => {
      expect(input).toMatchObject({
        categoryId: '183050',
        conditionId: '2750',
        listingId: 'Single-000123',
      });

      return {
        fetchedAt: '2026-06-11T12:05:00.000Z',
        provider: 'apify',
        query: '2023 Panini Prizm Victor Wembanyama Rookie Card 136',
        rawResult: {
          actorId: 'actor-123',
          input: {
          actorInput: {
            count: 8,
            keywords: ['2023 Panini Prizm Victor Wembanyama Rookie Card 136'],
            listingId: 'Single-000123',
            minSoldComps: 8,
            title: '2023 Panini Prizm Victor Wembanyama Rookie Card',
          },
          query: '2023 Panini Prizm Victor Wembanyama Rookie Card 136',
        },
        output: {
          itemCount: 4,
          sampleTitles: ['Comp A', 'Comp B', 'Comp C', 'Comp D'],
          },
          run: {
            finishedAt: '2026-06-11T12:05:00.000Z',
            runId: 'run-123',
            startedAt: '2026-06-11T12:03:00.000Z',
            status: 'SUCCEEDED',
          },
        },
        soldComps: [
          {
            condition: 'Near Mint',
            listingUrl: 'https://www.ebay.com/itm/1',
            price: { currency: 'USD', value: 24.99 },
            shippingPrice: { currency: 'USD', value: 4.99 },
            soldDate: '2026-06-01T10:00:00.000Z',
            title: 'Comp A',
          },
          {
            condition: null,
            price: { currency: 'USD', value: 22 },
            soldDate: '2026-05-31T10:00:00.000Z',
            title: 'Comp B',
          },
          {
            price: { currency: 'USD', value: 21 },
            soldDate: '2026-05-30T10:00:00.000Z',
            title: 'Comp C',
          },
          {
            price: { currency: 'USD', value: 20 },
            soldDate: '2026-05-29T10:00:00.000Z',
            title: 'Comp D',
          },
        ],
      };
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { runSmokeApifyPricingCli } = await import('@/scripts/smoke-apify-pricing.js');
    await runSmokeApifyPricingCli(['--listing-id', 'Single-000123'], {
      createDataAccess: () =>
        ({
          jobs: {
            enqueueResearchPrice,
          },
          listingPriceResearch: {
            create: createResearch,
            markFailed,
            markSucceeded,
          },
          listings: {
            getByListingId,
            update,
            updateWorkflowState,
          },
        }) as never,
      createProvider: () =>
        ({
          fetchSoldComps,
          name: 'apify',
        }) as never,
    });

    const payload = JSON.parse(logSpy.mock.calls[0][0] as string) as {
      listingId: string;
      overallStatus: string;
      provider: string;
      rawResultSummary: {
        output: { itemCount: number; sampleTitles: string[] };
      };
      sampleComps: Array<Record<string, unknown>>;
      soldCompCount: number;
    };

    expect(payload).toMatchObject({
      listingId: 'Single-000123',
      overallStatus: 'pass',
      provider: 'apify',
      rawResultSummary: {
        input: {
          actorInput: {
            count: 8,
            keywords: ['2023 Panini Prizm Victor Wembanyama Rookie Card 136'],
          },
          query: '2023 Panini Prizm Victor Wembanyama Rookie Card 136',
        },
        output: {
          itemCount: 4,
          sampleTitles: ['Comp A', 'Comp B', 'Comp C'],
        },
      },
      soldCompCount: 4,
    });
    expect(payload.sampleComps).toHaveLength(3);
    expect(JSON.stringify(payload)).not.toContain('listingUrl');
    expect(JSON.stringify(payload)).not.toContain('category:183050');
    expect(JSON.stringify(payload)).not.toContain('condition:2750');
    expect(fetchSoldComps).toHaveBeenCalledTimes(1);
    expect(enqueueResearchPrice).not.toHaveBeenCalled();
    expect(createResearch).not.toHaveBeenCalled();
    expect(markFailed).not.toHaveBeenCalled();
    expect(markSucceeded).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(updateWorkflowState).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it('prints redacted classified provider failure and exits non-zero', async () => {
    const getByListingId = vi.fn().mockResolvedValue(createListing());
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { ApifyPricingProviderError } = await import('@/pricing/index.js');
    const { runSmokeApifyPricingCli } = await import('@/scripts/smoke-apify-pricing.js');

    await runSmokeApifyPricingCli(['--listing-id', 'Single-000123'], {
      createDataAccess: () =>
        ({
          jobs: {
            enqueueResearchPrice: vi.fn(),
          },
          listingPriceResearch: {
            create: vi.fn(),
            markFailed: vi.fn(),
            markSucceeded: vi.fn(),
          },
          listings: {
            getByListingId,
            update: vi.fn(),
            updateWorkflowState: vi.fn(),
          },
        }) as never,
      createProvider: () =>
        ({
          fetchSoldComps: vi.fn().mockRejectedValue(
            new ApifyPricingProviderError(
              'apify_auth_failed',
              'auth_config',
              'Bearer super-secret-token https://api.apify.com/v2/acts',
              'token=super-secret-token'
            )
          ),
          name: 'apify',
        }) as never,
    });

    const payload = JSON.parse(logSpy.mock.calls[0][0] as string) as {
      failure: { category: string; code: string; message: string; query: string };
      listingId: string;
      overallStatus: string;
      provider: string;
    };

    expect(payload).toMatchObject({
      failure: {
        category: 'auth_config',
        code: 'apify_auth_failed',
      },
      listingId: 'Single-000123',
      overallStatus: 'fail',
      provider: 'apify',
    });
    expect(payload.failure.message).not.toContain('super-secret-token');
    expect(payload.failure.query).not.toContain('super-secret-token');
    expect(process.exitCode).toBe(1);
  });
});
