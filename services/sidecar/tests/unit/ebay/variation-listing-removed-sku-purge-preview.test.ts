import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import type {
  Json,
  VariationListingAggregateSnapshot,
  VariationListingPublishingCheckpointRow,
  VariationListingRevisionRow,
} from '@ebay-inventory/data';

import { buildRemovedSkuPurgeCandidateManifest } from '@/ebay/variation-listing-removed-sku-purge-preview.js';

const groupId = '11111111-1111-4111-8111-111111111111';
const targetVariationId = '22222222-2222-4222-8222-222222222222';
const survivorVariationIds = [
  '33333333-3333-4333-8333-333333333331',
  '33333333-3333-4333-8333-333333333332',
];
const targetSku = 'BSKBL-Purge-000001';
const survivorSkus = ['BSKBL-Purge-000002', 'BSKBL-Purge-000003'];
const groupKey = 'VL-G-11111111111141118111111111111111';
const listingId = 'listing-1';
const revisionId = '44444444-4444-4444-8444-444444444444';
const now = '2026-10-22T00:00:00.000Z';

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function digest(value: Json): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function group(): VariationListingAggregateSnapshot['group'] {
  return {
    group_id: groupId,
    group_key: groupKey,
    sku_category_code: 'BSKBL',
    sku_bucket_token: 'Purge',
    next_inventory_serial: 4,
    lifecycle_state: 'active',
    selector_name: 'Card',
    title: 'Purge test',
    description: 'Purge test',
    derived_common_ebay_aspects: { Sport: ['Basketball'] },
    category_id: '261328',
    marketplace_id: 'EBAY_US',
    listing_format: 'FIXED_PRICE',
    merchant_location_key: 'main',
    fulfillment_policy_id: 'fulfillment',
    payment_policy_id: 'payment',
    return_policy_id: 'return',
    condition_id: '4000',
    condition_token: 'VERY_GOOD',
    condition_description: null,
    condition_descriptors: [],
    desired_revision: 4,
    last_confirmed_revision: 4,
    created_at: now,
    updated_at: now,
  };
}

function variation(
  variationId: string,
  sku: string,
  position: number,
  pendingRemovalAt: string | null = null
): VariationListingAggregateSnapshot['variations'][number] {
  return {
    variation_id: variationId,
    group_id: groupId,
    inventory_serial: position + 1,
    position,
    sku,
    selector_value: `Card ${position + 1}`,
    price_amount: 1.49,
    price_currency: 'USD',
    quantity_adjustment_counter: 0,
    representative_copy_id: null,
    variation_metadata: {},
    pending_removal_at: pendingRemovalAt,
    created_at: now,
    updated_at: now,
  };
}

function copy(
  copyId: string,
  variationId: string,
  prefix: string
): VariationListingAggregateSnapshot['copies'][number] {
  return {
    copy_id: copyId,
    variation_id: variationId,
    front_r2_key: `cards/${prefix}/front.webp`,
    back_r2_key: `cards/${prefix}/back.webp`,
    capture_front_source_ref: `${prefix}-front-source`,
    capture_back_source_ref: `${prefix}-back-source`,
    capture_pair_id: `${prefix}-pair`,
    capture_source_key: 'camera-1',
    capture_started_at: now,
    captured_at: now,
    condition_token: 'VERY_GOOD',
    condition_notes: null,
    availability_state: 'available',
    created_at: now,
    updated_at: now,
  };
}

function confirmedAggregate(
  frozenCopies: VariationListingAggregateSnapshot['copies']
): VariationListingAggregateSnapshot {
  return {
    group: group(),
    variations: [
      variation(targetVariationId, targetSku, 0, '2026-10-22T00:00:00.000Z'),
      variation(survivorVariationIds[0]!, survivorSkus[0]!, 1),
      variation(survivorVariationIds[1]!, survivorSkus[1]!, 2),
    ],
    copies: frozenCopies,
  };
}

