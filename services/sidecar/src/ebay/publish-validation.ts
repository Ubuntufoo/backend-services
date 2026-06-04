import type { AppSettingsRow, Json, ListingRow } from '@ebay-inventory/data';
import type { EbayApiError } from '@/types/ebay.js';
import type { EbayEnvironment } from '@/ebay/config.js';
import type { ResolvedPublishConfig } from '@/ebay/publish-config.js';
import type { PublishImageUrlReadinessIssue } from '@/ebay/image-url-readiness.js';
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
  fields?: PublishValidationFieldIssue[];
  kind?: 'user_fixable';
  listingId?: string | null;
  offerId?: string;
  publishOfferListingId?: string | null;
  issues?: string[];
  stage?: 'finalize' | 'load' | 'validate' | 'metadata' | 'inventory_item' | 'offer' | 'publish';
  validationCode?:
    | 'CATEGORY_REQUIRED_ITEM_SPECIFICS_MISSING'
    | 'IMAGE_URL_NOT_READY_FOR_EBAY'
    | 'PUBLISH_REQUIRED_FIELD_MISSING';
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

export type PublishRequiredField =
  | 'title'
  | 'description'
  | 'price'
  | 'categoryId'
  | 'conditionId'
  | 'imageUrls'
  | 'sku'
  | 'quantity'
  | 'marketplaceId'
  | 'paymentPolicyId'
  | 'fulfillmentPolicyId'
  | 'returnPolicyId'
  | 'merchantLocationKey';

export interface PublishRequiredFieldIssue {
  field: PublishRequiredField;
  message: string;
  scope: 'listing' | 'publish_config';
}

export interface PublishRequiredItemSpecificIssue {
  acceptedKeys: string[];
  aspectName: string;
  field: `item_specifics.${string}`;
  message: string;
  scope: 'listing';
}

export type PublishValidationFieldIssue =
  | PublishImageUrlReadinessIssue
  | PublishRequiredFieldIssue
  | PublishRequiredItemSpecificIssue;

export interface PublishReadyValidationSuccess {
  ok: true;
}

export interface PublishReadyValidationFailure {
  code: 'PUBLISH_REQUIRED_FIELD_MISSING';
  fields: PublishRequiredFieldIssue[];
  kind: 'user_fixable';
  ok: false;
}

export type PublishReadyValidationResult =
  | PublishReadyValidationSuccess
  | PublishReadyValidationFailure;

export interface ValidatePublishReadyInput {
  listing: ListingRow;
  publishConfig: Partial<ResolvedPublishConfig> | null | undefined;
  quantity?: number | null;
}

export class PublishRequiredFieldValidationError extends PublishListingError {
  readonly fields: PublishRequiredFieldIssue[];
  readonly kind = 'user_fixable' as const;
  readonly validationCode = 'PUBLISH_REQUIRED_FIELD_MISSING' as const;

  constructor(listingId: string | null, fields: PublishRequiredFieldIssue[]) {
    super(
      'LISTING_NOT_READY',
      fields.map((field) => field.message).join('; '),
      {
        fields,
        issues: fields.map((field) => field.message),
        kind: 'user_fixable',
        listingId,
        stage: 'validate',
        validationCode: 'PUBLISH_REQUIRED_FIELD_MISSING',
      }
    );
    this.name = 'PublishRequiredFieldValidationError';
    this.fields = fields;
  }
}

export class PublishRequiredItemSpecificsValidationError extends PublishListingError {
  readonly fields: PublishRequiredItemSpecificIssue[];
  readonly kind = 'user_fixable' as const;
  readonly validationCode = 'CATEGORY_REQUIRED_ITEM_SPECIFICS_MISSING' as const;

