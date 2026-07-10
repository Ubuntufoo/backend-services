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
    expect(prompt).toMatch(/insert type/);
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

  it('requires visible-image year evidence and forbids hint-based year inference', () => {
    const prompt = buildGenerateListingDraftPrompt(createInput());

    expect(prompt).toMatch(/Never infer or guess the card year\./);
    expect(prompt).toMatch(
      /Return yearEvidence only when visible card text explicitly states the production or release year/
    );
    expect(prompt).toMatch(/Statistics, biography dates, career dates, card numbers/i);
    expect(prompt).toMatch(/user hints, and general model knowledge are not year evidence/i);
    expect(prompt).toMatch(/"yearEvidence"/);
    expect(prompt).not.toMatch(/"warningCode"/);
    expect(prompt).not.toMatch(/likelyYear/);
  });

  it('uses the simplified yearEvidence contract and production_line source type', () => {
    const prompt = buildGenerateListingDraftPrompt(createInput());

    expect(prompt).not.toMatch(/"Year": "string;/);
    expect(prompt).not.toMatch(/"Season": "string;/);
    expect(prompt).toMatch(/"yearEvidence": null,/);
    expect(prompt).toMatch(/If qualifying visible year evidence exists, replace "yearEvidence": null with:/);
    expect(prompt).toMatch(/"sourceType": "copyright_line"/);
    expect(prompt).toMatch(/production_line/);
  });

  it('requires exact copied visibleText and imageIndex for yearEvidence', () => {
    const prompt = buildGenerateListingDraftPrompt(createInput());

    expect(prompt).toMatch(/copy the exact supporting text into yearEvidence\.visibleText/i);
    expect(prompt).toMatch(/return the zero-based image index containing that text in yearEvidence\.imageIndex/i);
    expect(prompt).toMatch(/copy the exact four-digit year into yearEvidence\.year/i);
    expect(prompt).toMatch(/return yearEvidence: null/i);
  });

  it('forbids Year and Season item specifics from the model', () => {
    const prompt = buildGenerateListingDraftPrompt(createInput());

    expect(prompt).toMatch(
      /Do not generate Year or Season item specifics\. The backend derives canonical Year from validated yearEvidence\./
    );
  });

  it('keeps listing-context user hints available without treating them as year verification evidence', () => {
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
    expect(prompt).toMatch(/existing item specifics, user hints, and general model knowledge are not year evidence/i);
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
});
