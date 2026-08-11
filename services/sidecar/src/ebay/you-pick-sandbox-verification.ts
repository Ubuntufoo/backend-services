import {
  assertExecutableManifestIntegrity,
  digest,
  executableYouPickManifestSchema,
  inventoryItemSemanticMismatch,
  offerSemanticMismatch,
  resolveFuturePlan,
  sanitizeError,
  YOU_PICK_CONTENT_LANGUAGE,
  YOU_PICK_MARKETPLACE,
  YOU_PICK_SANDBOX_ORIGIN,
  type ExecutableYouPickManifest,
  type RemoteOffer,
  type YouPickPilotReadApi,
} from './you-pick-sandbox-pilot.js';

// Re-exported for the mutation module — single source of truth.
export interface ReconciledPublicationState {
  state: 'unpublished' | 'active' | 'ended' | 'not-listed';
  offers: RemoteOffer[];
  listingId: string | null;
  withdrawRequired: boolean;
}

/**
 * Pure read-only publication reconciliation.
 * Returns the exact current publication state of every child offer.
 * Does NOT accept a mutation API, persist callback, or execute flag.
 */
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

/** Sanitized child verification summary emitted in the report. */
export interface VerifiedChildSummary {
  slot: string;
  sku: string;
  quantity: number;
  expectedQuantity: number;
  quantityMatch: true;
  offerId: string;
  expectedOfferId: string;
  offerStatus: 'PUBLISHED';
  listingLifecycle: 'active';
  itemSemanticMatch: true;
  offerSemanticMatch: true;
  groupAssociationMatch: true;
}

/** Typed, sanitized read-only verification report. */
export interface VerificationReport {
  status: 'verified';
  runId: string;
  sellerId: string;
  groupKey: string;
  listingId: string;
  children: VerifiedChildSummary[];
  groupSemanticMatch: true;
  manifestSha256: string;
  reads: {
    identity: number;
    inventoryItems: number;
    offers: number;
    group: number;
  };
  mutationCapabilitiesResolved: false;
  manifestWritten: false;
}

export interface VerificationOptions {
  readApi: YouPickPilotReadApi;
  manifest: ExecutableYouPickManifest;
  manifestSha256: string;
  confirmSandboxSeller: string;
}

/**
 * Pure read-only verification entry point.
 * Every gate is fail-closed: any mismatch, missing field, or unknown state
 * throws immediately before a verified report is returned.
 * Never mutates local or remote state.
 */
