import { describe, expect, it } from 'vitest';

import {
  InMemoryIncidentRepairAuthorizationAuthority,
  incidentRepairAuthorizationBinding,
  issueOfflineIncidentRepairAuthorization,
} from '@/ebay/variation-listing-incident-repair-authorization.js';

const binding = {
  runId: 'run-1', phase: 'prepare' as const, targetEnvironment: 'sandbox', authorityMode: 'offline-test' as const,
  projectRef: 'fmiliwxthjonjwywuqta', repairId: 'repair-1', revisionId: 'revision-1',
  groupId: 'group-1', groupKey: 'group-key', sellerUserId: 'seller', marketplaceId: 'EBAY_US',
  listingId: 'listing', targetVariationId: 'variation', snapshotDigest: 'a'.repeat(64), correctedPayloadDigest: 'b'.repeat(64),
  desiredRevision: 6, confirmedRevision: 5, targetSku: 'target', targetOfferId: 'target-offer', targetQuantity: 0,
  survivorSkus: ['survivor-1', 'survivor-2'], survivorOfferIds: ['offer-1', 'offer-2'], survivorQuantities: [1, 1], allowedActions: ['prepare'] as const,
};

describe('incident repair offline authorization', () => {
  it('binds all identities and consumes one phase exactly once', () => {
    const authority = new InMemoryIncidentRepairAuthorizationAuthority();
    const attestation = issueOfflineIncidentRepairAuthorization({ ...binding, issuedAt: 100, expiresAt: 200 });
    authority.consume(attestation, binding, 150);
    expect(() => authority.consume(attestation, binding, 150)).toThrow(/already been consumed/i);
  });

  it('fails closed for expiry, phase, environment, run, and digest drift', () => {
    const authority = new InMemoryIncidentRepairAuthorizationAuthority();
    const attestation = issueOfflineIncidentRepairAuthorization({ ...binding, issuedAt: 100, expiresAt: 200 });
    expect(() => authority.consume(attestation, binding, 200)).toThrow(/expired/i);
    expect(() => authority.consume(attestation, { ...binding, phase: 'one-put' }, 150)).toThrow(/binding/i);
    expect(() => authority.consume(attestation, { ...binding, correctedPayloadDigest: 'c'.repeat(64) }, 150)).toThrow(/binding/i);
    expect(() => authority.consume(attestation, { ...binding, runId: 'foreign-run' }, 150)).toThrow(/binding/i);
  });

  it('derives exact plan binding without allowing caller-selected identities', () => {
    const plan = {
      repairId: 'repair-1',
      manifest: {
        revisionId: 'revision-1', groupId: 'group-1', groupKey: 'group-key', sellerUserId: 'seller', marketplaceId: 'EBAY_US', listingId: 'listing', snapshotDigest: 'a'.repeat(64),
        desiredRevision: 6, confirmedRevision: 5, target: { sku: 'target', offerId: 'target-offer', quantity: 0 }, survivors: [{ sku: 'survivor-1', offerId: 'offer-1', quantity: 1 }, { sku: 'survivor-2', offerId: 'offer-2', quantity: 1 }],
      },
      frozen: { targetVariationId: 'variation' },
      correctedPayloadDigest: 'b'.repeat(64),
    } as never;
    expect(incidentRepairAuthorizationBinding(plan, 'run-1', 'prepare', 'fmiliwxthjonjwywuqta')).toMatchObject(binding);
  });
});
