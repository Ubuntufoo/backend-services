import {
  buildLlmPricingPrompt,
  type LlmPricingPromptInput,
} from '@/pricing/index.js';

describe('buildLlmPricingPrompt', () => {
  it('builds deterministic payload with listing facts, stats, comps, and condition summary', () => {
    const prompt = buildLlmPricingPrompt(buildInput());
    const payload = extractPayload(prompt.userPrompt);

    expect(payload).toEqual({
      listing: {
        title: '2023 Panini Prizm Victor Wembanyama #136 Rookie',
        condition: 'Very Good',
        facts: {
          Player: 'Victor Wembanyama',
          Year: '2023',
          Manufacturer: 'Panini',
          Set: 'Prizm',
          'Card Number': '136',
          'Parallel/Variety': 'Silver',
          'Team/Franchise': 'San Antonio Spurs',
        },
      },
      stats: {
        soldCount: 12,
        confidence: 'medium',
        low: 10,
        median: 15,
        high: 20,
        suggested: 15,
      },
      comps: [
        {
          id: 'c1',
          title: '2023 Panini Prizm Victor Wembanyama Rookie #136 VG-EX',
          price: 15.5,
          soldAt: '2026-05-28',
          condition: 'Ungraded',
        },
        {
          id: 'c2',
          title: '2023 Panini Prizm Victor Wembanyama #136 Spurs RC',
          price: 14.25,
          soldAt: '2026-05-21',
        },
      ],
      conditionAdjustment: {
        listingConditionSignal: {
          label: 'Very Good',
          matchedText: 'VERY_GOOD',
          score: 3,
        },
        compConditionSignals: [
          {
            compId: 'c1',
            title: '2023 Panini Prizm Victor Wembanyama Rookie #136 VG-EX',
            price: 15.5,
            signal: {
              label: 'VG-EX',
              matchedText: 'VG-EX',
              score: 3.5,
            },
          },
          {
            compId: 'c2',
            title: '2023 Panini Prizm Victor Wembanyama #136 Spurs RC',
            price: 14.25,
            signal: null,
          },
        ],
        explicitCompConditionCount: 4,
        compMedianConditionScore: 3.75,
        listingConditionScore: 3,
        conditionDelta: -0.75,
        deterministicMedianPrice: 15,
        allowedAdjustment: {
          eligible: true,
          targetPrice: 13.12,
        },
      },
    });
  });

  it('omits workflow fields and opaque payload data', () => {
    const prompt = buildLlmPricingPrompt({
      ...buildInput(),
      listing: {
        ...buildInput().listing,
        condition: null,
        facts: {
          Player: 'Victor Wembanyama',
          Year: '2023',
          Manufacturer: 'Panini',
          Set: 'Prizm',
          'Card Number': '136',
          'Parallel/Variety': '',
          'Team/Franchise': null,
        },
        listingType: 'single',
        status: 'needs_review',
        sub_status: 'review_pending',
        categoryId: '183050',
        conditionId: '3000',
        imageUrls: ['https://cdn.example.com/listing.jpg'],
      } as never,
      stats: {
        ...buildInput().stats,
        outputSchema: { verbose: true },
        forbiddenLanguage: ['sell as lot'],
      } as never,
      comps: [
        {
          ...buildInput().comps[0],
          listingUrl: 'https://www.ebay.com/itm/1',
          imageUrl: 'https://i.ebayimg.com/1.jpg',
          source: 'provider',
          rawHtml: '<html></html>',
          rawRecord: { id: 1 },
        } as never,
      ],
      conditionAdjustment: {
        ...buildInput().conditionAdjustment,
        rawResult: { unexpected: true },
      } as never,
    } as never);

    const payload = extractPayload(prompt.userPrompt);
    const serialized = JSON.stringify(payload);

    expect(payload.listing).toEqual({
      title: '2023 Panini Prizm Victor Wembanyama #136 Rookie',
      facts: {
        Player: 'Victor Wembanyama',
        Year: '2023',
        Manufacturer: 'Panini',
        Set: 'Prizm',
        'Card Number': '136',
      },
    });
    expect(serialized).not.toContain('listingType');
    expect(serialized).not.toContain('status');
    expect(serialized).not.toContain('sub_status');
    expect(serialized).not.toContain('categoryId');
    expect(serialized).not.toContain('conditionId');
    expect(serialized).not.toContain('rawResult');
    expect(serialized).not.toContain('rawHtml');
    expect(serialized).not.toContain('rawRecord');
    expect(serialized).not.toContain('listingUrl');
    expect(serialized).not.toContain('imageUrl');
    expect(serialized).not.toContain('imageUrls');
  });

  it('caps comp count after filtering invalid prices', () => {
    const payload = extractPayload(
      buildLlmPricingPrompt({
        ...buildInput(),
        comps: [
          { id: 'bad-zero', title: 'Bad Zero', price: 0, soldAt: '2026-05-01' },
          { id: 'good-1', title: 'Good 1 VG', price: 11.11, soldAt: '2026-05-02' },
          { id: 'good-2', title: 'Good 2 EX', price: 22.22, soldAt: '2026-05-03' },
          { id: 'good-3', title: 'Good 3 NM', price: 33.33, soldAt: '2026-05-04' },
        ],
        options: { maxComps: 2 },
      }).userPrompt,
    );

    expect(payload.comps).toEqual([
      {
        id: 'good-1',
        title: 'Good 1 VG',
        price: 11.11,
        soldAt: '2026-05-02',
      },
      {
        id: 'good-2',
        title: 'Good 2 EX',
        price: 22.22,
        soldAt: '2026-05-03',
      },
    ]);
  });

  it('keeps prompt deterministic while normalizing nullable fields', () => {
    const input: LlmPricingPromptInput = {
      listing: {
        title: '  2023 Panini Prizm Victor Wembanyama #136 Rookie  ',
        condition: '   ',
        facts: {
          Set: '  Prizm  ',
          Player: ' Victor Wembanyama ',
          Year: ' 2023 ',
          Manufacturer: ' Panini ',
          'Card Number': ' 136 ',
          'Parallel/Variety': null,
          'Team/Franchise': '',
        },
      },
      stats: {
        soldCount: 12.9,
        low: 10.001,
        median: 15.126,
        high: 20.999,
        suggested: null,
        confidence: 'medium',
      },
      conditionAdjustment: {
        listingConditionSignal: null,
        compConditionSignals: [],
        explicitCompConditionCount: 0,
        compMedianConditionScore: null,
        listingConditionScore: null,
        conditionDelta: null,
        deterministicMedianPrice: 15.126,
        allowedAdjustment: {
          eligible: false,
          targetPrice: null,
        },
      },
      comps: [
        {
          id: ' comp-1 ',
          title: '  2023 Panini Prizm Victor Wembanyama Rookie #136 VG-EX  ',
          price: 15.129,
          soldAt: ' 2026-05-28T11:22:33.000Z ',
          condition: '  ',
        },
      ],
      options: {
        compIdAliasesByCanonicalId: {
          ' comp-1 ': 'c1',
        },
      },
    };

    const promptA = buildLlmPricingPrompt(input);
    const promptB = buildLlmPricingPrompt(input);
    const payload = extractPayload(promptA.userPrompt);

    expect(promptA).toEqual(promptB);
    expect(payload).toEqual({
      listing: {
        title: '2023 Panini Prizm Victor Wembanyama #136 Rookie',
        facts: {
          Player: 'Victor Wembanyama',
          Year: '2023',
          Manufacturer: 'Panini',
          Set: 'Prizm',
          'Card Number': '136',
        },
      },
      stats: {
        soldCount: 12,
        confidence: 'medium',
        low: 10,
        median: 15.13,
        high: 21,
      },
      comps: [
        {
          id: 'c1',
          title: '2023 Panini Prizm Victor Wembanyama Rookie #136 VG-EX',
          price: 15.13,
          soldAt: '2026-05-28',
        },
      ],
      conditionAdjustment: {
        listingConditionSignal: null,
        compConditionSignals: [],
        explicitCompConditionCount: 0,
        compMedianConditionScore: null,
        listingConditionScore: null,
        conditionDelta: null,
        deterministicMedianPrice: 15.13,
        allowedAdjustment: {
          eligible: false,
          targetPrice: null,
        },
      },
    });
  });

  it('includes condition-adjustment instructions and exact-target semantics', () => {
    const prompt = buildLlmPricingPrompt(buildInput());

    expect(prompt.systemInstruction).toContain('deterministically accepted normalized sold comps');
    expect(prompt.systemInstruction).toContain('Do not decide comp eligibility');
    expect(prompt.userPrompt).toContain(
      'Use exactly these output fields: selectedCompIds, rejectedCompIds, conditionAdjustedPrice, conditionAdjustmentPercent, conditionAdjustmentReason, confidence, priceExplanation, reviewWarnings, ambiguousConditionTerms, compNotes.',
    );
    expect(prompt.userPrompt).toContain('Comps and deterministic stats are already accepted.');
    expect(prompt.userPrompt).toContain(
      'If conditionAdjustment.allowedAdjustment.eligible is true, either return the exact targetPrice or return conditionAdjustedPrice: null.',
    );
    expect(prompt.userPrompt).toContain('Never output a different adjusted price than targetPrice.');
    expect(prompt.userPrompt).not.toContain('outputSchema');
    expect(prompt.userPrompt).not.toContain('forbiddenLanguage');
  });
});

