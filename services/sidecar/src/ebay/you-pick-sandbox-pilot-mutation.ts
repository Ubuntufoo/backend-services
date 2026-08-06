import { createHash } from 'crypto';
import { z } from 'zod';
import {
  YOU_PICK_CONTENT_LANGUAGE,
  YOU_PICK_MARKETPLACE,
  assertInventoryItemSemanticMatch,
  assertOfferSemanticMatch,
  assertExecutableManifestIntegrity,
  buildFuturePlan,
  executableYouPickManifestSchema,
  inventoryItemSemanticMismatch,
  offerSemanticMismatch,
  sanitizeError,
  type ExecutableYouPickManifest,
  type ExactRead,
  type RemoteInventoryItem,
  type RemoteOffer,
  type YouPickPilotReadApi,
} from './you-pick-sandbox-pilot.js';

export interface GuardedMutationHeaders {
  'Content-Language': typeof YOU_PICK_CONTENT_LANGUAGE;
}

export interface YouPickPilotMutationApi {
  createOrReplaceInventoryItem(
    sku: string,
    payload: Record<string, unknown>,
    headers: GuardedMutationHeaders
  ): Promise<unknown>;
  createOffer(payload: Record<string, unknown>, headers: GuardedMutationHeaders): Promise<unknown>;
  createOrReplaceInventoryItemGroup(
    groupKey: string,
    payload: Record<string, unknown>,
    headers: GuardedMutationHeaders
  ): Promise<unknown>;
  publishInventoryItemGroup(
    payload: Record<string, unknown>,
    headers: GuardedMutationHeaders
  ): Promise<unknown>;
  bulkUpdatePriceQuantity(
    payload: Record<string, unknown>,
    headers: GuardedMutationHeaders
  ): Promise<unknown>;
  withdrawInventoryItemGroup(
    payload: Record<string, unknown>,
    headers: GuardedMutationHeaders
  ): Promise<unknown>;
  deleteOffer(offerId: string, headers: GuardedMutationHeaders): Promise<unknown>;
  deleteInventoryItemGroup(groupKey: string, headers: GuardedMutationHeaders): Promise<unknown>;
  deleteInventoryItem(sku: string, headers: GuardedMutationHeaders): Promise<unknown>;
}

const id = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const emptyMutationResponseSchema = z.union([
  z.undefined(),
  z.null(),
  z.object({}).strict(),
  z.object({ warnings: z.array(z.unknown()).optional() }).strict(),
]);
const createOfferResponseSchema = z.object({ offerId: id }).strict();
const publishResponseSchema = z.object({ listingId: id }).strict();
const bulkEntrySchema = z
  .object({
    sku: id,
    offerId: id,
    statusCode: z.number().int().min(200).max(299),
    errors: z.array(z.unknown()).max(0).optional(),
  })
  .strict();
const bulkResponseSchema = z.object({ responses: z.tuple([bulkEntrySchema]) }).strict();

const attestedChildSchema = z
  .object({
    sku: id,
    selectorValue: z.string().trim().min(1),
    expectedPrice: z.string().regex(/^\d+\.\d{2}$/),
    frontFingerprint: id,
    backFingerprint: id,
    selectorMapped: z.literal(true),
    priceMapped: z.literal(true),
    imagesInOrder: z.literal(true),
  })
  .strict();
export const publishedViewAttestationSchema = z
  .object({
    kind: z.literal('published-view'),
    runId: id,
    arrangementId: id,
    listingId: id,
    observedAt: z.string().datetime(),
    children: z.array(attestedChildSchema).min(2).max(3),
    sharedConditionCorrect: z.literal(true),
    titleAcceptable: z.literal(true),
    descriptionAcceptable: z.literal(true),
  })
  .strict();
export const quantityZeroAttestationSchema = z
  .object({
    kind: z.literal('quantity-zero'),
    runId: id,
    arrangementId: id,
    listingId: id,
    observedAt: z.string().datetime(),
    targetSku: id,
    remainingChildren: z
      .array(z.object({ sku: id, purchasable: z.literal(true) }).strict())
      .min(1)
      .max(2),
    targetUnavailable: z.literal(true),
  })
  .strict();
export type YouPickPilotAttestation =
  | z.infer<typeof publishedViewAttestationSchema>
  | z.infer<typeof quantityZeroAttestationSchema>;

export interface MutationExecutionOptions {
  manifest: ExecutableYouPickManifest;
  manifestPath?: string;
  readApi: YouPickPilotReadApi;
  mutationApi: YouPickPilotMutationApi;
  headers: GuardedMutationHeaders;
  attestation?: unknown;
  cleanup: boolean;
  now: () => Date;
  persist(manifest: ExecutableYouPickManifest): Promise<void>;
}

