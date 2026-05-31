import { describe, expect, it } from 'vitest';
import type { AppSettingsRow, ListingRow } from '@ebay-inventory/data';
import {
  buildPublishSku,
  mapListingConditionIdToInventoryCondition,
  mapListingToInventoryItemPayload,
  mapListingToOfferPayload,
} from '@/ebay/publish-mappers.js';

function createListing(overrides: Partial<ListingRow> = {}): ListingRow {
  return {
    approved_for_export_at: '2026-05-24T12:00:00.000Z',
    capture_mode: null,
    category_id: '1234',
    condition_id: '4000',
    condition_notes: 'Minor wear on corners.',
    created_at: '2026-05-24T10:00:00.000Z',
    description: 'Detailed listing description.',
    ebay_listing_id: null,
    ebay_listing_status: null,
    ebay_listing_url: null,
    ebay_offer_id: null,
    ese_eligible: null,
    estimated_weight_oz: 12,
    exported_at: null,
    generated_at: '2026-05-24T11:00:00.000Z',
    handling_days: 2,
    id: 'row-1',
    image_urls: ['https://cdn.example.com/front.jpg', 'https://cdn.example.com/back.jpg'],
    item_specifics: {
      Brand: 'Acme',
      Material: ['Cardboard', 'Paper'],
      Empty: [],
    },
    last_error_at: null,
    last_error_code: null,
    last_error_context: {},
    last_error_message: null,
    listing_id: 'LIST-001',
    listing_type: 'single',
    merchant_location_key: null,
    package_type: null,
    price: 24.5,
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

describe('publish mappers', () => {
  it('builds a stable publish sku from stored sku or listing id', () => {
    expect(buildPublishSku(createListing({ sku: 'SKU-001' }))).toBe('SKU-001');
    expect(buildPublishSku(createListing({ sku: '   ' }))).toBe('LIST-001');
    expect(buildPublishSku(createListing({ sku: null }))).toBe('LIST-001');
  });

  it('maps supported listing condition ids to inventory api condition enums', () => {
    expect(mapListingConditionIdToInventoryCondition('4000')).toBe('USED_VERY_GOOD');
    expect(mapListingConditionIdToInventoryCondition('2750')).toBe('LIKE_NEW');
    expect(mapListingConditionIdToInventoryCondition(4000)).toBe('USED_VERY_GOOD');
    expect(mapListingConditionIdToInventoryCondition(2750)).toBe('LIKE_NEW');
  });

  it('rejects unsupported listing condition ids', () => {
    expect(() => mapListingConditionIdToInventoryCondition('3000')).toThrow(
      'Unsupported listing condition_id "3000".'
    );
  });

  it('maps listing data to an inventory item payload', () => {
    const payload = mapListingToInventoryItemPayload(createListing(), createAppSettings());

    expect(payload).toEqual({
      availability: {
        shipToLocationAvailability: {
          quantity: 1,
        },
      },
      condition: 'USED_VERY_GOOD',
      conditionDescription: 'Minor wear on corners.',
      packageWeightAndSize: {
        packageType: 'LETTER',
        weight: {
          unit: 'OUNCE',
          value: 12,
        },
      },
      product: {
        aspects: {
          Brand: ['Acme'],
          Material: ['Cardboard', 'Paper'],
        },
        description: 'Detailed listing description.',
        imageUrls: ['https://cdn.example.com/front.jpg', 'https://cdn.example.com/back.jpg'],
        title: 'Vintage puzzle',
      },
    });
  });

  it('adds trading-card condition descriptors and omits Card Condition from aspects', () => {
    const payload = mapListingToInventoryItemPayload(
      createListing({
        category_id: '183050',
        item_specifics: {
          'Card Condition': 'VG',
          Franchise: 'Utah Jazz',
          Player: 'Michael Jordan',
        },
      }),
      createAppSettings(),
      {
        conditionDescriptors: [
          {
            name: '40001',
            values: ['400012'],
          },
        ],
      }
    );

    expect(payload.conditionDescriptors).toEqual([
      {
        name: '40001',
        values: ['400012'],
      },
    ]);
    expect(payload.product?.aspects).toEqual({
      Franchise: ['Utah Jazz'],
      Player: ['Michael Jordan'],
    });
  });

  it('filters internal Gemini suggestion specifics from product aspects without mutating listing specifics', () => {
    const listing = createListing({
      item_specifics: {
        Sport: 'Basketball',
        Player: "Shaquille O'Neal",
        Season: '1996',
        'Card Manufacturer': 'Topps',
        CategorySuggestion:
          'Sports Mem, Cards & Fan Shop > Sports Trading Cards > Basketball Cards',
        ConditionSuggestion: 'Ungraded',
      },
    });
    const originalItemSpecifics = JSON.parse(JSON.stringify(listing.item_specifics));

    const payload = mapListingToInventoryItemPayload(listing, createAppSettings());

    expect(payload.product?.aspects).toEqual({
      Sport: ['Basketball'],
      Player: ["Shaquille O'Neal"],
      Season: ['1996'],
      'Card Manufacturer': ['Topps'],
    });
    expect(payload.product?.aspects).not.toHaveProperty('CategorySuggestion');
    expect(payload.product?.aspects).not.toHaveProperty('ConditionSuggestion');
    expect(listing.item_specifics).toEqual(originalItemSpecifics);
  });

  it('maps listing data to an offer payload using stored policies and location key', () => {
    const payload = mapListingToOfferPayload(createListing(), createAppSettings(), 'SKU-001');

    expect(payload).toEqual({
      availableQuantity: 1,
      categoryId: '1234',
      format: 'FIXED_PRICE',
      listingDescription: 'Detailed listing description.',
      listingPolicies: {
        fulfillmentPolicyId: 'FULFILLMENT-1',
        paymentPolicyId: 'PAYMENT-1',
        returnPolicyId: 'RETURN-1',
      },
      marketplaceId: 'EBAY_US',
      merchantLocationKey: 'warehouse-1',
      pricingSummary: {
        price: {
          currency: 'USD',
          value: '24.50',
        },
      },
      sku: 'SKU-001',
    });
  });
});
