import { describe, expect, it } from 'vitest';
import {
  GeminiDraftTitleOverflowError,
  normalizeGeneratedDraft,
  parseGeneratedDraft,
} from '@/gemini/index.js';

describe('parseGeneratedDraft', () => {
  it('preserves expanded category-specific candidates while rejecting direct Year and Season', () => {
    const draft = parseGeneratedDraft(
      JSON.stringify({
        title: 'Charizard Pokémon #4 Holo',
        description: 'Single card.',
        aspects: {
          Game: 'Pokémon TCG',
          Sport: 'Baseball',
          'Card Name': 'Charizard',
          Character: 'Charizard',
          Rarity: 'Rare Holo',
          Language: 'English',
          'Card Type': 'Pokémon',
          Finish: 'Holo',
          Manufacturer: 'Wizards of the Coast',
          Set: 'Base Set',
          'Card Number': '4',
          Features: ['Holo', 'Rare'],
          League: 'Pokémon League',
          Autographed: 'No',
          'Signed By': 'Printed signature',
          'Autograph Format': 'Hard Signed',
          'Autograph Authentication': 'None',
          'Autograph Authentication Number': '123',
          Vintage: 'Yes',
          Type: 'Collectible Card Game',
          'Arbitrary Key': ['syntactically', 'valid'],
          Year: '1999',
          Season: '1999',
        },
        yearEvidence: null,
        warnings: [],
      }),
      { id: 'raw-response-expanded-ccg' },
      { imageCount: 2 }
    );

    expect(draft.aspects).toMatchObject({
      Game: 'Pokémon TCG',
      'Card Name': 'Charizard',
      Character: 'Charizard',
      Rarity: 'Rare Holo',
      Language: 'English',
      'Card Type': 'Pokémon',
      Finish: 'Holo',
      Manufacturer: 'Wizards of the Coast',
      Set: 'Base Set',
      'Card Number': '4',
      Features: ['Holo', 'Rare'],
    });
    expect(draft.aspects).not.toHaveProperty('Year');
    expect(draft.aspects).not.toHaveProperty('Season');
    expect(draft.aspects).toHaveProperty('League', 'Pokémon League');
    expect(draft.aspects).not.toHaveProperty('Autographed');
    expect(draft.aspects).not.toHaveProperty('Vintage');
    expect(draft.aspects).not.toHaveProperty('Type');
    expect(draft.aspects).not.toHaveProperty('Arbitrary Key');
    expect(draft.warnings).toContain(
      'Gemini response aspects discarded unexpected keys: "Autographed", "Signed By", "Autograph Format", "Autograph Authentication", "Autograph Authentication Number", "Vintage", "Type", "Arbitrary Key".'
    );
  });

  it('derives Year from validated year evidence and removes duplicate aliases and Season', () => {
    const draft = parseGeneratedDraft(
      JSON.stringify({
        title: '1955 Topps Johnny Riddle #98',
        description: 'Vintage single card.',
        aspects: {
          Athlete: 'Johnny Riddle',
          'Card Manufacturer': 'Topps',
          Season: '1955',
          Set: '1955 Topps',
        },
        yearEvidence: {
          year: '1955',
          sourceType: 'copyright_line',
          visibleText: '© 1955 THE TOPPS COMPANY, INC.',
          imageIndex: 1,
        },
        warnings: [],
      }),
      { id: 'raw-response-1' },
      { imageCount: 2 }
    );

    expect(draft.title).toBe('1955 Topps Johnny Riddle #98');
    expect(draft.aspects).toEqual({
      Player: 'Johnny Riddle',
      Manufacturer: 'Topps',
      Set: 'Topps',
      'Card Number': '98',
      Year: '1955',
    });
    expect(draft.yearEvidence).toEqual({
      year: '1955',
      sourceType: 'copyright_line',
      visibleText: '© 1955 THE TOPPS COMPANY, INC.',
      imageIndex: 1,
    });
  });

  it('uses an authorized seller year over conflicting model year claims without image evidence', () => {
    const draft = parseGeneratedDraft(
      JSON.stringify({
        title: 'Willie Stargell 1975 Topps #100',
        description: 'The model described this as a 1975 card.',
        aspects: {
          Player: 'Willie Stargell',
          Manufacturer: 'Topps',
          'Card Number': '100',
          Year: '1975',
        },
        yearEvidence: {
          year: '1975',
          sourceType: 'copyright_line',
          visibleText: '© 1975 TOPPS',
          imageIndex: 0,
        },
        warnings: [],
      }),
      { id: 'seller-year-raw-response' },
      { authorizedYear: '1974', imageCount: 1 }
    );

    expect(draft.title).toBe('1974 Topps Willie Stargell #100');
    expect(draft.aspects).toMatchObject({
      'Card Number': '100',
      Manufacturer: 'Topps',
      Player: 'Willie Stargell',
      Year: '1974',
    });
    expect(draft.yearEvidence).toBeNull();
  });

  it('removes unsupported title and set years when evidence is absent and preserves card-number years', () => {
    const draft = parseGeneratedDraft(
      JSON.stringify({
        title: 'Phil Rizzuto 1951 Topps #1951',
        description: 'Single card.',
        aspects: {
          Player: 'Phil Rizzuto',
          Manufacturer: 'Topps',
          Set: '1951 Topps',
          Year: '1951',
          Season: '1951',
        },
        yearEvidence: null,
        warnings: [],
      }),
      { id: 'raw-response-2' },
      { imageCount: 2 }
    );

    expect(draft.title).toBe('Topps Phil Rizzuto #1951');
    expect(draft.aspects).toEqual({
      Player: 'Phil Rizzuto',
      Manufacturer: 'Topps',
      Set: 'Topps',
      'Card Number': '1951',
    });
    expect(draft.yearEvidence).toBeNull();
    expect(draft.warnings).toContain(
      'Gemini exact year discarded: missing qualifying visible year evidence.'
    );
  });

  it('rejects unsupported source types', () => {
    const draft = parseGeneratedDraft(
      JSON.stringify({
        title: 'Ed Stanky 1952 Topps #191',
        description: 'Single card.',
        aspects: {
          Player: 'Ed Stanky',
          Manufacturer: 'Topps',
          Set: '1952 Topps',
          Year: '1952',
        },
        yearEvidence: {
          year: '1952',
          sourceType: 'bad_source',
          visibleText: '© 1952 THE TOPPS COMPANY, INC.',
          imageIndex: 0,
        },
        warnings: [],
      }),
      { id: 'raw-response-3' },
      { imageCount: 1 }
    );

    expect(draft.title).toBe('Topps Ed Stanky #191');
    expect(draft.aspects).toEqual({
      Player: 'Ed Stanky',
      Manufacturer: 'Topps',
      Set: 'Topps',
      'Card Number': '191',
    });
    expect(draft.yearEvidence).toBeNull();
    expect(draft.warnings).toContain(
      'Gemini response field "yearEvidence.sourceType" was invalid and was discarded.'
    );
    expect(draft.warnings).toContain(
      'Gemini response field "yearEvidence" was incomplete and was discarded.'
    );
  });

  it('rejects mismatched visible text years', () => {
    const draft = parseGeneratedDraft(
      JSON.stringify({
        title: 'Phil Rizzuto 1951 Bowman #17',
        description: 'Single card.',
        aspects: {
          Player: 'Phil Rizzuto',
          Manufacturer: 'Bowman',
          Set: '1951 Bowman',
        },
        yearEvidence: {
          year: '1951',
          sourceType: 'copyright_line',
          visibleText: 'Career stats through 1954 season',
          imageIndex: 0,
        },
        warnings: [],
      }),
      { id: 'raw-response-4' },
      { imageCount: 1 }
    );

    expect(draft.title).toBe('Bowman Phil Rizzuto #17');
    expect(draft.aspects.Set).toBe('Bowman');
    expect(draft.yearEvidence).toBeNull();
    expect(draft.warnings).toContain(
      'Gemini exact year discarded: visibleText does not contain year "1951".'
    );
  });

  it('rejects out-of-range image indexes', () => {
    const draft = parseGeneratedDraft(
      JSON.stringify({
        title: '1991 Fleer Pro Vision Michael Jordan #2',
        description: 'Single card.',
        aspects: {
          Player: 'Michael Jordan',
          Manufacturer: 'Fleer',
          Set: '1991 Fleer Pro Vision',
        },
        yearEvidence: {
          year: '1991',
          sourceType: 'production_line',
          visibleText: 'Production 1991 Fleer',
          imageIndex: 3,
        },
        warnings: [],
      }),
      { id: 'raw-response-5' },
      { imageCount: 2 }
    );

    expect(draft.title).toBe('Fleer Pro Vision Michael Jordan #2');
    expect(draft.aspects.Set).toBe('Fleer Pro Vision');
    expect(draft.yearEvidence).toBeNull();
    expect(draft.warnings).toContain(
      'Gemini exact year discarded: imageIndex must reference a supplied image.'
    );
  });

  it('keeps meaningful set variants while removing a redundant validated year', () => {
    const draft = parseGeneratedDraft(
      JSON.stringify({
        title: '1953 Bowman Color Mickey Mantle #59',
        description: 'Single card.',
        aspects: {
          Player: 'Mickey Mantle',
          Manufacturer: 'Bowman',
          Set: '1953 Bowman Color',
        },
        yearEvidence: {
          year: '1953',
          sourceType: 'manufacture_line',
          visibleText: 'Manufactured in 1953 by Bowman Gum, Inc.',
          imageIndex: 0,
        },
        warnings: [],
      }),
      { id: 'raw-response-6' },
      { imageCount: 1 }
    );

    expect(draft.aspects).toMatchObject({
      Manufacturer: 'Bowman',
      Set: 'Bowman Color',
      Year: '1953',
    });
  });

  it('inserts validated year evidence before the manufacturer when Gemini omits it', () => {
    const draft = parseGeneratedDraft(
      JSON.stringify({
        title: 'Ryne Sandberg Fleer Team Leaders #6 of 10',
        description: 'Single card.',
        cardConditionToken: null,
        aspects: {
          Player: 'Ryne Sandberg',
          Manufacturer: 'Fleer',
          'Card Number': '6 of 10',
        },
        yearEvidence: {
          year: '1993',
          sourceType: 'copyright_line',
          visibleText: '© 1993 FLEER CORP.',
          imageIndex: 1,
        },
        warnings: [],
      }),
      { id: 'raw-response-sandberg-year' },
      { imageCount: 2 }
    );

    expect(draft.title).toBe('1993 Fleer Ryne Sandberg #6 of 10');
  });

  it('builds the canonical vintage title order from validated aspects', () => {
    const draft = parseGeneratedDraft(
      JSON.stringify({
        title: 'Smoky Burgess 1953 Topps #10',
        description: 'Single card.',
        aspects: {
          Player: 'Smoky Burgess',
          Manufacturer: 'Topps',
          Set: '1953 Topps',
          'Card Number': '10',
        },
        yearEvidence: {
          year: '1953',
          sourceType: 'copyright_line',
          visibleText: '© 1953 TOPPS',
          imageIndex: 0,
        },
        warnings: [],
      }),
      { id: 'raw-response-canonical-smoky-burgess' },
      { imageCount: 1 }
    );

    expect(draft.title).toBe('1953 Topps Smoky Burgess #10');
  });

  it('preserves season range, named insert, and evidenced team in canonical order', () => {
    const draft = parseGeneratedDraft(
      JSON.stringify({
        title: '1997-98 Skybox Metal Universe Planet Metal Marcus Camby #6 Toronto Raptors',
        description: 'Single card.',
        aspects: {
          Player: 'Marcus Camby',
          Manufacturer: 'Skybox',
          Set: '1997-98 Skybox Metal Universe',
          'Insert Set': 'Planet Metal',
          'Card Number': '6',
          Franchise: 'Toronto Raptors',
        },
        yearEvidence: {
          year: '1997',
          sourceType: 'copyright_line',
          visibleText: '© 1997 Skybox',
          imageIndex: 0,
        },
        warnings: [],
      }),
      { id: 'raw-response-canonical-marcus-camby' },
      { imageCount: 1 }
    );

    expect(draft.title).toBe(
      '1997-98 Skybox Metal Universe Planet Metal Marcus Camby #6 Toronto Raptors'
    );
  });

  it.each(['1997-99', '1997/98'])(
    'canonicalizes an unsupported season range %s to the validated year',
    (range) => {
      const draft = parseGeneratedDraft(
        JSON.stringify({
          title: `${range} Topps Player #1`,
          description: 'Single card.',
          aspects: {
            Player: 'Player',
            Manufacturer: 'Topps',
            'Card Number': '1',
          },
          yearEvidence: {
            year: '1997',
            sourceType: 'copyright_line',
            visibleText: '© 1997 TOPPS',
            imageIndex: 0,
          },
          warnings: [],
        }),
        { id: `raw-response-unsupported-range-${range}` },
        { imageCount: 1 }
      );

      expect(draft.title).toBe('1997 Topps Player #1');
    }
  );

  it('rejects a multi-range Set claim instead of deriving Season from it', () => {
    const draft = parseGeneratedDraft(
      JSON.stringify({
        title: '1997-98/99 Topps Player #1',
        description: 'Single card.',
        aspects: {
          Player: 'Player',
          Set: '1997-98/99 Topps',
          Manufacturer: 'Topps',
          'Card Number': '1',
        },
        yearEvidence: {
          year: '1997',
          sourceType: 'copyright_line',
          visibleText: '© 1997 TOPPS',
          imageIndex: 0,
        },
        warnings: [],
      }),
      { id: 'raw-response-unsafe-set-range' },
      { imageCount: 1 }
    );

    expect(draft.aspects.Set).toBe('Topps');
    expect(draft.aspects).not.toHaveProperty('Season');
  });

  it('appends an authoritative Franchise aspect after the card number', () => {
    const draft = parseGeneratedDraft(
      JSON.stringify({
        title: '1997-98 Skybox Metal Universe Planet Metal Marcus Camby #6',
        description: 'Single card.',
        aspects: {
          Player: 'Marcus Camby',
          Manufacturer: 'Skybox',
          Set: '1997-98 Skybox Metal Universe',
          'Insert Set': 'Planet Metal',
          'Card Number': '6',
          Franchise: 'Toronto Raptors',
        },
        yearEvidence: {
          year: '1997',
          sourceType: 'copyright_line',
          visibleText: '© 1997 Skybox',
          imageIndex: 0,
        },
        warnings: [],
      }),
      { id: 'raw-response-franchise-aspect-only' },
      { imageCount: 1 }
    );

    expect(draft.title).toBe(
      '1997-98 Skybox Metal Universe Planet Metal Marcus Camby #6 Toronto Raptors'
    );
  });

  it.each([
    [
      'after the player when manufacturer is unavailable',
      'Ryne Sandberg Team Leaders #6 of 10',
      { Player: 'Ryne Sandberg' },
      '1993 Ryne Sandberg #6 of 10',
    ],
    [
      'at the start when player and manufacturer are unavailable',
      'Team Leaders #6 of 10',
      {},
      '1993 Team Leaders #6 of 10',
    ],
  ])('inserts validated year evidence %s', (_case, title, aspects, expectedTitle) => {
    const draft = parseGeneratedDraft(
      JSON.stringify({
        title,
        description: 'Single card.',
        cardConditionToken: null,
        aspects,
        yearEvidence: {
          year: '1993',
          sourceType: 'copyright_line',
          visibleText: '© 1993 FLEER CORP.',
          imageIndex: 1,
        },
        warnings: [],
      }),
      { id: `raw-response-year-placement-${_case}` },
      { imageCount: 2 }
    );

    expect(draft.title).toBe(expectedTitle);
  });

  it('keeps condition assessment out of titles for near-mint-or-better cards', () => {
    const draft = parseGeneratedDraft(
      JSON.stringify({
        title: 'Ryne Sandberg Fleer Team Leaders #6 of 10 NM+ NM+',
        description: 'Single card.',
        cardConditionToken: 'NEAR_MINT_OR_BETTER',
        aspects: {
          Player: 'Ryne Sandberg',
          Manufacturer: 'Fleer',
          'Card Number': '6 of 10',
        },
        yearEvidence: {
          year: '1993',
          sourceType: 'copyright_line',
          visibleText: '© 1993 FLEER CORP.',
          imageIndex: 1,
        },
        warnings: [],
      }),
      { id: 'raw-response-sandberg-nm' },
      { imageCount: 2 }
    );

    expect(draft.title).toBe('1993 Fleer Ryne Sandberg #6 of 10');
  });

  it('reconstructs an overlength raw title from validated canonical fields', () => {
    const title =
      'Ryne Sandberg Fleer Team Leaders Limited Edition Premium Collector Parallel Insert #6';
    expect(title.length).toBeGreaterThan(80);

    const draft = parseGeneratedDraft(
      JSON.stringify({
        title,
        description: 'Single card.',
        cardConditionToken: 'NEAR_MINT_OR_BETTER',
        aspects: {
          Player: 'Ryne Sandberg',
          Manufacturer: 'Fleer',
          'Card Number': '6',
        },
        yearEvidence: {
          year: '1993',
          sourceType: 'copyright_line',
          visibleText: '© 1993 FLEER CORP.',
          imageIndex: 1,
        },
        warnings: [],
      }),
      { id: 'raw-response-overlong-semantic-title' },
      { imageCount: 2 }
    );

    expect(draft.title).toBe('1993 Fleer Ryne Sandberg #6');
  });

  it('removes a bare card-number duplicate and reconstructs the validated Bert Blyleven title', () => {
    const draft = parseGeneratedDraft(
      JSON.stringify({
        title: 'Topps 98 Bert Blyleven #98 Minnesota Twins',
        description: 'Single card.',
        aspects: {
          Player: 'Bert Blyleven',
          Set: 'Topps',
          'Card Number': '98',
          Franchise: 'Minnesota Twins',
        },
        yearEvidence: {
          year: '1974',
          sourceType: 'copyright_line',
          visibleText: '© 1974 THE TOPPS COMPANY, INC.',
          imageIndex: 0,
        },
        warnings: [],
      }),
      { id: 'raw-response-bert-blyleven-duplicate-number' },
      { imageCount: 1 }
    );

    expect(draft.title).toBe('1974 Topps Bert Blyleven #98 Minnesota Twins');
  });

  it('returns an exactly 80-character normalized title unchanged', () => {
    const title = `Ryne Sandberg ${'A'.repeat(66)}`;
    expect(title).toHaveLength(80);

    const draft = parseGeneratedDraft(
      JSON.stringify({
        title,
        description: 'Single card.',
        cardConditionToken: null,
        aspects: { Player: 'Ryne Sandberg' },
        yearEvidence: null,
        warnings: [],
      }),
      { id: 'raw-response-exact-title-limit' }
    );

    expect(draft.title).toBe(title);
  });

  it('fails closed when normalized title content cannot fit within 80 characters', () => {
    const player = 'A'.repeat(72);

    let thrown: unknown;
    try {
      parseGeneratedDraft(
        JSON.stringify({
          title: `${player} Fleer #1951`,
          description: 'Single card.',
          cardConditionToken: 'NEAR_MINT_OR_BETTER',
          aspects: {
            Player: player,
            Manufacturer: 'Fleer',
            'Card Number': '1951',
          },
          yearEvidence: {
            year: '1993',
            sourceType: 'copyright_line',
            visibleText: '© 1993 FLEER CORP.',
            imageIndex: 0,
          },
          warnings: [],
        }),
        { id: 'raw-response-required-title-too-long' },
        { imageCount: 1 }
      )
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(GeminiDraftTitleOverflowError);
    expect((thrown as GeminiDraftTitleOverflowError).context).toMatchObject({
      finalLength: 83,
      protectedComponents: ['1993', player, '#1951'],
    });
  });

  it.each(['EXCELLENT', 'VERY_GOOD', 'POOR', null])(
    'does not add NM+ for %s condition token',
    (cardConditionToken) => {
      const draft = parseGeneratedDraft(
        JSON.stringify({
          title: 'Ryne Sandberg Fleer Team Leaders #6 of 10',
          description: 'Single card.',
          cardConditionToken,
          aspects: {
            Player: 'Ryne Sandberg',
            Manufacturer: 'Fleer',
          },
          yearEvidence: null,
          warnings: [],
        }),
        { id: `raw-response-condition-${cardConditionToken ?? 'null'}` },
        { imageCount: 2 }
      );

      expect(draft.title).toBe('Fleer Ryne Sandberg #6 of 10');
    }
  );

  it('defensively removes condition and grading wording without touching card numbers', () => {
    const draft = parseGeneratedDraft(
      JSON.stringify({
        title: '2023 Topps Victor Wembanyama Rookie Card #136 PSA 10 Near Mint Good Fair Low Grade',
        description: 'Single card.',
        cardConditionToken: 'NEAR_MINT_OR_BETTER',
        aspects: {
          Player: 'Victor Wembanyama',
          Manufacturer: 'Topps',
          Features: ['Rookie Card'],
        },
        yearEvidence: null,
        warnings: [],
      }),
      { id: 'raw-response-title-condition-language' }
    );

    expect(draft.title).toBe('Topps Rookie Card Victor Wembanyama #136');
    expect(draft.aspects['Card Number']).toBe('136');
    expect(draft.cardConditionToken).toBe('NEAR_MINT_OR_BETTER');
  });

  it('preserves condition-like words when they are part of recognized set or insert names', () => {
    const draft = parseGeneratedDraft(
      JSON.stringify({
        title: '1997 Topps Mint Collection Excellent Adventure Player #10',
        description: 'Single card.',
        aspects: {
          Player: 'Player',
          Manufacturer: 'Topps',
          Set: 'Mint Collection',
          'Insert Set': 'Excellent Adventure',
        },
        yearEvidence: {
          year: '1997',
          sourceType: 'copyright_line',
          visibleText: '© 1997 TOPPS',
          imageIndex: 0,
        },
        warnings: [],
      }),
      { id: 'raw-response-protected-condition-words' },
      { imageCount: 1 }
    );

    expect(draft.title).toBe('1997 Topps Mint Collection Excellent Adventure Player #10');
  });

  it('does not strip legitimate initials that resemble condition shorthand', () => {
    const draft = parseGeneratedDraft(
      JSON.stringify({
        title: 'G Chipper Jones Topps #1',
        description: 'Single card.',
        aspects: {
          Player: 'G Chipper Jones',
          Manufacturer: 'Topps',
        },
        yearEvidence: null,
        warnings: [],
      }),
      { id: 'raw-response-initial-title' }
    );

    expect(draft.title).toBe('Topps G Chipper Jones #1');
  });

  it('removes a bare card-number duplicate while retaining nonmatching numeric and serial identifiers', () => {
    const draft = parseGeneratedDraft(
      JSON.stringify({
        title: '2023 Topps Player #10 10 9.5 10/25',
        description: 'Single card.',
        aspects: {
          Player: 'Player',
          Manufacturer: 'Topps',
          'Card Number': '10',
          Features: ['Serial Numbered'],
        },
        yearEvidence: {
          year: '2023',
          sourceType: 'copyright_line',
          visibleText: '© 2023 TOPPS',
          imageIndex: 0,
        },
        warnings: [],
      }),
      { id: 'raw-response-numeric-grade' },
      { imageCount: 1 }
    );

    expect(draft.title).toBe('2023 Topps Serial Numbered 10/25 Player #10 9.5');
  });

  it('removes a bare number duplicating the canonical card number before the protected marker', () => {
    const draft = parseGeneratedDraft(
      JSON.stringify({
        title: '10 Topps Player #10',
        description: 'Single card.',
        aspects: {
          Player: 'Player',
          Manufacturer: 'Topps',
          'Card Number': '10',
        },
        yearEvidence: null,
        warnings: [],
      }),
      { id: 'raw-response-grade-before-card-number' }
    );

    expect(draft.title).toBe('Topps Player #10');
  });

  it.each(['Series 2', 'Insert 5'])('preserves legitimate numeric content in %s', (numericPart) => {
    const draft = parseGeneratedDraft(
      JSON.stringify({
        title: `Topps ${numericPart} Player #1`,
        description: 'Single card.',
        aspects: {
          Player: 'Player',
          Manufacturer: 'Topps',
          Features: numericPart === 'Insert 5' ? ['Insert 5'] : undefined,
          'Card Number': '1',
        },
        warnings: [],
      }),
      { id: `raw-response-${numericPart.replace(/\s+/gu, '-').toLocaleLowerCase()}` }
    );

    expect(draft.title).toBe(`Topps ${numericPart} Player #1`);
  });

  it('does not let malformed condition Features protect prohibited title wording', () => {
    const draft = parseGeneratedDraft(
      JSON.stringify({
        title: '2023 Topps Player Near Mint #10',
        description: 'Single card.',
        aspects: {
          Player: 'Player',
          Manufacturer: 'Topps',
          Features: ['Near Mint'],
        },
        yearEvidence: null,
        warnings: [],
      }),
      { id: 'raw-response-condition-feature' }
    );

    expect(draft.title).toBe('Topps Player #10');
  });

  it('does not reintroduce condition-only structured components after title sanitation', () => {
    const draft = parseGeneratedDraft(
      JSON.stringify({
        title: 'Topps Player #1',
        description: 'Single card.',
        aspects: {
          Player: 'Player',
          Manufacturer: 'Topps',
          Set: 'PSA 10',
          'Insert Set': 'Near Mint',
          'Parallel/Variety': 'EX',
          Franchise: 'Poor',
          'Card Number': '1',
        },
        warnings: [],
      }),
      { id: 'raw-response-condition-aspect-reintroduction' }
    );

    expect(draft.title).toBe('Topps Player #1');
  });

  it('strips a condition-only Set phrase even when no Player aspect triggers canonical rebuilding', () => {
    const draft = parseGeneratedDraft(
      JSON.stringify({
        title: 'Topps Near Mint #1',
        description: 'Single card.',
        aspects: {
          Manufacturer: 'Topps',
          Set: 'Near Mint',
          'Card Number': '1',
        },
        warnings: [],
      }),
      { id: 'raw-response-condition-set-no-player' }
    );

    expect(draft.title).toBe('Topps #1');
  });

  it('dedupes overlapping Set and Insert Set phrases across canonical slots', () => {
    const draft = parseGeneratedDraft(
      JSON.stringify({
        title: 'Skybox Metal Universe Metal Universe Planet Metal Player #1',
        description: 'Single card.',
        aspects: {
          Player: 'Player',
          Manufacturer: 'Skybox',
          Set: 'Metal Universe',
          'Insert Set': 'Metal Universe Planet Metal',
          'Card Number': '1',
        },
        warnings: [],
      }),
      { id: 'raw-response-overlapping-components' }
    );

    expect(draft.title).toBe('Skybox Metal Universe Planet Metal Player #1');
  });

  it('strips mixed condition prefixes from structured named components', () => {
    const draft = parseGeneratedDraft(
      JSON.stringify({
        title: 'Topps Heroes Gold Player #1',
        description: 'Single card.',
        aspects: {
          Player: 'Player',
          Manufacturer: 'Topps',
          'Insert Set': 'Near Mint Heroes',
          'Parallel/Variety': 'NM+ Gold',
          'Card Number': '1',
        },
        warnings: [],
      }),
      { id: 'raw-response-mixed-condition-components' }
    );

    expect(draft.title).toBe('Topps Heroes Gold Player #1');
  });

  it('does not preserve nested grade language in larger named components', () => {
    const draft = parseGeneratedDraft(
      JSON.stringify({
        title: 'Topps Adventure Collection Player #1',
        description: 'Single card.',
        aspects: {
          Player: 'Player',
          Manufacturer: 'Topps',
          'Insert Set': 'Excellent NM+ Adventure',
          'Parallel/Variety': 'Mint PSA 10 Collection',
          'Card Number': '1',
        },
        warnings: [],
      }),
      { id: 'raw-response-nested-condition-components' }
    );

    expect(draft.title).toBe('Topps Adventure Collection Player #1');
  });

  it('keeps a recognized Feature while removing mixed condition wording', () => {
    const draft = parseGeneratedDraft(
      JSON.stringify({
        title: '2023 Topps Player Near Mint Rookie Card #10',
        description: 'Single card.',
        aspects: {
          Player: 'Player',
          Manufacturer: 'Topps',
          Features: ['Near Mint Rookie Card'],
        },
        yearEvidence: null,
        warnings: [],
      }),
      { id: 'raw-response-mixed-condition-feature' }
    );

    expect(draft.title).toBe('Topps Rookie Card Player #10');
  });

  it('preserves the complete visible Rookie Card characteristic for a shorthand Feature', () => {
    const draft = parseGeneratedDraft(
      JSON.stringify({
        title: 'Topps Player Rookie Card #1',
        description: 'Single card.',
        aspects: {
          Player: 'Player',
          Manufacturer: 'Topps',
          Features: ['Rookie'],
          'Card Number': '1',
        },
        warnings: [],
      }),
      { id: 'raw-response-rookie-feature-shorthand' }
    );

    expect(draft.title).toBe('Topps Rookie Card Player #1');
  });

  it('preserves a serial identifier authorized by a Serial Numbered Feature', () => {
    const draft = parseGeneratedDraft(
      JSON.stringify({
        title: 'Topps Player #1 10/25',
        description: 'Single card.',
        aspects: {
          Player: 'Player',
          Manufacturer: 'Topps',
          Features: ['Serial Numbered'],
          'Card Number': '1',
        },
        warnings: [],
      }),
      { id: 'raw-response-serial-feature' }
    );

    expect(draft.title).toBe('Topps Serial Numbered 10/25 Player #1');
  });

  it('preserves an official Set occurrence while stripping a later condition occurrence', () => {
    const draft = parseGeneratedDraft(
      JSON.stringify({
        title: 'Topps Mint Player #1 Near Mint',
        description: 'Single card.',
        aspects: {
          Player: 'Player',
          Manufacturer: 'Topps',
          Set: 'Mint',
        },
        yearEvidence: null,
        warnings: [],
      }),
      { id: 'raw-response-repeated-set-word' }
    );

    expect(draft.title).toBe('Topps Mint Player #1');
  });

  it('skips an earlier condition occurrence when selecting the official Set phrase', () => {
    const draft = parseGeneratedDraft(
      JSON.stringify({
        title: 'Near Mint Topps Mint Player #1',
        description: 'Single card.',
        aspects: {
          Player: 'Player',
          Manufacturer: 'Topps',
          Set: 'Mint',
        },
        yearEvidence: null,
        warnings: [],
      }),
      { id: 'raw-response-set-after-condition' }
    );

    expect(draft.title).toBe('Topps Mint Player #1');
  });

  it('does not duplicate an existing canonical title year or protected four-digit card number', () => {
    const draft = parseGeneratedDraft(
      JSON.stringify({
        title: 'Phil Rizzuto 1951 Topps #1951 1951',
        description: 'Single card.',
        cardConditionToken: null,
        aspects: {
          Player: 'Phil Rizzuto',
          Manufacturer: 'Topps',
        },
        yearEvidence: {
          year: '1951',
          sourceType: 'copyright_line',
          visibleText: '© 1951 TOPPS',
          imageIndex: 0,
        },
        warnings: [],
      }),
      { id: 'raw-response-deduped-year' },
      { imageCount: 1 }
    );

    expect(draft.title).toBe('1951 Topps Phil Rizzuto #1951');
  });

  it('sanitizes array-valued Set entries individually', () => {
    const draft = parseGeneratedDraft(
      JSON.stringify({
        title: 'Mickey Mantle Bowman Color',
        description: 'Single card.',
        aspects: {
          Player: 'Mickey Mantle',
          Manufacturer: 'Bowman',
          Set: ['1953 Bowman Color', 'Bowman Color 1953'],
        },
        yearEvidence: null,
        warnings: [],
      }),
      { id: 'raw-response-6b' },
      { imageCount: 1 }
    );

    expect(draft.aspects).toMatchObject({
      Manufacturer: 'Bowman',
      Set: 'Bowman Color',
    });
  });

  it('removes array-valued Year and Season without evidence', () => {
    const draft = parseGeneratedDraft(
      JSON.stringify({
        title: 'Phil Rizzuto 1951 Topps #17',
        description: 'Single card.',
        aspects: {
          Player: 'Phil Rizzuto',
          Manufacturer: 'Topps',
          Year: ['1951'],
          Season: ['1951', '1951-52'],
          Set: ['1951 Topps'],
        },
        yearEvidence: null,
        warnings: [],
      }),
      { id: 'raw-response-6c' },
      { imageCount: 1 }
    );

    expect(draft.aspects).toEqual({
      Player: 'Phil Rizzuto',
      Manufacturer: 'Topps',
      Set: 'Topps',
      'Card Number': '17',
    });
  });

  it('normalizes conflicting set years even when validated Year differs', () => {
    const draft = parseGeneratedDraft(
      JSON.stringify({
        title: '1954 Topps Phil Rizzuto #17',
        description: 'Single card.',
        aspects: {
          Player: 'Phil Rizzuto',
          Manufacturer: 'Topps',
          Set: '1951 Topps',
          Year: '1954',
        },
        yearEvidence: {
          year: '1954',
          sourceType: 'copyright_line',
          visibleText: '© 1954 THE TOPPS COMPANY, INC.',
          imageIndex: 0,
        },
        warnings: [],
      }),
      { id: 'raw-response-6d' },
      { imageCount: 1 }
    );

    expect(draft.aspects).toMatchObject({
      Manufacturer: 'Topps',
      Set: 'Topps',
      Year: '1954',
    });
  });

  it('drops Year and Season from incomplete yearEvidence payloads', () => {
    const draft = parseGeneratedDraft(
      JSON.stringify({
        title: '1986 Fleer Michael Jordan #57',
        description: 'Single card.',
        aspects: {
          Player: 'Michael Jordan',
          Manufacturer: 'Fleer',
          Year: '1986',
          Season: '1986-87',
        },
        yearEvidence: {
          year: '1986',
          sourceType: 'copyright_line',
        },
        warnings: [],
      }),
      { id: 'raw-response-7' },
      { imageCount: 1 }
    );

    expect(draft.aspects).toEqual({
      Player: 'Michael Jordan',
      Manufacturer: 'Fleer',
      'Card Number': '57',
    });
    expect(draft.yearEvidence).toBeNull();
    expect(draft.warnings).toContain(
      'Gemini response field "yearEvidence" was incomplete and was discarded.'
    );
  });

  it('derives Print Run and Serial Numbered from validated visible serial evidence', () => {
    const draft = parseGeneratedDraft(
      JSON.stringify({
        title: '1997 Topps Derek Jeter #10 037/199',
        description: 'Serial numbered single card.',
        aspects: {
          Player: 'Derek Jeter',
          Manufacturer: 'Topps',
          Features: ['Rookie'],
        },
        serialEvidence: {
          visibleText: 'Serial Numbered 037/199',
          imageIndex: 1,
          numerator: 37,
          denominator: 199,
        },
        yearEvidence: null,
        warnings: [],
      }),
      { id: 'raw-response-serial-evidence' },
      { imageCount: 2 }
    );

    expect(draft.serialEvidence).toEqual({
      visibleText: 'Serial Numbered 037/199',
      imageIndex: 1,
      numerator: 37,
      denominator: 199,
    });
    expect(draft.aspects).toMatchObject({
      'Print Run': '199',
      Features: ['Rookie', 'Serial Numbered'],
    });
  });

  it('rejects direct free-form Print Run output without serial evidence', () => {
    const draft = parseGeneratedDraft(
      JSON.stringify({
        title: 'Derek Jeter #10',
        description: 'Single card.',
        aspects: { Player: 'Derek Jeter', 'Print Run': '199' },
        yearEvidence: null,
        warnings: [],
      }),
      { id: 'raw-response-direct-print-run' },
      { imageCount: 1 }
    );

    expect(draft.aspects).not.toHaveProperty('Print Run');
    expect(draft.warnings).toContain(
      'Gemini response aspects discarded unexpected keys: "Print Run".'
    );
  });

  it.each([
    { visibleText: '#25', numerator: 2, denominator: 5 },
    { visibleText: 'Card #10 of 25', numerator: 10, denominator: 25 },
    { visibleText: '037/200', numerator: 37, denominator: 199 },
    { visibleText: '037/199 and 010/025', numerator: 37, denominator: 199 },
  ])('fails closed for ambiguous or inconsistent serial evidence %#', (serialEvidence) => {
    const draft = parseGeneratedDraft(
      JSON.stringify({
        title: 'Derek Jeter #10',
        description: 'Single card.',
        aspects: { Player: 'Derek Jeter' },
        serialEvidence,
        yearEvidence: null,
        warnings: [],
      }),
      { id: 'raw-response-invalid-serial' },
      { imageCount: 1 }
    );

    expect(draft.serialEvidence).toBeNull();
    expect(draft.aspects).not.toHaveProperty('Print Run');
    expect(draft.aspects).not.toHaveProperty('Features');
    expect(draft.warnings.some((warning) => warning.includes('serialEvidence'))).toBe(true);
  });

  it('rejects serial evidence that merely repeats the generated title', () => {
    const draft = parseGeneratedDraft(
      JSON.stringify({
        title: 'Derek Jeter 037/199',
        description: 'Single card.',
        aspects: { Player: 'Derek Jeter' },
        serialEvidence: {
          visibleText: 'Derek Jeter 037/199',
          imageIndex: 0,
          numerator: 37,
          denominator: 199,
        },
        yearEvidence: null,
        warnings: [],
      }),
      { id: 'raw-response-title-only-serial' },
      { imageCount: 1 }
    );

    expect(draft.serialEvidence).toBeNull();
    expect(draft.aspects).not.toHaveProperty('Print Run');
  });

  it.each([
    ['zero numerator', { visibleText: '000/199', numerator: 0, denominator: 199, imageIndex: 0 }],
    ['zero denominator', { visibleText: '037/000', numerator: 37, denominator: 0, imageIndex: 0 }],
    ['negative numerator', { visibleText: '037/199', numerator: -37, denominator: 199, imageIndex: 0 }],
    ['negative denominator', { visibleText: '037/199', numerator: 37, denominator: -199, imageIndex: 0 }],
    ['non-integer numerator', { visibleText: '037/199', numerator: 37.5, denominator: 199, imageIndex: 0 }],
    ['non-number denominator', { visibleText: '037/199', numerator: 37, denominator: '199', imageIndex: 0 }],
    ['numerator exceeds denominator', { visibleText: '199/037', numerator: 199, denominator: 37, imageIndex: 0 }],
    ['image index outside supplied images', { visibleText: '037/199', numerator: 37, denominator: 199, imageIndex: 1 }],
  ])('fails closed for serialEvidence %s', (_label, serialEvidence) => {
    const draft = parseGeneratedDraft(
      JSON.stringify({
        title: 'Derek Jeter #10',
        description: 'Single card.',
        aspects: { Player: 'Derek Jeter' },
        serialEvidence,
        yearEvidence: null,
        warnings: [],
      }),
      { id: 'raw-response-invalid-serial-contract' },
      { imageCount: 1 }
    );

    expect(draft.serialEvidence).toBeNull();
    expect(draft.aspects).not.toHaveProperty('Print Run');
    expect(draft.warnings.some((warning) => warning.includes('serialEvidence'))).toBe(true);
  });

  it.each([
    ['#1951', 'Topps Phil Rizzuto #1951'],
    ['No. 1951', 'Topps Phil Rizzuto #1951'],
    ['No 1951', 'Topps Phil Rizzuto #1951'],
    ['Card 1951', 'Topps Phil Rizzuto #1951'],
    ['Card #1951', 'Topps Phil Rizzuto #1951'],
    ['Card No. 1951', 'Topps Phil Rizzuto #1951'],
    ['Card No 1951', 'Topps Phil Rizzuto #1951'],
    ['Card Number 1951', 'Topps Phil Rizzuto #1951'],
  ])(
    'preserves protected four-digit card-number form %s while stripping unsupported year',
    (cardForm, expectedTitle) => {
      const draft = parseGeneratedDraft(
        JSON.stringify({
          title: `Phil Rizzuto 1951 Topps ${cardForm}`,
          description: 'Single card.',
          aspects: {
            Player: 'Phil Rizzuto',
            Manufacturer: 'Topps',
            Set: '1951 Topps',
          },
          yearEvidence: null,
          warnings: [],
        }),
        { id: `raw-response-${cardForm}` },
        { imageCount: 1 }
      );

      expect(draft.title).toBe(expectedTitle);
      expect(draft.aspects.Set).toBe('Topps');
    }
  );

  it('compacts long preferred characteristics as whole phrases while retaining identity', () => {
    const longParallel = 'Supercalifragilisticexpi Parallel Variety';
    const draft = parseGeneratedDraft(
      JSON.stringify({
        title:
          '2023 Topps Chrome Supercalifragilisticexpi Parallel Variety Extremely Long Insert Name Player #1 Boston Celtics',
        description: 'Single card.',
        aspects: {
          Player: 'Player',
          Manufacturer: 'Topps',
          Set: 'Chrome',
          'Parallel/Variety': longParallel,
          'Card Number': '1',
          Franchise: 'Boston Celtics',
        },
        yearEvidence: null,
        warnings: [],
      }),
      { id: 'raw-response-long-characteristic' }
    );

    expect(draft.title.length).toBeLessThanOrEqual(80);
    expect(draft.title).toContain('Player #1');
    expect(draft.title.includes(longParallel) || !draft.title.includes('Supercalifragilisticexpi')).toBe(
      true
    );
  });

  it('compacts the Shelden Williams overflow shape and reports semantic diagnostics', () => {
    const preCompactionTitle =
      '2006 Topps Chrome Refractor Parallel Variation Rookie Card Serial Numbered 12/99 Shelden Williams #123 Boston Celtics';
    const compactedTitle = '2006 Rookie Card Serial Numbered 12/99 Shelden Williams #123';
    const draft = parseGeneratedDraft(
      JSON.stringify({
        title:
          'Shelden Williams 2006-07 Topps Chrome Refractor Rookie Card Parallel Variation Boston Celtics #123 12/99',
        description: 'Single card.',
        aspects: {
          Player: 'Shelden Williams',
          Manufacturer: 'Topps',
          Set: 'Chrome',
          'Parallel/Variety': 'Refractor Parallel Variation',
          Features: ['Rookie Card', 'Serial Numbered'],
          'Card Number': '123',
          Franchise: 'Boston Celtics',
        },
        yearEvidence: {
          year: '2006',
          sourceType: 'copyright_line',
          visibleText: '2006',
          imageIndex: 0,
        },
        warnings: [],
      }),
      { id: 'raw-response-shelden-williams-overflow' }
    );

    expect(draft.title).toBe(compactedTitle);
    expect(draft.title).toHaveLength(60);
    expect(draft.title).toContain('2006');
    expect(draft.title).toContain('Shelden Williams');
    expect(draft.title).toContain('#123');
    expect(draft.title).toContain('12/99');
    expect(draft.title).toContain('Rookie Card');
    expect(draft.title).toContain('Serial Numbered');
    expect(draft.title).not.toContain('Boston Celtics');
    const warning = draft.warnings.find((entry) => entry.startsWith('Generated listing title compacted'));
    expect(warning).toContain('from 117 to 60 characters');
    expect(warning).toContain(`pre="${preCompactionTitle}"`);
    expect(warning).toContain(`final="${compactedTitle}"`);
    expect(warning).toContain('omitted=');
  });

  it('retains validated serial fraction through semantic compaction', () => {
    const draft = parseGeneratedDraft(
      JSON.stringify({
        title: '2023 Topps Chrome Refractor Player #1 Boston Celtics',
        description: 'Single card.',
        aspects: { Player: 'Player', Manufacturer: 'Topps', Set: 'Chrome', 'Card Number': '1' },
        serialEvidence: {
          visibleText: 'Serial Number 012345/999999',
          imageIndex: 0,
          numerator: 12345,
          denominator: 999999,
        },
        yearEvidence: null,
        warnings: [],
      }),
      { id: 'raw-response-serial-compaction' },
      { imageCount: 1 }
    );

    expect(draft.title).toContain('012345/999999');
    expect(draft.title.length).toBeLessThanOrEqual(80);
  });

  it('preserves leading-zero serial formatting through overflow compaction', () => {
    const draft = parseGeneratedDraft(
      JSON.stringify({
        title:
          'Shelden Williams 2006-07 Topps Chrome Refractor Rookie Card Parallel Variation Boston Celtics #123 37/199',
        description: 'Single card.',
        aspects: {
          Player: 'Shelden Williams',
          Manufacturer: 'Topps',
          Set: 'Chrome',
          'Parallel/Variety': 'Refractor Parallel Variation',
          Features: ['Rookie Card', 'Serial Numbered'],
          'Card Number': '123',
          Franchise: 'Boston Celtics',
        },
        serialEvidence: {
          visibleText: 'Serial Number 037/199',
          imageIndex: 0,
          numerator: 37,
          denominator: 199,
        },
        yearEvidence: {
          year: '2006',
          sourceType: 'copyright_line',
          visibleText: '2006',
          imageIndex: 0,
        },
        warnings: [],
      }),
      { id: 'raw-response-leading-zero-serial-overflow' },
      { imageCount: 1 }
    );

    expect(draft.title.length).toBeLessThanOrEqual(80);
    expect(draft.title).toContain('2006');
    expect(draft.title).toContain('Shelden Williams');
    expect(draft.title).toContain('#123');
    expect(draft.title).toContain('037/199');
    expect(draft.title).not.toMatch(/(?<!0)37\/199/u);
  });

  it('uses the protected-only fallback for an 81+ character Player-only title', () => {
    const player = 'Shelden Williams';
    const draft = parseGeneratedDraft(
      JSON.stringify({
        title: `${player} ${'Unstructured filler '.repeat(4)}`.trim(),
        description: 'Single card.',
        aspects: { Player: player },
        warnings: [],
      }),
      { id: 'raw-response-player-only-overflow' }
    );

    expect(draft.title).toBe(player);
    expect(draft.warnings.at(-1)).toContain('omitted=unstructured-title-content');
  });

  it('keeps validated serial evidence before Player in the protected-only fallback', () => {
    const player = 'Shelden Williams';
    const draft = parseGeneratedDraft(
      JSON.stringify({
        title: `${player} ${'Unstructured filler '.repeat(4)}`.trim(),
        description: 'Single card.',
        aspects: { Player: player },
        serialEvidence: {
          visibleText: '12345/999999',
          imageIndex: 0,
          numerator: 12345,
          denominator: 999999,
        },
        warnings: [],
      }),
      { id: 'raw-response-player-serial-only-overflow' },
      { imageCount: 1 }
    );

    expect(draft.title).toBe(`12345/999999 ${player}`);
  });

  it('is idempotent after semantic compaction', () => {
    const draft = parseGeneratedDraft(
      JSON.stringify({
        title:
          'Shelden Williams 2006-07 Topps Chrome Refractor Rookie Card Parallel Variation Boston Celtics #123 12/99',
        description: 'Single card.',
        aspects: {
          Player: 'Shelden Williams',
          Manufacturer: 'Topps',
          Set: 'Chrome',
          'Parallel/Variety': 'Refractor Parallel Variation',
          Features: ['Rookie Card', 'Serial Numbered'],
          'Card Number': '123',
          Franchise: 'Boston Celtics',
        },
        yearEvidence: {
          year: '2006',
          sourceType: 'copyright_line',
          visibleText: '2006',
          imageIndex: 0,
        },
        warnings: [],
      }),
      { id: 'raw-response-idempotent' }
    );
    expect(draft.warnings.some((warning) => warning.startsWith('Generated listing title compacted'))).toBe(
      true
    );
    const again = normalizeGeneratedDraft({
      title: draft.title,
      aspects: draft.aspects,
      warnings: draft.warnings,
      yearEvidence: draft.yearEvidence,
    });
    expect(again.title).toBe(draft.title);
    expect(again.warnings).toEqual(draft.warnings);
  });
});
