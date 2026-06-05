import type { AppSettingsRow, ListingRow } from '@ebay-inventory/data';
import { EbaySellerApi } from '@/api/index.js';
import type { InventoryApi } from '@/api/listing-management/inventory.js';
import type { MetadataApi } from '@/api/listing-metadata/metadata.js';
import type { TaxonomyApi } from '@/api/listing-metadata/taxonomy.js';
import { getEbayConfig } from '@/config/environment.js';
import { getSidecarDataAccess, type SidecarDataAccess } from '@/data/sidecar-data.js';
import type { EbayConfig } from '@/types/ebay.js';
import {
  getRawCardConditionCandidateLabels,
  getRawCardConditionDescriptorValueId,
  getSavedRawCardConditionToken,
  getRawCardConditionDisplayLabel,
  GRADED_TRADING_CARD_CONDITION_ID,
  isTradingCardCategoryId,
  RAW_TRADING_CARD_CONDITION_ID,
  TRADING_CARD_CONDITION_ASPECT_KEY,
  type RawCardConditionToken,
} from '@/listings/trading-card-conditions.js';
import type { EbayApiError } from '@/types/ebay.js';
import type { components as MetadataComponents } from '@/types/sell-apps/listing-metadata/sellMetadataV1Oas3.js';
import { createLogger } from '@/utils/logger.js';
import {
  buildPublishSku,
  mapListingToInventoryItemPayload,
  mapListingToOfferPayload,
} from '@/ebay/publish-mappers.js';
import {
  getMetadataPolicies,
  getTradingCardConditionDescriptor,
} from '@/ebay/condition-policy-diagnostic.js';
import {
  buildPublishedListingUpdate,
  PUBLISHED_LISTING_ATTEMPTED_FIELDS,
} from '@/ebay/published-listing-state.js';
import {
  assertPublishReady,
  assertStructuredPublishSkuReady,
  PublishListingError,
  PublishListingValidationError,
  validatePublishListingReadiness,
} from '@/ebay/publish-validation.js';
import {
  assertListingImageUrlsReadyForEbay,
} from '@/ebay/image-url-readiness.js';
import {
  getPublishConfigCandidate,
  resolvePublishConfig,
  type ResolvedPublishConfig,
} from '@/ebay/publish-config.js';
import { validateRequiredItemSpecificsForCategory } from '@/ebay/required-item-specifics-validation.js';

type PublishInventoryApi = Pick<
  InventoryApi,
  'createOrReplaceInventoryItem' | 'createOffer' | 'getInventoryLocation' | 'getOffers' | 'publishOffer'
>;
type PublishMetadataApi = Pick<MetadataApi, 'getItemConditionPolicies'>;
type PublishTaxonomyApi = Pick<TaxonomyApi, 'getDefaultCategoryTreeId' | 'getItemAspectsForCategory'>;

type MetadataItemConditionDescriptor = MetadataComponents['schemas']['ItemConditionDescriptor'];
type OfferLookupResponse = Awaited<ReturnType<PublishInventoryApi['getOffers']>>;
type OfferLookupEntry = NonNullable<OfferLookupResponse['offers']>[number];

const publishLogger = createLogger('PublishListing');

export interface PublishListingDependencies {
  dataAccess: SidecarDataAccess;
  fetch?: typeof globalThis.fetch;
  imagePublicBaseUrl?: string | null;
  inventoryApi: PublishInventoryApi;
  metadataApi: PublishMetadataApi;
  taxonomyApi: PublishTaxonomyApi;
  now: () => Date;
  runtimeConfig: Pick<EbayConfig, 'environment' | 'marketplaceId'>;
}

export interface PublishListingResult {
  ebayListingId: string | null;
  exportedAt: string;
  listingId: string;
  offerId: string | null;
  reusedExistingOffer: boolean;
  sku: string;
  status: 'exported';
}

async function createDefaultDependencies(): Promise<PublishListingDependencies> {
  const runtimeConfig = getEbayConfig();
  const api = new EbaySellerApi(runtimeConfig);
  await api.initialize();

  return {
    dataAccess: getSidecarDataAccess(),
    fetch: globalThis.fetch,
    imagePublicBaseUrl: process.env.R2_PUBLIC_BASE_URL?.trim() || null,
    inventoryApi: api.inventory,
    metadataApi: api.metadata,
    taxonomyApi: api.taxonomy,
    now: () => new Date(),
    runtimeConfig: {
      environment: runtimeConfig.environment,
      marketplaceId: runtimeConfig.marketplaceId ?? 'EBAY_US',
    },
  };
}

