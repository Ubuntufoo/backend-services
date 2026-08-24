import { describe, expect, it } from 'vitest';
import type { ListingRow } from '@ebay-inventory/data';
import {
  getCategoryTreeIdFromTaxonomyResponse,
  getEffectiveItemSpecificsForCategoryValidation,
  getRequiredAspectNamesFromTaxonomyResponse,
  getTaxonomyAspectMetadata,
  hasRequiredAspectValue,
  normalizeSingleCardOutboundItemSpecifics,
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

const NORMALIZE_NOW = () => new Date('2026-08-24T00:00:00.000Z');

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

  it('retains canonical names, constraints, usage, allowed values, and cardinality', () => {
    expect(
      getTaxonomyAspectMetadata({
        aspects: [
          {
            localizedAspectName: ' Type ',
            aspectConstraint: {
              aspectDataType: 'STRING',
              aspectMode: 'SELECTION_ONLY',
              aspectRequired: true,
              aspectUsage: 'RECOMMENDED',
              itemToAspectCardinality: 'SINGLE',
            },
            aspectValues: [
              { localizedValue: 'Sports Trading Card' },
              { localizedValue: 'Non-Sport Trading Card' },
            ],
          },
        ],
      })
    ).toEqual([
      {
        allowedValues: ['Sports Trading Card', 'Non-Sport Trading Card'],
        cardinality: 'SINGLE',
        dataType: 'STRING',
        inputMode: 'SELECTION_ONLY',
        localizedName: 'Type',
        required: true,
        usage: 'RECOMMENDED',
      },
    ]);
  });

  it('normalizes sports aliases, authorized year, and deterministic Type to taxonomy names', () => {
    const listing = createListing({
      category_id: '261328',
      item_specifics: {
        'Card Condition': 'NEAR_MINT_OR_BETTER',
        Franchise: 'Chicago Bulls',
        Player: 'Michael Jordan',
        Set: 'Upper Deck',
        Unsupported: 'must not leak',
        Year: '1991',
        __draft_metadata: {
          year: {
            image_index: 1,
            source_type: 'copyright_line',
            visible_text: '© 1991 UPPER DECK COMPANY',
            year: '1991',
          },
        },
      },
    });
    const taxonomyAspects = getTaxonomyAspectMetadata({
      aspects: [
        {
          localizedAspectName: 'Player/Athlete',
          aspectConstraint: { aspectRequired: true, itemToAspectCardinality: 'SINGLE' },
        },
        {
          localizedAspectName: 'Set',
          aspectConstraint: { aspectRequired: false, itemToAspectCardinality: 'SINGLE' },
        },
        {
          localizedAspectName: 'Team',
          aspectConstraint: { aspectRequired: false, itemToAspectCardinality: 'SINGLE' },
        },
        {
          localizedAspectName: 'Year Manufactured',
          aspectConstraint: { aspectRequired: false, itemToAspectCardinality: 'SINGLE' },
        },
        {
          localizedAspectName: 'Type',
          aspectConstraint: {
            aspectMode: 'SELECTION_ONLY',
            aspectRequired: false,
            itemToAspectCardinality: 'SINGLE',
          },
          aspectValues: [{ localizedValue: 'Sports Trading Card' }],
        },
      ],
    });

    expect(
      normalizeSingleCardOutboundItemSpecifics({
        conditionDescriptorsPresent: true,
        listing,
        taxonomyAspects,
        now: NORMALIZE_NOW,
      })
    ).toEqual({
      'Player/Athlete': ['Michael Jordan'],
      Set: ['1991 Upper Deck'],
      Team: ['Chicago Bulls'],
      'Year Manufactured': ['1991'],
      Type: ['Sports Trading Card'],
    });
  });

  it.each([
    ['2005', 'Yes'],
    ['2006', 'No'],
  ])('derives dynamic Vintage boundary and safe Season for authorized year %s', (year, vintage) => {
    const listing = createListing({
      category_id: '261328',
      item_specifics: {
        Year: year,
        Season: `${year}-${String(Number(year) + 1).slice(-2)}`,
        __draft_metadata: {
          year: {
            image_index: null,
            source_type: 'seller_hint',
            visible_text: null,
            year,
          },
        },
      },
    });
    const taxonomyAspects = getTaxonomyAspectMetadata({
      aspects: [
        {
          localizedAspectName: 'Season',
          aspectConstraint: { aspectMode: 'FREE_TEXT', itemToAspectCardinality: 'SINGLE' },
        },
        {
          localizedAspectName: 'Vintage',
          aspectConstraint: {
            aspectMode: 'SELECTION_ONLY',
            itemToAspectCardinality: 'SINGLE',
          },
          aspectValues: [{ localizedValue: 'Yes' }, { localizedValue: 'No' }],
        },
      ],
    });

    expect(
      normalizeSingleCardOutboundItemSpecifics({
        conditionDescriptorsPresent: false,
        listing,
        taxonomyAspects,
        now: NORMALIZE_NOW,
      })
    ).toEqual({
      Season: [`${year}-${String(Number(year) + 1).slice(-2)}`],
      Vintage: [vintage],
    });
  });

  it('uses a valid manually persisted Vintage value ahead of deterministic fallback', () => {
    const listing = createListing({
      category_id: '261328',
      item_specifics: {
        Vintage: 'No',
        Year: '2005',
        __draft_metadata: {
          year: {
            image_index: null,
            source_type: 'seller_hint',
            visible_text: null,
            year: '2005',
          },
        },
      },
    });
    const taxonomyAspects = getTaxonomyAspectMetadata({
      aspects: [
        {
          localizedAspectName: 'Vintage',
          aspectConstraint: {
            aspectMode: 'SELECTION_ONLY',
            itemToAspectCardinality: 'SINGLE',
          },
          aspectValues: [{ localizedValue: 'Yes' }, { localizedValue: 'No' }],
        },
      ],
    });

    expect(
      normalizeSingleCardOutboundItemSpecifics({
        conditionDescriptorsPresent: false,
        listing,
        taxonomyAspects,
        now: NORMALIZE_NOW,
      })
    ).toEqual({ Vintage: ['No'] });
  });

  it('publishes manual Season without canonical year and omits deterministic Vintage', () => {
    const listing = createListing({
      category_id: '261328',
      item_specifics: { Season: '2000-01' },
    });

    expect(listing.item_specifics).toEqual({ Season: '2000-01' });
    expect(listing.item_specifics).not.toHaveProperty('Year');
    expect(listing.item_specifics).not.toHaveProperty('__draft_metadata');

    const taxonomyAspects = getTaxonomyAspectMetadata({
      aspects: [
        {
          localizedAspectName: 'Season',
          aspectConstraint: { aspectMode: 'FREE_TEXT', itemToAspectCardinality: 'SINGLE' },
        },
        {
          localizedAspectName: 'Vintage',
          aspectConstraint: { aspectMode: 'SELECTION_ONLY', itemToAspectCardinality: 'SINGLE' },
          aspectValues: [{ localizedValue: 'Yes' }, { localizedValue: 'No' }],
        },
      ],
    });

    expect(
      normalizeSingleCardOutboundItemSpecifics({
        conditionDescriptorsPresent: false,
        listing,
        taxonomyAspects,
        now: NORMALIZE_NOW,
      })
    ).toEqual({ Season: ['2000-01'] });
  });

  it('omits Vintage and Season for stale conflicting year metadata', () => {
    const listing = createListing({
      category_id: '261328',
      item_specifics: {
        Year: '2006',
        __draft_metadata: {
          year: {
            image_index: null,
            source_type: 'seller_hint',
            visible_text: null,
            year: '2005',
          },
        },
      },
    });
    const taxonomyAspects = getTaxonomyAspectMetadata({
      aspects: [
        {
          localizedAspectName: 'Season',
          aspectConstraint: { aspectMode: 'FREE_TEXT', itemToAspectCardinality: 'SINGLE' },
        },
        {
          localizedAspectName: 'Vintage',
          aspectConstraint: { aspectMode: 'SELECTION_ONLY', itemToAspectCardinality: 'SINGLE' },
          aspectValues: [{ localizedValue: 'Yes' }, { localizedValue: 'No' }],
        },
      ],
    });

    expect(
      normalizeSingleCardOutboundItemSpecifics({
        conditionDescriptorsPresent: false,
        listing,
        taxonomyAspects,
        now: NORMALIZE_NOW,
      })
    ).toEqual({});
  });

  it('does not trust mixed or invalid Season arrays', () => {
    const listing = createListing({
      category_id: '261328',
      item_specifics: {
        Season: [123, '2005'],
        Year: '2005',
        __draft_metadata: {
          year: {
            image_index: null,
            source_type: 'seller_hint',
            visible_text: null,
            year: '2005',
          },
        },
      },
    });
    const taxonomyAspects = getTaxonomyAspectMetadata({
      aspects: [
        {
          localizedAspectName: 'Season',
          aspectConstraint: { aspectMode: 'FREE_TEXT', itemToAspectCardinality: 'SINGLE' },
        },
      ],
    });

    expect(
      normalizeSingleCardOutboundItemSpecifics({
        conditionDescriptorsPresent: false,
        listing,
        taxonomyAspects,
        now: NORMALIZE_NOW,
      })
    ).toEqual({ Season: ['2005'] });
  });

  it('publishes manually persisted autograph item specifics when taxonomy exposes them', () => {
    const listing = createListing({
      category_id: '261328',
      item_specifics: {
        Autographed: 'No',
        'Signed By': 'Printed signature',
        'Autograph Format': 'Hard Signed',
        'Autograph Authentication': 'None',
        'Autograph Authentication Number': '123',
      },
    });
    const taxonomyAspects = getTaxonomyAspectMetadata({
      aspects: [
        ...[
          'Autographed',
          'Signed By',
          'Autograph Format',
          'Autograph Authentication',
          'Autograph Authentication Number',
        ].map((localizedAspectName) => ({
          localizedAspectName,
          aspectConstraint: { aspectMode: 'FREE_TEXT', itemToAspectCardinality: 'SINGLE' },
        })),
      ],
    });

    expect(
      normalizeSingleCardOutboundItemSpecifics({
        conditionDescriptorsPresent: false,
        listing,
        taxonomyAspects,
        now: NORMALIZE_NOW,
      })
    ).toEqual({
      Autographed: ['No'],
      'Signed By': ['Printed signature'],
      'Autograph Format': ['Hard Signed'],
      'Autograph Authentication': ['None'],
      'Autograph Authentication Number': ['123'],
    });
  });

  it.each([
    ['BSKBL', 'Basketball'],
    ['BSBL', 'Baseball'],
  ])('maps controlled %s SKU category evidence to Sport', (skuCategoryCode, sport) => {
    const listing = createListing({
      category_id: '261328',
      item_specifics: { skuCategoryCode },
    });
    const taxonomyAspects = getTaxonomyAspectMetadata({
      aspects: [
        {
          localizedAspectName: 'Sport',
          aspectConstraint: {
            aspectMode: 'SELECTION_ONLY',
            aspectRequired: true,
            itemToAspectCardinality: 'SINGLE',
          },
          aspectValues: [
            { localizedValue: 'Baseball' },
            { localizedValue: 'Basketball' },
          ],
        },
      ],
    });

    expect(
      normalizeSingleCardOutboundItemSpecifics({
        conditionDescriptorsPresent: false,
        listing,
        taxonomyAspects,
        now: NORMALIZE_NOW,
      })
    ).toEqual({ Sport: [sport] });
  });

  it('does not invent Sport from an unrecognized SKU category', () => {
    const listing = createListing({
      category_id: '261328',
      item_specifics: { skuCategoryCode: 'OTHER' },
    });
    const taxonomyAspects = getTaxonomyAspectMetadata({
      aspects: [
        {
          localizedAspectName: 'Sport',
          aspectConstraint: { aspectRequired: true, itemToAspectCardinality: 'SINGLE' },
        },
      ],
    });

    expect(
      normalizeSingleCardOutboundItemSpecifics({
        conditionDescriptorsPresent: false,
        listing,
        taxonomyAspects,
        now: NORMALIZE_NOW,
      })
    ).toEqual({});
  });

  it.each([
    { label: 'plain stored Set', year: '1985', set: 'Topps', expected: '1985 Topps' },
    {
      label: 'same-year stored Set',
      year: '1985',
      set: '1985 Topps',
      expected: '1985 Topps',
    },
    {
      label: 'authorized short season range',
      year: '1995',
      set: '1995-96 SkyBox',
      expected: '1995-96 SkyBox',
    },
    {
      label: 'authorized slash season range',
      year: '1995',
      set: '1995/96 SkyBox',
      expected: '1995/96 SkyBox',
    },
    {
      label: 'authorized full season range',
      year: '1995',
      set: '1995-1996 SkyBox',
      expected: '1995-1996 SkyBox',
    },
    {
      label: 'conflicting-year stored Set',
      year: '1985',
      set: '1986 Topps',
      expected: '1985 Topps',
    },
    { label: 'unsupported-year stored Set', year: '1985', set: '1885 Topps', expected: null },
    {
      label: 'conflicting season range',
      year: '1995',
      set: '1996-97 SkyBox',
      expected: null,
    },
    {
      label: 'ambiguous season range',
      year: '1995',
      set: '1995-97 SkyBox',
      expected: null,
    },
    {
      label: 'unsupported season-range separator',
      year: '1995',
      set: '1995–96 SkyBox',
      expected: null,
    },
    {
      label: 'unsupported Unicode minus separator',
      year: '1995',
      set: '1995−96 SkyBox',
      expected: null,
    },
    {
      label: 'ambiguous multiple years',
      year: '1995',
      set: '1995 1996 SkyBox',
      expected: null,
    },
    {
      label: 'mixed valid and conflicting ranges',
      year: '1995',
      set: ['1995-96 SkyBox', '1996-97 SkyBox'],
      expected: null,
    },
  ])('canonicalizes an authorized sports Set for $label', ({ year, set, expected }) => {
    const itemSpecifics = {
      Set: set,
      Year: year,
      __draft_metadata: {
        year: {
          image_index: 1,
          source_type: 'copyright_line',
          visible_text: `© ${year} CARD COMPANY`,
          year,
        },
      },
    };
    const storedBeforeNormalization = structuredClone(itemSpecifics);
    const listing = createListing({ category_id: '261328', item_specifics: itemSpecifics });
    const taxonomyAspects = getTaxonomyAspectMetadata({
      aspects: [
        {
          localizedAspectName: 'Set',
          aspectConstraint: { aspectRequired: false, itemToAspectCardinality: 'SINGLE' },
        },
      ],
    });

    expect(
      normalizeSingleCardOutboundItemSpecifics({
        conditionDescriptorsPresent: false,
        listing,
        taxonomyAspects,
        now: NORMALIZE_NOW,
      })
    ).toEqual(expected ? { Set: [expected] } : {});
    expect(listing.item_specifics).toBe(itemSpecifics);
    expect(itemSpecifics).toEqual(storedBeforeNormalization);
  });

  it('keeps a sports Set unchanged without authorized year metadata', () => {
    const listing = createListing({
      category_id: '261328',
      item_specifics: { Set: 'Topps', Year: '1985' },
    });
    const taxonomyAspects = getTaxonomyAspectMetadata({
      aspects: [
        {
          localizedAspectName: 'Set',
          aspectConstraint: { aspectRequired: false, itemToAspectCardinality: 'SINGLE' },
        },
      ],
    });

    expect(
      normalizeSingleCardOutboundItemSpecifics({
        conditionDescriptorsPresent: false,
        listing,
        taxonomyAspects,
        now: NORMALIZE_NOW,
      })
    ).toEqual({ Set: ['Topps'] });
  });

  it.each(['183050', '183454'])('keeps category %s Set naming unchanged', (categoryId) => {
    const listing = createListing({
      category_id: categoryId,
      item_specifics: {
        Set: 'Base Set',
        Year: '1999',
        __draft_metadata: {
          year: {
            image_index: 1,
            source_type: 'copyright_line',
            visible_text: '© 1999 CARD COMPANY',
            year: '1999',
          },
        },
      },
    });
    const taxonomyAspects = getTaxonomyAspectMetadata({
      aspects: [
        {
          localizedAspectName: 'Set',
          aspectConstraint: { aspectRequired: false, itemToAspectCardinality: 'SINGLE' },
        },
      ],
    });

    expect(
      normalizeSingleCardOutboundItemSpecifics({
        conditionDescriptorsPresent: false,
        listing,
        taxonomyAspects,
        now: NORMALIZE_NOW,
      })
    ).toEqual({ Set: ['Base Set'] });
  });

  it('preserves manual taxonomy-supported Season and Type while omitting unsafe values', () => {
    const listing = createListing({
      category_id: '183454',
      item_specifics: {
        Game: 'pokemon',
        Rarity: ['Rare Holo', 'Common'],
        Season: '1999',
        Type: 'Collectible Card Game',
        Year: '1999',
      },
    });
    const taxonomyAspects = getTaxonomyAspectMetadata({
      aspects: [
        {
          localizedAspectName: 'Game',
          aspectConstraint: {
            aspectMode: 'SELECTION_ONLY',
            aspectRequired: true,
            itemToAspectCardinality: 'SINGLE',
          },
          aspectValues: [{ localizedValue: 'Pokémon TCG' }],
        },
        {
          localizedAspectName: 'Rarity',
          aspectConstraint: { aspectRequired: false, itemToAspectCardinality: 'SINGLE' },
        },
        {
          localizedAspectName: 'Season',
          aspectConstraint: { aspectRequired: false, itemToAspectCardinality: 'SINGLE' },
        },
        {
          localizedAspectName: 'Type',
          aspectConstraint: { aspectRequired: false, itemToAspectCardinality: 'SINGLE' },
        },
        {
          localizedAspectName: 'Year Manufactured',
          aspectConstraint: { aspectRequired: false, itemToAspectCardinality: 'SINGLE' },
        },
      ],
    });

    expect(
      normalizeSingleCardOutboundItemSpecifics({
        conditionDescriptorsPresent: false,
        listing,
        taxonomyAspects,
        now: NORMALIZE_NOW,
      })
    ).toEqual({
      Season: ['1999'],
      Type: ['Collectible Card Game'],
    });
  });

  it('canonicalizes exact case-insensitive closed-set matches', () => {
    const listing = createListing({
      category_id: '183454',
      item_specifics: { Game: 'pokémon tcg' },
    });
    const taxonomyAspects = getTaxonomyAspectMetadata({
      aspects: [
        {
          localizedAspectName: 'Game',
          aspectConstraint: {
            aspectMode: 'SELECTION_ONLY',
            aspectRequired: true,
            itemToAspectCardinality: 'SINGLE',
          },
          aspectValues: [{ localizedValue: 'Pokémon TCG' }],
        },
      ],
    });

    expect(
      normalizeSingleCardOutboundItemSpecifics({
        conditionDescriptorsPresent: false,
        listing,
        taxonomyAspects,
        now: NORMALIZE_NOW,
      })
    ).toEqual({ Game: ['Pokémon TCG'] });
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

  it('uses the effective lot player default during live required-aspect validation', () => {
    expect(() =>
      validateRequiredItemSpecificsForCategory({
        listing: createListing({
          capture_mode: 'lot_3_image',
          item_specifics: { Franchise: 'Star Wars' },
        }),
        requiredAspectNames: ['Player/Athlete'],
      })
    ).not.toThrow();
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
