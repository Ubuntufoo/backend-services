import {
  DEFAULT_APP_SETTINGS_ID,
  type AppSettingsInsert,
  type AppSettingsRow,
} from '@ebay-inventory/data';
import type { EbayApiClient } from '@/api/client.js';
import type { SidecarDataAccess } from '@/data/sidecar-data.js';
import { parseScopeString } from '@/utils/scope-helper.js';
import type { ComponentLogger } from '@/utils/logger.js';
import { setupLogger } from '@/utils/logger.js';
import type { AccountApi } from '@/api/account-management/account.js';
import type { InventoryApi } from '@/api/listing-management/inventory.js';
import type { components as AccountComponents } from '@/types/sell-apps/account-management/sellAccountV1Oas3.js';
import type { components as InventoryComponents } from '@/types/sell-apps/listing-management/sellInventoryV1Oas3.js';

type AppSettingsAccess = SidecarDataAccess['appSettings'];
type FulfillmentPolicy = AccountComponents['schemas']['FulfillmentPolicy'];
type FulfillmentPolicyRequest = AccountComponents['schemas']['FulfillmentPolicyRequest'];
type PaymentPolicy = AccountComponents['schemas']['PaymentPolicy'];
type PaymentPolicyRequest = AccountComponents['schemas']['PaymentPolicyRequest'];
type ReturnPolicy = AccountComponents['schemas']['ReturnPolicy'];
type ReturnPolicyRequest = AccountComponents['schemas']['ReturnPolicyRequest'];
type SetFulfillmentPolicyResponse = AccountComponents['schemas']['SetFulfillmentPolicyResponse'];
type SetPaymentPolicyResponse = AccountComponents['schemas']['SetPaymentPolicyResponse'];
type SetReturnPolicyResponse = AccountComponents['schemas']['SetReturnPolicyResponse'];
type InventoryLocationFull = InventoryComponents['schemas']['InventoryLocationFull'];
type InventoryLocationResponse = InventoryComponents['schemas']['InventoryLocationResponse'];
type LocationResponse = InventoryComponents['schemas']['LocationResponse'];
interface ScopedUserTokens {
  scope?: string;
}

const REQUIRED_OAUTH_SCOPES = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.account',
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
] as const;

const POLICY_NAMES = {
  fulfillment: 'Sandbox Default Fulfillment Policy',
  payment: 'Sandbox Default Payment Policy',
  return: 'Sandbox Default Return Policy',
} as const;

const DEFAULT_LOCATION_KEY = 'default-main-location';

const DEFAULT_CATEGORY_TYPES = [{ name: 'ALL_EXCLUDING_MOTORS_VEHICLES' }];

export interface SandboxBootstrapApi {
  account: Pick<
    AccountApi,
    | 'createFulfillmentPolicy'
    | 'createPaymentPolicy'
    | 'createReturnPolicy'
    | 'getFulfillmentPolicies'
    | 'getPaymentPolicies'
    | 'getReturnPolicies'
  >;
  inventory: Pick<InventoryApi, 'createOrReplaceInventoryLocation' | 'getInventoryLocations'>;
  getAuthClient(): Pick<EbayApiClient, 'getConfig' | 'getOAuthClient'>;
  hasUserTokens(): boolean;
}

export { DEFAULT_LOCATION_KEY, POLICY_NAMES };

interface SandboxAuthValidationApi {
  getAuthClient(): {
    getConfig(): {
      environment?: string;
      marketplaceId?: string;
    };
    getOAuthClient(): {
      getAccessToken(): Promise<string>;
      getUserTokens(): ScopedUserTokens | null;
    };
  };
  hasUserTokens(): boolean;
}

export interface BootstrapCreatedFlags {
  fulfillment: boolean;
  location: boolean;
  payment: boolean;
  return: boolean;
}

export interface EnsureDefaultSellerPoliciesResult {
  created: Pick<BootstrapCreatedFlags, 'fulfillment' | 'payment' | 'return'>;
  fulfillmentPolicyId: string;
  paymentPolicyId: string;
  returnPolicyId: string;
  warnings: string[];
}

export interface EnsureDefaultInventoryLocationResult {
  created: Pick<BootstrapCreatedFlags, 'location'>;
  merchantLocationKey: string;
  warnings: string[];
}

