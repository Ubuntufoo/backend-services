import type {
  PricingProvider,
  PricingProviderInput,
  PricingProviderResult,
  RawSoldComp,
} from './types.js';

const DEFAULT_MIN_SOLD_COMPS = 12;
const FIXTURE_FETCHED_AT = '2026-01-01T00:00:00.000Z';
const FIXTURE_PROVIDER_NAME = 'fixture';
const FIXTURE_CURRENCY = 'USD';

const BASE_FIXTURE_SOLD_COMPS: RawSoldComp[] = [
  {
    title: '2023 Panini Prizm Victor Wembanyama Rookie Card PSA 10',
    price: { value: 39.99, currency: FIXTURE_CURRENCY },
    shippingPrice: { value: 4.99, currency: FIXTURE_CURRENCY },
    soldDate: '2026-01-14T18:22:00.000Z',
    condition: 'Graded',
    listingUrl: 'https://www.ebay.com/itm/100000000001',
  },
  {
    title: 'Victor Wembanyama RC 2023 Panini Prizm Silver Rookie',
    price: { value: 33.5, currency: FIXTURE_CURRENCY },
    shippingPrice: { value: 1.25, currency: FIXTURE_CURRENCY },
    soldDate: '2026-01-13T15:11:00.000Z',
    condition: 'Used',
    listingUrl: 'https://www.ebay.com/itm/100000000002',
  },
  {
    title: '2023 Prizm Wembanyama Base Rookie Card Spurs',
    price: { value: 21, currency: FIXTURE_CURRENCY },
    shippingPrice: null,
    soldDate: '2026-01-12T20:05:00.000Z',
    condition: 'Ungraded',
    listingUrl: 'https://www.ebay.com/itm/100000000003',
  },
  {
    title: 'Victor Wembanyama Donruss Rated Rookie Lot',
    price: { value: 28.75, currency: FIXTURE_CURRENCY },
    shippingPrice: { value: 5, currency: FIXTURE_CURRENCY },
    soldDate: '2026-01-11T14:41:00.000Z',
    condition: 'Ungraded',
    listingUrl: 'https://www.ebay.com/itm/100000000004',
  },
  {
    title: '2023-24 Hoops Wembanyama Rookie Card NM-MT',
    price: { value: 14.99, currency: FIXTURE_CURRENCY },
    shippingPrice: { value: 0, currency: FIXTURE_CURRENCY },
    soldDate: '2026-01-10T22:07:00.000Z',
    condition: 'Near Mint or Better',
    listingUrl: 'https://www.ebay.com/itm/100000000005',
  },
  {
    title: 'Victor Wembanyama Rookie Card Pink Parallel',
    price: { value: 24.49, currency: FIXTURE_CURRENCY },
    shippingPrice: { value: 3.99, currency: FIXTURE_CURRENCY },
    soldDate: '2026-01-09T19:33:00.000Z',
    condition: 'Used',
    listingUrl: 'https://www.ebay.com/itm/100000000006',
  },
  {
    title: '2023 Panini Instant Wembanyama Draft Night Rookie',
    price: { value: 18.25, currency: FIXTURE_CURRENCY },
    shippingPrice: null,
    soldDate: '2026-01-08T13:58:00.000Z',
    condition: 'Ungraded',
    listingUrl: 'https://www.ebay.com/itm/100000000007',
  },
  {
    title: 'Victor Wembanyama Rookie Card Lot of 2',
    price: { value: 31.0, currency: FIXTURE_CURRENCY },
    shippingPrice: { value: 4.5, currency: FIXTURE_CURRENCY },
    soldDate: '2026-01-07T10:27:00.000Z',
    condition: 'Used',
    listingUrl: 'https://www.ebay.com/itm/100000000008',
  },
  {
    title: 'Wembanyama Rookie Revolution Impact Parallel',
    price: { value: 16.5, currency: FIXTURE_CURRENCY },
    shippingPrice: { value: 1.99, currency: FIXTURE_CURRENCY },
    soldDate: '2026-01-06T17:44:00.000Z',
    condition: 'Near Mint or Better',
    listingUrl: 'https://www.ebay.com/itm/100000000009',
  },
  {
    title: 'Victor Wembanyama Rookie Card Mosaic NBA Debut',
    price: { value: 19.95, currency: FIXTURE_CURRENCY },
    shippingPrice: { value: 2.95, currency: FIXTURE_CURRENCY },
    soldDate: '2026-01-05T12:16:00.000Z',
    condition: 'Ungraded',
    listingUrl: 'https://www.ebay.com/itm/100000000010',
  },
  {
    title: '2023 Select Wembanyama Concourse Rookie Card',
    price: { value: 17.89, currency: FIXTURE_CURRENCY },
    shippingPrice: null,
    soldDate: '2026-01-04T21:02:00.000Z',
    condition: 'Used',
    listingUrl: 'https://www.ebay.com/itm/100000000011',
  },
  {
    title: 'Victor Wembanyama Rookie Card Blue Velocity',
    price: { value: 27.4, currency: FIXTURE_CURRENCY },
    shippingPrice: { value: 3.5, currency: FIXTURE_CURRENCY },
    soldDate: '2026-01-03T16:49:00.000Z',
    condition: 'Near Mint or Better',
    listingUrl: 'https://www.ebay.com/itm/100000000012',
  },
];

