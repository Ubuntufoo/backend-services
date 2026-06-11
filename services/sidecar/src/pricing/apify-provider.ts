import { z } from 'zod';

import type { PricingProvider, PricingProviderInput, PricingProviderResult, RawSoldComp } from './types.js';

const APIFY_PROVIDER_NAME = 'apify';
const DEFAULT_TIMEOUT_SECONDS = 120;
const DEFAULT_MIN_SOLD_COMPS = 12;
const ISO_SOLD_DATE_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/;
const URL_PROTOCOLS = new Set(['http:', 'https:']);
const QUERY_ITEM_SPECIFIC_KEYS = [
  'Player',
  'Year',
  'Manufacturer',
  'Card Number',
  'Set',
  'Parallel/Variety',
] as const;

const moneySchema = z.object({
  value: z.number().finite(),
  currency: z.string().trim().min(1),
});

const apifySoldCompSchema = z.object({
  condition: z.string().trim().min(1).nullable().optional(),
  listingUrl: z
    .string()
    .trim()
    .url()
    .refine((value) => URL_PROTOCOLS.has(new URL(value).protocol), 'listingUrl must use http or https')
    .nullable()
    .optional(),
  price: moneySchema,
  shippingPrice: moneySchema.nullable().optional(),
  soldDate: z
    .string()
    .trim()
    .refine((value) => ISO_SOLD_DATE_PATTERN.test(value), 'soldDate must be ISO-8601')
    .refine((value) => !Number.isNaN(new Date(value).getTime()), 'soldDate must be valid'),
  title: z.string().trim().min(1),
});

const apifyActorOutputSchema = z.object({
  items: z.array(apifySoldCompSchema),
  query: z.string().trim().min(1),
  run: z
    .object({
      finishedAt: z.string().trim().min(1).optional(),
      itemCount: z.number().int().nonnegative().optional(),
      runId: z.string().trim().min(1).optional(),
      startedAt: z.string().trim().min(1).optional(),
      status: z.string().trim().min(1).optional(),
      statusMessage: z.string().trim().min(1).optional(),
    })
    .optional(),
});

export interface ApifyActorInput {
  categoryId?: string;
  conditionId?: string;
  facets?: Partial<Record<(typeof QUERY_ITEM_SPECIFIC_KEYS)[number], string>>;
  itemSpecifics?: PricingProviderInput['itemSpecifics'];
  listingId: string;
  minSoldComps: number;
  query: string;
  title: string;
}

export interface ApifyActorOutputMeta {
  actorId: string;
  fetchedAt?: string;
}

export interface ApifyPricingProviderConfig {
  actorId: string;
  minSoldComps?: number;
  timeoutSeconds?: number;
  token: string;
}

export interface RunApifyActorInput {
  actorId: string;
  actorInput: ApifyActorInput;
  query: string;
  timeoutSeconds: number;
  token: string;
}

export interface ApifyPricingProviderDependencies {
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  runActor?: (input: RunApifyActorInput) => Promise<unknown>;
}

export type ApifyProviderFailureCategory =
  | 'rate_limit'
  | 'auth_config'
  | 'timeout_network'
  | 'provider_unavailable'
  | 'malformed_output'
  | 'provider_failure';

export class ApifyPricingProviderError extends Error {
  readonly category: ApifyProviderFailureCategory;
  readonly code: string;
  readonly provider = APIFY_PROVIDER_NAME;
  readonly query: string;
  readonly statusCode?: number;
  readonly workflowSafe = true;

  constructor(
    code: string,
    category: ApifyProviderFailureCategory,
    message: string,
    query: string,
    options?: ErrorOptions & { statusCode?: number }
  ) {
    super(compactApifyErrorMessage(message), options);
    this.name = 'ApifyPricingProviderError';
    this.category = category;
    this.code = code;
    this.query = redactSensitiveText(query);
    this.statusCode = options?.statusCode;
  }
}

export function buildApifyActorInput(input: PricingProviderInput): ApifyActorInput {
  const minSoldComps = Math.max(input.minSoldComps ?? DEFAULT_MIN_SOLD_COMPS, DEFAULT_MIN_SOLD_COMPS);
  const query = buildApifyQuery(input);
  const facets = buildFacets(input.itemSpecifics);

  return {
    ...(input.categoryId ? { categoryId: input.categoryId } : {}),
    ...(input.conditionId ? { conditionId: input.conditionId } : {}),
    ...(facets ? { facets } : {}),
    ...(input.itemSpecifics ? { itemSpecifics: input.itemSpecifics } : {}),
    listingId: input.listingId,
    minSoldComps,
    query,
    title: input.title.trim(),
  };
}

