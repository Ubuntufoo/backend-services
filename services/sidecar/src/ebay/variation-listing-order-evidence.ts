import type { components } from '@/types/sell-apps/order-management/sellFulfillmentV1Oas3.js';

export type FulfillmentOrder = components['schemas']['Order'];
export type FulfillmentLineItem = components['schemas']['LineItem'];

/** The fields required to identify and match one purchased order line. */
export interface VariationOrderLineEvidence {
  orderId: string;
  lineItemId: string;
  sku: string;
  quantity: number;
  idempotencyKey: string;
}

/** Sanitized order evidence. No buyer, payment, shipping, title, or pricing fields are retained. */
export interface VariationOrderEvidence {
  orderId: string;
  lines: readonly VariationOrderLineEvidence[];
}

export interface LocalVariationIndexEntry {
  sku: string;
}

export type LocalVariationCollection = readonly (string | LocalVariationIndexEntry)[];

export type VariationOrderLineMatchStatus = 'matched' | 'unresolved' | 'ambiguous';

const MAX_FULFILLMENT_QUANTITY = 2_147_483_647;

export interface VariationOrderLineMatch extends VariationOrderLineEvidence {
  status: VariationOrderLineMatchStatus;
  /** Set only when exactly one local variation owns the SKU. */
  localVariationSku?: string;
  reason?: 'sku_not_in_local_variations' | 'duplicate_local_sku';
}

