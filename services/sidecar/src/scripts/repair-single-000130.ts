#!/usr/bin/env node

import { EbaySellerApi } from '@/api/index.js';
import { getEbayConfig } from '@/config/environment.js';
import { loadRootEnvironment } from '@/config/env-paths.js';
import { getSidecarDataAccess } from '@/data/sidecar-data.js';
import { selectFulfillmentPolicyForListing } from '@/ebay/fulfillment-policy.js';
import { resolvePublishConfig } from '@/ebay/publish-config.js';
import { buildPublishSku, mapListingToOfferPayload } from '@/ebay/publish-mappers.js';
import { buildPublishedListingUpdate } from '@/ebay/published-listing-state.js';

const LISTING_ID = 'Single-000130';
const OFFER_ID = '242845254011';
const SKU = 'BSKBL-Single-000130';
const REQUIRED_PRICE = '0.99';

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected an object response.');
  }

  return value as Record<string, unknown>;
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function getOfferPrice(value: unknown): string | undefined {
  const offer = asRecord(value);
  const pricingSummary = asRecord(offer.pricingSummary);
  const price = asRecord(pricingSummary.price);
  return getString(price.value);
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label} must be ${JSON.stringify(expected)}; received ${JSON.stringify(actual)}.`);
  }
}

function selectOfferFields(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return {};
  }

  const offer = value as Record<string, unknown>;
  return {
    availableQuantity: offer.availableQuantity,
    categoryId: offer.categoryId,
    format: offer.format,
    listing: offer.listing,
    marketplaceId: offer.marketplaceId,
    offerId: offer.offerId,
    pricingSummary: offer.pricingSummary,
    sku: offer.sku,
    status: offer.status,
    tax: offer.tax,
  };
}

async function main(): Promise<void> {
  loadRootEnvironment();

  const data = getSidecarDataAccess();
  const listing = await data.listings.getByListingId(LISTING_ID);
  const jobs = await data.jobs.listByListingId(LISTING_ID);
  const runtimeConfig = getEbayConfig();
  const api = new EbaySellerApi(runtimeConfig);
  await api.initialize();
  const offer = await api.inventory.getOffer(OFFER_ID);
  const offersForSku = await api.inventory.getOffers(SKU, runtimeConfig.marketplaceId, 25);
  const orderedJobs = [...jobs].sort((left, right) =>
    right.created_at.localeCompare(left.created_at)
  );

  const execute = process.argv.slice(2).includes('--execute');
  let result: Record<string, unknown> | undefined;

  if (execute) {
    if (!listing) {
      throw new Error(`Listing ${LISTING_ID} was not found.`);
    }

    assertEqual(runtimeConfig.environment, 'production', 'Runtime environment');
    assertEqual(listing.listing_id, LISTING_ID, 'Listing ID');
    assertEqual(listing.price?.toFixed(2), REQUIRED_PRICE, 'Local price');
    assertEqual(listing.status, 'needs_review', 'Local status');
    assertEqual(listing.sub_status, 'review_pending', 'Local sub-status');
    assertEqual(listing.sku, SKU, 'Local SKU');
    assertEqual(listing.ebay_offer_id, OFFER_ID, 'Local offer ID');
    assertEqual(listing.ebay_listing_id, null, 'Local listing ID trace');
    assertEqual(listing.ebay_listing_status, null, 'Local listing status trace');
    assertEqual(listing.ebay_listing_url, null, 'Local listing URL trace');
    assertEqual(listing.exported_at, null, 'Local exported-at trace');

    const activeJobs = jobs.filter((job) => job.status === 'queued' || job.status === 'running');
    assertEqual(activeJobs.length, 0, 'Active job count');

    const offerRecord = asRecord(offer);
    assertEqual(getString(offerRecord.offerId), OFFER_ID, 'Remote offer ID');
    assertEqual(getString(offerRecord.sku), SKU, 'Remote offer SKU');
    assertEqual(getString(offerRecord.status), 'UNPUBLISHED', 'Remote offer status');
    assertEqual(getString(offerRecord.marketplaceId), 'EBAY_US', 'Remote marketplace');
    assertEqual(getString(offerRecord.format), 'FIXED_PRICE', 'Remote offer format');
    assertEqual(offerRecord.listing, undefined, 'Remote listing trace');
    assertEqual(getOfferPrice(offer), '0.95', 'Remote pre-repair price');

    const matchingOffers = (offersForSku.offers ?? []).filter(
      (entry) => getString(entry.sku) === SKU
    );
    assertEqual(matchingOffers.length, 1, 'Remote offer count for exact SKU');
    assertEqual(getString(matchingOffers[0]?.offerId), OFFER_ID, 'Remote SKU offer ID');

    const appSettings = await data.appSettings.get();
    if (!appSettings) {
      throw new Error('App settings were not found.');
    }

    const configResult = resolvePublishConfig(appSettings, {
      environment: runtimeConfig.environment,
      runtimeMarketplaceId: runtimeConfig.marketplaceId,
    });
    if (!configResult.config) {
      throw new Error(`Production publish config is invalid: ${configResult.issues.join(' ')}`);
    }

    const sku = buildPublishSku(listing);
    assertEqual(sku, SKU, 'Rebuilt SKU');
    const selectedConfig = selectFulfillmentPolicyForListing(listing, configResult.config);
    const offerPayload = mapListingToOfferPayload(listing, selectedConfig, sku);
    assertEqual(offerPayload.pricingSummary?.price?.value, REQUIRED_PRICE, 'Outbound offer price');
    assertEqual(offerPayload.pricingSummary?.price?.currency, 'USD', 'Outbound offer currency');
    assertEqual(offerPayload.sku, SKU, 'Outbound offer SKU');
    assertEqual(offerPayload.marketplaceId, 'EBAY_US', 'Outbound marketplace');

    const remotePolicies = asRecord(offerRecord.listingPolicies);
    assertEqual(offerRecord.hideBuyerDetails, false, 'Remote hide-buyer-details option');
    assertEqual(
      offerRecord.includeCatalogProductDetails,
      true,
      'Remote include-catalog-product-details option'
    );
    assertEqual(remotePolicies.eBayPlusIfEligible, false, 'Remote eBay Plus option');
    assertEqual(JSON.stringify(offerRecord.tax), JSON.stringify({ applyTax: false }), 'Remote tax option');

    // updateOffer is a complete replacement. Rebuild local/config-owned fields and
    // explicitly retain the writable optional fields present on the current draft.
    const updatePayload = {
      ...offerPayload,
      hideBuyerDetails: offerRecord.hideBuyerDetails,
      includeCatalogProductDetails: offerRecord.includeCatalogProductDetails,
      listingPolicies: {
        ...offerPayload.listingPolicies,
        eBayPlusIfEligible: remotePolicies.eBayPlusIfEligible,
      },
      tax: offerRecord.tax,
    };

    await api.inventory.updateOffer(OFFER_ID, updatePayload);
    const updatedOffer = await api.inventory.getOffer(OFFER_ID);
    assertEqual(getOfferPrice(updatedOffer), REQUIRED_PRICE, 'Updated remote offer price');
    assertEqual(getString(asRecord(updatedOffer).status), 'UNPUBLISHED', 'Updated remote offer status');
    assertEqual(getString(asRecord(updatedOffer).sku), SKU, 'Updated remote offer SKU');

    const publishResponse = await api.inventory.publishOffer(OFFER_ID);
    const ebayListingId = getString(publishResponse.listingId);
    if (!ebayListingId) {
      throw new Error('Published offer response did not contain a listing ID.');
    }

    const exportedAt = new Date().toISOString();
    await data.listings.update(
      LISTING_ID,
      buildPublishedListingUpdate({
        appSettings,
        ebayListingId,
        ebayOfferId: OFFER_ID,
        exportedAt,
        sku,
      })
    );

    const finalListing = await data.listings.getByListingId(LISTING_ID);
    const finalOffer = await api.inventory.getOffer(OFFER_ID);
    assertEqual(finalListing?.status, 'exported', 'Final local status');
    assertEqual(finalListing?.sub_status, 'idle', 'Final local sub-status');
    assertEqual(finalListing?.ebay_offer_id, OFFER_ID, 'Final local offer ID');
    assertEqual(finalListing?.ebay_listing_id, ebayListingId, 'Final local eBay listing ID');
    assertEqual(finalListing?.last_error_code, null, 'Final local error code');
    assertEqual(getOfferPrice(finalOffer), REQUIRED_PRICE, 'Final remote listing price');
    assertEqual(getString(asRecord(finalOffer).status), 'PUBLISHED', 'Final remote offer status');
    assertEqual(
      getString(asRecord(asRecord(finalOffer).listing).listingId),
      ebayListingId,
      'Final remote listing ID'
    );

    result = {
      ebayListingId,
      listing: finalListing && {
        ebayListingId: finalListing.ebay_listing_id,
        ebayListingStatus: finalListing.ebay_listing_status,
        ebayListingUrl: finalListing.ebay_listing_url,
        ebayOfferId: finalListing.ebay_offer_id,
        exportedAt: finalListing.exported_at,
        lastErrorCode: finalListing.last_error_code,
        listingId: finalListing.listing_id,
        price: finalListing.price,
        sku: finalListing.sku,
        status: finalListing.status,
        subStatus: finalListing.sub_status,
      },
      offer: selectOfferFields(finalOffer),
      path: 'update-existing-draft-and-publish',
    };
  }

  console.log(
    JSON.stringify(
      {
        activeJobs: orderedJobs
          .filter((job) => job.status === 'queued' || job.status === 'running')
          .map((job) => ({
            id: job.id,
            jobType: job.job_type,
            nextRunAt: job.next_run_at,
            status: job.status,
          })),
        jobs: orderedJobs.slice(0, 10).map((job) => ({
          attempts: job.attempts,
          createdAt: job.created_at,
          errorAt: job.last_error_at,
          errorCode: job.last_error_code,
          errorMessage: job.last_error,
          id: job.id,
          jobType: job.job_type,
          maxAttempts: job.max_attempts,
          nextRunAt: job.next_run_at,
          status: job.status,
          updatedAt: job.updated_at,
        })),
        listing: listing && {
          ebayListingId: listing.ebay_listing_id,
          ebayListingStatus: listing.ebay_listing_status,
          ebayListingUrl: listing.ebay_listing_url,
          ebayOfferId: listing.ebay_offer_id,
          exportedAt: listing.exported_at,
          lastErrorAt: listing.last_error_at,
          lastErrorCode: listing.last_error_code,
          lastErrorMessage: listing.last_error_message,
          listingId: listing.listing_id,
          price: listing.price,
          sku: listing.sku,
          status: listing.status,
          subStatus: listing.sub_status,
          updatedAt: listing.updated_at,
        },
        offer: selectOfferFields(offer),
        offersForSku: (offersForSku.offers ?? []).map(selectOfferFields),
        result,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
