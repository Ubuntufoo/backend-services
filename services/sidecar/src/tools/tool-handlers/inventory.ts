import type { ToolHandlerMap } from './types.js';

/** Handler map for Inventory API item, offer, location, and bulk tools. */
export const inventoryHandlers: ToolHandlerMap = {
  ebay_get_inventory_items: async (api, args) => {
    return await api.inventory.getInventoryItems(args.limit as number, args.offset as number);
  },

  ebay_get_inventory_item: async (api, args) => {
    return await api.inventory.getInventoryItem(args.sku as string);
  },

  ebay_create_inventory_item: async (api, args) => {
    return await api.inventory.createOrReplaceInventoryItem(
      args.sku as string,
      args.inventoryItem as Record<string, unknown>
    );
  },

  ebay_delete_inventory_item: async (api, args) => {
    return await api.inventory.deleteInventoryItem(args.sku as string);
  },

  ebay_bulk_create_or_replace_inventory_item: async (api, args) => {
    return await api.inventory.bulkCreateOrReplaceInventoryItem(
      args.requests as Record<string, unknown>
    );
  },

  ebay_bulk_get_inventory_item: async (api, args) => {
    return await api.inventory.bulkGetInventoryItem(args.requests as Record<string, unknown>);
  },

  ebay_bulk_update_price_quantity: async (api, args) => {
    return await api.inventory.bulkUpdatePriceQuantity(args.requests as Record<string, unknown>);
  },

  ebay_get_product_compatibility: async (api, args) => {
    return await api.inventory.getProductCompatibility(args.sku as string);
  },

  ebay_create_or_replace_product_compatibility: async (api, args) => {
    return await api.inventory.createOrReplaceProductCompatibility(
      args.sku as string,
      args.compatibility as Record<string, unknown>
    );
  },

  ebay_delete_product_compatibility: async (api, args) => {
    return await api.inventory.deleteProductCompatibility(args.sku as string);
  },

  ebay_get_inventory_item_group: async (api, args) => {
    return await api.inventory.getInventoryItemGroup(args.inventoryItemGroupKey as string);
  },

  ebay_create_or_replace_inventory_item_group: async (api, args) => {
    return await api.inventory.createOrReplaceInventoryItemGroup(
      args.inventoryItemGroupKey as string,
      args.inventoryItemGroup as Record<string, unknown>
    );
  },

  ebay_delete_inventory_item_group: async (api, args) => {
    return await api.inventory.deleteInventoryItemGroup(args.inventoryItemGroupKey as string);
  },

  ebay_get_inventory_locations: async (api, args) => {
    return await api.inventory.getInventoryLocations(args.limit as number, args.offset as number);
  },

  ebay_get_inventory_location: async (api, args) => {
    return await api.inventory.getInventoryLocation(args.merchantLocationKey as string);
  },

  ebay_create_or_replace_inventory_location: async (api, args) => {
    return await api.inventory.createOrReplaceInventoryLocation(
      args.merchantLocationKey as string,
      args.location as Record<string, unknown>
    );
  },

  ebay_delete_inventory_location: async (api, args) => {
    return await api.inventory.deleteInventoryLocation(args.merchantLocationKey as string);
  },

  ebay_disable_inventory_location: async (api, args) => {
    return await api.inventory.disableInventoryLocation(args.merchantLocationKey as string);
  },

  ebay_enable_inventory_location: async (api, args) => {
    return await api.inventory.enableInventoryLocation(args.merchantLocationKey as string);
  },

  ebay_update_location_details: async (api, args) => {
    return await api.inventory.updateLocationDetails(
      args.merchantLocationKey as string,
      args.locationDetails as Record<string, unknown>
    );
  },

  ebay_get_offers: async (api, args) => {
    return await api.inventory.getOffers(
      args.sku as string,
      args.marketplaceId as string,
      args.limit as number
    );
  },

  ebay_get_offer: async (api, args) => {
    return await api.inventory.getOffer(args.offerId as string);
  },

  ebay_create_offer: async (api, args) => {
    return await api.inventory.createOffer(args.offer as Record<string, unknown>);
  },

  ebay_update_offer: async (api, args) => {
    return await api.inventory.updateOffer(
      args.offerId as string,
      args.offer as Record<string, unknown>
    );
  },

  ebay_delete_offer: async (api, args) => {
    return await api.inventory.deleteOffer(args.offerId as string);
  },

  ebay_publish_offer: async (api, args) => {
    return await api.inventory.publishOffer(args.offerId as string);
  },

  ebay_withdraw_offer: async (api, args) => {
    return await api.inventory.withdrawOffer(args.offerId as string);
  },

  ebay_bulk_create_offer: async (api, args) => {
    return await api.inventory.bulkCreateOffer(args.requests as Record<string, unknown>);
  },

  ebay_bulk_publish_offer: async (api, args) => {
    return await api.inventory.bulkPublishOffer(args.requests as Record<string, unknown>);
  },

  ebay_get_listing_fees: async (api, args) => {
    return await api.inventory.getListingFees(args.offers as Record<string, unknown>);
  },

  ebay_bulk_migrate_listing: async (api, args) => {
    return await api.inventory.bulkMigrateListing(args.requests as Record<string, unknown>);
  },

  ebay_get_listing_locations: async (api, args) => {
    return await api.inventory.getListingLocations(args.listingId as string, args.sku as string);
  },

  ebay_create_or_replace_sku_location_mapping: async (api, args) => {
    return await api.inventory.createOrReplaceSkuLocationMapping(
      args.listingId as string,
      args.sku as string,
      args.locationMapping as Record<string, unknown>
    );
  },

  ebay_delete_sku_location_mapping: async (api, args) => {
    return await api.inventory.deleteSkuLocationMapping(
      args.listingId as string,
      args.sku as string
    );
  },

  ebay_publish_offer_by_inventory_item_group: async (api, args) => {
    return await api.inventory.publishOfferByInventoryItemGroup(
      args.request as Record<string, unknown>
    );
  },

  ebay_withdraw_offer_by_inventory_item_group: async (api, args) => {
    return await api.inventory.withdrawOfferByInventoryItemGroup(
      args.request as Record<string, unknown>
    );
  },
};
