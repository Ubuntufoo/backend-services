import type { ListingRow } from '@ebay-inventory/data';

import { readPricingModifierOptions } from '@/listings/pricing-modifier-options.js';
import {
  GRADED_TRADING_CARD_CONDITION_ID,
  RAW_TRADING_CARD_CONDITION_ID,
  TRADING_CARD_CONDITION_ASPECT_KEY,
  getSavedRawCardConditionToken,
  isTradingCardCategoryId,
} from '@/listings/trading-card-conditions.js';

import type { NormalizeSoldCompsContext } from './types.js';
import type { PricingProviderInput } from './types.js';
import { readAuthorizedGeneratedDraftYearMetadata } from './generated-draft-metadata.js';
import {
  sanitizeSetAspectValue,
  sanitizeTitleYearClaims,
} from '@/gemini/year-normalization.js';

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getSpecificStringValue(
  itemSpecifics: PricingProviderInput['itemSpecifics'],
  key: string
): string | undefined {
  if (!itemSpecifics) {
    return undefined;
  }

  const value = itemSpecifics[key];
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (Array.isArray(value)) {
    const first = value.find((entry) => typeof entry === 'string' && entry.trim().length > 0);
    return typeof first === 'string' ? first.trim() : undefined;
  }

  return undefined;
}

function getSpecificDisplayValue(
  itemSpecifics: PricingProviderInput['itemSpecifics'],
  key: string
): string | undefined {
  const value = getSpecificStringValue(itemSpecifics, key);
  return key === 'Card Number' && value ? `#${value.replace(/^#+/, '')}` : value;
}

function sanitizePricingItemSpecifics(
  itemSpecifics: PricingProviderInput['itemSpecifics'],
  allowedYear?: string | null
): PricingProviderInput['itemSpecifics'] {
  if (!itemSpecifics) {
    return undefined;
  }

  const sanitized: Record<string, string | string[]> = {};

  for (const [key, value] of Object.entries(itemSpecifics)) {
    if (key === 'Season') {
      continue;
    }

    if (key === 'Year') {
      if (allowedYear) {
        sanitized.Year = allowedYear;
      }
      continue;
    }

    if (key === 'Set') {
      const normalizedSet = sanitizeSetAspectValue(value);
      if (normalizedSet !== undefined) {
        sanitized.Set = normalizedSet;
      }
      continue;
    }

    if (value !== null && value !== undefined) {
      sanitized[key] = value;
    }
  }

  if (allowedYear && !sanitized.Year) {
    sanitized.Year = allowedYear;
  }

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

export function getListingItemSpecifics(
  value: ListingRow['item_specifics']
): PricingProviderInput['itemSpecifics'] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const itemSpecifics = Object.fromEntries(
    Object.entries(value).flatMap(([key, entryValue]) => {
      if (
        entryValue === null ||
        typeof entryValue === 'string' ||
        (Array.isArray(entryValue) && entryValue.every((candidate) => typeof candidate === 'string'))
      ) {
        return [[key, entryValue]];
      }

      return [];
    })
  );

  return Object.keys(itemSpecifics).length > 0 ? itemSpecifics : undefined;
}

export function buildPricingTitleFromItemSpecifics(
  itemSpecifics: PricingProviderInput['itemSpecifics']
): string | undefined {
  if (!itemSpecifics) {
    return undefined;
  }

  const titleParts = [
    getSpecificDisplayValue(itemSpecifics, 'Player'),
    getSpecificDisplayValue(itemSpecifics, 'Year'),
    getSpecificDisplayValue(itemSpecifics, 'Manufacturer'),
    getSpecificDisplayValue(itemSpecifics, 'Set'),
    getSpecificDisplayValue(itemSpecifics, 'Card Number'),
  ].flatMap((value) => (value ? [value] : []))
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return titleParts.length > 0 ? titleParts.join(' ') : undefined;
}

