import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createPartFromUriMock = vi.hoisted(() =>
  vi.fn(function createPartFromUri(uri: string, mimeType: string) {
    return {
      fileData: {
        fileUri: uri,
        mimeType,
      },
    };
  })
);
const generateContentMock = vi.hoisted(() => vi.fn());
const GoogleGenAIMock = vi.hoisted(() =>
  vi.fn(
    class GoogleGenAI {
      models = {
        generateContent: generateContentMock,
      };

      constructor(_config: { apiKey: string }) {}
    }
  )
);

interface MockFetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: {
    get(name: string): string | null;
  };
  arrayBuffer(): Promise<ArrayBuffer>;
}

function createFetchResponse({
  body,
  contentType,
  ok = true,
  status = 200,
  statusText = 'OK',
}: {
  body: Uint8Array;
  contentType: string | null;
  ok?: boolean;
  status?: number;
  statusText?: string;
}): MockFetchResponse {
  return {
    ok,
    status,
    statusText,
    headers: {
      get(name: string): string | null {
        return name.toLowerCase() === 'content-type' ? contentType : null;
      },
    },
    async arrayBuffer(): Promise<ArrayBuffer> {
      return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
    },
  };
}

vi.mock('@google/genai', () => ({
  GoogleGenAI: GoogleGenAIMock,
  createPartFromUri: createPartFromUriMock,
}));

import { GeminiDraftServiceError } from '@/gemini/contracts.js';
import { getGeminiDraftClient } from '@/gemini/client.js';

describe('getGeminiDraftClient', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    generateContentMock.mockReset();
    createPartFromUriMock.mockClear();
    GoogleGenAIMock.mockClear();
    generateContentMock.mockResolvedValue({
      text: '{"title":"draft"}',
      candidates: [],
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('fetches public HTTPS image URLs and sends them as inline image data parts', async () => {
    global.fetch = vi.fn(async function fetch(input: string | URL) {
      expect(typeof input).toBe('string');
      expect(input).toBe('https://cdn.example.com/front.png');

      return createFetchResponse({
        body: Uint8Array.from([1, 2, 3, 4]),
        contentType: 'image/png; charset=binary',
      });
    }) as typeof fetch;

    const client = getGeminiDraftClient('gemini-api-key');

    await client.generateDraftRaw({
      model: 'gemini-test-model',
      listingId: 'LIST-001',
      prompt: 'Prompt text',
      imageUrls: ['https://cdn.example.com/front.png'],
    });

    expect(createPartFromUriMock).not.toHaveBeenCalled();
    expect(generateContentMock).toHaveBeenCalledWith({
      model: 'gemini-test-model',
      contents: [
        {
          role: 'user',
          parts: [
            { text: 'Prompt text' },
            {
              inlineData: {
                data: Buffer.from([1, 2, 3, 4]).toString('base64'),
                mimeType: 'image/png',
              },
            },
          ],
        },
      ],
    });
  });

  it('rejects non-image HTTPS responses with a clear error', async () => {
    global.fetch = vi.fn(async function fetch() {
      return createFetchResponse({
        body: Buffer.from('<html>not an image</html>'),
        contentType: 'text/html',
      });
    }) as typeof fetch;

    const client = getGeminiDraftClient('gemini-api-key');

    await expect(
      client.generateDraftRaw({
        model: 'gemini-test-model',
        listingId: 'LIST-002',
        prompt: 'Prompt text',
        imageUrls: ['https://cdn.example.com/not-image'],
      })
    ).rejects.toThrow('returned non-image content type "text/html"');

    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it('preserves URI-based parts for non-HTTP Gemini file URIs', async () => {
    const client = getGeminiDraftClient('gemini-api-key');

    await client.generateDraftRaw({
      model: 'gemini-test-model',
      listingId: 'LIST-003',
      prompt: 'Prompt text',
      imageUrls: ['gs://bucket/card-front.jpg'],
    });

    expect(createPartFromUriMock).toHaveBeenCalledWith(
      'gs://bucket/card-front.jpg',
      'image/jpeg'
    );
    expect(generateContentMock).toHaveBeenCalledWith({
      model: 'gemini-test-model',
      contents: [
        {
          role: 'user',
          parts: [
            { text: 'Prompt text' },
            {
              fileData: {
                fileUri: 'gs://bucket/card-front.jpg',
                mimeType: 'image/jpeg',
              },
            },
          ],
        },
      ],
    });
  });

  it('rejects empty HTTP image responses clearly', async () => {
    global.fetch = vi.fn(async function fetch() {
      return createFetchResponse({
        body: new Uint8Array(),
        contentType: 'image/jpeg',
      });
    }) as typeof fetch;

    const client = getGeminiDraftClient('gemini-api-key');

    await expect(
      client.generateDraftRaw({
        model: 'gemini-test-model',
        listingId: 'LIST-004',
        prompt: 'Prompt text',
        imageUrls: ['https://cdn.example.com/empty.jpg'],
      })
    ).rejects.toBeInstanceOf(GeminiDraftServiceError);

    await expect(
      client.generateDraftRaw({
        model: 'gemini-test-model',
        listingId: 'LIST-004',
        prompt: 'Prompt text',
        imageUrls: ['https://cdn.example.com/empty.jpg'],
      })
    ).rejects.toThrow('returned an empty response body');
  });
});
