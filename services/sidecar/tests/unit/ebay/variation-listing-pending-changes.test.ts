import { describe, expect, it } from 'vitest';
import type { VariationListingAggregateSnapshot, VariationListingRevisionRow } from '@ebay-inventory/data';

import { hasEffectiveVariationListingPendingChanges, pendingVariationPriceQuantityChanges } from '@/ebay/variation-listing-pending-changes.js';

const now = '2026-10-29T00:00:00.000Z';

function aggregate(): VariationListingAggregateSnapshot {
  return {
    group: {
      group_id: 'group-1', group_key: 'VL-G-1', sku_category_code: 'BSKBL', sku_bucket_token: 'Player',
      next_inventory_serial: 3, lifecycle_state: 'active', selector_name: 'Card', title: 'Cards', description: 'Pick one.',
      derived_common_ebay_aspects: { Brand: ['Topps'], Sport: ['Basketball'] }, category_id: '261328', marketplace_id: 'EBAY_US',
      listing_format: 'FIXED_PRICE', merchant_location_key: 'main', fulfillment_policy_id: 'fulfillment', payment_policy_id: 'payment',
      return_policy_id: 'returns', condition_id: '4000', condition_token: 'VERY_GOOD', condition_description: 'Used cards',
      condition_descriptors: [{ name: '40001', values: ['400012'] }], desired_revision: 3, last_confirmed_revision: 3,
      created_at: now, updated_at: now,
    },
    variations: [{
      variation_id: 'variation-1', group_id: 'group-1', inventory_serial: 1, sku: 'SKU-1', position: 0,
      selector_value: '1998 Topps', price_amount: 3.49, price_currency: 'USD', quantity_adjustment_counter: 1,
      pending_removal_at: null, representative_copy_id: 'copy-1', variation_metadata: { player: 'Player', year: 1998 },
      created_at: now, updated_at: now,
    }],
    copies: [{
      copy_id: 'copy-1', variation_id: 'variation-1', availability_state: 'available', condition_token: 'VERY_GOOD',
      condition_notes: 'Clean', front_r2_key: 'front.jpg', back_r2_key: 'back.jpg', capture_source_key: 'station-a',
      capture_pair_id: 'pair-1', capture_front_source_ref: 'front-source', capture_back_source_ref: 'back-source',
      capture_started_at: now, captured_at: now, created_at: now, updated_at: now,
    }],
  } as VariationListingAggregateSnapshot;
}

function revision(confirmed: VariationListingAggregateSnapshot, version: 1 | 3 = 1): VariationListingRevisionRow {
  return {
    revision_id: 'revision-3', group_id: confirmed.group.group_id, captured_desired_revision: 3,
    snapshot_version: version, snapshot_digest: 'a'.repeat(64), operation_plan: [], operation_count: 0, captured_at: now,
    snapshot: version === 1
      ? { aggregate: confirmed }
      : { aggregate: confirmed, confirmed: { aggregate: confirmed, representativeImages: [], remote: { listingId: 'listing-1', offerIdsBySku: {} }, revisionId: 'revision-2' }, mediaResources: [], representativeImages: [] },
  } as unknown as VariationListingRevisionRow;
}

function staged(mutator?: (value: VariationListingAggregateSnapshot) => void) {
  const confirmed = aggregate();
  const current = structuredClone(confirmed);
  current.group.desired_revision = 7;
  current.group.last_confirmed_revision = 3;
  mutator?.(current);
  return { confirmed, current };
}

