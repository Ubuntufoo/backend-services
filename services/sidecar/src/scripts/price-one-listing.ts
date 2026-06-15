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
  redactSensitiveText,
  type LivePricingProviderMode,
} from '@/pricing/index.js';

interface StreamCapture {
  restore(): void;
}

interface PriceOneListingCliDependencies {
  createDataAccess?: () => Pick<SidecarDataAccess, 'appSettings' | 'listingPriceResearch' | 'listings'>;
  runPriceListingNow?: (
    listingId: string,
    dependencies: ResearchPriceJobDependencies,
    options: PriceListingNowOptions
  ) => Promise<PriceListingNowResult>;
  resolvePricingProvider?: ResearchPriceJobDependencies['resolvePricingProvider'];
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
type SelectedProviderModeForCli = LivePricingProviderMode | 'off';

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

function toFailurePayload(error: unknown, listingId?: string): Record<string, unknown> {
  const errorRecord = typeof error === 'object' && error !== null ? error : {};
  const actualProvider =
    typeof (errorRecord as { provider?: unknown }).provider === 'string'
      ? (errorRecord as { provider: string }).provider
      : typeof (errorRecord as { context?: { provider?: unknown } }).context?.provider === 'string'
        ? ((errorRecord as { context: { provider: string } }).context.provider ?? undefined)
        : undefined;
  const selectedProviderMode =
    typeof (errorRecord as { context?: { pricing_provider_mode?: unknown } }).context
      ?.pricing_provider_mode === 'string'
      ? ((errorRecord as { context: { pricing_provider_mode: LivePricingProviderMode } }).context
          .pricing_provider_mode ?? undefined)
      : undefined;
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
    ...(selectedProviderMode ? { selected_provider_mode: selectedProviderMode } : {}),
    ...(actualProvider ? { actual_provider: actualProvider } : {}),
    failure: {
      ...(category ? { category } : {}),
      ...(code ? { code } : {}),
      message,
      ...(query ? { query } : {}),
    },
    listing_price_updated: false,
    overallStatus: 'fail',
    workflow_safe: true,
  };
}

function buildSkippedPayload(
  listingId: string,
  message: string,
  selectedProviderMode: SelectedProviderModeForCli = 'off'
): Record<string, unknown> {
  return {
    db_updated: false,
    listing_id: listingId,
    listing_price_updated: false,
    message: redactSensitiveText(message),
    overallStatus: 'skipped',
    selected_provider_mode: selectedProviderMode,
    suggested_price: 'no price produced',
    workflow_safe: true,
  };
}

function buildSuccessPayload(listingId: string, result: PriceListingNowResult): Record<string, unknown> {
  return {
    accepted_comp_count: result.acceptedCompCount,
    actual_provider: result.provider,
    db_updated: result.listingPriceResearchUpdated,
    listing_id: listingId,
    listing_price_updated: result.listing.price === result.suggestedPrice,
    overallStatus: 'pass',
    raw_comp_count: result.rawCompCount,
    selected_provider_mode: result.selectedProviderMode,
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
    const result = await runPriceNow(parsedArgs.listingId, {
      dataAccess: dataAccess as ResearchPriceJobDependencies['dataAccess'],
      now: () => new Date(),
      pricingProviderEnv: process.env,
      ...(dependencies.resolvePricingProvider
        ? { resolvePricingProvider: dependencies.resolvePricingProvider }
        : {}),
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
      const selectedProviderModeRecord =
        typeof error === 'object' && error !== null
          ? (error as { context?: { pricing_provider_mode?: unknown } })
          : {};
      const selectedProviderMode =
        typeof selectedProviderModeRecord.context?.pricing_provider_mode === 'string'
          ? (selectedProviderModeRecord.context
              .pricing_provider_mode as SelectedProviderModeForCli)
          : 'off';
      console.log(
        JSON.stringify(
          buildSkippedPayload(parsedArgs.listingId, error.message, selectedProviderMode),
          null,
          2
        )
      );
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
