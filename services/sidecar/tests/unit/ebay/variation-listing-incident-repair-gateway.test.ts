import { describe, expect, it, vi } from 'vitest';

import { createC2BRemoval01IncidentRepairGateway } from '@/ebay/variation-listing-incident-repair-gateway.js';
import { C2B_REMOVAL01_MANIFEST, incidentJsonDigest } from '@/ebay/variation-listing-incident-repair.js';
import { InMemoryIncidentRepairAuthorizationAuthority, issueOfflineIncidentRepairAuthorization } from '@/ebay/variation-listing-incident-repair-authorization.js';

const correctedGroupPayload = { inventoryItemGroupKey: C2B_REMOVAL01_MANIFEST.groupKey } as never;
const plan = {
  repairId: C2B_REMOVAL01_MANIFEST.revisionId,
  manifest: C2B_REMOVAL01_MANIFEST,
  frozen: { originalSnapshotDigest: C2B_REMOVAL01_MANIFEST.snapshotDigest, targetVariationId: 'variation' },
  correctedGroupPayload,
  correctedPayloadDigest: incidentJsonDigest(correctedGroupPayload),
} as never;

const authority = new InMemoryIncidentRepairAuthorizationAuthority();
const auth = issueOfflineIncidentRepairAuthorization({
  runId: 'run-1', phase: 'prepare', targetEnvironment: 'sandbox', authorityMode: 'offline-test', projectRef: 'fmiliwxthjonjwywuqta',
  repairId: C2B_REMOVAL01_MANIFEST.revisionId, revisionId: C2B_REMOVAL01_MANIFEST.revisionId, groupId: C2B_REMOVAL01_MANIFEST.groupId, groupKey: C2B_REMOVAL01_MANIFEST.groupKey, sellerUserId: C2B_REMOVAL01_MANIFEST.sellerUserId, marketplaceId: C2B_REMOVAL01_MANIFEST.marketplaceId, listingId: C2B_REMOVAL01_MANIFEST.listingId, targetVariationId: 'variation', snapshotDigest: C2B_REMOVAL01_MANIFEST.snapshotDigest, correctedPayloadDigest: incidentJsonDigest(correctedGroupPayload), issuedAt: 100, expiresAt: 200,
  desiredRevision: C2B_REMOVAL01_MANIFEST.desiredRevision, confirmedRevision: C2B_REMOVAL01_MANIFEST.confirmedRevision, targetSku: C2B_REMOVAL01_MANIFEST.target.sku, targetOfferId: C2B_REMOVAL01_MANIFEST.target.offerId, targetQuantity: 0,
  survivorSkus: C2B_REMOVAL01_MANIFEST.survivors.map((entry) => entry.sku), survivorOfferIds: C2B_REMOVAL01_MANIFEST.survivors.map((entry) => entry.offerId), survivorQuantities: [1, 1], allowedActions: ['prepare'],
});
describe('incident repair gateway', () => {
  it('rejects a forged plan before constructing an executable gateway', async () => {
    const prepare = vi.fn();
    const remote = { readSeller: vi.fn(), readGroup: vi.fn(), readItem: vi.fn(), readAllOffers: vi.fn(), replaceGroup: vi.fn() };
    const ledger = { load: vi.fn(async () => null), prepare, start: vi.fn(), markPost: vi.fn(), markUnknown: vi.fn(), appendTerminalC2: vi.fn() };
    expect(() => createC2BRemoval01IncidentRepairGateway({ runId: 'run-1', projectRef: 'fmiliwxthjonjwywuqta', plan, authority, remote, ledger })).toThrow(/exact corrected payload projection/i);
    expect(prepare).not.toHaveBeenCalled();
    expect(remote.replaceGroup).not.toHaveBeenCalled();
  });
});
