import {createHash} from 'node:crypto';
import {describe, expect, it} from 'vitest';

import {verifyRemovedSkuR2Content, type RemovedSkuR2ContentObservation} from '@/ebay/variation-listing-removed-sku-r2-content-proof.js';
import type {RemovedSkuPurgeCandidateManifest} from '@/ebay/variation-listing-removed-sku-purge-preview.js';

const groupId = '11111111-1111-4111-8111-111111111111';
const revisionId = '22222222-2222-4222-8222-222222222222';
const variationId = '33333333-3333-4333-8333-333333333333';
const copyId = '44444444-4444-4444-8444-444444444444';
const copyId2 = '55555555-5555-4555-8555-555555555555';
const strongEtag = '"0123456789abcdef0123456789abcdef"';

function fixture() {
  const items = (['front', 'back'] as const).map(role => {
    const body = Buffer.from(`synthetic ${role} image bytes`);
    const digest = createHash('sha256').update(body).digest('hex').slice(0, 12);
    const objectKey = `variation-listing/${groupId}/${variationId}/${copyId}/${role}-${digest}.jpg`;
    return {objectKey, body, status: 'present' as const,
      headEtag: strongEtag, getEtag: strongEtag, contentLength: body.byteLength};
  });
  const candidate: RemovedSkuPurgeCandidateManifest = {
    groupId, revisionId, targetVariationId: variationId, targetSku: 'BSKBL-Remove-000002',
    copies: [{
      copyId, frontR2Key: items[0]!.objectKey,
      backR2Key: items[1]!.objectKey,
      localSourceRefs: ['/synthetic/front.jpg', '/synthetic/back.jpg'],
    }],
    r2ObjectKeys: items.map(item => item.objectKey),
    localSourceRefs: ['/synthetic/front.jpg', '/synthetic/back.jpg'],
    ownershipChecks: [
      {scope: 'variation-groups', status: 'unverified'},
      {scope: 'standard-single-lot', status: 'unverified'},
      {scope: 'prior-revisions', status: 'unverified'},
      {scope: 'local-files', status: 'unverified'},
      {scope: 'r2-objects', status: 'unverified'},
    ],
    requiredChecks: ['independent ownership and deletion-time safety'],
    deletionAuthorized: false,
  };
  return {candidate, items};
}

