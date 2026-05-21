import type { ToolHandlerMap } from './types.js';

/** Handler map for legacy Trading API listing, order, feedback, and dispute tools. */
/* eslint-disable @typescript-eslint/naming-convention -- handler keys must match published tool ids */
export const tradingHandlers: ToolHandlerMap = {
  ebay_get_active_listings: async (api, args) => {
    return await api.trading.getActiveListings(
      args.page as number | undefined,
      args.entriesPerPage as number | undefined
    );
  },

  ebay_get_listing: async (api, args) => {
    return await api.trading.getListing(args.itemId as string);
  },

  ebay_create_listing: async (api, args) => {
    return await api.trading.createListing(args.item as Record<string, unknown>);
  },

  ebay_revise_listing: async (api, args) => {
    return await api.trading.reviseListing(
      args.itemId as string,
      args.fields as Record<string, unknown>
    );
  },

  ebay_end_listing: async (api, args) => {
    return await api.trading.endListing(args.itemId as string, args.reason as string | undefined);
  },

  ebay_relist_item: async (api, args) => {
    return await api.trading.relistItem(
      args.itemId as string,
      args.modifications as Record<string, unknown> | undefined
    );
  },
};
