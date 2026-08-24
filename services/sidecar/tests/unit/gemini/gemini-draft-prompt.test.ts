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

    expect(prompt).toMatch(/team may appear last only when positively evidenced/i);
    expect(prompt).toMatch(/never infer a team from player identity/i);
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

  it('provides category-specific single-card candidate fields without speculative filling', () => {
    const prompt = buildGenerateListingDraftPrompt(createInput());

    expect(prompt).toMatch(/For sports singles, candidate fields are: Player, Sport/);
    expect(prompt).toMatch(
      /For non-sport singles, candidate fields are: Franchise, Character, Card Name/
    );
    expect(prompt).toMatch(
      /For CCG singles, candidate fields are: Game, Card Name, Character, Rarity/
    );
    expect(prompt).toMatch(/omit any candidate that is not positively identified/i);
    expect(prompt).toMatch(/Never invent Base Set or absence-based feature values/);
    expect(prompt).not.toMatch(/strongly inferable: Player, verified Year/i);
  });

  it('gates sports League, Language, and Card Name on positive evidence', () => {
    const prompt = buildGenerateListingDraftPrompt(createInput());

    expect(prompt).toMatch(/For sports singles, candidate fields are: Player, Sport, League, Language, Card Name/);
    expect(prompt).toMatch(/League may be returned only when a league name is positively visible/);
    expect(prompt).toMatch(/Never infer League from player identity, team history, roster history/);
    expect(prompt).toMatch(/Card Name may be returned only when a distinct card name is positively visible/);
    expect(prompt).toMatch(/Language may be returned only when confidently supported by visible text/);
  });

  it('requires structured serial evidence and denominator-only Print Run derivation', () => {
    const prompt = buildGenerateListingDraftPrompt(createInput());

    expect(prompt).toMatch(/"serialEvidence": null/);
    expect(prompt).toMatch(/Never return Print Run as a free-form aspect/);
    expect(prompt).toMatch(/positive numerator, and positive denominator/);
    expect(prompt).toMatch(/037\/199/);
    expect(prompt).toMatch(/Card #10 of 25/);
  });

  it('explicitly excludes every autograph item-specific key', () => {
    const prompt = buildGenerateListingDraftPrompt(createInput());

    for (const key of [
      'Autographed',
      'Signed By',
      'Autograph Format',
      'Autograph Authentication',
      'Autograph Authentication Number',
    ]) {
      expect(prompt).toMatch(new RegExp(key));
    }
  });

  it('requires positive team evidence for the internal sports Franchise field', () => {
    const prompt = buildGenerateListingDraftPrompt(createInput());

    expect(prompt).toMatch(/For sports singles, include the internal Franchise aspect/);
    expect(prompt).toMatch(/visible team name, team logo, or team wordmark/);
    expect(prompt).toMatch(/Do not infer Franchise from player identity, career or roster history/);
    expect(prompt).toMatch(/general model knowledge alone/);
    expect(prompt).toMatch(
      /Keep this generated field named Franchise; do not emit the eBay Team field/
    );
  });

  it('does not request deferred or speculative item specifics', () => {
    const prompt = buildGenerateListingDraftPrompt(createInput());

    expect(prompt).toMatch(/Do not generate Season, Autographed/);
    expect(prompt).toMatch(/Original\/Licensed Reprint, Vintage, Illustrator/);
    expect(prompt).toMatch(/MPN, UPC, or generic Graded item specifics/);
  });

  it('requires visible-image year evidence and forbids unstructured hint-based year inference', () => {
    const prompt = buildGenerateListingDraftPrompt(createInput());

    expect(prompt).toMatch(/Never infer or guess the card year\./);
    expect(prompt).toMatch(
      /Return yearEvidence only when visible card text explicitly states the production or release year/
    );
    expect(prompt).toMatch(/Statistics, biography dates, career dates, card numbers/i);
    expect(prompt).toMatch(
      /unstructured user hints, and general model knowledge are not year evidence/i
    );
    expect(prompt).toMatch(/"yearEvidence"/);
    expect(prompt).not.toMatch(/"warningCode"/);
    expect(prompt).not.toMatch(/likelyYear/);
  });

  it('treats structured explicitYear as canonical operator proof without fabricating image evidence', () => {
    const prompt = buildGenerateListingDraftPrompt(
      createInput({ userHints: { explicitYear: '1974', notes: 'year:1974' } })
    );

    expect(prompt).toMatch(/explicitYear.*canonical operator-provided proof/i);
    expect(prompt).toMatch(/explicitYear takes precedence/i);
    expect(prompt).toMatch(/Do not create yearEvidence for explicitYear/i);
    expect(prompt).toMatch(/"explicitYear": "1974"/);
  });

  it('uses the simplified yearEvidence contract and production_line source type', () => {
    const prompt = buildGenerateListingDraftPrompt(createInput());

    expect(prompt).not.toMatch(/"Year": "string;/);
    expect(prompt).not.toMatch(/"Season": "string;/);
    expect(prompt).toMatch(/"yearEvidence": null,/);
    expect(prompt).toMatch(
      /If qualifying visible year evidence exists, replace "yearEvidence": null with:/
    );
    expect(prompt).toMatch(/"sourceType": "copyright_line"/);
    expect(prompt).toMatch(/production_line/);
  });

  it('requires exact copied visibleText and imageIndex for yearEvidence', () => {
    const prompt = buildGenerateListingDraftPrompt(createInput());

    expect(prompt).toMatch(/copy the exact supporting text into yearEvidence\.visibleText/i);
    expect(prompt).toMatch(
      /return the zero-based image index containing that text in yearEvidence\.imageIndex/i
    );
    expect(prompt).toMatch(/copy the exact four-digit year into yearEvidence\.year/i);
    expect(prompt).toMatch(/return yearEvidence: null/i);
  });

  it('requires validated canonical year inclusion exactly once in the title', () => {
    const prompt = buildGenerateListingDraftPrompt(createInput());

    expect(prompt).toMatch(/include that exact canonical year in the title exactly once/i);
    expect(prompt).toMatch(
      /never return valid yearEvidence while omitting its year from the title/i
    );
    expect(prompt).toMatch(/at the very start of the title/i);
  });

  it('gives dual season/year evidence season-only title precedence', () => {
    const prompt = buildGenerateListingDraftPrompt(createInput());

    expect(prompt).toMatch(/valid seasonEvidence coexists with yearEvidence or explicitYear/i);
    expect(prompt).toMatch(/season as the sole human-facing title prefix/i);
    expect(prompt).toMatch(/do not also place the canonical four-digit year in the title/i);
    expect(prompt).toMatch(/Canonical Year remains internal/i);
    expect(prompt).toMatch(/Year Manufactured, Vintage, and pricing\/year authority/i);
  });

  it('keeps Set limited to base identity and separates insert/parallel characteristics', () => {
    const prompt = buildGenerateListingDraftPrompt(createInput());

    expect(prompt).toMatch(/Set must contain only the base product\/set identity/i);
    expect(prompt).toMatch(/belongs in Insert Set or Parallel\/Variety/i);
    expect(prompt).toMatch(/Set="Topps Chrome" and Insert Set="Expansion Draft"/i);
  });

  it('forbids card-condition and grading language in titles', () => {
    const prompt = buildGenerateListingDraftPrompt(createInput());

    expect(prompt).toMatch(/Do not include card-condition or grading language in titles/i);
    expect(prompt).toMatch(/NM\+/);
    expect(prompt).toMatch(/Near Mint/);
    expect(prompt).toMatch(/numeric grades/);
  });

  it('allows Gemini titles to use the full 80-character backend limit', () => {
    const prompt = buildGenerateListingDraftPrompt(createInput());

    expect(prompt).toMatch(/Listing title must be <= 80 characters/);
    expect(prompt).not.toMatch(/Listing title must be <= 76 characters/);
  });

  it('requires a complete final title counted at most 80 characters', () => {
    const prompt = buildGenerateListingDraftPrompt(createInput());

    expect(prompt).toMatch(/Count the complete final title/);
    expect(prompt).toMatch(/at most 80 characters total/);
  });

  it('requires exactly one Card Number in # form without a bare-number repeat', () => {
    const prompt = buildGenerateListingDraftPrompt(createInput());

    expect(prompt).toMatch(/Include the Card Number exactly once/);
    expect(prompt).toMatch(/always in # form/);
    expect(prompt).toMatch(/Never repeat the Card Number as a bare number/);
  });

  it('requires full four-digit years or season ranges, never two-digit shorthand', () => {
    const prompt = buildGenerateListingDraftPrompt(createInput());

    expect(prompt).toMatch(/full four-digit form/);
    expect(prompt).toMatch(/supported season range such as 1997-98/);
    expect(prompt).toMatch(/Never use two-digit year shorthand/);
  });

  it('forbids Year and Season item specifics from the model', () => {
    const prompt = buildGenerateListingDraftPrompt(createInput());

    expect(prompt).toMatch(
      /Do not generate Year or Season item specifics\. The backend derives canonical Year from structured explicitYear or validated yearEvidence\./
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
    expect(prompt).toMatch(
      /existing item specifics, unstructured user hints, and general model knowledge are not year evidence/i
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
});