export async function verifyYouPickSandbox(
  options: VerificationOptions
): Promise<VerificationReport> {
  const { readApi, manifest, manifestSha256, confirmSandboxSeller } = options;

  // -- Precondition gates ------------------------------------------------
  if (manifest.version !== 5)
    throw new Error('Verification requires executable version 5 manifest.');

  // Validate manifest expected values against exact constants
  const expected = manifest.expected;
  if (expected.environment !== 'sandbox')
    throw new Error('Verification requires sandbox environment in manifest.');
  if (expected.restOrigin !== YOU_PICK_SANDBOX_ORIGIN)
    throw new Error('Verification requires exact sandbox REST origin in manifest.');
  if (expected.oauthOrigin !== YOU_PICK_SANDBOX_ORIGIN)
    throw new Error('Verification requires exact sandbox OAuth origin in manifest.');
  if (expected.tradingOrigin !== YOU_PICK_SANDBOX_ORIGIN)
    throw new Error('Verification requires exact sandbox Trading origin in manifest.');
  if (expected.marketplaceId !== YOU_PICK_MARKETPLACE)
    throw new Error('Verification requires EBAY_US marketplace in manifest.');
  if (expected.contentLanguage !== YOU_PICK_CONTENT_LANGUAGE)
    throw new Error('Verification requires Content-Language: en-US in manifest.');
  if (expected.categoryId !== '261328')
    throw new Error('Verification requires category 261328 in manifest.');

  // Validate actual runtime snapshot against exact constants
  const runtime = await readApi.getRuntimeSnapshot();
  if (runtime.environment !== 'sandbox') throw new Error('Runtime environment must be sandbox.');
  if (runtime.restOrigin !== YOU_PICK_SANDBOX_ORIGIN)
    throw new Error('Runtime REST origin must be exact sandbox.');
  if (runtime.oauthOrigin !== YOU_PICK_SANDBOX_ORIGIN)
    throw new Error('Runtime OAuth origin must be exact sandbox.');
  if (runtime.tradingOrigin !== YOU_PICK_SANDBOX_ORIGIN)
    throw new Error('Runtime Trading origin must be exact sandbox.');
  if (runtime.marketplaceId !== YOU_PICK_MARKETPLACE)
    throw new Error('Runtime marketplace must be EBAY_US.');
  if (runtime.contentLanguage !== YOU_PICK_CONTENT_LANGUAGE)
    throw new Error('Runtime content language must be en-US.');
  if (Object.values(runtime.background).some((enabled) => enabled))
    throw new Error('All background work must be disabled during verification.');
  if (Object.values(runtime.forbiddenDependencies).some((enabled) => enabled))
    throw new Error('All forbidden dependencies must be disabled during verification.');
  if (!runtime.hasUserRefreshToken) throw new Error('Sandbox user refresh token is required.');
  if (runtime.productionCredentialMaterialPresent)
    throw new Error('Production eBay credential material must not be present.');

  // Manifest state gates
  if (manifest.checkpoint !== 'awaiting-published-view-verification')
    throw new Error(
      `Manifest checkpoint must be awaiting-published-view-verification, got ${manifest.checkpoint}.`
    );
  if (!manifest.published) throw new Error('Manifest must record published=true.');
  if (!manifest.groupListingId)
    throw new Error('Manifest must record a non-null group listing ID.');
  if (manifest.cleanup && (manifest.cleanup.attempts > 0 || manifest.cleanup.finalAbsenceVerified))
    throw new Error('Manifest must not have any cleanup attempts recorded.');
  if (
    manifest.execution.publishedAttestationDigest !== null ||
    manifest.execution.quantityZeroAttestationDigest !== null
  )
    throw new Error('Manifest must not have attestation digests.');
  if (manifest.lastError !== null)
    throw new Error('Manifest lastError must be null for verification.');

  // Verify manifest integrity (fixture ↔ ledger ↔ ownership)
  assertExecutableManifestIntegrity(manifest);

  // Validate ledger checkpoint state
  const { ledger } = manifest.execution;
  const completedOps = [
    'item-C01',
    'item-C02',
    'offer-C01',
    'offer-C02',
    'group-complete',
    'publish-group',
  ];
  for (const opId of completedOps) {
    const entry = ledger.find((e) => e.id === opId);
    if (!entry) throw new Error(`Ledger missing operation ${opId}.`);
    if (entry.state !== 'completed')
      throw new Error(`Ledger operation ${opId} must be completed, got ${entry.state}.`);
    if (entry.attemptCount !== 1)
      throw new Error(
        `Ledger operation ${opId} must have attemptCount 1, got ${entry.attemptCount}.`
      );
    if (!entry.readBackDigest)
      throw new Error(`Ledger operation ${opId} must have a non-null readBackDigest.`);
  }
  // all remaining ops beyond publish-group must be planned and untouched
  const publishIdx = ledger.findIndex((e) => e.id === 'publish-group');
  if (publishIdx === -1) throw new Error('Ledger missing publish-group entry.');
  for (let i = publishIdx + 1; i < ledger.length; i += 1) {
    const entry = ledger[i];
    if (entry.state !== 'planned')
      throw new Error(`Ledger operation ${entry.id} must be planned, got ${entry.state}.`);
    if (entry.attemptCount !== 0)
      throw new Error(
        `Ledger operation ${entry.id} must have attemptCount 0, got ${entry.attemptCount}.`
      );
    if (entry.startedAt !== null)
      throw new Error(`Ledger operation ${entry.id} must have null startedAt.`);
    if (entry.completedAt !== null)
      throw new Error(`Ledger operation ${entry.id} must have null completedAt.`);
    if (entry.error !== null) throw new Error(`Ledger operation ${entry.id} must have null error.`);
    if (entry.result !== null)
      throw new Error(`Ledger operation ${entry.id} must have null result.`);
    if (entry.readBackDigest !== null)
      throw new Error(`Ledger operation ${entry.id} must have null readBackDigest.`);
  }

  let readCount = { identity: 0, inventoryItems: 0, offers: 0, group: 0 };

  // -- Seller identity ---------------------------------------------------
  const identity = await readApi.getCurrentUserIdentity();
  readCount.identity += 1;
  if (identity.userId !== confirmSandboxSeller)
    throw new Error(
      `Seller identity mismatch: expected ${confirmSandboxSeller}, got ${identity.userId}.`
    );
  if (manifest.seller && manifest.seller.userId !== identity.userId)
    throw new Error(
      `Seller identity changed from manifest: expected ${manifest.seller.userId}, got ${identity.userId}.`
    );

  // -- Build immutable future plan ---------------------------------------
  const plan = resolveFuturePlan(manifest);

  // -- Bounded reads: items first ----------------------------------------
  const itemSummaries: {
    slot: string;
    sku: string;
    quantity: number;
    expectedQuantity: number;
  }[] = [];

  for (let index = 0; index < manifest.run.childSkus.length; index += 1) {
    const sku = manifest.run.childSkus[index];
    const slot = `C0${index + 1}`;

    const item = await readApi.getInventoryItem(sku);
    readCount.inventoryItems += 1;
    if (item.status !== 'found') throw new Error(`Item ${sku} must be found, got ${item.status}.`);
    const remote = item.value;

    const expectedItemPayload = plan.operations.find((op) => op.id === `item-${slot}`);
    if (!expectedItemPayload) throw new Error(`Missing planned operation for item-${slot}.`);

    // -- Item semantic match (fail-closed) --------------------------------
    const mismatchedItemField = inventoryItemSemanticMismatch(
      remote.semanticSnapshot,
      expectedItemPayload.payload
    );
    if (mismatchedItemField !== null)
      throw new Error(
        `Item ${sku} semantic ${mismatchedItemField} does not match the immutable planned item.`
      );

    // -- Item quantity (fail-closed, must be present) ---------------------
    const itemQuantity = remote.quantity;
    if (itemQuantity === undefined || itemQuantity === null)
      throw new Error(`Item ${sku} quantity is missing from the response.`);
    if (!Number.isInteger(itemQuantity) || itemQuantity < 0)
      throw new Error(`Item ${sku} quantity is not a valid non-negative integer.`);
    const expectedQuantity = manifest.ownership.itemQuantities[index];
    if (itemQuantity !== expectedQuantity)
      throw new Error(
        `Item ${sku} quantity mismatch: expected ${expectedQuantity}, got ${itemQuantity}.`
      );

    // -- Group association (fail-closed, must have exact single key) ------
    const groupKeys = remote.groupKeys;
    if (!groupKeys) throw new Error(`Item ${sku} groupKeys is missing or null.`);
    if (groupKeys.length !== 1)
      throw new Error(
        `Item ${sku} must have exactly one group association, got ${groupKeys.length}.`
      );
    if (groupKeys[0] !== manifest.run.groupKey)
      throw new Error(
        `Item ${sku} group association ${groupKeys[0]} does not match manifest group ${manifest.run.groupKey}.`
      );

    itemSummaries.push({ slot, sku, quantity: itemQuantity, expectedQuantity });
  }

  // -- Offer reconciliation via shared publication reconciler -------------
  const publication = await reconcileCompletePublicationState(readApi, manifest);
  readCount.offers += manifest.run.childSkus.length;

  if (publication.state !== 'active')
    throw new Error(`Publication state must be active for verification, got ${publication.state}.`);
  if (publication.listingId !== manifest.groupListingId)
    throw new Error(
      `Publication listing ID ${publication.listingId} does not match manifest ${manifest.groupListingId}.`
    );
  if (publication.offers.length !== manifest.run.childSkus.length)
    throw new Error(
      `Expected ${manifest.run.childSkus.length} published offers, got ${publication.offers.length}.`
    );

  // -- Validate each reconciled offer against immutable plan --------------
  const children: VerifiedChildSummary[] = [];
  const seenOfferIds = new Set<string>();

  for (let index = 0; index < manifest.run.childSkus.length; index += 1) {
    const sku = manifest.run.childSkus[index];
    const slot = `C0${index + 1}`;

    // Find the reconciled offer for this exact SKU (ordered match)
    const offer = publication.offers.find((o) => o.sku === sku);
    if (!offer) throw new Error(`Offer for ${sku} missing from reconciled publication state.`);
    if (seenOfferIds.has(offer.offerId))
      throw new Error(`Duplicate offer ${offer.offerId} in publication state.`);
    seenOfferIds.add(offer.offerId);

    const recordedOfferId = manifest.resources[index].offerId!;
    if (offer.offerId !== recordedOfferId)
      throw new Error(
        `Offer ID mismatch for ${sku}: expected ${recordedOfferId}, got ${offer.offerId}.`
      );

    // -- Offer semantic match (fail-closed) -------------------------------
    const expectedOfferPayload = plan.operations.find((op) => op.id === `offer-${slot}`);
    if (!expectedOfferPayload) throw new Error(`Missing planned operation for offer-${slot}.`);

    const mismatchedOfferField = offerSemanticMismatch(
      offer.semanticSnapshot,
      expectedOfferPayload.payload
    );
    if (mismatchedOfferField !== null)
      throw new Error(
        `Offer ${sku} semantic ${mismatchedOfferField} does not match the immutable planned offer.`
      );

    // -- Offer quantity (fail-closed, must be present) --------------------
    const offerQuantity = offer.availableQuantity;
    if (offerQuantity === undefined || offerQuantity === null)
      throw new Error(`Offer ${sku} availableQuantity is missing.`);
    if (!Number.isInteger(offerQuantity) || offerQuantity < 0)
      throw new Error(`Offer ${sku} availableQuantity is not a valid non-negative integer.`);
    const expectedOfferQuantity = manifest.ownership.offerQuantities[index];
    if (offerQuantity !== expectedOfferQuantity)
      throw new Error(
        `Offer ${sku} quantity mismatch: expected ${expectedOfferQuantity}, got ${offerQuantity}.`
      );

    // Lifecycle, listing ID, and publication evidence already verified by
    // reconcileCompletePublicationState (active, matching listingId,
    // publicationObserved, listingCurrentlyActive, withdrawRequired).

    children.push({
      slot,
      sku,
      quantity: itemSummaries[index].quantity,
      expectedQuantity: itemSummaries[index].expectedQuantity,
      quantityMatch: true,
      offerId: offer.offerId,
      expectedOfferId: recordedOfferId,
      offerStatus: 'PUBLISHED',
      listingLifecycle: 'active',
      itemSemanticMatch: true,
      offerSemanticMatch: true,
      groupAssociationMatch: true,
    });
  }

  // -- Group (fail-closed) ------------------------------------------------
  const groupRead = await readApi.getInventoryItemGroup(manifest.run.groupKey);
  readCount.group += 1;
  if (groupRead.status !== 'found')
    throw new Error(`Group must be found, got ${groupRead.status}.`);

  const group = groupRead.value;
  const expectedVariantSkus = manifest.run.childSkus;
  const groupSkusMatch =
    manifest.execution.fixture.version === 4
      ? JSON.stringify([...group.variantSKUs].sort()) ===
        JSON.stringify([...expectedVariantSkus].sort())
      : JSON.stringify(group.variantSKUs) === JSON.stringify(expectedVariantSkus);
  if (!groupSkusMatch)
    throw new Error(
      `Group variant SKUs mismatch: expected ${JSON.stringify(expectedVariantSkus)}, got ${JSON.stringify(group.variantSKUs)}.`
    );

  const expectedGroupPayload = plan.operations.find((op) => op.id === 'group-complete');
  if (!expectedGroupPayload) throw new Error('Missing planned operation for group-complete.');

  // Require snapshotDigest — absent digest is incomplete state
  const groupSnapshotDigest = group.snapshotDigest;
  if (!groupSnapshotDigest)
    throw new Error(
      'Group snapshotDigest is absent; group read is incomplete and cannot be verified.'
    );
  const expectedDigest = digest(expectedGroupPayload.payload);
  if (groupSnapshotDigest !== expectedDigest)
    throw new Error(
      `Group semantic digest mismatch: expected ${expectedDigest}, got ${groupSnapshotDigest}.`
    );

  // -- All gates passed — return verified report -------------------------
  return {
    status: 'verified',
    runId: manifest.run.runId,
    sellerId: identity.userId,
    groupKey: manifest.run.groupKey,
    listingId: manifest.groupListingId,
    children,
    groupSemanticMatch: true,
    manifestSha256,
    reads: readCount,
    mutationCapabilitiesResolved: false,
    manifestWritten: false,
  };
}
