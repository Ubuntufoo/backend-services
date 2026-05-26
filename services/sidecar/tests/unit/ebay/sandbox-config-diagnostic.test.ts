import { describe, expect, it, vi } from 'vitest';
import type { SandboxBootstrapApi } from '@/ebay/sandbox-bootstrap.js';
import {
  formatSandboxConfigDiagnostic,
  getSandboxConfigDiagnostic,
} from '@/ebay/sandbox-config-diagnostic.js';

const {
  getSandboxSellingPolicyManagementDiagnosticMock,
  validateSandboxOAuthAccessMock,
} = vi.hoisted(() => ({
  getSandboxSellingPolicyManagementDiagnosticMock: vi.fn(),
  validateSandboxOAuthAccessMock: vi.fn(),
}));

vi.mock('@/ebay/sandbox-bootstrap.js', async () => {
  const actual = await vi.importActual<typeof import('@/ebay/sandbox-bootstrap.js')>(
    '@/ebay/sandbox-bootstrap.js'
  );

  return {
    ...actual,
    validateSandboxOAuthAccess: validateSandboxOAuthAccessMock,
  };
});

vi.mock('@/ebay/sandbox-selling-policy-program.js', () => ({
  getSandboxSellingPolicyManagementDiagnostic:
    getSandboxSellingPolicyManagementDiagnosticMock,
}));

function createApi(): SandboxBootstrapApi {
  return {
    account: {
      createFulfillmentPolicy: vi.fn(),
      createPaymentPolicy: vi.fn(),
      createReturnPolicy: vi.fn(),
      getOptedInPrograms: vi.fn(),
      getFulfillmentPolicies: vi.fn().mockResolvedValue({
        fulfillmentPolicies: [
          {
            categoryTypes: [{ name: 'ALL_EXCLUDING_MOTORS_VEHICLES' }],
            fulfillmentPolicyId: 'FULFILLMENT-REAL',
            marketplaceId: 'EBAY_US',
            name: 'Sandbox Default Fulfillment Policy',
            shippingOptions: [{ optionType: 'DOMESTIC' }],
          },
        ],
      }),
      getPaymentPolicies: vi.fn().mockResolvedValue({
        paymentPolicies: [
          {
            categoryTypes: [{ name: 'ALL_EXCLUDING_MOTORS_VEHICLES' }],
            immediatePay: true,
            marketplaceId: 'EBAY_US',
            name: 'Sandbox Default Payment Policy',
            paymentPolicyId: 'PAYMENT-REAL',
          },
        ],
      }),
      getReturnPolicies: vi.fn().mockResolvedValue({
        returnPolicies: [
          {
            categoryTypes: [{ name: 'ALL_EXCLUDING_MOTORS_VEHICLES' }],
            marketplaceId: 'EBAY_US',
            name: 'Sandbox Default Return Policy',
            returnPeriod: { unit: 'DAY', value: 30 },
            returnPolicyId: 'RETURN-REAL',
            returnShippingCostPayer: 'BUYER',
            returnsAccepted: true,
          },
        ],
      }),
      optInToProgram: vi.fn(),
    },
    getAuthClient: vi.fn(() => ({
      getConfig: vi.fn(() => ({
        environment: 'sandbox',
        marketplaceId: 'EBAY_US',
      })),
      getOAuthClient: vi.fn(),
    })),
    hasUserTokens: vi.fn(() => true),
    inventory: {
      createOrReplaceInventoryLocation: vi.fn(),
      getInventoryLocations: vi.fn().mockResolvedValue({
        locations: [
          {
            locationTypes: ['WAREHOUSE'],
            merchantLocationKey: 'default-main-location',
            merchantLocationStatus: 'ENABLED',
            name: 'Sandbox Main Warehouse',
          },
        ],
      }),
    },
  };
}

function createDataAccess(current: Record<string, unknown> | null) {
  return {
    appSettings: {
      create: vi.fn(),
      get: vi.fn().mockResolvedValue(current),
      update: vi.fn(),
    },
  };
}

