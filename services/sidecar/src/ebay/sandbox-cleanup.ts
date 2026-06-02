import { EbayApiRequestError } from '@/api/client.js';
import type { EbaySellerApi } from '@/api/index.js';

export const DEFAULT_SANDBOX_CLEANUP_PREFIXES = ['Single-', 'Lot-'] as const;
export const MAX_GENERATED_SANDBOX_SKUS = 500;
const SANDBOX_SKU_SUFFIX_WIDTH = 6;

export type SandboxCleanupMode = 'dry-run' | 'delete';
export type SandboxCleanupSourceMode = 'range' | 'sku';

export interface SandboxCleanupOfferSummary {
  format?: string;
  listingId?: string;
  marketplaceId?: string;
  offerId?: string;
  sku: string;
  status?: string;
}

export interface SandboxCleanupInventoryItemSummary {
  sku: string;
}

export interface SandboxCleanupCandidateInspection {
  inventoryExists: boolean;
  offers: SandboxCleanupOfferSummary[];
  sku: string;
}

export interface SandboxCleanupPlan {
  candidateCount: number;
  candidateSkus: string[];
  foundSkus: string[];
  from?: number;
  missingSkus: string[];
  offersBySku: Record<string, SandboxCleanupOfferSummary[]>;
  prefixes: string[];
  skus: string[];
  sourceMode: SandboxCleanupSourceMode;
  to?: number;
}

export interface SandboxCleanupDeleteOutcome {
  deletedInventoryItem: boolean;
  deletedOffers: string[];
  errors: string[];
  sku: string;
  skippedMissing: string[];
  status: 'deleted' | 'failed' | 'skipped';
}

export interface SandboxCleanupRunResult extends SandboxCleanupPlan {
  mode: SandboxCleanupMode;
  outcomes: SandboxCleanupDeleteOutcome[];
  success: boolean;
}

export interface SandboxCleanupResolvedPlan extends SandboxCleanupPlan {
  inspections: SandboxCleanupCandidateInspection[];
}

export interface SandboxCleanupDependencies {
  api: Pick<EbaySellerApi, 'inventory' | 'trading'>;
}

export interface SandboxCleanupInput {
  allowLargeRange?: boolean;
  confirmSandboxCleanup?: boolean;
  delete?: boolean;
  from?: number;
  prefixes?: string[];
  skus?: string[];
  to?: number;
}

interface SandboxCleanupSelection {
  allowLargeRange: boolean;
  from?: number;
  prefixes: string[];
  skus: string[];
  sourceMode: SandboxCleanupSourceMode;
  to?: number;
}

function isSandboxEnvironment(): boolean {
  return process.env.EBAY_ENVIRONMENT === 'sandbox';
}

function normalizeText(value: string): string {
  return value.trim();
}

function normalizeStrings(values: string[] | undefined): string[] {
  if (!values || values.length === 0) {
    return [];
  }

  return values
    .map((value) => normalizeText(value))
    .filter((value) => value.length > 0);
}

function dedupePreserveOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }

    seen.add(value);
    result.push(value);
  }

  return result;
}

function getTrimmedString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function getNestedString(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }

  return getTrimmedString((value as Record<string, unknown>)[key]);
}

function getStatusCode(error: unknown): number | undefined {
  if (error instanceof EbayApiRequestError) {
    return error.statusCode;
  }

  if (error instanceof Error) {
    const match = /\b(4\d\d|5\d\d)\b/.exec(error.message);
    if (match) {
      return Number(match[1]);
    }
  }

  return undefined;
}

function getEbayErrorIds(error: unknown): number[] {
  if (error instanceof EbayApiRequestError) {
    return error.ebayErrors
      .map((ebayError) => ebayError.errorId)
      .filter((errorId): errorId is number => Number.isInteger(errorId));
  }

  return [];
}

function isMissingResourceError(error: unknown): boolean {
  const statusCode = getStatusCode(error);
  if (statusCode === 404 || statusCode === 410) {
    return true;
  }

  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes('not found') || message.includes('404') || message.includes('this offer is not available')) {
    return true;
  }

  return getEbayErrorIds(error).includes(25713);
}

