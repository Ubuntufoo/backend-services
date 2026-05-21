import { createWatcherListingIdRepository, type WatcherListingIdRepository } from './data/index.js';
import type { WatcherCaptureMode } from './config/capture-modes.js';

export const LISTING_ID_SEQUENCE_WIDTH = 6;

export type ListingIdPrefix = 'Single' | 'Lot';

export const LISTING_ID_PREFIX_BY_CAPTURE_MODE = {
  lot_3_image: 'Lot',
  single_2_image: 'Single',
} as const satisfies Record<WatcherCaptureMode, ListingIdPrefix>;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function getListingIdPrefixForCaptureMode(captureMode: WatcherCaptureMode): ListingIdPrefix {
  return LISTING_ID_PREFIX_BY_CAPTURE_MODE[captureMode];
}

export function formatListingId(prefix: ListingIdPrefix, sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error(`Listing ID sequence must be a positive integer. Received: ${sequence}.`);
  }

  return `${prefix}-${String(sequence).padStart(LISTING_ID_SEQUENCE_WIDTH, '0')}`;
}

export function parseListingId(value: string, prefix: ListingIdPrefix): number {
  const match = new RegExp(`^${escapeRegExp(prefix)}-(\\d{${LISTING_ID_SEQUENCE_WIDTH}})$`).exec(
    value
  );

  if (!match) {
    throw new Error(
      `Invalid listing_id "${value}" for prefix "${prefix}". Expected format: ${prefix}-${'0'.repeat(
        LISTING_ID_SEQUENCE_WIDTH
      )}.`
    );
  }

  return Number.parseInt(match[1], 10);
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
