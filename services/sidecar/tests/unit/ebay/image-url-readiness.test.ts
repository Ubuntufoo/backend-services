import { describe, expect, it, vi } from 'vitest';
import type { ListingRow } from '@ebay-inventory/data';
import {
  assertListingImageUrlsReadyForEbay,
  validateListingImageUrlsReadyForEbay,
} from '@/ebay/image-url-readiness.js';

type FetchResponse = Awaited<ReturnType<typeof globalThis.fetch>>;

function createListing(overrides: Partial<ListingRow> = {}): Pick<ListingRow, 'image_urls' | 'listing_id'> {
  return {
    image_urls: ['https://images.murphyfamilyhobby.dev/listings/list-001/front.jpg'],
    listing_id: 'LIST-001',
    ...overrides,
  };
}

function createResponse(
  body: Uint8Array | null,
  init: { headers?: Record<string, string>; status?: number } = {}
): FetchResponse {
  const status = init.status ?? 200;
  const headers = new Map(
    Object.entries(init.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value])
  );

  return {
    body:
      body === null
        ? null
        : ({
            getReader() {
              let read = false;

              return {
                async cancel() {
                  return undefined;
                },
                async read() {
                  if (read) {
                    return {
                      done: true,
                      value: undefined,
                    };
                  }

                  read = true;
                  return {
                    done: false,
                    value: body,
                  };
                },
              };
            },
          } as FetchResponse['body']),
    headers: {
      get(name: string) {
        return headers.get(name.toLowerCase()) ?? null;
      },
    },
    ok: status >= 200 && status < 300,
    status,
  } as FetchResponse;
}

