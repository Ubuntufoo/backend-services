import { createHash } from 'node:crypto';

import type {
  NormalizeSoldCompsResult,
  NormalizedMoneyValue,
  NormalizedSoldComp,
  RawSoldComp,
} from './types.js';

const URL_PROTOCOLS = new Set(['http:', 'https:']);
const ISO_SOLD_DATE_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/;

const REJECTION_REASONS = {
  blankTitle: 'blank_title',
  invalidPrice: 'invalid_price',
  invalidShipping: 'invalid_shipping',
  invalidSoldDate: 'invalid_sold_date',
  invalidListingUrl: 'invalid_listing_url',
} as const;

export function normalizeSoldComps(rawSoldComps: RawSoldComp[]): NormalizeSoldCompsResult {
  const comps: NormalizedSoldComp[] = [];
  const rejected: NormalizeSoldCompsResult['rejected'] = [];

  rawSoldComps.forEach((rawComp, index) => {
    const normalized = normalizeSoldComp(rawComp);

    if ('reason' in normalized) {
      rejected.push({ index, reason: normalized.reason });
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
  | { reason: string } {
  const title = rawComp.title.trim();
  if (title.length === 0) {
    return { reason: REJECTION_REASONS.blankTitle };
  }

  const price = normalizeMoneyValue(rawComp.price);
  if (!price || price.value <= 0) {
    return { reason: REJECTION_REASONS.invalidPrice };
  }

  let shippingPrice: NormalizedMoneyValue | null = null;
  if (rawComp.shippingPrice !== undefined && rawComp.shippingPrice !== null) {
    shippingPrice = normalizeMoneyValue(rawComp.shippingPrice);
    if (!shippingPrice || shippingPrice.value < 0) {
      return { reason: REJECTION_REASONS.invalidShipping };
    }
  }

  const soldDate = normalizeSoldDate(rawComp.soldDate);
  if (!soldDate) {
    return { reason: REJECTION_REASONS.invalidSoldDate };
  }

  const condition = normalizeOptionalTrimmedString(rawComp.condition);
  const listingUrl = normalizeOptionalTrimmedString(rawComp.listingUrl);

  if (listingUrl) {
    const parsed = tryParseUrl(listingUrl);
    if (!parsed || !URL_PROTOCOLS.has(parsed.protocol)) {
      return { reason: REJECTION_REASONS.invalidListingUrl };
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
