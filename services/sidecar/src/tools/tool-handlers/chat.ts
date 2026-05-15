import type { ToolHandlerMap } from './types.js';

/** Handler map for ChatGPT connector search and fetch tools. */
export const chatHandlers: ToolHandlerMap = {
  search: async (api, args) => {
    // For this example, we'll treat the query as a search for inventory items.
    // A more robust implementation might search across different types of content.
    const requestedLimitRaw = args.limit as number | undefined;
    const limit =
      typeof requestedLimitRaw === 'number' && Number.isFinite(requestedLimitRaw)
        ? Math.max(Math.floor(requestedLimitRaw), 1)
        : 10;
    const query = (args.query as string | undefined)?.toLowerCase().trim();
    const pageSize = query ? Math.min(Math.max(limit, 50), 200) : limit;
    const matches: {
      product?: { title?: string };
      sku: string;
    }[] = [];
    let offset = 0;

    while (matches.length < limit) {
      const response = await api.inventory.getInventoryItems(pageSize, offset);
      const pageItems = response.inventoryItems ?? [];
      if (pageItems.length === 0) {
        break;
      }

      // Filter to only include items with valid SKUs (required for getInventoryItem calls)
      const itemsWithSku = pageItems.filter(
        (item): item is typeof item & { sku: string } =>
          typeof item.sku === 'string' && item.sku.trim() !== ''
      );

      const filtered = query
        ? itemsWithSku.filter((item) => (item.product?.title ?? '').toLowerCase().includes(query))
        : itemsWithSku;

      matches.push(...filtered);
      offset += pageSize;

      const total = (response as { total?: number }).total;
      if (typeof total === 'number' && offset >= total) {
        break;
      }

      if (!query || pageItems.length < pageSize) {
        break;
      }
    }

    const results = matches.slice(0, limit).map((item) => ({
      id: item.sku,
      title: item.product?.title ?? 'No Title',
      // The URL should be a canonical link to the item, which we don't have here.
      // We'll use a placeholder.
      url: `https://www.ebay.com/`, // Placeholder URL
    }));

    // Format the response as required by the ChatGPT connector spec.
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ results }),
        },
      ],
    };
  },

  fetch: async (api, args) => {
    const sku = args.id as string;
    const item = await api.inventory.getInventoryItem(sku);

    // Format the response as required by the ChatGPT connector spec.
    const result = {
      id: sku,
      title: item.product?.title ?? 'No Title',
      text: item.product?.description ?? 'No description available.',
      url: `https://www.ebay.com/`, // Placeholder URL
      metadata: {
        source: 'ebay_inventory',
        aspects: item.product?.aspects,
        condition: item.condition,
      },
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result),
        },
      ],
    };
  },
};
