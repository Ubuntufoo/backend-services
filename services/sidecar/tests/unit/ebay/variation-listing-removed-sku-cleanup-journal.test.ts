import {describe, expect, it} from 'vitest';
import {
  planRemovedSkuCleanup,
  recoverInterruptedRemovedSkuCleanup,
  summarizeRemovedSkuCleanupJournal,
  transitionRemovedSkuCleanup,
} from '@/ebay/variation-listing-removed-sku-cleanup-journal.js';

const input = {
  groupId: '11111111-1111-4111-8111-111111111111',
  revisionId: '22222222-2222-4222-8222-222222222222',
  targetVariationId: '33333333-3333-4333-8333-333333333333',
  targetSku: 'BSKBL-Test-000002',
  localPaths: ['/tmp/test/front.jpg', '/tmp/test/back.jpg'],
  r2Keys: ['variation-listing/test/front', 'variation-listing/test/back'],
};

describe('removed SKU cleanup offline journal contract', () => {
  it('freezes distinct resources without conferring authorization', () => {
    const journal = planRemovedSkuCleanup(input);
    expect(journal.resources).toHaveLength(4);
    expect(journal.resources.map(resource => resource.state)).toEqual([
      'planned', 'planned', 'planned', 'planned',
    ]);
    expect(journal.operatorConfirmed).toBe(false);
    expect(journal.deletionAuthorized).toBe(false);
    expect(summarizeRemovedSkuCleanupJournal(journal)).toEqual({
      terminal: 0, pending: 4, uncertain: 0, deletionAuthorized: false,
    });
  });

  it('rejects missing, duplicated or malformed frozen resources', () => {
    expect(() => planRemovedSkuCleanup({...input, r2Keys: []})).toThrow();
    expect(() => planRemovedSkuCleanup({...input, localPaths: [input.localPaths[0]!, input.localPaths[0]!]})).toThrow();
    expect(() => planRemovedSkuCleanup({...input, groupId: 'not-uuid'})).toThrow();
    expect(() => planRemovedSkuCleanup({...input, r2Keys: ['  ']})).toThrow();
  });

  it('enforces exact transitions and never repeats completed resources', () => {
    const initial = planRemovedSkuCleanup(input);
    const target = {kind: 'r2' as const, identity: input.r2Keys[0]!};
    const attempted = transitionRemovedSkuCleanup(initial, {
      ...target, expectedState: 'planned', nextState: 'attempting',
    });
    expect(initial.resources[2]?.state).toBe('planned');
    expect(attempted.resources[2]?.attemptCount).toBe(1);
    expect(() => transitionRemovedSkuCleanup(attempted, {
      ...target, expectedState: 'planned', nextState: 'attempting',
    })).toThrow();
    const removed = transitionRemovedSkuCleanup(attempted, {
      ...target, expectedState: 'attempting', nextState: 'removed',
    });
    expect(removed.resources[2]?.state).toBe('removed');
    expect(summarizeRemovedSkuCleanupJournal(removed).terminal).toBe(1);
    expect(() => transitionRemovedSkuCleanup(removed, {
      ...target, expectedState: 'removed', nextState: 'attempting',
    })).toThrow();
    expect(() => transitionRemovedSkuCleanup(initial, {
      ...target, expectedState: 'planned', nextState: 'removed',
    })).toThrow();
  });

  it('marks interrupted operations unknown and blocks automatic retry', () => {
    const initial = planRemovedSkuCleanup(input);
    const target = {kind: 'local' as const, identity: input.localPaths[0]!};
    const attempting = transitionRemovedSkuCleanup(initial, {
      ...target, expectedState: 'planned', nextState: 'attempting',
    });
    const recovered = recoverInterruptedRemovedSkuCleanup(attempting);
    expect(recovered.resources[0]).toMatchObject({
      state: 'unknown', attemptCount: 1,
    });
    expect(summarizeRemovedSkuCleanupJournal(recovered).uncertain).toBe(1);
    expect(() => transitionRemovedSkuCleanup(recovered, {
      ...target, expectedState: 'unknown', nextState: 'attempting',
    })).toThrow();
  });

  it('requires a recorded reason for failed or ambiguous provider responses', () => {
    const target = {kind: 'r2' as const, identity: input.r2Keys[1]!};
    const started = transitionRemovedSkuCleanup(planRemovedSkuCleanup(input), {
      ...target, expectedState: 'planned', nextState: 'attempting',
    });
    expect(() => transitionRemovedSkuCleanup(started, {
      ...target, expectedState: 'attempting', nextState: 'unknown',
    })).toThrow();
    const failed = transitionRemovedSkuCleanup(started, {
      ...target, expectedState: 'attempting', nextState: 'failed',
      lastError: 'request outcome ambiguous',
    });
    expect(failed.resources[3]).toMatchObject({
      state: 'failed', lastError: 'request outcome ambiguous',
    });
    expect(() => transitionRemovedSkuCleanup(failed, {
      ...target, expectedState: 'failed', nextState: 'attempting',
    })).toThrow();
  });

  it('rejects forgery of journal confirmation or authorization flags', () => {
    const journal = planRemovedSkuCleanup(input);
    expect(() => summarizeRemovedSkuCleanupJournal({...journal, operatorConfirmed: true as never})).toThrow();
    expect(() => summarizeRemovedSkuCleanupJournal({...journal, deletionAuthorized: true as never})).toThrow();
  });
});
