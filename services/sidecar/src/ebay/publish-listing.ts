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

    await resolvedDependencies.dataAccess.listings.update(listingId, {
      ebay_listing_id: publishOfferResponse.listingId ?? null,
      ebay_offer_id: offerId,
      exported_at: exportedAt,
      sku,
      status: 'exported',
      sub_status: 'idle',
    });

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
