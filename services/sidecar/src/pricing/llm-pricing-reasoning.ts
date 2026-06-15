import { z, type ZodIssue } from 'zod';

import type {
  LlmPricingReasoning,
  LlmPricingReasoningValidationContext,
} from './types.js';

const CODE_FENCE_PATTERN = /^```(?:json)?\s*([\s\S]*?)\s*```$/i;
const MAX_EXPLANATION_LENGTH = 500;
const MAX_COMP_NOTE_LENGTH = 240;
const MAX_REASON_LENGTH = 240;
const MAX_WARNING_LENGTH = 180;
const MAX_TERM_LENGTH = 80;
const BLOCKED_RECOMMENDATION_LANGUAGE_PATTERN =
  /\b(?:sell as lot|sell as single|lot recommendation|single recommendation)\b/i;

const compIdSchema = z
  .string({
    required_error: 'compId is required',
    invalid_type_error: 'compId must be a string',
  })
  .trim()
  .min(1, 'compId is required');

const priceExplanationSchema = z
  .string({
    required_error: 'priceExplanation is required',
    invalid_type_error: 'priceExplanation must be a string',
  })
  .trim()
  .min(1, 'priceExplanation is required')
  .max(MAX_EXPLANATION_LENGTH, `priceExplanation must be at most ${MAX_EXPLANATION_LENGTH} characters`)
  .refine(
    (value) => !BLOCKED_RECOMMENDATION_LANGUAGE_PATTERN.test(value),
    'priceExplanation contains disallowed lot/single recommendation language',
  );

const compNoteSchema = z
  .object({
    compId: compIdSchema,
    note: z
      .string({
        required_error: 'compNotes.note is required',
        invalid_type_error: 'compNotes.note must be a string',
      })
      .trim()
      .min(1, 'compNotes.note is required')
      .max(MAX_COMP_NOTE_LENGTH, `compNotes.note must be at most ${MAX_COMP_NOTE_LENGTH} characters`)
      .refine(
        (value) => !BLOCKED_RECOMMENDATION_LANGUAGE_PATTERN.test(value),
        'compNotes.note contains disallowed lot/single recommendation language',
      ),
  })
  .strict();

const shortStringArrayItemSchema = (fieldName: string, maxLength: number) =>
  z
    .string({
      required_error: `${fieldName} entry is required`,
      invalid_type_error: `${fieldName} entry must be a string`,
    })
    .trim()
    .min(1, `${fieldName} entry is required`)
    .max(maxLength, `${fieldName} entry must be at most ${maxLength} characters`)
    .refine(
      (value) => !BLOCKED_RECOMMENDATION_LANGUAGE_PATTERN.test(value),
      `${fieldName} contains disallowed lot/single recommendation language`,
    );

const llmPricingReasoningSchema = z
  .object({
    selectedCompIds: z.array(compIdSchema, {
      required_error: 'selectedCompIds is required',
      invalid_type_error: 'selectedCompIds must be an array',
    }),
    rejectedCompIds: z.array(compIdSchema, {
      required_error: 'rejectedCompIds is required',
      invalid_type_error: 'rejectedCompIds must be an array',
    }),
    conditionAdjustedPrice: z
      .number({
        invalid_type_error: 'conditionAdjustedPrice must be a number or null',
      })
      .finite('conditionAdjustedPrice must be finite')
      .nullable(),
    conditionAdjustmentPercent: z
      .number({
        invalid_type_error: 'conditionAdjustmentPercent must be a number or null',
      })
      .finite('conditionAdjustmentPercent must be finite')
      .nullable(),
    conditionAdjustmentReason: z
      .string({
        invalid_type_error: 'conditionAdjustmentReason must be a string or null',
      })
      .trim()
      .min(1, 'conditionAdjustmentReason is required when present')
      .max(MAX_REASON_LENGTH, `conditionAdjustmentReason must be at most ${MAX_REASON_LENGTH} characters`)
      .nullable(),
    confidence: z.enum(['low', 'medium', 'high'], {
      required_error: 'confidence is required',
      invalid_type_error: 'confidence must be one of low, medium, high',
    }),
    priceExplanation: priceExplanationSchema,
    reviewWarnings: z
      .array(shortStringArrayItemSchema('reviewWarnings', MAX_WARNING_LENGTH), {
        invalid_type_error: 'reviewWarnings must be an array',
      })
      .optional(),
    ambiguousConditionTerms: z
      .array(shortStringArrayItemSchema('ambiguousConditionTerms', MAX_TERM_LENGTH), {
        invalid_type_error: 'ambiguousConditionTerms must be an array',
      })
      .optional(),
    compNotes: z.array(compNoteSchema, {
      invalid_type_error: 'compNotes must be an array',
    }).optional(),
  })
  .strict();

export class LlmPricingReasoningValidationError extends Error {
  readonly issues: ZodIssue[];

  constructor(issues: ZodIssue[], message?: string, options?: ErrorOptions) {
    super(message ?? formatValidationIssues(issues), options);
    this.name = 'LlmPricingReasoningValidationError';
    this.issues = issues;
  }
}

