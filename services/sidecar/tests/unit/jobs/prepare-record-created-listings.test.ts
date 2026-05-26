import type { ListingRow, ListingUpdate } from '@ebay-inventory/data';
import type { ProcessListingImagesResult } from '@ebay-inventory/image-service';
import { describe, expect, it, vi } from 'vitest';

import type { SidecarDataAccess } from '@/data/sidecar-data.js';
import {
  prepareRecordCreatedListings,
  type PrepareRecordCreatedListingsResult,
} from '@/jobs/index.js';
import type { R2ImageUploader } from '@/jobs/r2-image-uploader.js';

function createListingRow(overrides: Partial<ListingRow> = {}): ListingRow {
  return {
    approved_for_export_at: null,
    capture_mode: 'single_2_image',
    category_id: null,
    condition_id: null,
    condition_notes: null,
    created_at: '2026-05-22T12:00:00.000Z',
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
    image_urls: [
      '/processed/LIST-001/LIST-001_01.jpg',
      '/processed/LIST-001/LIST-001_02.jpg',
    ],
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
    seller_hints: null,
    shipping_profile: null,
    sku: 'SKU-001',
    sold_at: null,
    status: 'record_created',
    sub_status: 'idle',
    title: null,
    updated_at: '2026-05-22T12:00:00.000Z',
    ...overrides,
  };
}

function createDataAccess(
  listings: ListingRow[],
  shouldRejectUpdate?: (changes: ListingUpdate, current: ListingRow) => Error | null
): {
  dataAccess: SidecarDataAccess;
  listingStates: Map<string, ListingRow>;
  listingsUpdate: ReturnType<typeof vi.fn>;
  listingsListByStatus: ReturnType<typeof vi.fn>;
} {
  const listingStates = new Map(
    listings.map((listing) => [listing.listing_id, { ...listing }])
  );
  const listingsList = vi.fn(async () => [...listingStates.values()].map((listing) => ({ ...listing })));
  const listingsListByStatus = vi.fn(
    async (
      status: ListingRow['status'],
      options: { limit: number; offset: number; orderByCreatedAt?: 'asc' | 'desc' }
    ) => {
      const filtered = [...listingStates.values()]
        .filter((listing) => listing.status === status)
        .sort((left, right) =>
          options.orderByCreatedAt === 'desc'
            ? right.created_at.localeCompare(left.created_at)
            : left.created_at.localeCompare(right.created_at)
        );

      return filtered
        .slice(options.offset, options.offset + options.limit)
        .map((listing) => ({ ...listing }));
    }
  );
  const listingsGetByListingId = vi.fn(async (listingId: string) => listingStates.get(listingId) ?? null);
  const listingsUpdate = vi.fn(async (listingId: string, changes: ListingUpdate) => {
    const current = listingStates.get(listingId);
    if (!current) {
      throw new Error(`Missing listing ${listingId}.`);
    }

    const rejection = shouldRejectUpdate?.(changes, current);
    if (rejection) {
      throw rejection;
    }

    const nextListing = {
      ...current,
      ...changes,
    } as ListingRow;
    listingStates.set(listingId, nextListing);
    return nextListing;
  });

  const dataAccess: SidecarDataAccess = {
    appSettings: {
      create: vi.fn(),
      get: vi.fn(),
      update: vi.fn(),
    },
    jobs: {
      claimQueued: vi.fn(),
      create: vi.fn(),
      enqueueGenerateAi: vi.fn(),
      enqueueProcessImages: vi.fn(),
      getActiveGenerateAiByListingId: vi.fn(),
      getById: vi.fn(),
      listQueued: vi.fn(),
      listByListingId: vi.fn(),
      update: vi.fn(),
    },
    listings: {
      claimApprovedForPublish: vi.fn(),
      create: vi.fn(),
      getByListingId: listingsGetByListingId,
      listApprovedForExport: vi.fn(async () => []),
      list: listingsList,
      listByStatus: listingsListByStatus,
      markPublishFailed: vi.fn(),
      saveImageMetadata: vi.fn(),
      update: listingsUpdate,
      updateWorkflowState: vi.fn(),
    },
    orders: {
      create: vi.fn(),
      getByOrderId: vi.fn(),
      update: vi.fn(),
    },
  };

  return {
    dataAccess,
    listingStates,
    listingsUpdate,
    listingsListByStatus,
  };
}

