import { z, type ZodIssue } from 'zod';

import type {
  LlmPricingReasoning,
  LlmPricingReasoningValidationContext,
} from './types.js';

const CODE_FENCE_PATTERN = /^```(?:json)?\s*([\s\S]*?)\s*```$/i;
const MAX_EXPLANATION_LENGTH = 500;
const MAX_COMP_NOTE_LENGTH = 240;
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
    suggestedPrice: z
      .number({
        invalid_type_error: 'suggestedPrice must be a number or null',
      })
      .finite('suggestedPrice must be finite')
      .nullable(),
    confidence: z.enum(['low', 'medium', 'high'], {
      required_error: 'confidence is required',
      invalid_type_error: 'confidence must be one of low, medium, high',
    }),
    priceExplanation: priceExplanationSchema,
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

    if (value.suggestedPrice !== null) {
      const normalizedSuggestedPrice = normalizeSuggestedPrice(value.suggestedPrice);

      if (normalizedSuggestedPrice === null) {
        refinementContext.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['suggestedPrice'],
          message: 'suggestedPrice must be a positive amount with non-zero rounded cents',
        });
        return;
      }

      if (context.stats.lowSoldPrice === null || context.stats.highSoldPrice === null) {
        refinementContext.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['suggestedPrice'],
          message: 'suggestedPrice requires deterministic low/high sold price guardrails',
        });
        return;
      }

      const normalizedLow = normalizeSuggestedPrice(context.stats.lowSoldPrice);
      const normalizedHigh = normalizeSuggestedPrice(context.stats.highSoldPrice);

      if (normalizedLow === null || normalizedHigh === null) {
        refinementContext.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['suggestedPrice'],
          message: 'suggestedPrice requires valid deterministic low/high sold price guardrails',
        });
        return;
      }

      if (normalizedSuggestedPrice < normalizedLow || normalizedSuggestedPrice > normalizedHigh) {
        refinementContext.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['suggestedPrice'],
          message: `suggestedPrice must be within deterministic sold price range ${normalizedLow.toFixed(2)}-${normalizedHigh.toFixed(2)}`,
        });
      }
    }
  }).safeParse(parsed);

  if (!result.success) {
    throw new LlmPricingReasoningValidationError(result.error.issues);
  }

  return {
    ...result.data,
    suggestedPrice:
      result.data.suggestedPrice === null
        ? null
        : normalizeSuggestedPrice(result.data.suggestedPrice),
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
