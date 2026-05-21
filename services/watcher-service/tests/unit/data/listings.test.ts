import { afterEach, describe, expect, it, vi } from 'vitest';

const singleMock = vi.fn();
const selectMock = vi.fn(() => ({ single: singleMock }));
const insertMock = vi.fn(() => ({ select: selectMock }));
const fromMock = vi.fn(() => ({ insert: insertMock }));
const createSupabaseServiceClientMock = vi.fn(() => ({ from: fromMock }));

vi.mock('@ebay-inventory/data', () => ({
  createSupabaseServiceClient: createSupabaseServiceClientMock,
}));

describe('watcher listing repository', () => {
  afterEach(() => {
    vi.clearAllMocks();
    singleMock.mockReset();
  });

  it('creates watcher listing rows with processed image placeholders', async () => {
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