export interface SandboxBootstrapResult {
  created: BootstrapCreatedFlags;
  fulfillmentPolicyId: string;
  marketplaceId: string;
  merchantLocationKey: string;
  persistedAppSettingsId: string;
  paymentPolicyId: string;
  returnPolicyId: string;
  warnings: string[];
}

export interface SandboxBootstrapOptions {
  api: SandboxBootstrapApi;
  appSettingsId?: string;
  dataAccess: Pick<SidecarDataAccess, 'appSettings'>;
  logger?: ComponentLogger;
  marketplaceId?: string;
}

/* eslint-disable @typescript-eslint/naming-convention -- app_settings fields mirror DB column names */
interface PolicyAppSettingsSnapshot {
  default_fulfillment_policy_id?: string | null;
  default_payment_policy_id?: string | null;
  default_return_policy_id?: string | null;
}

interface LocationAppSettingsSnapshot {
  merchant_location_key?: string | null;
}
/* eslint-enable @typescript-eslint/naming-convention */

interface PolicyResolutionResult {
  created: boolean;
  id: string;
  warnings: string[];
}

type SandboxBootstrapStatus = 'created' | 'reused';

interface PolicyResolutionConfig<TPolicy, TCreateResponse> {
  bootstrapName: string;
  createDefault: () => Promise<TCreateResponse>;
  createErrorLabel: string;
  getId: (policy: TPolicy) => string | undefined;
  getName: (policy: TPolicy) => string | undefined;
  listPolicies: () => Promise<TPolicy[]>;
  logger: ComponentLogger;
  policyLabel: string;
  responseIdLabel: string;
  storedId?: string | null;
}

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hasText(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeText(value: string | null | undefined): string | null {
  return hasText(value) ? value.trim() : null;
}

function isObviousPlaceholder(value: string | null | undefined): boolean {
  const normalized = normalizeText(value);
  if (!normalized) {
    return false;
  }

  return (
    /^mock[-_]/i.test(normalized) ||
    /^example[-_]?/i.test(normalized) ||
    /^test[-_]?/i.test(normalized) ||
    /^placeholder$/i.test(normalized) ||
    /^changeme$/i.test(normalized) ||
    /^replace[-_]?me$/i.test(normalized) ||
    /^todo$/i.test(normalized) ||
    /^<[^>]+>$/.test(normalized)
  );
}

function isPlaceholderMarketplaceId(value: string | null | undefined): boolean {
  const normalized = normalizeText(value);
  return normalized ? isObviousPlaceholder(normalized) || !/^EBAY_[A-Z_]+$/.test(normalized) : true;
}

function sanitizeStoredValue(value: string | null | undefined): string | null {
  const normalized = normalizeText(value);
  return normalized && !isObviousPlaceholder(normalized) ? normalized : null;
}

function assertPersistableValue(label: string, value: string): string {
  const normalized = normalizeText(value);
  if (!normalized || isObviousPlaceholder(normalized)) {
    throw new Error(`Refusing to persist placeholder ${label} value "${value}".`);
  }

  return normalized;
}

function assertPersistableMarketplaceId(marketplaceId: string): string {
  const normalized = normalizeText(marketplaceId);
  if (!normalized || isPlaceholderMarketplaceId(normalized)) {
    throw new Error(`Refusing to persist invalid ebay_marketplace_id "${marketplaceId}".`);
  }

  return normalized;
}

function isAuthorizationScopeError(error: unknown): boolean {
  const message = normalizeError(error).toLowerCase();
  return (
    message.includes('insufficient_scope') ||
    message.includes('insufficient scope') ||
    message.includes('forbidden') ||
    message.includes('unauthorized') ||
    message.includes('status code 401') ||
    message.includes('status code 403')
  );
}

function isBusinessPolicyIneligibleError(error: unknown): boolean {
  const message = normalizeError(error).toLowerCase();
  return (
    message.includes('not eligible for business policy') ||
    message.includes('business policy') ||
    message.includes('error: invalid .')
  );
}

function formatPolicyBootstrapError(policyLabel: string, error: unknown): Error {
  if (isAuthorizationScopeError(error)) {
    return new Error(
      `Re-authorize sandbox user with scopes: api_scope, sell.account, sell.inventory. ${policyLabel} policy request failed. Root cause: ${normalizeError(error)}`
    );
  }

  if (isBusinessPolicyIneligibleError(error)) {
    return new Error(
      `Sandbox account limitation. eBay seller not eligible for Business Policy, so ${policyLabel} policy bootstrap cannot continue. Use different sandbox seller account with Business Policies enabled. Root cause: ${normalizeError(error)}`
    );
  }

  return new Error(
    `Failed to ensure default ${policyLabel} policy. Root cause: ${normalizeError(error)}`
  );
}

function formatLocationBootstrapError(error: unknown): Error {
  if (isAuthorizationScopeError(error)) {
    return new Error(
      `Re-authorize sandbox user with scopes: api_scope, sell.account, sell.inventory. Inventory location request failed. Root cause: ${normalizeError(error)}`
    );
  }

  return new Error(`Failed to ensure inventory location bootstrap. Root cause: ${normalizeError(error)}`);
}

function getRefreshTokenFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.EBAY_REFRESH_TOKEN ?? env.EBAY_USER_REFRESH_TOKEN;
}

