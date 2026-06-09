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

export interface NormalizedMoneyValue {
  value: number;
  currency: string;
}

export interface NormalizedSoldComp {
  id: string;
  title: string;
  price: NormalizedMoneyValue;
  shippingPrice: NormalizedMoneyValue | null;
  totalPrice: NormalizedMoneyValue;
  soldDate: string;
  condition: string | null;
  listingUrl: string | null;
  source: 'provider';
}

export interface NormalizeSoldCompsRejectedRow {
  index: number;
  reason: string;
}

export interface NormalizeSoldCompsResult {
  comps: NormalizedSoldComp[];
  rejected: NormalizeSoldCompsRejectedRow[];
}

export interface PricingStatsIgnoredComp {
  id: string;
  reason: 'invalid_total_price' | 'currency_mismatch';
}

export interface PricingStatsResult {
  soldCount: number;
  medianSoldPrice: number | null;
  lowSoldPrice: number | null;
  highSoldPrice: number | null;
  deterministicSuggestedPrice: number | null;
  currency: string | null;
  ignored: PricingStatsIgnoredComp[];
}

export type PricingConfidence = 'low' | 'medium' | 'high';

export interface PricingConfidenceInput {
  comps: NormalizedSoldComp[];
  stats: PricingStatsResult;
}

export interface PricingConfidenceResult {
  confidence: PricingConfidence;
  reasons: string[];
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
