import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  YOU_PICK_EXECUTION_ERROR,
  assertSafeManifestPath,
  buildCleanupPlan,
  buildFuturePlan,
  buildGuardedMutationHeaders,
  classifyYouPickListingStatus,
  generateRunIdentity,
  parseCurrentUserIdentity,
  readManifest,
  runYouPickSandboxPilot,
  sanitizeReport,
  validateRunIdentity,
  writeManifestAtomic,
  youPickFixtureSchema,
  type RuntimeSnapshot,
  type RemoteOffer,
  type YouPickListingStatus,
  type YouPickManifest,
  type YouPickPilotReadApi,
} from '@/ebay/you-pick-sandbox-pilot.js';

const fixturePath = fileURLToPath(
  new URL('../../fixtures/you-pick-sandbox/two-card.json', import.meta.url)
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
  listingStatus?: YouPickListingStatus | null;
}): RemoteOffer {
  const status = input.status ?? 'PUBLISHED';
  const listingStatus = input.listingStatus === undefined ? 'ACTIVE' : input.listingStatus;
  const listingId = input.listingId === undefined ? 'LISTING-1' : input.listingId;
  const lifecycle = classifyYouPickListingStatus(listingStatus);
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
  };
}

async function tempRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'you-pick-pilot-'));
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

function createApi(overrides: Partial<YouPickPilotReadApi> = {}): YouPickPilotReadApi {
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

async function loadFixture(): Promise<unknown> {
  return JSON.parse(await readFile(fixturePath, 'utf8')) as unknown;
}

async function runFresh(root: string, api = createApi()) {
  return await runYouPickSandboxPilot({
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
  const recorded: YouPickManifest = {
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
  manifest: YouPickManifest,
  offerFactory: (sku: string) => RemoteOffer[]
): YouPickPilotReadApi {
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

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

describe('You Pick sandbox pilot fixture and plan', () => {
  it('strictly validates the complete ordered fixture', async () => {
    const fixture = youPickFixtureSchema.parse(await loadFixture());
    expect(fixture.children.map((child) => child.slot)).toEqual(['C01', 'C02']);

    expect(() => youPickFixtureSchema.parse({ ...fixture, unexpected: true })).toThrow();
    expect(() =>
      youPickFixtureSchema.parse({
        ...fixture,
        selector: {
          ...fixture.selector,
          values: [fixture.selector.values[0], fixture.selector.values[0]],
        },
      })
    ).toThrow(/Selector values|exactly match/);
    expect(() =>
      youPickFixtureSchema.parse({
        ...fixture,
        children: fixture.children.map((child, index) =>
          index === 0 ? { ...child, images: [child.images[1], child.images[0]] } : child
        ),
      })
    ).toThrow(/front then back/);
    expect(() =>
      youPickFixtureSchema.parse({
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
      youPickFixtureSchema.parse({
        ...fixture,
        selector: { ...fixture.selector, name: 'Customized' },
      })
    ).toThrow();
    expect(() =>
      youPickFixtureSchema.parse({
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
    const fixture = await loadFixture();
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
    expect(JSON.stringify(first)).not.toContain('listingDescription');
    expect(first.operations[0]?.payload).toEqual(
      expect.objectContaining({
        condition: 'USED_VERY_GOOD',
        conditionDescriptors: [{ name: '40001', values: ['400012'] }],
      })
    );
  });

  it('requires a different fully cleaned predecessor for a fresh-run fallback', async () => {
    const fixture = youPickFixtureSchema.parse(await loadFixture());
    expect(() =>
      youPickFixtureSchema.parse({
        ...fixture,
        predecessorRunId: '20260803T140000Z-abcdef',
        predecessorFullyCleaned: false,
      })
    ).toThrow(/fully cleaned/);
  });
});

describe('You Pick manifest persistence and dry-run gates', () => {
  it('creates the manifest before reads, persists sanitized preflight, and reports no payloads or URLs', async () => {
    const root = await tempRepo();
    const api = createApi();
    const report = await runFresh(root, api);
    const manifestText = await readFile(report.manifestPath, 'utf8');
    const manifest = JSON.parse(manifestText) as YouPickManifest;

    expect(report.mode).toBe('dry-run');
    expect(report.seller.userId).toBe('sandbox-seller-123');
    expect(report.contentLanguage).toBe('en-US');
    expect(report.gates.every((gate) => gate.status === 'pass')).toBe(true);
    expect(manifest.checkpoint).toBe('preflight-complete');
    expect(manifest.metadataSummary?.selectorStatus).toBe('taxonomy-listed');
    expect(manifestText).not.toContain('images.example.invalid');
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

    await runYouPickSandboxPilot({
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
      runYouPickSandboxPilot({
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
      runYouPickSandboxPilot({
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
  });
});

describe('You Pick cleanup planning and redaction', () => {
  it('reconstructs manifest-owned state and emits dependency-ordered cleanup without mutations', async () => {
    const root = await tempRepo();
    const fresh = await runFresh(root);
    const localRoot = join(root, '.local', 'you-pick-sandbox');
    const manifest = await readManifest(fresh.manifestPath, localRoot);
    const withResources: YouPickManifest = {
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

    const report = await runYouPickSandboxPilot({
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
      const report = await runYouPickSandboxPilot({
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
      const report = await runYouPickSandboxPilot({
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
      const report = await runYouPickSandboxPilot({
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
    const report = await runYouPickSandboxPilot({
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
    const report = await runYouPickSandboxPilot({
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
      runYouPickSandboxPilot({
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
      runYouPickSandboxPilot({
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
    } satisfies YouPickManifest;
    await writeManifestAtomic(fresh.manifestPath, recorded, localRoot);

    await expect(
      runYouPickSandboxPilot({
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
    ).rejects.toThrow(/ordered run-owned SKUs/);
  });

  it('adds withdrawal from remote publication evidence and reports manifest reconciliation', async () => {
    const root = await tempRepo();
    const fresh = await runFresh(root);
    const localRoot = join(root, '.local', 'you-pick-sandbox');
    const manifest = await readManifest(fresh.manifestPath, localRoot);
    const recorded: YouPickManifest = {
      ...manifest,
      published: false,
      resources: manifest.resources.map((resource, index) => ({
        ...resource,
        offerId: `OFFER-${index + 1}`,
        offerStatus: 'UNPUBLISHED',
      })),
    };
    await writeManifestAtomic(fresh.manifestPath, recorded, localRoot);
    const report = await runYouPickSandboxPilot({
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
      const recorded: YouPickManifest = {
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
    const baseApi = (manifest: YouPickManifest, offerFactory: (sku: string) => RemoteOffer[]) =>
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
      runYouPickSandboxPilot({
        api: baseApi(foreign.manifest, (sku) => [remoteOffer({ sku, marketplaceId: 'EBAY_GB' })]),
        manifestPath: foreign.fresh.manifestPath,
        cleanup: true,
        repoRoot: foreign.root,
      })
    ).rejects.toThrow(/unrecorded or ambiguous/);

    const conflicting = await makeRecorded();
    await expect(
      runYouPickSandboxPilot({
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
      runYouPickSandboxPilot({
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
      runYouPickSandboxPilot({
        api,
        fixturePath,
        execute: true,
        repoRoot: await tempRepo(),
      })
    ).rejects.toThrow(YOU_PICK_EXECUTION_ERROR);
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
