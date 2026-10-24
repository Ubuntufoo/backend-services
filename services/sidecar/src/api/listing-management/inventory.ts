import type { components } from '../../types/sell-apps/listing-management/sellInventoryV1Oas3.js';
import type { EbayApiClient } from '../client.js';
import { buildValidatedPaginatedParams } from '../shared/query-params.js';
import {
  buildOptionalStringParams,
  optionalStringParam,
  requireObject,
  requireString,
  withApiError,
} from '../shared/request.js';

type EbayOfferDetailsWithKeys = components['schemas']['EbayOfferDetailsWithKeys'];
type InventoryItem = components['schemas']['InventoryItem'];
type GetInventoryItemResponse = components['schemas']['InventoryItemWithSkuLocaleGroupid'];
type GetInventoryItemsResponse = components['schemas']['InventoryItems'];
type CreateOfferResponse = components['schemas']['OfferResponse'];
type GetOffersResponse = components['schemas']['Offers'];
type PublishResponse = components['schemas']['PublishResponse'];
export type InventoryRequestConfig = Parameters<EbayApiClient['post']>[2];
export type InventoryItemGroup = Omit<
  components['schemas']['InventoryItemGroup'],
  'aspects' | 'variantSKUs'
> & {
  aspects?: Record<string, string[]>;
  variantSKUs: string[];
};
type InventoryItemGroupUpsertResponse = components['schemas']['BaseResponse'] | void;
export type PublishByInventoryItemGroupRequest = Required<
  components['schemas']['PublishByInventoryItemGroupRequest']
>;
export type WithdrawByInventoryItemGroupRequest = Required<
  components['schemas']['WithdrawByInventoryItemGroupRequest']
>;

/**
 * Inventory API - Manage listings and inventory
 * Based on: docs/sell-apps/listing-management/sell_inventory_v1_oas3.json
 */
export class InventoryApi {
  private readonly basePath = '/sell/inventory/v1';

  constructor(private client: EbayApiClient) {}

  private async request<T>(failureMessage: string, operation: () => Promise<T>): Promise<T> {
    return await withApiError(failureMessage, operation);
  }

  /**
   * Get all inventory items
   * @throws Error if parameters are invalid
   */
  async getInventoryItems(limit?: number, offset?: number): Promise<GetInventoryItemsResponse> {
    const params = buildValidatedPaginatedParams(undefined, limit, offset);

    return await this.request('Failed to get inventory items', () =>
      this.client.get<GetInventoryItemsResponse>(`${this.basePath}/inventory_item`, params)
    );
  }

  /**
   * Get a specific inventory item
   * @throws Error if required parameters are missing or invalid
   */
  async getInventoryItem(sku: string): Promise<GetInventoryItemResponse> {
    requireString(sku, 'sku');

    return await this.request('Failed to get inventory item', () =>
      this.client.get<GetInventoryItemResponse>(`${this.basePath}/inventory_item/${sku}`)
    );
  }

  /**
   * Create or replace an inventory item
   * @throws Error if required parameters are missing or invalid
   */
  async createOrReplaceInventoryItem(
    sku: string,
    inventoryItem: InventoryItem,
    config?: InventoryRequestConfig
  ): Promise<void> {
    requireString(sku, 'sku');
    requireObject(inventoryItem, 'inventoryItem');

    return await this.request('Failed to create or replace inventory item', () =>
      config
        ? this.client.put<void>(`${this.basePath}/inventory_item/${sku}`, inventoryItem, config)
        : this.client.put<void>(`${this.basePath}/inventory_item/${sku}`, inventoryItem)
    );
  }

  /**
   * Delete an inventory item
   * @throws Error if required parameters are missing or invalid
   */
  async deleteInventoryItem(sku: string, config?: InventoryRequestConfig): Promise<void> {
    requireString(sku, 'sku');

    return await this.request('Failed to delete inventory item', () =>
      config
        ? this.client.delete<void>(`${this.basePath}/inventory_item/${sku}`, config)
        : this.client.delete<void>(`${this.basePath}/inventory_item/${sku}`)
    );
  }

