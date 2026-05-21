#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { isEbayEnabled, validateEnvironmentConfig } from '@/config/environment.js';
import { createEbayMcpRuntime, type EbayMcpRuntime } from '@/mcp/runtime.js';
import { runSetup } from '@/scripts/setup.js';
import { serverLogger, getLogPaths } from '@/utils/logger.js';
import { checkForUpdates } from '@/utils/version.js';

checkForUpdates({ defer: true });

const args = process.argv.slice(2);
if (args.includes('setup')) {
  try {
    await runSetup();
    /* eslint-disable-next-line n/no-process-exit -- CLI setup mode should terminate immediately */
    process.exit(0);
  } catch (error) {
    console.error('Setup failed:', error instanceof Error ? error.message : error);
    /* eslint-disable-next-line n/no-process-exit -- CLI setup mode should terminate immediately */
    process.exit(1);
  }
}

/**
 * eBay API MCP Server
 * Provides access to eBay APIs through Model Context Protocol
 */
class EbayMcpServer {
  private runtime: EbayMcpRuntime;

  constructor() {
    this.runtime = createEbayMcpRuntime({
      ebayEnabled: isEbayEnabled(process.env),
      logToolExecution: true,
    });
    this.setupErrorHandling();
  }

  /**
   * Initialize the API (load tokens from storage)
   */
  private async initialize(): Promise<void> {
    await this.runtime.initializeApi();
  }

  private setupErrorHandling(): void {
    process.on('SIGINT', async () => {
      serverLogger.info('Received SIGINT, shutting down...');
      await this.runtime.server.close();
      /* eslint-disable-next-line n/no-process-exit -- signal handler should terminate after clean shutdown */
      process.exit(0);
    });
  }

  async run(): Promise<void> {
    serverLogger.info('Starting eBay API MCP Server');

    // Validate environment configuration
    const validation = validateEnvironmentConfig();

    // Log warnings
    if (validation.warnings.length > 0) {
      validation.warnings.forEach((warning) => {
        serverLogger.warn(warning);
      });
    }

    // Log errors and exit if configuration is invalid
    if (!validation.isValid) {
      validation.errors.forEach((error) => {
        serverLogger.error(error);
      });
      serverLogger.error('Please fix the configuration errors and restart the server.');
      /* eslint-disable-next-line n/no-process-exit -- invalid startup config should exit non-zero */
      process.exit(1);
    }

    if (this.runtime.api) {
      serverLogger.info('Initializing API client');
      await this.initialize();
    } else {
      serverLogger.info('eBay integration disabled; MCP runtime started without eBay tools');
    }

    // Log log file locations if file logging is enabled
    if (process.env.EBAY_ENABLE_FILE_LOGGING === 'true') {
      const paths = getLogPaths();
      serverLogger.info('File logging enabled', {
        logDir: paths.logDir,
        errorLog: paths.errorLog,
        combinedLog: paths.combinedLog,
      });
    }

    const transport = new StdioServerTransport();
    await this.runtime.server.connect(transport);
    serverLogger.info('eBay API MCP Server running on stdio');
  }
}

// Start the server
const server = new EbayMcpServer();
server.run().catch((error) => {
  serverLogger.error('Fatal error running server', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  /* eslint-disable-next-line n/no-process-exit -- fatal startup failure should exit non-zero */
  process.exit(1);
});