function extractPayload(userPrompt: string): {
  listing: Record<string, unknown>;
  stats: Record<string, unknown>;
  comps: Array<Record<string, unknown>>;
  conditionAdjustment: Record<string, unknown>;
} {
  const marker = 'Pricing payload:\n';
  const index = userPrompt.indexOf(marker);

  if (index < 0) {
    throw new Error('Prompt payload marker missing.');
  }

  return JSON.parse(userPrompt.slice(index + marker.length));
}

function buildInput(): LlmPricingPromptInput {
  return {
    listing: {
      title: '2023 Panini Prizm Victor Wembanyama #136 Rookie',
      condition: 'Very Good',
      facts: {
        Player: 'Victor Wembanyama',
        Year: '2023',
        Manufacturer: 'Panini',
        Set: 'Prizm',
        'Card Number': '136',
        'Parallel/Variety': 'Silver',
        'Team/Franchise': 'San Antonio Spurs',
      },
    },
    stats: {
      soldCount: 12,
      low: 10,
      median: 15,
      high: 20,
      suggested: 15,
      confidence: 'medium',
    },
    conditionAdjustment: {
      listingConditionSignal: {
        label: 'Very Good',
        matchedText: 'VERY_GOOD',
        score: 3,
        source: 'listing_condition',
      },
      compConditionSignals: [
        {
          compId: 'comp-1',
          title: '2023 Panini Prizm Victor Wembanyama Rookie #136 VG-EX',
          price: 15.5,
          signal: {
            label: 'VG-EX',
            matchedText: 'VG-EX',
            score: 3.5,
            source: 'comp_title',
          },
        },
        {
          compId: 'comp-2',
          title: '2023 Panini Prizm Victor Wembanyama #136 Spurs RC',
          price: 14.25,
          signal: null,
        },
      ],
      explicitCompConditionCount: 4,
      compMedianConditionScore: 3.75,
      listingConditionScore: 3,
      conditionDelta: -0.75,
      deterministicMedianPrice: 15,
      allowedAdjustment: {
        eligible: true,
        targetPrice: 13.12,
        minPrice: 13.12,
        maxPrice: 13.12,
        rawPercent: -0.0642,
        appliedPercent: -0.1253,
        reason: 'eligible',
      },
    },
    comps: [
      {
        id: 'comp-1',
        title: '2023 Panini Prizm Victor Wembanyama Rookie #136 VG-EX',
        price: 15.5,
        soldAt: '2026-05-28T12:34:56.000Z',
        condition: 'Ungraded',
      },
      {
        id: 'comp-2',
        title: '2023 Panini Prizm Victor Wembanyama #136 Spurs RC',
        price: 14.25,
        soldAt: '2026-05-21T00:00:00.000Z',
      },
    ],
    options: {
      compIdAliasesByCanonicalId: {
        'comp-1': 'c1',
        'comp-2': 'c2',
      },
    },
  };
}
