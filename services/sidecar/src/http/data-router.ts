import { randomUUID } from 'crypto';
import {
  DEFAULT_APP_SETTINGS_ID,
  ListingWorkflowTransitionConflictError,
  getPricingProviderMode,
  parseSoldCompsUsageSnapshot,
  type ListingInsert,
  type AppSettingsRow,
  type ListingUpdate,
} from '@ebay-inventory/data';
import type { GeminiUsageLastAttempt } from '@ebay-inventory/data';
import type { SoldCompsUsageSnapshot } from '@ebay-inventory/data';
import { Router, type Request, type Response } from 'express';
import { ZodError, type ZodType } from 'zod';
import { getSidecarDataAccess, type SidecarDataAccess } from '@/data/sidecar-data.js';
import { getBaseUrl, getOauthBaseUrl } from '@/config/environment.js';
import {
  enqueueGenerateAiRequestSchema,
  createListingRequestSchema,
  listingIdParamsSchema,
  updatePricingProviderModeRequestSchema,
  updateListingRequestSchema,
  updateListingImageUrlsRequestSchema,
  updateListingWorkflowStateRequestSchema,
  type CreateListingRequest,
  type EditableListingFieldsInput,
  type SellerEditableListingFieldsInput,
} from '@/schemas/data-api.js';
import { mergePricingModifierOptions } from '@/listings/pricing-modifier-options.js';
import type { EbayEnvironmentResponse } from '@/types/ebay.js';
import { createIdleWorkflowState } from '@/workflow/listing-workflow.js';
import { retryListingWorkflow } from '@/jobs/manual-retry.js';
import { JOB_ERROR_CODES, SidecarJobError } from '@/jobs/job-errors.js';

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
  if (error instanceof ListingWorkflowTransitionConflictError) {
    res.status(409).json({
      error: 'listing_state_stale',
      message: error.message,
    });
    return;
  }

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

function sendManualRetryError(res: Response, error: unknown): void {
  if (error instanceof SidecarJobError) {
    if (error.code === JOB_ERROR_CODES.JOB_NOT_FOUND) {
      res.status(404).json({
        error: 'not_found',
        message: error.message,
      });
      return;
    }

    if (error.code === JOB_ERROR_CODES.LISTING_NOT_FOUND) {
      res.status(404).json({
        error: 'not_found',
        message: error.message,
      });
      return;
    }

    if (error.code === JOB_ERROR_CODES.MANUAL_RETRY_NOT_ALLOWED) {
      res.status(409).json({
        error: error.code,
        message: error.message,
      });
      return;
    }
  }

  sendRouteError(res, error);
}

function mapEditableListingFields(input: EditableListingFieldsInput): ListingUpdate {
  const itemSpecifics =
    input.pricingModifierOptions === undefined
      ? (input.itemSpecifics as ListingUpdate['item_specifics'])
      : (mergePricingModifierOptions(input.itemSpecifics ?? {}, input.pricingModifierOptions) as ListingUpdate['item_specifics']);

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
    item_specifics: itemSpecifics,
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
  input: SellerEditableListingFieldsInput,
  existingItemSpecifics?: ListingUpdate['item_specifics']
): ListingUpdate {
  const itemSpecifics =
    input.pricingModifierOptions === undefined
      ? (input.itemSpecifics as ListingUpdate['item_specifics'])
      : (mergePricingModifierOptions(
          input.itemSpecifics ?? existingItemSpecifics ?? {},
          input.pricingModifierOptions
        ) as ListingUpdate['item_specifics']);

  return {
    category_id: input.categoryId,
    condition_id: input.conditionId,
    condition_notes: input.conditionNotes,
    description: input.description,
    item_specifics: itemSpecifics,
    price: input.price,
    seller_hints: input.sellerHints,
    title: input.title,
  };
}

interface AppSettingsApiResponse extends Omit<AppSettingsRow, 'soldcomps_usage_snapshot'> {
  pricing_provider_mode: ReturnType<typeof getPricingProviderMode>;
  soldcomps_usage: Pick<SoldCompsUsageSnapshot, 'limit' | 'updatedAt' | 'used'> | null;
}

function mapSoldCompsUsageSnapshot(
  appSettings: AppSettingsRow
): AppSettingsApiResponse['soldcomps_usage'] {
  const snapshot = parseSoldCompsUsageSnapshot(appSettings.soldcomps_usage_snapshot);

  if (!snapshot) {
    return null;
  }

  return {
    limit: snapshot.limit,
    updatedAt: snapshot.updatedAt,
    used: snapshot.used,
  };
}

function serializeAppSettings(appSettings: AppSettingsRow): AppSettingsApiResponse {
  const { soldcomps_usage_snapshot: _soldCompsUsageSnapshot, ...rest } = appSettings;

  return {
    ...rest,
    pricing_provider_mode: getPricingProviderMode(appSettings),
    soldcomps_usage: mapSoldCompsUsageSnapshot(appSettings),
  };
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string');
}

function getEbayEnvironmentResponse(): EbayEnvironmentResponse {
  const environment = process.env.EBAY_ENVIRONMENT === 'production' ? 'production' : 'sandbox';
  const marketplaceId = (process.env.EBAY_MARKETPLACE_ID ?? '').trim() || 'EBAY_US';

  return {
    environment,
    marketplace_id: marketplaceId,
    api_base_url: getBaseUrl(environment),
    oauth_base_url: getOauthBaseUrl(environment),
  };
}

function mapGeminiUsageLastAttempt(
  attempt: GeminiUsageLastAttempt | null
): GeminiUsageLastAttempt | null {
  if (!attempt) {
    return null;
  }

  return {
    display_name: attempt.display_name,
    finished_at: attempt.finished_at,
    model_name: attempt.model_name,
    provider: attempt.provider,
    started_at: attempt.started_at,
    status: attempt.status,
  };
}

