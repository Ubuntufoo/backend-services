import { describe, expect, it, vi } from 'vitest';
import {
  buildCombinedFulfillmentPolicyRequest,
  COMBINED_FULFILLMENT_POLICY_NAME,
  GROUND_FULFILLMENT_POLICY_NAME,
  selectFulfillmentPolicyForListing,
  setupCombinedFulfillmentPolicy,
} from '@/ebay/fulfillment-policy.js';
import type { ResolvedPublishConfig } from '@/ebay/publish-config.js';

const config: ResolvedPublishConfig = {
  combinedFulfillmentPolicyId: 'COMBINED',
  environment: 'production',
  fulfillmentPolicyId: 'GROUND',
  groundFulfillmentPolicyId: 'GROUND',
  marketplaceId: 'EBAY_US',
  merchantLocationKey: 'warehouse',
  paymentPolicyId: 'PAYMENT',
  returnPolicyId: 'RETURN',
  source: 'environment_config',
};

const esePolicy = {
  fulfillmentPolicyId: 'ESE',
  handlingTime: { unit: 'DAY', value: 1 },
  marketplaceId: 'EBAY_US',
  name: 'Current eSE policy',
  shippingOptions: [
    {
      costType: 'FLAT_RATE',
      optionType: 'DOMESTIC',
      shippingServices: [
        {
          shippingCost: { currency: 'USD', value: '1.25' },
          shippingServiceCode: 'US_eBayStandardEnvelope',
          sortOrder: 1,
        },
        {
          freeShipping: true,
          shippingServiceCode: 'Pickup',
          sortOrder: 2,
        },
        {
          shippingCarrierCode: 'USPS',
          shippingCost: { currency: 'USD', value: '8.00' },
          shippingServiceCode: 'USPSPriority',
          sortOrder: 3,
        },
      ],
    },
  ],
};

const groundPolicy = {
  fulfillmentPolicyId: 'GROUND',
  handlingTime: { unit: 'DAY', value: 1 },
  marketplaceId: 'EBAY_US',
  name: GROUND_FULFILLMENT_POLICY_NAME,
  shippingOptions: [
    {
      costType: 'FLAT_RATE',
      optionType: 'DOMESTIC',
      shippingServices: [
        {
          shippingCarrierCode: 'FedEx',
          shippingCost: { currency: 'USD', value: '6.49' },
          shippingServiceCode: 'FedExSmartPost',
          sortOrder: 1,
        },
        {
          freeShipping: true,
          shippingServiceCode: 'Pickup',
          sortOrder: 2,
        },
        {
          shippingCarrierCode: 'FEDEX',
          shippingCost: { currency: 'USD', value: '10.00' },
          shippingServiceCode: 'FedExHomeDelivery',
          sortOrder: 3,
        },
      ],
    },
  ],
};

describe('fulfillment policy selection', () => {
  it('selects combined only for explicitly eSE-eligible listings under $20', () => {
    const selected = selectFulfillmentPolicyForListing(
      {
        category_id: '261328',
        condition_id: '4000',
        ese_eligible: true,
        listing_type: 'single',
        price: 19.99,
      },
      config
    );

    expect(selected).toEqual({ ...config, fulfillmentPolicyId: 'COMBINED' });
    expect(selected.paymentPolicyId).toBe('PAYMENT');
    expect(selected.returnPolicyId).toBe('RETURN');
    expect(selected.merchantLocationKey).toBe('warehouse');
  });

  it.each([
    {
      category_id: '261328',
      condition_id: '4000',
      ese_eligible: false,
      listing_type: 'single',
      price: 10,
    },
    {
      category_id: '261328',
      condition_id: '4000',
      ese_eligible: null,
      listing_type: 'single',
      price: 10,
    },
    {
      category_id: '261328',
      condition_id: '4000',
      ese_eligible: true,
      listing_type: 'single',
      price: 20,
    },
    {
      category_id: '261328',
      condition_id: '4000',
      ese_eligible: true,
      listing_type: 'single',
      price: 19.999,
    },
    {
      category_id: '261328',
      condition_id: '4000',
      ese_eligible: true,
      listing_type: 'single',
      price: 0,
    },
    {
      category_id: '261328',
      condition_id: '4000',
      ese_eligible: true,
      listing_type: 'single',
      price: Number.NaN,
    },
    {
      category_id: '183050',
      condition_id: '4000',
      ese_eligible: true,
      listing_type: 'single',
      price: 10,
    },
    {
      category_id: '261328',
      condition_id: '2750',
      ese_eligible: true,
      listing_type: 'single',
      price: 10,
    },
    {
      category_id: '261328',
      condition_id: '4000',
      ese_eligible: true,
      listing_type: 'lot',
      price: 10,
    },
  ])('selects Ground-only for ineligible listing %o', (listing) => {
    expect(selectFulfillmentPolicyForListing(listing, config).fulfillmentPolicyId).toBe('GROUND');
  });
});

