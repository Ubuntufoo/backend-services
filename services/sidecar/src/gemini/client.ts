import { GoogleGenAI, createPartFromUri, type Part } from '@google/genai';
import { GeminiDraftServiceError } from './contracts.js';
import type { GenerateListingDraftUserHints } from './contracts.js';

export interface GeminiDraftRawRequest {
  model: string;
  listingId: string;
  prompt: string;
  imageUrls: string[];
  userHints?: GenerateListingDraftUserHints;
}

export interface GeminiDraftRawResult {
  text: string;
  rawResponse: unknown;
}

export interface GeminiDraftClient {
  generateDraftRaw(request: GeminiDraftRawRequest): Promise<GeminiDraftRawResult>;
}

function sanitizeImageUrl(imageUrl: string): string {
  try {
    const parsed = new URL(imageUrl);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return imageUrl;
  }
}

function inferMimeTypeFromUrl(imageUrl: string): string | undefined {
  const normalizedUrl = imageUrl.split('?')[0]?.toLowerCase() ?? '';

  if (normalizedUrl.endsWith('.png')) {
    return 'image/png';
  }

  if (normalizedUrl.endsWith('.webp')) {
    return 'image/webp';
  }

  if (normalizedUrl.endsWith('.gif')) {
    return 'image/gif';
  }

  if (normalizedUrl.endsWith('.jpg') || normalizedUrl.endsWith('.jpeg')) {
    return 'image/jpeg';
  }

  return undefined;
}

function isHttpImageUrl(imageUrl: string): boolean {
  return imageUrl.startsWith('http://') || imageUrl.startsWith('https://');
}

function parseMimeTypeHeader(contentType: string | null): string | undefined {
  if (!contentType) {
    return undefined;
  }

  return contentType.split(';')[0]?.trim().toLowerCase() || undefined;
}

function isImageMimeType(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

async function buildImagePartFromHttpUrl(imageUrl: string): Promise<Part> {
  const response = await fetch(imageUrl);
  const sanitizedUrl = sanitizeImageUrl(imageUrl);

  if (!response.ok) {
    throw new GeminiDraftServiceError(
      `Image URL "${sanitizedUrl}" returned HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}.`
    );
  }

  const responseMimeType = parseMimeTypeHeader(response.headers.get('content-type'));

  if (responseMimeType && !isImageMimeType(responseMimeType)) {
    throw new GeminiDraftServiceError(
      `Image URL "${sanitizedUrl}" returned non-image content type "${responseMimeType}".`
    );
  }

  const mimeType = responseMimeType ?? inferMimeTypeFromUrl(imageUrl);

  if (!mimeType) {
    throw new GeminiDraftServiceError(
      `Image URL "${sanitizedUrl}" did not provide an image Content-Type header and its MIME type could not be inferred.`
    );
  }

  const bytes = Buffer.from(await response.arrayBuffer());

  if (bytes.length === 0) {
    throw new GeminiDraftServiceError(`Image URL "${sanitizedUrl}" returned an empty response body.`);
  }

  return {
    inlineData: {
      data: bytes.toString('base64'),
      mimeType,
    },
  };
}

async function buildImagePart(imageUrl: string): Promise<Part> {
  if (isHttpImageUrl(imageUrl)) {
    return await buildImagePartFromHttpUrl(imageUrl);
  }

  return createPartFromUri(
    imageUrl,
    inferMimeTypeFromUrl(imageUrl) ?? 'image/jpeg'
  );
}

export function getGeminiDraftClient(apiKey: string): GeminiDraftClient {
  const client = new GoogleGenAI({ apiKey });

  return {
    async generateDraftRaw(request: GeminiDraftRawRequest): Promise<GeminiDraftRawResult> {
      const imageParts = await Promise.all(request.imageUrls.map(async (imageUrl) => await buildImagePart(imageUrl)));

      const response = await client.models.generateContent({
        model: request.model,
        contents: [
          {
            role: 'user',
            parts: [
              { text: request.prompt },
              ...imageParts,
            ],
          },
        ],
      });

      return {
        text: response.text ?? '',
        rawResponse: response,
      };
    },
  };
}
