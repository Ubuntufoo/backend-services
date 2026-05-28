#!/usr/bin/env node

import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { EbaySellerApi } from '@/api/index.js';
import { getEbayConfig } from '@/config/environment.js';
import { loadRootEnvironment } from '@/config/env-paths.js';
import { buildOfferDiagnostic } from '@/ebay/offer-diagnostic.js';

loadRootEnvironment();

function parseOfferId(argv: string[]): string {
  const offerId = argv.find((value) => value !== '--');

  if (!offerId) {
    throw new Error('Usage: pnpm ebay:diagnose-offer -- <offerId>');
  }

  return offerId;
}

export async function runDiagnoseOfferCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const offerId = parseOfferId(argv);
  const api = new EbaySellerApi(getEbayConfig());
  await api.initialize();

  const offer = await api.inventory.getOffer(offerId);
  console.log(JSON.stringify(buildOfferDiagnostic(offer), null, 2));
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
const modulePath = resolve(fileURLToPath(import.meta.url));

if (entryPath && modulePath === entryPath) {
  runDiagnoseOfferCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    /* eslint-disable-next-line n/no-process-exit -- CLI entry should exit non-zero on failure */
    process.exit(1);
  });
}
