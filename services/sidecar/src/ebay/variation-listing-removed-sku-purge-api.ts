import {
  createSupabaseServiceClient,
  createSupabaseVariationListingTransactionGateway,
  getVariationListingRevisionById,
  inspectR2ObjectMetadata,
  listVariationListingPublishingCheckpointsByRevisionId,
  type SupabaseDataClient,
  type VariationListingAggregateSnapshot,
  type VariationListingPublishingCheckpointRow,
  type VariationListingRevisionRow,
} from '@ebay-inventory/data';

import { resolveWatcherIncomingDirectory } from '@/http/standard-capture-state.js';
import { buildRemovedSkuPurgeCandidateManifest } from '@/ebay/variation-listing-removed-sku-purge-preview.js';
import { readRemovedSkuOwnershipRows, type RemovedSkuOwnershipRows, type RemovedSkuR2MetadataInspector } from '@/ebay/variation-listing-removed-sku-ownership.js';
import {
  inspectRemovedSkuPurgeReadiness,
  type RemovedSkuPurgeReadiness,
} from '@/ebay/variation-listing-removed-sku-purge-readiness.js';
import type { RemovedSkuLocalArtifactRoot } from '@/ebay/variation-listing-removed-sku-local-artifacts.js';

export interface RemovedSkuPurgePreviewDependencies {
  readAggregate(groupId: string): Promise<VariationListingAggregateSnapshot | null>;
  readRevision(revisionId: string): Promise<VariationListingRevisionRow | null>;
  readCheckpoints(revisionId: string): Promise<VariationListingPublishingCheckpointRow[]>;
  readOwnershipRows(): Promise<RemovedSkuOwnershipRows>;
  localRoots: readonly RemovedSkuLocalArtifactRoot[];
  inspectR2Metadata: RemovedSkuR2MetadataInspector;
  /** Test seam for the pure readiness aggregation; production uses the real inspector. */
  inspectReadiness?: typeof inspectRemovedSkuPurgeReadiness;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The endpoint's only I/O is SELECT/HEAD and bounded local inspection.
 * It does NOT call the deferred witness RPC or create deletion capability.
 */
export function createRemovedSkuPurgePreviewDependencies(
  env: NodeJS.ProcessEnv = process.env,
  client: SupabaseDataClient = createSupabaseServiceClient(env),
): RemovedSkuPurgePreviewDependencies {
  const gateway = createSupabaseVariationListingTransactionGateway(client);
  return {
    readAggregate: async (groupId) => await gateway.loadAggregate(groupId),
    readRevision: async (revisionId) =>
      (await getVariationListingRevisionById(client, revisionId))?.source ?? null,
    readCheckpoints: async (revisionId) =>
      (await listVariationListingPublishingCheckpointsByRevisionId(client, revisionId)).map((row) => row.source),
    readOwnershipRows: async () => await readRemovedSkuOwnershipRows(client),
    // Variation capture keeps original incoming refs; no speculative cache/
    // processed root is assumed. Unknown roots remain explicit blockers.
    localRoots: [{kind: 'incoming', absolutePath: resolveWatcherIncomingDirectory(env)}],
    inspectR2Metadata: async (key) => await inspectR2ObjectMetadata(key, {env}),
  };
}

export async function readRemovedSkuPurgePreview(
  groupId: string,
  revisionId: string,
  dependencies?: RemovedSkuPurgePreviewDependencies,
): Promise<RemovedSkuPurgeReadiness | null> {
  // Reject malformed identities before even a point lookup. This keeps direct
  // callers subject to the same cheap boundary as the HTTP route.
  if (!UUID.test(groupId) || !UUID.test(revisionId)) return null;
  groupId = groupId.toLowerCase();
  revisionId = revisionId.toLowerCase();
  const resolvedDependencies = dependencies ?? createRemovedSkuPurgePreviewDependencies();

  // Resolve exact immutable source before any potentially expensive scan.
  const revision = await resolvedDependencies.readRevision(revisionId);
  if (revision === null) return null;
  if (revision.group_id !== groupId || revision.revision_id !== revisionId) {
    // Do not expose cross-group revision or resource metadata.
    return null;
  }

  const aggregate = await resolvedDependencies.readAggregate(groupId);
  if (aggregate === null) return null;
  if (aggregate.group.group_id !== groupId) {
    throw new Error('Removed-SKU purge preview returned a mismatched group identity.');
  }
  if (aggregate.group.last_confirmed_revision !== revision.captured_desired_revision ||
      aggregate.group.desired_revision !== aggregate.group.last_confirmed_revision) {
    throw new Error('Removed-SKU purge preview revision is stale or the group has unconfirmed changes.');
  }
  const checkpoints = await resolvedDependencies.readCheckpoints(revisionId);

  // Hydrate and validate the immutable c2 removal before starting complete
  // cross-owner scans. This rejects staged, nonterminal, malformed, and stale
  // revisions while the operation is still on the cheap preflight path.
  buildRemovedSkuPurgeCandidateManifest({
    revision,
    checkpoints,
    currentAggregate: aggregate,
  });

  const rows = await resolvedDependencies.readOwnershipRows();

  const result = await (resolvedDependencies.inspectReadiness ?? inspectRemovedSkuPurgeReadiness)({
    revision,
    checkpoints,
    currentAggregate: aggregate,
    ownershipRows: rows,
    localRoots: resolvedDependencies.localRoots,
    r2MetadataInspector: resolvedDependencies.inspectR2Metadata,
  });
  if (result.deletionAuthorized !== false || result.groupId !== groupId || result.revisionId !== revisionId) {
    throw new Error('Removed-SKU purge preview returned inconsistent identity or authorization.');
  }
  return result;
}
