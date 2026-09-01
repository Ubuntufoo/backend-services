import { describe, expect, it, vi } from 'vitest';
import type { VariationListingAggregateSnapshot } from '@ebay-inventory/data';
import type { GeminiDraftClient } from '../../../src/gemini/client.js';
import {
  buildVariationListingGroupReviewInputFromAggregate,
  buildVariationListingGroupReviewPrompt,
  deriveVariationListingCommonEbayAspects,
  evaluateVariationListingGroupReadiness,
  generateVariationListingGroupReview,
  parseVariationListingGroupContentResponse,
  type GenerateVariationListingGroupReviewInput,
  generateVariationListingGroupReviewInputSchema,
} from '../../../src/gemini/index.js';

const baseInput: GenerateVariationListingGroupReviewInput = {
  groupId: '11111111-1111-4111-8111-111111111111',
  categoryId: '261328',
  conditionToken: 'EXCELLENT',
  variations: [
    {
      variationId: '22222222-2222-4222-8222-222222222222',
      selectorValue: '1997-98 Metal Universe Planet Metal Marcus Camby #6 Toronto Raptors',
      variationMetadata: {
        Sport: ['Basketball', 'Sports Trading Card'],
        League: 'NBA',
        'Player/Athlete': 'Marcus Camby',
        Team: 'Toronto Raptors',
        Manufacturer: 'Skybox',
        Set: 'Metal Universe',
        'Card Number': '6',
        'Insert Set': 'Planet Metal',
        Features: ['Insert', 'Rookie Card'],
        Season: '1997-98',
        _identityEvidence: { hidden: true },
      },
    },
    {
      variationId: '33333333-3333-4333-8333-333333333333',
      selectorValue: '1997-98 Metal Universe Planet Metal Kevin Garnett #2 Minnesota Timberwolves',
      variationMetadata: {
        Sport: ['Basketball'],
        League: 'NBA',
        'Player/Athlete': 'Kevin Garnett',
        Team: 'Minnesota Timberwolves',
        Manufacturer: 'Skybox',
        Set: 'Metal Universe',
        'Card Number': '2',
        'Insert Set': 'Planet Metal',
        Features: ['Insert'],
        Season: '1997-98',
      },
    },
  ],
  copies: [
    {
      copyId: '44444444-4444-4444-8444-444444444444',
      variationId: '22222222-2222-4222-8222-222222222222',
      availabilityState: 'available',
      conditionToken: 'NEAR_MINT_OR_BETTER',
    },
    {
      copyId: '55555555-5555-4555-8555-555555555555',
      variationId: '33333333-3333-4333-8333-333333333333',
      availabilityState: 'available',
      conditionToken: 'EXCELLENT',
    },
  ],
  userHints: { groupTheme: '1997-98 Metal Universe Planet Metal basketball cards' },
};

