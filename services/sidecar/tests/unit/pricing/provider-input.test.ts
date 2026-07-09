import type { ListingRow } from '@ebay-inventory/data';
import { describe, expect, it } from 'vitest';
import { buildPricingProviderInput, buildPricingSearchQuery } from '@/pricing/index.js';

function createListingRow(overrides: Partial<ListingRow> = {}): ListingRow {
  return {
    approved_for_export_at: null,
    capture_mode: null,
    category_id: '261328',
    condition_id: '4000',
    condition_notes: null,
    created_at: '2026-07-09T00:00:00.000Z',
    description: null,
    ebay_listing_id: null,
    ebay_listing_status: null,
    ebay_listing_url: null,
    ebay_offer_id: null,
    ese_eligible: null,
    estimated_weight_oz: null,
    exported_at: null,
    generated_at: null,
    handling_days: null,
    id: 'listing-row-id',
    image_urls: [],
    item_specifics: {},
    last_error_at: null,
    last_error_code: null,
    last_error_context: {},
    last_error_message: null,
    listing_id: 'LIST-001',
    listing_type: 'single',
    merchant_location_key: null,
    package_type: null,
    price: null,
    r2_delete_after: null,
    r2_deleted_at: null,
    r2_object_keys: [],
    r2_retention_policy: null,
    seller_hints: null,
    shipping_profile: null,
    sku: 'SKU-001',
    sold_at: null,
    status: 'needs_review',
    sub_status: 'review_pending',
    title: null,
    updated_at: '2026-07-09T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildPricingProviderInput', () => {
  it('omits guessed title year from pricing input when generated year is unverified', () => {
    const listing = createListingRow({
      item_specifics: {
        'Card Number': '191',
        Manufacturer: 'Topps',
        Player: 'Ed Stanky',
        __draft_metadata: {
          year: {
            likely_year: '1955',
            likely_year_range: '1952-1955',
            status: 'unverified',
            warning_code: 'year_unverified',
          },
        },
      },
      title: 'Ed Stanky 1952 Topps #191',
    });

    const input = buildPricingProviderInput(listing, listing.listing_id);

    expect(input.title).toBe('Ed Stanky Topps 191');
    expect(buildPricingSearchQuery(input)).toContain('Ed Stanky Topps 191');
    expect(buildPricingSearchQuery(input)).not.toContain('1952');
    expect(buildPricingSearchQuery(input)).not.toContain('1955');
  });

  it('preserves verified title year in pricing input when no uncertainty metadata exists', () => {
    const listing = createListingRow({
      item_specifics: {
        'Card Number': '191',
        Manufacturer: 'Topps',
        Player: 'Ed Stanky',
        Year: '1955',
      },
      title: 'Ed Stanky 1955 Topps #191',
    });

    const input = buildPricingProviderInput(listing, listing.listing_id);

    expect(input.title).toBe('Ed Stanky 1955 Topps #191');
    expect(buildPricingSearchQuery(input)).toContain('Ed Stanky 1955 Topps 191');
  });
});
