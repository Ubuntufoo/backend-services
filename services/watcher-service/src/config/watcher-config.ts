import { WATCHER_CAPTURE_MODES, type WatcherCaptureMode } from './capture-modes.js';
import {
  WATCHER_SUPPORTED_IMAGE_EXTENSIONS,
  type WatcherSupportedImageExtension,
} from './image-extensions.js';
import { resolveAbsoluteWatcherPath, resolveWatcherPathWithin } from './paths.js';

export const WATCHER_SERVICE_ENV_VARS = {
  baseDirectory: 'WATCHER_BASE_DIR',
  incomingDirectory: 'WATCHER_INCOMING_DIR',
  processedDirectory: 'WATCHER_PROCESSED_DIR',
} as const;

export const WATCHER_DEFAULT_BASE_DIRECTORY = 'watcher';
export const WATCHER_DEFAULT_INCOMING_DIRECTORY = 'incoming';
export const WATCHER_DEFAULT_PROCESSED_DIRECTORY = 'processed';

export interface WatcherServiceConfigEnvironment {
  WATCHER_BASE_DIR?: string;
  WATCHER_INCOMING_DIR?: string;
  WATCHER_PROCESSED_DIR?: string;
}

export interface WatcherServiceConfigInput {
  env?: WatcherServiceConfigEnvironment;
  cwd?: string;
}

export interface WatcherServiceConfig {
  baseDirectory: string;
  incomingDirectory: string;
  processedDirectory: string;
  supportedCaptureModes: readonly WatcherCaptureMode[];
  supportedImageExtensions: readonly WatcherSupportedImageExtension[];
}

function resolveConfiguredDirectory(
  pathValue: string | undefined,
  defaultPath: string,
  cwd: string
): string {
  return pathValue ? resolveAbsoluteWatcherPath(pathValue, cwd) : resolveAbsoluteWatcherPath(defaultPath, cwd);
}

export function createWatcherServiceConfig(
  input: WatcherServiceConfigInput = {}
): WatcherServiceConfig {
  const env = input.env ?? process.env;
  const cwd = input.cwd ?? process.cwd();

  const baseDirectory = resolveConfiguredDirectory(
    env.WATCHER_BASE_DIR,
    WATCHER_DEFAULT_BASE_DIRECTORY,
    cwd
  );
  const incomingDirectory = env.WATCHER_INCOMING_DIR
    ? resolveAbsoluteWatcherPath(env.WATCHER_INCOMING_DIR, cwd)
    : resolveWatcherPathWithin(baseDirectory, WATCHER_DEFAULT_INCOMING_DIRECTORY);
  const processedDirectory = env.WATCHER_PROCESSED_DIR
    ? resolveAbsoluteWatcherPath(env.WATCHER_PROCESSED_DIR, cwd)
    : resolveWatcherPathWithin(baseDirectory, WATCHER_DEFAULT_PROCESSED_DIRECTORY);

  return {
    baseDirectory,
    incomingDirectory,
    processedDirectory,
    supportedCaptureModes: WATCHER_CAPTURE_MODES,
    supportedImageExtensions: WATCHER_SUPPORTED_IMAGE_EXTENSIONS,
  };
}
