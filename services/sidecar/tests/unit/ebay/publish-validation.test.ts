import { describe, expect, it } from 'vitest';
import type { AppSettingsRow, ListingRow } from '@ebay-inventory/data';
import {
  PublishRequiredFieldValidationError,
  PublishListingValidationError,
  assertPublishReady,
  getPublishAppSettingIssues,
  validatePublishReady,
  validatePublishListingReadiness,
} from '@/ebay/publish-validation.js';
import type { ResolvedPublishConfig } from '@/ebay/publish-config.js';

const STRUCTURED_SKU = 'BSKBL-Single-000001';

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
    sku: STRUCTURED_SKU,
    sold_at: null,
    status: 'approved_for_export',
    sub_status: 'publish_queued',
    title: 'Vintage puzzle',
    updated_at: '2026-05-24T11:30:00.000Z',
    ...overrides,
  };
}

function createAppSettings(overrides: Partial<AppSettingsRow> = {}): AppSettingsRow {
  const appSettings: AppSettingsRow = {
    capture_mode: 'single_2_image',
    default_fulfillment_policy_id: 'FULFILLMENT-1',
    default_package_type: 'LETTER',
    default_payment_policy_id: 'PAYMENT-1',
    default_return_policy_id: 'RETURN-1',
    default_shipping_profile: null,
    ebay_marketplace_id: 'EBAY_US',
    ebay_publish_config: null,
    gemini_daily_limit: 500,
    handling_days: 2,
    id: 'default',
    incoming_folder_path: '/incoming',
    max_order_syncs_per_day: 25,
    merchant_location_key: 'warehouse-1',
    office_location_name: null,
    processed_folder_path: '/processed',
    soldcomps_usage_snapshot: null,
    r2_retention_days_after_sold: 30,
    updated_at: '2026-05-24T11:00:00.000Z',
    ...overrides,
  };

  if (appSettings.ebay_publish_config == null) {
    appSettings.ebay_publish_config = {
      sandbox: {
        fulfillmentPolicyId: appSettings.default_fulfillment_policy_id,
        marketplaceId: appSettings.ebay_marketplace_id,
        merchantLocationKey: appSettings.merchant_location_key,
        paymentPolicyId: appSettings.default_payment_policy_id,
        returnPolicyId: appSettings.default_return_policy_id,
      },
    };
  }

  return appSettings;
}

function createPublishConfig(
  overrides: Partial<ResolvedPublishConfig> = {}
): ResolvedPublishConfig {
  return {
    environment: 'sandbox',
    fulfillmentPolicyId: 'FULFILLMENT-1',
    marketplaceId: 'EBAY_US',
    merchantLocationKey: 'warehouse-1',
    paymentPolicyId: 'PAYMENT-1',
    returnPolicyId: 'RETURN-1',
    source: 'environment_config',
    ...overrides,
  };
}

