import { existsSync } from 'fs';
import { access, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  VARIATION_LISTING_EXECUTION_ERROR,
  assertExecutableManifestIntegrity,
  assertSafeManifestPath,
  buildCleanupPlan,
  buildFuturePlan,
  buildGuardedMutationHeaders,
  classifyVariationListingStatus,
  digest,
  executableVariationListingManifestSchema,
  generateRunIdentity,
  inventoryItemSemanticMismatch,
  matchesVariationListingGroupChildren,
  parseCurrentUserIdentity,
  projectInventoryItemSemanticSnapshot,
  projectOfferSemanticSnapshot,
  readManifest,
  resolveFuturePlan,
  runVariationListingSandboxPilot,
  sanitizeReport,
  validateRunIdentity,
  writeManifestAtomic,
  variationListingFixtureSchema,
  type RuntimeSnapshot,
  type ExecutableVariationListingManifest,
  type RemoteOffer,
  type VariationListingStatus,
  type VariationListingManifest,
  type VariationListingPilotReadApi,
} from '@/ebay/variation-listing-sandbox-pilot.js';
import {
  executeVariationListingManifest,
  type VariationListingPilotMutationApi,
} from '@/ebay/variation-listing-sandbox-pilot-mutation.js';
import * as variationListingMutation from '@/ebay/variation-listing-sandbox-pilot-mutation.js';
import {
  normalizeVariationListingGroup,
  normalizeVariationListingItem,
} from '@/scripts/variation-listing-sandbox-pilot.js';

const fixturePath = fileURLToPath(
  new URL('../../fixtures/you-pick-sandbox/two-card.json', import.meta.url)
);
const legacyFixturePath = fileURLToPath(
  new URL('../../fixtures/you-pick-sandbox/two-card-legacy-v1.json', import.meta.url)
);
const currentManifestPath = fileURLToPath(
  new URL(
    '../../../../../.local/you-pick-sandbox/20260804T173924Z-967292/manifest.json',
    import.meta.url
  )
);
const currentManifestRoot = fileURLToPath(
  new URL('../../../../../.local/you-pick-sandbox', import.meta.url)
);
const fixedDate = new Date('2026-08-03T15:17:00.000Z');
const fixedRandom = () => Buffer.from('a1b2c3', 'hex');
const tempRoots: string[] = [];

function remoteOffer(input: {
  sku: string;
  offerId?: string;
  marketplaceId?: string;
  status?: RemoteOffer['status'];
  listingId?: string | null;
  listingStatus?: VariationListingStatus | null;
  semanticPayload?: unknown;
}): RemoteOffer {
  const status = input.status ?? 'PUBLISHED';
  const listingStatus = input.listingStatus === undefined ? 'ACTIVE' : input.listingStatus;
  const listingId = input.listingId === undefined ? 'LISTING-1' : input.listingId;
  const lifecycle = classifyVariationListingStatus(listingStatus);
  return {
    offerId: input.offerId ?? (input.sku.endsWith('C01') ? 'OFFER-1' : 'OFFER-2'),
    sku: input.sku,
    marketplaceId: input.marketplaceId ?? 'EBAY_US',
    status,
    listingId,
    listingStatus,
    lifecycleClass: lifecycle.lifecycleClass,
    publicationObserved: status === 'PUBLISHED' || lifecycle.publicationObserved,
    listingCurrentlyActive: lifecycle.listingCurrentlyActive,
    withdrawRequired: lifecycle.withdrawRequired,
    semanticSnapshot:
      input.semanticPayload === undefined
        ? undefined
        : projectOfferSemanticSnapshot(input.semanticPayload),
  };
}

async function tempRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'variation-listing-pilot-'));
  tempRoots.push(root);
  return root;
}

const runtime: RuntimeSnapshot = {
  environment: 'sandbox',
  restOrigin: 'https://api.sandbox.ebay.com',
  oauthOrigin: 'https://api.sandbox.ebay.com',
  tradingOrigin: 'https://api.sandbox.ebay.com',
  marketplaceId: 'EBAY_US',
  contentLanguage: 'en-US',
  hasUserRefreshToken: true,
  grantedUserScopes: ['https://api.ebay.com/oauth/api_scope/sell.inventory'],
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
};