function getMarketplaceIdFromState(
  api: SandboxAuthValidationApi,
  marketplaceId: string | undefined,
  appSettingsMarketplaceId: string | null | undefined
): string {
  return (
    marketplaceId ??
    api.getAuthClient().getConfig().marketplaceId ??
    appSettingsMarketplaceId ??
    'EBAY_US'
  );
}

function createDefaultPaymentPolicyRequest(marketplaceId: string): PaymentPolicyRequest {
  return {
    categoryTypes: DEFAULT_CATEGORY_TYPES,
    description: 'Default sandbox payment policy for sidecar bootstrap.',
    immediatePay: true,
    marketplaceId,
    name: POLICY_NAMES.payment,
  };
}

function createDefaultFulfillmentPolicyRequest(marketplaceId: string): FulfillmentPolicyRequest {
  return {
    categoryTypes: DEFAULT_CATEGORY_TYPES,
    description: 'Default sandbox fulfillment policy for sidecar bootstrap.',
    handlingTime: {
      unit: 'DAY',
      value: 1,
    },
    marketplaceId,
    name: POLICY_NAMES.fulfillment,
    shippingOptions: [
      {
        costType: 'FLAT_RATE',
        optionType: 'DOMESTIC',
        shippingServices: [
          {
            freeShipping: false,
            shippingCarrierCode: 'USPS',
            shippingCost: {
              value: '5.00',
            },
            shippingServiceCode: 'USPSPriority',
            sortOrder: 1,
          },
        ],
      },
    ],
  };
}

function createDefaultReturnPolicyRequest(marketplaceId: string): ReturnPolicyRequest {
  return {
    categoryTypes: DEFAULT_CATEGORY_TYPES,
    description: 'Default sandbox return policy for sidecar bootstrap.',
    marketplaceId,
    name: POLICY_NAMES.return,
    refundMethod: 'MONEY_BACK',
    returnPeriod: {
      unit: 'DAY',
      value: 30,
    },
    returnShippingCostPayer: 'BUYER',
    returnsAccepted: true,
  };
}

function createDefaultInventoryLocationRequest(): InventoryLocationFull {
  return {
    location: {
      address: {
        addressLine1: '123 Sandbox Way',
        city: 'San Jose',
        country: 'US',
        postalCode: '95131',
        stateOrProvince: 'CA',
      },
    },
    locationTypes: ['WAREHOUSE'],
    merchantLocationStatus: 'ENABLED',
    name: 'Sandbox Main Warehouse',
  };
}

function getLocationKey(location: InventoryLocationResponse): string | undefined {
  return location.merchantLocationKey;
}

async function getInventoryLocationByKey(
  api: SandboxBootstrapApi,
  merchantLocationKey: string
): Promise<InventoryLocationResponse | null> {
  const inventoryApi = api.inventory as SandboxBootstrapApi['inventory'] & {
    getInventoryLocation?: (merchantLocationKey: string) => Promise<unknown>;
  };

  if (typeof inventoryApi.getInventoryLocation !== 'function') {
    return null;
  }

  const location = (await inventoryApi.getInventoryLocation(
    merchantLocationKey
  )) as InventoryLocationFull & {
    merchantLocationKey?: string;
  };

  return {
    ...location,
    merchantLocationKey,
  };
}

