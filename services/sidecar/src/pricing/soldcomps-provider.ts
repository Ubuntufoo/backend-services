import { z } from 'zod';

import { SOLDCOMPS_API_BASE_URL, SOLDCOMPS_SOLD_COMP_REQUEST_COUNT } from './soldcomps-config.js';
import { buildSoldCompsQuery } from './sold-comps-query.js';
import {
  compactRedactedMessage,
  extractZodErrorMessage,
  isNetworkLikeError,
  readResponseText,
  redactPricingSensitiveText,
  truncateRedactedText,
} from './provider-shared.js';
import { buildSoldCompsKeyword } from './soldcomps-keyword.js';
import type {
  PricingProvider,
  PricingProviderInput,
  PricingProviderResult,
  RawSoldComp,
  SoldCompsUsageSnapshot,
} from './types.js';

const SOLDCOMPS_PROVIDER_NAME = 'soldcomps';
const DEFAULT_TIMEOUT_SECONDS = 120;
const ISO_SOLD_DATE_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/;
const URL_PROTOCOLS = new Set(['http:', 'https:']);

const numericValueSchema = z.union([
  z.number().finite(),
  z
    .string()
    .trim()
    .min(1)
    .refine((value) => !Number.isNaN(Number(value)), 'must be numeric'),
]);

const soldCompsItemSchema = z.object({
  condition: z.string().trim().min(1).nullable(),
  conditionId: z.number().int().nullable(),
  categoryId: z.string().trim().min(1),
  endedAt: z
    .string()
    .trim()
    .refine((value) => ISO_SOLD_DATE_PATTERN.test(value), 'endedAt must be ISO-8601')
    .refine((value) => !Number.isNaN(new Date(value).getTime()), 'endedAt must be valid'),
  epid: z.string().trim().min(1).nullable(),
  itemId: z.string().trim().min(1),
  scrapedAt: z.string().trim().min(1),
  sellerFeedbackScore: z.number().finite().nullable(),
  sellerPositivePercent: z.number().finite().nullable(),
  sellerType: z.enum(['private', 'business']).nullable(),
  sellerUsername: z.string().trim().min(1).nullable(),
  shippingCurrency: z.string().trim().min(1).nullable(),
  shippingPrice: numericValueSchema.nullable(),
  shippingType: z.enum(['free', 'paid', 'pickup', 'unknown']).nullable(),
  soldCurrency: z.string().trim().min(1).nullable(),
  soldPrice: numericValueSchema.nullable(),
  thumbnailUrl: z.string().trim().url().nullable(),
  title: z.string().trim().min(1).nullable(),
  totalPrice: z.string().trim().min(1).nullable(),
  url: z
    .string()
    .trim()
    .url()
    .refine((value) => URL_PROTOCOLS.has(new URL(value).protocol), 'url must use http or https'),
});

const soldCompsResponseSchema = z.object({
  hasNextPage: z.boolean(),
  items: z.array(soldCompsItemSchema),
  keyword: z.string().trim().min(1),
  page: z.number().int().positive(),
  totalItems: z.number().int().nonnegative(),
});

const soldCompsErrorSchema = z
  .object({
    detail: z.string().trim().min(1).optional(),
    error: z.string().trim().min(1),
    limit: z.number().finite().optional(),
    plan: z.string().trim().min(1).optional(),
    remaining: z.number().finite().optional(),
    reset_at: z.string().trim().min(1).optional(),
    retry_after: z.number().finite().optional(),
    upgrade_url: z.string().trim().url().optional(),
    used: z.number().finite().optional(),
  })
  .passthrough();

export interface SoldCompsFetchInput {
  apiBaseUrl: string;
  apiKey: string;
  count: number;
  page: number;
  query: string;
  timeoutSeconds: number;
}

export interface SoldCompsFetchResult {
  body: unknown;
  responseHeaders?: Record<string, string>;
  status?: number;
}

export interface SoldCompsPricingProviderConfig {
  apiBaseUrl?: string;
  apiKey: string;
  timeoutSeconds?: number;
}

export interface SoldCompsPricingProviderDependencies {
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  runRequest?: (input: SoldCompsFetchInput) => Promise<SoldCompsFetchResult>;
}

