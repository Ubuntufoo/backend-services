import type { EbayApiClient } from '@/api/client.js';

const BROWSE_SEARCH_PATH = '/buy/browse/v1/item_summary/search';
const BROWSE_ORIGINS = new Set(['https://api.ebay.com', 'https://api.sandbox.ebay.com']);

export interface Money {
  value: number;
  currency: string;
}

export interface BrowseSearchPageInput {
  query: string;
  marketplaceId: string;
  categoryId: string;
  conditionId: string;
  currency: string;
  minItemPrice: number;
  maxItemPrice: number;
  excludeSellerUsername: string;
  context: {
    country: string;
    postalCode: string;
  };
  limit: number;
  offset?: number;
  next?: string;
}

export interface BrowseSearchPageItem {
  legacyItemId: string;
  title: string;
  condition: string | null;
  conditionId: string | null;
  itemPrice: Money;
  shippingCost: Money | null;
  shippingType: string | null;
  itemUrl: string;
}

export interface BrowseSearchPage {
  items: BrowseSearchPageItem[];
  next: string | null;
  total: number | null;
}

export class BrowseMalformedResponseError extends Error {
  constructor(message: string) {
    super(`Malformed Browse response: ${message}`);
    this.name = 'BrowseMalformedResponseError';
  }
}

interface BrowseItemSummaryResponse {
  itemSummaries?: unknown;
  next?: unknown;
  total?: unknown;
}

function requireNonEmptyString(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name} is required and must be a non-empty string`);
  }
}

function requireFiniteNumber(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${name} is required and must be a finite number`);
  }
}

function parseMoney(value: unknown, name: string): Money {
  if (!value || typeof value !== 'object') {
    throw new BrowseMalformedResponseError(`${name} must be an object`);
  }

  const amount = value as { value?: unknown; currency?: unknown };
  if (typeof amount.value !== 'string' || amount.value.trim() === '') {
    throw new BrowseMalformedResponseError(`${name}.value must be a non-empty decimal string`);
  }
  if (typeof amount.currency !== 'string' || amount.currency.length === 0) {
    throw new BrowseMalformedResponseError(`${name}.currency must be a non-empty string`);
  }

  const numericValue = Number(amount.value);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    throw new BrowseMalformedResponseError(`${name}.value must be a non-negative finite number`);
  }

  return { value: numericValue, currency: amount.currency };
}

function parseNullableString(value: unknown, name: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new BrowseMalformedResponseError(`${name} must be a string when provided`);
  }
  return value;
}

function parseShipping(
  value: unknown,
  itemCurrency: string
): Pick<BrowseSearchPageItem, 'shippingCost' | 'shippingType'> {
  if (!Array.isArray(value)) {
    return { shippingCost: null, shippingType: null };
  }

  for (const [index, option] of value.entries()) {
    try {
      if (!option || typeof option !== 'object') {
        continue;
      }

      const shippingOption = option as { shippingCost?: unknown; shippingCostType?: unknown };
      const shippingCost = parseMoney(
        shippingOption.shippingCost,
        `shippingOptions[${index}].shippingCost`
      );
      if (shippingCost.currency !== itemCurrency) {
        continue;
      }

      return {
        shippingCost,
        shippingType: parseNullableString(
          shippingOption.shippingCostType,
          `shippingOptions[${index}].shippingCostType`
        ),
      };
    } catch (error) {
      if (!(error instanceof BrowseMalformedResponseError)) {
        throw error;
      }
    }
  }

  return { shippingCost: null, shippingType: null };
}

function parseItem(value: unknown, index: number): BrowseSearchPageItem {
  if (!value || typeof value !== 'object') {
    throw new BrowseMalformedResponseError(`itemSummaries[${index}] must be an object`);
  }

  const item = value as {
    legacyItemId?: unknown;
    title?: unknown;
    condition?: unknown;
    conditionId?: unknown;
    price?: unknown;
    shippingOptions?: unknown;
    itemWebUrl?: unknown;
  };
  if (typeof item.legacyItemId !== 'string' || item.legacyItemId.length === 0) {
    throw new BrowseMalformedResponseError(
      `itemSummaries[${index}].legacyItemId must be a non-empty string`
    );
  }
  if (typeof item.title !== 'string' || item.title.length === 0) {
    throw new BrowseMalformedResponseError(
      `itemSummaries[${index}].title must be a non-empty string`
    );
  }
  if (typeof item.itemWebUrl !== 'string' || item.itemWebUrl.length === 0) {
    throw new BrowseMalformedResponseError(
      `itemSummaries[${index}].itemWebUrl must be a non-empty string`
    );
  }

  const itemPrice = parseMoney(item.price, `itemSummaries[${index}].price`);
  const shipping = parseShipping(item.shippingOptions, itemPrice.currency);

  return {
    legacyItemId: item.legacyItemId,
    title: item.title,
    condition: parseNullableString(item.condition, `itemSummaries[${index}].condition`),
    conditionId: parseNullableString(item.conditionId, `itemSummaries[${index}].conditionId`),
    itemPrice,
    ...shipping,
    itemUrl: item.itemWebUrl,
  };
}

