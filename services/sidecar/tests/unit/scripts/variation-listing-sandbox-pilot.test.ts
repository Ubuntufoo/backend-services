import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  VARIATION_LISTING_EXECUTION_ERROR,
  assertInventoryItemSemanticMatch,
  assertOfferSemanticMatch,
  projectInventoryItemSemanticSnapshot,
  projectOfferSemanticSnapshot,
  type PilotReport,
  type VariationListingPilotReadApi,
} from '@/ebay/variation-listing-sandbox-pilot.js';
import {
  adaptVariationListingPilotMutationApi,
  classifyVariationListingExactRead,
  classifyVariationListingOfferListRead,
  normalizeVariationListingItem,
  normalizeVariationListingOffers,
  parseVariationListingPilotArgs,
  normalizeVariationListingMetadata,
  normalizeVariationListingPolicies,
  runVariationListingSandboxPilotCli,
} from '@/scripts/variation-listing-sandbox-pilot.js';
import type { InventoryApi } from '@/api/listing-management/inventory.js';

const tempRoots: string[] = [];
const fixturePath = fileURLToPath(
  new URL('../../fixtures/you-pick-sandbox/two-card.json', import.meta.url)
);

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const report: PilotReport = {
  mode: 'dry-run',
  run: {
    runId: '20260803T151700Z-a1b2c3',
    prefix: 'YPSBX-20260803T151700Z-a1b2c3',
    groupKey: 'YPSBX-20260803T151700Z-a1b2c3-G',
    childSkus: ['YPSBX-20260803T151700Z-a1b2c3-C01', 'YPSBX-20260803T151700Z-a1b2c3-C02'],
  },
  manifestPath: '/repo/.local/you-pick-sandbox/20260803T151700Z-a1b2c3/manifest.json',
  seller: { userId: 'sandbox-seller-123' },
  sellerConfirmation: 'not-supplied',
  contentLanguage: 'en-US',
  gates: [{ name: 'environment', status: 'pass', detail: 'sandbox' }],
  selected: {
    policies: {
      fulfillmentPolicyId: 'FULFILLMENT-PILOT',
      paymentPolicyId: 'PAYMENT-PILOT',
      returnPolicyId: 'RETURN-PILOT',
    },
    merchantLocationKey: 'you-pick-pilot-location',
  },
  metadata: {
    categoryId: '261328',
    variationsSupported: true,
    selectorCandidates: ['Card'],
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
  },
  metadataSummary: {
    selectorStatus: 'taxonomy-listed',
    selectorName: 'Card',
    selectorCandidatesDigest: 'b'.repeat(64),
    conditionId: '4000',
    condition: 'USED_VERY_GOOD',
    conditionDescriptorsDigest: 'c'.repeat(64),
  },
  cleanupRemoteSummary: null,
  collisions: [],
  arrangementId: 'arrangement-v1-1234567890abcdef',
  operationPlan: [
    {
      id: 'item-C01',
      kind: 'create-or-replace-child-item',
      digest: 'a'.repeat(64),
    },
  ],
  requestDigests: ['a'.repeat(64)],
  nextAuthorizedCommand:
    'pnpm --filter sidecar ebay:pilot-variation-listing-sandbox -- --manifest /repo/manifest.json --execute --confirm-sandbox-seller sandbox-seller-123',
};

const plannedItem = {
  sku: 'YPSBX-20260804T173924Z-967292-C01',
  availability: { shipToLocationAvailability: { quantity: 1 } },
  condition: 'USED_VERY_GOOD',
  conditionDescriptors: [
    { name: '40002', values: ['400022', '400021'] },
    { name: '40001', values: ['400012'] },
  ],
  product: {
    aspects: {
      'Player/Athlete': ['Player B', 'Player A'],
      Card: ['C01'],
    },
  },
};

const plannedVersion2Item = {
  ...plannedItem,
  product: {
    ...plannedItem.product,
    imageUrls: [
      'https://images.example.invalid/alpha-front.jpg',
      'https://images.example.invalid/alpha-back.jpg',
    ],
  },
};

const plannedOffer = {
  sku: plannedItem.sku,
  marketplaceId: 'EBAY_US',
  format: 'FIXED_PRICE',
  categoryId: '261328',
  merchantLocationKey: 'default-main-location',
  availableQuantity: 1,
  pricingSummary: { price: { currency: 'USD', value: '1.11' } },
  listingPolicies: {
    fulfillmentPolicyId: '6227963000',
    paymentPolicyId: '6227962000',
    returnPolicyId: '6227964000',
  },
};

