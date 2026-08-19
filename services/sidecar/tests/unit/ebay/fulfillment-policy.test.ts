import { describe, expect, it } from 'vitest';
import { selectFulfillmentPolicyForListing } from '@/ebay/fulfillment-policy.js';
import type { ResolvedPublishConfig } from '@/ebay/publish-config.js';

const config: ResolvedPublishConfig = {
  combinedFulfillmentPolicyId: '263022806013',
  environment: 'production',
  fulfillmentPolicyId: '262292202013',
  groundFulfillmentPolicyId: '262292202013',
  marketplaceId: 'EBAY_US',
  merchantLocationKey: 'warehouse',
  paymentPolicyId: 'PAYMENT',
  returnPolicyId: 'RETURN',
  source: 'environment_config',
};

describe('fulfillment policy selection', () => {
  it.each([
    { price: 0.99, expected: '263022806013' },
    { price: 19.99, expected: '263022806013' },
    { price: 19.999, expected: '262292202013' },
    { price: 20, expected: '262292202013' },
  ])('selects the policy from the rounded outbound price ($price)', ({ price, expected }) => {
    const selected = selectFulfillmentPolicyForListing(
      {
        category_id: '261328',
        condition_id: '4000',
        ese_eligible: true,
        listing_type: 'single',
        price,
      },
      config
    );

    expect(selected.fulfillmentPolicyId).toBe(expected);
  });

  it.each([
    {
      name: 'explicitly ineligible',
      listing: {
        category_id: '261328',
        condition_id: '4000',
        ese_eligible: false,
        listing_type: 'single',
        price: 10,
      },
    },
    {
      name: 'missing persisted eligibility',
      listing: {
        category_id: '261328',
        condition_id: '4000',
        ese_eligible: null,
        listing_type: 'single',
        price: 10,
      },
    },
    {
      name: 'non-sports category',
      listing: {
        category_id: '183050',
        condition_id: '4000',
        ese_eligible: true,
        listing_type: 'single',
        price: 10,
      },
    },
    {
      name: 'non-raw condition',
      listing: {
        category_id: '261328',
        condition_id: '2750',
        ese_eligible: true,
        listing_type: 'single',
        price: 10,
      },
    },
    {
      name: 'lot listing',
      listing: {
        category_id: '261328',
        condition_id: '4000',
        ese_eligible: true,
        listing_type: 'lot',
        price: 10,
      },
    },
  ])('falls back to Ground for $name', ({ listing }) => {
    expect(selectFulfillmentPolicyForListing(listing, config).fulfillmentPolicyId).toBe(
      '262292202013'
    );
  });

  it('preserves the remaining publish configuration fields', () => {
    const selected = selectFulfillmentPolicyForListing(
      {
        category_id: '261328',
        condition_id: '4000',
        ese_eligible: true,
        listing_type: 'single',
        price: 10,
      },
      config
    );

    expect(selected).toEqual({ ...config, fulfillmentPolicyId: '263022806013' });
  });
});
