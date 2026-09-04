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

const variationListingIntakeModeSchema = z.enum(['idle', 'new_variation', 'duplicate_copy']);

export const configureVariationListingIntakeRequestSchema = z
  .object({
    mode: variationListingIntakeModeSchema,
    targetGroupId: z.string().uuid().nullable(),
    targetVariationId: z.string().uuid().nullable().default(null),
    copyConditionToken: z.enum(['NEAR_MINT_OR_BETTER', 'EXCELLENT', 'VERY_GOOD', 'POOR']).nullable().default(null),
    stickyPriceAmount: manualPriceAmountSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.mode === 'idle') {
      if (value.targetGroupId !== null) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'targetGroupId must be null while intake is idle',
          path: ['targetGroupId'],
        });
      }
      if (value.targetVariationId !== null) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'targetVariationId must be null while intake is idle',
          path: ['targetVariationId'],
        });
      }
      if (value.copyConditionToken !== null) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'copyConditionToken must be null while intake is idle',
          path: ['copyConditionToken'],
        });
      }
      return;
    }

    if (value.targetGroupId === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `targetGroupId is required for ${value.mode} intake`,
        path: ['targetGroupId'],
      });
    }

    if (value.mode === 'new_variation' && value.targetVariationId !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'targetVariationId must be null for new_variation intake',
        path: ['targetVariationId'],
      });
    }
    if (value.mode === 'new_variation' && value.copyConditionToken !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'copyConditionToken must be null for new_variation intake',
        path: ['copyConditionToken'],
      });
    }
    if (value.mode === 'duplicate_copy' && value.targetVariationId === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'targetVariationId is required for duplicate_copy intake',
        path: ['targetVariationId'],
      });
    }
    if (value.mode === 'duplicate_copy' && value.copyConditionToken === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'copyConditionToken is required for duplicate_copy intake',
        path: ['copyConditionToken'],
      });
    }
  });

const exactSourceRefSchema = z
  .string()
  .min(1)
  .refine((value) => value === value.trim(), 'source reference must be outer-trimmed');

export const generateVariationListingIntakeIdentityRequestSchema = z
  .object({
    variationId: z.string().uuid(),
    frontSourceRef: exactSourceRefSchema,
    backSourceRef: exactSourceRefSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.frontSourceRef === value.backSourceRef) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'frontSourceRef and backSourceRef must differ',
        path: ['backSourceRef'],
      });
    }
  });

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

export const updateVariationListingSelectorValueRequestSchema = z
  .object({
    expectedDesiredRevision: expectedDesiredRevisionSchema,
    selectorValue: z
      .string()
      .min(1, 'selectorValue is required')
      .refine((value) => value === value.trim(), 'selectorValue must be outer-trimmed'),
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

export const variationListingRevisionActionRequestSchema = z
  .object({ expectedDesiredRevision: expectedDesiredRevisionSchema })
  .strict();

export const variationListingQuantityActionRequestSchema = z
  .object({
    expectedDesiredRevision: expectedDesiredRevisionSchema,
    variationId: z.string().uuid(),
    copyId: z.string().uuid(),
    availabilityState: z.enum(['available', 'unavailable']),
  })
  .strict();

export const variationListingRetryActionRequestSchema = z.object({}).strict();

export type CreateVariationListingGroupRequest = z.input<
  typeof createVariationListingGroupRequestSchema
>;
export type ConfigureVariationListingIntakeRequest = z.infer<
  typeof configureVariationListingIntakeRequestSchema
>;
export type GenerateVariationListingIntakeIdentityRequest = z.infer<
  typeof generateVariationListingIntakeIdentityRequestSchema
>;