async function resolveDependencies(
  dependencies: Partial<PublishListingDependencies>
): Promise<PublishListingDependencies> {
  if (
    dependencies.dataAccess &&
    dependencies.inventoryApi &&
    dependencies.metadataApi &&
    dependencies.taxonomyApi
  ) {
    return {
      dataAccess: dependencies.dataAccess,
      fetch: dependencies.fetch ?? globalThis.fetch,
      imagePublicBaseUrl:
        dependencies.imagePublicBaseUrl ?? (process.env.R2_PUBLIC_BASE_URL?.trim() || null),
      inventoryApi: dependencies.inventoryApi,
      metadataApi: dependencies.metadataApi,
      taxonomyApi: dependencies.taxonomyApi,
      now: dependencies.now ?? (() => new Date()),
      runtimeConfig: dependencies.runtimeConfig ?? {
        environment: 'sandbox',
        marketplaceId: 'EBAY_US',
      },
    };
  }

  const defaults = await createDefaultDependencies();

  return {
    dataAccess: dependencies.dataAccess ?? defaults.dataAccess,
    fetch: dependencies.fetch ?? defaults.fetch,
    imagePublicBaseUrl: dependencies.imagePublicBaseUrl ?? defaults.imagePublicBaseUrl,
    inventoryApi: dependencies.inventoryApi ?? defaults.inventoryApi,
    metadataApi: dependencies.metadataApi ?? defaults.metadataApi,
    taxonomyApi: dependencies.taxonomyApi ?? defaults.taxonomyApi,
    now: dependencies.now ?? defaults.now,
    runtimeConfig: dependencies.runtimeConfig ?? defaults.runtimeConfig,
  };
}

function normalizeLookupText(value: string | null | undefined): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ');
}

function getListingLabel(listing: Pick<ListingRow, 'listing_id'>): string {
  return listing.listing_id?.trim().length ? listing.listing_id.trim() : '[missing listing_id]';
}

function matchesRawCardConditionValue(
  token: RawCardConditionToken,
  valueId: string | null | undefined,
  valueName: string | null | undefined
): boolean {
  const normalizedValueId = valueId?.trim();
  const normalizedValueName = normalizeLookupText(valueName);

  return (
    normalizedValueId === getRawCardConditionDescriptorValueId(token) ||
    getRawCardConditionCandidateLabels(token).some(
    (candidate) => normalizeLookupText(candidate) === normalizedValueName
    )
  );
}

function formatMetadataDescriptorValue(
  value: Pick<
    NonNullable<MetadataItemConditionDescriptor['conditionDescriptorValues']>[number],
    'conditionDescriptorValueId' | 'conditionDescriptorValueName'
  >
): string {
  const id = value.conditionDescriptorValueId?.trim() || '[missing id]';
  const name = value.conditionDescriptorValueName?.trim() || '[missing name]';
  return `${id}: ${name}`;
}

function getMetadataDescriptorValueDiagnostics(
  descriptor: MetadataItemConditionDescriptor | undefined
): string[] {
  const values = descriptor?.conditionDescriptorValues;

  if (!Array.isArray(values) || values.length === 0) {
    return [];
  }

  return values.map((value) => formatMetadataDescriptorValue(value));
}

function buildTradingCardMismatchIssue(
  listing: ListingRow,
  savedToken: RawCardConditionToken,
  descriptor: MetadataItemConditionDescriptor | undefined
): string {
  const listingLabel = getListingLabel(listing);
  const supportedValues = getMetadataDescriptorValueDiagnostics(descriptor);
  const descriptorName = descriptor?.conditionDescriptorName?.trim() || '[not found]';

  return [
    `Listing "${listingLabel}" could not map raw card condition token "${savedToken}" (${getRawCardConditionDisplayLabel(savedToken)}) to eBay metadata for category "${listing.category_id}".`,
    `Diagnostics: listing_id="${listing.listing_id ?? '[missing listing_id]'}", category_id="${listing.category_id ?? '[missing category_id]'}", saved_token="${savedToken}", saved_display_label="${getRawCardConditionDisplayLabel(savedToken)}", descriptor_name="${descriptorName}", supported_values=${JSON.stringify(supportedValues)}.`,
  ].join(' ');
}