describe('sandbox config diagnostic', () => {
  it('passes valid sandbox config state', async () => {
    validateSandboxOAuthAccessMock.mockResolvedValue({ tokenScopes: [] });
    getSandboxSellingPolicyManagementDiagnosticMock.mockResolvedValue({
      selling_policy_management_opted_in: true,
      warnings: [],
    });

    const result = await getSandboxConfigDiagnostic({
      api: createApi(),
      dataAccess: createDataAccess({
        default_fulfillment_policy_id: 'FULFILLMENT-REAL',
        default_payment_policy_id: 'PAYMENT-REAL',
        default_return_policy_id: 'RETURN-REAL',
        ebay_marketplace_id: 'EBAY_US',
        id: 'default',
        merchant_location_key: 'default-main-location',
      }),
    });

    expect(result.overallStatus).toBe('pass');
    expect(result.checks.map((check) => check.status)).toEqual([
      'pass',
      'pass',
      'pass',
      'pass',
      'pass',
      'pass',
    ]);
    expect(formatSandboxConfigDiagnostic(result)).toContain('[PASS] payment policy ID');
  });

  it('fails missing values cleanly', async () => {
    validateSandboxOAuthAccessMock.mockResolvedValue({ tokenScopes: [] });
    getSandboxSellingPolicyManagementDiagnosticMock.mockResolvedValue({
      selling_policy_management_opted_in: true,
      warnings: [],
    });

    const result = await getSandboxConfigDiagnostic({
      api: createApi(),
      dataAccess: createDataAccess({
        default_fulfillment_policy_id: null,
        default_payment_policy_id: null,
        default_return_policy_id: null,
        ebay_marketplace_id: null,
        id: 'default',
        merchant_location_key: null,
      }),
    });

    expect(result.overallStatus).toBe('fail');
    expect(result.checks.filter((check) => check.status === 'fail')).toHaveLength(5);
    expect(result.checks.find((check) => check.key === 'marketplace')?.message).toContain(
      'missing'
    );
    expect(result.suggestedSql).toContain("default_payment_policy_id = 'PAYMENT-REAL'");
  });

  it('fails obvious placeholder values', async () => {
    validateSandboxOAuthAccessMock.mockResolvedValue({ tokenScopes: [] });
    getSandboxSellingPolicyManagementDiagnosticMock.mockResolvedValue({
      selling_policy_management_opted_in: true,
      warnings: [],
    });

    const result = await getSandboxConfigDiagnostic({
      api: createApi(),
      dataAccess: createDataAccess({
        default_fulfillment_policy_id: 'mock-fulfillment-policy-id',
        default_payment_policy_id: 'mock-payment-policy-id',
        default_return_policy_id: 'mock-return-policy-id',
        ebay_marketplace_id: 'mock-marketplace',
        id: 'default',
        merchant_location_key: '<merchantLocationKey>',
      }),
    });

    expect(result.overallStatus).toBe('fail');
    expect(result.checks.find((check) => check.key === 'paymentPolicyId')).toMatchObject({
      configuredValue: 'mock-payment-policy-id',
      status: 'fail',
    });
    expect(result.checks.find((check) => check.key === 'merchantLocationKey')?.message).toContain(
      'placeholder'
    );
  });

  it('escapes single quotes in suggested SQL', async () => {
    validateSandboxOAuthAccessMock.mockResolvedValue({ tokenScopes: [] });
    getSandboxSellingPolicyManagementDiagnosticMock.mockResolvedValue({
      selling_policy_management_opted_in: true,
      warnings: [],
    });

    const api = createApi();
    api.account.getPaymentPolicies = vi.fn().mockResolvedValue({
      paymentPolicies: [
        {
          categoryTypes: [{ name: 'ALL_EXCLUDING_MOTORS_VEHICLES' }],
          immediatePay: true,
          marketplaceId: 'EBAY_US',
          name: "O'Reilly Payment",
          paymentPolicyId: "O'Reilly",
        },
      ],
    });

    const result = await getSandboxConfigDiagnostic({
      api,
      dataAccess: createDataAccess({
        default_fulfillment_policy_id: 'FULFILLMENT-REAL',
        default_payment_policy_id: "O'Reilly",
        default_return_policy_id: 'RETURN-REAL',
        ebay_marketplace_id: 'EBAY_US',
        id: 'default',
        merchant_location_key: 'default-main-location',
      }),
    });

    expect(result.suggestedSql).toContain("default_payment_policy_id = 'O''Reilly'");
  });

  it('fails partial config with mismatched marketplace and unknown resources', async () => {
    validateSandboxOAuthAccessMock.mockResolvedValue({ tokenScopes: [] });
    getSandboxSellingPolicyManagementDiagnosticMock.mockResolvedValue({
      selling_policy_management_opted_in: 'unknown',
      warnings: ['Could not determine selling policy opt-in status.'],
    });

    const api = createApi();
    api.account.getReturnPolicies = vi.fn().mockResolvedValue({ returnPolicies: [] });
    api.inventory.getInventoryLocations = vi.fn().mockResolvedValue({
      locations: [
        {
          locationTypes: ['WAREHOUSE'],
          merchantLocationKey: 'secondary-location',
          merchantLocationStatus: 'DISABLED',
          name: 'Secondary Warehouse',
        },
      ],
    });

    const result = await getSandboxConfigDiagnostic({
      api,
      dataAccess: createDataAccess({
        default_fulfillment_policy_id: 'FULFILLMENT-REAL',
        default_payment_policy_id: 'PAYMENT-REAL',
        default_return_policy_id: 'RETURN-MISSING',
        ebay_marketplace_id: 'EBAY_GB',
        id: 'default',
        merchant_location_key: 'secondary-location',
      }),
    });

    expect(result.overallStatus).toBe('fail');
    expect(result.checks.find((check) => check.key === 'marketplace')).toMatchObject({
      configuredValue: 'EBAY_GB',
      expectedValue: 'EBAY_US',
      status: 'fail',
    });
    expect(result.checks.find((check) => check.key === 'returnPolicyId')?.message).toContain(
      'not found'
    );
    expect(result.checks.find((check) => check.key === 'merchantLocationKey')?.message).toContain(
      'expected ENABLED'
    );
    expect(result.warnings).toContain('Could not determine selling policy opt-in status.');
    expect(result.warnings).toContain('No return policies found for marketplace EBAY_US.');
  });
});