function createProcessedImagesResult(listingId = 'LIST-001'): ProcessListingImagesResult {
  return {
    listingId,
    outputDirectory: `/processed/${listingId}/.image-service-output/run-001`,
    processingMode: 'strip_exif' as const,
    images: [
      {
        sourcePath: `/processed/${listingId}/${listingId}_01.jpg`,
        outputPath: `/processed/${listingId}/.image-service-output/run-001/${listingId}_01.jpg`,
        filename: `${listingId}_01.jpg`,
        sizeBytes: 101,
        processingMode: 'strip_exif' as const,
      },
      {
        sourcePath: `/processed/${listingId}/${listingId}_02.jpg`,
        outputPath: `/processed/${listingId}/.image-service-output/run-001/${listingId}_02.jpg`,
        filename: `${listingId}_02.jpg`,
        sizeBytes: 102,
        processingMode: 'strip_exif' as const,
      },
    ],
  };
}

async function runStep({
  batchSize,
  dataAccess,
  imageProcessor,
  imageUploader,
  now = () => new Date('2026-05-22T13:00:00.000Z'),
}: {
  batchSize?: number;
  dataAccess: SidecarDataAccess;
  imageProcessor: ReturnType<typeof vi.fn>;
  imageUploader: R2ImageUploader;
  now?: () => Date;
}): Promise<PrepareRecordCreatedListingsResult> {
  return await prepareRecordCreatedListings({
    batchSize,
    createRunId: () => 'run-001',
    dataAccess,
    imageProcessor,
    imageUploader,
    now,
  });
}

