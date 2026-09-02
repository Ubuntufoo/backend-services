import { randomUUID } from 'node:crypto';

import {
  VariationListingTransactionConflictError,
  type Json,
  type VariationListingAggregateSnapshot,
  type VariationListingPublishingCheckpoint,
  type VariationListingRevision,
} from '@ebay-inventory/data';
import { Router, type Request, type Response } from 'express';
import type { ZodType } from 'zod';

import type { SidecarDataAccess } from '@/data/sidecar-data.js';
import { getSidecarDataAccess } from '@/data/sidecar-data.js';
import {
  buildVariationListingGroupReviewInputFromAggregate,
  evaluateVariationListingGroupReadiness,
} from '@/gemini/variation-listing-group-review.js';
import {
  createVariationListingGroupRequestSchema,
  updateVariationListingCopyAvailabilityRequestSchema,
  updateVariationListingPriceRequestSchema,
  updateVariationListingRepresentativeCopyRequestSchema,
  updateVariationListingReviewDraftRequestSchema,
  variationListingCopyIdParamsSchema,
  variationListingGroupIdParamsSchema,
  variationListingVariationIdParamsSchema,
  type CreateVariationListingGroupRequest,
} from '@/schemas/variation-listing-api.js';

export type VariationListingApiDataAccess = SidecarDataAccess['variationListings'];

export interface VariationListingApiRouterOptions {
  dataAccess?: VariationListingApiDataAccess;
  createId?: () => string;
}

function parseOrSend<T>(res: Response, schema: ZodType<T>, value: unknown): T | undefined {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  res.status(400).json({
    error: 'invalid_request',
    details: result.error.issues.map((issue) => ({
      message: issue.message,
      path: issue.path.join('.'),
    })),
  });
  return undefined;
}

function sendError(res: Response, error: unknown): void {
  if (error instanceof VariationListingTransactionConflictError) {
    res.status(409).json({ error: 'variation_listing_state_stale', message: error.message });
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/not found/i.test(message)) {
    res.status(404).json({ error: 'not_found', message });
    return;
  }
  if (/duplicate key|unique constraint|already exists/i.test(message)) {
    res.status(409).json({ error: 'variation_listing_conflict', message });
    return;
  }
  console.error('Variation listing API route error:', error);
  res.status(500).json({ error: 'server_error', message: 'An unexpected server error occurred.' });
}

async function runRoute(res: Response, handler: () => Promise<void>): Promise<void> {
  try {
    await handler();
  } catch (error) {
    sendError(res, error);
  }
}

function groupKeyFromId(groupId: string): string {
  return `VL-G-${groupId.replaceAll('-', '').toUpperCase()}`;
}

function serializeCopy(copy: VariationListingAggregateSnapshot['copies'][number], representativeCopyId: string | null) {
  return {
    copyId: copy.copy_id,
    availabilityState: copy.availability_state,
    conditionToken: copy.condition_token,
    conditionNotes: copy.condition_notes,
    frontR2Key: copy.front_r2_key,
    backR2Key: copy.back_r2_key,
    captureSourceKey: copy.capture_source_key,
    capturePairId: copy.capture_pair_id,
    capturedAt: copy.captured_at,
    createdAt: copy.created_at,
    updatedAt: copy.updated_at,
    isRepresentative: copy.copy_id === representativeCopyId,
  };
}

function serializeVariation(
  variation: VariationListingAggregateSnapshot['variations'][number],
  copies: VariationListingAggregateSnapshot['copies']
) {
  const variationCopies = copies
    .filter((copy) => copy.variation_id === variation.variation_id)
    .map((copy) => serializeCopy(copy, variation.representative_copy_id));
  return {
    variationId: variation.variation_id,
    position: variation.position,
    inventorySerial: variation.inventory_serial,
    sku: variation.sku,
    selectorValue: variation.selector_value,
    priceAmount: variation.price_amount,
    priceCurrency: variation.price_currency,
    representativeCopyId: variation.representative_copy_id,
    availableQuantity: variationCopies.filter((copy) => copy.availabilityState === 'available').length,
    copyCount: variationCopies.length,
    variationMetadata: variation.variation_metadata,
    copies: variationCopies,
    createdAt: variation.created_at,
    updatedAt: variation.updated_at,
  };
}

