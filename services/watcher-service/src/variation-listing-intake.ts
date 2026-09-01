import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

import {
  VARIATION_LISTING_MANUAL_PRICE_AMOUNTS,
  createSupabaseServiceClient,
  getVariationListingIntakeSessionBySourceKey,
  isVariationListingManualPriceAmount,
  uploadImage,
  type Json,
  type SupabaseDataClient,
  type UploadImageResult,
  type VariationListingIntakeSession,
  type VariationListingManualPriceAmount,
} from '@ebay-inventory/data';

import {
  isSupportedWatcherImagePath,
  normalizeWatcherImageExtension,
} from './config/image-extensions.js';
import type { WatcherImageDescriptor } from './image-grouping.js';

export { VARIATION_LISTING_MANUAL_PRICE_AMOUNTS };
export type { VariationListingManualPriceAmount };

export const VARIATION_LISTING_COPY_CONDITION_TOKENS = [
  'NEAR_MINT_OR_BETTER',
  'EXCELLENT',
  'VERY_GOOD',
  'POOR',
] as const;

export type VariationListingCopyConditionToken =
  (typeof VARIATION_LISTING_COPY_CONDITION_TOKENS)[number];
export type VariationListingPendingMode = 'new_variation' | 'duplicate_copy';

export interface VariationListingWatcherPendingPair {
  expectedDesiredRevision: number;
  frontSourceRef: string;
  mode: VariationListingPendingMode;
  pairId: string;
  priceAmount: VariationListingManualPriceAmount;
  priceCurrency: 'USD';
  startedAt: string;
  targetGroupId: string;
  targetVariationId: string | null;
}

export type VariationListingWatcherEventRoute =
  | {
      kind: 'legacy';
      image: WatcherImageDescriptor;
    }
  | {
      kind: 'ignored';
      image: WatcherImageDescriptor;
      reason: 'unsupported_image';
    }
  | {
      kind: 'start_pair';
      captureSourceKey: string;
      frontSourceRef: string;
      frozenMode: VariationListingPendingMode;
      frozenPriceAmount: VariationListingManualPriceAmount;
      frozenPriceCurrency: 'USD';
      frozenTargetGroupId: string;
      frozenTargetVariationId: string | null;
      pairId: string;
      startedAt: string;
    }
  | {
      kind: 'duplicate_front';
      captureSourceKey: string;
      pendingPair: VariationListingWatcherPendingPair;
      sourceRef: string;
    }
  | {
      kind: 'completion_candidate';
      backSourceRef: string;
      captureSourceKey: string;
      completionKind: VariationListingPendingMode;
      pendingPair: VariationListingWatcherPendingPair;
    };

export interface VariationListingNewVariationStorageHandoff {
  completionKind: 'new_variation';
  conditionToken: VariationListingCopyConditionToken;
  selectorValue: string;
  variationMetadata: Json;
  capturedAt?: string;
}

export interface VariationListingDuplicateCopyStorageHandoff {
  completionKind: 'duplicate_copy';
  conditionToken: VariationListingCopyConditionToken;
  capturedAt?: string;
}

export type VariationListingStorageHandoff =
  | VariationListingNewVariationStorageHandoff
  | VariationListingDuplicateCopyStorageHandoff;

interface VariationListingStorageReadyCompletionCommon {
  backR2Key: string;
  backSourceRef: string;
  capturePairId: string;
  captureSourceKey: string;
  captureStartedAt: string;
  capturedAt?: string;
  conditionToken: VariationListingCopyConditionToken;
  copyId: string;
  expectedDesiredRevision: number;
  frontR2Key: string;
  frontSourceRef: string;
  frozenPriceAmount: VariationListingManualPriceAmount;
  frozenPriceCurrency: 'USD';
  targetGroupId: string;
}

export interface VariationListingNewVariationStorageReadyCompletionCommand
  extends VariationListingStorageReadyCompletionCommon {
  completionKind: 'new_variation';
  selectorValue: string;
  variationId: string;
  variationMetadata: Json;
}

export interface VariationListingDuplicateCopyStorageReadyCompletionCommand
  extends VariationListingStorageReadyCompletionCommon {
  completionKind: 'duplicate_copy';
  variationId: string;
}

export type VariationListingStorageReadyCompletionCommand =
  | VariationListingNewVariationStorageReadyCompletionCommand
  | VariationListingDuplicateCopyStorageReadyCompletionCommand;

export interface VariationListingIntakeSessionReader {
  getBySourceKey(captureSourceKey: string): Promise<VariationListingIntakeSession | null>;
}

export interface RouteVariationListingWatcherEventDependencies {
  createPairId?: () => string;
  now?: () => Date;
  sessionReader?: VariationListingIntakeSessionReader;
}

