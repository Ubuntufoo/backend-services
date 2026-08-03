import { describe, expect, it } from 'vitest';
import {
  classifyYouPickExactRead,
  normalizeYouPickGroup,
  normalizeYouPickItem,
  normalizeYouPickMetadata,
  normalizeYouPickOffers,
  normalizeYouPickPolicies,
} from '@/scripts/you-pick-sandbox-pilot.js';

describe('You Pick raw response normalization', () => {
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

  it('normalizes exact group, child, offer, listing, status, and 404 state', async () => {
    expect(normalizeYouPickGroup({ variantSKUs: ['C01', 'C02'] })).toEqual({
      variantSKUs: ['C01', 'C02'],
    });
    expect(normalizeYouPickItem({ sku: 'C01', groupIds: ['G1'] })).toEqual({
      sku: 'C01',
      groupKeys: ['G1'],
    });
    expect(
      normalizeYouPickOffers({
        offers: [
          {
            offerId: 'O1',
            sku: 'C01',
            marketplaceId: 'EBAY_US',
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
              offerId: 'O1',
              sku: 'C01',
              marketplaceId: 'EBAY_US',
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
            offerId: 'O1',
            sku: 'C01',
            marketplaceId: 'EBAY_US',
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
            offerId: 'O1',
            sku: 'C01',
            marketplaceId: 'EBAY_US',
            status: 'UNPUBLISHED',
            listing: { listingId: 'L1', listingStatus: 'NOT_LISTED' },
          },
        ],
      })
    ).toThrow(/ambiguous publication and listing identity/);
  });

  it('rejects malformed arrays, duplicate metadata IDs, and ambiguous item associations', () => {
    expect(() => normalizeYouPickGroup({ variantSKUs: ['C01', 'C01'] })).toThrow(/duplicate/);
    expect(() => normalizeYouPickOffers({ offers: {} })).toThrow(/must be an array/);
    expect(() =>
      normalizeYouPickItem({ sku: 'C01', groupIds: ['G1'], inventoryItemGroupKeys: ['G1'] })
    ).toThrow(/ambiguous/);
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
