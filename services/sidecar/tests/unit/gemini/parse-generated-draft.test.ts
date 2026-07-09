import { describe, expect, it } from 'vitest';
import { normalizeGeneratedDraft, parseGeneratedDraft } from '@/gemini/index.js';

describe('parseGeneratedDraft normalization', () => {
  it('normalizes alias fields and title-derived card number for Johnny Riddle', () => {
    const draft = parseGeneratedDraft(
      JSON.stringify({
        title: 'Johnny Riddle 1955 Topps #98 St. Louis Cardinals Coach',
        description: 'Vintage single card.',
        aspects: {
          'Card Manufacturer': 'Topps',
          Season: '1955',
        },
        warnings: [],
      }),
      { id: 'raw-response-1' }
    );

    expect(draft.aspects).toMatchObject({
      'Card Manufacturer': 'Topps',
      Manufacturer: 'Topps',
      Season: '1955',
      Year: '1955',
      'Card Number': '98',
    });
  });

  it('strips leading hash from existing card number values', () => {
    const normalized = normalizeGeneratedDraft({
      title: '1955 Topps Johnny Riddle',
      aspects: {
        'Card Number': '#98B',
      },
      warnings: [],
    });

    expect(normalized.aspects['Card Number']).toBe('98B');
  });

  it('normalizes Player/Athlete alias to canonical Player when Player is missing', () => {
    const normalized = normalizeGeneratedDraft({
      title: 'Johnny Riddle 1955 Topps #98 St. Louis Cardinals Coach',
      aspects: {
        'Player/Athlete': 'Johnny Riddle',
      },
      warnings: [],
    });

    expect(normalized.aspects.Player).toBe('Johnny Riddle');
    expect(normalized.aspects['Player/Athlete']).toBe('Johnny Riddle');
  });

  it('keeps explicit card number when title-derived value conflicts and adds warning', () => {
    const normalized = normalizeGeneratedDraft({
      title: 'Johnny Riddle 1955 Topps #98 St. Louis Cardinals Coach',
      aspects: {
        'Card Number': '147',
      },
      warnings: [],
    });

    expect(normalized.aspects['Card Number']).toBe('147');
    expect(normalized.warnings).toContain(
      'Gemini response title card number "98" conflicted with aspects["Card Number"] "147"; kept aspect value.'
    );
  });

  it('drops canonical year aspects and guessed title year when yearEvidence marks the year unverified', () => {
    const draft = parseGeneratedDraft(
      JSON.stringify({
        title: 'Ed Stanky 1952 Topps #191',
        description: 'Vintage single card.',
        aspects: {
          Player: 'Ed Stanky',
          Year: '1952',
          Season: '1952',
          Manufacturer: 'Topps',
          'Card Number': '191',
        },
        yearEvidence: {
          isVerified: false,
          likelyYear: '1955',
          likelyYearRange: '1952-1955',
          warningCode: 'year_unverified',
        },
        warnings: ['Year not visible on the card.'],
      }),
      { id: 'raw-response-2' }
    );

    expect(draft.aspects).toEqual({
      Player: 'Ed Stanky',
      Manufacturer: 'Topps',
      'Card Number': '191',
    });
    expect(draft.title).toBe('Ed Stanky Topps #191');
    expect(draft.yearEvidence).toEqual({
      isVerified: false,
      likelyYear: '1955',
      likelyYearRange: '1952-1955',
      warningCode: 'year_unverified',
    });
    expect(draft.warnings).toContain('Year not visible on the card.');
  });

  it('treats contradictory yearEvidence as unverified when warningCode forces year_unverified', () => {
    const draft = parseGeneratedDraft(
      JSON.stringify({
        title: 'Ed Stanky 1952 Topps #191',
        description: 'Vintage single card.',
        aspects: {
          Player: 'Ed Stanky',
          Year: '1952',
          Manufacturer: 'Topps',
          'Card Number': '191',
        },
        yearEvidence: {
          isVerified: true,
          likelyYear: '1955',
          likelyYearRange: '1952-1955',
          warningCode: 'year_unverified',
        },
        warnings: [],
      }),
      { id: 'raw-response-3' }
    );

    expect(draft.title).toBe('Ed Stanky Topps #191');
    expect(draft.aspects).toEqual({
      Player: 'Ed Stanky',
      Manufacturer: 'Topps',
      'Card Number': '191',
    });
    expect(draft.yearEvidence).toEqual({
      isVerified: false,
      likelyYear: '1955',
      likelyYearRange: '1952-1955',
      warningCode: 'year_unverified',
    });
    expect(draft.warnings).toContain(
      'Gemini response yearEvidence marked the year both verified and unverified; treated it as unverified.'
    );
  });
});
