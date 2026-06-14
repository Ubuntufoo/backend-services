#!/usr/bin/env node

import type { ListingRow } from '@ebay-inventory/data';

import { resolve } from 'path';
import { fileURLToPath } from 'url';

import { loadRootEnvironment } from '@/config/env-paths.js';
import { createSidecarDataAccess, type SidecarDataAccess } from '@/data/sidecar-data.js';
import {
  buildPricingProviderInput,
  createApifyPricingProvider,
  parseRuntimeApifyConfig,
  redactSensitiveText,
  type ApifyPricingProviderConfig,
  type PricingProvider,
  type PricingProviderResult,
} from '@/pricing/index.js';

interface StreamCapture {
  restore(): void;
}

interface SmokeApifyPricingCliDependencies {
  createDataAccess?: () => Pick<
    SidecarDataAccess,
    'jobs' | 'listingPriceResearch' | 'listings'
  >;
  createProvider?: (config: ApifyPricingProviderConfig) => PricingProvider;
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

type ParsedArgs = ParsedArgsSuccess | ParsedArgsFailure;

interface FailurePayload {
  failure?: {
    category?: string;
    code?: string;
    message: string;
    query?: string;
  };
  listingId?: string;
  overallStatus: 'fail';
  provider?: string;
  usage?: {
    command: string;
    selectors: string[];
  };
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

function parseNonEmptyValue(value: string | undefined, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} requires a non-empty value.`);
  }

  return value.trim();
}

function buildUsage(): FailurePayload['usage'] {
  return {
    command: 'pnpm pricing:smoke-apify -- --listing-id <listing_id>',
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
    provider?: string;
    usage?: boolean;
  } = {}
): FailurePayload {
  const provider =
    typeof (error as { provider?: unknown })?.provider === 'string'
      ? ((error as { provider: string }).provider ?? context.provider)
      : context.provider;
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
    overallStatus: 'fail',
    ...(provider ? { provider } : {}),
    failure: {
      ...(category ? { category } : {}),
      ...(code ? { code } : {}),
      message,
      ...(query ? { query } : {}),
    },
    ...(context.usage ? { usage: buildUsage() } : {}),
  };
}

function buildConfigFailurePayload(checkName: string, message: string): FailurePayload {
  return {
    overallStatus: 'fail',
    provider: 'apify',
    failure: {
      category: 'auth_config',
      code: checkName,
      message: redactSensitiveText(message),
    },
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

  if (config.requestedCompCount.value === null) {
    throw buildConfigFailurePayload(
      'apify_min_sold_comps',
      config.requestedCompCount.issues[0] ?? 'APIFY_MIN_SOLD_COMPS invalid.'
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
    requestedCompCount: config.requestedCompCount.value,
    timeoutSeconds: config.timeoutSeconds.value,
    token: config.token,
  };
}

function summarizeRawResult(rawResult: unknown): Record<string, unknown> {
  if (typeof rawResult !== 'object' || rawResult === null || Array.isArray(rawResult)) {
    return {};
  }

  const raw = rawResult as {
    actorId?: unknown;
    fetchedAt?: unknown;
    input?: {
      actorInput?: unknown;
      query?: unknown;
    };
    output?: {
      itemCount?: unknown;
      sampleTitles?: unknown;
    };
    run?: {
      finishedAt?: unknown;
      itemCount?: unknown;
      runId?: unknown;
      startedAt?: unknown;
      status?: unknown;
      statusMessage?: unknown;
    };
  };

  return {
    ...(typeof raw.actorId === 'string' ? { actorId: raw.actorId } : {}),
    ...(typeof raw.fetchedAt === 'string' ? { fetchedAt: raw.fetchedAt } : {}),
    input: {
      ...(typeof raw.input?.query === 'string'
        ? { query: redactSensitiveText(raw.input.query) }
        : {}),
      ...(typeof raw.input?.actorInput === 'object' && raw.input.actorInput !== null
        ? { actorInput: raw.input.actorInput }
        : {}),
    },
    output: {
      ...(typeof raw.output?.itemCount === 'number' ? { itemCount: raw.output.itemCount } : {}),
      ...(Array.isArray(raw.output?.sampleTitles)
        ? {
            sampleTitles: raw.output.sampleTitles
              .filter((value): value is string => typeof value === 'string')
              .slice(0, 3),
          }
        : {}),
    },
    run: {
      ...(typeof raw.run?.runId === 'string' ? { runId: raw.run.runId } : {}),
      ...(typeof raw.run?.status === 'string' ? { status: raw.run.status } : {}),
      ...(typeof raw.run?.itemCount === 'number' ? { itemCount: raw.run.itemCount } : {}),
      ...(typeof raw.run?.startedAt === 'string' ? { startedAt: raw.run.startedAt } : {}),
      ...(typeof raw.run?.finishedAt === 'string' ? { finishedAt: raw.run.finishedAt } : {}),
      ...(typeof raw.run?.statusMessage === 'string'
        ? { statusMessage: redactSensitiveText(raw.run.statusMessage) }
        : {}),
    },
  };
}

function buildSuccessPayload(
  listing: ListingRow,
  result: PricingProviderResult
): Record<string, unknown> {
  return {
    fetchedAt: result.fetchedAt,
    listingId: listing.listing_id,
    overallStatus: 'pass',
    provider: result.provider,
    query: redactSensitiveText(result.query),
    rawResultSummary: summarizeRawResult(result.rawResult),
    sampleComps: result.soldComps.slice(0, 3).map((comp) => ({
      ...(comp.condition ? { condition: comp.condition } : {}),
      price: comp.price,
      ...(comp.shippingPrice ? { shippingPrice: comp.shippingPrice } : {}),
      soldDate: comp.soldDate,
      title: comp.title,
    })),
    soldCompCount: result.soldComps.length,
  };
}

export async function runSmokeApifyPricingCli(
  argv: string[] = process.argv.slice(2),
  dependencies: SmokeApifyPricingCliDependencies = {}
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

    const config = buildProviderConfig(process.env);
    const dataAccess =
      dependencies.createDataAccess?.() ?? createSidecarDataAccess(process.env);
    const listing = await dataAccess.listings.getByListingId(parsedArgs.listingId);

    if (!listing) {
      throw new Error(`Listing "${parsedArgs.listingId}" was not found.`);
    }

    const provider =
      dependencies.createProvider?.(config) ?? createApifyPricingProvider(config);
    const providerResult = await provider.fetchSoldComps(
      buildPricingProviderInput(listing, listing.listing_id, config.requestedCompCount)
    );

    capture.restore();
    console.log(JSON.stringify(buildSuccessPayload(listing, providerResult), null, 2));
  } catch (error) {
    capture.restore();

    if (typeof error === 'object' && error !== null && 'overallStatus' in error) {
      console.log(JSON.stringify(error, null, 2));
    } else {
      console.log(
        JSON.stringify(
          toFailurePayload(error, {
            listingId: parsedArgs.ok ? parsedArgs.listingId : undefined,
            provider: 'apify',
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
  await runSmokeApifyPricingCli();
}