export function parseApifyActorOutput(
  raw: unknown,
  meta: ApifyActorOutputMeta
): PricingProviderResult {
  let parsed: z.infer<typeof apifyActorOutputSchema>;

  try {
    parsed = apifyActorOutputSchema.parse(raw);
  } catch (error) {
    throw new ApifyPricingProviderError(
      'apify_output_invalid',
      'malformed_output',
      `Apify actor output malformed: ${extractZodErrorMessage(error)}`,
      getQueryFromActorOutput(raw),
      { cause: error instanceof Error ? error : undefined }
    );
  }

  const soldComps = parsed.items.map((item) => toRawSoldComp(item));
  const fetchedAt = meta.fetchedAt ?? new Date().toISOString();

  return {
    fetchedAt,
    provider: APIFY_PROVIDER_NAME,
    query: parsed.query,
    rawResult: {
      actorId: meta.actorId,
      fetchedAt,
      input: {
        query: redactSensitiveText(parsed.query),
      },
      output: {
        itemCount: soldComps.length,
        sampleTitles: soldComps.slice(0, 3).map((comp) => comp.title),
      },
      run: parsed.run ?? {},
    },
    soldComps,
  };
}

export function createApifyPricingProvider(
  config: ApifyPricingProviderConfig,
  dependencies: ApifyPricingProviderDependencies = {}
): PricingProvider {
  const now = dependencies.now ?? (() => new Date());
  const runActor =
    dependencies.runActor ??
    ((input: RunApifyActorInput) => defaultRunActor(input, dependencies.fetch ?? globalThis.fetch));

  return {
    name: APIFY_PROVIDER_NAME,
    async fetchSoldComps(input: PricingProviderInput): Promise<PricingProviderResult> {
      if (!config.token.trim() || !config.actorId.trim()) {
        throw new ApifyPricingProviderError(
          'apify_auth_config_invalid',
          'auth_config',
          'Apify pricing provider misconfigured: APIFY_TOKEN and APIFY_PRICE_ACTOR_ID required.',
          input.title
        );
      }

      const actorInput = buildApifyActorInput({
        ...input,
        minSoldComps: Math.max(input.minSoldComps ?? config.minSoldComps ?? DEFAULT_MIN_SOLD_COMPS, DEFAULT_MIN_SOLD_COMPS),
      });
      const fetchedAt = now().toISOString();

      try {
        const raw = await runActor({
          actorId: config.actorId,
          actorInput,
          query: actorInput.query,
          timeoutSeconds: config.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS,
          token: config.token,
        });

        return parseApifyActorOutput(raw, {
          actorId: config.actorId,
          fetchedAt,
        });
      } catch (error) {
        if (error instanceof ApifyPricingProviderError) {
          throw error;
        }

        throw new ApifyPricingProviderError(
          'apify_provider_failure',
          'provider_failure',
          error instanceof Error ? error.message : String(error),
          actorInput.query,
          { cause: error instanceof Error ? error : undefined }
        );
      }
    },
  };
}

