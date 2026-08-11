import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildFuturePlan,
  digest,
  executableYouPickManifestSchema,
  legacyYouPickManifestSchema,
  readManifest,
  runYouPickSandboxPilot,
  writeManifestAtomic,
  type ExecutableYouPickManifest,
  type RemoteOffer,
  type YouPickPilotReadApi,
} from '@/ebay/you-pick-sandbox-pilot.js';
import {
  executeYouPickManifest,
  validatePublishedViewAttestation,
  validateQuantityZeroAttestation,
  type YouPickPilotMutationApi,
} from '@/ebay/you-pick-sandbox-pilot-mutation.js';

const fixturePath = fileURLToPath(
  new URL('../../fixtures/you-pick-sandbox/two-card.json', import.meta.url)
);
const roots: string[] = [];
const fixed = new Date('2026-08-04T15:00:00.000Z');

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function gateApi(): YouPickPilotReadApi {
  return {
    getRuntimeSnapshot: vi.fn(async () => ({
      environment: 'sandbox',
      restOrigin: 'https://api.sandbox.ebay.com',
      oauthOrigin: 'https://api.sandbox.ebay.com',
      tradingOrigin: 'https://api.sandbox.ebay.com',
      marketplaceId: 'EBAY_US',
      contentLanguage: 'en-US',
      hasUserRefreshToken: true,
      productionCredentialMaterialPresent: false,
      background: {
        jobRunner: false,
        apify: false,
        soldComps: false,
        publishing: false,
        watcher: false,
      },
      forbiddenDependencies: {
        supabase: false,
        r2: false,
        jobs: false,
        watcher: false,
        ai: false,
        pricing: false,
      },
    })),
    getCurrentUserIdentity: vi.fn(async () => ({ userId: 'sandbox-seller-123' })),
    getPolicyLocationSnapshot: vi.fn(async () => ({
      fulfillment: [
        { id: 'FULFILLMENT-PILOT', marketplaceId: 'EBAY_US', ownerUserId: 'sandbox-seller-123' },
      ],
      payment: [
        { id: 'PAYMENT-PILOT', marketplaceId: 'EBAY_US', ownerUserId: 'sandbox-seller-123' },
      ],
      returns: [
        { id: 'RETURN-PILOT', marketplaceId: 'EBAY_US', ownerUserId: 'sandbox-seller-123' },
      ],
      locations: [
        {
          merchantLocationKey: 'you-pick-pilot-location',
          ownerUserId: 'sandbox-seller-123',
          enabled: true,
        },
      ],
    })),
    getMetadataSnapshot: vi.fn(async () => ({
      categoryId: '261328',
      variationsSupported: true,
      selectorCandidates: ['Card'],
      conditions: [
        {
          conditionId: '4000',
          conditionDescription: 'Very Good',
          inventoryCondition: 'USED_VERY_GOOD',
          conditionDescriptors: [
            { id: '40001', name: 'Card Condition', values: [{ id: '400012', name: 'Very Good' }] },
          ],
        },
      ],
    })),
    getInventoryItemGroup: vi.fn(async () => ({ status: 'missing' })),
    getInventoryItem: vi.fn(async () => ({ status: 'missing' })),
    getOffers: vi.fn(async () => ({ status: 'found', value: { offers: [] } })),
  };
}

async function freshManifestState(): Promise<{
  root: string;
  manifestPath: string;
  manifest: ExecutableYouPickManifest;
}> {
  const root = await mkdtemp(join(tmpdir(), 'yp-mutation-'));
  roots.push(root);
  const report = await runYouPickSandboxPilot({
    api: gateApi(),
    fixturePath,
    repoRoot: root,
    now: () => fixed,
    randomBytesImpl: () => Buffer.from('a1b2c3', 'hex'),
  });
  if (!('manifestPath' in report)) throw new Error('Expected dry-run report.');
  const manifest = executableYouPickManifestSchema.parse(
    await readManifest(report.manifestPath, join(root, '.local', 'you-pick-sandbox'))
  );
  return { root, manifestPath: report.manifestPath, manifest };
}

async function freshManifest(): Promise<ExecutableYouPickManifest> {
  return (await freshManifestState()).manifest;
}

async function freshThreeChildManifest(): Promise<ExecutableYouPickManifest> {
  const root = await mkdtemp(join(tmpdir(), 'yp-mutation-three-'));
  roots.push(root);
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  const third = structuredClone(fixture.children[1]);
  third.slot = 'C03';
  third.selector.value = '003 - Gamma Card';
  third.productAspects.Card = ['003 - Gamma Card'];
  third.productAspects['Player/Athlete'] = ['Gamma Player'];
  third.itemQuantity = 3;
  third.offerQuantity = 3;
  third.price.value = '3.33';
  third.images = [
    {
      role: 'front',
      url: 'https://images.example.invalid/gamma-front.jpg',
      fingerprint: 'gamma-front-v1',
    },
    {
      role: 'back',
      url: 'https://images.example.invalid/gamma-back.jpg',
      fingerprint: 'gamma-back-v1',
    },
  ];
  fixture.children.push(third);
  fixture.selector.values.push(third.selector.value);
  fixture.group.variantSkuSnapshot.push('C03');
  fixture.group.variesBy.specifications[0].values.push(third.selector.value);
  const customFixturePath = join(root, 'three-card.json');
  await writeFile(customFixturePath, JSON.stringify(fixture));
  const report = await runYouPickSandboxPilot({
    api: gateApi(),
    fixturePath: customFixturePath,
    repoRoot: root,
    now: () => fixed,
    randomBytesImpl: () => Buffer.from('d4e5f6', 'hex'),
  });
  if (!('manifestPath' in report)) throw new Error('Expected three-child dry-run report.');
  return executableYouPickManifestSchema.parse(
    await readManifest(report.manifestPath, join(root, '.local', 'you-pick-sandbox'))
  );
}

function publishedAttestation(
  manifest: ExecutableYouPickManifest,
  observedAt = new Date(fixed.getTime() + 1_000).toISOString()
) {
  return {
    kind: 'published-view',
    runId: manifest.run.runId,
    arrangementId: manifest.arrangementId,
    listingId: manifest.groupListingId,
    observedAt,
    children: manifest.execution.fixture.children.map((child, index) => ({
      sku: manifest.run.childSkus[index],
      selectorValue: manifest.execution.fixture.selector.values[index],
      expectedPrice: child.price.value,
      frontFingerprint: child.images[0].fingerprint,
      backFingerprint: child.images[1].fingerprint,
      selectorMapped: true as const,
      priceMapped: true as const,
      imagesInOrder: true as const,
    })),
    sharedConditionCorrect: true as const,
    titleAcceptable: true as const,
    descriptionAcceptable: true as const,
  };
}

function withCompletedOperation(
  manifest: ExecutableYouPickManifest,
  operationId: 'publish-group' | 'quantity-zero',
  completedAt = fixed.toISOString()
): ExecutableYouPickManifest {
  return executableYouPickManifestSchema.parse({
    ...manifest,
    execution: {
      ...manifest.execution,
      ledger: manifest.execution.ledger.map((entry) =>
        entry.id === operationId
          ? {
              ...entry,
              state: 'completed' as const,
              attemptCount: 1,
              startedAt: new Date(new Date(completedAt).getTime() - 1_000).toISOString(),
              completedAt,
            }
          : entry
      ),
    },
  });
}

