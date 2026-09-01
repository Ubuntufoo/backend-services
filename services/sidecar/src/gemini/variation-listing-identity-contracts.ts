import { z } from 'zod';
import { GENERATED_YEAR_EVIDENCE_SOURCE_TYPES } from './year-normalization.js';

const nonEmptyStringSchema = z.string().trim().min(1);
const sourceIdentityStringSchema = z
  .string()
  .min(1)
  .refine((value) => value === value.trim(), {
    message: 'Value must not have outer whitespace.',
  });
const imageUrlSchema = sourceIdentityStringSchema;
const sourceRefSchema = sourceIdentityStringSchema;
const imageIndexSchema = z.number().int().min(0).max(1);
const explicitYearSchema = z.string().regex(/^(?:19\d{2}|20\d{2})$/u);

export const variationListingEvidenceFactSchema = z
  .object({
    value: nonEmptyStringSchema,
    imageIndex: imageIndexSchema,
    visibleEvidence: nonEmptyStringSchema,
  })
  .strict();

export const VARIATION_LISTING_FEATURE_VALUES = [
  'Insert',
  'Parallel/Variety',
  'Refractor',
  'Rookie Card',
  'Serial Numbered',
] as const;

export const variationListingFeatureEvidenceSchema = z
  .object({
    value: z.enum(VARIATION_LISTING_FEATURE_VALUES),
    imageIndex: imageIndexSchema,
    visibleEvidence: nonEmptyStringSchema,
  })
  .strict();

export const variationListingIdentityFactsSchema = z
  .object({
    sport: variationListingEvidenceFactSchema.nullable().optional(),
    league: variationListingEvidenceFactSchema.nullable().optional(),
    playerAthlete: variationListingEvidenceFactSchema.nullable().optional(),
    team: variationListingEvidenceFactSchema.nullable().optional(),
    manufacturer: variationListingEvidenceFactSchema.nullable().optional(),
    set: variationListingEvidenceFactSchema.nullable().optional(),
    cardNumber: variationListingEvidenceFactSchema.nullable().optional(),
    parallelVariety: variationListingEvidenceFactSchema.nullable().optional(),
    insertSet: variationListingEvidenceFactSchema.nullable().optional(),
    cardName: variationListingEvidenceFactSchema.nullable().optional(),
    language: variationListingEvidenceFactSchema.nullable().optional(),
    features: z.array(variationListingFeatureEvidenceSchema).max(8).optional(),
  })
  .strict();

export const variationListingYearEvidenceSchema = z
  .object({
    year: explicitYearSchema,
    sourceType: z.enum(GENERATED_YEAR_EVIDENCE_SOURCE_TYPES),
    visibleText: nonEmptyStringSchema,
    imageIndex: imageIndexSchema,
  })
  .strict();

export const variationListingSeasonEvidenceSchema = z
  .object({
    season: nonEmptyStringSchema,
    visibleText: nonEmptyStringSchema,
    imageIndex: imageIndexSchema,
  })
  .strict();

export const variationListingSerialEvidenceSchema = z
  .object({
    visibleText: nonEmptyStringSchema,
    imageIndex: imageIndexSchema,
    numerator: z.number().int().positive(),
    denominator: z.number().int().positive(),
  })
  .strict();

export const variationListingIdentityModelResponseSchema = z
  .object({
    facts: variationListingIdentityFactsSchema,
    yearEvidence: variationListingYearEvidenceSchema.nullable().optional(),
    seasonEvidence: variationListingSeasonEvidenceSchema.nullable().optional(),
    serialEvidence: variationListingSerialEvidenceSchema.nullable().optional(),
    reviewNotes: z.array(nonEmptyStringSchema.max(500)).max(12).default([]),
    warnings: z.array(nonEmptyStringSchema.max(500)).max(12).default([]),
  })
  .strict();

export const generateVariationListingIdentityInputSchema = z
  .object({
    variationId: nonEmptyStringSchema,
    imageUrls: z.tuple([imageUrlSchema, imageUrlSchema]),
    sourceRefs: z
      .object({
        front: sourceRefSchema,
        back: sourceRefSchema,
      })
      .strict(),
    userHints: z
      .object({
        explicitYear: explicitYearSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.imageUrls[0] === value.imageUrls[1]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['imageUrls'],
        message: 'Front and back image URLs must be distinct.',
      });
    }
    if (value.sourceRefs.front === value.sourceRefs.back) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sourceRefs'],
        message: 'Front and back source references must be distinct.',
      });
    }
  });

export type GenerateVariationListingIdentityInput = z.infer<
  typeof generateVariationListingIdentityInputSchema
>;
export type VariationListingEvidenceFact = z.infer<typeof variationListingEvidenceFactSchema>;
export type VariationListingFeatureEvidence = z.infer<typeof variationListingFeatureEvidenceSchema>;
export type VariationListingIdentityFacts = z.infer<typeof variationListingIdentityFactsSchema>;
export type VariationListingIdentityModelResponse = z.infer<
  typeof variationListingIdentityModelResponseSchema
>;
export type VariationListingYearEvidence = z.infer<typeof variationListingYearEvidenceSchema>;
export type VariationListingSeasonEvidence = z.infer<typeof variationListingSeasonEvidenceSchema>;
export type VariationListingSerialEvidence = z.infer<typeof variationListingSerialEvidenceSchema>;

export interface VariationListingNormalizedIdentity {
  sport?: string;
  league?: string;
  playerAthlete?: string;
  team?: string;
  manufacturer?: string;
  set?: string;
  cardNumber?: string;
  parallelVariety?: string;
  insertSet?: string;
  cardName?: string;
  language?: string;
  features: string[];
  year?: string;
  season?: string;
  serialNumber?: string;
  printRun?: number;
}

export interface GeneratedVariationListingIdentityDraft {
  variationId: string;
  selectorValue: string;
  identity: VariationListingNormalizedIdentity;
  variationMetadata: Record<string, unknown>;
  evidence: Record<string, unknown>;
  reviewNotes: string[];
  warnings: string[];
  sourceImages: {
    front: { imageUrl: string; sourceRef: string; imageIndex: 0 };
    back: { imageUrl: string; sourceRef: string; imageIndex: 1 };
  };
  rawModelResponse?: unknown;
}

export function validateGenerateVariationListingIdentityInput(
  input: GenerateVariationListingIdentityInput
): GenerateVariationListingIdentityInput {
  return generateVariationListingIdentityInputSchema.parse(input);
}
