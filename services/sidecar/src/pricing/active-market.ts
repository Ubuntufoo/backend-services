import {
  BrowseMalformedResponseError,
  type BrowseApi,
  type BrowseSearchPage,
  type BrowseSearchPageItem,
  type Money,
} from '@/api/buy/browse.js';
import type { IdentityApi } from '@/api/other/identity.js';
import { resolveBrowseShippingContext, type BrowseShippingContext } from '@/config/environment.js';

import { buildSoldCompsQuery } from './sold-comps-query.js';
import { buildActiveMarketTitleTarget, getActiveMarketTitleMismatchReason } from './active-market-title.js';
import { deriveBrowseItemPriceWindow } from './browse-price-window.js';
import { normalizeBrowsePricingOptions, type BrowsePricingOptions } from './browse-pricing-options.js';
import type { PricingProviderInput } from './types.js';

export const ACTIVE_MARKET_PAGE_SIZE = 200;
export const ACTIVE_MARKET_TRAVERSAL_SAFEGUARDS = {
  // Discovery observed a 1,358-result card; this permits ordinary high-supply scans
  // while keeping a single request bounded.
  maxPages: 10,
  maxDurationMs: 15_000,
  maxOffset: 2_000,
} as const;

const BROWSE_CONTINUATION_PATH = '/buy/browse/v1/item_summary/search';
const BROWSE_CONTINUATION_ORIGINS = new Set([
  'https://api.ebay.com',
  'https://api.sandbox.ebay.com',
]);

export interface BrowsePricingAnchor {
  value: number;
  currency: string;
  basis: 'condition_adjusted_base_price_before_competitive_velocity';
}

export interface ActiveMarketShippingContext extends BrowseShippingContext {
  basis: 'configured_contextual_location';
}

export interface ActiveMarketTraversalSafeguards {
  maxPages: number;
  maxDurationMs: number;
  maxOffset: number;
}

export type ActiveMarketIncompleteReason = 'page_limit' | 'time_limit' | 'offset_limit' | 'page_error';
export type ActiveMarketUnavailableReason =
  | 'missing_anchor'
  | 'invalid_options'
  | 'missing_shipping_context'
  | 'seller_identity_unavailable'
  | 'time_limit'
  | 'auth_failed'
  | 'api_failed'
  | 'malformed_response';

export interface ActiveMarketTraversalInput {
  providerInput: PricingProviderInput;
  anchor?: BrowsePricingAnchor | null;
  options?: unknown;
  marketplaceId?: string;
  shippingContext?: BrowseShippingContext;
  safeguards?: Partial<ActiveMarketTraversalSafeguards>;
}

export interface ActiveMarketTraversalDependencies {
  browse: Pick<BrowseApi, 'search'>;
  identity: Pick<IdentityApi, 'getUsername'>;
  now?: () => number;
  environment?: NodeJS.ProcessEnv;
}

export interface ActiveMarketTraversalResult {
  status: 'available' | 'skipped' | 'unavailable';
  skipReason: 'browse_disabled' | null;
  unavailableReason: ActiveMarketUnavailableReason | null;
  incompleteReason: ActiveMarketIncompleteReason | null;
  capturedAt: string;
  anchor: BrowsePricingAnchor | null;
  multipliers: Pick<BrowsePricingOptions, 'minPriceMultiplier' | 'maxPriceMultiplier'> | null;
  itemPriceWindow: { min: number; max: number; currency: string } | null;
  query: {
    canonical: string | null;
    marketplaceId: string;
    categoryId: string | null;
    conditionId: string | null;
    buyingOption: 'FIXED_PRICE';
  };
  sellerExclusionApplied: boolean;
  shippingContext: ActiveMarketShippingContext | null;
  safeguards: ActiveMarketTraversalSafeguards;
  pagesScanned: number;
  candidateRowsScanned: number;
  complete: boolean;
  exactAcceptedCount: number | null;
  acceptedCount: number;
  rejectedCount: number;
  rejectionReasonCounts: Record<string, number>;
  acceptedItems: BrowseSearchPageItem[];
  latencyMs: number;
}

/** A Browse competitor with a landed-price value only when shipping is usable. */
export interface ActiveMarketCompetitor {
  legacyItemId: string;
  title: string;
  condition: string | null;
  conditionId: string | null;
  itemPrice: Money;
  shippingCost: Money | null;
  shippingType: string | null;
  totalPrice: Money | null;
  itemUrl: string;
}

