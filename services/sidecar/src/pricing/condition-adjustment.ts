import { getSavedRawCardConditionToken } from '@/listings/trading-card-conditions.js';

import type {
  ConditionAdjustmentInput,
  ConditionAdjustmentSummary,
  ConditionSignal,
  PricingProviderInput,
} from './types.js';

const LISTING_SIGNAL_BY_TOKEN = {
  EXCELLENT: { label: 'Excellent', score: 4 },
  NEAR_MINT_OR_BETTER: { label: 'Near Mint or Better', score: 5 },
  POOR: { label: 'Poor', score: 0 },
  VERY_GOOD: { label: 'Very Good', score: 3 },
} as const;

const CONDITION_PATTERNS: ReadonlyArray<{
  label: string;
  pattern: RegExp;
  score: number;
}> = [
  { label: 'Low Grade', pattern: /(^|[^A-Za-z])(low grade)(?=$|[^A-Za-z])/i, score: 0 },
  {
    label: 'Near Mint or Better',
    pattern: /(^|[^A-Za-z])(near mint(?: or better)?)(?=$|[^A-Za-z])/i,
    score: 5,
  },
  { label: 'NM-MT', pattern: /(^|[^A-Za-z])(nm(?:\s|-|\/)mt)(?=$|[^A-Za-z])/i, score: 5.5 },
  { label: 'EX-MT', pattern: /(^|[^A-Za-z])(ex(?:\s|-|\/)mt)(?=$|[^A-Za-z])/i, score: 4.5 },
  { label: 'VG-EX', pattern: /(^|[^A-Za-z])(vg(?:\s|-|\/)ex)(?=$|[^A-Za-z])/i, score: 3.5 },
  { label: 'Very Good', pattern: /(^|[^A-Za-z])(very good)(?=$|[^A-Za-z])/i, score: 3 },
  { label: 'Excellent', pattern: /(^|[^A-Za-z])(excellent)(?=$|[^A-Za-z])/i, score: 4 },
  { label: 'Near Mint', pattern: /(^|[^A-Za-z])(near mint)(?=$|[^A-Za-z])/i, score: 5 },
  { label: 'Poor', pattern: /(^|[^A-Za-z])(poor)(?=$|[^A-Za-z])/i, score: 0 },
  { label: 'Fair', pattern: /(^|[^A-Za-z])(fair)(?=$|[^A-Za-z])/i, score: 1 },
  { label: 'Good', pattern: /(^|[^A-Za-z])(good)(?=$|[^A-Za-z])/i, score: 2 },
  { label: 'Mint', pattern: /(^|[^A-Za-z])(mint)(?=$|[^A-Za-z])/i, score: 6 },
  { label: 'NM', pattern: /(^|[^A-Za-z])(nm)(?=$|[^A-Za-z])/i, score: 5 },
  { label: 'EX', pattern: /(^|[^A-Za-z])(ex)(?=$|[^A-Za-z])/i, score: 4 },
  { label: 'VG', pattern: /(^|[^A-Za-z])(vg)(?=$|[^A-Za-z])/i, score: 3 },
  { label: 'MT', pattern: /(^|[^A-Za-z])(mt)(?=$|[^A-Za-z])/i, score: 6 },
  { label: 'G', pattern: /(^|[^A-Za-z])(g)(?=$|[^A-Za-z])/i, score: 2 },
];

export function computeConditionAdjustmentSummary(
  input: ConditionAdjustmentInput
): ConditionAdjustmentSummary {
  const listingConditionSignal = parseListingConditionSignal(input.listingCondition);
  const listingConditionScore = listingConditionSignal?.score ?? null;
  const deterministicMedianPrice = normalizePrice(input.stats.medianSoldPrice);
  const compConditionSignals = input.comps.map((comp) => ({
    compId: comp.id,
    title: comp.title,
    price: normalizePrice(comp.totalPrice.value) ?? 0,
    signal: parseCompConditionSignal(comp.title, comp.condition),
  }));
  const explicitCompScores = compConditionSignals
    .map((entry) => entry.signal?.score ?? null)
    .filter((score): score is number => typeof score === 'number');
  const explicitCompConditionCount = explicitCompScores.length;
  const compMedianConditionScore =
    explicitCompConditionCount > 0 ? roundMetric(calculateMedian(explicitCompScores)) : null;
  const conditionDelta =
    listingConditionScore !== null && compMedianConditionScore !== null
      ? roundMetric(listingConditionScore - compMedianConditionScore)
      : null;

  return {
    listingConditionSignal,
    compConditionSignals,
    explicitCompConditionCount,
    compMedianConditionScore,
    listingConditionScore,
    conditionDelta,
    deterministicMedianPrice,
    allowedAdjustment: buildAllowedAdjustment({
      conditionDelta,
      deterministicMedianPrice,
      explicitCompConditionCount,
      listingConditionScore,
      stats: input.stats,
    }),
  };
}

