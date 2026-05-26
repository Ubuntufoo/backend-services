import type { AppSettingsRow, ListingRow } from '@ebay-inventory/data';

export type PublishListingErrorCode =
  | 'APP_SETTINGS_NOT_FOUND'
  | 'EXPORT_STATE_PERSIST_FAILED'
  | 'INVENTORY_ITEM_UPSERT_FAILED'
  | 'LISTING_NOT_FOUND'
  | 'LISTING_NOT_READY'
  | 'OFFER_CREATE_FAILED'
  | 'OFFER_PUBLISH_FAILED';

export interface PublishListingErrorContext {
  listingId?: string;
  issues?: string[];
  stage?: 'finalize' | 'load' | 'validate' | 'inventory_item' | 'offer' | 'publish';
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

  constructor(listingId: string, issues: string[]) {
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

function hasText(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
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

function getMissingAppSettingIssues(appSettings: AppSettingsRow): string[] {
  const issues: string[] = [];

  if (!hasText(appSettings.default_payment_policy_id)) {
    issues.push('app_settings.default_payment_policy_id is required for publish.');
  }

  if (!hasText(appSettings.default_fulfillment_policy_id)) {
    issues.push('app_settings.default_fulfillment_policy_id is required for publish.');
  }

  if (!hasText(appSettings.default_return_policy_id)) {
    issues.push('app_settings.default_return_policy_id is required for publish.');
  }

  if (!hasText(appSettings.merchant_location_key)) {
    issues.push('app_settings.merchant_location_key is required for publish.');
  }

  return issues;
}

export function validatePublishListingReadiness(
  listing: ListingRow,
  appSettings: AppSettingsRow
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
  }

  if (!hasText(listing.category_id)) {
    issues.push(`Listing "${listingLabel}" is missing category_id.`);
  }

  if (!hasText(listing.condition_id)) {
    issues.push(`Listing "${listingLabel}" is missing condition_id.`);
  }

  issues.push(...getImageUrlIssues(listing));

  if (listing.price === null || !Number.isFinite(listing.price) || listing.price <= 0) {
    issues.push(`Listing "${listingLabel}" is missing a valid price.`);
  }

  issues.push(...getMissingAppSettingIssues(appSettings));

  if (issues.length > 0) {
    throw new PublishListingValidationError(listingLabel, issues);
  }
}
