import type { ListingRow } from '@ebay-inventory/data';
import { isDeepStrictEqual } from 'node:util';
import type { AccountApi } from '@/api/account-management/account.js';
import type { components } from '@/types/sell-apps/account-management/sellAccountV1Oas3.js';
import type { ResolvedPublishConfig } from '@/ebay/publish-config.js';
import { isStructurallyEseEligibleListing } from '@/listings/trading-card-conditions.js';

type FulfillmentPolicy = components['schemas']['FulfillmentPolicy'];
type FulfillmentPolicyRequest = components['schemas']['FulfillmentPolicyRequest'];
type ShippingOption = components['schemas']['ShippingOption'];
type ShippingService = components['schemas']['ShippingService'];
export const GROUND_FULFILLMENT_POLICY_NAME = '$6.49 Domestic Shipping - 5 Day';
export const COMBINED_FULFILLMENT_POLICY_NAME = 'eSE + USPS Ground Advantage';

const ESE_SHIPPING_SERVICE_CODE = 'US_eBayStandardEnvelope';
const GROUND_ADVANTAGE_SHIPPING_SERVICE_CODE = 'USPSParcel';
const GROUND_ADVANTAGE_CARRIER_CODE = 'USPS';
const PICKUP_SHIPPING_SERVICE_CODE = 'Pickup';

type CombinedPolicyApi = Pick<
  AccountApi,
  'createFulfillmentPolicy' | 'getFulfillmentPolicies' | 'getFulfillmentPolicy'
>;

export interface CombinedFulfillmentPolicySetupResult {
  combinedFulfillmentPolicyId: string | null;
  groundFulfillmentPolicyId: string;
  status: 'created' | 'resolved' | 'would_create';
}

