import { describe, expect, it } from 'vitest';
import type { AppSettingsRow, ListingRow } from '@ebay-inventory/data';
import {
  PublishListingValidationError,
  getPublishAppSettingIssues,
  validatePublishListingReadiness,
} from '@/ebay/publish-validation.js';

function createListing(overrides: Partial<ListingRow> = {}): ListingRow {
  return {
    approved_for_export_at: '2026-05-24T12:00:00.000Z',
    capture_mode: null,
    category_id: '1234',
    condition_id: '4000',
    condition_notes: null,
    created_at: '2026-05-24T10:00:00.000Z',
    description: 'desc',
    ebay_listing_id: null,
    ebay_listing_status: null,
    ebay_listing_url: null,
    ebay_offer_id: null,
    ese_eligible: null,
    estimated_weight_oz: 8,
    exported_at: null,
    generated_at: '2026-05-24T11:00:00.000Z',
    handling_days: 2,
    id: 'row-1',
    image_urls: ['https://cdn.example.com/front.jpg'],
    item_specifics: {},
    last_error_at: null,
    last_error_code: null,
    last_error_context: {},
    last_error_message: null,
    listing_id: 'LIST-001',
    listing_type: 'single',
    merchant_location_key: null,
    package_type: 'BOX',
    price: 12.5,
    r2_delete_after: null,
    r2_deleted_at: null,
    r2_object_keys: [],
    r2_retention_policy: null,
    seller_hints: null,
    shipping_profile: null,
    sku: null,
    sold_at: null,
    status: 'approved_for_export',
    sub_status: 'publish_queued',
    title: 'Vintage puzzle',
    updated_at: '2026-05-24T11:30:00.000Z',
    ...overrides,
  };
}

function createAppSettings(overrides: Partial<AppSettingsRow> = {}): AppSettingsRow {
  return {
    capture_mode: 'single_2_image',
    default_fulfillment_policy_id: 'FULFILLMENT-1',
    default_package_type: 'LETTER',
    default_payment_policy_id: 'PAYMENT-1',
    default_return_policy_id: 'RETURN-1',
    default_shipping_profile: null,
    ebay_marketplace_id: 'EBAY_US',
    gemini_daily_limit: 500,
    handling_days: 2,
    id: 'default',
    incoming_folder_path: '/incoming',
    max_order_syncs_per_day: 25,
    merchant_location_key: 'warehouse-1',
    office_location_name: null,
    processed_folder_path: '/processed',
    r2_retention_days_after_sold: 30,
    updated_at: '2026-05-24T11:00:00.000Z',
    ...overrides,
  };
}

describe('publish validation app settings checks', () => {
  it('flags null ebay marketplace before offer creation', () => {
    expect(getPublishAppSettingIssues(createAppSettings({ ebay_marketplace_id: null }))).toContain(
      'app_settings.ebay_marketplace_id is required for publish.'
    );
  });

  it('flags blank ebay marketplace before offer creation', () => {
    expect(
      getPublishAppSettingIssues(createAppSettings({ ebay_marketplace_id: '   ' }))
    ).toContain('app_settings.ebay_marketplace_id is required for publish.');
  });

  it('flags blank payment policy id before offer creation', () => {
    expect(
      getPublishAppSettingIssues(createAppSettings({ default_payment_policy_id: '   ' }))
    ).toContain('app_settings.default_payment_policy_id is required for publish.');
  });

  it('flags placeholder fulfillment policy id before offer creation', () => {
    expect(
      getPublishAppSettingIssues(
        createAppSettings({
          default_fulfillment_policy_id: 'mock-fulfillment-policy-id',
        })
      )
    ).toContain(
      'app_settings.default_fulfillment_policy_id "mock-fulfillment-policy-id" is a placeholder. Run sandbox policy diagnostics and update app_settings.default before publish.'
    );
  });

  it('flags blank fulfillment policy id before offer creation', () => {
    expect(
      getPublishAppSettingIssues(createAppSettings({ default_fulfillment_policy_id: '   ' }))
    ).toContain('app_settings.default_fulfillment_policy_id is required for publish.');
  });

  it('flags placeholder payment policy id before offer creation', () => {
    expect(
      getPublishAppSettingIssues(
        createAppSettings({
          default_payment_policy_id: 'mock-payment-policy-id',
        })
      )
    ).toContain(
      'app_settings.default_payment_policy_id "mock-payment-policy-id" is a placeholder. Run sandbox policy diagnostics and update app_settings.default before publish.'
    );
  });

  it('flags blank return policy id before offer creation', () => {
    expect(
      getPublishAppSettingIssues(createAppSettings({ default_return_policy_id: '   ' }))
    ).toContain('app_settings.default_return_policy_id is required for publish.');
  });

  it('flags placeholder return policy id before offer creation', () => {
    expect(
      getPublishAppSettingIssues(
        createAppSettings({
          default_return_policy_id: 'mock-return-policy-id',
        })
      )
    ).toContain(
      'app_settings.default_return_policy_id "mock-return-policy-id" is a placeholder. Run sandbox policy diagnostics and update app_settings.default before publish.'
    );
  });

  it('flags blank merchant location key before offer creation', () => {
    expect(
      getPublishAppSettingIssues(createAppSettings({ merchant_location_key: '   ' }))
    ).toContain('app_settings.merchant_location_key is required for publish.');
  });

  it('flags placeholder merchant location key before offer creation', () => {
    expect(
      getPublishAppSettingIssues(
        createAppSettings({
          merchant_location_key: 'mock-main-location',
        })
      )
    ).toContain(
      'app_settings.merchant_location_key "mock-main-location" looks like a placeholder. Run sandbox location diagnostics and update app_settings.default before publish.'
    );
  });

  it('treats default-main-location as placeholder when paired with mock policy ids', () => {
    expect(
      getPublishAppSettingIssues(
        createAppSettings({
          default_payment_policy_id: 'mock-payment-policy-id',
          merchant_location_key: 'default-main-location',
        })
      )
    ).toContain(
      'app_settings.merchant_location_key "default-main-location" looks like a placeholder. Run sandbox location diagnostics and update app_settings.default before publish.'
    );
  });

  it('accepts valid-looking settings without placeholder issues', () => {
    expect(
      getPublishAppSettingIssues(
        createAppSettings({
          default_fulfillment_policy_id: '6201234000',
          default_payment_policy_id: '6201235000',
          default_return_policy_id: '6201236000',
          ebay_marketplace_id: 'EBAY_US',
          merchant_location_key: 'default-main-location',
        })
      )
    ).toEqual([]);
  });

  it('blocks publish readiness before offer creation when app settings contain placeholders', () => {
    expect(() =>
      validatePublishListingReadiness(
        createListing(),
        createAppSettings({
          default_fulfillment_policy_id: 'mock-fulfillment-policy-id',
        })
      )
    ).toThrow(PublishListingValidationError);
  });
});