export function parseLlmPricingReasoningOutput(
  raw: string | unknown,
  context: LlmPricingReasoningValidationContext,
): LlmPricingReasoning {
  const parsed = parseReasoningPayload(raw);
  const result = llmPricingReasoningSchema.superRefine((value, refinementContext) => {
    validateCompIds(value.selectedCompIds, 'selectedCompIds', context, refinementContext);
    validateCompIds(value.rejectedCompIds, 'rejectedCompIds', context, refinementContext);

    const overlappingCompIds = value.selectedCompIds.filter((compId) => value.rejectedCompIds.includes(compId));
    if (overlappingCompIds.length > 0) {
      refinementContext.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['selectedCompIds'],
        message: `selectedCompIds overlaps rejectedCompIds: ${overlappingCompIds.join(', ')}`,
      });
    }

    value.compNotes?.forEach((compNote, index) => {
      if (!context.validCompIds.includes(compNote.compId)) {
        refinementContext.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['compNotes', index, 'compId'],
          message: `compNotes compId is unknown: ${compNote.compId}`,
        });
      }
    });

    if (value.conditionAdjustedPrice !== null) {
      const normalizedConditionAdjustedPrice = normalizeSuggestedPrice(value.conditionAdjustedPrice);

      if (normalizedConditionAdjustedPrice === null) {
        refinementContext.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['conditionAdjustedPrice'],
          message: 'conditionAdjustedPrice must be a positive amount with non-zero rounded cents',
        });
        return;
      }

      if (!context.allowedAdjustment.eligible || context.allowedAdjustment.targetPrice === null) {
        refinementContext.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['conditionAdjustedPrice'],
          message: 'conditionAdjustedPrice requires deterministic eligible condition adjustment target',
        });
        return;
      }

      const normalizedTargetPrice = normalizeSuggestedPrice(context.allowedAdjustment.targetPrice);
      if (normalizedTargetPrice === null) {
        refinementContext.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['conditionAdjustedPrice'],
          message: 'conditionAdjustedPrice requires valid deterministic eligible condition adjustment target',
        });
        return;
      }

      if (normalizedConditionAdjustedPrice !== normalizedTargetPrice) {
        refinementContext.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['conditionAdjustedPrice'],
          message: `conditionAdjustedPrice must equal deterministic condition-adjusted target ${normalizedTargetPrice.toFixed(2)}`,
        });
      }
    }
  }).safeParse(parsed);

  if (!result.success) {
    throw new LlmPricingReasoningValidationError(result.error.issues);
  }

  return {
    ...result.data,
    conditionAdjustedPrice:
      result.data.conditionAdjustedPrice === null
        ? null
        : normalizeSuggestedPrice(result.data.conditionAdjustedPrice),
    conditionAdjustmentPercent:
      result.data.conditionAdjustmentPercent === null
        ? null
        : Number(result.data.conditionAdjustmentPercent.toFixed(4)),
  };
}

function parseReasoningPayload(raw: string | unknown): unknown {
  if (typeof raw !== 'string') {
    return raw;
  }

  const payload = extractJsonPayload(raw);

  if (payload.length === 0) {
    throw new LlmPricingReasoningValidationError([], 'LLM pricing reasoning response was empty.');
  }

  try {
    return JSON.parse(payload);
  } catch (error) {
    throw new LlmPricingReasoningValidationError([], 'LLM pricing reasoning response contained invalid JSON.', {
      cause: error,
    });
  }
}

function extractJsonPayload(rawText: string): string {
  const trimmed = rawText.trim();
  const fencedMatch = CODE_FENCE_PATTERN.exec(trimmed);

  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  return trimmed;
}

function validateCompIds(
  compIds: readonly string[],
  fieldName: 'selectedCompIds' | 'rejectedCompIds',
  context: LlmPricingReasoningValidationContext,
  refinementContext: z.RefinementCtx,
): void {
  const seenCompIds = new Set<string>();

  compIds.forEach((compId, index) => {
    if (seenCompIds.has(compId)) {
      refinementContext.addIssue({
        code: z.ZodIssueCode.custom,
        path: [fieldName, index],
        message: `${fieldName} contains duplicate compId: ${compId}`,
      });
      return;
    }

    seenCompIds.add(compId);

    if (!context.validCompIds.includes(compId)) {
      refinementContext.addIssue({
        code: z.ZodIssueCode.custom,
        path: [fieldName, index],
        message: `${fieldName} contains unknown compId: ${compId}`,
      });
    }
  });
}

function normalizeSuggestedPrice(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  const normalizedString = value.toFixed(2);
  const normalized = Number(normalizedString);
  if (normalized <= 0) {
    return null;
  }

  const cents = Number(normalizedString.replace('.', ''));
  if (!Number.isSafeInteger(cents)) {
    return null;
  }

  return normalized;
}

function formatValidationIssues(issues: readonly ZodIssue[]): string {
  if (issues.length === 0) {
    return 'LLM pricing reasoning validation failed.';
  }

  return issues
    .map((issue) => (issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message))
    .join('; ');
}
