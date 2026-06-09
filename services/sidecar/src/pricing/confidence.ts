import type {
  PricingConfidence,
  PricingConfidenceInput,
  PricingConfidenceResult,
} from './types.js';

export function computePricingConfidence(input: PricingConfidenceInput): PricingConfidenceResult {
  const reasons: string[] = [];
  const { comps, stats } = input;

  if (
    stats.medianSoldPrice === null ||
    stats.deterministicSuggestedPrice === null ||
    stats.currency === null
  ) {
    reasons.push('missing_pricing_stats');
    return {
      confidence: 'low',
      reasons,
    };
  }

  let confidence: PricingConfidence;

  if (stats.soldCount < 3) {
    confidence = 'low';
    reasons.push('insufficient_comps');
  } else if (stats.soldCount < 8) {
    confidence = 'medium';
    reasons.push('moderate_comp_count');
  } else {
    confidence = 'high';
    reasons.push('strong_comp_count');
  }

  const candidateCount = comps.length;
  const ignoredRatio = candidateCount > 0 ? stats.ignored.length / candidateCount : 0;
  if (ignoredRatio > 0.4) {
    confidence = downgradeConfidence(confidence);
    reasons.push('high_ignored_ratio');
  }

  if (
    stats.lowSoldPrice !== null &&
    stats.highSoldPrice !== null &&
    stats.lowSoldPrice > 0 &&
    stats.highSoldPrice > 0 &&
    stats.highSoldPrice / stats.lowSoldPrice > 3
  ) {
    confidence = downgradeConfidence(confidence);
    reasons.push('wide_price_spread');
  }

  return {
    confidence,
    reasons,
  };
}

function downgradeConfidence(confidence: PricingConfidence): PricingConfidence {
  switch (confidence) {
    case 'high':
      return 'medium';
    case 'medium':
      return 'low';
    default:
      return 'low';
  }
}
