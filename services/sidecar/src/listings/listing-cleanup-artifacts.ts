import { rm } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve } from 'node:path';

export class ListingCleanupConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ListingCleanupConfigurationError';
  }
}

export function normalizeExactR2ObjectKeys(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value
        .filter((key): key is string => typeof key === 'string')
        .map((key) => key.trim())
        .filter((key) => key.length > 0)
    ),
  ];
}

function readAbsoluteDirectory(value: string | null | undefined, source: string): string | null {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  if (!isAbsolute(trimmed)) {
    throw new ListingCleanupConfigurationError(`${source} must be an absolute path.`);
  }

  return resolve(trimmed);
}

export function resolveListingCleanupProcessedRoot(input: {
  appSettingsProcessedRoot: string | null | undefined;
  env: NodeJS.ProcessEnv;
}): string {
  const envRoot = readAbsoluteDirectory(input.env.WATCHER_PROCESSED_DIR, 'WATCHER_PROCESSED_DIR');
  const appSettingsRoot = readAbsoluteDirectory(
    input.appSettingsProcessedRoot,
    'app_settings.processed_folder_path'
  );

  if (envRoot && appSettingsRoot && envRoot !== appSettingsRoot) {
    throw new ListingCleanupConfigurationError(
      'WATCHER_PROCESSED_DIR conflicts with app_settings.processed_folder_path.'
    );
  }

  const processedRoot = envRoot ?? appSettingsRoot;

  if (!processedRoot) {
    throw new ListingCleanupConfigurationError(
      'An absolute watcher processed directory is required.'
    );
  }

  return processedRoot;
}

export function resolveListingCleanupWatcherDirectory(
  processedRoot: string,
  listingId: string
): string {
  const resolvedRoot = resolve(processedRoot);
  const target = resolve(resolvedRoot, listingId);
  const relativeTarget = relative(resolvedRoot, target);

  if (
    relativeTarget.length === 0 ||
    relativeTarget.startsWith('..') ||
    isAbsolute(relativeTarget) ||
    basename(target) !== listingId
  ) {
    throw new ListingCleanupConfigurationError(
      `Watcher directory for listing "${listingId}" is not safely contained by the processed root.`
    );
  }

  return target;
}

export async function removeListingCleanupWatcherDirectory(
  processedRoot: string,
  listingId: string
): Promise<void> {
  await rm(resolveListingCleanupWatcherDirectory(processedRoot, listingId), {
    force: true,
    recursive: true,
  });
}
