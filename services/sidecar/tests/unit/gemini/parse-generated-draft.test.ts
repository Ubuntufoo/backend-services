import { describe, expect, it } from 'vitest';
import { parseGeneratedDraft } from '@/gemini/index.js';

describe('parseGeneratedDraft', () => {
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
      Athlete: 'Johnny Riddle',
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

    expect(draft.title).toBe('Phil Rizzuto Topps #1951');
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

    expect(draft.title).toBe('Ed Stanky Topps #191');
    expect(draft.aspects).toEqual({
      Player: 'Ed Stanky',
      Manufacturer: 'Topps',
      Set: 'Topps',
      'Card Number': '191',
    });
    expect(draft.yearEvidence).toBeNull();
    expect(draft.warnings).toContain('Gemini response field "yearEvidence.sourceType" was invalid and was discarded.');
    expect(draft.warnings).toContain('Gemini response field "yearEvidence" was incomplete and was discarded.');
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

    expect(draft.title).toBe('Phil Rizzuto Bowman #17');
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

    expect(draft.title).toBe('Ryne Sandberg 1993 Fleer Team Leaders #6 of 10');
  });

  it.each([
    [
      'after the player when manufacturer is unavailable',
      'Ryne Sandberg Team Leaders #6 of 10',
      { Player: 'Ryne Sandberg' },
      'Ryne Sandberg 1993 Team Leaders #6 of 10',
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

  it('combines canonical year insertion with one NM+ suffix for near-mint-or-better cards', () => {
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

    expect(draft.title).toBe('Ryne Sandberg 1993 Fleer Team Leaders #6 of 10 NM+');
  });

  it('fails closed instead of compacting semantic title content over 80 characters', () => {
    const title =
      'Ryne Sandberg Fleer Team Leaders Limited Edition Premium Collector Parallel Insert #6';

    expect(() =>
      parseGeneratedDraft(
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
      )
    ).toThrow('Generated listing title exceeds 80 characters after backend normalization.');
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

    expect(() =>
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
    ).toThrow('Generated listing title exceeds 80 characters after backend normalization.');
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

      expect(draft.title).toBe('Ryne Sandberg Fleer Team Leaders #6 of 10');
    }
  );

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

    expect(draft.title).toBe('Phil Rizzuto 1951 Topps #1951');
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
    expect(draft.warnings).toContain('Gemini response field "yearEvidence" was incomplete and was discarded.');
  });

  it.each([
    ['#1951', 'Phil Rizzuto Topps #1951'],
    ['No. 1951', 'Phil Rizzuto Topps No. 1951'],
    ['No 1951', 'Phil Rizzuto Topps No 1951'],
    ['Card 1951', 'Phil Rizzuto Topps Card 1951'],
    ['Card #1951', 'Phil Rizzuto Topps Card #1951'],
    ['Card No. 1951', 'Phil Rizzuto Topps Card No. 1951'],
    ['Card No 1951', 'Phil Rizzuto Topps Card No 1951'],
    ['Card Number 1951', 'Phil Rizzuto Topps Card Number 1951'],
  ])('preserves protected four-digit card-number form %s while stripping unsupported year', (cardForm, expectedTitle) => {
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
  });
});
