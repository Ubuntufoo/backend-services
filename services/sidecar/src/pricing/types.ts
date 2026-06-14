export interface PricingProviderInput {
  listingId: string;
  title: string;
  listingType?: 'single' | 'lot' | null;
  categoryId?: string | null;
  conditionId?: string | null;
  itemSpecifics?: Record<string, string | string[] | null | undefined>;
  requestedCompCount?: number;
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
  title: string | null;
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

export type LlmPricingPromptFactKey =
  | 'Player'
  | 'Year'
  | 'Manufacturer'
  | 'Set'
  | 'Card Number'
  | 'Parallel/Variety'
  | 'Team/Franchise';

export type LlmPricingPromptFacts = Partial<Record<LlmPricingPromptFactKey, string | null>>;

export interface LlmPricingPromptListing {
  title: string;
  condition?: string | null;
  facts?: LlmPricingPromptFacts;
}

export interface LlmPricingPromptStats {
  soldCount: number;
  low?: number | null;
  median?: number | null;
  high?: number | null;
  suggested?: number | null;
  confidence: PricingConfidence;
}

export interface LlmPricingPromptComp {
  id: string;
  title: string;
  price: number;
  soldAt: string;
  condition?: string | null;
}

export interface LlmPricingPromptOptions {
  maxComps?: number;
}

export interface LlmPricingPromptInput {
  listing: LlmPricingPromptListing;
  stats: LlmPricingPromptStats;
  comps: LlmPricingPromptComp[];
  options?: LlmPricingPromptOptions;
}

export interface LlmPricingPrompt {
  systemInstruction: string;
  userPrompt: string;
}

export interface LlmPricingReasoningCompNote {
  compId: string;
  note: string;
}

export interface LlmPricingReasoning {
  selectedCompIds: string[];
  rejectedCompIds: string[];
  suggestedPrice: number | null;
  confidence: PricingConfidence;
  priceExplanation: string;
  compNotes?: LlmPricingReasoningCompNote[];
}

export interface LlmPricingReasoningValidationContext {
  validCompIds: readonly string[];
  stats: Pick<PricingStatsResult, 'lowSoldPrice' | 'highSoldPrice'>;
}

export interface PricingAnalystInput {
  listing: LlmPricingPromptListing;
  stats: PricingStatsResult;
  comps: NormalizedSoldComp[];
  promptOptions?: LlmPricingPromptOptions;
}

export interface PricingAnalystResult {
  modelName: string;
  reasoning: LlmPricingReasoning;
  prompt: LlmPricingPrompt;
  rawOutput: unknown;
}

export interface PricingAnalyst {
  readonly name: string;
  analyze(input: PricingAnalystInput): Promise<PricingAnalystResult>;
}

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
