import { GoogleGenAI, createPartFromUri, type Part } from '@google/genai';
import { GeminiDraftServiceError } from './contracts.js';

const HTTP_IMAGE_FETCH_TIMEOUT_MS = 12_000;
const HTTP_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

export interface GeminiDraftProviderRequest {
  model: string;
  imageParts: Part[];
  prompt: string;
}

export interface GeminiDraftRawResult {
  text: string;
  rawResponse: unknown;
}

export interface PreparedImagePartsResult {
  imageParts: Part[];
  inlineImageBytesApprox: number;
}

export interface GeminiDraftClient {
  prepareImageParts(imageUrls: string[]): Promise<PreparedImagePartsResult>;
  generateDraftRaw(request: GeminiDraftProviderRequest): Promise<GeminiDraftRawResult>;
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

function formatImageUrlError(imageUrl: string, message: string): GeminiDraftServiceError {
  return new GeminiDraftServiceError(`Image URL "${sanitizeImageUrl(imageUrl)}": ${message}`);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

async function buildImagePartFromHttpUrl(imageUrl: string): Promise<Part> {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), HTTP_IMAGE_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(imageUrl, {
      signal: controller.signal,
    });

    const contentLength = response.headers.get('content-length');

    if (contentLength) {
      const declaredSize = Number.parseInt(contentLength, 10);

      if (Number.isFinite(declaredSize) && declaredSize > HTTP_IMAGE_MAX_BYTES) {
        throw formatImageUrlError(
          imageUrl,
          `is ${declaredSize} bytes and exceeds the 10 MB limit.`
        );
      }
    }

    if (!response.ok) {
      throw formatImageUrlError(
        imageUrl,
        `returned HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}.`
      );
    }

    const responseMimeType = parseMimeTypeHeader(response.headers.get('content-type'));

    if (responseMimeType && !isImageMimeType(responseMimeType)) {
      throw formatImageUrlError(
        imageUrl,
        `returned non-image content type "${responseMimeType}".`
      );
    }

    const mimeType = responseMimeType ?? inferMimeTypeFromUrl(imageUrl);

    if (!mimeType) {
      throw formatImageUrlError(
        imageUrl,
        'did not provide an image Content-Type header and its MIME type could not be inferred.'
      );
    }

    const bytes = Buffer.from(await response.arrayBuffer());

    if (bytes.length === 0) {
      throw formatImageUrlError(imageUrl, 'returned an empty response body.');
    }

    if (bytes.length > HTTP_IMAGE_MAX_BYTES) {
      throw formatImageUrlError(
        imageUrl,
        `returned ${bytes.length} bytes and exceeds the 10 MB limit.`
      );
    }

    return {
      inlineData: {
        data: bytes.toString('base64'),
        mimeType,
      },
    };
  } catch (error) {
    if (controller.signal.aborted || isAbortError(error)) {
      throw formatImageUrlError(
        imageUrl,
        `timed out after ${HTTP_IMAGE_FETCH_TIMEOUT_MS / 1000} seconds.`
      );
    }

    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
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

function getInlineImageBytesApprox(imagePart: Part): number {
  const inlineData = 'inlineData' in imagePart ? imagePart.inlineData : undefined;

  if (!inlineData?.data) {
    return 0;
  }

  return Buffer.from(inlineData.data, 'base64').length;
}

async function prepareImageParts(imageUrls: string[]): Promise<PreparedImagePartsResult> {
  const imageParts = await Promise.all(imageUrls.map(async (imageUrl) => await buildImagePart(imageUrl)));

  return {
    imageParts,
    inlineImageBytesApprox: imageParts.reduce(
      (totalBytes, imagePart) => totalBytes + getInlineImageBytesApprox(imagePart),
      0
    ),
  };
}

export function getGeminiDraftClient(apiKey: string): GeminiDraftClient {
  const client = new GoogleGenAI({ apiKey });

  return {
    prepareImageParts: async (imageUrls) => await prepareImageParts(imageUrls),
    async generateDraftRaw(request: GeminiDraftProviderRequest): Promise<GeminiDraftRawResult> {
      const response = await client.models.generateContent({
        model: request.model,
        contents: [
          {
            role: 'user',
            parts: [
              { text: request.prompt },
              ...request.imageParts,
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
