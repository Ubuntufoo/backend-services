import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createUnexpectedLiveReadinessReportMock = vi.fn();
const getLiveReadinessDiagnosticMock = vi.fn();
const getEbayConfigMock = vi.fn();
const getSidecarDataAccessMock = vi.fn();
const initializeMock = vi.fn();
const loadRootEnvironmentMock = vi.fn();

vi.mock('@/config/env-paths.js', () => ({
  loadRootEnvironment: loadRootEnvironmentMock,
}));

vi.mock('@/config/environment.js', () => ({
  getEbayConfig: getEbayConfigMock,
}));

getEbayConfigMock.mockImplementation(() => ({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    environment: 'production',
    marketplaceId: 'EBAY_US',
    refreshToken: 'refresh-token',
  }));

vi.mock('@/ebay/config.js', () => ({
  loadEbayOAuthValidationConfig: vi.fn(() => ({
    apiBaseUrl: 'https://api.ebay.com',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    environment: 'production',
    marketplaceId: 'EBAY_US',
    oauthBaseUrl: 'https://api.ebay.com/identity/v1/oauth2/token',
    publishEnabled: true,
    refreshToken: 'refresh-token',
  })),
}));

vi.mock('@/data/sidecar-data.js', () => ({
  getSidecarDataAccess: getSidecarDataAccessMock,
}));

vi.mock('@/ebay/live-readiness-diagnostic.js', () => ({
  createUnexpectedLiveReadinessReport: createUnexpectedLiveReadinessReportMock,
  getLiveReadinessDiagnostic: getLiveReadinessDiagnosticMock,
}));

vi.mock('@/api/index.js', () => ({
  EbaySellerApi: vi.fn(function (this: { initialize: typeof initializeMock }) {
    this.initialize = initializeMock;
  }),
}));

describe('diagnose live readiness script', () => {
  let originalExitCode: number | undefined;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getEbayConfigMock.mockImplementation(() => ({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      environment: 'production',
      marketplaceId: 'EBAY_US',
      refreshToken: 'refresh-token',
    }));
    getSidecarDataAccessMock.mockReturnValue({ appSettings: {} });
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = originalExitCode;
  });

  it('prints JSON report and leaves zero exit on ready', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const report = {
      apiBaseUrl: 'https://api.ebay.com',
      checkedAt: '2026-06-02T00:00:00.000Z',
      checks: [],
      environment: 'production',
      marketplaceId: 'EBAY_US',
      overallStatus: 'ready',
      productionPublishEnabled: true,
    };
    getLiveReadinessDiagnosticMock.mockResolvedValue(report);

    const { runDiagnoseLiveReadinessCli } = await import('@/scripts/diagnose-live-readiness.js');
    await runDiagnoseLiveReadinessCli();

    expect(getLiveReadinessDiagnosticMock).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(JSON.stringify(report, null, 2));
    expect(process.exitCode).toBeUndefined();
  });

  it('leaves zero exit when report is warning', async () => {
    getLiveReadinessDiagnosticMock.mockResolvedValue({
      apiBaseUrl: 'https://api.ebay.com',
      checkedAt: '2026-06-02T00:00:00.000Z',
      checks: [],
      environment: 'production',
      marketplaceId: 'EBAY_US',
      overallStatus: 'warning',
      productionPublishEnabled: false,
    });

    const { runDiagnoseLiveReadinessCli } = await import('@/scripts/diagnose-live-readiness.js');
    await runDiagnoseLiveReadinessCli();

    expect(process.exitCode).toBeUndefined();
  });

  it('sets non-zero exit when report is blocked', async () => {
    getLiveReadinessDiagnosticMock.mockResolvedValue({
      apiBaseUrl: 'https://api.ebay.com',
      checkedAt: '2026-06-02T00:00:00.000Z',
      checks: [],
      environment: 'production',
      marketplaceId: 'EBAY_US',
      overallStatus: 'blocked',
      productionPublishEnabled: true,
    });

    const { runDiagnoseLiveReadinessCli } = await import('@/scripts/diagnose-live-readiness.js');
    await runDiagnoseLiveReadinessCli();

    expect(process.exitCode).toBe(1);
  });

  it('prints final JSON even if diagnostic internals try to write noise', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const report = {
      apiBaseUrl: 'https://api.ebay.com',
      checkedAt: '2026-06-02T00:00:00.000Z',
      checks: [],
      environment: 'production',
      marketplaceId: 'EBAY_US',
      overallStatus: 'ready',
      productionPublishEnabled: true,
    };
    getLiveReadinessDiagnosticMock.mockImplementation(async () => {
      process.stdout.write('noisy stdout\n');
      process.stderr.write('noisy stderr\n');
      return report;
    });

    const { runDiagnoseLiveReadinessCli } = await import('@/scripts/diagnose-live-readiness.js');
    await runDiagnoseLiveReadinessCli();

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(JSON.stringify(report, null, 2));
  });

  it('prints fallback JSON when config load fails', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const fallbackReport = {
      apiBaseUrl: 'https://api.ebay.com',
      checkedAt: '2026-06-02T00:00:00.000Z',
      checks: [],
      environment: 'production',
      marketplaceId: 'EBAY_US',
      overallStatus: 'blocked',
      productionPublishEnabled: true,
    };
    createUnexpectedLiveReadinessReportMock.mockReturnValue(fallbackReport);
    getEbayConfigMock.mockImplementation(() => {
      throw new Error('bad config');
    });

    const { runDiagnoseLiveReadinessCli } = await import('@/scripts/diagnose-live-readiness.js');
    await runDiagnoseLiveReadinessCli();

    expect(createUnexpectedLiveReadinessReportMock).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(JSON.stringify(fallbackReport, null, 2));
    expect(process.exitCode).toBe(1);
  });
});
