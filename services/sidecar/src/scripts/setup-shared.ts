import { existsSync, readFileSync } from 'fs';
import { ROOT_ENV_PATH } from '@/config/env-paths.js';

/**
 * Load existing key/value config from the canonical repo-root .env file.
 */
export function loadExistingConfig(envPath = ROOT_ENV_PATH): Record<string, string> {
  const envConfig: Record<string, string> = {};

  if (!existsSync(envPath)) {
    return envConfig;
  }

  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    const [rawKey, ...valueParts] = line.split('=');
    const key = rawKey?.trim();
    const value = valueParts.join('=').trim();
    if (key && value && !value.includes('_here')) {
      envConfig[key] = value;
    }
  }

  return envConfig;
}

/**
 * Parse environment with safe sandbox default.
 */
export function readEnvironment(value?: string): 'sandbox' | 'production' {
  return value === 'production' ? 'production' : 'sandbox';
}