function createApi(
  overrides: Partial<VariationListingPilotReadApi> = {}
): VariationListingPilotReadApi {
  return {
    getRuntimeSnapshot: vi.fn(async () => runtime),
    getCurrentUserIdentity: vi.fn(async () => ({
      userId: 'sandbox-seller-123',
      username: 'pilot-seller',
    })),
    getPolicyLocationSnapshot: vi.fn(async () => ({
      fulfillment: [
        {
          id: 'FULFILLMENT-PILOT',
          marketplaceId: 'EBAY_US',
          ownerUserId: 'sandbox-seller-123',
        },
      ],
      payment: [
        {
          id: 'PAYMENT-PILOT',
          marketplaceId: 'EBAY_US',
          ownerUserId: 'sandbox-seller-123',
        },
      ],
      returns: [
        {
          id: 'RETURN-PILOT',
          marketplaceId: 'EBAY_US',
          ownerUserId: 'sandbox-seller-123',
        },
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
      selectorCandidates: ['Card', 'Card Selection'],
      conditions: [
        {
          conditionId: '4000',
          conditionDescription: 'Very Good',
          inventoryCondition: 'USED_VERY_GOOD',
          conditionDescriptors: [
            {
              id: '40001',
              name: 'Card Condition',
              values: [{ id: '400012', name: 'Very Good' }],
            },
          ],
        },
      ],
    })),
    getInventoryItemGroup: vi.fn(async () => ({ status: 'missing' as const })),
    getInventoryItem: vi.fn(async () => ({ status: 'missing' as const })),
    getOffers: vi.fn(async () => ({ status: 'found' as const, value: { offers: [] } })),
    ...overrides,
  };
}

function createMutationApi(): VariationListingPilotMutationApi {
  return {
    createOrReplaceInventoryItem: vi.fn(async () => undefined),
    createOffer: vi.fn(async () => undefined),
    createOrReplaceInventoryItemGroup: vi.fn(async () => undefined),
    publishInventoryItemGroup: vi.fn(async () => undefined),
    bulkUpdatePriceQuantity: vi.fn(async () => undefined),
    withdrawInventoryItemGroup: vi.fn(async () => undefined),
    deleteOffer: vi.fn(async () => undefined),
    deleteInventoryItemGroup: vi.fn(async () => undefined),
    deleteInventoryItem: vi.fn(async () => undefined),
  };
}

function unknownC01Manifest(
  manifest: VariationListingManifest
): ExecutableVariationListingManifest {
  const attemptedAt = '2026-08-04T21:00:00.000Z';
  return executableVariationListingManifestSchema.parse({
    ...manifest,
    checkpoint: 'creating-items',
    execution: {
      ...('execution' in manifest ? manifest.execution : {}),
      ledger:
        'execution' in manifest
          ? manifest.execution.ledger.map((entry) =>
              entry.id === 'item-C01'
                ? {
                    ...entry,
                    state: 'unknown',
                    attemptCount: 1,
                    startedAt: attemptedAt,
                    completedAt: null,
                    result: null,
                    error: 'prior response and reconciliation outcome unknown',
                    readBackDigest: null,
                  }
                : entry
            )
          : [],
    },
  });
}

function verifyingUnpublishedManifest(
  manifest: VariationListingManifest
): ExecutableVariationListingManifest {
  if (!('execution' in manifest)) throw new Error('Expected an executable manifest.');
  const completedAt = '2026-08-05T14:32:58.598Z';
  const completed = new Set(['item-C01', 'item-C02', 'offer-C01', 'offer-C02', 'group-complete']);
  const offerIds = ['11409899010', '11409959010'];
  return executableVariationListingManifestSchema.parse({
    ...manifest,
    checkpoint: 'verifying-unpublished',
    published: false,
    groupListingId: null,
    resources: manifest.resources.map((resource, index) => ({
      ...resource,
      offerId: offerIds[index],
      offerStatus: 'UNPUBLISHED',
    })),
    execution: {
      ...manifest.execution,
      ledger: manifest.execution.ledger.map((entry) =>
        completed.has(entry.id)
          ? {
              ...entry,
              state: 'completed',
              attemptCount: 1,
              startedAt: completedAt,
              completedAt,
              result: entry.id.startsWith('offer-')
                ? { offerId: offerIds[entry.id === 'offer-C01' ? 0 : 1] }
                : null,
              error: null,
              readBackDigest: 'a'.repeat(64),
            }
          : entry
      ),
    },
  });
}

async function prepareExecutionCheckpoint(
  root: string,
  checkpoint: 'awaiting-published-view-verification' | 'awaiting-quantity-zero-verification'
) {
  const fresh = await runFresh(root);
  const localRoot = join(root, '.local', 'you-pick-sandbox');
  const manifest = await readManifest(fresh.manifestPath, localRoot);
  if (!('execution' in manifest)) throw new Error('Expected an executable manifest.');
  const completedAt = '2026-08-05T14:32:58.598Z';
  const completed = new Set([
    'item-C01',
    'item-C02',
    'offer-C01',
    'offer-C02',
    'group-complete',
    'publish-group',
    ...(checkpoint === 'awaiting-quantity-zero-verification' ? ['quantity-zero'] : []),
  ]);
  const offerIds = ['11409899010', '11409959010'];
  const executable = executableVariationListingManifestSchema.parse({
    ...manifest,
    checkpoint,
    published: true,
    groupListingId: '110590142987',
    resources: manifest.resources.map((resource, index) => ({
      ...resource,
      offerId: offerIds[index],
      offerStatus: 'PUBLISHED',
    })),
    execution: {
      ...manifest.execution,
      publishedAttestationDigest:
        checkpoint === 'awaiting-quantity-zero-verification' ? 'b'.repeat(64) : null,
      ledger: manifest.execution.ledger.map((entry) =>
        completed.has(entry.id)
          ? {
              ...entry,
              state: 'completed',
              attemptCount: 1,
              startedAt: completedAt,
              completedAt,
              result:
                entry.id === 'publish-group'
                  ? { listingId: '110590142987' }
                  : entry.id.startsWith('offer-')
                    ? { offerId: offerIds[entry.id === 'offer-C01' ? 0 : 1] }
                    : null,
              error: null,
              readBackDigest: 'a'.repeat(64),
            }
          : entry
      ),
    },
  });
  await writeManifestAtomic(fresh.manifestPath, executable, localRoot);
  return { manifestPath: fresh.manifestPath, localRoot, manifest: executable };
}

async function loadFixture(): Promise<unknown> {
  return JSON.parse(await readFile(fixturePath, 'utf8')) as unknown;
}

async function loadLegacyFixture(): Promise<unknown> {
  return JSON.parse(await readFile(legacyFixturePath, 'utf8')) as unknown;
}

async function runFresh(root: string, api = createApi()) {
  return await runVariationListingSandboxPilot({
    api,
    fixturePath,
    repoRoot: root,
    now: () => fixedDate,
    randomBytesImpl: fixedRandom,
  });
}

async function prepareCleanup(root: string, published: boolean) {
  const fresh = await runFresh(root);
  const localRoot = join(root, '.local', 'you-pick-sandbox');
  const manifest = await readManifest(fresh.manifestPath, localRoot);
  const recorded: VariationListingManifest = {
    ...manifest,
    published,
    groupListingId: published ? 'LISTING-1' : null,
    resources: manifest.resources.map((resource, index) => ({
      ...resource,
      offerId: `OFFER-${index + 1}`,
      offerStatus: published ? 'PUBLISHED' : 'UNPUBLISHED',
    })),
  };
  await writeManifestAtomic(fresh.manifestPath, recorded, localRoot);
  return { fresh, manifest: recorded };
}

function cleanupApi(
  manifest: VariationListingManifest,
  offerFactory: (sku: string) => RemoteOffer[]
): VariationListingPilotReadApi {
  return createApi({
    getInventoryItemGroup: vi.fn(async () => ({
      status: 'found',
      value: { variantSKUs: manifest.run.childSkus },
    })),
    getInventoryItem: vi.fn(async (sku) => ({
      status: 'found',
      value: { sku, groupKeys: [manifest.run.groupKey] },
    })),
    getOffers: vi.fn(async (sku) => ({
      status: 'found',
      value: { offers: offerFactory(sku) },
    })),
  });
}

function cleanupExecutionHarness(
  manifest: ExecutableVariationListingManifest,
  failFinalGroupAbsence = false
) {
  const plan = buildFuturePlan(manifest.execution.fixture, manifest.run);
  const planned = new Map(plan.operations.map(({ id, payload }) => [id, payload]));
  let groupPresent = true;
  let listingStatus: VariationListingStatus = 'ACTIVE';
  let missingGroupReads = 0;
  const items = new Set(manifest.run.childSkus);
  const offers = new Set(manifest.run.childSkus);
  const readApi = createApi({
    getInventoryItemGroup: vi.fn(async () => {
      if (groupPresent)
        return {
          status: 'found' as const,
          value: normalizeVariationListingGroup(
            planned.get('group-complete'),
            manifest.run.groupKey
          ),
        };
      missingGroupReads += 1;
      return failFinalGroupAbsence && missingGroupReads > 1
        ? { status: 'unknown' as const, reason: 'final group state unavailable' }
        : { status: 'missing' as const };
    }),
    getInventoryItem: vi.fn(async (sku) =>
      items.has(sku)
        ? {
            status: 'found' as const,
            value: normalizeVariationListingItem({
              ...(planned.get(`item-${sku.endsWith('C01') ? 'C01' : 'C02'}`) as Record<
                string,
                unknown
              >),
              inventoryItemGroupKeys: [manifest.run.groupKey],
            }),
          }
        : { status: 'missing' as const }
    ),
    getOffers: vi.fn(async (sku) => {
      if (!offers.has(sku)) return { status: 'found' as const, value: { offers: [] } };
      const index = manifest.run.childSkus.indexOf(sku);
      return {
        status: 'found' as const,
        value: {
          offers: [
            remoteOffer({
              sku,
              offerId: manifest.resources[index].offerId ?? undefined,
              listingId: manifest.groupListingId,
              listingStatus,
              semanticPayload: planned.get(`offer-C0${index + 1}`),
            }),
          ],
        },
      };
    }),
  });
  const mutationApi: VariationListingPilotMutationApi = {
    ...createMutationApi(),
    withdrawInventoryItemGroup: vi.fn(async () => {
      listingStatus = 'ENDED';
    }),
    deleteOffer: vi.fn(async (offerId) => {
      const resource = manifest.resources.find((candidate) => candidate.offerId === offerId);
      if (resource) offers.delete(resource.sku);
    }),
    deleteInventoryItemGroup: vi.fn(async () => {
      groupPresent = false;
    }),
    deleteInventoryItem: vi.fn(async (sku) => {
      items.delete(sku);
    }),
  };
  return { readApi, mutationApi };
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

describe('variation listing sandbox pilot fixture and plan', () => {
  it('strictly validates the complete ordered fixture', async () => {
    const fixture = variationListingFixtureSchema.parse(await loadFixture());
    expect(fixture.version).toBe(2);
    expect(fixture.children.map((child) => child.slot)).toEqual(['C01', 'C02']);

    expect(() => variationListingFixtureSchema.parse({ ...fixture, unexpected: true })).toThrow();
    expect(() =>
      variationListingFixtureSchema.parse({
        ...fixture,
        selector: {
          ...fixture.selector,
          values: [fixture.selector.values[0], fixture.selector.values[0]],
        },
      })
    ).toThrow(/Selector values|exactly match/);
    expect(() =>
      variationListingFixtureSchema.parse({
        ...fixture,
        children: fixture.children.map((child, index) =>
          index === 0 ? { ...child, images: [child.images[1], child.images[0]] } : child
        ),
      })
    ).toThrow(/front then back/);
    expect(() =>
      variationListingFixtureSchema.parse({
        ...fixture,
        children: fixture.children.map((child, index) =>
          index === 0 ? { ...child, images: [child.images[0]] } : child
        ),
      })
    ).toThrow();
    expect(() =>
      variationListingFixtureSchema.parse({
        ...fixture,
        children: fixture.children.map((child, index) =>
          index === 0
            ? {
                ...child,
                images: [child.images[0], { ...child.images[1], url: child.images[0].url }],
              }
            : child
        ),
      })
    ).toThrow(/source URLs/);
    expect(() =>
      variationListingFixtureSchema.parse({
        ...fixture,
        children: fixture.children.map((child, index) =>
          index === 0
            ? {
                ...child,
                images: [
                  { ...child.images[0], url: child.images[0].url.replace('https:', 'http:') },
                  child.images[1],
                ],
              }
            : child
        ),
      })
    ).toThrow(/public HTTPS/);
    expect(() =>
      variationListingFixtureSchema.parse({
        ...fixture,
        children: fixture.children.map((child, index) =>
          index === 0
            ? {
                ...child,
                images: [
                  { ...child.images[0], url: `${child.images[0].url}?signature=secret` },
                  child.images[1],
                ],
              }
            : child
        ),
      })
    ).toThrow(/without credentials, query, or fragment/);
    expect(() =>
      variationListingFixtureSchema.parse({
        ...fixture,
        children: fixture.children.map((child, index) =>
          index === 0
            ? {
                ...child,
                images: [
                  { ...child.images[0], fingerprint: 'token-secret-value' },
                  child.images[1],
                ],
              }
            : child
        ),
      })
    ).toThrow(/non-secret/);
    expect(() =>
      variationListingFixtureSchema.parse({
        ...fixture,
        children: fixture.children.map((child, index) =>
          index === 1
            ? {
                ...child,
                images: [
                  { ...child.images[0], url: fixture.children[0].images[0].url },
                  child.images[1],
                ],
              }
            : child
        ),
      })
    ).toThrow(/distinct across children/);
    expect(() =>
      variationListingFixtureSchema.parse({
        ...fixture,
        selector: { ...fixture.selector, name: 'Customized' },
      })
    ).toThrow();
    expect(() =>
      variationListingFixtureSchema.parse({
        ...fixture,
        sharedCondition: {
          ...fixture.sharedCondition,
          conditionDescriptors: [{ name: 'Card Condition', values: ['Very Good'] }],
        },
      })
    ).toThrow();
  });

  it('generates exact collision-resistant run-owned identities outside Single/Lot grammar', () => {
    const run = generateRunIdentity(3, fixedDate, fixedRandom());
    expect(run).toEqual({
      runId: '20260803T151700Z-a1b2c3',
      prefix: 'YPSBX-20260803T151700Z-a1b2c3',
      groupKey: 'YPSBX-20260803T151700Z-a1b2c3-G',
      childSkus: [
        'YPSBX-20260803T151700Z-a1b2c3-C01',
        'YPSBX-20260803T151700Z-a1b2c3-C02',
        'YPSBX-20260803T151700Z-a1b2c3-C03',
      ],
    });
    expect(() => validateRunIdentity({ ...run, groupKey: 'BSKBL-Single-000001' })).toThrow();
  });

  it('builds a complete deterministic ordered and digested future plan without offer descriptions', async () => {
    const fixture = variationListingFixtureSchema.parse(await loadFixture());
    const run = generateRunIdentity(2, fixedDate, fixedRandom());
    const first = buildFuturePlan(fixture, run);
    const second = buildFuturePlan(fixture, run);

    expect(first).toEqual(second);
    expect(first.operations.map((item) => item.kind)).toEqual([
      'create-or-replace-child-item',
      'create-or-replace-child-item',
      'create-child-offer',
      'create-child-offer',
      'replace-complete-inventory-item-group',
      'publish-inventory-item-group',
      'bulk-update-one-child-quantity-zero',
      'optional-restore-one-child-quantity',
      'withdraw-inventory-item-group',
      'delete-recorded-offer',
      'delete-recorded-offer',
      'delete-inventory-item-group',
      'delete-child-inventory-item',
      'delete-child-inventory-item',
      'verify-exact-run-resource-absence',
    ]);
    expect(first.operations.every((item) => /^[a-f0-9]{64}$/.test(item.digest))).toBe(true);
    expect(first.arrangementId).toMatch(/^arrangement-v2-/);
    expect(JSON.stringify(first)).not.toContain('listingDescription');
    expect(first.operations[0]?.payload).toEqual(
      expect.objectContaining({
        condition: 'USED_VERY_GOOD',
        conditionDescriptors: [{ name: '40001', values: ['400012'] }],
      })
    );
    const itemRequests = first.operations
      .filter(({ kind }) => kind === 'create-or-replace-child-item')
      .map(({ payload }) => payload as { sku: string; product: { imageUrls: string[] } });
    const groupRequest = first.operations.find(({ id }) => id === 'group-complete')?.payload as {
      imageUrls: string[];
      variantSKUs: string[];
      variesBy: {
        specifications: { name: string; values: string[] }[];
        aspectsImageVariesBy: string[];
      };
    };
    expect(itemRequests.map(({ sku }) => sku)).toEqual(run.childSkus);
    expect(itemRequests.map(({ product }) => product.imageUrls)).toEqual(
      fixture.children.map((child) => child.images.map(({ url }) => url))
    );
    expect(groupRequest.imageUrls).toEqual(fixture.children.map((child) => child.images[0].url));
    expect(groupRequest.variantSKUs).toEqual(run.childSkus);
    expect(groupRequest.variesBy.specifications).toEqual([
      { name: fixture.selector.name, values: fixture.selector.values },
    ]);
    expect(groupRequest.variesBy.aspectsImageVariesBy).toEqual([fixture.selector.name]);
    expect(normalizeVariationListingGroup(groupRequest, run.groupKey).snapshotDigest).toBe(
      first.operations.find(({ id }) => id === 'group-complete')?.digest
    );
    expect(
      normalizeVariationListingGroup(
        { ...groupRequest, imageUrls: [...groupRequest.imageUrls].reverse() },
        run.groupKey
      ).snapshotDigest
    ).not.toBe(first.operations.find(({ id }) => id === 'group-complete')?.digest);
  });

  it('preflights version 3 with ordered Media operations and resolves only exact ready EPS URLs', async () => {
    const fixture = { ...((await loadFixture()) as Record<string, unknown>), version: 3 };
    const parsedFixture = variationListingFixtureSchema.parse(fixture);
    const run = generateRunIdentity(2, fixedDate, fixedRandom());
    const plan = buildFuturePlan(parsedFixture, run);
    expect(plan.operations.slice(0, 4).map(({ id }) => id)).toEqual([
      'media-C01-front',
      'media-C01-back',
      'media-C02-front',
      'media-C02-back',
    ]);
    expect(plan.operations.find(({ id }) => id === 'item-C01')?.payload).toEqual(
      expect.objectContaining({
        product: expect.objectContaining({
          imageUrls: ['$media.C01.front', '$media.C01.back'],
        }),
      })
    );
    expect(
      (
        plan.operations.find(({ id }) => id === 'group-complete')?.payload as {
          imageUrls: string[];
        }
      ).imageUrls
    ).toEqual(['$media.C01.front', '$media.C02.front']);

    const root = await tempRepo();
    const version3FixturePath = join(root, 'version-3-fixture.json');
    await writeFile(version3FixturePath, JSON.stringify(fixture));
    const probeMediaImageAccess = vi.fn(async () => 'authorized' as const);
    const report = await runVariationListingSandboxPilot({
      api: createApi({
        getRuntimeSnapshot: vi.fn(async () => ({ ...runtime, grantedUserScopes: undefined })),
        probeMediaImageAccess,
      }),
      fixturePath: version3FixturePath,
      repoRoot: root,
      now: () => fixedDate,
      randomBytesImpl: fixedRandom,
    });
    expect(probeMediaImageAccess).toHaveBeenCalledWith('VL_MEDIA_AUTH_PROBE_MISSING');
    const manifest = await readManifest(
      report.manifestPath,
      join(root, '.local', 'you-pick-sandbox')
    );
    if (!('execution' in manifest)) throw new Error('Expected executable manifest.');
    expect(
      manifest.execution.mediaResources?.map(({ operationId, state }) => ({
        operationId,
        state,
      }))
    ).toEqual(plan.operations.slice(0, 4).map(({ id }) => ({ operationId: id, state: 'planned' })));
    expect(() => resolveFuturePlan(manifest)).toThrow(/not ready/);

    const unauthorizedRoot = await tempRepo();
    const unauthorizedFixturePath = join(unauthorizedRoot, 'version-3-fixture.json');
    await writeFile(unauthorizedFixturePath, JSON.stringify(fixture));
    await expect(
      runVariationListingSandboxPilot({
        api: createApi({
          getRuntimeSnapshot: vi.fn(async () => ({ ...runtime, grantedUserScopes: undefined })),
          probeMediaImageAccess: vi.fn(async () => 'unauthorized'),
        }),
        fixturePath: unauthorizedFixturePath,
        repoRoot: unauthorizedRoot,
        now: () => fixedDate,
        randomBytesImpl: fixedRandom,
      })
    ).rejects.toThrow(/media-oauth-capability gate failed/);

    const ready = executableVariationListingManifestSchema.parse({
      ...manifest,
      execution: {
        ...manifest.execution,
        ledger: manifest.execution.ledger.map((entry) =>
          entry.id.startsWith('media-')
            ? {
                ...entry,
                state: 'completed',
                attemptCount: 1,
                startedAt: '2026-08-11T15:17:00.000Z',
                completedAt: '2026-08-11T15:18:00.000Z',
              }
            : entry
        ),
        mediaResources: manifest.execution.mediaResources?.map((resource, index) => {
          const epsUrl = `https://i.ebayimg.com/images/g/EPS${index}/s-l1600.jpg${index === 0 ? '?quality=100' : ''}`;
          return {
            ...resource,
            state: 'ready',
            imageId: `IMAGE-${index}`,
            location: `https://apim.sandbox.ebay.com/commerce/media/v1_beta/image/IMAGE-${index}`,
            epsUrl,
            epsUrlDigest: digest(epsUrl),
            expirationDate: '2026-09-11T15:17:00.000Z',
            createdAt: '2026-08-11T15:17:00.000Z',
            verifiedAt: '2026-08-11T15:18:00.000Z',
          };
        }),
      },
    });
    const resolved = resolveFuturePlan(ready);
    expect(
      (
        resolved.operations.find(({ id }) => id === 'item-C01')?.payload as {
          product: { imageUrls: string[] };
        }
      ).product.imageUrls
    ).toEqual([
      'https://i.ebayimg.com/images/g/EPS0/s-l1600.jpg?quality=100',
      'https://i.ebayimg.com/images/g/EPS1/s-l1600.jpg',
    ]);
    const resolvedItem = resolved.operations.find(({ id }) => id === 'item-C01')?.payload;
    expect(
      inventoryItemSemanticMismatch(
        projectInventoryItemSemanticSnapshot(resolvedItem),
        resolvedItem
      )
    ).toBeNull();
    await writeManifestAtomic(report.manifestPath, ready, join(root, '.local', 'you-pick-sandbox'));
    const roundTrip = await readManifest(
      report.manifestPath,
      join(root, '.local', 'you-pick-sandbox')
    );
    expect('execution' in roundTrip ? roundTrip.execution.mediaResources?.[0].epsUrl : null).toBe(
      'https://i.ebayimg.com/images/g/EPS0/s-l1600.jpg?quality=100'
    );
  });

  it('builds version 4 with ordered child Media pairs and no group imageUrls', async () => {
    const fixture = variationListingFixtureSchema.parse({ ...(await loadFixture()), version: 4 });
    const run = generateRunIdentity(2, fixedDate, fixedRandom());
    const plan = buildFuturePlan(fixture, run);
    const group = plan.operations.find(({ id }) => id === 'group-complete')?.payload as Record<
      string,
      unknown
    >;

    expect(plan.arrangementId).toMatch(/^arrangement-v4-/);
    expect(plan.operations.slice(0, 4).map(({ id }) => id)).toEqual([
      'media-C01-front',
      'media-C01-back',
      'media-C02-front',
      'media-C02-back',
    ]);
    expect(
      plan.operations
        .filter(({ kind }) => kind === 'create-or-replace-child-item')
        .map(({ payload }) => (payload as { product: { imageUrls: string[] } }).product.imageUrls)
    ).toEqual([
      ['$media.C01.front', '$media.C01.back'],
      ['$media.C02.front', '$media.C02.back'],
    ]);
    expect(group).not.toHaveProperty('imageUrls');
    expect(group.variesBy).toEqual({
      specifications: [{ name: 'Card', values: ['001 - Alpha Card', '002 - Beta Card'] }],
      aspectsImageVariesBy: ['Card'],
    });

    const root = await tempRepo();
    const fixturePath = join(root, 'version-4-fixture.json');
    await writeFile(fixturePath, JSON.stringify(fixture));
    const report = await runVariationListingSandboxPilot({
      api: createApi(),
      fixturePath,
      repoRoot: root,
      now: () => fixedDate,
      randomBytesImpl: fixedRandom,
    });
    const manifest = executableVariationListingManifestSchema.parse(
      await readManifest(report.manifestPath, join(root, '.local', 'you-pick-sandbox'))
    );
    const ready = executableVariationListingManifestSchema.parse({
      ...manifest,
      execution: {
        ...manifest.execution,
        ledger: manifest.execution.ledger.map((entry) =>
          entry.id.startsWith('media-')
            ? {
                ...entry,
                state: 'completed',
                attemptCount: 1,
                startedAt: '2026-08-11T15:17:00.000Z',
                completedAt: '2026-08-11T15:18:00.000Z',
              }
            : entry
        ),
        mediaResources: manifest.execution.mediaResources?.map((resource, index) => {
          const epsUrl = `https://i.ebayimg.com/images/g/CHILD${index}/s-l1600.jpg`;
          return {
            ...resource,
            state: 'ready',
            imageId: `CHILD-${index}`,
            location: `https://apim.sandbox.ebay.com/commerce/media/v1_beta/image/CHILD-${index}`,
            epsUrl,
            epsUrlDigest: digest(epsUrl),
            expirationDate: '2026-09-11T15:17:00.000Z',
            createdAt: '2026-08-11T15:17:00.000Z',
            verifiedAt: '2026-08-11T15:18:00.000Z',
          };
        }),
      },
    });
    const resolved = resolveFuturePlan(ready);
    expect(
      resolved.operations
        .filter(({ kind }) => kind === 'create-or-replace-child-item')
        .map(({ payload }) => (payload as { product: { imageUrls: string[] } }).product.imageUrls)
    ).toEqual([
      [
        'https://i.ebayimg.com/images/g/CHILD0/s-l1600.jpg',
        'https://i.ebayimg.com/images/g/CHILD1/s-l1600.jpg',
      ],
      [
        'https://i.ebayimg.com/images/g/CHILD2/s-l1600.jpg',
        'https://i.ebayimg.com/images/g/CHILD3/s-l1600.jpg',
      ],
    ]);
    expect(
      resolved.operations.find(({ id }) => id === 'group-complete')?.payload
    ).not.toHaveProperty('imageUrls');
    const resolvedGroup = resolved.operations.find(({ id }) => id === 'group-complete');
    expect(
      normalizeVariationListingGroup(
        {
          ...(resolvedGroup?.payload as Record<string, unknown>),
          variantSKUs: [...run.childSkus].reverse(),
        },
        run.groupKey
      ).snapshotDigest
    ).toBe(resolvedGroup?.digest);
  });

  it('preserves the exact version-1 arrangement and operation digests', async () => {
    const run = generateRunIdentity(2, fixedDate, fixedRandom());
    const legacy = buildFuturePlan(await loadLegacyFixture(), run);
    const current = buildFuturePlan(await loadFixture(), run);

    expect(legacy.arrangementId).toBe('arrangement-v1-9b99f3413d106515');
    expect(legacy.operations.map(({ id, digest }) => ({ id, digest }))).toEqual([
      {
        id: 'item-C01',
        digest: 'bd5e528399a6788db24bd14b6cc8ddbc657979d6746e7def1d9bffcecfc72949',
      },
      {
        id: 'item-C02',
        digest: 'a4610503640234211cdd3de9ca46afed315368a33e582cf163c75851aa103ddc',
      },
      {
        id: 'offer-C01',
        digest: 'f3b9003bd31a3cbcee94fd0487a57c72a5a919f539c7fce75b9d5bc7901806e2',
      },
      {
        id: 'offer-C02',
        digest: 'e8fe4e7b0036d8cf6ffb8c15e80bc4a1fc005eddd09fdc45207cdfc6583dfca3',
      },
      {
        id: 'group-complete',
        digest: 'b8b91ccbbc8116b2b9f5a6a11505294178e2fd878afed521453da9cbfc2267f7',
      },
      {
        id: 'publish-group',
        digest: '8b78bfb289fac339a4601371d5c6d49143806c6ded9608ffdcdd5e46f279d7cf',
      },
      {
        id: 'quantity-zero',
        digest: 'f02e339423e62f7207ed5c6be2fe6f500f10eb6810272eb5ebc2fe9e02fc29af',
      },
      {
        id: 'quantity-restore-optional',
        digest: '9ae00a6db658fd9d0ba7d2e8eef13bb4f3943602745c8f8d3c72d23ccfe771cb',
      },
      {
        id: 'withdraw-group',
        digest: '8b78bfb289fac339a4601371d5c6d49143806c6ded9608ffdcdd5e46f279d7cf',
      },
      {
        id: 'cleanup-offer-C02',
        digest: '5904e31450eddc4e55be8fe8d6feb61b9f4d317c7d44f40902b8962402db144d',
      },
      {
        id: 'cleanup-offer-C01',
        digest: '9c8d1509af3d3bbb6152c30ef4fe9da8a6f096acc6148b6ff8a65c29682a3d87',
      },
      {
        id: 'cleanup-group',
        digest: '038234d4e26313ef8a2ee9c12e1d41e3c6ad40fb7ad4a6735c93f6f57b24dfec',
      },
      {
        id: 'cleanup-child-2',
        digest: 'd6920160a97c3dad69bdec4e8be3d67c600dbc565677944e06730e9deb68b86c',
      },
      {
        id: 'cleanup-child-1',
        digest: '2ec63cdb83247675a7ba7cacddb9a91b960ac83b60b172369d0774356641497f',
      },
      {
        id: 'verify-absence',
        digest: 'e21b119a028c8a28e3f6157b391077521a318a2d30180f025c742bbb6bfc3235',
      },
    ]);
    expect(current.arrangementId).not.toBe(legacy.arrangementId);
    expect(
      (legacy.operations[0]?.payload as { product: Record<string, unknown> }).product
    ).not.toHaveProperty('imageUrls');
    expect(
      (
        legacy.operations.find(({ id }) => id === 'group-complete')?.payload as {
          imageUrls: string[];
        }
      ).imageUrls
    ).toHaveLength(4);
  });

  it('requires a different fully cleaned predecessor for a fresh-run fallback', async () => {
    const fixture = variationListingFixtureSchema.parse(await loadFixture());
    expect(() =>
      variationListingFixtureSchema.parse({
        ...fixture,
        predecessorRunId: '20260803T140000Z-abcdef',
        predecessorFullyCleaned: false,
      })
    ).toThrow(/fully cleaned/);
  });
});

describe('variation listing manifest persistence and dry-run gates', () => {
  it('rejects version-1 fixtures for new pilot runs before resolving reads', async () => {
    const root = await tempRepo();
    const apiFactory = vi.fn<() => Promise<VariationListingPilotReadApi>>();

    await expect(
      runVariationListingSandboxPilot({
        apiFactory,
        fixturePath: legacyFixturePath,
        repoRoot: root,
        now: () => fixedDate,
        randomBytesImpl: fixedRandom,
      })
    ).rejects.toThrow();
    expect(apiFactory).not.toHaveBeenCalled();
  });

  it('creates the manifest before reads, persists sanitized preflight, and reports no payloads or URLs', async () => {
    const root = await tempRepo();
    const api = createApi();
    const report = await runFresh(root, api);
    const manifestText = await readFile(report.manifestPath, 'utf8');
    const manifest = JSON.parse(manifestText) as VariationListingManifest;

    expect(report.mode).toBe('dry-run');
    expect(report.seller.userId).toBe('sandbox-seller-123');
    expect(report.contentLanguage).toBe('en-US');
    expect(report.gates.every((gate) => gate.status === 'pass')).toBe(true);
    expect(manifest.checkpoint).toBe('preflight-complete');
    expect(manifest.metadataSummary?.selectorStatus).toBe('taxonomy-listed');
    expect(manifestText).not.toContain('signature=');
    expect(manifestText).not.toContain('token=');
    expect(manifestText).not.toContain('Bearer');
    expect(api.getRuntimeSnapshot).toHaveBeenCalledOnce();
    expect(report.operationPlan.every((item) => !('payload' in item))).toBe(true);
  });

  it('creates the manifest before resolving the credential-bearing API factory', async () => {
    const root = await tempRepo();
    const expectedPath = join(
      root,
      '.local',
      'you-pick-sandbox',
      '20260803T151700Z-a1b2c3',
      'manifest.json'
    );
    const apiFactory = vi.fn(async () => {
      await expect(access(expectedPath)).resolves.toBeUndefined();
      return createApi();
    });

    await runVariationListingSandboxPilot({
      apiFactory,
      fixturePath,
      repoRoot: root,
      now: () => fixedDate,
      randomBytesImpl: fixedRandom,
    });
    expect(apiFactory).toHaveBeenCalledOnce();
  });

  it('refuses corrupt, unsupported, foreign, and unsafe manifests', async () => {
    const root = await tempRepo();
    const localRoot = join(root, '.local', 'you-pick-sandbox');
    const runId = '20260803T151700Z-a1b2c3';
    const path = join(localRoot, runId, 'manifest.json');
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, '{broken', 'utf8');
    await expect(readManifest(path, localRoot)).rejects.toThrow(/missing or corrupt/);
    expect(() => assertSafeManifestPath(join(root, 'manifest.json'), localRoot)).toThrow(
      /contained/
    );

    const secondRoot = await tempRepo();
    const fresh = await runFresh(secondRoot);
    const secondLocalRoot = join(secondRoot, '.local', 'you-pick-sandbox');
    const manifest = await readManifest(fresh.manifestPath, secondLocalRoot);
    await writeFile(fresh.manifestPath, JSON.stringify({ ...manifest, version: 99 }), 'utf8');
    await expect(readManifest(fresh.manifestPath, secondLocalRoot)).rejects.toThrow();
    await writeFile(
      fresh.manifestPath,
      JSON.stringify({
        ...manifest,
        run: { ...manifest.run, groupKey: 'YPSBX-foreign-G' },
      }),
      'utf8'
    );
    await expect(readManifest(fresh.manifestPath, secondLocalRoot)).rejects.toThrow(/owned/);
  });

  it.skipIf(!existsSync(currentManifestPath))(
    'keeps the cleaned version-1 manifest integrity-valid and byte-identical',
    async () => {
      const before = await readFile(currentManifestPath, 'utf8');
      const manifest = await readManifest(currentManifestPath, currentManifestRoot);
      if (manifest.version !== 5) throw new Error('Current manifest is not executable version 5.');

      expect(() => assertExecutableManifestIntegrity(manifest)).not.toThrow();
      expect(manifest.execution.fixture.version).toBe(1);
      expect(manifest.arrangementId).toBe('arrangement-v1-ab936d5f171492b8');
      expect(manifest.checkpoint).toBe('cleanup-complete');
      expect(manifest.cleanup).toEqual({ attempts: 1, finalAbsenceVerified: true });
      expect(
        manifest.execution.ledger
          .filter(({ id }) => id === 'withdraw-group' || id.startsWith('cleanup-'))
          .map(({ id, state, attemptCount }) => ({ id, state, attemptCount }))
      ).toEqual([
        { id: 'withdraw-group', state: 'completed', attemptCount: 1 },
        { id: 'cleanup-offer-C02', state: 'completed', attemptCount: 1 },
        { id: 'cleanup-offer-C01', state: 'completed', attemptCount: 1 },
        { id: 'cleanup-group', state: 'completed', attemptCount: 1 },
        { id: 'cleanup-child-2', state: 'completed', attemptCount: 1 },
        { id: 'cleanup-child-1', state: 'completed', attemptCount: 1 },
      ]);
      expect(manifest.execution.ledger.find(({ id }) => id === 'verify-absence')).toEqual(
        expect.objectContaining({
          state: 'completed',
          attemptCount: 0,
          startedAt: expect.any(String),
          completedAt: expect.any(String),
          readBackDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        })
      );
      expect(manifest.execution.ledger.find(({ id }) => id === 'quantity-zero')).toEqual(
        expect.objectContaining({ state: 'planned', attemptCount: 0 })
      );
      expect(
        manifest.execution.ledger.find(({ id }) => id === 'quantity-restore-optional')
      ).toEqual(expect.objectContaining({ state: 'planned', attemptCount: 0 }));
      expect(manifest.lastError).toBe(
        'Inventory item response contains ambiguous group association fields.'
      );
      expect(await readFile(currentManifestPath, 'utf8')).toBe(before);
    }
  );

  it('rejects a symlinked manifest run directory before API factories resolve', async () => {
    const root = await tempRepo();
    const foreignRoot = await tempRepo();
    const foreign = await runFresh(foreignRoot);
    const localRoot = join(root, '.local', 'you-pick-sandbox');
    const linkedManifest = join(localRoot, foreign.run.runId, 'manifest.json');
    await mkdir(localRoot, { recursive: true });
    await symlink(dirname(foreign.manifestPath), dirname(linkedManifest), 'dir');
    const apiFactory = vi.fn<() => Promise<VariationListingPilotReadApi>>();
    const mutationApiFactory = vi.fn();

    await expect(
      runVariationListingSandboxPilot({
        apiFactory,
        manifestPath: linkedManifest,
        repoRoot: root,
        execute: true,
        confirmSandboxSeller: 'sandbox-seller-123',
        mutationApiFactory,
      })
    ).rejects.toThrow(/resolves outside|symbolic link/);
    expect(apiFactory).not.toHaveBeenCalled();
    expect(mutationApiFactory).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...runtime, environment: 'production' }, 'environment gate failed'],
    [{ ...runtime, restOrigin: 'https://api.ebay.com' }, 'hosts gate failed'],
    [{ ...runtime, marketplaceId: 'EBAY_GB' }, 'marketplace gate failed'],
    [{ ...runtime, contentLanguage: undefined }, 'content-language gate failed'],
    [
      { ...runtime, background: { ...runtime.background, jobRunner: true } },
      'background-work gate failed',
    ],
  ])('fails closed on unsafe runtime gate %#', async (unsafeRuntime, message) => {
    const root = await tempRepo();
    const api = createApi({ getRuntimeSnapshot: vi.fn(async () => unsafeRuntime) });
    await expect(runFresh(root, api)).rejects.toThrow(message);
    expect(api.getCurrentUserIdentity).not.toHaveBeenCalled();
  });

  it('persists a sanitized failed gate for recovery evidence', async () => {
    const root = await tempRepo();
    const api = createApi({
      getRuntimeSnapshot: vi.fn(async () => ({
        ...runtime,
        contentLanguage: 'fr-FR',
      })),
    });
    await expect(runFresh(root, api)).rejects.toThrow(/content-language gate failed/);
    const path = join(
      root,
      '.local',
      'you-pick-sandbox',
      '20260803T151700Z-a1b2c3',
      'manifest.json'
    );
    const manifest = await readManifest(path, join(root, '.local', 'you-pick-sandbox'));
    expect(manifest.gates).toContainEqual(
      expect.objectContaining({ name: 'content-language', status: 'fail' })
    );
    expect(manifest.lastError).toMatch(/content-language gate failed/);
  });

  it('requires exact seller confirmation and stable identity on resume', async () => {
    const root = await tempRepo();
    await expect(
      runVariationListingSandboxPilot({
        api: createApi(),
        fixturePath,
        repoRoot: root,
        confirmSandboxSeller: 'another-seller',
        now: () => fixedDate,
        randomBytesImpl: fixedRandom,
      })
    ).rejects.toThrow(/does not exactly match/);

    const secondRoot = await tempRepo();
    const report = await runFresh(secondRoot);
    await expect(
      runVariationListingSandboxPilot({
        api: createApi({
          getCurrentUserIdentity: vi.fn(async () => ({ userId: 'changed-seller' })),
        }),
        manifestPath: report.manifestPath,
        repoRoot: secondRoot,
      })
    ).rejects.toThrow(/changed from the manifest/);
  });

  it('rejects ambiguous policies, metadata failure, and unknown collision state', async () => {
    const root1 = await tempRepo();
    const ambiguous = createApi();
    ambiguous.getPolicyLocationSnapshot = vi.fn(async () => ({
      ...(await createApi().getPolicyLocationSnapshot()),
      fulfillment: [
        {
          id: 'FULFILLMENT-PILOT',
          marketplaceId: 'EBAY_US',
          ownerUserId: 'sandbox-seller-123',
        },
        {
          id: 'FULFILLMENT-PILOT',
          marketplaceId: 'EBAY_US',
          ownerUserId: 'sandbox-seller-123',
        },
      ],
    }));
    await expect(runFresh(root1, ambiguous)).rejects.toThrow(/ambiguous/);

    const root2 = await tempRepo();
    await expect(
      runFresh(
        root2,
        createApi({
          getMetadataSnapshot: vi.fn(async () => ({
            categoryId: '261328',
            variationsSupported: false,
            selectorCandidates: [],
            conditions: [],
          })),
        })
      )
    ).rejects.toThrow(/variation support/);

    const root3 = await tempRepo();
    await expect(
      runFresh(
        root3,
        createApi({
          getInventoryItemGroup: vi.fn(async () => ({
            status: 'unknown',
            reason: 'HTTP 503',
          })),
        })
      )
    ).rejects.toThrow(/did not confirm absence/);
  });

  it('allows a bounded custom selector absent from taxonomy and reports experiment status', async () => {
    const root = await tempRepo();
    const report = await runFresh(
      root,
      createApi({
        getMetadataSnapshot: vi.fn(async () => ({
          ...(await createApi().getMetadataSnapshot('261328')),
          selectorCandidates: [],
        })),
      })
    );
    expect(report.metadataSummary.selectorStatus).toBe('custom-unlisted');
    expect(report.gates.find((gate) => gate.name === 'metadata')?.detail).toContain(
      'sandbox group validation remains authoritative'
    );
  });

  it('rejects a condition enum or descriptor value inconsistent with condition 4000', async () => {
    const root = await tempRepo();
    await expect(
      runFresh(
        root,
        createApi({
          getMetadataSnapshot: vi.fn(async () => {
            const metadata = await createApi().getMetadataSnapshot('261328');
            return {
              ...metadata,
              conditions: metadata.conditions.map((condition) => ({
                ...condition,
                inventoryCondition: 'USED_EXCELLENT',
              })),
            };
          }),
        })
      )
    ).rejects.toThrow(/unexpected enum/);

    const secondRoot = await tempRepo();
    await expect(
      runFresh(
        secondRoot,
        createApi({
          getMetadataSnapshot: vi.fn(async () => {
            const metadata = await createApi().getMetadataSnapshot('261328');
            return {
              ...metadata,
              conditions: metadata.conditions.map((condition) => ({
                ...condition,
                conditionDescriptors: condition.conditionDescriptors.map((descriptor) => ({
                  ...descriptor,
                  values: [{ id: '400099', name: 'Foreign' }],
                })),
              })),
            };
          }),
        })
      )
    ).rejects.toThrow(/descriptor values/);

    const thirdRoot = await tempRepo();
    await expect(
      runFresh(
        thirdRoot,
        createApi({
          getMetadataSnapshot: vi.fn(async () => {
            const metadata = await createApi().getMetadataSnapshot('261328');
            return {
              ...metadata,
              conditions: metadata.conditions.map((condition) => ({
                ...condition,
                conditionDescriptors: condition.conditionDescriptors.map((descriptor) => ({
                  ...descriptor,
                  values: [],
                })),
              })),
            };
          }),
        })
      )
    ).rejects.toThrow(/descriptor values/);

    const fourthRoot = await tempRepo();
    await expect(
      runFresh(
        fourthRoot,
        createApi({
          getMetadataSnapshot: vi.fn(async () => {
            const metadata = await createApi().getMetadataSnapshot('261328');
            return {
              ...metadata,
              conditions: metadata.conditions.map((condition) => ({
                ...condition,
                conditionDescriptors: [],
              })),
            };
          }),
        })
      )
    ).rejects.toThrow(/missing or ambiguous descriptor ID/);

    const fifthRoot = await tempRepo();
    await expect(
      runFresh(
        fifthRoot,
        createApi({
          getMetadataSnapshot: vi.fn(async () => {
            const metadata = await createApi().getMetadataSnapshot('261328');
            return {
              ...metadata,
              conditions: metadata.conditions.map((condition) => ({
                ...condition,
                conditionDescriptors: [{ id: '27503', name: 'Certification Number', values: [] }],
              })),
            };
          }),
        })
      )
    ).rejects.toThrow(/missing or ambiguous descriptor ID/);
  });
});

