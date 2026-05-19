import { randomUUID } from 'crypto';
import { DEFAULT_APP_SETTINGS_ID, type Json, type ListingInsert, type ListingUpdate } from '@ebay-inventory/data';
import { Router, type Request, type Response } from 'express';
import { ZodError, type ZodType } from 'zod';
import { getSidecarDataAccess, type SidecarDataAccess } from '@/data/sidecar-data.js';
import {
  createListingRequestSchema,
  listingIdParamsSchema,
  updateListingRequestSchema,
  updateListingImageUrlsRequestSchema,
  updateListingWorkflowStateRequestSchema,
  type CreateListingRequest,
  type EditableListingFieldsInput,
  type SellerEditableListingFieldsInput,
} from '@/schemas/data-api.js';
import { createIdleWorkflowState } from '@/workflow/listing-workflow.js';

export interface DataApiRouterOptions {
  dataAccess?: SidecarDataAccess;
}

function parseOrSend<T>(
  res: Response,
  schema: ZodType<T>,
  input: unknown
): T | undefined {
  const parsed = schema.safeParse(input);

  if (parsed.success) {
    return parsed.data;
  }

  res.status(400).json({
    error: 'invalid_request',
    details: parsed.error.issues.map((issue) => ({
      message: issue.message,
      path: issue.path.join('.'),
    })),
  });
  return undefined;
}

function toStatusCode(error: unknown): number {
  if (error instanceof ZodError) {
    return 400;
  }

  const message = error instanceof Error ? error.message : String(error);

  if (message.includes('was not updated') || message.includes('were not updated')) {
    return 404;
  }

  return 500;
}

function sendRouteError(res: Response, error: unknown): void {
  const statusCode = toStatusCode(error);
  const errorMessage = error instanceof Error ? error.message : 'Unknown error';
  const responseMessage =
    statusCode === 500 ? 'An unexpected server error occurred.' : errorMessage;

  if (statusCode === 500) {
    console.error('Data API route error:', error);
  }

  res.status(statusCode).json({
    error: statusCode === 400 ? 'invalid_request' : statusCode === 404 ? 'not_found' : 'server_error',
    message: responseMessage,
  });
}

function mapEditableListingFields(input: EditableListingFieldsInput): ListingUpdate {
  return {
    capture_mode: input.captureMode,
    category_id: input.categoryId,
    condition_id: input.conditionId,
    condition_notes: input.conditionNotes,
    description: input.description,
    ese_eligible: input.eseEligible,
    estimated_weight_oz: input.estimatedWeightOz,
    handling_days: input.handlingDays,
    image_urls: input.imageUrls,
    item_specifics: input.itemSpecifics as Json | undefined,
    listing_type: input.listingType,
    merchant_location_key: input.merchantLocationKey,
    package_type: input.packageType,
    price: input.price,
    seller_hints: input.sellerHints,
    shipping_profile: input.shippingProfile,
    sku: input.sku,
    title: input.title,
  };
}

function mapSellerEditableListingFields(
  input: SellerEditableListingFieldsInput
): ListingUpdate {
  return {
    category_id: input.categoryId,
    condition_id: input.conditionId,
    condition_notes: input.conditionNotes,
    description: input.description,
    item_specifics: input.itemSpecifics as Json | undefined,
    price: input.price,
    seller_hints: input.sellerHints,
    title: input.title,
  };
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string');
}

function buildListingInsert(input: CreateListingRequest): ListingInsert {
  const listingId = input.listingId ?? `${input.mode}-${randomUUID()}`;
  const initialWorkflowState = createIdleWorkflowState('record_created');

  return {
    ...mapEditableListingFields(input),
    image_urls: input.imageUrls ?? [],
    item_specifics: (input.itemSpecifics ?? {}) as Json,
    listing_id: listingId,
    r2_object_keys: [],
    status: initialWorkflowState.status,
    sub_status: initialWorkflowState.subStatus,
  };
}

