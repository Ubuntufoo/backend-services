import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const formatSandboxConfigDiagnosticMock = vi.fn();
const getSandboxConfigDiagnosticMock = vi.fn();
const getSidecarDataAccessMock = vi.fn();
const initializeMock = vi.fn();
const loadRootEnvironmentMock = vi.fn();

vi.mock('@/config/env-paths.js', () => ({
  loadRootEnvironment: loadRootEnvironmentMock,
}));

vi.mock('@/config/environment.js', () => ({
  getEbayConfig: vi.fn(() => ({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    environment: 'sandbox',
    marketplaceId: 'EBAY_US',
  })),
}));

vi.mock('@/data/sidecar-data.js', () => ({
  getSidecarDataAccess: getSidecarDataAccessMock,
}));

vi.mock('@/ebay/sandbox-config-diagnostic.js', () => ({
  formatSandboxConfigDiagnostic: formatSandboxConfigDiagnosticMock,
  getSandboxConfigDiagnostic: getSandboxConfigDiagnosticMock,
}));

vi.mock('@/api/index.js', () => ({
  EbaySellerApi: vi.fn(function (this: { initialize: typeof initializeMock }) {
    this.initialize = initializeMock;
  }),
}));

describe('diagnose sandbox config script', () => {
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    vi.clearAllMocks();
    initializeMock.mockResolvedValue(undefined);
    getSidecarDataAccessMock.mockReturnValue({ appSettings: {} });
    formatSandboxConfigDiagnosticMock.mockReturnValue('formatted diagnostic');
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = originalExitCode;
  });

  it('prints formatted diagnostic output', async () => {
    const result = {
      overallStatus: 'pass',
    };
    getSandboxConfigDiagnosticMock.mockResolvedValue(result);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { runDiagnoseSandboxConfigCli } = await import('@/scripts/diagnose-sandbox-config.js');
    await runDiagnoseSandboxConfigCli();

    expect(getSandboxConfigDiagnosticMock).toHaveBeenCalledTimes(1);
    expect(formatSandboxConfigDiagnosticMock).toHaveBeenCalledWith(result);
    expect(logSpy).toHaveBeenCalledWith('formatted diagnostic');
    expect(process.exitCode).toBeUndefined();
  });

  it('sets non-zero exit code when diagnostic fails', async () => {
    getSandboxConfigDiagnosticMock.mockResolvedValue({
      overallStatus: 'fail',
    });

    const { runDiagnoseSandboxConfigCli } = await import('@/scripts/diagnose-sandbox-config.js');
    await runDiagnoseSandboxConfigCli();

    expect(process.exitCode).toBe(1);
  });
});
