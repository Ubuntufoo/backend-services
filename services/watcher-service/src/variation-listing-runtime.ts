import { createHash } from 'node:crypto';

import {
  createSupabaseServiceClient,
  getVariationListingGroupById,
  type SupabaseDataClient,
  type VariationListingIntakeSessionRow,
} from '@ebay-inventory/data';

import {
  VARIATION_LISTING_COPY_CONDITION_TOKENS,
  buildVariationListingStorageReadyCompletionCommand,
  cleanupVariationListingPreparedCompletionMedia,
  createVariationListingIntakeSessionReader,
  prepareVariationListingCompletionMedia,
  routeVariationListingWatcherEvent,
  storeVariationListingCompletionCandidate,
  type VariationListingCopyConditionToken,
  type VariationListingManualPriceAmount,
  type VariationListingPendingMode,
  VariationListingStoragePreparationError,
  type VariationListingStorageReadyCompletionCommand,
  type VariationListingPreparedCompletionMedia,
  type VariationListingWatcherEventRoute,
} from './variation-listing-intake.js';
import {
  persistVariationListingCompletion,
  startVariationListingIntakePersistence,
} from './variation-listing-persistence.js';
import {
  reportVariationListingIntakeStatus,
  requestVariationListingIdentityHandoff,
  VariationListingSidecarRetryableError,
  type VariationListingIntakeStatusRequest,
  type VariationListingSidecarEnvironment,
} from './variation-listing-sidecar.js';

export type VariationListingRuntimeOutcome =
  | { kind: 'legacy' }
  | { kind: 'ignored'; reason: 'unsupported_image' }
  | { kind: 'started'; groupId: string; pairId: string }
  | { kind: 'duplicate_front'; pairId: string }
  | {
      kind: 'completed';
      completionKind: 'new_variation' | 'duplicate_copy';
      copyId: string;
      groupId: string;
      status: 'completed' | 'already_completed';
      variationId: string;
      timings?: {
        identityMs: number;
        identityReadEncodeMs?: number;
        identityGenerationMs?: number;
        storageMs: number;
        persistenceMs: number;
        totalMs: number;
      };
    };

export interface VariationListingRuntimeProcessor {
  /**
   * Snapshot capture ownership and the exact Variation target/configuration at
   * file-arrival time. Pair routing is resolved again when the image is
   * processed so a front/back pair can advance durable state, but a queued
   * image may never silently move to another bucket/variation/configuration.
   */
  snapshot?(sourcePath: string): Promise<VariationListingRuntimeOwnership>;
  process(
    sourcePath: string,
    capturedOwnership?: VariationListingRuntimeOwnership,
  ): Promise<VariationListingRuntimeOutcome>;
}

export type VariationListingRuntimeOwnership =
  | 'legacy'
  | 'ignored'
  | {
      kind: 'variation';
      pairId?: string;
      mode: VariationListingPendingMode;
      targetGroupId: string;
      targetVariationId: string | null;
      conditionToken: VariationListingCopyConditionToken | null;
      priceAmount: VariationListingManualPriceAmount;
      priceCurrency: 'USD';
    };

export interface CreateVariationListingRuntimeProcessorInput {
  captureSourceKey: string;
  env?: NodeJS.ProcessEnv & VariationListingSidecarEnvironment;
}

export type VariationListingCaptureFailureKind =
  | 'gemini'
  | 'storage'
  | 'gemini_and_storage'
  | 'persistence';

export class VariationListingCaptureRetryableError extends Error {
  readonly failureKind: VariationListingCaptureFailureKind;
  readonly pairId: string;
  readonly ownedSourcePaths: readonly string[];

  constructor(
    message: string,
    failureKind: VariationListingCaptureFailureKind,
    pairId: string,
    ownedSourcePaths: readonly string[] = [],
  ) {
    super(message);
    this.name = 'VariationListingCaptureRetryableError';
    this.failureKind = failureKind;
    this.pairId = pairId;
    this.ownedSourcePaths = [...new Set(ownedSourcePaths)];
  }
}

