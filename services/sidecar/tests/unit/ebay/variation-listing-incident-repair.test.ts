import { describe, expect, it, vi } from 'vitest';
import type { Json, VariationListingRevisionRow } from '@ebay-inventory/data';

import {
  buildC2BRemoval01Plan,
  classifyC2BRemoval01,
  C2B_REMOVAL01_MANIFEST,
  executeC2BRemoval01Repair,
  incidentJsonDigest,
  inspectC2BRemoval01,
  type IncidentFrozenEvidence,
  type IncidentOfferRead,
  type IncidentRemoteGateway,
  type IncidentRepairLedger,
  type IncidentRepairPlan,
  type IncidentRepairRecord,
} from '@/ebay/variation-listing-incident-repair.js';
import { IncidentRepairCasConflictError, createC2BRemoval01IncidentRepairGateway } from '@/ebay/variation-listing-incident-repair-gateway.js';
import { InMemoryIncidentRepairAuthorizationAuthority, incidentRepairAuthorizationBinding, issueOfflineIncidentRepairAuthorization } from '@/ebay/variation-listing-incident-repair-authorization.js';
import { buildC2BRemoval01PlanFromRevision } from '@/ebay/variation-listing-incident-repair-store.js';

const manifestSkus = [C2B_REMOVAL01_MANIFEST.target.sku, ...C2B_REMOVAL01_MANIFEST.survivors.map((s) => s.sku)];
const selectorBySku = Object.fromEntries(manifestSkus.map((sku, index) => [sku, `Card ${String.fromCharCode(65 + index)}`]));

function groupPayload(skus = manifestSkus, values = skus.map((sku) => selectorBySku[sku]!)): Json {
  return {
    inventoryItemGroupKey: C2B_REMOVAL01_MANIFEST.groupKey,
    title: 'C2BRemoval01 cards',
    description: 'Incident fixture',
    aspects: { Sport: ['Basketball'] },
    variantSKUs: [...skus],
    variesBy: { aspectsImageVariesBy: ['Card'], specifications: [{ name: 'Card', values: [...values] }] },
  };
}

function itemPayload(sku: string, quantity: number): Json {
  return {
    availability: { shipToLocationAvailability: { quantity } },
    condition: 'USED', conditionDescriptors: [],
    product: { aspects: { Card: [selectorBySku[sku]!] }, imageUrls: [`https://i.sandbox.ebayimg.com/${sku}-front.jpg`, `https://i.sandbox.ebayimg.com/${sku}-back.jpg`] },
  };
}

function offerPayload(sku: string, quantity: number): Json {
  return {
    availableQuantity: quantity, categoryId: '261328', format: 'FIXED_PRICE',
    listingPolicies: { fulfillmentPolicyId: 'fulfill', paymentPolicyId: 'pay', returnPolicyId: 'returns' },
    marketplaceId: 'EBAY_US', merchantLocationKey: 'main', pricingSummary: { price: { currency: 'USD', value: '1.49' } }, sku,
  };
}

function frozen(groupSkus = manifestSkus, groupValues = groupSkus.map((sku) => selectorBySku[sku]!)): IncidentFrozenEvidence {
  return {
    originalSnapshotDigest: C2B_REMOVAL01_MANIFEST.snapshotDigest,
    targetVariationId: '00000000-0000-4000-8000-000000000001',
    groupPayload: groupPayload(groupSkus, groupValues),
    selectorBySku,
    itemPayloadWithoutQuantityBySku: Object.fromEntries(manifestSkus.map((sku) => {
      const payload = itemPayload(sku, 1) as Record<string, Json>;
      const availability = payload.availability as Record<string, Json>;
      const ship = (availability.shipToLocationAvailability as Record<string, Json>);
      delete ship.quantity;
      return [sku, payload];
    })),
    offerPayloadWithoutQuantityBySku: Object.fromEntries(manifestSkus.map((sku) => {
      const payload = offerPayload(sku, 1) as Record<string, Json>;
      delete payload.availableQuantity;
      return [sku, payload];
    })),
  };
}