function buildValidation(aggregate: VariationListingAggregateSnapshot) {
  const blockers: string[] = [];
  const reviewedReadiness =
    aggregate.variations.length === 0
      ? {
          ready: false,
          blockers: ['Variation listing publish readiness requires at least two variations.'],
          conditionCompatible: true,
          incompatibleCopies: [],
        }
      : evaluateVariationListingGroupReadiness(
          buildVariationListingGroupReviewInputFromAggregate(aggregate)
        );
  blockers.push(...reviewedReadiness.blockers);
  const prePublication = aggregate.group.last_confirmed_revision === null;
  if (!aggregate.group.title) blockers.push('Group title is required.');
  if (!aggregate.group.description) blockers.push('Group description is required.');
  for (const variation of aggregate.variations) {
    const copies = aggregate.copies.filter((copy) => copy.variation_id === variation.variation_id);
    if (!variation.representative_copy_id) {
      blockers.push(`Variation ${variation.variation_id} has no representative copy.`);
    } else if (!copies.some((copy) => copy.copy_id === variation.representative_copy_id)) {
      blockers.push(`Variation ${variation.variation_id} representative copy is not owned by the variation.`);
    }
    if (prePublication && copies.every((copy) => copy.availability_state !== 'available')) {
      blockers.push(`Variation ${variation.variation_id} requires positive available quantity for initial publication.`);
    }
  }
  const terminal = ['withdrawn', 'abandoned', 'cleanup', 'terminal-absent'].includes(
    aggregate.group.lifecycle_state
  );
  if (terminal) blockers.push(`Lifecycle ${aggregate.group.lifecycle_state} is not publishable.`);
  return {
    blockers,
    initialPublicationReady: blockers.length === 0 && prePublication && reviewedReadiness.ready,
    hasPendingChanges:
      aggregate.group.last_confirmed_revision === null
        ? aggregate.group.desired_revision > 0
        : aggregate.group.desired_revision > aggregate.group.last_confirmed_revision,
  };
}

function summarizeJournal(
  revision: VariationListingRevision | null,
  checkpoints: VariationListingPublishingCheckpoint[]
) {
  if (!revision) return { latestRevision: null };
  const latestByKey = new Map<string, VariationListingPublishingCheckpoint>();
  for (const checkpoint of checkpoints) {
    const previous = latestByKey.get(checkpoint.operationKey);
    if (
      !previous ||
      checkpoint.attemptNumber > previous.attemptNumber ||
      (checkpoint.attemptNumber === previous.attemptNumber &&
        checkpoint.checkpointNumber > previous.checkpointNumber)
    ) {
      latestByKey.set(checkpoint.operationKey, checkpoint);
    }
  }
  return {
    latestRevision: {
      revisionId: revision.revisionId,
      capturedDesiredRevision: revision.capturedDesiredRevision,
      operationCount: revision.operationCount,
      capturedAt: revision.source.captured_at,
      hasUnknownOutcome: checkpoints.some(
        (checkpoint) =>
          checkpoint.state === 'unknown' || checkpoint.observedRemoteState === 'unknown'
      ),
      retryExhausted: checkpoints.some((checkpoint) => checkpoint.state === 'retry_exhausted'),
      operations: revision.operationPlan.map((operation) => {
        const latest = latestByKey.get(operation.operation_key);
        return {
          operationKey: operation.operation_key,
          operationKind: operation.operation_kind,
          state: latest?.state ?? 'pending',
          observedRemoteState: latest?.observedRemoteState ?? null,
          attemptNumber: latest?.attemptNumber ?? 0,
          checkpointNumber: latest?.checkpointNumber ?? 0,
        };
      }),
    },
  };
}