async function ensureAppSettingsRow(
  appSettings: AppSettingsAccess,
  appSettingsId: string,
  marketplaceId: string
): Promise<AppSettingsRow> {
  const existing = await appSettings.get(appSettingsId);
  if (existing) {
    return existing;
  }

  const input: AppSettingsInsert = {
    ebay_marketplace_id: marketplaceId,
    id: appSettingsId,
  };

  try {
    return await appSettings.create(input);
  } catch (error) {
    const reloaded = await appSettings.get(appSettingsId);
    if (reloaded) {
      return reloaded;
    }

    throw new Error(
      `Failed to create app settings row "${appSettingsId}": ${normalizeError(error)}`
    );
  }
}

function assertSandboxEnvironment(api: SandboxAuthValidationApi): void {
  const environment = api.getAuthClient().getConfig().environment;
  if (environment !== 'sandbox') {
    throw new Error(
      `Sandbox bootstrap only runs against EBAY_ENVIRONMENT=sandbox. Current environment: ${environment}.`
    );
  }
}

function getValidatedUserTokens(api: SandboxAuthValidationApi): ScopedUserTokens {
  const oauthClient = api.getAuthClient().getOAuthClient();
  const userTokens = oauthClient.getUserTokens();

  if (!userTokens) {
    throw new Error(
      'OAuth validation failed. No usable seller refresh token found. Set EBAY_REFRESH_TOKEN or EBAY_USER_REFRESH_TOKEN to a valid user refresh token.'
    );
  }

  return userTokens;
}

export async function validateSandboxOAuthAccess(
  api: SandboxAuthValidationApi,
  logger: ComponentLogger = setupLogger
): Promise<{ tokenScopes: string[] }> {
  assertSandboxEnvironment(api);

  const rawRefreshToken = getRefreshTokenFromEnv();
  if (!rawRefreshToken?.trim()) {
    throw new Error(
      'OAuth validation failed. Set EBAY_REFRESH_TOKEN or EBAY_USER_REFRESH_TOKEN before running sandbox bootstrap.'
    );
  }

  if (!api.hasUserTokens()) {
    throw new Error(
      'OAuth validation failed. Refresh token could not be loaded or refreshed. Re-authorize and store a valid seller refresh token.'
    );
  }

  const oauthClient = api.getAuthClient().getOAuthClient();
  await oauthClient.getAccessToken();

  const userTokens = getValidatedUserTokens(api);
  const tokenScopes = userTokens.scope ? parseScopeString(userTokens.scope) : [];
  if (tokenScopes.length > 0) {
    const missingScopes = REQUIRED_OAUTH_SCOPES.filter((scope) => !tokenScopes.includes(scope));
    if (missingScopes.length > 0) {
      throw new Error(
        `OAuth validation failed. Missing required scopes: ${missingScopes.join(', ')}. Re-authorize with ${REQUIRED_OAUTH_SCOPES.join(', ')}.`
      );
    }

    return { tokenScopes };
  }

  logger.warn(
    'OAuth validation warning. Token refresh succeeded but eBay did not return scope metadata. Continuing; Account API and Inventory API calls will prove effective access.'
  );

  return { tokenScopes };
}

