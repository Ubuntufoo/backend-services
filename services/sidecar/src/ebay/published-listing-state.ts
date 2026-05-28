import type { AppSettingsRow, ListingUpdate } from '@ebay-inventory/data';

export const PUBLISHED_LISTING_ATTEMPTED_FIELDS = [
  'ebay_offer_id',
  'ebay_listing_id',
  'ebay_listing_url',
  'exported_at',
  'sku',
  'status',
  'sub_status',
  'last_error_at',
  'last_error_code',
  'last_error_message',
  'last_error_context',
] as const;

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

export function buildEbayListingUrl(
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

export function buildPublishedListingUpdate(input: {
  appSettings: AppSettingsRow;
  ebayListingId: string | null | undefined;
  ebayOfferId: string;
  exportedAt: string;
  sku?: string;
}): ListingUpdate {
  const ebayListingId = getNonEmptyString(input.ebayListingId);
  const ebayListingUrl = buildEbayListingUrl(input.appSettings.ebay_marketplace_id, ebayListingId);
  const changes: ListingUpdate = {
    ebay_offer_id: input.ebayOfferId,
    exported_at: input.exportedAt,
    last_error_at: null,
    last_error_code: null,
    last_error_context: {},
    last_error_message: null,
    status: 'exported',
    sub_status: 'idle',
  };

  if (input.sku !== undefined) {
    changes.sku = input.sku;
  }

  if (ebayListingId) {
    changes.ebay_listing_id = ebayListingId;
  }

  if (ebayListingUrl) {
    changes.ebay_listing_url = ebayListingUrl;
  }

  return changes;
}
