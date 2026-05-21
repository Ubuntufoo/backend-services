import { afterEach, describe, expect, it, vi } from 'vitest';

describe('listing ID allocation', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('maps capture_mode to the Single prefix', async () => {
    const { getListingIdPrefixForCaptureMode } = await import('../../src/listing-id.js');

    expect(getListingIdPrefixForCaptureMode('single_2_image')).toBe('Single');
  });

  it('maps capture_mode to the Lot prefix', async () => {
    const { getListingIdPrefixForCaptureMode } = await import('../../src/listing-id.js');

    expect(getListingIdPrefixForCaptureMode('lot_3_image')).toBe('Lot');
  });

  it('generates the first Single listing ID from an empty state', async () => {
    const { allocateNextListingId } = await import('../../src/listing-id.js');
    const repository = {
      getLatestByPrefix: vi.fn(async () => null),
    };

    await expect(allocateNextListingId('single_2_image', repository)).resolves.toBe(
      'Single-000001'
    );
    expect(repository.getLatestByPrefix).toHaveBeenCalledWith('Single');
  });

  it('generates the first Lot listing ID from an empty state', async () => {
    const { allocateNextListingId } = await import('../../src/listing-id.js');
    const repository = {
      getLatestByPrefix: vi.fn(async () => null),
    };

    await expect(allocateNextListingId('lot_3_image', repository)).resolves.toBe('Lot-000001');
    expect(repository.getLatestByPrefix).toHaveBeenCalledWith('Lot');
  });

  it('increments existing listing IDs correctly', async () => {
    const { allocateNextListingId } = await import('../../src/listing-id.js');
    const repository = {
      getLatestByPrefix: vi.fn(async () => 'Single-000041'),
    };

    await expect(allocateNextListingId('single_2_image', repository)).resolves.toBe(
      'Single-000042'
    );
  });

  it('preserves zero padding when incrementing', async () => {
    const { getNextListingIdFromLatest } = await import('../../src/listing-id.js');

    expect(getNextListingIdFromLatest('Lot', 'Lot-000999')).toBe('Lot-001000');
  });

  it('rejects malformed existing listing IDs', async () => {
    const { allocateNextListingId } = await import('../../src/listing-id.js');
    const repository = {
      getLatestByPrefix: vi.fn(async () => 'Single-42'),
    };

    await expect(allocateNextListingId('single_2_image', repository)).rejects.toThrow(
      'Invalid listing_id "Single-42" for prefix "Single".'
    );
  });
});
