import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getSandboxSellingPolicyManagementDiagnosticMock = vi.fn();
const optInSandboxSellingPolicyManagementMock = vi.fn();
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

vi.mock('@/ebay/sandbox-selling-policy-program.js', () => ({
  getSandboxSellingPolicyManagementDiagnostic: getSandboxSellingPolicyManagementDiagnosticMock,
  optInSandboxSellingPolicyManagement: optInSandboxSellingPolicyManagementMock,
}));

vi.mock('@/api/index.js', () => ({
  EbaySellerApi: vi.fn(function (this: { initialize: typeof initializeMock }) {
    this.initialize = initializeMock;
  }),
}));

describe('opt-in selling policies script', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initializeMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints already opted-in message', async () => {
    optInSandboxSellingPolicyManagementMock.mockResolvedValue({
      message: 'Already opted in to SELLING_POLICY_MANAGEMENT.',
      status: 'already_opted_in',
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { runOptInSellingPoliciesCli } = await import('@/scripts/opt-in-selling-policies.js');
    await runOptInSellingPoliciesCli();

    expect(getSandboxSellingPolicyManagementDiagnosticMock).not.toHaveBeenCalled();
    expect(optInSandboxSellingPolicyManagementMock).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith('Already opted in to SELLING_POLICY_MANAGEMENT.');
  });

  it('surfaces wrong-environment failure', async () => {
    optInSandboxSellingPolicyManagementMock.mockRejectedValue(
      new Error('Sandbox bootstrap only runs against EBAY_ENVIRONMENT=sandbox')
    );

    const { runOptInSellingPoliciesCli } = await import('@/scripts/opt-in-selling-policies.js');

    await expect(runOptInSellingPoliciesCli()).rejects.toThrow(
      'Sandbox bootstrap only runs against EBAY_ENVIRONMENT=sandbox'
    );
  });
});
