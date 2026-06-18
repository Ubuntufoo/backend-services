import { createHash } from 'node:crypto';

import type {
  NormalizeSoldCompsContext,
  NormalizeSoldCompsResult,
  NormalizedMoneyValue,
  NormalizedSoldComp,
  RawSoldComp,
} from './types.js';
import {
  buildExactCardTitleTarget,
  getExactCardTitleMismatchReason,
} from './exact-card-title.js';
import { isGradedListingTitle } from './graded-listing-signals.js';
import { normalizeSeasonRanges } from './season-range.js';

const URL_PROTOCOLS = new Set(['http:', 'https:']);
const ISO_SOLD_DATE_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/;

const REJECTION_REASONS = {
  blankTitle: 'blank_title',
  excludedGradedListing: 'excluded_graded_listing',
  excludedSelectionListing: 'excluded_selection_listing',
  invalidPrice: 'invalid_price',
  invalidShipping: 'invalid_shipping',
  invalidSoldDate: 'invalid_sold_date',
  invalidListingUrl: 'invalid_listing_url',
} as const;

const INVALID_TITLE_PATTERNS = [
  {
    pattern: /\byou[\s-]+pick\b/i,
    reason: REJECTION_REASONS.excludedSelectionListing,
  },
  {
    pattern: /\bpick[\s-]+your\b/i,
    reason: REJECTION_REASONS.excludedSelectionListing,
  },
  {
    pattern: /\bchoose\b/i,
    reason: REJECTION_REASONS.excludedSelectionListing,
  },
  {
    pattern: /\bcomplete[\s-]+your[\s-]+set\b/i,
    reason: REJECTION_REASONS.excludedSelectionListing,
  },
  {
    pattern: /\bpick[\s-]+choose\b/i,
    reason: REJECTION_REASONS.excludedSelectionListing,
  },
] as const;

const CARD_NUMBER_RANGE_PATTERN = /#?\s*(\d{1,4})\s*-\s*(\d{1,4})\b/i;

export function normalizeSoldComps(
  rawSoldComps: RawSoldComp[],
  context: NormalizeSoldCompsContext = {}
): NormalizeSoldCompsResult {
  const comps: NormalizedSoldComp[] = [];
  const rejected: NormalizeSoldCompsResult['rejected'] = [];
  const exactCardTarget = buildExactCardTitleTarget(context);

  rawSoldComps.forEach((rawComp, index) => {
    const normalized = normalizeSingleSoldComp(rawComp, exactCardTarget, context);

    if ('reason' in normalized) {
      rejected.push({ index, reason: normalized.reason, title: normalized.title });
      return;
    }

    comps.push({
      ...normalized,
      id: createNormalizedCompId(normalized),
      source: 'provider',
    });
  });

  return { comps, rejected };
}

function normalizeSoldComp(rawComp: RawSoldComp):
  | Omit<NormalizedSoldComp, 'id' | 'source'>
  | { reason: string; title: string | null } {
  return normalizeSingleSoldComp(rawComp, buildExactCardTitleTarget({}), {});
}