async function resolvePolicy<TPolicy, TCreateResponse>({
  bootstrapName,
  createDefault,
  createErrorLabel,
  getId,
  getName,
  listPolicies,
  logger,
  policyLabel,
  responseIdLabel,
  storedId,
}: PolicyResolutionConfig<TPolicy, TCreateResponse>): Promise<PolicyResolutionResult> {
  const warnings: string[] = [];
  let policies = await listPolicies();
  const sanitizedStoredId = sanitizeStoredValue(storedId);

  if (storedId && !sanitizedStoredId) {
    warnings.push(
      `Ignoring placeholder stored ${policyLabel} policy id "${storedId}" during sandbox bootstrap.`
    );
  }

  if (sanitizedStoredId) {
    const storedPolicy = policies.find((policy) => getId(policy) === sanitizedStoredId);
    if (storedPolicy) {
      return { created: false, id: sanitizedStoredId, warnings };
    }
  }

  const namedPolicy = policies.find((policy) => getName(policy) === bootstrapName && getId(policy));
  if (namedPolicy) {
    return {
      created: false,
      id: getId(namedPolicy)!,
      warnings,
    };
  }

  try {
    const createdPolicy = await createDefault();
    const createdId = (createdPolicy as Record<string, unknown>)[responseIdLabel];
    if (typeof createdId !== 'string' || createdId.trim() === '') {
      throw new Error(
        `Malformed ${policyLabel} policy create response: missing ${responseIdLabel}.`
      );
    }

    return {
      created: true,
      id: createdId,
      warnings,
    };
  } catch (error) {
    policies = await listPolicies();

    const createdByRace = policies.find(
      (policy) => getName(policy) === bootstrapName && getId(policy)
    );
    if (createdByRace) {
      return {
        created: false,
        id: getId(createdByRace)!,
        warnings,
      };
    }

    const fallbackPolicy = policies.find((policy) => getId(policy));
    if (fallbackPolicy) {
      const fallbackId = getId(fallbackPolicy)!;
      const fallbackName = getName(fallbackPolicy) ?? fallbackId;
      const warning =
        `Fell back to existing ${policyLabel} policy "${fallbackName}" (${fallbackId}) ` +
        `after ${createErrorLabel}: ${normalizeError(error)}`;
      logger.warn(warning, { policyId: fallbackId, policyLabel });
      warnings.push(warning);
      return {
        created: false,
        id: fallbackId,
        warnings,
      };
    }

    throw new Error(
      `Failed to create default ${policyLabel} policy and no existing ${policyLabel} policies are available: ${normalizeError(error)}`
    );
  }
}

async function listFulfillmentPolicies(
  api: SandboxBootstrapApi,
  marketplaceId: string
): Promise<FulfillmentPolicy[]> {
  return (await api.account.getFulfillmentPolicies(marketplaceId)).fulfillmentPolicies ?? [];
}

async function listPaymentPolicies(
  api: SandboxBootstrapApi,
  marketplaceId: string
): Promise<PaymentPolicy[]> {
  return (await api.account.getPaymentPolicies(marketplaceId)).paymentPolicies ?? [];
}

async function listReturnPolicies(
  api: SandboxBootstrapApi,
  marketplaceId: string
): Promise<ReturnPolicy[]> {
  return (await api.account.getReturnPolicies(marketplaceId)).returnPolicies ?? [];
}

function getFulfillmentPolicyId(policy: FulfillmentPolicy): string | undefined {
  return policy.fulfillmentPolicyId;
}

function getPaymentPolicyId(policy: PaymentPolicy): string | undefined {
  return policy.paymentPolicyId;
}

function getReturnPolicyId(policy: ReturnPolicy): string | undefined {
  return policy.returnPolicyId;
}

export async function createDefaultPaymentPolicy(
  api: SandboxBootstrapApi,
  marketplaceId: string
): Promise<SetPaymentPolicyResponse> {
  return await api.account.createPaymentPolicy(createDefaultPaymentPolicyRequest(marketplaceId));
}

export async function createDefaultFulfillmentPolicy(
  api: SandboxBootstrapApi,
  marketplaceId: string
): Promise<SetFulfillmentPolicyResponse> {
  return await api.account.createFulfillmentPolicy(
    createDefaultFulfillmentPolicyRequest(marketplaceId)
  );
}

export async function createDefaultReturnPolicy(
  api: SandboxBootstrapApi,
  marketplaceId: string
): Promise<SetReturnPolicyResponse> {
  return await api.account.createReturnPolicy(createDefaultReturnPolicyRequest(marketplaceId));
}

