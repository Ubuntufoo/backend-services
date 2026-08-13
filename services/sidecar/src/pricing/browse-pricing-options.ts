export interface BrowsePricingOptions {
  skipBrowse: boolean;
  minPriceMultiplier: number;
  maxPriceMultiplier: number;
}

export const DEFAULT_BROWSE_PRICING_OPTIONS = {
  skipBrowse: false,
  minPriceMultiplier: 0.33,
  maxPriceMultiplier: 3,
} as const satisfies BrowsePricingOptions;

export function normalizeBrowsePricingOptions(input: unknown): BrowsePricingOptions {
  if (input === undefined || input === null) {
    return { ...DEFAULT_BROWSE_PRICING_OPTIONS };
  }

  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Browse pricing options must be a plain object.');
  }

  const candidate = input as Record<string, unknown>;

  if (typeof candidate.skipBrowse !== 'boolean') {
    throw new TypeError('skipBrowse must be a boolean.');
  }

  if (
    typeof candidate.minPriceMultiplier !== 'number' ||
    !Number.isFinite(candidate.minPriceMultiplier) ||
    candidate.minPriceMultiplier <= 0
  ) {
    throw new RangeError('minPriceMultiplier must be a finite positive number.');
  }

  if (
    typeof candidate.maxPriceMultiplier !== 'number' ||
    !Number.isFinite(candidate.maxPriceMultiplier) ||
    candidate.maxPriceMultiplier <= 0
  ) {
    throw new RangeError('maxPriceMultiplier must be a finite positive number.');
  }

  if (!(candidate.minPriceMultiplier < candidate.maxPriceMultiplier)) {
    throw new RangeError('minPriceMultiplier must be less than maxPriceMultiplier.');
  }

  return {
    skipBrowse: candidate.skipBrowse,
    minPriceMultiplier: candidate.minPriceMultiplier,
    maxPriceMultiplier: candidate.maxPriceMultiplier,
  };
}