  /**
   * Bulk create or replace inventory items
   * Endpoint: POST /bulk_create_or_replace_inventory_item
   * @throws Error if required parameters are missing or invalid
   */
  async bulkCreateOrReplaceInventoryItem(requests: Record<string, unknown>): Promise<unknown> {
    requireObject(requests, 'requests');

    return await this.request('Failed to bulk create or replace inventory items', () =>
      this.client.post(`${this.basePath}/bulk_create_or_replace_inventory_item`, requests)
    );
  }

  /**
   * Bulk get inventory items
   * Endpoint: POST /bulk_get_inventory_item
   * @throws Error if required parameters are missing or invalid
   */
  async bulkGetInventoryItem(requests: Record<string, unknown>): Promise<unknown> {
    requireObject(requests, 'requests');

    return await this.request('Failed to bulk get inventory items', () =>
      this.client.post(`${this.basePath}/bulk_get_inventory_item`, requests)
    );
  }

  /**
   * Bulk update price and quantity
   * Endpoint: POST /bulk_update_price_quantity
   * @throws Error if required parameters are missing or invalid
   */
  async bulkUpdatePriceQuantity(
    requests: Record<string, unknown>,
    config?: InventoryRequestConfig
  ): Promise<unknown> {
    requireObject(requests, 'requests');

    return await this.request('Failed to bulk update price and quantity', () =>
      config
        ? this.client.post(`${this.basePath}/bulk_update_price_quantity`, requests, config)
        : this.client.post(`${this.basePath}/bulk_update_price_quantity`, requests)
    );
  }

  /**
   * Get product compatibility for an inventory item
   * Endpoint: GET /inventory_item/{sku}/product_compatibility
   * @throws Error if required parameters are missing or invalid
   */
  async getProductCompatibility(sku: string): Promise<unknown> {
    requireString(sku, 'sku');

    return await this.request('Failed to get product compatibility', () =>
      this.client.get(`${this.basePath}/inventory_item/${sku}/product_compatibility`)
    );
  }

  /**
   * Create or replace product compatibility for an inventory item
   * Endpoint: PUT /inventory_item/{sku}/product_compatibility
   * @throws Error if required parameters are missing or invalid
   */
  async createOrReplaceProductCompatibility(
    sku: string,
    compatibility: Record<string, unknown>
  ): Promise<unknown> {
    requireString(sku, 'sku');
    requireObject(compatibility, 'compatibility');

    return await this.request('Failed to create or replace product compatibility', () =>
      this.client.put(`${this.basePath}/inventory_item/${sku}/product_compatibility`, compatibility)
    );
  }

  /**
   * Delete product compatibility for an inventory item
   * Endpoint: DELETE /inventory_item/{sku}/product_compatibility
   * @throws Error if required parameters are missing or invalid
   */
  async deleteProductCompatibility(sku: string): Promise<void> {
    requireString(sku, 'sku');

    return await this.request('Failed to delete product compatibility', () =>
      this.client.delete(`${this.basePath}/inventory_item/${sku}/product_compatibility`)
    );
  }

  /**
   * Get an inventory item group
   * Endpoint: GET /inventory_item_group/{inventoryItemGroupKey}
   * @throws Error if required parameters are missing or invalid
   */
  async getInventoryItemGroup(inventoryItemGroupKey: string): Promise<InventoryItemGroup> {
    requireString(inventoryItemGroupKey, 'inventoryItemGroupKey');

    return await this.request('Failed to get inventory item group', () =>
      this.client.get<InventoryItemGroup>(
        `${this.basePath}/inventory_item_group/${inventoryItemGroupKey}`
      )
    );
  }

