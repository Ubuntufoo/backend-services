import { describe, expect, it, vi } from 'vitest';

import { checkApifyActorMetadata, getApifyPricingDiagnostic } from '@/pricing/index.js';

describe('Apify pricing diagnostic', () => {
  it('passes with disabled state and skips enabled-only checks', async () => {
    const report = await getApifyPricingDiagnostic(
      {
        APIFY_ENABLED: 'false',
      } as NodeJS.ProcessEnv,
      {
        now: () => new Date('2026-06-11T12:00:00.000Z'),
      }
    );

    expect(report).toMatchObject({
      checkedAt: '2026-06-11T12:00:00.000Z',
      enabled: false,
      metadata: {
        actor: null,
        attempted: false,
      },
      requestedCompCount: 50,
      overallStatus: 'pass',
      timeoutSeconds: 120,
      token: {
        configured: false,
        redacted: null,
      },
    });
    expect(report.checks.find((check) => check.name === 'apify_token')?.status).toBe('skipped');
    expect(report.checks.find((check) => check.name === 'apify_actor_id')?.status).toBe('skipped');
  });

  it('fails clearly when enabled without token', async () => {
    const report = await getApifyPricingDiagnostic({
      APIFY_ENABLED: 'true',
      APIFY_PRICE_ACTOR_ID: 'actor-123',
    } as NodeJS.ProcessEnv);

    expect(report.overallStatus).toBe('fail');
    expect(report.checks.find((check) => check.name === 'apify_token')).toMatchObject({
      message: 'APIFY_TOKEN required when APIFY_ENABLED=true.',
      status: 'fail',
    });
    expect(report.metadata.attempted).toBe(false);
  });

  it('fails clearly when enabled without actor id', async () => {
    const report = await getApifyPricingDiagnostic({
      APIFY_ENABLED: 'true',
      APIFY_TOKEN: 'secret-token',
    } as NodeJS.ProcessEnv);

    expect(report.overallStatus).toBe('fail');
    expect(report.checks.find((check) => check.name === 'apify_actor_id')).toMatchObject({
      message: 'APIFY_PRICE_ACTOR_ID required when APIFY_ENABLED=true.',
      status: 'fail',
    });
  });

  it('fails clearly on invalid min comps and timeout', async () => {
    const report = await getApifyPricingDiagnostic({
      APIFY_ENABLED: 'true',
      APIFY_MIN_SOLD_COMPS: '0',
      APIFY_PRICE_ACTOR_ID: 'actor-123',
      APIFY_PRICE_TIMEOUT_SECONDS: '-5',
      APIFY_TOKEN: 'secret-token',
    } as NodeJS.ProcessEnv);

    expect(report.overallStatus).toBe('fail');
    expect(report.checks.find((check) => check.name === 'apify_min_sold_comps')).toMatchObject({
      message: 'APIFY_MIN_SOLD_COMPS must be a positive integer.',
      status: 'fail',
    });
    expect(
      report.checks.find((check) => check.name === 'apify_price_timeout_seconds')
    ).toMatchObject({
      message: 'APIFY_PRICE_TIMEOUT_SECONDS must be a positive integer.',
      status: 'fail',
    });
    expect(report.metadata.attempted).toBe(false);
  });

  it('reports enabled config and runs metadata seam when valid', async () => {
    const checkActorMetadata = vi.fn().mockResolvedValue({
      actorId: 'actor-123',
      actorName: 'ebay-price-actor',
      actorUsername: 'team-apify',
    });

    const report = await getApifyPricingDiagnostic(
      {
        APIFY_ENABLED: 'true',
        APIFY_MIN_SOLD_COMPS: '18',
        APIFY_PRICE_ACTOR_ID: 'actor-123',
        APIFY_PRICE_TIMEOUT_SECONDS: '240',
        APIFY_TOKEN: 'secret-token-value',
      } as NodeJS.ProcessEnv,
      {
        checkActorMetadata,
      }
    );

    expect(report).toMatchObject({
      actorId: 'actor-123',
      enabled: true,
      metadata: {
        actor: {
          actorId: 'actor-123',
          actorName: 'ebay-price-actor',
          actorUsername: 'team-apify',
        },
        attempted: true,
      },
      requestedCompCount: 18,
      overallStatus: 'pass',
      timeoutSeconds: 240,
      token: {
        configured: true,
        redacted: '[redacted:8chars]',
      },
    });
    expect(checkActorMetadata).toHaveBeenCalledWith({
      actorId: 'actor-123',
      token: 'secret-token-value',
    });
    expect(JSON.stringify(report)).not.toContain('secret-token-value');
  });

  it('redacts sensitive metadata errors', async () => {
    const report = await getApifyPricingDiagnostic(
      {
        APIFY_ENABLED: 'true',
        APIFY_PRICE_ACTOR_ID: 'actor-123',
        APIFY_TOKEN: 'secret-token-value',
      } as NodeJS.ProcessEnv,
      {
        checkActorMetadata: vi.fn().mockRejectedValue(
          new Error(
            '401 https://api.apify.com/v2/acts/actor-123?token=secret-token-value Bearer secret-token-value'
          )
        ),
      }
    );

    const metadataCheck = report.checks.find((check) => check.name === 'apify_actor_metadata');

    expect(report.overallStatus).toBe('fail');
    expect(metadataCheck?.status).toBe('fail');
    expect(metadataCheck?.message).toContain('[redacted-url]');
    expect(metadataCheck?.message).toContain('Bearer [redacted-token]');
    expect(metadataCheck?.message).not.toContain('secret-token-value');
  });
});

describe('checkApifyActorMetadata', () => {
  it('uses auth header and returns actor metadata without running actor', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({
        data: {
          id: 'actor-123',
          name: 'pricing-check',
          username: 'team-apify',
        },
      }),
      ok: true,
    });

    const result = await checkApifyActorMetadata(
      {
        actorId: 'actor-123',
        token: 'secret-token',
      },
      fetchMock
    );

    expect(result).toEqual({
      actorId: 'actor-123',
      actorName: 'pricing-check',
      actorUsername: 'team-apify',
    });
    expect(fetchMock).toHaveBeenCalledWith('https://api.apify.com/v2/acts/actor-123', {
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer secret-token',
      },
      method: 'GET',
    });
  });
});
