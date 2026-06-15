import {
  createFixturePricingProvider,
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
    ['1955 Topps #98 Johnny Riddle PSA 5', 'excluded_graded_listing'],
    ['1955 Topps #98 Johnny Riddle SGC 4', 'excluded_graded_listing'],
    ['1955 Topps #98 Johnny Riddle BGS 7.5', 'excluded_graded_listing'],
    ['1955 Topps #98 Johnny Riddle slabbed', 'excluded_graded_listing'],
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

  it('rejects set-break title when broad-selection wording also present', () => {
    const title = '1955 Topps Set Break #98 Johnny Riddle You Pick';
    const normalized = normalizeSoldComps([buildRawComp({ title })], buildExactCardContext());

    expect(normalized.comps).toEqual([]);
    expect(normalized.rejected).toEqual([
      { index: 0, reason: 'excluded_selection_listing', title },
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
