import { z } from 'zod';

import { SOLDCOMPS_API_BASE_URL, SOLDCOMPS_SOLD_COMP_REQUEST_COUNT } from './soldcomps-config.js';
import { buildSoldCompsKeyword } from './soldcomps-keyword.js';
import type { PricingProvider, PricingProviderInput, PricingProviderResult, RawSoldComp } from './types.js';

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
  readonly statusCode?: number;
  readonly workflowSafe = true;

  constructor(
    code: string,
    category: SoldCompsProviderFailureCategory,
    message: string,
    query: string,
    options?: ErrorOptions & { statusCode?: number }
  ) {
    super(compactSoldCompsErrorMessage(message));
    this.name = 'SoldCompsPricingProviderError';
    this.category = category;
    this.code = code;
    this.query = redactSoldCompsSensitiveText(query);
    this.statusCode = options?.statusCode;
    if (options?.cause) {
      this.cause = options.cause;
    }
  }
}

export interface SoldCompsRequestParams {
  count: number;
  ebaySite: 'ebay.com';
  keyword: string;
  page: number;
  sortOrder: 'endedRecently';
}

export function buildSoldCompsRequestParams(input: PricingProviderInput): SoldCompsRequestParams {
  return {
    count: input.requestedCompCount ?? SOLDCOMPS_SOLD_COMP_REQUEST_COUNT,
    ebaySite: 'ebay.com',
    keyword: buildSoldCompsKeyword(input),
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
      `SoldComps output malformed: ${extractZodErrorMessage(error)}`,
      meta.query ?? getQueryFromResponse(raw),
      { cause: error instanceof Error ? error : undefined, statusCode: meta.status }
    );
  }

  const soldComps = parsed.items.map((item) => toRawSoldComp(item, parsed.keyword));
  const fetchedAt = meta.fetchedAt ?? new Date().toISOString();

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
    },
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

      const request = buildSoldCompsRequestParams(input);
      const fetchedAt = now().toISOString();

      try {
        const raw = await runRequest({
          apiBaseUrl: config.apiBaseUrl ?? SOLDCOMPS_API_BASE_URL,
          apiKey: config.apiKey,
          count: request.count,
          page: request.page,
          query: request.keyword,
          timeoutSeconds: config.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS,
        });

        return parseSoldCompsResponse(raw.body, {
          fetchedAt,
          query: request.keyword,
          request,
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
          request.keyword,
          { cause: error instanceof Error ? error : undefined }
        );
      }
    },
  };
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
      const responseText = await readResponseText(response);
      const parsedError = parseSoldCompsError(responseText);
      const { category, code } = classifySoldCompsHttpFailure(response.status);
      const detail = parsedError?.detail ? ` ${parsedError.detail}` : '';

      throw new SoldCompsPricingProviderError(
        code,
        category,
        `SoldComps request failed with status ${response.status}: ${parsedError?.error ?? truncateText(responseText)}${detail}`,
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

export function redactSoldCompsSensitiveText(value: string): string {
  return value
    .replace(/https?:\/\/\S+/gi, '[redacted-url]')
    .replace(/\b(?:Bearer|bearer)\s+[A-Za-z0-9._~+/=-]+\b/g, 'Bearer [redacted-token]')
    .replace(
      /\b(?:token|api[_-]?key|access[_-]?token|refresh[_-]?token|key|apikey|apiKey)\s*[:=]\s*([^\s,&]+)/gi,
      (_match, secret: string) => `[redacted-secret:${maskSecret(secret)}]`
    );
}

function truncateText(value: string, maxLength = 240): string {
  const normalized = value.replace(/\s+/g, ' ').trim();

  if (normalized.length <= maxLength) {
    return redactSoldCompsSensitiveText(normalized);
  }

  return `${redactSoldCompsSensitiveText(normalized.slice(0, maxLength - 3))}...`;
}

function compactSoldCompsErrorMessage(value: string): string {
  const normalized = redactSoldCompsSensitiveText(value).replace(/\s+/g, ' ').trim();

  if (normalized.length <= 240) {
    return normalized;
  }

  return `${normalized.slice(0, 237)}...`;
}

function extractZodErrorMessage(error: unknown): string {
  if (!(error instanceof z.ZodError)) {
    return error instanceof Error ? error.message : 'invalid provider output';
  }

  const issue = error.issues[0];
  if (!issue) {
    return 'invalid provider output';
  }

  const path = issue.path.length > 0 ? issue.path.join('.') : 'payload';
  return `${path}: ${issue.message}`;
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

function isNetworkLikeError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes('network') ||
    message.includes('socket') ||
    message.includes('fetch failed') ||
    message.includes('econnreset') ||
    message.includes('enotfound') ||
    message.includes('timed out') ||
    message.includes('timeout')
  );
}

async function readResponseText(response: { text(): Promise<string> }): Promise<string> {
  try {
    return await response.text();
  } catch {
    return 'Unable to read SoldComps response body.';
  }
}

function maskSecret(value: string): string {
  if (value.length <= 8) {
    return '***';
  }

  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}
