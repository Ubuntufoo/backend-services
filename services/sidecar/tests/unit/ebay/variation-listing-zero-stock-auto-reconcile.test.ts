import { describe, expect, it } from 'vitest';
import type { VariationListingFrozenActiveRevision } from '@/ebay/variation-listing-active-revision.js';
import { canAutoReconcileTerminalZeroOfferFailure } from '@/ebay/variation-listing-actions.js';

const missingVariationSpecificsMessage = 'Invalid data in the Inventory Item Group. Missing name in the variation specifics or variation specifics set.';
const failure = new Error(`Failed to update offer: eBay API Error: ${missingVariationSpecificsMessage}`, {
  cause: Object.assign(new Error(`eBay API Error: ${missingVariationSpecificsMessage}`), {
    ebayErrors: [{ errorId: 25013, longMessage: missingVariationSpecificsMessage }],
  }),
});

function caseFixture(): VariationListingFrozenActiveRevision {
  return {
    captureInput: { operationPlan: [
      { operationKind: 'child_inventory_item_write', targetRef: 'SKU-A', operationKey: 'child-item:A' },
      { operationKind: 'child_offer_write', targetRef: 'SKU-A', operationKey: 'child-offer:A' },
      { operationKind: 'revision_reconcile', targetRef: 'GROUP', operationKey: 'revision-reconcile' },
    ] },
    confirmedBundle: { children: [{ sku: 'SKU-A', quantity: 1 }, { sku: 'SKU-B', quantity: 2 }, { sku: 'SKU-C', quantity: 1 }] },
    desiredBundlePreview: { children: [{ sku: 'SKU-A', quantity: 0 }, { sku: 'SKU-B', quantity: 2 }, { sku: 'SKU-C', quantity: 1 }] },
    snapshot: { confirmed: { remote: { quantitiesBySku: { 'SKU-A': { inventoryItemQuantity: 1, offerQuantity: 1, sellableQuantity: 1 } } } } },
  } as unknown as VariationListingFrozenActiveRevision;
}

describe('automatic terminal-zero Offer reconciliation eligibility', () => {
  it('accepts the exact 1-to-0 eBay Offer 25013 case', () => {
    expect(canAutoReconcileTerminalZeroOfferFailure(failure, caseFixture())).toBe(true);
  });
  it('rejects unrelated failures', () => {
    expect(canAutoReconcileTerminalZeroOfferFailure(new Error('connection reset'), caseFixture())).toBe(false);
    expect(canAutoReconcileTerminalZeroOfferFailure(new Error('Failed to update offer: invalid policy'), caseFixture())).toBe(false);
    expect(canAutoReconcileTerminalZeroOfferFailure(new Error(`Failed to update offer: eBay API Error: ${missingVariationSpecificsMessage}`), caseFixture())).toBe(false);
    expect(canAutoReconcileTerminalZeroOfferFailure(new Error(`Failed to update offer: eBay API Error: ${missingVariationSpecificsMessage}`, {
      cause: Object.assign(new Error(`eBay API Error: ${missingVariationSpecificsMessage}`), {
        ebayErrors: [{ errorId: 25012, longMessage: missingVariationSpecificsMessage }],
      }),
    }), caseFixture())).toBe(false);
  });
  it('requires two sellable survivors', () => {
    const frozen = caseFixture();
    frozen.desiredBundlePreview!.children[2]!.quantity = 0;
    expect(canAutoReconcileTerminalZeroOfferFailure(failure, frozen)).toBe(false);
  });
  it('requires exact previous Inventory Item and Offer quantities', () => {
    const frozen = caseFixture();
    frozen.snapshot.confirmed.remote.quantitiesBySku!['SKU-A']!.offerQuantity = 0;
    expect(canAutoReconcileTerminalZeroOfferFailure(failure, frozen)).toBe(false);
  });
  it('requires only the frozen single-SKU zero transition', () => {
    const frozen = caseFixture();
    frozen.desiredBundlePreview!.children[0]!.quantity = 1;
    expect(canAutoReconcileTerminalZeroOfferFailure(failure, frozen)).toBe(false);
    frozen.desiredBundlePreview!.children[0]!.quantity = 0;
    frozen.captureInput.operationPlan.push({ ...frozen.captureInput.operationPlan[1]!, operationKey: 'another-offer' });
    expect(canAutoReconcileTerminalZeroOfferFailure(failure, frozen)).toBe(false);
  });
});