export class FixturePricingProvider implements PricingProvider {
  readonly name = FIXTURE_PROVIDER_NAME;

  async fetchSoldComps(input: PricingProviderInput): Promise<PricingProviderResult> {
    const minSoldComps = Math.max(input.minSoldComps ?? DEFAULT_MIN_SOLD_COMPS, DEFAULT_MIN_SOLD_COMPS);
    const soldComps = buildFixtureSoldComps(minSoldComps);
    const query = buildFixtureQuery(input);

    return {
      provider: this.name,
      query,
      soldComps,
      rawResult: {
        provider: this.name,
        query,
        listingId: input.listingId,
        requestedMinSoldComps: input.minSoldComps ?? null,
        returnedSoldComps: soldComps.length,
        comps: soldComps,
      },
      fetchedAt: FIXTURE_FETCHED_AT,
    };
  }
}

export function createFixturePricingProvider(): PricingProvider {
  return new FixturePricingProvider();
}

function buildFixtureSoldComps(minSoldComps: number): RawSoldComp[] {
  return Array.from({ length: minSoldComps }, (_, index) => {
    const baseComp = BASE_FIXTURE_SOLD_COMPS[index % BASE_FIXTURE_SOLD_COMPS.length];
    const cycle = Math.floor(index / BASE_FIXTURE_SOLD_COMPS.length);

    if (cycle === 0) {
      return { ...baseComp };
    }

    return {
      ...baseComp,
      title: `${baseComp.title} #${cycle + 1}`,
      price: {
        ...baseComp.price,
        value: Number((baseComp.price.value + cycle * 0.5).toFixed(2)),
      },
      shippingPrice: baseComp.shippingPrice
        ? {
            ...baseComp.shippingPrice,
            value: Number((baseComp.shippingPrice.value + cycle * 0.25).toFixed(2)),
          }
        : null,
      soldDate: shiftIsoDate(baseComp.soldDate, cycle),
      listingUrl: baseComp.listingUrl ? `${baseComp.listingUrl}?variant=${cycle + 1}` : null,
    };
  });
}

function buildFixtureQuery(input: PricingProviderInput): string {
  const queryParts = [input.title.trim()];

  if (input.categoryId) {
    queryParts.push(`category:${input.categoryId}`);
  }

  if (input.conditionId) {
    queryParts.push(`condition:${input.conditionId}`);
  }

  return queryParts.join(' | ');
}

function shiftIsoDate(isoDate: string, cycle: number): string {
  const date = new Date(isoDate);
  date.setUTCDate(date.getUTCDate() - cycle);
  return date.toISOString();
}
