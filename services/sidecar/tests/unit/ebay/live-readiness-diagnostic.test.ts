import { DEFAULT_APP_SETTINGS_ID, type AppSettingsRow } from '@ebay-inventory/data';
import { describe, expect, it, vi } from 'vitest';
import { EbayApiRequestError } from '@/api/client.js';
import {
  getLiveReadinessDiagnostic,
  type LiveReadinessApi,
} from '@/ebay/live-readiness-diagnostic.js';
import type { EbayOAuthValidationConfig } from '@/ebay/config.js';
import type { EbayConfig } from '@/types/ebay.js';

function createRuntimeConfig(overrides: Partial<EbayConfig> = {}): EbayConfig {
  return {
    accessToken: 'access-token-secret',
    appAccessToken: 'app-access-token-secret',
    clientId: 'client-id',
    clientSecret: 'client-secret-secret',
    contentLanguage: 'en-US',
    environment: 'production',
    marketplaceId: 'EBAY_US',
    refreshToken: 'refresh-token-secret',
    ...overrides,
  };
}

function createOauthConfig(
  overrides: Partial<EbayOAuthValidationConfig> = {}
): EbayOAuthValidationConfig {
  return {
    apiBaseUrl: 'https://api.ebay.com',
    clientId: 'client-id',
    clientSecret: 'client-secret-secret',
    environment: 'production',
    marketplaceId: 'EBAY_US',
    oauthBaseUrl: 'https://api.ebay.com/identity/v1/oauth2/token',
    publishEnabled: true,
    refreshToken: 'refresh-token-secret',
    ...overrides,
  };
}

function createAppSettings(overrides: Partial<AppSettingsRow> = {}): AppSettingsRow {
  return {
    default_fulfillment_policy_id: 'FULFILLMENT-REAL',
    default_package_type: null,
    default_payment_policy_id: 'PAYMENT-REAL',
    default_return_policy_id: 'RETURN-REAL',
    ebay_marketplace_id: 'EBAY_US',
    id: DEFAULT_APP_SETTINGS_ID,
    merchant_location_key: 'warehouse-main',
    ...overrides,
  } as AppSettingsRow;
}

function createApi() {
  const api = {
    account: {
      createFulfillmentPolicy: vi.fn(),
      createPaymentPolicy: vi.fn(),
      createReturnPolicy: vi.fn(),
      getFulfillmentPolicy: vi.fn().mockResolvedValue({
        fulfillmentPolicyId: 'FULFILLMENT-REAL',
        marketplaceId: 'EBAY_US',
        name: 'Live Fulfillment',
      }),
      getPaymentPolicy: vi.fn().mockResolvedValue({
        marketplaceId: 'EBAY_US',
        name: 'Live Payment',
        paymentPolicyId: 'PAYMENT-REAL',
      }),
      getPrivileges: vi.fn().mockResolvedValue({
        sellingLimit: { amount: { currency: 'USD', value: '1000.00' }, quantity: 100 },
      }),
      getReturnPolicy: vi.fn().mockResolvedValue({
        marketplaceId: 'EBAY_US',
        name: 'Live Return',
        returnPolicyId: 'RETURN-REAL',
      }),
      updateFulfillmentPolicy: vi.fn(),
      updatePaymentPolicy: vi.fn(),
      updateReturnPolicy: vi.fn(),
    },
    initialize: vi.fn().mockResolvedValue(undefined),
    inventory: {
      createOrReplaceInventoryLocation: vi.fn(),
      enableInventoryLocation: vi.fn(),
      getInventoryLocation: vi.fn().mockResolvedValue({
        merchantLocationKey: 'warehouse-main',
        merchantLocationStatus: 'ENABLED',
        name: 'Warehouse Main',
      }),
      updateLocationDetails: vi.fn(),
    },
  };

  return api as LiveReadinessApi & typeof api;
}

function createDataAccess(appSettings: AppSettingsRow | null, error?: unknown) {
  return {
    appSettings: {
      get: error ? vi.fn().mockRejectedValue(error) : vi.fn().mockResolvedValue(appSettings),
    },
  };
}

