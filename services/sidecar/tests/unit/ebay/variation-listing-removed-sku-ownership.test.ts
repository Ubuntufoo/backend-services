import { mkdtemp, mkdir, writeFile, link, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { inspectR2ObjectMetadata } from '@ebay-inventory/data';
import type { RemovedSkuPurgeCandidateManifest } from '@/ebay/variation-listing-removed-sku-purge-preview.js';
import {
  findRemovedSkuReferenceConflicts,
  inspectRemovedSkuLocalFiles,
  inspectRemovedSkuOwnership,
  readRemovedSkuOwnershipRows,
} from '@/ebay/variation-listing-removed-sku-ownership.js';
import type { RemovedSkuOwnershipRows } from '@/ebay/variation-listing-removed-sku-ownership.js';

const r2Config = {
  accountId: 'account-id', accessKeyId: 'access-key-id', secretAccessKey: 'secret',
  bucketName: 'listing-images', publicBaseUrl: 'https://images.example.com', region: 'auto' as const,
  s3Endpoint: 'https://account-id.r2.cloudflarestorage.com',
};

const makeCandidate = (
  overrides: Partial<RemovedSkuPurgeCandidateManifest> = {}
): RemovedSkuPurgeCandidateManifest => {
  const groupId = '11111111-1111-4111-8111-111111111111';
  const targetVariationId = '22222222-2222-4222-8222-222222222222';
  const copyId = '33333333-3333-4333-8333-333333333333';
  const frontR2Key = `variation-listing/${groupId}/${targetVariationId}/${copyId}/front-0123456789ab.webp`;
  const backR2Key = `variation-listing/${groupId}/${targetVariationId}/${copyId}/back-abcdef012345.png`;
  return {
    groupId, revisionId: '44444444-4444-4444-8444-444444444444', targetVariationId, targetSku: 'sku',
    r2ObjectKeys: [frontR2Key, backR2Key],
    copies: [{ copyId, frontR2Key, backR2Key, localSourceRefs: ['/images/front.jpg', '/images/back.jpg'] }],
    localSourceRefs: ['/images/front.jpg', '/images/back.jpg'],
    ownershipChecks: [
      { scope: 'variation-groups', status: 'unverified' },
      { scope: 'standard-single-lot', status: 'unverified' },
      { scope: 'prior-revisions', status: 'unverified' },
      { scope: 'local-files', status: 'unverified' },
      { scope: 'r2-objects', status: 'unverified' },
    ],
    deletionAuthorized: false,
    requiredChecks: ['check'],
    ...overrides,
  };
};

const candidate = makeCandidate();
const rows = (): RemovedSkuOwnershipRows => ({
  scanComplete: true,
  scanCounts: { variationCopies: 0, standardListings: 0, revisions: 0 },
  variationCopies: [],
  standardListings: [],
  revisions: [],
});
const attest = (data: RemovedSkuOwnershipRows): RemovedSkuOwnershipRows => {
  data.scanCounts = {
    variationCopies: data.variationCopies.length,
    standardListings: data.standardListings.length,
    revisions: data.revisions.length,
  };
  return data;
};
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('read-only removed SKU ownership audit', () => {
  it('keeps deletion unauthorized and reports valid watcher keys as metadata-unknown without an inspector', async () => {
    const audit = await inspectRemovedSkuOwnership({ candidate, rows: rows() });
    expect(audit.deletionAuthorized).toBe(false);
    expect(audit.referenceConflicts).toEqual([]);
    expect(audit.databaseChecks.every((x) => x.status === 'clear')).toBe(true);
    expect(audit.r2KeyChecks.every((x) => x.status === 'unknown' && x.formatValid)).toBe(true);
  });

  it('detects references in other Variation copies and Standard listings, including URL paths', () => {
    const data = rows();
    data.variationCopies.push({ copy_id: 'other', front_r2_key: candidate.r2ObjectKeys[0]!, back_r2_key: 'other', capture_front_source_ref: 'other', capture_back_source_ref: '/images/back.jpg' });
    data.standardListings.push({ listing_id: 'standard', r2_object_keys: [candidate.r2ObjectKeys[0]!], image_urls: [`https://images.example.com/prefix/${encodeURIComponent(candidate.r2ObjectKeys[1]!)}`] });
    const conflicts = findRemovedSkuReferenceConflicts(candidate, attest(data));
    expect(conflicts.filter((x) => x.scope === 'variation-groups')).toHaveLength(2);
    expect(conflicts.filter((x) => x.scope === 'standard-single-lot')).toHaveLength(2);
  });

  it('treats same deleted-copy historical fields as provenance but rejects other copies and anonymous media', () => {
    const data = rows();
    data.revisions.push({ revision_id: 'prior', group_id: candidate.groupId, snapshot: { aggregate: { copies: [{ copy_id: candidate.copies[0]!.copyId, variation_id: candidate.targetVariationId, front_r2_key: candidate.r2ObjectKeys[0], capture_back_source_ref: '/images/back.jpg' }] } } });
    expect(findRemovedSkuReferenceConflicts(candidate, attest(data))).toEqual([]);
    data.revisions.push({ revision_id: 'wrong-role', group_id: candidate.groupId, snapshot: { copies: [{ copy_id: candidate.copies[0]!.copyId, variation_id: candidate.targetVariationId, front_r2_key: candidate.r2ObjectKeys[1] }] } });
    data.revisions.push({ revision_id: 'other-copy', group_id: candidate.groupId, snapshot: { copies: [{ copy_id: 'other', variation_id: candidate.targetVariationId, front_r2_key: candidate.r2ObjectKeys[0] }] } });
    data.revisions.push({ revision_id: 'anonymous', group_id: candidate.groupId, snapshot: { mediaResources: [{ url: `https://host/${candidate.r2ObjectKeys[1]}` }] } });
    expect(findRemovedSkuReferenceConflicts(candidate, attest(data)).filter((x) => x.scope === 'prior-revisions')).toHaveLength(3);
  });

  it('does not treat another copy key as provenance when carried by the deleted copy', () => {
    const copyId = '55555555-5555-4555-8555-555555555555';
    const frontR2Key = `variation-listing/${candidate.groupId}/${candidate.targetVariationId}/${copyId}/front-112233445566.jpg`;
    const backR2Key = `variation-listing/${candidate.groupId}/${candidate.targetVariationId}/${copyId}/back-aabbccddeeff.jpeg`;
    const multiCopyCandidate = makeCandidate({
      r2ObjectKeys: [...candidate.r2ObjectKeys, frontR2Key, backR2Key],
      localSourceRefs: [...candidate.localSourceRefs, '/images/front-2.jpg', '/images/back-2.jpg'],
      copies: [...candidate.copies, { copyId, frontR2Key, backR2Key, localSourceRefs: ['/images/front-2.jpg', '/images/back-2.jpg'] }],
    });
    const data = rows();
    data.revisions.push({ revision_id: 'cross-copy', group_id: candidate.groupId, snapshot: {
      copies: [{ copy_id: candidate.copies[0]!.copyId, variation_id: candidate.targetVariationId, front_r2_key: frontR2Key }],
    } });
    expect(findRemovedSkuReferenceConflicts(multiCopyCandidate, attest(data))).toEqual([
      { scope: 'prior-revisions', owner: 'revision:cross-copy.copies[0].front_r2_key', resource: frontR2Key },
    ]);
  });

  it('rejects malformed candidate, rows, and snapshots instead of treating them as absence', () => {
    expect(() => findRemovedSkuReferenceConflicts({ ...candidate, r2ObjectKeys: [] }, rows())).toThrow(/mapping/);
    expect(() => findRemovedSkuReferenceConflicts({ ...candidate }, { ...rows(), scanComplete: false as never })).toThrow(/ownership rows/);
    expect(() => findRemovedSkuReferenceConflicts({ ...candidate }, { ...rows(), scanCounts: { variationCopies: 1, standardListings: 0, revisions: 0 } })).toThrow(/completeness/);
    expect(() => findRemovedSkuReferenceConflicts({
      ...candidate,
      copies: [{ ...candidate.copies[0]!, localSourceRefs: ['/images/only-front.jpg'] }],
    }, rows())).toThrow(/duplicate|malformed|mapping/);
    expect(() => findRemovedSkuReferenceConflicts(candidate, attest({ ...rows(), variationCopies: [{ copy_id: 'x', front_r2_key: null as never, back_r2_key: 'b', capture_front_source_ref: 'f', capture_back_source_ref: 'b' }] }))).toThrow(/malformed/);
    expect(() => findRemovedSkuReferenceConflicts(candidate, attest({ ...rows(), variationCopies: [{ copy_id: ' x', front_r2_key: 'f', back_r2_key: 'b', capture_front_source_ref: 'f', capture_back_source_ref: 'b' }] }))).toThrow(/malformed/);
    expect(() => findRemovedSkuReferenceConflicts({ ...candidate, targetSku: ' sku' }, rows())).toThrow(/malformed/);
    expect(() => findRemovedSkuReferenceConflicts(candidate, attest({ ...rows(), revisions: [{ revision_id: 'r', group_id: 'g', snapshot: null as never }] }))).toThrow(/malformed/);
  });

  it('rejects forged or duplicate ownership scopes and malformed required checks', () => {
    const forgedScopes = candidate.ownershipChecks.map((check, index) =>
      index === 0 ? { ...check, scope: 'forged-scope' as never } : check
    );
    expect(() => findRemovedSkuReferenceConflicts({ ...candidate, ownershipChecks: forgedScopes }, rows())).toThrow(/ownership checks/);

    const duplicateScopes = candidate.ownershipChecks.map((check, index) =>
      index === 1 ? candidate.ownershipChecks[0]! : check
    );
    expect(() => findRemovedSkuReferenceConflicts({ ...candidate, ownershipChecks: duplicateScopes }, rows())).toThrow(/ownership checks/);

    expect(() => findRemovedSkuReferenceConflicts({ ...candidate, requiredChecks: [] }, rows())).toThrow(/ownership checks/);
    expect(() => findRemovedSkuReferenceConflicts({ ...candidate, requiredChecks: [' '] }, rows())).toThrow(/ownership checks/);
    expect(() => findRemovedSkuReferenceConflicts({ ...candidate, requiredChecks: [' check '] }, rows())).toThrow(/ownership checks/);
  });

  it('classifies R2 HEAD responses with safe metadata only', async () => {
    const send = vi.fn().mockResolvedValue({ ContentLength: 12, ContentType: 'image/webp', ETag: 'etag', LastModified: new Date('2026-01-01T00:00:00Z'), Body: 'must-not-be-returned' });
    const present = await inspectR2ObjectMetadata(candidate.r2ObjectKeys[0]!, { client: { send }, config: r2Config });
    expect(present).toMatchObject({ objectKey: candidate.r2ObjectKeys[0], status: 'present', contentLength: 12, contentType: 'image/webp', etag: 'etag' });
    expect(present).not.toHaveProperty('Body');
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      input: { Bucket: r2Config.bucketName, Key: candidate.r2ObjectKeys[0] },
    }));
    for (const [error, status] of [
      [{ $metadata: { httpStatusCode: 404 } }, 'absent'],
      [{ name: 'NoSuchKey' }, 'absent'],
      [{ statusCode: 401 }, 'inaccessible'],
      [{ name: 'AccessDenied' }, 'inaccessible'],
      [new Error('network'), 'unknown'],
    ] as const) {
      const result = await inspectR2ObjectMetadata(candidate.r2ObjectKeys[0]!, { client: { send: vi.fn().mockRejectedValue(error) }, config: r2Config });
      expect(result.status).toBe(status);
    }
  });

  it('keeps R2 absent and inspector failures diagnostic, never ownership proof', async () => {
    const statuses = new Map(candidate.r2ObjectKeys.map((key, index) => [key, index === 0 ? 'absent' : 'inaccessible'] as const));
    const audit = await inspectRemovedSkuOwnership({
      candidate,
      rows: rows(),
      r2MetadataInspector: async (key) => {
        if (key === candidate.r2ObjectKeys[1]) throw new Error('unknown');
        return { objectKey: key, status: statuses.get(key)! };
      },
    });
    expect(audit.r2KeyChecks[0]).toMatchObject({ status: 'absent', formatValid: true });
    expect(audit.r2KeyChecks[1]).toMatchObject({ status: 'unknown', formatValid: true });
    expect(audit.deletionAuthorized).toBe(false);
  });

  it('rejects inspector object-key mismatches and malformed status evidence as unknown', async () => {
    const mismatch = await inspectRemovedSkuOwnership({
      candidate,
      rows: rows(),
      r2MetadataInspector: async (key) => ({ objectKey: `${key}-other`, status: 'present' }),
    });
    expect(mismatch.r2KeyChecks.every((check) => check.status === 'unknown')).toBe(true);
    const malformed = await inspectRemovedSkuOwnership({
      candidate,
      rows: rows(),
      r2MetadataInspector: async (key) => ({ objectKey: key, status: 'not-a-status' } as never),
    });
    expect(malformed.r2KeyChecks.every((check) => check.status === 'unknown')).toBe(true);
  });

  it('rejects wrong-prefix or malformed watcher keys as unknown without metadata ownership inference', async () => {
    const wrong = 'cards/target/front.webp';
    const badCandidate = makeCandidate({ r2ObjectKeys: [wrong, candidate.r2ObjectKeys[1]!], copies: [{ ...candidate.copies[0]!, frontR2Key: wrong }] });
    const audit = await inspectRemovedSkuOwnership({ candidate: badCandidate, rows: rows(), r2MetadataInspector: vi.fn() });
    expect(audit.r2KeyChecks[0]).toMatchObject({ formatValid: false, status: 'unknown' });
    expect(audit.r2KeyChecks[1]).toMatchObject({ formatValid: true });
  });
});

