import { describe, expect, it, vi } from 'vitest';
import type { GeminiDraftClient } from '../../../src/gemini/client.js';
import {
  buildVariationListingIdentityPrompt,
  generateVariationListingIdentity,
  parseVariationListingIdentityResponse,
  toVariationListingNewVariationIdentityHandoff,
  type GenerateVariationListingIdentityInput,
} from '../../../src/gemini/index.js';

const input: GenerateVariationListingIdentityInput = {
  variationId: '22222222-2222-4222-8222-222222222222',
  imageUrls: ['https://images.test/front.jpg', 'https://images.test/back.jpg'],
  sourceRefs: {
    front: '/incoming/front.jpg',
    back: '/incoming/back.jpg',
  },
};

const modelResponse = {
  facts: {
    sport: { value: 'Basketball', imageIndex: 0, visibleEvidence: 'Basketball design and NBA text' },
    playerAthlete: { value: 'Marcus Camby', imageIndex: 0, visibleEvidence: 'MARCUS CAMBY printed on front' },
    team: { value: 'Toronto Raptors', imageIndex: 0, visibleEvidence: 'Raptors wordmark visible' },
    manufacturer: { value: 'Skybox', imageIndex: 1, visibleEvidence: 'Skybox logo on back' },
    set: { value: 'Metal Universe', imageIndex: 1, visibleEvidence: 'METAL UNIVERSE printed on back' },
    cardNumber: { value: '#6', imageIndex: 1, visibleEvidence: 'No. 6 printed on back' },
    insertSet: { value: 'Planet Metal', imageIndex: 0, visibleEvidence: 'Planet Metal printed on front' },
    features: [
      { value: 'Insert', imageIndex: 0, visibleEvidence: 'Planet Metal insert name visible' },
    ],
  },
  seasonEvidence: {
    season: '1997-1998',
    visibleText: '1997-98 SKYBOX METAL UNIVERSE',
    imageIndex: 1,
  },
  yearEvidence: null,
  serialEvidence: null,
  reviewNotes: ['Player and insert identity are clear.'],
  warnings: [],
};

