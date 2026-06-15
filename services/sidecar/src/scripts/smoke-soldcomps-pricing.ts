#!/usr/bin/env node

import { getPricingProviderMode, type ListingRow } from '@ebay-inventory/data';

import { resolve } from 'path';
import { fileURLToPath } from 'url';

import { loadRootEnvironment } from '@/config/env-paths.js';
import { createSidecarDataAccess, type SidecarDataAccess } from '@/data/sidecar-data.js';
import {
  buildPricingProviderInput,
  redactSensitiveText,
  resolveProductionPricingProvider,
  type PricingProvider,
  type PricingProviderResult,
} from '@/pricing/index.js';

interface StreamCapture {
  restore(): void;
}

interface SmokeSoldCompsPricingCliDependencies {
  createDataAccess?: () => Pick<SidecarDataAccess, 'appSettings' | 'listings'>;
  resolvePricingProvider?: () => PricingProvider;
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
    command: 'pnpm pricing:smoke-soldcomps -- --listing-id <listing_id>',
    selectors: ['--listing-id <listing_id>'],
  };
}

function parseArgs(argv: string[]): ParsedArgs {
  const normalizedArgv = argv[0] === '--' ? argv.slice(1) : argv;
  const listingIds: string[] = [];

  for (let index = 0; index < normalizedArgv.length; index += 1) {
    const current = normalizedArgv[index];

    if (current === '--listing-id') {
      listingIds.push(parseNonEmptyValue(normalizedArgv[index + 1], '--listing-id'));
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
      message: 'Exactly one selector required.',
      ok: false,
    };
  }

  if (listingIds.length > 1) {
    return {
      code: 'invalid_arguments',
      message: 'Multiple selectors supplied. Exactly one selector required.',
      ok: false,
    };
  }

  return {
    listingId: listingIds[0],
    ok: true,
  };
}

function toFailurePayload(
  error: unknown,
  context: {
    listingId?: string;
    selectedProviderMode?: string;
    usage?: boolean;
  } = {}
): Record<string, unknown> {
  const provider =
    typeof (error as { provider?: unknown })?.provider === 'string'
      ? (error as { provider: string }).provider
      : 'soldcomps';
  const category =
    typeof (error as { category?: unknown })?.category === 'string'
      ? (error as { category: string }).category
      : undefined;
  const code =
    typeof (error as { code?: unknown })?.code === 'string'
      ? (error as { code: string }).code
      : undefined;
  const query =
    typeof (error as { query?: unknown })?.query === 'string'
      ? redactSensitiveText((error as { query: string }).query)
      : undefined;
  const message = redactSensitiveText(
    (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').trim()
  );

  return {
    ...(context.listingId ? { listingId: context.listingId } : {}),
    ...(context.selectedProviderMode
      ? { selectedProviderMode: context.selectedProviderMode }
      : {}),
    failure: {
      ...(category ? { category } : {}),
      ...(code ? { code } : {}),
      message,
      ...(query ? { query } : {}),
    },
    overallStatus: 'fail',
    provider,
    ...(context.usage ? { usage: buildUsage() } : {}),
    workflow_safe: true,
  };
}

function summarizeRawResult(rawResult: unknown): Record<string, unknown> {
  if (typeof rawResult !== 'object' || rawResult === null || Array.isArray(rawResult)) {
    return {};
  }

  const raw = rawResult as {
    fetchedAt?: unknown;
    input?: {
      query?: unknown;
      request?: unknown;
    };
    output?: {
      hasNextPage?: unknown;
      itemCount?: unknown;
      page?: unknown;
      sampleTitles?: unknown;
      totalItems?: unknown;
    };
    responseHeaders?: unknown;
    status?: unknown;
  };

  return {
    ...(typeof raw.fetchedAt === 'string' ? { fetchedAt: raw.fetchedAt } : {}),
    input: {
      ...(typeof raw.input?.query === 'string'
        ? { query: redactSensitiveText(raw.input.query) }
        : {}),
      ...(typeof raw.input?.request === 'object' && raw.input.request !== null
        ? { request: raw.input.request }
        : {}),
    },
    output: {
      ...(typeof raw.output?.hasNextPage === 'boolean'
        ? { hasNextPage: raw.output.hasNextPage }
        : {}),
      ...(typeof raw.output?.itemCount === 'number' ? { itemCount: raw.output.itemCount } : {}),
      ...(typeof raw.output?.page === 'number' ? { page: raw.output.page } : {}),
      ...(Array.isArray(raw.output?.sampleTitles)
        ? {
            sampleTitles: raw.output.sampleTitles
              .filter((value): value is string => typeof value === 'string')
              .slice(0, 3),
          }
        : {}),
      ...(typeof raw.output?.totalItems === 'number' ? { totalItems: raw.output.totalItems } : {}),
    },
    ...(typeof raw.responseHeaders === 'object' && raw.responseHeaders !== null
      ? { responseHeaders: raw.responseHeaders }
      : {}),
    ...(typeof raw.status === 'number' ? { status: raw.status } : {}),
  };
}

function buildSuccessPayload(
  listing: ListingRow,
  selectedProviderMode: string,
  result: PricingProviderResult
): Record<string, unknown> {
  const requestCount =
    typeof (result.rawResult as { input?: { request?: { count?: unknown } } })?.input?.request
      ?.count === 'number'
      ? ((result.rawResult as { input: { request: { count: number } } }).input.request.count ?? null)
      : null;

  return {
    listingId: listing.listing_id,
    overallStatus: 'pass',
    provider: result.provider,
    query: redactSensitiveText(result.query),
    rawResultSummary: summarizeRawResult(result.rawResult),
    requestedCompCount: requestCount,
    sampleComps: result.soldComps.slice(0, 3).map((comp) => ({
      ...(comp.condition ? { condition: comp.condition } : {}),
      price: comp.price,
      ...(comp.shippingPrice ? { shippingPrice: comp.shippingPrice } : {}),
      soldDate: comp.soldDate,
      title: comp.title,
    })),
    selectedProviderMode,
    soldCompCount: result.soldComps.length,
  };
}

export async function runSmokeSoldCompsPricingCli(
  argv: string[] = process.argv.slice(2),
  dependencies: SmokeSoldCompsPricingCliDependencies = {}
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

    const dataAccess = dependencies.createDataAccess?.() ?? createSidecarDataAccess(process.env);
    const [appSettings, listing] = await Promise.all([
      dataAccess.appSettings.get(),
      dataAccess.listings.getByListingId(parsedArgs.listingId),
    ]);
    const selectedProviderMode = getPricingProviderMode(appSettings);

    if (!listing) {
      throw new Error(`Listing "${parsedArgs.listingId}" was not found.`);
    }

    const provider =
      dependencies.resolvePricingProvider?.() ??
      resolveProductionPricingProvider({
        env: process.env,
        mode: 'soldcomps',
      });
    const providerResult = await provider.fetchSoldComps(
      buildPricingProviderInput(listing, listing.listing_id)
    );

    capture.restore();
    console.log(JSON.stringify(buildSuccessPayload(listing, selectedProviderMode, providerResult), null, 2));
  } catch (error) {
    capture.restore();

    if (typeof error === 'object' && error !== null && 'overallStatus' in error) {
      console.log(JSON.stringify(error, null, 2));
    } else {
      console.log(
        JSON.stringify(
          toFailurePayload(error, {
            listingId: parsedArgs.ok ? parsedArgs.listingId : undefined,
            usage: !parsedArgs.ok,
          }),
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
  await runSmokeSoldCompsPricingCli();
}