function warnGeminiUsageAttemptLookup(error: unknown): void {
  console.warn('Failed to load latest Gemini usage attempt.', {
    error: error instanceof Error ? error.message : String(error),
  });
}

function buildListingInsert(input: CreateListingRequest): ListingInsert {
  const listingId = input.listingId ?? randomUUID();
  const initialWorkflowState = createIdleWorkflowState('record_created');
  const mappedFields = mapEditableListingFields(input);

  return {
    ...mappedFields,
    image_urls: input.imageUrls ?? [],
    item_specifics:
      (mappedFields.item_specifics ?? input.itemSpecifics ?? {}) as ListingInsert['item_specifics'],
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
      res.json({
        listings: await getDataAccess().listings.list(),
      });
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

  router.get('/gemini-usage', async (_req: Request, res: Response) => {
    try {
      const summary = await getDataAccess().dailyUsage.getGeminiSummary();
      let lastAttempt: GeminiUsageLastAttempt | null = null;

      try {
        lastAttempt = await getDataAccess().aiModelAttempts.getLatestGeminiUsageAttempt();
      } catch (error) {
        warnGeminiUsageAttemptLookup(error);
      }

      res.json({
        effective_limit: summary.effectiveLimit,
        last_attempt: mapGeminiUsageLastAttempt(lastAttempt),
        remaining: summary.remaining,
        reset_at: summary.resetAt,
        reset_time_zone: summary.resetTimeZone,
        usage_date: summary.usageDate,
        used: summary.used,
      });
    } catch (error) {
      sendRouteError(res, error);
    }
  });

  router.get('/ebay-environment', (_req: Request, res: Response) => {
    res.json(getEbayEnvironmentResponse());
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
      let existingItemSpecifics: ListingUpdate['item_specifics'] | undefined;

      if (body.pricingModifierOptions !== undefined) {
        const existingListing = await getDataAccess().listings.getByListingId(params.listingId);

        if (!existingListing) {
          res.status(404).json({
            error: 'not_found',
            message: `Listing "${params.listingId}" was not found.`,
          });
          return;
        }

        existingItemSpecifics = existingListing.item_specifics as ListingUpdate['item_specifics'];
      }

      const listing = await getDataAccess().listings.update(
        params.listingId,
        mapSellerEditableListingFields(body, existingItemSpecifics)
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
      const listing =
        body.status === 'approved_for_export' && body.subStatus === 'publish_queued'
          ? await getDataAccess().listings.approveForExport(params.listingId)
          : await getDataAccess().listings.updateWorkflowState({
              listingId: params.listingId,
              status: body.status,
              subStatus: body.subStatus,
            });

      if (listing.status === 'approved_for_export' && listing.sub_status === 'publish_queued') {
        await getDataAccess().jobs.enqueuePublish(params.listingId);
      }

      res.json(listing);
    } catch (error) {
      sendRouteError(res, error);
    }
  });

  router.post('/listings/:listingId/generate-ai', async (req: Request, res: Response) => {
    const params = parseOrSend(res, listingIdParamsSchema, req.params);
    if (!params) {
      return;
    }

    const body = parseOrSend(res, enqueueGenerateAiRequestSchema, req.body);
    if (!body) {
      return;
    }

    try {
      const dataAccess = getDataAccess();
      const listing = await dataAccess.listings.getByListingId(params.listingId);

      if (!listing) {
        res.status(404).json({
          error: 'not_found',
          message: `Listing "${params.listingId}" was not found.`,
        });
        return;
      }

      if (listing.status !== 'assets_ready') {
        res.status(409).json({
          error: 'listing_not_assets_ready',
          message: `Listing "${params.listingId}" must be assets_ready before generate_ai can be enqueued.`,
        });
        return;
      }

      const preparedListing = await dataAccess.listings.prepareForGenerateAi({
        expectedUpdatedAt: listing.updated_at,
        listingId: params.listingId,
        sellerHints: body.sellerHints,
      });

      if (!preparedListing) {
        res.status(409).json({
          error: 'listing_state_stale',
          message: `Listing "${params.listingId}" changed before generate_ai could be enqueued. Refresh and retry.`,
        });
        return;
      }

      const enqueueResult = await dataAccess.jobs.enqueueGenerateAi(params.listingId);

      res.status(enqueueResult.alreadyQueued ? 200 : 201).json({
        alreadyQueued: enqueueResult.alreadyQueued,
        job: enqueueResult.job,
        listing: preparedListing,
      });
    } catch (error) {
      sendRouteError(res, error);
    }
  });

  router.post('/listings/:listingId/retry', async (req: Request, res: Response) => {
    const params = parseOrSend(res, listingIdParamsSchema, req.params);
    if (!params) {
      return;
    }

    try {
      const result = await retryListingWorkflow({
        dataAccess: getDataAccess(),
        listingId: params.listingId,
      });

      res.status(200).json(result);
    } catch (error) {
      sendManualRetryError(res, error);
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

      res.json(serializeAppSettings(appSettings));
    } catch (error) {
      sendRouteError(res, error);
    }
  });

  router.patch('/app-settings', async (req: Request, res: Response) => {
    const body = parseOrSend(res, updatePricingProviderModeRequestSchema, req.body);
    if (!body) {
      return;
    }

    try {
      const appSettings = await getDataAccess().appSettings.update(
        {
          pricing_provider_mode: body.pricingProviderMode,
        },
        DEFAULT_APP_SETTINGS_ID
      );

      res.json(serializeAppSettings(appSettings));
    } catch (error) {
      sendRouteError(res, error);
    }
  });

  return router;
}
