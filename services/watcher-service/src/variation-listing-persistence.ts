import {
  createSupabaseServiceClient,
  createSupabaseVariationListingTransactionGateway,
  getVariationListingCopyByCapturePairId,
  getVariationListingGroupById,
  getVariationListingVariationById,
  variationListingJsonSemanticallyEqual,
  type ConfigureVariationListingIntakeInput,
  type SupabaseDataClient,
  type VariationListingCopyRow,
  type VariationListingGroupRow,
  type VariationListingIntakeSessionRow,
  type VariationListingTransactionGateway,
  type VariationListingVariationRow,
} from '@ebay-inventory/data';

import type {
  VariationListingStorageReadyCompletionCommand,
  VariationListingWatcherEventRoute,
} from './variation-listing-intake.js';

export interface VariationListingPersistenceReader {
  getCopyByCapturePairId(capturePairId: string): Promise<VariationListingCopyRow | null>;
  getGroupById(groupId: string): Promise<VariationListingGroupRow | null>;
  getVariationById(variationId: string): Promise<VariationListingVariationRow | null>;
}

export interface VariationListingPersistenceDependencies {
  client?: SupabaseDataClient;
  gateway?: VariationListingTransactionGateway;
  reader?: VariationListingPersistenceReader;
}

export type VariationListingCompletionPersistenceResult =
  | {
      completionKind: 'new_variation';
      copy: VariationListingCopyRow;
      group: VariationListingGroupRow;
      status: 'completed';
      variation: VariationListingVariationRow;
    }
  | {
      completionKind: 'duplicate_copy';
      copy: VariationListingCopyRow;
      group: VariationListingGroupRow;
      status: 'completed';
    }
  | {
      completionKind: 'new_variation' | 'duplicate_copy';
      copy: VariationListingCopyRow;
      group: VariationListingGroupRow;
      status: 'already_completed';
      variation: VariationListingVariationRow;
    };

export interface VariationListingUnknownCompletedCapturePairResult {
  completionKind: 'unknown';
  copy: VariationListingCopyRow;
  group: VariationListingGroupRow;
  status: 'already_completed';
  variation: VariationListingVariationRow;
}

interface LoadedCompletedCapturePair {
  copy: VariationListingCopyRow;
  group: VariationListingGroupRow;
  variation: VariationListingVariationRow;
}

function fail(message: string): never {
  throw new Error(`Variation listing persistence failed: ${message}`);
}

function assertExact(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) fail(`${label} does not match the persisted capture pair.`);
}

function assertSameInstant(actual: string, expected: string, label: string): void {
  const actualTime = Date.parse(actual);
  const expectedTime = Date.parse(expected);
  if (Number.isNaN(actualTime) || Number.isNaN(expectedTime)) {
    fail(`${label} must contain valid timestamps.`);
  }
  if (actualTime !== expectedTime) fail(`${label} does not match the persisted capture pair.`);
}

function createReader(client: SupabaseDataClient): VariationListingPersistenceReader {
  return {
    getCopyByCapturePairId: async (capturePairId) =>
      (await getVariationListingCopyByCapturePairId(client, capturePairId))?.source ?? null,
    getGroupById: async (groupId) => (await getVariationListingGroupById(client, groupId))?.source ?? null,
    getVariationById: async (variationId) =>
      (await getVariationListingVariationById(client, variationId))?.source ?? null,
  };
}

function resolveGateway(
  dependencies: VariationListingPersistenceDependencies
): VariationListingTransactionGateway {
  if (dependencies.gateway) return dependencies.gateway;
  return createSupabaseVariationListingTransactionGateway(
    dependencies.client ?? createSupabaseServiceClient()
  );
}

function resolveReader(
  dependencies: VariationListingPersistenceDependencies
): VariationListingPersistenceReader {
  if (dependencies.reader) return dependencies.reader;
  return createReader(dependencies.client ?? createSupabaseServiceClient());
}

function resolveCompletionDependencies(
  dependencies: VariationListingPersistenceDependencies
): { gateway: VariationListingTransactionGateway; reader: VariationListingPersistenceReader } {
  if (dependencies.gateway && dependencies.reader) {
    return { gateway: dependencies.gateway, reader: dependencies.reader };
  }
  const client = dependencies.client ?? createSupabaseServiceClient();
  return {
    gateway:
      dependencies.gateway ?? createSupabaseVariationListingTransactionGateway(client),
    reader: dependencies.reader ?? createReader(client),
  };
}

async function loadCompletedCapturePair(
  capturePairId: string,
  reader: VariationListingPersistenceReader
): Promise<LoadedCompletedCapturePair | null> {
  const copy = await reader.getCopyByCapturePairId(capturePairId);
  if (!copy) return null;
  const variation = await reader.getVariationById(copy.variation_id);
  if (!variation) return fail('persisted capture pair references a missing variation.');
  const group = await reader.getGroupById(variation.group_id);
  if (!group) return fail('persisted capture pair references a missing group.');
  return { copy, group, variation };
}

