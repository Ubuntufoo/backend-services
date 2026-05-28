import type { AppSettingsRow, ListingRow } from '@ebay-inventory/data';
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
  buildPublishedListingUpdate,
  PUBLISHED_LISTING_ATTEMPTED_FIELDS,
} from '@/ebay/published-listing-state.js';
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

function getCauseMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