describe('effective variation-listing pending changes', () => {
  it('compares derived condition semantics when persisted descriptors are stale', () => {
    const confirmed = aggregate();
    confirmed.group.condition_descriptors = [{ name: '40001', values: ['400012'] }];
    const current = structuredClone(confirmed);
    current.group.desired_revision = 7;
    current.group.last_confirmed_revision = 3;
    current.group.condition_descriptors = [];

    expect(hasEffectiveVariationListingPendingChanges(current, revision(confirmed))).toBe(false);
  });

  it.each([1, 3] as const)('recognizes a net-zero staged aggregate from a v%s confirmed snapshot', (version) => {
    const { confirmed, current } = staged();
    expect(hasEffectiveVariationListingPendingChanges(current, revision(confirmed, version))).toBe(false);
  });

  it('ignores only lifecycle, revision, allocation-watermark, timestamp, and capture-provenance changes', () => {
    const { confirmed, current } = staged((value) => {
      value.group.lifecycle_state = 'publishing';
      value.group.next_inventory_serial = 99;
      value.group.updated_at = '2026-10-30T00:00:00.000Z';
      value.variations[0]!.updated_at = '2026-10-30T00:00:00.000Z';
      value.copies[0]!.updated_at = '2026-10-30T00:00:00.000Z';
      value.copies[0]!.capture_source_key = 'station-b';
      value.copies[0]!.capture_pair_id = 'pair-2';
      value.copies[0]!.capture_front_source_ref = 'new-front-source';
    });
    expect(hasEffectiveVariationListingPendingChanges(current, revision(confirmed))).toBe(false);
  });

  it.each([
    ['price', (value: VariationListingAggregateSnapshot) => { value.variations[0]!.price_amount = 3.99; }],
    ['quantity', (value: VariationListingAggregateSnapshot) => { value.variations[0]!.quantity_adjustment_counter = 2; }],
    ['selector', (value: VariationListingAggregateSnapshot) => { value.variations[0]!.selector_value = 'Different'; }],
    ['group content', (value: VariationListingAggregateSnapshot) => { value.group.description = 'Different'; }],
    ['representative copy', (value: VariationListingAggregateSnapshot) => { value.variations[0]!.representative_copy_id = 'copy-2'; }],
    ['copy availability', (value: VariationListingAggregateSnapshot) => { value.copies[0]!.availability_state = 'unavailable'; }],
    ['copy condition', (value: VariationListingAggregateSnapshot) => { value.copies[0]!.condition_notes = 'Different'; }],
    ['condition token', (value: VariationListingAggregateSnapshot) => { value.group.condition_token = 'EXCELLENT'; }],
    ['copy image', (value: VariationListingAggregateSnapshot) => { value.copies[0]!.front_r2_key = 'different.jpg'; }],
    ['pending removal', (value: VariationListingAggregateSnapshot) => { value.variations[0]!.pending_removal_at = now; }],
    ['new variation', (value: VariationListingAggregateSnapshot) => { value.variations.push({ ...value.variations[0]!, variation_id: 'variation-2', sku: 'SKU-2' }); }],
    ['removed variation', (value: VariationListingAggregateSnapshot) => { value.variations = []; value.copies = []; }],
  ] as const)('keeps %s publishable', (_label, mutate) => {
    const { confirmed, current } = staged(mutate);
    expect(hasEffectiveVariationListingPendingChanges(current, revision(confirmed))).toBe(true);
  });

  it('supports partial revert and restage without changing the confirmed baseline', () => {
    const { confirmed, current } = staged((value) => { value.variations[0]!.quantity_adjustment_counter = 2; });
    expect(hasEffectiveVariationListingPendingChanges(current, revision(confirmed))).toBe(true);
    current.variations[0]!.quantity_adjustment_counter = 1;
    expect(hasEffectiveVariationListingPendingChanges(current, revision(confirmed))).toBe(false);
    current.variations[0]!.price_amount = 4.49;
    expect(hasEffectiveVariationListingPendingChanges(current, revision(confirmed))).toBe(true);
  });

  it.each([1, 3] as const)('shows only actual child price/quantity deltas from a v%s baseline and clears after reversion', (version) => {
    const { confirmed, current } = staged();
    const sibling = {...current.variations[0]!, variation_id: 'variation-2', sku: 'SKU-2'};
    const confirmedSibling = {...confirmed.variations[0]!, variation_id: 'variation-2', sku: 'SKU-2'};
    current.variations.push(sibling);
    confirmed.variations.push(confirmedSibling);
    expect(pendingVariationPriceQuantityChanges(current, revision(confirmed, version))?.get('variation-1')).toBe(false);
    current.variations[0]!.price_amount = 4.99;
    let pending = pendingVariationPriceQuantityChanges(current, revision(confirmed, version));
    expect(pending?.get('variation-1')).toBe(true);
    expect(pending?.get('variation-2')).toBe(false);
    current.variations[0]!.price_amount = 3.49;
    current.variations[0]!.quantity_adjustment_counter += 1;
    pending = pendingVariationPriceQuantityChanges(current, revision(confirmed, version));
    expect(pending?.get('variation-1')).toBe(true);
    expect(pending?.get('variation-2')).toBe(false);
    current.variations[0]!.quantity_adjustment_counter -= 1;
    expect(pendingVariationPriceQuantityChanges(current, revision(confirmed, version))?.get('variation-1')).toBe(false);
  });

  it('does not mistake sold-copy availability drift for a staged active quantity adjustment', () => {
    const { confirmed, current } = staged((value) => { value.copies[0]!.availability_state = 'unavailable'; });
    expect(hasEffectiveVariationListingPendingChanges(current, revision(confirmed))).toBe(true);
    expect(pendingVariationPriceQuantityChanges(current, revision(confirmed))?.get('variation-1')).toBe(false);
  });

  it('does not advertise a staged price or quantity when only other fields change or baseline is unknown', () => {
    const { confirmed, current } = staged((value) => { value.group.description = 'A new group description'; });
    expect(hasEffectiveVariationListingPendingChanges(current, revision(confirmed))).toBe(true);
    expect(pendingVariationPriceQuantityChanges(current, revision(confirmed))?.get('variation-1')).toBe(false);
    expect(pendingVariationPriceQuantityChanges(current, undefined)).toBeNull();
    expect(pendingVariationPriceQuantityChanges(current, {...revision(confirmed), group_id: 'other'})).toBeNull();
  });

  it.each([
    ['missing', undefined],
    ['wrong revision', { captured_desired_revision: 2 }],
    ['wrong group', { group_id: 'other' }],
    ['malformed snapshot', { snapshot: { aggregate: { variations: 'bad' } } }],
  ])('fails closed for %s confirmed evidence', (_label, patch) => {
    const { confirmed, current } = staged();
    const evidence = patch === undefined ? undefined : Object.assign(revision(confirmed), patch);
    expect(hasEffectiveVariationListingPendingChanges(current, evidence)).toBe(true);
  });

  it('fails closed for unsupported condition evidence', () => {
    const { current, confirmed } = staged();
    (confirmed.group as typeof confirmed.group & { condition_token: string }).condition_token = 'UNSUPPORTED';
    expect(hasEffectiveVariationListingPendingChanges(current, revision(confirmed))).toBe(true);
  });

  it.each([
    ['duplicate descriptor names', [
      { name: '40001', values: ['400012'] },
      { name: '40001', values: ['400013'] },
    ]],
    ['unknown descriptor key', [{ name: '40001', values: ['400012'], unsupported: 'x' }]],
    ['invalid additional info', [{ name: '40001', values: ['400012'], additionalInfo: ' ' }]],
  ] as const)('fails closed for identical malformed %s evidence', (_label, descriptors) => {
    const { current, confirmed } = staged();
    current.group.condition_descriptors = structuredClone(descriptors) as typeof current.group.condition_descriptors;
    confirmed.group.condition_descriptors = structuredClone(descriptors) as typeof confirmed.group.condition_descriptors;
    expect(hasEffectiveVariationListingPendingChanges(current, revision(confirmed))).toBe(true);
  });
});