describe('validatePublishReady', () => {
  it('passes for valid listing and valid config', () => {
    expect(
      validatePublishReady({
        listing: createListing({
          sku: STRUCTURED_SKU,
        }),
        publishConfig: createPublishConfig(),
        quantity: 1,
      })
    ).toEqual({ ok: true });
  });

  it('throws structured required-field error via assert helper', () => {
    expect(() =>
      assertPublishReady({
        listing: createListing({
          sku: STRUCTURED_SKU,
          title: '   ',
        }),
        publishConfig: createPublishConfig(),
        quantity: 1,
      })
    ).toThrow(PublishRequiredFieldValidationError);
  });

  it('reports missing title', () => {
    expect(
      validatePublishReady({
        listing: createListing({
          sku: STRUCTURED_SKU,
          title: null,
        }),
        publishConfig: createPublishConfig(),
        quantity: 1,
      })
    ).toMatchObject({
      code: 'PUBLISH_REQUIRED_FIELD_MISSING',
      fields: [{ field: 'title', message: 'Title is required before publishing.' }],
      kind: 'user_fixable',
      ok: false,
    });
  });

  it('reports blank and whitespace title', () => {
    expect(
      validatePublishReady({
        listing: createListing({
          sku: STRUCTURED_SKU,
          title: '   ',
        }),
        publishConfig: createPublishConfig(),
        quantity: 1,
      })
    ).toMatchObject({
      fields: [{ field: 'title', message: 'Title is required before publishing.' }],
      ok: false,
    });
  });

  it('reports missing description', () => {
    expect(
      validatePublishReady({
        listing: createListing({
          description: '  ',
          sku: STRUCTURED_SKU,
        }),
        publishConfig: createPublishConfig(),
        quantity: 1,
      })
    ).toMatchObject({
      fields: [{ field: 'description', message: 'Description is required before publishing.' }],
      ok: false,
    });
  });

  it.each([
    { label: 'missing', price: null },
    { label: 'zero', price: 0 },
    { label: 'negative', price: -1 },
  ])('reports invalid price: $label', ({ price }) => {
    expect(
      validatePublishReady({
        listing: createListing({
          price,
          sku: STRUCTURED_SKU,
        }),
        publishConfig: createPublishConfig(),
        quantity: 1,
      })
    ).toMatchObject({
      fields: [{ field: 'price', message: 'Price must be greater than 0 before publishing.' }],
      ok: false,
    });
  });

  it('reports missing category ID', () => {
    expect(
      validatePublishReady({
        listing: createListing({
          category_id: '  ',
          sku: STRUCTURED_SKU,
        }),
        publishConfig: createPublishConfig(),
        quantity: 1,
      })
    ).toMatchObject({
      fields: [{ field: 'categoryId', message: 'Category ID is required before publishing.' }],
      ok: false,
    });
  });

  it('reports missing condition ID', () => {
    expect(
      validatePublishReady({
        listing: createListing({
          condition_id: null,
          sku: STRUCTURED_SKU,
        }),
        publishConfig: createPublishConfig(),
        quantity: 1,
      })
    ).toMatchObject({
      fields: [{ field: 'conditionId', message: 'Condition ID is required before publishing.' }],
      ok: false,
    });
  });

  it('reports missing image URLs', () => {
    expect(
      validatePublishReady({
        listing: createListing({
          image_urls: [],
          sku: STRUCTURED_SKU,
        }),
        publishConfig: createPublishConfig(),
        quantity: 1,
      })
    ).toMatchObject({
      fields: [
        {
          field: 'imageUrls',
          message: 'At least one image URL is required before publishing.',
        },
      ],
      ok: false,
    });
  });

  it('reports invalid image URL', () => {
    expect(
      validatePublishReady({
        listing: createListing({
          image_urls: ['ftp://cdn.example.com/front.jpg'],
          sku: STRUCTURED_SKU,
        }),
        publishConfig: createPublishConfig(),
        quantity: 1,
      })
    ).toMatchObject({
      fields: [
        {
          field: 'imageUrls',
          message: 'At least one valid HTTP/HTTPS image URL is required before publishing.',
        },
      ],
      ok: false,
    });
  });

  it('reports missing SKU or custom label', () => {
    expect(
      validatePublishReady({
        listing: createListing({
          sku: '   ',
        }),
        publishConfig: createPublishConfig(),
        quantity: 1,
      })
    ).toMatchObject({
      fields: [{ field: 'sku', message: 'SKU or custom label is required before publishing.' }],
      ok: false,
    });
  });

  it.each(['Single-000001', 'NOT-A-SKU', 'BSKBL-Single-000000'])(
    'reports non-finalized structured SKU: %s',
    (sku) => {
      expect(
        validatePublishReady({
          listing: createListing({
            sku,
          }),
          publishConfig: createPublishConfig(),
          quantity: 1,
        })
      ).toMatchObject({
        fields: [
          {
            field: 'sku',
            message:
              'SKU must be a finalized structured SKU like BSKBL-Single-000001 before publishing.',
            scope: 'listing',
          },
        ],
        ok: false,
      });
    }
  );

  it.each([
    { label: 'missing', quantity: null },
    { label: 'zero', quantity: 0 },
    { label: 'negative', quantity: -1 },
  ])('reports invalid quantity: $label', ({ quantity }) => {
    expect(
      validatePublishReady({
        listing: createListing({
          sku: STRUCTURED_SKU,
        }),
        publishConfig: createPublishConfig(),
        quantity,
      })
    ).toMatchObject({
      fields: [{ field: 'quantity', message: 'Quantity must be greater than 0 before publishing.' }],
      ok: false,
    });
  });

  it('reports missing marketplace ID', () => {
    expect(
      validatePublishReady({
        listing: createListing({
          sku: STRUCTURED_SKU,
        }),
        publishConfig: createPublishConfig({
          marketplaceId: '   ',
        }),
        quantity: 1,
      })
    ).toMatchObject({
      fields: [{ field: 'marketplaceId', message: 'Marketplace ID is required before publishing.' }],
      ok: false,
    });
  });

  it('reports missing payment policy ID', () => {
    expect(
      validatePublishReady({
        listing: createListing({
          sku: STRUCTURED_SKU,
        }),
        publishConfig: createPublishConfig({
          paymentPolicyId: '',
        }),
        quantity: 1,
      })
    ).toMatchObject({
      fields: [
        { field: 'paymentPolicyId', message: 'Payment policy ID is required before publishing.' },
      ],
      ok: false,
    });
  });

  it('reports missing fulfillment policy ID', () => {
    expect(
      validatePublishReady({
        listing: createListing({
          sku: STRUCTURED_SKU,
        }),
        publishConfig: createPublishConfig({
          fulfillmentPolicyId: ' ',
        }),
        quantity: 1,
      })
    ).toMatchObject({
      fields: [
        {
          field: 'fulfillmentPolicyId',
          message: 'Fulfillment policy ID is required before publishing.',
        },
      ],
      ok: false,
    });
  });

  it('reports missing return policy ID', () => {
    expect(
      validatePublishReady({
        listing: createListing({
          sku: STRUCTURED_SKU,
        }),
        publishConfig: createPublishConfig({
          returnPolicyId: null as unknown as string,
        }),
        quantity: 1,
      })
    ).toMatchObject({
      fields: [{ field: 'returnPolicyId', message: 'Return policy ID is required before publishing.' }],
      ok: false,
    });
  });

  it('reports missing merchant location key', () => {
    expect(
      validatePublishReady({
        listing: createListing({
          sku: STRUCTURED_SKU,
        }),
        publishConfig: createPublishConfig({
          merchantLocationKey: '  ',
        }),
        quantity: 1,
      })
    ).toMatchObject({
      fields: [
        {
          field: 'merchantLocationKey',
          message: 'Merchant location key is required before publishing.',
        },
      ],
      ok: false,
    });
  });

  it('returns multiple missing fields together', () => {
    expect(
      validatePublishReady({
        listing: createListing({
          category_id: '   ',
          condition_id: null,
          description: ' ',
          image_urls: [],
          price: 0,
          sku: null,
          title: null,
        }),
        publishConfig: createPublishConfig({
          fulfillmentPolicyId: ' ',
          marketplaceId: '',
          merchantLocationKey: ' ',
          paymentPolicyId: '',
          returnPolicyId: '',
        }),
        quantity: 0,
      })
    ).toEqual({
      code: 'PUBLISH_REQUIRED_FIELD_MISSING',
      fields: [
        { field: 'title', message: 'Title is required before publishing.', scope: 'listing' },
        {
          field: 'description',
          message: 'Description is required before publishing.',
          scope: 'listing',
        },
        { field: 'price', message: 'Price must be greater than 0 before publishing.', scope: 'listing' },
        { field: 'categoryId', message: 'Category ID is required before publishing.', scope: 'listing' },
        { field: 'conditionId', message: 'Condition ID is required before publishing.', scope: 'listing' },
        {
          field: 'sku',
          message: 'SKU or custom label is required before publishing.',
          scope: 'listing',
        },
        {
          field: 'quantity',
          message: 'Quantity must be greater than 0 before publishing.',
          scope: 'listing',
        },
        {
          field: 'imageUrls',
          message: 'At least one image URL is required before publishing.',
          scope: 'listing',
        },
        {
          field: 'marketplaceId',
          message: 'Marketplace ID is required before publishing.',
          scope: 'publish_config',
        },
        {
          field: 'paymentPolicyId',
          message: 'Payment policy ID is required before publishing.',
          scope: 'publish_config',
        },
        {
          field: 'fulfillmentPolicyId',
          message: 'Fulfillment policy ID is required before publishing.',
          scope: 'publish_config',
        },
        {
          field: 'returnPolicyId',
          message: 'Return policy ID is required before publishing.',
          scope: 'publish_config',
        },
        {
          field: 'merchantLocationKey',
          message: 'Merchant location key is required before publishing.',
          scope: 'publish_config',
        },
      ],
      kind: 'user_fixable',
      ok: false,
    });
  });
});