  /**
   * Create or replace an inventory item group
   * Endpoint: PUT /inventory_item_group/{inventoryItemGroupKey}
   * @throws Error if required parameters are missing or invalid
   */
  async createOrReplaceInventoryItemGroup(
    inventoryItemGroupKey: string,
    inventoryItemGroup: InventoryItemGroup,
    config?: InventoryRequestConfig
  ): Promise<InventoryItemGroupUpsertResponse> {
    requireString(inventoryItemGroupKey, 'inventoryItemGroupKey');
    requireObject(inventoryItemGroup, 'inventoryItemGroup');

    return await this.request('Failed to create or replace inventory item group', () =>
      config
        ? this.client.put<InventoryItemGroupUpsertResponse>(
            `${this.basePath}/inventory_item_group/${inventoryItemGroupKey}`,
            inventoryItemGroup,
            config
          )
        : this.client.put<InventoryItemGroupUpsertResponse>(
            `${this.basePath}/inventory_item_group/${inventoryItemGroupKey}`,
            inventoryItemGroup
          )
    );
  }

  /**
   * Delete an inventory item group
   * Endpoint: DELETE /inventory_item_group/{inventoryItemGroupKey}
   * @throws Error if required parameters are missing or invalid
   */
  async deleteInventoryItemGroup(
    inventoryItemGroupKey: string,
    config?: InventoryRequestConfig
  ): Promise<void> {
    requireString(inventoryItemGroupKey, 'inventoryItemGroupKey');

    return await this.request('Failed to delete inventory item group', () =>
      config
        ? this.client.delete(
            `${this.basePath}/inventory_item_group/${inventoryItemGroupKey}`,
            config
          )
        : this.client.delete(`${this.basePath}/inventory_item_group/${inventoryItemGroupKey}`)
    );
  }

  /**
   * Get all inventory locations
   * Endpoint: GET /location
   * @throws Error if parameters are invalid
   */
  async getInventoryLocations(limit?: number, offset?: number): Promise<unknown> {
    const params = buildValidatedPaginatedParams(undefined, limit, offset);

    return await this.request('Failed to get inventory locations', () =>
      this.client.get(`${this.basePath}/location`, params)
    );
  }

  /**
   * Get a specific inventory location
   * Endpoint: GET /location/{merchantLocationKey}
   * @throws Error if required parameters are missing or invalid
   */
  async getInventoryLocation(merchantLocationKey: string): Promise<unknown> {
    requireString(merchantLocationKey, 'merchantLocationKey');

    return await this.request('Failed to get inventory location', () =>
      this.client.get(`${this.basePath}/location/${merchantLocationKey}`)
    );
  }

  /**
   * Create or replace an inventory location
   * Endpoint: POST /location/{merchantLocationKey}
   * @throws Error if required parameters are missing or invalid
   */
  async createOrReplaceInventoryLocation(
    merchantLocationKey: string,
    location: Record<string, unknown>
  ): Promise<void> {
    requireString(merchantLocationKey, 'merchantLocationKey');
    requireObject(location, 'location');

    return await this.request('Failed to create or replace inventory location', () =>
      this.client.post(`${this.basePath}/location/${merchantLocationKey}`, location)
    );
  }

  /**
   * Delete an inventory location
   * Endpoint: DELETE /location/{merchantLocationKey}
   * @throws Error if required parameters are missing or invalid
   */
  async deleteInventoryLocation(merchantLocationKey: string): Promise<void> {
    requireString(merchantLocationKey, 'merchantLocationKey');

    return await this.request('Failed to delete inventory location', () =>
      this.client.delete(`${this.basePath}/location/${merchantLocationKey}`)
    );
  }

  /**
   * Disable an inventory location
   * Endpoint: POST /location/{merchantLocationKey}/disable
   * @throws Error if required parameters are missing or invalid
   */
  async disableInventoryLocation(merchantLocationKey: string): Promise<unknown> {
    requireString(merchantLocationKey, 'merchantLocationKey');

    return await this.request('Failed to disable inventory location', () =>
      this.client.post(`${this.basePath}/location/${merchantLocationKey}/disable`, {})
    );
  }

  /**
   * Enable an inventory location
   * Endpoint: POST /location/{merchantLocationKey}/enable
   * @throws Error if required parameters are missing or invalid
   */
  async enableInventoryLocation(merchantLocationKey: string): Promise<unknown> {
    requireString(merchantLocationKey, 'merchantLocationKey');

    return await this.request('Failed to enable inventory location', () =>
      this.client.post(`${this.basePath}/location/${merchantLocationKey}/enable`, {})
    );
  }

