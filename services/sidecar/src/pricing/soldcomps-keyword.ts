import {
  GRADED_TRADING_CARD_CONDITION_ID,
  TRADING_CARD_CONDITION_ASPECT_KEY,
} from '@/listings/trading-card-conditions.js';

import { buildSoldCompsQuery } from './sold-comps-query.js';
import type { PricingProviderInput } from './types.js';

const GRADED_PROVIDER_TERMS = [
  'PSA',
  'BGS',
  'SGC',
  'CGC',
  'CSG',
  'TAG',
  'HGA',
  'GMA',
  'KSA',
  'ISA',
  'WCG',
  'BCCG',
  'Beckett',
] as const;

const RAW_CARD_NEGATIVE_MODIFIERS = [
  '-"you pick"',
  '-"pick your"',
  '-"complete your set"',
  '-choose',
  '-signed',
  '-auto',
  '-autograph',
  '-graded',
  '-slab',
  '-slabbed',
  ...GRADED_PROVIDER_TERMS.map((term) => `-${term}`),
] as const;

const TITLE_GRADE_PATTERN =
  /\b(?:PSA|BGS|SGC|CGC|CSG|TAG|HGA|GMA|KSA|ISA|WCG|BCCG)\b|\bgraded\b|\bslab(?:bed)?\b|\bbeckett\b/i;
const GRADER_ITEM_SPECIFIC_KEYS = ['Professional Grader', 'Grader'] as const;
const GRADE_ITEM_SPECIFIC_KEYS = ['Grade', 'Card Grade'] as const;
const BOOLEAN_GRADED_ITEM_SPECIFIC_KEYS = ['Graded'] as const;

export function buildSoldCompsKeyword(input: PricingProviderInput, positiveQuery = buildSoldCompsQuery(input)): string {

  if (!shouldAppendRawCardModifiers(input)) {
    return positiveQuery;
  }

  const existingNegativeTerms = collectExistingNegativeTerms(positiveQuery);
  const appendedModifiers = RAW_CARD_NEGATIVE_MODIFIERS.filter(
    (modifier) => !existingNegativeTerms.has(normalizeNegativeModifier(modifier))
  );

  if (appendedModifiers.length === 0) {
    return positiveQuery;
  }

  return `${positiveQuery} ${appendedModifiers.join(' ')}`;
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

  if (TITLE_GRADE_PATTERN.test(input.title)) {
    return true;
  }

  for (const key of GRADER_ITEM_SPECIFIC_KEYS) {
    const value = input.itemSpecifics?.[key];
    const normalizedValues = Array.isArray(value) ? value : [value];

    for (const entry of normalizedValues) {
      if (typeof entry !== 'string') {
        continue;
      }

      if (entry.trim().length > 0) {
        return true;
      }
    }
  }

  for (const key of GRADE_ITEM_SPECIFIC_KEYS) {
    const value = input.itemSpecifics?.[key];
    const normalizedValues = Array.isArray(value) ? value : [value];

    for (const entry of normalizedValues) {
      if (typeof entry !== 'string') {
        continue;
      }

      if (entry.trim().length > 0) {
        return true;
      }
    }
  }

  for (const key of BOOLEAN_GRADED_ITEM_SPECIFIC_KEYS) {
    const value = input.itemSpecifics?.[key];
    const normalizedValues = Array.isArray(value) ? value : [value];

    for (const entry of normalizedValues) {
      if (typeof entry !== 'string') {
        continue;
      }

      const normalized = entry.trim().toLowerCase();
      if (normalized === 'yes' || normalized === 'true' || normalized === 'graded') {
        return true;
      }
    }
  }

  const cardCondition = input.itemSpecifics?.[TRADING_CARD_CONDITION_ASPECT_KEY];
  if (typeof cardCondition === 'string' && cardCondition.trim().toLowerCase() === 'graded') {
    return true;
  }

  return false;
}

function collectExistingNegativeTerms(query: string): Set<string> {
  const matches = query.match(/-(?:"[^"]+"|\S+)/g) ?? [];
  return new Set(matches.map((match) => normalizeNegativeModifier(match)));
}

function normalizeNegativeModifier(modifier: string): string {
  return modifier
    .trim()
    .replace(/^-/, '')
    .replace(/^"(.*)"$/, '$1')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}
