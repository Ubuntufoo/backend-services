import type { ToolHandlerMap } from './types.js';
import { getApiStatusFeed } from '@/utils/api-status-feed.js';

/** Handler map for Developer API application and keyset tools. */
/* eslint-disable @typescript-eslint/naming-convention -- handler keys must match published tool ids */
export const developerHandlers: ToolHandlerMap = {
  SearchClaudeCodeDocs: (api, args) => {
    const query = typeof args.query === 'string' ? args.query : JSON.stringify(args.query);
    return {
      content: [
        {
          type: 'text',
          text: `Tool 'SearchClaudeCodeDocs' called with query: ${query}. This tool is not yet fully implemented.`,
        },
      ],
    };
  },

  ebay_get_api_status: async (api, args) => {
    const result = await getApiStatusFeed({
      limit: args.limit as number | undefined,
      status: args.status as 'Resolved' | 'Unresolved' | undefined,
      api: args.api as string | undefined,
    });
    return { items: result.items, ...(result.error && { error: result.error }) };
  },

  ebay_get_rate_limits: async (api, args) => {
    return await api.developer.getRateLimits(
      args.apiContext as string | undefined,
      args.apiName as string | undefined
    );
  },

  ebay_get_user_rate_limits: async (api, args) => {
    return await api.developer.getUserRateLimits(
      args.apiContext as string | undefined,
      args.apiName as string | undefined
    );
  },

  ebay_register_client: async (api, args) => {
    return await api.developer.registerClient(args.clientSettings as Record<string, unknown>);
  },

  ebay_get_signing_keys: async (api, _args) => {
    return await api.developer.getSigningKeys();
  },

  ebay_create_signing_key: async (api, args) => {
    return await api.developer.createSigningKey(
      args.signingKeyCipher ? { signingKeyCipher: args.signingKeyCipher as string } : undefined
    );
  },

  ebay_get_signing_key: async (api, args) => {
    return await api.developer.getSigningKey(args.signingKeyId as string);
  },
};