class RemoteFixture implements IncidentRemoteGateway {
  post = false;
  failPut = false;
  driftAfterPut = false;
  extraGroupField = false;
  offersComplete = true;
  itemPayloadQuantityDrift = false;
  offerPayloadQuantityDrift = false;
  putCalls = 0;
  sellerUserId = C2B_REMOVAL01_MANIFEST.sellerUserId;
  groupSkus = [...manifestSkus];
  groupValues = [...manifestSkus].map((sku) => selectorBySku[sku]!);
  offers: Record<string, IncidentOfferRead> = Object.fromEntries(manifestSkus.map((sku, index) => {
    const entry = sku === C2B_REMOVAL01_MANIFEST.target.sku ? C2B_REMOVAL01_MANIFEST.target : C2B_REMOVAL01_MANIFEST.survivors.find((s) => s.sku === sku)!;
    return [sku, { offerId: entry.offerId, sku, marketplaceId: 'EBAY_US', status: 'PUBLISHED', listingId: C2B_REMOVAL01_MANIFEST.listingId, listingStatus: sku === C2B_REMOVAL01_MANIFEST.target.sku ? 'OUT_OF_STOCK' : 'ACTIVE', availableQuantity: entry.quantity, payload: offerPayload(sku, entry.quantity) }];
  }));
  async readSeller() { return { userId: this.sellerUserId }; }
  async readGroup() {
    const payload = { ...(groupPayload(this.groupSkus) as Record<string, Json>), variesBy: { aspectsImageVariesBy: ['Card'], specifications: [{ name: 'Card', values: [...this.groupValues] }] } };
    if (this.extraGroupField) payload.unexpectedMetadata = 'reject';
    return { variantSKUs: [...this.groupSkus], payload };
  }
  async readItem(sku: string) {
    const target = sku === C2B_REMOVAL01_MANIFEST.target.sku;
    const q = target ? 0 : 1;
    const payload = itemPayload(sku, q);
    if (this.itemPayloadQuantityDrift) {
      const availability = (payload as Record<string, Json>).availability as Record<string, Json>;
      const ship = availability.shipToLocationAvailability as Record<string, Json>;
      ship.quantity = q + 1;
    }
    return { sku, groupKeys: target && this.post ? [] : [C2B_REMOVAL01_MANIFEST.groupKey], payload, quantity: q };
  }
  async readAllOffers(sku: string) {
    const offer = this.offers[sku]!;
    if (!this.offerPayloadQuantityDrift) return { complete: this.offersComplete, offers: [offer] };
    const payload = { ...(offer.payload as Record<string, Json>), availableQuantity: offer.availableQuantity + 1 };
    return { complete: this.offersComplete, offers: [{ ...offer, payload }] };
  }
  async replaceGroup() {
    this.putCalls += 1;
    if (this.failPut) throw new Error('response lost');
    this.post = true;
    this.groupSkus = C2B_REMOVAL01_MANIFEST.survivors.map((s) => s.sku);
    this.groupValues = this.groupSkus.map((sku) => selectorBySku[sku]!);
    const target = this.offers[C2B_REMOVAL01_MANIFEST.target.sku]!;
    target.status = 'UNPUBLISHED'; target.listingId = null; target.listingStatus = 'NOT_LISTED';
    if (this.driftAfterPut) this.groupValues[0] = 'Drifted Card';
  }
}

function ledgerFixture(options: { startConflict?: boolean } = {}): { ledger: IncidentRepairLedger; record: () => IncidentRepairRecord | null; terminalCalls: number[] } {
  let current: IncidentRepairRecord | null = null;
  const terminalCalls = [0];
  return {
    terminalCalls,
    record: () => current,
    ledger: {
      load: async () => current,
      prepare: async (plan) => current = { repairId: plan.repairId, revisionId: plan.repairId, state: 'planned', correctedPayloadDigest: plan.correctedPayloadDigest },
      start: async (id) => {
        if (options.startConflict) {
          current = { ...current!, repairId: id, revisionId: id, state: 'started' };
          throw new IncidentRepairCasConflictError();
        }
        if (current?.state !== 'planned') throw new IncidentRepairCasConflictError();
        return current = { ...current!, repairId: id, revisionId: id, state: 'started' };
      },
      markPost: async (_id, state, evidence) => current = { ...current!, state, evidence },
      markUnknown: async (_id, evidence) => current = { ...current!, state: 'unknown', evidence },
      appendTerminalC2: async () => { terminalCalls[0] += 1; },
    },
  };
}

function plan(evidence = frozen()): IncidentRepairPlan { return buildC2BRemoval01Plan(evidence); }

function offlineAuthorization(p: IncidentRepairPlan, phase: 'prepare' | 'one-put' | 'resolve-post', authority: InMemoryIncidentRepairAuthorizationAuthority) {
  return issueOfflineIncidentRepairAuthorization({
    ...incidentRepairAuthorizationBinding(p, 'run-c2b-removal01-test', phase, 'fmiliwxthjonjwywuqta'),
    issuedAt: 1_000,
    expiresAt: 2_000,
  });
}

