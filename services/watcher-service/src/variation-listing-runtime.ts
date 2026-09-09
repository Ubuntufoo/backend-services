import { createHash } from 'node:crypto';

import {
  createSupabaseServiceClient,
  getVariationListingGroupById,
  type SupabaseDataClient,
  type VariationListingIntakeSessionRow,
} from '@ebay-inventory/data';

import {
  VARIATION_LISTING_COPY_CONDITION_TOKENS,
  createVariationListingIntakeSessionReader,
  routeVariationListingWatcherEvent,
  storeVariationListingCompletionCandidate,
  type VariationListingCopyConditionToken,
  type VariationListingManualPriceAmount,
  type VariationListingPendingMode,
  type VariationListingStorageReadyCompletionCommand,
  type VariationListingWatcherEventRoute,
} from './variation-listing-intake.js';
import {
  persistVariationListingCompletion,
  startVariationListingIntakePersistence,
} from './variation-listing-persistence.js';
import {
  requestVariationListingIdentityHandoff,
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

export interface VariationListingRuntimeProcessorDependencies {
  getGroupCaptureState?: (groupId: string) => Promise<{
    conditionToken: VariationListingCopyConditionToken;
    lifecycleState: string;
  }>;
  client?: SupabaseDataClient;
  routeEvent?: typeof routeVariationListingWatcherEvent;
  startPersistence?: typeof startVariationListingIntakePersistence;
  storeCompletionCandidate?: typeof storeVariationListingCompletionCandidate;
  persistCompletion?: typeof persistVariationListingCompletion;
  requestIdentityHandoff?: typeof requestVariationListingIdentityHandoff;
  getGroupConditionToken?: (groupId: string) => Promise<VariationListingCopyConditionToken>;
}

function fail(message: string): never {
  throw new Error(`Variation listing runtime failed: ${message}`);
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
    left.mode === right.mode &&
    left.targetGroupId === right.targetGroupId &&
    left.targetVariationId === right.targetVariationId &&
    left.conditionToken === right.conditionToken &&
    left.priceAmount === right.priceAmount &&
    left.priceCurrency === right.priceCurrency
  );
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
  const requestIdentityHandoff = dependencies.requestIdentityHandoff ?? (async (request) =>
    await requestVariationListingIdentityHandoff(request, { env }));
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

  return {
    snapshot: async (sourcePath) =>
      routeOwnership(
        await routeEvent({
          captureSourceKey: input.captureSourceKey,
          image: { path: sourcePath },
        }),
      ),
    process: async (sourcePath, capturedOwnership) => {
      const cachedCommand = pendingCompletionCommands.get(sourcePath);
      if (cachedCommand) {
        const persisted = await persistCompletion(cachedCommand);
        pendingCompletionCommands.delete(sourcePath);
        return {
          kind: 'completed',
          completionKind: cachedCommand.completionKind,
          copyId: cachedCommand.copyId,
          groupId: cachedCommand.targetGroupId,
          status: persisted.status,
          variationId: cachedCommand.variationId,
        };
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
      if (route.kind === 'legacy') return { kind: 'legacy' };
      if (route.kind === 'ignored') return { kind: 'ignored', reason: route.reason };
      if (route.kind === 'duplicate_front') {
        return { kind: 'duplicate_front', pairId: route.pendingPair.pairId };
      }
      if (route.kind === 'start_pair') {
        await requireCaptureState(route.frozenTargetGroupId);
        const persistedSession = await startPersistence(route);
        assertStartedPairMatchesRoute(route, persistedSession);
        return {
          kind: 'started',
          groupId: route.frozenTargetGroupId,
          pairId: route.pairId,
        };
      }

      const completionRoute: Extract<VariationListingWatcherEventRoute, { kind: 'completion_candidate' }> = route;
      const captureState = await requireCaptureState(route.pendingPair.targetGroupId);
      const conditionToken = route.completionKind === 'new_variation'
        ? captureState.conditionToken
        : route.pendingPair.conditionToken ?? fail('duplicate-copy pending pair is missing frozen condition.');
      const copyId = deriveCaptureOwnedUuid(route.pendingPair.pairId, 'copy');
      const variationId = route.completionKind === 'duplicate_copy'
        ? route.pendingPair.targetVariationId ?? fail('duplicate-copy route is missing targetVariationId.')
        : deriveCaptureOwnedUuid(route.pendingPair.pairId, 'variation');
      const identityHandoff = route.completionKind === 'new_variation'
        ? await requestIdentityHandoff({
            variationId,
            frontSourceRef: route.pendingPair.frontSourceRef,
            backSourceRef: route.backSourceRef,
          })
        : null;
      const ids = route.completionKind === 'new_variation'
        ? [copyId, variationId]
        : [copyId];
      let idIndex = 0;
      const command = await storeCompletionCandidate(
        completionRoute,
        route.completionKind === 'new_variation'
          ? {
              completionKind: 'new_variation',
              conditionToken,
              selectorValue: identityHandoff!.selectorValue,
              variationMetadata: identityHandoff!.variationMetadata,
            }
          : {
              completionKind: 'duplicate_copy',
              conditionToken,
            },
        {
          createId: () => ids[idIndex++] ?? fail('storage requested more capture-owned IDs than expected.'),
        }
      );
      pendingCompletionCommands.set(route.backSourceRef, command);
      const persisted = await persistCompletion(command);
      pendingCompletionCommands.delete(route.backSourceRef);
      return {
        kind: 'completed',
        completionKind: route.completionKind,
        copyId,
        groupId: route.pendingPair.targetGroupId,
        status: persisted.status,
        variationId,
      };
    },
  };
}