export type SoldCompsProviderFailureCategory =
  | 'rate_limit'
  | 'auth_config'
  | 'timeout_network'
  | 'provider_unavailable'
  | 'malformed_output'
  | 'provider_failure';

export class SoldCompsPricingProviderError extends Error {
  readonly category: SoldCompsProviderFailureCategory;
  readonly code: string;
  readonly provider = SOLDCOMPS_PROVIDER_NAME;
  readonly query: string;
  readonly rawResult?: Record<string, unknown>;
  readonly statusCode?: number;
  readonly workflowSafe = true;

  constructor(
    code: string,
    category: SoldCompsProviderFailureCategory,
    message: string,
    query: string,
    options?: ErrorOptions & { rawResult?: Record<string, unknown>; statusCode?: number }
  ) {
    super(compactRedactedMessage(message));
    this.name = 'SoldCompsPricingProviderError';
    this.category = category;
    this.code = code;
    this.query = redactSoldCompsSensitiveText(query);
    this.rawResult = options?.rawResult;
    this.statusCode = options?.statusCode;
    if (options?.cause) {
      this.cause = options.cause;
    }
  }
}

export const redactSoldCompsSensitiveText = redactPricingSensitiveText;

export interface SoldCompsRequestParams {
  count: number;
  ebaySite: 'ebay.com';
  keyword: string;
  page: number;
  sortOrder: 'endedRecently';
}

export function buildSoldCompsRequestParams(
  input: PricingProviderInput,
  keyword = buildSoldCompsKeyword(input)
): SoldCompsRequestParams {
  return {
    count: input.requestedCompCount ?? SOLDCOMPS_SOLD_COMP_REQUEST_COUNT,
    ebaySite: 'ebay.com',
    keyword,
    page: 1,
    sortOrder: 'endedRecently',
  };
}

export function parseSoldCompsResponse(
  raw: unknown,
  meta: {
    fetchedAt?: string;
    query?: string;
    request?: SoldCompsRequestParams;
    responseHeaders?: Record<string, string>;
    status?: number;
  } = {}
): PricingProviderResult {
  let parsed: z.infer<typeof soldCompsResponseSchema>;

  try {
    parsed = soldCompsResponseSchema.parse(raw);
  } catch (error) {
    throw new SoldCompsPricingProviderError(
      'soldcomps_output_invalid',
      'malformed_output',
      `SoldComps output malformed: ${extractZodErrorMessage(error, 'invalid provider output')}`,
      meta.query ?? getQueryFromResponse(raw),
      { cause: error instanceof Error ? error : undefined, statusCode: meta.status }
    );
  }

  const soldComps = parsed.items.map((item) => toRawSoldComp(item, parsed.keyword));
  const fetchedAt = meta.fetchedAt ?? new Date().toISOString();
  const usage = parseSoldCompsUsageHeaders(meta.responseHeaders, fetchedAt);

  return {
    fetchedAt,
    provider: SOLDCOMPS_PROVIDER_NAME,
    query: meta.query ?? parsed.keyword,
    rawResult: {
      fetchedAt,
      input: {
        query: redactSoldCompsSensitiveText(meta.query ?? parsed.keyword),
        request: meta.request ? sanitizeRequestParams(meta.request) : undefined,
      },
      output: {
        hasNextPage: parsed.hasNextPage,
        itemCount: soldComps.length,
        page: parsed.page,
        sampleTitles: soldComps.slice(0, 3).map((comp) => comp.title),
        totalItems: parsed.totalItems,
      },
      responseHeaders: sanitizeHeaders(meta.responseHeaders),
      status: meta.status,
      usage,
    },
    soldCompsUsage: usage,
    soldComps,
  };
}

