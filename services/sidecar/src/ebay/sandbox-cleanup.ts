import type { EbaySellerApi } from '@/api/index.js';
import { EbayApiRequestError } from '@/api/client.js';

export const DEFAULT_SANDBOX_CLEANUP_PREFIXES = ['Single-', 'Lot-'] as const;

export type SandboxCleanupMode = 'dry-run' | 'delete';

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

export interface SandboxCleanupTarget {
  inventoryItem: SandboxCleanupInventoryItemSummary;
  offers: SandboxCleanupOfferSummary[];
}

export interface SandboxCleanupSkuOutcome {
  deletedInventoryItem: boolean;
  deletedOffers: string[];
  errors: string[];
  sku: string;
  skippedMissing: string[];
  status: 'dry-run' | 'deleted' | 'failed';
}

export interface SandboxCleanupReport {
  matchedSkus: string[];
  mode: SandboxCleanupMode;
  outcomes: SandboxCleanupSkuOutcome[];
  prefixes: string[];
  success: boolean;
  targets: SandboxCleanupTarget[];
}

export interface SandboxCleanupDependencies {
  api: Pick<EbaySellerApi, 'inventory' | 'trading'>;
}

export interface SandboxCleanupInput {
  confirmSandboxCleanup?: boolean;
  delete?: boolean;
  prefixes?: string[];
}

function isSandboxEnvironment(): boolean {
  return process.env.EBAY_ENVIRONMENT === 'sandbox';
}

function normalizePrefix(prefix: string): string {
  return prefix.trim();
}

function hasPrefix(sku: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => sku.startsWith(prefix));
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

function isMissingResourceError(error: unknown): boolean {
  const statusCode = getStatusCode(error);
  if (statusCode === 404 || statusCode === 410) {
    return true;
  }

  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes('not found') || message.includes('404');
}