export interface PriceDistribution {
  low: number;
  median: number;
  high: number;
  currency: string;
}

export interface ActiveMarketSnapshot {
  complete: boolean;
  competitors: ActiveMarketCompetitor[];
  exactAcceptedCount: number | null;
  shippingKnownAcceptedCount: number;
  itemPriceDistribution: PriceDistribution | null;
  shippingKnownTotalDistribution: PriceDistribution | null;
  tacticalSellPrice: number | null;
}

export function projectActiveMarketCompetitor(item: BrowseSearchPageItem): ActiveMarketCompetitor {
  const totalValue =
    isUsableMoney(item.itemPrice) && isCompatibleShipping(item.itemPrice, item.shippingCost)
      ? item.itemPrice.value + item.shippingCost.value
      : null;
  const totalPrice =
    totalValue !== null && Number.isFinite(totalValue)
      ? { value: roundCurrency(totalValue), currency: item.itemPrice.currency }
      : null;

  return {
    legacyItemId: item.legacyItemId,
    title: item.title,
    condition: item.condition,
    conditionId: item.conditionId,
    itemPrice: item.itemPrice,
    shippingCost: item.shippingCost,
    shippingType: item.shippingType,
    totalPrice,
    itemUrl: item.itemUrl,
  };
}

export function projectActiveMarketCompetitors(
  items: readonly BrowseSearchPageItem[]
): ActiveMarketCompetitor[] {
  return items.map(projectActiveMarketCompetitor);
}

export function computePriceDistribution(values: readonly Money[]): PriceDistribution | null {
  const usableValues = values.filter(isUsableMoney);
  const currencies = new Set(usableValues.map((value) => value.currency));
  if (currencies.size > 1) return null;
  const selectedCurrency = usableValues[0]?.currency;
  if (!selectedCurrency) return null;

  const sortedValues = usableValues
    .map((value) => value.value)
    .sort((left, right) => left - right);
  if (sortedValues.length === 0) return null;

  const midpoint = Math.floor(sortedValues.length / 2);
  const median =
    sortedValues.length % 2 === 1
      ? sortedValues[midpoint]!
      : ((sortedValues[midpoint - 1]! + sortedValues[midpoint]!) / 2);

  return {
    low: roundCurrency(sortedValues[0]!),
    median: roundCurrency(median),
    high: roundCurrency(sortedValues[sortedValues.length - 1]!),
    currency: selectedCurrency,
  };
}

export function buildActiveMarketSnapshot(
  acceptedItems: readonly BrowseSearchPageItem[],
  complete: boolean
): ActiveMarketSnapshot {
  const competitors = projectActiveMarketCompetitors(acceptedItems);
  const shippingKnown = competitors.filter((competitor) => competitor.totalPrice !== null);

  return {
    complete,
    competitors,
    exactAcceptedCount: complete ? competitors.length : null,
    shippingKnownAcceptedCount: shippingKnown.length,
    itemPriceDistribution: complete
      ? computePriceDistribution(competitors.map((competitor) => competitor.itemPrice))
      : null,
    shippingKnownTotalDistribution: complete
      ? computePriceDistribution(
          shippingKnown.flatMap((competitor) => (competitor.totalPrice ? [competitor.totalPrice] : []))
        )
      : null,
    tacticalSellPrice: null,
  };
}

export class ActiveMarketTraversal {
  private readonly now: () => number;

  constructor(private readonly dependencies: ActiveMarketTraversalDependencies) {
    this.now = dependencies.now ?? Date.now;
  }

