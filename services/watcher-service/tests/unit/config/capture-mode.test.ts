import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WatcherCaptureMode } from '../../../src/index.js';

const createRepository = (captureMode: WatcherCaptureMode | string | null) => ({
  get: vi.fn(async () =>
    captureMode === null
      ? null
      : ({
          capture_mode: captureMode,
        } as never)
  ),
});

describe('watcher capture mode loading', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns the active supported capture_mode', async () => {
    const { getActiveWatcherCaptureMode } = await import(
      '../../../src/config/capture-mode.js'
    );
    const repository = createRepository('single_2_image');

    await expect(getActiveWatcherCaptureMode(repository)).resolves.toBe('single_2_image');
  });

  it('rejects unsupported capture_mode values', async () => {
    const { getActiveWatcherCaptureMode } = await import(
      '../../../src/config/capture-mode.js'
    );
    const repository = createRepository('single_legacy_image');

    await expect(getActiveWatcherCaptureMode(repository)).rejects.toThrow(
      'Unsupported watcher capture_mode "single_legacy_image".'
    );
  });

  it('rejects missing app settings rows', async () => {
    const { getActiveWatcherCaptureMode } = await import(
      '../../../src/config/capture-mode.js'
    );
    const repository = createRepository(null);

    await expect(getActiveWatcherCaptureMode(repository)).rejects.toThrow(
      'App settings "default" were not found.'
    );
  });
});
