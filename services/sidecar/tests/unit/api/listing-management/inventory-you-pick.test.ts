import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InventoryApi } from '@/api/listing-management/inventory.js';
import type { EbayApiClient } from '@/api/client.js';

describe('InventoryApi guarded You Pick mutation headers', () => {
  let client: EbayApiClient;
  let api: InventoryApi;
  const config = { headers: { 'Content-Language': 'en-US' } };

  beforeEach(() => {
    client = {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    } as unknown as EbayApiClient;
    api = new InventoryApi(client);
  });

  it('forwards explicit en-US on every pilot mutation wrapper', async () => {
    vi.mocked(client.post).mockImplementation(async (path) =>
      path.endsWith('/offer')
        ? { offerId: 'OFFER-1' }
        : path.includes('publish')
          ? { listingId: 'LISTING-1' }
          : {}
    );
    vi.mocked(client.put).mockResolvedValue(undefined);
    vi.mocked(client.delete).mockResolvedValue(undefined);
    const item = { condition: 'USED_VERY_GOOD', product: { aspects: { Card: ['A'] } } };
    const offer = {
      sku: 'SKU-1',
      marketplaceId: 'EBAY_US',
      format: 'FIXED_PRICE',
      categoryId: '261328',
      listingPolicies: { fulfillmentPolicyId: 'F', paymentPolicyId: 'P', returnPolicyId: 'R' },
      pricingSummary: { price: { currency: 'USD', value: '1.11' } },
    };
    const group = { variantSKUs: ['SKU-1', 'SKU-2'] };

    await api.createOrReplaceInventoryItem('SKU-1', item as any, config);
    await api.createOffer(offer as any, config);
    await api.createOrReplaceInventoryItemGroup('GROUP-1', group, config);
    await api.bulkUpdatePriceQuantity({ requests: [] }, config);
    await api.publishOfferByInventoryItemGroup(
      { inventoryItemGroupKey: 'GROUP-1', marketplaceId: 'EBAY_US' },
      config
    );
    await api.withdrawOfferByInventoryItemGroup(
      { inventoryItemGroupKey: 'GROUP-1', marketplaceId: 'EBAY_US' },
      config
    );
    await api.deleteOffer('OFFER-1', config);
    await api.deleteInventoryItemGroup('GROUP-1', config);
    await api.deleteInventoryItem('SKU-1', config);

    expect(client.put).toHaveBeenNthCalledWith(
      1,
      '/sell/inventory/v1/inventory_item/SKU-1',
      item,
      config
    );
    expect(client.put).toHaveBeenNthCalledWith(
      2,
      '/sell/inventory/v1/inventory_item_group/GROUP-1',
      group,
      config
    );
    expect(vi.mocked(client.post).mock.calls.every((call) => call[2] === config)).toBe(true);
    expect(vi.mocked(client.delete).mock.calls.every((call) => call[1] === config)).toBe(true);
  });

  it('preserves omitted-config call shapes for existing callers', async () => {
    vi.mocked(client.put).mockResolvedValue(undefined);
    vi.mocked(client.post).mockResolvedValue({ offerId: 'OFFER-1' });
    vi.mocked(client.delete).mockResolvedValue(undefined);
    await api.createOrReplaceInventoryItem('SKU-1', {} as any);
    await api.createOffer({} as any);
    await api.deleteInventoryItem('SKU-1');
    expect(client.put).toHaveBeenCalledWith('/sell/inventory/v1/inventory_item/SKU-1', {});
    expect(client.post).toHaveBeenCalledWith('/sell/inventory/v1/offer', {});
    expect(client.delete).toHaveBeenCalledWith('/sell/inventory/v1/inventory_item/SKU-1');
  });
});
