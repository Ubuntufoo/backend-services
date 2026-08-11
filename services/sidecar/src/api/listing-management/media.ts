import type { EbayApiClient } from '@/api/client.js';
import { withApiError } from '@/api/shared/request.js';
import axios from 'axios';
import { z } from 'zod';

const mediaPath = '/commerce/media/v1_beta';
const imageIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);

const httpsUrlSchema = z
  .string({ required_error: 'URL is required', invalid_type_error: 'URL must be a string' })
  .trim()
  .url('URL must be a valid URL')
  .refine((value) => new URL(value).protocol === 'https:', 'URL must use HTTPS')
  .refine(
    (value) => {
      const parsed = new URL(value);
      return !parsed.username && !parsed.password;
    },
    'URL must not include credentials'
  );

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

  let imageId: string;
  try {
    imageId = decodeURIComponent(match[1]);
  } catch {
    throw new Error('Media API response Location header contains an invalid image ID');
  }
  if (!imageIdSchema.safeParse(imageId).success) {
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
    const imageId = imageIdSchema.parse(missingImageId);
    const environment = this.client.getConfig().environment;
    const location = `${getMediaBaseUrl(environment)}${mediaPath}/image/${encodeURIComponent(imageId)}`;

    try {
      await this.client.getWithFullUrl(location);
      throw new Error('Media authorization probe unexpectedly found an image resource');
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 404) return 'authorized';
        if (error.response?.status === 401 || error.response?.status === 403)
          return 'unauthorized';
      }
      throw error;
    }
  }
}
