import { describe, expect, it, vi } from 'vitest';
import {
  adaptYouPickPilotMutationApi,
  classifyYouPickExactRead,
  normalizeYouPickGroup,
  normalizeYouPickItem,
  normalizeYouPickMetadata,
  normalizeYouPickOffers,
  normalizeYouPickPolicies,
} from '@/scripts/you-pick-sandbox-pilot.js';
import type { InventoryApi } from '@/api/listing-management/inventory.js';

function normalizeConditionDescriptors(conditionDescriptors: unknown) {
  return normalizeYouPickMetadata(
    '261328',
    { listingStructurePolicies: [{ categoryId: '261328', variationsSupported: true }] },
    {
      itemConditionPolicies: [
        {
          categoryId: '261328',
          itemConditions: [
            {
              conditionId: '4000',
              conditionDescription: 'Ungraded',
              conditionDescriptors,
            },
          ],
        },
      ],
    },
    { aspects: [] }
  ).conditions[0].conditionDescriptors;
}

// Semantic snapshots are required on normalized Inventory API responses. Keep
// these fixtures complete so each test reaches the adapter behavior it asserts.
const validInventoryItem = {
  sku: 'C01',
  availability: { shipToLocationAvailability: { quantity: 1 } },
  condition: 'USED_VERY_GOOD',
  conditionDescriptors: [{ name: 'Card Condition', values: ['Very Good'] }],
  product: { aspects: { Card: ['C01'] } },
};

const validOffer = {
  sku: 'C01',
  marketplaceId: 'EBAY_US',
  format: 'FIXED_PRICE',
  categoryId: '261328',
  merchantLocationKey: 'default-main-location',
  availableQuantity: 1,
  pricingSummary: { price: { currency: 'USD', value: '1.11' } },
  listingPolicies: {
    fulfillmentPolicyId: 'F1',
    paymentPolicyId: 'P1',
    returnPolicyId: 'R1',
  },
};

