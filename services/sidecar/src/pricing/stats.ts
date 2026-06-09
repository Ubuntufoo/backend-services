import type { NormalizedSoldComp, PricingStatsResult } from './types.js';

export function computePricingStats(comps: readonly NormalizedSoldComp[]): PricingStatsResult {
  const ignored: PricingStatsResult['ignored'] = [];
  const usableValues: number[] = [];
  let selectedCurrency: string | null = null;

  comps.forEach((comp) => {
    const totalPrice = comp.totalPrice;

    if (!Number.isFinite(totalPrice.value) || totalPrice.value <= 0) {
      ignored.push({ id: comp.id, reason: 'invalid_total_price' });
      return;
    }

    if (selectedCurrency === null) {
      selectedCurrency = totalPrice.currency;
    }

    if (totalPrice.currency !== selectedCurrency) {
      ignored.push({ id: comp.id, reason: 'currency_mismatch' });
      return;
    }

    usableValues.push(totalPrice.value);
  });

  if (usableValues.length === 0) {
    return {
      soldCount: 0,
      medianSoldPrice: null,
      lowSoldPrice: null,
      highSoldPrice: null,
      deterministicSuggestedPrice: null,
      currency: null,
      ignored,
    };
  }

  const sortedValues = [...usableValues].sort((left, right) => left - right);
  const low = roundCurrency(sortedValues[0]);
  const high = roundCurrency(sortedValues[sortedValues.length - 1]);
  const median = roundCurrency(calculateMedian(sortedValues));

  return {
    soldCount: sortedValues.length,
    medianSoldPrice: median,
    lowSoldPrice: low,
    highSoldPrice: high,
    deterministicSuggestedPrice: median,
    currency: selectedCurrency,
    ignored,
  };
}

function calculateMedian(sortedValues: readonly number[]): number {
  const midpoint = Math.floor(sortedValues.length / 2);

  if (sortedValues.length % 2 === 1) {
    return sortedValues[midpoint] ?? 0;
  }

  return ((sortedValues[midpoint - 1] ?? 0) + (sortedValues[midpoint] ?? 0)) / 2;
}

function roundCurrency(value: number): number {
  return Number(value.toFixed(2));
}
