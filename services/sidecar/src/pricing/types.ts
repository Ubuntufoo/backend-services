export interface PricingProviderInput {
  listingId: string;
  title: string;
  categoryId?: string | null;
  conditionId?: string | null;
  itemSpecifics?: Record<string, string | string[] | null | undefined>;
  minSoldComps?: number;
}

export interface RawSoldComp {
  title: string;
  price: {
    value: number;
    currency: string;
  };
  shippingPrice?: {
    value: number;
    currency: string;
  } | null;
  soldDate: string;
  condition?: string | null;
  listingUrl?: string | null;
}

export interface PricingProviderResult {
  provider: string;
  query: string;
  soldComps: RawSoldComp[];
  rawResult: unknown;
  fetchedAt: string;
}

export interface PricingProvider {
  readonly name: string;
  fetchSoldComps(input: PricingProviderInput): Promise<PricingProviderResult>;
}
