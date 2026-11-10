import {describe, expect, it} from 'vitest';
import {createRemovedSkuCleanupPersistence} from '@/ebay/variation-listing-removed-sku-cleanup-persistence.js';

describe('removed SKU cleanup journal persistence seam', () => {
  it('persists the frozen plan without exposing confirmation or delete operations', async () => {
    const calls: Array<{name: string; args: Record<string, unknown>}> = [];
    const persistence = createRemovedSkuCleanupPersistence({
      async rpc(name, args) {
        calls.push({name, args});
        return {data: 'journal-id', error: null};
      },
    });
    await expect(persistence.createPlan({
      groupId: 'g', revisionId: 'r', targetVariationId: 'v', targetSku: 'sku',
      localPaths: ['/tmp/a'], r2Keys: ['r2/a'],
    })).resolves.toBe('journal-id');
    expect(calls).toEqual([{
      name: 'create_variation_listing_removed_sku_cleanup_journal',
      args: {
        p_group_id: 'g', p_revision_id: 'r', p_target_variation_id: 'v', p_target_sku: 'sku',
        p_local_paths: ['/tmp/a'], p_r2_keys: ['r2/a'],
      },
    }]);
  });

  it('uses strict CAS state transitions and recovery, with no blind retry method', async () => {
    const calls: Array<{name: string; args: Record<string, unknown>}> = [];
    const persistence = createRemovedSkuCleanupPersistence({
      async rpc(name, args) {
        calls.push({name, args});
        return {data: [{state: 'attempting', attempt_count: 1, version: 1}], error: null};
      },
    });
    await persistence.beginAttempt({journalId: 'j', resourceKind: 'r2', resourceIdentity: 'k', expectedVersion: 0});
    await persistence.recordOutcome({journalId: 'j', resourceKind: 'r2', resourceIdentity: 'k', expectedVersion: 1, nextState: 'unknown', lastError: 'ambiguous'});
    await persistence.recoverInterrupted({journalId: 'j', resourceKind: 'local', resourceIdentity: '/tmp/a', expectedVersion: 1});
    expect(calls).toEqual([
      {name: 'transition_variation_listing_removed_sku_cleanup_resource', args: {
        p_journal_id: 'j', p_resource_kind: 'r2', p_resource_identity: 'k',
        p_expected_state: 'planned', p_next_state: 'attempting', p_expected_version: 0, p_last_error: null,
      }},
      {name: 'transition_variation_listing_removed_sku_cleanup_resource', args: {
        p_journal_id: 'j', p_resource_kind: 'r2', p_resource_identity: 'k',
        p_expected_state: 'attempting', p_next_state: 'unknown', p_expected_version: 1, p_last_error: 'ambiguous',
      }},
      {name: 'recover_variation_listing_removed_sku_cleanup_resource', args: {
        p_journal_id: 'j', p_resource_kind: 'local', p_resource_identity: '/tmp/a', p_expected_version: 1,
      }},
    ]);
    expect(Object.keys(persistence).sort()).toEqual(['beginAttempt', 'createPlan', 'recordOutcome', 'recoverInterrupted']);
  });

  it('fails closed on RPC errors and malformed outcomes', async () => {
    const error = createRemovedSkuCleanupPersistence({
      async rpc() { return {data: null, error: {message: 'CAS mismatch'}}; },
    });
    await expect(error.createPlan({
      groupId: 'g', revisionId: 'r', targetVariationId: 'v', targetSku: 'sku', localPaths: ['/tmp/a'], r2Keys: ['r2/a'],
    })).rejects.toThrow('CAS mismatch');
    const malformed = createRemovedSkuCleanupPersistence({
      async rpc() { return {data: [{state: 'removed', attempt_count: -1, version: 1}], error: null}; },
    });
    await expect(malformed.beginAttempt({journalId: 'j', resourceKind: 'local', resourceIdentity: '/tmp/a', expectedVersion: 0})).rejects.toThrow();
  });
});
