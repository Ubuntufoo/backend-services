import type { Server } from 'http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HttpTransportConfig } from '@/mcp/http-transport.js';

vi.mock('@/config/environment.js', () => ({
  validateEnvironmentConfig: vi.fn(() => ({
    errors: [],
    isValid: true,
    warnings: [],
  })),
}));

function createConfig(): HttpTransportConfig {
  return {
    authEnabled: false,
    dataAccess: undefined,
    ebayEnabled: false,
    ebayConfig: undefined,
    host: '127.0.0.1',
    oauth: {
      authServerUrl: 'http://localhost:8080/realms/master',
      requiredScopes: ['mcp:tools'],
      useIntrospection: true,
    },
    port: 3001,
    projectRoot: process.cwd(),
  };
}

function createFakeServer(): Server {
  return {
    close: vi.fn((callback?: (error?: Error) => void) => {
      callback?.();
      return undefined;
    }),
  } as unknown as Server;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('HTTP sidecar startup', () => {
  it('starts job runner when enabled', async () => {
    const { startSidecarHttpServer } = await import('@/server-http.js');
    const server = createFakeServer();
    const app = {
      listen: vi.fn((_port: number, _host: string, callback: () => void) => {
        callback();
        return server;
      }),
    };
    const runnerHandle = {
      isRunning: vi.fn(() => true),
      stop: vi.fn(),
    };
    const startJobRunnerLoop = vi.fn(() => runnerHandle);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const started = await startSidecarHttpServer({
      config: createConfig(),
      createApp: vi.fn(async () => app as never),
      env: {
        SIDECAR_JOB_RUNNER_ENABLED: 'true',
      },
      registerSignalHandlers: false,
      startJobRunnerLoop,
    });

    expect(started.jobRunnerStarted).toBe(true);
    expect(startJobRunnerLoop).toHaveBeenCalledTimes(1);

    await started.close();

    expect(runnerHandle.stop).toHaveBeenCalledTimes(1);
    expect(server.close).toHaveBeenCalledTimes(1);
  });

  it('does not start job runner when disabled', async () => {
    const { isSidecarJobRunnerEnabled, startSidecarHttpServer } = await import('@/server-http.js');
    const server = createFakeServer();
    const app = {
      listen: vi.fn((_port: number, _host: string, callback: () => void) => {
        callback();
        return server;
      }),
    };
    const startJobRunnerLoop = vi.fn();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(isSidecarJobRunnerEnabled({})).toBe(true);
    expect(isSidecarJobRunnerEnabled({ SIDECAR_JOB_RUNNER_ENABLED: 'false' })).toBe(false);

    const started = await startSidecarHttpServer({
      config: createConfig(),
      createApp: vi.fn(async () => app as never),
      env: {
        SIDECAR_JOB_RUNNER_ENABLED: 'false',
      },
      registerSignalHandlers: false,
      startJobRunnerLoop: startJobRunnerLoop as never,
    });

    expect(started.jobRunnerStarted).toBe(false);
    expect(startJobRunnerLoop).not.toHaveBeenCalled();

    await started.close();

    expect(server.close).toHaveBeenCalledTimes(1);
  });
});
