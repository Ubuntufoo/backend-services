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
