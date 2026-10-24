import {describe, expect, it, vi} from 'vitest';
import type {
  VariationListingAggregateSnapshot,
  VariationListingPublishingCheckpointRow,
  VariationListingRevisionRow,
} from '@ebay-inventory/data';

import {
  readRemovedSkuPurgePreview,
  type RemovedSkuPurgePreviewDependencies,
} from '@/ebay/variation-listing-removed-sku-purge-api.js';
import {buildRemovedSkuPurgeCandidateManifest} from '@/ebay/variation-listing-removed-sku-purge-preview.js';
import type {RemovedSkuOwnershipRows} from '@/ebay/variation-listing-removed-sku-ownership.js';
import type {RemovedSkuPurgeReadiness} from '@/ebay/variation-listing-removed-sku-purge-readiness.js';

vi.mock('@/ebay/variation-listing-removed-sku-purge-preview.js', () => ({
  buildRemovedSkuPurgeCandidateManifest: vi.fn(() => ({deletionAuthorized: false})),
}));

const groupId = '11111111-1111-4111-8111-111111111111';
const revisionId = '22222222-2222-4222-8222-222222222222';
const foreignGroupId = '33333333-3333-4333-8333-333333333333';

const revision = (group_id = groupId): VariationListingRevisionRow => ({
  revision_id: revisionId,
  group_id,
  captured_desired_revision: 1,
} as unknown as VariationListingRevisionRow);

const aggregate = (group_id = groupId, desired_revision = 1, last_confirmed_revision: number | null = 1): VariationListingAggregateSnapshot => ({
  group: {group_id, desired_revision, last_confirmed_revision},
} as unknown as VariationListingAggregateSnapshot);

const rows: RemovedSkuOwnershipRows = {
  scanComplete: true,
  scanCounts: {variationCopies: 0, standardListings: 0, revisions: 0},
  variationCopies: [],
  standardListings: [],
  revisions: [],
};

const readiness: RemovedSkuPurgeReadiness = {
  kind: 'removed_sku_read_only_readiness',
  groupId,
  revisionId,
  targetVariationId: '44444444-4444-4444-8444-444444444444',
  targetSku: 'SKU',
  r2ObjectKeys: ['secret/key'],
  localPaths: ['/secret/path'],
  r2Present: 0,
  r2Absent: 0,
  r2UnknownOrInaccessible: 1,
  localPresent: 0,
  localUnverifiedOrShared: 1,
  databaseReferenceConflicts: 0,
  databaseWitnessUsed: false,
  blockers: ['diagnostic only'],
  deletionAuthorized: false,
};

function dependencies(overrides: Partial<RemovedSkuPurgePreviewDependencies> = {}): RemovedSkuPurgePreviewDependencies {
  return {
    readAggregate: vi.fn().mockResolvedValue(aggregate()),
    readRevision: vi.fn().mockResolvedValue(revision()),
    readCheckpoints: vi.fn().mockResolvedValue([] as VariationListingPublishingCheckpointRow[]),
    readOwnershipRows: vi.fn().mockResolvedValue(rows),
    localRoots: [],
    inspectR2Metadata: vi.fn().mockResolvedValue({objectKey: 'secret/key', status: 'unknown'}),
    inspectReadiness: vi.fn().mockResolvedValue(readiness),
    ...overrides,
  };
}

