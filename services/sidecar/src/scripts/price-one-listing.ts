#!/usr/bin/env node

import { resolve } from 'path';
import { fileURLToPath } from 'url';

import { loadRootEnvironment } from '@/config/env-paths.js';
import { createSidecarDataAccess, type SidecarDataAccess } from '@/data/sidecar-data.js';
import { JOB_ERROR_CODES } from '@/jobs/job-errors.js';
import {
  priceListingNow,
  type PriceListingNowOptions,
  type PriceListingNowResult,
  type ResearchPriceJobDependencies,
} from '@/jobs/research-price-job.js';
import {
  createApifyPricingProvider,
  parseRuntimeApifyConfig,
  redactSensitiveText,
  type ApifyPricingProviderConfig,
  type PricingProvider,
} from '@/pricing/index.js';

interface StreamCapture {
  restore(): void;
}

interface PriceOneListingCliDependencies {
  createDataAccess?: () => Pick<SidecarDataAccess, 'appSettings' | 'listingPriceResearch' | 'listings'>;
  createProvider?: (config: ApifyPricingProviderConfig) => PricingProvider;
  runPriceListingNow?: (
    listingId: string,
    dependencies: ResearchPriceJobDependencies,
    options: PriceListingNowOptions
  ) => Promise<PriceListingNowResult>;
}

interface ParsedArgsSuccess {
  listingId: string;
  ok: true;
}

interface ParsedArgsFailure {
  code: 'invalid_arguments';
  message: string;
  ok: false;
}

type ParsedArgs = ParsedArgsFailure | ParsedArgsSuccess;

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