describe('variation listing C01 semantic recovery', () => {
  it('adopts matching unknown C01 without any later mutation', async () => {
    const root = await tempRepo();
    const fresh = await runFresh(root);
    const localRoot = join(root, '.local', 'you-pick-sandbox');
    const manifest = unknownC01Manifest(await readManifest(fresh.manifestPath, localRoot));
    const itemRequest = buildFuturePlan(manifest.execution.fixture, manifest.run).operations.find(
      ({ id }) => id === 'item-C01'
    )?.payload;
    expect(itemRequest).toBeDefined();
    const getInventoryItem = vi.fn(async (sku: string) =>
      sku === manifest.run.childSkus[0]
        ? {
            status: 'found' as const,
            value: {
              sku,
              groupKeys: null,
              quantity: 1,
              semanticSnapshot: projectInventoryItemSemanticSnapshot(itemRequest),
            },
          }
        : { status: 'unknown' as const, reason: 'stop before C02 mutation' }
    );
    const mutationApi = createMutationApi();
    let persisted = manifest;

    await expect(
      executeVariationListingManifest({
        manifest,
        manifestPath: fresh.manifestPath,
        readApi: createApi({ getInventoryItem }),
        mutationApi,
        headers: { 'Content-Language': 'en-US' },
        cleanup: false,
        now: () => new Date('2026-08-04T21:30:00.000Z'),
        persist: async (next) => {
          persisted = next;
        },
      })
    ).rejects.toThrow('item-C02 pre-state is unknown.');

    expect(persisted.execution.ledger.find(({ id }) => id === 'item-C01')).toEqual(
      expect.objectContaining({ state: 'completed', attemptCount: 1 })
    );
    expect(persisted.execution.ledger.find(({ id }) => id === 'item-C02')).toEqual(
      expect.objectContaining({ state: 'planned', attemptCount: 0 })
    );
    expect(getInventoryItem).toHaveBeenCalledWith(manifest.run.childSkus[0]);
    expect(getInventoryItem).toHaveBeenCalledWith(manifest.run.childSkus[1]);
    for (const mutation of Object.values(mutationApi)) expect(mutation).not.toHaveBeenCalled();
  });

  it('refuses a semantically matching item with foreign group ownership', async () => {
    const root = await tempRepo();
    const fresh = await runFresh(root);
    const localRoot = join(root, '.local', 'you-pick-sandbox');
    const manifest = unknownC01Manifest(await readManifest(fresh.manifestPath, localRoot));
    const itemRequest = buildFuturePlan(manifest.execution.fixture, manifest.run).operations.find(
      ({ id }) => id === 'item-C01'
    )?.payload;
    const mutationApi = createMutationApi();

    await expect(
      executeVariationListingManifest({
        manifest,
        readApi: createApi({
          getInventoryItem: vi.fn(async (sku) => ({
            status: 'found',
            value: {
              sku,
              groupKeys: ['foreign-group'],
              quantity: 1,
              semanticSnapshot: projectInventoryItemSemanticSnapshot(itemRequest),
            },
          })),
        }),
        mutationApi,
        headers: { 'Content-Language': 'en-US' },
        cleanup: false,
        now: () => new Date('2026-08-04T21:30:00.000Z'),
        persist: async () => undefined,
      })
    ).rejects.toThrow('item-C01 has an unexpected group association.');
    for (const mutation of Object.values(mutationApi)) expect(mutation).not.toHaveBeenCalled();
  });

  it('resumes the current creating-offers state without rewriting C01 or C02', async () => {
    const root = await tempRepo();
    const fresh = await runFresh(root);
    const localRoot = join(root, '.local', 'you-pick-sandbox');
    const initial = await readManifest(fresh.manifestPath, localRoot);
    if (!('execution' in initial)) throw new Error('Expected an executable manifest.');
    const timestamp = '2026-08-05T13:20:56.855Z';
    const manifest = executableVariationListingManifestSchema.parse({
      ...initial,
      checkpoint: 'creating-offers',
      execution: {
        ...initial.execution,
        ledger: initial.execution.ledger.map((entry) =>
          entry.id === 'item-C01' || entry.id === 'item-C02'
            ? {
                ...entry,
                state: 'completed',
                attemptCount: 1,
                startedAt: timestamp,
                completedAt: timestamp,
                result: {},
                error: null,
                readBackDigest: 'a'.repeat(64),
              }
            : entry.id === 'offer-C01'
              ? {
                  ...entry,
                  state: 'unknown',
                  attemptCount: 1,
                  startedAt: timestamp,
                  completedAt: null,
                  result: null,
                  error: 'Interrupted before exact offer reconciliation.',
                  readBackDigest: null,
                }
              : entry
        ),
      },
    });
    const plan = buildFuturePlan(manifest.execution.fixture, manifest.run);
    const itemRequests = new Map(
      plan.operations
        .filter(({ id }) => id === 'item-C01' || id === 'item-C02')
        .map(({ payload }) => {
          const request = payload as { sku: string };
          return [request.sku, payload] as const;
        })
    );
    const getInventoryItem = vi.fn(async (sku: string) => ({
      status: 'found' as const,
      value: {
        sku,
        groupKeys: null,
        quantity: manifest.execution.fixture.children.find((child) => sku.endsWith(child.slot))!
          .itemQuantity,
        semanticSnapshot: projectInventoryItemSemanticSnapshot(itemRequests.get(sku)),
      },
    }));
    const mutationApi = createMutationApi();
    let persisted = manifest;
    const offerRequest = plan.operations.find(({ id }) => id === 'offer-C01')?.payload;
    const offerId = 'OFFER-C01-EXISTING';
    const getOffers = vi.fn(async (sku: string) =>
      sku.endsWith('C01')
        ? {
            status: 'found' as const,
            value: {
              offers: [
                remoteOffer({
                  sku,
                  offerId,
                  status: 'UNPUBLISHED',
                  listingId: null,
                  listingStatus: null,
                  semanticPayload: offerRequest,
                }),
              ],
            },
          }
        : ({ status: 'unknown' as const, reason: 'read-only stop' } as const)
    );

    await expect(
      executeVariationListingManifest({
        manifest,
        manifestPath: fresh.manifestPath,
        readApi: createApi({
          getInventoryItem,
          getOffers,
        }),
        mutationApi,
        headers: { 'Content-Language': 'en-US' },
        cleanup: false,
        now: () => new Date('2026-08-05T13:30:00.000Z'),
        persist: async (next) => {
          persisted = next;
        },
      })
    ).rejects.toThrow('offer-C02 exact read is unknown');

    expect(getInventoryItem).toHaveBeenCalledTimes(2);
    expect(getOffers).toHaveBeenNthCalledWith(1, manifest.run.childSkus[0], 'EBAY_US');
    expect(getOffers).toHaveBeenNthCalledWith(2, manifest.run.childSkus[1], 'EBAY_US');
    expect(persisted.execution.ledger.slice(0, 2)).toEqual([
      expect.objectContaining({ id: 'item-C01', state: 'completed', attemptCount: 1 }),
      expect.objectContaining({ id: 'item-C02', state: 'completed', attemptCount: 1 }),
    ]);
    expect(persisted.execution.ledger[2]).toEqual(
      expect.objectContaining({ id: 'offer-C01', state: 'completed', attemptCount: 1 })
    );
    expect(persisted.resources[0]).toEqual(
      expect.objectContaining({ offerId, offerStatus: 'UNPUBLISHED' })
    );
    for (const mutation of Object.values(mutationApi)) expect(mutation).not.toHaveBeenCalled();
  });

  it('refuses same-manifest offer recovery when an owned semantic field differs', async () => {
    const root = await tempRepo();
    const fresh = await runFresh(root);
    const localRoot = join(root, '.local', 'you-pick-sandbox');
    const initial = await readManifest(fresh.manifestPath, localRoot);
    if (!('execution' in initial)) throw new Error('Expected an executable manifest.');
    const timestamp = '2026-08-05T13:20:56.855Z';
    const manifest = executableVariationListingManifestSchema.parse({
      ...initial,
      checkpoint: 'creating-offers',
      execution: {
        ...initial.execution,
        ledger: initial.execution.ledger.map((entry) =>
          entry.id === 'item-C01' || entry.id === 'item-C02'
            ? {
                ...entry,
                state: 'completed',
                attemptCount: 1,
                startedAt: timestamp,
                completedAt: timestamp,
                result: {},
                error: null,
                readBackDigest: 'a'.repeat(64),
              }
            : entry.id === 'offer-C01'
              ? {
                  ...entry,
                  state: 'unknown',
                  attemptCount: 1,
                  startedAt: timestamp,
                  completedAt: null,
                  result: null,
                  error: 'Interrupted before exact offer reconciliation.',
                  readBackDigest: null,
                }
              : entry
        ),
      },
    });
    const plan = buildFuturePlan(manifest.execution.fixture, manifest.run);
    const itemRequests = new Map(
      plan.operations
        .filter(({ id }) => id === 'item-C01' || id === 'item-C02')
        .map(({ payload }) => {
          const request = payload as { sku: string };
          return [request.sku, payload] as const;
        })
    );
    const offerRequest = plan.operations.find(({ id }) => id === 'offer-C01')?.payload as {
      pricingSummary: { price: { currency: string; value: string } };
    };
    const mismatchedOffer = {
      ...offerRequest,
      pricingSummary: {
        ...offerRequest.pricingSummary,
        price: { ...offerRequest.pricingSummary.price, value: '9.99' },
      },
    };
    const mutationApi = createMutationApi();

    await expect(
      executeVariationListingManifest({
        manifest,
        readApi: createApi({
          getInventoryItem: vi.fn(async (sku) => ({
            status: 'found',
            value: {
              sku,
              groupKeys: null,
              quantity: manifest.execution.fixture.children.find((child) =>
                sku.endsWith(child.slot)
              )!.itemQuantity,
              semanticSnapshot: projectInventoryItemSemanticSnapshot(itemRequests.get(sku)),
            },
          })),
          getOffers: vi.fn(async (sku) => ({
            status: 'found',
            value: {
              offers: [
                remoteOffer({
                  sku,
                  status: 'UNPUBLISHED',
                  listingId: null,
                  listingStatus: null,
                  semanticPayload: mismatchedOffer,
                }),
              ],
            },
          })),
        }),
        mutationApi,
        headers: { 'Content-Language': 'en-US' },
        cleanup: false,
        now: () => new Date('2026-08-05T13:30:00.000Z'),
        persist: async () => undefined,
      })
    ).rejects.toThrow('offer-C01 semantic price value does not match the immutable planned offer.');
    for (const mutation of Object.values(mutationApi)) expect(mutation).not.toHaveBeenCalled();
  });
});

