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
});
