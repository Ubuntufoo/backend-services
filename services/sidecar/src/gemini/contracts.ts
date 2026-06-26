import { z, type ZodIssue } from 'zod';
import { SKU_CATEGORY_CODES } from '@ebay-inventory/types';
import { RAW_CARD_CONDITION_TOKENS } from '@/listings/trading-card-conditions.js';

const listingIdSchema = z
  .string({
    required_error: 'listingId is required',
    invalid_type_error: 'listingId must be a string',
  })
  .trim()
  .min(1, 'listingId is required');

const imageUrlSchema = z
  .string({
    required_error: 'imageUrls entries are required',
    invalid_type_error: 'imageUrls entries must be strings',
  })
  .trim()
  .min(1, 'imageUrls entries must be non-empty strings');

export const aspectValueSchema = z.union([z.string(), z.array(z.string())]);
const rawCardConditionTokenSchema = z.enum(RAW_CARD_CONDITION_TOKENS);

export const userHintsSchema = z.object({
  title: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  aspects: z.record(aspectValueSchema).nullable().optional(),
  price: z.number().finite().nullable().optional(),
});

const confidenceSchema = z.object({
  title: z.number().min(0).max(1).optional(),
  category: z.number().min(0).max(1).optional(),
  price: z.number().min(0).max(1).optional(),
  aspects: z.number().min(0).max(1).optional(),
});

const skuCategoryCodeSchema = z.enum(SKU_CATEGORY_CODES);

export const generateListingDraftInputSchema = z.object({
  listingId: listingIdSchema,
  imageUrls: z
    .array(imageUrlSchema, {
      required_error: 'imageUrls is required',
      invalid_type_error: 'imageUrls must be an array',
    })
    .min(1, 'imageUrls must contain at least one image URL'),
  userHints: userHintsSchema.optional(),
});

export const generatedListingDraftSchema = z.object({
  title: z.string(),
  description: z.string(),
  categorySuggestion: z.string().nullable().optional(),
  cardConditionNote: z.string().nullable().optional(),
  cardConditionToken: rawCardConditionTokenSchema.nullable().optional(),
  conditionSuggestion: z.string().nullable().optional(),
  skuCategoryCode: skuCategoryCodeSchema.optional(),
  aspects: z.record(aspectValueSchema),
  priceSuggestion: z.number().finite().nullable().optional(),
  confidence: confidenceSchema.optional(),
  warnings: z.array(z.string()),
  rawModelResponse: z.unknown().optional(),
});

export type GenerateListingDraftInput = z.infer<typeof generateListingDraftInputSchema>;
export type GeneratedListingDraft = z.infer<typeof generatedListingDraftSchema>;
export type GenerateListingDraftUserHints = z.infer<typeof userHintsSchema>;

export interface GenerateAiLatencyDiagnostics {
  totalMs?: number;
  prepareDraftMs?: number;
  modelMs?: number;
  parseMs?: number;
  listingUpdateMs?: number;
  enqueueResearchPriceMs?: number;
}

export interface GenerateAiPayloadDiagnostics {
  promptBytes?: number;
  imageCount: number;
  preparedImagePartCount?: number;
  inlineImageBytesApprox?: number;
}

export interface GenerateAiAttemptDiagnostics {
  latency?: Pick<GenerateAiLatencyDiagnostics, 'modelMs' | 'parseMs'>;
  payload: GenerateAiPayloadDiagnostics;
}

export class GeminiDraftServiceError extends Error {
  readonly diagnostics?: GenerateAiAttemptDiagnostics;

  constructor(message: string, options?: (ErrorOptions & { diagnostics?: GenerateAiAttemptDiagnostics })) {
    super(message, options);
    this.name = 'GeminiDraftServiceError';
    this.diagnostics = options?.diagnostics;
  }
}

export class GeminiDraftValidationError extends GeminiDraftServiceError {
  readonly issues: ZodIssue[];

  constructor(issues: ZodIssue[]) {
    super(formatValidationIssues(issues));
    this.name = 'GeminiDraftValidationError';
    this.issues = issues;
  }
}

function formatValidationIssues(issues: ZodIssue[]): string {
  return issues
    .map((issue) =>
      issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message
    )
    .join('; ');
}

export function validateGenerateListingDraftInput(
  input: GenerateListingDraftInput
): GenerateListingDraftInput {
  const result = generateListingDraftInputSchema.safeParse(input);

  if (!result.success) {
    throw new GeminiDraftValidationError(result.error.issues);
  }

  return result.data;
}