describe('variation listing verifying-unpublished recovery', () => {
  it('verifies the current arrangement with equivalent aliases and replays no mutation', async () => {
    const root = await tempRepo();
    const fresh = await runFresh(root);
    const manifest = verifyingUnpublishedManifest(
      await readManifest(fresh.manifestPath, join(root, '.local', 'you-pick-sandbox'))
    );
    const plan = buildFuturePlan(manifest.execution.fixture, manifest.run);
    const itemRequests = new Map(
      plan.operations
        .filter(({ id }) => id === 'item-C01' || id === 'item-C02')
        .map(({ payload }) => [(payload as { sku: string }).sku, payload] as const)
    );
    const offerRequests = new Map(
      plan.operations
        .filter(({ id }) => id === 'offer-C01' || id === 'offer-C02')
        .map(({ payload }) => [(payload as { sku: string }).sku, payload] as const)
    );
    const groupRequest = plan.operations.find(({ id }) => id === 'group-complete')?.payload;
    const getInventoryItem = vi.fn(async (sku: string) => ({
      status: 'found' as const,
      value: normalizeVariationListingItem({
        ...(itemRequests.get(sku) as Record<string, unknown>),
        groupIds: [manifest.run.groupKey],
        inventoryItemGroupKeys: [manifest.run.groupKey],
      }),
    }));
    let offerReadCount = 0;
    const getOffers = vi.fn(async (sku: string) => {
      offerReadCount += 1;
      if (offerReadCount > 4)
        return { status: 'unknown' as const, reason: 'intentional pre-publish stop' };
      const index = manifest.run.childSkus.indexOf(sku);
      return {
        status: 'found' as const,
        value: {
          offers: [
            remoteOffer({
              sku,
              offerId: manifest.resources[index].offerId ?? undefined,
              status: 'UNPUBLISHED',
              listingId: null,
              listingStatus: null,
              semanticPayload: offerRequests.get(sku),
            }),
          ],
        },
      };
    });
    const getInventoryItemGroup = vi.fn(async () => ({
      status: 'found' as const,
      value: normalizeVariationListingGroup(groupRequest, manifest.run.groupKey),
    }));
    const mutationApi = createMutationApi();
    let persisted = manifest;

    await expect(
      executeVariationListingManifest({
        manifest,
        manifestPath: fresh.manifestPath,
        readApi: createApi({ getInventoryItem, getOffers, getInventoryItemGroup }),
        mutationApi,
        headers: { 'Content-Language': 'en-US' },
        cleanup: false,
        now: () => new Date('2026-08-05T15:30:00.000Z'),
        persist: async (next) => {
          persisted = next;
        },
      })
    ).rejects.toThrow(`Publication state for ${manifest.run.childSkus[0]} is unknown.`);

    expect(getInventoryItem).toHaveBeenCalledTimes(4);
    expect(getOffers).toHaveBeenCalledTimes(6);
    expect(getInventoryItemGroup).toHaveBeenCalledTimes(2);
    expect(persisted.checkpoint).toBe('verifying-unpublished');
    expect(
      persisted.execution.ledger.slice(0, 5).map(({ id, state, attemptCount }) => ({
        id,
        state,
        attemptCount,
      }))
    ).toEqual([
      { id: 'item-C01', state: 'completed', attemptCount: 1 },
      { id: 'item-C02', state: 'completed', attemptCount: 1 },
      { id: 'offer-C01', state: 'completed', attemptCount: 1 },
      { id: 'offer-C02', state: 'completed', attemptCount: 1 },
      { id: 'group-complete', state: 'completed', attemptCount: 1 },
    ]);
    expect(persisted.execution.ledger[5]).toEqual(
      expect.objectContaining({ id: 'publish-group', state: 'planned', attemptCount: 0 })
    );
    expect(persisted.resources).toEqual([
      expect.objectContaining({ offerId: '11409899010', offerStatus: 'UNPUBLISHED' }),
      expect.objectContaining({ offerId: '11409959010', offerStatus: 'UNPUBLISHED' }),
    ]);
    for (const mutation of Object.values(mutationApi)) expect(mutation).not.toHaveBeenCalled();
  });

  it.each([
    [
      'conflicting aliases',
      (groupKey: string) => ({
        groupIds: [groupKey],
        inventoryItemGroupKeys: ['FOREIGN-GROUP'],
      }),
      /association aliases conflict/,
    ],
    [
      'a foreign association',
      () => ({ groupIds: ['FOREIGN-GROUP'], inventoryItemGroupKeys: ['FOREIGN-GROUP'] }),
      /unexpected group association/,
    ],
    [
      'multiple associations',
      (groupKey: string) => ({
        groupIds: [groupKey, 'FOREIGN-GROUP'],
        inventoryItemGroupKeys: ['FOREIGN-GROUP', groupKey],
      }),
      /unexpected group association/,
    ],
    ['a missing expected group', () => ({}), /not associated with the exact group/],
  ])('blocks %s before publication without mutation', async (_label, associations, error) => {
    const root = await tempRepo();
    const fresh = await runFresh(root);
    const manifest = verifyingUnpublishedManifest(
      await readManifest(fresh.manifestPath, join(root, '.local', 'you-pick-sandbox'))
    );
    const plan = buildFuturePlan(manifest.execution.fixture, manifest.run);
    const itemRequests = new Map(
      plan.operations
        .filter(({ id }) => id === 'item-C01' || id === 'item-C02')
        .map(({ payload }) => [(payload as { sku: string }).sku, payload] as const)
    );
    const offerRequests = new Map(
      plan.operations
        .filter(({ id }) => id === 'offer-C01' || id === 'offer-C02')
        .map(({ payload }) => [(payload as { sku: string }).sku, payload] as const)
    );
    const groupRequest = plan.operations.find(({ id }) => id === 'group-complete')?.payload;
    const mutationApi = createMutationApi();

    await expect(
      executeVariationListingManifest({
        manifest,
        readApi: createApi({
          getInventoryItem: vi.fn(async (sku) => ({
            status: 'found',
            value: normalizeVariationListingItem({
              ...(itemRequests.get(sku) as Record<string, unknown>),
              ...associations(manifest.run.groupKey),
            }),
          })),
          getOffers: vi.fn(async (sku) => {
            const index = manifest.run.childSkus.indexOf(sku);
            return {
              status: 'found',
              value: {
                offers: [
                  remoteOffer({
                    sku,
                    offerId: manifest.resources[index].offerId ?? undefined,
                    status: 'UNPUBLISHED',
                    listingId: null,
                    listingStatus: null,
                    semanticPayload: offerRequests.get(sku),
                  }),
                ],
              },
            };
          }),
          getInventoryItemGroup: vi.fn(async () => ({
            status: 'found',
            value: normalizeVariationListingGroup(groupRequest, manifest.run.groupKey),
          })),
        }),
        mutationApi,
        headers: { 'Content-Language': 'en-US' },
        cleanup: false,
        now: () => new Date('2026-08-05T15:30:00.000Z'),
        persist: async () => undefined,
      })
    ).rejects.toThrow(error);
    expect(mutationApi.publishInventoryItemGroup).not.toHaveBeenCalled();
    for (const mutation of Object.values(mutationApi)) expect(mutation).not.toHaveBeenCalled();
  });
});

