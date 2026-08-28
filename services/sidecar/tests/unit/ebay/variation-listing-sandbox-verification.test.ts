import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildFuturePlan,
  digest,
  executableVariationListingManifestSchema,
  generateRunIdentity,
  projectInventoryItemSemanticSnapshot,
  projectOfferSemanticSnapshot,
  type ExecutableVariationListingManifest,
  type RemoteOffer,
  type VariationListingStatus,
  type VariationListingPilotReadApi,
  type RuntimeSnapshot,
} from '@/ebay/variation-listing-sandbox-pilot.js';
import {
  reconcileCompletePublicationState,
  verifyVariationListingSandbox,
} from '@/ebay/variation-listing-sandbox-verification.js';

const fixedDate = new Date('2026-08-06T19:03:00.000Z');

function remoteOffer(input: {
  sku: string;
  offerId?: string;
  marketplaceId?: string;
  status?: RemoteOffer['status'];
  listingId?: string | null;
  listingStatus?: VariationListingStatus | null;
  availableQuantity?: number;
  semanticPayload?: unknown;
}): RemoteOffer {
  const status = input.status ?? 'PUBLISHED';
  const listingStatus = input.listingStatus === undefined ? 'ACTIVE' : input.listingStatus;
  const listingId = input.listingId === undefined ? 'LISTING-1' : input.listingId;
  const lifecycle: RemoteOffer['lifecycleClass'] =
    listingStatus === 'ACTIVE' || listingStatus === 'OUT_OF_STOCK'
      ? 'active'
      : listingStatus === 'ENDED' || listingStatus === 'EBAY_ENDED'
        ? 'ended'
        : listingStatus === 'NOT_LISTED'
          ? 'not-listed'
          : null;
  const publicationObserved =
    status === 'PUBLISHED' || lifecycle === 'active' || lifecycle === 'ended';
  return {
    offerId: input.offerId ?? (input.sku.endsWith('C01') ? 'OFFER-1' : 'OFFER-2'),
    sku: input.sku,
    marketplaceId: input.marketplaceId ?? 'EBAY_US',
    status,
    listingId,
    listingStatus,
    lifecycleClass: lifecycle,
    publicationObserved,
    listingCurrentlyActive: lifecycle === 'active',
    withdrawRequired: lifecycle === 'active',
    availableQuantity: input.availableQuantity ?? 1,
    semanticSnapshot:
      input.semanticPayload === undefined
        ? undefined
        : projectOfferSemanticSnapshot(input.semanticPayload),
  };
}