function parseNonEmptyValue(value: string | undefined, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} requires a non-empty value.`);
  }

  return value.trim();
}

function buildUsage(): { command: string; selectors: string[] } {
  return {
    command: 'pnpm pricing:price-one -- --listing-id <listing_id>',
    selectors: ['--listing-id <listing_id>'],
  };
}

function parseArgs(argv: string[]): ParsedArgs {
  const normalizedArgv = argv[0] === '--' ? argv.slice(1) : argv;
  const listingIds: string[] = [];

  for (let index = 0; index < normalizedArgv.length; index += 1) {
    const current = normalizedArgv[index];

    if (current === '--listing-id') {
      try {
        listingIds.push(parseNonEmptyValue(normalizedArgv[index + 1], '--listing-id'));
      } catch (error) {
        return {
          code: 'invalid_arguments',
          message: error instanceof Error ? error.message : String(error),
          ok: false,
        };
      }
      index += 1;
      continue;
    }

    return {
      code: 'invalid_arguments',
      message: `Unknown argument: ${current}`,
      ok: false,
    };
  }

  if (listingIds.length === 0) {
    return {
      code: 'invalid_arguments',
      message: 'Exactly one --listing-id required.',
      ok: false,
    };
  }

  if (listingIds.length > 1) {
    return {
      code: 'invalid_arguments',
      message: 'Multiple --listing-id selectors supplied.',
      ok: false,
    };
  }

  return {
    listingId: listingIds[0],
    ok: true,
  };
}

function buildConfigFailurePayload(checkName: string, message: string): Record<string, unknown> {
  return {
    failure: {
      category: 'auth_config',
      code: checkName,
      message: redactSensitiveText(message),
    },
    overallStatus: 'fail',
    provider: 'apify',
  };
}

function buildProviderConfig(env: NodeJS.ProcessEnv): ApifyPricingProviderConfig {
  const config = parseRuntimeApifyConfig(env);

  if (!config.enabled) {
    throw buildConfigFailurePayload('apify_enabled', 'APIFY_ENABLED=true required.');
  }

  if (!config.token) {
    throw buildConfigFailurePayload('apify_token', 'APIFY_TOKEN required when APIFY_ENABLED=true.');
  }

  if (!config.actorId) {
    throw buildConfigFailurePayload(
      'apify_actor_id',
      'APIFY_PRICE_ACTOR_ID required when APIFY_ENABLED=true.'
    );
  }

  if (config.timeoutSeconds.value === null) {
    throw buildConfigFailurePayload(
      'apify_price_timeout_seconds',
      config.timeoutSeconds.issues[0] ?? 'APIFY_PRICE_TIMEOUT_SECONDS invalid.'
    );
  }

  return {
    actorId: config.actorId,
    timeoutSeconds: config.timeoutSeconds.value,
    token: config.token,
  };
}

function toFailurePayload(error: unknown, listingId?: string): Record<string, unknown> {
  const errorRecord = typeof error === 'object' && error !== null ? error : {};
  const provider =
    typeof (errorRecord as { provider?: unknown }).provider === 'string'
      ? ((errorRecord as { provider: string }).provider ?? 'apify')
      : 'apify';
  const category =
    typeof (errorRecord as { category?: unknown }).category === 'string'
      ? (errorRecord as { category: string }).category
      : undefined;
  const code =
    typeof (errorRecord as { code?: unknown }).code === 'string'
      ? (errorRecord as { code: string }).code
      : undefined;
  const query =
    typeof (errorRecord as { context?: { query?: unknown }; query?: unknown }).query === 'string'
      ? redactSensitiveText((errorRecord as { query: string }).query)
      : typeof (errorRecord as { context?: { query?: unknown } }).context?.query === 'string'
        ? redactSensitiveText((errorRecord as { context: { query: string } }).context.query)
        : undefined;
  const message = redactSensitiveText(
    (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').trim()
  );

  return {
    ...(listingId ? { listing_id: listingId } : {}),
    failure: {
      ...(category ? { category } : {}),
      ...(code ? { code } : {}),
      message,
      ...(query ? { query } : {}),
    },
    listing_price_updated: false,
    overallStatus: 'fail',
    provider,
  };
}

function buildSkippedPayload(listingId: string, message: string): Record<string, unknown> {
  return {
    db_updated: false,
    listing_id: listingId,
    listing_price_updated: false,
    message: redactSensitiveText(message),
    overallStatus: 'skipped',
    provider: 'apify',
    suggested_price: 'no price produced',
  };
}

function buildSuccessPayload(listingId: string, result: PriceListingNowResult): Record<string, unknown> {
  return {
    accepted_comp_count: result.acceptedCompCount,
    db_updated: result.listingPriceResearchUpdated,
    listing_id: listingId,
    listing_price_updated: result.listing.price === result.suggestedPrice,
    overallStatus: 'pass',
    provider: result.provider,
    raw_comp_count: result.rawCompCount,
    suggested_price: result.suggestedPrice ?? 'no price produced',
  };
}

export async function runPriceOneListingCli(
  argv: string[] = process.argv.slice(2),
  dependencies: PriceOneListingCliDependencies = {}
): Promise<void> {
  const capture = createStreamCapture();
  loadRootEnvironment();
  const parsedArgs = parseArgs(argv);

  try {
    if (!parsedArgs.ok) {
      capture.restore();
      console.log(
        JSON.stringify(
          {
            failure: {
              code: parsedArgs.code,
              message: parsedArgs.message,
            },
            overallStatus: 'fail',
            usage: buildUsage(),
          },
          null,
          2
        )
      );
      process.exitCode = 1;
      return;
    }

    const dataAccess =
      dependencies.createDataAccess?.() ?? createSidecarDataAccess(process.env);
    const runPriceNow = dependencies.runPriceListingNow ?? priceListingNow;
    const config = buildProviderConfig(process.env);
    const result = await runPriceNow(parsedArgs.listingId, {
      createPricingProvider: () => {
        return dependencies.createProvider?.(config) ?? createApifyPricingProvider(config);
      },
      dataAccess: dataAccess as ResearchPriceJobDependencies['dataAccess'],
      now: () => new Date(),
    }, {
      executionSource: 'cli',
    });

    capture.restore();
    console.log(JSON.stringify(buildSuccessPayload(parsedArgs.listingId, result), null, 2));
  } catch (error) {
    capture.restore();

    if (
      error instanceof Error &&
      'code' in error &&
      error.code === JOB_ERROR_CODES.RESEARCH_PRICE_DISABLED &&
      parsedArgs.ok
    ) {
      console.log(JSON.stringify(buildSkippedPayload(parsedArgs.listingId, error.message), null, 2));
      return;
    }

    if (typeof error === 'object' && error !== null && 'overallStatus' in error) {
      console.log(JSON.stringify(error, null, 2));
    } else {
      console.log(
        JSON.stringify(
          toFailurePayload(error, parsedArgs.ok ? parsedArgs.listingId : undefined),
          null,
          2
        )
      );
    }

    process.exitCode = 1;
  }
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
const modulePath = resolve(fileURLToPath(import.meta.url));

if (entryPath && modulePath === entryPath) {
  await runPriceOneListingCli();
}
