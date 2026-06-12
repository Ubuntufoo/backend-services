import { z } from 'zod';
import {
  GRADED_TRADING_CARD_CONDITION_ID,
  RAW_TRADING_CARD_CONDITION_ID,
  TRADING_CARD_CONDITION_ASPECT_KEY,
} from '@/listings/trading-card-conditions.js';

import type { PricingProvider, PricingProviderInput, PricingProviderResult, RawSoldComp } from './types.js';

const APIFY_PROVIDER_NAME = 'apify';
const DEFAULT_TIMEOUT_SECONDS = 120;
const DEFAULT_MIN_SOLD_COMPS = 8;
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
const QUERY_TITLE_STOPWORDS = new Set([
  'and',
  'baseball',
  'basketball',
  'card',
  'cards',
  'football',
  'for',
  'hockey',
  'insert',
  'mlb',
  'nba',
  'nfl',
  'nhl',
  'of',
  'rc',
  'rookie',
  'soccer',
  'sports',
  'tcg',
  'the',
  'trading',
]);
const SET_LINE_ITEM_SPECIFIC_KEYS = ['Manufacturer', 'Brand', 'Set', 'Series', 'Product', 'Product Line'] as const;
const PARALLEL_ITEM_SPECIFIC_KEYS = [
  'Parallel/Variety',
  'Insert Set',
  'Features',
  'Series',
  'Product',
  'Product Line',
  'Variation',
] as const;
const PARALLEL_TERMS = [
  'Topps Chrome',
  'Bowman Chrome',
  'Rated Rookie',
  'Blue Velocity',
  'Red Ice',
  'Pink Ice',
  'Fast Break',
  'Tiger Stripe',
  'Cracked Ice',
  'Photo Variation',
  'X-Fractor',
  'Die-Cut',
  'Prizm',
  'Silver',
  'Refractor',
  'Mosaic',
  'Optic',
  'Select',
  'Chrome',
  'Concourse',
  'Courtside',
  'Genesis',
  'Checkerboard',
  'Kaboom',
  'Downtown',
  'Color Blast',
  'Shimmer',
  'Sparkle',
  'Disco',
  'Mojo',
  'Scope',
  'Impact',
  'Holo',
  'Foil',
  'Negative',
  'Sepia',
  'Hyper',
  'Wave',
  'Pink',
  'Gold',
  'Green',
  'Blue',
  'Red',
  'Black',
  'White',
  'Purple',
  'Orange',
] as const;
const GRADE_PATTERN = /\b(PSA|BGS|SGC|CGC|CSG|TAG|HGA)\s*(10|[1-9](?:\.\d)?)\b/i;
const TITLE_CARD_NUMBER_PATTERN = /(?:^|[\s(#-])#?([A-Za-z]{0,4}\d{1,4}[A-Za-z]{0,4})(?:$|[\s)#-])/g;
const TITLE_YEAR_PATTERN = /\b(19\d{2}|20\d{2})\b/g;

const moneySchema = z.object({
  value: z.number().finite(),
  currency: z.string().trim().min(1),
});

const numericValueSchema = z.union([
  z.number().finite(),
  z
    .string()
    .trim()
    .min(1)
    .refine((value) => !Number.isNaN(Number(value)), 'must be numeric'),
]);

const internalApifySoldCompSchema = z.object({
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

const actorDatasetItemSchema = z.object({
  condition: z.string().trim().min(1).nullable().optional(),
  endedAt: z
    .string()
    .trim()
    .min(1)
    .refine((value) => ISO_SOLD_DATE_PATTERN.test(value), 'endedAt must be ISO-8601')
    .refine((value) => !Number.isNaN(new Date(value).getTime()), 'endedAt must be valid'),
  soldCurrency: z.string().trim().min(1),
  soldPrice: numericValueSchema,
  shippingPrice: numericValueSchema.nullable().optional(),
  title: z.string().trim().min(1),
  url: z
    .string()
    .trim()
    .url()
    .refine((value) => URL_PROTOCOLS.has(new URL(value).protocol), 'url must use http or https'),
});

const apifyActorOutputSchema = z.object({
  items: z.array(z.union([internalApifySoldCompSchema, actorDatasetItemSchema])),
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
  count: number;
  facets?: Partial<Record<(typeof QUERY_ITEM_SPECIFIC_KEYS)[number], string>>;
  itemSpecifics?: PricingProviderInput['itemSpecifics'];
  keywords: string[];
  listingId: string;
  minSoldComps: number;
  title: string;
}

export interface ApifyActorOutputMeta {
  actorInput?: ApifyActorInput;
  actorId: string;
  fetchedAt?: string;
  query?: string;
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
  const minSoldComps = input.minSoldComps ?? DEFAULT_MIN_SOLD_COMPS;
  const query = buildApifyQuery(input);
  const facets = buildFacets(input.itemSpecifics);

  return {
    count: minSoldComps,
    ...(facets ? { facets } : {}),
    ...(input.itemSpecifics ? { itemSpecifics: input.itemSpecifics } : {}),
    keywords: [query],
    listingId: input.listingId,
    minSoldComps,
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
    query: meta.query ?? parsed.query,
    rawResult: {
      actorId: meta.actorId,
      fetchedAt,
      input: {
        actorInput: meta.actorInput ? sanitizeActorInput(meta.actorInput) : undefined,
        query: redactSensitiveText(meta.query ?? parsed.query),
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
        minSoldComps: input.minSoldComps ?? config.minSoldComps ?? DEFAULT_MIN_SOLD_COMPS,
      });
      const fetchedAt = now().toISOString();

      try {
        const raw = await runActor({
          actorId: config.actorId,
          actorInput,
          query: actorInput.keywords[0],
          timeoutSeconds: config.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS,
          token: config.token,
        });

        return parseApifyActorOutput(raw, {
          actorInput,
          actorId: config.actorId,
          fetchedAt,
          query: actorInput.keywords[0],
        });
      } catch (error) {
        if (error instanceof ApifyPricingProviderError) {
          throw error;
        }

        throw new ApifyPricingProviderError(
          'apify_provider_failure',
          'provider_failure',
          error instanceof Error ? error.message : String(error),
          actorInput.keywords[0] ?? input.title,
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
  const title = input.title.trim();
  const terms = new QueryTermAccumulator();
  const isLot = isLotListing(input, title);

  terms.add(getFirstSpecificValue(input.itemSpecifics, ['Player']));
  terms.add(getPrimaryYear(input.itemSpecifics, title));
  terms.add(getSetLine(input.itemSpecifics, title));

  if (!isLot) {
    terms.add(formatCardNumber(getCardNumber(input.itemSpecifics, title)));
  }

  for (const token of getParallelSignals(input.itemSpecifics, title)) {
    terms.add(token);
  }

  terms.add(getGradingSignal(input));

  if (isLot) {
    terms.add('lot');
  }

  if (terms.isEmpty()) {
    for (const token of tokenizeTitle(title)) {
      terms.add(token);
    }
  }

  return terms.toString() || title;
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

function sanitizeActorInput(input: ApifyActorInput): Record<string, unknown> {
  return {
    count: input.count,
    ...(input.facets ? { facets: sanitizeUnknown(input.facets) } : {}),
    ...(input.itemSpecifics ? { itemSpecifics: sanitizeUnknown(input.itemSpecifics) } : {}),
    keywords: input.keywords.map((value) => redactSensitiveText(value)),
    listingId: redactSensitiveText(input.listingId),
    minSoldComps: input.minSoldComps,
    title: redactSensitiveText(input.title),
  };
}

function sanitizeUnknown(value: unknown): unknown {
  if (typeof value === 'string') {
    return redactSensitiveText(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeUnknown(entry));
  }

  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [key, sanitizeUnknown(entryValue)])
    );
  }

  return value;
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

function toRawSoldComp(
  item: z.infer<typeof internalApifySoldCompSchema> | z.infer<typeof actorDatasetItemSchema>
): RawSoldComp {
  if ('price' in item) {
    return {
      ...(item.condition !== undefined ? { condition: item.condition } : {}),
      ...(item.listingUrl !== undefined ? { listingUrl: item.listingUrl } : {}),
      ...(item.shippingPrice !== undefined ? { shippingPrice: item.shippingPrice } : {}),
      price: item.price,
      soldDate: item.soldDate,
      title: item.title,
    };
  }

  const soldPriceValue = normalizeNumericValue(item.soldPrice);

  if (soldPriceValue === null) {
    throw new ApifyPricingProviderError(
      'apify_output_invalid',
      'malformed_output',
      'Apify actor output malformed: soldPrice must be numeric.',
      item.title
    );
  }

  const shippingPriceValue =
    item.shippingPrice === null || item.shippingPrice === undefined
      ? null
      : normalizeNumericValue(item.shippingPrice);

  if (item.shippingPrice !== null && item.shippingPrice !== undefined && shippingPriceValue === null) {
    throw new ApifyPricingProviderError(
      'apify_output_invalid',
      'malformed_output',
      'Apify actor output malformed: shippingPrice must be numeric when present.',
      item.title
    );
  }

  return {
    ...(item.condition !== undefined ? { condition: item.condition } : {}),
    listingUrl: item.url,
    price: {
      currency: item.soldCurrency,
      value: soldPriceValue,
    },
    ...(shippingPriceValue === null
      ? {}
      : {
          shippingPrice: {
            currency: item.soldCurrency,
            value: shippingPriceValue,
          },
        }),
    soldDate: item.endedAt,
    title: item.title,
  };
}

function normalizeNumericValue(value: string | number): number | null {
  const normalized = typeof value === 'number' ? value : Number(value.trim());

  return Number.isFinite(normalized) ? normalized : null;
}

class QueryTermAccumulator {
  readonly #terms: string[] = [];
  readonly #seen = new Set<string>();

  add(value: string | undefined): void {
    const normalized = value?.trim().replace(/\s+/g, ' ');

    if (!normalized) {
      return;
    }

    const key = normalized.toLocaleLowerCase();
    if (this.#seen.has(key)) {
      return;
    }

    if (this.#terms.some((term) => containsWholePhrase(term, normalized))) {
      return;
    }

    this.#terms.push(normalized);
    this.#seen.add(key);
  }

  isEmpty(): boolean {
    return this.#terms.length === 0;
  }

  toArray(): string[] {
    return [...this.#terms];
  }

  toString(): string {
    return this.#terms.join(' ');
  }
}

function getSpecificValues(
  itemSpecifics: PricingProviderInput['itemSpecifics'],
  keys: readonly string[]
): string[] {
  if (!itemSpecifics) {
    return [];
  }

  return keys.flatMap((key) => normalizeSpecificValue(itemSpecifics[key]));
}

function normalizeSpecificValue(value: string | string[] | null | undefined): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  }

  const normalized = value?.trim();
  return normalized ? [normalized] : [];
}

function getFirstSpecificValue(
  itemSpecifics: PricingProviderInput['itemSpecifics'],
  keys: readonly string[]
): string | undefined {
  return getSpecificValues(itemSpecifics, keys)[0];
}

function getPrimaryYear(itemSpecifics: PricingProviderInput['itemSpecifics'], title: string): string | undefined {
  const specificYear = getFirstSpecificValue(itemSpecifics, ['Year']);

  if (specificYear) {
    const match = specificYear.match(/\b(19\d{2}|20\d{2})\b/);
    if (match) {
      return match[1];
    }
  }

  return title.match(TITLE_YEAR_PATTERN)?.[0];
}

function getSetLine(itemSpecifics: PricingProviderInput['itemSpecifics'], title: string): string | undefined {
  const terms = new QueryTermAccumulator();

  for (const value of getSpecificValues(itemSpecifics, SET_LINE_ITEM_SPECIFIC_KEYS)) {
    terms.add(value);
  }

  if (!terms.isEmpty()) {
    return terms.toString();
  }

  return tokenizeTitle(title)
    .filter((token) => !/^\d{4}$/.test(token))
    .slice(0, 4)
    .join(' ');
}

function getCardNumber(itemSpecifics: PricingProviderInput['itemSpecifics'], title: string): string | undefined {
  const specific = sanitizeCardNumber(getFirstSpecificValue(itemSpecifics, ['Card Number']));
  const primaryYear = getPrimaryYear(itemSpecifics, title);

  if (specific) {
    return specific;
  }

  for (const match of title.matchAll(TITLE_CARD_NUMBER_PATTERN)) {
    const candidate = sanitizeCardNumber(match[1]);
    if (candidate && candidate !== primaryYear) {
      return candidate;
    }
  }

  return undefined;
}

function sanitizeCardNumber(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/^#+/, '');
  return normalized && /^[A-Za-z]{0,4}\d{1,4}[A-Za-z]{0,4}$/.test(normalized) ? normalized : undefined;
}

function formatCardNumber(value: string | undefined): string | undefined {
  return value ? `#${value.replace(/^#+/, '')}` : undefined;
}

function getParallelSignals(itemSpecifics: PricingProviderInput['itemSpecifics'], title: string): string[] {
  const terms = new QueryTermAccumulator();

  for (const value of getSpecificValues(itemSpecifics, PARALLEL_ITEM_SPECIFIC_KEYS)) {
    for (const term of extractParallelTerms(value)) {
      terms.add(term);
    }
  }

  for (const term of extractParallelTerms(title)) {
    terms.add(term);
  }

  return terms.toArray();
}

function extractParallelTerms(value: string): string[] {
  return PARALLEL_TERMS.filter((term) => includesWholeTerm(value, term));
}

function includesWholeTerm(source: string, candidate: string): boolean {
  const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(?:^|[^A-Za-z0-9])${escaped}(?:$|[^A-Za-z0-9])`, 'i').test(source);
}

function containsWholePhrase(source: string, candidate: string): boolean {
  const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(?:^|\\s)${escaped}(?:$|\\s)`, 'i').test(source);
}

function getGradingSignal(input: PricingProviderInput): string | undefined {
  const gradedFromTitle = extractTitleGrade(input.title);

  if (input.conditionId?.trim() === GRADED_TRADING_CARD_CONDITION_ID) {
    return gradedFromTitle;
  }

  if (input.conditionId?.trim() === RAW_TRADING_CARD_CONDITION_ID) {
    return 'raw';
  }

  if (gradedFromTitle) {
    return gradedFromTitle;
  }

  if (getFirstSpecificValue(input.itemSpecifics, [TRADING_CARD_CONDITION_ASPECT_KEY])) {
    return 'raw';
  }

  return undefined;
}

function extractTitleGrade(title: string): string | undefined {
  const match = title.match(GRADE_PATTERN);
  return match ? `${match[1].toUpperCase()} ${match[2]}` : undefined;
}

function isLotListing(input: PricingProviderInput, title: string): boolean {
  return input.listingType === 'lot' || /\blot\b|\blot of\b|\bbundle\b|\bmultiple\b/i.test(title);
}

function tokenizeTitle(title: string): string[] {
  return title
    .replace(/[#/()-]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1)
    .filter((token) => !QUERY_TITLE_STOPWORDS.has(token.toLocaleLowerCase()));
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
