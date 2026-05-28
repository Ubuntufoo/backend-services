#!/usr/bin/env node

import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { loadRootEnvironment } from '@/config/env-paths.js';
import { reconcilePublishedListing } from '@/ebay/reconcile-published-listing.js';

loadRootEnvironment();

function parseArgs(argv: string[]): { listingId?: string; offerId?: string } {
  let listingId: string | undefined;
  let offerId: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];

    if (current === '--') {
      continue;
    }

    if (current === '--listing-id') {
      listingId = argv[index + 1];
      index += 1;
      continue;
    }

    if (current === '--offer-id') {
      offerId = argv[index + 1];
      index += 1;
      continue;
    }
  }

  return { listingId, offerId };
}

export async function runReconcilePublishedListingCli(
  argv: string[] = process.argv.slice(2)
): Promise<void> {
  const result = await reconcilePublishedListing(parseArgs(argv));

  console.log(
    JSON.stringify(
      {
        ebayListingId: result.ebayListingId,
        exportedAt: result.exportedAt,
        listingId: result.listing.listing_id,
        offer: result.offer,
        offerId: result.offerId,
        reason: result.reason,
        reconciled: result.reconciled,
      },
      null,
      2
    )
  );
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
const modulePath = resolve(fileURLToPath(import.meta.url));

if (entryPath && modulePath === entryPath) {
  runReconcilePublishedListingCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    /* eslint-disable-next-line n/no-process-exit -- CLI entry should exit non-zero on failure */
    process.exit(1);
  });
}