  constructor(listingId: string | null, fields: PublishRequiredItemSpecificIssue[]) {
    super(
      'LISTING_NOT_READY',
      fields.map((field) => field.message).join('; '),
      {
        fields,
        issues: fields.map((field) => field.message),
        kind: 'user_fixable',
        listingId,
        stage: 'validate',
        validationCode: 'CATEGORY_REQUIRED_ITEM_SPECIFICS_MISSING',
      }
    );
    this.name = 'PublishRequiredItemSpecificsValidationError';
    this.fields = fields;
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

function isValidHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function createFieldIssue(
  field: PublishRequiredField,
  scope: PublishRequiredFieldIssue['scope'],
  message: string
): PublishRequiredFieldIssue {
  return {
    field,
    message,
    scope,
  };
}

function hasPositiveNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function validatePublishReady({
  listing,
  publishConfig,
  quantity,
}: ValidatePublishReadyInput): PublishReadyValidationResult {
  const fields: PublishRequiredFieldIssue[] = [];

  if (!hasText(listing.title)) {
    fields.push(
      createFieldIssue('title', 'listing', 'Title is required before publishing.')
    );
  }

  if (!hasText(listing.description)) {
    fields.push(
      createFieldIssue('description', 'listing', 'Description is required before publishing.')
    );
  }

  if (!hasPositiveNumber(listing.price)) {
    fields.push(
      createFieldIssue('price', 'listing', 'Price must be greater than 0 before publishing.')
    );
  }

  if (!hasText(listing.category_id)) {
    fields.push(
      createFieldIssue('categoryId', 'listing', 'Category ID is required before publishing.')
    );
  }

  if (!hasText(listing.condition_id)) {
    fields.push(
      createFieldIssue('conditionId', 'listing', 'Condition ID is required before publishing.')
    );
  }

  if (!hasText(listing.sku)) {
    fields.push(
      createFieldIssue('sku', 'listing', 'SKU or custom label is required before publishing.')
    );
  }

  if (!hasPositiveNumber(quantity)) {
    fields.push(
      createFieldIssue('quantity', 'listing', 'Quantity must be greater than 0 before publishing.')
    );
  }

  if (!Array.isArray(listing.image_urls) || listing.image_urls.length === 0) {
    fields.push(
      createFieldIssue('imageUrls', 'listing', 'At least one image URL is required before publishing.')
    );
  } else {
    const validImageUrlCount = listing.image_urls.filter(
      (imageUrl) => hasText(imageUrl) && isValidHttpUrl(imageUrl.trim())
    ).length;

    if (validImageUrlCount === 0) {
      fields.push(
        createFieldIssue(
          'imageUrls',
          'listing',
          'At least one valid HTTP/HTTPS image URL is required before publishing.'
        )
      );
    } else if (listing.image_urls.some((imageUrl) => !hasText(imageUrl) || !isValidHttpUrl(imageUrl.trim()))) {
      fields.push(
        createFieldIssue(
          'imageUrls',
          'listing',
          'Image URLs must be non-empty HTTP/HTTPS URLs before publishing.'
        )
      );
    }
  }

  if (!hasText(publishConfig?.marketplaceId)) {
    fields.push(
      createFieldIssue(
        'marketplaceId',
        'publish_config',
        'Marketplace ID is required before publishing.'
      )
    );
  }

  if (!hasText(publishConfig?.paymentPolicyId)) {
    fields.push(
      createFieldIssue(
        'paymentPolicyId',
        'publish_config',
        'Payment policy ID is required before publishing.'
      )
    );
  }

  if (!hasText(publishConfig?.fulfillmentPolicyId)) {
    fields.push(
      createFieldIssue(
        'fulfillmentPolicyId',
        'publish_config',
        'Fulfillment policy ID is required before publishing.'
      )
    );
  }

  if (!hasText(publishConfig?.returnPolicyId)) {
    fields.push(
      createFieldIssue(
        'returnPolicyId',
        'publish_config',
        'Return policy ID is required before publishing.'
      )
    );
  }

  if (!hasText(publishConfig?.merchantLocationKey)) {
    fields.push(
      createFieldIssue(
        'merchantLocationKey',
        'publish_config',
        'Merchant location key is required before publishing.'
      )
    );
  }

  if (fields.length === 0) {
    return { ok: true };
  }

  return {
    code: 'PUBLISH_REQUIRED_FIELD_MISSING',
    fields,
    kind: 'user_fixable',
    ok: false,
  };
}

export function assertPublishReady(input: ValidatePublishReadyInput): void {
  const result = validatePublishReady(input);

  if (!result.ok) {
    throw new PublishRequiredFieldValidationError(input.listing.listing_id, result.fields);
  }
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