export async function ensureDefaultSellerPolicies(
  api: SandboxBootstrapApi,
  appSettings: PolicyAppSettingsSnapshot,
  marketplaceId: string,
  logger: ComponentLogger = setupLogger
): Promise<EnsureDefaultSellerPoliciesResult> {
  let payment: PolicyResolutionResult;
  try {
    payment = await resolvePolicy({
      bootstrapName: POLICY_NAMES.payment,
      createDefault: async () => await createDefaultPaymentPolicy(api, marketplaceId),
      createErrorLabel: 'creating default payment policy',
      getId: getPaymentPolicyId,
      getName: (policy) => policy.name,
      listPolicies: async () => await listPaymentPolicies(api, marketplaceId),
      logger,
      policyLabel: 'payment',
      responseIdLabel: 'paymentPolicyId',
      storedId: appSettings.default_payment_policy_id,
    });
  } catch (error) {
    throw formatPolicyBootstrapError('payment', error);
  }

  let fulfillment: PolicyResolutionResult;
  try {
    fulfillment = await resolvePolicy({
      bootstrapName: POLICY_NAMES.fulfillment,
      createDefault: async () => await createDefaultFulfillmentPolicy(api, marketplaceId),
      createErrorLabel: 'creating default fulfillment policy',
      getId: getFulfillmentPolicyId,
      getName: (policy) => policy.name,
      listPolicies: async () => await listFulfillmentPolicies(api, marketplaceId),
      logger,
      policyLabel: 'fulfillment',
      responseIdLabel: 'fulfillmentPolicyId',
      storedId: appSettings.default_fulfillment_policy_id,
    });
  } catch (error) {
    throw formatPolicyBootstrapError('fulfillment', error);
  }

  let returns: PolicyResolutionResult;
  try {
    returns = await resolvePolicy({
      bootstrapName: POLICY_NAMES.return,
      createDefault: async () => await createDefaultReturnPolicy(api, marketplaceId),
      createErrorLabel: 'creating default return policy',
      getId: getReturnPolicyId,
      getName: (policy) => policy.name,
      listPolicies: async () => await listReturnPolicies(api, marketplaceId),
      logger,
      policyLabel: 'return',
      responseIdLabel: 'returnPolicyId',
      storedId: appSettings.default_return_policy_id,
    });
  } catch (error) {
    throw formatPolicyBootstrapError('return', error);
  }

  return {
    created: {
      fulfillment: fulfillment.created,
      payment: payment.created,
      return: returns.created,
    },
    fulfillmentPolicyId: fulfillment.id,
    paymentPolicyId: payment.id,
    returnPolicyId: returns.id,
    warnings: [...payment.warnings, ...fulfillment.warnings, ...returns.warnings],
  };
}

async function listInventoryLocations(
  api: SandboxBootstrapApi
): Promise<InventoryLocationResponse[]> {
  const response = (await api.inventory.getInventoryLocations()) as LocationResponse;
  return response.locations ?? [];
}

