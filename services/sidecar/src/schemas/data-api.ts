import { CAPTURE_MODES } from '@ebay-inventory/types';
import { z } from 'zod';
import { listingWorkflowStateSchema } from '@/workflow/listing-workflow.js';

const trimmedStringSchema = (name: string): z.ZodString =>
  z
    .string({
      required_error: `${name} is required`,
      invalid_type_error: `${name} must be a string`,
    })
    .trim()
    .min(1, `${name} is required`);

const nullableTrimmedStringSchema = (name: string): z.ZodOptional<z.ZodNullable<z.ZodString>> =>
  trimmedStringSchema(name).nullable().optional();

const listingTypeSchema = z.enum(['single', 'lot']);
const captureModeSchema = z.enum(CAPTURE_MODES);

const itemSpecificsSchema = z.record(z.string(), z.unknown());
const publicImageUrlSchema = z
  .string({
    required_error: 'imageUrl is required',
    invalid_type_error: 'imageUrl must be a string',
  })
  .trim()
  .min(1, 'imageUrl is required')
  .url('imageUrl must be a valid URL')
  .refine((value) => {
    try {
      const protocol = new URL(value).protocol;
      return protocol === 'http:' || protocol === 'https:';
    } catch {
      return false;
    }
  }, 'imageUrl must use http or https');

export const listingIdParamsSchema = z.object({
  listingId: trimmedStringSchema('listingId'),
});

export const editableListingFieldsSchema = z
  .object({
    captureMode: captureModeSchema.nullable().optional(),
    categoryId: nullableTrimmedStringSchema('categoryId'),
    conditionId: nullableTrimmedStringSchema('conditionId'),
    conditionNotes: nullableTrimmedStringSchema('conditionNotes'),
    description: nullableTrimmedStringSchema('description'),
    eseEligible: z.boolean().nullable().optional(),
    estimatedWeightOz: z.number().finite().nonnegative().nullable().optional(),
    handlingDays: z.number().int().nonnegative().nullable().optional(),
    imageUrls: z.array(trimmedStringSchema('imageUrl')).optional(),
    itemSpecifics: itemSpecificsSchema.optional(),
    listingType: listingTypeSchema.nullable().optional(),
    merchantLocationKey: nullableTrimmedStringSchema('merchantLocationKey'),
    packageType: nullableTrimmedStringSchema('packageType'),
    price: z.number().finite().nonnegative().nullable().optional(),
    sellerHints: nullableTrimmedStringSchema('sellerHints'),
    shippingProfile: nullableTrimmedStringSchema('shippingProfile'),
    sku: nullableTrimmedStringSchema('sku'),
    title: nullableTrimmedStringSchema('title'),
  })
  .strict();

export const sellerEditableListingFieldsSchema = z
  .object({
    categoryId: nullableTrimmedStringSchema('categoryId'),
    conditionId: nullableTrimmedStringSchema('conditionId'),
    conditionNotes: nullableTrimmedStringSchema('conditionNotes'),
    description: nullableTrimmedStringSchema('description'),
    itemSpecifics: itemSpecificsSchema.optional(),
    price: z.number().finite().nonnegative().nullable().optional(),
    sellerHints: nullableTrimmedStringSchema('sellerHints'),
    title: nullableTrimmedStringSchema('title'),
  })
  .strict();

export const createListingRequestSchema = editableListingFieldsSchema
  .extend({
    listingId: trimmedStringSchema('listingId').optional(),
  })
  .strict();

export const updateListingRequestSchema = sellerEditableListingFieldsSchema.refine(
  (value) => Object.values(value).some((field) => field !== undefined),
  {
    message: 'At least one editable field is required.',
  }
);

export const updateListingImageUrlsRequestSchema = z
  .object({
    imageUrls: z.array(publicImageUrlSchema),
  })
  .strict();

export const updateListingWorkflowStateRequestSchema = listingWorkflowStateSchema;

export const enqueueGenerateAiRequestSchema = z
  .object({
    sellerHints: nullableTrimmedStringSchema('sellerHints'),
  })
  .strict();

export type EditableListingFieldsInput = z.infer<typeof editableListingFieldsSchema>;
export type SellerEditableListingFieldsInput = z.infer<
  typeof sellerEditableListingFieldsSchema
>;
export type CreateListingRequest = z.infer<typeof createListingRequestSchema>;
export type ListingIdParams = z.infer<typeof listingIdParamsSchema>;
export type UpdateListingRequest = z.infer<typeof updateListingRequestSchema>;
export type UpdateListingImageUrlsRequest = z.infer<
  typeof updateListingImageUrlsRequestSchema
>;
export type UpdateListingWorkflowStateRequest = z.infer<
  typeof updateListingWorkflowStateRequestSchema
>;
export type EnqueueGenerateAiRequest = z.infer<typeof enqueueGenerateAiRequestSchema>;
