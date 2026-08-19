import type { ListingRow } from '@ebay-inventory/data';
import type { ResolvedPublishConfig } from '@/ebay/publish-config.js';
import { isStructurallyEseEligibleListing } from '@/listings/trading-card-conditions.js';

export function selectFulfillmentPolicyForListing(
  listing: Pick<
    ListingRow,
    'category_id' | 'condition_id' | 'ese_eligible' | 'listing_type' | 'price'
  >,
  config: ResolvedPublishConfig
): ResolvedPublishConfig {
  const outboundPrice =
    typeof listing.price === 'number' && Number.isFinite(listing.price)
      ? Number(listing.price.toFixed(2))
      : Number.NaN;
  const usesCombinedPolicy =
    listing.ese_eligible === true &&
    isStructurallyEseEligibleListing(listing) &&
    outboundPrice > 0 &&
    outboundPrice < 20;

  return {
    ...config,
    fulfillmentPolicyId: usesCombinedPolicy
      ? config.combinedFulfillmentPolicyId
      : config.groundFulfillmentPolicyId,
  };
}
