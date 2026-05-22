#!/usr/bin/env node
import { loadDotenvFiles } from '@ebay-inventory/env';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startWatcherRuntime } from './watcher-runtime.js';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const ROOT_ENV_PATH = join(REPO_ROOT, '.env');
const ROOT_ENV_LOCAL_PATH = join(REPO_ROOT, '.env.local');

function loadRootEnvironment(): void {
  loadDotenvFiles([ROOT_ENV_PATH, ROOT_ENV_LOCAL_PATH]);
}

function logCliError(event: string, error: unknown, fields: Record<string, unknown> = {}): void {
  console.error(
    JSON.stringify({
      level: 'error',
      service: 'watcher-service',
      event,
      ...fields,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })
  );
}

async function main(): Promise<void> {
  loadRootEnvironment();

  const runtime = startWatcherRuntime();
  let shutdownPromise: Promise<void> | null = null;

  const shutdown = async (signal: 'SIGINT' | 'SIGTERM') => {
    if (shutdownPromise) {
      await shutdownPromise;
      return;
    }

    shutdownPromise = (async () => {
      await runtime.close();
    })();

    try {
      await shutdownPromise;
      process.exit(0);
    } catch (error) {
      logCliError('shutdown_failed', error, { signal });
      process.exit(1);
    }
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

main().catch((error) => {
  logCliError('startup_failed', error);
  process.exit(1);
});