describe('live readiness diagnostic', () => {
  it('rejects when EBAY_ENVIRONMENT is not production', async () => {
    process.env.EBAY_ENVIRONMENT = 'sandbox';

    const api = createApi();
    const dataAccess = createDataAccess(createAppSettings());

    const report = await getLiveReadinessDiagnostic({
      api,
      dataAccess,
      oauthConfig: createOauthConfig(),
      runtimeConfig: createRuntimeConfig(),
    });

    expect(report.overallStatus).toBe('blocked');
    expect(report.checks.find((check) => check.name === 'environment_config')).toMatchObject({
      status: 'fail',
    });
    expect(report.checks.find((check) => check.name === 'oauth_refresh')).toMatchObject({
      status: 'warning',
    });
    expect(report.checks.find((check) => check.name === 'seller_account_access')?.details).toEqual({
      blockedBy: 'environment_config',
    });
    expect(api.initialize).not.toHaveBeenCalled();
    expect(api.account.getPrivileges).not.toHaveBeenCalled();
  });

  it('rejects sandbox base URLs in production readiness mode', async () => {
    process.env.EBAY_ENVIRONMENT = 'production';

    const report = await getLiveReadinessDiagnostic({
      api: createApi(),
      dataAccess: createDataAccess(createAppSettings()),
      oauthConfig: createOauthConfig({
        apiBaseUrl: 'https://api.sandbox.ebay.com',
        oauthBaseUrl: 'https://api.sandbox.ebay.com/identity/v1/oauth2/token',
      }),
      runtimeConfig: createRuntimeConfig(),
    });

    expect(report.overallStatus).toBe('blocked');
    expect(report.checks.find((check) => check.name === 'environment_config')?.message).toContain(
      'production host'
    );
  });

  it('reads policy and location config from app_settings.default used by publish', async () => {
    process.env.EBAY_ENVIRONMENT = 'production';

    const api = createApi();
    const dataAccess = createDataAccess(createAppSettings());

    const report = await getLiveReadinessDiagnostic({
      api,
      dataAccess,
      oauthConfig: createOauthConfig(),
      runtimeConfig: createRuntimeConfig(),
      validateOAuth: vi.fn().mockResolvedValue({
        environment: 'production',
        expiresIn: 7200,
        marketplaceId: 'EBAY_US',
        ok: true,
        tokenType: 'Bearer',
      }),
    });

    expect(dataAccess.appSettings.get).toHaveBeenCalledWith(DEFAULT_APP_SETTINGS_ID);
    expect(report.productionPublishEnabled).toBe(true);
    expect(report).not.toHaveProperty('oauthBaseUrl');
    expect(report.checks.find((check) => check.name === 'payment_policy')?.details).toMatchObject({
      configuredValue: 'PAYMENT-REAL',
      paymentPolicyId: 'PAYMENT-REAL',
    });
    expect(report.checks.find((check) => check.name === 'inventory_location')?.details).toMatchObject({
      merchantLocationKey: 'warehouse-main',
    });
    expect(
      report.checks.find((check) => check.name === 'publish_config_resolution')?.details
    ).toMatchObject({
      default_payment_policy_id: 'PAYMENT-REAL',
      merchant_location_key: 'warehouse-main',
    });
  });

  it('returns overallStatus ready when all read-only checks pass', async () => {
    process.env.EBAY_ENVIRONMENT = 'production';

    const api = createApi();
    const report = await getLiveReadinessDiagnostic({
      api,
      dataAccess: createDataAccess(createAppSettings()),
      oauthConfig: createOauthConfig(),
      runtimeConfig: createRuntimeConfig(),
      validateOAuth: vi.fn().mockResolvedValue({
        environment: 'production',
        expiresIn: 7200,
        marketplaceId: 'EBAY_US',
        ok: true,
        tokenType: 'Bearer',
      }),
    });

    expect(report.overallStatus).toBe('ready');
    expect(report.productionPublishEnabled).toBe(true);
    expect(report.checks.every((check) => check.status === 'pass')).toBe(true);
    expect(api.account.createPaymentPolicy).not.toHaveBeenCalled();
    expect(api.account.updatePaymentPolicy).not.toHaveBeenCalled();
    expect(api.account.createFulfillmentPolicy).not.toHaveBeenCalled();
    expect(api.account.updateFulfillmentPolicy).not.toHaveBeenCalled();
    expect(api.account.createReturnPolicy).not.toHaveBeenCalled();
    expect(api.account.updateReturnPolicy).not.toHaveBeenCalled();
    expect(api.inventory.createOrReplaceInventoryLocation).not.toHaveBeenCalled();
    expect(api.inventory.updateLocationDetails).not.toHaveBeenCalled();
    expect(api.inventory.enableInventoryLocation).not.toHaveBeenCalled();
  });

  it('returns overallStatus warning when only production publish guard is disabled', async () => {
    process.env.EBAY_ENVIRONMENT = 'production';

    const report = await getLiveReadinessDiagnostic({
      api: createApi(),
      dataAccess: createDataAccess(createAppSettings()),
      oauthConfig: createOauthConfig({ publishEnabled: false }),
      runtimeConfig: createRuntimeConfig(),
      validateOAuth: vi.fn().mockResolvedValue({
        environment: 'production',
        expiresIn: 7200,
        marketplaceId: 'EBAY_US',
        ok: true,
        tokenType: 'Bearer',
      }),
    });

    expect(report.overallStatus).toBe('warning');
    expect(report.productionPublishEnabled).toBe(false);
    expect(report.checks.find((check) => check.name === 'production_publish_guard')).toMatchObject({
      status: 'warning',
    });
  });

  it('returns overallStatus blocked when any required check fails', async () => {
    process.env.EBAY_ENVIRONMENT = 'production';

    const api = createApi();
    api.account.getPrivileges = vi.fn().mockRejectedValue(
      new EbayApiRequestError(
        'eBay API Error: seller access denied',
        [
          {
            category: 'REQUEST',
            domain: 'API_ACCOUNT',
            errorId: 1100,
            message: 'seller access denied',
          },
        ],
        403
      )
    );

    const report = await getLiveReadinessDiagnostic({
      api,
      dataAccess: createDataAccess(createAppSettings()),
      oauthConfig: createOauthConfig(),
      runtimeConfig: createRuntimeConfig(),
      validateOAuth: vi.fn().mockResolvedValue({
        environment: 'production',
        expiresIn: 7200,
        marketplaceId: 'EBAY_US',
        ok: true,
        tokenType: 'Bearer',
      }),
    });

    expect(report.overallStatus).toBe('blocked');
    expect(report.checks.find((check) => check.name === 'seller_account_access')).toMatchObject({
      status: 'fail',
    });
  });

  it('fails when policy IDs are missing', async () => {
    process.env.EBAY_ENVIRONMENT = 'production';

    const api = createApi();
    const report = await getLiveReadinessDiagnostic({
      api,
      dataAccess: createDataAccess(
        createAppSettings({
          default_fulfillment_policy_id: null,
          default_payment_policy_id: null,
          default_return_policy_id: null,
        })
      ),
      oauthConfig: createOauthConfig(),
      runtimeConfig: createRuntimeConfig(),
      validateOAuth: vi.fn().mockResolvedValue({
        environment: 'production',
        expiresIn: 7200,
        marketplaceId: 'EBAY_US',
        ok: true,
        tokenType: 'Bearer',
      }),
    });

    expect(report.checks.find((check) => check.name === 'payment_policy')).toMatchObject({
      status: 'fail',
    });
    expect(report.checks.find((check) => check.name === 'fulfillment_policy')).toMatchObject({
      status: 'fail',
    });
    expect(report.checks.find((check) => check.name === 'return_policy')).toMatchObject({
      status: 'fail',
    });
    expect(api.account.getPaymentPolicy).not.toHaveBeenCalled();
    expect(api.account.getFulfillmentPolicy).not.toHaveBeenCalled();
    expect(api.account.getReturnPolicy).not.toHaveBeenCalled();
    expect(report.overallStatus).toBe('blocked');
  });

  it('fails when merchant location key is missing', async () => {
    process.env.EBAY_ENVIRONMENT = 'production';

    const api = createApi();
    const report = await getLiveReadinessDiagnostic({
      api,
      dataAccess: createDataAccess(
        createAppSettings({
          merchant_location_key: null,
        })
      ),
      oauthConfig: createOauthConfig(),
      runtimeConfig: createRuntimeConfig(),
      validateOAuth: vi.fn().mockResolvedValue({
        environment: 'production',
        expiresIn: 7200,
        marketplaceId: 'EBAY_US',
        ok: true,
        tokenType: 'Bearer',
      }),
    });

    expect(report.checks.find((check) => check.name === 'inventory_location')).toMatchObject({
      status: 'fail',
    });
    expect(api.inventory.getInventoryLocation).not.toHaveBeenCalled();
    expect(report.overallStatus).toBe('blocked');
  });

  it('blocks when publish config contains placeholder values', async () => {
    process.env.EBAY_ENVIRONMENT = 'production';

    const report = await getLiveReadinessDiagnostic({
      api: createApi(),
      dataAccess: createDataAccess(
        createAppSettings({
          default_payment_policy_id: 'mock-payment-policy-id',
        })
      ),
      oauthConfig: createOauthConfig(),
      runtimeConfig: createRuntimeConfig(),
      validateOAuth: vi.fn().mockResolvedValue({
        environment: 'production',
        expiresIn: 7200,
        marketplaceId: 'EBAY_US',
        ok: true,
        tokenType: 'Bearer',
      }),
    });

    expect(report.overallStatus).toBe('blocked');
    expect(
      report.checks.find((check) => check.name === 'publish_config_resolution')
    ).toMatchObject({
      status: 'fail',
    });
  });

  it('preserves sanitized eBay API failure details without leaking secrets', async () => {
    process.env.EBAY_ENVIRONMENT = 'production';

    const api = createApi();
    api.account.getPaymentPolicy = vi.fn().mockRejectedValue(
      new EbayApiRequestError(
        'eBay API Error: Bearer access-token-secret',
        [
          {
            category: 'REQUEST',
            domain: 'API_ACCOUNT',
            errorId: 32100,
            longMessage:
              'Authorization: Bearer access-token-secret bad refresh-token-secret client-secret-secret',
            message: 'bad refresh-token-secret',
            parameters: [{ name: 'token', value: 'access-token-secret' }],
          },
        ],
        403
      )
    );

    const report = await getLiveReadinessDiagnostic({
      api,
      dataAccess: createDataAccess(createAppSettings()),
      oauthConfig: createOauthConfig(),
      runtimeConfig: createRuntimeConfig(),
      validateOAuth: vi.fn().mockResolvedValue({
        environment: 'production',
        expiresIn: 7200,
        marketplaceId: 'EBAY_US',
        ok: true,
        tokenType: 'Bearer',
      }),
    });

    const paymentPolicyCheck = report.checks.find((check) => check.name === 'payment_policy');
    expect(paymentPolicyCheck).toMatchObject({
      status: 'fail',
    });
    expect(paymentPolicyCheck?.details).toMatchObject({
      errorId: 32100,
      statusCode: 403,
    });

    const json = JSON.stringify(report);
    expect(json).not.toContain('refresh-token-secret');
    expect(json).not.toContain('access-token-secret');
    expect(json).not.toContain('client-secret-secret');
    expect(json).not.toContain('Authorization');
    expect(json).toContain('[REDACTED]');
  });

  it('never invokes listing or offer mutation methods during diagnostics', async () => {
    process.env.EBAY_ENVIRONMENT = 'production';

    const api = createApi() as LiveReadinessApi &
      ReturnType<typeof createApi> & {
        inventory: ReturnType<typeof createApi>['inventory'] & {
          createOffer: ReturnType<typeof vi.fn>;
          createOrReplaceInventoryItem: ReturnType<typeof vi.fn>;
          publishOffer: ReturnType<typeof vi.fn>;
        };
      };
    api.inventory.createOffer = vi.fn();
    api.inventory.createOrReplaceInventoryItem = vi.fn();
    api.inventory.publishOffer = vi.fn();

    await getLiveReadinessDiagnostic({
      api,
      dataAccess: createDataAccess(createAppSettings()),
      oauthConfig: createOauthConfig(),
      runtimeConfig: createRuntimeConfig(),
      validateOAuth: vi.fn().mockResolvedValue({
        environment: 'production',
        expiresIn: 7200,
        marketplaceId: 'EBAY_US',
        ok: true,
        tokenType: 'Bearer',
      }),
    });

    expect(api.inventory.createOrReplaceInventoryItem).not.toHaveBeenCalled();
    expect(api.inventory.createOffer).not.toHaveBeenCalled();
    expect(api.inventory.publishOffer).not.toHaveBeenCalled();
  });
});
