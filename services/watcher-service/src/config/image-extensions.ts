import { extname } from 'node:path';

export const WATCHER_SUPPORTED_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'] as const;

export type WatcherSupportedImageExtension = (typeof WATCHER_SUPPORTED_IMAGE_EXTENSIONS)[number];

const WATCHER_SUPPORTED_IMAGE_EXTENSION_SET = new Set<WatcherSupportedImageExtension>(
  WATCHER_SUPPORTED_IMAGE_EXTENSIONS
);

export function normalizeWatcherImageExtension(filePath: string): string {
  return extname(filePath).toLowerCase();
}

export function isSupportedWatcherImageExtension(
  extension: string
): extension is WatcherSupportedImageExtension {
  return WATCHER_SUPPORTED_IMAGE_EXTENSION_SET.has(
    extension.toLowerCase() as WatcherSupportedImageExtension
  );
}

export function isSupportedWatcherImagePath(filePath: string): boolean {
  return isSupportedWatcherImageExtension(normalizeWatcherImageExtension(filePath));
}