function currentAggregate(
  overrides: Partial<VariationListingAggregateSnapshot> = {}
): VariationListingAggregateSnapshot {
  const survivorCopies = [
    copy('survivor-copy-1', survivorVariationIds[0]!, 'survivor-1'),
    copy('survivor-copy-2', survivorVariationIds[1]!, 'survivor-2'),
  ];
  return {
    group: group(),
    variations: [
      variation(survivorVariationIds[0]!, survivorSkus[0]!, 0),
      variation(survivorVariationIds[1]!, survivorSkus[1]!, 1),
    ],
    copies: survivorCopies,
    ...overrides,
  };
}

function revision(
  options: {
    frozenCopies?: VariationListingAggregateSnapshot['copies'];
    frozenVariations?: VariationListingAggregateSnapshot['variations'];
    snapshotDigest?: string;
  } = {}
): VariationListingRevisionRow {
  const targetCopy = copy('target-copy-1', targetVariationId, 'target-1');
  const frozenCopies = options.frozenCopies ?? [
    targetCopy,
    copy('survivor-copy-1', survivorVariationIds[0]!, 'survivor-1'),
    copy('survivor-copy-2', survivorVariationIds[1]!, 'survivor-2'),
  ];
  const quantitiesBySku = {
    [targetSku]: { inventoryItemQuantity: 0, offerQuantity: 0, sellableQuantity: 0 },
    [survivorSkus[0]!]: { inventoryItemQuantity: 1, offerQuantity: 1, sellableQuantity: 1 },
    [survivorSkus[1]!]: { inventoryItemQuantity: 2, offerQuantity: 2, sellableQuantity: 2 },
  };
  const offerIdsBySku = {
    [targetSku]: `offer-${targetSku}`,
    [survivorSkus[0]!]: `offer-${survivorSkus[0]}`,
    [survivorSkus[1]!]: `offer-${survivorSkus[1]}`,
  };
  const inventoryItemPayloadsBySku = Object.fromEntries(
    [targetSku, ...survivorSkus].map((sku, index) => [sku, {
      sku,
      condition: 'VERY_GOOD',
      product: { aspects: { Card: [`Card ${index + 1}`] } },
    }])
  );
  const offerPayloadsBySku = Object.fromEntries(
    [targetSku, ...survivorSkus].map((sku) => [sku, { sku, listingPolicies: { fulfillmentPolicyId: 'fulfillment' } }])
  );
  const expectedGroupPayload = {
    inventoryItemGroupKey: groupKey,
    title: 'Purge test',
    description: 'Purge test',
    aspects: { Sport: ['Basketball'] },
    variantSKUs: [targetSku, ...survivorSkus],
    variesBy: { aspectsImageVariesBy: ['Card'], specifications: [{ name: 'Card', values: ['Card 1', 'Card 2', 'Card 3'] }] },
  };
  const snapshot: Json = {
    aggregate: currentAggregate(),
    confirmed: {
      aggregate: {
        ...confirmedAggregate(frozenCopies),
        variations: options.frozenVariations ?? confirmedAggregate(frozenCopies).variations,
      },
      representativeImages: [],
      remote: {
        listingId,
        offerIdsBySku: {
          [survivorSkus[0]!]: offerIdsBySku[survivorSkus[0]!],
          [survivorSkus[1]!]: offerIdsBySku[survivorSkus[1]!],
        },
        quantitiesBySku: {
          [survivorSkus[0]!]: quantitiesBySku[survivorSkus[0]!],
          [survivorSkus[1]!]: quantitiesBySku[survivorSkus[1]!],
        },
      },
      revisionId: 'previous-revision',
    },
    mediaResources: [],
    representativeImages: [],
    permanentRemoval: {
      version: 1,
      groupKey,
      targetVariationId,
      targetSku,
      marketplaceId: 'EBAY_US',
      survivorSkus,
      listingId,
      offerIdsBySku,
      quantitiesBySku,
      inventoryItemPayloadsBySku,
      offerPayloadsBySku,
      expectedGroupPayload,
      replacementGroupPayload: {
        ...expectedGroupPayload,
        variantSKUs: survivorSkus,
        variesBy: { aspectsImageVariesBy: ['Card'], specifications: [{ name: 'Card', values: ['Card 2', 'Card 3'] }] },
      },
    },
  };
  const intent = { groupKey, targetSku, survivorSkus };
  const operationPlan = [{
    sequence_no: 1,
    operation_key: 'remove-group-membership',
    operation_kind: 'permanent_removal_group_membership',
    target_ref: groupKey,
    intent_version: 1,
    intent_digest: digest(intent),
    intent,
  }];
  return {
    revision_id: revisionId,
    group_id: groupId,
    captured_desired_revision: 4,
    snapshot_version: 3,
    snapshot_digest: options.snapshotDigest ?? digest(snapshot),
    snapshot,
    operation_plan: operationPlan,
    operation_count: 1,
    captured_at: now,
  } as unknown as VariationListingRevisionRow;
}