function parseContinuationOffset(value: unknown): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string' || value.length === 0) {
    throw new BrowseMalformedResponseError('next must be a non-empty string when provided');
  }

  let url: URL;
  try {
    url = new URL(value, 'https://api.ebay.com');
  } catch {
    throw new BrowseMalformedResponseError('next must be a valid Browse search URL');
  }

  const isRelative = value.startsWith('/') && !value.startsWith('//');
  if ((!isRelative && !BROWSE_ORIGINS.has(url.origin)) || url.pathname !== BROWSE_SEARCH_PATH) {
    throw new BrowseMalformedResponseError(
      'next must target the Browse item-summary search endpoint'
    );
  }

  const offset = url.searchParams.get('offset');
  if (offset === null || !/^\d+$/.test(offset)) {
    throw new BrowseMalformedResponseError('next must contain a non-negative integer offset');
  }

  const numericOffset = Number(offset);
  if (!Number.isSafeInteger(numericOffset)) {
    throw new BrowseMalformedResponseError('next offset must be a safe integer');
  }

  return numericOffset;
}

function buildInitialParams(input: BrowseSearchPageInput): Record<string, string | number> {
  return {
    q: input.query,
    category_ids: input.categoryId,
    limit: input.limit,
    ...(input.offset === undefined ? {} : { offset: input.offset }),
    filter: [
      'buyingOptions:{FIXED_PRICE}',
      `conditionIds:{${input.conditionId}}`,
      `excludeSellers:{${input.excludeSellerUsername}}`,
      `price:[${input.minItemPrice}..${input.maxItemPrice}]`,
      `priceCurrency:${input.currency}`,
    ].join(','),
  };
}

function validateInput(input: BrowseSearchPageInput): void {
  requireNonEmptyString(input.query, 'query');
  requireNonEmptyString(input.marketplaceId, 'marketplaceId');
  requireNonEmptyString(input.categoryId, 'categoryId');
  requireNonEmptyString(input.conditionId, 'conditionId');
  requireNonEmptyString(input.currency, 'currency');
  requireNonEmptyString(input.excludeSellerUsername, 'excludeSellerUsername');
  requireNonEmptyString(input.context?.country, 'context.country');
  requireNonEmptyString(input.context?.postalCode, 'context.postalCode');
  requireFiniteNumber(input.minItemPrice, 'minItemPrice');
  requireFiniteNumber(input.maxItemPrice, 'maxItemPrice');
  requireFiniteNumber(input.limit, 'limit');

  if (input.minItemPrice < 0 || input.maxItemPrice < input.minItemPrice) {
    throw new Error(
      'minItemPrice and maxItemPrice must be non-negative with minItemPrice <= maxItemPrice'
    );
  }
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 200) {
    throw new Error('limit must be an integer from 1 through 200');
  }
  if (input.offset !== undefined && (!Number.isSafeInteger(input.offset) || input.offset < 0)) {
    throw new Error('offset must be a non-negative safe integer when provided');
  }
  if (input.next !== undefined && input.offset !== undefined) {
    throw new Error('next and offset cannot both be provided');
  }
}

function parsePage(value: unknown): BrowseSearchPage {
  if (!value || typeof value !== 'object') {
    throw new BrowseMalformedResponseError('response must be an object');
  }

  const response = value as BrowseItemSummaryResponse;
  if (!Array.isArray(response.itemSummaries)) {
    throw new BrowseMalformedResponseError('itemSummaries must be an array');
  }
  if (
    response.total !== undefined &&
    (typeof response.total !== 'number' || !Number.isInteger(response.total) || response.total < 0)
  ) {
    throw new BrowseMalformedResponseError('total must be a non-negative integer when provided');
  }

  const continuationOffset = parseContinuationOffset(response.next);
  return {
    items: response.itemSummaries.map(parseItem),
    next: continuationOffset === null ? null : `${BROWSE_SEARCH_PATH}?offset=${continuationOffset}`,
    total: response.total ?? null,
  };
}

/** A read-only, one-page adapter for eBay Buy Browse item-summary search. */
export class BrowseApi {
  constructor(private readonly client: EbayApiClient) {}

  async search(input: BrowseSearchPageInput): Promise<BrowseSearchPage> {
    validateInput(input);
    const continuationOffset =
      input.next === undefined ? null : parseContinuationOffset(input.next);
    const params = buildInitialParams({
      ...input,
      offset: continuationOffset ?? input.offset,
    });

    const response = await this.client.getWithApplicationToken<unknown>(
      BROWSE_SEARCH_PATH,
      params,
      {
        headers: {
          'X-EBAY-C-MARKETPLACE-ID': input.marketplaceId,
          'X-EBAY-C-ENDUSERCTX': `contextualLocation=country=${input.context.country},zip=${input.context.postalCode}`,
        },
      }
    );

    return parsePage(response);
  }
}
