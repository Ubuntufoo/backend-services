import {
  computePricingStats,
  createFixturePricingProvider,
  GRADED_PROVIDER_TERMS,
  normalizeSoldComps,
  type NormalizeSoldCompsContext,
  type RawSoldComp,
} from '@/pricing/index.js';

describe('normalizeSoldComps', () => {
  it('normalizes fixture provider output to at least 12 comps', async () => {
    const provider = createFixturePricingProvider();
    const result = await provider.fetchSoldComps({
      listingId: 'listing-123',
      title: 'Victor Wembanyama rookie card',
    });

    const normalized = normalizeSoldComps(result.soldComps);

    expect(normalized.comps.length).toBeGreaterThan(0);
    expect(normalized.comps.length + normalized.rejected.length).toBeGreaterThanOrEqual(12);
    expect(normalized.comps[0]).toMatchObject({
      source: 'provider',
      price: { currency: 'USD' },
      totalPrice: { currency: 'USD' },
    });
  });

  it('trims title', () => {
    const normalized = normalizeSoldComps([buildRawComp({ title: '  Test Title  ' })]);

    expect(normalized.comps[0]?.title).toBe('Test Title');
  });

  it('rejects blank title', () => {
    const normalized = normalizeSoldComps([buildRawComp({ title: '   ' })]);

    expect(normalized.comps).toEqual([]);
    expect(normalized.rejected).toEqual([{ index: 0, reason: 'blank_title', title: null }]);
  });

  it('requires positive finite price', () => {
    expect(normalizeSoldComps([buildRawComp({ price: { value: 0, currency: 'USD' } })]).rejected).toEqual([
      { index: 0, reason: 'invalid_price', title: 'Sample Title' },
    ]);
    expect(
      normalizeSoldComps([buildRawComp({ price: { value: Number.POSITIVE_INFINITY, currency: 'USD' } })]).rejected,
    ).toEqual([{ index: 0, reason: 'invalid_price', title: 'Sample Title' }]);
  });

  it('accepts zero shipping', () => {
    const normalized = normalizeSoldComps([buildRawComp({ shippingPrice: { value: 0, currency: 'USD' } })]);

    expect(normalized.rejected).toEqual([]);
    expect(normalized.comps[0]?.shippingPrice).toEqual({ value: 0, currency: 'USD' });
  });

  it('accepts missing and null shipping as null', () => {
    const missingShipping = normalizeSoldComps([buildRawComp({ shippingPrice: undefined })]);
    const nullShipping = normalizeSoldComps([buildRawComp({ shippingPrice: null })]);

    expect(missingShipping.comps[0]?.shippingPrice).toBeNull();
    expect(nullShipping.comps[0]?.shippingPrice).toBeNull();
  });

  it('rejects negative and non-finite shipping', () => {
    expect(
      normalizeSoldComps([buildRawComp({ shippingPrice: { value: -1, currency: 'USD' } })]).rejected,
    ).toEqual([{ index: 0, reason: 'invalid_shipping', title: 'Sample Title' }]);
    expect(
      normalizeSoldComps([buildRawComp({ shippingPrice: { value: Number.NaN, currency: 'USD' } })]).rejected,
    ).toEqual([{ index: 0, reason: 'invalid_shipping', title: 'Sample Title' }]);
  });

  it('includes shipping in total price when present', () => {
    const normalized = normalizeSoldComps([
      buildRawComp({
        price: { value: 10, currency: 'USD' },
        shippingPrice: { value: 2.5, currency: 'USD' },
      }),
    ]);

    expect(normalized.comps[0]?.totalPrice).toEqual({ value: 12.5, currency: 'USD' });
  });

  it('uses price as total price when shipping missing or null', () => {
    const missingShipping = normalizeSoldComps([buildRawComp({ price: { value: 10, currency: 'USD' }, shippingPrice: undefined })]);
    const nullShipping = normalizeSoldComps([buildRawComp({ price: { value: 10, currency: 'USD' }, shippingPrice: null })]);

    expect(missingShipping.comps[0]?.totalPrice).toEqual({ value: 10, currency: 'USD' });
    expect(nullShipping.comps[0]?.totalPrice).toEqual({ value: 10, currency: 'USD' });
  });

  it.each([
    [1, 15, 1, 2],
    [5, 15, 1.25, 6.25],
    [10, 15, 2, 12],
    [17.5, 15, 2.75, 20.25],
  ])(
    'replaces provider shipping for eligible raw-card singles under $20: price=%s provider=%s default=%s total=%s',
    (price, providerShipping, expectedShipping, expectedTotal) => {
      const normalized = normalizeSoldComps(
        [
          buildRawComp({
            price: { value: price, currency: 'USD' },
            shippingPrice: { value: providerShipping, currency: 'USD' },
          }),
        ],
        buildRawCardSingleContext()
      );

      expect(normalized.comps[0]?.shippingPrice).toEqual({ currency: 'USD', value: expectedShipping });
      expect(normalized.comps[0]?.totalPrice).toEqual({ currency: 'USD', value: expectedTotal });
    }
  );

  it('uses 2.00 shipping for 8.50 raw-card single with inflated provider shipping', () => {
    const normalized = normalizeSoldComps(
      [
        buildRawComp({
          price: { value: 8.5, currency: 'USD' },
          shippingPrice: { value: 30.05, currency: 'USD' },
        }),
      ],
      buildRawCardSingleContext()
    );

    expect(normalized.comps[0]?.shippingPrice).toEqual({ currency: 'USD', value: 2 });
    expect(normalized.comps[0]?.totalPrice).toEqual({ currency: 'USD', value: 10.5 });
  });

  it.each([undefined, null, { value: 0, currency: 'USD' }, { value: 3.25, currency: 'USD' }])(
    'replaces free/null/provider shipping for eligible raw-card singles: %o',
    (shippingPrice) => {
      const normalized = normalizeSoldComps(
        [
          buildRawComp({
            price: { value: 5, currency: 'USD' },
            shippingPrice,
          }),
        ],
        buildRawCardSingleContext()
      );

      expect(normalized.comps[0]?.shippingPrice).toEqual({ currency: 'USD', value: 1.25 });
      expect(normalized.comps[0]?.totalPrice).toEqual({ currency: 'USD', value: 6.25 });
    }
  );

  it('does not replace provider shipping for lot context', () => {
    const normalized = normalizeSoldComps(
      [
        buildRawComp({
          price: { value: 5, currency: 'USD' },
          shippingPrice: { value: 15, currency: 'USD' },
        }),
      ],
      buildLotContext()
    );

    expect(normalized.comps[0]?.shippingPrice).toEqual({ currency: 'USD', value: 15 });
    expect(normalized.comps[0]?.totalPrice).toEqual({ currency: 'USD', value: 20 });
  });

  it('does not replace provider shipping for explicit graded context', () => {
    const normalized = normalizeSoldComps(
      [
        buildRawComp({
          title: 'Sample Raw Title',
          price: { value: 5, currency: 'USD' },
          shippingPrice: { value: 15, currency: 'USD' },
        }),
      ],
      buildExplicitGradedContext()
    );

    expect(normalized.comps[0]?.shippingPrice).toEqual({ currency: 'USD', value: 15 });
    expect(normalized.comps[0]?.totalPrice).toEqual({ currency: 'USD', value: 20 });
  });

  it('keeps provider shipping unchanged for eligible raw-card singles at $20+', () => {
    const normalized = normalizeSoldComps(
      [
        buildRawComp({
          price: { value: 20, currency: 'USD' },
          shippingPrice: { value: 15, currency: 'USD' },
        }),
      ],
      buildRawCardSingleContext()
    );

    expect(normalized.comps[0]?.shippingPrice).toEqual({ currency: 'USD', value: 15 });
    expect(normalized.comps[0]?.totalPrice).toEqual({ currency: 'USD', value: 35 });
  });

  it('feeds corrected totals into median stats', () => {
    const normalized = normalizeSoldComps(
      [
        buildRawComp({
          title: 'Comp A',
          price: { value: 1, currency: 'USD' },
          shippingPrice: { value: 15, currency: 'USD' },
        }),
        buildRawComp({
          title: 'Comp B',
          price: { value: 5, currency: 'USD' },
          shippingPrice: { value: 15, currency: 'USD' },
        }),
        buildRawComp({
          title: 'Comp C',
          price: { value: 10, currency: 'USD' },
          shippingPrice: { value: 15, currency: 'USD' },
        }),
      ],
      buildRawCardSingleContext()
    );
    const stats = computePricingStats(normalized.comps);

    expect(normalized.comps.map((comp) => comp.totalPrice.value)).toEqual([2, 6.25, 12]);
    expect(stats).toMatchObject({
      deterministicSuggestedPrice: 6.25,
      highSoldPrice: 12,
      lowSoldPrice: 2,
      medianSoldPrice: 6.25,
      soldCount: 3,
    });
  });

  it('normalizes valid soldDate to iso string', () => {
    const normalized = normalizeSoldComps([buildRawComp({ soldDate: '2026-01-15T12:34:56-05:00' })]);

    expect(normalized.comps[0]?.soldDate).toBe('2026-01-15T17:34:56.000Z');
  });

  it('rejects invalid soldDate', () => {
    expect(normalizeSoldComps([buildRawComp({ soldDate: 'not-a-date' })]).rejected).toEqual([
      { index: 0, reason: 'invalid_sold_date', title: 'Sample Title' },
    ]);
    expect(normalizeSoldComps([buildRawComp({ soldDate: '2026-01-15' })]).rejected).toEqual([
      { index: 0, reason: 'invalid_sold_date', title: 'Sample Title' },
    ]);
    expect(normalizeSoldComps([buildRawComp({ soldDate: '01/15/2026 12:34:56' })]).rejected).toEqual([
      { index: 0, reason: 'invalid_sold_date', title: 'Sample Title' },
    ]);
  });

  it('normalizes blank condition to null', () => {
    const normalized = normalizeSoldComps([buildRawComp({ condition: '   ' })]);

    expect(normalized.comps[0]?.condition).toBeNull();
  });

  it('preserves valid listingUrl and blanks to null', () => {
    const validUrl = normalizeSoldComps([buildRawComp({ listingUrl: 'https://example.com/item/1' })]);
    const blankUrl = normalizeSoldComps([buildRawComp({ listingUrl: '   ' })]);

    expect(validUrl.comps[0]?.listingUrl).toBe('https://example.com/item/1');
    expect(blankUrl.comps[0]?.listingUrl).toBeNull();
  });

  it('rejects non-http listingUrl', () => {
    const normalized = normalizeSoldComps([buildRawComp({ listingUrl: 'ftp://example.com/item/1' })]);

    expect(normalized.rejected).toEqual([
      { index: 0, reason: 'invalid_listing_url', title: 'Sample Title' },
    ]);
  });

  it.each([
    ...GRADED_PROVIDER_TERMS.map((grader) => [
      `1955 Topps #98 Johnny Riddle ${grader} 9`,
      'excluded_graded_listing',
    ] as const),
    ['1955 Topps #98 Johnny Riddle slabbed', 'excluded_graded_listing'] as const,
    ['1955 Topps #98 Johnny Riddle graded', 'excluded_graded_listing'] as const,
  ])('rejects graded/filtered title "%s"', (title, reason) => {
    const normalized = normalizeSoldComps([buildRawComp({ title })]);

    expect(normalized.comps).toEqual([]);
    expect(normalized.rejected).toEqual([{ index: 0, reason, title }]);
  });

  it.each([
    '1955 Topps #98 Johnny Riddle You Pick',
    '1955 Topps #98 Johnny Riddle you-pick',
    '1955 Topps #98 Johnny Riddle pick your card',
    '1955 Topps #98 Johnny Riddle choose your card',
    '1955 Topps #98 Johnny Riddle choose from dropdown',
    '1955 Topps #98 Johnny Riddle complete your set',
    '1955 Topps #98 Johnny Riddle complete-your-set',
    '1955 Topps #98 Johnny Riddle pick choose',
  ])('rejects broad-selection title "%s"', (title) => {
    const normalized = normalizeSoldComps([buildRawComp({ title })]);

    expect(normalized.comps).toEqual([]);
    expect(normalized.rejected).toEqual([
      { index: 0, reason: 'excluded_selection_listing', title },
    ]);
  });

  it('rejects exact invalid broad-selection title from live smoke finding', () => {
    const title = '1955 Topps Baseball #1-210 You-Pick. Complete-Your-Set. Combined Shipping.';

    const normalized = normalizeSoldComps([buildRawComp({ title })], buildExactCardContext());

    expect(normalized.comps).toEqual([]);
    expect(normalized.rejected).toEqual([
      { index: 0, reason: 'excluded_selection_listing', title },
    ]);
  });

  it('rejects card-number range selection title when target card number is exact', () => {
    const title = '1955 Topps Baseball #1-210 Combined Shipping';

    const normalized = normalizeSoldComps([buildRawComp({ title })], buildExactCardContext());

    expect(normalized.comps).toEqual([]);
    expect(normalized.rejected).toEqual([
      { index: 0, reason: 'excluded_selection_listing', title },
    ]);
  });

  it.each([
    ['1991-92 NBA Hoops Michael Jordan #536 All-Time Stat Leaders', '1991'],
    ['92-93 NBA Hoops Michael Jordan #536 All-Time Stat Leaders', '1992'],
  ])('accepts exact-card season range title "%s" as start year %s', (title, year) => {
    const normalized = normalizeSoldComps([buildRawComp({ title })], buildMichaelJordanHoopsContext(year));

    expect(normalized.rejected).toEqual([]);
    expect(normalized.comps[0]?.title).toBe(title);
  });

  it('keeps valid raw exact-card comp title', () => {
    const title = '1955 TOPPS BASEBALL CARD #98 JOHNNY RIDDLE EX/EX+';
    const normalized = normalizeSoldComps([buildRawComp({ title })], buildExactCardContext());

    expect(normalized.rejected).toEqual([]);
    expect(normalized.comps[0]?.title).toBe(title);
  });

  it('accepts exact-card set-break comp title', () => {
    const title = '1955 Topps Set Break #98 Johnny Riddle VG-VGEX St Louis Cardinals';
    const normalized = normalizeSoldComps([buildRawComp({ title })], buildExactCardContext());

    expect(normalized.rejected).toEqual([]);
    expect(normalized.comps[0]?.title).toBe(title);
  });

  it.each([
    'Topps 1983 Topps Ryne Sandberg #83 Rookie Base Set Chicago Cubs Card',
    '1983 Topps - Ryne Sandberg Chicago Cubs #83 (RC) Base Set Baseball Card',
    'Topps 1983 Ryne Sandberg Rookie #83 Base Set Chicago Cubs Baseball',
    '1983 TOPPS ROOKIE CHICAGO CUBS 3RD BASE #83 RYNE SANDBERG BASEBALL CARD IN CASE',
  ])('accepts generic base/base-set exact-card title "%s"', (title) => {
    const normalized = normalizeSoldComps([buildRawComp({ title })], buildRyneSandbergContext());

    expect(normalized.rejected).toEqual([]);
    expect(normalized.comps[0]?.title).toBe(title);
  });

  it.each([
    '1977 TOPPS BSKT. #20 PETE MARAVICH',
    '1977 Topps 20 Pete Maravich',
    'Pete Maravich #20 1977 Topps New Orleans Jazz Basketball Card NBA NM',
    '1977-78 Topps BSKB - #20 Pete Maravich/Jazz G/VG',
    '1977-1978 Topps 20 Pete Maravich',
    'Pete Maravich 1977 Topps All-Star #20 HOF',
    '1977-78 Topps White Backs #20 Pete Maravich New Orleans Jazz',
    '1977-78 Topps NBA #20 Pete Maravich New Orleans Jazz Hawks HOF',
  ])('accepts descriptor-heavy generic exact-card title "%s"', (title) => {
    const normalized = normalizeSoldComps([buildRawComp({ title })], buildPeteMaravichContext());

    expect(normalized.rejected).toEqual([]);
    expect(normalized.comps[0]?.title).toBe(title);
  });

  it('rejects set-break title when broad-selection wording also present', () => {
    const title = '1955 Topps Set Break #98 Johnny Riddle You Pick';
    const normalized = normalizeSoldComps([buildRawComp({ title })], buildExactCardContext());

    expect(normalized.comps).toEqual([]);
    expect(normalized.rejected).toEqual([
      { index: 0, reason: 'excluded_selection_listing', title },
    ]);
  });

  it.each([
    ['1984 Fleer - Darryl Strawberry #599 (RC)', 'exact_year_mismatch'],
    ['1996 Fleer - Darryl Strawberry #198', 'exact_year_mismatch'],
    ['1997 Fleer Ultra - Darryl Strawberry #G106 Gold Medallion New York Yankees Card', 'exact_card_number_mismatch'],
    ['1987 Fleer Magic Mets SuperStar Special #629 Mets Carter Gooden Strawberry', 'exact_player_mismatch'],
    ['1997 Donruss Darryl Strawberry #261 New York Yankees', 'exact_set_mismatch'],
    ['1995 Ultra #244 Darryl Strawberry San Francisco Giants', 'exact_set_mismatch'],
  ])('rejects exact-card mismatch title "%s"', (title, reason) => {
    const normalized = normalizeSoldComps([buildRawComp({ title })], buildDarrylStrawberryContext());

    expect(normalized.comps).toEqual([]);
    expect(normalized.rejected).toEqual([{ index: 0, reason, title }]);
  });

  it.each([
    '1997 Fleer Darryl Strawberry #179',
    '1997 Fleer Darryl Strawberry',
    '1997 Fleer Ultra Darryl Strawberry #179',
    'Fleer Darryl Strawberry #179',
    '1997 Fleer Set Break #179 Darryl Strawberry',
    '1997 Fleer RC Darryl Strawberry #179',
  ])('accepts exact-card title "%s"', (title) => {
    const normalized = normalizeSoldComps([buildRawComp({ title })], buildDarrylStrawberryContext());

    expect(normalized.rejected).toEqual([]);
    expect(normalized.comps[0]?.title).toBe(title);
  });

  it('accepts matching target parallel after canonical set phrase', () => {
    const title = '1997 Fleer Ultra Gold Medallion Darryl Strawberry #G106';
    const normalized = normalizeSoldComps([buildRawComp({ title })], {
      itemSpecifics: {
        'Card Number': 'G106',
        'Parallel/Variety': 'Gold Medallion',
        Player: 'Darryl Strawberry',
        Set: 'Fleer Ultra',
        Year: '1997',
      },
      title: '1997 Fleer Ultra Gold Medallion Darryl Strawberry #G106',
    });

    expect(normalized.rejected).toEqual([]);
    expect(normalized.comps[0]?.title).toBe(title);
  });

  it('accepts matching target insert after canonical set phrase', () => {
    const title = '2023 Panini Prizm Silver Victor Wembanyama #136';
    const normalized = normalizeSoldComps([buildRawComp({ title })], {
      itemSpecifics: {
        'Card Number': '136',
        'Insert Set': 'Silver',
        Player: 'Victor Wembanyama',
        Set: 'Panini Prizm',
        Year: '2023',
      },
      title: '2023 Panini Prizm Silver Victor Wembanyama #136',
    });

    expect(normalized.rejected).toEqual([]);
    expect(normalized.comps[0]?.title).toBe(title);
  });

  it.each([
    '1997 Fleer Ultra Darryl Strawberry #261',
    '1997 Fleer Ultra Darryl Strawberry 261',
  ])('rejects conflicting card number even when generic manufacturer expansion matches "%s"', (title) => {
    const normalized = normalizeSoldComps([buildRawComp({ title })], buildDarrylStrawberryContext());

    expect(normalized.rejected).toEqual([
      { index: 0, reason: 'exact_card_number_mismatch', title },
    ]);
  });

  it('rejects mixed-year multi-card generic-set title', () => {
    const title = 'Topps 1977 Pete Maravich #20 And Topps 1978 Pete Maravich #80 Set Good';
    const normalized = normalizeSoldComps([buildRawComp({ title })], buildPeteMaravichContext());

    expect(normalized.rejected).toEqual([
      { index: 0, reason: 'exact_year_mismatch', title },
    ]);
  });

  it('uses title fallback for target year/card number when item specifics omit them', () => {
    const normalized = normalizeSoldComps(
      [buildRawComp({ title: '1996 Fleer Darryl Strawberry #198' })],
      {
        itemSpecifics: {
          Manufacturer: 'Fleer',
          Player: 'Darryl Strawberry',
        },
        title: 'Darryl Strawberry 1997 Fleer #179',
      }
    );

    expect(normalized.rejected).toEqual([
      { index: 0, reason: 'exact_year_mismatch', title: '1996 Fleer Darryl Strawberry #198' },
    ]);
  });

  it('rejects explicit alphanumeric card-number mismatch', () => {
    const normalized = normalizeSoldComps(
      [buildRawComp({ title: '1997 Fleer Darryl Strawberry #G106' })],
      {
        itemSpecifics: {
          'Card Number': 'US250',
          Manufacturer: 'Fleer',
          Player: 'Darryl Strawberry',
          Year: '1997',
        },
        title: '1997 Fleer Darryl Strawberry #US250',
      }
    );

    expect(normalized.rejected).toEqual([
      { index: 0, reason: 'exact_card_number_mismatch', title: '1997 Fleer Darryl Strawberry #G106' },
    ]);
  });

  it('accepts explicit four-digit card number without false year mismatch', () => {
    const title = '1997 Fleer Darryl Strawberry #2023';
    const normalized = normalizeSoldComps([buildRawComp({ title })], {
      itemSpecifics: {
        'Card Number': '2023',
        Player: 'Darryl Strawberry',
        Set: 'Fleer',
        Year: '1997',
      },
      title: '1997 Fleer Darryl Strawberry #2023',
    });

    expect(normalized.rejected).toEqual([]);
    expect(normalized.comps[0]?.title).toBe(title);
  });

  it('rejects genuine conflicting four-digit year outside explicit card-number marker', () => {
    const title = '1996 Fleer Darryl Strawberry #2023';
    const normalized = normalizeSoldComps([buildRawComp({ title })], {
      itemSpecifics: {
        'Card Number': '2023',
        Player: 'Darryl Strawberry',
        Set: 'Fleer',
        Year: '1997',
      },
      title: '1997 Fleer Darryl Strawberry #2023',
    });

    expect(normalized.rejected).toEqual([
      { index: 0, reason: 'exact_year_mismatch', title },
    ]);
  });

  it('generates deterministic ids across repeated normalization', () => {
    const rawComp = buildRawComp({
      title: ' Stable Title ',
      soldDate: '2026-01-15T12:34:56-05:00',
      listingUrl: 'https://example.com/item/1',
    });

    const first = normalizeSoldComps([rawComp]);
    const second = normalizeSoldComps([rawComp]);

    expect(first.comps[0]?.id).toBe(second.comps[0]?.id);
  });

  it('preserves accepted comp order', () => {
    const normalized = normalizeSoldComps([
      buildRawComp({ title: ' First ' }),
      buildRawComp({ title: ' Second ' }),
      buildRawComp({ title: ' Third ' }),
    ]);

    expect(normalized.comps.map((comp) => comp.title)).toEqual(['First', 'Second', 'Third']);
  });

  it('returns rejected rows with index and reason while preserving accepted comps', () => {
    const normalized = normalizeSoldComps([
      buildRawComp({ title: 'Accepted A' }),
      buildRawComp({ title: '   ' }),
      buildRawComp({ soldDate: 'bad-date' }),
      buildRawComp({ title: 'Accepted B' }),
    ]);

    expect(normalized.comps.map((comp) => comp.title)).toEqual(['Accepted A', 'Accepted B']);
    expect(normalized.rejected).toEqual([
      { index: 1, reason: 'blank_title', title: null },
      { index: 2, reason: 'invalid_sold_date', title: 'Sample Title' },
    ]);
  });
});