function incidentSnapshotWithRealMetadata(): Json {
  const target = C2B_REMOVAL01_MANIFEST.target.sku;
  const [survivorB, survivorC] = C2B_REMOVAL01_MANIFEST.survivors.map((survivor) => survivor.sku);
  const targetVariationId = '00000000-0000-4000-8000-000000000001';
  const variation = (sku: string, position: number, variationId: string, selector: string): Json => ({
    variation_id: variationId,
    sku,
    position,
    selector_value: selector,
  });
  const confirmedVariations = [
    variation(survivorB, 1, '00000000-0000-4000-8000-000000000002', 'Card B'),
    variation(survivorC, 2, '00000000-0000-4000-8000-000000000003', 'Card C'),
    variation(target, 3, targetVariationId, 'Card A'),
  ];
  const metadata: Json = {
    version: 1,
    groupKey: C2B_REMOVAL01_MANIFEST.groupKey,
    targetVariationId,
    targetSku: target,
    marketplaceId: C2B_REMOVAL01_MANIFEST.marketplaceId,
    survivorSkus: [survivorB, survivorC],
    listingId: C2B_REMOVAL01_MANIFEST.listingId,
    offerIdsBySku: {
      [target]: C2B_REMOVAL01_MANIFEST.target.offerId,
      [survivorB]: C2B_REMOVAL01_MANIFEST.survivors[0]!.offerId,
      [survivorC]: C2B_REMOVAL01_MANIFEST.survivors[1]!.offerId,
    },
    quantitiesBySku: {
      [target]: { inventoryItemQuantity: 0, offerQuantity: 0, sellableQuantity: 0 },
      [survivorB]: { inventoryItemQuantity: 1, offerQuantity: 1, sellableQuantity: 1 },
      [survivorC]: { inventoryItemQuantity: 1, offerQuantity: 1, sellableQuantity: 1 },
    },
    inventoryItemPayloadsBySku: Object.fromEntries(manifestSkus.map((sku) => {
      const payload = itemPayload(sku, sku === target ? 0 : 1) as Record<string, Json>;
      const availability = payload.availability as Record<string, Json>;
      const ship = availability.shipToLocationAvailability as Record<string, Json>;
      delete ship.quantity;
      return [sku, payload];
    })),
    offerPayloadsBySku: Object.fromEntries(manifestSkus.map((sku) => {
      const payload = offerPayload(sku, sku === target ? 0 : 1) as Record<string, Json>;
      delete payload.availableQuantity;
      return [sku, payload];
    })),
    // Canonical held revision semantics: the historical expected payload has
    // B,C,A SKU order but Card values in application A,B,C order.
    expectedGroupPayload: groupPayload([survivorB, survivorC, target], ['Card A', 'Card B', 'Card C']),
    // Historical malformed replacement: two SKUs but three selectors. The
    // adapter must never use or hydrate this value.
    replacementGroupPayload: groupPayload([survivorB, survivorC], ['Card B', 'Card C', 'Card A']),
  };
  const confirmedGroup = {
    group_id: C2B_REMOVAL01_MANIFEST.groupId,
    group_key: C2B_REMOVAL01_MANIFEST.groupKey,
    marketplace_id: C2B_REMOVAL01_MANIFEST.marketplaceId,
  } as Json;
  return {
    aggregate: { group: confirmedGroup, variations: confirmedVariations, copies: [] },
    confirmed: { aggregate: { group: confirmedGroup, variations: confirmedVariations, copies: [] }, remote: {}, revisionId: C2B_REMOVAL01_MANIFEST.revisionId },
    permanentRemoval: metadata,
  };
}

function incidentRevisionFixture(): VariationListingRevisionRow {
  const snapshot = incidentSnapshotWithRealMetadata();
  const intent = { groupKey: C2B_REMOVAL01_MANIFEST.groupKey, targetSku: C2B_REMOVAL01_MANIFEST.target.sku, survivorSkus: C2B_REMOVAL01_MANIFEST.survivors.map((survivor) => survivor.sku) } as Json;
  return {
    revision_id: C2B_REMOVAL01_MANIFEST.revisionId,
    group_id: C2B_REMOVAL01_MANIFEST.groupId,
    captured_desired_revision: C2B_REMOVAL01_MANIFEST.desiredRevision,
    snapshot_version: 3,
    snapshot_digest: incidentJsonDigest(snapshot),
    snapshot,
    operation_count: 1,
    operation_plan: [{ sequence_no: 1, operation_key: 'remove-group-membership', operation_kind: 'permanent_removal_group_membership', target_ref: C2B_REMOVAL01_MANIFEST.groupKey, intent_version: 1, intent_digest: incidentJsonDigest(intent), intent }],
    captured_at: '2026-01-01T00:00:00.000Z',
  } as VariationListingRevisionRow;
}

