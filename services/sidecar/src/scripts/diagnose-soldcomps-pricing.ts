#!/usr/bin/env node

import { getPricingProviderMode } from '@ebay-inventory/data';
import { loadSoldCompsPricingEnv, EnvValidationError } from '@ebay-inventory/env';

import { resolve } from 'path';
import { fileURLToPath } from 'url';

import { loadRootEnvironment } from '@/config/env-paths.js';
import { createSidecarDataAccess, type SidecarDataAccess } from '@/data/sidecar-data.js';
import { SOLDCOMPS_SOLD_COMP_REQUEST_COUNT } from '@/pricing/index.js';

interface StreamCapture {
  restore(): void;
}

interface DiagnoseSoldCompsPricingCliDependencies {
  createDataAccess?: () => Pick<SidecarDataAccess, 'appSettings'>;
}

type DiagnosticCheckStatus = 'pass' | 'fail';

interface DiagnosticCheck {
  details: Record<string, unknown>;
  message: string;
  name:
    | 'selected_provider_mode'
    | 'soldcomps_api_key'
    | 'soldcomps_price_timeout_seconds'
    | 'soldcomps_request_count';
  status: DiagnosticCheckStatus;
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

function redactSecret(value: string): string {
  return `[redacted:${Math.min(value.trim().length, 8)}chars]`;
}

function buildCheck(
  name: DiagnosticCheck['name'],
  status: DiagnosticCheckStatus,
  message: string,
  details: Record<string, unknown> = {}
): DiagnosticCheck {
  return {
    details,
    message,
    name,
    status,
  };
}

function findIssueMessage(error: EnvValidationError, key: string, fallback: string): string {
  const issue = error.issues.find((entry) => entry.path[0] === key);
  return issue?.message ?? fallback;
}

export async function runDiagnoseSoldCompsPricingCli(
  dependencies: DiagnoseSoldCompsPricingCliDependencies = {}
): Promise<void> {
  const capture = createStreamCapture();
  loadRootEnvironment();

  try {
    const dataAccess = dependencies.createDataAccess?.() ?? createSidecarDataAccess(process.env);
    const appSettings = await dataAccess.appSettings.get();
    const selectedProviderMode = getPricingProviderMode(appSettings);
    const checks: DiagnosticCheck[] = [
      buildCheck(
        'selected_provider_mode',
        selectedProviderMode === 'soldcomps' ? 'pass' : 'fail',
        selectedProviderMode === 'soldcomps'
          ? 'Persisted pricing_provider_mode resolves to soldcomps.'
          : `Persisted pricing_provider_mode currently resolves to "${selectedProviderMode}".`,
        {
          value: selectedProviderMode,
        }
      ),
    ];

    try {
      const env = loadSoldCompsPricingEnv({
        env: process.env,
      });

      checks.push(
        buildCheck('soldcomps_api_key', 'pass', 'SOLDCOMPS_API_KEY configured.', {
          configured: true,
          redacted: redactSecret(env.SOLDCOMPS_API_KEY),
        }),
        buildCheck(
          'soldcomps_price_timeout_seconds',
          'pass',
          'SOLDCOMPS_PRICE_TIMEOUT_SECONDS valid.',
          {
            value: Number(env.SOLDCOMPS_PRICE_TIMEOUT_SECONDS),
          }
        )
      );
    } catch (error) {
      if (!(error instanceof EnvValidationError)) {
        throw error;
      }

      const apiKeyIssue = error.issues.some((issue) => issue.path[0] === 'SOLDCOMPS_API_KEY');
      const timeoutIssue = error.issues.some(
        (issue) => issue.path[0] === 'SOLDCOMPS_PRICE_TIMEOUT_SECONDS'
      );

      checks.push(
        buildCheck(
          'soldcomps_api_key',
          apiKeyIssue ? 'fail' : 'pass',
          apiKeyIssue
            ? findIssueMessage(error, 'SOLDCOMPS_API_KEY', 'SOLDCOMPS_API_KEY is required.')
            : 'SOLDCOMPS_API_KEY configured.',
          {
            configured: apiKeyIssue ? false : typeof process.env.SOLDCOMPS_API_KEY === 'string',
            redacted:
              typeof process.env.SOLDCOMPS_API_KEY === 'string' &&
              process.env.SOLDCOMPS_API_KEY.trim().length > 0
                ? redactSecret(process.env.SOLDCOMPS_API_KEY)
                : null,
          }
        ),
        buildCheck(
          'soldcomps_price_timeout_seconds',
          timeoutIssue ? 'fail' : 'pass',
          timeoutIssue
            ? findIssueMessage(
                error,
                'SOLDCOMPS_PRICE_TIMEOUT_SECONDS',
                'SOLDCOMPS_PRICE_TIMEOUT_SECONDS invalid.'
              )
            : 'SOLDCOMPS_PRICE_TIMEOUT_SECONDS valid.',
          {
            value:
              typeof process.env.SOLDCOMPS_PRICE_TIMEOUT_SECONDS === 'string' &&
              process.env.SOLDCOMPS_PRICE_TIMEOUT_SECONDS.trim().length > 0
                ? process.env.SOLDCOMPS_PRICE_TIMEOUT_SECONDS.trim()
                : 120,
          }
        )
      );
    }

    checks.push(
      buildCheck(
        'soldcomps_request_count',
        'pass',
        'SoldComps live path requests canonical 50 comps.',
        {
          value: SOLDCOMPS_SOLD_COMP_REQUEST_COUNT,
        }
      )
    );

    const overallStatus = checks.some((check) => check.status === 'fail') ? 'fail' : 'pass';

    capture.restore();
    console.log(
      JSON.stringify(
        {
          checkedAt: new Date().toISOString(),
          checks,
          overallStatus,
          requestedCompCount: SOLDCOMPS_SOLD_COMP_REQUEST_COUNT,
          selectedProviderMode,
        },
        null,
        2
      )
    );

    if (overallStatus === 'fail') {
      process.exitCode = 1;
    }
  } catch (error) {
    capture.restore();
    console.log(
      JSON.stringify(
        {
          checkedAt: new Date().toISOString(),
          checks: [
            buildCheck(
              'selected_provider_mode',
              'fail',
              error instanceof Error ? error.message : String(error)
            ),
          ],
          overallStatus: 'fail',
          requestedCompCount: SOLDCOMPS_SOLD_COMP_REQUEST_COUNT,
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
  await runDiagnoseSoldCompsPricingCli();
}