describe('prepareRecordCreatedListings', () => {
  it('processes eligible watcher listings and moves them to assets_ready', async () => {
    const { dataAccess, listingStates, listingsUpdate } = createDataAccess([createListingRow()]);
    const imageProcessor = vi.fn(async () => createProcessedImagesResult());
    const imageUploader: R2ImageUploader = {
      uploadListingImages: vi.fn(async () => [
        {
          filename: 'LIST-001_01.jpg',
          objectKey: 'listings/list-001/list-001_01.jpg',
          publicUrl:
            'https://images.murphyfamilyhobby.dev/listings/list-001/list-001_01.jpg',
        },
        {
          filename: 'LIST-001_02.jpg',
          objectKey: 'listings/list-001/list-001_02.jpg',
          publicUrl:
            'https://images.murphyfamilyhobby.dev/listings/list-001/list-001_02.jpg',
        },
      ]),
    };

    const result = await runStep({
      dataAccess,
      imageProcessor,
      imageUploader,
    });

    expect(result.failed).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.exhaustedCandidates).toBe(true);
    expect(result.processed).toHaveLength(1);
    expect(result.processed[0]?.status).toBe('assets_ready');
    expect(listingStates.get('LIST-001')?.status).toBe('assets_ready');
    expect(listingsUpdate).toHaveBeenCalledWith(
      'LIST-001',
      expect.objectContaining({
        image_urls: [
          'https://images.murphyfamilyhobby.dev/listings/list-001/list-001_01.jpg',
          'https://images.murphyfamilyhobby.dev/listings/list-001/list-001_02.jpg',
        ],
        r2_object_keys: [
          'listings/list-001/list-001_01.jpg',
          'listings/list-001/list-001_02.jpg',
        ],
        status: 'assets_ready',
        sub_status: 'ready_to_generate',
      })
    );
  });

  it('saves uploaded image URLs and R2 object keys in processed image order', async () => {
    const { dataAccess, listingsUpdate } = createDataAccess([createListingRow()]);
    const imageProcessor = vi.fn(async () => createProcessedImagesResult());
    const imageUploader: R2ImageUploader = {
      uploadListingImages: vi.fn(async () => [
        {
          filename: 'LIST-001_02.jpg',
          objectKey: 'listings/list-001/list-001_02.jpg',
          publicUrl:
            'https://images.murphyfamilyhobby.dev/listings/list-001/list-001_02.jpg',
        },
        {
          filename: 'LIST-001_01.jpg',
          objectKey: 'listings/list-001/list-001_01.jpg',
          publicUrl:
            'https://images.murphyfamilyhobby.dev/listings/list-001/list-001_01.jpg',
        },
      ]),
    };

    await runStep({
      dataAccess,
      imageProcessor,
      imageUploader,
    });

    expect(listingsUpdate).toHaveBeenCalledWith(
      'LIST-001',
      expect.objectContaining({
        image_urls: [
          'https://images.murphyfamilyhobby.dev/listings/list-001/list-001_01.jpg',
          'https://images.murphyfamilyhobby.dev/listings/list-001/list-001_02.jpg',
        ],
        r2_object_keys: [
          'listings/list-001/list-001_01.jpg',
          'listings/list-001/list-001_02.jpg',
        ],
      })
    );
  });

  it('skips non-watcher rows without writing errors and still processes next eligible listing', async () => {
    const skippedListing = createListingRow({
      created_at: '2026-05-22T11:00:00.000Z',
      image_urls: ['https://cdn.example.com/manual-front.jpg'],
      listing_id: 'manual-001',
    });
    const eligibleListing = createListingRow({
      created_at: '2026-05-22T12:00:00.000Z',
    });
    const { dataAccess, listingStates, listingsUpdate, listingsListByStatus } = createDataAccess([
      skippedListing,
      eligibleListing,
    ]);
    const imageProcessor = vi.fn(async () => createProcessedImagesResult());
    const imageUploader: R2ImageUploader = {
      uploadListingImages: vi.fn(async () => [
        {
          filename: 'LIST-001_01.jpg',
          objectKey: 'listings/list-001/list-001_01.jpg',
          publicUrl:
            'https://images.murphyfamilyhobby.dev/listings/list-001/list-001_01.jpg',
        },
        {
          filename: 'LIST-001_02.jpg',
          objectKey: 'listings/list-001/list-001_02.jpg',
          publicUrl:
            'https://images.murphyfamilyhobby.dev/listings/list-001/list-001_02.jpg',
        },
      ]),
    };

    const result = await runStep({
      batchSize: 1,
      dataAccess,
      imageProcessor,
      imageUploader,
    });

    expect(result.failed).toEqual([]);
    expect(result.skipped).toEqual([
      {
        listingId: 'manual-001',
        reason: 'record_created_skip_non_local_source_images',
      },
    ]);
    expect(result.processed).toHaveLength(1);
    expect(result.exhaustedCandidates).toBe(false);
    expect(listingStates.get('manual-001')?.last_error_code).toBeNull();
    expect(listingsUpdate).not.toHaveBeenCalledWith(
      'manual-001',
      expect.objectContaining({
        last_error_code: expect.any(String),
      })
    );
    expect(listingsListByStatus).toHaveBeenNthCalledWith(1, 'record_created', {
      limit: 1,
      offset: 0,
      orderByCreatedAt: 'asc',
    });
    expect(listingsListByStatus).toHaveBeenNthCalledWith(2, 'record_created', {
      limit: 1,
      offset: 1,
      orderByCreatedAt: 'asc',
    });
  });

  it('writes listing failures for watcher-state conflicts before processing', async () => {
    const conflictedListing = createListingRow({
      image_urls: ['/processed/LIST-001/LIST-001_01.jpg'],
      r2_object_keys: ['listings/list-001/list-001_01.jpg'],
    });
    const { dataAccess, listingStates } = createDataAccess([conflictedListing]);
    const imageProcessor = vi.fn(async () => createProcessedImagesResult());
    const imageUploader: R2ImageUploader = {
      uploadListingImages: vi.fn(),
    };

    const result = await runStep({
      dataAccess,
      imageProcessor,
      imageUploader,
    });

    expect(result.processed).toEqual([]);
    expect(result.failed).toEqual([
      expect.objectContaining({
        errorCode: 'record_created_asset_state_conflict',
        listingId: 'LIST-001',
      }),
    ]);
    expect(result.skipped).toEqual([]);
    expect(imageProcessor).not.toHaveBeenCalled();
    expect(imageUploader.uploadListingImages).not.toHaveBeenCalled();
    expect(listingStates.get('LIST-001')?.status).toBe('record_created');
    expect(listingStates.get('LIST-001')?.last_error_code).toBe(
      'record_created_asset_state_conflict'
    );
  });

  it('does not move listing to assets_ready if image processing fails', async () => {
    const { dataAccess, listingStates } = createDataAccess([createListingRow()]);
    const imageProcessor = vi.fn(async () => {
      throw new Error('sharp exploded');
    });
    const imageUploader: R2ImageUploader = {
      uploadListingImages: vi.fn(),
    };

    const result = await runStep({
      dataAccess,
      imageProcessor,
      imageUploader,
    });

    expect(result.processed).toEqual([]);
    expect(result.failed).toEqual([
      expect.objectContaining({
        errorCode: 'record_created_image_processing_failed',
        listingId: 'LIST-001',
      }),
    ]);
    expect(imageUploader.uploadListingImages).not.toHaveBeenCalled();
    expect(listingStates.get('LIST-001')?.status).toBe('record_created');
    expect(listingStates.get('LIST-001')?.last_error_code).toBe(
      'record_created_image_processing_failed'
    );
  });

  it('does not move listing to assets_ready if DB persistence fails', async () => {
    const { dataAccess, listingStates, listingsUpdate } = createDataAccess(
      [createListingRow()],
      (changes) =>
        changes.status === 'assets_ready' ? new Error('database write failed') : null
    );
    const imageProcessor = vi.fn(async () => createProcessedImagesResult());
    const imageUploader: R2ImageUploader = {
      uploadListingImages: vi.fn(async () => [
        {
          filename: 'LIST-001_01.jpg',
          objectKey: 'listings/list-001/list-001_01.jpg',
          publicUrl:
            'https://images.murphyfamilyhobby.dev/listings/list-001/list-001_01.jpg',
        },
        {
          filename: 'LIST-001_02.jpg',
          objectKey: 'listings/list-001/list-001_02.jpg',
          publicUrl:
            'https://images.murphyfamilyhobby.dev/listings/list-001/list-001_02.jpg',
        },
      ]),
    };

    const result = await runStep({
      dataAccess,
      imageProcessor,
      imageUploader,
    });

    expect(result.processed).toEqual([]);
    expect(result.failed).toEqual([
      expect.objectContaining({
        errorCode: 'record_created_asset_persistence_failed',
        listingId: 'LIST-001',
      }),
    ]);
    expect(listingStates.get('LIST-001')?.status).toBe('record_created');
    expect(listingStates.get('LIST-001')?.last_error_code).toBe(
      'record_created_asset_persistence_failed'
    );
    expect(listingsUpdate).toHaveBeenCalledTimes(2);
    expect(listingsUpdate).toHaveBeenNthCalledWith(
      2,
      'LIST-001',
      expect.objectContaining({
        last_error_at: '2026-05-22T13:00:00.000Z',
        last_error_code: 'record_created_asset_persistence_failed',
      })
    );

    const failureUpdate = listingsUpdate.mock.calls[1]?.[1];
    expect(failureUpdate).not.toHaveProperty('image_urls');
    expect(failureUpdate).not.toHaveProperty('r2_object_keys');
    expect(failureUpdate).not.toHaveProperty('status');
    expect(failureUpdate).not.toHaveProperty('sub_status');
  });

  it('continues paginating until batchSize eligible rows are attempted', async () => {
    const listings = [
      createListingRow({
        created_at: '2026-05-22T10:00:00.000Z',
        image_urls: ['https://cdn.example.com/manual-1.jpg'],
        listing_id: 'manual-001',
      }),
      createListingRow({
        created_at: '2026-05-22T10:01:00.000Z',
        image_urls: ['https://cdn.example.com/manual-2.jpg'],
        listing_id: 'manual-002',
      }),
      createListingRow({
        created_at: '2026-05-22T10:02:00.000Z',
        listing_id: 'LIST-001',
      }),
      createListingRow({
        created_at: '2026-05-22T10:03:00.000Z',
        listing_id: 'LIST-002',
        image_urls: ['/processed/LIST-002/LIST-002_01.jpg', '/processed/LIST-002/LIST-002_02.jpg'],
        sku: 'SKU-002',
      }),
    ];
    const { dataAccess, listingsListByStatus } = createDataAccess(listings);
    const imageProcessor = vi.fn(async ({ listingId }: { listingId: string }) =>
      createProcessedImagesResult(listingId)
    );
    const imageUploader: R2ImageUploader = {
      uploadListingImages: vi.fn(async (input) =>
        input.images.map((image) => ({
          filename: image.filename,
          objectKey: `listings/${input.listingId.toLowerCase()}/${image.filename.toLowerCase()}`,
          publicUrl: `https://images.murphyfamilyhobby.dev/listings/${input.listingId.toLowerCase()}/${image.filename.toLowerCase()}`,
        }))
      ),
    };

    const result = await runStep({
      batchSize: 2,
      dataAccess,
      imageProcessor,
      imageUploader,
    });

    expect(result.processed.map((listing) => listing.listing_id)).toEqual(['LIST-001', 'LIST-002']);
    expect(result.skipped).toEqual([
      {
        listingId: 'manual-001',
        reason: 'record_created_skip_non_local_source_images',
      },
      {
        listingId: 'manual-002',
        reason: 'record_created_skip_non_local_source_images',
      },
    ]);
    expect(result.exhaustedCandidates).toBe(false);
    expect(listingsListByStatus).toHaveBeenNthCalledWith(1, 'record_created', {
      limit: 2,
      offset: 0,
      orderByCreatedAt: 'asc',
    });
    expect(listingsListByStatus).toHaveBeenNthCalledWith(2, 'record_created', {
      limit: 2,
      offset: 2,
      orderByCreatedAt: 'asc',
    });
  });
});
