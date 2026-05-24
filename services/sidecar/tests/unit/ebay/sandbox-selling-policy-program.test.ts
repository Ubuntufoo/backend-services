import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getSandboxSellingPolicyManagementDiagnostic,
  optInSandboxSellingPolicyManagement,
  SELLING_POLICY_MANAGEMENT_PROGRAM,
  type SandboxProgramApi,
} from '@/ebay/sandbox-selling-policy-program.js';

const REQUIRED_SCOPE_STRING = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.account',
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
].join(' ');

function createApi(overrides: Partial<SandboxProgramApi> = {}): SandboxProgramApi {
  const oauthClient = {
    getAccessToken: vi.fn().mockResolvedValue('access-token'),
    getUserTokens: vi.fn().mockReturnValue({
      scope: REQUIRED_SCOPE_STRING,
    }),
  };

  return {
    account: {
      getOptedInPrograms: vi.fn().mockResolvedValue({ programs: [] }),
      optInToProgram: vi.fn().mockResolvedValue(undefined),
    },
    getAuthClient: vi.fn(() => ({
      getConfig: vi.fn(() => ({
        environment: 'sandbox',
        marketplaceId: 'EBAY_US',
      })),
      getOAuthClient: vi.fn(() => oauthClient),
    })),
    hasUserTokens: vi.fn(() => true),
    ...overrides,
  };
}

describe('sandbox selling policy program', () => {
  const originalRefreshToken = process.env.EBAY_REFRESH_TOKEN;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.EBAY_REFRESH_TOKEN = 'refresh-token';
  });

  afterEach(() => {
    if (originalRefreshToken === undefined) {
      delete process.env.EBAY_REFRESH_TOKEN;
      return;
    }

    process.env.EBAY_REFRESH_TOKEN = originalRefreshToken;
  });

  it('returns true when opted-in programs include SELLING_POLICY_MANAGEMENT', async () => {
    const api = createApi();
    api.account.getOptedInPrograms = vi.fn().mockResolvedValue({
      programs: [{ programStatus: 'OPTED_IN', programType: SELLING_POLICY_MANAGEMENT_PROGRAM }],
    });

    await expect(getSandboxSellingPolicyManagementDiagnostic(api)).resolves.toEqual({
      selling_policy_management_opted_in: true,
      warnings: [],
    });
  });

  it('opts in when programs list is empty', async () => {
    const api = createApi();

    await expect(optInSandboxSellingPolicyManagement(api)).resolves.toEqual({
      message:
        'Opt-in request submitted for SELLING_POLICY_MANAGEMENT. eBay may take up to 24 hours to process. Rerun ebay:diagnose-sandbox later.',
      status: 'opt_in_requested',
    });
    expect(api.account.optInToProgram).toHaveBeenCalledWith({
      programType: SELLING_POLICY_MANAGEMENT_PROGRAM,
    });
  });

  it('skips POST when already opted in', async () => {
    const api = createApi();
    api.account.getOptedInPrograms = vi.fn().mockResolvedValue({
      programs: [{ programStatus: 'OPTED_IN', programType: SELLING_POLICY_MANAGEMENT_PROGRAM }],
    });

    await expect(optInSandboxSellingPolicyManagement(api)).resolves.toEqual({
      message: 'Already opted in to SELLING_POLICY_MANAGEMENT.',
      status: 'already_opted_in',
    });
    expect(api.account.optInToProgram).not.toHaveBeenCalled();
  });

  it.each([
    'Request failed with status code 409',
    'eBay API Error: 25803 program already requested',
  ])('treats %s as non-fatal already-requested state', async (message) => {
    const api = createApi();
    api.account.optInToProgram = vi.fn().mockRejectedValue(new Error(message));

    await expect(optInSandboxSellingPolicyManagement(api)).resolves.toEqual({
      message:
        'SELLING_POLICY_MANAGEMENT already opted in or opt-in already requested. eBay may take up to 24 hours to process. Rerun ebay:diagnose-sandbox later.',
      status: 'already_requested',
    });
  });

  it('fails with actionable reauthorize message on missing scope', async () => {
    const api = createApi();
    api.account.getOptedInPrograms = vi
      .fn()
      .mockRejectedValue(new Error('eBay API Error: insufficient_scope'));

    await expect(optInSandboxSellingPolicyManagement(api)).rejects.toThrow(
      'Re-authorize sandbox user with scopes: api_scope, sell.account, sell.inventory'
    );
  });

  it('rejects outside sandbox', async () => {
    const api = createApi({
      getAuthClient: vi.fn(() => ({
        getConfig: vi.fn(() => ({
          environment: 'production',
          marketplaceId: 'EBAY_US',
        })),
        getOAuthClient: vi.fn(() => ({
          getAccessToken: vi.fn().mockResolvedValue('access-token'),
          getUserTokens: vi.fn().mockReturnValue({
            scope: REQUIRED_SCOPE_STRING,
          }),
        })),
      })),
    });

    await expect(optInSandboxSellingPolicyManagement(api)).rejects.toThrow(
      'Sandbox bootstrap only runs against EBAY_ENVIRONMENT=sandbox'
    );
  });

  it('diagnostics never mutates account state', async () => {
    const api = createApi();
    api.account.getOptedInPrograms = vi
      .fn()
      .mockRejectedValue(new Error('eBay API Error: insufficient_scope'));

    await expect(getSandboxSellingPolicyManagementDiagnostic(api)).resolves.toEqual({
      selling_policy_management_opted_in: 'unknown',
      warnings: [
        'Could not determine selling policy opt-in status. Re-authorize sandbox user with scopes: api_scope, sell.account, sell.inventory.',
      ],
    });
    expect(api.account.optInToProgram).not.toHaveBeenCalled();
  });
});
