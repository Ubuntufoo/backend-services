import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Load existing key/value config from the project .env file.
 */
export function loadExistingConfig(projectRoot: string): Record<string, string> {
  const envPath = join(projectRoot, '.env');
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
