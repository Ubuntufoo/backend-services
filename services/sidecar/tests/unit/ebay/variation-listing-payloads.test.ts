import type {
  VariationListingAggregateSnapshot,
  VariationListingCopyRow,
  VariationListingGroupRow,
  VariationListingVariationRow,
} from '@ebay-inventory/data';
import { describe, expect, it } from 'vitest';

import { buildVariationListingInventoryPayloadBundle } from '@/ebay/variation-listing-payloads.js';

const front1 = 'https://i.ebayimg.com/images/g/AAA/s-l1600.jpg';
const back1 = 'https://i.ebayimg.com/images/g/BBB/s-l1600.jpg';
const front2 = 'https://i.ebayimg.com/images/g/CCC/s-l1600.jpg';
const back2 = 'https://i.ebayimg.com/images/g/DDD/s-l1600.jpg';

function group(overrides: Partial<VariationListingGroupRow> = {}): VariationListingGroupRow {
  return {
    category_id: '261328',
    condition_description: null,
    condition_descriptors: [{ name: '40001', values: ['400012'] }],
    condition_id: '4000',
    condition_token: 'VERY_GOOD',
    created_at: '2026-09-01T00:00:00Z',
    derived_common_ebay_aspects: { Sport: ['Baseball'], Language: 'English' },
    description: 'Two cards from the same set.',
    desired_revision: 1,
    fulfillment_policy_id: 'fulfillment-1',
    group_id: 'group-1',
    group_key: 'GROUP-1',
    last_confirmed_revision: null,
    lifecycle_state: 'review',
    listing_format: 'FIXED_PRICE',
    marketplace_id: 'EBAY_US',
    merchant_location_key: 'warehouse-1',
    next_inventory_serial: 3,
    payment_policy_id: 'payment-1',
    return_policy_id: 'return-1',
    selector_name: 'Card',
    sku_bucket_token: 'bucket',
    sku_category_code: 'sports',
    title: 'Baseball cards',
    updated_at: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

function variation(
  input: Partial<VariationListingVariationRow> & Pick<VariationListingVariationRow, 'variation_id' | 'position' | 'sku' | 'selector_value' | 'representative_copy_id'>
): VariationListingVariationRow {
  return {
    created_at: '2026-09-01T00:00:00Z',
    group_id: 'group-1',
    inventory_serial: input.position + 1,
    price_amount: 0.99,
    price_currency: 'USD',
    updated_at: '2026-09-01T00:00:00Z',
    variation_metadata: {},
    ...input,
  };
}

function copy(
  input: Pick<VariationListingCopyRow, 'copy_id' | 'variation_id' | 'availability_state' | 'condition_token'>
): VariationListingCopyRow {
  return {
    back_r2_key: `r2/${input.copy_id}/back`,
    capture_back_source_ref: `source/${input.copy_id}/back`,
    capture_front_source_ref: `source/${input.copy_id}/front`,
    capture_pair_id: `pair-${input.copy_id}`,
    capture_source_key: `capture-${input.copy_id}`,
    capture_started_at: '2026-09-01T00:00:00Z',
    captured_at: '2026-09-01T00:00:01Z',
    condition_notes: null,
    created_at: '2026-09-01T00:00:01Z',
    front_r2_key: `r2/${input.copy_id}/front`,
    updated_at: '2026-09-01T00:00:01Z',
    ...input,
  };
}

function fixture(): { aggregate: VariationListingAggregateSnapshot; representativeImages: { copyId: string; frontEpsUrl: string; backEpsUrl: string }[] } {
  const v1 = variation({ variation_id: 'v1', position: 0, sku: 'SKU-1', selector_value: 'Card One', representative_copy_id: 'c1' });
  const v2 = variation({ variation_id: 'v2', position: 1, sku: 'SKU-2', selector_value: 'Card Two', representative_copy_id: 'c2', price_amount: 2.49 });
  return {
    aggregate: {
      group: group(),
      // Deliberately reversed: application position owns output order.
      variations: [v2, v1],
      copies: [
        copy({ copy_id: 'c1', variation_id: 'v1', availability_state: 'available', condition_token: 'VERY_GOOD' }),
        copy({ copy_id: 'c1b', variation_id: 'v1', availability_state: 'unavailable', condition_token: 'EXCELLENT' }),
        // Representative copy may be unavailable; it remains the image source.
        copy({ copy_id: 'c2', variation_id: 'v2', availability_state: 'unavailable', condition_token: 'VERY_GOOD' }),
      ],
    },
    representativeImages: [
      { copyId: 'c2', frontEpsUrl: front2, backEpsUrl: back2 },
      { copyId: 'c1', frontEpsUrl: front1, backEpsUrl: back1 },
    ],
  };
}

function build(overrides: {
  aggregate?: Partial<VariationListingAggregateSnapshot>;
  representativeImages?: { copyId: string; frontEpsUrl: string; backEpsUrl: string }[];
} = {}) {
  const base = fixture();
  return buildVariationListingInventoryPayloadBundle({
    aggregate: { ...base.aggregate, ...overrides.aggregate },
    representativeImages: overrides.representativeImages ?? base.representativeImages,
  });
}

describe('buildVariationListingInventoryPayloadBundle', () => {
  it('builds ordered child items/offers, complete group, and exact publish request', () => {
    const result = build();

    expect(result.children.map((child) => child.variationId)).toEqual(['v1', 'v2']);
    expect(result.group.variantSKUs).toEqual(['SKU-1', 'SKU-2']);
    expect(result.group.variesBy).toEqual({
      aspectsImageVariesBy: ['Card'],
      specifications: [{ name: 'Card', values: ['Card One', 'Card Two'] }],
    });
    expect(result.group).not.toHaveProperty('imageUrls');
    expect(result.group.aspects).toEqual({ Sport: ['Baseball'], Language: ['English'] });
    expect(result.publishRequest).toEqual({ inventoryItemGroupKey: 'GROUP-1', marketplaceId: 'EBAY_US' });

    expect(result.children[0]).toMatchObject({ quantity: 1, sku: 'SKU-1', selectorValue: 'Card One', representativeCopyId: 'c1' });
    expect(result.children[1]).toMatchObject({ quantity: 0, sku: 'SKU-2', selectorValue: 'Card Two', representativeCopyId: 'c2' });
    expect(result.children.map((child) => child.inventoryItem.availability.shipToLocationAvailability.quantity)).toEqual([1, 0]);
    expect(result.children.map((child) => child.offer.availableQuantity)).toEqual([1, 0]);
    expect(result.children[0]?.inventoryItem).toEqual({
      availability: { shipToLocationAvailability: { quantity: 1 } },
      condition: 'USED_VERY_GOOD',
      conditionDescriptors: [{ name: '40001', values: ['400012'] }],
      product: { aspects: { Card: ['Card One'] }, imageUrls: [front1, back1] },
    });
    expect(result.children[1]?.inventoryItem.product?.imageUrls).toEqual([front2, back2]);
    expect(result.children[0]?.inventoryItem.product?.aspects).toEqual({ Card: ['Card One'] });
    expect(result.children[0]?.offer).toEqual({
      availableQuantity: 1,
      categoryId: '261328',
      format: 'FIXED_PRICE',
      listingPolicies: { fulfillmentPolicyId: 'fulfillment-1', paymentPolicyId: 'payment-1', returnPolicyId: 'return-1' },
      marketplaceId: 'EBAY_US',
      merchantLocationKey: 'warehouse-1',
      pricingSummary: { price: { currency: 'USD', value: '0.99' } },
      sku: 'SKU-1',
    });
    expect(result.children[1]?.offer.pricingSummary.price.value).toBe('2.49');
  });

  it.each([
    ['fewer than two variations', (a: VariationListingAggregateSnapshot) => ({ ...a, variations: [a.variations[0]!] })],
    ['wrong category', (a: VariationListingAggregateSnapshot) => ({ ...a, group: group({ category_id: '999' }) })],
    ['wrong marketplace', (a: VariationListingAggregateSnapshot) => ({ ...a, group: group({ marketplace_id: 'EBAY_GB' }) })],
    ['wrong condition id', (a: VariationListingAggregateSnapshot) => ({ ...a, group: group({ condition_id: '2750' }) })],
    ['wrong listing format', (a: VariationListingAggregateSnapshot) => ({ ...a, group: group({ listing_format: 'AUCTION' }) })],
    ['wrong selector name', (a: VariationListingAggregateSnapshot) => ({ ...a, group: group({ selector_name: 'Color' }) })],
    ['missing title', (a: VariationListingAggregateSnapshot) => ({ ...a, group: group({ title: null }) })],
    ['overlong title', (a: VariationListingAggregateSnapshot) => ({ ...a, group: group({ title: 'x'.repeat(81) }) })],
    ['missing description', (a: VariationListingAggregateSnapshot) => ({ ...a, group: group({ description: null }) })],
    ['overlong description', (a: VariationListingAggregateSnapshot) => ({ ...a, group: group({ description: 'x'.repeat(4001) }) })],
    ['non-contiguous positions', (a: VariationListingAggregateSnapshot) => ({ ...a, variations: a.variations.map((v, i) => ({ ...v, position: i + 1 })) })],
    ['duplicate SKUs', (a: VariationListingAggregateSnapshot) => ({ ...a, variations: a.variations.map((v) => ({ ...v, sku: 'SAME' })) })],
    ['duplicate selector values', (a: VariationListingAggregateSnapshot) => ({ ...a, variations: a.variations.map((v) => ({ ...v, selector_value: 'SAME' })) })],
    ['non-manual variation price', (a: VariationListingAggregateSnapshot) => ({ ...a, variations: a.variations.map((v) => ({ ...v, price_amount: 1.23 })) })],
    ['foreign copy ownership', (a: VariationListingAggregateSnapshot) => ({ ...a, copies: [...a.copies, copy({ copy_id: 'foreign', variation_id: 'other', availability_state: 'available', condition_token: 'VERY_GOOD' })] })],
    ['duplicate copy ids', (a: VariationListingAggregateSnapshot) => ({ ...a, copies: [...a.copies, { ...a.copies[0]! }] })],
    ['missing representative copy', (a: VariationListingAggregateSnapshot) => ({ ...a, variations: a.variations.map((v) => v.variation_id === 'v1' ? { ...v, representative_copy_id: null } : v) })],
    ['representative copy belongs to another variation', (a: VariationListingAggregateSnapshot) => ({ ...a, variations: a.variations.map((v) => v.variation_id === 'v1' ? { ...v, representative_copy_id: 'c2' } : v) })],
    ['common Card leakage', (a: VariationListingAggregateSnapshot) => ({ ...a, group: group({ derived_common_ebay_aspects: { Sport: ['Baseball'], Card: ['leak'] } }) })],
    ['missing common Sport', (a: VariationListingAggregateSnapshot) => ({ ...a, group: group({ derived_common_ebay_aspects: { Language: ['English'] } }) })],
    ['unsupported group condition', (a: VariationListingAggregateSnapshot) => ({ ...a, group: group({ condition_token: 'NEW' }) })],
    ['inherited-property group condition', (a: VariationListingAggregateSnapshot) => ({ ...a, group: group({ condition_token: 'toString' }) })],
    ['unsupported copy condition', (a: VariationListingAggregateSnapshot) => ({ ...a, copies: [copy({ copy_id: 'c1', variation_id: 'v1', availability_state: 'available', condition_token: 'NEW' }), ...a.copies.slice(1)] })],
    ['inherited-property copy condition', (a: VariationListingAggregateSnapshot) => ({ ...a, copies: [copy({ copy_id: 'c1', variation_id: 'v1', availability_state: 'available', condition_token: 'toString' }), ...a.copies.slice(1)] })],
    ['available copy below shared condition', (a: VariationListingAggregateSnapshot) => ({ ...a, copies: [copy({ copy_id: 'c1', variation_id: 'v1', availability_state: 'available', condition_token: 'POOR' }), ...a.copies.slice(1)] })],
    ['malformed condition descriptors', (a: VariationListingAggregateSnapshot) => ({ ...a, group: group({ condition_descriptors: [{ name: 'not-numeric', values: ['400012'] }] }) })],
    ['overlong condition description', (a: VariationListingAggregateSnapshot) => ({ ...a, group: group({ condition_descriptors: [], condition_description: 'x'.repeat(1001) }) })],
  ])('%s fails closed', (_name, mutate) => {
    const base = fixture().aggregate;
    expect(() => build({ aggregate: mutate(base) })).toThrow();
  });

  it('rejects duplicate image URLs across representative pairs', () => {
    expect(() => build({ representativeImages: [{ copyId: 'c1', frontEpsUrl: front1, backEpsUrl: front1 }, { copyId: 'c2', frontEpsUrl: front2, backEpsUrl: back2 }] })).toThrow();
  });

  it('preserves valid eBay EPS query strings and does not invent universal aspect-length caps', () => {
    const base = fixture();
    base.aggregate.variations[0]!.selector_value = 'x'.repeat(65);
    base.aggregate.group.derived_common_ebay_aspects = {
      Sport: ['Baseball'],
      ['x'.repeat(60)]: ['y'.repeat(80)],
    };
    base.representativeImages[0]!.frontEpsUrl = `${front2}?set_id=880000500F`;

    const result = buildVariationListingInventoryPayloadBundle(base);
    expect(result.children[1]?.selectorValue).toHaveLength(65);
    expect(result.children[1]?.inventoryItem.product?.imageUrls[0]).toBe(`${front2}?set_id=880000500F`);
    expect(result.group.aspects['x'.repeat(60)]).toEqual(['y'.repeat(80)]);
  });

  it.each([
    ['representative set mismatch', [{ copyId: 'c1', frontEpsUrl: front1, backEpsUrl: back1 }]],
    ['untrusted non-HTTPS EPS URL', [{ copyId: 'c1', frontEpsUrl: 'http://i.ebayimg.com/images/g/AAA/s-l1600.jpg', backEpsUrl: back1 }, { copyId: 'c2', frontEpsUrl: front2, backEpsUrl: back2 }]],
    ['missing representative URL', [{ copyId: 'c1', frontEpsUrl: front1, backEpsUrl: back1 }, { copyId: 'c2', frontEpsUrl: front2, backEpsUrl: front2 }]],
  ])('%s fails closed', (_name, representativeImages) => {
    expect(() => build({ representativeImages })).toThrow();
  });

  it('rejects duplicate variation ids and unsupported availability states', () => {
    const base = fixture().aggregate;
    expect(() => build({ aggregate: { ...base, variations: base.variations.map((v) => ({ ...v, variation_id: 'same' })) } })).toThrow();
    expect(() => build({ aggregate: { ...base, copies: [copy({ copy_id: 'c1', variation_id: 'v1', availability_state: 'reserved', condition_token: 'VERY_GOOD' }), ...base.copies.slice(1)] } })).toThrow();
  });
});
