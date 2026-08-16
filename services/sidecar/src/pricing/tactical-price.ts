import type { Money } from '@/api/buy/browse.js';
import type { ActiveMarketSnapshot } from './active-market.js';
import { roundFinalListingPrice } from './final-price-adjustment.js';

const MIN_EVIDENCE_COUNT = 20;
const LANDED_COVERAGE_MIN = 0.75;
const UNDERCUT_AMOUNT = 0.01;
const MIN_RESULT = 0.01;
const REQUIRED_CURRENCY = 'USD';

/**
 * Pure tactical-price calculation over one completed active-market snapshot.
 *
 * Implements the deterministic rule finalized in 10F.2 (docs/pricing.md):
 * - exact complete evidence only
 * - landed basis only with strong shipping coverage AND known-free own buyer shipping
 * - nearest-rank Q1 minus $0.01, then the same nickel/psychological rounding as
 *   roundFinalListingPrice()
 *
 * Side-effect free: never mutates the snapshot, competitor rows, or money objects,
 * and performs no persistence, network, or job behavior.
 */
export function computeTacticalSellPrice(
  snapshot: ActiveMarketSnapshot,
  ourEffectiveBuyerShipping: Money | null
): number | null {
  if (!snapshot.complete) return null;

  const exactAcceptedCount = snapshot.exactAcceptedCount;
  if (
    exactAcceptedCount === null ||
    !Number.isSafeInteger(exactAcceptedCount) ||
    exactAcceptedCount < MIN_EVIDENCE_COUNT ||
    exactAcceptedCount !== snapshot.competitors.length
  ) {
    return null;
  }

  const itemValues: number[] = [];
  const landedValues: number[] = [];
  for (const competitor of snapshot.competitors) {
    const itemPrice = competitor.itemPrice;
    if (!isFiniteNonNegativeUsd(itemPrice.value, itemPrice.currency)) {
      return null;
    }
    itemValues.push(itemPrice.value);

    const totalPrice = competitor.totalPrice;
    if (totalPrice !== null && isFiniteNonNegativeUsd(totalPrice.value, totalPrice.currency)) {
      landedValues.push(totalPrice.value);
    }
  }

  const landedCoverage = landedValues.length / exactAcceptedCount;
  const landedQualifies =
    landedValues.length >= MIN_EVIDENCE_COUNT &&
    landedValues.length === snapshot.shippingKnownAcceptedCount &&
    landedCoverage >= LANDED_COVERAGE_MIN &&
    snapshot.shippingKnownTotalDistribution !== null;

  const selectedValues =
    landedQualifies && isKnownFreeShipping(ourEffectiveBuyerShipping) ? landedValues : itemValues;

  const q1 = nearestRankQ1(selectedValues);
  if (q1 === null) return null;

  const undercut = q1 - UNDERCUT_AMOUNT;
  if (!Number.isFinite(undercut) || undercut < MIN_RESULT) return null;

  const rounded = roundFinalListingPrice(undercut);
  if (!Number.isFinite(rounded) || rounded < MIN_RESULT) return null;

  return rounded;
}

function isFiniteNonNegativeUsd(value: number, currency: string): boolean {
  return Number.isFinite(value) && value >= 0 && currency === REQUIRED_CURRENCY;
}

function isKnownFreeShipping(shipping: Money | null): boolean {
  return (
    shipping !== null &&
    Number.isFinite(shipping.value) &&
    shipping.currency === REQUIRED_CURRENCY &&
    shipping.value === 0
  );
}

function nearestRankQ1(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(0.25 * sorted.length) - 1]!;
}
