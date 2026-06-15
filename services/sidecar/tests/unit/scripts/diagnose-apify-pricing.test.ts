import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getApifyPricingDiagnosticMock = vi.fn();
const loadRootEnvironmentMock = vi.fn();

vi.mock('@/config/env-paths.js', () => ({
  loadRootEnvironment: loadRootEnvironmentMock,
}));

vi.mock('@/pricing/index.js', () => ({
  getApifyPricingDiagnostic: getApifyPricingDiagnosticMock,
}));

describe('diagnose apify pricing script', () => {
  let originalExitCode: number | undefined;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = originalExitCode;
  });

  it('prints json and keeps zero exit on pass', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const report = {
      actorId: null,
      checkedAt: '2026-06-11T12:00:00.000Z',
      checks: [],
      enabled: false,
      metadata: {
        actor: null,
        attempted: false,
      },
      requestedCompCount: 20,
      overallStatus: 'pass',
      timeoutSeconds: 120,
      token: {
        configured: false,
        redacted: null,
      },
    };
    getApifyPricingDiagnosticMock.mockResolvedValue(report);

    const { runDiagnoseApifyPricingCli } = await import('@/scripts/diagnose-apify-pricing.js');
    await runDiagnoseApifyPricingCli();

    expect(loadRootEnvironmentMock).toHaveBeenCalledTimes(1);
    expect(getApifyPricingDiagnosticMock).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(JSON.stringify(report, null, 2));
    expect(process.exitCode).toBeUndefined();
  });

  it('sets non-zero exit on fail', async () => {
    getApifyPricingDiagnosticMock.mockResolvedValue({
      actorId: 'actor-123',
      checkedAt: '2026-06-11T12:00:00.000Z',
      checks: [],
      enabled: true,
      metadata: {
        actor: null,
        attempted: false,
      },
      requestedCompCount: 20,
      overallStatus: 'fail',
      timeoutSeconds: 120,
      token: {
        configured: true,
        redacted: '[redacted:8chars]',
      },
    });

    const { runDiagnoseApifyPricingCli } = await import('@/scripts/diagnose-apify-pricing.js');
    await runDiagnoseApifyPricingCli();

    expect(process.exitCode).toBe(1);
  });

  it('prints fallback json on unexpected failure', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    getApifyPricingDiagnosticMock.mockRejectedValue(new Error('diagnostic failed'));

    const { runDiagnoseApifyPricingCli } = await import('@/scripts/diagnose-apify-pricing.js');
    await runDiagnoseApifyPricingCli();

    expect(logSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(logSpy.mock.calls[0][0] as string) as {
      overallStatus: string;
      checks: { message: string; status: string }[];
    };
    expect(payload.overallStatus).toBe('fail');
    expect(payload.checks[0]).toMatchObject({
      message: 'diagnostic failed',
      status: 'fail',
    });
    expect(process.exitCode).toBe(1);
  });
});
