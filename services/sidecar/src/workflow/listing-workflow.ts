import {
  LISTING_IDLE_SUB_STATUS,
  LISTING_STATUSES,
  LISTING_SUB_STATUSES,
  isValidListingWorkflowState,
  type ListingWorkflowState,
} from '@ebay-inventory/types';
import { z } from 'zod';

const workflowStateValidationMessage = (status: string, subStatus: string): string =>
  `subStatus "${subStatus}" is not valid for status "${status}"`;

const listingIdSchema = z
  .string({
    required_error: 'listingId is required',
    invalid_type_error: 'listingId must be a string',
  })
  .trim()
  .min(1, 'listingId is required');

export const listingStatusSchema = z.enum(LISTING_STATUSES);
export const listingSubStatusSchema = z.enum(LISTING_SUB_STATUSES);

function assertValidWorkflowState(
  input: { status: string; subStatus: string },
  ctx: z.RefinementCtx
): void {
  if (!isValidListingWorkflowState(input.status, input.subStatus)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: workflowStateValidationMessage(input.status, input.subStatus),
      path: ['subStatus'],
    });
  }
}

export const listingWorkflowStateSchema = z
  .object({
    status: listingStatusSchema,
    subStatus: listingSubStatusSchema,
  })
  .strict()
  .superRefine(assertValidWorkflowState);

export const watcherWorkflowUpdateSchema = z
  .object({
    source: z.literal('watcher'),
    listingId: listingIdSchema,
    status: listingStatusSchema,
    subStatus: listingSubStatusSchema,
  })
  .superRefine(assertValidWorkflowState);

export const geminiWorkflowUpdateSchema = z
  .object({
    source: z.literal('gemini'),
    listingId: listingIdSchema,
    status: listingStatusSchema,
    subStatus: listingSubStatusSchema,
  })
  .superRefine(assertValidWorkflowState);

export type WatcherWorkflowUpdate = z.infer<typeof watcherWorkflowUpdateSchema>;
export type GeminiWorkflowUpdate = z.infer<typeof geminiWorkflowUpdateSchema>;
export type ListingWorkflowStateInput = z.infer<typeof listingWorkflowStateSchema>;

export function createIdleWorkflowState(
  status: ListingWorkflowState['status']
): ListingWorkflowState {
  return {
    status,
    subStatus: LISTING_IDLE_SUB_STATUS,
  };
}