describe('variation-listing Gemini identity', () => {
  it('parses proven identity and builds a deterministic backend selector', () => {
    const result = parseVariationListingIdentityResponse(
      JSON.stringify(modelResponse),
      { provider: 'fixture' },
      input
    );

    expect(result.selectorValue).toBe(
      '1997-98 Metal Universe Planet Metal Marcus Camby #6 Toronto Raptors'
    );
    expect(result.identity).toMatchObject({
      cardNumber: '6',
      playerAthlete: 'Marcus Camby',
      season: '1997-98',
      set: 'Metal Universe',
      team: 'Toronto Raptors',
    });
    expect(result.sourceImages).toEqual({
      front: {
        imageUrl: 'https://images.test/front.jpg',
        sourceRef: '/incoming/front.jpg',
        imageIndex: 0,
      },
      back: {
        imageUrl: 'https://images.test/back.jpg',
        sourceRef: '/incoming/back.jpg',
        imageIndex: 1,
      },
    });
    expect(result.variationMetadata).toMatchObject({
      'Card Number': '6',
      'Insert Set': 'Planet Metal',
      'Player/Athlete': 'Marcus Camby',
      Season: '1997-98',
      Set: 'Metal Universe',
      Team: 'Toronto Raptors',
    });
    expect(result.variationMetadata).not.toHaveProperty('priceSuggestion');
    expect(result.variationMetadata).not.toHaveProperty('Autographed');
  });

  it('uses explicit operator year without accepting model yearEvidence', () => {
    const explicitInput = { ...input, userHints: { explicitYear: '1953' } };
    const response = {
      ...modelResponse,
      seasonEvidence: null,
      yearEvidence: {
        year: '1954',
        sourceType: 'copyright_line',
        visibleText: '© 1954',
        imageIndex: 1,
      },
    };
    const result = parseVariationListingIdentityResponse(
      JSON.stringify(response),
      undefined,
      explicitInput
    );
    expect(result.identity.year).toBe('1953');
    expect(result.evidence).not.toHaveProperty('yearEvidence');
    expect(result.warnings).toContain(
      'Gemini visible yearEvidence was ignored because explicitYear is canonical.'
    );
  });

  it('derives serial print run only from one exact visible fraction', () => {
    const response = {
      ...modelResponse,
      serialEvidence: {
        visibleText: '037/199',
        imageIndex: 1,
        numerator: 37,
        denominator: 199,
      },
    };
    const result = parseVariationListingIdentityResponse(JSON.stringify(response), undefined, input);
    expect(result.identity).toMatchObject({ printRun: 199, serialNumber: '037/199' });
    expect(result.identity.features).toContain('Serial Numbered');
    expect(result.selectorValue).toContain('037/199');
    expect(result.variationMetadata).toMatchObject({
      'Serial Number': '037/199',
      'Print Run': 199,
    });
  });

  it('normalizes identity text to NFC while preserving card-number token spelling', () => {
    const decomposed = {
      ...modelResponse,
      seasonEvidence: null,
      facts: {
        ...modelResponse.facts,
        playerAthlete: {
          value: 'Cafe\u0301 Runner',
          imageIndex: 0,
          visibleEvidence: 'Cafe\u0301 Runner printed on front',
        },
        cardNumber: {
          value: 'Card Number 0007',
          imageIndex: 1,
          visibleEvidence: 'Card Number 0007 printed on back',
        },
      },
    };
    const composed = {
      ...decomposed,
      facts: {
        ...decomposed.facts,
        playerAthlete: {
          ...decomposed.facts.playerAthlete,
          value: 'Café Runner',
          visibleEvidence: 'Café Runner printed on front',
        },
      },
    };
    const first = parseVariationListingIdentityResponse(JSON.stringify(decomposed), undefined, input);
    const second = parseVariationListingIdentityResponse(JSON.stringify(composed), undefined, input);
    expect(first.identity.playerAthlete).toBe('Café Runner');
    expect(first.identity.cardNumber).toBe('0007');
    expect(first.selectorValue).toBe(second.selectorValue);
  });

  it.each([
    ['#0008', '0008'],
    ['No. 0008', '0008'],
    ['Card # 0008', '0008'],
    ['Card No. 0008', '0008'],
    ['Card Number 0008', '0008'],
    ['RC-01', 'RC-01'],
    ['SP/10', 'SP/10'],
    ['1.2', '1.2'],
  ])('normalizes card-number form %s to %s', (value, expected) => {
    const response = {
      ...modelResponse,
      facts: {
        ...modelResponse.facts,
        cardNumber: {
          value,
          imageIndex: 1,
          visibleEvidence: `${value} printed on back`,
        },
      },
    };
    const result = parseVariationListingIdentityResponse(JSON.stringify(response), undefined, input);
    expect(result.identity.cardNumber).toBe(expected);
  });

  it('rejects malformed, free-form, or range-like card numbers', () => {
    const response = {
      ...modelResponse,
      facts: {
        ...modelResponse.facts,
        cardNumber: {
          value: 'Card Number 6 of 25',
          imageIndex: 1,
          visibleEvidence: 'Card Number 6 of 25 printed on back',
        },
      },
    };
    expect(() =>
      parseVariationListingIdentityResponse(JSON.stringify(response), undefined, input)
    ).toThrow(/cardNumber is malformed/);
  });

  it('requires a card-distinguishing component in addition to normalized selector components', () => {
    const response = {
      facts: {
        manufacturer: { value: 'Topps', imageIndex: 0, visibleEvidence: 'Topps visible' },
        set: { value: 'Base Set', imageIndex: 1, visibleEvidence: 'Base Set visible' },
      },
      yearEvidence: null,
      seasonEvidence: null,
      serialEvidence: null,
      reviewNotes: [],
      warnings: [],
    };
    expect(() =>
      parseVariationListingIdentityResponse(JSON.stringify(response), undefined, input)
    ).toThrow(/card-distinguishing|enough proven components/);
  });

  it('rejects duplicate or outer-whitespace source identity values', () => {
    expect(() =>
      parseVariationListingIdentityResponse(JSON.stringify(modelResponse), undefined, {
        ...input,
        imageUrls: [input.imageUrls[0], input.imageUrls[0]],
      })
    ).toThrow();
    expect(() =>
      parseVariationListingIdentityResponse(JSON.stringify(modelResponse), undefined, {
        ...input,
        sourceRefs: { front: input.sourceRefs.front, back: input.sourceRefs.front },
      })
    ).toThrow();
    expect(() =>
      parseVariationListingIdentityResponse(JSON.stringify(modelResponse), undefined, {
        ...input,
        sourceRefs: { ...input.sourceRefs, front: ` ${input.sourceRefs.front}` },
      })
    ).toThrow();
  });

  it('requires source-specific year evidence and rejects season-only year claims', () => {
    const seasonOnly = {
      ...modelResponse,
      seasonEvidence: null,
      yearEvidence: {
        year: '1997',
        sourceType: 'copyright_line',
        visibleText: '1997-98 SKYBOX METAL UNIVERSE',
        imageIndex: 1,
      },
    };
    expect(() =>
      parseVariationListingIdentityResponse(JSON.stringify(seasonOnly), undefined, input)
    ).toThrow(/yearEvidence/);

    const accepted = {
      ...seasonOnly,
      yearEvidence: {
        year: '1997',
        sourceType: 'copyright_line',
        visibleText: '© 1997 Skybox',
        imageIndex: 1,
      },
    };
    const result = parseVariationListingIdentityResponse(JSON.stringify(accepted), undefined, input);
    expect(result.identity.year).toBe('1997');
  });

  it('rejects malformed or unsupported model keys instead of widening the contract', () => {
    const response = {
      ...modelResponse,
      priceSuggestion: 9.99,
      facts: {
        ...modelResponse.facts,
        Autographed: { value: 'Yes', imageIndex: 0, visibleEvidence: 'signature visible' },
      },
    };
    expect(() =>
      parseVariationListingIdentityResponse(JSON.stringify(response), undefined, input)
    ).toThrow();
  });

  it('rejects unsafe selector construction when identity evidence is too sparse', () => {
    const response = {
      facts: {
        playerAthlete: {
          value: 'Unknown Player',
          imageIndex: 0,
          visibleEvidence: 'name visible',
        },
      },
      yearEvidence: null,
      seasonEvidence: null,
      serialEvidence: null,
      reviewNotes: [],
      warnings: ['Set and card number are unreadable.'],
    };
    expect(() =>
      parseVariationListingIdentityResponse(JSON.stringify(response), undefined, input)
    ).toThrow(/enough proven components/);
  });

  it('includes proven Rookie Card and Refractor features in selector identity', () => {
    const response = {
      ...modelResponse,
      facts: {
        ...modelResponse.facts,
        insertSet: null,
        features: [
          { value: 'Rookie Card', imageIndex: 0, visibleEvidence: 'RC mark visible' },
          { value: 'Refractor', imageIndex: 0, visibleEvidence: 'REFRACTOR text visible' },
        ],
      },
    };
    const result = parseVariationListingIdentityResponse(JSON.stringify(response), undefined, input);
    expect(result.selectorValue).toContain('Rookie Card Refractor');
  });

  it('generates through the existing Gemini client seam without pricing/provider side paths', async () => {
    const client: GeminiDraftClient = {
      prepareImageParts: vi.fn(async () => ({
        imageParts: [{ text: 'front' }, { text: 'back' }],
        inlineImageBytesApprox: 0,
      })),
      generateDraftRaw: vi.fn(async () => ({
        text: JSON.stringify(modelResponse),
        rawResponse: { fixture: true },
      })),
    };

    const result = await generateVariationListingIdentity(
      input,
      { model: 'gemini-test' },
      {
        getClient: () => client,
        loadConfig: () => ({ apiKey: 'test-key' }),
      }
    );

    expect(client.prepareImageParts).toHaveBeenCalledWith(input.imageUrls);
    expect(client.generateDraftRaw).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gemini-test' })
    );
    expect(result.selectorValue).toContain('Marcus Camby');
    expect(toVariationListingNewVariationIdentityHandoff(result)).toEqual({
      selectorValue: result.selectorValue,
      variationMetadata: result.variationMetadata,
    });
  });
});

describe('variation-listing Gemini identity prompt', () => {
  it('forbids pricing, autograph inference, selector authorship, and unsupported knowledge', () => {
    const prompt = buildVariationListingIdentityPrompt(input);
    expect(prompt).toContain('Do not return priceSuggestion');
    expect(prompt).toContain('Never return Autographed');
    expect(prompt).toContain('Backend code constructs the selector deterministically');
    expect(prompt).toContain('Never guess a year');
    expect(prompt).toContain('Image index 0 is the FRONT. Image index 1 is the BACK.');
    expect(prompt).toContain('"manufacturer": {"value":"string","imageIndex":0 | 1');
    expect(prompt).toContain('"yearEvidence": {"year":"YYYY"');
    expect(prompt).toContain('"imageIndex":0 | 1');
    expect(prompt).not.toContain('"imageIndex":1,"visibleEvidence"');
    expect(prompt).not.toContain('SoldComps');
  });
});
