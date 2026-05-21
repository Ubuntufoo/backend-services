import type { ToolHandlerMap } from './types.js';

/** Handler map for Taxonomy API category and compatibility tools. */
/* eslint-disable @typescript-eslint/naming-convention -- handler keys must match published tool ids */
export const taxonomyHandlers: ToolHandlerMap = {
  ebay_get_default_category_tree_id: async (api, args) => {
    return await api.taxonomy.getDefaultCategoryTreeId(args.marketplaceId as string);
  },

  ebay_get_category_tree: async (api, args) => {
    return await api.taxonomy.getCategoryTree(args.categoryTreeId as string);
  },

  ebay_get_category_suggestions: async (api, args) => {
    return await api.taxonomy.getCategorySuggestions(
      args.categoryTreeId as string,
      args.query as string
    );
  },

  ebay_get_item_aspects_for_category: async (api, args) => {
    return await api.taxonomy.getItemAspectsForCategory(
      args.categoryTreeId as string,
      args.categoryId as string
    );
  },
};