export function createSoldCompsPricingProvider(
  config: SoldCompsPricingProviderConfig,
  dependencies: SoldCompsPricingProviderDependencies = {}
): PricingProvider {
  const now = dependencies.now ?? (() => new Date());
  const runRequest =
    dependencies.runRequest ??
    ((input: SoldCompsFetchInput) =>
      defaultRunRequest(
        input,
        config.apiBaseUrl ?? SOLDCOMPS_API_BASE_URL,
        dependencies.fetch ?? globalThis.fetch
      ));

  return {
    name: SOLDCOMPS_PROVIDER_NAME,
    async fetchSoldComps(input: PricingProviderInput): Promise<PricingProviderResult> {
      if (!config.apiKey.trim()) {
        throw new SoldCompsPricingProviderError(
          'soldcomps_auth_config_invalid',
          'auth_config',
          'SoldComps pricing provider misconfigured: SOLDCOMPS_API_KEY required.',
          input.title
        );
      }

      const strictRequest = buildSoldCompsRequestParams(input);
      const relaxedQuery = buildSoldCompsQuery(input);
      const strictResult = await executeSoldCompsRequest({
        apiBaseUrl: config.apiBaseUrl ?? SOLDCOMPS_API_BASE_URL,
        apiKey: config.apiKey,
        now,
        request: strictRequest,
        runRequest,
        timeoutSeconds: config.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS,
      });

      if (strictResult.soldComps.length > 0 || strictRequest.keyword === relaxedQuery) {
        return withQueryFallbackDiagnostics({
          effectiveResult: strictResult,
          strictResult,
        });
      }

      const fallbackRequest = buildSoldCompsRequestParams(input, relaxedQuery);

      try {
        const fallbackResult = await executeSoldCompsRequest({
          apiBaseUrl: config.apiBaseUrl ?? SOLDCOMPS_API_BASE_URL,
          apiKey: config.apiKey,
          now,
          request: fallbackRequest,
          runRequest,
          timeoutSeconds: config.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS,
        });

        return withQueryFallbackDiagnostics({
          effectiveResult: fallbackResult,
          fallbackResult,
          strictResult,
        });
      } catch (error) {
        if (!(error instanceof SoldCompsPricingProviderError)) {
          throw error;
        }

        throw withFallbackFailureDiagnostics(error, {
          strictResult,
        });
      }
    },
  };
}

async function executeSoldCompsRequest(input: {
  apiBaseUrl: string;
  apiKey: string;
  now: () => Date;
  request: SoldCompsRequestParams;
  runRequest: (input: SoldCompsFetchInput) => Promise<SoldCompsFetchResult>;
  timeoutSeconds: number;
}): Promise<PricingProviderResult> {
  const fetchedAt = input.now().toISOString();

  try {
    const raw = await input.runRequest({
      apiBaseUrl: input.apiBaseUrl,
      apiKey: input.apiKey,
      count: input.request.count,
      page: input.request.page,
      query: input.request.keyword,
      timeoutSeconds: input.timeoutSeconds,
    });

    return parseSoldCompsResponse(raw.body, {
      fetchedAt,
      query: input.request.keyword,
      request: input.request,
      responseHeaders: raw.responseHeaders,
      status: raw.status,
    });
  } catch (error) {
    if (error instanceof SoldCompsPricingProviderError) {
      throw error;
    }

    throw new SoldCompsPricingProviderError(
      'soldcomps_provider_failure',
      'provider_failure',
      error instanceof Error ? error.message : String(error),
      input.request.keyword,
      { cause: error instanceof Error ? error : undefined }
    );
  }
}

function withQueryFallbackDiagnostics(input: {
  effectiveResult: PricingProviderResult;
  fallbackError?: SoldCompsPricingProviderError;
  fallbackResult?: PricingProviderResult;
  strictResult: PricingProviderResult;
}): PricingProviderResult {
  return {
    ...input.effectiveResult,
    rawResult: {
      ...toObjectRecord(input.effectiveResult.rawResult),
      queryFallback: buildQueryFallbackDiagnostics({
        effectiveQuery: input.effectiveResult.query,
        fallbackError: input.fallbackError,
        fallbackResult: input.fallbackResult,
        strictResult: input.strictResult,
      }),
    },
  };
}

function withFallbackFailureDiagnostics(
  error: SoldCompsPricingProviderError,
  input: {
    strictResult: PricingProviderResult;
  }
): SoldCompsPricingProviderError {
  return new SoldCompsPricingProviderError(error.code, error.category, error.message, error.query, {
    cause: error,
    rawResult: {
      queryFallback: buildQueryFallbackDiagnostics({
        fallbackError: error,
        strictResult: input.strictResult,
      }),
    },
    statusCode: error.statusCode,
  });
}