export interface MutationExecutionReport {
  mode: 'execute' | 'cleanup-execute';
  checkpoint: ExecutableYouPickManifest['checkpoint'];
  run: ExecutableYouPickManifest['run'];
  listingId: string | null;
  completedOperationIds: string[];
  safeResumeCommand: string;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function payload(
  plan: ReturnType<typeof buildFuturePlan>,
  idValue: string
): Record<string, unknown> {
  const operation = plan.operations.find((candidate) => candidate.id === idValue);
  if (!operation || !operation.payload || typeof operation.payload !== 'object')
    throw new Error(`Immutable operation ${idValue} is missing.`);
  return operation.payload as Record<string, unknown>;
}

function exactFound<T>(read: ExactRead<T>, label: string): T {
  if (read.status !== 'found')
    throw new Error(`${label} exact read is ${read.status}; mutation outcome remains unknown.`);
  return read.value;
}

function requireSnapshotDigest(
  value: { snapshotDigest?: string },
  expected: string,
  label: string
) {
  if (!value.snapshotDigest || value.snapshotDigest !== expected)
    throw new Error(`${label} exact snapshot does not match the immutable planned payload digest.`);
}

function requireInventoryItemSemanticMatch(
  item: RemoteInventoryItem,
  expected: unknown,
  label: string
): void {
  if (item.semanticSnapshot && item.sku !== item.semanticSnapshot.sku)
    throw new Error(`${label} semantic SKU conflicts with normalized ownership SKU.`);
  assertInventoryItemSemanticMatch(item.semanticSnapshot, expected, label);
}

function requireOneInventoryItemSemanticMatch(
  item: RemoteInventoryItem,
  expected: unknown[],
  label: string
): void {
  if (item.semanticSnapshot && item.sku !== item.semanticSnapshot.sku)
    throw new Error(`${label} semantic SKU conflicts with normalized ownership SKU.`);
  if (
    item.semanticSnapshot &&
    expected.some(
      (candidate) => inventoryItemSemanticMismatch(item.semanticSnapshot, candidate) === null
    )
  )
    return;
  throw new Error(`${label} does not match an owned original/zero semantic item snapshot.`);
}

function requireOfferSemanticMatch(
  offer: RemoteOffer,
  expected: unknown,
  label: string
): void {
  if (offer.semanticSnapshot && offer.sku !== offer.semanticSnapshot.sku)
    throw new Error(`${label} semantic SKU conflicts with normalized ownership SKU.`);
  if (offer.semanticSnapshot && offer.marketplaceId !== offer.semanticSnapshot.marketplaceId)
    throw new Error(`${label} semantic marketplace conflicts with normalized ownership.`);
  assertOfferSemanticMatch(offer.semanticSnapshot, expected, label);
}

function requireOneOfferSemanticMatch(
  offer: RemoteOffer,
  expected: unknown[],
  label: string
): void {
  if (offer.semanticSnapshot && offer.sku !== offer.semanticSnapshot.sku)
    throw new Error(`${label} semantic SKU conflicts with normalized ownership SKU.`);
  if (offer.semanticSnapshot && offer.marketplaceId !== offer.semanticSnapshot.marketplaceId)
    throw new Error(`${label} semantic marketplace conflicts with normalized ownership.`);
  if (
    offer.semanticSnapshot &&
    expected.some((candidate) => offerSemanticMismatch(offer.semanticSnapshot, candidate) === null)
  )
    return;
  throw new Error(`${label} does not match an owned original/zero semantic offer snapshot.`);
}

function requireExactUnpublishedOffer(offer: RemoteOffer, sku: string, label: string): void {
  if (!offer.offerId || offer.sku !== sku || offer.marketplaceId !== YOU_PICK_MARKETPLACE)
    throw new Error(`${label} has conflicting offer identity or ownership.`);
  if (
    offer.status !== 'UNPUBLISHED' ||
    offer.listingId !== null ||
    offer.listingStatus !== null ||
    offer.lifecycleClass !== null ||
    offer.publicationObserved ||
    offer.listingCurrentlyActive !== false ||
    offer.withdrawRequired !== false
  )
    throw new Error(`${label} is not one exact unpublished offer.`);
}

function completedOperationTime(manifest: ExecutableYouPickManifest, operationId: string): Date {
  const entry = manifest.execution.ledger.find((candidate) => candidate.id === operationId);
  if (entry?.state !== 'completed' || !entry.completedAt)
    throw new Error(`Operator attestation requires completed ${operationId} ledger evidence.`);
  return new Date(entry.completedAt);
}

function validateAttestationTime(observedAt: string, now: Date, completedAt: Date): void {
  const observed = new Date(observedAt);
  const age = now.getTime() - observed.getTime();
  if (age < 0 || age > 24 * 60 * 60 * 1000)
    throw new Error('Operator attestation is stale or future-dated.');
  if (observed.getTime() <= completedAt.getTime())
    throw new Error('Operator attestation must occur strictly after its completed operation.');
}

export function validatePublishedViewAttestation(
  input: unknown,
  manifest: ExecutableYouPickManifest,
  now: Date
) {
  if (input === undefined)
    throw new Error('Published-view attestation is required for quantity-zero execution.');
  const value = publishedViewAttestationSchema.parse(input);
  validateAttestationTime(value.observedAt, now, completedOperationTime(manifest, 'publish-group'));
  if (
    value.runId !== manifest.run.runId ||
    value.arrangementId !== manifest.arrangementId ||
    value.listingId !== manifest.groupListingId
  )
    throw new Error(
      'Published-view attestation does not match this run, arrangement, and listing.'
    );
  const fixture = manifest.execution.fixture;
  const expected = fixture.children.map((child, index) => ({
    sku: manifest.run.childSkus[index],
    selectorValue: fixture.selector.values[index],
    expectedPrice: child.price.value,
    frontFingerprint: child.images[0].fingerprint,
    backFingerprint: child.images[1].fingerprint,
  }));
  if (
    JSON.stringify(
      value.children.map(
        ({ selectorMapped: _a, priceMapped: _b, imagesInOrder: _c, ...child }) => child
      )
    ) !== JSON.stringify(expected)
  )
    throw new Error(
      'Published-view attestation child identities or ordered evidence do not match.'
    );
  return value;
}

export function validateQuantityZeroAttestation(
  input: unknown,
  manifest: ExecutableYouPickManifest,
  now: Date
) {
  if (input === undefined)
    throw new Error('Quantity-zero attestation is required before withdrawal and cleanup.');
  const value = quantityZeroAttestationSchema.parse(input);
  validateAttestationTime(value.observedAt, now, completedOperationTime(manifest, 'quantity-zero'));
  const expectedRemainingChildren = manifest.run.childSkus.slice(1).map((sku) => ({
    sku,
    purchasable: true as const,
  }));
  if (
    value.runId !== manifest.run.runId ||
    value.arrangementId !== manifest.arrangementId ||
    value.listingId !== manifest.groupListingId ||
    value.targetSku !== manifest.run.childSkus[0] ||
    JSON.stringify(value.remainingChildren) !== JSON.stringify(expectedRemainingChildren)
  )
    throw new Error('Quantity-zero attestation does not match the exact run-owned children.');
  return value;
}

export interface ReconciledPublicationState {
  state: 'unpublished' | 'active' | 'ended' | 'not-listed';
  offers: RemoteOffer[];
  listingId: string | null;
  withdrawRequired: boolean;
}

export async function reconcileCompletePublicationState(
  readApi: YouPickPilotReadApi,
  manifest: ExecutableYouPickManifest,
  allowAbsent = false
): Promise<ReconciledPublicationState> {
  const reads = await Promise.all(
    manifest.run.childSkus.map((sku) => readApi.getOffers(sku, YOU_PICK_MARKETPLACE))
  );
  const offers: RemoteOffer[] = [];
  let absentCount = 0;
  reads.forEach((read, index) => {
    const sku = manifest.run.childSkus[index];
    if (read.status === 'unknown') throw new Error(`Publication state for ${sku} is unknown.`);
    if (read.status === 'missing' || read.value.offers.length === 0) {
      absentCount += 1;
      return;
    }
    if (read.value.offers.length !== 1)
      throw new Error(`Publication state for ${sku} requires exactly one offer.`);
    const offer = read.value.offers[0];
    const recordedOfferId = manifest.resources[index].offerId;
    if (
      offer.sku !== sku ||
      offer.marketplaceId !== YOU_PICK_MARKETPLACE ||
      (recordedOfferId !== null && offer.offerId !== recordedOfferId)
    )
      throw new Error(`Publication state for ${sku} has conflicting ownership.`);
    offers.push(offer);
  });

  if (!allowAbsent && absentCount > 0)
    throw new Error('Complete publication state is missing one or more child offers.');
  if (offers.length === 0)
    return { state: 'unpublished', offers, listingId: null, withdrawRequired: false };
  const statuses = new Set(offers.map((offer) => offer.status));
  if (statuses.size !== 1)
    throw new Error('Publication state mixes PUBLISHED and UNPUBLISHED child offers.');
  const status = offers[0].status;
  if (status === 'UNPUBLISHED') {
    if (
      offers.some(
        (offer) =>
          offer.listingId !== null ||
          offer.listingStatus !== null ||
          offer.lifecycleClass !== null ||
          offer.publicationObserved ||
          offer.listingCurrentlyActive !== false ||
          offer.withdrawRequired !== false
      )
    )
      throw new Error('Unpublished child offers contain ambiguous lifecycle evidence.');
    return { state: 'unpublished', offers, listingId: null, withdrawRequired: false };
  }
  if (absentCount > 0) throw new Error('Published group is missing one or more child offers.');
  const listingIds = [...new Set(offers.map((offer) => offer.listingId))];
  if (listingIds.length !== 1 || !listingIds[0])
    throw new Error('Published group has conflicting or missing listing IDs.');
  if (manifest.groupListingId && manifest.groupListingId !== listingIds[0])
    throw new Error('Published group listing ID conflicts with the manifest.');
  const lifecycleClasses = new Set(offers.map((offer) => offer.lifecycleClass));
  if (
    lifecycleClasses.size !== 1 ||
    lifecycleClasses.has(null) ||
    lifecycleClasses.has('ambiguous')
  )
    throw new Error('Published group has mixed, missing, or ambiguous lifecycle classes.');
  const lifecycleClass = offers[0].lifecycleClass;
  if (lifecycleClass !== 'active' && lifecycleClass !== 'ended' && lifecycleClass !== 'not-listed')
    throw new Error('Published group lifecycle is not safely classified.');
  const withdrawRequired = lifecycleClass === 'active';
  if (
    offers.some(
      (offer) =>
        !offer.publicationObserved ||
        offer.listingCurrentlyActive !== withdrawRequired ||
        offer.withdrawRequired !== withdrawRequired ||
        offer.listingStatus === null
    )
  )
    throw new Error('Published group has incomplete or conflicting normalized lifecycle details.');
  return {
    state: lifecycleClass,
    offers,
    listingId: listingIds[0],
    withdrawRequired,
  };
}

function resolveResourcesFromPublication(
  manifest: ExecutableYouPickManifest,
  publication: ReconciledPublicationState
): ExecutableYouPickManifest['resources'] {
  return manifest.resources.map((resource, index) => ({
    ...resource,
    offerId: publication.offers[index].offerId,
    offerStatus: publication.offers[index].status,
  }));
}

function expectedItemPayload(
  plan: ReturnType<typeof buildFuturePlan>,
  index: number,
  zeroTarget: boolean
): Record<string, unknown> {
  const item = structuredClone(payload(plan, `item-C0${index + 1}`));
  if (zeroTarget && index === 0)
    (
      (item.availability as Record<string, unknown>).shipToLocationAvailability as Record<
        string,
        unknown
      >
    ).quantity = 0;
  return item;
}

function expectedOfferPayload(
  plan: ReturnType<typeof buildFuturePlan>,
  index: number,
  zeroTarget: boolean
): Record<string, unknown> {
  const offer = structuredClone(payload(plan, `offer-C0${index + 1}`));
  if (zeroTarget && index === 0) offer.availableQuantity = 0;
  return offer;
}

async function validateCompleteQuantitySnapshot(
  options: MutationExecutionOptions,
  state: 'original' | 'target-zero'
): Promise<{ listingId: string; targetOfferId: string }> {
  const plan = buildFuturePlan(options.manifest.execution.fixture, options.manifest.run);
  const zeroTarget = state === 'target-zero';
  const group = exactFound(
    await options.readApi.getInventoryItemGroup(options.manifest.run.groupKey),
    `${state} quantity group`
  );
  if (JSON.stringify(group.variantSKUs) !== JSON.stringify(options.manifest.run.childSkus))
    throw new Error(`${state} quantity group membership changed.`);
  requireSnapshotDigest(group, digest(payload(plan, 'group-complete')), `${state} quantity group`);
  for (let index = 0; index < options.manifest.run.childSkus.length; index += 1) {
    const sku = options.manifest.run.childSkus[index];
    const item = exactFound(
      await options.readApi.getInventoryItem(sku),
      `${state} quantity item ${sku}`
    );
    if (
      item.sku !== sku ||
      JSON.stringify(item.groupKeys) !== JSON.stringify([options.manifest.run.groupKey])
    )
      throw new Error(`${state} quantity item ${sku} changed group association.`);
    const expectedQuantity =
      zeroTarget && index === 0 ? 0 : options.manifest.ownership.itemQuantities[index];
    if (item.quantity !== expectedQuantity)
      throw new Error(`${state} quantity item ${sku} has unexpected quantity.`);
    requireInventoryItemSemanticMatch(
      item,
      expectedItemPayload(plan, index, zeroTarget),
      `${state} item ${sku}`
    );
  }
  const publication = await reconcileCompletePublicationState(options.readApi, options.manifest);
  if (publication.state !== 'active' || !publication.listingId)
    throw new Error(`${state} quantity requires one fully active published group.`);
  if (publication.listingId !== options.manifest.groupListingId)
    throw new Error(`${state} quantity listing identity changed.`);
  publication.offers.forEach((offer, index) => {
    const expectedQuantity =
      zeroTarget && index === 0 ? 0 : options.manifest.ownership.offerQuantities[index];
    if (offer.availableQuantity !== expectedQuantity)
      throw new Error(`${state} quantity offer ${offer.sku} has unexpected quantity.`);
    requireOfferSemanticMatch(
      offer,
      expectedOfferPayload(plan, index, zeroTarget),
      `${state} offer ${offer.sku}`
    );
  });
  const targetOfferId = options.manifest.resources[0].offerId;
  if (!targetOfferId || publication.offers[0].offerId !== targetOfferId)
    throw new Error(`${state} quantity target offer ID is not exact.`);
  return { listingId: publication.listingId, targetOfferId };
}

async function updateLedger(
  options: MutationExecutionOptions,
  operationId: string,
  state: 'started' | 'completed' | 'unknown',
  evidence: {
    result?: Record<string, string | number | boolean | null>;
    error?: string;
    readBack?: unknown;
  }
): Promise<void> {
  const timestamp = options.now().toISOString();
  const ledger = options.manifest.execution.ledger.map((entry) =>
    entry.id !== operationId
      ? entry
      : {
          ...entry,
          state,
          attemptCount: state === 'started' ? entry.attemptCount + 1 : entry.attemptCount,
          startedAt:
            state === 'started' || (state === 'completed' && entry.startedAt === null)
              ? timestamp
              : entry.startedAt,
          completedAt: state === 'completed' ? timestamp : null,
          result: evidence.result ?? null,
          error: evidence.error ? sanitizeError(evidence.error) : null,
          readBackDigest: evidence.readBack === undefined ? null : digest(evidence.readBack),
        }
  );
  options.manifest = executableYouPickManifestSchema.parse({
    ...options.manifest,
    updatedAt: timestamp,
    execution: { ...options.manifest.execution, ledger },
  });
  await options.persist(options.manifest);
}

type MutationRecovery =
  | { state: 'after-proven'; evidence: unknown }
  | { state: 'pre-proven'; evidence: unknown }
  | { state: 'unknown'; error: string };

async function recoverMutationState(
  reconcileAfter: () => Promise<unknown>,
  provePreState: () => Promise<unknown>
): Promise<MutationRecovery> {
  let afterError: unknown;
  try {
    return { state: 'after-proven', evidence: await reconcileAfter() };
  } catch (error) {
    afterError = error;
  }
  try {
    return { state: 'pre-proven', evidence: await provePreState() };
  } catch (preStateError) {
    return {
      state: 'unknown',
      error: `after-state: ${sanitizeError(afterError)}; pre-state: ${sanitizeError(preStateError)}`,
    };
  }
}

async function controlledMutation(
  options: MutationExecutionOptions,
  operationId: string,
  mutate: () => Promise<unknown>,
  validateResult: (value: unknown) => Record<string, string | number | boolean | null>,
  reconcileAfter: () => Promise<unknown>,
  provePreState: () => Promise<unknown>
): Promise<unknown> {
  const entry = options.manifest.execution.ledger.find((candidate) => candidate.id === operationId);
  if (!entry) throw new Error(`Missing ledger operation ${operationId}.`);
  if (entry.state === 'completed') return await reconcileAfter();
  if (entry.state === 'started' || entry.state === 'unknown') {
    const recovery = await recoverMutationState(reconcileAfter, provePreState);
    if (recovery.state === 'after-proven') {
      await updateLedger(options, operationId, 'completed', { readBack: recovery.evidence });
      return recovery.evidence;
    }
    if (recovery.state === 'unknown') {
      await updateLedger(options, operationId, 'unknown', {
        error: recovery.error,
      });
      throw new Error(
        `Mutation ${operationId} remains unresolved; neither exact after-state nor exact pre-state is proven.`
      );
    }
    if (entry.attemptCount >= 2)
      throw new Error(`Mutation ${operationId} exhausted its bounded exact-prestate attempts.`);
  }
  await updateLedger(options, operationId, 'started', {});
  try {
    const raw = await mutate();
    const result = validateResult(raw);
    const recovered = await reconcileAfter();
    await updateLedger(options, operationId, 'completed', { result, readBack: recovered });
    return recovered;
  } catch (error) {
    try {
      const recovered = await reconcileAfter();
      await updateLedger(options, operationId, 'completed', { readBack: recovered });
      return recovered;
    } catch (reconcileError) {
      await updateLedger(options, operationId, 'unknown', {
        error: `${sanitizeError(error)}; reconciliation: ${sanitizeError(reconcileError)}`,
      });
      throw new Error(`Mutation ${operationId} outcome is unknown; exact reconciliation failed.`);
    }
  }
}

async function setCheckpoint(
  options: MutationExecutionOptions,
  checkpoint: ExecutableYouPickManifest['checkpoint']
): Promise<void> {
  options.manifest = executableYouPickManifestSchema.parse({
    ...options.manifest,
    checkpoint,
    updatedAt: options.now().toISOString(),
  });
  await options.persist(options.manifest);
}

async function executePublishPath(options: MutationExecutionOptions): Promise<void> {
  const plan = buildFuturePlan(options.manifest.execution.fixture, options.manifest.run);
  await setCheckpoint(options, 'creating-items');
  for (let index = 0; index < options.manifest.run.childSkus.length; index += 1) {
    const sku = options.manifest.run.childSkus[index];
    const operationId = `item-C0${index + 1}`;
    const request = payload(plan, operationId);
    const { sku: requestSku, ...itemBody } = request;
    if (requestSku !== sku) throw new Error(`${operationId} request SKU does not match its path.`);
    const existing = await options.readApi.getInventoryItem(sku);
    if (existing.status === 'found') {
      if (
        existing.value.groupKeys !== null &&
        JSON.stringify(existing.value.groupKeys) !== JSON.stringify([options.manifest.run.groupKey])
      )
        throw new Error(`${operationId} has an unexpected group association.`);
      requireInventoryItemSemanticMatch(existing.value, request, operationId);
      await updateLedger(options, operationId, 'completed', { readBack: existing.value });
    } else if (existing.status !== 'missing')
      throw new Error(`${operationId} pre-state is unknown.`);
    if (existing.status === 'missing')
      await controlledMutation(
        options,
        operationId,
        () => options.mutationApi.createOrReplaceInventoryItem(sku, itemBody, options.headers),
        (raw) => {
          emptyMutationResponseSchema.parse(raw);
          return {};
        },
        async () => {
          const item = exactFound(await options.readApi.getInventoryItem(sku), operationId);
          if (
            item.sku !== sku ||
            (item.groupKeys !== null &&
              JSON.stringify(item.groupKeys) !== JSON.stringify([options.manifest.run.groupKey]))
          )
            throw new Error(`${operationId} after-state ownership is ambiguous.`);
          requireInventoryItemSemanticMatch(item, request, operationId);
          return item;
        },
        async () => {
          const item = await options.readApi.getInventoryItem(sku);
          requireMissing(item, `${operationId} pre-state`);
          return { missing: true };
        }
      );
  }

  await setCheckpoint(options, 'creating-offers');
  for (let index = 0; index < options.manifest.run.childSkus.length; index += 1) {
    const sku = options.manifest.run.childSkus[index];
    const operationId = `offer-C0${index + 1}`;
    const request = payload(plan, operationId);
    const offers = exactFound(
      await options.readApi.getOffers(sku, YOU_PICK_MARKETPLACE),
      operationId
    ).offers;
    if (offers.length > 1) throw new Error(`${operationId} has duplicate offers.`);
    if (offers[0]) {
      requireExactUnpublishedOffer(offers[0], sku, operationId);
      requireOfferSemanticMatch(offers[0], request, operationId);
      await updateLedger(options, operationId, 'completed', { readBack: offers[0] });
    }
    let offer: RemoteOffer;
    if (offers[0]) offer = offers[0];
    else {
      let returnedOfferId: string | undefined;
      offer = (await controlledMutation(
        options,
        operationId,
        async () => {
          const raw = await options.mutationApi.createOffer(request, options.headers);
          returnedOfferId = createOfferResponseSchema.parse(raw).offerId;
          return raw;
        },
        (raw) => ({ offerId: createOfferResponseSchema.parse(raw).offerId }),
        async () => {
          const reads = exactFound(
            await options.readApi.getOffers(sku, YOU_PICK_MARKETPLACE),
            operationId
          ).offers;
          if (reads.length !== 1) throw new Error(`${operationId} did not reconcile to one offer.`);
          requireExactUnpublishedOffer(reads[0], sku, operationId);
          if (returnedOfferId && reads[0].offerId !== returnedOfferId)
            throw new Error(`${operationId} returned offer ID does not match exact read-back.`);
          requireOfferSemanticMatch(reads[0], request, operationId);
          return reads[0];
        },
        async () => {
          const read = exactFound(
            await options.readApi.getOffers(sku, YOU_PICK_MARKETPLACE),
            `${operationId} pre-state`
          );
          if (read.offers.length !== 0)
            throw new Error(`${operationId} pre-state is not exact offer absence.`);
          return { missing: true };
        }
      )) as RemoteOffer;
    }
    options.manifest = executableYouPickManifestSchema.parse({
      ...options.manifest,
      resources: options.manifest.resources.map((resource) =>
        resource.sku === sku
          ? { ...resource, offerId: offer.offerId, offerStatus: offer.status }
          : resource
      ),
    });
    await options.persist(options.manifest);
  }

  await setCheckpoint(options, 'replacing-group');
  const groupRequest = payload(plan, 'group-complete');
  const { inventoryItemGroupKey: requestGroupKey, ...groupBody } = groupRequest;
  if (requestGroupKey !== options.manifest.run.groupKey)
    throw new Error('Group request key does not match its exact path.');
  const groupRead = await options.readApi.getInventoryItemGroup(options.manifest.run.groupKey);
  if (groupRead.status === 'found') {
    requireSnapshotDigest(groupRead.value, digest(groupRequest), 'group-complete');
    await updateLedger(options, 'group-complete', 'completed', { readBack: groupRead.value });
  } else if (groupRead.status !== 'missing') throw new Error('Group pre-state is unknown.');
  if (groupRead.status === 'missing')
    await controlledMutation(
      options,
      'group-complete',
      () =>
        options.mutationApi.createOrReplaceInventoryItemGroup(
          options.manifest.run.groupKey,
          groupBody,
          options.headers
        ),
      (raw) => {
        emptyMutationResponseSchema.parse(raw);
        return {};
      },
      async () => {
        const group = exactFound(
          await options.readApi.getInventoryItemGroup(options.manifest.run.groupKey),
          'group-complete'
        );
        if (JSON.stringify(group.variantSKUs) !== JSON.stringify(options.manifest.run.childSkus))
          throw new Error('Group ordered variant SKUs do not match.');
        requireSnapshotDigest(group, digest(groupRequest), 'group-complete');
        return group;
      },
      async () => {
        const group = await options.readApi.getInventoryItemGroup(options.manifest.run.groupKey);
        requireMissing(group, 'group-complete pre-state');
        return { missing: true };
      }
    );

  await setCheckpoint(options, 'verifying-unpublished');
  for (let index = 0; index < options.manifest.run.childSkus.length; index += 1) {
    const sku = options.manifest.run.childSkus[index];
    const item = exactFound(
      await options.readApi.getInventoryItem(sku),
      `unpublished verification item ${sku}`
    );
    if (JSON.stringify(item.groupKeys) !== JSON.stringify([options.manifest.run.groupKey]))
      throw new Error(`Unpublished item ${sku} is not associated with the exact group.`);
    requireInventoryItemSemanticMatch(item, payload(plan, `item-C0${index + 1}`), `item ${sku}`);
    const offers = exactFound(
      await options.readApi.getOffers(sku, YOU_PICK_MARKETPLACE),
      `unpublished verification offer ${sku}`
    ).offers;
    if (offers.length !== 1 || offers[0].offerId !== options.manifest.resources[index].offerId)
      throw new Error(`Group offer ${sku} is missing, ambiguous, or changed.`);
    requireExactUnpublishedOffer(offers[0], sku, `offer ${sku}`);
    requireOfferSemanticMatch(offers[0], payload(plan, `offer-C0${index + 1}`), `offer ${sku}`);
  }
  const verifiedGroup = exactFound(
    await options.readApi.getInventoryItemGroup(options.manifest.run.groupKey),
    'unpublished verification group'
  );
  if (JSON.stringify(verifiedGroup.variantSKUs) !== JSON.stringify(options.manifest.run.childSkus))
    throw new Error('Unpublished group ordered child snapshot changed before publication.');
  requireSnapshotDigest(verifiedGroup, digest(groupRequest), 'unpublished group');
  const publishRequest = payload(plan, 'publish-group');
  const publication = await reconcileCompletePublicationState(options.readApi, options.manifest);
  await setCheckpoint(options, 'publishing');
  if (publication.state === 'active' && publication.listingId) {
    options.manifest = executableYouPickManifestSchema.parse({
      ...options.manifest,
      published: true,
      groupListingId: publication.listingId,
      resources: resolveResourcesFromPublication(options.manifest, publication),
    });
    await updateLedger(options, 'publish-group', 'completed', {
      result: { listingId: publication.listingId },
      readBack: publication.offers,
    });
  } else {
    if (publication.state !== 'unpublished')
      throw new Error('Publish recovery may adopt only a fully active published group.');
    let returnedListingId: string | undefined;
    await controlledMutation(
      options,
      'publish-group',
      async () => {
        const raw = await options.mutationApi.publishInventoryItemGroup(
          publishRequest,
          options.headers
        );
        returnedListingId = publishResponseSchema.parse(raw).listingId;
        return raw;
      },
      (raw) => ({ listingId: publishResponseSchema.parse(raw).listingId }),
      async () => {
        const reconciled = await reconcileCompletePublicationState(
          options.readApi,
          options.manifest
        );
        if (
          reconciled.state !== 'active' ||
          !reconciled.listingId ||
          (returnedListingId && reconciled.listingId !== returnedListingId)
        )
          throw new Error('Publish exact read-back is not one fully active group.');
        options.manifest = executableYouPickManifestSchema.parse({
          ...options.manifest,
          published: true,
          groupListingId: reconciled.listingId,
          resources: resolveResourcesFromPublication(options.manifest, reconciled),
        });
        return { listingId: reconciled.listingId };
      },
      async () => {
        const reconciled = await reconcileCompletePublicationState(
          options.readApi,
          options.manifest
        );
        if (reconciled.state !== 'unpublished')
          throw new Error('Publish pre-state is not one complete unpublished group.');
        return reconciled.offers;
      }
    );
  }
  options.manifest = executableYouPickManifestSchema.parse({
    ...options.manifest,
    checkpoint: 'awaiting-published-view-verification',
    updatedAt: options.now().toISOString(),
  });
  await options.persist(options.manifest);
}

async function executeQuantityZero(options: MutationExecutionOptions): Promise<void> {
  const attestation = options.manifest.execution.publishedAttestationDigest
    ? undefined
    : validatePublishedViewAttestation(options.attestation, options.manifest, options.now());
  if (attestation) {
    options.manifest = executableYouPickManifestSchema.parse({
      ...options.manifest,
      checkpoint: 'setting-quantity-zero',
      execution: {
        ...options.manifest.execution,
        publishedAttestationDigest: digest(attestation),
      },
    });
    await options.persist(options.manifest);
  } else await setCheckpoint(options, 'setting-quantity-zero');
  const targetSku = options.manifest.run.childSkus[0];
  const quantityEntry = options.manifest.execution.ledger.find(
    (entry) => entry.id === 'quantity-zero'
  );
  let alreadyZero = false;
  let snapshot: { listingId: string; targetOfferId: string };
  if (quantityEntry?.state === 'planned') {
    snapshot = await validateCompleteQuantitySnapshot(options, 'original');
  } else {
    const recovery = await recoverMutationState(
      async () => await validateCompleteQuantitySnapshot(options, 'target-zero'),
      async () => await validateCompleteQuantitySnapshot(options, 'original')
    );
    if (recovery.state === 'after-proven') {
      snapshot = recovery.evidence as typeof snapshot;
      alreadyZero = true;
    } else if (recovery.state === 'pre-proven') {
      snapshot = recovery.evidence as typeof snapshot;
    } else {
      await updateLedger(options, 'quantity-zero', 'unknown', { error: recovery.error });
      throw new Error(
        'Mutation quantity-zero remains unresolved; neither exact after-state nor exact pre-state is proven.'
      );
    }
  }
  const targetOfferId = snapshot.targetOfferId;
  if (!alreadyZero) {
    const plan = buildFuturePlan(options.manifest.execution.fixture, options.manifest.run);
    const request = structuredClone(payload(plan, 'quantity-zero'));
    const requests = request.requests as Record<string, unknown>[];
    const requestOffers = requests[0].offers as Record<string, unknown>[];
    requestOffers[0].offerId = targetOfferId;
    await controlledMutation(
      options,
      'quantity-zero',
      () => options.mutationApi.bulkUpdatePriceQuantity(request, options.headers),
      (raw) => {
        const result = bulkResponseSchema.parse(raw).responses[0];
        if (result.sku !== targetSku || result.offerId !== targetOfferId)
          throw new Error('Bulk quantity result does not match the exact target.');
        return { sku: result.sku, offerId: result.offerId, statusCode: result.statusCode };
      },
      async () => await validateCompleteQuantitySnapshot(options, 'target-zero'),
      async () => await validateCompleteQuantitySnapshot(options, 'original')
    );
  } else
    await updateLedger(options, 'quantity-zero', 'completed', {
      readBack: snapshot,
    });
  options.manifest = executableYouPickManifestSchema.parse({
    ...options.manifest,
    checkpoint: 'awaiting-quantity-zero-verification',
    execution: {
      ...options.manifest.execution,
      publishedAttestationDigest: options.manifest.execution.publishedAttestationDigest,
    },
  });
  await options.persist(options.manifest);
}

async function authorizeWithdrawal(options: MutationExecutionOptions): Promise<void> {
  const attestation = validateQuantityZeroAttestation(
    options.attestation,
    options.manifest,
    options.now()
  );
  options.manifest = executableYouPickManifestSchema.parse({
    ...options.manifest,
    checkpoint: 'withdrawal-ready',
    execution: {
      ...options.manifest.execution,
      quantityZeroAttestationDigest: digest(attestation),
    },
  });
  await options.persist(options.manifest);
}

function requireMissing(read: ExactRead<unknown>, label: string): void {
  if (read.status !== 'missing') throw new Error(`${label} final absence is ${read.status}.`);
}

async function executeCleanup(options: MutationExecutionOptions): Promise<void> {
  options.manifest = executableYouPickManifestSchema.parse({
    ...options.manifest,
    checkpoint: 'cleanup-in-progress',
    cleanup: { ...options.manifest.cleanup, attempts: options.manifest.cleanup.attempts + 1 },
  });
  await options.persist(options.manifest);
  const plan = buildFuturePlan(options.manifest.execution.fixture, options.manifest.run);
  const group = await options.readApi.getInventoryItemGroup(options.manifest.run.groupKey);
  if (group.status === 'unknown') throw new Error('Cleanup group state is unknown.');
  if (group.status === 'found') {
    const expectedGroup = payload(plan, 'group-complete');
    if (JSON.stringify(group.value.variantSKUs) !== JSON.stringify(options.manifest.run.childSkus))
      throw new Error('Cleanup group does not contain the exact ordered run-owned children.');
    requireSnapshotDigest(group.value, digest(expectedGroup), 'cleanup group');
  }
  for (let index = 0; index < options.manifest.run.childSkus.length; index += 1) {
    const sku = options.manifest.run.childSkus[index];
    const item = await options.readApi.getInventoryItem(sku);
    if (item.status === 'unknown') throw new Error(`Cleanup item ${sku} state is unknown.`);
    if (item.status === 'found') {
      if (
        item.value.sku !== sku ||
        (item.value.groupKeys !== null &&
          JSON.stringify(item.value.groupKeys) !== JSON.stringify([options.manifest.run.groupKey]))
      )
        throw new Error(`Cleanup item ${sku} ownership or group association is ambiguous.`);
      const originalItem = payload(plan, `item-C0${index + 1}`);
      const allowedItems = [originalItem];
      if (index === 0) {
        const zeroItem = structuredClone(originalItem);
        (
          (zeroItem.availability as Record<string, unknown>).shipToLocationAvailability as Record<
            string,
            unknown
          >
        ).quantity = 0;
        allowedItems.push(zeroItem);
      }
      requireOneInventoryItemSemanticMatch(item.value, allowedItems, `Cleanup item ${sku}`);
    }
  }
  const offerReads = await Promise.all(
    options.manifest.run.childSkus.map((sku) =>
      options.readApi.getOffers(sku, YOU_PICK_MARKETPLACE)
    )
  );
  if (offerReads.some((read) => read.status === 'unknown'))
    throw new Error('Cleanup offer ownership is unresolved.');
  for (let index = 0; index < offerReads.length; index += 1) {
    const read = offerReads[index];
    if (read.status !== 'found') continue;
    if (read.value.offers.length > 1) throw new Error('Cleanup found duplicate offers.');
    const offer = read.value.offers[0];
    if (!offer) continue;
    const resource = options.manifest.resources[index];
    if (offer.sku !== resource.sku || offer.marketplaceId !== YOU_PICK_MARKETPLACE)
      throw new Error('Cleanup found a foreign offer owner or marketplace.');
    const originalOffer = payload(plan, `offer-C0${index + 1}`);
    const allowedOffers = [originalOffer];
    if (index === 0) {
      const zeroOffer = structuredClone(originalOffer);
      zeroOffer.availableQuantity = 0;
      allowedOffers.push(zeroOffer);
    }
    requireOneOfferSemanticMatch(offer, allowedOffers, `Cleanup offer ${resource.sku}`);
    if (resource.offerId && resource.offerId !== offer.offerId)
      throw new Error('Cleanup found an offer ID conflicting with the manifest.');
    if (!resource.offerId) {
      options.manifest = executableYouPickManifestSchema.parse({
        ...options.manifest,
        resources: options.manifest.resources.map((candidate, candidateIndex) =>
          candidateIndex === index
            ? { ...candidate, offerId: offer.offerId, offerStatus: offer.status }
            : candidate
        ),
      });
      await options.persist(options.manifest);
    }
  }
  const publication = await reconcileCompletePublicationState(
    options.readApi,
    options.manifest,
    true
  );
  if (publication.state === 'active')
    await controlledMutation(
      options,
      'withdraw-group',
      () =>
        options.mutationApi.withdrawInventoryItemGroup(
          payload(plan, 'withdraw-group'),
          options.headers
        ),
      (raw) => {
        emptyMutationResponseSchema.parse(raw);
        return {};
      },
      async () => {
        const reconciled = await reconcileCompletePublicationState(
          options.readApi,
          options.manifest,
          true
        );
        if (reconciled.state === 'active') throw new Error('Withdrawal state remains active.');
        return { withdrawn: true, state: reconciled.state };
      },
      async () => {
        const reconciled = await reconcileCompletePublicationState(
          options.readApi,
          options.manifest,
          true
        );
        if (reconciled.state !== 'active')
          throw new Error('Withdrawal pre-state is not one complete active group.');
        return reconciled.offers;
      }
    );
  else
    await updateLedger(options, 'withdraw-group', 'completed', {
      result: { required: false },
      readBack: publication.offers,
    });
  for (const resource of [...options.manifest.resources].reverse()) {
    if (!resource.offerId) continue;
    const resourceIndex = options.manifest.resources.findIndex(
      (candidate) => candidate.sku === resource.sku
    );
    const operationId = `cleanup-offer-C0${resourceIndex + 1}`;
    const current = exactFound(
      await options.readApi.getOffers(resource.sku, YOU_PICK_MARKETPLACE),
      operationId
    ).offers;
    if (current.length === 0) {
      await updateLedger(options, operationId, 'completed', { readBack: { missing: true } });
      continue;
    }
    if (current.length !== 1 || current[0].offerId !== resource.offerId)
      throw new Error(`${operationId} ownership is ambiguous.`);
    await controlledMutation(
      options,
      operationId,
      () => options.mutationApi.deleteOffer(resource.offerId!, options.headers),
      (raw) => {
        emptyMutationResponseSchema.parse(raw);
        return {};
      },
      async () => {
        const read = await options.readApi.getOffers(resource.sku, YOU_PICK_MARKETPLACE);
        if (read.status !== 'found' || read.value.offers.length !== 0)
          throw new Error(`${operationId} absence is not proven.`);
        return { missing: true };
      },
      async () => {
        const read = exactFound(
          await options.readApi.getOffers(resource.sku, YOU_PICK_MARKETPLACE),
          `${operationId} pre-state`
        ).offers;
        if (read.length !== 1 || read[0].offerId !== resource.offerId)
          throw new Error(`${operationId} exact owned pre-state is not proven.`);
        return read[0];
      }
    );
  }
  if (group.status === 'found')
    await controlledMutation(
      options,
      'cleanup-group',
      () =>
        options.mutationApi.deleteInventoryItemGroup(
          options.manifest.run.groupKey,
          options.headers
        ),
      (raw) => {
        emptyMutationResponseSchema.parse(raw);
        return {};
      },
      async () => {
        const read = await options.readApi.getInventoryItemGroup(options.manifest.run.groupKey);
        requireMissing(read, 'group');
        return { missing: true };
      },
      async () => {
        const read = exactFound(
          await options.readApi.getInventoryItemGroup(options.manifest.run.groupKey),
          'cleanup-group pre-state'
        );
        if (JSON.stringify(read.variantSKUs) !== JSON.stringify(options.manifest.run.childSkus))
          throw new Error('Cleanup group pre-state membership is not exact.');
        requireSnapshotDigest(
          read,
          digest(payload(plan, 'group-complete')),
          'cleanup group pre-state'
        );
        return read;
      }
    );
  else
    await updateLedger(options, 'cleanup-group', 'completed', {
      readBack: { missing: true },
    });
  for (let index = options.manifest.run.childSkus.length - 1; index >= 0; index -= 1) {
    const sku = options.manifest.run.childSkus[index];
    const operationId = `cleanup-child-${index + 1}`;
    const read = await options.readApi.getInventoryItem(sku);
    if (read.status === 'unknown') throw new Error(`${operationId} state is unknown.`);
    if (read.status === 'found')
      await controlledMutation(
        options,
        operationId,
        () => options.mutationApi.deleteInventoryItem(sku, options.headers),
        (raw) => {
          emptyMutationResponseSchema.parse(raw);
          return {};
        },
        async () => {
          const after = await options.readApi.getInventoryItem(sku);
          requireMissing(after, operationId);
          return { missing: true };
        },
        async () => {
          const before = exactFound(
            await options.readApi.getInventoryItem(sku),
            `${operationId} pre-state`
          );
          const originalItem = payload(plan, `item-C0${index + 1}`);
          const allowedItems = [originalItem];
          if (index === 0) {
            const zeroItem = structuredClone(originalItem);
            (
              (zeroItem.availability as Record<string, unknown>)
                .shipToLocationAvailability as Record<string, unknown>
            ).quantity = 0;
            allowedItems.push(zeroItem);
          }
          if (before.sku !== sku)
            throw new Error(`${operationId} exact owned pre-state is not proven.`);
          requireOneInventoryItemSemanticMatch(before, allowedItems, operationId);
          return before;
        }
      );
    else
      await updateLedger(options, operationId, 'completed', {
        readBack: { missing: true },
      });
  }
  requireMissing(
    await options.readApi.getInventoryItemGroup(options.manifest.run.groupKey),
    'group'
  );
  for (const sku of options.manifest.run.childSkus) {
    requireMissing(await options.readApi.getInventoryItem(sku), sku);
    const offerRead = await options.readApi.getOffers(sku, YOU_PICK_MARKETPLACE);
    if (offerRead.status !== 'found' || offerRead.value.offers.length !== 0)
      throw new Error(`${sku} offer absence is not proven.`);
  }
  await updateLedger(options, 'verify-absence', 'completed', {
    readBack: { group: 'missing', items: options.manifest.run.childSkus, offers: 'missing' },
  });
  options.manifest = executableYouPickManifestSchema.parse({
    ...options.manifest,
    checkpoint: 'cleanup-complete',
    cleanup: { ...options.manifest.cleanup, finalAbsenceVerified: true },
    lastError: null,
  });
  await options.persist(options.manifest);
}

export async function executeYouPickManifest(
  options: MutationExecutionOptions
): Promise<MutationExecutionReport> {
  options.manifest = executableYouPickManifestSchema.parse(options.manifest);
  assertExecutableManifestIntegrity(options.manifest);
  if (options.headers['Content-Language'] !== YOU_PICK_CONTENT_LANGUAGE)
    throw new Error('Mutation API requires exact Content-Language: en-US.');
  if (options.manifest.checkpoint === 'cleanup-complete')
    throw new Error('Cleaned manifest is historical and cannot mutate again.');
  try {
    if (options.cleanup) await executeCleanup(options);
    else if (
      [
        'preflight-complete',
        'creating-items',
        'creating-offers',
        'replacing-group',
        'verifying-unpublished',
        'publishing',
      ].includes(options.manifest.checkpoint)
    )
      await executePublishPath(options);
    else if (
      options.manifest.checkpoint === 'awaiting-published-view-verification' ||
      options.manifest.checkpoint === 'setting-quantity-zero'
    )
      await executeQuantityZero(options);
    else if (options.manifest.checkpoint === 'awaiting-quantity-zero-verification')
      await authorizeWithdrawal(options);
    else
      throw new Error(`Checkpoint ${options.manifest.checkpoint} is not executable in this mode.`);
  } catch (error) {
    const startedIds = options.manifest.execution.ledger
      .filter((entry) => entry.state === 'started')
      .map((entry) => entry.id);
    for (const operationId of startedIds)
      await updateLedger(options, operationId, 'unknown', { error: sanitizeError(error) });
    throw error;
  }
  return {
    mode: options.cleanup ? 'cleanup-execute' : 'execute',
    checkpoint: options.manifest.checkpoint,
    run: options.manifest.run,
    listingId: options.manifest.groupListingId,
    completedOperationIds: options.manifest.execution.ledger
      .filter((entry) => entry.state === 'completed')
      .map((entry) => entry.id),
    safeResumeCommand: `pnpm --filter sidecar ebay:pilot-you-pick-sandbox -- --manifest ${options.manifestPath ?? '<exact-path>'} ${options.cleanup ? '--cleanup ' : ''}--execute --confirm-sandbox-seller ${options.manifest.seller?.userId ?? '<seller>'}`,
  };
}
