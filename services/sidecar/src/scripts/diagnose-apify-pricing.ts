#!/usr/bin/env node

import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { loadRootEnvironment } from '@/config/env-paths.js';
import { getApifyPricingDiagnostic } from '@/pricing/index.js';

interface StreamCapture {
  restore(): void;
}

function createStreamCapture(): StreamCapture {
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  const swallowStdoutWrite: typeof process.stdout.write = (..._args) => true;
  const swallowStderrWrite: typeof process.stderr.write = (..._args) => true;

  process.stdout.write = swallowStdoutWrite;
  process.stderr.write = swallowStderrWrite;

  return {
    restore() {
      process.stdout.write = originalStdoutWrite;
      process.stderr.write = originalStderrWrite;
    },
  };
}

export async function runDiagnoseApifyPricingCli(): Promise<void> {
  const capture = createStreamCapture();
  loadRootEnvironment();

  try {
    const report = await getApifyPricingDiagnostic(process.env);
    capture.restore();
    console.log(JSON.stringify(report, null, 2));

    if (report.overallStatus === 'fail') {
      process.exitCode = 1;
    }
  } catch (error) {
    capture.restore();
    console.log(
      JSON.stringify(
        {
          checkedAt: new Date().toISOString(),
          checks: [
            {
              details: {},
              message: error instanceof Error ? error.message : String(error),
              name: 'apify_enabled',
              status: 'fail',
            },
          ],
          enabled: process.env.APIFY_ENABLED === 'true',
          metadata: {
            actor: null,
            attempted: false,
          },
          overallStatus: 'fail',
        },
        null,
        2
      )
    );
    process.exitCode = 1;
  }
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
const modulePath = resolve(fileURLToPath(import.meta.url));

if (entryPath && modulePath === entryPath) {
  await runDiagnoseApifyPricingCli();
}