describe('variation listing publication resource persistence', () => {
  it('persists PUBLISHED on all resources after successful first publication', async () => {
    const root = await tempRepo();
    const fresh = await runFresh(root);
    const manifest = verifyingUnpublishedManifest(
      await readManifest(fresh.manifestPath, join(root, '.local', 'you-pick-sandbox'))
    );
    const plan = buildFuturePlan(manifest.execution.fixture, manifest.run);
    const itemRequests = new Map(
      plan.operations
        .filter(({ id }) => id === 'item-C01' || id === 'item-C02')
        .map(({ payload }) => [(payload as { sku: string }).sku, payload] as const)
    );
    const offerRequests = new Map(
      plan.operations
        .filter(({ id }) => id === 'offer-C01' || id === 'offer-C02')
        .map(({ payload }) => [(payload as { sku: string }).sku, payload] as const)
    );
    const groupRequest = plan.operations.find(({ id }) => id === 'group-complete')?.payload;
    const listingId = '110590199999';
    const getInventoryItem = vi.fn(async (sku: string) => ({
      status: 'found' as const,
      value: normalizeVariationListingItem({
        ...(itemRequests.get(sku) as Record<string, unknown>),
        groupIds: [manifest.run.groupKey],
        inventoryItemGroupKeys: [manifest.run.groupKey],
      }),
    }));
    let offerCall = 0;
    const getOffers = vi.fn(async (sku: string) => {
      offerCall++;
      const index = manifest.run.childSkus.indexOf(sku);
      // Call 1-6: UNPUBLISHED (creating-offers, verifying-unpublished, pre-publish reconciliation)
      // Call 7-8: PUBLISHED (post-publish reconciliation)
      const published = offerCall > 6;
      return {
        status: 'found' as const,
        value: {
          offers: [
            remoteOffer({
              sku,
              offerId: manifest.resources[index].offerId ?? undefined,
              status: published ? 'PUBLISHED' : 'UNPUBLISHED',
              listingId: published ? listingId : null,
              listingStatus: published ? 'ACTIVE' : null,
              semanticPayload: offerRequests.get(sku),
            }),
          ],
        },
      };
    });
    const getInventoryItemGroup = vi.fn(async () => ({
      status: 'found' as const,
      value: normalizeVariationListingGroup(groupRequest, manifest.run.groupKey),
    }));
    const mutationApi = createMutationApi();
    mutationApi.publishInventoryItemGroup = vi.fn(async () => ({ listingId }));
    let persisted = manifest;

    const report = await executeVariationListingManifest({
      manifest,
      manifestPath: fresh.manifestPath,
      readApi: createApi({ getInventoryItem, getOffers, getInventoryItemGroup }),
      mutationApi,
      headers: { 'Content-Language': 'en-US' },
      cleanup: false,
      now: () => new Date('2026-08-06T16:30:00.000Z'),
      persist: async (next) => {
        persisted = next;
      },
    });

    expect(report.checkpoint).toBe('awaiting-published-view-verification');
    expect(report.listingId).toBe(listingId);
    expect(persisted.published).toBe(true);
    expect(persisted.groupListingId).toBe(listingId);
    expect(persisted.resources).toEqual([
      expect.objectContaining({ offerId: '11409899010', offerStatus: 'PUBLISHED' }),
      expect.objectContaining({ offerId: '11409959010', offerStatus: 'PUBLISHED' }),
    ]);
    expect(mutationApi.publishInventoryItemGroup).toHaveBeenCalledOnce();
    // later operations untouched
    expect(persisted.execution.ledger[6].state).toBe('planned');
    expect(persisted.execution.ledger[6].attemptCount).toBe(0);
    expect(persisted.execution.ledger[7].state).toBe('planned');
    expect(persisted.execution.ledger[7].attemptCount).toBe(0);
    expect(persisted.cleanup.attempts).toBe(0);
  });

  it('adopts already-active published group and persists PUBLISHED on resources', async () => {
    const root = await tempRepo();
    const fresh = await runFresh(root);
    const manifest = verifyingUnpublishedManifest(
      await readManifest(fresh.manifestPath, join(root, '.local', 'you-pick-sandbox'))
    );
    const plan = buildFuturePlan(manifest.execution.fixture, manifest.run);
    const itemRequests = new Map(
      plan.operations
        .filter(({ id }) => id === 'item-C01' || id === 'item-C02')
        .map(({ payload }) => [(payload as { sku: string }).sku, payload] as const)
    );
    const offerRequests = new Map(
      plan.operations
        .filter(({ id }) => id === 'offer-C01' || id === 'offer-C02')
        .map(({ payload }) => [(payload as { sku: string }).sku, payload] as const)
    );
    const groupRequest = plan.operations.find(({ id }) => id === 'group-complete')?.payload;
    const listingId = '110590199998';
    const getInventoryItem = vi.fn(async (sku: string) => ({
      status: 'found' as const,
      value: normalizeVariationListingItem({
        ...(itemRequests.get(sku) as Record<string, unknown>),
        groupIds: [manifest.run.groupKey],
        inventoryItemGroupKeys: [manifest.run.groupKey],
      }),
    }));
    let offerCall = 0;
    const getOffers = vi.fn(async (sku: string) => {
      offerCall++;
      const index = manifest.run.childSkus.indexOf(sku);
      // Call 1-4: UNPUBLISHED (creating-offers, verifying-unpublished)
      // Call 5-6: PUBLISHED (reconcileCompletePublicationState finds already active)
      const published = offerCall > 4;
      return {
        status: 'found' as const,
        value: {
          offers: [
            remoteOffer({
              sku,
              offerId: manifest.resources[index].offerId ?? undefined,
              status: published ? 'PUBLISHED' : 'UNPUBLISHED',
              listingId: published ? listingId : null,
              listingStatus: published ? 'ACTIVE' : null,
              semanticPayload: offerRequests.get(sku),
            }),
          ],
        },
      };
    });
    const getInventoryItemGroup = vi.fn(async () => ({
      status: 'found' as const,
      value: normalizeVariationListingGroup(groupRequest, manifest.run.groupKey),
    }));
    const mutationApi = createMutationApi();
    let persisted = manifest;

    const report = await executeVariationListingManifest({
      manifest,
      manifestPath: fresh.manifestPath,
      readApi: createApi({ getInventoryItem, getOffers, getInventoryItemGroup }),
      mutationApi,
      headers: { 'Content-Language': 'en-US' },
      cleanup: false,
      now: () => new Date('2026-08-06T16:30:00.000Z'),
      persist: async (next) => {
        persisted = next;
      },
    });

    expect(report.checkpoint).toBe('awaiting-published-view-verification');
    expect(report.listingId).toBe(listingId);
    expect(persisted.published).toBe(true);
    expect(persisted.groupListingId).toBe(listingId);
    expect(persisted.resources).toEqual([
      expect.objectContaining({ offerId: '11409899010', offerStatus: 'PUBLISHED' }),
      expect.objectContaining({ offerId: '11409959010', offerStatus: 'PUBLISHED' }),
    ]);
    expect(mutationApi.publishInventoryItemGroup).not.toHaveBeenCalled();
    // later operations untouched
    expect(persisted.execution.ledger[6].state).toBe('planned');
    expect(persisted.execution.ledger[6].attemptCount).toBe(0);
    expect(persisted.execution.ledger[7].state).toBe('planned');
    expect(persisted.execution.ledger[7].attemptCount).toBe(0);
    expect(persisted.cleanup.attempts).toBe(0);
  });
});