function normalizeSingleSoldComp(
  rawComp: RawSoldComp,
  exactCardTarget: ReturnType<typeof buildExactCardTitleTarget>,
  context: NormalizeSoldCompsContext
):
  | Omit<NormalizedSoldComp, 'id' | 'source'>
  | { reason: string; title: string | null } {
  const title = rawComp.title.trim();
  if (title.length === 0) {
    return { reason: REJECTION_REASONS.blankTitle, title: null };
  }

  const invalidTitleReason = getInvalidTitleReason(title, exactCardTarget);
  if (invalidTitleReason) {
    return { reason: invalidTitleReason, title };
  }

  const price = normalizeMoneyValue(rawComp.price);
  if (!price || price.value <= 0) {
    return { reason: REJECTION_REASONS.invalidPrice, title };
  }

  let shippingPrice: NormalizedMoneyValue | null = null;
  if (rawComp.shippingPrice !== undefined && rawComp.shippingPrice !== null) {
    shippingPrice = normalizeMoneyValue(rawComp.shippingPrice);
    if (!shippingPrice || shippingPrice.value < 0) {
      return { reason: REJECTION_REASONS.invalidShipping, title };
    }
  }

  const estimatedShipping =
    context.rawCardSingleShippingDefaults === true ? estimateRawCardSingleShipping(price.value) : null;
  if (estimatedShipping !== null) {
    shippingPrice = {
      currency: price.currency,
      value: estimatedShipping,
    };
  }

  const soldDate = normalizeSoldDate(rawComp.soldDate);
  if (!soldDate) {
    return { reason: REJECTION_REASONS.invalidSoldDate, title };
  }

  const condition = normalizeOptionalTrimmedString(rawComp.condition);
  const listingUrl = normalizeOptionalTrimmedString(rawComp.listingUrl);

  if (listingUrl) {
    const parsed = tryParseUrl(listingUrl);
    if (!parsed || !URL_PROTOCOLS.has(parsed.protocol)) {
      return { reason: REJECTION_REASONS.invalidListingUrl, title };
    }
  }

  return {
    title,
    price,
    shippingPrice,
    totalPrice: {
      value: Number((price.value + (shippingPrice?.value ?? 0)).toFixed(2)),
      currency: price.currency,
    },
    soldDate: soldDate.toISOString(),
    condition,
    listingUrl,
  };
}

function estimateRawCardSingleShipping(price: number): number | null {
  if (!Number.isFinite(price) || price < 0) {
    return null;
  }

  if (price < 3) {
    return 1;
  }

  if (price < 8) {
    return 1.25;
  }

  if (price < 15) {
    return 2;
  }

  if (price < 20) {
    return 2.75;
  }

  return null;
}

function getInvalidTitleReason(
  title: string,
  exactCardTarget: ReturnType<typeof buildExactCardTitleTarget>
): string | null {
  if (isGradedListingTitle(title)) {
    return REJECTION_REASONS.excludedGradedListing;
  }

  for (const { pattern, reason } of INVALID_TITLE_PATTERNS) {
    if (pattern.test(title)) {
      return reason;
    }
  }

  const validationTitle = normalizeSeasonRanges(title, { targetYear: exactCardTarget.year });

  if (exactCardTarget.cardNumber && containsSelectionRangeForExactCard(validationTitle, exactCardTarget.cardNumber)) {
    return REJECTION_REASONS.excludedSelectionListing;
  }

  const exactCardMismatchReason = getExactCardTitleMismatchReason(validationTitle, exactCardTarget);
  if (exactCardMismatchReason) {
    return exactCardMismatchReason;
  }

  return null;
}

function containsSelectionRangeForExactCard(title: string, exactTargetCardNumber: string): boolean {
  const rangeMatch = title.match(CARD_NUMBER_RANGE_PATTERN);
  if (!rangeMatch) {
    return false;
  }

  if (!/^\d+$/.test(exactTargetCardNumber)) {
    return true;
  }

  const exactValue = Number.parseInt(exactTargetCardNumber, 10);
  const start = Number.parseInt(rangeMatch[1] ?? '', 10);
  const end = Number.parseInt(rangeMatch[2] ?? '', 10);

  if (![exactValue, start, end].every(Number.isFinite)) {
    return true;
  }

  return start !== exactValue || end !== exactValue;
}

function normalizeMoneyValue(value: { value: number; currency: string }): NormalizedMoneyValue | null {
  if (!Number.isFinite(value.value)) {
    return null;
  }

  return {
    value: value.value,
    currency: value.currency,
  };
}

function normalizeOptionalTrimmedString(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeSoldDate(value: string): Date | null {
  if (!ISO_SOLD_DATE_PATTERN.test(value)) {
    return null;
  }

  const soldDate = new Date(value);
  if (Number.isNaN(soldDate.getTime())) {
    return null;
  }

  return soldDate;
}

function tryParseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function createNormalizedCompId(comp: Omit<NormalizedSoldComp, 'id' | 'source'>): string {
  return createHash('sha256')
    .update(
      [
        comp.title,
        comp.price.currency,
        comp.price.value.toFixed(2),
        comp.shippingPrice ? comp.shippingPrice.value.toFixed(2) : '',
        comp.soldDate,
        comp.listingUrl ?? '',
        comp.condition ?? '',
      ].join('|'),
    )
    .digest('hex');
}
