import { afterEach, describe, expect, it, vi } from 'vitest';

const maybeSingleMock = vi.fn();
const limitMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }));
const orderMock = vi.fn(() => ({ limit: limitMock }));
const likeMock = vi.fn(() => ({ order: orderMock }));
const selectMock = vi.fn(() => ({ like: likeMock }));
const fromMock = vi.fn(() => ({ select: selectMock }));
const createSupabaseServiceClientMock = vi.fn(() => ({ from: fromMock }));

vi.mock('@ebay-inventory/data', () => ({
  createSupabaseServiceClient: createSupabaseServiceClientMock,
}));

describe('watcher listing ID repository', () => {
  afterEach(() => {
    vi.clearAllMocks();
    maybeSingleMock.mockReset();
  });

  it('creates one shared client and queries the latest listing ID for a prefix', async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: { listing_id: 'Single-000123' },
      error: null,
    });

    const { createWatcherListingIdRepository } = await import('../../../src/data/listing-id.js');
    const env = {
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
      NEXT_PUBLIC_SUPABASE_URL: 'https://fmiliwxthjonjwywuqta.supabase.co',
      SUPABASE_PROJECT_REF: 'fmiliwxthjonjwywuqta',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    } as NodeJS.ProcessEnv;

    const repository = createWatcherListingIdRepository(env);

    await expect(repository.getLatestByPrefix('Single')).resolves.toBe('Single-000123');

    expect(createSupabaseServiceClientMock).toHaveBeenCalledWith(env);
    expect(fromMock).toHaveBeenCalledWith('listings');
    expect(selectMock).toHaveBeenCalledWith('listing_id');
    expect(likeMock).toHaveBeenCalledWith('listing_id', 'Single-%');
    expect(orderMock).toHaveBeenCalledWith('listing_id', { ascending: false });
    expect(limitMock).toHaveBeenCalledWith(1);
  });

  it('returns null when no listing exists for the prefix', async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    const { createWatcherListingIdRepository } = await import('../../../src/data/listing-id.js');
    const repository = createWatcherListingIdRepository();

    await expect(repository.getLatestByPrefix('Lot')).resolves.toBeNull();
  });

  it('throws when the latest listing ID lookup fails', async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'boom' },
    });

    const { createWatcherListingIdRepository } = await import('../../../src/data/listing-id.js');
    const repository = createWatcherListingIdRepository();

    await expect(repository.getLatestByPrefix('Single')).rejects.toThrow('boom');
  });
});