  async traverse(input: ActiveMarketTraversalInput): Promise<ActiveMarketTraversalResult> {
    const startedAt = this.now();
    const safeguards = resolveSafeguards(input.safeguards);
    const deadlineSignal = AbortSignal.timeout(safeguards.maxDurationMs);
    const capturedAt = new Date(startedAt).toISOString();
    const marketplaceId = input.marketplaceId ?? 'EBAY_US';
    const base = createBaseResult(capturedAt, marketplaceId, safeguards);

    let options: BrowsePricingOptions;
    try {
      options = normalizeBrowsePricingOptions(
        input.options ?? input.providerInput.browsePricingOptions
      );
    } catch {
      return finish(base, startedAt, this.now, {
        status: 'unavailable',
        unavailableReason: 'invalid_options',
      });
    }

    base.multipliers = {
      minPriceMultiplier: options.minPriceMultiplier,
      maxPriceMultiplier: options.maxPriceMultiplier,
    };
    if (options.skipBrowse) {
      return finish(base, startedAt, this.now, {
        status: 'skipped',
        skipReason: 'browse_disabled',
      });
    }

    const anchor = input.anchor;
    if (!anchor || !isValidAnchor(anchor)) {
      return finish(base, startedAt, this.now, {
        status: 'unavailable',
        unavailableReason: 'missing_anchor',
      });
    }
    base.anchor = anchor;

    const currency = anchor.currency;
    const categoryId = nonEmpty(input.providerInput.categoryId);
    const conditionId = nonEmpty(input.providerInput.conditionId);
    if (!currency || !categoryId || !conditionId) {
      return finish(base, startedAt, this.now, {
        status: 'unavailable',
        unavailableReason: 'missing_anchor',
      });
    }

    let window: { minItemPrice: number; maxItemPrice: number };
    try {
      window = deriveBrowseItemPriceWindow(anchor.value, options);
    } catch {
      return finish(base, startedAt, this.now, {
        status: 'unavailable',
        unavailableReason: 'missing_anchor',
      });
    }
    base.itemPriceWindow = { min: window.minItemPrice, max: window.maxItemPrice, currency };

    const shippingContext = input.shippingContext ?? resolveShippingContext(this.dependencies.environment);
    if (!shippingContext) {
      return finish(base, startedAt, this.now, {
        status: 'unavailable',
        unavailableReason: 'missing_shipping_context',
      });
    }
    base.shippingContext = { ...shippingContext, basis: 'configured_contextual_location' };

    const canonicalQuery = buildSoldCompsQuery(input.providerInput);
    base.query = {
      canonical: canonicalQuery,
      marketplaceId,
      categoryId,
      conditionId,
      buyingOption: 'FIXED_PRICE',
    };

    let sellerUsername: string;
    try {
      sellerUsername = await this.dependencies.identity.getUsername({ signal: deadlineSignal });
    } catch {
      if (deadlineSignal.aborted || this.now() - startedAt >= safeguards.maxDurationMs) {
        return finish(base, startedAt, this.now, {
          status: 'unavailable',
          unavailableReason: 'time_limit',
        });
      }
      return finish(base, startedAt, this.now, {
        status: 'unavailable',
        unavailableReason: 'seller_identity_unavailable',
      });
    }

    const target = buildActiveMarketTitleTarget(input.providerInput);
    let next: string | undefined;
    let offset = 0;
    const seen = new Set<string>();
    let page: BrowseSearchPage | null = null;
    while (true) {
      const elapsed = this.now() - startedAt;
      const safeguardReason = getSafeguardReason(base.pagesScanned, elapsed, offset, safeguards);
      if (deadlineSignal.aborted || safeguardReason) {
        const reason = deadlineSignal.aborted ? 'time_limit' : safeguardReason;
        if (base.pagesScanned === 0) {
          return finish(base, startedAt, this.now, {
            status: 'unavailable',
            unavailableReason: 'time_limit',
          });
        }
        return finish(base, startedAt, this.now, {
          status: 'available',
          incompleteReason: reason,
          acceptedItems: base.acceptedItems,
          acceptedCount: base.acceptedCount,
          rejectedCount: base.rejectedCount,
        });
      }

      try {
        page = await this.dependencies.browse.search({
          query: canonicalQuery,
          marketplaceId,
          categoryId,
          conditionId,
          currency,
          minItemPrice: window.minItemPrice,
          maxItemPrice: window.maxItemPrice,
          excludeSellerUsername: sellerUsername,
          context: shippingContext,
          limit: ACTIVE_MARKET_PAGE_SIZE,
          timeoutMs: Math.max(1, safeguards.maxDurationMs - elapsed),
          signal: deadlineSignal,
          ...(next === undefined ? { offset } : { next }),
        });
      } catch (error) {
        if (deadlineSignal.aborted || this.now() - startedAt >= safeguards.maxDurationMs) {
          return finish(
            base,
            startedAt,
            this.now,
            base.pagesScanned === 0
              ? { status: 'unavailable', unavailableReason: 'time_limit' }
              : { status: 'available', incompleteReason: 'time_limit' }
          );
        }
        const reason = base.pagesScanned > 0 ? 'page_error' : classifyUnavailable(error);
        return finish(base, startedAt, this.now, {
          status: base.pagesScanned > 0 ? 'available' : 'unavailable',
          ...(base.pagesScanned > 0
            ? { incompleteReason: reason as ActiveMarketIncompleteReason }
            : { unavailableReason: reason as ActiveMarketUnavailableReason }),
        });
      }

      // A noncompliant dependency (or a timer that fires after transport
      // resolution) must not allow a page beyond the traversal budget to be
      // reported as complete. Keep only pages already accepted as usable.
      if (deadlineSignal.aborted || this.now() - startedAt >= safeguards.maxDurationMs) {
        if (base.pagesScanned === 0) {
          return finish(base, startedAt, this.now, {
            status: 'unavailable',
            unavailableReason: 'time_limit',
          });
        }
        return finish(base, startedAt, this.now, {
          status: 'available',
          incompleteReason: 'time_limit',
          acceptedItems: base.acceptedItems,
          acceptedCount: base.acceptedCount,
          rejectedCount: base.rejectedCount,
        });
      }

      const currentPage = page!;
      const pageAcceptedItems: BrowseSearchPageItem[] = [];
      const pageAcceptedIds = new Set<string>();
      let pageRejectedCount = 0;
      const pageRejectionReasonCounts: Record<string, number> = {};
      for (const item of currentPage.items) {
        const mismatchReason = getActiveMarketTitleMismatchReason(item.title, target);
        if (mismatchReason) {
          pageRejectedCount += 1;
          pageRejectionReasonCounts[mismatchReason] =
            (pageRejectionReasonCounts[mismatchReason] ?? 0) + 1;
          continue;
        }
        if (seen.has(item.legacyItemId) || pageAcceptedIds.has(item.legacyItemId)) continue;
        pageAcceptedIds.add(item.legacyItemId);
        pageAcceptedItems.push(item);
      }

      next = currentPage.next ?? undefined;
      const finishTimeLimit = (): ActiveMarketTraversalResult => {
        if (base.pagesScanned === 0) {
          return finish(base, startedAt, this.now, {
            status: 'unavailable',
            unavailableReason: 'time_limit',
          });
        }
        return finish(base, startedAt, this.now, {
          status: 'available',
          incompleteReason: 'time_limit',
          acceptedItems: base.acceptedItems,
          acceptedCount: base.acceptedCount,
          rejectedCount: base.rejectedCount,
        });
      };

      const commitPage = (): void => {
        base.pagesScanned += 1;
        base.candidateRowsScanned += currentPage.items.length;
        base.rejectedCount += pageRejectedCount;
        for (const [reason, count] of Object.entries(pageRejectionReasonCounts)) {
          base.rejectionReasonCounts[reason] = (base.rejectionReasonCounts[reason] ?? 0) + count;
        }
        for (const item of pageAcceptedItems) {
          seen.add(item.legacyItemId);
          base.acceptedItems.push(item);
        }
        base.acceptedCount += pageAcceptedItems.length;
      };

      if (next === undefined) {
        // Recheck immediately before exact completion; the current page has
        // not been committed, so only previously usable pages can be retained.
        if (deadlineSignal.aborted || this.now() - startedAt >= safeguards.maxDurationMs) {
          return finishTimeLimit();
        }
        commitPage();
        return finish(base, startedAt, this.now, {
          status: 'available',
          complete: true,
          exactAcceptedCount: base.acceptedCount,
          sellerExclusionApplied: true,
        });
      }

      // Do not commit a page whose filtering/deduplication crossed the shared
      // traversal deadline; only previously usable pages may be retained.
      if (deadlineSignal.aborted || this.now() - startedAt >= safeguards.maxDurationMs) {
        return finishTimeLimit();
      }
      commitPage();

      const nextOffset = parseContinuationOffset(next);
      if (nextOffset === null || nextOffset <= offset) {
        return finish(base, startedAt, this.now, {
          status: 'available',
          incompleteReason: 'page_error',
        });
      }
      offset = nextOffset;
    }
  }
}