function getOfferSummary(offer: Record<string, unknown>): SandboxCleanupOfferSummary | undefined {
  const sku = getTrimmedString(offer.sku);
  if (!sku) {
    return undefined;
  }

  return {
    format: getTrimmedString(offer.format),
    listingId: getNestedString(offer.listing, 'listingId'),
    marketplaceId: getTrimmedString(offer.marketplaceId),
    offerId: getTrimmedString(offer.offerId),
    sku,
    status: getTrimmedString(offer.status),
  };
}

function toRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (entry): entry is Record<string, unknown> =>
      typeof entry === 'object' && entry !== null && !Array.isArray(entry)
  );
}

function parsePositiveInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return value;
}

function buildGeneratedSku(prefix: string, sequence: number): string {
  return `${prefix}${String(sequence).padStart(SANDBOX_SKU_SUFFIX_WIDTH, '0')}`;
}

function buildGeneratedSkus(prefixes: string[], from: number, to: number): string[] {
  const skus: string[] = [];

  for (const prefix of prefixes) {
    for (let current = from; current <= to; current += 1) {
      skus.push(buildGeneratedSku(prefix, current));
    }
  }

  return dedupePreserveOrder(skus);
}

function resolveSourceSelection(input: SandboxCleanupInput): SandboxCleanupSelection {
  const prefixes = normalizeStrings(input.prefixes);
  const skus = dedupePreserveOrder(normalizeStrings(input.skus));
  const hasRange = input.from !== undefined || input.to !== undefined;

  if (skus.length > 0) {
    if (prefixes.length > 0 || hasRange) {
      throw new Error('--sku cannot be combined with --prefix, --from, or --to.');
    }

    if (input.allowLargeRange) {
      throw new Error('--allow-large-range requires --prefix with --from/--to.');
    }

    return {
      allowLargeRange: false,
      prefixes: [],
      skus,
      sourceMode: 'sku',
    };
  }

  if (hasRange) {
    if (input.from === undefined || input.to === undefined) {
      throw new Error('--from and --to must be provided together.');
    }

    if (prefixes.length === 0) {
      throw new Error('--prefix is required when using --from/--to.');
    }

    const from = parsePositiveInteger(input.from, '--from');
    const to = parsePositiveInteger(input.to, '--to');

    if (to < from) {
      throw new Error('--to must be greater than or equal to --from.');
    }

    const candidateCount = prefixes.length * (to - from + 1);
    if (candidateCount > MAX_GENERATED_SANDBOX_SKUS && !input.allowLargeRange) {
      throw new Error(
        `Generated SKU range would create ${candidateCount} candidates. ` +
          `Limit is ${MAX_GENERATED_SANDBOX_SKUS}. Pass --allow-large-range to override.`
      );
    }

    return {
      allowLargeRange: Boolean(input.allowLargeRange),
      from,
      prefixes,
      skus: [],
      sourceMode: 'range',
      to,
    };
  }

  const prefixCount = prefixes.length;
  if (prefixCount > 0) {
    throw new Error(
      [
        'Broad inventory-list cleanup mode is disabled because the eBay sandbox inventory list endpoint is unreliable.',
        'Use explicit SKU cleanup or generated range cleanup instead.',
        'Examples:',
        '  --sku Single-000001',
        '  --prefix Single- --from 1 --to 50',
        '  --prefix Single- --prefix Lot- --from 1 --to 50',
      ].join('\n')
    );
  }

  if (input.allowLargeRange) {
    throw new Error('--allow-large-range requires --prefix with --from/--to.');
  }

  throw new Error(
    [
      'Broad inventory-list cleanup mode is disabled because the eBay sandbox inventory list endpoint is unreliable.',
      'Use explicit SKU cleanup or generated range cleanup instead.',
      'Examples:',
      '  pnpm ebay:cleanup-sandbox -- --sku Single-000001',
      '  pnpm ebay:cleanup-sandbox -- --prefix Single- --from 1 --to 50',
      '  pnpm ebay:cleanup-sandbox -- --prefix Single- --prefix Lot- --from 1 --to 50',
    ].join('\n')
  );
}