const defaultRuntime: RuntimeSnapshot = {
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

function createReadApi(
  overrides: Partial<VariationListingPilotReadApi> = {}
): VariationListingPilotReadApi {
  return {
    getRuntimeSnapshot: vi.fn(async () => ({ ...defaultRuntime })),
    getCurrentUserIdentity: vi.fn(async () => ({
      userId: 'testuser_mfhsandbox',
      username: 'testuser_mfhsandbox',
    })),
    getPolicyLocationSnapshot: vi.fn(),
    getMetadataSnapshot: vi.fn(),
    getInventoryItemGroup: vi.fn(async () => ({
      status: 'found',
      value: { variantSKUs: [], snapshotDigest: 'c'.repeat(64) },
    })),
    getInventoryItem: vi.fn(async () => ({ status: 'missing' as const })),
    getOffers: vi.fn(async () => ({ status: 'found' as const, value: { offers: [] } })),
    ...overrides,
  };
}

function makeManifest(
  overrides: Partial<ExecutableVariationListingManifest> = {}
): ExecutableVariationListingManifest {
  const run = generateRunIdentity(2, fixedDate, Buffer.from('a1b2c3', 'hex'));
  const fixture = {
    version: 2 as const,
    marketplaceId: 'EBAY_US' as const,
    categoryId: '261328' as const,
    format: 'FIXED_PRICE' as const,
    contentLanguage: 'en-US' as const,
    policies: { fulfillmentPolicyId: 'FP-1', paymentPolicyId: 'PP-1', returnPolicyId: 'RP-1' },
    merchantLocationKey: 'MLK-1',
    selector: { name: 'Card' as const, values: ['Charizard', 'Pikachu'] },
    group: {
      title: 'Test Group',
      description: 'Test Description',
      sharedAspects: { Brand: ['Pokemon'] },
      variantSkuSnapshot: ['C01', 'C02'],
      variesBy: {
        specifications: [{ name: 'Card', values: ['Charizard', 'Pikachu'] }],
        aspectsImageVariesBy: 'Card',
      },
    },
    sharedCondition: {
      condition: 'USED_VERY_GOOD' as const,
      conditionId: '4000' as const,
      conditionDescriptors: [{ name: '40001', values: ['400012'] }],
    },
    children: [
      {
        slot: 'C01' as const,
        selector: { name: 'Card', value: 'Charizard' },
        productAspects: { Card: ['Charizard'], Brand: ['Pokemon'] },
        itemQuantity: 1,
        offerQuantity: 1,
        price: { currency: 'USD' as const, value: '10.00' },
        images: [
          { role: 'front' as const, url: 'https://example.com/cf.jpg', fingerprint: 'fp-cf' },
          { role: 'back' as const, url: 'https://example.com/cb.jpg', fingerprint: 'fp-cb' },
        ],
        condition: {
          condition: 'USED_VERY_GOOD' as const,
          conditionId: '4000' as const,
          conditionDescriptors: [{ name: '40001', values: ['400012'] }],
        },
      },
      {
        slot: 'C02' as const,
        selector: { name: 'Card', value: 'Pikachu' },
        productAspects: { Card: ['Pikachu'], Brand: ['Pokemon'] },
        itemQuantity: 2,
        offerQuantity: 2,
        price: { currency: 'USD' as const, value: '20.00' },
        images: [
          { role: 'front' as const, url: 'https://example.com/pf.jpg', fingerprint: 'fp-pf' },
          { role: 'back' as const, url: 'https://example.com/pb.jpg', fingerprint: 'fp-pb' },
        ],
        condition: {
          condition: 'USED_VERY_GOOD' as const,
          conditionId: '4000' as const,
          conditionDescriptors: [{ name: '40001', values: ['400012'] }],
        },
      },
    ],
  };
  const plan = buildFuturePlan(fixture, run);
  const ownership = {
    selectorName: fixture.selector.name,
    selectorValues: fixture.selector.values,
    imageFingerprints: fixture.children.flatMap((c) => c.images.map((i) => i.fingerprint)),
    itemQuantities: fixture.children.map((c) => c.itemQuantity),
    offerQuantities: fixture.children.map((c) => c.offerQuantity),
    prices: fixture.children.map((c) => c.price.value),
    condition: fixture.sharedCondition.condition,
    conditionId: fixture.sharedCondition.conditionId,
    conditionDescriptors: fixture.sharedCondition.conditionDescriptors,
    conditionDigest: digest(fixture.sharedCondition),
    fulfillmentPolicyId: fixture.policies.fulfillmentPolicyId,
    paymentPolicyId: fixture.policies.paymentPolicyId,
    returnPolicyId: fixture.policies.returnPolicyId,
    merchantLocationKey: fixture.merchantLocationKey,
  };
  const completedOps = new Set([
    'item-C01',
    'item-C02',
    'offer-C01',
    'offer-C02',
    'group-complete',
    'publish-group',
  ]);
  return executableVariationListingManifestSchema.parse({
    version: 5,
    run,
    createdAt: fixedDate.toISOString(),
    updatedAt: fixedDate.toISOString(),
    mode: 'dry-run',
    checkpoint: 'awaiting-published-view-verification',
    seller: { userId: 'testuser_mfhsandbox' },
    expected: {
      environment: 'sandbox',
      restOrigin: 'https://api.sandbox.ebay.com',
      oauthOrigin: 'https://api.sandbox.ebay.com',
      tradingOrigin: 'https://api.sandbox.ebay.com',
      marketplaceId: 'EBAY_US',
      categoryId: '261328',
      contentLanguage: 'en-US',
    },
    ownership,
    arrangementId: plan.arrangementId,
    predecessorRunId: null,
    predecessorFullyCleaned: false,
    published: true,
    groupListingId: 'LISTING-1',
    resources: run.childSkus.map((sku) => ({
      sku,
      offerId: sku.endsWith('C01') ? 'OFFER-1' : 'OFFER-2',
      offerStatus: 'PUBLISHED',
    })),
    gates: [],
    collisions: [],
    metadataSummary: null,
    cleanupRemoteSummary: null,
    operations: plan.operations.map(({ id, kind, digest: value }) => ({ id, kind, digest: value })),
    execution: {
      eligible: true,
      fixture,
      ledger: plan.operations.map(({ id, kind, digest: requestDigest }) => ({
        id,
        kind,
        requestDigest,
        state: completedOps.has(id) ? ('completed' as const) : ('planned' as const),
        attemptCount: completedOps.has(id) ? 1 : 0,
        startedAt: completedOps.has(id) ? fixedDate.toISOString() : null,
        completedAt: completedOps.has(id) ? fixedDate.toISOString() : null,
        result: null,
        error: null,
        readBackDigest: completedOps.has(id) ? 'a'.repeat(64) : null,
      })),
      publishedAttestationDigest: null,
      quantityZeroAttestationDigest: null,
    },
    cleanup: { attempts: 0, finalAbsenceVerified: false },
    lastError: null,
    ...overrides,
  }) as ExecutableVariationListingManifest;
}

afterEach(() => {
  vi.restoreAllMocks();
});

const offerPayload = (sku: string, availableQuantity = 1) => ({
  sku,
  marketplaceId: 'EBAY_US',
  format: 'FIXED_PRICE',
  categoryId: '261328',
  merchantLocationKey: 'MLK-1',
  availableQuantity,
  pricingSummary: { price: { currency: 'USD', value: '10.00' } },
  listingPolicies: { fulfillmentPolicyId: 'FP-1', paymentPolicyId: 'PP-1', returnPolicyId: 'RP-1' },
});

function validItemResponse(sku: string, groupKey: string, quantity: number, itemPayload: unknown) {
  return Promise.resolve({
    status: 'found' as const,
    value: {
      sku,
      groupKeys: [groupKey],
      quantity,
      semanticSnapshot: projectInventoryItemSemanticSnapshot(itemPayload),
    },
  });
}
function validOffersResponse(sku: string, offerId: string) {
  const isC01 = sku.endsWith('C01');
  const qty = isC01 ? 1 : 2;
  const price = isC01 ? '10.00' : '20.00';
  const payload = {
    ...offerPayload(sku, qty),
    pricingSummary: { price: { currency: 'USD', value: price } },
  };
  return Promise.resolve({
    status: 'found' as const,
    value: {
      offers: [
        remoteOffer({
          sku,
          offerId,
          listingId: 'LISTING-1',
          listingStatus: 'ACTIVE',
          availableQuantity: qty,
          semanticPayload: payload,
        }),
      ],
    },
  });
}
function validGroupResponse(childSkus: string[], groupPayload: unknown) {
  return Promise.resolve({
    status: 'found' as const,
    value: { variantSKUs: [...childSkus], snapshotDigest: digest(groupPayload) },
  });
}

describe('reconcileCompletePublicationState', () => {
  it('returns unpublished when no offers exist', async () => {
    const m = makeManifest();
    const api = createReadApi({
      getOffers: vi.fn(async () => ({ status: 'found' as const, value: { offers: [] } })),
    });
    expect((await reconcileCompletePublicationState(api, m, true)).state).toBe('unpublished');
  });
  it('returns active with both PUBLISHED', async () => {
    const m = makeManifest();
    const api = createReadApi({
      getOffers: vi.fn(async (sku) => ({
        status: 'found' as const,
        value: {
          offers: [
            remoteOffer({
              sku,
              offerId: sku.endsWith('C01') ? 'OFFER-1' : 'OFFER-2',
              listingId: 'LISTING-1',
              listingStatus: 'ACTIVE',
              semanticPayload: offerPayload(sku),
            }),
          ],
        },
      })),
    });
    const r = await reconcileCompletePublicationState(api, m);
    expect(r.state).toBe('active');
    expect(r.listingId).toBe('LISTING-1');
  });
  it('throws on mixed statuses', async () => {
    const m = makeManifest();
    const api = createReadApi({
      getOffers: vi.fn(async (sku) => ({
        status: 'found' as const,
        value: {
          offers: [
            remoteOffer({
              sku,
              offerId: sku.endsWith('C01') ? 'OFFER-1' : 'OFFER-2',
              status: sku.endsWith('C01') ? 'PUBLISHED' : 'UNPUBLISHED',
              listingId: sku.endsWith('C01') ? 'LISTING-1' : null,
              listingStatus: sku.endsWith('C01') ? 'ACTIVE' : null,
              semanticPayload: offerPayload(sku),
            }),
          ],
        },
      })),
    });
    await expect(reconcileCompletePublicationState(api, m)).rejects.toThrow(
      'mixes PUBLISHED and UNPUBLISHED'
    );
  });
});

describe('verifyVariationListingSandbox', () => {
  const sha = 'e'.repeat(64);

  it('returns verified report with all children matching', async () => {
    const m = makeManifest();
    const plan = buildFuturePlan(m.execution.fixture, m.run);
    const api = createReadApi({
      getInventoryItem: vi.fn(async (sku) => {
        const idx = m.run.childSkus.indexOf(sku);
        const slot = `C0${idx + 1}`;
        const p = plan.operations.find((o) => o.id === `item-${slot}`)!.payload as Record<
          string,
          unknown
        >;
        return validItemResponse(sku, m.run.groupKey, m.ownership.itemQuantities[idx], p);
      }),
      getOffers: vi.fn(async (sku) => {
        const idx = m.run.childSkus.indexOf(sku);
        return validOffersResponse(sku, m.resources[idx].offerId!);
      }),
      getInventoryItemGroup: vi.fn(async () => {
        const gp = plan.operations.find((o) => o.id === 'group-complete')!.payload;
        return validGroupResponse(m.run.childSkus, gp);
      }),
    });
    const r = await verifyVariationListingSandbox({
      readApi: api,
      manifest: m,
      manifestSha256: sha,
      confirmSandboxSeller: 'testuser_mfhsandbox',
    });
    expect(r.status).toBe('verified');
    expect(r.children).toHaveLength(2);
    expect(r.children[0].itemSemanticMatch).toBe(true);
    expect(r.children[0].offerSemanticMatch).toBe(true);
    expect(r.children[0].groupAssociationMatch).toBe(true);
    expect(r.groupSemanticMatch).toBe(true);
    expect(r.mutationCapabilitiesResolved).toBe(false);
    expect(r.manifestWritten).toBe(false);
    expect(r.reads.offers).toBe(2);
    expect(r.reads.inventoryItems).toBe(2);
  });

  it('throws on wrong runtime environment', async () => {
    const m = makeManifest();
    const api = createReadApi({
      getRuntimeSnapshot: vi.fn(async () => ({ ...defaultRuntime, environment: 'production' })),
    });
    await expect(
      verifyVariationListingSandbox({
        readApi: api,
        manifest: m,
        manifestSha256: sha,
        confirmSandboxSeller: 'testuser_mfhsandbox',
      })
    ).rejects.toThrow('Runtime environment');
  });

  it('throws on wrong runtime marketplace', async () => {
    const m = makeManifest();
    const api = createReadApi({
      getRuntimeSnapshot: vi.fn(async () => ({ ...defaultRuntime, marketplaceId: 'EBAY_DE' })),
    });
    await expect(
      verifyVariationListingSandbox({
        readApi: api,
        manifest: m,
        manifestSha256: sha,
        confirmSandboxSeller: 'testuser_mfhsandbox',
      })
    ).rejects.toThrow('marketplace must be EBAY_US');
  });

  it('throws on wrong runtime content language', async () => {
    const m = makeManifest();
    const api = createReadApi({
      getRuntimeSnapshot: vi.fn(async () => ({ ...defaultRuntime, contentLanguage: 'de-DE' })),
    });
    await expect(
      verifyVariationListingSandbox({
        readApi: api,
        manifest: m,
        manifestSha256: sha,
        confirmSandboxSeller: 'testuser_mfhsandbox',
      })
    ).rejects.toThrow('content language must be en-US');
  });

  it('throws on enabled background work', async () => {
    const m = makeManifest();
    const api = createReadApi({
      getRuntimeSnapshot: vi.fn(async () => ({
        ...defaultRuntime,
        background: { ...defaultRuntime.background, jobRunner: true },
      })),
    });
    await expect(
      verifyVariationListingSandbox({
        readApi: api,
        manifest: m,
        manifestSha256: sha,
        confirmSandboxSeller: 'testuser_mfhsandbox',
      })
    ).rejects.toThrow('background work');
  });

  it('throws on enabled forbidden dependency', async () => {
    const m = makeManifest();
    const api = createReadApi({
      getRuntimeSnapshot: vi.fn(async () => ({
        ...defaultRuntime,
        forbiddenDependencies: { ...defaultRuntime.forbiddenDependencies, supabase: true },
      })),
    });
    await expect(
      verifyVariationListingSandbox({
        readApi: api,
        manifest: m,
        manifestSha256: sha,
        confirmSandboxSeller: 'testuser_mfhsandbox',
      })
    ).rejects.toThrow('forbidden dependencies');
  });

  it('throws on missing refresh token', async () => {
    const m = makeManifest();
    const api = createReadApi({
      getRuntimeSnapshot: vi.fn(async () => ({ ...defaultRuntime, hasUserRefreshToken: false })),
    });
    await expect(
      verifyVariationListingSandbox({
        readApi: api,
        manifest: m,
        manifestSha256: sha,
        confirmSandboxSeller: 'testuser_mfhsandbox',
      })
    ).rejects.toThrow('refresh token');
  });

  it('throws on production credential material', async () => {
    const m = makeManifest();
    const api = createReadApi({
      getRuntimeSnapshot: vi.fn(async () => ({
        ...defaultRuntime,
        productionCredentialMaterialPresent: true,
      })),
    });
    await expect(
      verifyVariationListingSandbox({
        readApi: api,
        manifest: m,
        manifestSha256: sha,
        confirmSandboxSeller: 'testuser_mfhsandbox',
      })
    ).rejects.toThrow('Production eBay credential');
  });

  it('throws on wrong seller', async () => {
    const m = makeManifest();
    await expect(
      verifyVariationListingSandbox({
        readApi: createReadApi(),
        manifest: m,
        manifestSha256: sha,
        confirmSandboxSeller: 'wrong',
      })
    ).rejects.toThrow('Seller identity mismatch');
  });

  it('throws on wrong checkpoint', async () => {
    const m = makeManifest({
      checkpoint: 'preflight-complete',
    } as Partial<ExecutableVariationListingManifest>);
    await expect(
      verifyVariationListingSandbox({
        readApi: createReadApi(),
        manifest: m,
        manifestSha256: sha,
        confirmSandboxSeller: 'testuser_mfhsandbox',
      })
    ).rejects.toThrow('awaiting-published-view-verification');
  });

  it('throws when not published', async () => {
    const m = makeManifest({
      published: false,
      groupListingId: null,
    } as Partial<ExecutableVariationListingManifest>);
    await expect(
      verifyVariationListingSandbox({
        readApi: createReadApi(),
        manifest: m,
        manifestSha256: sha,
        confirmSandboxSeller: 'testuser_mfhsandbox',
      })
    ).rejects.toThrow('published=true');
  });

  it('throws on item semantic drift', async () => {
    const m = makeManifest();
    const plan = buildFuturePlan(m.execution.fixture, m.run);
    const api = createReadApi({
      getInventoryItem: vi.fn(async (sku) => {
        const idx = m.run.childSkus.indexOf(sku);
        const slot = `C0${idx + 1}`;
        const p = {
          ...(plan.operations.find((o) => o.id === `item-${slot}`)!.payload as Record<
            string,
            unknown
          >),
          condition: 'USED_GOOD',
        };
        return {
          status: 'found' as const,
          value: {
            sku,
            groupKeys: [m.run.groupKey],
            quantity: m.ownership.itemQuantities[idx],
            semanticSnapshot: projectInventoryItemSemanticSnapshot(p),
          },
        };
      }),
    });
    await expect(
      verifyVariationListingSandbox({
        readApi: api,
        manifest: m,
        manifestSha256: sha,
        confirmSandboxSeller: 'testuser_mfhsandbox',
      })
    ).rejects.toThrow('semantic condition does not match');
  });

  it('throws on missing item quantity', async () => {
    const m = makeManifest();
    const plan = buildFuturePlan(m.execution.fixture, m.run);
    const api = createReadApi({
      getInventoryItem: vi.fn(async (sku) => {
        const idx = m.run.childSkus.indexOf(sku);
        const slot = `C0${idx + 1}`;
        const p = plan.operations.find((o) => o.id === `item-${slot}`)!.payload as Record<
          string,
          unknown
        >;
        return {
          status: 'found' as const,
          value: {
            sku,
            groupKeys: [m.run.groupKey],
            semanticSnapshot: projectInventoryItemSemanticSnapshot(p),
          },
        };
      }),
    });
    await expect(
      verifyVariationListingSandbox({
        readApi: api,
        manifest: m,
        manifestSha256: sha,
        confirmSandboxSeller: 'testuser_mfhsandbox',
      })
    ).rejects.toThrow('quantity is missing');
  });

  it('throws on wrong item quantity', async () => {
    const m = makeManifest();
    const plan = buildFuturePlan(m.execution.fixture, m.run);
    const api = createReadApi({
      getInventoryItem: vi.fn(async (sku) => {
        const idx = m.run.childSkus.indexOf(sku);
        const slot = `C0${idx + 1}`;
        const p = plan.operations.find((o) => o.id === `item-${slot}`)!.payload as Record<
          string,
          unknown
        >;
        return {
          status: 'found' as const,
          value: {
            sku,
            groupKeys: [m.run.groupKey],
            quantity: 999,
            semanticSnapshot: projectInventoryItemSemanticSnapshot(p),
          },
        };
      }),
    });
    await expect(
      verifyVariationListingSandbox({
        readApi: api,
        manifest: m,
        manifestSha256: sha,
        confirmSandboxSeller: 'testuser_mfhsandbox',
      })
    ).rejects.toThrow('quantity mismatch');
  });

  it('throws on null groupKeys', async () => {
    const m = makeManifest();
    const plan = buildFuturePlan(m.execution.fixture, m.run);
    const api = createReadApi({
      getInventoryItem: vi.fn(async (sku) => {
        const idx = m.run.childSkus.indexOf(sku);
        const slot = `C0${idx + 1}`;
        const p = plan.operations.find((o) => o.id === `item-${slot}`)!.payload as Record<
          string,
          unknown
        >;
        return {
          status: 'found' as const,
          value: {
            sku,
            groupKeys: null,
            quantity: m.ownership.itemQuantities[idx],
            semanticSnapshot: projectInventoryItemSemanticSnapshot(p),
          },
        };
      }),
    });
    await expect(
      verifyVariationListingSandbox({
        readApi: api,
        manifest: m,
        manifestSha256: sha,
        confirmSandboxSeller: 'testuser_mfhsandbox',
      })
    ).rejects.toThrow('groupKeys is missing or null');
  });

  it('throws on wrong group association', async () => {
    const m = makeManifest();
    const plan = buildFuturePlan(m.execution.fixture, m.run);
    const api = createReadApi({
      getInventoryItem: vi.fn(async (sku) => {
        const idx = m.run.childSkus.indexOf(sku);
        const slot = `C0${idx + 1}`;
        const p = plan.operations.find((o) => o.id === `item-${slot}`)!.payload as Record<
          string,
          unknown
        >;
        return {
          status: 'found' as const,
          value: {
            sku,
            groupKeys: ['wrong-group'],
            quantity: m.ownership.itemQuantities[idx],
            semanticSnapshot: projectInventoryItemSemanticSnapshot(p),
          },
        };
      }),
    });
    await expect(
      verifyVariationListingSandbox({
        readApi: api,
        manifest: m,
        manifestSha256: sha,
        confirmSandboxSeller: 'testuser_mfhsandbox',
      })
    ).rejects.toThrow('group association wrong-group does not match');
  });

  it('throws on extra group associations', async () => {
    const m = makeManifest();
    const plan = buildFuturePlan(m.execution.fixture, m.run);
    const api = createReadApi({
      getInventoryItem: vi.fn(async (sku) => {
        const idx = m.run.childSkus.indexOf(sku);
        const slot = `C0${idx + 1}`;
        const p = plan.operations.find((o) => o.id === `item-${slot}`)!.payload as Record<
          string,
          unknown
        >;
        return {
          status: 'found' as const,
          value: {
            sku,
            groupKeys: [m.run.groupKey, 'extra'],
            quantity: m.ownership.itemQuantities[idx],
            semanticSnapshot: projectInventoryItemSemanticSnapshot(p),
          },
        };
      }),
    });
    await expect(
      verifyVariationListingSandbox({
        readApi: api,
        manifest: m,
        manifestSha256: sha,
        confirmSandboxSeller: 'testuser_mfhsandbox',
      })
    ).rejects.toThrow('exactly one group association');
  });

  it('throws on offer semantic drift', async () => {
    const m = makeManifest();
    const plan = buildFuturePlan(m.execution.fixture, m.run);
    const drifted = {
      ...offerPayload(m.run.childSkus[0], 1),
      pricingSummary: { price: { currency: 'USD', value: '99.99' } },
    };
    const api = createReadApi({
      getInventoryItem: vi.fn(async (sku) => {
        const idx = m.run.childSkus.indexOf(sku);
        const slot = `C0${idx + 1}`;
        const p = plan.operations.find((o) => o.id === `item-${slot}`)!.payload as Record<
          string,
          unknown
        >;
        return validItemResponse(sku, m.run.groupKey, m.ownership.itemQuantities[idx], p);
      }),
      getOffers: vi.fn(async (sku) => {
        if (sku === m.run.childSkus[0])
          return {
            status: 'found' as const,
            value: {
              offers: [
                remoteOffer({
                  sku,
                  offerId: 'OFFER-1',
                  listingId: 'LISTING-1',
                  listingStatus: 'ACTIVE',
                  availableQuantity: 1,
                  semanticPayload: drifted,
                }),
              ],
            },
          };
        return validOffersResponse(sku, m.resources[1].offerId!);
      }),
    });
    await expect(
      verifyVariationListingSandbox({
        readApi: api,
        manifest: m,
        manifestSha256: sha,
        confirmSandboxSeller: 'testuser_mfhsandbox',
      })
    ).rejects.toThrow('semantic price value does not match');
  });

  it('throws when publication state is not active', async () => {
    const m = makeManifest();
    const plan = buildFuturePlan(m.execution.fixture, m.run);
    const api = createReadApi({
      getInventoryItem: vi.fn(async (sku) => {
        const idx = m.run.childSkus.indexOf(sku);
        const slot = `C0${idx + 1}`;
        const p = plan.operations.find((o) => o.id === `item-${slot}`)!.payload as Record<
          string,
          unknown
        >;
        return validItemResponse(sku, m.run.groupKey, m.ownership.itemQuantities[idx], p);
      }),
      getOffers: vi.fn(async () => ({ status: 'found' as const, value: { offers: [] } })),
    });
    await expect(
      verifyVariationListingSandbox({
        readApi: api,
        manifest: m,
        manifestSha256: sha,
        confirmSandboxSeller: 'testuser_mfhsandbox',
      })
    ).rejects.toThrow('Complete publication state is missing');
  });

  it('throws when group snapshotDigest is absent', async () => {
    const m = makeManifest();
    const plan = buildFuturePlan(m.execution.fixture, m.run);
    const api = createReadApi({
      getInventoryItem: vi.fn(async (sku) => {
        const idx = m.run.childSkus.indexOf(sku);
        const slot = `C0${idx + 1}`;
        const p = plan.operations.find((o) => o.id === `item-${slot}`)!.payload as Record<
          string,
          unknown
        >;
        return validItemResponse(sku, m.run.groupKey, m.ownership.itemQuantities[idx], p);
      }),
      getOffers: vi.fn(async (sku) => {
        const idx = m.run.childSkus.indexOf(sku);
        return validOffersResponse(sku, m.resources[idx].offerId!);
      }),
      getInventoryItemGroup: vi.fn(async () => ({
        status: 'found' as const,
        value: { variantSKUs: [...m.run.childSkus] },
      })),
    });
    await expect(
      verifyVariationListingSandbox({
        readApi: api,
        manifest: m,
        manifestSha256: sha,
        confirmSandboxSeller: 'testuser_mfhsandbox',
      })
    ).rejects.toThrow('snapshotDigest is absent');
  });

  it('throws on group digest mismatch', async () => {
    const m = makeManifest();
    const plan = buildFuturePlan(m.execution.fixture, m.run);
    const api = createReadApi({
      getInventoryItem: vi.fn(async (sku) => {
        const idx = m.run.childSkus.indexOf(sku);
        const slot = `C0${idx + 1}`;
        const p = plan.operations.find((o) => o.id === `item-${slot}`)!.payload as Record<
          string,
          unknown
        >;
        return validItemResponse(sku, m.run.groupKey, m.ownership.itemQuantities[idx], p);
      }),
      getOffers: vi.fn(async (sku) => {
        const idx = m.run.childSkus.indexOf(sku);
        return validOffersResponse(sku, m.resources[idx].offerId!);
      }),
      getInventoryItemGroup: vi.fn(async () => ({
        status: 'found' as const,
        value: { variantSKUs: [...m.run.childSkus], snapshotDigest: 'wrong'.padEnd(64, '0') },
      })),
    });
    await expect(
      verifyVariationListingSandbox({
        readApi: api,
        manifest: m,
        manifestSha256: sha,
        confirmSandboxSeller: 'testuser_mfhsandbox',
      })
    ).rejects.toThrow('Group semantic digest mismatch');
  });

  it('throws on wrong group variant SKU order', async () => {
    const m = makeManifest();
    const plan = buildFuturePlan(m.execution.fixture, m.run);
    const gp = plan.operations.find((o) => o.id === 'group-complete')!.payload;
    const api = createReadApi({
      getInventoryItem: vi.fn(async (sku) => {
        const idx = m.run.childSkus.indexOf(sku);
        const slot = `C0${idx + 1}`;
        const p = plan.operations.find((o) => o.id === `item-${slot}`)!.payload as Record<
          string,
          unknown
        >;
        return validItemResponse(sku, m.run.groupKey, m.ownership.itemQuantities[idx], p);
      }),
      getOffers: vi.fn(async (sku) => {
        const idx = m.run.childSkus.indexOf(sku);
        return validOffersResponse(sku, m.resources[idx].offerId!);
      }),
      getInventoryItemGroup: vi.fn(async () => ({
        status: 'found' as const,
        value: { variantSKUs: [...m.run.childSkus].reverse(), snapshotDigest: digest(gp) },
      })),
    });
    await expect(
      verifyVariationListingSandbox({
        readApi: api,
        manifest: m,
        manifestSha256: sha,
        confirmSandboxSeller: 'testuser_mfhsandbox',
      })
    ).rejects.toThrow('variant SKUs mismatch');
  });

  it('throws when ledger publish-group has wrong state', async () => {
    const m = makeManifest();
    const bad = executableVariationListingManifestSchema.parse({
      ...m,
      execution: {
        ...m.execution,
        ledger: m.execution.ledger.map((e) =>
          e.id === 'publish-group'
            ? {
                ...e,
                state: 'unknown' as const,
                attemptCount: 2,
                startedAt: fixedDate.toISOString(),
                completedAt: null,
                readBackDigest: null,
              }
            : e
        ),
      },
    }) as ExecutableVariationListingManifest;
    await expect(
      verifyVariationListingSandbox({
        readApi: createReadApi(),
        manifest: bad,
        manifestSha256: sha,
        confirmSandboxSeller: 'testuser_mfhsandbox',
      })
    ).rejects.toThrow('publish-group must be completed');
  });

  it('throws when planned operation has started evidence', async () => {
    const m = makeManifest();
    const bad = executableVariationListingManifestSchema.parse({
      ...m,
      execution: {
        ...m.execution,
        ledger: m.execution.ledger.map((e) =>
          e.id === 'quantity-zero'
            ? {
                ...e,
                state: 'started' as const,
                attemptCount: 1,
                startedAt: fixedDate.toISOString(),
              }
            : e
        ),
      },
    }) as ExecutableVariationListingManifest;
    await expect(
      verifyVariationListingSandbox({
        readApi: createReadApi(),
        manifest: bad,
        manifestSha256: sha,
        confirmSandboxSeller: 'testuser_mfhsandbox',
      })
    ).rejects.toThrow('quantity-zero must be planned');
  });

  it('throws on unknown item read', async () => {
    const m = makeManifest();
    const api = createReadApi({
      getInventoryItem: vi.fn(async () => ({
        status: 'unknown' as const,
        reason: 'network error',
      })),
    });
    await expect(
      verifyVariationListingSandbox({
        readApi: api,
        manifest: m,
        manifestSha256: sha,
        confirmSandboxSeller: 'testuser_mfhsandbox',
      })
    ).rejects.toThrow('must be found');
  });

  it('throws on unknown group read', async () => {
    const m = makeManifest();
    const plan = buildFuturePlan(m.execution.fixture, m.run);
    const api = createReadApi({
      getInventoryItem: vi.fn(async (sku) => {
        const idx = m.run.childSkus.indexOf(sku);
        const slot = `C0${idx + 1}`;
        const p = plan.operations.find((o) => o.id === `item-${slot}`)!.payload as Record<
          string,
          unknown
        >;
        return validItemResponse(sku, m.run.groupKey, m.ownership.itemQuantities[idx], p);
      }),
      getOffers: vi.fn(async (sku) => {
        const idx = m.run.childSkus.indexOf(sku);
        return validOffersResponse(sku, m.resources[idx].offerId!);
      }),
      getInventoryItemGroup: vi.fn(async () => ({
        status: 'unknown' as const,
        reason: 'network error',
      })),
    });
    await expect(
      verifyVariationListingSandbox({
        readApi: api,
        manifest: m,
        manifestSha256: sha,
        confirmSandboxSeller: 'testuser_mfhsandbox',
      })
    ).rejects.toThrow('Group must be found');
  });

  // -- Runtime origin mismatch tests ---------------------------------------
  it('throws on wrong runtime REST origin', async () => {
    const m = makeManifest();
    const api = createReadApi({
      getRuntimeSnapshot: vi.fn(async () => ({
        ...defaultRuntime,
        restOrigin: 'https://api.ebay.com',
      })),
    });
    await expect(
      verifyVariationListingSandbox({
        readApi: api,
        manifest: m,
        manifestSha256: sha,
        confirmSandboxSeller: 'testuser_mfhsandbox',
      })
    ).rejects.toThrow('REST origin must be exact sandbox');
  });

  it('throws on wrong runtime OAuth origin', async () => {
    const m = makeManifest();
    const api = createReadApi({
      getRuntimeSnapshot: vi.fn(async () => ({
        ...defaultRuntime,
        oauthOrigin: 'https://auth.ebay.com',
      })),
    });
    await expect(
      verifyVariationListingSandbox({
        readApi: api,
        manifest: m,
        manifestSha256: sha,
        confirmSandboxSeller: 'testuser_mfhsandbox',
      })
    ).rejects.toThrow('OAuth origin must be exact sandbox');
  });

  it('throws on wrong runtime Trading origin', async () => {
    const m = makeManifest();
    const api = createReadApi({
      getRuntimeSnapshot: vi.fn(async () => ({
        ...defaultRuntime,
        tradingOrigin: 'https://api.ebay.com',
      })),
    });
    await expect(
      verifyVariationListingSandbox({
        readApi: api,
        manifest: m,
        manifestSha256: sha,
        confirmSandboxSeller: 'testuser_mfhsandbox',
      })
    ).rejects.toThrow('Trading origin must be exact sandbox');
  });

  // -- Offer-level fail-closed (already present above, adding missing ones) ------

  it('throws on missing offer availableQuantity', async () => {
    const m = makeManifest();
    const plan = buildFuturePlan(m.execution.fixture, m.run);
    const api = createReadApi({
      getInventoryItem: vi.fn(async (sku) => {
        const idx = m.run.childSkus.indexOf(sku);
        const slot = `C0${idx + 1}`;
        const p = plan.operations.find((o) => o.id === `item-${slot}`)!.payload as Record<
          string,
          unknown
        >;
        return validItemResponse(sku, m.run.groupKey, m.ownership.itemQuantities[idx], p);
      }),
      getOffers: vi.fn(async (sku) => {
        const idx = m.run.childSkus.indexOf(sku);
        const isC01 = sku.endsWith('C01');
        const qty = isC01 ? 1 : 2;
        const price = isC01 ? '10.00' : '20.00';
        const payload = {
          ...offerPayload(sku, qty),
          pricingSummary: { price: { currency: 'USD', value: price } },
        };
        const offer = remoteOffer({
          sku,
          offerId: m.resources[idx].offerId!,
          listingId: 'LISTING-1',
          listingStatus: 'ACTIVE',
          semanticPayload: payload,
        });
        (offer as any).availableQuantity = undefined;
        return { status: 'found' as const, value: { offers: [offer] } };
      }),
    });
    await expect(
      verifyVariationListingSandbox({
        readApi: api,
        manifest: m,
        manifestSha256: sha,
        confirmSandboxSeller: 'testuser_mfhsandbox',
      })
    ).rejects.toThrow('availableQuantity is missing');
  });

  it('throws on wrong offer quantity', async () => {
    const m = makeManifest();
    const plan = buildFuturePlan(m.execution.fixture, m.run);
    const api = createReadApi({
      getInventoryItem: vi.fn(async (sku) => {
        const idx = m.run.childSkus.indexOf(sku);
        const slot = `C0${idx + 1}`;
        const p = plan.operations.find((o) => o.id === `item-${slot}`)!.payload as Record<
          string,
          unknown
        >;
        return validItemResponse(sku, m.run.groupKey, m.ownership.itemQuantities[idx], p);
      }),
      getOffers: vi.fn(async (sku) => {
        const idx = m.run.childSkus.indexOf(sku);
        const isC01 = sku.endsWith('C01');
        const price = isC01 ? '10.00' : '20.00';
        const payload = {
          ...offerPayload(sku, 99),
          pricingSummary: { price: { currency: 'USD', value: price } },
        };
        return {
          status: 'found' as const,
          value: {
            offers: [
              remoteOffer({
                sku,
                offerId: m.resources[idx].offerId!,
                listingId: 'LISTING-1',
                listingStatus: 'ACTIVE',
                availableQuantity: 99,
                semanticPayload: payload,
              }),
            ],
          },
        };
      }),
    });
    await expect(
      verifyVariationListingSandbox({
        readApi: api,
        manifest: m,
        manifestSha256: sha,
        confirmSandboxSeller: 'testuser_mfhsandbox',
      })
    ).rejects.toThrow('semantic available quantity does not match');
  });

  it('throws on wrong listing ID', async () => {
    const m = makeManifest();
    const plan = buildFuturePlan(m.execution.fixture, m.run);
    const api = createReadApi({
      getInventoryItem: vi.fn(async (sku) => {
        const idx = m.run.childSkus.indexOf(sku);
        const slot = `C0${idx + 1}`;
        const p = plan.operations.find((o) => o.id === `item-${slot}`)!.payload as Record<
          string,
          unknown
        >;
        return validItemResponse(sku, m.run.groupKey, m.ownership.itemQuantities[idx], p);
      }),
      getOffers: vi.fn(async (sku) => {
        const idx = m.run.childSkus.indexOf(sku);
        return validOffersResponse(sku, m.resources[idx].offerId!);
      }),
      getInventoryItemGroup: vi.fn(async () => {
        const gp = plan.operations.find((o) => o.id === 'group-complete')!.payload;
        return validGroupResponse(m.run.childSkus, gp);
      }),
    });
    // Override groupListingId but keep offers pointing to LISTING-1
    const badM = executableVariationListingManifestSchema.parse({
      ...m,
      groupListingId: 'WRONG-LISTING',
    }) as ExecutableVariationListingManifest;
    await expect(
      verifyVariationListingSandbox({
        readApi: api,
        manifest: badM,
        manifestSha256: sha,
        confirmSandboxSeller: 'testuser_mfhsandbox',
      })
    ).rejects.toThrow('listing ID conflicts with the manifest');
  });

  it('throws on ended lifecycle', async () => {
    const m = makeManifest();
    const plan = buildFuturePlan(m.execution.fixture, m.run);
    const api = createReadApi({
      getInventoryItem: vi.fn(async (sku) => {
        const idx = m.run.childSkus.indexOf(sku);
        const slot = `C0${idx + 1}`;
        const p = plan.operations.find((o) => o.id === `item-${slot}`)!.payload as Record<
          string,
          unknown
        >;
        return validItemResponse(sku, m.run.groupKey, m.ownership.itemQuantities[idx], p);
      }),
      getOffers: vi.fn(async (sku) => {
        const idx = m.run.childSkus.indexOf(sku);
        const qty = sku.endsWith('C01') ? 1 : 2;
        return {
          status: 'found' as const,
          value: {
            offers: [
              remoteOffer({
                sku,
                offerId: m.resources[idx].offerId!,
                listingId: 'LISTING-1',
                listingStatus: 'ENDED',
                availableQuantity: qty,
                semanticPayload: offerPayload(sku, qty),
              }),
            ],
          },
        };
      }),
    });
    await expect(
      verifyVariationListingSandbox({
        readApi: api,
        manifest: m,
        manifestSha256: sha,
        confirmSandboxSeller: 'testuser_mfhsandbox',
      })
    ).rejects.toThrow('Publication state must be active for verification');
  });

  it('throws when NOT_LISTED lifecycle', async () => {
    const m = makeManifest();
    const plan = buildFuturePlan(m.execution.fixture, m.run);
    const api = createReadApi({
      getInventoryItem: vi.fn(async (sku) => {
        const idx = m.run.childSkus.indexOf(sku);
        const slot = `C0${idx + 1}`;
        const p = plan.operations.find((o) => o.id === `item-${slot}`)!.payload as Record<
          string,
          unknown
        >;
        return validItemResponse(sku, m.run.groupKey, m.ownership.itemQuantities[idx], p);
      }),
      getOffers: vi.fn(async (sku) => {
        const idx = m.run.childSkus.indexOf(sku);
        const qty = sku.endsWith('C01') ? 1 : 2;
        return {
          status: 'found' as const,
          value: {
            offers: [
              remoteOffer({
                sku,
                offerId: m.resources[idx].offerId!,
                listingId: 'LISTING-1',
                listingStatus: 'NOT_LISTED',
                availableQuantity: qty,
                semanticPayload: offerPayload(sku, qty),
              }),
            ],
          },
        };
      }),
    });
    await expect(
      verifyVariationListingSandbox({
        readApi: api,
        manifest: m,
        manifestSha256: sha,
        confirmSandboxSeller: 'testuser_mfhsandbox',
      })
    ).rejects.toThrow('Publication state must be active for verification');
  });

  // -- Fractional quantity tests ---------------------------------------
  it('throws on fractional item quantity', async () => {
    const m = makeManifest();
    const plan = buildFuturePlan(m.execution.fixture, m.run);
    const api = createReadApi({
      getInventoryItem: vi.fn(async (sku) => {
        const idx = m.run.childSkus.indexOf(sku);
        const slot = `C0${idx + 1}`;
        const p = plan.operations.find((o) => o.id === `item-${slot}`)!.payload as Record<
          string,
          unknown
        >;
        return {
          status: 'found' as const,
          value: {
            sku,
            groupKeys: [m.run.groupKey],
            quantity: 1.5,
            semanticSnapshot: projectInventoryItemSemanticSnapshot(p),
          },
        };
      }),
    });
    await expect(
      verifyVariationListingSandbox({
        readApi: api,
        manifest: m,
        manifestSha256: sha,
        confirmSandboxSeller: 'testuser_mfhsandbox',
      })
    ).rejects.toThrow('non-negative integer');
  });

  // -- Ledger: planned entry with non-null result (regression) -------------
  it('throws when planned ledger entry has non-null result', async () => {
    const m = makeManifest();
    const bad = executableVariationListingManifestSchema.parse({
      ...m,
      execution: {
        ...m.execution,
        ledger: m.execution.ledger.map((e) =>
          e.id === 'quantity-zero'
            ? {
                ...e,
                state: 'planned' as const,
                attemptCount: 0,
                startedAt: null,
                completedAt: null,
                result: { bad: true },
                error: null,
                readBackDigest: null,
              }
            : e
        ),
      },
    }) as ExecutableVariationListingManifest;
    await expect(
      verifyVariationListingSandbox({
        readApi: createReadApi(),
        manifest: bad,
        manifestSha256: sha,
        confirmSandboxSeller: 'testuser_mfhsandbox',
      })
    ).rejects.toThrow('quantity-zero must have null result');
  });
});