  /**
   * Update location details
   * Endpoint: POST /location/{merchantLocationKey}/update_location_details
   * @throws Error if required parameters are missing or invalid
   */
  async updateLocationDetails(
    merchantLocationKey: string,
    locationDetails: Record<string, unknown>
  ): Promise<void> {
    requireString(merchantLocationKey, 'merchantLocationKey');
    requireObject(locationDetails, 'locationDetails');

    return await this.request('Failed to update location details', () =>
      this.client.post(
        `${this.basePath}/location/${merchantLocationKey}/update_location_details`,
        locationDetails
      )
    );
  }

  /**
   * Get all offers
   * @throws Error if parameters are invalid
   */
  async getOffers(
    sku?: string,
    marketplaceId?: string,
    limit?: number,
    offset?: number
  ): Promise<GetOffersResponse> {
    const params = buildOptionalStringParams({ sku });
    const marketplaceIdParam = optionalStringParam(marketplaceId, 'marketplaceId');
    if (marketplaceIdParam) {
      params.marketplace_id = marketplaceIdParam;
    }

    if (limit !== undefined) {
      if (typeof limit !== 'number' || limit < 1) {
        throw new Error('limit must be a positive number when provided');
      }
      params.limit = limit;
    }
    if (offset !== undefined) {
      if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0) {
        throw new Error('offset must be a non-negative integer when provided');
      }
      params.offset = offset;
    }