async function inspectCandidateSku(
  api: Pick<EbaySellerApi, 'inventory'>,
  sku: string,
  options: { probeInventoryIfNoOffers: boolean }
): Promise<SandboxCleanupCandidateInspection> {
  try {
    const response = await api.inventory.getOffers(sku);
    const offers = toRecordArray(response.offers)
      .map(getOfferSummary)
      .filter((offer): offer is SandboxCleanupOfferSummary => offer !== undefined);

    if (offers.length > 0) {
      return {
        inventoryExists: true,
        offers,
        sku,
      };
    }

    if (!options.probeInventoryIfNoOffers) {
      return {
        inventoryExists: true,
        offers,
        sku,
      };
    }

    try {
      await api.inventory.getInventoryItem(sku);
      return {
        inventoryExists: true,
        offers,
        sku,
      };
    } catch (error) {
      if (isMissingResourceError(error)) {
        return {
          inventoryExists: false,
          offers: [],
          sku,
        };
      }

      throw error;
    }
  } catch (error) {
    if (isMissingResourceError(error)) {
      return {
        inventoryExists: false,
        offers: [],
        sku,
      };
    }

    throw error;
  }
}

function buildPlan(selection: {
  candidateSkus: string[];
  from?: number;
  prefixes: string[];
  skus: string[];
  sourceMode: SandboxCleanupSourceMode;
  to?: number;
}, inspections: SandboxCleanupCandidateInspection[]): SandboxCleanupPlan {
  const candidateSkus = selection.candidateSkus;
  const foundSkus = inspections.filter((inspection) => inspection.inventoryExists).map((inspection) => inspection.sku);
  const missingSkus = inspections.filter((inspection) => !inspection.inventoryExists).map((inspection) => inspection.sku);
  const offersBySku = candidateSkus.reduce<Record<string, SandboxCleanupOfferSummary[]>>((accumulator, sku) => {
    accumulator[sku] = inspections.find((inspection) => inspection.sku === sku)?.offers ?? [];
    return accumulator;
  }, {});

  return {
    candidateCount: candidateSkus.length,
    candidateSkus,
    foundSkus,
    from: selection.from,
    missingSkus,
    offersBySku,
    prefixes: selection.prefixes,
    skus: selection.skus,
    sourceMode: selection.sourceMode,
    to: selection.to,
  };
}

async function resolveExplicitPlan(
  api: Pick<EbaySellerApi, 'inventory'>,
  candidateSkus: string[]
): Promise<{ candidateSkus: string[]; inspections: SandboxCleanupCandidateInspection[] }> {
  const inspections: SandboxCleanupCandidateInspection[] = [];

  for (const sku of candidateSkus) {
    inspections.push(
      await inspectCandidateSku(api, sku, {
        probeInventoryIfNoOffers: true,
      })
    );
  }

  return {
    candidateSkus,
    inspections,
  };
}

export async function resolveSandboxCleanupApi(
  dependencies: Partial<SandboxCleanupDependencies>
): Promise<Pick<EbaySellerApi, 'inventory' | 'trading'>> {
  if (dependencies.api) {
    return dependencies.api;
  }

  const { EbaySellerApi } = await import('@/api/index.js');
  const { getEbayConfig } = await import('@/config/environment.js');
  const api = new EbaySellerApi(getEbayConfig());
  await api.initialize();
  return api;
}

async function resolveSandboxCleanupResolvedPlanWithApi(
  selection: SandboxCleanupSelection,
  api: Pick<EbaySellerApi, 'inventory' | 'trading'>
): Promise<SandboxCleanupResolvedPlan> {
  if (!isSandboxEnvironment()) {
    throw new Error('EBAY_ENVIRONMENT must be set to "sandbox" before running sandbox cleanup.');
  }

  const resolvedCandidates =
    selection.sourceMode === 'range'
      ? await resolveExplicitPlan(api, buildGeneratedSkus(selection.prefixes, selection.from!, selection.to!))
      : await resolveExplicitPlan(api, selection.skus);

  const plan = buildPlan(
    {
      candidateSkus: resolvedCandidates.candidateSkus,
      from: selection.from,
      prefixes: selection.prefixes,
      skus: selection.skus,
      sourceMode: selection.sourceMode,
      to: selection.to,
    },
    resolvedCandidates.inspections
  );

  return {
    ...plan,
    inspections: resolvedCandidates.inspections,
  };
}

function buildDeleteOutcome(inspection: SandboxCleanupCandidateInspection): SandboxCleanupDeleteOutcome {
  if (!inspection.inventoryExists) {
    return {
      deletedInventoryItem: false,
      deletedOffers: [],
      errors: [],
      sku: inspection.sku,
      skippedMissing: [`inventory:${inspection.sku}`],
      status: 'skipped',
    };
  }

  return {
    deletedInventoryItem: false,
    deletedOffers: [],
    errors: [],
    sku: inspection.sku,
    skippedMissing: [],
    status: 'deleted',
  };
}