function sellerVerifiedBcaGroup(): { sellerUserId: string; groupKey: string; variantSKUs: string[]; payload: Json } {
  const skus = [C2B_REMOVAL01_MANIFEST.survivors[0]!.sku, C2B_REMOVAL01_MANIFEST.survivors[1]!.sku, C2B_REMOVAL01_MANIFEST.target.sku];
  return {
    sellerUserId: C2B_REMOVAL01_MANIFEST.sellerUserId,
    groupKey: C2B_REMOVAL01_MANIFEST.groupKey,
    variantSKUs: skus,
    payload: groupPayload(skus, ['Card A', 'Card B', 'Card C']),
  };
}

it('hydrates a realistic B,C,A immutable revision and derives corrected B,C payload without the malformed replacement', () => {
  const revision = incidentRevisionFixture();
  const manifest = C2B_REMOVAL01_MANIFEST as unknown as { snapshotDigest: string };
  const priorDigest = manifest.snapshotDigest;
  manifest.snapshotDigest = revision.snapshot_digest;
  try {
    const plan = buildC2BRemoval01PlanFromRevision(revision, sellerVerifiedBcaGroup());
    const corrected = plan.correctedGroupPayload as Record<string, Json>;
    expect(corrected.variantSKUs).toEqual([C2B_REMOVAL01_MANIFEST.survivors[0]!.sku, C2B_REMOVAL01_MANIFEST.survivors[1]!.sku]);
    expect((corrected.variesBy as Record<string, Json>).specifications).toEqual([{ name: 'Card', values: ['Card B', 'Card C'] }]);
    expect(plan.frozen.selectorBySku[C2B_REMOVAL01_MANIFEST.target.sku]).toBe('Card A');
    expect(() => buildC2BRemoval01PlanFromRevision(revision, {
      ...sellerVerifiedBcaGroup(),
      payload: ((revision.snapshot as Record<string, Json>).permanentRemoval as Record<string, Json>).replacementGroupPayload!,
    })).toThrow(/group|selector|shape/i);
    expect(() => buildC2BRemoval01PlanFromRevision(revision, {
      ...sellerVerifiedBcaGroup(),
      groupKey: 'VL-G-foreign',
    })).toThrow(/seller|group/i);
    const drifted = sellerVerifiedBcaGroup();
    (drifted.payload as Record<string, Json>).title = 'Changed provider title';
    expect(() => buildC2BRemoval01PlanFromRevision(revision, drifted)).toThrow(/common fields|SQL projection/i);
  } finally {
    manifest.snapshotDigest = priorDigest;
  }
});

