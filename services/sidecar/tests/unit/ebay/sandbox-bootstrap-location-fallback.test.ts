import { describe, expect, it, vi } from 'vitest';
import type { SandboxBootstrapApi } from '@/ebay/sandbox-bootstrap.js';
import { ensureDefaultInventoryLocation } from '@/ebay/sandbox-bootstrap.js';

function createApi(): SandboxBootstrapApi {
  return {
    account: {
      createFulfillmentPolicy: vi.fn(),
      createPaymentPolicy: vi.fn(),
      createReturnPolicy: vi.fn(),
      getFulfillmentPolicies: vi.fn(),
      getPaymentPolicies: vi.fn(),
      getReturnPolicies: vi.fn(),
    },
    getAuthClient: vi.fn(() => ({
      getConfig: vi.fn(() => ({
        environment: 'sandbox',
        marketplaceId: 'EBAY_US',
      })),
      getOAuthClient: vi.fn(),
    })),
    hasUserTokens: vi.fn(() => true),
    inventory: {
      createOrReplaceInventoryLocation: vi.fn().mockResolvedValue(undefined),
      getInventoryLocation: vi.fn().mockRejectedValue(new Error('not found')),
      getInventoryLocations: vi.fn().mockRejectedValue(new Error('system error')),
    },
  } as unknown as SandboxBootstrapApi;
}

describe('sandbox bootstrap inventory fallback', () => {
  it('creates default inventory location when list endpoint fails', async () => {
    const api = createApi();

    const result = await ensureDefaultInventoryLocation(api, {
      merchant_location_key: 'default-main-location',
    });

    expect(api.inventory.createOrReplaceInventoryLocation).toHaveBeenCalledWith(
      'default-main-location',
      expect.any(Object)
    );
    expect(result).toEqual({
      created: { location: true },
      merchantLocationKey: 'default-main-location',
      warnings: [
        expect.stringContaining('Failed to list inventory locations before bootstrap. Continuing with direct lookup/create fallback.'),
      ],
    });
  });
});