describe('EXEC3 R2 frozen content integrity, non-authorizing', () => {
  it('verifies each exact content-addressed R2 key but never authorizes deletion', () => {
    const {candidate, items} = fixture();
    const result = verifyRemovedSkuR2Content(candidate, items);
    expect(result).toEqual({
      verifiedKeys: [items[0]!.objectKey, items[1]!.objectKey],
      blockers: [], deletionAuthorized: false,
    });
  });

  it('rejects replaced content at the same R2 key despite matching metadata', () => {
    const {candidate, items} = fixture();
    const observation = {...items[0]!, body: Buffer.from('replacement')};
    observation.contentLength = observation.body.byteLength;
    const result = verifyRemovedSkuR2Content(candidate, [observation, items[1]!]);
    expect(result.verifiedKeys).toEqual([items[1]!.objectKey]);
    expect(result.blockers[0]).toMatch(/differs from the frozen digest/);
  });

  it('fails closed on stale HEAD/GET ETag, missing content, and oversized data', () => {
    const {candidate, items} = fixture();
    const mismatched: RemovedSkuR2ContentObservation = {...items[0]!, getEtag: '"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"'};
    const missing: RemovedSkuR2ContentObservation = {objectKey: items[1]!.objectKey, status: 'absent'};
    const result = verifyRemovedSkuR2Content(candidate, [mismatched, missing]);
    expect(result.verifiedKeys).toEqual([]);
    expect(result.blockers).toHaveLength(2);
    expect(result.deletionAuthorized).toBe(false);
    expect(verifyRemovedSkuR2Content(candidate, [
      {...items[0]!, contentLength: 21 * 1024 * 1024}, items[1]!,
    ]).blockers).toHaveLength(1);
    const oversized = Buffer.alloc(20 * 1024 * 1024 + 1);
    expect(verifyRemovedSkuR2Content(candidate, [
      {...items[0]!, body: oversized, contentLength: oversized.byteLength}, items[1]!,
    ])).toMatchObject({verifiedKeys: [items[1]!.objectKey], deletionAuthorized: false});
  });

  it('blocks incomplete observation coverage and rejects duplicates or unrelated keys', () => {
    const {candidate, items} = fixture();
    const incomplete = verifyRemovedSkuR2Content(candidate, [items[0]!]);
    expect(incomplete.verifiedKeys).toHaveLength(1);
    expect(incomplete.blockers).toHaveLength(1);
    expect(() => verifyRemovedSkuR2Content(candidate, [items[0]!, items[0]!])).toThrow(/duplicate/);
    expect(() => verifyRemovedSkuR2Content(candidate, [{
      ...items[0]!, objectKey: 'variation-listing/unrelated/image.jpg',
    }])).toThrow(/unexpected/);
  });

  it('rejects malformed and inconsistent frozen candidate keys before any inspection', () => {
    const {candidate, items} = fixture();
    expect(() => verifyRemovedSkuR2Content({...candidate, deletionAuthorized: true as never}, items)).toThrow(/invalid frozen candidate/);
    expect(() => verifyRemovedSkuR2Content({
      ...candidate, r2ObjectKeys: [items[0]!.objectKey, items[0]!.objectKey],
    }, items)).toThrow(/inconsistent/);
    expect(() => verifyRemovedSkuR2Content({
      ...candidate, copies: [{...candidate.copies[0]!, backR2Key: items[0]!.objectKey}],
    }, items)).toThrow(/duplicate or malformed/);
  });

  it('fails closed for malformed revision, ownership, path, extension, hash, and bounded candidates', () => {
    const {candidate, items} = fixture();
    expect(() => verifyRemovedSkuR2Content({...candidate, revisionId: 'revision' }, items))
      .toThrow(/invalid frozen candidate/);
    expect(() => verifyRemovedSkuR2Content({
      ...candidate,
      ownershipChecks: candidate.ownershipChecks.map((check, index) =>
        index === 0 ? {...check, status: 'verified'} : check) as never,
    }, items)).toThrow(/ownership checks/);
    expect(() => verifyRemovedSkuR2Content({
      ...candidate,
      groupId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    }, items)).toThrow(/duplicate or malformed/);
    expect(() => verifyRemovedSkuR2Content({
      ...candidate,
      copies: [{...candidate.copies[0]!, frontR2Key: items[0]!.objectKey.replace('.jpg', '.gif')}],
    }, items)).toThrow(/duplicate or malformed/);
    expect(() => verifyRemovedSkuR2Content({
      ...candidate,
      copies: [{...candidate.copies[0]!, frontR2Key: items[0]!.objectKey.replace(/-[a-f0-9]{12}\.jpg$/, '-ABCDEFABCDEF.jpg')}],
    }, items)).toThrow(/duplicate or malformed/);
    expect(() => verifyRemovedSkuR2Content({
      ...candidate,
      copies: Array.from({length: 129}, () => candidate.copies[0]!),
    }, items)).toThrow(/copies/);
    expect(() => verifyRemovedSkuR2Content({
      ...candidate,
      r2ObjectKeys: Array.from({length: 257}, () => items[0]!.objectKey),
    }, items)).toThrow(/candidate R2 keys/);
    const sparseKeys = new Array<string>(2);
    sparseKeys[1] = items[1]!.objectKey;
    expect(() => verifyRemovedSkuR2Content({...candidate, r2ObjectKeys: sparseKeys}, items))
      .toThrow(/candidate R2 keys/);
    const sparseChecks = new Array<string>(1);
    expect(() => verifyRemovedSkuR2Content({...candidate, requiredChecks: sparseChecks}, items))
      .toThrow(/required ownership checks/);
  });

  it('accepts opaque R2 ETags only as equal change signals and blocks swapped or incomplete content', () => {
    const {candidate, items} = fixture();
    const opaque = items.map((item, index) => ({
      ...item,
      headEtag: `W/"opaque-r2-${index}"`,
      getEtag: `W/"opaque-r2-${index}"`,
    }));
    expect(verifyRemovedSkuR2Content(candidate, opaque)).toMatchObject({
      verifiedKeys: items.map((item) => item.objectKey), blockers: [], deletionAuthorized: false,
    });

    const swapped = items.map((item, index) => ({
      ...item,
      body: items[1 - index]!.body,
      contentLength: items[1 - index]!.body.byteLength,
    }));
    const swappedResult = verifyRemovedSkuR2Content(candidate, swapped);
    expect(swappedResult.verifiedKeys).toEqual([]);
    expect(swappedResult.blockers).toHaveLength(2);
    const swappedKeys = items.map((item, index) => ({
      ...item,
      objectKey: items[1 - index]!.objectKey,
    }));
    expect(verifyRemovedSkuR2Content(candidate, swappedKeys)).toMatchObject({
      verifiedKeys: [], deletionAuthorized: false,
    });
    expect(verifyRemovedSkuR2Content(candidate, []).blockers).toHaveLength(2);
    expect(verifyRemovedSkuR2Content(candidate, [
      {...items[0]!, status: 'inaccessible', contentLength: undefined},
      {...items[1]!, contentLength: items[1]!.body.byteLength + 1},
    ]).blockers).toHaveLength(2);
  });

  it('fails closed when bounded observations exceed the aggregate body cap', () => {
    const body = Buffer.alloc(17 * 1024 * 1024, 1);
    const digest = createHash('sha256').update(body).digest('hex').slice(0, 12);
    const key = (copy: string, role: 'front' | 'back') =>
      `variation-listing/${groupId}/${variationId}/${copy}/${role}-${digest}.jpg`;
    const keys = [key(copyId, 'front'), key(copyId, 'back'), key(copyId2, 'front'), key(copyId2, 'back')];
    const {candidate: base} = fixture();
    const candidate: RemovedSkuPurgeCandidateManifest = {
      ...base,
      copies: [
        {copyId, frontR2Key: keys[0]!, backR2Key: keys[1]!, localSourceRefs: ['/synthetic/1-front', '/synthetic/1-back']},
        {copyId: copyId2, frontR2Key: keys[2]!, backR2Key: keys[3]!, localSourceRefs: ['/synthetic/2-front', '/synthetic/2-back']},
      ],
      r2ObjectKeys: keys,
      localSourceRefs: ['/synthetic/1-front', '/synthetic/1-back', '/synthetic/2-front', '/synthetic/2-back'],
    };
    const observations = keys.map((objectKey, index) => ({
      objectKey, status: 'present' as const, body,
      headEtag: `opaque-${index}`, getEtag: `opaque-${index}`, contentLength: body.byteLength,
    }));
    const result = verifyRemovedSkuR2Content(candidate, observations);
    expect(result.verifiedKeys).toEqual([]);
    expect(result.blockers.some((blocker) => blocker.includes('aggregate body limit'))).toBe(true);
    expect(result.deletionAuthorized).toBe(false);
  });
});
