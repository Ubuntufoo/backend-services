import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AxiosResponse } from 'axios';
import type { EbayApiClient } from '@/api/client.js';
import { MediaApi } from '@/api/listing-management/media.js';

const imageUrl = 'https://cdn.example.test/source/front.webp';
const epsImageUrl = 'https://i.ebayimg.com/images/g/example/s-l1600.webp';
const imageResourceUri = 'https://apim.sandbox.ebay.com/commerce/media/v1_beta/image/image-123';
const imageResponse = {
  imageUrl: epsImageUrl,
  expirationDate: '2026-08-12T00:00:00.000Z',
  maxDimensionImageUrl: 'https://i.ebayimg.com/images/g/example/s-l5000.webp',
};

function response(
  data: typeof imageResponse,
  location = imageResourceUri,
  status = 201
): AxiosResponse<typeof imageResponse> {
  return {
    data,
    status,
    statusText: status === 201 ? 'Created' : 'OK',
    headers: { Location: location },
    config: {},
  } as AxiosResponse<typeof imageResponse>;
}

function axiosStatusError(status: number): Error {
  return Object.assign(new Error(`HTTP ${status}`), {
    isAxiosError: true,
    response: { status },
  });
}

describe('MediaApi', () => {
  let client: EbayApiClient;
  let api: MediaApi;

  beforeEach(() => {
    client = {
      getConfig: vi.fn(() => ({ environment: 'sandbox' })),
      postWithFullUrlResponse: vi.fn(),
      getWithFullUrl: vi.fn(),
    } as unknown as EbayApiClient;
    api = new MediaApi(client);
  });

  describe('createImageFromUrl', () => {
    it('posts to the sandbox Media API and preserves Location-derived identity', async () => {
      vi.mocked(client.postWithFullUrlResponse).mockResolvedValue(response(imageResponse));

      const result = await api.createImageFromUrl(`  ${imageUrl} `);

      expect(client.postWithFullUrlResponse).toHaveBeenCalledWith(
        'https://apim.sandbox.ebay.com/commerce/media/v1_beta/image/create_image_from_url',
        { imageUrl }
      );
      expect(result).toEqual({
        imageId: 'image-123',
        location: imageResourceUri,
        imageUrl: imageResponse.imageUrl,
        expirationDate: imageResponse.expirationDate,
      });
    });

    it('treats the eBay image ID as an opaque URI segment', async () => {
      const opaqueId = `${'A'.repeat(160)}%2Fchild%3D%3D`;
      const opaqueLocation = `https://apim.sandbox.ebay.com/commerce/media/v1_beta/image/${opaqueId}`;
      vi.mocked(client.postWithFullUrlResponse).mockResolvedValue(
        response(imageResponse, opaqueLocation)
      );

      await expect(api.createImageFromUrl(imageUrl)).resolves.toEqual(
        expect.objectContaining({ imageId: opaqueId, location: opaqueLocation })
      );
    });

    it('rejects a non-HTTPS source before making a request', async () => {
      await expect(api.createImageFromUrl('http://example.test/image.jpg')).rejects.toThrow(
        'URL must use HTTPS'
      );
      expect(client.postWithFullUrlResponse).not.toHaveBeenCalled();
    });

    it('requires a 201 response and a valid image Location header', async () => {
      vi.mocked(client.postWithFullUrlResponse).mockResolvedValue(
        response(imageResponse, imageResourceUri, 200)
      );

      await expect(api.createImageFromUrl(imageUrl)).rejects.toThrow('unexpected status 200');

      vi.mocked(client.postWithFullUrlResponse).mockResolvedValue(
        response(imageResponse, 'https://evil.example.test/image/image-123')
      );
      await expect(api.createImageFromUrl(imageUrl)).rejects.toThrow('untrusted eBay host');
    });

    it('rejects malformed response metadata', async () => {
      vi.mocked(client.postWithFullUrlResponse).mockResolvedValue(
        response({ ...imageResponse, expirationDate: 'not-a-date' })
      );

      await expect(api.createImageFromUrl(imageUrl)).rejects.toThrow('Invalid');
    });
  });

  describe('getImage', () => {
    it('gets the exact validated image resource URI', async () => {
      vi.mocked(client.getWithFullUrl).mockResolvedValue(imageResponse);

      const result = await api.getImage(imageResourceUri);

      expect(client.getWithFullUrl).toHaveBeenCalledWith(imageResourceUri);
      expect(result).toEqual({
        imageId: 'image-123',
        location: imageResourceUri,
        imageUrl: imageResponse.imageUrl,
        expirationDate: imageResponse.expirationDate,
      });
    });

    it('rejects a production or non-Media URI while configured for Sandbox', async () => {
      await expect(
        api.getImage('https://apim.ebay.com/commerce/media/v1_beta/image/image-123')
      ).rejects.toThrow('untrusted eBay host');
      await expect(
        api.getImage('https://apim.sandbox.ebay.com/commerce/media/v1_beta/video/video-123')
      ).rejects.toThrow('not an image resource URI');
      expect(client.getWithFullUrl).not.toHaveBeenCalled();
    });

    it('rejects malformed GET response metadata', async () => {
      vi.mocked(client.getWithFullUrl).mockResolvedValue({
        imageUrl: epsImageUrl,
        expirationDate: 'not-a-date',
      });

      await expect(api.getImage(imageResourceUri)).rejects.toThrow('Invalid');
    });
  });

  describe('probeImageAccess', () => {
    it('treats a missing image as proof that authorization reached resource lookup', async () => {
      vi.mocked(client.getWithFullUrl).mockRejectedValue(axiosStatusError(404));

      await expect(api.probeImageAccess('VL_MEDIA_AUTH_PROBE_MISSING')).resolves.toBe('authorized');
      expect(client.getWithFullUrl).toHaveBeenCalledWith(
        'https://apim.sandbox.ebay.com/commerce/media/v1_beta/image/VL_MEDIA_AUTH_PROBE_MISSING'
      );
    });

    it.each([401, 403])('treats HTTP %s as unauthorized', async (status) => {
      vi.mocked(client.getWithFullUrl).mockRejectedValue(axiosStatusError(status));

      await expect(api.probeImageAccess('VL_MEDIA_AUTH_PROBE_MISSING')).resolves.toBe(
        'unauthorized'
      );
    });

    it('fails closed on unexpected responses', async () => {
      vi.mocked(client.getWithFullUrl).mockRejectedValue(axiosStatusError(500));

      await expect(api.probeImageAccess('VL_MEDIA_AUTH_PROBE_MISSING')).rejects.toThrow('HTTP 500');
    });
  });
});