export interface StoreVariationListingCompletionDependencies {
  createId?: () => string;
  readImage?: (sourcePath: string) => Promise<Buffer | Uint8Array>;
  uploadStoredImage?: (input: {
    body: Buffer | Uint8Array;
    contentType: string;
    objectKey: string;
    sourcePath: string;
    targetGroupId: string;
  }) => Promise<UploadImageResult>;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONDITION_SET = new Set<string>(VARIATION_LISTING_COPY_CONDITION_TOKENS);

function fail(message: string): never {
  throw new Error(`Variation listing watcher routing failed: ${message}`);
}

function requireNonEmptyExact(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    return fail(`${label} must be a non-empty outer-trimmed string.`);
  }
  return value;
}

function requireUuid(value: unknown, label: string): string {
  const id = requireNonEmptyExact(value, label);
  if (!UUID_PATTERN.test(id)) {
    return fail(`${label} must be a UUID.`);
  }
  return id.toLowerCase();
}

function requirePrice(value: unknown, label: string): VariationListingManualPriceAmount {
  if (!isVariationListingManualPriceAmount(value)) {
    return fail(`${label} must be one of ${VARIATION_LISTING_MANUAL_PRICE_AMOUNTS.join(', ')}.`);
  }
  return value;
}

function normalizeInstant(value: string | Date, label: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return fail(`${label} must be a valid timestamp.`);
  }
  return date.toISOString();
}

function requireConditionToken(value: string): VariationListingCopyConditionToken {
  if (!CONDITION_SET.has(value)) {
    return fail(`conditionToken must be one of ${VARIATION_LISTING_COPY_CONDITION_TOKENS.join(', ')}.`);
  }
  return value as VariationListingCopyConditionToken;
}

function requireJsonObject(value: Json): Json {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    return fail('variationMetadata must be a JSON object.');
  }
  return value;
}

function parsePendingPair(value: Record<string, unknown>): VariationListingWatcherPendingPair {
  const pairId = requireUuid(value.pair_id, 'pending pair pair_id');
  const mode = value.mode;
  if (mode !== 'new_variation' && mode !== 'duplicate_copy') {
    return fail('pending pair mode is invalid.');
  }

  const targetGroupId = requireUuid(value.target_group_id, 'pending pair target_group_id');
  const targetVariationId =
    mode === 'new_variation'
      ? value.target_variation_id === null
        ? null
        : fail('new-variation pending pair target_variation_id must be null.')
      : requireUuid(value.target_variation_id, 'pending pair target_variation_id');
  const priceAmount = requirePrice(value.price_amount, 'pending pair price_amount');

  if (value.price_currency !== 'USD') {
    return fail('pending pair price_currency must be USD.');
  }

  const frontSourceRef = requireNonEmptyExact(
    value.front_source_ref,
    'pending pair front_source_ref'
  );
  const startedAt = normalizeInstant(
    requireNonEmptyExact(value.started_at, 'pending pair started_at'),
    'pending pair started_at'
  );
  const expectedDesiredRevision = value.expected_desired_revision;
  if (
    typeof expectedDesiredRevision !== 'number' ||
    !Number.isInteger(expectedDesiredRevision) ||
    expectedDesiredRevision < 0
  ) {
    return fail('pending pair expected_desired_revision must be a non-negative integer.');
  }

  return {
    expectedDesiredRevision,
    frontSourceRef,
    mode,
    pairId,
    priceAmount,
    priceCurrency: 'USD',
    startedAt,
    targetGroupId,
    targetVariationId,
  };
}

function assertSessionConfiguration(session: VariationListingIntakeSession): void {
  requireNonEmptyExact(session.captureSourceKey, 'captureSourceKey');
  requirePrice(session.stickyPriceAmount, 'stickyPriceAmount');
  if (session.stickyPriceCurrency !== 'USD') {
    fail('stickyPriceCurrency must be USD.');
  }

  if (session.mode === 'idle') {
    if (session.targetGroupId !== null || session.targetVariationId !== null) {
      fail('idle session must not have a target.');
    }
    return;
  }

  if (session.mode === 'new_variation') {
    requireUuid(session.targetGroupId, 'targetGroupId');
    if (session.targetVariationId !== null) {
      fail('new-variation session must not have targetVariationId.');
    }
    return;
  }

  if (session.mode === 'duplicate_copy') {
    requireUuid(session.targetGroupId, 'targetGroupId');
    requireUuid(session.targetVariationId, 'targetVariationId');
    return;
  }

  fail(`unsupported intake session mode ${JSON.stringify(session.mode)}.`);
}