export function traverseActiveMarket(
  input: ActiveMarketTraversalInput,
  dependencies: ActiveMarketTraversalDependencies
): Promise<ActiveMarketTraversalResult> {
  return new ActiveMarketTraversal(dependencies).traverse(input);
}

function createBaseResult(
  capturedAt: string,
  marketplaceId: string,
  safeguards: ActiveMarketTraversalSafeguards
): ActiveMarketTraversalResult {
  return {
    status: 'unavailable',
    skipReason: null,
    unavailableReason: null,
    incompleteReason: null,
    capturedAt,
    anchor: null,
    multipliers: null,
    itemPriceWindow: null,
    query: {
      canonical: null,
      marketplaceId,
      categoryId: null,
      conditionId: null,
      buyingOption: 'FIXED_PRICE',
    },
    sellerExclusionApplied: false,
    shippingContext: null,
    safeguards,
    pagesScanned: 0,
    candidateRowsScanned: 0,
    complete: false,
    exactAcceptedCount: null,
    acceptedCount: 0,
    rejectedCount: 0,
    rejectionReasonCounts: {},
    acceptedItems: [],
    latencyMs: 0,
  };
}

function finish(
  base: ActiveMarketTraversalResult,
  startedAt: number,
  now: () => number,
  changes: Partial<ActiveMarketTraversalResult>
): ActiveMarketTraversalResult {
  const result = { ...base, ...changes };
  result.latencyMs = Math.max(0, now() - startedAt);
  if (result.status !== 'available' || !result.complete) {
    result.exactAcceptedCount = null;
  }
  if (result.status === 'available') result.sellerExclusionApplied = true;
  return result;
}

