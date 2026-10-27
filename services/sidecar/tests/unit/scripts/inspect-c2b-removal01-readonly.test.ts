import { describe, expect, it, vi } from 'vitest';
import {
  C2B_REMOVAL01_GROUP_ID,
  C2B_REMOVAL01_GROUP_KEY,
  C2B_REMOVAL01_REVISION_ID,
  C2B_REMOVAL01_SKUS,
  collectC2BRemoval01Evidence,
  createReadOnlySandboxApi,
  parseC2BRemoval01Args,
  readAllC2BRemoval01Offers,
  validateC2BRemoval01Environment,
  type ReadOnlyDataAccess,
  type ReadOnlySellerApi,
} from '@/scripts/inspect-c2b-removal01-readonly.js';

const env = (): NodeJS.ProcessEnv => ({
  EBAY_ENVIRONMENT: 'sandbox',
  EBAY_MARKETPLACE_ID: 'EBAY_US',
  EBAY_REFRESH_TOKEN: 'refresh-token',
  EBAY_API_BASE_URL: 'https://api.sandbox.ebay.com',
  EBAY_OAUTH_BASE_URL: 'https://api.sandbox.ebay.com/identity/v1/oauth2/token',
  SUPABASE_PROJECT_REF: 'fmiliwxthjonjwywuqta',
  NEXT_PUBLIC_SUPABASE_URL: 'https://fmiliwxthjonjwywuqta.supabase.co',
});

const revision = (): Record<string, unknown> => ({
  revisionId: C2B_REMOVAL01_REVISION_ID,
  groupId: C2B_REMOVAL01_GROUP_ID,
  snapshotDigest: '602f38a42f0beb0f940a6f222c105ffa0914bbe0b0d3eff03a2830a0a6737727',
  operationCount: 1,
  operationPlan: [{ sequence_no: 1 }],
  source: { snapshot_version: 3, snapshot_digest: '602f38a42f0beb0f940a6f222c105ffa0914bbe0b0d3eff03a2830a0a6737727', operation_count: 1 },
});

function makeApi(overrides: Partial<ReadOnlySellerApi> = {}): ReadOnlySellerApi {
  const getOffers = vi.fn(async (sku?: string) => ({
    total: 1,
    size: 1,
    offers: [{
      sku,
      offerId: sku?.endsWith('000001') ? '11951367010' : sku?.endsWith('000002') ? '11951368010' : '11951369010',
      marketplaceId: 'EBAY_US',
      status: 'PUBLISHED',
      listing: { listingId: '110591443545', listingStatus: 'ACTIVE' },
      availableQuantity: 1,
      imageUrl: 'https://private.example/image.jpg',
    }],
  }));
  const api: ReadOnlySellerApi = {
    trading: { getCurrentUserIdentity: vi.fn(async () => ({ userId: 'verified-seller' })) },
    inventory: {
      getInventoryItemGroup: vi.fn(async () => ({
        variantSKUs: [...C2B_REMOVAL01_SKUS],
        title: 'C2BRemoval01',
        imageUrls: ['https://private.example/group.jpg'],
        variesBy: { specifications: [{ name: 'Card', values: ['A', 'B', 'C'] }] },
      })),
      getInventoryItem: vi.fn(async (sku: string) => ({
        sku,
        groupIds: [C2B_REMOVAL01_GROUP_KEY],
        availability: { shipToLocationAvailability: { quantity: sku.endsWith('000001') ? 0 : 1 } },
        product: { aspects: { Card: [sku] }, imageUrls: ['https://private.example/item.jpg'] },
      })),
      getOffers,
    },
  };
  return { ...api, ...overrides };
}

function makeData(overrides: Partial<ReadOnlyDataAccess> = {}): ReadOnlyDataAccess {
  return {
    variationListings: {
      listRevisionsByGroupId: vi.fn(async () => [revision()]),
      listCheckpointsByRevisionId: vi.fn(async () => [
        { revisionId: C2B_REMOVAL01_REVISION_ID, operationKey: 'remove-group-membership', state: 'started', source: { revision_id: C2B_REMOVAL01_REVISION_ID, checkpoint_id: 'cp-1', checkpoint_number: 1, operation_key: 'remove-group-membership', state: 'started', observed_remote_state: null } },
        { revisionId: C2B_REMOVAL01_REVISION_ID, operationKey: 'remove-group-membership', state: 'unknown', source: { revision_id: C2B_REMOVAL01_REVISION_ID, checkpoint_id: 'cp-2', checkpoint_number: 2, operation_key: 'remove-group-membership', state: 'unknown', observed_remote_state: 'unknown' } },
      ]),
      remoteRetirementStore: { load: vi.fn(async () => null) },
    },
    ...overrides,
  };
}

