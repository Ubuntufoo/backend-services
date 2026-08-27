import {
  buildExactCardTitleTarget,
  getExactCardTitleMismatchReason,
  type ExactCardTitleTarget,
} from './exact-card-title.js';
import type { NormalizeSoldCompsContext } from './types.js';

const AUTOGRAPH_PATTERN = /\b(?:auto(?:graph(?:ed)?)?|signed)\b/i;
const REPRINT_PATTERN = /\b(?:reprint|reproduction|replica)\b/i;
const MULTI_CARD_PATTERN =
  /\b(?:lot|bundle|complete\s+set|multi[\s-]+card)\b|\b\d+[\s-]*(?:x|cards?|count|ct)\b|\b(?:qty|quantity)\s*[:x]?\s*\d+\b/i;
const CONTEXTUAL_YEAR_PATTERN =
  /\b(?:hall\s+of\s+fame|hof)\s+(?:class(?:\s+of)?|inducted)?\s*(?:19\d{2}|20\d{2})\b/gi;

export const ACTIVE_MARKET_TITLE_REJECTION_REASONS = {
  autographMismatch: 'active_autograph_mismatch',
  cardNumberEvidenceMismatch: 'active_card_number_evidence_mismatch',
  multiCardMismatch: 'active_multi_card_mismatch',
  reprintMismatch: 'active_reprint_mismatch',
  setMismatch: 'active_set_mismatch',
} as const;

export interface ActiveMarketTitleTarget {
  exactCard: ExactCardTitleTarget;
  structuredSetTokens: string[];
  authorizesAutograph: boolean;
  authorizesReprint: boolean;
}

export function buildActiveMarketTitleTarget(
  context: NormalizeSoldCompsContext
): ActiveMarketTitleTarget {
  const identityText = [context.title, ...getAuthorizationValues(context)].filter(Boolean).join(' ');

  return {
    exactCard: buildExactCardTitleTarget(context),
    structuredSetTokens: getStructuredSetTokens(context),
    authorizesAutograph: AUTOGRAPH_PATTERN.test(identityText),
    authorizesReprint: REPRINT_PATTERN.test(identityText),
  };
}

export function getActiveMarketTitleMismatchReason(
  title: string,
  target: ActiveMarketTitleTarget
): string | null {
  const contextualYearNormalizedTitle = title.replace(CONTEXTUAL_YEAR_PATTERN, ' ');
  const sharedMismatch = getExactCardTitleMismatchReason(
    contextualYearNormalizedTitle,
    target.exactCard
  );
  if (sharedMismatch) {
    return sharedMismatch;
  }

  if (REPRINT_PATTERN.test(title) && !target.authorizesReprint) {
    return ACTIVE_MARKET_TITLE_REJECTION_REASONS.reprintMismatch;
  }
  if (AUTOGRAPH_PATTERN.test(title) && !target.authorizesAutograph) {
    return ACTIVE_MARKET_TITLE_REJECTION_REASONS.autographMismatch;
  }
  if (MULTI_CARD_PATTERN.test(title)) {
    return ACTIVE_MARKET_TITLE_REJECTION_REASONS.multiCardMismatch;
  }

  const titleTokens = tokenize(title);
  const { baseSetTokens, cardNumber, year } = target.exactCard;
  const fullSetTokens = target.structuredSetTokens;
  if (
    fullSetTokens.length > baseSetTokens.length &&
    !containsPhrase(titleTokens, fullSetTokens)
  ) {
    return ACTIVE_MARKET_TITLE_REJECTION_REASONS.setMismatch;
  }

  if (
    cardNumber &&
    !hasStrongCardNumberEvidence(title, cardNumber) &&
    (titleTokens.includes(cardNumber.toLowerCase()) ||
      !(year && titleTokens.includes(year) && containsPhrase(titleTokens, fullSetTokens)))
  ) {
    return ACTIVE_MARKET_TITLE_REJECTION_REASONS.cardNumberEvidenceMismatch;
  }

  return null;
}

function getStructuredSetTokens(context: NormalizeSoldCompsContext): string[] {
  const rawSet = context.itemSpecifics?.Set;
  const value = Array.isArray(rawSet) ? rawSet[0] : rawSet;
  return typeof value === 'string' ? tokenize(value).filter((token) => token !== 'set') : [];
}

function getAuthorizationValues(context: NormalizeSoldCompsContext): string[] {
  if (!context.itemSpecifics) return [];
  return ['Autographed', 'Autograph', 'Features', 'Parallel/Variety', 'Reprint'].flatMap((key) => {
    const value = context.itemSpecifics?.[key];
    return Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  });
}

function hasStrongCardNumberEvidence(title: string, cardNumber: string): boolean {
  const escaped = escapeRegExp(cardNumber);
  return new RegExp(
    `(?:#\\s*${escaped}\\b|\\b(?:card|no\\.?|number)\\s*#?\\s*${escaped}\\b)`,
    'i'
  ).test(title);
}

function tokenize(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/i).filter(Boolean);
}

function containsPhrase(tokens: string[], phrase: string[]): boolean {
  if (phrase.length === 0) return false;
  return tokens.some((_, index) => phrase.every((token, offset) => tokens[index + offset] === token));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
