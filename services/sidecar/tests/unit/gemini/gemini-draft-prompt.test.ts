import { describe, expect, it } from 'vitest';
import { buildGenerateListingDraftPrompt } from '@/gemini/prompt.js';
import type { GenerateListingDraftInput } from '@/gemini/contracts.js';

function createInput(
  overrides: Partial<GenerateListingDraftInput> = {}
): GenerateListingDraftInput {
  return {
    imageUrls: ['https://cdn.example.com/front.jpg'],
    listingId: 'LIST-001',
    ...overrides,
  };
}

describe('buildGenerateListingDraftPrompt', () => {
  it('does not request priceSuggestion from Gemini', () => {
    const prompt = buildGenerateListingDraftPrompt(createInput());

    expect(prompt).not.toMatch(/"priceSuggestion"/);
    expect(prompt).not.toMatch(/priceSuggestion/);
  });

  it('does not request confidence.price from Gemini', () => {
    const prompt = buildGenerateListingDraftPrompt(createInput());

    expect(prompt).not.toMatch(/"price": 0\.0/);
    expect(prompt).not.toMatch(/"price":\s*0\.0/);
  });

  it('still includes other confidence fields (title, category, aspects)', () => {
    const prompt = buildGenerateListingDraftPrompt(createInput());

    expect(prompt).toMatch(/"title": 0\.0/);
    expect(prompt).toMatch(/"category": 0\.0/);
    expect(prompt).toMatch(/"aspects": 0\.0/);
  });

  it('explicitly prohibits sport in titles', () => {
    const prompt = buildGenerateListingDraftPrompt(createInput());

    expect(prompt).toMatch(/Do NOT include inferred filler in titles/);
    expect(prompt).toMatch(/sport/);
  });

  it('explicitly prohibits league in titles', () => {
    const prompt = buildGenerateListingDraftPrompt(createInput());

    expect(prompt).toMatch(/league/);
  });

  it('explicitly prohibits team in titles', () => {
    const prompt = buildGenerateListingDraftPrompt(createInput());

    expect(prompt).toMatch(/team/);
  });

  it('explicitly prohibits franchise in titles', () => {
    const prompt = buildGenerateListingDraftPrompt(createInput());

    expect(prompt).toMatch(/franchise/);
  });

  it('explicitly prohibits position in titles', () => {
    const prompt = buildGenerateListingDraftPrompt(createInput());

    expect(prompt).toMatch(/position/);
  });

  it('explicitly prohibits role in titles', () => {
    const prompt = buildGenerateListingDraftPrompt(createInput());

    expect(prompt).toMatch(/role/);
  });

  it('explicitly prohibits "coach" in titles', () => {
    const prompt = buildGenerateListingDraftPrompt(createInput());

    expect(prompt).toMatch(/"coach"/);
  });

  it('explicitly prohibits "3rd base" in titles', () => {
    const prompt = buildGenerateListingDraftPrompt(createInput());

    expect(prompt).toMatch(/"3rd base"/);
  });

  it('allows noisy terms when part of an official set, insert, or parallel name', () => {
    const prompt = buildGenerateListingDraftPrompt(createInput());

    expect(prompt).toMatch(/unless those words are genuinely part of/);
    expect(prompt).toMatch(/official set name/);
    expect(prompt).toMatch(/insert name/);
    expect(prompt).toMatch(/parallel name/);
  });

  it('preserves Card Number aspect in the expected JSON shape', () => {
    const prompt = buildGenerateListingDraftPrompt(createInput());

    expect(prompt).toMatch(/"Card Number": "string"/);
  });

  it('preserves card number extraction instructions in prompt', () => {
    const prompt = buildGenerateListingDraftPrompt(createInput());

    expect(prompt).toMatch(/"#98"/);
    expect(prompt).toMatch(/"Card #98"/);
    expect(prompt).toMatch(/Card Number/);
  });

  it('preserves canonical aspect generation instructions', () => {
    const prompt = buildGenerateListingDraftPrompt(createInput());

    expect(prompt).toMatch(
      /Player, Manufacturer, Set, Card Number, Parallel\/Variety, Insert Set/
    );
    expect(prompt).not.toMatch(/strongly inferable: Player, verified Year/i);
  });

  it('requires exact visible or user-provided year before emitting Year or Season', () => {
    const prompt = buildGenerateListingDraftPrompt(createInput());

    expect(prompt).toMatch(
      /Emit aspects\["Year"\] and aspects\["Season"\] only when the exact year is visible on the card image or explicitly provided in user hints\./
    );
    expect(prompt).toMatch(/do not return aspects\["Year"\], and do not return aspects\["Season"\]/i);
    expect(prompt).toMatch(/"yearEvidence"/);
    expect(prompt).toMatch(/"warningCode": "year_unverified or omitted"/);
  });

  it('marks Year and Season as conditional in the expected JSON shape', () => {
    const prompt = buildGenerateListingDraftPrompt(createInput());

    expect(prompt).toMatch(
      /"Year": "string; include only when the exact year is visible on the card image or explicitly provided in user hints"/
    );
    expect(prompt).toMatch(
      /"Season": "string; include only when the exact year is visible on the card image or explicitly provided in user hints"/
    );
  });

  it('strips price from userHints in listing context when explicitly present', () => {
    const prompt = buildGenerateListingDraftPrompt(
      createInput({
        userHints: {
          aspects: { Player: 'Test Player' },
          notes: 'Test notes',
          price: 199.99,
          title: 'Test title',
        },
      })
    );

    // The listing context should not mention price
    const contextStart = prompt.indexOf('Listing context:');
    const contextSection = prompt.slice(contextStart);

    expect(contextSection).not.toMatch(/"price"/);
  });

  it('includes userHints in listing context but strips price when present', () => {
    const prompt = buildGenerateListingDraftPrompt(
      createInput({
        userHints: {
          aspects: { Player: 'Test Player', Year: '2020' },
          notes: 'Some notes',
          price: 299.99,
          title: 'A card title',
        },
      })
    );

    expect(prompt).toMatch(/"Player": "Test Player"/);
    expect(prompt).toMatch(/"Year": "2020"/);
    expect(prompt).toMatch(/"title": "A card title"/);
    expect(prompt).toMatch(/"notes": "Some notes"/);

    // price should not appear anywhere in the listing context
    const contextStart = prompt.indexOf('Listing context:');
    const contextSection = prompt.slice(contextStart);
    expect(contextSection).not.toMatch(/"price"/);
  });
});
