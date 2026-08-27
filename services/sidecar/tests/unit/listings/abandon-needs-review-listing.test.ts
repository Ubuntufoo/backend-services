import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ListingRow } from '@ebay-inventory/data';

import type { SidecarDataAccess } from '@/data/sidecar-data.js';
import {
  abandonNeedsReviewListing,
  ListingAbandonmentError,
  removeWatcherListingDirectory,
  resolveWatcherListingDirectory,
  resolveWatcherProcessedRoot,
} from '@/listings/abandon-needs-review-listing.js';

const listing: ListingRow = {
  approved_for_export_at: null,
  auto_pricing_enabled: true,
  capture_mode: 'single_2_image',
  category_id: '261328',
  condition_id: '4000',
  condition_notes: null,
  created_at: '2026-07-30T12:00:00.000Z',
  description: 'Listing description',
  ebay_listing_id: null,
  ebay_listing_status: null,
  ebay_listing_url: null,
  ebay_offer_id: null,
  ese_eligible: null,
  estimated_weight_oz: null,
  exported_at: null,
  generated_at: '2026-07-30T12:02:00.000Z',
  handling_days: 2,
  id: 'listing-row-id',
  image_urls: ['https://images.example.com/listings/LIST-001/front.jpg'],
  item_specifics: {},
  last_error_at: null,
  last_error_code: null,
  last_error_context: {},
  last_error_message: null,
  listing_id: 'LIST-001',
  listing_type: 'single',
  merchant_location_key: null,
  package_type: null,
  price: 24.99,
  r2_delete_after: null,
  r2_deleted_at: null,
  r2_object_keys: [
    ' listings/LIST-001/front.jpg ',
    'listings/LIST-001/back.jpg',
    'listings/LIST-001/front.jpg',
    '',
  ],
  r2_retention_policy: null,
  seller_hints: null,
  shipping_profile: null,
  sku: 'BSKBL-Single-000001',
  sold_at: null,
  status: 'needs_review',
  sub_status: 'review_pending',
  title: 'Test listing',
  updated_at: '2026-07-30T12:03:00.000Z',
};

const tempRoots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();

  for (const tempRoot of tempRoots.splice(0)) {
    await rm(tempRoot, { force: true, recursive: true });
  }
});

function createDataAccess(currentListing: ListingRow | null = listing): SidecarDataAccess {
  return {
    appSettings: {
      get: vi.fn(async () => ({
        id: 'default',
        processed_folder_path: '/processed',
      })),
    },
    jobs: {
      listByListingId: vi.fn(async () => []),
    },
    listings: {
      deleteSandboxCleaned: vi.fn(async () => null),
      deleteNeedsReview: vi.fn(async () => currentListing),
      getByListingId: vi.fn(async () => currentListing),
      getBySku: vi.fn(async () => currentListing),
    },
    orders: {
      hasByListingId: vi.fn(async () => false),
    },
  } as unknown as SidecarDataAccess;
}

function createOptions(dataAccess: SidecarDataAccess) {
  return {
    dataAccess,
    deleteObjects: vi.fn(async () => undefined),
    env: { WATCHER_PROCESSED_DIR: '/processed' } as NodeJS.ProcessEnv,
    logger: {
      error: vi.fn(),
      info: vi.fn(),
    },
    removeDirectory: vi.fn(async () => undefined),
  };
}

async function expectAbandonmentError(
  promise: Promise<unknown>,
  code: ListingAbandonmentError['code'],
  statusCode: ListingAbandonmentError['statusCode']
): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code, statusCode });
}

