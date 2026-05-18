import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getToolDefinitions } from '@/tools/index.js';

const mcpMock = vi.hoisted(() => ({
  close: vi.fn(),
  connect: vi.fn(),
  constructor: vi.fn(),
  registerTool: vi.fn(),
}));

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: vi.fn(function (config) {
    mcpMock.constructor(config);
    return {
      close: mcpMock.close,
      connect: mcpMock.connect,
      registerTool: mcpMock.registerTool,
    };
  }),
}));

describe('MCP runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers the shared tool registry on server construction', async () => {
    const { createEbayMcpRuntime } = await import('@/mcp/runtime.js');
    const api = {
      initialize: vi.fn(),
    };

    const runtime = createEbayMcpRuntime({
      api: api as never,
      ebayEnabled: true,
      serverConfig: { name: 'test-mcp', version: '0.0.0' },
    });

    expect(runtime.api).toBe(api);
    expect(mcpMock.constructor).toHaveBeenCalledWith({ name: 'test-mcp', version: '0.0.0' });
    expect(mcpMock.registerTool).toHaveBeenCalledTimes(getToolDefinitions().length);

    await runtime.initializeApi();
    expect(api.initialize).toHaveBeenCalledOnce();
  });

  it('skips eBay tool registration when eBay is disabled', async () => {
    const { createEbayMcpRuntime } = await import('@/mcp/runtime.js');

    const runtime = createEbayMcpRuntime({
      ebayEnabled: false,
      serverConfig: { name: 'test-mcp', version: '0.0.0' },
    });

    expect(runtime.api).toBeUndefined();
    expect(mcpMock.registerTool).not.toHaveBeenCalled();

    await expect(runtime.initializeApi()).resolves.toBeUndefined();
  });
});
