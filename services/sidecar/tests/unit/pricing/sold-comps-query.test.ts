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
    expect(buildSoldCompsQuery(baseInput)).toBe('Victor Wembanyama 2023 Panini Prizm 136 PSA 10');
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
    ).toBe('Johnny Riddle 1955 Topps 98');
  });

  it('strips noisy sport terms from set values', () => {
    expect(
      buildSoldCompsQuery({
        categoryId: '261328',
        conditionId: '4000',
        itemSpecifics: {
          'Card Number': '125',
          Manufacturer: 'Topps',
          Player: 'John Hadl',
          Set: 'Topps Football',
          Sport: 'Football',
          Year: '1966',
        },
        listingId: 'Single-000014',
        listingType: 'single',
        requestedCompCount: 20,
        title: '1966 Topps Football #125 John Hadl',
      })
    ).toBe('John Hadl 1966 Topps 125');
  });

  it('strips noisy role fragments instead of mining title leftovers', () => {
    expect(
      buildSoldCompsQuery({
        categoryId: '261328',
        conditionId: '4000',
        itemSpecifics: {
          'Card Number': '#98',
          Manufacturer: 'Topps',
          Player: 'Johnny Riddle',
          Set: 'Topps Johnny Riddle 98 Coach',
          Year: '1955',
        },
        listingId: 'Single-000007',
        listingType: 'single',
        requestedCompCount: 20,
        title: 'Johnny Riddle 1955 Topps #98 St. Louis Cardinals Coach',
      })
    ).toBe('Johnny Riddle 1955 Topps 98');
  });

  it('strips noisy position fragments from structured product values', () => {
    expect(
      buildSoldCompsQuery({
        categoryId: '261328',
        conditionId: '4000',
        itemSpecifics: {
          'Card Number': '179',
          Manufacturer: 'Fleer',
          Player: 'Darryl Strawberry',
          Set: 'Fleer 3rd Base',
          Year: '1997',
        },
        listingId: 'Single-000179',
        listingType: 'single',
        requestedCompCount: 20,
        title: 'Darryl Strawberry 1997 Fleer #179 3rd Base',
      })
    ).toBe('Darryl Strawberry 1997 Fleer 179');
  });

  it('normalizes manufacturer and set league suffixes while preserving real multi-token sets', () => {
    expect(
      buildSoldCompsQuery({
        categoryId: '261328',
        conditionId: '4000',
        itemSpecifics: {
          'Card Number': '536',
          Manufacturer: 'Hoops NBA',
          Player: 'Michael Jordan',
          Set: 'Hoops NBA',
          Year: '1991',
        },
        listingId: 'Single-000536',
        listingType: 'single',
        requestedCompCount: 20,
        title: 'Michael Jordan 1991 Hoops NBA #536',
      })
    ).toBe('Michael Jordan 1991 Hoops 536');
    expect(
      buildSoldCompsQuery({
        categoryId: '261328',
        conditionId: '4000',
        itemSpecifics: {
          'Card Number': '45',
          Manufacturer: 'Fleer',
          Player: 'Ken Griffey Jr.',
          Set: 'Fleer Ultra',
          Year: '1994',
        },
        listingId: 'Single-000045',
        listingType: 'single',
        requestedCompCount: 20,
        title: 'Ken Griffey Jr. 1994 Fleer Ultra #45',
      })
    ).toBe('Ken Griffey Jr. 1994 Fleer Ultra 45');
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
    ).toBe('Johnny Riddle 1955 Topps 98');
  });

  it.each([
    ['1993-94 NBA Hoops Michael Jordan #536', 'Michael Jordan 1993 Hoops 536'],
    ['92-93 NBA Hoops Michael Jordan #536', 'Michael Jordan 1992 Hoops 536'],
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
          Product: 'Johnny Riddle 1955 Topps 98',
          Season: '1955',
        },
        listingId: 'Single-000007',
        listingType: 'single',
        requestedCompCount: 20,
        title: 'Johnny Riddle 1955 Topps #98 St. Louis Cardinals Coach',
      })
    ).toBe('Johnny Riddle 1955 Topps 98');
  });

  it('uses bare card number token for SoldComps exact-card query broadening', () => {
    expect(
      buildSoldCompsQuery({
        ...baseInput,
        conditionId: '4000',
        itemSpecifics: {
          'Card Number': '20',
          Manufacturer: 'Topps',
          Player: 'Pete Maravich',
          Set: 'Topps',
          Year: '1977',
        },
        title: 'Pete Maravich 1977 Topps #20',
      })
    ).toBe('Pete Maravich 1977 Topps 20');
  });
});