describe('You Pick raw response normalization', () => {
  it('maps every guarded mutation to the intended Inventory wrapper with en-US config', async () => {
    const inventory = {
      createOrReplaceInventoryItem: vi.fn(),
      createOffer: vi.fn(),
      createOrReplaceInventoryItemGroup: vi.fn(),
      publishOfferByInventoryItemGroup: vi.fn(),
      bulkUpdatePriceQuantity: vi.fn(),
      withdrawOfferByInventoryItemGroup: vi.fn(),
      deleteOffer: vi.fn(),
      deleteInventoryItemGroup: vi.fn(),
      deleteInventoryItem: vi.fn(),
    } as unknown as InventoryApi;
    const api = adaptYouPickPilotMutationApi(inventory);
    const headers = { 'Content-Language': 'en-US' as const };
    const config = { headers };
    await api.createOrReplaceInventoryItem('SKU', {}, headers);
    await api.createOffer({}, headers);
    await api.createOrReplaceInventoryItemGroup('GROUP', {}, headers);
    await api.publishInventoryItemGroup({}, headers);
    await api.bulkUpdatePriceQuantity({}, headers);
    await api.withdrawInventoryItemGroup({}, headers);
    await api.deleteOffer('OFFER', headers);
    await api.deleteInventoryItemGroup('GROUP', headers);
    await api.deleteInventoryItem('SKU', headers);
    expect(inventory.createOrReplaceInventoryItem).toHaveBeenCalledWith('SKU', {}, config);
    expect(inventory.createOffer).toHaveBeenCalledWith({}, config);
    expect(inventory.createOrReplaceInventoryItemGroup).toHaveBeenCalledWith('GROUP', {}, config);
    expect(inventory.publishOfferByInventoryItemGroup).toHaveBeenCalledWith({}, config);
    expect(inventory.bulkUpdatePriceQuantity).toHaveBeenCalledWith({}, config);
    expect(inventory.withdrawOfferByInventoryItemGroup).toHaveBeenCalledWith({}, config);
    expect(inventory.deleteOffer).toHaveBeenCalledWith('OFFER', config);
    expect(inventory.deleteInventoryItemGroup).toHaveBeenCalledWith('GROUP', config);
    expect(inventory.deleteInventoryItem).toHaveBeenCalledWith('SKU', config);
  });
  it('normalizes representative account and metadata payloads without credentials', () => {
    expect(
      normalizeYouPickPolicies(
        { fulfillmentPolicies: [{ fulfillmentPolicyId: 'F1', marketplaceId: 'EBAY_US' }] },
        { paymentPolicies: [{ paymentPolicyId: 'P1', marketplaceId: 'EBAY_US' }] },
        { returnPolicies: [{ returnPolicyId: 'R1', marketplaceId: 'EBAY_US' }] },
        { locations: [{ merchantLocationKey: 'L1', merchantLocationStatus: 'ENABLED' }] },
        'seller-1'
      )
    ).toEqual({
      fulfillment: [{ id: 'F1', marketplaceId: 'EBAY_US', ownerUserId: 'seller-1' }],
      payment: [{ id: 'P1', marketplaceId: 'EBAY_US', ownerUserId: 'seller-1' }],
      returns: [{ id: 'R1', marketplaceId: 'EBAY_US', ownerUserId: 'seller-1' }],
      locations: [{ merchantLocationKey: 'L1', ownerUserId: 'seller-1', enabled: true }],
    });

    expect(
      normalizeYouPickMetadata(
        '261328',
        { listingStructurePolicies: [{ categoryId: '261328', variationsSupported: true }] },
        {
          itemConditionPolicies: [
            {
              categoryId: '261328',
              itemConditions: [
                {
                  conditionId: '1000',
                  conditionDescription: 'New',
                },
                {
                  conditionId: '2000',
                  conditionDescription: 'Certified',
                  conditionDescriptors: [],
                },
                {
                  conditionId: '2750',
                  conditionDescription: 'Graded',
                  conditionDescriptors: [
                    {
                      conditionDescriptorId: '27503',
                      conditionDescriptorName: 'Certification Number',
                    },
                  ],
                },
                {
                  conditionId: '4000',
                  conditionDescription: 'Very Good',
                  conditionDescriptors: [
                    {
                      conditionDescriptorId: '40001',
                      conditionDescriptorName: 'Card Condition',
                      conditionDescriptorValues: [
                        {
                          conditionDescriptorValueId: '400012',
                          conditionDescriptorValueName: 'Very Good',
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          aspects: [
            {
              localizedAspectName: 'Set',
              aspectConstraint: { aspectEnabledForVariations: true },
            },
          ],
        }
      )
    ).toEqual(
      expect.objectContaining({
        categoryId: '261328',
        variationsSupported: true,
        selectorCandidates: ['Set'],
        conditions: [
          expect.objectContaining({
            conditionId: '1000',
            conditionDescriptors: [],
          }),
          expect.objectContaining({
            conditionId: '2000',
            conditionDescriptors: [],
          }),
          expect.objectContaining({
            conditionId: '2750',
            conditionDescriptors: [
              {
                id: '27503',
                name: 'Certification Number',
                values: [],
              },
            ],
          }),
          expect.objectContaining({
            conditionId: '4000',
            inventoryCondition: 'USED_VERY_GOOD',
            conditionDescriptors: [
              expect.objectContaining({
                id: '40001',
                values: [expect.objectContaining({ id: '400012' })],
              }),
            ],
          }),
        ],
      })
    );
  });

  it('normalizes explicitly empty condition descriptor values as valueless', () => {
    expect(
      normalizeConditionDescriptors([
        {
          conditionDescriptorId: '27503',
          conditionDescriptorName: 'Certification Number',
          conditionDescriptorValues: [],
        },
      ])
    ).toEqual([{ id: '27503', name: 'Certification Number', values: [] }]);
  });

  it('rejects malformed condition descriptor arrays and rows', () => {
    expect(() => normalizeConditionDescriptors(null)).toThrow(
      'conditionDescriptors must be an array when present.'
    );
    expect(() => normalizeConditionDescriptors({})).toThrow(
      'conditionDescriptors must be an array when present.'
    );
    expect(() => normalizeConditionDescriptors([null])).toThrow(
      'conditionDescriptors contains a malformed row.'
    );
  });

  it('rejects malformed condition descriptor values and identifiers', () => {
    expect(() =>
      normalizeConditionDescriptors([
        { conditionDescriptorId: '27503', conditionDescriptorValues: {} },
      ])
    ).toThrow('conditionDescriptorValues must be an array when present.');
    expect(() =>
      normalizeConditionDescriptors([
        { conditionDescriptorId: '27503', conditionDescriptorValues: [null] },
      ])
    ).toThrow('conditionDescriptorValues contains a malformed row.');
    expect(() =>
      normalizeConditionDescriptors([
        {
          conditionDescriptorId: '40001',
          conditionDescriptorValues: [{}],
        },
      ])
    ).toThrow(/missing or duplicate identifiers/);
    expect(() =>
      normalizeConditionDescriptors([
        {
          conditionDescriptorId: '40001',
          conditionDescriptorValues: [{ conditionDescriptorValueId: 'value-name' }],
        },
      ])
    ).toThrow(/missing or duplicate identifiers/);
    expect(() => normalizeConditionDescriptors([{}])).toThrow(/missing or duplicate identifiers/);
    expect(() =>
      normalizeConditionDescriptors([{ conditionDescriptorId: 'descriptor-name' }])
    ).toThrow(/missing or duplicate identifiers/);
    expect(() =>
      normalizeConditionDescriptors([
        { conditionDescriptorId: '27503' },
        { conditionDescriptorId: '27503' },
      ])
    ).toThrow(/missing or duplicate identifiers/);
    expect(() =>
      normalizeConditionDescriptors([
        {
          conditionDescriptorId: '40001',
          conditionDescriptorValues: [
            { conditionDescriptorValueId: '400012' },
            { conditionDescriptorValueId: '400012' },
          ],
        },
      ])
    ).toThrow(/missing or duplicate identifiers/);
  });

  it('normalizes exact group, child, offer, listing, status, and 404 state', async () => {
    expect(normalizeYouPickGroup({ variantSKUs: ['C01', 'C02'] })).toEqual({
      variantSKUs: ['C01', 'C02'],
    });
    expect(normalizeYouPickItem({ ...validInventoryItem, groupIds: ['G1'] })).toEqual({
      sku: 'C01',
      quantity: 1,
      groupKeys: ['G1'],
      semanticSnapshot: validInventoryItem,
    });
    expect(
      normalizeYouPickOffers({
        offers: [
          {
            ...validOffer,
            offerId: 'O1',
            status: 'PUBLISHED',
            listing: { listingId: 'L1', listingStatus: 'ACTIVE' },
          },
        ],
      })
    ).toEqual({
      offers: [
        {
          offerId: 'O1',
          sku: 'C01',
          marketplaceId: 'EBAY_US',
          status: 'PUBLISHED',
          listingId: 'L1',
          listingStatus: 'ACTIVE',
          lifecycleClass: 'active',
          publicationObserved: true,
          listingCurrentlyActive: true,
          withdrawRequired: true,
          availableQuantity: 1,
          semanticSnapshot: validOffer,
        },
      ],
    });
    expect(normalizeYouPickOffers({ offers: [] })).toEqual({ offers: [] });
    await expect(
      classifyYouPickExactRead(async () => {
        throw Object.assign(new Error('not found'), { response: { status: 404 } });
      })
    ).resolves.toEqual({ status: 'missing' });
    await expect(
      classifyYouPickExactRead(async () => {
        throw Object.assign(new Error('unavailable'), { response: { status: 503 } });
      })
    ).resolves.toEqual(expect.objectContaining({ status: 'unknown' }));
  });

  it.each([
    ['ACTIVE', 'active', true, true, true],
    ['OUT_OF_STOCK', 'active', true, true, true],
    ['INACTIVE', 'ambiguous', true, null, null],
    ['ENDED', 'ended', true, false, false],
    ['EBAY_ENDED', 'ended', true, false, false],
    ['NOT_LISTED', 'not-listed', true, false, false],
  ] as const)(
    'normalizes official listing status %s',
    (
      listingStatus,
      lifecycleClass,
      publicationObserved,
      listingCurrentlyActive,
      withdrawRequired
    ) => {
      expect(
        normalizeYouPickOffers({
          offers: [
            {
              ...validOffer,
              offerId: 'O1',
              status: 'PUBLISHED',
              listing: { listingId: 'L1', listingStatus },
            },
          ],
        }).offers[0]
      ).toEqual(
        expect.objectContaining({
          listingStatus,
          lifecycleClass,
          publicationObserved,
          listingCurrentlyActive,
          withdrawRequired,
        })
      );
    }
  );

  it('rejects unknown or contradictory publication/listing states', () => {
    expect(() =>
      normalizeYouPickOffers({
        offers: [
          {
            ...validOffer,
            offerId: 'O1',
            status: 'PUBLISHED',
            listing: { listingId: 'L1', listingStatus: 'PAUSED' },
          },
        ],
      })
    ).toThrow(/unsupported listing status/);
    expect(() =>
      normalizeYouPickOffers({
        offers: [
          {
            ...validOffer,
            offerId: 'O1',
            status: 'UNPUBLISHED',
            listing: { listingId: 'L1', listingStatus: 'NOT_LISTED' },
          },
        ],
      })
    ).toThrow(/ambiguous publication and listing identity/);
  });

  it('rejects malformed arrays, duplicate metadata IDs, and conflicting item associations', () => {
    expect(() => normalizeYouPickGroup({ variantSKUs: ['C01', 'C01'] })).toThrow(/duplicate/);
    expect(() => normalizeYouPickOffers({ offers: {} })).toThrow(/must be an array/);
    expect(() =>
      normalizeYouPickItem({
        ...validInventoryItem,
        groupIds: ['G1'],
        inventoryItemGroupKeys: ['G2'],
      })
    ).toThrow(/aliases conflict/);
    expect(() =>
      normalizeYouPickMetadata(
        '261328',
        {
          listingStructurePolicies: [
            { categoryId: '261328', variationsSupported: true },
            { categoryId: '261328', variationsSupported: true },
          ],
        },
        { itemConditionPolicies: [] },
        { aspects: [] }
      )
    ).toThrow(/missing or ambiguous/);
  });
});
