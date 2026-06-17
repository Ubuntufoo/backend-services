import { buildPricingSearchQuery } from './pricing-search-query.js';
import type { PricingProviderInput } from './types.js';

export function buildSoldCompsKeyword(
  input: PricingProviderInput,
  positiveQuery?: string
): string {
  return buildPricingSearchQuery(input, positiveQuery);
}