describe('variation listing execution attestation gates', () => {
  it.each(['awaiting-published-view-verification', 'awaiting-quantity-zero-verification'] as const)(
    'bypasses quantity-experiment attestations for cleanup from %s',
    async (checkpoint) => {
      const root = await tempRepo();
      const prepared = await prepareExecutionCheckpoint(root, checkpoint);
      const publishedValidator = vi
        .spyOn(variationListingMutation, 'validatePublishedViewAttestation')
        .mockImplementation(() => {
          throw new Error('Published-view validator must not run during cleanup.');
        });
      const quantityValidator = vi
        .spyOn(variationListingMutation, 'validateQuantityZeroAttestation')
        .mockImplementation(() => {
          throw new Error('Quantity-zero validator must not run during cleanup.');
        });
      const executionReport = {
        mode: 'cleanup-execute',
        checkpoint,
        run: prepared.manifest.run,
        listingId: prepared.manifest.groupListingId,
        completedOperationIds: [],
        safeResumeCommand: 'manifest-owned cleanup resume',
      } as const;
      const execute = vi
        .spyOn(variationListingMutation, 'executeVariationListingManifest')
        .mockResolvedValue(executionReport);
      const mutationApiFactory = vi.fn(async () => createMutationApi());

      await expect(
        runVariationListingSandboxPilot({
          api: createApi(),
          manifestPath: prepared.manifestPath,
          cleanup: true,
          execute: true,
          confirmSandboxSeller: 'sandbox-seller-123',
          mutationApiFactory,
          repoRoot: root,
          now: () => new Date('2026-08-05T16:00:00.000Z'),
        })
      ).resolves.toEqual(executionReport);

      expect(publishedValidator).not.toHaveBeenCalled();
      expect(quantityValidator).not.toHaveBeenCalled();
      expect(mutationApiFactory).toHaveBeenCalledOnce();
      expect(execute).toHaveBeenCalledWith(expect.objectContaining({ cleanup: true }));
    }
  );

  it.each([
    [
      'awaiting-published-view-verification',
      'Published-view attestation is required for quantity-zero execution.',
    ],
    [
      'awaiting-quantity-zero-verification',
      'Quantity-zero attestation is required before withdrawal and cleanup.',
    ],
  ] as const)(
    'persists the required non-cleanup attestation failure from %s before mutation construction',
    async (checkpoint, expectedError) => {
      const root = await tempRepo();
      const prepared = await prepareExecutionCheckpoint(root, checkpoint);
      const mutationApiFactory = vi.fn(async () => createMutationApi());
      const failedAt = '2026-08-05T16:00:00.000Z';

      await expect(
        runVariationListingSandboxPilot({
          api: createApi(),
          manifestPath: prepared.manifestPath,
          execute: true,
          confirmSandboxSeller: 'sandbox-seller-123',
          mutationApiFactory,
          repoRoot: root,
          now: () => new Date(failedAt),
        })
      ).rejects.toThrow(expectedError);

      expect(mutationApiFactory).not.toHaveBeenCalled();
      const persisted = await readManifest(prepared.manifestPath, prepared.localRoot);
      expect(persisted.lastError).toBe(expectedError);
      expect(persisted.updatedAt).toBe(failedAt);
    }
  );
});

