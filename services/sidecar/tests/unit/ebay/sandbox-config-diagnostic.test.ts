import { describe, expect, it, vi } from 'vitest';
import type { SandboxBootstrapApi } from '@/ebay/sandbox-bootstrap.js';
import { getSandboxConfigDiagnostic } from '@/ebay/sandbox-config-diagnostic.js';

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

describe('sandbox config diagnostic', () => {
  it('summarizes policies, locations, app settings issues, and suggested SQL', async () => {
    validateSandboxOAuthAccessMock.mockResolvedValue({ tokenScopes: [] });
    getSandboxSellingPolicyManagementDiagnosticMock.mockResolvedValue({
      selling_policy_management_opted_in: true,
      warnings: [],
    });

    const result = await getSandboxConfigDiagnostic({
      api: createApi(),
      dataAccess: {
        appSettings: {
          create: vi.fn(),
          get: vi.fn().mockResolvedValue({
            default_fulfillment_policy_id: 'mock-fulfillment-policy-id',
            default_payment_policy_id: 'mock-payment-policy-id',
            default_return_policy_id: 'mock-return-policy-id',
            ebay_marketplace_id: null,
            id: 'default',
            merchant_location_key: 'default-main-location',
          }),
          update: vi.fn(),
        },
      },
    });

    expect(result.marketplaceId).toBe('EBAY_US');
    expect(result.sellingPolicyManagementOptedIn).toBe(true);
    expect(result.appSettings.issues).toEqual(
      expect.arrayContaining([
        'app_settings.ebay_marketplace_id is required for publish.',
        'app_settings.default_payment_policy_id "mock-payment-policy-id" is a placeholder. Run sandbox policy diagnostics and update app_settings.default before publish.',
        'app_settings.default_fulfillment_policy_id "mock-fulfillment-policy-id" is a placeholder. Run sandbox policy diagnostics and update app_settings.default before publish.',
        'app_settings.default_return_policy_id "mock-return-policy-id" is a placeholder. Run sandbox policy diagnostics and update app_settings.default before publish.',
        'app_settings.merchant_location_key "default-main-location" looks like a placeholder. Run sandbox location diagnostics and update app_settings.default before publish.',
      ])
    );
    expect(result.proposedValues).toEqual({
      default_fulfillment_policy_id: 'FULFILLMENT-REAL',
      default_payment_policy_id: 'PAYMENT-REAL',
      default_return_policy_id: 'RETURN-REAL',
      ebay_marketplace_id: 'EBAY_US',
      merchant_location_key: 'default-main-location',
    });
    expect(result.summaries.fulfillmentPolicies).toEqual([
      {
        categoryTypes: ['ALL_EXCLUDING_MOTORS_VEHICLES'],
        id: 'FULFILLMENT-REAL',
        marketplaceId: 'EBAY_US',
        name: 'Sandbox Default Fulfillment Policy',
        summary: '1 shipping option(s): DOMESTIC',
      },
    ]);
    expect(result.suggestedSql).toContain("default_payment_policy_id = 'PAYMENT-REAL'");
    expect(result.suggestedSql).toContain("merchant_location_key = 'default-main-location'");
  });

  it('warns when DB app settings read fails and resources are missing', async () => {
    validateSandboxOAuthAccessMock.mockResolvedValue({ tokenScopes: [] });
    getSandboxSellingPolicyManagementDiagnosticMock.mockResolvedValue({
      selling_policy_management_opted_in: 'unknown',
      warnings: ['Could not determine selling policy opt-in status.'],
    });

    const api = createApi();
    api.account.getFulfillmentPolicies = vi.fn().mockResolvedValue({ fulfillmentPolicies: [] });
    api.account.getPaymentPolicies = vi.fn().mockResolvedValue({ paymentPolicies: [] });
    api.account.getReturnPolicies = vi.fn().mockResolvedValue({ returnPolicies: [] });
    api.inventory.getInventoryLocations = vi.fn().mockResolvedValue({ locations: [] });

    const result = await getSandboxConfigDiagnostic({
      api,
      dataAccess: {
        appSettings: {
          create: vi.fn(),
          get: vi.fn().mockRejectedValue(new Error('db unavailable')),
          update: vi.fn(),
        },
      },
    });

    expect(result.appSettings.current).toBeNull();
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        'Could not determine selling policy opt-in status.',
        'Failed to read app_settings.default: db unavailable',
        'No payment policies found for marketplace EBAY_US.',
        'No fulfillment policies found for marketplace EBAY_US.',
        'No return policies found for marketplace EBAY_US.',
        'No inventory locations found.',
      ])
    );
    expect(result.suggestedSql).toContain("'<paymentPolicyId>'");
  });
});
