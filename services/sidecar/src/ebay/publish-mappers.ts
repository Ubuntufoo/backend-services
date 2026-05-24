import type { AppSettingsRow, Json, ListingRow } from '@ebay-inventory/data';
import type { components } from '@/types/sell-apps/listing-management/sellInventoryV1Oas3.js';

type InventoryItem = components['schemas']['InventoryItem'];
type EbayOfferDetailsWithKeys = components['schemas']['EbayOfferDetailsWithKeys'];

const MARKETPLACE_CURRENCY_MAP: Record<string, string> = {
  EBAY_AU: 'AUD',
  EBAY_CA: 'CAD',
  EBAY_DE: 'EUR',
  EBAY_ES: 'EUR',
  EBAY_FR: 'EUR',
  EBAY_GB: 'GBP',
  EBAY_IT: 'EUR',
  EBAY_US: 'USD',
};

function normalizeAspectValue(value: Json): string[] | null {
  if (typeof value === 'string' && value.trim().length > 0) {
    return [value];
  }

  if (Array.isArray(value)) {
    const values = value.filter(
      (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0
    );

    return values.length > 0 ? values : null;
  }

  return null;
}

function normalizeItemSpecifics(
  itemSpecifics: ListingRow['item_specifics']
): Record<string, string[]> | undefined {
  if (!itemSpecifics || typeof itemSpecifics !== 'object' || Array.isArray(itemSpecifics)) {
    return undefined;
  }

  const aspects: Record<string, string[]> = {};

  for (const [key, value] of Object.entries(itemSpecifics)) {
    const normalized = normalizeAspectValue(value as Json);

    if (normalized && key.trim().length > 0) {
      aspects[key] = normalized;
    }
  }

  return Object.keys(aspects).length > 0 ? aspects : undefined;
}

function buildPackageWeightAndSize(
  listing: ListingRow,
  appSettings: AppSettingsRow
): InventoryItem['packageWeightAndSize'] | undefined {
  const packageType = listing.package_type ?? appSettings.default_package_type;
  const estimatedWeightOz = listing.estimated_weight_oz;

  if (!packageType && estimatedWeightOz === null) {
    return undefined;
  }

  return {
    packageType: packageType ?? undefined,
    weight:
      estimatedWeightOz === null
        ? undefined
        : {
            unit: 'OUNCE',
            value: estimatedWeightOz,
          },
  };
}

export function buildPublishSku(listing: Pick<ListingRow, 'listing_id' | 'sku'>): string {
  return listing.sku?.trim() ?? listing.listing_id;
}

export function getMarketplaceCurrency(marketplaceId: string): string {
  return MARKETPLACE_CURRENCY_MAP[marketplaceId] ?? 'USD';
}

export function mapListingToInventoryItemPayload(
  listing: ListingRow,
  appSettings: AppSettingsRow
): InventoryItem {
  const aspects = normalizeItemSpecifics(listing.item_specifics);

  return {
    availability: {
      shipToLocationAvailability: {
        quantity: 1,
      },
    },
    condition: listing.condition_id ?? undefined,
    conditionDescription: listing.condition_notes ?? undefined,
    packageWeightAndSize: buildPackageWeightAndSize(listing, appSettings),
    product: {
      aspects: aspects as unknown as components['schemas']['Product']['aspects'],
      description: listing.description ?? undefined,
      imageUrls: listing.image_urls,
      title: listing.title ?? undefined,
    },
  };
}

export function mapListingToOfferPayload(
  listing: ListingRow,
  appSettings: AppSettingsRow,
  sku: string
): EbayOfferDetailsWithKeys {
  const marketplaceId = appSettings.ebay_marketplace_id ?? 'EBAY_US';

  return {
    availableQuantity: 1,
    categoryId: listing.category_id ?? undefined,
    format: 'FIXED_PRICE',
    listingDescription: listing.description ?? undefined,
    listingPolicies: {
      fulfillmentPolicyId: appSettings.default_fulfillment_policy_id ?? undefined,
      paymentPolicyId: appSettings.default_payment_policy_id ?? undefined,
      returnPolicyId: appSettings.default_return_policy_id ?? undefined,
    },
    marketplaceId,
    merchantLocationKey: appSettings.merchant_location_key ?? undefined,
    pricingSummary: {
      price: {
        currency: getMarketplaceCurrency(marketplaceId),
        value: listing.price!.toFixed(2),
      },
    },
    sku,
  };
}
