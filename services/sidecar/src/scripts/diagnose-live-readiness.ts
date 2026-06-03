#!/usr/bin/env node

import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { loadRootEnvironment } from '@/config/env-paths.js';
import {
  createUnexpectedLiveReadinessReport,
  getLiveReadinessDiagnostic,
} from '@/ebay/live-readiness-diagnostic.js';

function withSilencedConsoleError<T>(callback: () => T): T {
  const originalConsoleError = console.error;
  console.error = () => undefined;

  try {
    return callback();
  } finally {
    console.error = originalConsoleError;
  }
}

interface StreamCapture {
  restore(): void;
}

function createStreamCapture(): StreamCapture {
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

  const swallowStdoutWrite: typeof process.stdout.write = (chunk, encoding, cb) => {
    if (typeof encoding === 'function') {
      encoding();
    } else if (typeof cb === 'function') {
      cb();
    }
    return true;
  };

  const swallowStderrWrite: typeof process.stderr.write = (chunk, encoding, cb) => {
    if (typeof encoding === 'function') {
      encoding();
    } else if (typeof cb === 'function') {
      cb();
    }
    return true;
  };

  process.stdout.write = swallowStdoutWrite;
  process.stderr.write = swallowStderrWrite;

  return {
    restore() {
      process.stdout.write = originalStdoutWrite;
      process.stderr.write = originalStderrWrite;
    },
  };
}

export async function runDiagnoseLiveReadinessCli(): Promise<void> {
  const capture = createStreamCapture();
  loadRootEnvironment();

  try {
    const [{ EbaySellerApi }, { getEbayConfig }, { loadEbayOAuthValidationConfig }, { getSidecarDataAccess }] =
      await Promise.all([
        import('@/api/index.js'),
        import('@/config/environment.js'),
        import('@/ebay/config.js'),
        import('@/data/sidecar-data.js'),
      ]);

    const runtimeConfig = withSilencedConsoleError(() => getEbayConfig());
    const oauthConfig = loadEbayOAuthValidationConfig(process.env);
    const report = await getLiveReadinessDiagnostic({
      api: new EbaySellerApi(runtimeConfig),
      dataAccess: getSidecarDataAccess(),
      oauthConfig,
      runtimeConfig,
    });

    capture.restore();
    console.log(JSON.stringify(report, null, 2));

    if (report.overallStatus === 'blocked') {
      process.exitCode = 1;
    }
  } catch (error) {
    const report = createUnexpectedLiveReadinessReport({
      error,
      processEnv: process.env,
    });

    capture.restore();
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = 1;
  }
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
const modulePath = resolve(fileURLToPath(import.meta.url));

if (entryPath && modulePath === entryPath) {
  runDiagnoseLiveReadinessCli().catch((error) => {
    const report = createUnexpectedLiveReadinessReport({
      error,
      processEnv: process.env,
    });

    console.log(JSON.stringify(report, null, 2));
    process.exitCode = 1;
  });
}