function buildRawComp(overrides: Partial<RawSoldComp> = {}): RawSoldComp {
  return {
    title: 'Sample Title',
    price: { value: 19.99, currency: 'USD' },
    shippingPrice: { value: 3.5, currency: 'USD' },
    soldDate: '2026-01-15T12:34:56.000Z',
    condition: 'Near Mint',
    listingUrl: 'https://example.com/item/123',
    ...overrides,
  };
}

function buildExactCardContext(): NormalizeSoldCompsContext {
  return {
    itemSpecifics: {
      'Card Number': '98',
      Manufacturer: 'Topps',
      Player: 'Johnny Riddle',
      Set: 'Topps',
      Year: '1955',
    },
    title: '1955 Topps Johnny Riddle #98',
  };
}

function buildDarrylStrawberryContext(): NormalizeSoldCompsContext {
  return {
    itemSpecifics: {
      'Card Number': '179',
      Manufacturer: 'Fleer',
      Player: 'Darryl Strawberry',
      Set: 'Fleer',
      Year: '1997',
    },
    title: '1997 Fleer Darryl Strawberry #179',
  };
}

function buildMichaelJordanHoopsContext(year: string): NormalizeSoldCompsContext {
  return {
    itemSpecifics: {
      'Card Number': '536',
      Manufacturer: 'NBA Hoops',
      Player: 'Michael Jordan',
      Set: 'NBA Hoops',
      Year: year,
    },
    title: `${year} NBA Hoops Michael Jordan #536 All-Time Stat Leaders`,
  };
}

