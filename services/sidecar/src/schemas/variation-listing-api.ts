import { z } from 'zod';

export const variationListingGroupIdParamsSchema = z.object({
  groupId: z.string().uuid(),
});

export const variationListingVariationIdParamsSchema = variationListingGroupIdParamsSchema.extend({
  variationId: z.string().uuid(),
});

export const variationListingCopyIdParamsSchema = variationListingVariationIdParamsSchema.extend({
  copyId: z.string().uuid(),
});

const trimmed = (label: string) => z.string().trim().min(1, `${label} is required`);
const expectedDesiredRevisionSchema = z.number().int().nonnegative();
const manualPriceAmountSchema = z.union([
  z.literal(0.99),
  z.literal(1.49),
  z.literal(1.99),
  z.literal(2.49),
]);

export const createVariationListingGroupRequestSchema = z
  .object({
    skuCategoryCode: z.enum(['BSKBL', 'BSBL', 'OTHER']),
    skuBucketToken: trimmed('skuBucketToken')
      .max(32)
      .regex(/^[A-Za-z0-9]+([._-][A-Za-z0-9]+)*$/, 'skuBucketToken has invalid characters')
      .refine((value) => value !== 'Single' && value !== 'Lot', 'skuBucketToken is reserved'),
    categoryId: z.literal('261328').default('261328'),
    marketplaceId: z.literal('EBAY_US').default('EBAY_US'),
    merchantLocationKey: trimmed('merchantLocationKey'),
    fulfillmentPolicyId: trimmed('fulfillmentPolicyId'),
    paymentPolicyId: trimmed('paymentPolicyId'),
    returnPolicyId: trimmed('returnPolicyId'),
    conditionId: trimmed('conditionId'),
    conditionToken: z.enum(['NEAR_MINT_OR_BETTER', 'EXCELLENT', 'VERY_GOOD', 'POOR']),
  })
  .strict();

export const updateVariationListingReviewDraftRequestSchema = z
  .object({
    expectedDesiredRevision: expectedDesiredRevisionSchema,
    title: trimmed('title'),
    description: trimmed('description'),
    derivedCommonEbayAspects: z.record(z.string(), z.unknown()),
  })
  .strict();

export const updateVariationListingPriceRequestSchema = z
  .object({
    expectedDesiredRevision: expectedDesiredRevisionSchema,
    priceAmount: manualPriceAmountSchema,
  })
  .strict();

export const updateVariationListingRepresentativeCopyRequestSchema = z
  .object({
    expectedDesiredRevision: expectedDesiredRevisionSchema,
    copyId: z.string().uuid(),
  })
  .strict();

export const updateVariationListingCopyAvailabilityRequestSchema = z
  .object({
    expectedDesiredRevision: expectedDesiredRevisionSchema,
    availabilityState: z.enum(['available', 'unavailable']),
  })
  .strict();

export type CreateVariationListingGroupRequest = z.input<
  typeof createVariationListingGroupRequestSchema
>;