describe('variation listing sandbox pilot CLI', () => {
  it('parses only the dedicated explicit dry-run arguments', () => {
    expect(
      parseVariationListingPilotArgs([
        '--fixture',
        'fixture.json',
        '--confirm-sandbox-seller',
        'seller-1',
      ])
    ).toEqual({
      fixturePath: 'fixture.json',
      cleanup: false,
      execute: false,
      confirmSandboxSeller: 'seller-1',
    });
    expect(parseVariationListingPilotArgs(['--manifest', 'manifest.json', '--cleanup'])).toEqual({
      manifestPath: 'manifest.json',
      cleanup: true,
      execute: false,
    });
    expect(() => parseVariationListingPilotArgs(['--fixture', 'a', '--manifest', 'b'])).toThrow(
      /exactly one/
    );
    expect(() => parseVariationListingPilotArgs(['--fixture', 'a', '--force'])).toThrow(
      'Unknown argument: --force'
    );
    expect(() => parseVariationListingPilotArgs(['--fixture', 'a', '--cleanup'])).toThrow(
      /requires --manifest/
    );
    expect(() => parseVariationListingPilotArgs(['--manifest', 'a', '--manifest', 'b'])).toThrow(
      /only once/
    );
    expect(() => parseVariationListingPilotArgs(['--manifest', 'a', '--execute'])).toThrow(
      VARIATION_LISTING_EXECUTION_ERROR
    );
    expect(
      parseVariationListingPilotArgs([
        '--manifest',
        'manifest.json',
        '--execute',
        '--confirm-sandbox-seller',
        'seller-1',
        '--attestation',
        'attestation.json',
      ])
    ).toEqual({
      manifestPath: 'manifest.json',
      cleanup: false,
      execute: true,
      confirmSandboxSeller: 'seller-1',
      attestationPath: 'attestation.json',
    });
  });

  it.each([
    ['--execute'],
    ['--fixture', 'fixture.json', '--execute'],
    ['--manifest', 'manifest.json', '--cleanup', '--execute'],
  ])('rejects every execute shape before resolving dependencies: %s', async (...argv) => {
    const apiFactory = vi.fn<() => Promise<VariationListingPilotReadApi>>();

    await expect(runVariationListingSandboxPilotCli(argv, { apiFactory })).rejects.toThrow(
      VARIATION_LISTING_EXECUTION_ERROR
    );
    expect(apiFactory).not.toHaveBeenCalled();
  });

  it('prints sanitized structured JSON for dry-run output', async () => {
    const api = {} as VariationListingPilotReadApi;
    const apiFactory = vi.fn(async () => api);
    const runner = vi.fn(async () => report);
    const print = vi.fn();

    await expect(
      runVariationListingSandboxPilotCli(['--fixture', 'fixture.json'], {
        apiFactory,
        runner,
        print,
        repoRoot: '/repo',
      })
    ).resolves.toEqual(report);
    expect(runner).toHaveBeenCalledWith(
      expect.objectContaining({
        apiFactory,
        fixturePath: '/repo/fixture.json',
        execute: false,
        repoRoot: '/repo',
      })
    );
    expect(apiFactory).not.toHaveBeenCalled();
    const output = print.mock.calls[0]?.[0] as string;
    expect(JSON.parse(output)).toEqual(report);
    expect(output).not.toContain('Authorization');
    expect(output).not.toContain('imageUrls');
  });

  it('resolves fixture, manifest, and attestation paths from repo root under package cwd', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'variation-listing-cli-paths-'));
    tempRoots.push(repoRoot);
    const packageCwd = join(repoRoot, 'services', 'sidecar');
    const runId = '20260803T151700Z-a1b2c3';
    const attestationPath = join(
      repoRoot,
      '.local',
      'you-pick-sandbox',
      runId,
      'published-view.json'
    );
    await mkdir(packageCwd, { recursive: true });
    await mkdir(join(repoRoot, '.local', 'you-pick-sandbox', runId), { recursive: true });
    await writeFile(attestationPath, JSON.stringify({ kind: 'published-view' }), 'utf8');
    const runner = vi.fn(async () => report);
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(packageCwd);

    try {
      await runVariationListingSandboxPilotCli(['--fixture', 'fixtures/two-card.json'], {
        repoRoot,
        runner,
        print: vi.fn(),
      });
      await runVariationListingSandboxPilotCli(
        [
          '--manifest',
          `.local/you-pick-sandbox/${runId}/manifest.json`,
          '--execute',
          '--confirm-sandbox-seller',
          'sandbox-seller-123',
          '--attestation',
          `.local/you-pick-sandbox/${runId}/published-view.json`,
        ],
        { repoRoot, runner, print: vi.fn() }
      );
    } finally {
      cwd.mockRestore();
    }

    expect(runner).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        fixturePath: join(repoRoot, 'fixtures', 'two-card.json'),
        repoRoot,
      })
    );
    expect(runner).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        manifestPath: join(repoRoot, '.local', 'you-pick-sandbox', runId, 'manifest.json'),
        attestation: { kind: 'published-view' },
        repoRoot,
      })
    );
  });

  it('rejects outside and symlinked attestation paths before dependency resolution', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'variation-listing-cli-safe-'));
    const outsideRoot = await mkdtemp(join(tmpdir(), 'variation-listing-cli-outside-'));
    tempRoots.push(repoRoot, outsideRoot);
    const runId = '20260803T151700Z-a1b2c3';
    const localRun = join(repoRoot, '.local', 'you-pick-sandbox', runId);
    const outsideAttestation = join(outsideRoot, 'published-view.json');
    const linkedAttestation = join(localRun, 'published-view.json');
    await mkdir(localRun, { recursive: true });
    await writeFile(outsideAttestation, '{}', 'utf8');
    await symlink(outsideAttestation, linkedAttestation);
    const apiFactory = vi.fn<() => Promise<VariationListingPilotReadApi>>();
    const mutationApiFactory = vi.fn();
    const runner = vi.fn(async () => report);

    await expect(
      runVariationListingSandboxPilotCli(['--fixture', '../outside.json'], {
        apiFactory,
        mutationApiFactory,
        repoRoot,
        runner,
      })
    ).rejects.toThrow(/contained in the repository root/);
    await expect(
      runVariationListingSandboxPilotCli(
        [
          '--manifest',
          `.local/you-pick-sandbox/${runId}/manifest.json`,
          '--execute',
          '--confirm-sandbox-seller',
          'sandbox-seller-123',
          '--attestation',
          `.local/you-pick-sandbox/${runId}/published-view.json`,
        ],
        { apiFactory, mutationApiFactory, repoRoot, runner }
      )
    ).rejects.toThrow(/resolve within the repository root/);
    expect(runner).not.toHaveBeenCalled();
    expect(apiFactory).not.toHaveBeenCalled();
    expect(mutationApiFactory).not.toHaveBeenCalled();
  });

  it('runs the CLI dry-run through raw-response normalization without loading credentials', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'variation-listing-cli-'));
    tempRoots.push(repoRoot);
    const relativeFixturePath = join('fixtures', 'two-card.json');
    await mkdir(join(repoRoot, 'fixtures'), { recursive: true });
    await copyFile(fixturePath, join(repoRoot, relativeFixturePath));
    const apiFactory = vi.fn(
      async (): Promise<VariationListingPilotReadApi> => ({
        getRuntimeSnapshot: async () => ({
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
        }),
        getCurrentUserIdentity: async () => ({ userId: 'sandbox-seller-123' }),
        getPolicyLocationSnapshot: async () =>
          normalizeVariationListingPolicies(
            {
              fulfillmentPolicies: [
                { fulfillmentPolicyId: 'FULFILLMENT-PILOT', marketplaceId: 'EBAY_US' },
              ],
            },
            { paymentPolicies: [{ paymentPolicyId: 'PAYMENT-PILOT', marketplaceId: 'EBAY_US' }] },
            { returnPolicies: [{ returnPolicyId: 'RETURN-PILOT', marketplaceId: 'EBAY_US' }] },
            {
              locations: [
                {
                  merchantLocationKey: 'you-pick-pilot-location',
                  merchantLocationStatus: 'ENABLED',
                },
              ],
            },
            'sandbox-seller-123'
          ),
        getMetadataSnapshot: async () =>
          normalizeVariationListingMetadata(
            '261328',
            { listingStructurePolicies: [{ categoryId: '261328', variationsSupported: true }] },
            {
              itemConditionPolicies: [
                {
                  categoryId: '261328',
                  itemConditions: [
                    {
                      conditionId: '4000',
                      conditionDescription: 'Very Good',
                      conditionDescriptors: [
                        {
                          conditionDescriptorId: '40001',
                          conditionDescriptorName: 'Card Condition',
                          conditionDescriptorValues: [
                            {
                              conditionDescriptorValueId: '400012',
                              conditionDescriptorValueName: 'Very Good',
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
            { aspects: [] }
          ),
        getInventoryItemGroup: async () => ({ status: 'missing' }),
        getInventoryItem: async () => ({ status: 'missing' }),
        getOffers: async () => ({ status: 'found', value: { offers: [] } }),
      })
    );
    const print = vi.fn();

    const result = await runVariationListingSandboxPilotCli(['--fixture', relativeFixturePath], {
      apiFactory,
      print,
      repoRoot,
    });

    expect(apiFactory).toHaveBeenCalledOnce();
    expect(result.metadataSummary.selectorStatus).toBe('custom-unlisted');
    expect(JSON.parse(print.mock.calls[0]?.[0] as string)).toEqual(result);
  });
});

describe('variation listing inventory item adapter contract', () => {
  it('canonicalizes a successful empty-string transport result to void', async () => {
    const createOrReplaceInventoryItem = vi.fn(async () => '' as never);
    const api = adaptVariationListingPilotMutationApi({
      createOrReplaceInventoryItem,
    } as unknown as InventoryApi);

    await expect(
      api.createOrReplaceInventoryItem(plannedItem.sku, plannedItem, {
        'Content-Language': 'en-US',
      })
    ).resolves.toBeUndefined();
    expect(createOrReplaceInventoryItem).toHaveBeenCalledWith(plannedItem.sku, plannedItem, {
      headers: { 'Content-Language': 'en-US' },
    });
  });

  it('preserves real inventory item transport errors', async () => {
    const transportError = new Error('transport failed');
    const api = adaptVariationListingPilotMutationApi({
      createOrReplaceInventoryItem: vi.fn(async () => {
        throw transportError;
      }),
    } as unknown as InventoryApi);

    await expect(
      api.createOrReplaceInventoryItem(plannedItem.sku, plannedItem, {
        'Content-Language': 'en-US',
      })
    ).rejects.toBe(transportError);
  });
});

describe('variation listing offer-list read adapter contract', () => {
  const offer = {
    ...plannedOffer,
    offerId: 'OFFER-1',
    status: 'UNPUBLISHED',
  };

  it('maps only an offer-list 404 to an exact empty collection', async () => {
    const notFound = Object.assign(new Error('not found'), { response: { status: 404 } });

    await expect(
      classifyVariationListingOfferListRead(async () => {
        throw notFound;
      })
    ).resolves.toEqual({ status: 'found', value: { offers: [] } });
    await expect(
      classifyVariationListingExactRead(async () => {
        throw notFound;
      })
    ).resolves.toEqual({ status: 'missing' });
  });

  it('normalizes an existing offer collection', async () => {
    await expect(
      classifyVariationListingOfferListRead(async () => ({ offers: [offer] }))
    ).resolves.toEqual({
      status: 'found',
      value: {
        offers: [
          expect.objectContaining({
            offerId: 'OFFER-1',
            sku: plannedItem.sku,
            marketplaceId: 'EBAY_US',
            status: 'UNPUBLISHED',
            semanticSnapshot: projectOfferSemanticSnapshot(plannedOffer),
          }),
        ],
      },
    });
  });

  it.each([
    ['malformed', { offers: ['not-an-offer'] }],
    ['duplicate', { offers: [offer, { ...offer }] }],
  ])('rejects a %s offer collection', async (_label, response) => {
    await expect(classifyVariationListingOfferListRead(async () => response)).rejects.toThrow();
  });

  it('preserves a non-404 transport failure as unknown', async () => {
    const unavailable = Object.assign(new Error('transport unavailable'), {
      response: { status: 503 },
    });

    await expect(
      classifyVariationListingOfferListRead(async () => {
        throw unavailable;
      })
    ).resolves.toEqual({ status: 'unknown', reason: 'transport unavailable' });
  });

  it('ignores the demonstrated server-managed offer fields', () => {
    const normalized = normalizeVariationListingOffers({
      offers: [
        {
          ...offer,
          hideBuyerDetails: false,
          includeCatalogProductDetails: true,
          listingDuration: 'GTC',
          tax: { applyTax: false },
          listingPolicies: { ...offer.listingPolicies, eBayPlusIfEligible: false },
        },
      ],
    }).offers[0];

    expect(normalized.semanticSnapshot).toEqual(projectOfferSemanticSnapshot(plannedOffer));
    expect(() =>
      assertOfferSemanticMatch(normalized.semanticSnapshot, plannedOffer, 'offer-C01')
    ).not.toThrow();
  });

  it.each([
    ['SKU', { ...plannedOffer, sku: `${plannedOffer.sku}-foreign` }],
    ['marketplace ID', { ...plannedOffer, marketplaceId: 'EBAY_GB' }],
    ['format', { ...plannedOffer, format: 'AUCTION' }],
    ['category ID', { ...plannedOffer, categoryId: '999999' }],
    ['merchant location key', { ...plannedOffer, merchantLocationKey: 'foreign-location' }],
    ['available quantity', { ...plannedOffer, availableQuantity: 2 }],
    [
      'price currency',
      {
        ...plannedOffer,
        pricingSummary: { price: { ...plannedOffer.pricingSummary.price, currency: 'CAD' } },
      },
    ],
    [
      'price value',
      {
        ...plannedOffer,
        pricingSummary: { price: { ...plannedOffer.pricingSummary.price, value: '9.99' } },
      },
    ],
    [
      'fulfillment policy ID',
      {
        ...plannedOffer,
        listingPolicies: {
          ...plannedOffer.listingPolicies,
          fulfillmentPolicyId: 'foreign-fulfillment',
        },
      },
    ],
    [
      'payment policy ID',
      {
        ...plannedOffer,
        listingPolicies: { ...plannedOffer.listingPolicies, paymentPolicyId: 'foreign-payment' },
      },
    ],
    [
      'return policy ID',
      {
        ...plannedOffer,
        listingPolicies: { ...plannedOffer.listingPolicies, returnPolicyId: 'foreign-return' },
      },
    ],
  ])('reports a field-specific %s mismatch', (field, changed) => {
    const actual = projectOfferSemanticSnapshot(plannedOffer);
    expect(() => assertOfferSemanticMatch(actual, changed, 'offer-C01')).toThrow(
      `offer-C01 semantic ${field} does not match the immutable planned offer.`
    );
  });

  it.each([
    ['missing pricing summary', { ...offer, pricingSummary: undefined }],
    [
      'missing policy',
      {
        ...offer,
        listingPolicies: { ...offer.listingPolicies, paymentPolicyId: undefined },
      },
    ],
    ['malformed quantity', { ...offer, availableQuantity: '1' }],
    ['malformed price', { ...offer, pricingSummary: { price: { currency: 'USD', value: 1.11 } } }],
  ])('fails closed on %s', (_label, malformed) => {
    expect(() => normalizeVariationListingOffers({ offers: [malformed] })).toThrow();
  });

  it.each([
    ['published without listing identity', { ...offer, status: 'PUBLISHED' }],
    [
      'unpublished with listing identity',
      {
        ...offer,
        listing: { listingId: 'LISTING-1', listingStatus: 'ACTIVE' },
      },
    ],
  ])('rejects %s', (_label, ambiguous) => {
    expect(() => normalizeVariationListingOffers({ offers: [ambiguous] })).toThrow(
      'Offer response has ambiguous publication and listing identity.'
    );
  });
});

describe('variation listing inventory item semantic snapshots', () => {
  it.each([
    ['groupIds', { groupIds: ['G1'] }],
    ['inventoryItemGroupKeys', { inventoryItemGroupKeys: ['G1'] }],
  ])('normalizes the %s association alias', (_label, associations) => {
    expect(normalizeVariationListingItem({ ...plannedItem, ...associations }).groupKeys).toEqual([
      'G1',
    ]);
  });

  it('accepts equivalent association aliases and returns one deterministic list', () => {
    expect(
      normalizeVariationListingItem({
        ...plannedItem,
        groupIds: ['G1'],
        inventoryItemGroupKeys: ['G1'],
      }).groupKeys
    ).toEqual(['G1']);
    expect(
      normalizeVariationListingItem({
        ...plannedItem,
        groupIds: ['G2', 'G1'],
        inventoryItemGroupKeys: ['G1', 'G2'],
      }).groupKeys
    ).toEqual(['G1', 'G2']);
  });

  it('distinguishes absent aliases from agreed empty association aliases', () => {
    expect(normalizeVariationListingItem(plannedItem).groupKeys).toBeNull();
    expect(
      normalizeVariationListingItem({
        ...plannedItem,
        groupIds: [],
        inventoryItemGroupKeys: [],
      }).groupKeys
    ).toEqual([]);
  });

  it.each([
    ['empty and non-empty', [], ['G1']],
    ['conflicting sets', ['G1'], ['G2']],
    ['missing value in one alias', ['G1', 'G2'], ['G1']],
  ])('rejects %s association aliases', (_label, groupIds, inventoryItemGroupKeys) => {
    expect(() =>
      normalizeVariationListingItem({ ...plannedItem, groupIds, inventoryItemGroupKeys })
    ).toThrow('Inventory item group association aliases conflict.');
  });

  it.each([
    ['groupIds', { key: 'groupIds', value: 'G1' }],
    ['inventoryItemGroupKeys', { key: 'inventoryItemGroupKeys', value: {} }],
  ])('rejects non-array %s', (_label, malformed) => {
    expect(() =>
      normalizeVariationListingItem({ ...plannedItem, [malformed.key]: malformed.value })
    ).toThrow(/association must be an array/);
  });

  it.each([
    ['non-string', { groupIds: ['G1', 1] }],
    ['blank', { inventoryItemGroupKeys: [' '] }],
    ['duplicate', { groupIds: ['G1', ' G1 '] }],
  ])('rejects %s association values', (_label, associations) => {
    expect(() => normalizeVariationListingItem({ ...plannedItem, ...associations })).toThrow(
      /malformed or duplicate associations/
    );
  });

  it('preserves multiple case-sensitive associations while canonicalizing only order', () => {
    expect(
      normalizeVariationListingItem({
        ...plannedItem,
        groupIds: ['group-2', 'Group 1'],
      }).groupKeys
    ).toEqual(['Group 1', 'group-2']);
  });

  it('ignores demonstrated server-managed fields and canonicalizes unordered API collections', () => {
    const raw = {
      ...plannedItem,
      locale: 'en_US',
      availability: {
        shipToLocationAvailability: {
          allocationByFormat: { FIXED_PRICE: 1 },
          quantity: 1,
        },
      },
      conditionDescriptors: [...plannedItem.conditionDescriptors]
        .reverse()
        .map((descriptor) => ({ ...descriptor, values: [...descriptor.values].reverse() })),
      product: {
        aspects: {
          Card: ['C01'],
          'Player/Athlete': ['Player A', 'Player B'],
        },
      },
    };

    expect(normalizeVariationListingItem(raw)).toEqual({
      sku: plannedItem.sku,
      groupKeys: null,
      quantity: 1,
      semanticSnapshot: projectInventoryItemSemanticSnapshot(plannedItem),
    });
  });

  it('keeps version-1 semantic recovery independent of child image fields', () => {
    const actual = normalizeVariationListingItem({
      ...plannedItem,
      product: {
        ...plannedItem.product,
        imageUrls: ['foreign', 'legacy-shape-is-ignored'],
      },
    }).semanticSnapshot;

    expect(() => assertInventoryItemSemanticMatch(actual, plannedItem, 'item-C01')).not.toThrow();
  });

  it('accepts the exact ordered version-2 child image pair', () => {
    const actual = normalizeVariationListingItem(plannedVersion2Item).semanticSnapshot;

    expect(() =>
      assertInventoryItemSemanticMatch(actual, plannedVersion2Item, 'item-C01')
    ).not.toThrow();
  });

  it.each([
    ['missing', plannedItem],
    [
      'reordered',
      {
        ...plannedVersion2Item,
        product: {
          ...plannedVersion2Item.product,
          imageUrls: [...plannedVersion2Item.product.imageUrls].reverse(),
        },
      },
    ],
    [
      'foreign',
      {
        ...plannedVersion2Item,
        product: {
          ...plannedVersion2Item.product,
          imageUrls: [
            plannedVersion2Item.product.imageUrls[0],
            'https://images.example.invalid/foreign-back.jpg',
          ],
        },
      },
    ],
    [
      'cross-child',
      {
        ...plannedVersion2Item,
        product: {
          ...plannedVersion2Item.product,
          imageUrls: [
            'https://images.example.invalid/beta-front.jpg',
            'https://images.example.invalid/beta-back.jpg',
          ],
        },
      },
    ],
  ])('rejects %s version-2 child image ownership', (_label, raw) => {
    const actual = normalizeVariationListingItem(raw).semanticSnapshot;

    expect(() => assertInventoryItemSemanticMatch(actual, plannedVersion2Item, 'item-C01')).toThrow(
      'item-C01 semantic product images does not match the immutable planned item.'
    );
  });

  it.each([
    ['SKU', { ...plannedItem, sku: `${plannedItem.sku}-foreign` }],
    [
      'quantity',
      {
        ...plannedItem,
        availability: { shipToLocationAvailability: { quantity: 2 } },
      },
    ],
    ['condition', { ...plannedItem, condition: 'USED_GOOD' }],
    [
      'condition descriptors',
      {
        ...plannedItem,
        conditionDescriptors: [{ name: '40001', values: ['400099'] }],
      },
    ],
    [
      'product aspects',
      {
        ...plannedItem,
        product: { aspects: { Card: ['C02'], 'Player/Athlete': ['Player A', 'Player B'] } },
      },
    ],
  ])('reports a field-specific %s mismatch', (field, changed) => {
    const actual = normalizeVariationListingItem(plannedItem).semanticSnapshot;
    expect(() => assertInventoryItemSemanticMatch(actual, changed, 'item-C01')).toThrow(
      `item-C01 semantic ${field} does not match the immutable planned item.`
    );
  });

  it.each([
    [
      'missing descriptors',
      { ...plannedItem, conditionDescriptors: undefined },
      /condition descriptors are missing/,
    ],
    [
      'duplicate descriptor names',
      {
        ...plannedItem,
        conditionDescriptors: [
          { name: '40001', values: ['400012'] },
          { name: '40001', values: ['400013'] },
        ],
      },
      /duplicate names/,
    ],
    [
      'duplicate descriptor values',
      {
        ...plannedItem,
        conditionDescriptors: [{ name: '40001', values: ['400012', '400012'] }],
      },
      /duplicate values/,
    ],
    [
      'duplicate aspect values',
      {
        ...plannedItem,
        product: { aspects: { Card: ['C01', 'C01'] } },
      },
      /duplicate values/,
    ],
    ['missing aspects', { ...plannedItem, product: {} }, /product aspects is missing/],
  ])('fails closed on %s', (_label, raw, error) => {
    expect(() => normalizeVariationListingItem(raw)).toThrow(error);
  });
});

// Module-level mock state for createVariationListingPilotReadApi tests
var readApiMockState = {
  initFn: vi.fn(async () => {}),
  getInventoryItemFn: vi.fn(async () => ({
    sku: 'sku-1',
    availability: { shipToLocationAvailability: { quantity: 1 } },
    condition: 'USED_VERY_GOOD',
    conditionDescriptors: [{ name: '40001', values: ['400012'] }],
    product: { aspects: { Card: ['a'] } },
  })),
  getOffersFn: vi.fn(async () => ({ offers: [] })),
  getInventoryItemGroupFn: vi.fn(async () => ({
    variantSKUs: ['sku-1', 'sku-2'],
    title: 'T',
    description: 'D',
    aspects: {},
    imageUrls: ['https://example.com/1.jpg'],
    variesBy: { specifications: [{ name: 'Card', values: ['a', 'b'] }] },
  })),
  getCurrentUserIdentityFn: vi.fn(async () => ({ userId: 'u', username: 'u' })),
};

vi.mock('@/api/index.js', () => {
  class MockEbaySellerApi {
    inventory = {
      getInventoryItem: readApiMockState.getInventoryItemFn,
      getOffers: readApiMockState.getOffersFn,
      getInventoryItemGroup: readApiMockState.getInventoryItemGroupFn,
      getInventoryLocations: vi.fn(async () => ({ locations: [] })),
    };
    trading = { getCurrentUserIdentity: readApiMockState.getCurrentUserIdentityFn };
    account = {
      getFulfillmentPolicies: vi.fn(async () => ({})),
      getPaymentPolicies: vi.fn(async () => ({})),
      getReturnPolicies: vi.fn(async () => ({})),
    };
    initialize = readApiMockState.initFn;
  }
  return { EbaySellerApi: MockEbaySellerApi };
});

vi.mock('@/config/environment.js', () => ({
  getEbayConfig: () => ({
    environment: 'sandbox',
    marketplaceId: 'EBAY_US',
    refreshToken: 'token',
  }),
  getBaseUrl: () => 'https://api.sandbox.ebay.com',
  getAuthUrl: () => 'https://api.sandbox.ebay.com/oauth',
}));

describe('createVariationListingPilotReadApi ensureInitialized', () => {
  beforeEach(() => {
    vi.stubEnv('EBAY_ENVIRONMENT', 'sandbox');
    vi.stubEnv('EBAY_MARKETPLACE_ID', 'EBAY_US');
    vi.stubEnv('EBAY_CONTENT_LANGUAGE', 'en-US');
    vi.stubEnv('SIDECAR_JOB_RUNNER_ENABLED', 'false');
    vi.stubEnv('APIFY_ENABLED', 'false');
    vi.stubEnv('SOLDCOMPS_ENABLED', 'false');
    vi.stubEnv('EBAY_PUBLISH_ENABLED', 'false');
    vi.stubEnv('WATCHER_ENABLED', 'false');
    vi.clearAllMocks();
    readApiMockState.initFn.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function getApi() {
    const mod = await import('@/scripts/variation-listing-sandbox-pilot.js');
    return mod.createVariationListingPilotReadApi();
  }

  it('getInventoryItem initializes before the inventory call', async () => {
    let initDone = false;
    readApiMockState.initFn.mockImplementation(async () => {
      initDone = true;
    });
    const api = await getApi();
    await api.getInventoryItem('sku-1');
    const initOrder = readApiMockState.initFn.mock.invocationCallOrder[0];
    const invOrder = readApiMockState.getInventoryItemFn.mock.invocationCallOrder[0];
    expect(initOrder).toBeLessThan(invOrder);
    expect(readApiMockState.initFn).toHaveBeenCalledOnce();
    expect(initDone).toBe(true);
  });

  it('getOffers initializes before the inventory call', async () => {
    const api = await getApi();
    await api.getOffers('sku-1', 'EBAY_US');
    expect(readApiMockState.initFn.mock.invocationCallOrder[0]).toBeLessThan(
      readApiMockState.getOffersFn.mock.invocationCallOrder[0]
    );
    expect(readApiMockState.initFn).toHaveBeenCalledOnce();
  });

  it('getInventoryItemGroup initializes before the inventory call', async () => {
    const api = await getApi();
    await api.getInventoryItemGroup('group-1');
    expect(readApiMockState.initFn.mock.invocationCallOrder[0]).toBeLessThan(
      readApiMockState.getInventoryItemGroupFn.mock.invocationCallOrder[0]
    );
    expect(readApiMockState.initFn).toHaveBeenCalledOnce();
  });

  it('getCurrentUserIdentity followed by Inventory reads initializes exactly once', async () => {
    const api = await getApi();
    await api.getCurrentUserIdentity();
    await api.getInventoryItem('sku-1');
    expect(readApiMockState.initFn).toHaveBeenCalledOnce();
  });

  it('concurrent first reads share one initialization', async () => {
    let resolveInit: () => void = () => {};
    const initStarted = vi.fn();
    readApiMockState.initFn.mockImplementation(
      () =>
        new Promise<void>((r) => {
          initStarted();
          resolveInit = r;
        })
    );
    const api = await getApi();
    const p1 = api.getInventoryItem('sku-1');
    const p2 = api.getOffers('sku-2', 'EBAY_US');
    await vi.waitFor(() => expect(initStarted).toHaveBeenCalled());
    expect(readApiMockState.initFn).toHaveBeenCalledOnce();
    resolveInit();
    await Promise.all([p1, p2]);
    expect(readApiMockState.initFn).toHaveBeenCalledOnce();
  });

  it('initialization rejection prevents downstream call', async () => {
    readApiMockState.initFn.mockRejectedValue(new Error('auth failed'));
    const api = await getApi();
    await expect(api.getInventoryItem('sku-1')).rejects.toThrow('auth failed');
    expect(readApiMockState.initFn).toHaveBeenCalledOnce();
    expect(readApiMockState.getInventoryItemFn).not.toHaveBeenCalled();
  });

  it('after initialization rejection, subsequent reads remain fail-closed', async () => {
    readApiMockState.initFn.mockRejectedValue(new Error('auth failed'));
    const api = await getApi();
    await expect(api.getInventoryItem('sku-1')).rejects.toThrow('auth failed');
    await expect(api.getOffers('sku-2', 'EBAY_US')).rejects.toThrow('auth failed');
    expect(readApiMockState.initFn).toHaveBeenCalledOnce();
    expect(readApiMockState.getInventoryItemFn).not.toHaveBeenCalled();
    expect(readApiMockState.getOffersFn).not.toHaveBeenCalled();
  });
});