function buildTradingCardValidationError(listing: ListingRow, message: string): PublishListingValidationError {
  return new PublishListingValidationError(listing.listing_id, [message]);
}

async function resolveTradingCardConditionDescriptors(
  listing: ListingRow,
  marketplaceId: string,
  metadataApi: PublishMetadataApi
) {
  if (!isTradingCardCategoryId(listing.category_id)) {
    return undefined;
  }

  const listingLabel = getListingLabel(listing);
  const normalizedConditionId = listing.condition_id?.trim();

  if (normalizedConditionId === GRADED_TRADING_CARD_CONDITION_ID) {
    throw buildTradingCardValidationError(
      listing,
      `Listing "${listingLabel}" uses graded trading-card condition_id "${GRADED_TRADING_CARD_CONDITION_ID}", but graded condition descriptors are not supported yet.`
    );
  }

  if (normalizedConditionId !== RAW_TRADING_CARD_CONDITION_ID) {
    return undefined;
  }

  const savedToken = getSavedRawCardConditionToken(listing.item_specifics);

  if (!savedToken) {
    throw buildTradingCardValidationError(
      listing,
      `Listing "${listingLabel}" is missing valid item_specifics["${TRADING_CARD_CONDITION_ASPECT_KEY}"] for trading-card publish.`
    );
  }

  let metadataResponse: Awaited<ReturnType<PublishMetadataApi['getItemConditionPolicies']>>;

  try {
    metadataResponse = await metadataApi.getItemConditionPolicies(
      marketplaceId,
      `categoryIds:{${listing.category_id!.trim()}}`
    );
  } catch (error) {
    throw wrapPublishStageError(
      'INVENTORY_ITEM_UPSERT_FAILED',
      'metadata',
      listing.listing_id,
      `Failed to fetch trading-card condition metadata for listing "${listingLabel}" in category "${listing.category_id}".`,
      error
    );
  }

  const policy = getMetadataPolicies(metadataResponse).find(
    (candidate) => candidate.categoryId?.trim() === listing.category_id?.trim()
  );
  const condition = policy?.itemConditions?.find(
    (candidate) => candidate.conditionId?.trim() === RAW_TRADING_CARD_CONDITION_ID
  );
  const descriptor = getTradingCardConditionDescriptor(condition);
  if (!descriptor?.conditionDescriptorId) {
    // Some sandbox/live category policies omit Card Condition descriptors entirely; fall back to
    // normal aspects so metadata gaps do not block publish for otherwise valid reviewed listings.
    publishLogger.debug('Trading-card condition metadata had no relevant descriptor; falling back.', {
      availableConditionIds: policy?.itemConditions?.map((candidate) => candidate.conditionId ?? '[missing]') ?? [],
      availableDescriptorNames:
        policy?.itemConditions?.flatMap((candidate) =>
          candidate.conditionDescriptors?.map(
            (descriptorCandidate) => descriptorCandidate.conditionDescriptorName ?? '[missing]'
          ) ?? []
        ) ?? [],
      category_id: listing.category_id,
      condition_id: listing.condition_id,
      listing_id: listing.listing_id,
      saved_token: savedToken,
    });
    return undefined;
  }

  const descriptorValue = descriptor?.conditionDescriptorValues?.find((candidate) =>
    matchesRawCardConditionValue(
      savedToken,
      candidate.conditionDescriptorValueId,
      candidate.conditionDescriptorValueName
    )
  );

  if (!descriptorValue?.conditionDescriptorValueId) {
    throw buildTradingCardValidationError(listing, buildTradingCardMismatchIssue(listing, savedToken, descriptor));
  }

  return [
    {
      name: descriptor.conditionDescriptorId,
      values: [descriptorValue.conditionDescriptorValueId],
    },
  ];
}

function getCauseMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getEbayErrors(error: unknown): EbayApiError['errors'] | undefined {
  const visited = new Set<Error>();
  let current: unknown = error;

  while (current instanceof Error && !visited.has(current)) {
    visited.add(current);

    if ('ebayErrors' in current) {
      const ebayErrors = (current as { ebayErrors?: unknown }).ebayErrors;
      if (Array.isArray(ebayErrors)) {
        return ebayErrors as EbayApiError['errors'];
      }
    }

    current = 'cause' in current ? current.cause : undefined;
  }

  return undefined;
}