export async function ensureDefaultInventoryLocation(
  api: SandboxBootstrapApi,
  appSettings: LocationAppSettingsSnapshot,
  logger: ComponentLogger = setupLogger
): Promise<EnsureDefaultInventoryLocationResult> {
  const warnings: string[] = [];
  let locations: InventoryLocationResponse[] = [];
  try {
    locations = await listInventoryLocations(api);
  } catch (error) {
    const warning =
      `Failed to list inventory locations before bootstrap. Continuing with direct lookup/create fallback. ` +
      `Root cause: ${normalizeError(error)}`;
    logger.warn(warning);
    warnings.push(warning);
  }

  const storedMerchantLocationKey = sanitizeStoredValue(appSettings.merchant_location_key);
  if (appSettings.merchant_location_key && !storedMerchantLocationKey) {
    const warning =
      `Ignoring placeholder stored merchant_location_key "${appSettings.merchant_location_key}" during sandbox bootstrap.`;
    logger.warn(warning);
    warnings.push(warning);
  }

  if (storedMerchantLocationKey) {
    const storedLocation = locations.find(
      (location) => getLocationKey(location) === storedMerchantLocationKey
    );
    if (storedLocation) {
      return {
        created: { location: false },
        merchantLocationKey: storedMerchantLocationKey,
        warnings,
      };
    }

    try {
      const directStoredLocation = await getInventoryLocationByKey(
        api,
        storedMerchantLocationKey
      );
      if (directStoredLocation) {
        return {
          created: { location: false },
          merchantLocationKey: storedMerchantLocationKey,
          warnings,
        };
      }
    } catch (error) {
      const warning =
        `Failed direct inventory location lookup for configured merchant_location_key ` +
        `"${storedMerchantLocationKey}". Continuing fallback flow. ` +
        `Root cause: ${normalizeError(error)}`;
      logger.warn(warning);
      warnings.push(warning);
    }
  }

  const defaultLocation = locations.find(
    (location) => getLocationKey(location) === DEFAULT_LOCATION_KEY
  );
  if (defaultLocation) {
    return {
      created: { location: false },
      merchantLocationKey: DEFAULT_LOCATION_KEY,
      warnings,
    };
  }

  try {
    await api.inventory.createOrReplaceInventoryLocation(
      DEFAULT_LOCATION_KEY,
      createDefaultInventoryLocationRequest()
    );
    return {
      created: { location: true },
      merchantLocationKey: DEFAULT_LOCATION_KEY,
      warnings,
    };
  } catch (error) {
    try {
      locations = await listInventoryLocations(api);
    } catch (reloadError) {
      try {
        const directDefaultLocation = await getInventoryLocationByKey(api, DEFAULT_LOCATION_KEY);
        if (directDefaultLocation) {
          return {
            created: { location: false },
            merchantLocationKey: DEFAULT_LOCATION_KEY,
            warnings,
          };
        }
      } catch (error) {
        const warning =
          `Failed direct inventory location lookup for default key "${DEFAULT_LOCATION_KEY}" ` +
          `after list reload failed. Root cause: ${normalizeError(error)}`;
        logger.warn(warning);
        warnings.push(warning);
      }

      throw formatLocationBootstrapError(reloadError);
    }

    if (isAuthorizationScopeError(error)) {
      throw formatLocationBootstrapError(error);
    }

    const createdByRace = locations.find(
      (location) => getLocationKey(location) === DEFAULT_LOCATION_KEY
    );
    if (createdByRace) {
      return {
        created: { location: false },
        merchantLocationKey: DEFAULT_LOCATION_KEY,
        warnings,
      };
    }

    const fallbackLocation = locations.find((location) => getLocationKey(location));
    if (fallbackLocation) {
      const fallbackKey = getLocationKey(fallbackLocation)!;
      const warning =
        `Fell back to existing inventory location "${fallbackLocation.name ?? fallbackKey}" ` +
        `(${fallbackKey}) after creating default inventory location failed: ${normalizeError(error)}`;
      logger.warn(warning, { merchantLocationKey: fallbackKey });
      warnings.push(warning);
      return {
        created: { location: false },
        merchantLocationKey: fallbackKey,
        warnings,
      };
    }

    throw new Error(
      `Failed to create default inventory location and no existing inventory locations are available: ${normalizeError(error)}`
    );
  }
}

async function persistPolicyBootstrapSettings(
  appSettings: AppSettingsAccess,
  appSettingsId: string,
  marketplaceId: string,
  result: Pick<
    SandboxBootstrapResult,
    'fulfillmentPolicyId' | 'paymentPolicyId' | 'returnPolicyId'
  >
): Promise<void> {
  await appSettings.update(
    {
      default_fulfillment_policy_id: assertPersistableValue(
        'default_fulfillment_policy_id',
        result.fulfillmentPolicyId
      ),
      default_payment_policy_id: assertPersistableValue(
        'default_payment_policy_id',
        result.paymentPolicyId
      ),
      default_return_policy_id: assertPersistableValue(
        'default_return_policy_id',
        result.returnPolicyId
      ),
      ebay_marketplace_id: assertPersistableMarketplaceId(marketplaceId),
    },
    appSettingsId
  );
}

async function persistInventoryLocationBootstrapSettings(
  appSettings: AppSettingsAccess,
  appSettingsId: string,
  merchantLocationKey: string
): Promise<void> {
  await appSettings.update(
    {
      merchant_location_key: assertPersistableValue('merchant_location_key', merchantLocationKey),
    },
    appSettingsId
  );
}