describe('needs-review listing abandonment', () => {
  it('returns not found before cleanup when the listing is missing', async () => {
    const dataAccess = createDataAccess(null);
    const options = createOptions(dataAccess);

    await expectAbandonmentError(
      abandonNeedsReviewListing('LIST-404', options),
      'not_found',
      404
    );

    expect(options.deleteObjects).not.toHaveBeenCalled();
    expect(options.removeDirectory).not.toHaveBeenCalled();
    expect(dataAccess.listings.deleteNeedsReview).not.toHaveBeenCalled();
  });

  it.each([
    'record_created',
    'image_processing_queued',
    'images_processed',
    'generating',
    'approved_for_export',
    'exported',
    'listed',
    'sold',
  ])('rejects unsupported status %s before cleanup', async (status) => {
    const dataAccess = createDataAccess({ ...listing, status });
    const options = createOptions(dataAccess);

    await expectAbandonmentError(
      abandonNeedsReviewListing(listing.listing_id, options),
      'listing_abandonment_status_unsupported',
      409
    );

    expect(options.deleteObjects).not.toHaveBeenCalled();
    expect(options.removeDirectory).not.toHaveBeenCalled();
    expect(dataAccess.listings.deleteNeedsReview).not.toHaveBeenCalled();
  });

  it('allows an assets-ready listing to reach abandonment cleanup', async () => {
    const assetsReadyListing = {
      ...listing,
      generated_at: null,
      status: 'assets_ready',
      sub_status: 'ready_to_generate',
    } as ListingRow;
    const dataAccess = createDataAccess(assetsReadyListing);
    const options = createOptions(dataAccess);

    await expect(
      abandonNeedsReviewListing(assetsReadyListing.listing_id, options)
    ).resolves.toEqual({ abandoned: true, listingId: 'LIST-001' });

    expect(dataAccess.listings.deleteNeedsReview).toHaveBeenCalledWith({
      expectedUpdatedAt: assetsReadyListing.updated_at,
      listingId: assetsReadyListing.listing_id,
    });
  });

  it.each(['queued', 'running'])('rejects an active %s job before cleanup', async (status) => {
    const dataAccess = createDataAccess();
    dataAccess.jobs.listByListingId = vi.fn(async () => [{ status }] as never);
    const options = createOptions(dataAccess);

    await expectAbandonmentError(
      abandonNeedsReviewListing(listing.listing_id, options),
      'listing_abandonment_active_job',
      409
    );

    expect(options.deleteObjects).not.toHaveBeenCalled();
    expect(options.removeDirectory).not.toHaveBeenCalled();
    expect(dataAccess.listings.deleteNeedsReview).not.toHaveBeenCalled();
  });

  it('rejects an associated order before cleanup', async () => {
    const dataAccess = createDataAccess();
    dataAccess.orders.hasByListingId = vi.fn(async () => true);
    const options = createOptions(dataAccess);

    await expectAbandonmentError(
      abandonNeedsReviewListing(listing.listing_id, options),
      'listing_abandonment_order_exists',
      409
    );

    expect(options.deleteObjects).not.toHaveBeenCalled();
    expect(options.removeDirectory).not.toHaveBeenCalled();
    expect(dataAccess.listings.deleteNeedsReview).not.toHaveBeenCalled();
  });

  it('rejects missing processed-root configuration before cleanup', async () => {
    const dataAccess = createDataAccess();
    dataAccess.appSettings.get = vi.fn(async () => null);
    const options = createOptions(dataAccess);
    options.env = {};

    await expectAbandonmentError(
      abandonNeedsReviewListing(listing.listing_id, options),
      'listing_abandonment_configuration_error',
      500
    );

    expect(options.deleteObjects).not.toHaveBeenCalled();
    expect(options.removeDirectory).not.toHaveBeenCalled();
    expect(dataAccess.listings.deleteNeedsReview).not.toHaveBeenCalled();
    expect(options.logger.error).toHaveBeenCalledWith(
      'Listing abandonment configuration validation failed.',
      { listingId: 'LIST-001', stage: 'configuration' }
    );
  });

  it.each([
    ['ebay_offer_id', 'OFFER-001'],
    ['ebay_listing_id', 'EBAY-001'],
    ['ebay_listing_url', 'https://www.ebay.com/itm/EBAY-001'],
    ['ebay_listing_status', 'ACTIVE'],
    ['approved_for_export_at', '2026-07-30T12:04:00.000Z'],
    ['exported_at', '2026-07-30T12:05:00.000Z'],
    ['sold_at', '2026-07-30T12:06:00.000Z'],
  ] as const)('rejects unexpected eBay/export trace in %s', async (field, value) => {
    const dataAccess = createDataAccess({ ...listing, [field]: value });
    const options = createOptions(dataAccess);

    await expectAbandonmentError(
      abandonNeedsReviewListing(listing.listing_id, options),
      'listing_abandonment_ebay_trace',
      409
    );

    expect(options.deleteObjects).not.toHaveBeenCalled();
    expect(options.removeDirectory).not.toHaveBeenCalled();
    expect(dataAccess.listings.deleteNeedsReview).not.toHaveBeenCalled();
  });

  it('deletes exact R2 keys, then the listing directory, then the unchanged database row', async () => {
    const calls: string[] = [];
    const dataAccess = createDataAccess();
    dataAccess.jobs.listByListingId = vi.fn(
      async () => [{ status: 'completed' }, { status: 'failed' }] as never
    );
    dataAccess.listings.deleteNeedsReview = vi.fn(async () => {
      calls.push('database');
      return listing;
    });
    const options = createOptions(dataAccess);
    options.deleteObjects = vi.fn(async () => {
      calls.push('r2');
    });
    options.removeDirectory = vi.fn(async () => {
      calls.push('filesystem');
    });

    await expect(abandonNeedsReviewListing(listing.listing_id, options)).resolves.toEqual({
      abandoned: true,
      listingId: 'LIST-001',
    });

    expect(options.deleteObjects).toHaveBeenCalledWith([
      'listings/LIST-001/front.jpg',
      'listings/LIST-001/back.jpg',
    ]);
    expect(options.removeDirectory).toHaveBeenCalledWith('/processed/LIST-001');
    expect(dataAccess.listings.deleteNeedsReview).toHaveBeenCalledWith({
      expectedUpdatedAt: '2026-07-30T12:03:00.000Z',
      listingId: 'LIST-001',
    });
    expect(calls).toEqual(['r2', 'filesystem', 'database']);
    expect(options.logger.info).toHaveBeenCalledWith('Listing abandoned.', {
      listingId: 'LIST-001',
      r2ObjectCount: 2,
    });
  });

  it('keeps the database row when R2 cleanup fails', async () => {
    const dataAccess = createDataAccess();
    const options = createOptions(dataAccess);
    options.deleteObjects = vi.fn(async () => {
      throw new Error('R2 unavailable');
    });

    await expectAbandonmentError(
      abandonNeedsReviewListing(listing.listing_id, options),
      'listing_abandonment_cleanup_failed',
      500
    );

    expect(options.removeDirectory).not.toHaveBeenCalled();
    expect(dataAccess.listings.deleteNeedsReview).not.toHaveBeenCalled();
    expect(options.logger.error).toHaveBeenCalledWith('Listing abandonment cleanup failed.', {
      listingId: 'LIST-001',
      stage: 'r2',
    });
  });

  it('keeps the database row when filesystem cleanup fails', async () => {
    const dataAccess = createDataAccess();
    const options = createOptions(dataAccess);
    options.removeDirectory = vi.fn(async () => {
      throw new Error('Permission denied');
    });

    await expectAbandonmentError(
      abandonNeedsReviewListing(listing.listing_id, options),
      'listing_abandonment_cleanup_failed',
      500
    );

    expect(options.deleteObjects).toHaveBeenCalledOnce();
    expect(dataAccess.listings.deleteNeedsReview).not.toHaveBeenCalled();
  });

  it('returns stale-state conflict when the optimistic final delete finds no row', async () => {
    const dataAccess = createDataAccess();
    dataAccess.listings.deleteNeedsReview = vi.fn(async () => null);
    const options = createOptions(dataAccess);

    await expectAbandonmentError(
      abandonNeedsReviewListing(listing.listing_id, options),
      'listing_abandonment_state_stale',
      409
    );

    expect(options.deleteObjects).toHaveBeenCalledOnce();
    expect(options.removeDirectory).toHaveBeenCalledOnce();
  });

  it('treats missing R2 and local artifacts as idempotent success', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'listing-abandonment-missing-'));
    tempRoots.push(tempRoot);
    const dataAccess = createDataAccess({ ...listing, r2_object_keys: [] });
    dataAccess.appSettings.get = vi.fn(async () => ({
      id: 'default',
      processed_folder_path: tempRoot,
    }) as never);

    await expect(
      abandonNeedsReviewListing(listing.listing_id, {
        dataAccess,
        env: {},
        logger: { error: vi.fn(), info: vi.fn() },
      })
    ).resolves.toEqual({ abandoned: true, listingId: 'LIST-001' });

    expect(dataAccess.listings.deleteNeedsReview).toHaveBeenCalledOnce();
  });
});

