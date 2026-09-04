import type { Json } from '@ebay-inventory/data';

export interface VariationListingSidecarEnvironment {
  MCP_PORT?: string;
  SIDECAR_API_URL?: string;
  SIDECAR_API_BEARER_TOKEN?: string;
}

export interface VariationListingIdentityHandoffRequest {
  variationId: string;
  frontSourceRef: string;
  backSourceRef: string;
}

export interface VariationListingIdentityHandoffResponse {
  selectorValue: string;
  variationMetadata: Json;
}

export interface VariationListingSidecarClientDependencies {
  env?: VariationListingSidecarEnvironment;
  fetch?: typeof fetch;
}

export class VariationListingSidecarRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VariationListingSidecarRetryableError';
  }
}

const RETRYABLE_GEMINI_FALLBACK_KINDS = new Set(['rate_limit', 'quota_exceeded', 'unavailable']);

function fail(message: string): never {
  throw new Error(`Variation listing Sidecar client failed: ${message}`);
}

function resolveSidecarApiUrl(env: VariationListingSidecarEnvironment): string {
  const explicit = env.SIDECAR_API_URL;
  if (explicit !== undefined) {
    if (!explicit || explicit !== explicit.trim()) {
      return fail('SIDECAR_API_URL must be a non-empty outer-trimmed URL when set.');
    }
    const parsed = new URL(explicit);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return fail('SIDECAR_API_URL must use http or https.');
    }
    return explicit.replace(/\/+$/u, '');
  }
  const port = env.MCP_PORT?.trim() || '3000';
  if (!/^\d+$/u.test(port)) return fail('MCP_PORT must be numeric when used for the Sidecar URL.');
  return `http://localhost:${port}`;
}

function buildHeaders(env: VariationListingSidecarEnvironment): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  const token = env.SIDECAR_API_BEARER_TOKEN;
  if (token !== undefined) {
    if (!token || token !== token.trim()) {
      return fail('SIDECAR_API_BEARER_TOKEN must be non-empty and outer-trimmed when set.');
    }
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/gu, '').toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

function assertBearerTransportSafety(apiUrl: string, headers: Record<string, string>): void {
  if (!headers.Authorization) return;
  const parsed = new URL(apiUrl);
  if (parsed.protocol === 'http:' && !isLoopbackHostname(parsed.hostname)) {
    return fail('SIDECAR_API_BEARER_TOKEN requires HTTPS for non-loopback Sidecar URLs.');
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export async function requestVariationListingIdentityHandoff(
  input: VariationListingIdentityHandoffRequest,
  dependencies: VariationListingSidecarClientDependencies = {}
): Promise<VariationListingIdentityHandoffResponse> {
  const env = dependencies.env ?? process.env;
  const fetchImpl = dependencies.fetch ?? fetch;
  const apiUrl = resolveSidecarApiUrl(env);
  const headers = buildHeaders(env);
  assertBearerTransportSafety(apiUrl, headers);
  const response = await fetchImpl(`${apiUrl}/api/variation-listings/intake-identity`, {
    method: 'POST',
    headers,
    body: JSON.stringify(input),
  });
  const payload = asObject(await response.json().catch(() => null));
  if (!response.ok) {
    const message = typeof payload?.message === 'string'
      ? payload.message
      : typeof payload?.error === 'string'
        ? payload.error
        : `HTTP ${response.status}`;
    if (
      response.status === 503 &&
      payload?.error === 'gemini_routes_temporarily_unavailable' &&
      payload?.retryable === true &&
      typeof payload.fallbackKind === 'string' &&
      RETRYABLE_GEMINI_FALLBACK_KINDS.has(payload.fallbackKind)
    ) {
      throw new VariationListingSidecarRetryableError(
        `Variation listing Sidecar identity request is retryable: ${message}`
      );
    }
    return fail(`identity request failed: ${message}`);
  }
  const selectorValue = payload?.selectorValue;
  const variationMetadata = payload?.variationMetadata;
  if (typeof selectorValue !== 'string' || selectorValue.trim() === '') {
    return fail('identity response is missing selectorValue.');
  }
  if (typeof variationMetadata !== 'object' || variationMetadata === null || Array.isArray(variationMetadata)) {
    return fail('identity response is missing variationMetadata.');
  }
  return {
    selectorValue,
    variationMetadata: variationMetadata as Json,
  };
}