function buildQueryFallbackDiagnostics(input: {
  effectiveQuery?: string;
  fallbackError?: SoldCompsPricingProviderError;
  fallbackResult?: PricingProviderResult;
  strictResult: PricingProviderResult;
}): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries({
      effectiveQuery: input.effectiveQuery,
      fallbackAttempt: input.fallbackResult ? toAttemptDiagnostics(input.fallbackResult) : undefined,
      fallbackAttempted: input.fallbackResult !== undefined || input.fallbackError !== undefined,
      fallbackFailure: input.fallbackError
        ? {
            ...(input.fallbackError.rawResult ? input.fallbackError.rawResult : {}),
            category: input.fallbackError.category,
            code: input.fallbackError.code,
            message: input.fallbackError.message,
            query: input.fallbackError.query,
            statusCode: input.fallbackError.statusCode,
          }
        : undefined,
      fallbackSucceeded: input.fallbackResult !== undefined && input.fallbackResult.soldComps.length > 0,
      strictAttempt: toAttemptDiagnostics(input.strictResult),
    }).filter(([, value]) => value !== undefined)
  );
}

function toAttemptDiagnostics(result: PricingProviderResult): Record<string, unknown> {
  return {
    ...toObjectRecord(result.rawResult),
    query: result.query,
  };
}

function toObjectRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? { ...value }
    : { value };
}

async function defaultRunRequest(
  input: SoldCompsFetchInput,
  apiBaseUrl: string,
  fetchImpl: typeof globalThis.fetch
): Promise<SoldCompsFetchResult> {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), input.timeoutSeconds * 1000);

  try {
    const endpoint = new URL('/v1/scrape', apiBaseUrl);
    endpoint.searchParams.set('keyword', input.query);
    endpoint.searchParams.set('page', String(input.page));
    endpoint.searchParams.set('count', String(input.count));
    endpoint.searchParams.set('ebaySite', 'ebay.com');
    endpoint.searchParams.set('sortOrder', 'endedRecently');

    const response = await fetchImpl(endpoint, {
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
      },
      method: 'GET',
      signal: controller.signal,
    });

    if (!response.ok) {
      const responseText = await readResponseText(response, 'Unable to read SoldComps response body.');
      const parsedError = parseSoldCompsError(responseText);
      const { category, code } = classifySoldCompsHttpFailure(response.status);
      const detail = parsedError?.detail ? ` ${parsedError.detail}` : '';

      throw new SoldCompsPricingProviderError(
        code,
        category,
        `SoldComps request failed with status ${response.status}: ${parsedError?.error ?? truncateRedactedText(responseText)}${detail}`,
        input.query,
        {
          statusCode: response.status,
        }
      );
    }

    const body = (await response.json()) as unknown;

    return {
      body,
      responseHeaders: Object.fromEntries(response.headers.entries()),
      status: response.status,
    };
  } catch (error) {
    if (error instanceof SoldCompsPricingProviderError) {
      throw error;
    }

    if (error instanceof Error && error.name === 'AbortError') {
      throw new SoldCompsPricingProviderError(
        'soldcomps_timeout',
        'timeout_network',
        `SoldComps request timed out after ${input.timeoutSeconds} seconds.`,
        input.query,
        { cause: error }
      );
    }

    if (error instanceof Error && isNetworkLikeError(error)) {
      throw new SoldCompsPricingProviderError(
        'soldcomps_network_error',
        'timeout_network',
        error.message,
        input.query,
        { cause: error }
      );
    }

    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

function toRawSoldComp(item: z.infer<typeof soldCompsItemSchema>, query: string): RawSoldComp {
  if (!item.title) {
    throw new SoldCompsPricingProviderError(
      'soldcomps_output_invalid',
      'malformed_output',
      'SoldComps output malformed: item title required.',
      query
    );
  }

  const soldPrice = normalizeNumericValue(item.soldPrice);
  if (soldPrice === null || !item.soldCurrency) {
    throw new SoldCompsPricingProviderError(
      'soldcomps_output_invalid',
      'malformed_output',
      'SoldComps output malformed: soldPrice and soldCurrency required.',
      query
    );
  }

  const shippingPrice = normalizeNumericValue(item.shippingPrice);
  const shippingCurrency = item.shippingCurrency ?? item.soldCurrency;

  if (item.shippingPrice !== null && shippingPrice === null) {
    throw new SoldCompsPricingProviderError(
      'soldcomps_output_invalid',
      'malformed_output',
      'SoldComps output malformed: shippingPrice must be numeric when present.',
      query
    );
  }

  if (item.shippingPrice !== null && !shippingCurrency) {
    throw new SoldCompsPricingProviderError(
      'soldcomps_output_invalid',
      'malformed_output',
      'SoldComps output malformed: shipping currency required when shippingPrice present.',
      query
    );
  }

  return {
    ...(item.condition !== null ? { condition: item.condition } : {}),
    ...(shippingPrice === null || !shippingCurrency
      ? {}
      : {
          shippingPrice: {
            currency: shippingCurrency,
            value: shippingPrice,
          },
        }),
    listingUrl: item.url,
    price: {
      currency: item.soldCurrency,
      value: soldPrice,
    },
    soldDate: item.endedAt,
    title: item.title,
  };
}

function normalizeNumericValue(value: string | number | null): number | null {
  if (value === null) {
    return null;
  }

  const normalized = typeof value === 'number' ? value : Number(value.trim());
  return Number.isFinite(normalized) ? normalized : null;
}

function parseSoldCompsError(value: string): z.infer<typeof soldCompsErrorSchema> | null {
  try {
    return soldCompsErrorSchema.parse(JSON.parse(value));
  } catch {
    return null;
  }
}

function sanitizeRequestParams(input: SoldCompsRequestParams): Record<string, unknown> {
  return {
    count: input.count,
    ebaySite: input.ebaySite,
      keyword: redactSoldCompsSensitiveText(input.keyword),
    page: input.page,
    sortOrder: input.sortOrder,
  };
}

function sanitizeHeaders(headers: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!headers) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key, redactSoldCompsSensitiveText(value)])
  );
}

