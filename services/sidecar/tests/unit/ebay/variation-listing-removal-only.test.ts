import { describe, expect, it } from 'vitest';
import type { VariationListingAggregateSnapshot, VariationListingRevisionRow } from '@ebay-inventory/data';
import { hasOnlyVariationListingPermanentRemovalPending } from '@/ebay/variation-listing-pending-changes.js';

const groupId = '11111111-1111-4111-8111-111111111111';
const targetId = '22222222-2222-4222-8222-222222222222';
const now = '2026-11-05T00:00:00Z';

function aggregate(): VariationListingAggregateSnapshot {
  const group = {
    group_id: groupId, group_key: 'VL-G-TEST', category_id: '261328',
    condition_token: 'VERY_GOOD', condition_descriptors: [{ name: '40001', values: ['400012'] }],
    desired_revision: 3, last_confirmed_revision: 3, title: 'Cards', description: 'Pick a card',
    listing_format: 'FIXED_PRICE', marketplace_id: 'EBAY_US',
    merchant_location_key: 'main', payment_policy_id: 'payment', return_policy_id: 'returns',
    fulfillment_policy_id: 'fulfillment', sku_category_code: 'BSKBL', sku_bucket_token: 'Pilot',
    condition_id: '4000', condition_description: null, derived_common_ebay_aspects: {},
    selector_name: 'Card',
  };
  const baseVariation = {
    group_id: groupId, position: 0, selector_value: 'Card A',
    inventory_serial: 1, variation_metadata: {}, price_amount: 0.99, price_currency: 'USD',
    quantity_adjustment_counter: 0, pending_removal_at: null, representative_copy_id: 'copy-a',
  };
  return {
    group,
    variations: [
      { ...baseVariation, variation_id: targetId, sku: 'SKU-A' },
      { ...baseVariation, variation_id: 'variation-b', sku: 'SKU-B', position: 1, inventory_serial: 2, selector_value: 'Card B', representative_copy_id: 'copy-b' },
      { ...baseVariation, variation_id: 'variation-c', sku: 'SKU-C', position: 2, inventory_serial: 3, selector_value: 'Card C', representative_copy_id: 'copy-c' },
    ],
    copies: ['a', 'b', 'c'].map((letter) => ({
      copy_id: `copy-${letter}`, variation_id: letter === 'a' ? targetId : `variation-${letter}`,
      availability_state: 'available', condition_notes: null, condition_token: 'VERY_GOOD',
      front_r2_key: `front-${letter}`, back_r2_key: `back-${letter}`,
    })),
  } as unknown as VariationListingAggregateSnapshot;
}

function revision(confirmed: VariationListingAggregateSnapshot): VariationListingRevisionRow {
  return {
    revision_id: 'revision-3', group_id: groupId, captured_desired_revision: 3,
    snapshot_version: 1, snapshot: { aggregate: confirmed },
  } as unknown as VariationListingRevisionRow;
}

describe('YP10.11 removal-only publication projection', () => {
  it('allows one isolated removal marker', () => {
    const confirmed = aggregate();
    const current = structuredClone(confirmed);
    current.group.desired_revision = 4;
    current.variations[0]!.pending_removal_at = now;
    expect(hasOnlyVariationListingPermanentRemovalPending(current, revision(confirmed), targetId)).toBe(true);
  });

  it.each([
    ['sibling quantity', (x: VariationListingAggregateSnapshot) => { x.variations[1]!.quantity_adjustment_counter++; }],
    ['sibling price', (x: VariationListingAggregateSnapshot) => { x.variations[1]!.price_amount = 1.49; }],
    ['group description', (x: VariationListingAggregateSnapshot) => { x.group.description = 'Changed'; }],
    ['copy state', (x: VariationListingAggregateSnapshot) => { x.copies[1]!.availability_state = 'unavailable'; }],
    ['copy image', (x: VariationListingAggregateSnapshot) => { x.copies[1]!.front_r2_key = 'other'; }],
  ])('rejects removal mixed with %s', (_name, change) => {
    const confirmed = aggregate();
    const current = structuredClone(confirmed);
    current.group.desired_revision = 4;
    current.variations[0]!.pending_removal_at = now;
    change(current);
    expect(hasOnlyVariationListingPermanentRemovalPending(current, revision(confirmed), targetId)).toBe(false);
  });

  it('rejects ambiguous or missing confirmation and second removal marker', () => {
    const confirmed = aggregate();
    const current = structuredClone(confirmed);
    current.group.desired_revision = 4;
    current.variations[0]!.pending_removal_at = now;
    expect(hasOnlyVariationListingPermanentRemovalPending(current, undefined, targetId)).toBe(false);
    current.variations[1]!.pending_removal_at = now;
    expect(hasOnlyVariationListingPermanentRemovalPending(current, revision(confirmed), targetId)).toBe(false);
  });
});