describe('C2BRemoval01 read-only preflight', () => {
  it('rejects all arguments and unsafe environment provenance', () => {
    expect(() => parseC2BRemoval01Args(['--execute'])).toThrow(/no arguments/i);
    expect(() => validateC2BRemoval01Environment({ ...env(), EBAY_ENVIRONMENT: 'production' })).toThrow(/Sandbox/);
    expect(() => validateC2BRemoval01Environment({ ...env(), EBAY_PRODUCTION_CLIENT_SECRET: 'present' })).toThrow(/Production/);
    expect(() => validateC2BRemoval01Environment({ ...env(), SUPABASE_PROJECT_REF: 'other' })).toThrow(/canonical/);
    expect(() => validateC2BRemoval01Environment({ ...env(), EBAY_API_BASE_URL: 'https://api.ebay.com' })).toThrow(/origin/);
    expect(() => validateC2BRemoval01Environment({ ...env(), EBAY_OAUTH_BASE_URL: 'https://auth.sandbox.ebay.com' })).toThrow(/origin/);
    expect(() => validateC2BRemoval01Environment({ ...env(), EBAY_CONTENT_LANGUAGE: 'fr-FR' })).toThrow(/en-US/);
    expect(() => validateC2BRemoval01Environment({ ...env(), NEXT_PUBLIC_SUPABASE_URL: 'https://other.supabase.co' })).toThrow(/canonical/);
  });

  it('reads only the exact allowlist and emits sanitized evidence', async () => {
    const api = makeApi();
    const data = makeData();
    const evidence = await collectC2BRemoval01Evidence(api, data, env());
    expect(api.trading.getCurrentUserIdentity).toHaveBeenCalledOnce();
    expect(api.inventory.getInventoryItemGroup).toHaveBeenCalledWith(C2B_REMOVAL01_GROUP_KEY);
    expect(api.inventory.getInventoryItem).toHaveBeenCalledTimes(3);
    expect(api.inventory.getInventoryItem).toHaveBeenCalledWith(C2B_REMOVAL01_SKUS[0]);
    expect(api.inventory.getOffers).toHaveBeenCalledTimes(3);
    expect(api.inventory.getOffers).toHaveBeenNthCalledWith(1, C2B_REMOVAL01_SKUS[0], undefined, 25, 0);
    expect(data.variationListings.listRevisionsByGroupId).toHaveBeenCalledWith(C2B_REMOVAL01_GROUP_ID);
    expect(data.variationListings.listCheckpointsByRevisionId).toHaveBeenCalledWith(C2B_REMOVAL01_REVISION_ID);
    expect(data.variationListings.remoteRetirementStore.load).toHaveBeenCalledWith(C2B_REMOVAL01_REVISION_ID);
    const serialized = JSON.stringify(evidence);
    expect(serialized).not.toContain('https://private.example');
    expect(serialized).not.toContain('imageUrls');
    expect(evidence).toMatchObject({ seller: { userId: 'verified-seller' }, revision: { snapshotVersion: 3, planCardinality: 1 }, group: { imageEvidence: { count: 1, hosts: ['private.example'] } } });
    expect(evidence.offers).toEqual(expect.arrayContaining([expect.objectContaining({ pages: [expect.objectContaining({ offers: [expect.objectContaining({ listingId: '110591443545', listingStatus: 'ACTIVE', status: 'PUBLISHED' })] })] })]));
  });

  it('rejects cross-host and incomplete offer pagination', async () => {
    const inventory = makeApi().inventory;
    const crossHost = vi.fn(async () => ({ total: 1, size: 1, offers: [{ offerId: 'foreign' }], next: 'https://api.ebay.com/sell/inventory/v1/offer?offset=1' }));
    inventory.getOffers = crossHost;
    await expect(readAllC2BRemoval01Offers(inventory, C2B_REMOVAL01_SKUS[0])).rejects.toThrow(/Sandbox host/);
    inventory.getOffers = vi.fn(async () => ({ total: 2, size: 1, offers: [{}] }));
    await expect(readAllC2BRemoval01Offers(inventory, C2B_REMOVAL01_SKUS[0])).rejects.toThrow(/exactly one Offer/);
    inventory.getOffers = vi.fn(async () => ({ total: 1, size: 1, offers: [{ offerId: 'foreign', marketplaceId: 'EBAY_US', listingId: '110591443545', status: 'PUBLISHED', availableQuantity: 0 }] }));
    await expect(readAllC2BRemoval01Offers(inventory, C2B_REMOVAL01_SKUS[0])).rejects.toThrow(/frozen C2BRemoval01 identity/);
  });

  it('fails closed when exact revision or two checkpoints are unavailable', async () => {
    const missingRevision = makeData();
    missingRevision.variationListings.listRevisionsByGroupId = vi.fn(async () => []);
    await expect(collectC2BRemoval01Evidence(makeApi(), missingRevision, env())).rejects.toThrow(/revision/);
    const missingCheckpoint = makeData();
    missingCheckpoint.variationListings.listCheckpointsByRevisionId = vi.fn(async () => []);
    await expect(collectC2BRemoval01Evidence(makeApi(), missingCheckpoint, env())).rejects.toThrow(/exactly two/);
  });

  it('rejects placeholder Trading seller identities', async () => {
    const api = makeApi();
    api.trading.getCurrentUserIdentity = vi.fn(async () => ({ userId: 'sandbox' }));
    await expect(collectC2BRemoval01Evidence(api, makeData(), env())).rejects.toThrow(/placeholder/);
  });

  it('uses Bearer auth and language headers for native Sandbox reads', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ access_token: 'access-secret', expires_in: 3600, token_type: 'User Access Token' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ variantSKUs: [] }) })
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => '<GetUserResponse><User><UserID>verified-seller</UserID></User></GetUserResponse>' });
    const api = await createReadOnlySandboxApi({ ...env(), EBAY_CLIENT_ID: 'client-id', EBAY_CLIENT_SECRET: 'client-secret' }, fetchImpl);
    await api.inventory.getInventoryItemGroup(C2B_REMOVAL01_GROUP_KEY);
    await api.trading.getCurrentUserIdentity();
    const inventoryRequest = fetchImpl.mock.calls[1]![1] as RequestInit;
    expect(inventoryRequest.method).toBe('GET');
    expect(inventoryRequest.headers).toMatchObject({ Authorization: 'Bearer access-secret', 'Accept-Language': 'en-US', 'Content-Language': 'en-US' });
    const tradingRequest = fetchImpl.mock.calls[2]![1] as RequestInit;
    expect(tradingRequest.headers).toMatchObject({ 'X-EBAY-API-IAF-TOKEN': 'access-secret' });
    expect((tradingRequest.headers as Record<string, string>).Authorization).toBeUndefined();
  });
});
