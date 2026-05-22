/**
 * eBay API MCP Server with HTTP Transport and OAuth 2.1 Authorization.
 */

import type { Server } from 'http';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { validateEnvironmentConfig } from '@/config/environment.js';
import { startSidecarJobRunnerLoop, type SidecarJobRunnerLoopHandle } from '@/jobs/index.js';
import {
  createHttpMcpApp,
  createHttpTransportConfigFromEnv,
  getHttpServerUrl,
  type HttpTransportConfig,
} from '@/mcp/http-transport.js';

const SIDECAR_JOB_RUNNER_ENABLED = 'SIDECAR_JOB_RUNNER_ENABLED';

export interface StartSidecarHttpServerOptions {
  config?: HttpTransportConfig;
  createApp?: typeof createHttpMcpApp;
  env?: NodeJS.ProcessEnv;
  registerSignalHandlers?: boolean;
  startJobRunnerLoop?: () => SidecarJobRunnerLoopHandle;
}

export interface StartedSidecarHttpServer {
  close(): Promise<void>;
  jobRunnerStarted: boolean;
  server: Server;
}

function logEnvironmentValidation(): void {
  const validation = validateEnvironmentConfig();

  if (validation.warnings.length > 0) {
    console.log('Environment Configuration Warnings:');
    validation.warnings.forEach((warning) => {
      console.log(`  • ${warning}`);
    });
    console.log();
  }

  if (!validation.isValid) {
    console.error('Environment Configuration Errors:');
    validation.errors.forEach((error) => {
      console.error(`  • ${error}`);
    });
    console.error('\nPlease fix the configuration errors and restart the server.\n');
    /* eslint-disable-next-line n/no-process-exit -- invalid startup config should exit non-zero */
    process.exit(1);
  }
}

function logConfiguration(
  config: HttpTransportConfig,
  env: NodeJS.ProcessEnv = process.env
): void {
  console.log('Configuration:');
  console.log(`Host: ${config.host}`);
  console.log(`Port: ${config.port}`);
  console.log(`OAuth Enabled: ${config.authEnabled}`);
  console.log(`eBay Enabled: ${config.ebayEnabled}`);
  console.log(`Job Runner Enabled: ${isSidecarJobRunnerEnabled(env)}`);

  if (config.authEnabled) {
    console.log(`Auth Server: ${config.oauth.authServerUrl}`);
    console.log(`Required Scopes: ${config.oauth.requiredScopes.join(', ')}`);
    console.log(`Verification Method: ${config.oauth.useIntrospection ? 'Introspection' : 'JWT'}`);
  }
}

function logStartupUrls(serverUrl: string): void {
  console.log('Server is running!');
  console.log();
  console.log(`MCP endpoint: ${serverUrl}/`);
  console.log(`Protected Resource Metadata: ${serverUrl}/.well-known/oauth-protected-resource`);
  console.log(`Health check: ${serverUrl}/health`);
  console.log();
}

function logAuthState(config: HttpTransportConfig): void {
  if (config.authEnabled) {
    console.log('Authorization is ENABLED');
    console.log('Clients must provide valid Bearer tokens to access MCP endpoints');
    return;
  }

  console.log('Authorization is DISABLED');
  console.log('Set OAUTH_ENABLED=true (or remove OAUTH_ENABLED=false) to enable OAuth protection');
}

export function isSidecarJobRunnerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const rawValue = env[SIDECAR_JOB_RUNNER_ENABLED]?.trim().toLowerCase();
  return rawValue !== '0' && rawValue !== 'false';
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error) {
        rejectClose(error);
        return;
      }

      resolveClose();
    });
  });
}

export async function startSidecarHttpServer(
  options: StartSidecarHttpServerOptions = {}
): Promise<StartedSidecarHttpServer> {
  const env = options.env ?? process.env;
  const config = options.config ?? createHttpTransportConfigFromEnv(env);

  logEnvironmentValidation();
  logConfiguration(config, env);

  const app = await (options.createApp ?? createHttpMcpApp)(config);
  const serverUrl = getHttpServerUrl(config);
  const server = await new Promise<Server>((resolveServer) => {
    const httpServer = app.listen(config.port, config.host, () => {
      logStartupUrls(serverUrl);
      logAuthState(config);
      queueMicrotask(() => {
        resolveServer(httpServer);
      });
    });
  });

  const jobRunner = isSidecarJobRunnerEnabled(env)
    ? (options.startJobRunnerLoop ?? startSidecarJobRunnerLoop)()
    : null;

  if (jobRunner) {
    console.log('Sidecar job runner started.');
  } else {
    console.log(`Sidecar job runner disabled via ${SIDECAR_JOB_RUNNER_ENABLED}=false.`);
  }

  const close = async (): Promise<void> => {
    jobRunner?.stop();
    await closeServer(server);
  };

  if (options.registerSignalHandlers !== false) {
    process.on('SIGINT', () => {
      console.log('\n Shutting down...');
      void close()
        .then(() => {
          console.log('✓ Server closed');
          /* eslint-disable-next-line n/no-process-exit -- signal handler should terminate after clean shutdown */
          process.exit(0);
        })
        .catch((error: unknown) => {
          console.error('Error closing server:', error);
          /* eslint-disable-next-line n/no-process-exit -- signal handler should terminate after failed shutdown */
          process.exit(1);
        });
    });
  }

  return {
    close,
    jobRunnerStarted: jobRunner !== null,
    server,
  };
}

export async function main(): Promise<void> {
  try {
    console.log('Starting eBay API MCP Server (HTTP + OAuth)...');
    console.log();
    await startSidecarHttpServer();
  } catch (error) {
    console.error('Fatal error starting server:', error);
    /* eslint-disable-next-line n/no-process-exit -- fatal startup failure should exit non-zero */
    process.exit(1);
  }
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
const modulePath = resolve(fileURLToPath(import.meta.url));
if (entryPath && modulePath === entryPath) {
  await main();
}