function quantityAttestation(
  manifest: ExecutableYouPickManifest,
  observedAt: string,
  remainingChildren = manifest.run.childSkus.slice(1).map((sku) => ({
    sku,
    purchasable: true as const,
  }))
) {
  return {
    kind: 'quantity-zero',
    runId: manifest.run.runId,
    arrangementId: manifest.arrangementId,
    listingId: manifest.groupListingId,
    observedAt,
    targetSku: manifest.run.childSkus[0],
    targetUnavailable: true,
    remainingChildren,
  };
}

function withUnresolvedOperation(
  manifest: ExecutableYouPickManifest,
  operationId: string,
  state: 'started' | 'unknown'
): ExecutableYouPickManifest {
  return executableYouPickManifestSchema.parse({
    ...manifest,
    execution: {
      ...manifest.execution,
      ledger: manifest.execution.ledger.map((entry) =>
        entry.id === operationId
          ? {
              ...entry,
              state,
              attemptCount: 1,
              startedAt: fixed.toISOString(),
              completedAt: null,
              error: state === 'unknown' ? 'prior outcome unresolved' : null,
            }
          : entry
      ),
    },
  });
}

function mutationSpies(): YouPickPilotMutationApi {
  return {
    createOrReplaceInventoryItem: vi.fn(),
    createOffer: vi.fn(),
    createOrReplaceInventoryItemGroup: vi.fn(),
    publishInventoryItemGroup: vi.fn(),
    bulkUpdatePriceQuantity: vi.fn(),
    withdrawInventoryItemGroup: vi.fn(),
    deleteOffer: vi.fn(),
    deleteInventoryItemGroup: vi.fn(),
    deleteInventoryItem: vi.fn(),
  };
}

