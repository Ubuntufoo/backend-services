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
} {
  const listingStates = new Map(
    listings.map((listing) => [listing.listing_id, { ...listing }])
  );
  const listingsList = vi.fn(async () => [...listingStates.values()].map((listing) => ({ ...listing })));
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
      create: vi.fn(),
      enqueueGenerateAi: vi.fn(),
      getActiveGenerateAiByListingId: vi.fn(),
      getById: vi.fn(),
      listByListingId: vi.fn(),
      update: vi.fn(),
    },
    listings: {
      create: vi.fn(),
      getByListingId: listingsGetByListingId,
      list: listingsList,
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
  };
}

function createProcessedImagesResult(): ProcessListingImagesResult {
  return {
    listingId: 'LIST-001',
    outputDirectory: '/processed/LIST-001/.image-service-output/run-001',
    processingMode: 'strip_exif' as const,
    images: [
      {
        sourcePath: '/processed/LIST-001/LIST-001_01.jpg',
        outputPath: '/processed/LIST-001/.image-service-output/run-001/LIST-001_01.jpg',
        filename: 'LIST-001_01.jpg',
        sizeBytes: 101,
        processingMode: 'strip_exif' as const,
      },
      {
        sourcePath: '/processed/LIST-001/LIST-001_02.jpg',
        outputPath: '/processed/LIST-001/.image-service-output/run-001/LIST-001_02.jpg',
        filename: 'LIST-001_02.jpg',
        sizeBytes: 102,
        processingMode: 'strip_exif' as const,
      },
    ],
  };
}

async function runStep({
  dataAccess,
  imageProcessor,
  imageUploader,
  now = () => new Date('2026-05-22T13:00:00.000Z'),
}: {
  dataAccess: SidecarDataAccess;
  imageProcessor: ReturnType<typeof vi.fn>;
  imageUploader: R2ImageUploader;
  now?: () => Date;
}): Promise<PrepareRecordCreatedListingsResult> {
  return await prepareRecordCreatedListings({
    createRunId: () => 'run-001',
    dataAccess,
    imageProcessor,
    imageUploader,
    now,
  });
}