describe('variation listing cleanup completion accounting', () => {
  it('executes a valid cleanup-plan checkpoint and clears its stale pre-mutation error', async () => {
    const root = await tempRepo();
    const prepared = await prepareExecutionCheckpoint(root, 'awaiting-published-view-verification');
    const manifest = executableVariationListingManifestSchema.parse({
      ...prepared.manifest,
      lastError: 'stale pre-mutation gate error',
    });
    await writeManifestAtomic(prepared.manifestPath, manifest, prepared.localRoot);
    const harness = cleanupExecutionHarness(manifest);

    await runVariationListingSandboxPilot({
      api: harness.readApi,
      manifestPath: prepared.manifestPath,
      cleanup: true,
      repoRoot: root,
      now: () => new Date('2026-08-05T15:59:00.000Z'),
    });

    const planned = await readManifest(prepared.manifestPath, prepared.localRoot);
    expect(planned.checkpoint).toBe('cleanup-plan-ready');
    expect(planned.lastError).toBeNull();

    let tick = 0;
    await runVariationListingSandboxPilot({
      api: harness.readApi,
      manifestPath: prepared.manifestPath,
      cleanup: true,
      execute: true,
      confirmSandboxSeller: 'sandbox-seller-123',
      mutationApiFactory: vi.fn(async () => harness.mutationApi),
      repoRoot: root,
      now: () => new Date(Date.parse('2026-08-05T16:00:00.000Z') + tick++ * 1_000),
    });

    const persisted = await readManifest(prepared.manifestPath, prepared.localRoot);
    expect(persisted).toEqual(
      expect.objectContaining({
        checkpoint: 'cleanup-complete',
        lastError: null,
        cleanup: { attempts: 1, finalAbsenceVerified: true },
      })
    );
  });

  it('clears stale errors only after exact absence and records read-only verification completed/0', async () => {
    const root = await tempRepo();
    const prepared = await prepareExecutionCheckpoint(root, 'awaiting-published-view-verification');
    const manifest = executableVariationListingManifestSchema.parse({
      ...prepared.manifest,
      lastError: 'stale historical error',
    });
    await writeManifestAtomic(prepared.manifestPath, manifest, prepared.localRoot);
    const harness = cleanupExecutionHarness(manifest);
    let tick = 0;

    await runVariationListingSandboxPilot({
      api: harness.readApi,
      manifestPath: prepared.manifestPath,
      cleanup: true,
      execute: true,
      confirmSandboxSeller: 'sandbox-seller-123',
      mutationApiFactory: vi.fn(async () => harness.mutationApi),
      repoRoot: root,
      now: () => new Date(Date.parse('2026-08-05T16:00:00.000Z') + tick++ * 1_000),
    });

    const persisted = await readManifest(prepared.manifestPath, prepared.localRoot);
    if (!('execution' in persisted)) throw new Error('Expected an executable manifest.');
    expect(persisted).toEqual(
      expect.objectContaining({
        checkpoint: 'cleanup-complete',
        lastError: null,
        cleanup: { attempts: 1, finalAbsenceVerified: true },
      })
    );
    expect(
      persisted.execution.ledger
        .filter(({ id }) => id === 'withdraw-group' || id.startsWith('cleanup-'))
        .map(({ id, state, attemptCount }) => ({ id, state, attemptCount }))
    ).toEqual([
      { id: 'withdraw-group', state: 'completed', attemptCount: 1 },
      { id: 'cleanup-offer-C02', state: 'completed', attemptCount: 1 },
      { id: 'cleanup-offer-C01', state: 'completed', attemptCount: 1 },
      { id: 'cleanup-group', state: 'completed', attemptCount: 1 },
      { id: 'cleanup-child-2', state: 'completed', attemptCount: 1 },
      { id: 'cleanup-child-1', state: 'completed', attemptCount: 1 },
    ]);
    expect(persisted.execution.ledger.find(({ id }) => id === 'verify-absence')).toEqual(
      expect.objectContaining({
        state: 'completed',
        attemptCount: 0,
        startedAt: expect.any(String),
        completedAt: expect.any(String),
        readBackDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      })
    );
    expect(harness.mutationApi.withdrawInventoryItemGroup).toHaveBeenCalledOnce();
    expect(harness.mutationApi.deleteOffer).toHaveBeenCalledTimes(2);
    expect(harness.mutationApi.deleteInventoryItemGroup).toHaveBeenCalledOnce();
    expect(harness.mutationApi.deleteInventoryItem).toHaveBeenCalledTimes(2);
  });

  it('persists a current final-absence error and does not clear stale state early', async () => {
    const root = await tempRepo();
    const prepared = await prepareExecutionCheckpoint(root, 'awaiting-published-view-verification');
    const manifest = executableVariationListingManifestSchema.parse({
      ...prepared.manifest,
      lastError: 'stale historical error',
    });
    await writeManifestAtomic(prepared.manifestPath, manifest, prepared.localRoot);
    const harness = cleanupExecutionHarness(manifest, true);
    let tick = 0;

    await expect(
      runVariationListingSandboxPilot({
        api: harness.readApi,
        manifestPath: prepared.manifestPath,
        cleanup: true,
        execute: true,
        confirmSandboxSeller: 'sandbox-seller-123',
        mutationApiFactory: vi.fn(async () => harness.mutationApi),
        repoRoot: root,
        now: () => new Date(Date.parse('2026-08-05T16:00:00.000Z') + tick++ * 1_000),
      })
    ).rejects.toThrow('group final absence is unknown.');

    const persisted = await readManifest(prepared.manifestPath, prepared.localRoot);
    if (!('execution' in persisted)) throw new Error('Expected an executable manifest.');
    expect(persisted.checkpoint).toBe('cleanup-in-progress');
    expect(persisted.cleanup).toEqual({ attempts: 1, finalAbsenceVerified: false });
    expect(persisted.lastError).toBe('group final absence is unknown.');
    expect(persisted.execution.ledger.find(({ id }) => id === 'verify-absence')).toEqual(
      expect.objectContaining({
        state: 'planned',
        attemptCount: 0,
        startedAt: null,
        completedAt: null,
        readBackDigest: null,
      })
    );
  });
});

