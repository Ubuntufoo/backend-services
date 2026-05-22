import { afterEach, describe, expect, it, vi } from 'vitest';

const singleMock = vi.fn();
const selectMock = vi.fn(() => ({ single: singleMock }));
const insertMock = vi.fn(() => ({ select: selectMock }));
const deleteEqMock = vi.fn(async () => ({ error: null }));
const deleteMock = vi.fn(() => ({ eq: deleteEqMock }));
const fromMock = vi.fn(() => ({ delete: deleteMock, insert: insertMock }));
const createSupabaseServiceClientMock = vi.fn(() => ({ from: fromMock }));
const enqueueProcessImagesJobMock = vi.fn();

vi.mock('@ebay-inventory/data', () => ({
  createSupabaseServiceClient: createSupabaseServiceClientMock,
  enqueueProcessImagesJob: enqueueProcessImagesJobMock,
}));

describe('watcher listing repository', () => {
  afterEach(() => {
    vi.clearAllMocks();
    singleMock.mockReset();
    enqueueProcessImagesJobMock.mockReset();
    deleteEqMock.mockReset();
    deleteEqMock.mockResolvedValue({ error: null });
  });

  it('creates watcher listing rows with processed image placeholders and enqueues process_images', async () => {
    const createdRow = {
      listing_id: 'Single-000123',
      capture_mode: 'single_2_image',
      status: 'record_created',
      sub_status: 'idle',
      image_urls: ['/processed/Single-000123/Single-000123_01.jpg'],
      listing_type: 'single',
    };
    singleMock.mockResolvedValueOnce({
      data: createdRow,
      error: null,
    });
    enqueueProcessImagesJobMock.mockResolvedValueOnce({
      alreadyQueued: false,
      job: { id: 'job-process-images' },
    });

    const { createWatcherListingRepository } = await import('../../../src/data/listings.js');
    const repository = createWatcherListingRepository();

    await expect(
      repository.createWatcherListing({
        listingId: 'Single-000123',
        captureMode: 'single_2_image',
        images: [{ processedPath: '/processed/Single-000123/Single-000123_01.jpg' }],
      })
    ).resolves.toEqual(createdRow);

    expect(fromMock).toHaveBeenCalledWith('listings');
    expect(insertMock).toHaveBeenCalledWith({
      capture_mode: 'single_2_image',
      image_urls: ['/processed/Single-000123/Single-000123_01.jpg'],
      item_specifics: {},
      listing_id: 'Single-000123',
      listing_type: 'single',
      r2_object_keys: [],
      status: 'record_created',
      sub_status: 'idle',
    });
    expect(enqueueProcessImagesJobMock).toHaveBeenCalledWith(
      createSupabaseServiceClientMock.mock.results[0]?.value
    );
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('treats active process_images dedupe as success without cleanup', async () => {
    const createdRow = {
      listing_id: 'Single-000123',
      capture_mode: 'single_2_image',
      status: 'record_created',
      sub_status: 'idle',
      image_urls: ['/processed/Single-000123/Single-000123_01.jpg'],
      listing_type: 'single',
    };
    singleMock.mockResolvedValueOnce({
      data: createdRow,
      error: null,
    });
    enqueueProcessImagesJobMock.mockResolvedValueOnce({
      alreadyQueued: true,
      job: { id: 'job-process-images-active' },
    });

    const { createWatcherListingRepository } = await import('../../../src/data/listings.js');
    const repository = createWatcherListingRepository();

    await expect(
      repository.createWatcherListing({
        listingId: 'Single-000123',
        captureMode: 'single_2_image',
        images: [{ processedPath: '/processed/Single-000123/Single-000123_01.jpg' }],
      })
    ).resolves.toEqual(createdRow);

    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('deletes inserted listing and throws when process_images enqueue fails', async () => {
    const createdRow = {
      listing_id: 'Single-000123',
      capture_mode: 'single_2_image',
      status: 'record_created',
      sub_status: 'idle',
      image_urls: ['/processed/Single-000123/Single-000123_01.jpg'],
      listing_type: 'single',
    };
    singleMock.mockResolvedValueOnce({
      data: createdRow,
      error: null,
    });
    enqueueProcessImagesJobMock.mockRejectedValueOnce(new Error('queue offline'));

    const { WatcherListingRepositoryError, createWatcherListingRepository } = await import(
      '../../../src/data/listings.js'
    );
    const repository = createWatcherListingRepository();

    await expect(
      repository.createWatcherListing({
        listingId: 'Single-000123',
        captureMode: 'single_2_image',
        images: [{ processedPath: '/processed/Single-000123/Single-000123_01.jpg' }],
      })
    ).rejects.toBeInstanceOf(WatcherListingRepositoryError);

    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(deleteEqMock).toHaveBeenCalledWith('listing_id', 'Single-000123');
  });

  it('preserves unique violation metadata for collision retry logic', async () => {
    singleMock.mockResolvedValueOnce({
      data: null,
      error: {
        code: '23505',
        message: 'duplicate key value violates unique constraint "listings_listing_id_key"',
      },
    });

    const {
      WatcherListingRepositoryError,
      createWatcherListingRepository,
      isUniqueViolation,
      isWatcherListingIdUniqueViolation,
    } = await import('../../../src/data/listings.js');
    const repository = createWatcherListingRepository();

    try {
      await repository.createWatcherListing({
        listingId: 'Single-000123',
        captureMode: 'single_2_image',
        images: [{ processedPath: '/processed/Single-000123/Single-000123_01.jpg' }],
      });
      throw new Error('expected createWatcherListing to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(WatcherListingRepositoryError);
      expect(isUniqueViolation(error)).toBe(true);
      expect(isWatcherListingIdUniqueViolation(error)).toBe(true);
    }
  });

  it('does not classify non-listing unique violations as listing collisions', async () => {
    const { isWatcherListingIdUniqueViolation } = await import('../../../src/data/listings.js');

    expect(
      isWatcherListingIdUniqueViolation({
        code: '23505',
        message: 'duplicate key value violates unique constraint "jobs_generate_ai_active_listing_idx"',
      })
    ).toBe(false);
  });
});
