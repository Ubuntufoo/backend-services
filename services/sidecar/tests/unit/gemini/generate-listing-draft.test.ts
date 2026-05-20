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

function setGeminiResponse(text: string, rawResponse: unknown = { text }): void {
  generateDraftRawMock.mockResolvedValue({
    text,
    rawResponse,
  });
}

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

    setGeminiResponse(
      JSON.stringify({
        title: '1991 Upper Deck Michael Jordan',
        description: 'Classic base card with visible wear.',
        categorySuggestion: 'Sports Trading Cards',
        conditionSuggestion: 'Ungraded',
        aspects: {
          Player: 'Michael Jordan',
        },
        priceSuggestion: 149.99,
        confidence: {
          title: 0.9,
        },
        warnings: ['Corners show wear.'],
      })
    );
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

  it('parses a valid raw JSON response into GeneratedListingDraft', async () => {
    const rawResponse = {
      text: '{"title":"1986 Fleer Michael Jordan RC"}',
      candidates: [{ id: 'candidate-1' }],
    };
    setGeminiResponse(
      JSON.stringify({
        title: '1986 Fleer Michael Jordan RC',
        description: 'Visible front and back images suggest an ungraded single card.',
        categorySuggestion: 'Sports Trading Cards',
        conditionSuggestion: 'Ungraded',
        aspects: {
          Player: 'Michael Jordan',
          Sport: 'Basketball',
          'Card Manufacturer': 'Fleer',
          Season: '1986-87',
        },
        priceSuggestion: 12500,
        confidence: {
          title: 0.96,
          category: 0.88,
          price: 0.52,
          aspects: 0.84,
        },
        warnings: ['Condition cannot be confirmed from photos alone.'],
      }),
      rawResponse
    );

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
    expect(request.prompt).toContain('Return strict JSON only with no markdown fences or explanatory prose.');
    expect(request.prompt).toContain('"listingId": "LIST-001"');
    expect(request.prompt).toContain('"https://cdn.example.com/front.jpg"');
    expect(request.prompt).toContain('"title": "string"');

    expect(result).toEqual({
      title: '1986 Fleer Michael Jordan RC',
      description: 'Visible front and back images suggest an ungraded single card.',
      categorySuggestion: 'Sports Trading Cards',
      conditionSuggestion: 'Ungraded',
      aspects: {
        Player: 'Michael Jordan',
        Sport: 'Basketball',
        'Card Manufacturer': 'Fleer',
        Season: '1986-87',
      },
      priceSuggestion: 12500,
      confidence: {
        title: 0.96,
        category: 0.88,
        price: 0.52,
        aspects: 0.84,
      },
      warnings: ['Condition cannot be confirmed from photos alone.'],
      rawModelResponse: rawResponse,
    });
  });

  it('parses JSON wrapped in a json code fence', async () => {
    setGeminiResponse(`\`\`\`json
{
  "title": "1989 Upper Deck Ken Griffey Jr.",
  "description": "Single card listing.",
  "aspects": {
    "Player": "Ken Griffey Jr."
  },
  "warnings": []
}
\`\`\``);

    const result = await generateListingDraft({
      listingId: 'LIST-002',
      imageUrls: ['https://cdn.example.com/listing.jpg'],
    });

    expect(result.title).toBe('1989 Upper Deck Ken Griffey Jr.');
    expect(result.description).toBe('Single card listing.');
    expect(result.aspects).toEqual({
      Player: 'Ken Griffey Jr.',
    });
  });

  it('parses JSON wrapped in a generic code fence', async () => {
    setGeminiResponse(`\`\`\`
{
  "title": "Pokemon lot",
  "description": "Mixed lot of cards.",
  "aspects": {},
  "warnings": []
}
\`\`\``);

    const result = await generateListingDraft({
      listingId: 'LIST-003',
      imageUrls: ['https://cdn.example.com/listing.jpg'],
    });

    expect(result.title).toBe('Pokemon lot');
    expect(result.description).toBe('Mixed lot of cards.');
  });

  it('normalizes missing optional fields to safe defaults', async () => {
    setGeminiResponse(
      JSON.stringify({
        title: 'Baseball card lot',
        description: 'Lot listing with multiple visible cards.',
        aspects: {
          Sport: 'Baseball',
        },
      })
    );

    const result = await generateListingDraft({
      listingId: 'LIST-004',
      imageUrls: ['https://cdn.example.com/listing.jpg'],
    });

    expect(result).toEqual({
      title: 'Baseball card lot',
      description: 'Lot listing with multiple visible cards.',
      categorySuggestion: null,
      conditionSuggestion: null,
      aspects: {
        Sport: 'Baseball',
      },
      priceSuggestion: null,
      confidence: {},
      warnings: [],
      rawModelResponse: {
        text: JSON.stringify({
          title: 'Baseball card lot',
          description: 'Lot listing with multiple visible cards.',
          aspects: {
            Sport: 'Baseball',
          },
        }),
      },
    });
  });

  it('converts invalid priceSuggestion to null', async () => {
    setGeminiResponse(
      JSON.stringify({
        title: 'Card lot',
        description: 'Description',
        aspects: {},
        priceSuggestion: 'not-a-number',
      })
    );

    const result = await generateListingDraft({
      listingId: 'LIST-005',
      imageUrls: ['https://cdn.example.com/listing.jpg'],
    });

    expect(result.priceSuggestion).toBeNull();
    expect(result.warnings).toContain(
      'Gemini response field "priceSuggestion" was invalid and was reset to null.'
    );
  });

  it('drops invalid confidence values outside 0 to 1', async () => {
    setGeminiResponse(
      JSON.stringify({
        title: 'Card lot',
        description: 'Description',
        aspects: {},
        confidence: {
          title: 1.2,
          category: -0.1,
          price: 0.4,
          aspects: 'high',
        },
      })
    );

    const result = await generateListingDraft({
      listingId: 'LIST-006',
      imageUrls: ['https://cdn.example.com/listing.jpg'],
    });

    expect(result.confidence).toEqual({
      price: 0.4,
    });
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        'Gemini response field "confidence.title" was invalid and was discarded.',
        'Gemini response field "confidence.category" was invalid and was discarded.',
        'Gemini response field "confidence.aspects" was invalid and was discarded.',
      ])
    );
  });

  it('drops invalid aspect values and filters non-string array entries', async () => {
    setGeminiResponse(
      JSON.stringify({
        title: 'Card lot',
        description: 'Description',
        aspects: {
          Player: 'Michael Jordan',
          Teams: ['Bulls', 23, 'USA Basketball'],
          Grade: 9,
          EmptyList: [12, false],
        },
      })
    );

    const result = await generateListingDraft({
      listingId: 'LIST-007',
      imageUrls: ['https://cdn.example.com/listing.jpg'],
    });

    expect(result.aspects).toEqual({
      Player: 'Michael Jordan',
      Teams: ['Bulls', 'USA Basketball'],
    });
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        'Gemini response aspect "Teams" contained invalid values and was filtered.',
        'Gemini response aspect "Grade" was invalid and was discarded.',
        'Gemini response aspect "EmptyList" contained invalid values and was filtered.',
      ])
    );
  });

  it('converts missing or invalid warnings to a safe empty array', async () => {
    setGeminiResponse(
      JSON.stringify({
        title: 'Card lot',
        description: 'Description',
        aspects: {},
        warnings: 'not-an-array',
      })
    );

    const result = await generateListingDraft({
      listingId: 'LIST-008',
      imageUrls: ['https://cdn.example.com/listing.jpg'],
    });

    expect(result.warnings).toEqual([]);
  });

  it('adds service warnings when key fields are defaulted or invalid values are discarded', async () => {
    setGeminiResponse(
      JSON.stringify({
        aspects: {
          Year: ['1990', 1991],
        },
        confidence: {
          title: 2,
        },
        priceSuggestion: 'not-a-number',
      })
    );

    const result = await generateListingDraft({
      listingId: 'LIST-009',
      imageUrls: ['https://cdn.example.com/listing.jpg'],
    });

    expect(result.title).toBe('');
    expect(result.description).toBe('');
    expect(result.aspects).toEqual({
      Year: ['1990'],
    });
    expect(result.priceSuggestion).toBeNull();
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        'Gemini response field "title" was missing or invalid; defaulted to an empty string.',
        'Gemini response field "description" was missing or invalid; defaulted to an empty string.',
        'Gemini response aspect "Year" contained invalid values and was filtered.',
        'Gemini response field "confidence.title" was invalid and was discarded.',
        'Gemini response field "priceSuggestion" was invalid and was reset to null.',
      ])
    );
  });

  it('rejects invalid JSON with a clear service error', async () => {
    setGeminiResponse('{ "title": "broken" ');

    await expect(
      generateListingDraft({
        listingId: 'LIST-010',
        imageUrls: ['https://cdn.example.com/listing.jpg'],
      })
    ).rejects.toBeInstanceOf(GeminiDraftServiceError);

    await expect(
      generateListingDraft({
        listingId: 'LIST-010',
        imageUrls: ['https://cdn.example.com/listing.jpg'],
      })
    ).rejects.toThrow('invalid JSON');
  });

  it('rejects non-object JSON with a clear service error', async () => {
    setGeminiResponse(JSON.stringify(['not', 'an', 'object']));

    await expect(
      generateListingDraft({
        listingId: 'LIST-010A',
        imageUrls: ['https://cdn.example.com/listing.jpg'],
      })
    ).rejects.toBeInstanceOf(GeminiDraftServiceError);

    await expect(
      generateListingDraft({
        listingId: 'LIST-010A',
        imageUrls: ['https://cdn.example.com/listing.jpg'],
      })
    ).rejects.toThrow('not an object');
  });

  it('uses a configured Gemini model when GEMINI_MODEL is set', async () => {
    process.env.GEMINI_MODEL = 'gemini-3-pro-preview';

    await generateListingDraft({
      listingId: 'LIST-011',
      imageUrls: ['https://cdn.example.com/listing.jpg'],
    });

    expect(generateDraftRawMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-3-pro-preview',
      })
    );
  });
});
