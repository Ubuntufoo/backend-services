import { existsSync, readFileSync } from 'fs';
import { ROOT_ENV_LOCAL_PATH } from '@/config/env-paths.js';

/**
 * Load existing key/value config from the canonical repo-root .env.local file.
 */
export function loadExistingConfig(): Record<string, string> {
  const envPath = ROOT_ENV_LOCAL_PATH;
  const envConfig: Record<string, string> = {};

  if (!existsSync(envPath)) {
    return envConfig;
  }

  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    if (line.trim() && !line.startsWith('#')) {
      const [key, ...valueParts] = line.split('=');
      const value = valueParts.join('=').trim();
      if (key && value && !value.includes('_here')) {
        envConfig[key.trim()] = value;
      }
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
