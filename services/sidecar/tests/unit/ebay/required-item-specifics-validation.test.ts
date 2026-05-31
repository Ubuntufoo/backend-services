import { describe, expect, it, vi } from 'vitest';
import type { ListingRow } from '@ebay-inventory/data';
import {
  getRequiredAspectNamesFromMetadata,
  hasRequiredAspectValue,
  validateRequiredItemSpecificsForCategory,
} from '@/ebay/required-item-specifics-validation.js';
import { PublishListingValidationError } from '@/ebay/publish-validation.js';

function createListing(overrides: Partial<ListingRow> = {}): ListingRow {
  return {
    approved_for_export_at: '2026-05-24T12:00:00.000Z',
    capture_mode: null,
    category_id: '183050',
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

describe('required item specifics validation', () => {
  it('extracts required aspect names from taxonomy metadata', () => {
    expect(
      getRequiredAspectNamesFromMetadata({
        aspects: [
          {
            localizedAspectName: ' Franchise ',
            aspectConstraint: { aspectRequired: true },
          },
          {
            localizedAspectName: 'Player/Athlete',
            aspectConstraint: { aspectUsage: 'REQUIRED' },
          },
          {
            localizedAspectName: 'Team',
            aspectConstraint: { aspectUsage: 'RECOMMENDED' },
          },
          {
            localizedAspectName: '   ',
            aspectConstraint: { aspectRequired: true },
          },
        ],
      })
    ).toEqual(['Franchise', 'Player/Athlete']);
  });

  it.each([
    { label: 'empty string', itemSpecifics: { Franchise: '' } },
    { label: 'whitespace string', itemSpecifics: { Franchise: '   ' } },
    { label: 'empty array', itemSpecifics: { Franchise: [] } },
    { label: 'blank array value', itemSpecifics: { Franchise: [''] } },
    { label: 'object payload', itemSpecifics: { Franchise: {} } },
    { label: 'number payload', itemSpecifics: { Franchise: 123 } },
    { label: 'boolean payload', itemSpecifics: { Franchise: true } },
  ])('rejects $label as required aspect value', ({ itemSpecifics }) => {
    expect(hasRequiredAspectValue(itemSpecifics, 'Franchise')).toBe(false);
  });

  it('accepts exact-match-after-trim string and array values', () => {
    expect(hasRequiredAspectValue({ ' Franchise ': 'Utah Jazz' }, 'Franchise')).toBe(true);
    expect(hasRequiredAspectValue({ Franchise: [' ', 'Utah Jazz'] }, 'Franchise')).toBe(true);
  });

  it('does not allow internal keys to satisfy required aspects', () => {
    expect(hasRequiredAspectValue({ CategorySuggestion: 'Basketball Cards' }, 'CategorySuggestion')).toBe(
      false
    );
    expect(hasRequiredAspectValue({ ConditionSuggestion: 'Near Mint' }, 'ConditionSuggestion')).toBe(
      false
    );
  });

  it('throws listing validation error for missing required aspects', async () => {
    await expect(
      validateRequiredItemSpecificsForCategory({
        listing: createListing({
          item_specifics: {
            Player: 'Karl Malone',
          },
        }),
        marketplaceId: 'EBAY_US',
        taxonomyApi: {
          getDefaultCategoryTreeId: vi.fn(async () => ({ categoryTreeId: '0' })),
          getItemAspectsForCategory: vi.fn(async () => ({
            aspects: [
              {
                localizedAspectName: 'Franchise',
                aspectConstraint: { aspectRequired: true },
              },
            ],
          })),
        },
      })
    ).rejects.toThrow(PublishListingValidationError);
  });
});