export interface VariationListingRuntimeProcessorDependencies {
  getGroupCaptureState?: (groupId: string) => Promise<{
    conditionToken: VariationListingCopyConditionToken;
    lifecycleState: string;
  }>;
  client?: SupabaseDataClient;
  routeEvent?: typeof routeVariationListingWatcherEvent;
  startPersistence?: typeof startVariationListingIntakePersistence;
  storeCompletionCandidate?: typeof storeVariationListingCompletionCandidate;
  prepareCompletionMedia?: typeof prepareVariationListingCompletionMedia;
  buildCompletionCommand?: typeof buildVariationListingStorageReadyCompletionCommand;
  cleanupCompletionMedia?: (media: VariationListingPreparedCompletionMedia) => Promise<void>;
  persistCompletion?: typeof persistVariationListingCompletion;
  requestIdentityHandoff?: typeof requestVariationListingIdentityHandoff;
  reportIntakeStatus?: (input: VariationListingIntakeStatusRequest) => Promise<void>;
  getGroupConditionToken?: (groupId: string) => Promise<VariationListingCopyConditionToken>;
}

function fail(message: string): never {
  throw new Error(`Variation listing runtime failed: ${message}`);
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

function deriveCaptureOwnedUuid(pairId: string, role: 'copy' | 'variation'): string {
  const bytes = Buffer.from(
    createHash('sha256').update(`variation-listing:${role}:${pairId.toLowerCase()}`).digest().subarray(0, 16)
  );
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function isCopyConditionToken(value: string): value is VariationListingCopyConditionToken {
  return (VARIATION_LISTING_COPY_CONDITION_TOKENS as readonly string[]).includes(value);
}

const CAPTURE_ELIGIBLE_LIFECYCLES = new Set([
  'intake',
  'draft',
  'review',
  'publish-ready',
  'active',
]);

function assertCaptureLifecycleEligible(groupId: string, lifecycleState: string): void {
  if (!CAPTURE_ELIGIBLE_LIFECYCLES.has(lifecycleState)) {
    fail(`target group ${groupId} lifecycle ${JSON.stringify(lifecycleState)} cannot accept capture.`);
  }
}

function sameInstant(left: unknown, right: string): boolean {
  if (typeof left !== 'string') return false;
  const leftMs = new Date(left).getTime();
  const rightMs = new Date(right).getTime();
  return Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs === rightMs;
}

function assertStartedPairMatchesRoute(
  route: Extract<VariationListingWatcherEventRoute, {kind: 'start_pair'}>,
  session: VariationListingIntakeSessionRow | undefined,
): void {
  // The real gateway always returns the committed row. Test/embedder seams may
  // intentionally omit it, so retain compatibility while still validating any
  // durable response before reporting a started pair.
  if (session === undefined) return;

  const pending = session.pending_pair;
  if (
    session.capture_source_key !== route.captureSourceKey ||
    session.mode !== route.frozenMode ||
    session.target_group_id?.toLowerCase() !== route.frozenTargetGroupId ||
    (session.target_variation_id?.toLowerCase() ?? null) !== route.frozenTargetVariationId ||
    session.sticky_price_amount !== route.frozenPriceAmount ||
    session.sticky_price_currency !== route.frozenPriceCurrency ||
    pending === null ||
    typeof pending !== 'object' ||
    Array.isArray(pending)
  ) {
    return fail('durable pending pair disagrees with the arrival-time Variation route.');
  }

  const pair = pending as Record<string, unknown>;
  if (
    pair.pair_id !== route.pairId ||
    pair.mode !== route.frozenMode ||
    pair.target_group_id !== route.frozenTargetGroupId ||
    (pair.target_variation_id ?? null) !== route.frozenTargetVariationId ||
    pair.price_amount !== route.frozenPriceAmount ||
    pair.price_currency !== route.frozenPriceCurrency ||
    pair.condition_token !== route.frozenConditionToken ||
    pair.front_source_ref !== route.frontSourceRef ||
    !sameInstant(pair.started_at, route.startedAt)
  ) {
    return fail('durable pending pair disagrees with the arrival-time Variation route.');
  }
}

function routeOwnership(route: VariationListingWatcherEventRoute): VariationListingRuntimeOwnership {
  if (route.kind === 'legacy') return 'legacy';
  if (route.kind === 'ignored') return 'ignored';
  if (route.kind === 'start_pair') {
    return {
      kind: 'variation',
      mode: route.frozenMode,
      targetGroupId: route.frozenTargetGroupId,
      targetVariationId: route.frozenTargetVariationId,
      conditionToken: route.frozenConditionToken,
      priceAmount: route.frozenPriceAmount,
      priceCurrency: route.frozenPriceCurrency,
    };
  }
  const pending = route.pendingPair;
  return {
    kind: 'variation',
    pairId: pending.pairId,
    mode: pending.mode,
    targetGroupId: pending.targetGroupId,
    targetVariationId: pending.targetVariationId,
    conditionToken: pending.conditionToken,
    priceAmount: pending.priceAmount,
    priceCurrency: pending.priceCurrency,
  };
}

function sameOwnership(
  left: VariationListingRuntimeOwnership,
  right: VariationListingRuntimeOwnership,
): boolean {
  if (typeof left === 'string' || typeof right === 'string') return left === right;
  return (
    left.kind === right.kind &&
    (left.pairId ?? null) === (right.pairId ?? null) &&
    left.mode === right.mode &&
    left.targetGroupId === right.targetGroupId &&
    left.targetVariationId === right.targetVariationId &&
    left.conditionToken === right.conditionToken &&
    left.priceAmount === right.priceAmount &&
    left.priceCurrency === right.priceCurrency
  );
}

function operatorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const firstLine = raw.split(/\r?\n/u, 1)[0]?.trim() ?? '';
  const withoutObjectKeys = firstLine.replace(
    /\bvariation-listing\/[A-Za-z0-9._~:/-]+/gu,
    '[stored image]'
  );
  return withoutObjectKeys.replace(
    /\/(?:[A-Za-z0-9._~-]+\/)+[A-Za-z0-9._~-]+/gu,
    '[path]'
  ).slice(0, 500);
}

function storageOperatorMessage(error: unknown): string {
  const base = operatorMessage(error);
  if (!(error instanceof VariationListingStoragePreparationError) || !error.cleanupMessage) {
    return base;
  }
  return `${base} Cleanup: ${operatorMessage(error.cleanupMessage)}`.slice(0, 500);
}

function isRetryableIdentityError(error: unknown): boolean {
  return error instanceof VariationListingSidecarRetryableError;
}

function isRetryableStorageError(error: unknown): boolean {
  return error instanceof VariationListingStoragePreparationError && error.retryable;
}

export function createVariationListingRuntimeProcessor(
  input: CreateVariationListingRuntimeProcessorInput,
  dependencies: VariationListingRuntimeProcessorDependencies = {}
): VariationListingRuntimeProcessor {
  const env = input.env ?? process.env;
  let client = dependencies.client;
  const getClient = (): SupabaseDataClient => {
    client ??= createSupabaseServiceClient(env);
    return client;
  };
  const routeEvent = dependencies.routeEvent ?? (async (event) =>
    await routeVariationListingWatcherEvent(event, {
      sessionReader: createVariationListingIntakeSessionReader(getClient()),
    }));
  const startPersistence = dependencies.startPersistence ?? (async (route) =>
    await startVariationListingIntakePersistence(route, { client: getClient() }));
  const persistCompletion = dependencies.persistCompletion ?? (async (command) =>
    await persistVariationListingCompletion(command, { client: getClient() }));
  const storeCompletionCandidate =
    dependencies.storeCompletionCandidate ?? storeVariationListingCompletionCandidate;
  const prepareCompletionMedia =
    dependencies.prepareCompletionMedia ?? prepareVariationListingCompletionMedia;
  const buildCompletionCommand =
    dependencies.buildCompletionCommand ?? buildVariationListingStorageReadyCompletionCommand;
  const cleanupCompletionMedia = dependencies.cleanupCompletionMedia ?? (async (media) =>
    await cleanupVariationListingPreparedCompletionMedia(media));
  const requestIdentityHandoff = dependencies.requestIdentityHandoff ?? (async (request) =>
    await requestVariationListingIdentityHandoff(request, { env }));
  const reportIntakeStatus = dependencies.reportIntakeStatus ?? (async (status) =>
    await reportVariationListingIntakeStatus(status, { env }));
  const safeReportIntakeStatus = async (status: VariationListingIntakeStatusRequest): Promise<void> => {
    try {
      await reportIntakeStatus(status);
    } catch {
      // Intake progress is operator-facing ephemeral telemetry only. It must
      // never change durable capture ownership, retry, or persistence behavior.
    }
  };
  const getGroupCaptureState = dependencies.getGroupCaptureState ?? (dependencies.getGroupConditionToken
    ? async (groupId) => ({
        conditionToken: await dependencies.getGroupConditionToken!(groupId),
        lifecycleState: 'active',
      })
    : async (groupId) => {
        const group = await getVariationListingGroupById(getClient(), groupId);
        if (!group) return fail(`target group ${groupId} no longer exists.`);
        const conditionToken = group.source.condition_token;
        if (!isCopyConditionToken(conditionToken)) {
          return fail(`target group ${groupId} has unsupported condition token ${JSON.stringify(conditionToken)}.`);
        }
        return {
          conditionToken,
          lifecycleState: group.source.lifecycle_state,
        };
      });
  const requireCaptureState = async (groupId: string) => {
    const state = await getGroupCaptureState(groupId);
    assertCaptureLifecycleEligible(groupId, state.lifecycleState);
    return state;
  };
  const pendingCompletionCommands = new Map<string, VariationListingStorageReadyCompletionCommand>();
  const pendingCompletionKeysBySource = new Map<string, string>();
  const completionCacheKey = (command: VariationListingStorageReadyCompletionCommand): string =>
    `${command.captureSourceKey}\u0000${command.capturePairId}\u0000${command.backSourceRef}`;
  const getPendingCompletionCommand = (sourcePath: string): VariationListingStorageReadyCompletionCommand | undefined => {
    const key = pendingCompletionKeysBySource.get(sourcePath);
    return key === undefined ? undefined : pendingCompletionCommands.get(key);
  };
  const cachePendingCompletionCommand = (command: VariationListingStorageReadyCompletionCommand): void => {
    const key = completionCacheKey(command);
    const previousKey = pendingCompletionKeysBySource.get(command.backSourceRef);
    if (previousKey !== undefined && previousKey !== key) pendingCompletionCommands.delete(previousKey);
    pendingCompletionCommands.set(key, command);
    pendingCompletionKeysBySource.set(command.backSourceRef, key);
  };
  const clearPendingCompletionCommand = (command: VariationListingStorageReadyCompletionCommand): void => {
    const key = completionCacheKey(command);
    if (pendingCompletionCommands.get(key) === command) pendingCompletionCommands.delete(key);
    if (pendingCompletionKeysBySource.get(command.backSourceRef) === key) {
      pendingCompletionKeysBySource.delete(command.backSourceRef);
    }
  };

  return {
    snapshot: async (sourcePath) =>
      routeOwnership(
        await routeEvent({
          captureSourceKey: input.captureSourceKey,
          image: { path: sourcePath },
        }),
      ),
    process: async (sourcePath, capturedOwnership) => {
      const cachedCommand = getPendingCompletionCommand(sourcePath);
      const cachedPairMatchesOwnership =
        cachedCommand !== undefined &&
        (capturedOwnership === undefined ||
          (typeof capturedOwnership === 'object' && capturedOwnership.pairId === cachedCommand.capturePairId));
      if (cachedCommand && cachedPairMatchesOwnership) {
        await safeReportIntakeStatus({
          captureSourceKey: cachedCommand.captureSourceKey,
          targetGroupId: cachedCommand.targetGroupId,
          pairId: cachedCommand.capturePairId,
          phase: 'saving',
          completionKind: cachedCommand.completionKind,
          message: null,
        });
        try {
          const persistenceStartedAt = Date.now();
          const persisted = await persistCompletion(cachedCommand);
          clearPendingCompletionCommand(cachedCommand);
          await safeReportIntakeStatus({
            captureSourceKey: cachedCommand.captureSourceKey,
            targetGroupId: cachedCommand.targetGroupId,
            pairId: cachedCommand.capturePairId,
            phase: 'ready',
            completionKind: cachedCommand.completionKind,
            message: null,
          });
          return {
            kind: 'completed',
            completionKind: cachedCommand.completionKind,
            copyId: cachedCommand.copyId,
            groupId: cachedCommand.targetGroupId,
            status: persisted.status,
            timings: {
              identityMs: 0,
              storageMs: 0,
              persistenceMs: elapsedMs(persistenceStartedAt),
              totalMs: elapsedMs(persistenceStartedAt),
            },
            variationId: cachedCommand.variationId,
          };
        } catch (error) {
          const message = storageOperatorMessage(error);
          await safeReportIntakeStatus({
            captureSourceKey: cachedCommand.captureSourceKey,
            targetGroupId: cachedCommand.targetGroupId,
            pairId: cachedCommand.capturePairId,
            phase: 'failed',
            completionKind: cachedCommand.completionKind,
            message,
            failureKind: 'persistence',
            retryable: true,
          });
          throw new VariationListingCaptureRetryableError(
            message,
            'persistence',
            cachedCommand.capturePairId,
            [cachedCommand.frontSourceRef, cachedCommand.backSourceRef],
          );
        }
      }

      if (capturedOwnership === 'legacy') {
        return { kind: 'legacy' };
      }
      if (capturedOwnership === 'ignored') {
        return { kind: 'ignored', reason: 'unsupported_image' };
      }
      const route = await routeEvent({
        captureSourceKey: input.captureSourceKey,
        image: { path: sourcePath },
      });
      if (capturedOwnership !== undefined && !sameOwnership(routeOwnership(route), capturedOwnership)) {
        return fail('capture workspace ownership or target configuration changed while the image was queued.');
      }
      const routePairId = route.kind === 'completion_candidate' || route.kind === 'duplicate_front'
        ? route.pendingPair.pairId
        : null;
      if (cachedCommand && routePairId !== cachedCommand.capturePairId) {
        clearPendingCompletionCommand(cachedCommand);
      }
      if (route.kind === 'legacy') return { kind: 'legacy' };
      if (route.kind === 'ignored') return { kind: 'ignored', reason: route.reason };
      if (route.kind === 'duplicate_front') {
        return { kind: 'duplicate_front', pairId: route.pendingPair.pairId };
      }
      if (route.kind === 'start_pair') {
        await requireCaptureState(route.frozenTargetGroupId);
        const persistedSession = await startPersistence(route);
        assertStartedPairMatchesRoute(route, persistedSession);
        await safeReportIntakeStatus({
          captureSourceKey: route.captureSourceKey,
          targetGroupId: route.frozenTargetGroupId,
          pairId: route.pairId,
          phase: 'waiting_for_back',
          completionKind: route.frozenMode,
          message: null,
        });
        return {
          kind: 'started',
          groupId: route.frozenTargetGroupId,
          pairId: route.pairId,
        };
      }

      const completionRoute: Extract<VariationListingWatcherEventRoute, { kind: 'completion_candidate' }> = route;
      const completionStartedAt = Date.now();
      const captureState = await requireCaptureState(route.pendingPair.targetGroupId);
      const conditionToken = route.completionKind === 'new_variation'
        ? captureState.conditionToken
        : route.pendingPair.conditionToken ?? fail('duplicate-copy pending pair is missing frozen condition.');
      const copyId = deriveCaptureOwnedUuid(route.pendingPair.pairId, 'copy');
      const variationId = route.completionKind === 'duplicate_copy'
        ? route.pendingPair.targetVariationId ?? fail('duplicate-copy route is missing targetVariationId.')
        : deriveCaptureOwnedUuid(route.pendingPair.pairId, 'variation');
      await safeReportIntakeStatus({
        captureSourceKey: route.captureSourceKey,
        targetGroupId: route.pendingPair.targetGroupId,
        pairId: route.pendingPair.pairId,
        phase: route.completionKind === 'new_variation' ? 'generating_identity' : 'saving',
        completionKind: route.completionKind,
        message: null,
      });
      let identityHandoff = null;
      let identityMs = 0;
      let storageMs = 0;
      let command: VariationListingStorageReadyCompletionCommand;

      if (route.completionKind === 'new_variation') {
        const identityStartedAt = Date.now();
        const storageStartedAt = Date.now();
        const identityPromise = Promise.resolve()
          .then(() => requestIdentityHandoff({
            variationId,
            frontSourceRef: route.pendingPair.frontSourceRef,
            backSourceRef: route.backSourceRef,
          }))
          .then((value) => ({ value, durationMs: elapsedMs(identityStartedAt) }));
        const storagePromise = Promise.resolve()
          .then(() => prepareCompletionMedia(
            completionRoute,
            { copyId, variationId },
          ))
          .then((value) => ({ value, durationMs: elapsedMs(storageStartedAt) }));
        const [identityResult, storageResult] = await Promise.allSettled([
          identityPromise,
          storagePromise,
        ]);

        if (identityResult.status === 'rejected' || storageResult.status === 'rejected') {
          let cleanupFailure: string | null = null;
          if (identityResult.status === 'rejected' && storageResult.status === 'fulfilled') {
            try {
              await cleanupCompletionMedia(storageResult.value.value);
            } catch (error) {
              cleanupFailure = error instanceof VariationListingStoragePreparationError
                ? error.cleanupMessage ?? operatorMessage(error)
                : operatorMessage(error);
            }
          }
          const identityFailure = identityResult.status === 'rejected' ? operatorMessage(identityResult.reason) : null;
          const storageFailure = storageResult.status === 'rejected' ? storageOperatorMessage(storageResult.reason) : null;
          const failureKind: VariationListingCaptureFailureKind = identityFailure && storageFailure
            ? 'gemini_and_storage'
            : identityFailure
              ? 'gemini'
              : 'storage';
          const failureParts = [
            identityFailure ? `Gemini: ${identityFailure}` : null,
            storageFailure ? `Image storage: ${storageFailure}` : null,
            cleanupFailure ? `Cleanup: ${cleanupFailure}` : null,
          ].filter((value): value is string => value !== null);
          const retryable = cleanupFailure === null &&
            (identityResult.status === 'fulfilled' || isRetryableIdentityError(identityResult.reason)) &&
            (storageResult.status === 'fulfilled' || isRetryableStorageError(storageResult.reason));
          const message = failureParts.join(' | ').slice(0, 500);
          await safeReportIntakeStatus({
            captureSourceKey: route.captureSourceKey,
            targetGroupId: route.pendingPair.targetGroupId,
            pairId: route.pendingPair.pairId,
            phase: 'failed',
            completionKind: route.completionKind,
            message,
            failureKind,
            retryable,
          });
          if (retryable) {
            throw new VariationListingCaptureRetryableError(
              message,
              failureKind,
              route.pendingPair.pairId,
              [route.pendingPair.frontSourceRef, route.backSourceRef],
            );
          }
          throw (identityResult.status === 'rejected'
            ? identityResult.reason
            : storageResult.status === 'rejected'
              ? storageResult.reason
              : new Error(message));
        }

        identityHandoff = identityResult.value.value;
        identityMs = identityResult.value.durationMs;
        storageMs = storageResult.value.durationMs;
        await safeReportIntakeStatus({
          captureSourceKey: route.captureSourceKey,
          targetGroupId: route.pendingPair.targetGroupId,
          pairId: route.pendingPair.pairId,
          phase: 'saving',
          completionKind: route.completionKind,
          message: null,
        });
        try {
          command = buildCompletionCommand(
            completionRoute,
            {
              completionKind: 'new_variation',
              conditionToken,
              selectorValue: identityHandoff.selectorValue,
              variationMetadata: identityHandoff.variationMetadata,
            },
            storageResult.value.value,
          );
        } catch (error) {
          let cleanupFailure: string | null = null;
          try {
            await cleanupCompletionMedia(storageResult.value.value);
          } catch (cleanupError) {
            cleanupFailure = cleanupError instanceof VariationListingStoragePreparationError
              ? cleanupError.cleanupMessage ?? operatorMessage(cleanupError)
              : operatorMessage(cleanupError);
          }
          const message = [
            `Image storage: ${operatorMessage(error)}`,
            cleanupFailure ? `Cleanup: ${cleanupFailure}` : null,
          ].filter((value): value is string => value !== null).join(' | ').slice(0, 500);
          await safeReportIntakeStatus({
            captureSourceKey: route.captureSourceKey,
            targetGroupId: route.pendingPair.targetGroupId,
            pairId: route.pendingPair.pairId,
            phase: 'failed',
            completionKind: route.completionKind,
            message,
            failureKind: 'storage',
            retryable: false,
          });
          throw error;
        }
      } else {
        const storageStartedAt = Date.now();
        try {
          command = await storeCompletionCandidate(
            completionRoute,
            {
              completionKind: 'duplicate_copy',
              conditionToken,
            },
            {
              createId: () => copyId,
            },
          );
          storageMs = elapsedMs(storageStartedAt);
        } catch (error) {
          const message = storageOperatorMessage(error);
          const retryable = isRetryableStorageError(error);
          await safeReportIntakeStatus({
            captureSourceKey: route.captureSourceKey,
            targetGroupId: route.pendingPair.targetGroupId,
            pairId: route.pendingPair.pairId,
            phase: 'failed',
            completionKind: route.completionKind,
            message,
            failureKind: 'storage',
            retryable,
          });
          if (retryable) {
            throw new VariationListingCaptureRetryableError(
              message,
              'storage',
              route.pendingPair.pairId,
              [route.pendingPair.frontSourceRef, route.backSourceRef],
            );
          }
          throw error;
        }
      }
      cachePendingCompletionCommand(command);
      const persistenceStartedAt = Date.now();
      let persisted;
      try {
        persisted = await persistCompletion(command);
      } catch (error) {
        const message = storageOperatorMessage(error);
        await safeReportIntakeStatus({
          captureSourceKey: route.captureSourceKey,
          targetGroupId: route.pendingPair.targetGroupId,
          pairId: route.pendingPair.pairId,
          phase: 'failed',
          completionKind: route.completionKind,
          message,
          failureKind: 'persistence',
          retryable: true,
        });
        throw new VariationListingCaptureRetryableError(
          message,
          'persistence',
          route.pendingPair.pairId,
          [route.pendingPair.frontSourceRef, route.backSourceRef],
        );
      }
      clearPendingCompletionCommand(command);
      const persistenceMs = elapsedMs(persistenceStartedAt);
      await safeReportIntakeStatus({
        captureSourceKey: route.captureSourceKey,
        targetGroupId: route.pendingPair.targetGroupId,
        pairId: route.pendingPair.pairId,
        phase: 'ready',
        completionKind: route.completionKind,
        message: null,
      });
      return {
        kind: 'completed',
        completionKind: route.completionKind,
        copyId,
        groupId: route.pendingPair.targetGroupId,
        status: persisted.status,
        timings: {
          identityMs,
          ...(identityHandoff?.timings ? {
            identityReadEncodeMs: Math.max(0, identityHandoff.timings.imageReadEncodeMs),
            identityGenerationMs: Math.max(0, identityHandoff.timings.generationMs),
          } : {}),
          storageMs,
          persistenceMs,
          totalMs: elapsedMs(completionStartedAt),
        },
        variationId,
      };
    },
  };
}