describe('image URL readiness validation', () => {
  it('passes HTTPS custom-domain JPG when reachable and non-empty', async () => {
    const fetch = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      expect((init?.method ?? 'GET').toUpperCase()).toBe('HEAD');
      return createResponse(null, {
        headers: {
          'content-length': '12',
          'content-type': 'image/jpeg',
        },
      });
    });

    await expect(
      validateListingImageUrlsReadyForEbay(createListing(), {
        allowedPublicBaseUrl: 'https://images.murphyfamilyhobby.dev',
        fetch,
      })
    ).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('fails HTTP URLs', async () => {
    await expect(
      validateListingImageUrlsReadyForEbay(
        createListing({
          image_urls: ['http://images.murphyfamilyhobby.dev/listings/list-001/front.jpg'],
        }),
        {
          allowedPublicBaseUrl: 'https://images.murphyfamilyhobby.dev',
          fetch: vi.fn(),
        }
      )
    ).resolves.toMatchObject({
      code: 'IMAGE_URL_NOT_READY_FOR_EBAY',
      fields: [
        {
          field: 'image_urls[0]',
          message: 'Image URL must use HTTPS before publishing.',
          scope: 'listing',
          url: 'http://images.murphyfamilyhobby.dev/listings/list-001/front.jpg',
        },
      ],
      kind: 'user_fixable',
      ok: false,
    });
  });

  it('fails when host does not match configured public image host', async () => {
    await expect(
      validateListingImageUrlsReadyForEbay(
        createListing({
          image_urls: ['https://cdn.example.com/listings/list-001/front.jpg'],
        }),
        {
          allowedPublicBaseUrl: 'https://images.murphyfamilyhobby.dev',
          fetch: vi.fn(),
        }
      )
    ).resolves.toMatchObject({
      fields: [
        {
          field: 'image_urls[0]',
          message:
            'Image URL must use configured public image host "images.murphyfamilyhobby.dev" before publishing.',
          scope: 'listing',
          url: 'https://cdn.example.com/listings/list-001/front.jpg',
        },
      ],
      ok: false,
    });
  });

  it('fails unsupported extensions', async () => {
    await expect(
      validateListingImageUrlsReadyForEbay(
        createListing({
          image_urls: ['https://images.murphyfamilyhobby.dev/listings/list-001/front.gif'],
        }),
        {
          allowedPublicBaseUrl: 'https://images.murphyfamilyhobby.dev',
          fetch: vi.fn(),
        }
      )
    ).resolves.toMatchObject({
      fields: [
        {
          message: 'Image URL path must end in .jpg, .jpeg, .png, or .webp before publishing.',
        },
      ],
      ok: false,
    });
  });

  it('fails empty responses', async () => {
    const fetch = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'HEAD') {
        return createResponse(null, {
          headers: {
            'content-type': 'image/jpeg',
          },
        });
      }

      return createResponse(null, {
        headers: {
          'content-type': 'image/jpeg',
        },
      });
    });

    await expect(
      validateListingImageUrlsReadyForEbay(createListing(), {
        allowedPublicBaseUrl: 'https://images.murphyfamilyhobby.dev',
        fetch,
      })
    ).resolves.toMatchObject({
      fields: [
        {
          message: 'Image URL returned an empty response body.',
        },
      ],
      ok: false,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([404, 403])('fails %s responses', async (status) => {
    const fetch = vi.fn(async () =>
      createResponse(null, {
        status,
      })
    );

    await expect(
      validateListingImageUrlsReadyForEbay(createListing(), {
        allowedPublicBaseUrl: 'https://images.murphyfamilyhobby.dev',
        fetch,
      })
    ).resolves.toMatchObject({
      fields: [
        {
          message: `Image URL returned HTTP ${status} when checked for eBay publish.`,
        },
      ],
      ok: false,
    });
  });

  it('passes valid content type without GET fallback', async () => {
    const fetch = vi.fn(async () =>
      createResponse(null, {
        headers: {
          'content-length': '9',
          'content-type': 'image/png',
        },
      })
    );

    await expect(
      validateListingImageUrlsReadyForEbay(createListing(), {
        allowedPublicBaseUrl: 'https://images.murphyfamilyhobby.dev',
        fetch,
      })
    ).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('accepts missing content type when extension is valid and body is non-empty', async () => {
    const fetch = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();

      if (method === 'HEAD') {
        return createResponse(null, {
          headers: {
            'content-length': '0',
          },
        });
      }

      return createResponse(new Uint8Array([1, 2, 3]));
    });

    await expect(
      validateListingImageUrlsReadyForEbay(createListing(), {
        allowedPublicBaseUrl: 'https://images.murphyfamilyhobby.dev',
        fetch,
      })
    ).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('fails invalid content type', async () => {
    const fetch = vi.fn(async () =>
      createResponse(null, {
        headers: {
          'content-length': '20',
          'content-type': 'text/html',
        },
      })
    );

    await expect(
      validateListingImageUrlsReadyForEbay(createListing(), {
        allowedPublicBaseUrl: 'https://images.murphyfamilyhobby.dev',
        fetch,
      })
    ).resolves.toMatchObject({
      fields: [
        {
          message: 'Image URL returned unsupported Content-Type "text/html" for eBay publish.',
        },
      ],
      ok: false,
    });
  });

  it('falls back from HEAD to GET when HEAD is unsupported', async () => {
    const fetch = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();

      if (method === 'HEAD') {
        return createResponse(null, {
          status: 405,
        });
      }

      return createResponse(new Uint8Array([1]), {
        headers: {
          'content-type': 'image/webp',
        },
      });
    });

    await expect(
      validateListingImageUrlsReadyForEbay(createListing(), {
        allowedPublicBaseUrl: 'https://images.murphyfamilyhobby.dev',
        fetch,
      })
    ).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('aggregates multiple failures by URL index', async () => {
    await expect(
      validateListingImageUrlsReadyForEbay(
        createListing({
          image_urls: [
            'http://images.murphyfamilyhobby.dev/listings/list-001/front.jpg',
            'https://cdn.example.com/listings/list-001/back.jpg',
            'https://images.murphyfamilyhobby.dev/listings/list-001/thumb.gif',
          ],
        }),
        {
          allowedPublicBaseUrl: 'https://images.murphyfamilyhobby.dev',
          fetch: vi.fn(),
        }
      )
    ).resolves.toMatchObject({
      fields: [
        {
          field: 'image_urls[0]',
          message: 'Image URL must use HTTPS before publishing.',
        },
        {
          field: 'image_urls[1]',
          message:
            'Image URL must use configured public image host "images.murphyfamilyhobby.dev" before publishing.',
        },
        {
          field: 'image_urls[2]',
          message: 'Image URL path must end in .jpg, .jpeg, .png, or .webp before publishing.',
        },
      ],
      ok: false,
    });
  });

  it('throws structured validation error through assert helper', async () => {
    await expect(
      assertListingImageUrlsReadyForEbay(
        createListing({
          image_urls: ['http://images.murphyfamilyhobby.dev/listings/list-001/front.jpg'],
        }),
        {
          allowedPublicBaseUrl: 'https://images.murphyfamilyhobby.dev',
          fetch: vi.fn(),
        }
      )
    ).rejects.toMatchObject({
      code: 'LISTING_NOT_READY',
      context: {
        fields: [
          {
            field: 'image_urls[0]',
            message: 'Image URL must use HTTPS before publishing.',
            scope: 'listing',
            url: 'http://images.murphyfamilyhobby.dev/listings/list-001/front.jpg',
          },
        ],
        issues: ['Image URL must use HTTPS before publishing.'],
        kind: 'user_fixable',
        stage: 'validate',
        validationCode: 'IMAGE_URL_NOT_READY_FOR_EBAY',
      },
    });
  });
});
