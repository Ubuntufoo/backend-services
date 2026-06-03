import type { AppSettingsRow, Json, ListingRow } from '@ebay-inventory/data';
import { Condition } from '@/types/ebay-enums.js';
import type { ResolvedPublishConfig } from '@/ebay/publish-config.js';
import type { components } from '@/types/sell-apps/listing-management/sellInventoryV1Oas3.js';
import {
  getRawCardConditionDisplayLabel,
  normalizeRawCardConditionToken,
  isTradingCardCategoryId,
  TRADING_CARD_CONDITION_ASPECT_KEY,
} from '@/listings/trading-card-conditions.js';

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

const INVENTORY_CONDITION_BY_LISTING_CONDITION_ID: Record<string, Condition> = {
  '2750': Condition.LIKE_NEW,
  '4000': Condition.USED_VERY_GOOD,
};
const INTERNAL_ITEM_SPECIFIC_KEYS = new Set(['CategorySuggestion', 'ConditionSuggestion']);

export interface InventoryItemPayloadOptions {
  conditionDescriptors?: InventoryItem['conditionDescriptors'];
}

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
  itemSpecifics: ListingRow['item_specifics'],
  ignoredKeys: ReadonlySet<string>
): Record<string, string[]> | undefined {
  if (!itemSpecifics || typeof itemSpecifics !== 'object' || Array.isArray(itemSpecifics)) {
    return undefined;
  }

  const aspects: Record<string, string[]> = {};

  for (const [key, value] of Object.entries(itemSpecifics)) {
    if (ignoredKeys.has(key)) {
      continue;
    }

    const normalizedValue =
      key === TRADING_CARD_CONDITION_ASPECT_KEY
        ? (() => {
            const token = normalizeRawCardConditionToken(value);
            return token ? getRawCardConditionDisplayLabel(token) : value;
          })()
        : value;
    const normalized = normalizeAspectValue(normalizedValue as Json);

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
  const sku = listing.sku?.trim();

  return sku && sku.length > 0 ? sku : listing.listing_id;
}

export function getMarketplaceCurrency(marketplaceId: string): string {
  return MARKETPLACE_CURRENCY_MAP[marketplaceId] ?? 'USD';
}

export function mapListingConditionIdToInventoryCondition(
  conditionId: string | number | null | undefined
): Condition {
  const normalizedConditionId =
    typeof conditionId === 'number'
      ? String(conditionId)
      : typeof conditionId === 'string'
        ? conditionId.trim()
        : '';
  const inventoryCondition = INVENTORY_CONDITION_BY_LISTING_CONDITION_ID[normalizedConditionId];

  if (!inventoryCondition) {
    throw new Error(`Unsupported listing condition_id "${normalizedConditionId}".`);
  }

  return inventoryCondition;
}

export function mapListingToInventoryItemPayload(
  listing: ListingRow,
  appSettings: AppSettingsRow,
  options: InventoryItemPayloadOptions = {}
): InventoryItem {
  const ignoredKeys = new Set(INTERNAL_ITEM_SPECIFIC_KEYS);

  if (options.conditionDescriptors && isTradingCardCategoryId(listing.category_id)) {
    ignoredKeys.add(TRADING_CARD_CONDITION_ASPECT_KEY);
  }

  const aspects = normalizeItemSpecifics(listing.item_specifics, ignoredKeys);

  return {
    availability: {
      shipToLocationAvailability: {
        quantity: 1,
      },
    },
    condition: mapListingConditionIdToInventoryCondition(listing.condition_id ?? undefined),
    conditionDescription: listing.condition_notes ?? undefined,
    conditionDescriptors: options.conditionDescriptors,
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
  publishConfig: ResolvedPublishConfig,
  sku: string
): EbayOfferDetailsWithKeys {
  const marketplaceId = publishConfig.marketplaceId;

  return {
    availableQuantity: 1,
    categoryId: listing.category_id ?? undefined,
    format: 'FIXED_PRICE',
    listingDescription: listing.description ?? undefined,
    listingPolicies: {
      fulfillmentPolicyId: publishConfig.fulfillmentPolicyId,
      paymentPolicyId: publishConfig.paymentPolicyId,
      returnPolicyId: publishConfig.returnPolicyId,
    },
    marketplaceId,
    merchantLocationKey: publishConfig.merchantLocationKey,
    pricingSummary: {
      price: {
        currency: getMarketplaceCurrency(marketplaceId),
        value: listing.price!.toFixed(2),
      },
    },
    sku,
  };
}
