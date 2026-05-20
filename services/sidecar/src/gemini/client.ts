import { GoogleGenAI, createPartFromUri } from '@google/genai';
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

function inferMimeType(imageUrl: string): string {
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

  return 'image/jpeg';
}

export function getGeminiDraftClient(apiKey: string): GeminiDraftClient {
  const client = new GoogleGenAI({ apiKey });

  return {
    async generateDraftRaw(request: GeminiDraftRawRequest): Promise<GeminiDraftRawResult> {
      const response = await client.models.generateContent({
        model: request.model,
        contents: [
          {
            role: 'user',
            parts: [
              { text: request.prompt },
              ...request.imageUrls.map((imageUrl) =>
                createPartFromUri(imageUrl, inferMimeType(imageUrl))
              ),
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