async function serializeAggregate(dataAccess: VariationListingApiDataAccess, aggregate: VariationListingAggregateSnapshot) {
  const revisions = await dataAccess.listRevisionsByGroupId(aggregate.group.group_id);
  const latestRevision = revisions[0] ?? null;
  const checkpoints = latestRevision
    ? await dataAccess.listCheckpointsByRevisionId(latestRevision.revisionId)
    : [];
  const variations = [...aggregate.variations]
    .sort((left, right) => left.position - right.position)
    .map((variation) => serializeVariation(variation, aggregate.copies));
  return {
    groupId: aggregate.group.group_id,
    groupKey: aggregate.group.group_key,
    lifecycleState: aggregate.group.lifecycle_state,
    desiredRevision: aggregate.group.desired_revision,
    lastConfirmedRevision: aggregate.group.last_confirmed_revision,
    title: aggregate.group.title,
    description: aggregate.group.description,
    derivedCommonEbayAspects: aggregate.group.derived_common_ebay_aspects,
    categoryId: aggregate.group.category_id,
    marketplaceId: aggregate.group.marketplace_id,
    listingFormat: aggregate.group.listing_format,
    merchantLocationKey: aggregate.group.merchant_location_key,
    fulfillmentPolicyId: aggregate.group.fulfillment_policy_id,
    paymentPolicyId: aggregate.group.payment_policy_id,
    returnPolicyId: aggregate.group.return_policy_id,
    conditionId: aggregate.group.condition_id,
    conditionToken: aggregate.group.condition_token,
    conditionDescription: aggregate.group.condition_description,
    conditionDescriptors: aggregate.group.condition_descriptors,
    selectorName: aggregate.group.selector_name,
    skuNamespace: {
      categoryCode: aggregate.group.sku_category_code,
      bucketToken: aggregate.group.sku_bucket_token,
      nextInventorySerial: aggregate.group.next_inventory_serial,
    },
    variationCount: variations.length,
    totalAvailableQuantity: variations.reduce((sum, variation) => sum + variation.availableQuantity, 0),
    variations,
    validation: buildValidation(aggregate),
    journal: summarizeJournal(latestRevision, checkpoints),
    createdAt: aggregate.group.created_at,
    updatedAt: aggregate.group.updated_at,
  };
}

async function requireAggregate(
  res: Response,
  dataAccess: VariationListingApiDataAccess,
  groupId: string
): Promise<VariationListingAggregateSnapshot | null> {
  const aggregate = await dataAccess.loadAggregate(groupId);
  if (!aggregate) {
    res.status(404).json({ error: 'not_found', message: `Variation listing group "${groupId}" was not found.` });
    return null;
  }
  return aggregate;
}