export async function runSandboxBootstrap({
  api,
  appSettingsId = DEFAULT_APP_SETTINGS_ID,
  dataAccess,
  logger = setupLogger,
  marketplaceId,
}: SandboxBootstrapOptions): Promise<SandboxBootstrapResult> {
  assertSandboxEnvironment(api);
  await validateSandboxOAuthAccess(api, logger);

  const initialAppSettings = await ensureAppSettingsRow(
    dataAccess.appSettings,
    appSettingsId,
    marketplaceId ?? api.getAuthClient().getConfig().marketplaceId ?? 'EBAY_US'
  );
  const resolvedMarketplaceId = getMarketplaceIdFromState(
    api,
    marketplaceId,
    initialAppSettings.ebay_marketplace_id
  );
  const warnings: string[] = [];

  if (
    hasText(initialAppSettings.ebay_marketplace_id) &&
    initialAppSettings.ebay_marketplace_id !== resolvedMarketplaceId
  ) {
    const warning =
      `Stored app_settings.${appSettingsId}.ebay_marketplace_id ` +
      `"${initialAppSettings.ebay_marketplace_id}" does not match active sidecar marketplace ` +
      `"${resolvedMarketplaceId}". Bootstrap will persist "${resolvedMarketplaceId}".`;
    logger.warn(warning);
    warnings.push(warning);
  }

  const policyResult = await ensureDefaultSellerPolicies(
    api,
    initialAppSettings,
    resolvedMarketplaceId,
    logger
  );
  await persistPolicyBootstrapSettings(
    dataAccess.appSettings,
    appSettingsId,
    resolvedMarketplaceId,
    {
      fulfillmentPolicyId: policyResult.fulfillmentPolicyId,
      paymentPolicyId: policyResult.paymentPolicyId,
      returnPolicyId: policyResult.returnPolicyId,
    }
  );
  const locationResult = await ensureDefaultInventoryLocation(api, initialAppSettings, logger);

  const result: SandboxBootstrapResult = {
    created: {
      fulfillment: policyResult.created.fulfillment,
      location: locationResult.created.location,
      payment: policyResult.created.payment,
      return: policyResult.created.return,
    },
    fulfillmentPolicyId: policyResult.fulfillmentPolicyId,
    marketplaceId: resolvedMarketplaceId,
    merchantLocationKey: locationResult.merchantLocationKey,
    persistedAppSettingsId: appSettingsId,
    paymentPolicyId: policyResult.paymentPolicyId,
    returnPolicyId: policyResult.returnPolicyId,
    warnings: [...warnings, ...policyResult.warnings, ...locationResult.warnings],
  };

  await persistInventoryLocationBootstrapSettings(
    dataAccess.appSettings,
    appSettingsId,
    locationResult.merchantLocationKey
  );

  return result;
}

function formatBootstrapLine(
  label: string,
  value: string,
  status: SandboxBootstrapStatus
): string {
  return `${label}: ${value} (${status})`;
}

export function formatSandboxBootstrapResult(result: SandboxBootstrapResult): string {
  const lines = [
    'eBay sandbox bootstrap',
    `marketplace: ${result.marketplaceId}`,
    `app_settings row: ${result.persistedAppSettingsId}`,
    '',
    formatBootstrapLine(
      'payment policy ID',
      result.paymentPolicyId,
      result.created.payment ? 'created' : 'reused'
    ),
    formatBootstrapLine(
      'fulfillment policy ID',
      result.fulfillmentPolicyId,
      result.created.fulfillment ? 'created' : 'reused'
    ),
    formatBootstrapLine(
      'return policy ID',
      result.returnPolicyId,
      result.created.return ? 'created' : 'reused'
    ),
    formatBootstrapLine(
      'merchant location key',
      result.merchantLocationKey,
      result.created.location ? 'created' : 'reused'
    ),
    '',
    'persisted:',
    `- ebay_marketplace_id = ${result.marketplaceId}`,
    `- default_payment_policy_id = ${result.paymentPolicyId}`,
    `- default_fulfillment_policy_id = ${result.fulfillmentPolicyId}`,
    `- default_return_policy_id = ${result.returnPolicyId}`,
    `- merchant_location_key = ${result.merchantLocationKey}`,
  ];

  if (result.warnings.length > 0) {
    lines.push('', 'warnings:');
    for (const warning of result.warnings) {
      lines.push(`- ${warning}`);
    }
  }

  return lines.join('\n');
}
