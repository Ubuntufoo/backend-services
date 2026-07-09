import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_GEMINI_DRAFT_MODEL } from '@/gemini/config.js';
import {
  GeminiDraftServiceError,
  GeminiDraftValidationError,
  generateListingDraft as generateListingDraftImpl,
  prepareGenerateListingDraft,
} from '@/gemini/index.js';

const generateDraftRawMock = vi.hoisted(() => vi.fn());
const getGeminiDraftClientMock = vi.hoisted(() => vi.fn());
const prepareImagePartsMock = vi.hoisted(() => vi.fn());

vi.mock('@/gemini/client.js', () => ({
  getGeminiDraftClient: getGeminiDraftClientMock,
}));

function setGeminiResponse(text: string, rawResponse: unknown = { text }): void {
  generateDraftRawMock.mockResolvedValue({
    text,
    rawResponse,
  });
}

async function generateListingDraft(
  input: Parameters<typeof generateListingDraftImpl>[0]
): Promise<Awaited<ReturnType<typeof generateListingDraftImpl>>> {
  return await generateListingDraftImpl(input, {
    model: DEFAULT_GEMINI_DRAFT_MODEL,
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
    prepareImagePartsMock.mockReset();
    prepareImagePartsMock.mockResolvedValue({
      imageParts: [{ inlineData: { data: 'AQID', mimeType: 'image/jpeg' } }],
      inlineImageBytesApprox: 3,
    });
    getGeminiDraftClientMock.mockReturnValue({
      generateDraftRaw: generateDraftRawMock,
      prepareImageParts: prepareImagePartsMock,
    });

    setGeminiResponse(
      JSON.stringify({
        title: '1991 Upper Deck Michael Jordan',
        description: 'Classic base card with visible wear.',
        categorySuggestion: 'Sports Trading Cards',
        cardConditionNote: 'Visible corner wear and light edge wear.',
        cardConditionToken: 'VERY_GOOD',
        conditionSuggestion: 'Ungraded',
        skuCategoryCode: 'BSKBL',
        aspects: {
          Franchise: 'Utah Jazz',
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

  it('labels image preparation failures as preflight failures', async () => {
    prepareImagePartsMock.mockRejectedValueOnce(new Error('image fetch timed out'));

    await expect(
      generateListingDraft({
        listingId: 'LIST-001',
        imageUrls: ['https://cdn.example.com/listing.jpg'],
      })
    ).rejects.toThrow(
      'Gemini draft preflight failed for listing "LIST-001": image fetch timed out'
    );

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
        cardConditionNote: 'Soft corners visible; condition estimated from photos.',
        cardConditionToken: 'EXCELLENT',
        conditionSuggestion: 'Ungraded',
        skuCategoryCode: 'BSKBL',
        aspects: {
          Franchise: 'Utah Jazz',
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
    expect(prepareImagePartsMock).toHaveBeenCalledWith([
      'https://cdn.example.com/front.jpg',
      'https://cdn.example.com/back.png',
    ]);
    expect(generateDraftRawMock).toHaveBeenCalledWith(
      expect.objectContaining({
        imageParts: [{ inlineData: { data: 'AQID', mimeType: 'image/jpeg' } }],
        model: DEFAULT_GEMINI_DRAFT_MODEL,
      })
    );

    const request = generateDraftRawMock.mock.calls[0]?.[0];
    expect(request.prompt).toContain('Generate an eBay listing draft for a trading card or card lot.');
    expect(request.prompt).toContain('choose the closest supported raw card condition token');
    expect(request.prompt).toContain(
      'Supported raw card condition tokens: NEAR_MINT_OR_BETTER, EXCELLENT, VERY_GOOD, POOR.'
    );
    expect(request.prompt).toContain('Do not return PSA/BGS/SGC-style numeric grades.');
    expect(request.prompt).toContain(
      'Do not return collector shorthand such as NM-MT, EX-MT, VG-EX, MT, NM, EX, VG, FR, or PR.'
    );
    expect(request.prompt).toContain('Include a Franchise aspect when the team, franchise, or IP is identifiable');
    expect(request.prompt).toContain(
      'Emit canonical trading-card pricing aspects whenever visible or strongly inferable'
    );
    expect(request.prompt).toContain(
      'If title includes a card number marker such as "#98", "Card #98", "Card No. 98", or "Card Number 98"'
    );
    expect(request.prompt).toContain('"Year": "string"');
    expect(request.prompt).toContain('"Manufacturer": "string"');
    expect(request.prompt).toContain('"Set": "string"');
    expect(request.prompt).toContain('"Card Number": "string"');
    expect(request.prompt).toContain('"Parallel/Variety": "string"');
    expect(request.prompt).toContain('"Insert Set": "string"');
    expect(request.prompt).toContain('"Franchise": "string"');
    expect(request.prompt).toContain(
      '"cardConditionToken": "NEAR_MINT_OR_BETTER | EXCELLENT | VERY_GOOD | POOR | null"'
    );
    expect(request.prompt).toContain('"skuCategoryCode": "BSKBL | BSBL | OTHER"');
    expect(request.prompt).toContain('Do not generate, infer, or return a full SKU anywhere in the response.');
    expect(request.prompt).toContain('Return strict JSON only with no markdown fences or explanatory prose.');
    expect(request.prompt).toContain('"listingId": "LIST-001"');
    expect(request.prompt).toContain('"https://cdn.example.com/front.jpg"');
    expect(request.prompt).toContain('"title": "string"');

    expect(result).toEqual({
      title: '1986 Fleer Michael Jordan RC',
      description: 'Visible front and back images suggest an ungraded single card.',
      categorySuggestion: 'Sports Trading Cards',
      cardConditionNote: 'Soft corners visible; condition estimated from photos.',
      cardConditionToken: 'EXCELLENT',
      conditionSuggestion: 'Ungraded',
      skuCategoryCode: 'BSKBL',
      aspects: {
        Franchise: 'Utah Jazz',
        Player: 'Michael Jordan',
        Manufacturer: 'Fleer',
        Sport: 'Basketball',
        'Card Manufacturer': 'Fleer',
        Year: '1986-87',
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

  it('produces compact prompt and image diagnostics without exposing raw prompt or image data', async () => {
    const preparedDraft = await prepareGenerateListingDraft({
      listingId: 'LIST-001',
      imageUrls: [
        'https://cdn.example.com/front.jpg',
        'https://cdn.example.com/back.png',
      ],
      userHints: {
        notes: 'Visible edge wear.',
        title: 'Jordan lot',
      },
    });

    expect(preparedDraft.diagnostics.payload).toEqual({
      imageCount: 2,
      inlineImageBytesApprox: 3,
      preparedImagePartCount: 1,
      promptBytes: expect.any(Number),
    });
    expect(preparedDraft.diagnostics.latency.prepareDraftMs).toEqual(expect.any(Number));
    expect(preparedDraft.diagnostics.latency.prepareDraftMs).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(preparedDraft.diagnostics.payload.promptBytes)).toBe(true);
    expect(preparedDraft.diagnostics.payload.promptBytes).toBeGreaterThan(0);
    expect('prompt' in preparedDraft.diagnostics.payload).toBe(false);
    expect('imageParts' in preparedDraft.diagnostics.payload).toBe(false);

    const executionResult = await preparedDraft.execute({
      model: DEFAULT_GEMINI_DRAFT_MODEL,
    });

    expect(executionResult.diagnostics.payload).toEqual(preparedDraft.diagnostics.payload);
    expect(executionResult.diagnostics.latency?.modelMs).toEqual(expect.any(Number));
    expect(executionResult.diagnostics.latency?.parseMs).toEqual(expect.any(Number));
    expect(executionResult.diagnostics.latency?.modelMs).toBeGreaterThanOrEqual(0);
    expect(executionResult.diagnostics.latency?.parseMs).toBeGreaterThanOrEqual(0);
  });

  it('accepts Franchise as a generated aspect value', async () => {
    setGeminiResponse(
      JSON.stringify({
        title: '1993 Finest Karl Malone',
        description: 'Single ungraded card.',
        categorySuggestion: 'Sports Trading Cards',
        cardConditionToken: 'EXCELLENT',
        aspects: {
          Player: 'Karl Malone',
          Franchise: 'Utah Jazz',
        },
      })
    );

    const result = await generateListingDraft({
      listingId: 'LIST-001B',
      imageUrls: ['https://cdn.example.com/front.jpg'],
    });

    expect(result.aspects).toEqual({
      Player: 'Karl Malone',
      Franchise: 'Utah Jazz',
    });
  });

  it('normalizes canonical pricing aspects from aliases and title card number fallback', async () => {
    setGeminiResponse(
      JSON.stringify({
        title: 'Johnny Riddle 1955 Topps #98 St. Louis Cardinals Coach',
        description: 'Vintage single card.',
        aspects: {
          Athlete: 'Johnny Riddle',
          'Card Manufacturer': 'Topps',
          Season: '1955',
          Team: 'St. Louis Cardinals',
        },
        warnings: [],
      })
    );

    const result = await generateListingDraft({
      listingId: 'LIST-013',
      imageUrls: ['https://cdn.example.com/listing.jpg'],
    });

    expect(result.aspects).toMatchObject({
      Athlete: 'Johnny Riddle',
      Player: 'Johnny Riddle',
      'Card Manufacturer': 'Topps',
      Manufacturer: 'Topps',
      Season: '1955',
      Year: '1955',
      'Card Number': '98',
      Team: 'St. Louis Cardinals',
    });
  });

  it('preserves verified details while dropping guessed canonical year data for vintage cards', async () => {
    setGeminiResponse(
      JSON.stringify({
        title: 'Ed Stanky 1952 Topps #191',
        description: 'Vintage single card.',
        aspects: {
          Player: 'Ed Stanky',
          Year: '1952',
          Manufacturer: 'Topps',
          'Card Number': '191',
        },
        yearEvidence: {
          isVerified: false,
          likelyYear: '1955',
          likelyYearRange: '1952-1955',
          warningCode: 'year_unverified',
        },
        warnings: ['Year not visible on the card.'],
      })
    );

    const result = await generateListingDraft({
      listingId: 'LIST-VINTAGE-001',
      imageUrls: ['https://cdn.example.com/listing.jpg'],
    });

    expect(result.aspects).toEqual({
      Player: 'Ed Stanky',
      Manufacturer: 'Topps',
      'Card Number': '191',
    });
    expect(result.title).toBe('Ed Stanky Topps #191');
    expect(result.yearEvidence).toEqual({
      isVerified: false,
      likelyYear: '1955',
      likelyYearRange: '1952-1955',
      warningCode: 'year_unverified',
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
      cardConditionNote: null,
      cardConditionToken: null,
      conditionSuggestion: null,
      skuCategoryCode: 'OTHER',
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

  it('converts invalid cardConditionToken to null', async () => {
    setGeminiResponse(
      JSON.stringify({
        title: 'Card lot',
        description: 'Description',
        aspects: {},
        cardConditionToken: 'EX-MT',
      })
    );

    const result = await generateListingDraft({
      listingId: 'LIST-005A',
      imageUrls: ['https://cdn.example.com/listing.jpg'],
    });

    expect(result.cardConditionToken).toBeNull();
    expect(result.warnings).toContain(
      'Gemini response field "cardConditionToken" was invalid and was reset to null.'
    );
  });

  it('normalizes lowercase and whitespace skuCategoryCode', async () => {
    setGeminiResponse(
      JSON.stringify({
        title: 'Basketball card',
        description: 'Description',
        aspects: {},
        skuCategoryCode: ' bskbl ',
      })
    );

    const result = await generateListingDraft({
      listingId: 'LIST-005AA',
      imageUrls: ['https://cdn.example.com/listing.jpg'],
    });

    expect(result.skuCategoryCode).toBe('BSKBL');
  });

  it('defaults missing skuCategoryCode to OTHER', async () => {
    setGeminiResponse(
      JSON.stringify({
        title: 'Unknown card lot',
        description: 'Description',
        aspects: {},
      })
    );

    const result = await generateListingDraft({
      listingId: 'LIST-005AB',
      imageUrls: ['https://cdn.example.com/listing.jpg'],
    });

    expect(result.skuCategoryCode).toBe('OTHER');
  });

  it('defaults invalid or full-SKU skuCategoryCode values to OTHER', async () => {
    for (const invalidValue of ['Basketball', 'NBA', 'MLB', 'TCG', 'Pokemon', 'BSKBL-Single-000001']) {
      setGeminiResponse(
        JSON.stringify({
          title: 'Unknown card lot',
          description: 'Description',
          aspects: {},
          skuCategoryCode: invalidValue,
        })
      );

      const result = await generateListingDraft({
        listingId: `LIST-${invalidValue}`,
        imageUrls: ['https://cdn.example.com/listing.jpg'],
      });

      expect(result.skuCategoryCode).toBe('OTHER');
      expect(result.warnings).toContain(
        'Gemini response field "skuCategoryCode" was invalid and defaulted to OTHER.'
      );
    }
  });

  it('accepts supported cardConditionToken values only from the new scale', async () => {
    setGeminiResponse(
      JSON.stringify({
        title: 'Card lot',
        description: 'Description',
        aspects: {},
        cardConditionToken: 'POOR',
      })
    );

    const result = await generateListingDraft({
      listingId: 'LIST-005B',
      imageUrls: ['https://cdn.example.com/listing.jpg'],
    });

    expect(result.cardConditionToken).toBe('POOR');
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

  it('uses the provided Gemini model option', async () => {
    await generateListingDraftImpl(
      {
        listingId: 'LIST-011',
        imageUrls: ['https://cdn.example.com/listing.jpg'],
      },
      { model: 'gemini-3-pro-preview' }
    );

    expect(generateDraftRawMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-3-pro-preview',
      })
    );
  });

  it('preserves provider root-cause text in Gemini draft service errors', async () => {
    generateDraftRawMock.mockRejectedValueOnce(
      new Error('INVALID_ARGUMENT: unsupported file_data URI')
    );

    await expect(
      generateListingDraft({
        listingId: 'LIST-012',
        imageUrls: ['https://cdn.example.com/listing.jpg'],
      })
    ).rejects.toThrow(
      'Gemini draft generation failed for listing "LIST-012": INVALID_ARGUMENT: unsupported file_data URI'
    );
  });
});