describe('prepareRecordCreatedListings', () => {
  it('skips listings that are already past record_created', async () => {
    const { dataAccess, listingStates, listingsUpdate } = createDataAccess([
      createListingRow({
        status: 'assets_ready',
        sub_status: 'ready_to_generate',
        image_urls: ['https://cdn.example.com/front.jpg'],
        r2_object_keys: ['listings/list-001/front.jpg'],
      }),
    ]);
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
    expect(result.failed).toEqual([]);
    expect(imageProcessor).not.toHaveBeenCalled();
    expect(imageUploader.uploadListingImages).not.toHaveBeenCalled();
    expect(listingsUpdate).not.toHaveBeenCalled();
    expect(listingStates.get('LIST-001')).toEqual(
      expect.objectContaining({
        status: 'assets_ready',
        image_urls: ['https://cdn.example.com/front.jpg'],
        r2_object_keys: ['listings/list-001/front.jpg'],
      })
    );
  });

  it('processes eligible record_created listings and moves them to assets_ready', async () => {
    const { dataAccess, listingStates, listingsUpdate } = createDataAccess([createListingRow()]);
    const imageProcessor = vi.fn(async () => createProcessedImagesResult());
    const imageUploader: R2ImageUploader = {
      uploadListingImages: vi.fn(async () => [
        {
          filename: 'LIST-001_01.jpg',
          objectKey: 'listings/list-001/front.jpg',
          publicUrl: 'https://cdn.example.com/front.jpg',
        },
        {
          filename: 'LIST-001_02.jpg',
          objectKey: 'listings/list-001/back.jpg',
          publicUrl: 'https://cdn.example.com/back.jpg',
        },
      ]),
    };

    const result = await runStep({
      dataAccess,
      imageProcessor,
      imageUploader,
    });

    expect(result.failed).toEqual([]);
    expect(result.processed).toHaveLength(1);
    expect(result.processed[0]?.status).toBe('assets_ready');
    expect(listingStates.get('LIST-001')?.status).toBe('assets_ready');
    expect(listingsUpdate).toHaveBeenCalledWith(
      'LIST-001',
      expect.objectContaining({
        image_urls: ['https://cdn.example.com/front.jpg', 'https://cdn.example.com/back.jpg'],
        r2_object_keys: ['listings/list-001/front.jpg', 'listings/list-001/back.jpg'],
        status: 'assets_ready',
        sub_status: 'ready_to_generate',
      })
    );
  });

  it('calls image-service with a distinct output directory', async () => {
    const { dataAccess } = createDataAccess([createListingRow()]);
    const imageProcessor = vi.fn(async () => createProcessedImagesResult());
    const imageUploader: R2ImageUploader = {
      uploadListingImages: vi.fn(async () => [
        {
          filename: 'LIST-001_01.jpg',
          objectKey: 'listings/list-001/front.jpg',
          publicUrl: 'https://cdn.example.com/front.jpg',
        },
        {
          filename: 'LIST-001_02.jpg',
          objectKey: 'listings/list-001/back.jpg',
          publicUrl: 'https://cdn.example.com/back.jpg',
        },
      ]),
    };

    await runStep({
      dataAccess,
      imageProcessor,
      imageUploader,
    });

    expect(imageProcessor).toHaveBeenCalledWith(
      expect.objectContaining({
        inputImagePaths: [
          '/processed/LIST-001/LIST-001_01.jpg',
          '/processed/LIST-001/LIST-001_02.jpg',
        ],
        outputDirectory: '/processed/LIST-001/.image-service-output/run-001',
        processingMode: 'strip_exif',
      })
    );
    expect(
      imageProcessor.mock.calls[0]?.[0]?.outputDirectory
    ).not.toBe('/processed/LIST-001');
  });

  it('saves uploaded image URLs and R2 object keys in processed image order', async () => {
    const { dataAccess, listingsUpdate } = createDataAccess([createListingRow()]);
    const imageProcessor = vi.fn(async () => createProcessedImagesResult());
    const imageUploader: R2ImageUploader = {
      uploadListingImages: vi.fn(async () => [
        {
          filename: 'LIST-001_02.jpg',
          objectKey: 'listings/list-001/back.jpg',
          publicUrl: 'https://cdn.example.com/back.jpg',
        },
        {
          filename: 'LIST-001_01.jpg',
          objectKey: 'listings/list-001/front.jpg',
          publicUrl: 'https://cdn.example.com/front.jpg',
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
        image_urls: ['https://cdn.example.com/front.jpg', 'https://cdn.example.com/back.jpg'],
        r2_object_keys: ['listings/list-001/front.jpg', 'listings/list-001/back.jpg'],
      })
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

  it('does not move listing to assets_ready if R2 upload fails', async () => {
    const { dataAccess, listingStates } = createDataAccess([createListingRow()]);
    const imageProcessor = vi.fn(async () => createProcessedImagesResult());
    const imageUploader: R2ImageUploader = {
      uploadListingImages: vi.fn(async () => {
        throw new Error('upload failed');
      }),
    };

    const result = await runStep({
      dataAccess,
      imageProcessor,
      imageUploader,
    });

    expect(result.processed).toEqual([]);
    expect(result.failed).toEqual([
      expect.objectContaining({
        errorCode: 'record_created_r2_upload_failed',
        listingId: 'LIST-001',
      }),
    ]);
    expect(listingStates.get('LIST-001')?.status).toBe('record_created');
    expect(listingStates.get('LIST-001')?.last_error_code).toBe('record_created_r2_upload_failed');
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
          objectKey: 'listings/list-001/front.jpg',
          publicUrl: 'https://cdn.example.com/front.jpg',
        },
        {
          filename: 'LIST-001_02.jpg',
          objectKey: 'listings/list-001/back.jpg',
          publicUrl: 'https://cdn.example.com/back.jpg',
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
      1,
      'LIST-001',
      expect.objectContaining({
        image_urls: ['https://cdn.example.com/front.jpg', 'https://cdn.example.com/back.jpg'],
        r2_object_keys: ['listings/list-001/front.jpg', 'listings/list-001/back.jpg'],
        status: 'assets_ready',
        sub_status: 'ready_to_generate',
      })
    );
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

  it('handles pre-populated asset fields safely without duplicating data', async () => {
    const { dataAccess, listingStates } = createDataAccess([
      createListingRow({
        image_urls: ['https://cdn.example.com/front.jpg'],
        r2_object_keys: ['listings/list-001/front.jpg'],
      }),
    ]);
    const imageProcessor = vi.fn(async () => createProcessedImagesResult());
    const imageUploader: R2ImageUploader = {
      uploadListingImages: vi.fn(async () => []),
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
    expect(imageProcessor).not.toHaveBeenCalled();
    expect(imageUploader.uploadListingImages).not.toHaveBeenCalled();
    expect(listingStates.get('LIST-001')?.status).toBe('record_created');
    expect(listingStates.get('LIST-001')?.last_error_code).toBe(
      'record_created_asset_state_conflict'
    );
  });
});
