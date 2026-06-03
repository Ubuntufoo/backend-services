#!/usr/bin/env node

import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { EbaySellerApi } from '@/api/index.js';
import { getEbayConfig } from '@/config/environment.js';
import { loadRootEnvironment } from '@/config/env-paths.js';
import { loadEbayOAuthValidationConfig } from '@/ebay/config.js';
import {
  discoverLivePublishConfig,
  type LivePublishConfigDiscoveryError,
  type LivePublishConfigDiscoveryReport,
} from '@/ebay/live-publish-config-discovery.js';
import { validateEbayOAuth } from '@/ebay/validate-oauth.js';

loadRootEnvironment();

interface CapturedOutput {
  stdout: string[];
  stderr: string[];
}

function createStreamCapture() {
  const captured: CapturedOutput = {
    stdout: [],
    stderr: [],
  };

  let stdoutBuffer = '';
  let stderrBuffer = '';

  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

  const append = (target: 'stdout' | 'stderr', chunk: unknown) => {
    const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    if (target === 'stdout') {
      stdoutBuffer += text;
      const parts = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = parts.pop() ?? '';
      for (const part of parts) {
        if (part.trim()) {
          captured.stdout.push(part.trim());
        }
      }
      return;
    }

    stderrBuffer += text;
    const parts = stderrBuffer.split(/\r?\n/);
    stderrBuffer = parts.pop() ?? '';
    for (const part of parts) {
      if (part.trim()) {
        captured.stderr.push(part.trim());
      }
    }
  };

  process.stdout.write = ((chunk: unknown, encoding?: BufferEncoding | ((error?: Error | null) => void), cb?: (error?: Error | null) => void) => {
    append('stdout', chunk);
    if (typeof encoding === 'function') {
      encoding();
    } else if (typeof cb === 'function') {
      cb();
    }
    return true;
  }) as typeof process.stdout.write;

  process.stderr.write = ((chunk: unknown, encoding?: BufferEncoding | ((error?: Error | null) => void), cb?: (error?: Error | null) => void) => {
    append('stderr', chunk);
    if (typeof encoding === 'function') {
      encoding();
    } else if (typeof cb === 'function') {
      cb();
    }
    return true;
  }) as typeof process.stderr.write;

  return {
    captured,
    restore() {
      if (stdoutBuffer.trim()) {
        captured.stdout.push(stdoutBuffer.trim());
      }
      if (stderrBuffer.trim()) {
        captured.stderr.push(stderrBuffer.trim());
      }
      process.stdout.write = originalStdoutWrite;
      process.stderr.write = originalStderrWrite;
    },
  };
}