describe('readRemovedSkuPurgePreview', () => {
  it('rejects malformed UUIDs before any dependency I/O', async () => {
    const deps = dependencies();
    expect(await readRemovedSkuPurgePreview('bad', revisionId, deps)).toBeNull();
    expect(await readRemovedSkuPurgePreview('bad', revisionId)).toBeNull();
    expect(deps.readRevision).not.toHaveBeenCalled();
    expect(deps.readOwnershipRows).not.toHaveBeenCalled();
  });

  it('rejects a foreign revision before loading the group or scanning owners', async () => {
    const deps = dependencies({readRevision: vi.fn().mockResolvedValue(revision(foreignGroupId))});
    expect(await readRemovedSkuPurgePreview(groupId, revisionId, deps)).toBeNull();
    expect(deps.readAggregate).not.toHaveBeenCalled();
    expect(deps.readCheckpoints).not.toHaveBeenCalled();
    expect(deps.readOwnershipRows).not.toHaveBeenCalled();
  });

  it('canonicalizes valid uppercase UUIDs before lookup and identity comparison', async () => {
    const lowercaseGroupId = 'aaaaaaaa-1111-4111-8111-111111111111';
    const lowercaseRevisionId = 'bbbbbbbb-2222-4222-8222-222222222222';
    const deps = dependencies({
      readRevision: vi.fn().mockResolvedValue({
        ...revision(lowercaseGroupId),
        revision_id: lowercaseRevisionId,
      }),
      readAggregate: vi.fn().mockResolvedValue(aggregate(lowercaseGroupId)),
      inspectReadiness: vi.fn().mockResolvedValue({
        ...readiness,
        groupId: lowercaseGroupId,
        revisionId: lowercaseRevisionId,
      }),
    });

    await expect(readRemovedSkuPurgePreview(
      lowercaseGroupId.toUpperCase(),
      lowercaseRevisionId.toUpperCase(),
      deps,
    )).resolves.toMatchObject({groupId: lowercaseGroupId, revisionId: lowercaseRevisionId});
    expect(deps.readRevision).toHaveBeenCalledWith(lowercaseRevisionId);
    expect(deps.readAggregate).toHaveBeenCalledWith(lowercaseGroupId);
  });

  it('loads the immutable revision, aggregate and journal before injecting readiness', async () => {
    const inspectReadiness = vi.fn().mockResolvedValue(readiness);
    const deps = dependencies({inspectReadiness});
    expect(await readRemovedSkuPurgePreview(groupId, revisionId, deps)).toEqual(readiness);
    expect(deps.readRevision).toHaveBeenCalledWith(revisionId);
    expect(deps.readAggregate).toHaveBeenCalledWith(groupId);
    expect(deps.readCheckpoints).toHaveBeenCalledWith(revisionId);
    expect(deps.readOwnershipRows).toHaveBeenCalledOnce();
    expect(inspectReadiness).toHaveBeenCalledWith(expect.objectContaining({
      revision: expect.objectContaining({revision_id: revisionId, group_id: groupId}),
      currentAggregate: expect.objectContaining({group: expect.objectContaining({group_id: groupId})}),
      ownershipRows: rows,
    }));
  });

  it('rejects missing, mismatched and stale aggregate state before owner scans', async () => {
    const missing = dependencies({readAggregate: vi.fn().mockResolvedValue(null)});
    expect(await readRemovedSkuPurgePreview(groupId, revisionId, missing)).toBeNull();
    expect(missing.readOwnershipRows).not.toHaveBeenCalled();

    const mismatched = dependencies({readAggregate: vi.fn().mockResolvedValue(aggregate(foreignGroupId))});
    await expect(readRemovedSkuPurgePreview(groupId, revisionId, mismatched)).rejects.toThrow(/mismatched group identity/);
    expect(mismatched.readOwnershipRows).not.toHaveBeenCalled();

    const stale = dependencies({readAggregate: vi.fn().mockResolvedValue(aggregate(groupId, 2, 2))});
    await expect(readRemovedSkuPurgePreview(groupId, revisionId, stale)).rejects.toThrow(/stale/);
    expect(stale.readCheckpoints).not.toHaveBeenCalled();
    expect(stale.readOwnershipRows).not.toHaveBeenCalled();
  });

  it('rejects invalid removal or journal evidence before owner scans', async () => {
    vi.mocked(buildRemovedSkuPurgeCandidateManifest).mockImplementationOnce(() => {
      throw new Error('terminal membership removal proof is missing');
    });
    const deps = dependencies();

    await expect(readRemovedSkuPurgePreview(groupId, revisionId, deps)).rejects.toThrow(/terminal/);
    expect(deps.readOwnershipRows).not.toHaveBeenCalled();
    expect(deps.inspectReadiness).not.toHaveBeenCalled();
  });

  it('keeps scan failures and forged authorization fail-closed', async () => {
    const failedScan = dependencies({readOwnershipRows: vi.fn().mockRejectedValue(new Error('scan failed'))});
    await expect(readRemovedSkuPurgePreview(groupId, revisionId, failedScan)).rejects.toThrow('scan failed');

    const forged = dependencies({inspectReadiness: vi.fn().mockResolvedValue({...readiness, deletionAuthorized: true as never})});
    await expect(readRemovedSkuPurgePreview(groupId, revisionId, forged)).rejects.toThrow(/authorization/);
  });
});
