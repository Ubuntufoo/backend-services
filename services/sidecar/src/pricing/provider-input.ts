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
    itemSpecifics.Player,
    itemSpecifics.Year,
    itemSpecifics.Manufacturer,
    itemSpecifics.Set,
    itemSpecifics['Card Number'],
  ]
    .flatMap((value) => (Array.isArray(value) ? value : value ? [value] : []))
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return titleParts.length > 0 ? titleParts.join(' ') : undefined;
}

export function buildPricingProviderInput(
  listing: ListingRow,
  listingId: string,
  requestedCompCount?: number
): PricingProviderInput {
  const itemSpecifics = getListingItemSpecifics(listing.item_specifics);
  const title =
    asNonEmptyString(listing.title) ?? buildPricingTitleFromItemSpecifics(itemSpecifics) ?? listingId;

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