export function getListingConditionForAdjustment(
  itemSpecifics: PricingProviderInput['itemSpecifics']
): string | null {
  return getSavedRawCardConditionToken(itemSpecifics ?? null);
}

function parseListingConditionSignal(
  listingCondition: string | null | undefined
): ConditionSignal | null {
  if (typeof listingCondition !== 'string') {
    return null;
  }

  const normalized = listingCondition.trim();
  if (normalized.length === 0) {
    return null;
  }

  const signal = LISTING_SIGNAL_BY_TOKEN[normalized as keyof typeof LISTING_SIGNAL_BY_TOKEN];
  if (!signal) {
    return null;
  }

  return {
    label: signal.label,
    matchedText: normalized,
    score: signal.score,
    source: 'listing_condition',
  };
}

function parseCompConditionSignal(title: string, condition: string | null): ConditionSignal | null {
  return (
    parseTextConditionSignal(title, 'comp_title') ??
    parseTextConditionSignal(condition, 'comp_condition')
  );
}

function parseTextConditionSignal(
  value: string | null | undefined,
  source: 'comp_title' | 'comp_condition'
): ConditionSignal | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  if (normalized.length === 0) {
    return null;
  }

  for (const candidate of CONDITION_PATTERNS) {
    const match = candidate.pattern.exec(normalized);
    if (!match?.[2]) {
      continue;
    }

    return {
      label: candidate.label,
      matchedText: match[2],
      score: candidate.score,
      source,
    };
  }

  return null;
}

function buildAllowedAdjustment(input: {
  conditionDelta: number | null;
  deterministicMedianPrice: number | null;
  explicitCompConditionCount: number;
  listingConditionScore: number | null;
  stats: ConditionAdjustmentInput['stats'];
}): ConditionAdjustmentSummary['allowedAdjustment'] {
  if (input.listingConditionScore === null) {
    return ineligibleAdjustment('listing_condition_unknown');
  }

  if (input.deterministicMedianPrice === null) {
    return ineligibleAdjustment('median_price_unavailable');
  }

  if (input.explicitCompConditionCount < 3) {
    return ineligibleAdjustment('insufficient_explicit_comp_conditions');
  }

  if (input.conditionDelta === null) {
    return ineligibleAdjustment('comp_condition_median_unavailable');
  }

  const rawPercent = Math.tanh(input.conditionDelta / 2.0) * 0.5;
  const clampedPercent = clamp(rawPercent, -0.4, 0.4);
  const baseLowerBound = input.deterministicMedianPrice * 0.65;
  const baseUpperBound = input.deterministicMedianPrice * 1.35;
  let curvePrice = input.deterministicMedianPrice * (1 + clampedPercent);

  const normalizedLow = normalizePrice(input.stats.lowSoldPrice);
  const normalizedHigh = normalizePrice(input.stats.highSoldPrice);
  if (normalizedLow !== null && normalizedHigh !== null && normalizedLow <= normalizedHigh) {
    curvePrice = clamp(curvePrice, normalizedLow, normalizedHigh);
  }

  curvePrice = clamp(curvePrice, baseLowerBound, baseUpperBound);
  const targetPrice = normalizePrice(curvePrice);

  if (targetPrice === null) {
    return ineligibleAdjustment('target_price_invalid');
  }

  return {
    eligible: true,
    targetPrice,
    minPrice: targetPrice,
    maxPrice: targetPrice,
    rawPercent: roundMetric(rawPercent),
    appliedPercent: roundMetric(targetPrice / input.deterministicMedianPrice - 1),
    reason: 'eligible',
  };
}

function ineligibleAdjustment(
  reason: ConditionAdjustmentSummary['allowedAdjustment']['reason']
): ConditionAdjustmentSummary['allowedAdjustment'] {
  return {
    eligible: false,
    targetPrice: null,
    minPrice: null,
    maxPrice: null,
    rawPercent: null,
    appliedPercent: null,
    reason,
  };
}

function calculateMedian(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[midpoint] ?? 0;
  }

  return ((sorted[midpoint - 1] ?? 0) + (sorted[midpoint] ?? 0)) / 2;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function normalizePrice(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  const normalized = Number(value.toFixed(2));
  return normalized > 0 ? normalized : null;
}

function roundMetric(value: number): number {
  return Number(value.toFixed(4));
}
