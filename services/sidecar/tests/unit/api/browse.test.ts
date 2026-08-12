import { describe, expect, it, vi } from 'vitest';
import {
  BrowseApi,
  BrowseMalformedResponseError,
  type BrowseSearchPageInput,
} from '@/api/buy/browse.js';
import type { EbayApiClient } from '@/api/client.js';

const input: BrowseSearchPageInput = {
  query: '1974 Topps Dave Winfield #456',
  marketplaceId: 'EBAY_US',
  categoryId: '261328',
  conditionId: '3000',
  currency: 'USD',
  minItemPrice: 1.25,
  maxItemPrice: 35.5,
  excludeSellerUsername: 'seller-username-is-request-only',
  context: { country: 'US', postalCode: '10001' },
  limit: 100,
  offset: 0,
};

function createApi(response: unknown) {
  const client = {
    getWithApplicationToken: vi.fn().mockResolvedValue(response),
  } as unknown as EbayApiClient;

  return { api: new BrowseApi(client), client };
}

describe('BrowseApi', () => {
  it('uses the Application-token seam with the exact Browse request contract', async () => {
    const { api, client } = createApi({ itemSummaries: [] });

    await expect(api.search(input)).resolves.toEqual({ items: [], next: null, total: null });

    expect(client.getWithApplicationToken).toHaveBeenCalledWith(
      '/buy/browse/v1/item_summary/search',
      {
        q: '1974 Topps Dave Winfield #456',
        category_ids: '261328',
        limit: 100,
        offset: 0,
        filter:
          'buyingOptions:{FIXED_PRICE},conditionIds:{3000},excludeSellers:{seller-username-is-request-only},price:[1.25..35.5],priceCurrency:USD',
      },
      {
        headers: {
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
          'X-EBAY-C-ENDUSERCTX': 'contextualLocation=country=US,zip=10001',
        },
      }
    );
  });

  it('parses only the approved fields in eBay result order', async () => {
    const { api } = createApi({
      total: 2,
      next: 'https://api.ebay.com/buy/browse/v1/item_summary/search?q=next-page&offset=100&filter=excludeSellers%3A%7Bmust-not-be-returned%7D',
      itemSummaries: [
        {
          legacyItemId: '111',
          title: 'First result',
          condition: 'Used',
          conditionId: '3000',
          price: { value: '12.34', currency: 'USD' },
          shippingOptions: [
            { shippingCost: { value: '0', currency: 'USD' }, shippingCostType: 'FIXED' },
          ],
          itemWebUrl: 'https://www.ebay.com/itm/111',
          seller: { username: 'must-not-be-returned' },
        },
        {
          legacyItemId: '222',
          title: 'Second result',
          price: { value: '7.5', currency: 'USD' },
          shippingOptions: [
            { shippingCost: { value: '4', currency: 'CAD' }, shippingCostType: 'CALCULATED' },
          ],
          itemWebUrl: 'https://www.ebay.com/itm/222',
        },
      ],
    });

    await expect(api.search(input)).resolves.toEqual({
      total: 2,
      next: '/buy/browse/v1/item_summary/search?offset=100',
      items: [
        {
          legacyItemId: '111',
          title: 'First result',
          condition: 'Used',
          conditionId: '3000',
          itemPrice: { value: 12.34, currency: 'USD' },
          shippingCost: { value: 0, currency: 'USD' },
          shippingType: 'FIXED',
          itemUrl: 'https://www.ebay.com/itm/111',
        },
        {
          legacyItemId: '222',
          title: 'Second result',
          condition: null,
          conditionId: null,
          itemPrice: { value: 7.5, currency: 'USD' },
          shippingCost: null,
          shippingType: null,
          itemUrl: 'https://www.ebay.com/itm/222',
        },
      ],
    });
  });

  it('uses the first usable same-currency shipping option and retains calculated type', async () => {
    const { api } = createApi({
      itemSummaries: [
        {
          legacyItemId: '333',
          title: 'Calculated shipping',
          price: { value: '20', currency: 'USD' },
          shippingOptions: [
            { shippingCost: { value: '5', currency: 'CAD' }, shippingCostType: 'FIXED' },
            { shippingCost: { value: '3.25', currency: 'USD' }, shippingCostType: 'CALCULATED' },
          ],
          itemWebUrl: 'https://www.ebay.com/itm/333',
        },
      ],
    });

    await expect(api.search(input)).resolves.toMatchObject({
      items: [
        {
          shippingCost: { value: 3.25, currency: 'USD' },
          shippingType: 'CALCULATED',
        },
      ],
    });
  });

  it('accepts zero-result pages and does not expose the seller exclusion input', async () => {
    const { api } = createApi({ itemSummaries: [], total: 0 });

    const result = await api.search(input);

    expect(result).toEqual({ items: [], next: null, total: 0 });
    expect(JSON.stringify(result)).not.toContain(input.excludeSellerUsername);
  });

  it('rebuilds a sanitized continuation request from typed input and its offset', async () => {
    const { api, client } = createApi({ itemSummaries: [] });

    await api.search({
      ...input,
      offset: undefined,
      next: '/buy/browse/v1/item_summary/search?q=next-page&offset=100&filter=excludeSellers%3A%7Bmust-not-be-returned%7D',
    });

    expect(client.getWithApplicationToken).toHaveBeenCalledWith(
      '/buy/browse/v1/item_summary/search',
      {
        q: input.query,
        category_ids: input.categoryId,
        limit: input.limit,
        offset: 100,
        filter:
          'buyingOptions:{FIXED_PRICE},conditionIds:{3000},excludeSellers:{seller-username-is-request-only},price:[1.25..35.5],priceCurrency:USD',
      },
      expect.anything()
    );
  });

  it('does not expose seller exclusion data from eBay next responses', async () => {
    const { api } = createApi({
      itemSummaries: [],
      next: 'https://api.ebay.com/buy/browse/v1/item_summary/search?offset=100&filter=excludeSellers%3A%7Bseller-username-is-request-only%7D',
    });

    const result = await api.search(input);

    expect(result.next).toBe('/buy/browse/v1/item_summary/search?offset=100');
    expect(JSON.stringify(result)).not.toContain(input.excludeSellerUsername);
  });

  it('rejects arbitrary-host continuations before the Application-token request', async () => {
    const { api, client } = createApi({ itemSummaries: [] });

    await expect(
      api.search({
        ...input,
        offset: undefined,
        next: 'https://example.test/buy/browse/v1/item_summary/search',
      })
    ).rejects.toThrow(BrowseMalformedResponseError);
    expect(client.getWithApplicationToken).not.toHaveBeenCalled();
  });

  it('rejects malformed item, pagination, and structureless payloads predictably', async () => {
    const malformedItem = createApi({
      itemSummaries: [
        { legacyItemId: '444', title: 'No price', itemWebUrl: 'https://www.ebay.com/itm/444' },
      ],
    });
    const malformedPage = createApi({ itemSummaries: [], next: 'https://example.test/not-browse' });
    const structurelessPage = createApi({});

    await expect(malformedItem.api.search(input)).rejects.toThrow(BrowseMalformedResponseError);
    await expect(malformedPage.api.search(input)).rejects.toThrow(BrowseMalformedResponseError);
    await expect(structurelessPage.api.search(input)).rejects.toThrow(BrowseMalformedResponseError);
  });

  it('rejects limits above eBay Browse maximum', async () => {
    const { api, client } = createApi({ itemSummaries: [] });

    await expect(api.search({ ...input, limit: 201 })).rejects.toThrow(
      'limit must be an integer from 1 through 200'
    );
    expect(client.getWithApplicationToken).not.toHaveBeenCalled();
  });
});
