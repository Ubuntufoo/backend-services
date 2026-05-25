import type { AppSettingsRow, ListingRow, ListingUpdate } from '@ebay-inventory/data';
import { EbaySellerApi } from '@/api/index.js';
import type { InventoryApi } from '@/api/listing-management/inventory.js';
import { getEbayConfig } from '@/config/environment.js';
import { getSidecarDataAccess, type SidecarDataAccess } from '@/data/sidecar-data.js';
import {
  buildPublishSku,
  mapListingToInventoryItemPayload,
  mapListingToOfferPayload,
} from '@/ebay/publish-mappers.js';
import {
  PublishListingError,
  validatePublishListingReadiness,
} from '@/ebay/publish-validation.js';

type PublishInventoryApi = Pick<
  InventoryApi,
  'createOrReplaceInventoryItem' | 'createOffer' | 'publishOffer'
>;

export interface PublishListingDependencies {
  dataAccess: SidecarDataAccess;
  inventoryApi: PublishInventoryApi;
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

function getNonEmptyString(value: string | null | undefined): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function getMarketplaceListingBaseUrl(
  marketplaceId: AppSettingsRow['ebay_marketplace_id']
): string | undefined {
  switch (marketplaceId) {
    case 'EBAY_AT':
      return 'https://www.ebay.at';
    case 'EBAY_AU':
      return 'https://www.ebay.com.au';
    case 'EBAY_BE':
      return 'https://www.ebay.be';
    case 'EBAY_CA':
      return 'https://www.ebay.ca';
    case 'EBAY_CH':
      return 'https://www.ebay.ch';
    case 'EBAY_DE':
      return 'https://www.ebay.de';
    case 'EBAY_ES':
      return 'https://www.ebay.es';
    case 'EBAY_FR':
      return 'https://www.ebay.fr';
    case 'EBAY_GB':
      return 'https://www.ebay.co.uk';
    case 'EBAY_HK':
      return 'https://www.ebay.com.hk';
    case 'EBAY_IE':
      return 'https://www.ebay.ie';
    case 'EBAY_IT':
      return 'https://www.ebay.it';
    case 'EBAY_MY':
      return 'https://www.ebay.com.my';
    case 'EBAY_NL':
      return 'https://www.ebay.nl';
    case 'EBAY_PH':
      return 'https://www.ebay.ph';
    case 'EBAY_PL':
      return 'https://www.ebay.pl';
    case 'EBAY_SG':
      return 'https://www.ebay.com.sg';
    case 'EBAY_TW':
      return 'https://www.ebay.com.tw';
    case 'EBAY_US':
      return 'https://www.ebay.com';
    case 'EBAY_VN':
      return 'https://www.ebay.vn';
    default:
      return undefined;
  }
}

function buildEbayListingUrl(
  marketplaceId: AppSettingsRow['ebay_marketplace_id'],
  listingId: string | null | undefined
): string | undefined {
  const normalizedListingId = getNonEmptyString(listingId);
  const baseUrl = getMarketplaceListingBaseUrl(marketplaceId);

  if (!baseUrl || !normalizedListingId) {
    return undefined;
  }

  return `${baseUrl}/itm/${normalizedListingId}`;
}

function buildPublishedListingUpdate(input: {
  appSettings: AppSettingsRow;
  ebayListingId: string | null | undefined;
  ebayOfferId: string;
  exportedAt: string;
  sku: string;
}): ListingUpdate {
  const ebayListingId = getNonEmptyString(input.ebayListingId);
  const ebayListingUrl = buildEbayListingUrl(input.appSettings.ebay_marketplace_id, ebayListingId);
  const changes: ListingUpdate = {
    ebay_offer_id: input.ebayOfferId,
    exported_at: input.exportedAt,
    sku: input.sku,
    status: 'exported',
    sub_status: 'idle',
  };

  if (ebayListingId) {
    changes.ebay_listing_id = ebayListingId;
  }

  if (ebayListingUrl) {
    changes.ebay_listing_url = ebayListingUrl;
  }

  return changes;
}

async function createDefaultDependencies(): Promise<PublishListingDependencies> {
  const api = new EbaySellerApi(getEbayConfig());
  await api.initialize();

  return {
    dataAccess: getSidecarDataAccess(),
    inventoryApi: api.inventory,
    now: () => new Date(),
  };
}

async function resolveDependencies(
  dependencies: Partial<PublishListingDependencies>
): Promise<PublishListingDependencies> {
  if (dependencies.dataAccess && dependencies.inventoryApi) {
    return {
      dataAccess: dependencies.dataAccess,
      inventoryApi: dependencies.inventoryApi,
      now: dependencies.now ?? (() => new Date()),
    };
  }

  const defaults = await createDefaultDependencies();

  return {
    dataAccess: dependencies.dataAccess ?? defaults.dataAccess,
    inventoryApi: dependencies.inventoryApi ?? defaults.inventoryApi,
    now: dependencies.now ?? defaults.now,
  };
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

async function markPublishQueued(
  listingId: string,
  dataAccess: SidecarDataAccess
): Promise<void> {
  await dataAccess.listings.update(listingId, {
    status: 'approved_for_export',
    sub_status: 'publish_queued',
  });
}

function wrapPublishStageError(
  code: PublishListingError['code'],
  stage: NonNullable<PublishListingError['context']['stage']>,
  listingId: string,
  message: string,
  error: unknown
): PublishListingError {
  return new PublishListingError(code, message, { listingId, stage }, { cause: error });
}

export async function publishListing(
  listingId: string,
  dependencies: Partial<PublishListingDependencies> = {}
): Promise<PublishListingResult> {
  const resolvedDependencies = await resolveDependencies(dependencies);
  const { appSettings, listing } = await loadPublishContext(listingId, resolvedDependencies.dataAccess);

  validatePublishListingReadiness(listing, appSettings);

  await resolvedDependencies.dataAccess.listings.updateWorkflowState({
    listingId,
    status: 'approved_for_export',
    subStatus: 'publishing_to_ebay',
  });

  const sku = buildPublishSku(listing);
  const inventoryItemPayload = mapListingToInventoryItemPayload(listing, appSettings);
  const offerPayload = mapListingToOfferPayload(listing, appSettings, sku);
  const reusedExistingOffer = typeof listing.ebay_offer_id === 'string' && listing.ebay_offer_id.length > 0;

  try {
    await resolvedDependencies.inventoryApi.createOrReplaceInventoryItem(sku, inventoryItemPayload);
    await resolvedDependencies.dataAccess.listings.update(listingId, {
      sku,
    });
  } catch (error) {
    await markPublishQueued(listingId, resolvedDependencies.dataAccess);
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
      await markPublishQueued(listingId, resolvedDependencies.dataAccess);
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

    return {
      ebayListingId: publishOfferResponse.listingId ?? null,
      exportedAt,
      listingId,
      offerId,
      reusedExistingOffer,
      sku,
      status: 'exported',
    };
  } catch (error) {
    await markPublishQueued(listingId, resolvedDependencies.dataAccess);
    throw wrapPublishStageError(
      'OFFER_PUBLISH_FAILED',
      'publish',
      listingId,
      `Failed to publish offer for listing "${listingId}".`,
      error
    );
  }
}