function getTrimmedString(value: string | null | undefined): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function hasPublishedListingTrace(listing: Pick<ListingRow, 'ebay_listing_id'>): boolean {
  return getTrimmedString(listing.ebay_listing_id) !== undefined;
}

function buildTraceBackedListingRepairUpdate(
  listing: ListingRow,
  exportedAt: string
): Partial<ListingRow> {
  const changes: Partial<ListingRow> = {
    exported_at: getTrimmedString(listing.exported_at) ?? exportedAt,
    last_error_at: null,
    last_error_code: null,
    last_error_context: {},
    last_error_message: null,
    status: 'exported',
    sub_status: 'idle',
  };

  const ebayListingId = getTrimmedString(listing.ebay_listing_id);
  const ebayOfferId = getTrimmedString(listing.ebay_offer_id);
  const ebayListingUrl = getTrimmedString(listing.ebay_listing_url);
  const ebayListingStatus = getTrimmedString(listing.ebay_listing_status);
  const sku = getTrimmedString(listing.sku);

  if (ebayListingId) {
    changes.ebay_listing_id = ebayListingId;
  }

  if (ebayOfferId !== undefined) {
    changes.ebay_offer_id = ebayOfferId;
  }

  if (ebayListingUrl !== undefined) {
    changes.ebay_listing_url = ebayListingUrl;
  }

  if (ebayListingStatus !== undefined) {
    changes.ebay_listing_status = ebayListingStatus;
  }

  if (sku !== undefined) {
    changes.sku = sku;
  }

  return changes;
}

function getEbayErrorText(error: EbayApiError['errors'][number]): string {
  return [error.message, error.longMessage, ...(error.parameters ?? []).flatMap((parameter) => [
    parameter.name,
    parameter.value,
  ])]
    .filter((value) => typeof value === 'string' && value.trim().length > 0)
    .join(' ')
    .toLowerCase();
}

function getEbayErrorParameterValue(
  error: EbayApiError['errors'][number],
  name: string
): string | undefined {
  const parameter = error.parameters?.find((entry) => entry.name === name);
  return getTrimmedString(parameter?.value);
}

function isDuplicateOfferAlreadyExistsError(error: unknown): boolean {
  return (
    getEbayErrors(error)?.some(
      (entry) =>
        entry.errorId === 25002 && getEbayErrorText(entry).includes('offer entity already exists')
    ) ?? false
  );
}

function getDuplicateOfferIdFromError(error: unknown): string | undefined {
  const duplicateOfferError = getEbayErrors(error)?.find(
    (entry) =>
      entry.errorId === 25002 && getEbayErrorText(entry).includes('offer entity already exists')
  );

  return duplicateOfferError ? getEbayErrorParameterValue(duplicateOfferError, 'offerId') : undefined;
}

function getOfferIdFromLookupEntry(offer: OfferLookupEntry): string | undefined {
  return getTrimmedString(offer.offerId);
}

function isPublishedOffer(offer: OfferLookupEntry): boolean {
  return getTrimmedString(offer.status)?.toUpperCase() === 'PUBLISHED';
}

function pickLookupOffer(
  offers: OfferLookupEntry[],
  preferredOfferId?: string
): OfferLookupEntry | undefined {
  const preferred = getTrimmedString(preferredOfferId);

  if (preferred) {
    const matchingOffer = offers.find((offer) => getOfferIdFromLookupEntry(offer) === preferred);
    if (matchingOffer) {
      return matchingOffer;
    }
  }

  return (
    offers.find((offer) => getTrimmedString(offer.format)?.toUpperCase() === 'FIXED_PRICE') ??
    offers.find((offer) => getOfferIdFromLookupEntry(offer) !== undefined)
  );
}

async function resolveExistingOfferForSku(
  inventoryApi: PublishInventoryApi,
  sku: string,
  marketplaceId: string,
  preferredOfferId?: string
): Promise<OfferLookupEntry | undefined> {
  const response = await inventoryApi.getOffers(sku, marketplaceId, 25);
  return pickLookupOffer(response.offers ?? [], preferredOfferId);
}