function getOfferStatus(offer: Record<string, unknown>): string | undefined {
  return getTrimmedString(offer.status);
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
    status: getOfferStatus(offer),
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

async function listInventoryItems(
  api: Pick<EbaySellerApi, 'inventory'>,
  prefixes: string[]
): Promise<SandboxCleanupTarget[]> {
  const pageSize = 200;
  const targetsBySku = new Map<string, SandboxCleanupTarget>();
  let offset = 0;

  while (true) {
    const response = await api.inventory.getInventoryItems(pageSize, offset);
    const inventoryItems = toRecordArray(response.inventoryItems);

    for (const item of inventoryItems) {
      const sku = getTrimmedString(item.sku);
      if (!sku || !hasPrefix(sku, prefixes) || targetsBySku.has(sku)) {
        continue;
      }

      targetsBySku.set(sku, {
        inventoryItem: { sku },
        offers: [],
      });
    }

    const pageSizeReturned = inventoryItems.length;
    const total = typeof response.total === 'number' && Number.isFinite(response.total) ? response.total : undefined;

    if (pageSizeReturned === 0) {
      break;
    }

    offset += pageSizeReturned;

    if (total !== undefined && offset >= total) {
      break;
    }
  }

  return Array.from(targetsBySku.values()).sort((left, right) =>
    left.inventoryItem.sku.localeCompare(right.inventoryItem.sku)
  );
}

async function attachOffers(
  api: Pick<EbaySellerApi, 'inventory'>,
  targets: SandboxCleanupTarget[]
): Promise<SandboxCleanupTarget[]> {
  const resolvedTargets: SandboxCleanupTarget[] = [];

  for (const target of targets) {
    const response = await api.inventory.getOffers(target.inventoryItem.sku);
    const offers = toRecordArray(response.offers)
      .map(getOfferSummary)
      .filter((offer): offer is SandboxCleanupOfferSummary => offer !== undefined)
      .sort((left, right) => (left.offerId ?? '').localeCompare(right.offerId ?? ''));

    resolvedTargets.push({
      inventoryItem: target.inventoryItem,
      offers,
    });
  }

  return resolvedTargets;
}

async function deleteOfferBySku(
  api: Pick<EbaySellerApi, 'inventory' | 'trading'>,
  target: SandboxCleanupTarget
): Promise<SandboxCleanupSkuOutcome> {
  const outcome: SandboxCleanupSkuOutcome = {
    deletedInventoryItem: false,
    deletedOffers: [],
    errors: [],
    sku: target.inventoryItem.sku,
    skippedMissing: [],
    status: 'deleted',
  };

  for (const offer of target.offers) {
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
    await api.inventory.deleteInventoryItem(target.inventoryItem.sku);
    outcome.deletedInventoryItem = true;
  } catch (error) {
    if (isMissingResourceError(error)) {
      outcome.skippedMissing.push(`inventory:${target.inventoryItem.sku}`);
    } else {
      outcome.errors.push(
        `deleteInventoryItem(${target.inventoryItem.sku}) failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  if (outcome.errors.length > 0) {
    outcome.status = 'failed';
  }

  return outcome;
}

async function resolveSandboxCleanupApi(
  dependencies: Partial<SandboxCleanupDependencies>
): Promise<Pick<EbaySellerApi, 'inventory' | 'trading'>> {
  if (dependencies.api) {
    return dependencies.api;
  }

  const { EbaySellerApi } = await import('@/api/index.js');
  const { getEbayConfig } = await import('@/config/environment.js');
  const client = new EbaySellerApi(getEbayConfig());
  await client.initialize();
  return client;
}

export async function collectSandboxCleanupTargets(
  api: Pick<EbaySellerApi, 'inventory'>,
  prefixes: string[]
): Promise<SandboxCleanupTarget[]> {
  const normalizedPrefixes = prefixes.map(normalizePrefix).filter((prefix) => prefix.length > 0);
  const targets = await listInventoryItems(api, normalizedPrefixes);
  return await attachOffers(api, targets);
}

export async function runSandboxCleanup(
  input: SandboxCleanupInput = {},
  dependencies: Partial<SandboxCleanupDependencies> = {}
): Promise<SandboxCleanupReport> {
  if (!isSandboxEnvironment()) {
    throw new Error('EBAY_ENVIRONMENT must be set to "sandbox" before running sandbox cleanup.');
  }

  const prefixes = (input.prefixes?.length ? input.prefixes : [...DEFAULT_SANDBOX_CLEANUP_PREFIXES]).map(
    normalizePrefix
  );

  if (prefixes.some((prefix) => prefix.length === 0)) {
    throw new Error('Prefix values must be non-empty strings.');
  }

  if (input.delete && !input.confirmSandboxCleanup) {
    throw new Error('Destructive sandbox cleanup requires --confirm-sandbox-cleanup.');
  }

  const api = await resolveSandboxCleanupApi(dependencies);
  const targets = await collectSandboxCleanupTargets(api, prefixes);
  const dryRun = !input.delete;

  if (dryRun) {
    return {
      matchedSkus: targets.map((target) => target.inventoryItem.sku),
      mode: 'dry-run',
      outcomes: targets.map((target) => ({
        deletedInventoryItem: false,
        deletedOffers: [],
        errors: [],
        sku: target.inventoryItem.sku,
        skippedMissing: [],
        status: 'dry-run',
      })),
      prefixes,
      success: true,
      targets,
    };
  }

  const outcomes: SandboxCleanupSkuOutcome[] = [];
  for (const target of targets) {
    outcomes.push(await deleteOfferBySku(api, target));
  }

  return {
    matchedSkus: targets.map((target) => target.inventoryItem.sku),
    mode: 'delete',
    outcomes,
    prefixes,
    success: outcomes.every((outcome) => outcome.status !== 'failed'),
    targets,
  };
}

export async function performSandboxCleanup(
  api: Pick<EbaySellerApi, 'inventory' | 'trading'>,
  targets: SandboxCleanupTarget[]
): Promise<SandboxCleanupSkuOutcome[]> {
  const outcomes: SandboxCleanupSkuOutcome[] = [];

  for (const target of targets) {
    outcomes.push(await deleteOfferBySku(api, target));
  }

  return outcomes;
}
