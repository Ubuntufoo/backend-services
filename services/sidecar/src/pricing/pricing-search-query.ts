import { DEFAULT_PRICING_MODIFIER_OPTIONS } from '@ebay-inventory/types';
import { GRADED_TRADING_CARD_CONDITION_ID } from '@/listings/trading-card-conditions.js';

import { hasGradedSignalItemSpecifics } from './provider-input.js';
import {
  CORE_GRADED_PROVIDER_NEGATIVES,
  isGradedListingTitle,
} from './graded-listing-signals.js';
import { buildSoldCompsQuery } from './sold-comps-query.js';
import type { PricingProviderInput } from './types.js';

export {
  CORE_GRADED_PROVIDER_NEGATIVES,
} from './graded-listing-signals.js';

export const RAW_CARD_NEGATIVE_MODIFIERS = ['-pick', '-choose', '-complete', '-lot'] as const;
export const AUTOGRAPH_PROVIDER_NEGATIVES = ['-auto', '-autograph'] as const;

export function buildPricingSearchQuery(
  input: PricingProviderInput,
  positiveQuery = buildSoldCompsQuery(input)
): string {
  if (!shouldAppendRawCardModifiers(input)) {
    return positiveQuery;
  }

  const modifierOptions = input.pricingModifierOptions ?? DEFAULT_PRICING_MODIFIER_OPTIONS;
  const existingNegativeTerms = collectExistingNegativeTerms(positiveQuery);
  const appendedModifiers = [
    ...RAW_CARD_NEGATIVE_MODIFIERS,
    ...(modifierOptions.excludeGraded ? CORE_GRADED_PROVIDER_NEGATIVES : []),
    ...(modifierOptions.excludeAutographs ? AUTOGRAPH_PROVIDER_NEGATIVES : []),
  ].filter((modifier) => !existingNegativeTerms.has(normalizeNegativeModifier(modifier)));

  return appendedModifiers.length > 0 ? `${positiveQuery} ${appendedModifiers.join(' ')}` : positiveQuery;
}

function shouldAppendRawCardModifiers(input: PricingProviderInput): boolean {
  if (input.listingType === 'lot') {
    return false;
  }

  return !isExplicitlyGraded(input);
}

function isExplicitlyGraded(input: PricingProviderInput): boolean {
  if (input.conditionId?.trim() === GRADED_TRADING_CARD_CONDITION_ID) {
    return true;
  }

  if (isGradedListingTitle(input.title)) {
    return true;
  }

  return hasGradedSignalItemSpecifics(input.itemSpecifics);
}

function collectExistingNegativeTerms(query: string): Set<string> {
  const matches = query.match(/-\S+/g) ?? [];
  return new Set(matches.map((match) => normalizeNegativeModifier(match)));
}

function normalizeNegativeModifier(modifier: string): string {
  return modifier.trim().replace(/^-/, '').replace(/\s+/g, ' ').toLowerCase();
}