describe('variation listing cleanup planning and redaction', () => {
  it('reconstructs manifest-owned state and emits dependency-ordered cleanup without mutations', async () => {
    const root = await tempRepo();
    const fresh = await runFresh(root);
    const localRoot = join(root, '.local', 'you-pick-sandbox');
    const manifest = await readManifest(fresh.manifestPath, localRoot);
    const withResources: VariationListingManifest = {
      ...manifest,
      published: true,
      groupListingId: 'LISTING-1',
      resources: manifest.resources.map((resource, index) => ({
        ...resource,
        offerId: `OFFER-${index + 1}`,
        offerStatus: 'PUBLISHED',
      })),
    };
    await writeManifestAtomic(fresh.manifestPath, withResources, localRoot);
    const api = createApi({
      getInventoryItemGroup: vi.fn(async () => ({
        status: 'found',
        value: { variantSKUs: manifest.run.childSkus },
      })),
      getInventoryItem: vi.fn(async (sku) => ({
        status: 'found',
        value: { sku, groupKeys: [manifest.run.groupKey] },
      })),
      getOffers: vi.fn(async (sku) => ({
        status: 'found',
        value: {
          offers: [remoteOffer({ sku })],
        },
      })),
    });

    const report = await runVariationListingSandboxPilot({
      api,
      manifestPath: fresh.manifestPath,
      cleanup: true,
      repoRoot: root,
      now: () => fixedDate,
    });
    expect(report.mode).toBe('cleanup-plan');
    expect(report.operationPlan.map((item) => item.kind)).toEqual([
      'withdraw-active-group-if-needed',
      'delete-recorded-offer',
      'delete-recorded-offer',
      'delete-group',
      'delete-child',
      'delete-child',
      'verify-exact-absence',
    ]);
    expect(
      buildCleanupPlan(withResources, {
        group: 'found',
        items: [],
        offers: [],
        publicationObserved: true,
        listingCurrentlyActive: true,
        withdrawRequired: true,
        listingId: 'LISTING-1',
        lifecycleClass: 'active',
        listingStatuses: ['ACTIVE'],
        warnings: [],
      })[0]?.kind
    ).toBe('withdraw-active-group-if-needed');
    expect(report.cleanupRemoteSummary?.withdrawRequired).toBe(true);
  });

  it.each([
    ['ACTIVE', true, true],
    ['OUT_OF_STOCK', true, true],
    ['ENDED', false, false],
    ['EBAY_ENDED', false, false],
    ['NOT_LISTED', false, false],
  ] as const)(
    'separates publication history, current activity, and withdrawal for %s',
    async (listingStatus, listingCurrentlyActive, withdrawRequired) => {
      const root = await tempRepo();
      const { fresh, manifest } = await prepareCleanup(root, true);
      const report = await runVariationListingSandboxPilot({
        api: cleanupApi(manifest, (sku) => [remoteOffer({ sku, listingStatus })]),
        manifestPath: fresh.manifestPath,
        cleanup: true,
        repoRoot: root,
      });

      expect(report.cleanupRemoteSummary).toEqual(
        expect.objectContaining({
          manifestPublished: true,
          publicationObserved: true,
          listingCurrentlyActive,
          withdrawRequired,
          lifecycleClass: withdrawRequired
            ? 'active'
            : listingStatus === 'NOT_LISTED'
              ? 'not-listed'
              : 'ended',
          listingStatuses: [listingStatus],
        })
      );
      expect(report.operationPlan[0]?.kind).toBe(
        withdrawRequired ? 'withdraw-active-group-if-needed' : 'delete-recorded-offer'
      );
    }
  );

  it.each(['ACTIVE', 'OUT_OF_STOCK'] as const)(
    'requires withdrawal and warns when remote %s contradicts unpublished manifest history',
    async (listingStatus) => {
      const root = await tempRepo();
      const { fresh, manifest } = await prepareCleanup(root, false);
      const report = await runVariationListingSandboxPilot({
        api: cleanupApi(manifest, (sku) => [
          remoteOffer({ sku, listingId: 'LISTING-REMOTE', listingStatus }),
        ]),
        manifestPath: fresh.manifestPath,
        cleanup: true,
        repoRoot: root,
      });

      expect(report.cleanupRemoteSummary?.withdrawRequired).toBe(true);
      expect(report.cleanupRemoteSummary?.warnings).toContain(
        'Remote evidence shows publication not recorded by the manifest.'
      );
      expect(report.operationPlan[0]?.kind).toBe('withdraw-active-group-if-needed');
    }
  );

  it.each(['ENDED', 'EBAY_ENDED'] as const)(
    'does not force withdrawal when manifest history is published but remote status is %s',
    async (listingStatus) => {
      const root = await tempRepo();
      const { fresh, manifest } = await prepareCleanup(root, true);
      const report = await runVariationListingSandboxPilot({
        api: cleanupApi(manifest, (sku) => [remoteOffer({ sku, listingStatus })]),
        manifestPath: fresh.manifestPath,
        cleanup: true,
        repoRoot: root,
      });

      expect(report.cleanupRemoteSummary?.withdrawRequired).toBe(false);
      expect(report.cleanupRemoteSummary?.warnings).toContain(
        'Manifest publication history reconciles with a remote listing that no longer requires withdrawal.'
      );
      expect(report.operationPlan[0]?.kind).toBe('delete-recorded-offer');
    }
  );

  it('allows ACTIVE plus OUT_OF_STOCK and persists sorted unique active evidence', async () => {
    const root = await tempRepo();
    const { fresh, manifest } = await prepareCleanup(root, true);
    const report = await runVariationListingSandboxPilot({
      api: cleanupApi(manifest, (sku) => [
        remoteOffer({
          sku,
          listingStatus: sku.endsWith('C01') ? 'OUT_OF_STOCK' : 'ACTIVE',
        }),
      ]),
      manifestPath: fresh.manifestPath,
      cleanup: true,
      repoRoot: root,
    });

    expect(report.cleanupRemoteSummary).toEqual(
      expect.objectContaining({
        lifecycleClass: 'active',
        listingStatuses: ['ACTIVE', 'OUT_OF_STOCK'],
        publicationObserved: true,
        listingCurrentlyActive: true,
        withdrawRequired: true,
      })
    );
    expect(report.operationPlan[0]?.kind).toBe('withdraw-active-group-if-needed');
    const persisted = await readManifest(
      fresh.manifestPath,
      join(root, '.local', 'you-pick-sandbox')
    );
    expect(persisted.cleanupRemoteSummary?.listingStatuses).toEqual(['ACTIVE', 'OUT_OF_STOCK']);
  });

  it('allows ENDED plus EBAY_ENDED and omits withdrawal with all status evidence', async () => {
    const root = await tempRepo();
    const { fresh, manifest } = await prepareCleanup(root, true);
    const report = await runVariationListingSandboxPilot({
      api: cleanupApi(manifest, (sku) => [
        remoteOffer({
          sku,
          listingStatus: sku.endsWith('C01') ? 'ENDED' : 'EBAY_ENDED',
        }),
      ]),
      manifestPath: fresh.manifestPath,
      cleanup: true,
      repoRoot: root,
    });

    expect(report.cleanupRemoteSummary).toEqual(
      expect.objectContaining({
        lifecycleClass: 'ended',
        listingStatuses: ['EBAY_ENDED', 'ENDED'],
        publicationObserved: true,
        listingCurrentlyActive: false,
        withdrawRequired: false,
      })
    );
    expect(report.operationPlan[0]?.kind).toBe('delete-recorded-offer');
  });

  it('refuses conflicting child lifecycle states and conservatively blocks INACTIVE', async () => {
    const conflictingRoot = await tempRepo();
    const conflicting = await prepareCleanup(conflictingRoot, true);
    await expect(
      runVariationListingSandboxPilot({
        api: cleanupApi(conflicting.manifest, (sku) => [
          remoteOffer({ sku, listingStatus: sku.endsWith('C01') ? 'ACTIVE' : 'ENDED' }),
        ]),
        manifestPath: conflicting.fresh.manifestPath,
        cleanup: true,
        repoRoot: conflictingRoot,
      })
    ).rejects.toThrow(/conflicting listing lifecycle classes/);

    const inactiveRoot = await tempRepo();
    const inactive = await prepareCleanup(inactiveRoot, true);
    await expect(
      runVariationListingSandboxPilot({
        api: cleanupApi(inactive.manifest, (sku) => [
          remoteOffer({ sku, listingStatus: 'INACTIVE' }),
        ]),
        manifestPath: inactive.fresh.manifestPath,
        cleanup: true,
        repoRoot: inactiveRoot,
      })
    ).rejects.toThrow(/INACTIVE is ambiguous/);
  });

  it('stops cleanup for mismatched group children, child association, offer owner, or listing ID', async () => {
    const root = await tempRepo();
    const fresh = await runFresh(root);
    const localRoot = join(root, '.local', 'you-pick-sandbox');
    const manifest = await readManifest(fresh.manifestPath, localRoot);
    const recorded = {
      ...manifest,
      resources: manifest.resources.map((resource, index) => ({
        ...resource,
        offerId: `OFFER-${index + 1}`,
        offerStatus: 'UNPUBLISHED',
      })),
    } satisfies VariationListingManifest;
    await writeManifestAtomic(fresh.manifestPath, recorded, localRoot);

    await expect(
      runVariationListingSandboxPilot({
        api: createApi({
          getInventoryItemGroup: vi.fn(async () => ({
            status: 'found',
            value: { variantSKUs: [...manifest.run.childSkus].reverse() },
          })),
        }),
        manifestPath: fresh.manifestPath,
        cleanup: true,
        repoRoot: root,
      })
    ).rejects.toThrow(/run-owned SKUs/);
  });

  it('accepts reordered child membership only for child-only EPS fixtures', () => {
    expect(matchesVariationListingGroupChildren(4, ['C02', 'C01'], ['C01', 'C02'])).toBe(true);
    expect(matchesVariationListingGroupChildren(3, ['C02', 'C01'], ['C01', 'C02'])).toBe(false);
    expect(matchesVariationListingGroupChildren(4, ['C02', 'FOREIGN'], ['C01', 'C02'])).toBe(false);
  });

  it('adds withdrawal from remote publication evidence and reports manifest reconciliation', async () => {
    const root = await tempRepo();
    const fresh = await runFresh(root);
    const localRoot = join(root, '.local', 'you-pick-sandbox');
    const manifest = await readManifest(fresh.manifestPath, localRoot);
    const recorded: VariationListingManifest = {
      ...manifest,
      published: false,
      resources: manifest.resources.map((resource, index) => ({
        ...resource,
        offerId: `OFFER-${index + 1}`,
        offerStatus: 'UNPUBLISHED',
      })),
    };
    await writeManifestAtomic(fresh.manifestPath, recorded, localRoot);
    const report = await runVariationListingSandboxPilot({
      api: createApi({
        getInventoryItemGroup: vi.fn(async () => ({
          status: 'found',
          value: { variantSKUs: manifest.run.childSkus },
        })),
        getInventoryItem: vi.fn(async (sku) => ({
          status: 'found',
          value: { sku, groupKeys: [manifest.run.groupKey] },
        })),
        getOffers: vi.fn(async (sku) => ({
          status: 'found',
          value: {
            offers: [remoteOffer({ sku, listingId: 'LISTING-REMOTE' })],
          },
        })),
      }),
      manifestPath: fresh.manifestPath,
      cleanup: true,
      repoRoot: root,
    });
    expect(report.operationPlan[0]?.kind).toBe('withdraw-active-group-if-needed');
    expect(report.cleanupRemoteSummary?.warnings).toContain(
      'Remote evidence shows publication not recorded by the manifest.'
    );
  });

  it('refuses foreign offers, conflicting listing IDs, and unknown cleanup reads', async () => {
    const makeRecorded = async () => {
      const root = await tempRepo();
      const fresh = await runFresh(root);
      const localRoot = join(root, '.local', 'you-pick-sandbox');
      const manifest = await readManifest(fresh.manifestPath, localRoot);
      const recorded: VariationListingManifest = {
        ...manifest,
        resources: manifest.resources.map((resource, index) => ({
          ...resource,
          offerId: `OFFER-${index + 1}`,
          offerStatus: 'PUBLISHED',
        })),
      };
      await writeManifestAtomic(fresh.manifestPath, recorded, localRoot);
      return { root, fresh, manifest };
    };
    const baseApi = (
      manifest: VariationListingManifest,
      offerFactory: (sku: string) => RemoteOffer[]
    ) =>
      createApi({
        getInventoryItemGroup: vi.fn(async () => ({
          status: 'found',
          value: { variantSKUs: manifest.run.childSkus },
        })),
        getInventoryItem: vi.fn(async (sku) => ({
          status: 'found',
          value: { sku, groupKeys: [manifest.run.groupKey] },
        })),
        getOffers: vi.fn(async (sku) => ({
          status: 'found',
          value: { offers: offerFactory(sku) },
        })),
      });

    const foreign = await makeRecorded();
    await expect(
      runVariationListingSandboxPilot({
        api: baseApi(foreign.manifest, (sku) => [remoteOffer({ sku, marketplaceId: 'EBAY_GB' })]),
        manifestPath: foreign.fresh.manifestPath,
        cleanup: true,
        repoRoot: foreign.root,
      })
    ).rejects.toThrow(/unrecorded or ambiguous/);

    const conflicting = await makeRecorded();
    await expect(
      runVariationListingSandboxPilot({
        api: baseApi(conflicting.manifest, (sku) => [
          remoteOffer({
            sku,
            listingId: sku.endsWith('C01') ? 'LISTING-1' : 'LISTING-2',
          }),
        ]),
        manifestPath: conflicting.fresh.manifestPath,
        cleanup: true,
        repoRoot: conflicting.root,
      })
    ).rejects.toThrow(/conflicting group listing/);

    const unknown = await makeRecorded();
    await expect(
      runVariationListingSandboxPilot({
        api: createApi({
          getInventoryItemGroup: vi.fn(async () => ({ status: 'unknown', reason: 'HTTP 503' })),
        }),
        manifestPath: unknown.fresh.manifestPath,
        cleanup: true,
        repoRoot: unknown.root,
      })
    ).rejects.toThrow(/group state is unknown/);
  });

  it('unconditionally rejects execute before any dependency call', async () => {
    const api = createApi();
    await expect(
      runVariationListingSandboxPilot({
        api,
        fixturePath,
        execute: true,
        repoRoot: await tempRepo(),
      })
    ).rejects.toThrow(VARIATION_LISTING_EXECUTION_ERROR);
    expect(api.getRuntimeSnapshot).not.toHaveBeenCalled();
  });

  it('builds only the exact future en-US mutation header after every guard matches', () => {
    expect(
      buildGuardedMutationHeaders({
        environment: 'sandbox',
        sellerUserId: 'seller-1',
        expectedSellerUserId: 'seller-1',
        marketplaceId: 'EBAY_US',
        contentLanguage: 'en-US',
      })
    ).toEqual({ 'Content-Language': 'en-US' });
    expect(() =>
      buildGuardedMutationHeaders({
        environment: 'production',
        sellerUserId: 'seller-1',
        expectedSellerUserId: 'seller-1',
        marketplaceId: 'EBAY_US',
        contentLanguage: 'en-US',
      })
    ).toThrow(/sandbox/);
  });

  it('redacts auth, cookies, addresses, signed query strings, and fixture secrets', () => {
    const sanitized = sanitizeReport(
      {
        Authorization: 'Bearer token-value',
        cookie: 'session=secret',
        address: '123 Private Street',
        message: 'fixture-secret https://images.example.invalid/front.jpg?signature=abc&token=def',
      },
      ['fixture-secret']
    );
    const output = JSON.stringify(sanitized);
    expect(output).not.toContain('token-value');
    expect(output).not.toContain('session=secret');
    expect(output).not.toContain('Private Street');
    expect(output).not.toContain('signature=abc');
    expect(output).not.toContain('fixture-secret');
  });

  it.each([[{ User: { UserID: 'seller-123', UserName: 'seller-name' } }, 'seller-123']])(
    'parses canonical Trading identity %#',
    (response, userId) => {
      expect(parseCurrentUserIdentity(response).userId).toBe(userId);
      expect(() => parseCurrentUserIdentity({ User: { UserID: 'placeholder' } })).toThrow(
        /placeholder/
      );
    }
  );
});
