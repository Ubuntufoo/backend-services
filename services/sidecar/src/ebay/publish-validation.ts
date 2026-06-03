import type { AppSettingsRow, Json, ListingRow } from '@ebay-inventory/data';
import type { EbayApiError } from '@/types/ebay.js';
import type { EbayEnvironment } from '@/ebay/config.js';
import { mapListingConditionIdToInventoryCondition } from '@/ebay/publish-mappers.js';
import { getPublishAppSettingIssues } from '@/ebay/publish-config.js';
import {
  GRADED_TRADING_CARD_CONDITION_ID,
  getSavedRawCardConditionToken,
  isRawCardConditionToken,
  isTradingCardCategoryId,
  RAW_TRADING_CARD_CONDITION_ID,
  TRADING_CARD_CONDITION_ASPECT_KEY,
} from '@/listings/trading-card-conditions.js';

export type PublishListingErrorCode =
  | 'APP_SETTINGS_NOT_FOUND'
  | 'EXPORT_STATE_PERSIST_FAILED'
  | 'INVENTORY_ITEM_UPSERT_FAILED'
  | 'LISTING_NOT_FOUND'
  | 'LISTING_NOT_READY'
  | 'OFFER_CREATE_FAILED'
  | 'OFFER_PUBLISH_FAILED';

export interface PublishListingErrorContext {
  attemptedFields?: string[];
  causeMessage?: string;
  ebayErrors?: EbayApiError['errors'];
  listingId?: string | null;
  offerId?: string;
  publishOfferListingId?: string | null;
  issues?: string[];
  stage?: 'finalize' | 'load' | 'validate' | 'metadata' | 'inventory_item' | 'offer' | 'publish';
}

export class PublishListingError extends Error {
  readonly code: PublishListingErrorCode;
  readonly context: PublishListingErrorContext;

  constructor(
    code: PublishListingErrorCode,
    message: string,
    context: PublishListingErrorContext = {},
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'PublishListingError';
    this.code = code;
    this.context = context;
  }
}

export class PublishListingValidationError extends PublishListingError {
  readonly issues: string[];

  constructor(listingId: string | null, issues: string[]) {
    super(
      'LISTING_NOT_READY',
      issues.join('; '),
      {
        issues,
        listingId,
        stage: 'validate',
      }
    );
    this.name = 'PublishListingValidationError';
    this.issues = issues;
  }
}

export { getPublishAppSettingIssues } from '@/ebay/publish-config.js';

function hasText(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value: ListingRow['item_specifics']): value is Record<string, Json> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getListingLabel(listing: Pick<ListingRow, 'listing_id'>): string {
  return hasText(listing.listing_id) ? listing.listing_id.trim() : '[missing listing_id]';
}

function getImageUrlIssues(listing: ListingRow): string[] {
  const listingLabel = getListingLabel(listing);
  const imageUrls = listing.image_urls;

  if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
    return [`Listing "${listingLabel}" must include at least one image URL for publish.`];
  }

  const nonEmptyImageUrlCount = imageUrls.filter((imageUrl) => hasText(imageUrl)).length;
  const issues: string[] = [];

  if (nonEmptyImageUrlCount === 0) {
    issues.push(`Listing "${listingLabel}" must include at least one image URL for publish.`);
  }

  if (imageUrls.some((imageUrl) => !hasText(imageUrl))) {
    issues.push(`Listing "${listingLabel}" contains blank image_urls entries.`);
  }

  return issues;
}

export function validatePublishListingReadiness(
  listing: ListingRow,
  appSettings: AppSettingsRow,
  options: {
    environment?: EbayEnvironment;
    runtimeMarketplaceId?: string | null;
  } = {}
): void {
  const listingLabel = getListingLabel(listing);
  const issues: string[] = [];

  if (listing.status !== 'approved_for_export') {
    issues.push(
      `Listing "${listingLabel}" must be in status "approved_for_export" before publish. Current status: "${listing.status}".`
    );
  }

  if (!hasText(listing.listing_id)) {
    issues.push('Listing is missing listing_id required for publish SKU.');
  }

  if (!hasText(listing.title)) {
    issues.push(`Listing "${listingLabel}" is missing title.`);
  } else {
    const normalizedTitle = listing.title.trim();

    if (normalizedTitle.length > 80) {
      issues.push(
        `Listing "${listingLabel}" title must be 80 characters or fewer for eBay publish. Current length: ${normalizedTitle.length}.`
      );
    }
  }

  if (!hasText(listing.category_id)) {
    issues.push(`Listing "${listingLabel}" is missing category_id.`);
  }

  if (!hasText(listing.condition_id)) {
    issues.push(`Listing "${listingLabel}" is missing condition_id.`);
  } else {
    try {
      mapListingConditionIdToInventoryCondition(listing.condition_id);
    } catch {
      issues.push(
        `Listing "${listingLabel}" has unsupported condition_id "${listing.condition_id.trim()}" for Inventory API mapping.`
      );
    }
  }

  if (isTradingCardCategoryId(listing.category_id)) {
    const normalizedConditionId = listing.condition_id?.trim();

    if (normalizedConditionId === GRADED_TRADING_CARD_CONDITION_ID) {
      issues.push(
        `Listing "${listingLabel}" uses graded trading-card condition_id "${GRADED_TRADING_CARD_CONDITION_ID}", but graded condition descriptors are not supported yet.`
      );
    }

    if (normalizedConditionId === RAW_TRADING_CARD_CONDITION_ID) {
      const savedToken = getSavedRawCardConditionToken(listing.item_specifics);

      if (!savedToken) {
        const savedValue =
          isRecord(listing.item_specifics) &&
          typeof listing.item_specifics[TRADING_CARD_CONDITION_ASPECT_KEY] === 'string'
            ? listing.item_specifics[TRADING_CARD_CONDITION_ASPECT_KEY]
            : null;

        if (!savedValue) {
          issues.push(
            `Listing "${listingLabel}" is missing item_specifics["${TRADING_CARD_CONDITION_ASPECT_KEY}"] for trading-card publish.`
          );
        } else if (!isRawCardConditionToken(savedValue)) {
          issues.push(
            `Listing "${listingLabel}" has unsupported item_specifics["${TRADING_CARD_CONDITION_ASPECT_KEY}"] value "${savedValue}" for trading-card publish.`
          );
        }
      }
    }
  }

  issues.push(...getImageUrlIssues(listing));

  if (listing.price === null || !Number.isFinite(listing.price) || listing.price <= 0) {
    issues.push(`Listing "${listingLabel}" is missing a valid price.`);
  }

  issues.push(
    ...getPublishAppSettingIssues(appSettings, {
      environment: options.environment,
      runtimeMarketplaceId: options.runtimeMarketplaceId,
    })
  );

  if (issues.length > 0) {
    throw new PublishListingValidationError(listing.listing_id, issues);
  }
}
