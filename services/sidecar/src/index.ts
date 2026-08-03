#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { isEbayEnabled, validateEnvironmentConfig } from '@/config/environment.js';
import { createEbayMcpRuntime, type EbayMcpRuntime } from '@/mcp/runtime.js';
import { serverLogger, getLogPaths } from '@/utils/logger.js';
import { checkForUpdates } from '@/utils/version.js';

type RunSetup = typeof import('@/scripts/setup.js').runSetup;

export interface MainDependencies {
  runSetup?: RunSetup;
}

export interface DirectEntrypointDependencies {
  exit?: (code: number) => void;
  logSetupError?: (message: string, error: unknown) => void;
  runMain?: typeof main;
}

/**
 * eBay API MCP Server
 * Provides access to eBay APIs through Model Context Protocol
 */
export class EbayMcpServer {
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

export async function main(
  args: string[] = process.argv.slice(2),
  dependencies: MainDependencies = {}
): Promise<void> {
  if (args.includes('setup')) {
    const runSetup =
      dependencies.runSetup ?? (await import('@/scripts/setup.js')).runSetup;
    await runSetup();
    return;
  }

  checkForUpdates({ defer: true });
  const server = new EbayMcpServer();
  await server.run();
}

export async function runDirectEntrypoint(
  args: string[],
  dependencies: DirectEntrypointDependencies = {}
): Promise<void> {
  const exit = dependencies.exit ?? ((code: number) => process.exit(code));
  try {
    await (dependencies.runMain ?? main)(args);
    if (args.includes('setup')) exit(0);
  } catch (error) {
    if (args.includes('setup')) {
      (dependencies.logSetupError ?? console.error)(
        'Setup failed:',
        error instanceof Error ? error.message : error
      );
      exit(1);
      return;
    }
    serverLogger.error('Fatal error running server', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    exit(1);
  }
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
const modulePath = resolve(fileURLToPath(import.meta.url));
const entryArgs = process.argv.slice(2);

if (entryPath && entryPath === modulePath) {
  void runDirectEntrypoint(entryArgs);
}