describe('variation-listing group review', () => {
  it('derives only truthful common aspects, using intersection for multi values', () => {
    const common = deriveVariationListingCommonEbayAspects(baseInput);
    expect(common).toEqual({
      Manufacturer: 'Skybox',
      Set: 'Metal Universe',
      'Insert Set': 'Planet Metal',
      Season: '1997-98',
      Sport: ['Basketball'],
      League: ['NBA'],
      Features: ['Insert'],
    });
    expect(common).not.toHaveProperty('Player/Athlete');
    expect(common).not.toHaveProperty('Team');
    expect(common.Features).not.toContain('Rookie Card');
  });

  it('normalizes commonality case-insensitively while preserving first-variation spelling', () => {
    const input: GenerateVariationListingGroupReviewInput = {
      ...baseInput,
      variations: [
        {
          ...baseInput.variations[0]!,
          variationMetadata: {
            ...baseInput.variations[0]!.variationMetadata,
            Set: 'TOPPS',
            Features: ['INSERT'],
          },
        },
        {
          ...baseInput.variations[1]!,
          variationMetadata: {
            ...baseInput.variations[1]!.variationMetadata,
            Set: 'topps',
            Features: ['insert'],
          },
        },
      ],
    };
    const common = deriveVariationListingCommonEbayAspects(input);
    expect(common.Set).toBe('TOPPS');
    expect(common.Features).toEqual(['INSERT']);
  });

  it('omits a common optional aspect when any variation lacks it', () => {
    const input = {
      ...baseInput,
      variations: [
        baseInput.variations[0],
        {
          ...baseInput.variations[1],
          variationMetadata: {
            ...baseInput.variations[1]!.variationMetadata,
            League: undefined,
          },
        },
      ],
    } as GenerateVariationListingGroupReviewInput;
    const common = deriveVariationListingCommonEbayAspects(input);
    expect(common).not.toHaveProperty('League');
    expect(common.Sport).toEqual(['Basketball']);
  });

  it('reports the complete group ready when required common aspects and copy conditions pass', () => {
    const readiness = evaluateVariationListingGroupReadiness(baseInput);
    expect(readiness).toEqual({
      ready: true,
      blockers: [],
      conditionCompatible: true,
      incompatibleCopies: [],
    });
  });

  it('blocks an available physical copy below the shared condition tier', () => {
    const input: GenerateVariationListingGroupReviewInput = {
      ...baseInput,
      copies: [
        ...baseInput.copies,
        {
          copyId: '66666666-6666-4666-8666-666666666666',
          variationId: baseInput.variations[0]!.variationId,
          availabilityState: 'available',
          conditionToken: 'VERY_GOOD',
        },
      ],
    };
    const readiness = evaluateVariationListingGroupReadiness(input);
    expect(readiness.ready).toBe(false);
    expect(readiness.conditionCompatible).toBe(false);
    expect(readiness.incompatibleCopies).toHaveLength(1);
    expect(readiness.blockers.join(' ')).toContain('below the group');
  });

  it('ignores a worse non-available historical copy for current condition readiness', () => {
    const input: GenerateVariationListingGroupReviewInput = {
      ...baseInput,
      copies: [
        ...baseInput.copies,
        {
          copyId: '66666666-6666-4666-8666-666666666666',
          variationId: baseInput.variations[0]!.variationId,
          availabilityState: 'unavailable',
          conditionToken: 'POOR',
        },
      ],
    };
    expect(evaluateVariationListingGroupReadiness(input).conditionCompatible).toBe(true);
  });

  it('rejects unknown availability states instead of silently skipping them', () => {
    const malformedInput = {
      ...baseInput,
      copies: [
        {
          ...baseInput.copies[0]!,
          availabilityState: 'sold',
        },
        ...baseInput.copies.slice(1),
      ],
    };
    expect(generateVariationListingGroupReviewInputSchema.safeParse(malformedInput).success).toBe(
      false
    );
    expect(() =>
      evaluateVariationListingGroupReadiness(
        malformedInput as unknown as GenerateVariationListingGroupReviewInput
      )
    ).toThrow();
  });

  it('rejects duplicate copy ids in aggregate input', () => {
    const duplicateInput = {
      ...baseInput,
      copies: [
        baseInput.copies[0]!,
        {
          ...baseInput.copies[1]!,
          copyId: baseInput.copies[0]!.copyId,
        },
      ],
    };
    expect(generateVariationListingGroupReviewInputSchema.safeParse(duplicateInput).success).toBe(
      false
    );
    expect(() =>
      evaluateVariationListingGroupReadiness(
        duplicateInput as unknown as GenerateVariationListingGroupReviewInput
      )
    ).toThrow();
  });

  it('derives readiness aspects internally without a caller-supplied override', () => {
    const heterogeneousInput: GenerateVariationListingGroupReviewInput = {
      ...baseInput,
      variations: [
        baseInput.variations[0]!,
        {
          ...baseInput.variations[1]!,
          variationMetadata: {
            ...baseInput.variations[1]!.variationMetadata,
            Sport: ['Baseball'],
          },
        },
      ],
    };
    expect(evaluateVariationListingGroupReadiness).toHaveLength(1);
    expect(evaluateVariationListingGroupReadiness(heterogeneousInput).blockers).toContain(
      'Required common eBay aspect Sport has no truthful value across every variation.'
    );
  });

  it('blocks readiness when required Sport has no truthful common value', () => {
    const input: GenerateVariationListingGroupReviewInput = {
      ...baseInput,
      variations: [
        baseInput.variations[0]!,
        {
          ...baseInput.variations[1]!,
          variationMetadata: {
            ...baseInput.variations[1]!.variationMetadata,
            Sport: ['Baseball'],
          },
        },
      ],
    };
    const readiness = evaluateVariationListingGroupReadiness(input);
    expect(readiness.ready).toBe(false);
    expect(readiness.blockers).toContain(
      'Required common eBay aspect Sport has no truthful value across every variation.'
    );
  });

  it('blocks readiness when category has no reviewed common-aspect contract', () => {
    const input: GenerateVariationListingGroupReviewInput = {
      ...baseInput,
      categoryId: '999999',
    };
    expect(evaluateVariationListingGroupReadiness(input).blockers).toContain(
      'Variation listing group readiness has no reviewed common-aspect contract for category 999999.'
    );
  });

  it('maps aggregate review input without mutating the semantic snapshot', () => {
    const aggregate = {
      group: {
        group_id: baseInput.groupId,
        category_id: baseInput.categoryId,
        condition_token: baseInput.conditionToken,
      },
      variations: baseInput.variations.map((variation) => ({
        variation_id: variation.variationId,
        selector_value: variation.selectorValue,
        variation_metadata: variation.variationMetadata,
      })),
      copies: baseInput.copies.map((copy) => ({
        copy_id: copy.copyId,
        variation_id: copy.variationId,
        availability_state: copy.availabilityState,
        condition_token: copy.conditionToken,
      })),
    } as unknown as VariationListingAggregateSnapshot;
    const before = structuredClone(aggregate);

    expect(buildVariationListingGroupReviewInputFromAggregate(aggregate, baseInput.userHints)).toEqual(
      baseInput
    );
    expect(aggregate).toEqual(before);
  });

  it('requires at least two variations for publish readiness', () => {
    const input: GenerateVariationListingGroupReviewInput = {
      ...baseInput,
      variations: [baseInput.variations[0]!],
      copies: [baseInput.copies[0]!],
    };
    expect(evaluateVariationListingGroupReadiness(input).blockers).toContain(
      'Variation listing publish readiness requires at least two variations.'
    );
  });

  it('strictly parses only group title, description, and warnings', () => {
    expect(
      parseVariationListingGroupContentResponse(
        JSON.stringify({
          title: '1997-98 Metal Universe Planet Metal Basketball Cards',
          description: 'Choose one card using the Card selector. Images correspond to the selected card.',
          warnings: [],
        }),
        { fixture: true }
      )
    ).toMatchObject({
      title: '1997-98 Metal Universe Planet Metal Basketball Cards',
    });
    expect(() =>
      parseVariationListingGroupContentResponse(
        JSON.stringify({ title: 'Group', description: 'Description', warnings: [], price: 4.99 }),
        undefined
      )
    ).toThrow();
  });

  it('keeps deterministic aspects out of Gemini authorship and hides internal metadata', () => {
    const common = deriveVariationListingCommonEbayAspects(baseInput);
    const prompt = buildVariationListingGroupReviewPrompt(baseInput, common);
    expect(prompt).toContain('Generate only one group title and one group description.');
    expect(prompt).toContain('Do not generate item specifics or common aspects.');
    expect(prompt).toContain('No SoldComps, Browse, market-price, or repricing analysis');
    expect(prompt).not.toContain('_identityEvidence');
    expect(prompt).toContain('"Sport": [');
    expect(prompt).toContain('"Basketball"');
  });

  it('generates prose through the existing Gemini client without preparing images or pricing', async () => {
    const client: GeminiDraftClient = {
      prepareImageParts: vi.fn(),
      generateDraftRaw: vi.fn(async () => ({
        text: JSON.stringify({
          title: '1997-98 Metal Universe Planet Metal Basketball Cards',
          description: 'Choose one card using the Card selector. Images correspond to the selected card.',
          warnings: [],
        }),
        rawResponse: { fixture: true },
      })),
    };
    const result = await generateVariationListingGroupReview(
      baseInput,
      { model: 'gemini-test' },
      {
        getClient: () => client,
        loadConfig: () => ({ apiKey: 'test-key' }),
      }
    );
    expect(client.prepareImageParts).not.toHaveBeenCalled();
    expect(client.generateDraftRaw).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gemini-test', imageParts: [] })
    );
    expect(result.readiness.ready).toBe(true);
    expect(result.derivedCommonEbayAspects.Sport).toEqual(['Basketball']);
    expect(result).not.toHaveProperty('price');
  });
});
