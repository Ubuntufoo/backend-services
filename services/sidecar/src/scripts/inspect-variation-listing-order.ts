#!/usr/bin/env node

import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { EbaySellerApi } from '@/api/index.js';
import type { FulfillmentApi } from '@/api/order-management/fulfillment.js';
import { getEbayConfig } from '@/config/environment.js';
import { loadRootEnvironment } from '@/config/env-paths.js';
import { setLogLevel } from '@/utils/logger.js';
import {
  parseVariationOrderEvidence,
  type VariationOrderEvidence,
} from '@/ebay/variation-listing-order-evidence.js';

loadRootEnvironment();

export interface InspectVariationListingOrderArgs {
  orderId?: string;
  filter?: string;
  limit?: number;
  offset?: number;
}

export interface InspectVariationListingOrderApi {
  fulfillment: Pick<FulfillmentApi, 'getOrder' | 'getOrders'>;
}

export interface InspectVariationListingOrderCliSeams {
  apiFactory?: () => Promise<InspectVariationListingOrderApi>;
  print?: (output: string) => void;
}

function requireValue(value: string | undefined, flag: string): string {
  if (!value || value === '--' || value.startsWith('--') || value.trim().length === 0) {
    throw new Error(`${flag} requires a non-empty value.`);
  }
  return value;
}

function parsePositiveInteger(value: string | undefined, flag: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} requires a positive integer.`);
  }
  return parsed;
}

function parseNonNegativeInteger(value: string | undefined, flag: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${flag} requires a non-negative integer.`);
  }
  return parsed;
}

const CLOSED_DATE_FILTER =
  /^(?:creationdate|lastmodifieddate):\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)\.\.(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)\]$/;
const CLOSED_STATUS_FILTERS = new Set([
  'orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS}',
  'orderfulfillmentstatus:{FULFILLED|IN_PROGRESS}',
]);

function parseIsoInstant(value: string): number | undefined {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/.exec(value);
  if (!match) return undefined;
  const milliseconds = (match[2] ?? '').padEnd(3, '0');
  const canonical = `${match[1]}.${milliseconds}Z`;
  const timestamp = Date.parse(canonical);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== canonical) {
    return undefined;
  }
  return timestamp;
}

function isNarrowOrderFilter(value: string): boolean {
  if (CLOSED_STATUS_FILTERS.has(value)) return true;
  const match = CLOSED_DATE_FILTER.exec(value);
  if (!match) return false;
  const start = parseIsoInstant(match[1]);
  const end = parseIsoInstant(match[2]);
  return start !== undefined && end !== undefined && start <= end;
}

/** Parse a GET-only inspection target; broad account-history reads are rejected. */
export function parseInspectVariationListingOrderArgs(
  argv: string[]
): InspectVariationListingOrderArgs {
  const result: InspectVariationListingOrderArgs = {};
  const seen = new Set<string>();

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (seen.has(argument)) throw new Error(`${argument} may be supplied only once.`);
    seen.add(argument);

    if (argument === '--order-id') {
      result.orderId = requireValue(argv[index + 1], '--order-id');
      index += 1;
    } else if (argument === '--filter') {
      const filter = requireValue(argv[index + 1], '--filter');
      if (!isNarrowOrderFilter(filter)) {
        throw new Error(
          '--filter must be a closed creationdate/lastmodifieddate ISO range or a supported orderfulfillmentstatus set.'
        );
      }
      result.filter = filter;
      index += 1;
    } else if (argument === '--limit') {
      result.limit = parsePositiveInteger(argv[index + 1], '--limit');
      if (result.limit > 50) throw new Error('--limit must not exceed 50.');
      index += 1;
    } else if (argument === '--offset') {
      result.offset = parseNonNegativeInteger(argv[index + 1], '--offset');
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (Boolean(result.orderId) === Boolean(result.filter)) {
    throw new Error('Supply exactly one of --order-id or a narrow --filter.');
  }
  if (result.orderId && (result.limit !== undefined || result.offset !== undefined)) {
    throw new Error('--limit and --offset may only be used with --filter.');
  }
  return result;
}

function printEvidence(
  evidence: readonly VariationOrderEvidence[],
  print: (output: string) => void
): void {
  // Deliberately serialize only parser output. Raw eBay responses never reach this function.
  print(JSON.stringify({ orders: evidence }, null, 2));
}

export async function runInspectVariationListingOrderCli(
  argv: string[] = process.argv.slice(2),
  seams: InspectVariationListingOrderCliSeams = {}
): Promise<void> {
  const args = parseInspectVariationListingOrderArgs(argv);
  const apiFactory =
    seams.apiFactory ??
    (async (): Promise<InspectVariationListingOrderApi> => {
      const api = new EbaySellerApi(getEbayConfig());
      await api.initialize();
      return api;
    });
  // This command's stdout is a machine-readable sanitized evidence document. Suppress Winston's
  // console/file chatter before constructing the API (which may initialize OAuth and log reads).
  setLogLevel('silent');
  const api = await apiFactory();

  const orders = args.orderId
    ? [await api.fulfillment.getOrder(args.orderId)]
    : ((await api.fulfillment.getOrders(args.filter, args.limit ?? 10, args.offset)).orders ?? []);
  const evidence = orders.map((order) => parseVariationOrderEvidence(order));
  printEvidence(evidence, seams.print ?? console.log);
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
const modulePath = resolve(fileURLToPath(import.meta.url));

if (entryPath && modulePath === entryPath) {
  runInspectVariationListingOrderCli().catch(() => {
    console.error('Variation order inspection failed; no raw order payload was emitted.');
    /* eslint-disable-next-line n/no-process-exit -- CLI entry should exit non-zero on failure */
    process.exit(1);
  });
}