describe('C2BRemoval01 offline incident repair', () => {
  it('projects B,C selectors from an authoritative A,B,C frozen group', () => {
    const value = plan(frozen(manifestSkus));
    expect(value.repairId).toBe(C2B_REMOVAL01_MANIFEST.revisionId);
    expect((value.correctedGroupPayload as Record<string, Json>).variantSKUs).toEqual(C2B_REMOVAL01_MANIFEST.survivors.map((s) => s.sku));
    expect(((value.correctedGroupPayload as Record<string, Json>).variesBy as Record<string, Json>).specifications).toEqual([{ name: 'Card', values: ['Card B', 'Card C'] }]);
  });

  it('projects B,C selectors from the observed B,C,A frozen group without using remote order', () => {
    const bca = [manifestSkus[1]!, manifestSkus[2]!, manifestSkus[0]!];
    const value = plan(frozen(bca));
    expect((value.correctedGroupPayload as Record<string, Json>).variantSKUs).toEqual([manifestSkus[1], manifestSkus[2]]);
    expect(((value.correctedGroupPayload as Record<string, Json>).variesBy as Record<string, Json>).specifications).toEqual([{ name: 'Card', values: ['Card B', 'Card C'] }]);
  });

  it('accepts independent B,C,A SKU and A,B,C group Card order with exact immutable Item ownership', () => {
    const bca = [manifestSkus[1]!, manifestSkus[2]!, manifestSkus[0]!];
    const value = plan(frozen(bca, ['Card A', 'Card B', 'Card C']));
    expect(((value.correctedGroupPayload as Record<string, Json>).variesBy as Record<string, Json>).specifications)
      .toEqual([{ name: 'Card', values: ['Card B', 'Card C'] }]);
    const independentlyReordered = plan(frozen(bca, ['Card C', 'Card A', 'Card B']));
    expect(((independentlyReordered.correctedGroupPayload as Record<string, Json>).variesBy as Record<string, Json>).specifications)
      .toEqual([{ name: 'Card', values: ['Card B', 'Card C'] }]);
  });

  it('rejects duplicate selectors, duplicate or foreign SKUs, and missing selectors', () => {
    expect(() => plan(frozen(manifestSkus, ['Card A', 'Card B', 'Card B']))).toThrow(/unique/i);
    expect(() => plan(frozen(manifestSkus, ['x'.repeat(66), 'Card B', 'Card C']))).toThrow();
    expect(() => plan(frozen([manifestSkus[0]!, manifestSkus[1]!, manifestSkus[1]!]))).toThrow(/unique|membership/i);
    expect(() => plan(frozen([manifestSkus[0]!, manifestSkus[1]!, 'BSKBL-C2BRemoval01-foreign'], ['Card A', 'Card B', 'Card X']))).toThrow(/membership/i);
    expect(() => plan(frozen(manifestSkus, ['Card A', 'Card B', '']))).toThrow(/malformed|shape/i);
  });

  it('rejects shuffled selectors without aligned SKUs, impossible positional mapping, and group images', () => {
    const bca = [manifestSkus[1]!, manifestSkus[2]!, manifestSkus[0]!];
    expect(() => plan(frozen(bca, ['Card C', 'Card B', 'Card foreign']))).toThrow(/values|selectors/i);
    const invalidItem = frozen(bca, ['Card A', 'Card B', 'Card C']);
    const wrong = structuredClone(invalidItem.itemPayloadWithoutQuantityBySku) as Record<string, Json>;
    const item = wrong[manifestSkus[1]!] as Record<string, Json>;
    ((item.product as Record<string, Json>).aspects as Record<string, Json>).Card = ['Card A'];
    expect(() => plan({ ...invalidItem, itemPayloadWithoutQuantityBySku: wrong })).toThrow(/Item Card aspect/i);
    expect(() => buildC2BRemoval01Plan({ ...frozen(), originalSnapshotDigest: '0'.repeat(64) })).toThrow(/snapshot digest/i);
    expect(() => buildC2BRemoval01Plan({ ...frozen(), selectorBySku: { ...selectorBySku, [manifestSkus[1]!]: 'Card C', [manifestSkus[2]!]: 'Card B' } })).toThrow(/Item Card|mapping/i);
    expect(() => buildC2BRemoval01Plan({ ...frozen(), groupPayload: { ...(groupPayload() as Record<string, Json>), imageUrls: ['https://i.sandbox.ebayimg.com/foreign.jpg'] } })).toThrow(/image/i);
    expect(() => buildC2BRemoval01Plan({ ...frozen(), groupPayload: { ...(groupPayload() as Record<string, Json>), variesBy: { aspectsImageVariesBy: ['Card'], specifications: [{ name: 'Card', values: ['Card A', 'Card B'] }] } } })).toThrow(/selector shape/i);
  });

  it('classifies order-independent exact pre and corrected post without live writes', async () => {
    const remote = new RemoteFixture();
    remote.groupSkus = [manifestSkus[1]!, manifestSkus[2]!, manifestSkus[0]!];
    remote.groupValues = manifestSkus.map((sku) => selectorBySku[sku]!);
    const value = await classifyC2BRemoval01(remote, plan());
    expect(value.state).toBe('EXACT_PRE');
    remote.groupValues = ['Card A', 'Card B', 'Card foreign'];
    expect((await classifyC2BRemoval01(remote, plan())).state).toBe('MIXED');
    remote.groupValues = manifestSkus.map((sku) => selectorBySku[sku]!);
    await remote.replaceGroup(C2B_REMOVAL01_MANIFEST.groupKey, plan().correctedGroupPayload);
    expect((await classifyC2BRemoval01(remote, plan())).state).toBe('EXACT_CORRECTED_POST');
  });

  it('keeps the compatibility executor strictly read-only and leaves an absent row absent', async () => {
    const remote = new RemoteFixture(); const fixture = ledgerFixture(); const p = plan();
    await expect(executeC2BRemoval01Repair({ plan: p, remote, ledger: fixture.ledger })).resolves.toMatchObject({ remoteState: 'EXACT_PRE', putCount: 0, repairState: 'absent' });
    expect(fixture.record()).toBeNull();
    expect(remote.putCalls).toBe(0);
  });

  it('keeps ambiguous recovery GET-only until an explicitly authorized gateway call', async () => {
    const remote = new RemoteFixture(); const fixture = ledgerFixture(); const p = plan();
    const first = await executeC2BRemoval01Repair({ plan: p, remote, ledger: fixture.ledger });
    expect(first).toMatchObject({ remoteState: 'EXACT_PRE', repairState: 'absent', putCount: 0 });
    expect(remote.putCalls).toBe(0);
  });

  it('fails closed for seller, quantity, offer coverage, and post drift', async () => {
    const p = plan(); const remote = new RemoteFixture(); remote.sellerUserId = 'different-seller';
    expect((await classifyC2BRemoval01(remote, p)).state).toBe('MIXED');
    remote.sellerUserId = C2B_REMOVAL01_MANIFEST.sellerUserId;
    remote.offers[C2B_REMOVAL01_MANIFEST.survivors[0]!.sku]!.availableQuantity = 0;
    expect((await classifyC2BRemoval01(remote, p)).state).toBe('MIXED');
    remote.offers[C2B_REMOVAL01_MANIFEST.survivors[0]!.sku]!.availableQuantity = 1;
    remote.offerPayloadQuantityDrift = true;
    expect((await classifyC2BRemoval01(remote, p)).state).toBe('MIXED');
    remote.offerPayloadQuantityDrift = false;
    remote.itemPayloadQuantityDrift = true;
    expect((await classifyC2BRemoval01(remote, p)).state).toBe('MIXED');
    remote.itemPayloadQuantityDrift = false;
    remote.extraGroupField = true;
    expect((await classifyC2BRemoval01(remote, p)).state).toBe('MIXED');
    remote.extraGroupField = false;
    remote.offersComplete = false;
    expect((await classifyC2BRemoval01(remote, p)).state).toBe('UNKNOWN');
    remote.offersComplete = true;
    remote.driftAfterPut = true; const fixture = ledgerFixture();
    const result = await executeC2BRemoval01Repair({ plan: p, remote, ledger: fixture.ledger });
    expect(result.repairState).toBe('absent'); expect(remote.putCalls).toBe(0);
  });

  it('does not issue a second PUT after a concurrent start winner or repeated call', async () => {
    const remote = new RemoteFixture(); const p = plan(); const fixture = ledgerFixture({ startConflict: true });
    const result = await executeC2BRemoval01Repair({ plan: p, remote, ledger: fixture.ledger });
    expect(result.putCount).toBe(0); expect(remote.putCalls).toBe(0); expect(fixture.record()).toBeNull();
  });

  it('treats a restart after durable start but before the outbound call as GET-only', async () => {
    const remote = new RemoteFixture(); const p = plan(); const fixture = ledgerFixture();
    await fixture.ledger.prepare(p);
    await fixture.ledger.start(p.manifest.revisionId);
    const result = await executeC2BRemoval01Repair({ plan: p, remote, ledger: fixture.ledger });
    expect(result).toMatchObject({ remoteState: 'EXACT_PRE', repairState: 'started', putCount: 0 });
    expect(remote.putCalls).toBe(0);
  });

  it('returns UNKNOWN on failed evidence reads and never exposes mutation/deletion seams', async () => {
    const p = plan(); const remote = new RemoteFixture(); remote.readSeller = vi.fn(async () => { throw new Error('network'); }); const fixture = ledgerFixture();
    expect(await executeC2BRemoval01Repair({ plan: p, remote, ledger: fixture.ledger })).toMatchObject({ remoteState: 'UNKNOWN', repairState: 'absent' });
    expect(remote.putCalls).toBe(0);
    expect(incidentJsonDigest(p.correctedGroupPayload)).toBe(p.correctedPayloadDigest);
  });

  it('requires separate prepare, one-put, and resolve-post attestations', async () => {
    const p = plan(); const remote = new RemoteFixture(); const fixture = ledgerFixture();
    const order: string[] = [];
    const originalStart = fixture.ledger.start;
    fixture.ledger.start = async (revisionId) => { order.push('start'); return originalStart(revisionId); };
    const originalReplace = remote.replaceGroup.bind(remote);
    remote.replaceGroup = async (groupKey, payload) => { order.push('put'); return originalReplace(groupKey, payload); };
    const authority = new InMemoryIncidentRepairAuthorizationAuthority();
    const gateway = createC2BRemoval01IncidentRepairGateway({
      enabled: true, runId: 'run-c2b-removal01-test', projectRef: 'fmiliwxthjonjwywuqta', plan: p,
      authority, remote, ledger: fixture.ledger, now: () => 1_001,
    });
    await expect(gateway.inspect()).resolves.toMatchObject({ repairState: 'absent', putCount: 0 });
    await expect(gateway.prepare(offlineAuthorization(p, 'prepare', authority))).resolves.toMatchObject({ state: 'planned' });
    const put = await gateway.executeOnePut(offlineAuthorization(p, 'one-put', authority));
    expect(put).toMatchObject({ remoteState: 'EXACT_CORRECTED_POST', repairState: 'started', putCount: 1, c2TerminalAppended: false });
    expect(remote.putCalls).toBe(1);
    expect(order).toEqual(['start', 'put']);
    const resolved = await gateway.resolvePost(offlineAuthorization(p, 'resolve-post', authority));
    expect(resolved).toMatchObject({ remoteState: 'EXACT_CORRECTED_POST', repairState: 'confirmed_post', putCount: 0, c2TerminalAppended: true });
    expect(fixture.terminalCalls[0]).toBe(1);
  });

  it('marks a lost PUT unknown and never retries it, even with a fresh one-put attestation', async () => {
    const p = plan(); const remote = new RemoteFixture(); remote.failPut = true; const fixture = ledgerFixture();
    const authority = new InMemoryIncidentRepairAuthorizationAuthority();
    const gateway = createC2BRemoval01IncidentRepairGateway({
      enabled: true, runId: 'run-c2b-removal01-test', projectRef: 'fmiliwxthjonjwywuqta', plan: p,
      authority, remote, ledger: fixture.ledger, now: () => 1_001,
    });
    await gateway.prepare(offlineAuthorization(p, 'prepare', authority));
    await expect(gateway.executeOnePut(offlineAuthorization(p, 'one-put', authority))).resolves.toMatchObject({ remoteState: 'UNKNOWN', repairState: 'unknown', putCount: 1 });
    remote.failPut = false;
    await expect(gateway.executeOnePut(offlineAuthorization(p, 'one-put', authority))).resolves.toMatchObject({ putCount: 0, repairState: 'unknown' });
    expect(remote.putCalls).toBe(1);
  });

  it('reloads after a typed start CAS loss and propagates non-CAS start failures', async () => {
    const p = plan(); const authority = new InMemoryIncidentRepairAuthorizationAuthority();
    const casRemote = new RemoteFixture(); const casFixture = ledgerFixture({ startConflict: true });
    const casGateway = createC2BRemoval01IncidentRepairGateway({ enabled: true, runId: 'run-c2b-removal01-test', projectRef: 'fmiliwxthjonjwywuqta', plan: p, authority, remote: casRemote, ledger: casFixture.ledger, now: () => 1_001 });
    await casGateway.prepare(offlineAuthorization(p, 'prepare', authority));
    await expect(casGateway.executeOnePut(offlineAuthorization(p, 'one-put', authority))).resolves.toMatchObject({ putCount: 0, repairState: 'started' });
    expect(casRemote.putCalls).toBe(0);

    const failingRemote = new RemoteFixture(); const prepared = ledgerFixture();
    await prepared.ledger.prepare(p);
    const failingLedger: IncidentRepairLedger = { ...prepared.ledger, start: async () => { throw new Error('database unavailable'); } };
    const failingGateway = createC2BRemoval01IncidentRepairGateway({ enabled: true, runId: 'run-c2b-removal01-test', projectRef: 'fmiliwxthjonjwywuqta', plan: p, authority: new InMemoryIncidentRepairAuthorizationAuthority(), remote: failingRemote, ledger: failingLedger, now: () => 1_001 });
    await expect(failingGateway.executeOnePut(offlineAuthorization(p, 'one-put', authority))).rejects.toThrow(/database unavailable/i);
    expect(failingRemote.putCalls).toBe(0);
  });

  it('rejects disabled, expired, foreign, and replayed attestations before any mutation', async () => {
    const p = plan(); const remote = new RemoteFixture(); const fixture = ledgerFixture();
    const authority = new InMemoryIncidentRepairAuthorizationAuthority();
    const gateway = createC2BRemoval01IncidentRepairGateway({
      runId: 'run-c2b-removal01-test', projectRef: 'fmiliwxthjonjwywuqta', plan: p, authority, remote, ledger: fixture.ledger, now: () => 1_001,
    });
    await expect(gateway.prepare(offlineAuthorization(p, 'prepare', authority))).rejects.toThrow(/disabled/i);
    const expired = issueOfflineIncidentRepairAuthorization({ ...incidentRepairAuthorizationBinding(p, 'run-c2b-removal01-test', 'prepare', 'fmiliwxthjonjwywuqta'), issuedAt: 1_000, expiresAt: 1_001 });
    const enabled = createC2BRemoval01IncidentRepairGateway({
      enabled: true, runId: 'run-c2b-removal01-test', projectRef: 'fmiliwxthjonjwywuqta', plan: p, authority, remote, ledger: fixture.ledger, now: () => 1_001,
    });
    await expect(enabled.prepare(expired)).rejects.toThrow(/expired/i);
    const foreign = issueOfflineIncidentRepairAuthorization({ ...incidentRepairAuthorizationBinding(p, 'other-run', 'prepare', 'fmiliwxthjonjwywuqta'), issuedAt: 1_000, expiresAt: 2_000 });
    await expect(enabled.prepare(foreign)).rejects.toThrow(/binding/i);
    const valid = offlineAuthorization(p, 'prepare', authority);
    await enabled.prepare(valid);
    await expect(enabled.prepare(valid)).rejects.toThrow(/already been consumed/i);
    expect(remote.putCalls).toBe(0);
  });

  it('keeps gateway inspection read-only across every persisted/missing ledger and remote state', async () => {
    const remoteStates = ['EXACT_PRE', 'EXACT_CORRECTED_POST', 'MIXED', 'UNKNOWN'] as const;
    const ledgerStates = [null, 'planned', 'started', 'unknown', 'confirmed_post', 'reconciled_post'] as const;
    for (const remoteState of remoteStates) {
      for (const ledgerState of ledgerStates) {
        const p = plan(); const remote = new RemoteFixture();
        if (remoteState === 'EXACT_CORRECTED_POST') {
          await remote.replaceGroup(C2B_REMOVAL01_MANIFEST.groupKey, p.correctedGroupPayload);
          remote.putCalls = 0;
        } else if (remoteState === 'MIXED') {
          remote.groupValues = ['Card A', 'Card B', 'foreign'];
        } else if (remoteState === 'UNKNOWN') {
          remote.offersComplete = false;
        }
        const record = ledgerState === null ? null : { repairId: p.repairId, revisionId: p.repairId, state: ledgerState, correctedPayloadDigest: p.correctedPayloadDigest };
        const load = vi.fn(async () => record);
        const prepare = vi.fn(async () => { throw new Error('inspection attempted prepare'); });
        const start = vi.fn(async () => { throw new Error('inspection attempted start'); });
        const markUnknown = vi.fn(async () => { throw new Error('inspection attempted markUnknown'); });
        const markPost = vi.fn(async () => { throw new Error('inspection attempted markPost'); });
        const appendTerminalC2 = vi.fn(async () => { throw new Error('inspection attempted append'); });
        const readSeller = vi.spyOn(remote, 'readSeller');
        const replaceGroup = vi.spyOn(remote, 'replaceGroup');
        const gateway = createC2BRemoval01IncidentRepairGateway({
          runId: 'run-c2b-removal01-test', projectRef: 'fmiliwxthjonjwywuqta', plan: p,
          authority: new InMemoryIncidentRepairAuthorizationAuthority(), remote,
          ledger: { load, prepare, start, markUnknown, markPost, appendTerminalC2 },
        });
        await gateway.inspect();
        expect(load).toHaveBeenCalledTimes(1);
        expect(readSeller).toHaveBeenCalled();
        expect(prepare).not.toHaveBeenCalled(); expect(start).not.toHaveBeenCalled();
        expect(markUnknown).not.toHaveBeenCalled(); expect(markPost).not.toHaveBeenCalled();
        expect(appendTerminalC2).not.toHaveBeenCalled(); expect(replaceGroup).not.toHaveBeenCalled();
      }
    }
  });
});

