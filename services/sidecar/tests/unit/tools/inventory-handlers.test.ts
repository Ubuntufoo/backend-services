import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EbaySellerApi } from '@/api/index.js';
import { inventoryHandlers } from '@/tools/tool-handlers/inventory.js';

const publishCases = [
  {
    name: 'ebay_publish_offer' as const,
    method: 'publishOffer' as const,
    args: { offerId: 'offer-1' },
  },
  {
    name: 'ebay_bulk_publish_offer' as const,
    method: 'bulkPublishOffer' as const,
    args: { requests: { requests: [{ offerId: 'offer-1' }] } },
  },
  {
    name: 'ebay_publish_offer_by_inventory_item_group' as const,
    method: 'publishOfferByInventoryItemGroup' as const,
    args: { request: { inventoryItemGroupKey: 'group-1', marketplaceId: 'EBAY_US' } },
  },
];

function api(): EbaySellerApi {
  return {
    inventory: {
      publishOffer: vi.fn(),
      bulkPublishOffer: vi.fn(),
      publishOfferByInventoryItemGroup: vi.fn(),
      withdrawOffer: vi.fn(),
    },
  } as unknown as EbaySellerApi;
}

describe('eBay inventory publish handlers', () => {
  let previousPublishEnabled: string | undefined;

  beforeEach(() => {
    previousPublishEnabled = process.env.EBAY_PUBLISH_ENABLED;
  });

  afterEach(() => {
    if (previousPublishEnabled === undefined) delete process.env.EBAY_PUBLISH_ENABLED;
    else process.env.EBAY_PUBLISH_ENABLED = previousPublishEnabled;
  });

  it.each(publishCases)('blocks $name before the API call when publishing is disabled', async ({ name, method, args }) => {
    process.env.EBAY_PUBLISH_ENABLED = 'false';
    const sellerApi = api();

    await expect(inventoryHandlers[name](sellerApi, args)).rejects.toThrow(
      'eBay publishing is disabled. Set EBAY_PUBLISH_ENABLED=true only for an authorized publish window.'
    );
    expect(sellerApi.inventory[method]).not.toHaveBeenCalled();
  });

  it.each(publishCases)('calls $name during an enabled publish window', async ({ name, method, args }) => {
    process.env.EBAY_PUBLISH_ENABLED = 'true';
    const sellerApi = api();

    await inventoryHandlers[name](sellerApi, args);

    expect(sellerApi.inventory[method]).toHaveBeenCalledTimes(1);
  });

  it('keeps withdrawal available when publishing is disabled', async () => {
    process.env.EBAY_PUBLISH_ENABLED = 'false';
    const sellerApi = api();

    await inventoryHandlers.ebay_withdraw_offer(sellerApi, { offerId: 'offer-1' });

    expect(sellerApi.inventory.withdrawOffer).toHaveBeenCalledWith('offer-1');
  });
});
