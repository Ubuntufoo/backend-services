import type {
  LlmPricingPrompt,
  LlmPricingPromptComp,
  LlmPricingPromptFactKey,
  LlmPricingPromptInput,
  LlmPricingPromptListing,
  LlmPricingPromptStats,
} from './types.js';

const DEFAULT_MAX_COMPS = 12;
const MAX_TITLE_LENGTH = 160;
const MAX_FACT_VALUE_LENGTH = 80;
const MAX_CONDITION_LENGTH = 48;
const FACT_KEY_ORDER: readonly LlmPricingPromptFactKey[] = [
  'Player',
  'Year',
  'Manufacturer',
  'Set',
  'Card Number',
  'Parallel/Variety',
  'Team/Franchise',
];

export function buildLlmPricingPrompt(input: LlmPricingPromptInput): LlmPricingPrompt {
  const payload = {
    listing: buildListingPayload(input.listing),
    stats: buildStatsPayload(input.stats),
    comps: buildCompsPayload(input.comps, input.options?.maxComps),
    conditionAdjustment: buildConditionAdjustmentPayload(input.conditionAdjustment),
  };

  return {
    systemInstruction: [
      'You are pricing analyst for deterministically accepted normalized sold comps.',
      'Use only provided listing facts, deterministic stats, normalized comps, and deterministic condition summary.',
      'Do not decide comp eligibility or exact-card matching.',
      'Do not invent condition scores or override deterministic target math.',
      'Return JSON only with no markdown fences or explanatory prose.',
    ].join(' '),
    userPrompt: [
      'Return JSON only.',
      'Use exactly these output fields: selectedCompIds, rejectedCompIds, conditionAdjustedPrice, conditionAdjustmentPercent, conditionAdjustmentReason, confidence, priceExplanation, reviewWarnings, ambiguousConditionTerms, compNotes.',
      'Use only IDs from comps.',
      'Do not invent comps, prices, dates, grades, serials, players, teams, card attributes, condition terms, or listing facts.',
      'Comps and deterministic stats are already accepted. Do not reject exact-card comps from stats.',
      'Do not make lot or single recommendations.',
      'Keep priceExplanation short.',
      'If conditionAdjustment.allowedAdjustment.eligible is true, either return the exact targetPrice or return conditionAdjustedPrice: null.',
      'If conditionAdjustment.allowedAdjustment.eligible is false, return conditionAdjustedPrice: null.',
      'Never output a different adjusted price than targetPrice.',
      'Pricing payload:',
      JSON.stringify(payload),
    ].join('\n'),
  };
}

function buildListingPayload(listing: LlmPricingPromptListing): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    title: truncateText(listing.title, MAX_TITLE_LENGTH),
  };

  const condition = normalizeOptionalText(listing.condition, MAX_CONDITION_LENGTH);
  if (condition) {
    payload.condition = condition;
  }

  const facts = buildFactsPayload(listing.facts);
  if (facts) {
    payload.facts = facts;
  }

  return payload;
}

function buildFactsPayload(
  facts: LlmPricingPromptListing['facts']
): Record<string, string> | undefined {
  if (!facts) {
    return undefined;
  }

  const entries = FACT_KEY_ORDER.flatMap((key) => {
    const value = normalizeOptionalText(facts[key], MAX_FACT_VALUE_LENGTH);
    return value ? [[key, value] as const] : [];
  });

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function buildStatsPayload(stats: LlmPricingPromptStats): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    soldCount: normalizeSoldCount(stats.soldCount),
    confidence: stats.confidence,
  };

  const numericEntries: ReadonlyArray<readonly ['low' | 'median' | 'high' | 'suggested', string]> = [
    ['low', 'low'],
    ['median', 'median'],
    ['high', 'high'],
    ['suggested', 'suggested'],
  ];

  for (const [sourceKey, targetKey] of numericEntries) {
    const value = normalizePrice(stats[sourceKey]);
    if (value !== undefined) {
      payload[targetKey] = value;
    }
  }

  return payload;
}

function buildCompsPayload(
  comps: readonly LlmPricingPromptComp[],
  maxComps: number | undefined
): Record<string, unknown>[] {
  const normalizedMaxComps = normalizeMaxComps(maxComps);
  const payloads: Record<string, unknown>[] = [];

  for (const comp of comps) {
    const price = normalizePrice(comp.price);
    if (price === undefined || price <= 0) {
      continue;
    }

    const payload: Record<string, unknown> = {
      id: normalizeRequiredText(comp.id),
      title: truncateText(comp.title, MAX_TITLE_LENGTH),
      price,
      soldAt: normalizeRequiredText(comp.soldAt),
    };

    const condition = normalizeOptionalText(comp.condition, MAX_CONDITION_LENGTH);
    if (condition) {
      payload.condition = condition;
    }

    payloads.push(payload);

    if (payloads.length >= normalizedMaxComps) {
      break;
    }
  }

  return payloads;
}

function buildConditionAdjustmentPayload(
  summary: LlmPricingPromptInput['conditionAdjustment']
): Record<string, unknown> {
  return {
    listingConditionSignal: summary.listingConditionSignal
      ? {
          label: summary.listingConditionSignal.label,
          matchedText: summary.listingConditionSignal.matchedText,
          score: summary.listingConditionSignal.score,
          source: summary.listingConditionSignal.source,
        }
      : null,
    compConditionSignals: summary.compConditionSignals.map((entry) => ({
      compId: entry.compId,
      price: normalizePrice(entry.price),
      signal: entry.signal
        ? {
            label: entry.signal.label,
            matchedText: entry.signal.matchedText,
            score: entry.signal.score,
            source: entry.signal.source,
          }
        : null,
      title: truncateText(entry.title, MAX_TITLE_LENGTH),
    })),
    explicitCompConditionCount: summary.explicitCompConditionCount,
    compMedianConditionScore: summary.compMedianConditionScore,
    listingConditionScore: summary.listingConditionScore,
    conditionDelta: summary.conditionDelta,
    deterministicMedianPrice: normalizePrice(summary.deterministicMedianPrice),
    allowedAdjustment: {
      eligible: summary.allowedAdjustment.eligible,
      targetPrice: normalizeNullablePrice(summary.allowedAdjustment.targetPrice),
      minPrice: normalizeNullablePrice(summary.allowedAdjustment.minPrice),
      maxPrice: normalizeNullablePrice(summary.allowedAdjustment.maxPrice),
      rawPercent: summary.allowedAdjustment.rawPercent,
      appliedPercent: summary.allowedAdjustment.appliedPercent,
      reason: summary.allowedAdjustment.reason,
    },
  };
}

function normalizeSoldCount(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.trunc(value));
}

function normalizeMaxComps(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_MAX_COMPS;
  }

  return Math.max(1, Math.trunc(value));
}

function normalizePrice(value: number | null | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }

  return Number(value.toFixed(2));
}

function normalizeNullablePrice(value: number | null | undefined): number | null {
  const normalized = normalizePrice(value);
  return normalized ?? null;
}

function normalizeRequiredText(value: string): string {
  return value.trim();
}

function normalizeOptionalText(value: string | null | undefined, maxLength: number): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = truncateText(value, maxLength);
  return normalized.length > 0 ? normalized : undefined;
}

function truncateText(value: string, maxLength: number): string {
  const normalized = value.trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return normalized.slice(0, maxLength).trimEnd();
}
