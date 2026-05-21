import { DEFAULT_APP_SETTINGS_ID } from '@ebay-inventory/data';
import { createWatcherAppSettingsRepository, type WatcherAppSettingsRepository } from '../data/index.js';
import {
  requireSupportedWatcherCaptureMode,
  type WatcherCaptureMode,
} from './capture-modes.js';

export async function getActiveWatcherCaptureMode(
  repository: Pick<WatcherAppSettingsRepository, 'get'> = createWatcherAppSettingsRepository()
): Promise<WatcherCaptureMode> {
  const appSettings = await repository.get(DEFAULT_APP_SETTINGS_ID);

  if (!appSettings) {
    throw new Error(`App settings "${DEFAULT_APP_SETTINGS_ID}" were not found.`);
  }

  return requireSupportedWatcherCaptureMode(appSettings.capture_mode);
}
