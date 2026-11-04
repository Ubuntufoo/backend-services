import { createHash } from 'node:crypto';
import type { Json } from '@ebay-inventory/data';
import type { EbayApiClient } from '@/api/client.js';
import { withApiError } from '@/api/shared/request.js';
import axios from 'axios';
import { z } from 'zod';

const mediaPath = '/commerce/media/v1_beta';
const probeImageIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
const opaqueImageIdSchema = z.string().min(1).max(2048);

const httpsUrlSchema = z
  .string({ required_error: 'URL is required', invalid_type_error: 'URL must be a string' })
  .trim()
  .url('URL must be a valid URL')
  .refine((value) => new URL(value).protocol === 'https:', 'URL must use HTTPS')
  .refine((value) => {
    const parsed = new URL(value);
    return !parsed.username && !parsed.password;
  }, 'URL must not include credentials');

const createImageFromUrlRequestSchema = z
  .object({
    imageUrl: httpsUrlSchema,
  })
  .strict();

const imageResponseSchema = z
  .object({
    imageUrl: httpsUrlSchema,
    expirationDate: z.string().datetime({ offset: true }),
    maxDimensionImageUrl: httpsUrlSchema.optional(),
  })
  .strict();

function safeHeaderValue(headers: unknown, name: string): unknown {
  try {
    if (!headers || typeof headers !== 'object') return undefined;
    const get = (headers as { get?: unknown }).get;
    if (typeof get === 'function') {
      const value = (get as (headerName: string) => unknown).call(headers, name);
      if (value !== undefined) return value;
    }
    return Object.entries(headers as Record<string, unknown>).find(
      ([key]) => key.toLowerCase() === name
    )?.[1];
  } catch {
    return undefined;
  }
}

function safeObjectProperty(value: unknown, name: string): unknown {
  try {
    if (!value || typeof value !== 'object') return undefined;
    return (value as Record<string, unknown>)[name];
  } catch {
    return undefined;
  }
}

/**
 * Allowlisted, non-secret diagnostics for a failed Media create. Never persist raw
 * response bodies, URLs, provider messages or the Axios request configuration.
 */
export function mediaCreateErrorEvidence(error: unknown): Json {
  let cause: unknown = error;
  for (let i = 0; i < 4 && !axios.isAxiosError(cause); i += 1) {
    cause = safeObjectProperty(cause, 'cause');
  }
  const axiosError = axios.isAxiosError(cause) ? cause : null;
  const response = safeObjectProperty(axiosError, 'response');
  const status = safeObjectProperty(response, 'status');
  const httpStatus = typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599
    ? status
    : undefined;
  const evidence: Record<string, Json> = {
    error: httpStatus !== undefined
      ? 'Failed to create eBay Media API image: HTTP ' + httpStatus
      : 'Failed to create eBay Media API image: request or response validation failed',
    method: 'POST',
    endpoint: mediaPath + '/image/create_image_from_url',
  };
  if (httpStatus !== undefined) evidence.httpStatus = httpStatus;
  const transportCode = safeObjectProperty(axiosError, 'code');
  if (typeof transportCode === 'string' && /^[A-Z][A-Z0-9_]{0,47}$/.test(transportCode)) {
    evidence.transportCode = transportCode;
  }
  for (const header of ['x-ebay-c-request-id', 'x-ebay-correlation-id', 'x-ebay-c-trace-id']) {
    const value = safeHeaderValue(safeObjectProperty(response, 'headers'), header);
    if (typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value)) {
      evidence.requestId = value;
      evidence.requestIdHeader = header;
      break;
    }
  }
  const body = safeObjectProperty(response, 'data');
  if (body !== undefined) {
    try {
      const serialized = typeof body === 'string' ? body : JSON.stringify(body);
      if (typeof serialized === 'string') {
        evidence.responseSha256 = createHash('sha256').update(serialized).digest('hex');
      }
    } catch {
      // Error reporting must not interfere with the durable unknown checkpoint.
    }
  }
  const errors = safeObjectProperty(body, 'errors');
  let errorEntries: unknown[] = [];
  try {
    if (Array.isArray(errors)) errorEntries = errors.slice(0, 3);
  } catch {
    errorEntries = [];
  }
  if (errorEntries.length > 0) {
    const details: Json[] = [];
    for (const entry of errorEntries) {
      if (!entry || typeof entry !== 'object') continue;
      try {
        if (Array.isArray(entry)) continue;
      } catch {
        continue;
      }
      const detail: Record<string, Json> = {};
      for (const field of ['errorId', 'domain', 'category'] as const) {
        const value = safeObjectProperty(entry, field);
        if (field === 'errorId') {
          if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
            detail[field] = value;
          }
          continue;
        }
        if (typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,80}$/.test(value)) {
          detail[field] = value;
        }
      }
      const message = safeObjectProperty(entry, 'message');
      if (typeof message === 'string') {
        detail.messageSha256 = createHash('sha256').update(message).digest('hex');
      }
      if (Object.keys(detail).length > 0) details.push(detail);
    }
    if (details.length > 0) evidence.providerErrors = details;
  }
  return evidence;
}

