import { describe, expect, it } from 'vitest';
import type { AppSettingsRow } from '@ebay-inventory/data';
import { resolvePublishConfig } from '@/ebay/publish-config.js';

function createAppSettings(overrides: Partial<AppSettingsRow> = {}): AppSettingsRow {
  return {
    capture_mode: 'single_2_image',
    default_fulfillment_policy_id: 'LEGACY-FULFILLMENT',
    default_package_type: 'LETTER',
    default_payment_policy_id: 'LEGACY-PAYMENT',
    default_return_policy_id: 'LEGACY-RETURN',
    default_shipping_profile: null,
    ebay_marketplace_id: 'EBAY_US',
    ebay_publish_config: {
      production: {
        fulfillmentPolicyId: 'LIVE-FULFILLMENT',
        marketplaceId: 'EBAY_US',
        merchantLocationKey: 'live-warehouse',
        paymentPolicyId: 'LIVE-PAYMENT',
        returnPolicyId: 'LIVE-RETURN',
      },
      sandbox: {
        fulfillmentPolicyId: 'SANDBOX-FULFILLMENT',
        marketplaceId: 'EBAY_US',
        merchantLocationKey: 'sandbox-warehouse',
        paymentPolicyId: 'SANDBOX-PAYMENT',
        returnPolicyId: 'SANDBOX-RETURN',
      },
    },
    gemini_daily_limit: 500,
    handling_days: 2,
    id: 'default',
    incoming_folder_path: null,
    max_order_syncs_per_day: 25,
    merchant_location_key: 'legacy-warehouse',
    office_location_name: null,
    processed_folder_path: null,
    r2_retention_days_after_sold: 30,
    updated_at: '2026-06-03T12:00:00.000Z',
    ...overrides,
  };
}

describe('resolvePublishConfig', () => {
  it('resolves sandbox runtime to sandbox config', () => {
    const result = resolvePublishConfig(createAppSettings(), {
      environment: 'sandbox',
      runtimeMarketplaceId: 'EBAY_US',
    });

    expect(result.issues).toEqual([]);
    expect(result.config).toMatchObject({
      environment: 'sandbox',
      fulfillmentPolicyId: 'SANDBOX-FULFILLMENT',
      merchantLocationKey: 'sandbox-warehouse',
      paymentPolicyId: 'SANDBOX-PAYMENT',
      returnPolicyId: 'SANDBOX-RETURN',
    });
  });

  it('resolves production runtime to production config', () => {
    const result = resolvePublishConfig(createAppSettings(), {
      environment: 'production',
      runtimeMarketplaceId: 'EBAY_US',
    });

    expect(result.issues).toEqual([]);
    expect(result.config).toMatchObject({
      environment: 'production',
      fulfillmentPolicyId: 'LIVE-FULFILLMENT',
      merchantLocationKey: 'live-warehouse',
      paymentPolicyId: 'LIVE-PAYMENT',
      returnPolicyId: 'LIVE-RETURN',
    });
  });

  it('never resolves production config when sandbox runtime active', () => {
    const result = resolvePublishConfig(
      createAppSettings({
        ebay_publish_config: {
          production: {
            fulfillmentPolicyId: 'LIVE-FULFILLMENT',
            marketplaceId: 'EBAY_US',
            merchantLocationKey: 'live-warehouse',
            paymentPolicyId: 'LIVE-PAYMENT',
            returnPolicyId: 'LIVE-RETURN',
          },
        },
      }),
      {
        environment: 'sandbox',
        runtimeMarketplaceId: 'EBAY_US',
      }
    );

    expect(result.config).toBeNull();
    expect(result.issues).toContain(
      'publish_config_missing_for_environment: app_settings.ebay_publish_config.sandbox is required when EBAY_ENVIRONMENT=sandbox.'
    );
  });

  it('never resolves sandbox config when production runtime active', () => {
    const result = resolvePublishConfig(
      createAppSettings({
        ebay_publish_config: {
          sandbox: {
            fulfillmentPolicyId: 'SANDBOX-FULFILLMENT',
            marketplaceId: 'EBAY_US',
            merchantLocationKey: 'sandbox-warehouse',
            paymentPolicyId: 'SANDBOX-PAYMENT',
            returnPolicyId: 'SANDBOX-RETURN',
          },
        },
      }),
      {
        environment: 'production',
        runtimeMarketplaceId: 'EBAY_US',
      }
    );

    expect(result.config).toBeNull();
    expect(result.issues).toContain(
      'publish_config_missing_for_environment: app_settings.ebay_publish_config.production is required when EBAY_ENVIRONMENT=production.'
    );
  });

  it('fails for missing sandbox config before api call path', () => {
    const result = resolvePublishConfig(createAppSettings({ ebay_publish_config: null }), {
      environment: 'sandbox',
      runtimeMarketplaceId: 'EBAY_US',
    });

    expect(result.config?.source).toBe('legacy_flat');
  });

  it('fails for missing production config before api call path', () => {
    const result = resolvePublishConfig(
      createAppSettings({
        ebay_publish_config: {
          sandbox: {
            fulfillmentPolicyId: 'SANDBOX-FULFILLMENT',
            marketplaceId: 'EBAY_US',
            merchantLocationKey: 'sandbox-warehouse',
            paymentPolicyId: 'SANDBOX-PAYMENT',
            returnPolicyId: 'SANDBOX-RETURN',
          },
        },
      }),
      {
        environment: 'production',
        runtimeMarketplaceId: 'EBAY_US',
      }
    );

    expect(result.config).toBeNull();
    expect(result.issues).toContain(
      'publish_config_missing_for_environment: app_settings.ebay_publish_config.production is required when EBAY_ENVIRONMENT=production.'
    );
  });

  it('fails when marketplace mismatches runtime marketplace', () => {
    const result = resolvePublishConfig(createAppSettings(), {
      environment: 'sandbox',
      runtimeMarketplaceId: 'EBAY_GB',
    });

    expect(result.config).toBeNull();
    expect(result.issues).toContain(
      'publish_config_marketplace_mismatch: Resolved publish marketplace "EBAY_US" does not match runtime marketplace "EBAY_GB".'
    );
  });

  it('fails when merchant location key missing', () => {
    const result = resolvePublishConfig(
      createAppSettings({
        ebay_publish_config: {
          sandbox: {
            fulfillmentPolicyId: 'SANDBOX-FULFILLMENT',
            marketplaceId: 'EBAY_US',
            merchantLocationKey: '   ',
            paymentPolicyId: 'SANDBOX-PAYMENT',
            returnPolicyId: 'SANDBOX-RETURN',
          },
        },
      }),
      {
        environment: 'sandbox',
        runtimeMarketplaceId: 'EBAY_US',
      }
    );

    expect(result.config).toBeNull();
    expect(result.issues).toContain(
      'merchant_location_key_missing_for_environment: app_settings.ebay_publish_config.sandbox.merchantLocationKey is required for sandbox publish config.'
    );
  });
});