    return await this.request('Failed to get offers', () =>
      this.client.get<GetOffersResponse>(`${this.basePath}/offer`, params)
    );
  }

  /**
   * Read every offer for a SKU without marketplace filtering. The Inventory
   * API is paginated and may expose more than one offer (for example an
   * auction and fixed-price offer concurrently); callers that need complete
   * ownership evidence must use this method instead of getOffers(sku,market).
   */
  async getAllOffersForSku(sku: string, limit = 25): Promise<GetOffersResponse> {
    requireString(sku, 'sku');
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error('limit must be a positive integer');
    }
    const offers: NonNullable<GetOffersResponse['offers']> = [];
    let offset = 0;
    let expectedTotal: number | undefined;
    const seenOffsets = new Set<number>();
    for (let page = 0; page < 1000; page += 1) {
      if (seenOffsets.has(offset)) throw new Error('eBay Offer pagination repeated an offset');
      seenOffsets.add(offset);
      let response: GetOffersResponse;
      try {
        response = await this.getOffers(sku, undefined, limit, offset);
      } catch (error) {
        if (page === 0) throw error;
        // A later-page failure (including 404) is incomplete pagination, not
        // proof that the entire SKU's Offer collection is absent. Mask the
        // provider status so the c2b adapter cannot collapse it to [] and
        // continue a destructive flow on partial evidence.
        const paginationError = new Error('eBay Offer pagination became incomplete after the first page.') as Error & {
          statusCode?: number;
          cause?: unknown;
        };
        paginationError.statusCode = 502;
        paginationError.cause = error;
        throw paginationError;
      }
      const rawOffers = response.offers;
      const nextValue = response.next;
      if (nextValue !== undefined && nextValue !== null && typeof nextValue !== 'string') {
        throw new Error('eBay Offer response contains invalid pagination cursor');
      }
      const next = typeof nextValue === 'string' && nextValue.trim() !== '';
      let pageOffers: NonNullable<GetOffersResponse['offers']>;
      if (rawOffers === undefined || rawOffers === null) {
        if (response.total !== 0 || response.size !== undefined && response.size !== 0 || next) {
          throw new Error('eBay Offer response is missing its complete offers collection');
        }
        pageOffers = [];
      } else {
        if (!Array.isArray(rawOffers)) throw new Error('eBay Offer response contains invalid offers');
        pageOffers = rawOffers;
      }
      if (response.size !== undefined &&
        (!Number.isSafeInteger(response.size) || response.size < 0 || response.size !== pageOffers.length)) {
        throw new Error('eBay Offer response contains an invalid page size');
      }
      if (response.total !== undefined) {
        if (!Number.isSafeInteger(response.total) || response.total < 0) throw new Error('eBay Offer response contains invalid total');
        if (expectedTotal !== undefined && expectedTotal !== response.total) throw new Error('eBay Offer response changed total while paging');
        expectedTotal = response.total;
      }
      offers.push(...pageOffers);
      if (!next) {
        if (expectedTotal !== undefined && offers.length !== expectedTotal) throw new Error('eBay Offer pagination ended before the advertised total');
        return { ...response, offers, size: offers.length, total: expectedTotal ?? offers.length, next: undefined };
      }
      const step = response.size ?? pageOffers.length;
      if (step < 1) throw new Error('eBay Offer response contains invalid page size');
      // Inventory API's offset is a page index (0, 1, 2...), not an item
      // count. Advance one page even when a short page is returned.
      offset += 1;
    }
    throw new Error('eBay Offer pagination exceeded the safety bound');
  }

  /**
   * Get a specific offer
   * Endpoint: GET /offer/{offerId}
   * @throws Error if required parameters are missing or invalid
   */
  async getOffer(offerId: string): Promise<unknown> {
    requireString(offerId, 'offerId');

    return await this.request('Failed to get offer', () =>
      this.client.get(`${this.basePath}/offer/${offerId}`)
    );
  }

  /**
   * Create an offer
   * @throws Error if required parameters are missing or invalid
   */
  async createOffer(
    offer: EbayOfferDetailsWithKeys,
    config?: InventoryRequestConfig
  ): Promise<CreateOfferResponse> {
    requireObject(offer, 'offer');

    return await this.request('Failed to create offer', () =>
      config
        ? this.client.post<CreateOfferResponse>(`${this.basePath}/offer`, offer, config)
        : this.client.post<CreateOfferResponse>(`${this.basePath}/offer`, offer)
    );
  }

  /**
   * Update an offer
   * Endpoint: PUT /offer/{offerId}
   * @throws Error if required parameters are missing or invalid
   */
  async updateOffer(offerId: string, offer: Record<string, unknown>): Promise<unknown> {
    requireString(offerId, 'offerId');
    requireObject(offer, 'offer');

    return await this.request('Failed to update offer', () =>
      this.client.put(`${this.basePath}/offer/${offerId}`, offer)
    );
  }

  /**
   * Delete an offer
   * Endpoint: DELETE /offer/{offerId}
   * @throws Error if required parameters are missing or invalid
   */
  async deleteOffer(offerId: string, config?: InventoryRequestConfig): Promise<void> {
    requireString(offerId, 'offerId');

    return await this.request('Failed to delete offer', () =>
      config
        ? this.client.delete(`${this.basePath}/offer/${offerId}`, config)
        : this.client.delete(`${this.basePath}/offer/${offerId}`)
    );
  }

  /**
   * Publish an offer
   * @throws Error if required parameters are missing or invalid
   */
  async publishOffer(offerId: string): Promise<PublishResponse> {
    requireString(offerId, 'offerId');

    return await this.request('Failed to publish offer', () =>
      this.client.post<PublishResponse>(`${this.basePath}/offer/${offerId}/publish`)
    );
  }

  /**
   * Withdraw an offer
   * Endpoint: POST /offer/{offerId}/withdraw
   * @throws Error if required parameters are missing or invalid
   */
  async withdrawOffer(offerId: string): Promise<unknown> {
    requireString(offerId, 'offerId');

    return await this.request('Failed to withdraw offer', () =>
      this.client.post(`${this.basePath}/offer/${offerId}/withdraw`, {})
    );
  }

  /**
   * Bulk create offers
   * Endpoint: POST /bulk_create_offer
   * @throws Error if required parameters are missing or invalid
   */
  async bulkCreateOffer(requests: Record<string, unknown>): Promise<unknown> {
    requireObject(requests, 'requests');

    return await this.request('Failed to bulk create offers', () =>
      this.client.post(`${this.basePath}/bulk_create_offer`, requests)
    );
  }

  /**
   * Bulk publish offers
   * Endpoint: POST /bulk_publish_offer
   * @throws Error if required parameters are missing or invalid
   */
  async bulkPublishOffer(requests: Record<string, unknown>): Promise<unknown> {
    requireObject(requests, 'requests');

    return await this.request('Failed to bulk publish offers', () =>
      this.client.post(`${this.basePath}/bulk_publish_offer`, requests)
    );
  }

  /**
   * Get listing fees for offers
   * Endpoint: POST /offer/get_listing_fees
   * @throws Error if required parameters are missing or invalid
   */
  async getListingFees(offers: Record<string, unknown>): Promise<unknown> {
    requireObject(offers, 'offers');

    return await this.request('Failed to get listing fees', () =>
      this.client.post(`${this.basePath}/offer/get_listing_fees`, offers)
    );
  }

  /**
   * Bulk migrate listings
   * Endpoint: POST /bulk_migrate_listing
   * @throws Error if required parameters are missing or invalid
   */
  async bulkMigrateListing(requests: Record<string, unknown>): Promise<unknown> {
    requireObject(requests, 'requests');

    return await this.request('Failed to bulk migrate listings', () =>
      this.client.post(`${this.basePath}/bulk_migrate_listing`, requests)
    );
  }

  /**
   * Get listing's inventory locations (SKU location mapping)
   * Endpoint: GET /listing/{listingId}/sku/{sku}/locations
   * @throws Error if required parameters are missing or invalid
   */
  async getListingLocations(listingId: string, sku: string): Promise<unknown> {
    requireString(listingId, 'listingId');
    requireString(sku, 'sku');

    return await this.request('Failed to get listing locations', () =>
      this.client.get(`${this.basePath}/listing/${listingId}/sku/${sku}/locations`)
    );
  }

  async createOrReplaceSkuLocationMapping(
    listingId: string,
    sku: string,
    locationMapping: Record<string, unknown>
  ): Promise<void> {
    requireString(listingId, 'listingId');
    requireString(sku, 'sku');
    requireObject(locationMapping, 'locationMapping');

    return await this.request('Failed to create or replace SKU location mapping', () =>
      this.client.put(
        `${this.basePath}/listing/${listingId}/sku/${sku}/locations`,
        locationMapping,
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      )
    );
  }

  async deleteSkuLocationMapping(listingId: string, sku: string): Promise<void> {
    requireString(listingId, 'listingId');
    requireString(sku, 'sku');

    return await this.request('Failed to delete SKU location mapping', () =>
      this.client.delete(`${this.basePath}/listing/${listingId}/sku/${sku}/locations`)
    );
  }

  /**
   * Publish offer by inventory item group
   * Endpoint: POST /offer/publish_by_inventory_item_group
   * @throws Error if required parameters are missing or invalid
   */
  async publishOfferByInventoryItemGroup(
    request: PublishByInventoryItemGroupRequest,
    config?: InventoryRequestConfig
  ): Promise<PublishResponse> {
    requireObject(request, 'request');

    return await this.request('Failed to publish offer by inventory item group', () =>
      config
        ? this.client.post<PublishResponse>(
            `${this.basePath}/offer/publish_by_inventory_item_group`,
            request,
            config
          )
        : this.client.post<PublishResponse>(
            `${this.basePath}/offer/publish_by_inventory_item_group`,
            request
          )
    );
  }

  /**
   * Withdraw offer by inventory item group
   * Endpoint: POST /offer/withdraw_by_inventory_item_group
   * @throws Error if required parameters are missing or invalid
   */
  async withdrawOfferByInventoryItemGroup(
    request: WithdrawByInventoryItemGroupRequest,
    config?: InventoryRequestConfig
  ): Promise<unknown> {
    requireObject(request, 'request');

    return await this.request('Failed to withdraw offer by inventory item group', () =>
      config
        ? this.client.post(
            `${this.basePath}/offer/withdraw_by_inventory_item_group`,
            request,
            config
          )
        : this.client.post(`${this.basePath}/offer/withdraw_by_inventory_item_group`, request)
    );
  }
}
