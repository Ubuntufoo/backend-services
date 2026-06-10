import {
  buildLlmPricingPrompt,
  type LlmPricingPromptInput,
} from '@/pricing/index.js';

describe('buildLlmPricingPrompt', () => {
  it('builds compact deterministic payload with listing facts, stats, and normalized comps only', () => {
    const prompt = buildLlmPricingPrompt(buildInput());
    const payload = extractPayload(prompt.userPrompt);

    expect(payload).toEqual({
      listing: {
        title: '2023 Panini Prizm Victor Wembanyama #136 Rookie',
        condition: 'Ungraded',
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
          id: 'comp-1',
          title: '2023 Panini Prizm Victor Wembanyama Rookie #136',
          price: 15.5,
          soldAt: '2026-05-28',
          condition: 'Ungraded',
        },
        {
          id: 'comp-2',
          title: '2023 Panini Prizm Victor Wembanyama #136 Spurs RC',
          price: 14.25,
          soldAt: '2026-05-21',
        },
      ],
    });
  });

  it('omits workflow fields, opaque ids, helper payloads, raw output, urls, and images', () => {
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
      rawResult: { soldComps: [] },
      validCompIds: ['comp-1'],
      outputSchema: { fields: [] },
      forbiddenLanguage: ['sell as single'],
      provider: 'apify',
      imageUrls: ['https://cdn.example.com/top-level.jpg'],
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
    expect(serialized).not.toContain('validCompIds');
    expect(serialized).not.toContain('outputSchema');
    expect(serialized).not.toContain('forbiddenLanguage');
    expect(serialized).not.toContain('rawResult');
    expect(serialized).not.toContain('rawHtml');
    expect(serialized).not.toContain('rawRecord');
    expect(serialized).not.toContain('listingUrl');
    expect(serialized).not.toContain('imageUrl');
    expect(serialized).not.toContain('imageUrls');
    expect(serialized).not.toContain('source');
  });

  it('caps comp count at default and honors explicit lower cap while preserving order', () => {
    const comps = Array.from({ length: 14 }, (_, index) => ({
      id: `comp-${index + 1}`,
      title: `Comp ${index + 1}`,
      price: 10 + index,
      soldAt: `2026-05-${String(index + 1).padStart(2, '0')}`,
      condition: index % 2 === 0 ? 'Ungraded' : null,
    }));

    const defaultPayload = extractPayload(
      buildLlmPricingPrompt({
        ...buildInput(),
        comps,
      }).userPrompt,
    );

    const cappedPayload = extractPayload(
      buildLlmPricingPrompt({
        ...buildInput(),
        comps,
        options: { maxComps: 3 },
      }).userPrompt,
    );

    expect(defaultPayload.comps).toHaveLength(12);
    expect(defaultPayload.comps.map((comp: { id: string }) => comp.id)).toEqual([
      'comp-1',
      'comp-2',
      'comp-3',
      'comp-4',
      'comp-5',
      'comp-6',
      'comp-7',
      'comp-8',
      'comp-9',
      'comp-10',
      'comp-11',
      'comp-12',
    ]);
    expect(cappedPayload.comps.map((comp: { id: string }) => comp.id)).toEqual([
      'comp-1',
      'comp-2',
      'comp-3',
    ]);
  });

  it('normalizes numbers, omits null/empty fields, and keeps prompt deterministic', () => {
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
      comps: [
        {
          id: ' comp-1 ',
          title: '  2023 Panini Prizm Victor Wembanyama Rookie #136  ',
          price: 15.129,
          soldAt: ' 2026-05-28 ',
          condition: '  ',
        },
      ],
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
          id: 'comp-1',
          title: '2023 Panini Prizm Victor Wembanyama Rookie #136',
          price: 15.13,
          soldAt: '2026-05-28',
        },
      ],
    });
  });

  it('includes concise schema-aligned instructions without compNotes or verbose schema blocks', () => {
    const prompt = buildLlmPricingPrompt(buildInput());

    expect(prompt.systemInstruction).toContain('normalized sold comps');
    expect(prompt.systemInstruction).toContain('Return JSON only');
    expect(prompt.userPrompt).toContain('Return JSON only.');
    expect(prompt.userPrompt).toContain(
      'Use exactly these output fields: selectedCompIds, rejectedCompIds, suggestedPrice, confidence, priceExplanation.',
    );
    expect(prompt.userPrompt).toContain('Use only IDs from comps.');
    expect(prompt.userPrompt).toContain(
      'Do not invent comps, prices, dates, grades, serials, players, teams, card attributes, or listing facts.',
    );
    expect(prompt.userPrompt).toContain('Do not make lot or single recommendations.');
    expect(prompt.userPrompt).toContain('Keep priceExplanation short.');
    expect(prompt.userPrompt).toContain('Suggested price must stay within deterministic low/high range.');
    expect(prompt.userPrompt).toContain(
      'Use suggestedPrice: null if provided comps do not support a safe price.',
    );
    expect(prompt.userPrompt).not.toContain('compNotes');
    expect(prompt.userPrompt).not.toContain('outputSchema');
    expect(prompt.userPrompt).not.toContain('forbiddenLanguage');
  });
});

function extractPayload(userPrompt: string): {
  listing: Record<string, unknown>;
  stats: Record<string, unknown>;
  comps: Array<Record<string, unknown>>;
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
      condition: 'Ungraded',
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
    comps: [
      {
        id: 'comp-1',
        title: '2023 Panini Prizm Victor Wembanyama Rookie #136',
        price: 15.5,
        soldAt: '2026-05-28',
        condition: 'Ungraded',
      },
      {
        id: 'comp-2',
        title: '2023 Panini Prizm Victor Wembanyama #136 Spurs RC',
        price: 14.25,
        soldAt: '2026-05-21',
      },
    ],
  };
}
