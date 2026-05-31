import type { AppSettingsRow, ListingRow } from '@ebay-inventory/data';
import { EbaySellerApi } from '@/api/index.js';
import type { InventoryApi } from '@/api/listing-management/inventory.js';
import type { MetadataApi } from '@/api/listing-metadata/metadata.js';
import type { TaxonomyApi } from '@/api/listing-metadata/taxonomy.js';
import { getEbayConfig } from '@/config/environment.js';
import { getSidecarDataAccess, type SidecarDataAccess } from '@/data/sidecar-data.js';
import {
  getRawCardConditionCandidateLabels,
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
  PublishListingError,
  PublishListingValidationError,
  validatePublishListingReadiness,
} from '@/ebay/publish-validation.js';
import { validateRequiredItemSpecificsForCategory } from '@/ebay/required-item-specifics-validation.js';

type PublishInventoryApi = Pick<
  InventoryApi,
  'createOrReplaceInventoryItem' | 'createOffer' | 'publishOffer'
>;
type PublishMetadataApi = Pick<MetadataApi, 'getItemConditionPolicies'>;
type PublishTaxonomyApi = Pick<TaxonomyApi, 'getDefaultCategoryTreeId' | 'getItemAspectsForCategory'>;

type MetadataResponse = MetadataComponents['schemas']['ItemConditionPolicyResponse'];
type MetadataItemConditionPolicy = MetadataComponents['schemas']['ItemConditionPolicy'];
type MetadataItemCondition = MetadataComponents['schemas']['ItemCondition'];
type MetadataItemConditionDescriptor = MetadataComponents['schemas']['ItemConditionDescriptor'];

const publishLogger = createLogger('PublishListing');

export interface PublishListingDependencies {
  dataAccess: SidecarDataAccess;
  inventoryApi: PublishInventoryApi;
  metadataApi: PublishMetadataApi;
  taxonomyApi: PublishTaxonomyApi;
  now: () => Date;
}

export interface PublishListingResult {
  ebayListingId: string | null;
  exportedAt: string;
  listingId: string;
  offerId: string;
  reusedExistingOffer: boolean;
  sku: string;
  status: 'exported';
}

async function createDefaultDependencies(): Promise<PublishListingDependencies> {
  const api = new EbaySellerApi(getEbayConfig());
  await api.initialize();

  return {
    dataAccess: getSidecarDataAccess(),
    inventoryApi: api.inventory,
    metadataApi: api.metadata,
    taxonomyApi: api.taxonomy,
    now: () => new Date(),
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
      inventoryApi: dependencies.inventoryApi,
      metadataApi: dependencies.metadataApi,
      taxonomyApi: dependencies.taxonomyApi,
      now: dependencies.now ?? (() => new Date()),
    };
  }

  const defaults = await createDefaultDependencies();

  return {
    dataAccess: dependencies.dataAccess ?? defaults.dataAccess,
    inventoryApi: dependencies.inventoryApi ?? defaults.inventoryApi,
    metadataApi: dependencies.metadataApi ?? defaults.metadataApi,
    taxonomyApi: dependencies.taxonomyApi ?? defaults.taxonomyApi,
    now: dependencies.now ?? defaults.now,
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
  valueName: string | null | undefined
): boolean {
  const normalizedValueName = normalizeLookupText(valueName);

  return getRawCardConditionCandidateLabels(token).some(
    (candidate) => normalizeLookupText(candidate) === normalizedValueName
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
  appSettings: AppSettingsRow,
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
      appSettings.ebay_marketplace_id!.trim(),
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
    matchesRawCardConditionValue(savedToken, candidate.conditionDescriptorValueName)
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

async function loadPublishContext(
  listingId: string,
  dataAccess: SidecarDataAccess
): Promise<{
  appSettings: AppSettingsRow;
  listing: ListingRow;
}> {
  const [listing, appSettings] = await Promise.all([
    dataAccess.listings.getByListingId(listingId),
    dataAccess.appSettings.get(),
  ]);

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

  return {
    appSettings,
    listing,
  };
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

export async function publishListing(
  listingId: string,
  dependencies: Partial<PublishListingDependencies> = {}
): Promise<PublishListingResult> {
  const resolvedDependencies = await resolveDependencies(dependencies);
  const { appSettings, listing } = await loadPublishContext(listingId, resolvedDependencies.dataAccess);

  validatePublishListingReadiness(listing, appSettings);

  const sku = buildPublishSku(listing);
  const conditionDescriptors = await resolveTradingCardConditionDescriptors(
    listing,
    appSettings,
    resolvedDependencies.metadataApi
  );
  try {
    await validateRequiredItemSpecificsForCategory({
      listing,
      marketplaceId: appSettings.ebay_marketplace_id?.trim() ?? '',
      taxonomyApi: resolvedDependencies.taxonomyApi,
    });
  } catch (error) {
    if (error instanceof PublishListingValidationError) {
      throw error;
    }

    throw wrapPublishStageError(
      'INVENTORY_ITEM_UPSERT_FAILED',
      'metadata',
      listing.listing_id,
      `Failed to fetch required item-specific metadata for listing "${getListingLabel(listing)}" in category "${listing.category_id}".`,
      error
    );
  }
  const inventoryItemPayload = mapListingToInventoryItemPayload(listing, appSettings, {
    conditionDescriptors,
  });
  const offerPayload = mapListingToOfferPayload(listing, appSettings, sku);
  const reusedExistingOffer = typeof listing.ebay_offer_id === 'string' && listing.ebay_offer_id.length > 0;

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

  let offerId = listing.ebay_offer_id ?? null;

  if (!offerId) {
    try {
      const createOfferResponse = await resolvedDependencies.inventoryApi.createOffer(offerPayload);
      offerId = createOfferResponse.offerId ?? null;

      if (!offerId) {
        throw new Error('createOffer completed without offerId.');
      }

      await resolvedDependencies.dataAccess.listings.update(listingId, {
        ebay_offer_id: offerId,
        sku,
      });
    } catch (error) {
      throw wrapPublishStageError(
        'OFFER_CREATE_FAILED',
        'offer',
        listingId,
        `Failed to create offer for listing "${listingId}".`,
        error
      );
    }
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