async function defaultRunActor(
  input: RunApifyActorInput,
  fetchImpl: typeof globalThis.fetch
): Promise<unknown> {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), input.timeoutSeconds * 1000);
  const endpoint = `https://api.apify.com/v2/actors/${encodeURIComponent(input.actorId)}/run-sync-get-dataset-items`;

  try {
    const response = await fetchImpl(endpoint, {
      body: JSON.stringify(input.actorInput),
      headers: {
        Authorization: `Bearer ${input.token}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
      signal: controller.signal,
    });

    if (!response.ok) {
      const responseText = await readResponseText(response);
      const { category, code } = classifyApifyHttpFailure(response.status);

      throw new ApifyPricingProviderError(
        code,
        category,
        `Apify Actor request failed with status ${response.status}: ${truncateText(responseText)}`,
        input.query,
        {
          statusCode: response.status,
        }
      );
    }

    const body = (await response.json()) as unknown;

    return {
      items: body,
      query: input.query,
      run: {
        itemCount: Array.isArray(body) ? body.length : undefined,
        status: 'SUCCEEDED',
      },
    };
  } catch (error) {
    if (error instanceof ApifyPricingProviderError) {
      throw error;
    }

    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApifyPricingProviderError(
        'apify_timeout',
        'timeout_network',
        `Apify Actor request timed out after ${input.timeoutSeconds} seconds.`,
        input.query,
        { cause: error }
      );
    }

    if (error instanceof Error && isNetworkLikeError(error)) {
      throw new ApifyPricingProviderError(
        'apify_network_error',
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

function buildApifyQuery(input: PricingProviderInput): string {
  const queryParts = [input.title.trim()];

  if (input.categoryId) {
    queryParts.push(`category:${input.categoryId}`);
  }

  if (input.conditionId) {
    queryParts.push(`condition:${input.conditionId}`);
  }

  for (const key of QUERY_ITEM_SPECIFIC_KEYS) {
    const value = input.itemSpecifics?.[key];
    const normalizedValue = Array.isArray(value)
      ? value.map((entry) => entry.trim()).filter((entry) => entry.length > 0).join(', ')
      : value?.trim();

    if (normalizedValue) {
      queryParts.push(`${normalizeQueryKey(key)}:${normalizedValue}`);
    }
  }

  return queryParts.join(' | ');
}

function buildFacets(
  itemSpecifics: PricingProviderInput['itemSpecifics']
): ApifyActorInput['facets'] | undefined {
  if (!itemSpecifics) {
    return undefined;
  }

  const facets = Object.fromEntries(
    QUERY_ITEM_SPECIFIC_KEYS.flatMap((key) => {
      const value = itemSpecifics[key];
      const normalized = Array.isArray(value)
        ? value.map((entry) => entry.trim()).filter((entry) => entry.length > 0).join(' / ')
        : value?.trim() ?? '';

      return normalized.length > 0 ? [[key, normalized] as const] : [];
    })
  );

  return Object.keys(facets).length > 0 ? facets : undefined;
}

function normalizeQueryKey(key: string): string {
  return key.toLowerCase().replaceAll(/[^a-z0-9]+/g, '_').replaceAll(/^_|_$/g, '');
}

export function redactSensitiveText(value: string): string {
  return value
    .replace(/https?:\/\/\S+/gi, '[redacted-url]')
    .replace(/\b(?:Bearer|bearer)\s+[A-Za-z0-9._~+/=-]+\b/g, 'Bearer [redacted-token]')
    .replace(
      /\b(?:token|api[_-]?key|access[_-]?token|refresh[_-]?token|key|apikey|apiKey)\s*[:=]\s*([^\s,&]+)/gi,
      (_match, secret: string) => `[redacted-secret:${maskSecret(secret)}]`
    );
}

function toRawSoldComp(item: z.infer<typeof apifySoldCompSchema>): RawSoldComp {
  return {
    ...(item.condition !== undefined ? { condition: item.condition } : {}),
    ...(item.listingUrl !== undefined ? { listingUrl: item.listingUrl } : {}),
    ...(item.shippingPrice !== undefined ? { shippingPrice: item.shippingPrice } : {}),
    price: item.price,
    soldDate: item.soldDate,
    title: item.title,
  };
}

async function readResponseText(response: { text(): Promise<string> }): Promise<string> {
  try {
    return await response.text();
  } catch {
    return 'Unable to read Apify response body.';
  }
}

function truncateText(value: string, maxLength = 240): string {
  const normalized = value.replace(/\s+/g, ' ').trim();

  if (normalized.length <= maxLength) {
    return redactSensitiveText(normalized);
  }

  return `${redactSensitiveText(normalized.slice(0, maxLength - 3))}...`;
}

function compactApifyErrorMessage(value: string): string {
  const normalized = redactSensitiveText(value).replace(/\s+/g, ' ').trim();

  if (normalized.length <= 240) {
    return normalized;
  }

  return `${normalized.slice(0, 237)}...`;
}

function extractZodErrorMessage(error: unknown): string {
  if (!(error instanceof z.ZodError)) {
    return error instanceof Error ? error.message : 'invalid actor output';
  }

  const issue = error.issues[0];
  if (!issue) {
    return 'invalid actor output';
  }

  const path = issue.path.length > 0 ? issue.path.join('.') : 'payload';
  return `${path}: ${issue.message}`;
}

function getQueryFromActorOutput(raw: unknown): string {
  if (!raw || Array.isArray(raw) || typeof raw !== 'object') {
    return '';
  }

  const query = 'query' in raw ? raw.query : undefined;
  return typeof query === 'string' ? query : '';
}

function classifyApifyHttpFailure(
  status: number
): { category: ApifyProviderFailureCategory; code: string } {
  if (status === 401 || status === 403) {
    return { category: 'auth_config', code: 'apify_auth_failed' };
  }

  if (status === 429 || status === 402) {
    return { category: 'rate_limit', code: 'apify_rate_limited' };
  }

  if (status === 408 || status === 504) {
    return { category: 'timeout_network', code: 'apify_timeout' };
  }

  if (status === 502 || status === 503 || status === 521 || status === 522 || status === 523 || status === 524) {
    return { category: 'provider_unavailable', code: 'apify_provider_unavailable' };
  }

  return { category: 'provider_failure', code: `apify_http_${status}` };
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

function maskSecret(value: string): string {
  if (value.length <= 8) {
    return '***';
  }

  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}