async function loadPublishListing(
  listingId: string,
  dataAccess: SidecarDataAccess
): Promise<ListingRow> {
  const listing = await dataAccess.listings.getByListingId(listingId);

  if (!listing) {
    throw new PublishListingError(
      'LISTING_NOT_FOUND',
      `Listing "${listingId}" was not found.`,
      {
        listingId,
        stage: 'load',
      }
    );
  }

  return listing;
}

async function loadPublishAppSettings(
  listingId: string,
  dataAccess: SidecarDataAccess
): Promise<AppSettingsRow> {
  const appSettings = await dataAccess.appSettings.get();

  if (!appSettings) {
    throw new PublishListingError(
      'APP_SETTINGS_NOT_FOUND',
      'App settings "default" were not found.',
      {
        listingId,
        stage: 'load',
      }
    );
  }

  return appSettings;
}

function wrapPublishStageError(
  code: PublishListingError['code'],
  stage: NonNullable<PublishListingError['context']['stage']>,
  listingId: string | null,
  message: string,
  error: unknown
): PublishListingError {
  return new PublishListingError(
    code,
    message,
    {
      ebayErrors: getEbayErrors(error),
      listingId,
      stage,
    },
    { cause: error }
  );
}

async function verifyResolvedMerchantLocation(
  inventoryApi: PublishInventoryApi,
  listingId: string,
  publishConfig: ResolvedPublishConfig
): Promise<void> {
  try {
    const location = (await inventoryApi.getInventoryLocation(publishConfig.merchantLocationKey)) as {
      merchantLocationStatus?: string | null;
    };
    const status = getTrimmedString(location.merchantLocationStatus)?.toUpperCase();

    if (status && status !== 'ENABLED') {
      throw new PublishListingValidationError(listingId, [
        `merchant_location_key_missing_for_environment: merchant location "${publishConfig.merchantLocationKey}" exists for ${publishConfig.environment} but status is "${status}", not ENABLED.`,
      ]);
    }
  } catch (error) {
    if (error instanceof PublishListingValidationError) {
      throw error;
    }

    throw new PublishListingValidationError(listingId, [
      `merchant_location_key_missing_for_environment: merchant location "${publishConfig.merchantLocationKey}" could not be verified for ${publishConfig.environment}.`,
    ]);
  }
}

