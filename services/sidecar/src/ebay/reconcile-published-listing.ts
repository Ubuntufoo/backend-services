import type { AppSettingsRow, ListingRow } from '@ebay-inventory/data';
import { EbaySellerApi } from '@/api/index.js';
import type { InventoryApi } from '@/api/listing-management/inventory.js';
import { getEbayConfig } from '@/config/environment.js';
import { getSidecarDataAccess, type SidecarDataAccess } from '@/data/sidecar-data.js';
import { buildOfferDiagnostic, type OfferDiagnostic } from '@/ebay/offer-diagnostic.js';
import { buildPublishedListingUpdate } from '@/ebay/published-listing-state.js';

type ReconcileInventoryApi = Pick<InventoryApi, 'getOffer'>;

export interface ReconcilePublishedListingDependencies {
  dataAccess: SidecarDataAccess;
  inventoryApi: ReconcileInventoryApi;
  now: () => Date;
}

export interface ReconcilePublishedListingInput {
  listingId?: string;
  offerId?: string;
}

export interface ReconcilePublishedListingResult {
  ebayListingId: string | null;
  exportedAt: string | null;
  listing: ListingRow;
  offer: OfferDiagnostic;
  offerId: string;
  reason?: string;
  reconciled: boolean;
}

async function createDefaultDependencies(): Promise<ReconcilePublishedListingDependencies> {
  const api = new EbaySellerApi(getEbayConfig());
  await api.initialize();

  return {
    dataAccess: getSidecarDataAccess(),
    inventoryApi: api.inventory,
    now: () => new Date(),
  };
}

async function resolveDependencies(
  dependencies: Partial<ReconcilePublishedListingDependencies>
): Promise<ReconcilePublishedListingDependencies> {
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

function getOfferIdFromListing(listing: ListingRow): string {
  if (typeof listing.ebay_offer_id === 'string' && listing.ebay_offer_id.length > 0) {
    return listing.ebay_offer_id;
  }

  throw new Error(`Listing "${listing.listing_id}" does not have an ebay_offer_id to reconcile.`);
}

function validateInput(input: ReconcilePublishedListingInput): void {
  const hasListingId = typeof input.listingId === 'string' && input.listingId.length > 0;
  const hasOfferId = typeof input.offerId === 'string' && input.offerId.length > 0;

  if (hasListingId === hasOfferId) {
    throw new Error('Provide exactly one of --listing-id or --offer-id.');
  }
}

async function loadListingForReconcile(
  input: ReconcilePublishedListingInput,
  dataAccess: SidecarDataAccess
): Promise<ListingRow> {
  if (input.listingId) {
    const listing = await dataAccess.listings.getByListingId(input.listingId);

    if (!listing) {
      throw new Error(`Listing "${input.listingId}" was not found.`);
    }

    return listing;
  }

  const listing = await dataAccess.listings.getByOfferId(input.offerId!);

  if (!listing) {
    throw new Error(`No local listing found for offer "${input.offerId}".`);
  }

  return listing;
}

async function loadAppSettings(dataAccess: SidecarDataAccess): Promise<AppSettingsRow> {
  const appSettings = await dataAccess.appSettings.get();

  if (!appSettings) {
    throw new Error('App settings "default" were not found.');
  }

  return appSettings;
}

export async function reconcilePublishedListing(
  input: ReconcilePublishedListingInput,
  dependencies: Partial<ReconcilePublishedListingDependencies> = {}
): Promise<ReconcilePublishedListingResult> {
  validateInput(input);

  const resolvedDependencies = await resolveDependencies(dependencies);
  const [listing, appSettings] = await Promise.all([
    loadListingForReconcile(input, resolvedDependencies.dataAccess),
    loadAppSettings(resolvedDependencies.dataAccess),
  ]);
  const offerId = input.offerId ?? getOfferIdFromListing(listing);
  const offer = buildOfferDiagnostic(await resolvedDependencies.inventoryApi.getOffer(offerId));
  const ebayListingId = offer.listingId ?? null;

  if (!ebayListingId) {
    return {
      ebayListingId: null,
      exportedAt: null,
      listing,
      offer,
      offerId,
      reason: `Offer "${offerId}" is published externally but did not expose listingId.`,
      reconciled: false,
    };
  }

  const exportedAt = resolvedDependencies.now().toISOString();
  const updatedListing = await resolvedDependencies.dataAccess.listings.update(
    listing.listing_id,
    buildPublishedListingUpdate({
      appSettings,
      ebayListingId,
      ebayOfferId: listing.ebay_offer_id ?? offerId,
      exportedAt,
    })
  );

  return {
    ebayListingId,
    exportedAt,
    listing: updatedListing,
    offer,
    offerId,
    reconciled: true,
  };
}