describe('guarded You Pick staged mutation lifecycle', () => {
  it.each([
    ['fixture policy', (value: any) => (value.execution.fixture.policies.paymentPolicyId += '-X')],
    ['fixture location', (value: any) => (value.execution.fixture.merchantLocationKey += '-X')],
    ['fixture price', (value: any) => (value.execution.fixture.children[0].price.value = '9.99')],
    [
      'fixture item quantity',
      (value: any) => (value.execution.fixture.children[0].itemQuantity = 9),
    ],
    [
      'fixture offer quantity',
      (value: any) => (value.execution.fixture.children[0].offerQuantity = 9),
    ],
    ['fixture selector', (value: any) => (value.execution.fixture.selector.name = 'Variant')],
    [
      'fixture condition',
      (value: any) =>
        (value.execution.fixture.sharedCondition.conditionDescriptors[0].values[0] = '400099'),
    ],
    [
      'fixture image',
      (value: any) => (value.execution.fixture.children[0].images[0].fingerprint += '-tampered'),
    ],
    ['arrangement ID', (value: any) => (value.arrangementId = 'f'.repeat(64))],
    ['operation digest', (value: any) => (value.operations[0].digest = 'f'.repeat(64))],
    ['ledger digest', (value: any) => (value.execution.ledger[0].requestDigest = 'f'.repeat(64))],
    ['operation order', (value: any) => value.operations.reverse()],
    ['resource order', (value: any) => value.resources.reverse()],
    ['missing operation', (value: any) => value.operations.pop()],
    ['extra ledger entry', (value: any) => value.execution.ledger.push(value.execution.ledger[0])],
  ])('rejects %s tampering through the authoritative integrity gate', async (_label, mutate) => {
    const tampered = structuredClone(await freshManifest()) as any;
    mutate(tampered);
    expect(() => executableYouPickManifestSchema.parse(tampered)).toThrow();
  });

  it('rejects a raw tampered manifest before either mutation dependency resolves', async () => {
    const state = await freshManifestState();
    const raw = JSON.parse(await readFile(state.manifestPath, 'utf8'));
    raw.execution.fixture.policies.fulfillmentPolicyId += '-TAMPERED';
    await writeFile(state.manifestPath, JSON.stringify(raw));
    const readFactory = vi.fn<() => Promise<YouPickPilotReadApi>>();
    const mutationFactory = vi.fn<() => Promise<YouPickPilotMutationApi>>();
    await expect(
      runYouPickSandboxPilot({
        apiFactory: readFactory,
        mutationApiFactory: mutationFactory,
        manifestPath: state.manifestPath,
        execute: true,
        confirmSandboxSeller: 'sandbox-seller-123',
        repoRoot: state.root,
      })
    ).rejects.toThrow(/integrity/i);
    expect(readFactory).not.toHaveBeenCalled();
    expect(mutationFactory).not.toHaveBeenCalled();
  });

  it('keeps version-4 proof readable but permanently non-executable', async () => {
    const current = await freshManifest();
    const { execution: _execution, version: _version, ...common } = current;
    const legacy = legacyYouPickManifestSchema.parse({ ...common, version: 4 });
    expect(legacy.version).toBe(4);
    expect(executableYouPickManifestSchema.safeParse(legacy).success).toBe(false);
  });

  it('rejects legacy and incomplete checkpoints before either API factory is resolved', async () => {
    const state = await freshManifestState();
    const localRoot = join(state.root, '.local', 'you-pick-sandbox');
    const readFactory = vi.fn<() => Promise<YouPickPilotReadApi>>();
    const mutationFactory = vi.fn<() => Promise<YouPickPilotMutationApi>>();
    const { execution: _execution, version: _version, ...common } = state.manifest;
    await writeManifestAtomic(
      state.manifestPath,
      legacyYouPickManifestSchema.parse({ ...common, version: 4 }),
      localRoot
    );
    await expect(
      runYouPickSandboxPilot({
        apiFactory: readFactory,
        mutationApiFactory: mutationFactory,
        manifestPath: state.manifestPath,
        execute: true,
        confirmSandboxSeller: 'sandbox-seller-123',
        repoRoot: state.root,
      })
    ).rejects.toThrow(/Guarded execution requires/);
    expect(readFactory).not.toHaveBeenCalled();
    expect(mutationFactory).not.toHaveBeenCalled();

    await writeManifestAtomic(
      state.manifestPath,
      executableYouPickManifestSchema.parse({ ...state.manifest, checkpoint: 'created' }),
      localRoot
    );
    await expect(
      runYouPickSandboxPilot({
        apiFactory: readFactory,
        mutationApiFactory: mutationFactory,
        manifestPath: state.manifestPath,
        execute: true,
        confirmSandboxSeller: 'sandbox-seller-123',
        repoRoot: state.root,
      })
    ).rejects.toThrow(/Guarded execution requires/);
    expect(readFactory).not.toHaveBeenCalled();
    expect(mutationFactory).not.toHaveBeenCalled();

    await expect(
      runYouPickSandboxPilot({
        apiFactory: readFactory,
        mutationApiFactory: mutationFactory,
        manifestPath: state.manifestPath,
        cleanup: true,
        execute: true,
        confirmSandboxSeller: 'sandbox-seller-123',
        repoRoot: state.root,
      })
    ).rejects.toThrow(/Guarded execution requires/);
    expect(readFactory).not.toHaveBeenCalled();
    expect(mutationFactory).not.toHaveBeenCalled();
  });

  it('rejects missing checkpoint attestation before the mutation factory is resolved', async () => {
    const state = await freshManifestState();
    const localRoot = join(state.root, '.local', 'you-pick-sandbox');
    await writeManifestAtomic(
      state.manifestPath,
      executableYouPickManifestSchema.parse({
        ...state.manifest,
        checkpoint: 'awaiting-published-view-verification',
        published: true,
        groupListingId: 'LISTING-1',
      }),
      localRoot
    );
    const mutationFactory = vi.fn<() => Promise<YouPickPilotMutationApi>>();
    await expect(
      runYouPickSandboxPilot({
        api: gateApi(),
        mutationApiFactory: mutationFactory,
        manifestPath: state.manifestPath,
        execute: true,
        confirmSandboxSeller: 'sandbox-seller-123',
        repoRoot: state.root,
        now: () => fixed,
      })
    ).rejects.toThrow(/Published-view attestation is required/);
    expect(mutationFactory).not.toHaveBeenCalled();
  });

  it('checkpoints every operation, stops twice for exact attestations, and cleans exact resources', async () => {
    let manifest = await freshManifest();
    let clock = fixed;
    const plan = buildFuturePlan(manifest.execution.fixture, manifest.run);
    const items = new Map<string, { digest: string; quantity: number }>();
    const offers = new Map<string, RemoteOffer>();
    let group: { digest: string; skus: string[] } | undefined;
    const readApi: YouPickPilotReadApi = {
      ...gateApi(),
      getInventoryItem: vi.fn(async (sku) => {
        const item = items.get(sku);
        return item
          ? {
              status: 'found',
              value: {
                sku,
                groupKeys: group ? [manifest.run.groupKey] : null,
                quantity: item.quantity,
                snapshotDigest: item.digest,
              },
            }
          : { status: 'missing' };
      }),
      getOffers: vi.fn(async (sku) => ({
        status: 'found',
        value: { offers: offers.has(sku) ? [offers.get(sku)!] : [] },
      })),
      getInventoryItemGroup: vi.fn(async () =>
        group
          ? { status: 'found', value: { variantSKUs: group.skus, snapshotDigest: group.digest } }
          : { status: 'missing' }
      ),
    };
    const headers: Record<string, string>[] = [];
    const mutationApi: YouPickPilotMutationApi = {
      createOrReplaceInventoryItem: vi.fn(async (sku, request, guarded) => {
        headers.push(guarded);
        items.set(sku, {
          digest: digest({ sku, ...request }),
          quantity: (request.availability as any).shipToLocationAvailability.quantity as number,
        });
      }),
      createOffer: vi.fn(async (request, guarded) => {
        headers.push(guarded);
        const sku = request.sku as string;
        const offerId = `OFFER-${offers.size + 1}`;
        offers.set(sku, {
          offerId,
          sku,
          marketplaceId: 'EBAY_US',
          status: 'UNPUBLISHED',
          listingId: null,
          listingStatus: null,
          lifecycleClass: null,
          publicationObserved: false,
          listingCurrentlyActive: false,
          withdrawRequired: false,
          availableQuantity: request.availableQuantity as number,
          snapshotDigest: digest(request),
        });
        return { offerId };
      }),
      createOrReplaceInventoryItemGroup: vi.fn(async (groupKey, request, guarded) => {
        headers.push(guarded);
        group = {
          digest: digest({ inventoryItemGroupKey: groupKey, ...request }),
          skus: request.variantSKUs as string[],
        };
      }),
      publishInventoryItemGroup: vi.fn(async (_request, guarded) => {
        headers.push(guarded);
        for (const [sku, offer] of offers)
          offers.set(sku, {
            ...offer,
            status: 'PUBLISHED',
            listingId: 'LISTING-1',
            listingStatus: 'ACTIVE',
            lifecycleClass: 'active',
            publicationObserved: true,
            listingCurrentlyActive: true,
            withdrawRequired: true,
          });
        return { listingId: 'LISTING-1' };
      }),
      bulkUpdatePriceQuantity: vi.fn(async (_request, guarded) => {
        headers.push(guarded);
        const sku = manifest.run.childSkus[0];
        const itemPayload = structuredClone(
          plan.operations.find((operation) => operation.id === 'item-C01')!.payload
        );
        (itemPayload.availability as any).shipToLocationAvailability.quantity = 0;
        items.set(sku, { digest: digest(itemPayload), quantity: 0 });
        const offerPayload = structuredClone(
          plan.operations.find((operation) => operation.id === 'offer-C01')!.payload
        );
        offerPayload.availableQuantity = 0;
        offers.set(sku, {
          ...offers.get(sku)!,
          availableQuantity: 0,
          listingStatus: 'OUT_OF_STOCK',
          snapshotDigest: digest(offerPayload),
        });
        return { responses: [{ sku, offerId: offers.get(sku)!.offerId, statusCode: 200 }] };
      }),
      withdrawInventoryItemGroup: vi.fn(async (_request, guarded) => {
        headers.push(guarded);
        let index = 0;
        for (const [sku, offer] of offers) {
          offers.set(sku, {
            ...offer,
            listingStatus: index === 0 ? 'ENDED' : 'EBAY_ENDED',
            lifecycleClass: 'ended',
            listingCurrentlyActive: false,
            withdrawRequired: false,
          });
          index += 1;
        }
      }),
      deleteOffer: vi.fn(async (offerId, guarded) => {
        headers.push(guarded);
        for (const [sku, offer] of offers) if (offer.offerId === offerId) offers.delete(sku);
      }),
      deleteInventoryItemGroup: vi.fn(async (_key, guarded) => {
        headers.push(guarded);
        group = undefined;
      }),
      deleteInventoryItem: vi.fn(async (sku, guarded) => {
        headers.push(guarded);
        items.delete(sku);
      }),
    };
    const persist = vi.fn(async (next: ExecutableYouPickManifest) => {
      manifest = next;
    });
    const base = () => ({
      manifest,
      readApi,
      mutationApi,
      headers: { 'Content-Language': 'en-US' as const },
      now: () => clock,
      persist,
    });

    const published = await executeYouPickManifest({ ...base(), cleanup: false });
    expect(published.checkpoint).toBe('awaiting-published-view-verification');
    expect(mutationApi.createOrReplaceInventoryItem).toHaveBeenCalledTimes(2);
    expect(mutationApi.createOffer).toHaveBeenCalledTimes(2);
    expect(mutationApi.publishInventoryItemGroup).toHaveBeenCalledOnce();
    expect(headers.every((value) => value['Content-Language'] === 'en-US')).toBe(true);
    expect(plan.operations.map((operation) => operation.digest)).toEqual(
      manifest.operations.map((operation) => operation.digest)
    );

    clock = new Date(fixed.getTime() + 2_000);
    const zero = await executeYouPickManifest({
      ...base(),
      cleanup: false,
      attestation: publishedAttestation(manifest),
    });
    expect(zero.checkpoint).toBe('awaiting-quantity-zero-verification');
    expect(items.get(manifest.run.childSkus[0])?.quantity).toBe(0);
    expect(offers.get(manifest.run.childSkus[0])?.availableQuantity).toBe(0);
    expect(offers.get(manifest.run.childSkus[0])?.listingStatus).toBe('OUT_OF_STOCK');
    expect(offers.get(manifest.run.childSkus[1])?.listingStatus).toBe('ACTIVE');

    const quantityAttestation = {
      kind: 'quantity-zero',
      runId: manifest.run.runId,
      arrangementId: manifest.arrangementId,
      listingId: manifest.groupListingId,
      observedAt: new Date(fixed.getTime() + 3_000).toISOString(),
      targetSku: manifest.run.childSkus[0],
      targetUnavailable: true,
      remainingChildren: manifest.run.childSkus.slice(1).map((sku) => ({
        sku,
        purchasable: true as const,
      })),
    };
    clock = new Date(fixed.getTime() + 4_000);
    const ready = await executeYouPickManifest({
      ...base(),
      cleanup: false,
      attestation: quantityAttestation,
    });
    expect(ready.checkpoint).toBe('withdrawal-ready');
    const cleaned = await executeYouPickManifest({ ...base(), cleanup: true });
    expect(cleaned.checkpoint).toBe('cleanup-complete');
    expect(manifest.cleanup.finalAbsenceVerified).toBe(true);
    expect(group).toBeUndefined();
    expect(items.size).toBe(0);
    expect(offers.size).toBe(0);
  });

  it('rejects stale or mismatched published evidence and never accepts generic booleans', async () => {
    const completedAt = new Date(fixed.getTime() - 1_000).toISOString();
    const base = await freshManifest();
    const manifest = executableYouPickManifestSchema.parse({
      ...base,
      checkpoint: 'awaiting-published-view-verification',
      published: true,
      groupListingId: 'LISTING-1',
      execution: {
        ...base.execution,
        ledger: base.execution.ledger.map((entry) =>
          entry.id === 'publish-group'
            ? {
                ...entry,
                state: 'completed' as const,
                attemptCount: 1,
                startedAt: new Date(fixed.getTime() - 2_000).toISOString(),
                completedAt,
              }
            : entry
        ),
      },
    });
    const validationNow = new Date(fixed.getTime() + 2_000);
    expect(() => validatePublishedViewAttestation(true, manifest, validationNow)).toThrow();
    expect(() => validatePublishedViewAttestation(undefined, manifest, validationNow)).toThrow(
      /Published-view attestation is required/
    );
    expect(() =>
      validatePublishedViewAttestation(
        { ...publishedAttestation(manifest), runId: '20260804T150000Z-ffffff' },
        manifest,
        validationNow
      )
    ).toThrow(/does not match/);
    expect(() =>
      validatePublishedViewAttestation(
        { ...publishedAttestation(manifest), observedAt: '2026-08-02T15:00:00.000Z' },
        manifest,
        validationNow
      )
    ).toThrow(/stale/);
  });

  it.each([
    ['before', -1_000, 2_000, false],
    ['equal', 0, 2_000, false],
    ['after', 1_000, 2_000, true],
    ['stale', -25 * 60 * 60 * 1_000, 2_000, false],
    ['future', 3_000, 2_000, false],
  ] as const)(
    'requires published and quantity evidence %s their completed operation',
    async (_label, observedOffset, nowOffset, accepted) => {
      let manifest = await freshManifest();
      manifest = withCompletedOperation(manifest, 'publish-group');
      manifest = withCompletedOperation(manifest, 'quantity-zero');
      manifest = executableYouPickManifestSchema.parse({
        ...manifest,
        published: true,
        groupListingId: 'LISTING-1',
      });
      const observedAt = new Date(fixed.getTime() + observedOffset).toISOString();
      const now = new Date(fixed.getTime() + nowOffset);
      const published = () =>
        validatePublishedViewAttestation(publishedAttestation(manifest, observedAt), manifest, now);
      const quantity = () =>
        validateQuantityZeroAttestation(quantityAttestation(manifest, observedAt), manifest, now);
      if (accepted) {
        expect(published).not.toThrow();
        expect(quantity).not.toThrow();
      } else {
        expect(published).toThrow();
        expect(quantity).toThrow();
      }
    }
  );

  it('fails attestation closed when the corresponding operation has no completion evidence', async () => {
    const manifest = executableYouPickManifestSchema.parse({
      ...(await freshManifest()),
      groupListingId: 'LISTING-1',
    });
    const observedAt = new Date(fixed.getTime() + 1_000).toISOString();
    const now = new Date(fixed.getTime() + 2_000);
    expect(() =>
      validatePublishedViewAttestation(publishedAttestation(manifest, observedAt), manifest, now)
    ).toThrow(/completed publish-group ledger evidence/);
    expect(() =>
      validateQuantityZeroAttestation(quantityAttestation(manifest, observedAt), manifest, now)
    ).toThrow(/completed quantity-zero ledger evidence/);
  });

  it('requires the exact ordered set of every non-target child and rejects the singular shape', async () => {
    let twoChild = await freshManifest();
    twoChild = withCompletedOperation(twoChild, 'quantity-zero');
    twoChild = executableYouPickManifestSchema.parse({
      ...twoChild,
      groupListingId: 'LISTING-1',
    });
    const observedAt = new Date(fixed.getTime() + 1_000).toISOString();
    const now = new Date(fixed.getTime() + 2_000);
    expect(() =>
      validateQuantityZeroAttestation(quantityAttestation(twoChild, observedAt), twoChild, now)
    ).not.toThrow();
    expect(() =>
      validateQuantityZeroAttestation(
        {
          ...quantityAttestation(twoChild, observedAt),
          remainingChildren: undefined,
          remainingSku: twoChild.run.childSkus[1],
          remainingPurchasable: true,
        },
        twoChild,
        now
      )
    ).toThrow();

    let threeChild = await freshThreeChildManifest();
    threeChild = withCompletedOperation(threeChild, 'quantity-zero');
    threeChild = executableYouPickManifestSchema.parse({
      ...threeChild,
      groupListingId: 'LISTING-1',
    });
    const exact = quantityAttestation(threeChild, observedAt);
    expect(() => validateQuantityZeroAttestation(exact, threeChild, now)).not.toThrow();
    for (const remainingChildren of [
      exact.remainingChildren.slice(0, 1),
      [...exact.remainingChildren].reverse(),
      [...exact.remainingChildren, exact.remainingChildren[0]],
      [exact.remainingChildren[0], exact.remainingChildren[0]],
    ])
      expect(() =>
        validateQuantityZeroAttestation({ ...exact, remainingChildren }, threeChild, now)
      ).toThrow();
  });

  it.each([
    [
      'non-target item digest drift',
      (state: any) => (state.items[1].snapshotDigest = 'f'.repeat(64)),
      false,
    ],
    [
      'non-target offer price/policy drift',
      (state: any) => (state.offers[1].snapshotDigest = 'f'.repeat(64)),
      false,
    ],
    ['changed ordered group membership', (state: any) => state.group.variantSKUs.reverse(), false],
    [
      'changed listing identity',
      (state: any) => (state.offers[1].listingId = 'LISTING-OTHER'),
      false,
    ],
    ['partial target zero', (state: any) => (state.items[0].quantity = 0), false],
    [
      'post-zero non-target drift',
      (state: any) => (state.offers[1].snapshotDigest = 'f'.repeat(64)),
      true,
    ],
  ] as const)('blocks quantity-zero on %s', async (_label, drift, resumeAfterZero) => {
    let manifest = await freshManifest();
    const plan = buildFuturePlan(manifest.execution.fixture, manifest.run);
    const operation = (id: string) => plan.operations.find((candidate) => candidate.id === id)!;
    manifest = executableYouPickManifestSchema.parse({
      ...manifest,
      checkpoint: 'awaiting-published-view-verification',
      published: true,
      groupListingId: 'LISTING-1',
      resources: manifest.resources.map((resource, index) => ({
        ...resource,
        offerId: `OFFER-${index + 1}`,
        offerStatus: 'PUBLISHED' as const,
      })),
    });
    manifest = withCompletedOperation(manifest, 'publish-group');
    const state = {
      group: {
        variantSKUs: [...manifest.run.childSkus],
        snapshotDigest: operation('group-complete').digest,
      },
      items: manifest.run.childSkus.map((sku, index) => ({
        sku,
        groupKeys: [manifest.run.groupKey],
        quantity: manifest.execution.fixture.children[index].itemQuantity,
        snapshotDigest: operation(`item-C0${index + 1}`).digest,
      })),
      offers: manifest.run.childSkus.map(
        (sku, index): RemoteOffer => ({
          offerId: `OFFER-${index + 1}`,
          sku,
          marketplaceId: 'EBAY_US',
          status: 'PUBLISHED',
          listingId: 'LISTING-1',
          listingStatus: 'ACTIVE',
          lifecycleClass: 'active',
          publicationObserved: true,
          listingCurrentlyActive: true,
          withdrawRequired: true,
          availableQuantity: manifest.execution.fixture.children[index].offerQuantity,
          snapshotDigest: operation(`offer-C0${index + 1}`).digest,
        })
      ),
    };
    if (resumeAfterZero) {
      const itemPayload = structuredClone(operation('item-C01').payload);
      (itemPayload.availability as any).shipToLocationAvailability.quantity = 0;
      state.items[0].quantity = 0;
      state.items[0].snapshotDigest = digest(itemPayload);
      const offerPayload = structuredClone(operation('offer-C01').payload);
      offerPayload.availableQuantity = 0;
      state.offers[0].availableQuantity = 0;
      state.offers[0].snapshotDigest = digest(offerPayload);
      manifest = executableYouPickManifestSchema.parse({
        ...manifest,
        checkpoint: 'setting-quantity-zero',
        execution: {
          ...manifest.execution,
          publishedAttestationDigest: 'f'.repeat(64),
          ledger: manifest.execution.ledger.map((entry) =>
            entry.id === 'quantity-zero'
              ? {
                  ...entry,
                  state: 'started' as const,
                  attemptCount: 1,
                  startedAt: fixed.toISOString(),
                }
              : entry
          ),
        },
      });
    }
    drift(state);
    const readApi: YouPickPilotReadApi = {
      ...gateApi(),
      getInventoryItemGroup: vi.fn(async () => ({ status: 'found', value: state.group })),
      getInventoryItem: vi.fn(async (sku) => ({
        status: 'found',
        value: state.items[manifest.run.childSkus.indexOf(sku)],
      })),
      getOffers: vi.fn(async (sku) => ({
        status: 'found',
        value: { offers: [state.offers[manifest.run.childSkus.indexOf(sku)]] },
      })),
    };
    const mutationApi = {
      bulkUpdatePriceQuantity: vi.fn(),
    } as unknown as YouPickPilotMutationApi;
    await expect(
      executeYouPickManifest({
        manifest,
        readApi,
        mutationApi,
        headers: { 'Content-Language': 'en-US' },
        cleanup: false,
        attestation: publishedAttestation(manifest),
        now: () => new Date(fixed.getTime() + 2_000),
        persist: async (next) => {
          manifest = next;
        },
      })
    ).rejects.toThrow();
    expect(mutationApi.bulkUpdatePriceQuantity).not.toHaveBeenCalled();
  });

  it('recovers an exact completed item without replay and blocks a mismatched owned SKU', async () => {
    const manifest = await freshManifest();
    const plan = buildFuturePlan(manifest.execution.fixture, manifest.run);
    const first = plan.operations.find((operation) => operation.id === 'item-C01')!;
    const readApi = gateApi();
    readApi.getInventoryItem = vi.fn(async (sku) => ({
      status: 'found',
      value: {
        sku,
        groupKeys: null,
        snapshotDigest: sku.endsWith('C01') ? first.digest : 'f'.repeat(64),
      },
    }));
    const mutationApi = {
      createOrReplaceInventoryItem: vi.fn(),
      createOffer: vi.fn(),
      createOrReplaceInventoryItemGroup: vi.fn(),
      publishInventoryItemGroup: vi.fn(),
      bulkUpdatePriceQuantity: vi.fn(),
      withdrawInventoryItemGroup: vi.fn(),
      deleteOffer: vi.fn(),
      deleteInventoryItemGroup: vi.fn(),
      deleteInventoryItem: vi.fn(),
    } as unknown as YouPickPilotMutationApi;
    await expect(
      executeYouPickManifest({
        manifest,
        readApi,
        mutationApi,
        headers: { 'Content-Language': 'en-US' },
        cleanup: false,
        now: () => fixed,
        persist: async () => undefined,
      })
    ).rejects.toThrow(/immutable planned payload digest/);
    expect(mutationApi.createOrReplaceInventoryItem).not.toHaveBeenCalled();
  });

  it('blocks duplicate exact-SKU offers without creating or adopting either', async () => {
    let manifest = await freshManifest();
    const plan = buildFuturePlan(manifest.execution.fixture, manifest.run);
    const operationDigest = (operationId: string) =>
      plan.operations.find((operation) => operation.id === operationId)!.digest;
    const baseOffer = (offerId: string): RemoteOffer => ({
      offerId,
      sku: manifest.run.childSkus[0],
      marketplaceId: 'EBAY_US',
      status: 'UNPUBLISHED',
      listingId: null,
      listingStatus: null,
      lifecycleClass: null,
      publicationObserved: false,
      listingCurrentlyActive: false,
      withdrawRequired: false,
      snapshotDigest: operationDigest('offer-C01'),
    });
    const readApi: YouPickPilotReadApi = {
      ...gateApi(),
      getInventoryItem: vi.fn(async (sku) => ({
        status: 'found',
        value: {
          sku,
          groupKeys: null,
          snapshotDigest: operationDigest(sku.endsWith('C01') ? 'item-C01' : 'item-C02'),
        },
      })),
      getOffers: vi.fn(async () => ({
        status: 'found',
        value: { offers: [baseOffer('OFFER-1'), baseOffer('OFFER-2')] },
      })),
    };
    const mutationApi = {
      createOrReplaceInventoryItem: vi.fn(),
      createOffer: vi.fn(),
      createOrReplaceInventoryItemGroup: vi.fn(),
      publishInventoryItemGroup: vi.fn(),
      bulkUpdatePriceQuantity: vi.fn(),
      withdrawInventoryItemGroup: vi.fn(),
      deleteOffer: vi.fn(),
      deleteInventoryItemGroup: vi.fn(),
      deleteInventoryItem: vi.fn(),
    } as unknown as YouPickPilotMutationApi;
    await expect(
      executeYouPickManifest({
        manifest,
        readApi,
        mutationApi,
        headers: { 'Content-Language': 'en-US' },
        cleanup: false,
        now: () => fixed,
        persist: async (next) => {
          manifest = next;
        },
      })
    ).rejects.toThrow(/duplicate offers/);
    expect(mutationApi.createOffer).not.toHaveBeenCalled();
  });

  it.each([
    [
      'INACTIVE',
      (offers: RemoteOffer[]) =>
        offers.map((offer) => ({
          ...offer,
          listingStatus: 'INACTIVE' as const,
          lifecycleClass: 'ambiguous' as const,
          listingCurrentlyActive: null,
          withdrawRequired: null,
        })),
    ],
    [
      'conflicting listing IDs',
      (offers: RemoteOffer[]) =>
        offers.map((offer, index) => ({ ...offer, listingId: `L-${index}` })),
    ],
    [
      'mixed active and ended states',
      (offers: RemoteOffer[]) =>
        offers.map((offer, index) =>
          index === 0
            ? offer
            : {
                ...offer,
                listingStatus: 'ENDED' as const,
                lifecycleClass: 'ended' as const,
                listingCurrentlyActive: false,
                withdrawRequired: false,
              }
        ),
    ],
    [
      'mixed published and unpublished states',
      (offers: RemoteOffer[]) =>
        offers.map((offer, index) =>
          index === 0
            ? offer
            : {
                ...offer,
                status: 'UNPUBLISHED' as const,
                listingId: null,
                listingStatus: null,
                lifecycleClass: null,
                publicationObserved: false,
                listingCurrentlyActive: false,
                withdrawRequired: false,
              }
        ),
    ],
    [
      'missing lifecycle details',
      (offers: RemoteOffer[]) => offers.map((offer) => ({ ...offer, lifecycleClass: null })),
    ],
    [
      'duplicate offers',
      (offers: RemoteOffer[]) => [
        [offers[0]!, { ...offers[0]!, offerId: 'DUPLICATE' }],
        [offers[1]!],
      ],
    ],
    [
      'null withdrawRequired',
      (offers: RemoteOffer[]) => offers.map((offer) => ({ ...offer, withdrawRequired: null })),
    ],
  ])('blocks cleanup on %s with zero destructive calls', async (_label, transform) => {
    let manifest = await freshManifest();
    const plan = buildFuturePlan(manifest.execution.fixture, manifest.run);
    const operation = (id: string) => plan.operations.find((candidate) => candidate.id === id)!;
    manifest = executableYouPickManifestSchema.parse({
      ...manifest,
      checkpoint: 'withdrawal-ready',
      published: true,
      groupListingId: 'LISTING-1',
      resources: manifest.resources.map((resource, index) => ({
        ...resource,
        offerId: `OFFER-${index + 1}`,
        offerStatus: 'PUBLISHED' as const,
      })),
    });
    const baseOffers = manifest.run.childSkus.map(
      (sku, index): RemoteOffer => ({
        offerId: `OFFER-${index + 1}`,
        sku,
        marketplaceId: 'EBAY_US',
        status: 'PUBLISHED',
        listingId: 'LISTING-1',
        listingStatus: 'ACTIVE',
        lifecycleClass: 'active',
        publicationObserved: true,
        listingCurrentlyActive: true,
        withdrawRequired: true,
        availableQuantity: manifest.execution.fixture.children[index].offerQuantity,
        snapshotDigest: operation(`offer-C0${index + 1}`).digest,
      })
    );
    const transformed = transform(baseOffers) as RemoteOffer[] | RemoteOffer[][];
    const readApi: YouPickPilotReadApi = {
      ...gateApi(),
      getInventoryItemGroup: vi.fn(async () => ({
        status: 'found',
        value: {
          variantSKUs: manifest.run.childSkus,
          snapshotDigest: operation('group-complete').digest,
        },
      })),
      getInventoryItem: vi.fn(async (sku) => {
        const index = manifest.run.childSkus.indexOf(sku);
        return {
          status: 'found',
          value: {
            sku,
            groupKeys: [manifest.run.groupKey],
            quantity: manifest.execution.fixture.children[index].itemQuantity,
            snapshotDigest: operation(`item-C0${index + 1}`).digest,
          },
        };
      }),
      getOffers: vi.fn(async (sku) => {
        const index = manifest.run.childSkus.indexOf(sku);
        const offers = Array.isArray(transformed[0])
          ? (transformed as RemoteOffer[][])[index]
          : [(transformed as RemoteOffer[])[index]];
        return { status: 'found', value: { offers } };
      }),
    };
    const mutationApi = {
      createOrReplaceInventoryItem: vi.fn(),
      createOffer: vi.fn(),
      createOrReplaceInventoryItemGroup: vi.fn(),
      publishInventoryItemGroup: vi.fn(),
      bulkUpdatePriceQuantity: vi.fn(),
      withdrawInventoryItemGroup: vi.fn(),
      deleteOffer: vi.fn(),
      deleteInventoryItemGroup: vi.fn(),
      deleteInventoryItem: vi.fn(),
    } as unknown as YouPickPilotMutationApi;
    await expect(
      executeYouPickManifest({
        manifest,
        readApi,
        mutationApi,
        headers: { 'Content-Language': 'en-US' },
        cleanup: true,
        now: () => fixed,
        persist: async (next) => {
          manifest = next;
        },
      })
    ).rejects.toThrow();
    expect(mutationApi.withdrawInventoryItemGroup).not.toHaveBeenCalled();
    expect(mutationApi.deleteOffer).not.toHaveBeenCalled();
    expect(mutationApi.deleteInventoryItemGroup).not.toHaveBeenCalled();
    expect(mutationApi.deleteInventoryItem).not.toHaveBeenCalled();
  });

  it.each(['started', 'unknown'] as const)(
    'does not replay an unresolved %s create when reads prove neither state',
    async (ledgerState) => {
      let manifest = withUnresolvedOperation(await freshManifest(), 'item-C01', ledgerState);
      let reads = 0;
      const readApi = gateApi();
      readApi.getInventoryItem = vi.fn(async () =>
        reads++ === 0 ? { status: 'missing' } : { status: 'unknown' }
      );
      const mutationApi = mutationSpies();
      await expect(
        executeYouPickManifest({
          manifest,
          readApi,
          mutationApi,
          headers: { 'Content-Language': 'en-US' },
          cleanup: false,
          now: () => fixed,
          persist: async (next) => {
            manifest = next;
          },
        })
      ).rejects.toThrow(/remains unresolved/);
      expect(mutationApi.createOrReplaceInventoryItem).not.toHaveBeenCalled();
      expect(manifest.execution.ledger.find((entry) => entry.id === 'item-C01')?.state).toBe(
        'unknown'
      );
    }
  );

  it.each(['thrown read error', 'malformed or mismatched snapshot'] as const)(
    'does not treat a %s as exact create pre-state',
    async (failure) => {
      let manifest = withUnresolvedOperation(await freshManifest(), 'item-C01', 'started');
      let reads = 0;
      const readApi = gateApi();
      readApi.getInventoryItem = vi.fn(async (sku) => {
        if (reads++ === 0) return { status: 'missing' };
        if (failure === 'thrown read error') throw new Error('synthetic read failure');
        return {
          status: 'found',
          value: { sku, groupKeys: ['FOREIGN-GROUP'], snapshotDigest: 'f'.repeat(64) },
        };
      });
      const mutationApi = mutationSpies();
      await expect(
        executeYouPickManifest({
          manifest,
          readApi,
          mutationApi,
          headers: { 'Content-Language': 'en-US' },
          cleanup: false,
          now: () => fixed,
          persist: async (next) => {
            manifest = next;
          },
        })
      ).rejects.toThrow(/remains unresolved/);
      expect(mutationApi.createOrReplaceInventoryItem).not.toHaveBeenCalled();
      expect(manifest.execution.ledger.find((entry) => entry.id === 'item-C01')?.state).toBe(
        'unknown'
      );
    }
  );

  it.each(['started', 'unknown'] as const)(
    'allows exactly one bounded %s retry only after exact create pre-state is proven',
    async (ledgerState) => {
      let manifest = withUnresolvedOperation(await freshManifest(), 'item-C01', ledgerState);
      const plan = buildFuturePlan(manifest.execution.fixture, manifest.run);
      const expected = plan.operations.find((operation) => operation.id === 'item-C01')!.digest;
      let exists = false;
      const readApi = gateApi();
      readApi.getInventoryItem = vi.fn(async (sku) => {
        if (!sku.endsWith('C01')) return { status: 'unknown' };
        return exists
          ? { status: 'found', value: { sku, groupKeys: null, snapshotDigest: expected } }
          : { status: 'missing' };
      });
      const mutationApi = mutationSpies();
      mutationApi.createOrReplaceInventoryItem = vi.fn(async () => {
        exists = true;
      });
      await expect(
        executeYouPickManifest({
          manifest,
          readApi,
          mutationApi,
          headers: { 'Content-Language': 'en-US' },
          cleanup: false,
          now: () => fixed,
          persist: async (next) => {
            manifest = next;
          },
        })
      ).rejects.toThrow(/pre-state is unknown/);
      expect(mutationApi.createOrReplaceInventoryItem).toHaveBeenCalledOnce();
      expect(manifest.execution.ledger.find((entry) => entry.id === 'item-C01')?.state).toBe(
        'completed'
      );
    }
  );

  it.each(['started', 'unknown'] as const)(
    'does not replay an unresolved %s publish when reads become ambiguous',
    async (ledgerState) => {
      let manifest = withUnresolvedOperation(await freshManifest(), 'publish-group', ledgerState);
      const plan = buildFuturePlan(manifest.execution.fixture, manifest.run);
      const operation = (id: string) => plan.operations.find((candidate) => candidate.id === id)!;
      const offerReads = new Map<string, number>();
      const readApi: YouPickPilotReadApi = {
        ...gateApi(),
        getInventoryItem: vi.fn(async (sku) => ({
          status: 'found',
          value: {
            sku,
            groupKeys: [manifest.run.groupKey],
            snapshotDigest: operation(`item-C0${manifest.run.childSkus.indexOf(sku) + 1}`).digest,
          },
        })),
        getInventoryItemGroup: vi.fn(async () => ({
          status: 'found',
          value: {
            variantSKUs: manifest.run.childSkus,
            snapshotDigest: operation('group-complete').digest,
          },
        })),
        getOffers: vi.fn(async (sku) => {
          const count = (offerReads.get(sku) ?? 0) + 1;
          offerReads.set(sku, count);
          if (count >= 4) return { status: 'unknown' };
          const index = manifest.run.childSkus.indexOf(sku);
          return {
            status: 'found',
            value: {
              offers: [
                {
                  offerId: `OFFER-${index + 1}`,
                  sku,
                  marketplaceId: 'EBAY_US',
                  status: 'UNPUBLISHED',
                  listingId: null,
                  listingStatus: null,
                  lifecycleClass: null,
                  publicationObserved: false,
                  listingCurrentlyActive: false,
                  withdrawRequired: false,
                  snapshotDigest: operation(`offer-C0${index + 1}`).digest,
                },
              ],
            },
          };
        }),
      };
      const mutationApi = mutationSpies();
      await expect(
        executeYouPickManifest({
          manifest,
          readApi,
          mutationApi,
          headers: { 'Content-Language': 'en-US' },
          cleanup: false,
          now: () => fixed,
          persist: async (next) => {
            manifest = next;
          },
        })
      ).rejects.toThrow(/remains unresolved/);
      expect(mutationApi.publishInventoryItemGroup).not.toHaveBeenCalled();
    }
  );

  it.each(['started', 'unknown'] as const)(
    'does not replay an unresolved %s quantity update when recovery reads are unknown',
    async (ledgerState) => {
      let manifest = await freshManifest();
      const plan = buildFuturePlan(manifest.execution.fixture, manifest.run);
      const operation = (id: string) => plan.operations.find((candidate) => candidate.id === id)!;
      manifest = executableYouPickManifestSchema.parse({
        ...manifest,
        checkpoint: 'setting-quantity-zero',
        published: true,
        groupListingId: 'LISTING-1',
        resources: manifest.resources.map((resource, index) => ({
          ...resource,
          offerId: `OFFER-${index + 1}`,
          offerStatus: 'PUBLISHED' as const,
        })),
        execution: {
          ...manifest.execution,
          publishedAttestationDigest: 'f'.repeat(64),
        },
      });
      manifest = withUnresolvedOperation(manifest, 'quantity-zero', ledgerState);
      let groupReads = 0;
      const readApi: YouPickPilotReadApi = {
        ...gateApi(),
        getInventoryItemGroup: vi.fn(async () =>
          ++groupReads >= 3
            ? { status: 'unknown' }
            : {
                status: 'found',
                value: {
                  variantSKUs: manifest.run.childSkus,
                  snapshotDigest: operation('group-complete').digest,
                },
              }
        ),
        getInventoryItem: vi.fn(async (sku) => {
          const index = manifest.run.childSkus.indexOf(sku);
          return {
            status: 'found',
            value: {
              sku,
              groupKeys: [manifest.run.groupKey],
              quantity: manifest.ownership.itemQuantities[index],
              snapshotDigest: operation(`item-C0${index + 1}`).digest,
            },
          };
        }),
        getOffers: vi.fn(async (sku) => {
          const index = manifest.run.childSkus.indexOf(sku);
          return {
            status: 'found',
            value: {
              offers: [
                {
                  offerId: `OFFER-${index + 1}`,
                  sku,
                  marketplaceId: 'EBAY_US',
                  status: 'PUBLISHED',
                  listingId: 'LISTING-1',
                  listingStatus: 'ACTIVE',
                  lifecycleClass: 'active',
                  publicationObserved: true,
                  listingCurrentlyActive: true,
                  withdrawRequired: true,
                  availableQuantity: manifest.ownership.offerQuantities[index],
                  snapshotDigest: operation(`offer-C0${index + 1}`).digest,
                },
              ],
            },
          };
        }),
      };
      const mutationApi = mutationSpies();
      await expect(
        executeYouPickManifest({
          manifest,
          readApi,
          mutationApi,
          headers: { 'Content-Language': 'en-US' },
          cleanup: false,
          now: () => fixed,
          persist: async (next) => {
            manifest = next;
          },
        })
      ).rejects.toThrow(/remains unresolved/);
      expect(mutationApi.bulkUpdatePriceQuantity).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['withdraw-group', 'started', 'withdrawInventoryItemGroup', 'active'],
    ['withdraw-group', 'unknown', 'withdrawInventoryItemGroup', 'active'],
    ['cleanup-offer-C02', 'started', 'deleteOffer', 'ended'],
    ['cleanup-offer-C02', 'unknown', 'deleteOffer', 'ended'],
  ] as const)(
    'does not replay unresolved %s cleanup mutation from %s ledger state',
    async (operationId, ledgerState, mutationName, lifecycle) => {
      let manifest = await freshManifest();
      const plan = buildFuturePlan(manifest.execution.fixture, manifest.run);
      const operation = (id: string) => plan.operations.find((candidate) => candidate.id === id)!;
      manifest = executableYouPickManifestSchema.parse({
        ...manifest,
        checkpoint: 'withdrawal-ready',
        published: true,
        groupListingId: 'LISTING-1',
        resources: manifest.resources.map((resource, index) => ({
          ...resource,
          offerId: `OFFER-${index + 1}`,
          offerStatus: 'PUBLISHED' as const,
        })),
      });
      manifest = withUnresolvedOperation(manifest, operationId, ledgerState);
      const offerReads = new Map<string, number>();
      const readApi: YouPickPilotReadApi = {
        ...gateApi(),
        getInventoryItemGroup: vi.fn(async () => ({
          status: 'found',
          value: {
            variantSKUs: manifest.run.childSkus,
            snapshotDigest: operation('group-complete').digest,
          },
        })),
        getInventoryItem: vi.fn(async (sku) => {
          const index = manifest.run.childSkus.indexOf(sku);
          return {
            status: 'found',
            value: {
              sku,
              groupKeys: [manifest.run.groupKey],
              quantity: manifest.ownership.itemQuantities[index],
              snapshotDigest: operation(`item-C0${index + 1}`).digest,
            },
          };
        }),
        getOffers: vi.fn(async (sku) => {
          const count = (offerReads.get(sku) ?? 0) + 1;
          offerReads.set(sku, count);
          const unknownAt = operationId === 'withdraw-group' ? 3 : 4;
          if (count >= unknownAt && (operationId === 'withdraw-group' || sku.endsWith('C02')))
            return { status: 'unknown' };
          const index = manifest.run.childSkus.indexOf(sku);
          const active = lifecycle === 'active';
          return {
            status: 'found',
            value: {
              offers: [
                {
                  offerId: `OFFER-${index + 1}`,
                  sku,
                  marketplaceId: 'EBAY_US',
                  status: 'PUBLISHED',
                  listingId: 'LISTING-1',
                  listingStatus: active ? 'ACTIVE' : 'ENDED',
                  lifecycleClass: lifecycle,
                  publicationObserved: true,
                  listingCurrentlyActive: active,
                  withdrawRequired: active,
                  availableQuantity: manifest.ownership.offerQuantities[index],
                  snapshotDigest: operation(`offer-C0${index + 1}`).digest,
                },
              ],
            },
          };
        }),
      };
      const mutationApi = mutationSpies();
      await expect(
        executeYouPickManifest({
          manifest,
          readApi,
          mutationApi,
          headers: { 'Content-Language': 'en-US' },
          cleanup: true,
          now: () => fixed,
          persist: async (next) => {
            manifest = next;
          },
        })
      ).rejects.toThrow(/remains unresolved/);
      expect(mutationApi[mutationName]).not.toHaveBeenCalled();
      expect(mutationApi.deleteInventoryItemGroup).not.toHaveBeenCalled();
      expect(mutationApi.deleteInventoryItem).not.toHaveBeenCalled();
    }
  );

  it('persists an unknown checkpoint when a malformed mutation response has no after-state', async () => {
    let manifest = await freshManifest();
    const mutationApi = {
      createOrReplaceInventoryItem: vi.fn(async () => ({ unexpected: true })),
      createOffer: vi.fn(),
      createOrReplaceInventoryItemGroup: vi.fn(),
      publishInventoryItemGroup: vi.fn(),
      bulkUpdatePriceQuantity: vi.fn(),
      withdrawInventoryItemGroup: vi.fn(),
      deleteOffer: vi.fn(),
      deleteInventoryItemGroup: vi.fn(),
      deleteInventoryItem: vi.fn(),
    } as unknown as YouPickPilotMutationApi;
    await expect(
      executeYouPickManifest({
        manifest,
        readApi: gateApi(),
        mutationApi,
        headers: { 'Content-Language': 'en-US' },
        cleanup: false,
        now: () => fixed,
        persist: async (next) => {
          manifest = next;
        },
      })
    ).rejects.toThrow(/outcome is unknown/);
    expect(manifest.execution.ledger.find((entry) => entry.id === 'item-C01')).toEqual(
      expect.objectContaining({ state: 'unknown', attemptCount: 1 })
    );
  });

  it('cleans and resumes from a partial child-only checkpoint without prefix scanning', async () => {
    let manifest = executableYouPickManifestSchema.parse({
      ...(await freshManifest()),
      checkpoint: 'creating-items',
    });
    const plan = buildFuturePlan(manifest.execution.fixture, manifest.run);
    const firstDigest = plan.operations.find((operation) => operation.id === 'item-C01')!.digest;
    let firstExists = true;
    const readApi: YouPickPilotReadApi = {
      ...gateApi(),
      getInventoryItemGroup: vi.fn(async () => ({ status: 'missing' })),
      getInventoryItem: vi.fn(async (sku) =>
        firstExists && sku === manifest.run.childSkus[0]
          ? {
              status: 'found',
              value: { sku, groupKeys: null, quantity: 1, snapshotDigest: firstDigest },
            }
          : { status: 'missing' }
      ),
      getOffers: vi.fn(async () => ({ status: 'found', value: { offers: [] } })),
    };
    const mutationApi = {
      createOrReplaceInventoryItem: vi.fn(),
      createOffer: vi.fn(),
      createOrReplaceInventoryItemGroup: vi.fn(),
      publishInventoryItemGroup: vi.fn(),
      bulkUpdatePriceQuantity: vi.fn(),
      withdrawInventoryItemGroup: vi.fn(),
      deleteOffer: vi.fn(),
      deleteInventoryItemGroup: vi.fn(),
      deleteInventoryItem: vi.fn(async (sku: string) => {
        expect(sku).toBe(manifest.run.childSkus[0]);
        firstExists = false;
      }),
    } as unknown as YouPickPilotMutationApi;
    const result = await executeYouPickManifest({
      manifest,
      readApi,
      mutationApi,
      headers: { 'Content-Language': 'en-US' },
      cleanup: true,
      now: () => fixed,
      persist: async (next) => {
        manifest = next;
      },
    });
    expect(result.checkpoint).toBe('cleanup-complete');
    expect(mutationApi.deleteInventoryItem).toHaveBeenCalledOnce();
    expect(mutationApi.deleteOffer).not.toHaveBeenCalled();
    expect(mutationApi.deleteInventoryItemGroup).not.toHaveBeenCalled();
  });
});
