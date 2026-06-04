import { describe, expect, it } from 'vitest';
import type { ListingRow } from '@ebay-inventory/data';
import {
  getEffectiveItemSpecificsForCategoryValidation,
  getCoveredCategoryIds,
  getRequiredItemSpecificRulesForCategory,
  hasRequiredAspectValue,
  hasRequiredAspectValueForKeys,
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
  it('covers only local trading-card category rules', () => {
    expect(getCoveredCategoryIds()).toEqual(['183050']);
    expect(getRequiredItemSpecificRulesForCategory('183050')).toEqual([
      {
        acceptedKeys: ['Card Condition'],
        aspectName: 'Card Condition',
      },
      {
        acceptedKeys: ['Manufacturer', 'Card Manufacturer'],
        aspectName: 'Manufacturer',
      },
      {
        acceptedKeys: ['Player/Athlete', 'Player', 'Athlete'],
        aspectName: 'Player/Athlete',
      },
    ]);
    expect(getRequiredItemSpecificRulesForCategory('9999')).toEqual([]);
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

  it('accepts trimmed string and array values', () => {
    expect(hasRequiredAspectValue({ ' Franchise ': 'Utah Jazz' }, 'Franchise')).toBe(true);
    expect(hasRequiredAspectValue({ Franchise: [' ', 'Utah Jazz'] }, 'Franchise')).toBe(true);
  });

  it('accepts alias keys for local required aspect rules', () => {
    expect(
      hasRequiredAspectValueForKeys(
        {
          ' Card Manufacturer ': 'Upper Deck',
        },
        ['Manufacturer', 'Card Manufacturer']
      )
    ).toBe(true);
    expect(
      hasRequiredAspectValueForKeys(
        {
          Player: 'Michael Jordan',
        },
        ['Player/Athlete', 'Player', 'Athlete']
      )
    ).toBe(true);
  });

  it('does not allow internal keys to satisfy required aspects', () => {
    expect(hasRequiredAspectValue({ CategorySuggestion: 'Basketball Cards' }, 'CategorySuggestion')).toBe(
      false
    );
    expect(hasRequiredAspectValue({ ConditionSuggestion: 'Near Mint' }, 'ConditionSuggestion')).toBe(
      false
    );
  });

  it('injects Player/Athlete=Various for lot capture mode with missing player aspect', () => {
    expect(
      getEffectiveItemSpecificsForCategoryValidation(
        createListing({
          capture_mode: 'lot_3_image',
          listing_id: 'Lot-0001',
          item_specifics: {
            'Card Condition': 'NEAR_MINT_OR_BETTER',
            Manufacturer: 'Upper Deck',
          },
        })
      )
    ).toMatchObject({
      'Card Condition': 'NEAR_MINT_OR_BETTER',
      Manufacturer: 'Upper Deck',
      'Player/Athlete': 'Various',
    });
  });

  it('does not overwrite existing player aliases for lots', () => {
    expect(
      getEffectiveItemSpecificsForCategoryValidation(
        createListing({
          capture_mode: 'lot_3_image',
          listing_id: 'Lot-0001',
          item_specifics: {
            Athlete: 'Michael Jordan',
          },
        })
      )
    ).toEqual({
      Athlete: 'Michael Jordan',
    });
  });

  it('does not inject Various for unknown categories', () => {
    expect(
      getEffectiveItemSpecificsForCategoryValidation(
        createListing({
          category_id: '9999',
          listing_id: 'Lot-0001',
          item_specifics: {
            Brand: 'Acme',
          },
        })
      )
    ).toEqual({
      Brand: 'Acme',
    });
  });

  it('does not inject Various for single capture mode even if legacy lot heuristics match', () => {
    expect(
      getEffectiveItemSpecificsForCategoryValidation(
        createListing({
          capture_mode: 'single_2_image',
          listing_id: 'Lot-0001',
          seller_hints: 'Family bundle from one binder page.',
          title: '1990s NBA mixed stars 10-card lot',
          item_specifics: {
            'Card Condition': 'NEAR_MINT_OR_BETTER',
            Manufacturer: 'Upper Deck',
          },
        })
      )
    ).toEqual({
      'Card Condition': 'NEAR_MINT_OR_BETTER',
      Manufacturer: 'Upper Deck',
    });
  });

  it('allows lot capture mode listings to satisfy Player/Athlete with injected Various', () => {
    expect(() =>
      validateRequiredItemSpecificsForCategory({
        listing: createListing({
          capture_mode: 'lot_3_image',
          listing_id: 'Lot-0001',
          item_specifics: {
            'Card Condition': 'NEAR_MINT_OR_BETTER',
            Manufacturer: 'Upper Deck',
          },
        }),
      })
    ).not.toThrow();
  });

  it('throws structured listing validation error for missing required aspects', () => {
    try {
      validateRequiredItemSpecificsForCategory({
        listing: createListing({
          item_specifics: {
            Player: 'Karl Malone',
          },
        }),
      });
      throw new Error('Expected validation error.');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'LISTING_NOT_READY',
        context: {
          fields: [
            {
              acceptedKeys: ['Card Condition'],
              aspectName: 'Card Condition',
              field: 'item_specifics.Card Condition',
              message: 'Card Condition is required for this eBay category before publishing.',
              scope: 'listing',
            },
            {
              acceptedKeys: ['Manufacturer', 'Card Manufacturer'],
              aspectName: 'Manufacturer',
              field: 'item_specifics.Manufacturer',
              message: 'Manufacturer is required for this eBay category before publishing.',
              scope: 'listing',
            },
          ],
          issues: [
            'Card Condition is required for this eBay category before publishing.',
            'Manufacturer is required for this eBay category before publishing.',
          ],
          kind: 'user_fixable',
          listingId: 'LIST-001',
          stage: 'validate',
          validationCode: 'CATEGORY_REQUIRED_ITEM_SPECIFICS_MISSING',
        },
      });
    }
  });

  it('passes unknown categories without blocking publish', () => {
    expect(() =>
      validateRequiredItemSpecificsForCategory({
        listing: createListing({
          category_id: '9999',
          item_specifics: {},
        }),
      })
    ).not.toThrow();
  });

  it('still fails non-lot single-card listings with missing Player/Athlete', () => {
    expect(() =>
      validateRequiredItemSpecificsForCategory({
        listing: createListing({
          capture_mode: 'single_2_image',
          item_specifics: {
            'Card Condition': 'NEAR_MINT_OR_BETTER',
            Manufacturer: 'Upper Deck',
          },
          title: '1991 Upper Deck Michael Jordan',
        }),
      })
    ).toThrowError(/Player\/Athlete is required/);
  });

  it('still fails lots missing Card Condition', () => {
    expect(() =>
      validateRequiredItemSpecificsForCategory({
        listing: createListing({
          capture_mode: 'lot_3_image',
          listing_id: 'Lot-0001',
          item_specifics: {
            Manufacturer: 'Upper Deck',
          },
        }),
      })
    ).toThrowError(/Card Condition is required/);
  });

  it('still fails lots missing Manufacturer', () => {
    expect(() =>
      validateRequiredItemSpecificsForCategory({
        listing: createListing({
          capture_mode: 'lot_3_image',
          listing_id: 'Lot-0001',
          item_specifics: {
            'Card Condition': 'NEAR_MINT_OR_BETTER',
          },
        }),
      })
    ).toThrowError(/Manufacturer is required/);
  });

  it('still fails single capture mode listings with lot-like text when Player/Athlete is missing', () => {
    expect(() =>
      validateRequiredItemSpecificsForCategory({
        listing: createListing({
          capture_mode: 'single_2_image',
          listing_id: 'Lot-0001',
          seller_hints: 'Assorted bundle from one collection.',
          title: '1990s NBA mixed stars 10-card lot',
          item_specifics: {
            'Card Condition': 'NEAR_MINT_OR_BETTER',
            Manufacturer: 'Upper Deck',
          },
        }),
      })
    ).toThrowError(/Player\/Athlete is required/);
  });
});
