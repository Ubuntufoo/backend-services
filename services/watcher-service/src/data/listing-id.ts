import { createSupabaseServiceClient, type ListingRow } from '@ebay-inventory/data';

export interface WatcherListingIdRepository {
  getLatestByPrefix(prefix: 'Single' | 'Lot'): Promise<string | null>;
}

export function createWatcherListingIdRepository(
  env: NodeJS.ProcessEnv = process.env
): WatcherListingIdRepository {
  const client = createSupabaseServiceClient(env);

  return {
    getLatestByPrefix: async (prefix) => {
      const result = (await client
        .from('listings')
        .select('listing_id')
        .like('listing_id', `${prefix}-%`)
        .order('listing_id', { ascending: false })
        .limit(1)
        .maybeSingle()) as {
        data: Pick<ListingRow, 'listing_id'> | null;
        error: { message: string } | null;
      };

      if (result.error) {
        throw new Error(result.error.message);
      }

      return result.data?.listing_id ?? null;
    },
  };
}