describe('combined fulfillment policy setup', () => {
  it('uses the canonical FedEx Ground Economy source policy name', () => {
    expect(GROUND_FULFILLMENT_POLICY_NAME).toBe('$6.49 FedEx Ground Economy - 5 Day');
  });

  it('preserves source service fields without mutating source policies', () => {
    const originalEse = structuredClone(esePolicy);
    const originalGround = structuredClone(groundPolicy);
    const request = buildCombinedFulfillmentPolicyRequest({ esePolicy, groundPolicy });
    const services = request.shippingOptions?.[0]?.shippingServices;

    expect(request.name).toBe(COMBINED_FULFILLMENT_POLICY_NAME);
    expect(services).toHaveLength(3);
    expect(services?.map((service) => service.shippingServiceCode)).toEqual([
      'US_eBayStandardEnvelope',
      'FedExSmartPost',
      'Pickup',
    ]);
    expect(services?.map((service) => service.sortOrder)).toEqual([1, 2, 3]);
    expect(services?.[0]).toEqual(esePolicy.shippingOptions[0]?.shippingServices?.[0]);
    expect(services?.[1]).toEqual({
      ...groundPolicy.shippingOptions[0]?.shippingServices?.[0],
      sortOrder: 2,
    });
    expect(services?.[1]?.shippingCost).toEqual({ currency: 'USD', value: '6.49' });
    expect(esePolicy).toEqual(originalEse);
    expect(groundPolicy).toEqual(originalGround);
  });

  it('resolves an existing combined policy without creating or reading details', async () => {
    const accountApi = {
      createFulfillmentPolicy: vi.fn(),
      getFulfillmentPolicies: vi.fn().mockResolvedValue({
        fulfillmentPolicies: [
          { fulfillmentPolicyId: 'COMBINED', name: COMBINED_FULFILLMENT_POLICY_NAME },
          { fulfillmentPolicyId: 'GROUND', name: GROUND_FULFILLMENT_POLICY_NAME },
        ],
      }),
      getFulfillmentPolicy: vi.fn(),
    };

    await expect(
      setupCombinedFulfillmentPolicy({
        accountApi,
        eseSourceFulfillmentPolicyId: 'ESE',
        execute: true,
        marketplaceId: 'EBAY_US',
      })
    ).resolves.toEqual({
      combinedFulfillmentPolicyId: 'COMBINED',
      groundFulfillmentPolicyId: 'GROUND',
      status: 'resolved',
    });
    expect(accountApi.createFulfillmentPolicy).not.toHaveBeenCalled();
    expect(accountApi.getFulfillmentPolicy).not.toHaveBeenCalled();
  });

  it('creates the combined policy once from the exact source policies', async () => {
    const accountApi = {
      createFulfillmentPolicy: vi.fn().mockResolvedValue({ fulfillmentPolicyId: 'NEW-COMBINED' }),
      getFulfillmentPolicies: vi.fn().mockResolvedValue({
        fulfillmentPolicies: [
          { fulfillmentPolicyId: 'ESE', name: 'Current eSE policy' },
          { fulfillmentPolicyId: 'GROUND', name: GROUND_FULFILLMENT_POLICY_NAME },
        ],
      }),
      getFulfillmentPolicy: vi
        .fn()
        .mockResolvedValueOnce(esePolicy)
        .mockResolvedValueOnce(groundPolicy),
    };

    await expect(
      setupCombinedFulfillmentPolicy({
        accountApi,
        eseSourceFulfillmentPolicyId: 'ESE',
        execute: true,
        marketplaceId: 'EBAY_US',
      })
    ).resolves.toEqual({
      combinedFulfillmentPolicyId: 'NEW-COMBINED',
      groundFulfillmentPolicyId: 'GROUND',
      status: 'created',
    });
    expect(accountApi.createFulfillmentPolicy).toHaveBeenCalledOnce();
    const request = accountApi.createFulfillmentPolicy.mock.calls[0]?.[0];
    expect(request.shippingOptions[0].shippingServices).toHaveLength(3);
  });

  it('fails closed when FedEx Ground Economy is missing or ambiguous', () => {
    expect(() =>
      buildCombinedFulfillmentPolicyRequest({
        esePolicy,
        groundPolicy: {
          ...groundPolicy,
          shippingOptions: [
            {
              ...groundPolicy.shippingOptions[0],
              shippingServices: [
                {
                  ...groundPolicy.shippingOptions[0]?.shippingServices?.[0],
                  shippingServiceCode: 'USPSPriority',
                  shippingCarrierCode: 'USPS',
                },
                groundPolicy.shippingOptions[0]?.shippingServices?.[1],
              ],
            },
          ],
        },
      })
    ).toThrow('FedEx Ground Economy service');

    expect(() =>
      buildCombinedFulfillmentPolicyRequest({
        esePolicy,
        groundPolicy: {
          ...groundPolicy,
          shippingOptions: [
            {
              ...groundPolicy.shippingOptions[0],
              shippingServices: [
                ...(groundPolicy.shippingOptions[0]?.shippingServices ?? []),
                {
                  ...groundPolicy.shippingOptions[0]?.shippingServices?.[0],
                  sortOrder: 4,
                },
              ],
            },
          ],
        },
      })
    ).toThrow('FedEx Ground Economy service');
  });

  it('fails closed when eBay Standard Envelope is missing or ambiguous', () => {
    const withoutEse = {
      ...esePolicy,
      shippingOptions: [
        {
          ...esePolicy.shippingOptions[0],
          shippingServices: esePolicy.shippingOptions[0]?.shippingServices?.slice(1),
        },
      ],
    };
    const withDuplicateEse = {
      ...esePolicy,
      shippingOptions: [
        {
          ...esePolicy.shippingOptions[0],
          shippingServices: [
            ...(esePolicy.shippingOptions[0]?.shippingServices ?? []),
            { ...esePolicy.shippingOptions[0]?.shippingServices?.[0], sortOrder: 4 },
          ],
        },
      ],
    };

    expect(() =>
      buildCombinedFulfillmentPolicyRequest({ esePolicy: withoutEse, groundPolicy })
    ).toThrow('US_eBayStandardEnvelope');
    expect(() =>
      buildCombinedFulfillmentPolicyRequest({ esePolicy: withDuplicateEse, groundPolicy })
    ).toThrow('US_eBayStandardEnvelope');
  });

  it('fails closed when free Pickup is absent', () => {
    expect(() =>
      buildCombinedFulfillmentPolicyRequest({
        esePolicy: {
          ...esePolicy,
          shippingOptions: [
            {
              ...esePolicy.shippingOptions[0],
              shippingServices: [esePolicy.shippingOptions[0]?.shippingServices?.[0]],
            },
          ],
        },
        groundPolicy: {
          ...groundPolicy,
          shippingOptions: [
            {
              ...groundPolicy.shippingOptions[0],
              shippingServices: [groundPolicy.shippingOptions[0]?.shippingServices?.[0]],
            },
          ],
        },
      })
    ).toThrow('free Pickup');
  });

  it('keeps dry-run setup read-only', async () => {
    const accountApi = {
      createFulfillmentPolicy: vi.fn(),
      getFulfillmentPolicies: vi.fn().mockResolvedValue({
        fulfillmentPolicies: [
          { fulfillmentPolicyId: 'GROUND', name: GROUND_FULFILLMENT_POLICY_NAME },
        ],
      }),
      getFulfillmentPolicy: vi
        .fn()
        .mockResolvedValueOnce(esePolicy)
        .mockResolvedValueOnce(groundPolicy),
    };

    await expect(
      setupCombinedFulfillmentPolicy({
        accountApi,
        eseSourceFulfillmentPolicyId: 'ESE',
        execute: false,
        marketplaceId: 'EBAY_US',
      })
    ).resolves.toMatchObject({ combinedFulfillmentPolicyId: null, status: 'would_create' });
    expect(accountApi.createFulfillmentPolicy).not.toHaveBeenCalled();
  });
});
