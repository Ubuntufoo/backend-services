import { describe, expect, it } from 'vitest';
import { CAPTURE_MODES } from '../../../../../packages/types/build/index.js';
import {
  WATCHER_DEFAULT_BASE_DIRECTORY,
  WATCHER_DEFAULT_INCOMING_DIRECTORY,
  WATCHER_DEFAULT_PROCESSED_DIRECTORY,
  WATCHER_SUPPORTED_IMAGE_EXTENSIONS,
  createWatcherServiceConfig,
  isSupportedWatcherCaptureMode,
  isSupportedWatcherImageExtension,
  isSupportedWatcherImagePath,
  normalizeWatcherImageExtension,
  resolveAbsoluteWatcherPath,
  resolveWatcherChildPath,
} from '../../../src/index.js';

describe('watcher service config', () => {
  it('resolves default directories to absolute paths', () => {
    const config = createWatcherServiceConfig({ cwd: '/repo/services/watcher-service' });

    expect(config.baseDirectory).toBe('/repo/services/watcher-service/watcher');
    expect(config.incomingDirectory).toBe(
      '/repo/services/watcher-service/watcher/incoming'
    );
    expect(config.processedDirectory).toBe(
      '/repo/services/watcher-service/watcher/processed'
    );
  });

  it('uses env overrides and normalizes relative paths', () => {
    const config = createWatcherServiceConfig({
      cwd: '/repo/services/watcher-service',
      env: {
        WATCHER_BASE_DIR: './asset-watch',
        WATCHER_INCOMING_DIR: '../incoming-assets',
        WATCHER_PROCESSED_DIR: '/var/tmp/processed-assets',
      },
    });

    expect(config.baseDirectory).toBe('/repo/services/watcher-service/asset-watch');
    expect(config.incomingDirectory).toBe('/repo/services/incoming-assets');
    expect(config.processedDirectory).toBe('/var/tmp/processed-assets');
  });

  it('exposes the shared capture modes without duplication', () => {
    const config = createWatcherServiceConfig();

    expect(config.supportedCaptureModes).toBe(CAPTURE_MODES);
    expect(config.supportedCaptureModes).toEqual([
      'single_1_image',
      'single_2_image',
      'lot_3_image',
    ]);
    expect(isSupportedWatcherCaptureMode('single_1_image')).toBe(true);
    expect(isSupportedWatcherCaptureMode('not_a_mode')).toBe(false);
  });

  it('centralizes supported image extensions and file helpers', () => {
    expect(WATCHER_SUPPORTED_IMAGE_EXTENSIONS).toEqual([
      '.jpg',
      '.jpeg',
      '.png',
      '.webp',
    ]);
    expect(isSupportedWatcherImageExtension('.JPG')).toBe(true);
    expect(isSupportedWatcherImageExtension('.gif')).toBe(false);
    expect(normalizeWatcherImageExtension('/tmp/Photo.JPG')).toBe('.jpg');
    expect(isSupportedWatcherImagePath('/tmp/Photo.WEBP')).toBe(true);
    expect(isSupportedWatcherImagePath('/tmp/Photo.txt')).toBe(false);
  });

  it('keeps path helpers absolute and normalized', () => {
    expect(resolveAbsoluteWatcherPath('./incoming', '/repo/services/watcher-service')).toBe(
      '/repo/services/watcher-service/incoming'
    );
    expect(resolveWatcherChildPath('/repo/services/watcher-service/watcher', '../processed')).toBe(
      '/repo/services/watcher-service/processed'
    );
  });

  it('keeps the default directory constants available for future callers', () => {
    expect(WATCHER_DEFAULT_BASE_DIRECTORY).toBe('watcher');
    expect(WATCHER_DEFAULT_INCOMING_DIRECTORY).toBe('incoming');
    expect(WATCHER_DEFAULT_PROCESSED_DIRECTORY).toBe('processed');
  });
});
