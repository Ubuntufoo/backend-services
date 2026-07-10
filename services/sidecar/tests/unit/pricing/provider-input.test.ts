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
        Set: '1952 Topps',
        Year: '1952',
      },
      title: 'Ed Stanky 1952 Topps #191',
    });

    const input = buildPricingProviderInput(listing, listing.listing_id);

    expect(input.title).toBe('Ed Stanky Topps #191');
    expect(input.itemSpecifics).toEqual({
      'Card Number': '191',
      Manufacturer: 'Topps',
      Player: 'Ed Stanky',
      Set: 'Topps',
    });
    expect(buildPricingSearchQuery(input)).toContain('Ed Stanky Topps 191');
    expect(buildPricingSearchQuery(input)).not.toContain('1952');
  });

  it('preserves validated title year in pricing input when draft metadata proves it', () => {
    const listing = createListingRow({
      item_specifics: {
        'Card Number': '191',
        Manufacturer: 'Topps',
        Player: 'Ed Stanky',
        Set: '1955 Topps',
        Year: '1955',
        __draft_metadata: {
          year: {
            year: '1955',
            source_type: 'copyright_line',
            visible_text: '© 1955 THE TOPPS COMPANY, INC.',
            image_index: 1,
          },
        },
      },
      title: 'Ed Stanky 1955 Topps #191',
    });

    const input = buildPricingProviderInput(listing, listing.listing_id);

    expect(input.title).toBe('Ed Stanky 1955 Topps #191');
    expect(input.itemSpecifics).toEqual({
      'Card Number': '191',
      Manufacturer: 'Topps',
      Player: 'Ed Stanky',
      Set: 'Topps',
      Year: '1955',
    });
    expect(buildPricingSearchQuery(input)).toContain('Ed Stanky 1955 Topps 191');
  });

  it('sanitizes array-valued Set and removes array-valued Year and Season without valid metadata', () => {
    const listing = createListingRow({
      item_specifics: {
        Manufacturer: 'Topps',
        Player: 'Phil Rizzuto',
        Set: ['1951 Topps', 'Topps 1951'],
        Year: ['1951'],
        Season: ['1951'],
      },
      title: 'Phil Rizzuto 1951 Topps Card 1951',
    });

    const input = buildPricingProviderInput(listing, listing.listing_id);

    expect(input.title).toBe('Phil Rizzuto Topps Card 1951');
    expect(input.itemSpecifics).toEqual({
      Manufacturer: 'Topps',
      Player: 'Phil Rizzuto',
      Set: 'Topps',
    });
    const searchQuery = buildPricingSearchQuery(input);
    expect(searchQuery).toContain('Phil Rizzuto Topps 1951');
    expect(searchQuery).not.toContain('Phil Rizzuto 1951 Topps 1951');
  });

  it('does not trust metadata when current Year disagrees with the metadata year', () => {
    const listing = createListingRow({
      item_specifics: {
        'Card Number': '191',
        Manufacturer: 'Topps',
        Player: 'Ed Stanky',
        Set: '1955 Topps',
        Year: '1954',
        __draft_metadata: {
          year: {
            year: '1955',
            source_type: 'copyright_line',
            visible_text: '© 1955 THE TOPPS COMPANY, INC.',
            image_index: 1,
          },
        },
      },
      title: 'Ed Stanky 1955 Topps #191',
    });

    const input = buildPricingProviderInput(listing, listing.listing_id);

    expect(input.title).toBe('Ed Stanky Topps #191');
    expect(input.itemSpecifics).toEqual({
      'Card Number': '191',
      Manufacturer: 'Topps',
      Player: 'Ed Stanky',
      Set: 'Topps',
    });
  });

  it.each([
    [
      'invalid year',
      {
        year: {
          year: '1899',
          source_type: 'copyright_line',
          visible_text: '© 1899 THE TOPPS COMPANY, INC.',
          image_index: 1,
        },
      },
    ],
    [
      'invalid source type',
      {
        year: {
          year: '1955',
          source_type: 'bad_source',
          visible_text: '© 1955 THE TOPPS COMPANY, INC.',
          image_index: 1,
        },
      },
    ],
    [
      'visible-text mismatch',
      {
        year: {
          year: '1955',
          source_type: 'copyright_line',
          visible_text: 'Career stats through 1954 season',
          image_index: 1,
        },
      },
    ],
    [
      'invalid image index',
      {
        year: {
          year: '1955',
          source_type: 'copyright_line',
          visible_text: '© 1955 THE TOPPS COMPANY, INC.',
          image_index: -1,
        },
      },
    ],
  ])('ignores malformed persisted metadata: %s', (_label, metadata) => {
    const listing = createListingRow({
      item_specifics: {
        'Card Number': '191',
        Manufacturer: 'Topps',
        Player: 'Ed Stanky',
        Set: '1955 Topps',
        Year: '1955',
        __draft_metadata: metadata,
      },
      title: 'Ed Stanky 1955 Topps #191',
    });

    const input = buildPricingProviderInput(listing, listing.listing_id);

    expect(input.title).toBe('Ed Stanky Topps #191');
    expect(input.itemSpecifics).toEqual({
      'Card Number': '191',
      Manufacturer: 'Topps',
      Player: 'Ed Stanky',
      Set: 'Topps',
    });
  });
});