export async function performSandboxCleanup(
  api: Pick<EbaySellerApi, 'inventory' | 'trading'>,
  inspections: SandboxCleanupCandidateInspection[]
): Promise<SandboxCleanupDeleteOutcome[]> {
  const outcomes: SandboxCleanupDeleteOutcome[] = [];

  for (const inspection of inspections) {
    const outcome = buildDeleteOutcome(inspection);

    if (!inspection.inventoryExists) {
      outcomes.push(outcome);
      continue;
    }

    let performedDelete = false;

    for (const offer of inspection.offers) {
      const offerId = offer.offerId;
      if (!offerId) {
        outcome.skippedMissing.push(`offer:${offer.sku}:missing-offer-id`);
        continue;
      }

      const listingId = offer.listingId;
      const offerStatus = offer.status?.toUpperCase();

      if (listingId && offerStatus === 'PUBLISHED') {
        try {
          await api.trading.endListing(listingId);
        } catch (error) {
          if (!isMissingResourceError(error)) {
            outcome.errors.push(
              `endListing(${listingId}) failed: ${error instanceof Error ? error.message : String(error)}`
            );
          } else {
            outcome.skippedMissing.push(`listing:${listingId}`);
          }
        }
      }

      try {
        await api.inventory.deleteOffer(offerId);
        outcome.deletedOffers.push(offerId);
        performedDelete = true;
      } catch (error) {
        if (isMissingResourceError(error)) {
          outcome.skippedMissing.push(`offer:${offerId}`);
          continue;
        }

        outcome.errors.push(
          `deleteOffer(${offerId}) failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    try {
      await api.inventory.deleteInventoryItem(inspection.sku);
      outcome.deletedInventoryItem = true;
      performedDelete = true;
    } catch (error) {
      if (isMissingResourceError(error)) {
        outcome.skippedMissing.push(`inventory:${inspection.sku}`);
      } else {
        outcome.errors.push(
          `deleteInventoryItem(${inspection.sku}) failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    if (outcome.errors.length > 0) {
      outcome.status = 'failed';
    } else if (performedDelete) {
      outcome.status = 'deleted';
    } else {
      outcome.status = 'skipped';
    }

    outcomes.push(outcome);
  }

  return outcomes;
}

export async function resolveSandboxCleanupPlan(
  input: SandboxCleanupInput = {},
  dependencies: Partial<SandboxCleanupDependencies> = {}
): Promise<SandboxCleanupResolvedPlan> {
  if (!isSandboxEnvironment()) {
    throw new Error('EBAY_ENVIRONMENT must be set to "sandbox" before running sandbox cleanup.');
  }

  const selection = resolveSourceSelection(input);
  const api = await resolveSandboxCleanupApi(dependencies);
  return await resolveSandboxCleanupResolvedPlanWithApi(selection, api);
}

export async function runSandboxCleanup(
  input: SandboxCleanupInput = {},
  dependencies: Partial<SandboxCleanupDependencies> = {}
): Promise<SandboxCleanupRunResult> {
  if (!isSandboxEnvironment()) {
    throw new Error('EBAY_ENVIRONMENT must be set to "sandbox" before running sandbox cleanup.');
  }

  const selection = resolveSourceSelection(input);

  if (!input.delete) {
    const api = await resolveSandboxCleanupApi(dependencies);
    const { inspections: _inspections, ...plan } = await resolveSandboxCleanupResolvedPlanWithApi(
      selection,
      api
    );
    return {
      ...plan,
      mode: 'dry-run',
      outcomes: [],
      success: true,
    };
  }

  if (!input.confirmSandboxCleanup) {
    throw new Error('Destructive sandbox cleanup requires --confirm-sandbox-cleanup.');
  }

  const api = await resolveSandboxCleanupApi(dependencies);
  const { inspections, ...plan } = await resolveSandboxCleanupResolvedPlanWithApi(selection, api);
  const outcomes = await performSandboxCleanup(api, inspections);
  const success = outcomes.every((outcome) => outcome.status !== 'failed');

  return {
    ...plan,
    mode: 'delete',
    outcomes,
    success,
  };
}
