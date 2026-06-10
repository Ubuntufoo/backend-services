import { describe, expect, it, vi } from 'vitest';
import { createFixturePricingProvider, FixturePricingProvider } from '@/pricing/index.js';

describe('FixturePricingProvider', () => {
  const baseInput = {
    listingId: 'listing-123',
    title: 'Victor Wembanyama rookie card',
    categoryId: '261328',
    conditionId: '3000',
    itemSpecifics: {
      Player: 'Victor Wembanyama',
      Set: 'Prizm',
    },
  };

  it('returns at least 12 sold comps by default', async () => {
    const provider = createFixturePricingProvider();

    const result = await provider.fetchSoldComps(baseInput);

    expect(result.provider).toBe('fixture');
    expect(result.query).toBe(
      'Victor Wembanyama rookie card | category:261328 | condition:3000 | player:Victor Wembanyama | set:Prizm'
    );
    expect(result.fetchedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(result.soldComps).toHaveLength(12);
    expect(result.rawResult).toMatchObject({
      provider: 'fixture',
      listingId: 'listing-123',
      requestedMinSoldComps: null,
      returnedSoldComps: 12,
    });
  });

  it('respects minSoldComps when greater than default floor', async () => {
    const provider = new FixturePricingProvider();

    const result = await provider.fetchSoldComps({
      ...baseInput,
      minSoldComps: 15,
    });

    expect(result.soldComps).toHaveLength(15);
    expect(result.rawResult).toMatchObject({
      requestedMinSoldComps: 15,
      returnedSoldComps: 15,
    });
  });

  it('returns deterministic output for identical input', async () => {
    const provider = createFixturePricingProvider();

    const first = await provider.fetchSoldComps({
      ...baseInput,
      minSoldComps: 14,
    });
    const second = await provider.fetchSoldComps({
      ...baseInput,
      minSoldComps: 14,
    });

    expect(second).toEqual(first);
  });

  it('does not require apify env or network access', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const provider = createFixturePricingProvider();

    const previousApifyToken = process.env.APIFY_TOKEN;
    const previousApifyActorId = process.env.APIFY_ACTOR_ID;

    delete process.env.APIFY_TOKEN;
    delete process.env.APIFY_ACTOR_ID;

    try {
      const result = await provider.fetchSoldComps(baseInput);

      expect(result.soldComps.length).toBeGreaterThanOrEqual(12);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      if (previousApifyToken === undefined) {
        delete process.env.APIFY_TOKEN;
      } else {
        process.env.APIFY_TOKEN = previousApifyToken;
      }

      if (previousApifyActorId === undefined) {
        delete process.env.APIFY_ACTOR_ID;
      } else {
        process.env.APIFY_ACTOR_ID = previousApifyActorId;
      }

      fetchSpy.mockRestore();
    }
  });
});