export function createDataApiRouter(options: DataApiRouterOptions = {}): Router {
  const router = Router();
  const getDataAccess = (): SidecarDataAccess => options.dataAccess ?? getSidecarDataAccess();

  router.get('/listings', async (_req: Request, res: Response) => {
    try {
      const listings = await getDataAccess().listings.list();
      res.json({ listings });
    } catch (error) {
      sendRouteError(res, error);
    }
  });

  router.get('/listings/:listingId', async (req: Request, res: Response) => {
    const params = parseOrSend(res, listingIdParamsSchema, req.params);
    if (!params) {
      return;
    }

    try {
      const listing = await getDataAccess().listings.getByListingId(params.listingId);

      if (!listing) {
        res.status(404).json({
          error: 'not_found',
          message: `Listing "${params.listingId}" was not found.`,
        });
        return;
      }

      res.json(listing);
    } catch (error) {
      sendRouteError(res, error);
    }
  });

  router.post('/listings', async (req: Request, res: Response) => {
    const body = parseOrSend(res, createListingRequestSchema, req.body);
    if (!body) {
      return;
    }

    try {
      const listing = await getDataAccess().listings.create(buildListingInsert(body));
      res.status(201).json(listing);
    } catch (error) {
      sendRouteError(res, error);
    }
  });

  router.patch('/listings/:listingId', async (req: Request, res: Response) => {
    const params = parseOrSend(res, listingIdParamsSchema, req.params);
    if (!params) {
      return;
    }

    const body = parseOrSend(res, updateListingRequestSchema, req.body);
    if (!body) {
      return;
    }

    try {
      const listing = await getDataAccess().listings.update(
        params.listingId,
        mapSellerEditableListingFields(body)
      );
      res.json(listing);
    } catch (error) {
      sendRouteError(res, error);
    }
  });

  router.patch('/listings/:listingId/image-urls', async (req: Request, res: Response) => {
    const params = parseOrSend(res, listingIdParamsSchema, req.params);
    if (!params) {
      return;
    }

    const body = parseOrSend(res, updateListingImageUrlsRequestSchema, req.body);
    if (!body) {
      return;
    }

    try {
      const listing = await getDataAccess().listings.getByListingId(params.listingId);

      if (!listing) {
        res.status(404).json({
          error: 'not_found',
          message: `Listing "${params.listingId}" was not found.`,
        });
        return;
      }

      const updatedListing = await getDataAccess().listings.saveImageMetadata({
        listingId: params.listingId,
        imageUrls: body.imageUrls,
        r2ObjectKeys: asStringArray(listing.r2_object_keys),
      });

      if (!updatedListing) {
        throw new Error(`Listing "${params.listingId}" was not updated.`);
      }

      res.json(updatedListing);
    } catch (error) {
      sendRouteError(res, error);
    }
  });

  router.patch('/listings/:listingId/workflow-state', async (req: Request, res: Response) => {
    const params = parseOrSend(res, listingIdParamsSchema, req.params);
    if (!params) {
      return;
    }

    const body = parseOrSend(res, updateListingWorkflowStateRequestSchema, req.body);
    if (!body) {
      return;
    }

    try {
      const listing = await getDataAccess().listings.updateWorkflowState({
        listingId: params.listingId,
        status: body.status,
        subStatus: body.subStatus,
      });
      res.json(listing);
    } catch (error) {
      sendRouteError(res, error);
    }
  });

  router.get('/app-settings', async (_req: Request, res: Response) => {
    try {
      const appSettings = await getDataAccess().appSettings.get(DEFAULT_APP_SETTINGS_ID);

      if (!appSettings) {
        res.status(404).json({
          error: 'not_found',
          message: 'App settings "default" were not found.',
        });
        return;
      }

      res.json(appSettings);
    } catch (error) {
      sendRouteError(res, error);
    }
  });

  return router;
}
