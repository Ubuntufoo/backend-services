import {
  createSupabaseServiceClient,
  createSupabaseVariationListingTransactionGateway,
  getVariationListingRevisionById,
  inspectR2ObjectMetadata,
  listVariationListingPublishingCheckpointsByRevisionId,
  type SupabaseDataClient,
  type Json,
  type VariationListingAggregateSnapshot,
  type VariationListingPublishingCheckpointRow,
  type VariationListingRevisionRow,
} from '@ebay-inventory/data';

import { resolveWatcherIncomingDirectory, resolveWatcherProcessedDirectory } from '@/http/standard-capture-state.js';
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
  /** Restricted, read-only service-role database snapshot. */
  readPredeleteWitness(groupId: string, revisionId: string, variationId: string, sku: string): Promise<Json>;
  localRoots: readonly RemovedSkuLocalArtifactRoot[];
  inspectR2Metadata: RemovedSkuR2MetadataInspector;
  /** Test seam for the pure readiness aggregation; production uses the real inspector. */
  inspectReadiness?: typeof inspectRemovedSkuPurgeReadiness;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Diagnostic only: SELECT/HEAD, read-only service-role witness RPC, and local inspection.
 * The witness never grants cleanup authorization.
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
    readPredeleteWitness: async (groupId, revisionId, variationId, sku) => {
      const {data, error} = await client.rpc('inspect_variation_removed_sku_ownership' as never, {
        p_group_id: groupId,
        p_revision_id: revisionId,
        p_target_variation_id: variationId,
        p_target_sku: sku,
      } as never);
      if (error) throw new Error('Removed-SKU read-only database witness RPC failed.', {cause: error});
      if (data === null || data === undefined) {
        throw new Error('Removed-SKU read-only database witness returned no evidence.');
      }
      return data as Json;
    },
    // Scan configured watcher roots, including the archive destination.
    // Original capture refs may still point to incoming after archival.
    localRoots: [
      {kind: 'incoming', absolutePath: resolveWatcherIncomingDirectory(env)},
      {kind: 'processed', absolutePath: resolveWatcherProcessedDirectory(env)},
    ],
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
  const candidate = buildRemovedSkuPurgeCandidateManifest({
    revision,
    checkpoints,
    currentAggregate: aggregate,
  });
  // Do not silently fall back to a witness-free preview when the RPC fails.
  const witness = await resolvedDependencies.readPredeleteWitness(
    groupId, revisionId, candidate.targetVariationId, candidate.targetSku,
  );
  if (witness === null || witness === undefined) {
    throw new Error('Removed-SKU read-only database witness returned no evidence.');
  }
  const rows = await resolvedDependencies.readOwnershipRows();

  const result = await (resolvedDependencies.inspectReadiness ?? inspectRemovedSkuPurgeReadiness)({
    revision,
    checkpoints,
    currentAggregate: aggregate,
    ownershipRows: rows,
    localRoots: resolvedDependencies.localRoots,
    r2MetadataInspector: resolvedDependencies.inspectR2Metadata,
    predeleteWitness: witness,
  });
  if (result.deletionAuthorized !== false || result.databaseWitnessUsed !== true ||
      result.groupId !== groupId || result.revisionId !== revisionId) {
    throw new Error('Removed-SKU purge preview returned inconsistent identity or authorization.');
  }
  return result;
}