export function buildPricingProviderInput(
  listing: ListingRow,
  listingId: string,
  requestedCompCount?: number
): PricingProviderInput {
  const validatedYearEvidence = readAuthorizedGeneratedDraftYearMetadata(listing.item_specifics);
  const allowedYear = validatedYearEvidence?.year ?? null;
  const itemSpecifics = sanitizePricingItemSpecifics(
    getListingItemSpecifics(listing.item_specifics),
    allowedYear
  );
  const titleFromItemSpecifics = buildPricingTitleFromItemSpecifics(itemSpecifics);
  const rawListingTitle = asNonEmptyString(listing.title);
  const sanitizedListingTitle = rawListingTitle
    ? sanitizeTitleYearClaims(rawListingTitle, { allowedYear })
    : undefined;
  const title =
    sanitizedListingTitle ||
    titleFromItemSpecifics ||
    getSpecificStringValue(itemSpecifics, 'Player') ||
    listingId;

  return {
    categoryId: listing.category_id,
    conditionId: listing.condition_id,
    itemSpecifics,
    listingId,
    listingType: listing.listing_type,
    pricingModifierOptions: readPricingModifierOptions(listing.item_specifics),
    ...(requestedCompCount === undefined ? {} : { requestedCompCount }),
    title,
  };
}

export function buildNormalizeSoldCompsContext(
  listing: ListingRow,
  listingId: string
): NormalizeSoldCompsContext {
  const providerInput = buildPricingProviderInput(listing, listingId);

  return {
    ...providerInput,
    rawCardSingleShippingDefaults: shouldUseRawCardSingleShippingDefaults(listing, providerInput),
  };
}

function shouldUseRawCardSingleShippingDefaults(
  listing: ListingRow,
  providerInput: PricingProviderInput
): boolean {
  if (providerInput.listingType !== 'single') {
    return false;
  }

  const normalizedConditionId = providerInput.conditionId?.trim();
  if (normalizedConditionId === GRADED_TRADING_CARD_CONDITION_ID) {
    return false;
  }

  const isTradingCard = isTradingCardCategoryId(providerInput.categoryId);
  const hasSavedRawCondition = getSavedRawCardConditionToken(listing.item_specifics) !== null;
  const isRawTradingCardCondition = normalizedConditionId === RAW_TRADING_CARD_CONDITION_ID;

  if (!isTradingCard || (!hasSavedRawCondition && !isRawTradingCardCondition)) {
    return false;
  }

  return !hasGradedSignalItemSpecifics(providerInput.itemSpecifics);
}

export function hasExplicitGradeFieldItemSpecifics(
  itemSpecifics: PricingProviderInput['itemSpecifics']
): boolean {
  if (!itemSpecifics) {
    return false;
  }

  for (const key of ['Professional Grader', 'Grader', 'Grade', 'Card Grade'] as const) {
    const value = itemSpecifics[key];
    for (const entry of Array.isArray(value) ? value : [value]) {
      if (typeof entry === 'string' && entry.trim().length > 0) {
        return true;
      }
    }
  }

  return false;
}

export function hasGradedSignalItemSpecifics(
  itemSpecifics: PricingProviderInput['itemSpecifics']
): boolean {
  if (hasExplicitGradeFieldItemSpecifics(itemSpecifics)) {
    return true;
  }

  if (!itemSpecifics) {
    return false;
  }

  const gradedValue = itemSpecifics.Graded;
  for (const entry of Array.isArray(gradedValue) ? gradedValue : [gradedValue]) {
    if (typeof entry !== 'string') {
      continue;
    }

    const normalized = entry.trim().toLowerCase();
    if (normalized === 'yes' || normalized === 'true' || normalized === 'graded') {
      return true;
    }
  }

  const cardCondition = itemSpecifics[TRADING_CARD_CONDITION_ASPECT_KEY];
  if (typeof cardCondition === 'string' && cardCondition.trim().toLowerCase() === 'graded') {
    return true;
  }

  return false;
}