function checkpoint(
  state: string,
  checkpointNumber: number,
  options: { attemptNumber?: number; revisionId?: string; operationKey?: string; observed?: string | null; evidence?: Json } = {}
): VariationListingPublishingCheckpointRow {
  return {
    checkpoint_id: `checkpoint-${options.attemptNumber ?? 1}-${checkpointNumber}`,
    revision_id: options.revisionId ?? revisionId,
    operation_key: options.operationKey ?? 'remove-group-membership',
    attempt_number: options.attemptNumber ?? 1,
    checkpoint_number: checkpointNumber,
    state,
    observed_remote_state: options.observed ?? (state === 'started' ? null : state === 'unknown' || state === 'retry_exhausted' ? 'unknown' : 'present'),
    evidence: options.evidence ?? (state === 'confirmed_complete' ? {
      listingId,
      survivorSkus,
      targetSku,
      state: 'removed',
    } : {}),
    created_at: now,
  } as unknown as VariationListingPublishingCheckpointRow;
}

function validCheckpoints(): VariationListingPublishingCheckpointRow[] {
  return [checkpoint('started', 1), checkpoint('confirmed_complete', 2)];
}

function preview(
  options: {
    revisionOptions?: Parameters<typeof revision>[0];
    checkpoints?: readonly VariationListingPublishingCheckpointRow[];
    aggregate?: VariationListingAggregateSnapshot;
  } = {}
) {
  return buildRemovedSkuPurgeCandidateManifest({
    revision: revision(options.revisionOptions),
    checkpoints: options.checkpoints ?? validCheckpoints(),
    currentAggregate: options.aggregate ?? currentAggregate(),
  });
}

