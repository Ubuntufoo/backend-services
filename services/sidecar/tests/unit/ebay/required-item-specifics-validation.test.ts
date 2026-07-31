import { describe, expect, it } from 'vitest';
import type { ListingRow } from '@ebay-inventory/data';
import {
  getCategoryTreeIdFromTaxonomyResponse,
  getEffectiveItemSpecificsForCategoryValidation,
  getRequiredAspectNamesFromTaxonomyResponse,
  hasRequiredAspectValue,
  validateRequiredItemSpecificsForCategory,
} from '@/ebay/required-item-specifics-validation.js';

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
  it('parses the default category tree id', () => {
    expect(getCategoryTreeIdFromTaxonomyResponse({ categoryTreeId: ' 0 ' })).toBe('0');
    expect(() => getCategoryTreeIdFromTaxonomyResponse({})).toThrow(
      'Taxonomy default category tree response is missing categoryTreeId.'
    );
  });

  it('derives only required taxonomy aspect names and de-duplicates case-insensitively', () => {
    expect(
      getRequiredAspectNamesFromTaxonomyResponse({
        aspects: [
          {
            localizedAspectName: 'Franchise',
            aspectConstraint: { aspectRequired: true },
          },
          {
            localizedAspectName: ' franchise ',
            aspectConstraint: { aspectRequired: true },
          },
          {
            localizedAspectName: 'Manufacturer',
            aspectConstraint: { aspectRequired: false },
          },
          {
            localizedAspectName: 'Optional detail',
            aspectConstraint: {},
          },
        ],
      })
    ).toEqual(['Franchise']);
  });

  it.each([
    null,
    {},
    { aspects: [{}] },
    { aspects: [{ localizedAspectName: 'Sport' }] },
    {
      aspects: [
        {
          localizedAspectName: 'Sport',
          aspectConstraint: { aspectRequired: 'true' },
        },
      ],
    },
  ])('rejects malformed taxonomy response %#', (response) => {
    expect(() => getRequiredAspectNamesFromTaxonomyResponse(response)).toThrow(/Taxonomy item aspects/);
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

  it('matches aspect names case-insensitively and accepts meaningful strings or arrays', () => {
    expect(hasRequiredAspectValue({ ' franchise ': 'Star Wars' }, 'Franchise')).toBe(true);
    expect(hasRequiredAspectValue({ GAME: [' ', 'Pokemon'] }, 'Game')).toBe(true);
  });

  it('does not allow internal keys to satisfy required aspects', () => {
    expect(hasRequiredAspectValue({ CategorySuggestion: 'Sports cards' }, 'CategorySuggestion')).toBe(
      false
    );
  });

  it('preserves the application-specific lot player default without making it a required rule', () => {
    expect(
      getEffectiveItemSpecificsForCategoryValidation(
        createListing({
          capture_mode: 'lot_3_image',
          item_specifics: { Franchise: 'Star Wars' },
        })
      )
    ).toEqual({
      Franchise: 'Star Wars',
      'Player/Athlete': 'Various',
    });
  });

  it('throws field-level issues for missing live required aspects without stale local rules', () => {
    expect(() =>
      validateRequiredItemSpecificsForCategory({
        listing: createListing({
          item_specifics: {
            Player: 'Darth Vader',
          },
        }),
        requiredAspectNames: ['Franchise'],
      })
    ).toThrowError(/Franchise is required/);

    expect(() =>
      validateRequiredItemSpecificsForCategory({
        listing: createListing({
          item_specifics: {
            Franchise: 'Star Wars',
          },
        }),
        requiredAspectNames: ['Franchise'],
      })
    ).not.toThrow();
  });

  it('treats a validated structured descriptor as satisfying required Card Condition', () => {
    expect(() =>
      validateRequiredItemSpecificsForCategory({
        listing: createListing({
          item_specifics: {
            'Card Condition': 'NEAR_MINT_OR_BETTER',
            Franchise: 'Star Wars',
          },
        }),
        requiredAspectNames: ['Card Condition', 'Franchise'],
        satisfiedAspectNames: ['card condition'],
      })
    ).not.toThrow();
  });

  it('aggregates missing taxonomy aspects into the existing validation shape', () => {
    try {
      validateRequiredItemSpecificsForCategory({
        listing: createListing(),
        requiredAspectNames: ['Franchise', 'Manufacturer'],
      });
      throw new Error('Expected validation error.');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'LISTING_NOT_READY',
        context: {
          fields: [
            {
              acceptedKeys: ['Franchise'],
              aspectName: 'Franchise',
              field: 'item_specifics.Franchise',
              message: 'Franchise is required for this eBay category before publishing.',
              scope: 'listing',
            },
            {
              acceptedKeys: ['Manufacturer'],
              aspectName: 'Manufacturer',
              field: 'item_specifics.Manufacturer',
              message: 'Manufacturer is required for this eBay category before publishing.',
              scope: 'listing',
            },
          ],
          validationCode: 'CATEGORY_REQUIRED_ITEM_SPECIFICS_MISSING',
        },
      });
    }
  });
});