function resolveSafeguards(
  overrides?: Partial<ActiveMarketTraversalSafeguards>
): ActiveMarketTraversalSafeguards {
  const values = { ...ACTIVE_MARKET_TRAVERSAL_SAFEGUARDS, ...overrides };
  if (
    !Number.isSafeInteger(values.maxPages) ||
    values.maxPages < 1 ||
    !Number.isFinite(values.maxDurationMs) ||
    values.maxDurationMs < 1 ||
    !Number.isSafeInteger(values.maxOffset) ||
    values.maxOffset < 0
  ) {
    return { ...ACTIVE_MARKET_TRAVERSAL_SAFEGUARDS };
  }
  return values;
}

function getSafeguardReason(
  pagesScanned: number,
  elapsedMs: number,
  offset: number,
  safeguards: ActiveMarketTraversalSafeguards
): ActiveMarketIncompleteReason | null {
  if (pagesScanned >= safeguards.maxPages) return 'page_limit';
  if (elapsedMs >= safeguards.maxDurationMs) return 'time_limit';
  if (offset > safeguards.maxOffset) return 'offset_limit';
  return null;
}

function parseContinuationOffset(next: string): number | null {
  try {
    const url = new URL(next, 'https://api.ebay.com');
    const isRelative = next.startsWith('/') && !next.startsWith('//');
    if (
      (!isRelative && !BROWSE_CONTINUATION_ORIGINS.has(url.origin)) ||
      url.pathname !== BROWSE_CONTINUATION_PATH
    ) {
      return null;
    }
    const offset = url.searchParams.get('offset');
    if (!offset || !/^\d+$/.test(offset)) return null;
    const parsed = Number(offset);
    return Number.isSafeInteger(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function classifyUnavailable(error: unknown): ActiveMarketUnavailableReason {
  if (error instanceof BrowseMalformedResponseError) return 'malformed_response';
  const statusCode = (error as { statusCode?: unknown })?.statusCode;
  if (statusCode === 401 || statusCode === 403) return 'auth_failed';
  return 'api_failed';
}

function resolveShippingContext(environment?: NodeJS.ProcessEnv): BrowseShippingContext | null {
  try {
    return resolveBrowseShippingContext(environment);
  } catch {
    return null;
  }
}

function nonEmpty(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function isValidAnchor(value: BrowsePricingAnchor): boolean {
  return Number.isFinite(value.value) && value.value > 0 && nonEmpty(value.currency) !== null;
}

function isUsableMoney(value: Money | null): value is Money {
  return (
    value !== null &&
    Number.isFinite(value.value) &&
    value.value >= 0 &&
    nonEmpty(value.currency) !== null
  );
}

function isCompatibleShipping(itemPrice: Money, shippingCost: Money | null): shippingCost is Money {
  return isUsableMoney(shippingCost) && shippingCost.currency === itemPrice.currency;
}

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