function assertPendingMatchesSession(
  session: VariationListingIntakeSession,
  pendingPair: VariationListingWatcherPendingPair
): void {
  if (session.mode !== pendingPair.mode) {
    fail('pending pair mode disagrees with current durable session mode.');
  }
  if (session.targetGroupId?.toLowerCase() !== pendingPair.targetGroupId) {
    fail('pending pair target group disagrees with current durable session target.');
  }
  if ((session.targetVariationId?.toLowerCase() ?? null) !== pendingPair.targetVariationId) {
    fail('pending pair target variation disagrees with current durable session target.');
  }
  if (
    session.stickyPriceAmount !== pendingPair.priceAmount ||
    session.stickyPriceCurrency !== pendingPair.priceCurrency
  ) {
    fail('pending pair price disagrees with current durable session price.');
  }
}

export function createVariationListingIntakeSessionReader(
  client: SupabaseDataClient = createSupabaseServiceClient()
): VariationListingIntakeSessionReader {
  return {
    getBySourceKey: async (captureSourceKey) =>
      await getVariationListingIntakeSessionBySourceKey(client, captureSourceKey),
  };
}

export async function routeVariationListingWatcherEvent(
  input: {
    captureSourceKey: string;
    image: WatcherImageDescriptor;
  },
  dependencies: RouteVariationListingWatcherEventDependencies = {}
): Promise<VariationListingWatcherEventRoute> {
  const captureSourceKey = requireNonEmptyExact(input.captureSourceKey, 'captureSourceKey');
  const sourceRef = requireNonEmptyExact(input.image.path, 'WatcherImageDescriptor.path');

  if (!isSupportedWatcherImagePath(sourceRef)) {
    return {
      image: { path: sourceRef },
      kind: 'ignored',
      reason: 'unsupported_image',
    };
  }

  const sessionReader =
    dependencies.sessionReader ?? createVariationListingIntakeSessionReader();
  const session = await sessionReader.getBySourceKey(captureSourceKey);

  if (session === null) {
    return { image: { path: sourceRef }, kind: 'legacy' };
  }
  if (session.captureSourceKey !== captureSourceKey) {
    return fail('loaded session captureSourceKey does not match the requested source key.');
  }

  assertSessionConfiguration(session);

  if (session.pendingPair === null) {
    if (session.mode === 'idle') {
      return { image: { path: sourceRef }, kind: 'legacy' };
    }

    const targetGroupId = requireUuid(session.targetGroupId, 'targetGroupId');
    const targetVariationId =
      session.mode === 'duplicate_copy'
        ? requireUuid(session.targetVariationId, 'targetVariationId')
        : null;
    const pairId = requireUuid(
      (dependencies.createPairId ?? randomUUID)(),
      'generated pairId'
    );
    const startedAt = normalizeInstant(
      (dependencies.now ?? (() => new Date()))(),
      'startedAt'
    );

    return {
      captureSourceKey,
      frontSourceRef: sourceRef,
      frozenMode: session.mode,
      frozenPriceAmount: requirePrice(session.stickyPriceAmount, 'stickyPriceAmount'),
      frozenPriceCurrency: 'USD',
      frozenTargetGroupId: targetGroupId,
      frozenTargetVariationId: targetVariationId,
      kind: 'start_pair',
      pairId,
      startedAt,
    };
  }

  if (session.mode === 'idle') {
    return fail('idle session cannot retain a pending pair.');
  }

  const pendingPair = parsePendingPair(session.pendingPair);
  assertPendingMatchesSession(session, pendingPair);

  if (sourceRef === pendingPair.frontSourceRef) {
    return {
      captureSourceKey,
      kind: 'duplicate_front',
      pendingPair,
      sourceRef,
    };
  }

  return {
    backSourceRef: sourceRef,
    captureSourceKey,
    completionKind: pendingPair.mode,
    kind: 'completion_candidate',
    pendingPair,
  };
}

function getContentType(sourcePath: string): string {
  switch (normalizeWatcherImageExtension(sourcePath)) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    default:
      return fail(`unsupported variation image extension for ${sourcePath}.`);
  }
}

export function buildVariationListingR2ImageObjectKey(input: {
  body: Buffer | Uint8Array;
  copyId: string;
  groupId: string;
  role: 'front' | 'back';
  sourcePath: string;
  variationId: string;
}): string {
  const groupId = requireUuid(input.groupId, 'groupId');
  const variationId = requireUuid(input.variationId, 'variationId');
  const copyId = requireUuid(input.copyId, 'copyId');
  const extension = normalizeWatcherImageExtension(input.sourcePath);
  if (!isSupportedWatcherImagePath(input.sourcePath)) {
    return fail(`unsupported variation image path ${input.sourcePath}.`);
  }
  if (input.body.byteLength === 0) {
    return fail(`${input.role} image body must not be empty.`);
  }

  const contentHash = createHash('sha256').update(input.body).digest('hex').slice(0, 12);
  return `variation-listing/${groupId}/${variationId}/${copyId}/${input.role}-${contentHash}${extension}`;
}

