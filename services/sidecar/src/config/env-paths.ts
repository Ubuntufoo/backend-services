import { loadDotenvFiles } from '@ebay-inventory/env';
import { join } from 'path';
import { fileURLToPath } from 'url';

export const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
export const SIDECAR_PACKAGE_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const ROOT_ENV_LOCAL_PATH = join(REPO_ROOT, '.env.local');
export const ROOT_ENV_EXAMPLE_PATH = join(REPO_ROOT, 'env.example');

export function loadRootEnvironment(): void {
  loadDotenvFiles([ROOT_ENV_LOCAL_PATH]);
}