function buildRyneSandbergContext(): NormalizeSoldCompsContext {
  return {
    itemSpecifics: {
      'Card Number': '83',
      Manufacturer: 'Topps',
      Player: 'Ryne Sandberg',
      Set: 'Base Set',
      Year: '1983',
    },
    title: '1983 Topps Ryne Sandberg #83 Base Set',
  };
}

function buildPeteMaravichContext(): NormalizeSoldCompsContext {
  return {
    itemSpecifics: {
      'Card Number': '20',
      Manufacturer: 'Topps',
      Player: 'Pete Maravich',
      Set: 'Topps',
      Year: '1977',
    },
    title: '1977 Topps Pete Maravich #20',
  };
}

function buildRawCardSingleContext(): NormalizeSoldCompsContext {
  return {
    rawCardSingleShippingDefaults: true,
    title: '1955 Topps Johnny Riddle #98',
  };
}

function buildLotContext(): NormalizeSoldCompsContext {
  return {
    rawCardSingleShippingDefaults: false,
    title: '1955 Topps Johnny Riddle lot',
  };
}

function buildExplicitGradedContext(): NormalizeSoldCompsContext {
  return {
    rawCardSingleShippingDefaults: false,
    title: '1955 Topps Johnny Riddle PSA 5',
  };
}
