export const VARIATION_LISTING_COPY_CONDITION_TOKENS = [
  'NEAR_MINT_OR_BETTER',
  'EXCELLENT',
  'VERY_GOOD',
  'POOR',
] as const;

export type VariationListingCopyConditionToken =
  (typeof VARIATION_LISTING_COPY_CONDITION_TOKENS)[number];

const CONDITION_RANK: Record<VariationListingCopyConditionToken, number> = {
  NEAR_MINT_OR_BETTER: 0,
  EXCELLENT: 1,
  VERY_GOOD: 2,
  POOR: 3,
};

export function isVariationListingCopyConditionToken(
  value: unknown
): value is VariationListingCopyConditionToken {
  return (
    typeof value === 'string' &&
    (VARIATION_LISTING_COPY_CONDITION_TOKENS as readonly string[]).includes(value)
  );
}

export function isVariationListingCopyConditionCompatible(
  copyCondition: VariationListingCopyConditionToken,
  groupCondition: VariationListingCopyConditionToken
): boolean {
  return CONDITION_RANK[copyCondition] <= CONDITION_RANK[groupCondition];
}
