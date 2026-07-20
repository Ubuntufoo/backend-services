import type { NormalizedSoldComp } from './types.js';

const COMPETITIVE_DISCOUNT_PERCENT = 5;
const RECENT_WINDOW_DAYS = 90;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1_000;

export type SalesVelocityTier = 'high' | 'low' | 'medium';

export interface FinalPriceAdjustment {
  basePrice: number;
  competitiveDiscountPercent: number;
  recentWindowDays: number;
  recentAcceptedCompCount: number;
  salesVelocityTier: SalesVelocityTier;
  salesVelocityDiscountPercent: number;
  finalPrice: number;
}

export function computeFinalPriceAdjustment(input: {
  basePrice: number;
  comps: readonly NormalizedSoldComp[];
  currentTime: Date;
}): FinalPriceAdjustment {
  if (!Number.isFinite(input.basePrice) || input.basePrice <= 0) {
    throw new RangeError('Final price adjustment requires a positive finite base price.');
  }

  const currentTimeMs = input.currentTime.getTime();
  if (!Number.isFinite(currentTimeMs)) {
    throw new RangeError('Final price adjustment requires a valid current time.');
  }

  const recentWindowStartMs = currentTimeMs - RECENT_WINDOW_DAYS * MILLISECONDS_PER_DAY;
  const recentAcceptedCompCount = input.comps.filter((comp) => {
    const soldTimeMs = Date.parse(comp.soldDate);
    return (
      Number.isFinite(soldTimeMs) &&
      soldTimeMs >= recentWindowStartMs &&
      soldTimeMs <= currentTimeMs
    );
  }).length;
  const velocityAdjustment = getVelocityAdjustment(recentAcceptedCompCount);
  const competitivelyAdjustedPrice =
    input.basePrice * (1 - COMPETITIVE_DISCOUNT_PERCENT / 100);
  const finalPrice = roundCurrency(
    competitivelyAdjustedPrice * (1 - velocityAdjustment.discountPercent / 100)
  );

  if (!Number.isFinite(finalPrice) || finalPrice <= 0) {
    throw new RangeError('Final price adjustment did not produce a positive valid price.');
  }

  return {
    basePrice: input.basePrice,
    competitiveDiscountPercent: COMPETITIVE_DISCOUNT_PERCENT,
    recentWindowDays: RECENT_WINDOW_DAYS,
    recentAcceptedCompCount,
    salesVelocityTier: velocityAdjustment.tier,
    salesVelocityDiscountPercent: velocityAdjustment.discountPercent,
    finalPrice,
  };
}

function getVelocityAdjustment(recentAcceptedCompCount: number): {
  discountPercent: number;
  tier: SalesVelocityTier;
} {
  if (recentAcceptedCompCount >= 8) {
    return { discountPercent: 0, tier: 'high' };
  }

  if (recentAcceptedCompCount >= 3) {
    return { discountPercent: 2.5, tier: 'medium' };
  }

  return { discountPercent: 5, tier: 'low' };
}

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