async function defaultUploadStoredImage(input: {
  body: Buffer | Uint8Array;
  contentType: string;
  objectKey: string;
  sourcePath: string;
  targetGroupId: string;
}): Promise<UploadImageResult> {
  return await uploadImage(
    {
      body: input.body,
      contentType: input.contentType,
      filename: basename(input.sourcePath),
      listingId: input.targetGroupId,
    },
    { objectKey: input.objectKey }
  );
}

export async function storeVariationListingCompletionCandidate(
  route: Extract<VariationListingWatcherEventRoute, { kind: 'completion_candidate' }>,
  handoff: VariationListingStorageHandoff,
  dependencies: StoreVariationListingCompletionDependencies = {}
): Promise<VariationListingStorageReadyCompletionCommand> {
  if (handoff.completionKind !== route.completionKind) {
    return fail('storage handoff completion kind does not match the frozen pending pair mode.');
  }

  const conditionToken = requireConditionToken(handoff.conditionToken);
  const newVariationHandoff = handoff.completionKind === 'new_variation'
    ? {
        selectorValue: requireNonEmptyExact(handoff.selectorValue, 'selectorValue'),
        variationMetadata: requireJsonObject(handoff.variationMetadata),
      }
    : null;
  const capturedAtInput: unknown = handoff.capturedAt;
  const capturedAt =
    capturedAtInput === undefined
      ? undefined
      : typeof capturedAtInput === 'string'
        ? normalizeInstant(capturedAtInput, 'capturedAt')
        : fail('capturedAt must be a valid timestamp string when provided.');
  if (
    capturedAt !== undefined &&
    new Date(capturedAt).getTime() < new Date(route.pendingPair.startedAt).getTime()
  ) {
    return fail('capturedAt cannot be earlier than captureStartedAt.');
  }

  const createId = dependencies.createId ?? randomUUID;
  const copyId = requireUuid(createId(), 'generated copyId');
  const variationId =
    route.completionKind === 'duplicate_copy'
      ? requireUuid(route.pendingPair.targetVariationId, 'pending targetVariationId')
      : requireUuid(createId(), 'generated variationId');

  const readImage = dependencies.readImage ?? readFile;
  const frontBody = await readImage(route.pendingPair.frontSourceRef);
  const backBody = await readImage(route.backSourceRef);
  const frontR2Key = buildVariationListingR2ImageObjectKey({
    body: frontBody,
    copyId,
    groupId: route.pendingPair.targetGroupId,
    role: 'front',
    sourcePath: route.pendingPair.frontSourceRef,
    variationId,
  });
  const backR2Key = buildVariationListingR2ImageObjectKey({
    body: backBody,
    copyId,
    groupId: route.pendingPair.targetGroupId,
    role: 'back',
    sourcePath: route.backSourceRef,
    variationId,
  });
  const uploadStoredImage = dependencies.uploadStoredImage ?? defaultUploadStoredImage;

  const frontUpload = await uploadStoredImage({
    body: frontBody,
    contentType: getContentType(route.pendingPair.frontSourceRef),
    objectKey: frontR2Key,
    sourcePath: route.pendingPair.frontSourceRef,
    targetGroupId: route.pendingPair.targetGroupId,
  });
  if (frontUpload.objectKey !== frontR2Key) {
    return fail('front R2 upload returned a different object key than requested.');
  }

  const backUpload = await uploadStoredImage({
    body: backBody,
    contentType: getContentType(route.backSourceRef),
    objectKey: backR2Key,
    sourcePath: route.backSourceRef,
    targetGroupId: route.pendingPair.targetGroupId,
  });
  if (backUpload.objectKey !== backR2Key) {
    return fail('back R2 upload returned a different object key than requested.');
  }

  const common = {
    backR2Key,
    backSourceRef: route.backSourceRef,
    capturePairId: route.pendingPair.pairId,
    captureSourceKey: route.captureSourceKey,
    captureStartedAt: route.pendingPair.startedAt,
    capturedAt,
    conditionToken,
    copyId,
    expectedDesiredRevision: route.pendingPair.expectedDesiredRevision,
    frontR2Key,
    frontSourceRef: route.pendingPair.frontSourceRef,
    frozenPriceAmount: route.pendingPair.priceAmount,
    frozenPriceCurrency: route.pendingPair.priceCurrency,
    targetGroupId: route.pendingPair.targetGroupId,
  };

  if (handoff.completionKind === 'duplicate_copy') {
    return {
      ...common,
      completionKind: 'duplicate_copy',
      variationId,
    };
  }

  if (newVariationHandoff === null) {
    return fail('new-variation storage handoff is missing selector metadata.');
  }

  return {
    ...common,
    completionKind: 'new_variation',
    selectorValue: newVariationHandoff.selectorValue,
    variationId,
    variationMetadata: newVariationHandoff.variationMetadata,
  };
}