export type MediaImageResponse = z.infer<typeof imageResponseSchema>;

export interface MediaImageResource {
  imageId: string;
  location: string;
  imageUrl: string;
  expirationDate: string;
}

export type MediaImageAccessProbe = 'authorized' | 'unauthorized';

function getMediaBaseUrl(environment: 'production' | 'sandbox'): string {
  // Media API is served from apim; keep the environment mapping explicit.
  return environment === 'production' ? 'https://apim.ebay.com' : 'https://apim.sandbox.ebay.com';
}

function getAllowedMediaHosts(environment: 'production' | 'sandbox'): Set<string> {
  return new Set(
    environment === 'production'
      ? ['api.ebay.com', 'apim.ebay.com']
      : ['api.sandbox.ebay.com', 'apim.sandbox.ebay.com']
  );
}

function parseImageResourceUri(
  value: unknown,
  environment: 'production' | 'sandbox'
): { imageId: string; location: string } {
  const location = z.string().trim().url().safeParse(value);
  if (!location.success) {
    throw new Error('Media API response Location header must be a valid HTTPS URL');
  }

  const parsed = new URL(location.data);
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !getAllowedMediaHosts(environment).has(parsed.hostname)
  ) {
    throw new Error('Media API response Location header uses an untrusted eBay host');
  }

  const match = /^\/commerce\/media\/v1_beta\/image\/([^/]+)$/.exec(parsed.pathname);
  if (!match?.[1]) {
    throw new Error('Media API response Location header is not an image resource URI');
  }

  const imageId = match[1];
  try {
    decodeURIComponent(imageId);
  } catch {
    throw new Error('Media API response Location header contains an invalid image ID');
  }
  if (!opaqueImageIdSchema.safeParse(imageId).success) {
    throw new Error('Media API response Location header contains an invalid image ID');
  }

  return { imageId, location: parsed.toString() };
}

function getLocationHeader(headers: unknown): unknown {
  if (!headers || typeof headers !== 'object') {
    return undefined;
  }

  const entries = Object.entries(headers as Record<string, unknown>);
  const location = entries.find(([name]) => name.toLowerCase() === 'location')?.[1];
  if (location !== undefined) {
    return location;
  }

  const get = (headers as { get?: (name: string) => unknown }).get;
  return typeof get === 'function' ? get.call(headers, 'location') : undefined;
}

/**
 * eBay Commerce Media API image resource.
 *
 * This intentionally supports only URL ingestion and image reconciliation through the current
 * REST Media API.
 */
export class MediaApi {
  constructor(private readonly client: EbayApiClient) {}

  /** Upload an HTTPS source URL into seller-owned eBay Picture Services (EPS). */
  async createImageFromUrl(imageUrl: string): Promise<MediaImageResource> {
    return await withApiError('Failed to create eBay Media API image', async () => {
      const request = createImageFromUrlRequestSchema.parse({ imageUrl });
      const environment = this.client.getConfig().environment;
      const response = await this.client.postWithFullUrlResponse<MediaImageResponse>(
        `${getMediaBaseUrl(environment)}${mediaPath}/image/create_image_from_url`,
        request
      );

      if (response.status !== 201) {
        throw new Error(`Media API image creation returned unexpected status ${response.status}`);
      }

      const location = parseImageResourceUri(getLocationHeader(response.headers), environment);
      const image = imageResponseSchema.parse(response.data);
      return {
        ...location,
        imageUrl: image.imageUrl,
        expirationDate: image.expirationDate,
      };
    });
  }

  /** Retrieve an image resource using the exact Location URI returned by createImageFromUrl. */
  async getImage(imageResourceUri: string): Promise<MediaImageResource> {
    return await withApiError('Failed to get eBay Media API image', async () => {
      const environment = this.client.getConfig().environment;
      const location = parseImageResourceUri(imageResourceUri, environment);
      const imagePayload: unknown = await this.client.getWithFullUrl<MediaImageResponse>(
        location.location
      );
      const image = imageResponseSchema.parse(imagePayload);
      return {
        ...location,
        imageUrl: image.imageUrl,
        expirationDate: image.expirationDate,
      };
    });
  }

  /**
   * Confirm that the current user token can reach Media image resources without creating one.
   * The caller supplies an intentionally nonexistent image ID; 404 proves authorization reached
   * resource lookup, while 401/403 proves the token is unauthorized.
   */
  async probeImageAccess(missingImageId: string): Promise<MediaImageAccessProbe> {
    const imageId = probeImageIdSchema.parse(missingImageId);
    const environment = this.client.getConfig().environment;
    const location = `${getMediaBaseUrl(environment)}${mediaPath}/image/${encodeURIComponent(imageId)}`;

    try {
      await this.client.getWithFullUrl(location);
      throw new Error('Media authorization probe unexpectedly found an image resource');
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 404) return 'authorized';
        if (error.response?.status === 401 || error.response?.status === 403) return 'unauthorized';
      }
      throw error;
    }
  }
}