describe('buildRemovedSkuPurgeCandidateManifest', () => {
  it('returns a deterministic non-authorizing manifest for a valid completed removal', () => {
    const first = preview();
    const second = preview();

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      groupId,
      revisionId,
      targetVariationId,
      targetSku,
      r2ObjectKeys: ['cards/target-1/front.webp', 'cards/target-1/back.webp'],
      localSourceRefs: ['target-1-front-source', 'target-1-back-source'],
      deletionAuthorized: false,
    });
    expect(first.copies).toHaveLength(1);
    expect(first.ownershipChecks).toEqual([
      { scope: 'variation-groups', status: 'unverified' },
      { scope: 'standard-single-lot', status: 'unverified' },
      { scope: 'prior-revisions', status: 'unverified' },
      { scope: 'local-files', status: 'unverified' },
      { scope: 'r2-objects', status: 'unverified' },
    ]);
  });

  it.each([
    ['pending', [checkpoint('started', 1)]],
    ['unknown', [checkpoint('started', 1), checkpoint('unknown', 2)]],
    ['confirmed_no_op', [checkpoint('started', 1), checkpoint('confirmed_no_op', 2)]],
  ])('rejects %s or non-c2 terminal journal', (_label, checkpoints) => {
    expect(() => preview({ checkpoints })).toThrow();
  });

  it('rejects foreign revision and operation checkpoints instead of filtering them out', () => {
    expect(() => preview({ checkpoints: [
      ...validCheckpoints(),
      checkpoint('started', 3, { revisionId: 'foreign-revision' }),
    ] })).toThrow(/another revision or operation/);
    expect(() => preview({ checkpoints: [
      ...validCheckpoints(),
      checkpoint('started', 3, { operationKey: 'publish' }),
    ] })).toThrow(/another revision or operation/);
  });

  it.each([
    ['reopened terminal', [checkpoint('started', 1), checkpoint('confirmed_complete', 2), checkpoint('started', 3)]],
    ['terminal after exhausted replay', [
      checkpoint('started', 1),
      checkpoint('unknown', 2),
      checkpoint('retry_authorized', 1, { attemptNumber: 2, observed: 'present' }),
      checkpoint('started', 2, { attemptNumber: 2 }),
      checkpoint('retry_exhausted', 3, { attemptNumber: 2 }),
      checkpoint('confirmed_complete', 4, { attemptNumber: 2 }),
    ]],
    ['checkpoint gap', [checkpoint('started', 1), checkpoint('confirmed_complete', 3)]],
    ['duplicate checkpoint number', [checkpoint('started', 1), checkpoint('started', 1)]],
    ['started checkpoint with evidence', [checkpoint('started', 1, { observed: 'present' })]],
  ])('rejects %s journal history', (_label, checkpoints) => {
    expect(() => preview({ checkpoints })).toThrow();
  });

  it('rejects mismatched digest and group identity', () => {
    expect(() => preview({ revisionOptions: { snapshotDigest: '0'.repeat(64) } })).toThrow(/digest/);
    const mismatchedGroup = group();
    mismatchedGroup.group_id = '99999999-9999-4999-8999-999999999999';
    expect(() => preview({ aggregate: currentAggregate({ group: mismatchedGroup }) })).toThrow(/watermark/);

    const mismatchedGroupKey = group();
    mismatchedGroupKey.group_key = 'VL-G-99999999999949998999999999999999';
    expect(() => preview({ aggregate: currentAggregate({ group: mismatchedGroupKey }) })).toThrow(/watermark/);
  });

  it.each([
    ['target variation remains', currentAggregate({ variations: [
      variation(targetVariationId, targetSku, 0),
      variation(survivorVariationIds[0]!, survivorSkus[0]!, 1),
      variation(survivorVariationIds[1]!, survivorSkus[1]!, 2),
    ] })],
    ['target copy remains', currentAggregate({ copies: [
      copy('target-copy-live', targetVariationId, 'target-live'),
    ] })],
  ])('rejects %s after c2 deletion', (_label, aggregate) => {
    expect(() => preview({ aggregate })).toThrow(/target still exists/);
  });

  it('rejects missing target deletion copies and missing target keys', () => {
    const noTargetCopies = [
      copy('survivor-copy-1', survivorVariationIds[0]!, 'survivor-1'),
      copy('survivor-copy-2', survivorVariationIds[1]!, 'survivor-2'),
    ];
    expect(() => preview({ revisionOptions: { frozenCopies: noTargetCopies } })).toThrow(/target copy inventory/);

    const missingKey = copy('target-copy-1', targetVariationId, 'target-1');
    missingKey.front_r2_key = '';
    expect(() => preview({ revisionOptions: {
      frozenCopies: [
        missingKey,
        copy('survivor-copy-1', survivorVariationIds[0]!, 'survivor-1'),
        copy('survivor-copy-2', survivorVariationIds[1]!, 'survivor-2'),
      ],
    } })).toThrow(/front.*r2_key/);

    const missingTargetVariation = [
      variation(survivorVariationIds[0]!, survivorSkus[0]!, 1),
      variation(survivorVariationIds[1]!, survivorSkus[1]!, 2),
    ];
    expect(() => preview({ revisionOptions: { frozenVariations: missingTargetVariation } })).toThrow(/selector|target variation identity/);
  });

  it.each([
    ['missing back source ref', (target: ReturnType<typeof copy>) => {
      Reflect.deleteProperty(target, 'capture_back_source_ref');
    }],
    ['missing front source ref', (target: ReturnType<typeof copy>) => {
      target.capture_front_source_ref = '';
    }],
    ['null back source ref', (target: ReturnType<typeof copy>) => {
      target.capture_back_source_ref = null as unknown as string;
    }],
    ['same-copy source refs', (target: ReturnType<typeof copy>) => {
      target.capture_back_source_ref = target.capture_front_source_ref;
    }],
  ])('rejects %s', (_label, mutate) => {
    const target = copy('target-copy-1', targetVariationId, 'target-1');
    mutate(target);
    expect(() => preview({ revisionOptions: {
      frozenCopies: [
        target,
        copy('survivor-copy-1', survivorVariationIds[0]!, 'survivor-1'),
        copy('survivor-copy-2', survivorVariationIds[1]!, 'survivor-2'),
      ],
    } })).toThrow(/source ref/);
  });

  it('rejects a source ref shared by two target copies', () => {
    const target = copy('target-copy-1', targetVariationId, 'target-1');
    const secondTarget = copy('target-copy-2', targetVariationId, 'target-2');
    secondTarget.capture_front_source_ref = target.capture_front_source_ref;
    expect(() => preview({ revisionOptions: {
      frozenCopies: [
        target,
        secondTarget,
        copy('survivor-copy-1', survivorVariationIds[0]!, 'survivor-1'),
        copy('survivor-copy-2', survivorVariationIds[1]!, 'survivor-2'),
      ],
    } })).toThrow(/source refs/);
  });

  it.each([
    ['frozen R2 key', (target: ReturnType<typeof copy>, survivor: ReturnType<typeof copy>) => {
      survivor.front_r2_key = target.front_r2_key;
    }],
    ['frozen source ref', (target: ReturnType<typeof copy>, survivor: ReturnType<typeof copy>) => {
      survivor.capture_front_source_ref = target.capture_front_source_ref;
    }],
  ])('rejects shared %s', (_label, mutate) => {
    const target = copy('target-copy-1', targetVariationId, 'target-1');
    const survivor = copy('survivor-copy-1', survivorVariationIds[0]!, 'survivor-1');
    const other = copy('survivor-copy-2', survivorVariationIds[1]!, 'survivor-2');
    mutate(target, survivor);
    expect(() => preview({ revisionOptions: { frozenCopies: [target, survivor, other] } })).toThrow(/shared/);
  });

  it('rejects shared live R2 keys and source refs', () => {
    const aggregate = currentAggregate();
    aggregate.copies[0]!.front_r2_key = 'cards/target-1/front.webp';
    expect(() => preview({ aggregate })).toThrow(/shared/);

    const sourceRefAggregate = currentAggregate();
    sourceRefAggregate.copies[0]!.capture_front_source_ref = 'target-1-front-source';
    expect(() => preview({ aggregate: sourceRefAggregate })).toThrow(/shared/);
  });

  it('keeps cross-group, Standard Single/Lot, prior-revision, local, and R2 ownership unknown and unauthorized', () => {
    const manifest = preview();
    expect(manifest.deletionAuthorized).toBe(false);
    expect(manifest.ownershipChecks.every((check) => check.status === 'unverified')).toBe(true);
    expect(manifest.requiredChecks.join(' ')).toMatch(/every Variation bucket, Standard Single\/Lot listing, earlier revision/);
    expect(manifest.requiredChecks.join(' ')).toMatch(/local source references/);
  });
});