function supabaseClientFor(pages: Record<string, Array<{ data: unknown[] | null; error: { message: string } | null; count: number | null }>>): any {
  return {
    from(table: string) {
      const chain: any = {};
      chain.select = vi.fn(() => chain);
      chain.order = vi.fn(() => chain);
      chain.range = vi.fn((start: number) => Promise.resolve(pages[table]?.[Math.floor(start / 250)] ?? { data: [], error: null, count: 0 }));
      return chain;
    },
  };
}

const copyRow = (id: string) => ({ copy_id: id, front_r2_key: `front-${id}`, back_r2_key: `back-${id}`, capture_front_source_ref: `front-ref-${id}`, capture_back_source_ref: `back-ref-${id}` });
const listingRow = (id: string) => ({ listing_id: id, r2_object_keys: [`key-${id}`], image_urls: [`https://example/${id}`] });
const revisionRow = (id: string) => ({ revision_id: id, group_id: 'g', snapshot: {} });

describe('paginated ownership reads', () => {
  it.each([
    ['null count', { variation_listing_copies: [{ data: [], error: null, count: null }] }],
    ['short page', { variation_listing_copies: [{ data: [copyRow('c')], error: null, count: 2 }] }],
    ['count beyond bound', { variation_listing_copies: [{ data: [], error: null, count: 25001 }] }],
    ['missing error field', { variation_listing_copies: [{ data: [], count: 0 } as never] }],
    ['non-null error', { variation_listing_copies: [{ data: [], error: { message: 'failed' }, count: 0 }] }],
  ])('fails closed for %s', async (_label, variationPages) => {
    await expect(readRemovedSkuOwnershipRows(supabaseClientFor(variationPages))).rejects.toThrow();
  });

  it('rejects count drift and duplicate identity across pages', async () => {
    const first = Array.from({ length: 250 }, (_, index) => copyRow(`c-${index}`));
    const driftPages = {
      variation_listing_copies: [
        { data: first, error: null, count: 251 },
        { data: [copyRow('c-250')], error: null, count: 252 },
      ],
    };
    await expect(readRemovedSkuOwnershipRows(supabaseClientFor(driftPages))).rejects.toThrow(/changed/);
    const duplicatePages = {
      variation_listing_copies: [
        { data: first, error: null, count: 251 },
        { data: [copyRow('c-0')], error: null, count: 251 },
      ],
    };
    await expect(readRemovedSkuOwnershipRows(supabaseClientFor(duplicatePages))).rejects.toThrow(/duplicate/);
  });

  it('accepts a stable complete two-page result', async () => {
    const first = Array.from({ length: 250 }, (_, index) => copyRow(`page-one-${index}`));
    const second = [copyRow('page-two-only')];
    const result = await readRemovedSkuOwnershipRows(supabaseClientFor({
      variation_listing_copies: [
        { data: first, error: null, count: 251 },
        { data: second, error: null, count: 251 },
      ],
    }));
    expect(result.scanComplete).toBe(true);
    expect(result.scanCounts).toEqual({ variationCopies: 251, standardListings: 0, revisions: 0 });
    expect(result.variationCopies).toHaveLength(251);
    expect(result.variationCopies.at(-1)?.copy_id).toBe('page-two-only');
  });

  it('rejects malformed rows before returning an ownership snapshot', async () => {
    await expect(readRemovedSkuOwnershipRows(supabaseClientFor({
      listings: [{ data: [{ ...listingRow('x'), image_urls: [null] }], error: null, count: 1 }],
    }))).rejects.toThrow(/malformed/);
    await expect(readRemovedSkuOwnershipRows(supabaseClientFor({
      variation_listing_revisions: [{ data: [{ ...revisionRow('r'), snapshot: null }], error: null, count: 1 }],
    }))).rejects.toThrow(/malformed/);
  });
});