function hasText(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function getDomesticOption(policy: FulfillmentPolicy, label: string): ShippingOption {
  const options = (policy.shippingOptions ?? []).filter(
    (option) => option.optionType?.trim().toUpperCase() === 'DOMESTIC'
  );

  if (options.length !== 1 || !options[0]?.shippingServices?.length) {
    throw new Error(`${label} must contain exactly one DOMESTIC option with shipping services.`);
  }

  return options[0];
}

function comparableOption(option: ShippingOption): Omit<ShippingOption, 'shippingServices'> {
  const { shippingServices: _shippingServices, ...rest } = option;
  return rest;
}

function getUniqueShippingService(
  services: ShippingService[],
  predicate: (service: ShippingService) => boolean,
  label: string
): ShippingService {
  const matches = services.filter(predicate);
  if (matches.length !== 1) {
    throw new Error(`${label} must be uniquely identified; found ${matches.length}.`);
  }

  return matches[0];
}

function isGroundAdvantageService(service: ShippingService): boolean {
  return (
    service.shippingServiceCode === GROUND_ADVANTAGE_SHIPPING_SERVICE_CODE &&
    service.shippingCarrierCode?.trim().toUpperCase() === GROUND_ADVANTAGE_CARRIER_CODE
  );
}

function isFreePickupService(service: ShippingService): boolean {
  if (service.shippingServiceCode !== PICKUP_SHIPPING_SERVICE_CODE) {
    return false;
  }

  if (service.freeShipping === true) {
    return true;
  }

  const value = service.shippingCost?.value?.trim();
  return value === undefined
    ? service.freeShipping !== false
    : Number.isFinite(Number(value)) && Number(value) === 0;
}

export function buildCombinedFulfillmentPolicyRequest(input: {
  esePolicy: FulfillmentPolicy;
  groundPolicy: FulfillmentPolicy;
  name?: string;
}): FulfillmentPolicyRequest {
  const esePolicy = clone(input.esePolicy);
  const groundPolicy = clone(input.groundPolicy);
  const eseDomestic = getDomesticOption(esePolicy, 'Configured eSE fulfillment policy');
  const groundDomestic = getDomesticOption(
    groundPolicy,
    `Fulfillment policy "${GROUND_FULFILLMENT_POLICY_NAME}"`
  );

  if (!isDeepStrictEqual(comparableOption(eseDomestic), comparableOption(groundDomestic))) {
    throw new Error('Source fulfillment policies have incompatible DOMESTIC option configuration.');
  }

  if (!hasText(esePolicy.marketplaceId) || esePolicy.marketplaceId !== groundPolicy.marketplaceId) {
    throw new Error('Source fulfillment policies must use the same marketplace.');
  }

  const eseService = getUniqueShippingService(
    eseDomestic.shippingServices ?? [],
    (service) => service.shippingServiceCode === ESE_SHIPPING_SERVICE_CODE,
    `Configured eSE fulfillment policy service "${ESE_SHIPPING_SERVICE_CODE}"`
  );
  const groundService = getUniqueShippingService(
    groundDomestic.shippingServices ?? [],
    isGroundAdvantageService,
    `Fulfillment policy "${GROUND_FULFILLMENT_POLICY_NAME}" USPS Ground Advantage service`
  );
  const pickupService = [
    ...(eseDomestic.shippingServices ?? []),
    ...(groundDomestic.shippingServices ?? []),
  ].find(isFreePickupService);
  if (!pickupService) {
    throw new Error('Source fulfillment policies must contain one free Pickup service.');
  }

  const shippingServices = [eseService, groundService, pickupService].map((service, index) => ({
    ...clone(service),
    sortOrder: index + 1,
  }));
  const shippingOptions = (esePolicy.shippingOptions ?? []).map((option) =>
    option === eseDomestic ? { ...clone(option), shippingServices } : clone(option)
  );
  const { fulfillmentPolicyId: _fulfillmentPolicyId, name: _sourceName, ...request } = esePolicy;

  return {
    ...request,
    name: input.name ?? COMBINED_FULFILLMENT_POLICY_NAME,
    shippingOptions,
  };
}

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

export async function setupCombinedFulfillmentPolicy(input: {
  accountApi: CombinedPolicyApi;
  eseSourceFulfillmentPolicyId: string;
  execute: boolean;
  marketplaceId: string;
  combinedPolicyName?: string;
}): Promise<CombinedFulfillmentPolicySetupResult> {
  const combinedPolicyName = input.combinedPolicyName ?? COMBINED_FULFILLMENT_POLICY_NAME;
  const response = await input.accountApi.getFulfillmentPolicies(input.marketplaceId);
  const policies = response.fulfillmentPolicies ?? [];
  const existing = policies.find((policy) => policy.name === combinedPolicyName);
  const ground = policies.find((policy) => policy.name === GROUND_FULFILLMENT_POLICY_NAME);

  if (!ground?.fulfillmentPolicyId) {
    throw new Error(`Fulfillment policy "${GROUND_FULFILLMENT_POLICY_NAME}" was not found.`);
  }

  if (existing?.fulfillmentPolicyId) {
    return {
      combinedFulfillmentPolicyId: existing.fulfillmentPolicyId,
      groundFulfillmentPolicyId: ground.fulfillmentPolicyId,
      status: 'resolved',
    };
  }

  const [esePolicy, groundPolicy] = await Promise.all([
    input.accountApi.getFulfillmentPolicy(input.eseSourceFulfillmentPolicyId),
    input.accountApi.getFulfillmentPolicy(ground.fulfillmentPolicyId),
  ]);
  const request = buildCombinedFulfillmentPolicyRequest({
    esePolicy,
    groundPolicy,
    name: combinedPolicyName,
  });

  if (!input.execute) {
    return {
      combinedFulfillmentPolicyId: null,
      groundFulfillmentPolicyId: ground.fulfillmentPolicyId,
      status: 'would_create',
    };
  }

  const created = await input.accountApi.createFulfillmentPolicy(request);
  if (!hasText(created.fulfillmentPolicyId)) {
    throw new Error('Combined fulfillment policy create completed without fulfillmentPolicyId.');
  }

  return {
    combinedFulfillmentPolicyId: created.fulfillmentPolicyId,
    groundFulfillmentPolicyId: ground.fulfillmentPolicyId,
    status: 'created',
  };
}
