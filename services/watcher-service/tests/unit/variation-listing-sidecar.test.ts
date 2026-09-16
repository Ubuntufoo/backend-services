import { describe, expect, it, vi } from 'vitest';

import {
  claimVariationListingRetryApproval,
  reportVariationListingIntakeStatus,
  requestVariationListingIdentityHandoff,
  VariationListingSidecarRetryableError,
} from '../../src/variation-listing-sidecar.js';

const request = {
  variationId: '11111111-1111-4111-8111-111111111111',
  frontSourceRef: '/watcher/incoming/front.jpg',
  backSourceRef: '/watcher/incoming/back.jpg',
};

describe('variation listing Sidecar client', () => {
  it('claims retry approval with the exact capture source and pair', async () => {
    const fetch = vi.fn(async () =>
      new Response(JSON.stringify({ approved: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await expect(claimVariationListingRetryApproval(
      'camera-1',
      '22222222-2222-4222-8222-222222222222',
      true,
      { env: { SIDECAR_API_URL: 'http://localhost:3001' }, fetch: fetch as typeof globalThis.fetch },
    )).resolves.toBe(true);

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3001/api/variation-listings/intake-retry/claim',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          captureSourceKey: 'camera-1',
          pairId: '22222222-2222-4222-8222-222222222222',
          canRetry: true,
        }),
      }),
    );
  });

  it('surfaces a deterministic non-retryable identity validation message', async () => {
    const fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: 'gemini_identity_validation_failed',
          message: 'Variation identity does not contain enough proven components to construct a safe selector.',
          retryable: false,
        }),
        { status: 422, headers: { 'Content-Type': 'application/json' } }
      )
    );

    await expect(
      requestVariationListingIdentityHandoff(request, {
        env: { SIDECAR_API_URL: 'http://localhost:3001' },
        fetch: fetch as typeof globalThis.fetch,
      })
    ).rejects.toThrow(
      'Variation listing Sidecar client failed: identity request failed: Variation identity does not contain enough proven components to construct a safe selector.'
    );
  });

  it('maps an explicit temporarily missing identity source to a typed retryable error', async () => {
    const fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: 'variation_listing_identity_source_temporarily_unavailable',
          message: 'Variation listing intake identity source is temporarily unavailable: frontSourceRef.',
          retryable: true,
        }),
        { status: 409, headers: { 'Content-Type': 'application/json' } }
      )
    );

    await expect(
      requestVariationListingIdentityHandoff(request, {
        env: { SIDECAR_API_URL: 'http://localhost:3001' },
        fetch: fetch as typeof globalThis.fetch,
      })
    ).rejects.toBeInstanceOf(VariationListingSidecarRetryableError);
  });

  it('maps explicit retryable 503 identity exhaustion to a typed retryable error', async () => {
    const fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: 'gemini_routes_temporarily_unavailable',
          message: 'All configured Gemini fallback models are temporarily unavailable.',
          retryable: true,
          fallbackKind: 'unavailable',
        }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      )
    );

    await expect(
      requestVariationListingIdentityHandoff(request, {
        env: { SIDECAR_API_URL: 'http://localhost:3001' },
        fetch: fetch as typeof globalThis.fetch,
      })
    ).rejects.toBeInstanceOf(VariationListingSidecarRetryableError);
  });

  it('does not classify an ordinary 503 as retryable without the explicit contract flag', async () => {
    const fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ error: 'server_error', message: 'An unexpected server error occurred.' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      )
    );

    await expect(
      requestVariationListingIdentityHandoff(request, {
        env: { SIDECAR_API_URL: 'http://localhost:3001' },
        fetch: fetch as typeof globalThis.fetch,
      })
    ).rejects.toThrow('Variation listing Sidecar client failed: identity request failed');
  });

  it('requires the exact Gemini exhaustion error and a recoverable fallback kind', async () => {
    const fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: 'server_error',
          message: 'An unexpected server error occurred.',
          retryable: true,
          fallbackKind: 'unavailable',
        }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      )
    );

    await expect(
      requestVariationListingIdentityHandoff(request, {
        env: { SIDECAR_API_URL: 'http://localhost:3001' },
        fetch: fetch as typeof globalThis.fetch,
      })
    ).rejects.toThrow('Variation listing Sidecar client failed: identity request failed');

    fetch.mockImplementationOnce(async () =>
      new Response(
        JSON.stringify({
          error: 'gemini_routes_temporarily_unavailable',
          message: 'All configured Gemini fallback models are temporarily unavailable.',
          retryable: true,
          fallbackKind: 'none',
        }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      )
    );

    await expect(
      requestVariationListingIdentityHandoff(request, {
        env: { SIDECAR_API_URL: 'http://localhost:3001' },
        fetch: fetch as typeof globalThis.fetch,
      })
    ).rejects.toThrow('Variation listing Sidecar client failed: identity request failed');
  });

  it('preserves non-negative identity timing telemetry and posts intake status', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(
        JSON.stringify({
          selectorValue: 'Card A',
          variationMetadata: {},
          timings: { imageReadEncodeMs: 4, generationMs: 12, totalMs: 16 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      ))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));

    const handoff = await requestVariationListingIdentityHandoff(request, {
      env: { SIDECAR_API_URL: 'http://localhost:3001' },
      fetch: fetch as typeof globalThis.fetch,
    });
    expect(handoff.timings).toEqual({ imageReadEncodeMs: 4, generationMs: 12, totalMs: 16 });
    await reportVariationListingIntakeStatus({
      captureSourceKey: 'camera-1',
      targetGroupId: request.variationId,
      pairId: request.variationId,
      phase: 'ready',
      completionKind: 'new_variation',
      message: null,
    }, {
      env: { SIDECAR_API_URL: 'http://localhost:3001' },
      fetch: fetch as typeof globalThis.fetch,
    });
    expect(fetch).toHaveBeenNthCalledWith(2,
      'http://localhost:3001/api/variation-listings/intake-status',
      expect.objectContaining({ method: 'POST' })
    );
  });
});