function parseUsageHeaderValue(value: string | undefined): number | null | 'invalid' {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return 'invalid';
  }

  const parsed = Number(trimmed);

  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
    return 'invalid';
  }

  return parsed;
}

export function parseSoldCompsUsageHeaders(
  headers: Record<string, string> | undefined,
  updatedAt: string
): SoldCompsUsageSnapshot {
  const used = parseUsageHeaderValue(headers?.['x-usage-used']);
  const limit = parseUsageHeaderValue(headers?.['x-usage-limit']);

  if (used === 'invalid' || limit === 'invalid') {
    return {
      limit: null,
      source: 'malformed',
      updatedAt,
      used: null,
    };
  }

  if (used === null && limit === null) {
    return {
      limit: null,
      source: 'missing',
      updatedAt,
      used: null,
    };
  }

  return {
    limit,
    source: 'headers',
    updatedAt,
    used,
  };
}

function getQueryFromResponse(raw: unknown): string {
  if (!raw || Array.isArray(raw) || typeof raw !== 'object') {
    return '';
  }

  const keyword = 'keyword' in raw ? raw.keyword : undefined;
  return typeof keyword === 'string' ? keyword : '';
}

function classifySoldCompsHttpFailure(
  status: number
): { category: SoldCompsProviderFailureCategory; code: string } {
  if (status === 401 || status === 403) {
    return { category: 'auth_config', code: 'soldcomps_auth_failed' };
  }

  if (status === 429 || status === 402) {
    return { category: 'rate_limit', code: 'soldcomps_rate_limited' };
  }

  if (status === 408 || status === 504) {
    return { category: 'timeout_network', code: 'soldcomps_timeout' };
  }

  if (status === 500 || status === 502 || status === 503 || status === 521 || status === 522 || status === 523 || status === 524) {
    return { category: 'provider_unavailable', code: 'soldcomps_provider_unavailable' };
  }

  return { category: 'provider_failure', code: `soldcomps_http_${status}` };
}
