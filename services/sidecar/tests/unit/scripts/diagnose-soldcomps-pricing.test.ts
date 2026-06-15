import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loadRootEnvironmentMock = vi.fn();

vi.mock('@/config/env-paths.js', () => ({
  loadRootEnvironment: loadRootEnvironmentMock,
}));

describe('diagnose soldcomps pricing script', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let originalExitCode: number | undefined;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    originalEnv = { ...process.env };
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
    process.env.SOLDCOMPS_API_KEY = 'soldcomps-secret-token';
    delete process.env.SOLDCOMPS_PRICE_TIMEOUT_SECONDS;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = originalEnv;
    process.exitCode = originalExitCode;
  });

  it('reports selected soldcomps mode and canonical request count', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { runDiagnoseSoldCompsPricingCli } = await import(
      '@/scripts/diagnose-soldcomps-pricing.js'
    );
    await runDiagnoseSoldCompsPricingCli({
      createDataAccess: () =>
        ({
          appSettings: {
            get: vi.fn().mockResolvedValue({
              pricing_provider_mode: 'soldcomps',
            }),
          },
        }) as never,
    });

    const payload = JSON.parse(logSpy.mock.calls[0][0] as string) as {
      checks: Array<{ details: Record<string, unknown>; name: string; status: string }>;
      overallStatus: string;
      requestedCompCount: number;
      selectedProviderMode: string;
    };

    expect(payload.overallStatus).toBe('pass');
    expect(payload.requestedCompCount).toBe(50);
    expect(payload.selectedProviderMode).toBe('soldcomps');
    expect(payload.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'selected_provider_mode',
          status: 'pass',
        }),
        expect.objectContaining({
          details: expect.objectContaining({
            value: 50,
          }),
          name: 'soldcomps_request_count',
          status: 'pass',
        }),
      ])
    );
    expect(process.exitCode).toBeUndefined();
  });

  it('fails when persisted provider mode is not soldcomps', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { runDiagnoseSoldCompsPricingCli } = await import(
      '@/scripts/diagnose-soldcomps-pricing.js'
    );
    await runDiagnoseSoldCompsPricingCli({
      createDataAccess: () =>
        ({
          appSettings: {
            get: vi.fn().mockResolvedValue({
              pricing_provider_mode: 'apify',
            }),
          },
        }) as never,
    });

    const payload = JSON.parse(logSpy.mock.calls[0][0] as string) as {
      checks: Array<{ message: string; name: string; status: string }>;
      overallStatus: string;
    };

    expect(payload.overallStatus).toBe('fail');
    expect(payload.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: 'Persisted pricing_provider_mode currently resolves to "apify".',
          name: 'selected_provider_mode',
          status: 'fail',
        }),
      ])
    );
    expect(process.exitCode).toBe(1);
  });
});
