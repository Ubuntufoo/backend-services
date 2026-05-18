import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Implementation } from '@modelcontextprotocol/sdk/types.js';
import { EbaySellerApi } from '@/api/index.js';
import { getEbayConfig, isEbayEnabled, mcpConfig } from '@/config/environment.js';
import { getToolEntries, type ToolEntry } from '@/tools/registry.js';
import { serverLogger, toolLogger } from '@/utils/logger.js';

type ToolArgs = Record<string, unknown>;

/**
 * Optional dependencies and metadata for constructing the eBay MCP runtime.
 */
export interface EbayMcpRuntimeOptions {
  api?: EbaySellerApi;
  ebayEnabled?: boolean;
  serverConfig?: Implementation;
  logToolExecution?: boolean;
}

/**
 * Initialized MCP server runtime and eBay API facade.
 */
export interface EbayMcpRuntime {
  api?: EbaySellerApi;
  server: McpServer;
  initializeApi(): Promise<void>;
}

function formatToolSuccess(result: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
}

function formatToolFailure(error: unknown) {
  const errorMessage = error instanceof Error ? error.message : 'Unknown error';

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ error: errorMessage }, null, 2),
      },
    ],
    isError: true,
  };
}

function registerTool(
  server: McpServer,
  api: EbaySellerApi,
  entry: ToolEntry,
  logToolExecution: boolean
): void {
  const { definition, handler } = entry;

  server.registerTool(
    definition.name,
    {
      description: definition.description,
      inputSchema: definition.inputSchema,
    },
    async (args: ToolArgs) => {
      if (logToolExecution) {
        toolLogger.debug(`Executing tool: ${definition.name}`, { args });
      }

      try {
        const result = await handler(api, args);

        if (logToolExecution) {
          toolLogger.debug(`Tool ${definition.name} completed successfully`);
        }

        return formatToolSuccess(result);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        if (logToolExecution) {
          toolLogger.error(`Tool ${definition.name} failed`, { error: errorMessage });
        }

        return formatToolFailure(error);
      }
    }
  );
}

/**
 * Create an MCP server runtime and register all eBay tool handlers.
 */
export function createEbayMcpRuntime(options: EbayMcpRuntimeOptions = {}): EbayMcpRuntime {
  const ebayEnabled = options.ebayEnabled ?? isEbayEnabled(process.env);
  const api = ebayEnabled ? (options.api ?? new EbaySellerApi(getEbayConfig())) : undefined;
  const server = new McpServer(options.serverConfig ?? mcpConfig);
  const entries = ebayEnabled ? getToolEntries() : [];

  if (!api) {
    serverLogger.info('Registering 0 tools');

    return {
      api,
      server,
      async initializeApi() {
        return;
      },
    };
  }

  serverLogger.info(`Registering ${entries.length} tools`);

  for (const entry of entries) {
    registerTool(server, api, entry, options.logToolExecution ?? false);
  }

  return {
    api,
    server,
    async initializeApi() {
      if (api) {
        await api.initialize();
      }
    },
  };
}