function sanitizeCapturedLine(line: string, sensitiveValues: string[]): string {
  let sanitized = line;

  for (const value of sensitiveValues) {
    if (value) {
      sanitized = sanitized.split(value).join('[REDACTED]');
    }
  }

  sanitized = sanitized.replace(/Authorization["']?\s*[:=]\s*["']?/gi, '');
  sanitized = sanitized.replace(/\bBasic\s+[A-Za-z0-9._~+/=-]+\b/gi, 'Basic [REDACTED]');
  sanitized = sanitized.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+\b/gi, 'Bearer [REDACTED]');

  return sanitized;
}

function getSensitiveValuesForLogs(
  runtimeConfig: ReturnType<typeof getEbayConfig>,
  oauthConfig: ReturnType<typeof loadEbayOAuthValidationConfig>
): string[] {
  const values = [
    runtimeConfig.clientSecret,
    runtimeConfig.refreshToken,
    runtimeConfig.accessToken,
    runtimeConfig.appAccessToken,
    oauthConfig.clientSecret,
    oauthConfig.refreshToken,
    process.env.EBAY_CLIENT_SECRET,
    process.env.EBAY_REFRESH_TOKEN,
    process.env.EBAY_USER_REFRESH_TOKEN,
    process.env.EBAY_USER_ACCESS_TOKEN,
    process.env.EBAY_APP_ACCESS_TOKEN,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

  if (runtimeConfig.clientId && runtimeConfig.clientSecret) {
    values.push(Buffer.from(`${runtimeConfig.clientId}:${runtimeConfig.clientSecret}`).toString('base64'));
  }

  if (oauthConfig.clientId && oauthConfig.clientSecret) {
    values.push(Buffer.from(`${oauthConfig.clientId}:${oauthConfig.clientSecret}`).toString('base64'));
  }

  return [...new Set(values)];
}

function appendCapturedDiagnostics(
  report: LivePublishConfigDiscoveryReport,
  captured: CapturedOutput,
  sensitiveValues: string[]
): LivePublishConfigDiscoveryReport {
  if (report.overallStatus === 'ok') {
    return report;
  }

  const loggerErrors: LivePublishConfigDiscoveryError[] = [
    ...captured.stdout,
    ...captured.stderr,
  ]
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => ({
      family: 'logger' as const,
      message: sanitizeCapturedLine(line, sensitiveValues),
    }));

  if (loggerErrors.length === 0) {
    return report;
  }

  return {
    ...report,
    errors: [...report.errors, ...loggerErrors],
  };
}

function buildFailureReport(
  environment: string,
  marketplaceId: string,
  message: string,
  details?: Record<string, unknown>
): LivePublishConfigDiscoveryReport {
  return {
    environment,
    marketplaceId,
    apiBaseUrl: 'https://api.ebay.com',
    checkedAt: new Date().toISOString(),
    overallStatus: 'failed',
    paymentPolicies: [],
    fulfillmentPolicies: [],
    returnPolicies: [],
    inventoryLocations: [],
    errors: [
      {
        family: 'preflight',
        message,
        ...(details ? { details } : {}),
      },
    ],
  };
}

export async function runListLivePublishConfigCli(): Promise<void> {
  if (process.env.EBAY_ENVIRONMENT !== 'production') {
    console.log(
      JSON.stringify(
        buildFailureReport(
          process.env.EBAY_ENVIRONMENT ?? 'unknown',
          process.env.EBAY_MARKETPLACE_ID?.trim() || 'EBAY_US',
          'EBAY_ENVIRONMENT must be exactly "production".'
        ),
        null,
        2
      )
    );
    process.exitCode = 1;
    return;
  }

  const capture = createStreamCapture();

  try {
    const runtimeConfig = getEbayConfig();
    const oauthConfig = loadEbayOAuthValidationConfig(process.env);
    const api = new EbaySellerApi(runtimeConfig);
    const sensitiveValues = getSensitiveValuesForLogs(runtimeConfig, oauthConfig);

    const report = await discoverLivePublishConfig({
      api,
      oauthConfig,
      runtimeConfig,
      validateOAuth: validateEbayOAuth,
    });

    capture.restore();
    const finalReport = appendCapturedDiagnostics(report, capture.captured, sensitiveValues);
    console.log(JSON.stringify(finalReport, null, 2));

    if (finalReport.overallStatus !== 'ok') {
      process.exitCode = 1;
    }
  } catch (error) {
    const sensitiveValues: string[] = [
      process.env.EBAY_CLIENT_SECRET,
      process.env.EBAY_REFRESH_TOKEN,
      process.env.EBAY_USER_REFRESH_TOKEN,
      process.env.EBAY_USER_ACCESS_TOKEN,
      process.env.EBAY_APP_ACCESS_TOKEN,
    ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

    capture.restore();
    const report = appendCapturedDiagnostics(
      buildFailureReport(
        process.env.EBAY_ENVIRONMENT ?? 'unknown',
        process.env.EBAY_MARKETPLACE_ID?.trim() || 'EBAY_US',
        sanitizeCapturedLine(error instanceof Error ? error.message : String(error), sensitiveValues)
      ),
      capture.captured,
      sensitiveValues
    );
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = 1;
  }
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
const modulePath = resolve(fileURLToPath(import.meta.url));

if (entryPath && modulePath === entryPath) {
  runListLivePublishConfigCli().catch((error) => {
    const sensitiveValues: string[] = [
      process.env.EBAY_CLIENT_SECRET,
      process.env.EBAY_REFRESH_TOKEN,
      process.env.EBAY_USER_REFRESH_TOKEN,
      process.env.EBAY_USER_ACCESS_TOKEN,
      process.env.EBAY_APP_ACCESS_TOKEN,
    ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

    const report = buildFailureReport(
      process.env.EBAY_ENVIRONMENT ?? 'unknown',
      process.env.EBAY_MARKETPLACE_ID?.trim() || 'EBAY_US',
      sanitizeCapturedLine(error instanceof Error ? error.message : String(error), sensitiveValues)
    );
    console.log(
      JSON.stringify(
        report,
        null,
        2
      )
    );
    process.exitCode = 1;
  });
}