describe('trusted-root local artifact inspection', () => {
  it('classifies regular, missing, hard-linked, non-file, outside, and symlink paths conservatively', async () => {
    const root = await mkdtemp(join(tmpdir(), 'removed-sku-'));
    const outside = await mkdtemp(join(tmpdir(), 'removed-sku-outside-'));
    tempRoots.push(root, outside);
    await mkdir(join(root, 'nested'));
    await mkdir(join(root, 'inside-target'));
    await writeFile(join(root, 'image.jpg'), 'image');
    await writeFile(join(root, 'solo.jpg'), 'solo');
    await writeFile(join(root, 'inside-target', 'inside.jpg'), 'inside');
    await writeFile(join(outside, 'outside.jpg'), 'outside');
    await link(join(root, 'image.jpg'), join(root, 'hardlink.jpg'));
    await symlink(join(outside, 'outside.jpg'), join(root, 'final-link.jpg'));
    await symlink(outside, join(root, 'intermediate-link'));
    await symlink(join(root, 'inside-target'), join(root, 'in-root-link'));
    const observed = await inspectRemovedSkuLocalFiles([
      join(root, 'image.jpg'), join(root, 'hardlink.jpg'), join(root, 'solo.jpg'), join(root, 'solo.jpg'), join(root, 'missing.jpg'), join(root, 'nested'),
      join(root, 'final-link.jpg'), join(root, 'intermediate-link', 'outside.jpg'), join(root, 'in-root-link', 'inside.jpg'), join(outside, 'outside.jpg'), 'relative.jpg',
    ], [root]);
    expect(observed[0]?.status).toBe('shared');
    expect(observed[1]?.status).toBe('shared');
    expect(observed[2]?.status).toBe('shared');
    expect(observed[3]?.status).toBe('shared');
    expect(observed[4]?.status).toBe('missing');
    expect(observed[5]?.status).toBe('unverified');
    expect(observed[6]?.status).toBe('unverified');
    expect(observed[7]?.status).toBe('unverified');
    expect(observed[8]?.status).toBe('present');
    expect(observed[9]?.status).toBe('unverified');
    expect(observed[10]?.status).toBe('unverified');
    await expect(inspectRemovedSkuLocalFiles([], [join(root, 'image.jpg')])).rejects.toThrow(/directory/);
  });

  it('rejects duplicate, symlink-alias, and nested trusted roots', async () => {
    const base = await mkdtemp(join(tmpdir(), 'removed-sku-roots-'));
    tempRoots.push(base);
    const root = join(base, 'root');
    const nested = join(root, 'nested');
    const alias = join(base, 'root-alias');
    await mkdir(nested, { recursive: true });
    await symlink(root, alias);

    await expect(inspectRemovedSkuLocalFiles([], [root, root])).rejects.toThrow(/overlap or alias/);
    await expect(inspectRemovedSkuLocalFiles([], [root, alias])).rejects.toThrow(/overlap or alias/);
    await expect(inspectRemovedSkuLocalFiles([], [root, nested])).rejects.toThrow(/overlap or alias/);
  });
});
