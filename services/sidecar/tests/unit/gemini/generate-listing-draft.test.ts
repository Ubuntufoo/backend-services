import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_GEMINI_DRAFT_MODEL } from '@/gemini/config.js';
import {
  GeminiDraftServiceError,
  GeminiDraftValidationError,
  generateListingDraft,
} from '@/gemini/index.js';

const generateDraftRawMock = vi.hoisted(() => vi.fn());
const getGeminiDraftClientMock = vi.hoisted(() => vi.fn());

vi.mock('@/gemini/client.js', () => ({
  getGeminiDraftClient: getGeminiDraftClientMock,
}));

describe('generateListingDraft', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      GEMINI_API_KEY: 'gemini-api-key',
    };
    generateDraftRawMock.mockReset();
    getGeminiDraftClientMock.mockReset();
    getGeminiDraftClientMock.mockReturnValue({
      generateDraftRaw: generateDraftRawMock,
    });
    generateDraftRawMock.mockResolvedValue({
      text: '{"title":"1991 Upper Deck Michael Jordan"}',
      rawResponse: {
        text: '{"title":"1991 Upper Deck Michael Jordan"}',
      },
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  it('rejects missing or empty listingId', async () => {
    await expect(
      generateListingDraft({
        imageUrls: ['https://cdn.example.com/listing.jpg'],
      } as never)
    ).rejects.toBeInstanceOf(GeminiDraftValidationError);

    await expect(
      generateListingDraft({
        listingId: '   ',
        imageUrls: ['https://cdn.example.com/listing.jpg'],
      })
    ).rejects.toThrow('listingId');
  });

  it('rejects missing or empty imageUrls', async () => {
    await expect(
      generateListingDraft({
        listingId: 'LIST-001',
      } as never)
    ).rejects.toThrow('imageUrls is required');

    await expect(
      generateListingDraft({
        listingId: 'LIST-001',
        imageUrls: [],
      })
    ).rejects.toThrow('imageUrls must contain at least one image URL');
  });

  it('rejects non-string or empty imageUrls entries', async () => {
    await expect(
      generateListingDraft({
        listingId: 'LIST-001',
        imageUrls: [42 as never],
      })
    ).rejects.toThrow('imageUrls.0');

    await expect(
      generateListingDraft({
        listingId: 'LIST-001',
        imageUrls: [''],
      })
    ).rejects.toThrow('imageUrls entries must be non-empty strings');
  });

  it('fails clearly when the Gemini API key is missing', async () => {
    delete process.env.GEMINI_API_KEY;

    await expect(
      generateListingDraft({
        listingId: 'LIST-001',
        imageUrls: ['https://cdn.example.com/listing.jpg'],
      })
    ).rejects.toBeInstanceOf(GeminiDraftServiceError);

    await expect(
      generateListingDraft({
        listingId: 'LIST-001',
        imageUrls: ['https://cdn.example.com/listing.jpg'],
      })
    ).rejects.toThrow('GEMINI_API_KEY');

    expect(getGeminiDraftClientMock).not.toHaveBeenCalled();
    expect(generateDraftRawMock).not.toHaveBeenCalled();
  });

  it('sends listing context into the Gemini request and preserves raw model output', async () => {
    const rawResponse = {
      text: '{"title":"1986 Fleer Michael Jordan RC"}',
      candidates: [{ id: 'candidate-1' }],
    };
    generateDraftRawMock.mockResolvedValue({
      text: rawResponse.text,
      rawResponse,
    });

    const result = await generateListingDraft({
      listingId: 'LIST-001',
      imageUrls: [
        'https://cdn.example.com/front.jpg',
        'https://cdn.example.com/back.png',
      ],
      userHints: {
        title: 'Jordan rookie maybe',
        notes: 'Check centering and corners',
        category: 'Sports Trading Cards',
        aspects: {
          Athlete: 'Michael Jordan',
          Features: ['Rookie Card'],
        },
        price: 4999.99,
      },
    });

    expect(getGeminiDraftClientMock).toHaveBeenCalledWith('gemini-api-key');
    expect(generateDraftRawMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: DEFAULT_GEMINI_DRAFT_MODEL,
        listingId: 'LIST-001',
        imageUrls: [
          'https://cdn.example.com/front.jpg',
          'https://cdn.example.com/back.png',
        ],
        userHints: {
          title: 'Jordan rookie maybe',
          notes: 'Check centering and corners',
          category: 'Sports Trading Cards',
          aspects: {
            Athlete: 'Michael Jordan',
            Features: ['Rookie Card'],
          },
          price: 4999.99,
        },
      })
    );

    const request = generateDraftRawMock.mock.calls[0]?.[0];
    expect(request.prompt).toContain('Generate an eBay listing draft for a trading card or card lot.');
    expect(request.prompt).toContain('Use visible image evidence first.');
    expect(request.prompt).toContain('"listingId": "LIST-001"');
    expect(request.prompt).toContain('"https://cdn.example.com/front.jpg"');
    expect(request.prompt).toContain('"title": "Jordan rookie maybe"');

    expect(result).toEqual({
      title: '',
      description: '',
      categorySuggestion: null,
      conditionSuggestion: null,
      aspects: {},
      priceSuggestion: null,
      confidence: {},
      warnings: ['Gemini raw response received; structured parsing is not implemented yet.'],
      rawModelResponse: rawResponse,
    });
  });

  it('uses a configured Gemini model when GEMINI_MODEL is set', async () => {
    process.env.GEMINI_MODEL = 'gemini-3-pro-preview';

    await generateListingDraft({
      listingId: 'LIST-002',
      imageUrls: ['https://cdn.example.com/listing.jpg'],
    });

    expect(generateDraftRawMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-3-pro-preview',
      })
    );
  });
});
