import type {
  VariationListingAggregateSnapshot,
  VariationListingRevisionRow,
} from '@ebay-inventory/data';

import { revisionSnapshotAggregate } from '@/ebay/variation-listing-active-revision.js';

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Variation listing pending comparison contains a non-finite number.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`;
  }
  throw new Error('Variation listing pending comparison contains an unsupported value.');
}

function publicationProjection(aggregate: VariationListingAggregateSnapshot): unknown {
  if (!aggregate || typeof aggregate !== 'object' || !aggregate.group || typeof aggregate.group !== 'object') {
    throw new Error('Variation listing pending comparison requires a group.');
  }
  if (!Array.isArray(aggregate.variations) || !Array.isArray(aggregate.copies)) {
    throw new Error('Variation listing pending comparison requires variation and copy arrays.');
  }
  const group = aggregate.group;
  const variations = aggregate.variations.map((variation) => ({
    groupId: variation.group_id,
    inventorySerial: variation.inventory_serial,
    pendingRemoval: variation.pending_removal_at !== null,
    position: variation.position,
    priceAmount: variation.price_amount,
    priceCurrency: variation.price_currency,
    quantityAdjustmentCounter: variation.quantity_adjustment_counter,
    representativeCopyId: variation.representative_copy_id,
    selectorValue: variation.selector_value,
    sku: variation.sku,
    variationId: variation.variation_id,
    variationMetadata: variation.variation_metadata,
  })).sort((left, right) => left.variationId.localeCompare(right.variationId));
  const copies = aggregate.copies.map((copy) => ({
    availabilityState: copy.availability_state,
    backR2Key: copy.back_r2_key,
    conditionNotes: copy.condition_notes,
    conditionToken: copy.condition_token,
    copyId: copy.copy_id,
    frontR2Key: copy.front_r2_key,
    variationId: copy.variation_id,
  })).sort((left, right) => left.copyId.localeCompare(right.copyId));
  if (new Set(variations.map((variation) => variation.variationId)).size !== variations.length) {
    throw new Error('Variation listing pending comparison contains duplicate variation IDs.');
  }
  if (new Set(copies.map((copy) => copy.copyId)).size !== copies.length) {
    throw new Error('Variation listing pending comparison contains duplicate copy IDs.');
  }
  return {
    group: {
      categoryId: group.category_id,
      conditionDescription: group.condition_description,
      conditionDescriptors: group.condition_descriptors,
      conditionId: group.condition_id,
      conditionToken: group.condition_token,
      derivedCommonEbayAspects: group.derived_common_ebay_aspects,
      description: group.description,
      fulfillmentPolicyId: group.fulfillment_policy_id,
      groupId: group.group_id,
      groupKey: group.group_key,
      listingFormat: group.listing_format,
      marketplaceId: group.marketplace_id,
      merchantLocationKey: group.merchant_location_key,
      paymentPolicyId: group.payment_policy_id,
      returnPolicyId: group.return_policy_id,
      selectorName: group.selector_name,
      skuBucketToken: group.sku_bucket_token,
      skuCategoryCode: group.sku_category_code,
      title: group.title,
    },
    variations,
    copies,
  };
}

/** Fail closed: only exact, trusted last-confirmed evidence can prove net-zero work. */
export function hasEffectiveVariationListingPendingChanges(
  current: VariationListingAggregateSnapshot,
  confirmedRevision: VariationListingRevisionRow | null | undefined,
): boolean {
  if (current.group.last_confirmed_revision === null) return current.group.desired_revision > 0;
  if (current.group.desired_revision <= current.group.last_confirmed_revision) return false;
  if (!confirmedRevision) return true;
  try {
    if (
      confirmedRevision.group_id !== current.group.group_id ||
      confirmedRevision.captured_desired_revision !== current.group.last_confirmed_revision
    ) return true;
    const confirmed = revisionSnapshotAggregate(confirmedRevision);
    if (confirmed.group.group_id !== current.group.group_id) return true;
    if (confirmed.group.desired_revision !== confirmedRevision.captured_desired_revision) return true;
    return canonicalJson(publicationProjection(current)) !== canonicalJson(publicationProjection(confirmed));
  } catch {
    return true;
  }
}

/**
 * Per-child price/quantity display evidence from the durable confirmed snapshot.
 * null means that the baseline cannot be trusted; do not claim a staged edit.
 * New children have separate publication readiness, not an edited old price.
 */
export function pendingVariationPriceQuantityChanges(
  current: VariationListingAggregateSnapshot,
  confirmedRevision: VariationListingRevisionRow | null | undefined,
): Map<string, boolean> | null {
  if (current.group.last_confirmed_revision === null) return null;
  if (current.group.desired_revision <= current.group.last_confirmed_revision) {
    return new Map(current.variations.map((variation) => [variation.variation_id, false]));
  }
  if (
    !confirmedRevision ||
    confirmedRevision.group_id !== current.group.group_id ||
    confirmedRevision.captured_desired_revision !== current.group.last_confirmed_revision
  ) return null;

  try {
    const confirmed = revisionSnapshotAggregate(confirmedRevision);
    if (
      confirmed.group.group_id !== current.group.group_id ||
      confirmed.group.desired_revision !== confirmedRevision.captured_desired_revision
    ) return null;

    // Preserve YP10.9b's fail-closed validation of the source aggregate.
    canonicalJson(publicationProjection(confirmed));
    canonicalJson(publicationProjection(current));

    const confirmedById = new Map(confirmed.variations.map((variation) => [variation.variation_id, variation]));
    const result = new Map<string, boolean>();
    for (const variation of current.variations) {
      const prior = confirmedById.get(variation.variation_id);
      if (!prior) {
        result.set(variation.variation_id, false);
        continue;
      }
      if (prior.sku !== variation.sku || prior.group_id !== variation.group_id) return null;
      if (
        !Number.isInteger(prior.quantity_adjustment_counter) ||
        !Number.isInteger(variation.quantity_adjustment_counter)
      ) return null;
      result.set(variation.variation_id,
        variation.price_amount !== prior.price_amount ||
        variation.price_currency !== prior.price_currency ||
        variation.quantity_adjustment_counter !== prior.quantity_adjustment_counter,
      );
    }
    return result;
  } catch {
    return null;
  }
}