describe('watcher processed-directory safety', () => {
  it('prefers matching absolute watcher config and accepts the absolute app-settings fallback', () => {
    expect(
      resolveWatcherProcessedRoot({
        appSettingsProcessedRoot: '/data/processed',
        env: { WATCHER_PROCESSED_DIR: '/data/processed/' },
      })
    ).toBe('/data/processed');
    expect(
      resolveWatcherProcessedRoot({
        appSettingsProcessedRoot: '/fallback/processed',
        env: {},
      })
    ).toBe('/fallback/processed');
  });

  it.each([
    [{ WATCHER_PROCESSED_DIR: 'watcher/processed' }, null],
    [{ WATCHER_PROCESSED_DIR: '/env/processed' }, '/settings/processed'],
    [{}, 'relative/processed'],
    [{}, null],
  ] as const)('rejects ambiguous watcher configuration %#', (env, appSettingsProcessedRoot) => {
    expect(() =>
      resolveWatcherProcessedRoot({ appSettingsProcessedRoot, env })
    ).toThrowError(
      expect.objectContaining({ code: 'listing_abandonment_configuration_error' })
    );
  });

  it.each(['../escape', '/absolute-escape', '.', 'nested/LIST-001'])(
    'rejects unsafe listing directory identifier %s',
    (listingId) => {
      expect(() => resolveWatcherListingDirectory('/processed', listingId)).toThrowError(
        expect.objectContaining({ code: 'listing_abandonment_configuration_error' })
      );
    }
  );

  it('recursively removes only the exact listing directory and leaves siblings untouched', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'listing-abandonment-files-'));
    tempRoots.push(tempRoot);
    const listingDirectory = join(tempRoot, 'LIST-001');
    const siblingDirectory = join(tempRoot, 'LIST-002');
    await mkdir(join(listingDirectory, '.image-service-output'), { recursive: true });
    await mkdir(siblingDirectory);
    await writeFile(join(listingDirectory, 'LIST-001_01.jpg'), 'front');
    await writeFile(join(listingDirectory, '.image-service-output', 'normalized.jpg'), 'output');
    await writeFile(join(siblingDirectory, 'LIST-002_01.jpg'), 'sibling');

    await removeWatcherListingDirectory(tempRoot, 'LIST-001');

    await expect(access(listingDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(siblingDirectory, 'LIST-002_01.jpg'), 'utf8')).resolves.toBe(
      'sibling'
    );
  });
});

describe('listing abandonment cascade migration', () => {
  it('cascades listing deletion through jobs and pricing research without changing orders', async () => {
    const migration = await readFile(
      new URL(
        '../../../../../supabase/migrations/20260730140615_add_needs_review_listing_abandonment_cascades.sql',
        import.meta.url
      ),
      'utf8'
    );

    expect(migration).toMatch(
      /alter table public\.jobs[\s\S]*?jobs_listing_id_fkey[\s\S]*?on delete cascade;/
    );
    expect(migration).toMatch(
      /alter table public\.listing_price_research[\s\S]*?listing_price_research_listing_id_fkey[\s\S]*?on delete cascade;/
    );
    expect(migration).not.toContain('alter table public.orders');
    expect(migration).not.toContain('ai_model_attempts');
  });
});
