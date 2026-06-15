import { describe, expect, it, vi } from 'vitest';

import {
  PricingProviderResolverError,
  resolveProductionPricingProvider,
} from '@/pricing/index.js';

describe('pricing provider resolver', () => {
  it('maps soldcomps mode to soldcomps provider with validated config', () => {
    const createSoldCompsProvider = vi.fn().mockReturnValue({
      fetchSoldComps: vi.fn(),
      name: 'soldcomps',
    });

    const provider = resolveProductionPricingProvider({
      createSoldCompsProvider,
      env: {
        SOLDCOMPS_API_KEY: 'soldcomps-key',
        SOLDCOMPS_PRICE_TIMEOUT_SECONDS: '45',
      },
      mode: 'soldcomps',
    });

    expect(createSoldCompsProvider).toHaveBeenCalledWith(
      {
        apiKey: 'soldcomps-key',
        timeoutSeconds: 45,
      },
      undefined
    );
    expect(provider.name).toBe('soldcomps');
  });

  it('uses canonical default soldcomps timeout when blank', () => {
    const createSoldCompsProvider = vi.fn().mockReturnValue({
      fetchSoldComps: vi.fn(),
      name: 'soldcomps',
    });

    resolveProductionPricingProvider({
      createSoldCompsProvider,
      env: {
        APIFY_PRICE_TIMEOUT_SECONDS: '0',
        SOLDCOMPS_API_KEY: 'soldcomps-key',
        SOLDCOMPS_PRICE_TIMEOUT_SECONDS: '   ',
      },
      mode: 'soldcomps',
    });

    expect(createSoldCompsProvider).toHaveBeenCalledWith(
      {
        apiKey: 'soldcomps-key',
        timeoutSeconds: 120,
      },
      undefined
    );
  });

  it('maps apify mode to apify provider with validated config', () => {
    const createApifyProvider = vi.fn().mockReturnValue({
      fetchSoldComps: vi.fn(),
      name: 'apify',
    });

    const provider = resolveProductionPricingProvider({
      createApifyProvider,
      env: {
        APIFY_PRICE_ACTOR_ID: 'actor-id',
        APIFY_PRICE_TIMEOUT_SECONDS: '90',
        APIFY_TOKEN: 'apify-token',
      },
      mode: 'apify',
    });

    expect(createApifyProvider).toHaveBeenCalledWith(
      {
        actorId: 'actor-id',
        timeoutSeconds: 90,
        token: 'apify-token',
      },
      undefined
    );
    expect(provider.name).toBe('apify');
  });

  it('uses canonical default apify timeout when blank', () => {
    const createApifyProvider = vi.fn().mockReturnValue({
      fetchSoldComps: vi.fn(),
      name: 'apify',
    });

    resolveProductionPricingProvider({
      createApifyProvider,
      env: {
        APIFY_PRICE_ACTOR_ID: 'actor-id',
        APIFY_PRICE_TIMEOUT_SECONDS: '',
        APIFY_TOKEN: 'apify-token',
        SOLDCOMPS_PRICE_TIMEOUT_SECONDS: '0',
      },
      mode: 'apify',
    });

    expect(createApifyProvider).toHaveBeenCalledWith(
      {
        actorId: 'actor-id',
        timeoutSeconds: 120,
        token: 'apify-token',
      },
      undefined
    );
  });

  it('fails soldcomps mode clearly when selected config missing', () => {
    expect(() =>
      resolveProductionPricingProvider({
        env: {},
        mode: 'soldcomps',
      })
    ).toThrowError(PricingProviderResolverError);

    expect(() =>
      resolveProductionPricingProvider({
        env: {},
        mode: 'soldcomps',
      })
    ).toThrow(/SOLDCOMPS_API_KEY is required/);
  });

  it('fails apify mode clearly when selected config missing', () => {
    expect(() =>
      resolveProductionPricingProvider({
        env: {},
        mode: 'apify',
      })
    ).toThrowError(PricingProviderResolverError);

    expect(() =>
      resolveProductionPricingProvider({
        env: {},
        mode: 'apify',
      })
    ).toThrow(/APIFY_TOKEN is required/);
  });

  it('rejects invalid soldcomps timeout using canonical env-loader behavior', () => {
    expect(() =>
      resolveProductionPricingProvider({
        env: {
          SOLDCOMPS_API_KEY: 'soldcomps-key',
          SOLDCOMPS_PRICE_TIMEOUT_SECONDS: '0',
        },
        mode: 'soldcomps',
      })
    ).toThrow(/SOLDCOMPS_PRICE_TIMEOUT_SECONDS must be a positive integer string/);
  });

  it('rejects invalid apify timeout using canonical env-loader behavior', () => {
    expect(() =>
      resolveProductionPricingProvider({
        env: {
          APIFY_PRICE_ACTOR_ID: 'actor-id',
          APIFY_PRICE_TIMEOUT_SECONDS: 'abc',
          APIFY_TOKEN: 'apify-token',
        },
        mode: 'apify',
      })
    ).toThrow(/APIFY_PRICE_TIMEOUT_SECONDS must be a positive integer string/);
  });

  it('does not validate unselected provider configuration', () => {
    const createSoldCompsProvider = vi.fn().mockReturnValue({
      fetchSoldComps: vi.fn(),
      name: 'soldcomps',
    });

    const provider = resolveProductionPricingProvider({
      createSoldCompsProvider,
      env: {
        APIFY_PRICE_TIMEOUT_SECONDS: '0',
        SOLDCOMPS_API_KEY: 'soldcomps-key',
      },
      mode: 'soldcomps',
    });

    expect(provider.name).toBe('soldcomps');
    expect(createSoldCompsProvider).toHaveBeenCalledTimes(1);
  });
});
