import { z } from 'zod';
import { RAW_CARD_CONDITION_TOKENS } from '@/listings/trading-card-conditions.js';

const nonEmptyStringSchema = z.string().trim().min(1);
const rawConditionTokenSchema = z.enum(RAW_CARD_CONDITION_TOKENS);
const availabilityStateSchema = z.enum(['available', 'unavailable']);

export const variationListingGroupReviewVariationSchema = z
  .object({
    variationId: nonEmptyStringSchema,
    selectorValue: nonEmptyStringSchema,
    variationMetadata: z.record(z.unknown()),
  })
  .strict();

export const variationListingGroupReviewCopySchema = z
  .object({
    copyId: nonEmptyStringSchema,
    variationId: nonEmptyStringSchema,
    availabilityState: availabilityStateSchema,
    conditionToken: rawConditionTokenSchema,
  })
  .strict();

export const generateVariationListingGroupReviewInputSchema = z
  .object({
    groupId: nonEmptyStringSchema,
    categoryId: nonEmptyStringSchema,
    conditionToken: rawConditionTokenSchema,
    variations: z.array(variationListingGroupReviewVariationSchema).min(1),
    copies: z.array(variationListingGroupReviewCopySchema),
    userHints: z
      .object({
        groupTheme: nonEmptyStringSchema.max(500).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const variationIds = new Set<string>();
    const selectorValues = new Set<string>();
    for (const [index, variation] of value.variations.entries()) {
      if (variationIds.has(variation.variationId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['variations', index, 'variationId'],
          message: 'Variation ids must be unique within the group review input.',
        });
      }
      variationIds.add(variation.variationId);
      const selectorKey = variation.selectorValue.normalize('NFC').trim();
      if (selectorValues.has(selectorKey)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['variations', index, 'selectorValue'],
          message: 'Selector values must be unique within the group review input.',
        });
      }
      selectorValues.add(selectorKey);
    }

    const copyIds = new Set<string>();
    for (const [index, copy] of value.copies.entries()) {
      if (copyIds.has(copy.copyId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['copies', index, 'copyId'],
          message: 'Copy ids must be unique within the group review input.',
        });
      }
      copyIds.add(copy.copyId);
      if (!variationIds.has(copy.variationId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['copies', index, 'variationId'],
          message: 'Every copy must reference a variation in the reviewed group.',
        });
      }
    }
  });

export const variationListingGroupContentModelResponseSchema = z
  .object({
    title: nonEmptyStringSchema.max(80),
    description: nonEmptyStringSchema.max(4000),
    warnings: z.array(nonEmptyStringSchema.max(500)).max(12).default([]),
  })
  .strict();

export type GenerateVariationListingGroupReviewInput = z.infer<
  typeof generateVariationListingGroupReviewInputSchema
>;
export type VariationListingGroupReviewVariation = z.infer<
  typeof variationListingGroupReviewVariationSchema
>;
export type VariationListingGroupReviewCopy = z.infer<typeof variationListingGroupReviewCopySchema>;
export type VariationListingGroupContentModelResponse = z.infer<
  typeof variationListingGroupContentModelResponseSchema
>;

export interface VariationListingConditionCompatibilityIssue {
  copyId: string;
  variationId: string;
  copyConditionToken: string;
  groupConditionToken: string;
}

export interface VariationListingGroupReadiness {
  ready: boolean;
  blockers: string[];
  conditionCompatible: boolean;
  incompatibleCopies: VariationListingConditionCompatibilityIssue[];
}

export interface GeneratedVariationListingGroupReviewDraft {
  groupId: string;
  title: string;
  description: string;
  derivedCommonEbayAspects: Record<string, string | string[]>;
  readiness: VariationListingGroupReadiness;
  warnings: string[];
  rawModelResponse?: unknown;
}

export function validateGenerateVariationListingGroupReviewInput(
  input: GenerateVariationListingGroupReviewInput
): GenerateVariationListingGroupReviewInput {
  return generateVariationListingGroupReviewInputSchema.parse(input);
}