describe('publish validation app settings checks', () => {
  it('flags null ebay marketplace before offer creation', () => {
    expect(getPublishAppSettingIssues(createAppSettings({ ebay_marketplace_id: null }))).toContain(
      'marketplace_id_missing_for_environment: app_settings.ebay_publish_config.sandbox.marketplaceId is required for sandbox publish config.'
    );
  });

  it('flags blank ebay marketplace before offer creation', () => {
    expect(
      getPublishAppSettingIssues(createAppSettings({ ebay_marketplace_id: '   ' }))
    ).toContain(
      'marketplace_id_missing_for_environment: app_settings.ebay_publish_config.sandbox.marketplaceId is required for sandbox publish config.'
    );
  });

  it('flags blank payment policy id before offer creation', () => {
    expect(
      getPublishAppSettingIssues(createAppSettings({ default_payment_policy_id: '   ' }))
    ).toContain(
      'payment_policy_id_missing_for_environment: app_settings.ebay_publish_config.sandbox.paymentPolicyId is required for sandbox publish config.'
    );
  });

  it('flags placeholder fulfillment policy id before offer creation', () => {
    expect(
      getPublishAppSettingIssues(
        createAppSettings({
          default_fulfillment_policy_id: 'mock-fulfillment-policy-id',
        })
      )
    ).toContain(
      'fulfillment_policy_id_missing_for_environment: app_settings.ebay_publish_config.sandbox.fulfillmentPolicyId "mock-fulfillment-policy-id" is a placeholder.'
    );
  });

  it('flags blank fulfillment policy id before offer creation', () => {
    expect(
      getPublishAppSettingIssues(createAppSettings({ default_fulfillment_policy_id: '   ' }))
    ).toContain(
      'fulfillment_policy_id_missing_for_environment: app_settings.ebay_publish_config.sandbox.fulfillmentPolicyId is required for sandbox publish config.'
    );
  });

  it('flags placeholder payment policy id before offer creation', () => {
    expect(
      getPublishAppSettingIssues(
        createAppSettings({
          default_payment_policy_id: 'mock-payment-policy-id',
        })
      )
    ).toContain(
      'payment_policy_id_missing_for_environment: app_settings.ebay_publish_config.sandbox.paymentPolicyId "mock-payment-policy-id" is a placeholder.'
    );
  });

  it('flags blank return policy id before offer creation', () => {
    expect(
      getPublishAppSettingIssues(createAppSettings({ default_return_policy_id: '   ' }))
    ).toContain(
      'return_policy_id_missing_for_environment: app_settings.ebay_publish_config.sandbox.returnPolicyId is required for sandbox publish config.'
    );
  });

  it('flags placeholder return policy id before offer creation', () => {
    expect(
      getPublishAppSettingIssues(
        createAppSettings({
          default_return_policy_id: 'mock-return-policy-id',
        })
      )
    ).toContain(
      'return_policy_id_missing_for_environment: app_settings.ebay_publish_config.sandbox.returnPolicyId "mock-return-policy-id" is a placeholder.'
    );
  });

  it('flags blank merchant location key before offer creation', () => {
    expect(
      getPublishAppSettingIssues(createAppSettings({ merchant_location_key: '   ' }))
    ).toContain(
      'merchant_location_key_missing_for_environment: app_settings.ebay_publish_config.sandbox.merchantLocationKey is required for sandbox publish config.'
    );
  });

  it('flags placeholder merchant location key before offer creation', () => {
    expect(
      getPublishAppSettingIssues(
        createAppSettings({
          merchant_location_key: 'mock-main-location',
        })
      )
    ).toContain(
      'merchant_location_key_missing_for_environment: app_settings.ebay_publish_config.sandbox.merchantLocationKey "mock-main-location" looks like a placeholder.'
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
      'merchant_location_key_missing_for_environment: app_settings.ebay_publish_config.sandbox.merchantLocationKey "default-main-location" looks like a placeholder.'
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

  it('allows title length 80 for publish readiness', () => {
    expect(() =>
      validatePublishListingReadiness(
        createListing({
          title: 'a'.repeat(80),
        }),
        createAppSettings()
      )
    ).not.toThrow();
  });

  it('rejects title length 81 for publish readiness', () => {
    expect(() =>
      validatePublishListingReadiness(
        createListing({
          title: 'a'.repeat(81),
        }),
        createAppSettings()
      )
    ).toThrow(
      'Listing "LIST-001" title must be 80 characters or fewer for eBay publish. Current length: 81.'
    );
  });

  it('keeps missing title behavior without adding a length issue', () => {
    expect(() =>
      validatePublishListingReadiness(
        createListing({
          title: '   ',
        }),
        createAppSettings()
      )
    ).toThrow(PublishListingValidationError);

    try {
      validatePublishListingReadiness(
        createListing({
          title: '   ',
        }),
        createAppSettings()
      );
    } catch (error) {
      expect(error).toBeInstanceOf(PublishListingValidationError);
      expect((error as PublishListingValidationError).issues).toContain(
        'Listing "LIST-001" is missing title.'
      );
      expect((error as PublishListingValidationError).issues).not.toContain(
        'Listing "LIST-001" title must be 80 characters or fewer for eBay publish. Current length: 3.'
      );
    }
  });

  it('requires raw Card Condition token for trading-card publish', () => {
    expect(() =>
      validatePublishListingReadiness(
        createListing({
          category_id: '261328',
          condition_id: '4000',
          item_specifics: {},
        }),
        createAppSettings()
      )
    ).toThrow(
      'Listing "LIST-001" is missing item_specifics["Card Condition"] for trading-card publish.'
    );
  });

  it('rejects unsupported raw Card Condition token for trading-card publish', () => {
    expect(() =>
      validatePublishListingReadiness(
        createListing({
          category_id: '261328',
          condition_id: '4000',
          item_specifics: {
            'Card Condition': 'NEAR MINT',
          },
        }),
        createAppSettings()
      )
    ).toThrow(
      'Listing "LIST-001" has unsupported item_specifics["Card Condition"] value "NEAR MINT" for trading-card publish.'
    );
  });

  it('accepts legacy raw Card Condition tokens via explicit conservative normalization', () => {
    expect(() =>
      validatePublishListingReadiness(
        createListing({
          category_id: '261328',
          condition_id: '4000',
          item_specifics: {
            'Card Condition': 'EX-MT',
          },
        }),
        createAppSettings()
      )
    ).not.toThrow();
  });

  it('rejects graded trading-card condition ids in v1', () => {
    expect(() =>
      validatePublishListingReadiness(
        createListing({
          category_id: '261328',
          condition_id: '2750',
        }),
        createAppSettings()
      )
    ).toThrow(
      'Listing "LIST-001" uses graded trading-card condition_id "2750", but graded condition descriptors are not supported yet.'
    );
  });
});
