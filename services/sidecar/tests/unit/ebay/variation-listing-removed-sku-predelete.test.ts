import { describe, expect, it } from 'vitest';
import { assessRemovedSkuPredeleteWitness } from '@/ebay/variation-listing-removed-sku-predelete.js';
import type { RemovedSkuPurgeCandidateManifest } from '@/ebay/variation-listing-removed-sku-purge-preview.js';

const candidate: RemovedSkuPurgeCandidateManifest = {
  groupId: '11111111-1111-4111-8111-111111111111',
  revisionId: '22222222-2222-4222-8222-222222222222',
  targetVariationId: '33333333-3333-4333-8333-333333333333',
  targetSku: 'BSKBL-ABC-000001',
  r2ObjectKeys: ['r2/front', 'r2/back'],
  copies: [{
    copyId: '44444444-4444-4444-8444-444444444444',
    frontR2Key: 'r2/front',
    backR2Key: 'r2/back',
    localSourceRefs: ['/incoming/front.jpg', '/incoming/back.jpg'],
  }],
  localSourceRefs: ['/incoming/front.jpg', '/incoming/back.jpg'],
  ownershipChecks: [
    { scope: 'variation-groups', status: 'unverified' },
    { scope: 'standard-single-lot', status: 'unverified' },
    { scope: 'prior-revisions', status: 'unverified' },
    { scope: 'local-files', status: 'unverified' },
    { scope: 'r2-objects', status: 'unverified' },
  ],
  deletionAuthorized: false,
  requiredChecks: ['check all resource owners'],
};

const witness = () => ({
  version: 1,
  groupId: candidate.groupId,
  revisionId: candidate.revisionId,
  targetVariationId: candidate.targetVariationId,
  targetSku: candidate.targetSku,
  confirmedRevision: 5,
  desiredRevision: 5,
  capturedDesiredRevision: 5,
  copyIds: candidate.copies.map((copy) => copy.copyId),
  r2ObjectKeys: [...candidate.r2ObjectKeys],
  sourceRefs: [...candidate.localSourceRefs],
  liveVariationReferenceCount: 0,
  standardReferenceCount: 0,
  otherGroupRevisionReferenceCount: 0,
  sameGroupHistoricalReferencesVerified: false,
  journalHistoryVerified: false,
  referenceSearchComplete: false,
  singleStatementSnapshot: true,
  deletionAuthorized: false,
});

describe('YP9.6c4 read-only pre-delete witness', () => {
  it('reports incomplete coverage and never approves deletion', () => {
    const result = assessRemovedSkuPredeleteWitness(candidate, witness());
    expect(result.referenceCountsClear).toBe(false);
    expect(result.deletionAuthorized).toBe(false);
    expect(result.blockers).toContain('Same-group historical ownership is not verified by this witness.');
    expect(result.blockers).toContain('Journal history verification is incomplete.');
    expect(result.blockers).toContain('Reference search coverage is incomplete.');
  });

  it.each(['liveVariationReferenceCount', 'standardReferenceCount', 'otherGroupRevisionReferenceCount'] as const)(
    'treats %s references as blockers', (field) => {
      const result = assessRemovedSkuPredeleteWitness(candidate, { ...witness(), [field]: 1 });
      expect(result.referenceCountsClear).toBe(false);
      expect(result.deletionAuthorized).toBe(false);
    },
  );

  it('rejects forged or empty candidates and detached copy tuples', () => {
    expect(() => assessRemovedSkuPredeleteWitness(
      { ...candidate, targetSku: ' BSKBL-ABC-000001' }, witness(),
    )).toThrow();
    expect(() => assessRemovedSkuPredeleteWitness(
      { ...candidate, copies: [] }, witness(),
    )).toThrow();
    expect(() => assessRemovedSkuPredeleteWitness(
      { ...candidate, r2ObjectKeys: ['r2/front'] }, witness(),
    )).toThrow();
    expect(() => assessRemovedSkuPredeleteWitness(
      { ...candidate, copies: [{ ...candidate.copies[0]!, frontR2Key: 'r2/other' }] }, witness(),
    )).toThrow();
    expect(() => assessRemovedSkuPredeleteWitness(
      { ...candidate, ownershipChecks: [{ scope: 'variation-groups', status: 'unverified' }] }, witness(),
    )).toThrow();
    expect(() => assessRemovedSkuPredeleteWitness(
      {
        ...candidate,
        ownershipChecks: candidate.ownershipChecks.map((check, index) =>
          index === 0 ? { ...check, scope: 'forged-scope' } : check,
        ) as RemovedSkuPurgeCandidateManifest['ownershipChecks'],
      }, witness(),
    )).toThrow();
    expect(() => assessRemovedSkuPredeleteWitness(
      { ...candidate, requiredChecks: [' '] }, witness(),
    )).toThrow();
  });

  it('rejects missing or extra witness fields, empty or duplicate arrays', () => {
    const { referenceSearchComplete: _missing, ...missing } = witness();
    expect(() => assessRemovedSkuPredeleteWitness(candidate, missing)).toThrow();
    expect(() => assessRemovedSkuPredeleteWitness(candidate, { ...witness(), extra: true })).toThrow();
    expect(() => assessRemovedSkuPredeleteWitness(candidate, { ...witness(), copyIds: [] })).toThrow();
    expect(() => assessRemovedSkuPredeleteWitness(candidate, {
      ...witness(), copyIds: [candidate.copies[0]!.copyId, candidate.copies[0]!.copyId],
    })).toThrow();
    expect(() => assessRemovedSkuPredeleteWitness(candidate, {
      ...witness(), sourceRefs: ['/incoming/front.jpg', '/incoming/front.jpg'],
    })).toThrow();
  });

  it('rejects impossible revisions and forged safety flags', () => {
    expect(() => assessRemovedSkuPredeleteWitness(candidate, { ...witness(), confirmedRevision: 0 })).toThrow();
    expect(() => assessRemovedSkuPredeleteWitness(candidate, { ...witness(), desiredRevision: 6 })).toThrow();
    expect(() => assessRemovedSkuPredeleteWitness(candidate, { ...witness(), capturedDesiredRevision: 6 })).toThrow();
    expect(() => assessRemovedSkuPredeleteWitness(candidate, { ...witness(), deletionAuthorized: true })).toThrow();
    expect(() => assessRemovedSkuPredeleteWitness(candidate, { ...witness(), sameGroupHistoricalReferencesVerified: true })).toThrow();
    expect(() => assessRemovedSkuPredeleteWitness(candidate, { ...witness(), journalHistoryVerified: true })).toThrow();
    expect(() => assessRemovedSkuPredeleteWitness(candidate, { ...witness(), referenceSearchComplete: true })).toThrow();
    expect(() => assessRemovedSkuPredeleteWitness(candidate, { ...witness(), singleStatementSnapshot: false })).toThrow();
  });

  it('detaches returned resource arrays from mutable witness input', () => {
    const raw = witness();
    const result = assessRemovedSkuPredeleteWitness(candidate, raw);
    raw.copyIds[0] = 'mutated';
    raw.r2ObjectKeys[0] = 'mutated';
    raw.sourceRefs[0] = 'mutated';
    expect(result.witness.copyIds[0]).toBe(candidate.copies[0]!.copyId);
    expect(result.witness.r2ObjectKeys[0]).toBe('r2/front');
    expect(result.witness.sourceRefs[0]).toBe('/incoming/front.jpg');
  });
});