export async function publishListing(
  listingId: string,
  dependencies: Partial<PublishListingDependencies> = {}
): Promise<PublishListingResult> {
  const resolvedDependencies = await resolveDependencies(dependencies);
  const listing = await loadPublishListing(listingId, resolvedDependencies.dataAccess);
  const appSettings = await loadPublishAppSettings(listingId, resolvedDependencies.dataAccess);
  const runtimeMarketplaceId = resolvedDependencies.runtimeConfig.marketplaceId ?? 'EBAY_US';
  const publishConfigResult = resolvePublishConfig(appSettings, {
    environment: resolvedDependencies.runtimeConfig.environment,
    runtimeMarketplaceId,
  });
  const publishConfigCandidate = getPublishConfigCandidate(appSettings, {
    environment: resolvedDependencies.runtimeConfig.environment,
    runtimeMarketplaceId,
  });

  if (hasPublishedListingTrace(listing)) {
    assertStructuredPublishSkuReady(listing);

    if (!publishConfigResult.config) {
      throw new PublishListingValidationError(listing.listing_id, publishConfigResult.issues);
    }

    const ebayListingId = getTrimmedString(listing.ebay_listing_id)!;
    const offerId = getTrimmedString(listing.ebay_offer_id) ?? null;
    const exportedAt = getTrimmedString(listing.exported_at) ?? resolvedDependencies.now().toISOString();
    const sku = buildPublishSku(listing);

    // TODO: add explicit environment tagging before treating stored publish trace as cross-env safe.
    publishLogger.info('Listing already has published trace; repairing exported state and skipping eBay write path.', {
      ebayListingId,
      listingId,
      offerId,
      sku,
    });

    try {
      await resolvedDependencies.dataAccess.listings.update(
        listingId,
        buildTraceBackedListingRepairUpdate(listing, exportedAt)
      );
    } catch (error) {
      throw new PublishListingError(
        'EXPORT_STATE_PERSIST_FAILED',
        `Published listing "${listingId}" already has trace data but failed to repair exported state.`,
        {
          attemptedFields: [...PUBLISHED_LISTING_ATTEMPTED_FIELDS],
          causeMessage: getCauseMessage(error),
          listingId,
          offerId: offerId ?? undefined,
          publishOfferListingId: ebayListingId,
          stage: 'finalize',
        },
        { cause: error instanceof Error ? error : undefined }
      );
    }

    return {
      ebayListingId,
      exportedAt,
      listingId,
      offerId,
      reusedExistingOffer: true,
      sku,
      status: 'exported',
    };
  }

  assertPublishReady({
    listing,
    publishConfig: publishConfigCandidate,
    quantity: 1,
  });

  validatePublishListingReadiness(listing, appSettings, {
    environment: resolvedDependencies.runtimeConfig.environment,
    runtimeMarketplaceId,
  });

  if (!publishConfigResult.config) {
    throw new PublishListingValidationError(listing.listing_id, publishConfigResult.issues);
  }

  const publishConfig = publishConfigResult.config;

  validateRequiredItemSpecificsForCategory({
    listing,
  });
  await assertListingImageUrlsReadyForEbay(listing, {
    allowedPublicBaseUrl: resolvedDependencies.imagePublicBaseUrl,
    fetch: resolvedDependencies.fetch,
  });

  const sku = buildPublishSku(listing);
  const conditionDescriptors = await resolveTradingCardConditionDescriptors(
    listing,
    publishConfig.marketplaceId,
    resolvedDependencies.metadataApi
  );
  const inventoryItemPayload = mapListingToInventoryItemPayload(listing, appSettings, {
    conditionDescriptors,
  });
  const offerPayload = mapListingToOfferPayload(listing, publishConfig, sku);
  const marketplaceId = publishConfig.marketplaceId;
  let reusedExistingOffer = getTrimmedString(listing.ebay_offer_id) !== undefined;

  publishLogger.info('Resolved publish config for listing publish.', {
    environment: publishConfig.environment,
    fulfillmentPolicyId: publishConfig.fulfillmentPolicyId,
    listingId,
    marketplaceId: publishConfig.marketplaceId,
    merchantLocationKey: publishConfig.merchantLocationKey,
    paymentPolicyId: publishConfig.paymentPolicyId,
    returnPolicyId: publishConfig.returnPolicyId,
    source: publishConfig.source,
  });

  await verifyResolvedMerchantLocation(resolvedDependencies.inventoryApi, listingId, publishConfig);

  try {
    await resolvedDependencies.inventoryApi.createOrReplaceInventoryItem(sku, inventoryItemPayload);
    await resolvedDependencies.dataAccess.listings.update(listingId, {
      sku,
    });
  } catch (error) {
    throw wrapPublishStageError(
      'INVENTORY_ITEM_UPSERT_FAILED',
      'inventory_item',
      listingId,
      `Failed to create inventory item for listing "${listingId}".`,
      error
    );
  }

  let offerId = getTrimmedString(listing.ebay_offer_id) ?? null;
  let recoveredOffer: OfferLookupEntry | undefined;

  if (!offerId) {
    try {
      const createOfferResponse = await resolvedDependencies.inventoryApi.createOffer(offerPayload);
      offerId = getTrimmedString(createOfferResponse.offerId) ?? null;

      if (!offerId) {
        throw new Error('createOffer completed without offerId.');
      }

      await resolvedDependencies.dataAccess.listings.update(listingId, {
        ebay_offer_id: offerId,
        sku,
      });
    } catch (error) {
      if (!isDuplicateOfferAlreadyExistsError(error)) {
        throw wrapPublishStageError(
          'OFFER_CREATE_FAILED',
          'offer',
          listingId,
          `Failed to create offer for listing "${listingId}".`,
          error
        );
      }

      const duplicateOfferId = getDuplicateOfferIdFromError(error);

      if (duplicateOfferId) {
        offerId = duplicateOfferId;
      }

      try {
        recoveredOffer = await resolveExistingOfferForSku(
          resolvedDependencies.inventoryApi,
          sku,
          marketplaceId,
          offerId ?? undefined
        );
      } catch (lookupError) {
        if (!offerId) {
          throw new PublishListingError(
            'OFFER_CREATE_FAILED',
            `eBay reported an existing offer for SKU "${sku}" but did not return an offerId, and the existing offer could not be resolved.`,
            {
              causeMessage: getCauseMessage(lookupError),
              ebayErrors: getEbayErrors(error),
              listingId,
              stage: 'offer',
            },
            { cause: lookupError instanceof Error ? lookupError : undefined }
          );
        }
      }

      const recoveredOfferId = recoveredOffer ? getOfferIdFromLookupEntry(recoveredOffer) : undefined;
      offerId = offerId ?? recoveredOfferId ?? null;

      if (!offerId) {
        throw new PublishListingError(
          'OFFER_CREATE_FAILED',
          `eBay reported an existing offer for SKU "${sku}" but no offerId could be resolved.`,
          {
            causeMessage: getCauseMessage(error),
            ebayErrors: getEbayErrors(error),
            listingId,
            stage: 'offer',
          },
          { cause: error instanceof Error ? error : undefined }
        );
      }

      reusedExistingOffer = true;

      await resolvedDependencies.dataAccess.listings.update(listingId, {
        ebay_offer_id: offerId,
        sku,
      });

      if (!recoveredOffer) {
        try {
          recoveredOffer = await resolveExistingOfferForSku(
            resolvedDependencies.inventoryApi,
            sku,
            marketplaceId,
            offerId
          );
        } catch {
          recoveredOffer = undefined;
        }
      }
    }
  }

  if (!offerId) {
    throw new PublishListingError('OFFER_CREATE_FAILED', `Failed to resolve an offer for listing "${listingId}".`, {
      listingId,
      stage: 'offer',
    });
  }

  if (recoveredOffer && isPublishedOffer(recoveredOffer)) {
    const exportedAt = resolvedDependencies.now().toISOString();
    const recoveredListingId = getTrimmedString(recoveredOffer.listing?.listingId) ?? null;

    try {
      await resolvedDependencies.dataAccess.listings.update(
        listingId,
        buildPublishedListingUpdate({
          appSettings,
          ebayListingId: recoveredListingId,
          ebayOfferId: offerId,
          exportedAt,
          sku,
        })
      );
    } catch (error) {
      throw new PublishListingError(
        'EXPORT_STATE_PERSIST_FAILED',
        `Recovered a published offer for listing "${listingId}" but failed to persist exported state.`,
        {
          attemptedFields: [...PUBLISHED_LISTING_ATTEMPTED_FIELDS],
          causeMessage: getCauseMessage(error),
          listingId,
          offerId,
          publishOfferListingId: recoveredListingId,
          stage: 'finalize',
        },
        { cause: error instanceof Error ? error : undefined }
      );
    }

    return {
      ebayListingId: recoveredListingId,
      exportedAt,
      listingId,
      offerId,
      reusedExistingOffer,
      sku,
      status: 'exported',
    };
  }

  try {
    const publishOfferResponse = await resolvedDependencies.inventoryApi.publishOffer(offerId);
    const exportedAt = resolvedDependencies.now().toISOString();

    try {
      await resolvedDependencies.dataAccess.listings.update(
        listingId,
        buildPublishedListingUpdate({
          appSettings,
          ebayListingId: publishOfferResponse.listingId,
          ebayOfferId: offerId,
          exportedAt,
          sku,
        })
      );
    } catch (error) {
      throw new PublishListingError(
        'EXPORT_STATE_PERSIST_FAILED',
        `Published offer for listing "${listingId}" but failed to persist exported state.`,
        {
          attemptedFields: [...PUBLISHED_LISTING_ATTEMPTED_FIELDS],
          causeMessage: getCauseMessage(error),
          listingId,
          offerId,
          publishOfferListingId: publishOfferResponse.listingId ?? null,
          stage: 'finalize',
        },
        { cause: error }
      );
    }

    return {
      ebayListingId: publishOfferResponse.listingId ?? listing.ebay_listing_id ?? null,
      exportedAt,
      listingId,
      offerId,
      reusedExistingOffer,
      sku,
      status: 'exported',
    };
  } catch (error) {
    if (error instanceof PublishListingError) {
      throw error;
    }

    throw wrapPublishStageError(
      'OFFER_PUBLISH_FAILED',
      'publish',
      listingId,
      `Failed to publish offer for listing "${listingId}".`,
      error
    );
  }
}