function assertCompletedCaptureMatchesCommand(
  loaded: LoadedCompletedCapturePair,
  command: VariationListingStorageReadyCompletionCommand
): void {
  const { copy, group, variation } = loaded;
  assertExact(copy.capture_pair_id, command.capturePairId, 'capturePairId');
  assertExact(copy.copy_id, command.copyId, 'copyId');
  assertExact(copy.variation_id, command.variationId, 'variationId');
  assertExact(copy.capture_source_key, command.captureSourceKey, 'captureSourceKey');
  assertExact(copy.capture_front_source_ref, command.frontSourceRef, 'frontSourceRef');
  assertExact(copy.capture_back_source_ref, command.backSourceRef, 'backSourceRef');
  assertExact(copy.front_r2_key, command.frontR2Key, 'frontR2Key');
  assertExact(copy.back_r2_key, command.backR2Key, 'backR2Key');
  assertExact(copy.condition_token, command.conditionToken, 'conditionToken');
  assertSameInstant(copy.capture_started_at, command.captureStartedAt, 'captureStartedAt');
  if (command.capturedAt !== undefined) {
    assertSameInstant(copy.captured_at, command.capturedAt, 'capturedAt');
  }
  assertExact(variation.variation_id, command.variationId, 'variationId');
  assertExact(variation.group_id, command.targetGroupId, 'targetGroupId');
  assertExact(group.group_id, command.targetGroupId, 'targetGroupId');

  if (command.completionKind === 'new_variation') {
    assertExact(variation.selector_value, command.selectorValue, 'selectorValue');
    if (!variationListingJsonSemanticallyEqual(variation.variation_metadata, command.variationMetadata)) {
      fail('variationMetadata does not match the persisted capture pair.');
    }
    assertExact(variation.price_amount, command.frozenPriceAmount, 'frozenPriceAmount');
    assertExact(variation.price_currency, command.frozenPriceCurrency, 'frozenPriceCurrency');
  }
}

export async function configureVariationListingIntakePersistence(
  input: ConfigureVariationListingIntakeInput,
  dependencies: VariationListingPersistenceDependencies = {}
): Promise<VariationListingIntakeSessionRow> {
  return await resolveGateway(dependencies).configureIntake(input);
}

export async function startVariationListingIntakePersistence(
  route: Extract<VariationListingWatcherEventRoute, { kind: 'start_pair' }>,
  dependencies: VariationListingPersistenceDependencies = {}
): Promise<VariationListingIntakeSessionRow> {
  return await resolveGateway(dependencies).startIntakePair({
    captureSourceKey: route.captureSourceKey,
    frontSourceRef: route.frontSourceRef,
    pairId: route.pairId,
    startedAt: route.startedAt,
  });
}

export async function discardVariationListingIntakePersistence(
  captureSourceKey: string,
  dependencies: VariationListingPersistenceDependencies = {}
): Promise<VariationListingIntakeSessionRow> {
  return await resolveGateway(dependencies).discardIntakePair(captureSourceKey);
}

export async function findCompletedVariationListingCapturePair(
  capturePairId: string,
  dependencies: VariationListingPersistenceDependencies = {}
): Promise<VariationListingUnknownCompletedCapturePairResult | null> {
  const loaded = await loadCompletedCapturePair(capturePairId, resolveReader(dependencies));
  if (!loaded) return null;
  return {
    completionKind: 'unknown',
    copy: loaded.copy,
    group: loaded.group,
    status: 'already_completed',
    variation: loaded.variation,
  };
}

export async function persistVariationListingCompletion(
  command: VariationListingStorageReadyCompletionCommand,
  dependencies: VariationListingPersistenceDependencies = {}
): Promise<VariationListingCompletionPersistenceResult> {
  const { gateway, reader } = resolveCompletionDependencies(dependencies);
  const existing = await loadCompletedCapturePair(command.capturePairId, reader);
  if (existing) {
    assertCompletedCaptureMatchesCommand(existing, command);
    return {
      completionKind: command.completionKind,
      copy: existing.copy,
      group: existing.group,
      status: 'already_completed',
      variation: existing.variation,
    };
  }

  if (command.completionKind === 'new_variation') {
    const result = await gateway.completeNewVariation({
      backR2Key: command.backR2Key,
      backSourceRef: command.backSourceRef,
      capturePairId: command.capturePairId,
      captureSourceKey: command.captureSourceKey,
      capturedAt: command.capturedAt,
      conditionToken: command.conditionToken,
      copyId: command.copyId,
      frontR2Key: command.frontR2Key,
      selectorValue: command.selectorValue,
      variationId: command.variationId,
      variationMetadata: command.variationMetadata,
    });
    assertCompletedCaptureMatchesCommand(
      { copy: result.copy, group: result.group, variation: result.variation },
      command
    );
    return { completionKind: 'new_variation', status: 'completed', ...result };
  }

  const result = await gateway.completeDuplicateCopy({
    backR2Key: command.backR2Key,
    backSourceRef: command.backSourceRef,
    capturePairId: command.capturePairId,
    captureSourceKey: command.captureSourceKey,
    capturedAt: command.capturedAt,
    conditionToken: command.conditionToken,
    copyId: command.copyId,
    frontR2Key: command.frontR2Key,
    variationId: command.variationId,
  });
  const variation = await reader.getVariationById(result.copy.variation_id);
  if (!variation) return fail('completed duplicate copy references a missing variation.');
  assertCompletedCaptureMatchesCommand(
    { copy: result.copy, group: result.group, variation },
    command
  );
  return { completionKind: 'duplicate_copy', status: 'completed', ...result };
}