export function createVariationListingApiRouter(options: VariationListingApiRouterOptions = {}): Router {
  const router = Router();
  const getDataAccess = (): VariationListingApiDataAccess =>
    options.dataAccess ?? getSidecarDataAccess().variationListings;

  router.get('/', async (_req: Request, res: Response) =>
    await runRoute(res, async () => {
      const dataAccess = getDataAccess();
      const groups = await dataAccess.listGroups();
      const serialized = [];
      for (const group of groups) {
        const aggregate = await dataAccess.loadAggregate(group.groupId);
        if (!aggregate) throw new Error(`Variation listing group ${group.groupId} disappeared during read.`);
        serialized.push(await serializeAggregate(dataAccess, aggregate));
      }
      res.json({ groups: serialized });
    })
  );

  router.get('/:groupId', async (req: Request, res: Response) => {
    const params = parseOrSend(res, variationListingGroupIdParamsSchema, req.params);
    if (!params) return;
    return await runRoute(res, async () => {
      const dataAccess = getDataAccess();
      const aggregate = await requireAggregate(res, dataAccess, params.groupId);
      if (!aggregate) return;
      res.json(await serializeAggregate(dataAccess, aggregate));
    });
  });

  router.post('/', async (req: Request, res: Response) => {
    const body = parseOrSend(res, createVariationListingGroupRequestSchema, req.body);
    if (!body) return;
    return await runRoute(res, async () => {
      const dataAccess = getDataAccess();
      const groupId = (options.createId ?? randomUUID)();
      const input = buildCreateGroupInput(groupId, body);
      await dataAccess.createGroup(input);
      const aggregate = await requireAggregate(res, dataAccess, groupId);
      if (!aggregate) return;
      res.status(201).json(await serializeAggregate(dataAccess, aggregate));
    });
  });

  router.patch('/:groupId/review-draft', async (req: Request, res: Response) => {
    const params = parseOrSend(res, variationListingGroupIdParamsSchema, req.params);
    const body = parseOrSend(res, updateVariationListingReviewDraftRequestSchema, req.body);
    if (!params || !body) return;
    return await runRoute(res, async () => {
      const dataAccess = getDataAccess();
      await dataAccess.applyGroupReviewDraft({
        groupId: params.groupId,
        expectedDesiredRevision: body.expectedDesiredRevision,
        title: body.title,
        description: body.description,
        derivedCommonEbayAspects: body.derivedCommonEbayAspects as Json,
      });
      const aggregate = await requireAggregate(res, dataAccess, params.groupId);
      if (!aggregate) return;
      res.json(await serializeAggregate(dataAccess, aggregate));
    });
  });

  router.patch('/:groupId/variations/:variationId/price', async (req: Request, res: Response) => {
    const params = parseOrSend(res, variationListingVariationIdParamsSchema, req.params);
    const body = parseOrSend(res, updateVariationListingPriceRequestSchema, req.body);
    if (!params || !body) return;
    return await runRoute(res, async () => {
      const dataAccess = getDataAccess();
      await dataAccess.updateVariationPrice({
        groupId: params.groupId,
        variationId: params.variationId,
        expectedDesiredRevision: body.expectedDesiredRevision,
        priceAmount: body.priceAmount,
      });
      const aggregate = await requireAggregate(res, dataAccess, params.groupId);
      if (!aggregate) return;
      res.json(await serializeAggregate(dataAccess, aggregate));
    });
  });

  router.patch('/:groupId/variations/:variationId/representative-copy', async (req: Request, res: Response) => {
    const params = parseOrSend(res, variationListingVariationIdParamsSchema, req.params);
    const body = parseOrSend(res, updateVariationListingRepresentativeCopyRequestSchema, req.body);
    if (!params || !body) return;
    return await runRoute(res, async () => {
      const dataAccess = getDataAccess();
      await dataAccess.updateRepresentativeCopy({
        groupId: params.groupId,
        variationId: params.variationId,
        copyId: body.copyId,
        expectedDesiredRevision: body.expectedDesiredRevision,
      });
      const aggregate = await requireAggregate(res, dataAccess, params.groupId);
      if (!aggregate) return;
      res.json(await serializeAggregate(dataAccess, aggregate));
    });
  });

  router.patch('/:groupId/variations/:variationId/copies/:copyId/availability', async (req: Request, res: Response) => {
    const params = parseOrSend(res, variationListingCopyIdParamsSchema, req.params);
    const body = parseOrSend(res, updateVariationListingCopyAvailabilityRequestSchema, req.body);
    if (!params || !body) return;
    return await runRoute(res, async () => {
      const dataAccess = getDataAccess();
      await dataAccess.updateCopyAvailability({
        groupId: params.groupId,
        variationId: params.variationId,
        copyId: params.copyId,
        expectedDesiredRevision: body.expectedDesiredRevision,
        availabilityState: body.availabilityState,
      });
      const aggregate = await requireAggregate(res, dataAccess, params.groupId);
      if (!aggregate) return;
      res.json(await serializeAggregate(dataAccess, aggregate));
    });
  });

  return router;
}

function buildCreateGroupInput(
  groupId: string,
  body: CreateVariationListingGroupRequest
): Parameters<VariationListingApiDataAccess['createGroup']>[0] {
  return {
    groupId,
    groupKey: groupKeyFromId(groupId),
    skuCategoryCode: body.skuCategoryCode,
    skuBucketToken: body.skuBucketToken,
    categoryId: '261328',
    marketplaceId: 'EBAY_US',
    merchantLocationKey: body.merchantLocationKey,
    fulfillmentPolicyId: body.fulfillmentPolicyId,
    paymentPolicyId: body.paymentPolicyId,
    returnPolicyId: body.returnPolicyId,
    conditionId: body.conditionId,
    conditionToken: body.conditionToken,
  };
}