export interface VariationOrderMatch {
  orderId: string;
  lines: readonly VariationOrderLineMatch[];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function requiredString(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Fulfillment ${field} is missing or invalid.`);
  }
  // Validation may inspect whitespace, but identity values are never normalized.
  return value;
}

function requiredQuantity(record: Record<string, unknown>): number {
  const value = record.quantity;
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > MAX_FULFILLMENT_QUANTITY
  ) {
    throw new Error('Fulfillment quantity must be a positive int32.');
  }
  return value;
}

/**
 * Build the stable order-line identity proposed for YP8.2.
 * The tuple is encoded as JSON so delimiter characters in either eBay ID cannot collide.
 */
export function getVariationOrderLineIdempotencyKey(orderId: string, lineItemId: string): string {
  return JSON.stringify([orderId, lineItemId]);
}

function parseLine(orderId: string, value: unknown): VariationOrderLineEvidence {
  const line = asRecord(value);
  if (!line) throw new Error('Fulfillment line item is missing or invalid.');
  const lineItemId = requiredString(line, 'lineItemId');
  const sku = requiredString(line, 'sku');
  const quantity = requiredQuantity(line);
  return {
    orderId,
    lineItemId,
    sku,
    quantity,
    idempotencyKey: getVariationOrderLineIdempotencyKey(orderId, lineItemId),
  };
}

/**
 * Parse an unknown or generated Fulfillment Order into deterministic, sanitized evidence.
 * Missing required identity fields, malformed quantities, and duplicate line IDs fail closed.
 * Lines are sorted by exact lineItemId so response ordering cannot affect evidence.
 */
export function parseVariationOrderEvidence(payload: FulfillmentOrder): VariationOrderEvidence;
export function parseVariationOrderEvidence(payload: unknown): VariationOrderEvidence;
export function parseVariationOrderEvidence(payload: unknown): VariationOrderEvidence {
  const order = asRecord(payload);
  if (!order) throw new Error('Fulfillment order is missing or invalid.');
  const orderId = requiredString(order, 'orderId');
  const rawLines = order.lineItems;
  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    throw new Error('Fulfillment lineItems is missing or empty.');
  }

  const lines = rawLines.map((line) => parseLine(orderId, line));
  const lineIds = new Set<string>();
  for (const line of lines) {
    if (lineIds.has(line.lineItemId)) {
      throw new Error(`Fulfillment order contains duplicate lineItemId: ${line.lineItemId}.`);
    }
    lineIds.add(line.lineItemId);
  }

  lines.sort((left, right) =>
    left.lineItemId < right.lineItemId ? -1 : left.lineItemId > right.lineItemId ? 1 : 0
  );
  return { orderId, lines };
}

function localSku(value: string | LocalVariationIndexEntry): string {
  return typeof value === 'string' ? value : value.sku;
}

/** Match each order line against an explicitly supplied local variation SKU collection. */
export function matchVariationOrderEvidence(
  evidence: VariationOrderEvidence,
  localVariations: LocalVariationCollection
): VariationOrderMatch {
  const lines = evidence.lines.map((line): VariationOrderLineMatch => {
    const matches = localVariations.filter((variation) => localSku(variation) === line.sku);
    if (matches.length === 1) {
      return { ...line, status: 'matched', localVariationSku: line.sku };
    }
    if (matches.length > 1) {
      return { ...line, status: 'ambiguous', reason: 'duplicate_local_sku' };
    }
    return { ...line, status: 'unresolved', reason: 'sku_not_in_local_variations' };
  });
  return { orderId: evidence.orderId, lines };
}

/** Convenience matcher for one already-parsed order line. */
export function matchVariationOrderLine(
  line: VariationOrderLineEvidence,
  localVariations: LocalVariationCollection
): VariationOrderLineMatch {
  return matchVariationOrderEvidence({ orderId: line.orderId, lines: [line] }, localVariations)
    .lines[0];
}


/** Read-only, bounded proof for destructive removed-SKU retirement.
 * eBay Fulfillment searches are seller-wide and expose at most two years of
 * orders. A group outside that visibility window requires manual review. */
export interface RemovedSkuOrderSafety {
  complete: true;
  openTargetLines: number;
  fulfilledTargetLines: number;
}

export async function readRemovedSkuOrderSafety(
  readOrders: (filter: string, limit: number, offset: number) => Promise<unknown>,
  targetSku: string,
  listingCreatedAt: string,
  now: Date = new Date(),
): Promise<RemovedSkuOrderSafety> {
  const created = Date.parse(listingCreatedAt);
  const oldest = new Date(now);
  oldest.setUTCFullYear(oldest.getUTCFullYear() - 2);
  if (!targetSku || !Number.isFinite(created) || created < oldest.getTime() || created > now.getTime()) {
    throw new Error('Removed-SKU order history is outside the authoritative two-year Fulfillment window.');
  }

  const limit = 200;
  const scan = async (filter: string, permitted: readonly string[]): Promise<{
    count: number;
    inProgressTargetLines: Map<string, number>;
  }> => {
    let total: number | undefined;
    let count = 0;
    const orderIds = new Set<string>();
    const inProgressTargetLines = new Map<string, number>();
    for (let offset = 0; offset < 2000; offset += limit) {
      const raw = await readOrders(filter, limit, offset);
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Fulfillment order page is invalid.');
      const page = raw as Record<string, unknown>;
      if (typeof page.total !== 'number' || !Number.isSafeInteger(page.total) || page.total < 0 ||
          typeof page.offset !== 'number' || !Number.isSafeInteger(page.offset) || page.offset !== offset ||
          typeof page.limit !== 'number' || !Number.isSafeInteger(page.limit) || page.limit !== limit ||
          (total !== undefined && total !== page.total)) {
        throw new Error('Fulfillment order pagination is incomplete or changed during inspection.');
      }
      total = page.total as number;
      const orders = page.orders === undefined && total === 0 ? [] : page.orders;
      if (!Array.isArray(orders) || orders.length !== Math.min(limit, Math.max(total - offset, 0))) {
        throw new Error('Fulfillment order page coverage is incomplete.');
      }
      for (const rawOrder of orders) {
        if (!rawOrder || typeof rawOrder !== 'object' || Array.isArray(rawOrder)) {
          throw new Error('Fulfillment order is malformed.');
        }
        const status = (rawOrder as Record<string, unknown>).orderFulfillmentStatus;
        if (typeof status !== 'string' || !permitted.includes(status)) {
          throw new Error('Fulfillment order status does not match the requested filter.');
        }
        const evidence = parseVariationOrderEvidence(rawOrder);
        if (orderIds.has(evidence.orderId)) throw new Error('Fulfillment pagination contains duplicate order identities.');
        orderIds.add(evidence.orderId);
        for (const line of evidence.lines) {
          if (line.sku !== targetSku) continue;
          if (filter.includes('NOT_STARTED') || status === 'FULFILLED') count += 1;
          if (status === 'IN_PROGRESS') inProgressTargetLines.set(line.idempotencyKey, line.quantity);
        }
      }
      const next = page.next;
      if (next !== undefined && next !== null && typeof next !== 'string') {
        throw new Error('Fulfillment order pagination cursor is invalid.');
      }
      const more = offset + orders.length < total;
      if (more !== (typeof next === 'string' && next.length > 0)) {
        throw new Error('Fulfillment pagination next-page evidence is inconsistent.');
      }
      if (!more) return { count, inProgressTargetLines };
    }
    throw new Error('Fulfillment order history exceeds the bounded inspection capacity.');
  };
  const open = await scan('orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS}', ['NOT_STARTED', 'IN_PROGRESS']);
  const fulfilled = await scan('orderfulfillmentstatus:{FULFILLED|IN_PROGRESS}', ['FULFILLED', 'IN_PROGRESS']);
  if (open.inProgressTargetLines.size !== fulfilled.inProgressTargetLines.size ||
      [...open.inProgressTargetLines].some(([key, quantity]) => fulfilled.inProgressTargetLines.get(key) !== quantity)) {
    throw new Error('Fulfillment IN_PROGRESS target lines changed between safety filter passes.');
  }
  return { complete: true, openTargetLines: open.count, fulfilledTargetLines: fulfilled.count };
}
