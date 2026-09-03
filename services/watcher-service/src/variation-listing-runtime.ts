import { createHash } from 'node:crypto';

import {
  createSupabaseServiceClient,
  getVariationListingGroupById,
  type SupabaseDataClient,
} from '@ebay-inventory/data';

import {
  VARIATION_LISTING_COPY_CONDITION_TOKENS,
  createVariationListingIntakeSessionReader,
  routeVariationListingWatcherEvent,
  storeVariationListingCompletionCandidate,
  type VariationListingCopyConditionToken,
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
  process(sourcePath: string): Promise<VariationListingRuntimeOutcome>;
}

export interface CreateVariationListingRuntimeProcessorInput {
  captureSourceKey: string;
  env?: NodeJS.ProcessEnv & VariationListingSidecarEnvironment;
}

export interface VariationListingRuntimeProcessorDependencies {
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
  const getGroupConditionToken = dependencies.getGroupConditionToken ?? (async (groupId) => {
    const group = await getVariationListingGroupById(getClient(), groupId);
    if (!group) return fail(`target group ${groupId} no longer exists.`);
    const conditionToken = group.source.condition_token;
    if (!isCopyConditionToken(conditionToken)) {
      return fail(`target group ${groupId} has unsupported condition token ${JSON.stringify(conditionToken)}.`);
    }
    return conditionToken;
  });
  const pendingCompletionCommands = new Map<string, VariationListingStorageReadyCompletionCommand>();

  return {
    process: async (sourcePath) => {
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

      const route = await routeEvent({
        captureSourceKey: input.captureSourceKey,
        image: { path: sourcePath },
      });
      if (route.kind === 'legacy') return { kind: 'legacy' };
      if (route.kind === 'ignored') return { kind: 'ignored', reason: route.reason };
      if (route.kind === 'duplicate_front') {
        return { kind: 'duplicate_front', pairId: route.pendingPair.pairId };
      }
      if (route.kind === 'start_pair') {
        await startPersistence(route);
        return {
          kind: 'started',
          groupId: route.frozenTargetGroupId,
          pairId: route.pairId,
        };
      }

      const completionRoute: Extract<VariationListingWatcherEventRoute, { kind: 'completion_candidate' }> = route;
      const conditionToken = route.completionKind === 'new_variation'
        ? await getGroupConditionToken(route.pendingPair.targetGroupId)
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
