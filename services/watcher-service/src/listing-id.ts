import { formatBaseSku, parseBaseSku, SKU_SEQUENCE_WIDTH, type SkuListingType } from '@ebay-inventory/types';
import { createWatcherListingIdRepository, type WatcherListingIdRepository } from './data/index.js';
import type { WatcherCaptureMode } from './config/capture-modes.js';

export const LISTING_ID_SEQUENCE_WIDTH = SKU_SEQUENCE_WIDTH;

export type ListingIdPrefix = SkuListingType;

export const LISTING_ID_PREFIX_BY_CAPTURE_MODE = {
  lot_3_image: 'Lot',
  single_2_image: 'Single',
} as const satisfies Record<WatcherCaptureMode, ListingIdPrefix>;

export function getListingIdPrefixForCaptureMode(captureMode: WatcherCaptureMode): ListingIdPrefix {
  return LISTING_ID_PREFIX_BY_CAPTURE_MODE[captureMode];
}

export function formatListingId(prefix: ListingIdPrefix, sequence: number): string {
  return formatBaseSku(prefix, sequence);
}

export function parseListingId(value: string, prefix: ListingIdPrefix): number {
  let parsed;

  try {
    parsed = parseBaseSku(value);
  } catch {
    throw new Error(
      `Invalid listing_id "${value}" for prefix "${prefix}". Expected format: ${prefix}-${'0'.repeat(
        LISTING_ID_SEQUENCE_WIDTH
      )}.`
    );
  }

  if (parsed.listingType !== prefix) {
    throw new Error(
      `Invalid listing_id "${value}" for prefix "${prefix}". Expected format: ${prefix}-${'0'.repeat(
        LISTING_ID_SEQUENCE_WIDTH
      )}.`
    );
  }

  return Number.parseInt(parsed.sequence, 10);
}

export function getNextListingIdFromLatest(
  prefix: ListingIdPrefix,
  latestListingId: string | null
): string {
  if (latestListingId === null) {
    return formatListingId(prefix, 1);
  }

  return formatListingId(prefix, parseListingId(latestListingId, prefix) + 1);
}

export async function allocateNextListingId(
  captureMode: WatcherCaptureMode,
  repository: Pick<WatcherListingIdRepository, 'getLatestByPrefix'> = createWatcherListingIdRepository()
): Promise<string> {
  const prefix = getListingIdPrefixForCaptureMode(captureMode);
  const latestListingId = await repository.getLatestByPrefix(prefix);

  return getNextListingIdFromLatest(prefix, latestListingId);
}
