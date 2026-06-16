import { describe, expect, it } from 'vitest';

import { buildSoldCompsQuery } from '@/pricing/index.js';

describe('buildSoldCompsQuery', () => {
  const baseInput = {
    categoryId: '261328',
    conditionId: '2750',
    itemSpecifics: {
      'Card Number': '136',
      Manufacturer: 'Panini',
      Player: 'Victor Wembanyama',
      Set: 'Prizm',
      Year: '2023',
    },
    listingId: 'LIST-001',
    listingType: 'single' as const,
    requestedCompCount: 20,
    title: '2023 Panini Prizm Victor Wembanyama Rookie Card PSA 10',
  };

  it('builds canonical query for graded single-card listing', () => {
    expect(buildSoldCompsQuery(baseInput)).toBe('Victor Wembanyama 2023 Panini Prizm #136 PSA 10');
  });

  it('preserves Johnny Riddle canonical query exactly', () => {
    expect(
      buildSoldCompsQuery({
        categoryId: '261328',
        conditionId: '4000',
        itemSpecifics: {
          'Card Number': '#98',
          Manufacturer: 'Topps',
          Player: 'Johnny Riddle',
          Set: 'Topps Johnny Riddle 98',
          Year: '1955',
        },
        listingId: 'Single-000007',
        listingType: 'single',
        requestedCompCount: 20,
        title: 'Johnny Riddle 1955 Topps #98 St. Louis Cardinals Coach',
      })
    ).toBe('Johnny Riddle 1955 Topps #98');
  });

  it('de-dupes repeated parallel signals across title and specifics', () => {
    expect(
      buildSoldCompsQuery({
        ...baseInput,
        conditionId: '4000',
        itemSpecifics: {
          ...baseInput.itemSpecifics,
          Features: ['Silver', 'Prizm'],
          'Parallel/Variety': 'Silver Prizm',
        },
        title: '2023 Panini Prizm Victor Wembanyama Silver Prizm Rookie Card',
      })
    ).toBe('Victor Wembanyama 2023 Panini Prizm #136 Silver');
  });

  it('uses explicit title card-number markers when specifics omit card number', () => {
    expect(
      buildSoldCompsQuery({
        ...baseInput,
        conditionId: '4000',
        itemSpecifics: {
          Manufacturer: 'Topps',
          Player: 'Johnny Riddle',
          Year: '1955',
        },
        title: 'Johnny Riddle 1955 Topps Card No. 98 St. Louis Cardinals Coach',
      })
    ).toBe('Johnny Riddle 1955 Topps #98');
  });

  it.each([
    ['1993-94 NBA Hoops Michael Jordan #536', 'Michael Jordan 1993 NBA Hoops #536'],
    ['92-93 NBA Hoops Michael Jordan #536', 'Michael Jordan 1992 NBA Hoops #536'],
  ])('normalizes season range in query title "%s"', (title, expectedQuery) => {
    expect(
      buildSoldCompsQuery({
        ...baseInput,
        conditionId: '4000',
        itemSpecifics: {
          'Card Number': '536',
          Manufacturer: 'NBA Hoops',
          Player: 'Michael Jordan',
          Set: 'NBA Hoops',
        },
        title,
      })
    ).toBe(expectedQuery);
  });

  it('does not infer bare title numbers as card numbers without explicit marker', () => {
    expect(
      buildSoldCompsQuery({
        ...baseInput,
        conditionId: '4000',
        itemSpecifics: {
          Manufacturer: 'Topps',
          Player: 'Johnny Riddle',
          Year: '1955',
        },
        title: 'Johnny Riddle 1955 Topps 98 St. Louis Cardinals Coach',
      })
    ).toBe('Johnny Riddle 1955 Topps');
  });

  it('keeps lot queries broader and includes lot signal', () => {
    expect(
      buildSoldCompsQuery({
        ...baseInput,
        conditionId: '4000',
        listingType: 'lot',
        title: '2023 Panini Prizm Victor Wembanyama Lot of 3 Rookie Cards',
      })
    ).toBe('Victor Wembanyama 2023 Panini Prizm lot');
  });

  it('falls back to minimal safe title tokens when identity sparse', () => {
    expect(
      buildSoldCompsQuery({
        categoryId: '261328',
        conditionId: null,
        itemSpecifics: undefined,
        listingId: 'LIST-EMPTY',
        listingType: 'single',
        requestedCompCount: 20,
        title: 'Vintage trading card',
      })
    ).toBe('Vintage');
  });

  it('uses alias fields when primary item specifics absent', () => {
    expect(
      buildSoldCompsQuery({
        categoryId: '261328',
        conditionId: '4000',
        itemSpecifics: {
          Athlete: 'Johnny Riddle',
          Brand: 'Topps',
          'Card Manufacturer': 'Topps',
          'Insert Set': 'All-Star',
          Product: 'Johnny Riddle 1955 Topps 98',
          Season: '1955',
        },
        listingId: 'Single-000007',
        listingType: 'single',
        requestedCompCount: 20,
        title: 'Johnny Riddle 1955 Topps #98 St. Louis Cardinals Coach',
      })
    ).toBe('Johnny Riddle 1955 Topps #98 All-Star');
  });
});
