import { EbayApiRequestError } from '@/api/client.js';
import type { EbayConfig } from '@/types/ebay.js';
import type { EbayOAuthValidationConfig } from '@/ebay/config.js';
import type { EbayOAuthValidationResult } from '@/ebay/validate-oauth.js';
import { validateEbayOAuth } from '@/ebay/validate-oauth.js';
import type { AccountApi } from '@/api/account-management/account.js';
import type { InventoryApi } from '@/api/listing-management/inventory.js';
import type { components as AccountComponents } from '@/types/sell-apps/account-management/sellAccountV1Oas3.js';
import type { components as InventoryComponents } from '@/types/sell-apps/listing-management/sellInventoryV1Oas3.js';

type PaymentPolicy = AccountComponents['schemas']['PaymentPolicy'];
type FulfillmentPolicy = AccountComponents['schemas']['FulfillmentPolicy'];
type ReturnPolicy = AccountComponents['schemas']['ReturnPolicy'];
type PaymentPolicyResponse = AccountComponents['schemas']['PaymentPolicyResponse'];
type FulfillmentPolicyResponse = AccountComponents['schemas']['FulfillmentPolicyResponse'];
type ReturnPolicyResponse = AccountComponents['schemas']['ReturnPolicyResponse'];
type InventoryLocationResponse = InventoryComponents['schemas']['InventoryLocationResponse'];
type LocationResponse = InventoryComponents['schemas']['LocationResponse'];

const PRODUCTION_API_BASE_URL = 'https://api.ebay.com';
const PRODUCTION_OAUTH_BASE_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const DEFAULT_MARKETPLACE_ID = 'EBAY_US';

export interface LivePublishInventoryLocationSummary {
  merchantLocationKey: string;
  name: string;
  status: string;
}

export interface LivePublishConfigDiscoveryError {
  family: 'account' | 'inventory' | 'logger' | 'oauth' | 'preflight';
  message: string;
  details?: Record<string, unknown>;
}

export interface LivePublishConfigDiscoveryReport {
  environment: string;
  marketplaceId: string;
  apiBaseUrl: string;
  checkedAt: string;
  overallStatus: 'ok' | 'partial' | 'failed';
  paymentPolicies: Array<{
    paymentPolicyId: string;
    name: string;
    marketplaceId: string;
  }>;
  fulfillmentPolicies: Array<{
    fulfillmentPolicyId: string;
    name: string;
    marketplaceId: string;
  }>;
  returnPolicies: Array<{
    returnPolicyId: string;
    name: string;
    marketplaceId: string;
  }>;
  inventoryLocations: LivePublishInventoryLocationSummary[];
  errors: LivePublishConfigDiscoveryError[];
}

export interface LivePublishConfigDiscoveryApi {
  account: Pick<
    AccountApi,
    'getFulfillmentPolicies' | 'getPaymentPolicies' | 'getReturnPolicies'
  >;
  initialize(): Promise<void>;
  inventory: Pick<InventoryApi, 'getInventoryLocations'>;
}

export interface LivePublishConfigDiscoveryOptions {
  api: LivePublishConfigDiscoveryApi;
  oauthConfig: EbayOAuthValidationConfig;
  runtimeConfig: EbayConfig;
  validateOAuth?: (
    config: EbayOAuthValidationConfig,
    options?: Parameters<typeof validateEbayOAuth>[1]
  ) => Promise<EbayOAuthValidationResult>;
}

function hasText(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeText(value: string | null | undefined): string | null {
  return hasText(value) ? value.trim() : null;
}

function isProductionEnvironment(value: string | null | undefined): boolean {
  return normalizeText(value) === 'production';
}

function redactValue(input: string, value: string | undefined): string {
  if (!value) {
    return input;
  }

  return input.split(value).join('[REDACTED]');
}

function sanitizeText(value: string, sensitiveValues: string[]): string {
  let sanitized = value;

  for (const sensitiveValue of sensitiveValues) {
    sanitized = redactValue(sanitized, sensitiveValue);
  }

  sanitized = sanitized.replace(/Authorization["']?\s*[:=]\s*["']?/gi, '');
  sanitized = sanitized.replace(/\bBasic\s+[A-Za-z0-9._~+/=-]+\b/gi, 'Basic [REDACTED]');
  sanitized = sanitized.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+\b/gi, 'Bearer [REDACTED]');

  return sanitized;
}

function sanitizeUnknown(value: unknown, sensitiveValues: string[]): unknown {
  if (typeof value === 'string') {
    return sanitizeText(value, sensitiveValues);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeUnknown(entry, sensitiveValues));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => {
        if (/authorization/i.test(key)) {
          return [key, '[REDACTED]'];
        }

        return [key, sanitizeUnknown(entryValue, sensitiveValues)];
      })
    );
  }

  return value;
}

function getSensitiveValues(
  runtimeConfig: EbayConfig,
  oauthConfig: EbayOAuthValidationConfig,
  processEnv: NodeJS.ProcessEnv = process.env
): string[] {
  const values = [
    runtimeConfig.clientSecret,
    runtimeConfig.refreshToken,
    runtimeConfig.accessToken,
    runtimeConfig.appAccessToken,
    oauthConfig.clientSecret,
    oauthConfig.refreshToken,
    processEnv.EBAY_CLIENT_SECRET,
    processEnv.EBAY_REFRESH_TOKEN,
    processEnv.EBAY_USER_REFRESH_TOKEN,
    processEnv.EBAY_USER_ACCESS_TOKEN,
    processEnv.EBAY_APP_ACCESS_TOKEN,
  ].filter(hasText);

  const basicCredential =
    hasText(runtimeConfig.clientId) && hasText(runtimeConfig.clientSecret)
      ? Buffer.from(`${runtimeConfig.clientId}:${runtimeConfig.clientSecret}`).toString('base64')
      : hasText(oauthConfig.clientId) && hasText(oauthConfig.clientSecret)
        ? Buffer.from(`${oauthConfig.clientId}:${oauthConfig.clientSecret}`).toString('base64')
        : null;

  if (basicCredential) {
    values.push(basicCredential);
  }

  return [...new Set(values)];
}

function serializeError(error: unknown, sensitiveValues: string[]): Record<string, unknown> {
  if (error instanceof EbayApiRequestError) {
    const firstError = error.ebayErrors[0];
    return sanitizeUnknown(
      {
        category: firstError?.category,
        domain: firstError?.domain,
        errorId: firstError?.errorId,
        longMessage: firstError?.longMessage,
        message: firstError?.message ?? sanitizeText(error.message, sensitiveValues),
        parameters: firstError?.parameters,
        statusCode: error.statusCode,
      },
      sensitiveValues
    ) as Record<string, unknown>;
  }

  if (error && typeof error === 'object' && 'status' in error && error instanceof Error) {
    return {
      message: sanitizeText(error.message, sensitiveValues),
      statusCode: Number((error as { status?: number }).status) || undefined,
      name: error.name,
    };
  }

  if (error instanceof Error) {
    const base: Record<string, unknown> = {
      message: sanitizeText(error.message, sensitiveValues),
      name: error.name,
    };

    const issues = (error as { issues?: Array<{ message?: string; path?: unknown }> }).issues;
    if (Array.isArray(issues) && issues.length > 0) {
      base.issues = issues.map((issue) => ({
        message: sanitizeText(issue.message ?? 'Unknown issue', sensitiveValues),
        path: sanitizeUnknown(issue.path, sensitiveValues),
      }));
    }

    return base;
  }

  return {
    message: sanitizeText(String(error), sensitiveValues),
  };
}

function normalizeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isBusinessPolicyIneligibleError(error: unknown): boolean {
  const message = normalizeErrorMessage(error).toLowerCase();
  return (
    message.includes('user is not eligible for business policy') ||
    message.includes('not eligible for business policy')
  );
}

function buildError(
  family: LivePublishConfigDiscoveryError['family'],
  message: string,
  details?: Record<string, unknown>
): LivePublishConfigDiscoveryError {
  return {
    family,
    message,
    ...(details ? { details } : {}),
  };
}

function normalizeMarketplaceId(value: string | null | undefined): string {
  return normalizeText(value) ?? DEFAULT_MARKETPLACE_ID;
}

function mapPaymentPolicies(
  response: PaymentPolicyResponse | undefined,
  marketplaceId: string
): LivePublishConfigDiscoveryReport['paymentPolicies'] {
  return (response?.paymentPolicies ?? [])
    .map((policy: PaymentPolicy) => {
      const paymentPolicyId = normalizeText(policy.paymentPolicyId);
      const name = normalizeText(policy.name);
      if (!paymentPolicyId || !name) {
        return null;
      }

      return {
        paymentPolicyId,
        name,
        marketplaceId: normalizeText(policy.marketplaceId) ?? marketplaceId,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
}

function mapFulfillmentPolicies(
  response: FulfillmentPolicyResponse | undefined,
  marketplaceId: string
): LivePublishConfigDiscoveryReport['fulfillmentPolicies'] {
  return (response?.fulfillmentPolicies ?? [])
    .map((policy: FulfillmentPolicy) => {
      const fulfillmentPolicyId = normalizeText(policy.fulfillmentPolicyId);
      const name = normalizeText(policy.name);
      if (!fulfillmentPolicyId || !name) {
        return null;
      }

      return {
        fulfillmentPolicyId,
        name,
        marketplaceId: normalizeText(policy.marketplaceId) ?? marketplaceId,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
}

function mapReturnPolicies(
  response: ReturnPolicyResponse | undefined,
  marketplaceId: string
): LivePublishConfigDiscoveryReport['returnPolicies'] {
  return (response?.returnPolicies ?? [])
    .map((policy: ReturnPolicy) => {
      const returnPolicyId = normalizeText(policy.returnPolicyId);
      const name = normalizeText(policy.name);
      if (!returnPolicyId || !name) {
        return null;
      }

      return {
        returnPolicyId,
        name,
        marketplaceId: normalizeText(policy.marketplaceId) ?? marketplaceId,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
}

async function listInventoryLocations(
  api: LivePublishConfigDiscoveryApi
): Promise<{ locations: InventoryLocationResponse[]; error?: unknown }> {
  if (typeof api.inventory.getInventoryLocations !== 'function') {
    return {
      locations: [],
      error: new Error(
        'Inventory location listing unavailable in current API surface. Create or use a known merchantLocationKey manually.'
      ),
    };
  }

  const collected: InventoryLocationResponse[] = [];
  let offset = 0;
  const pageSize = 100;

  try {
    while (true) {
      const response = (await api.inventory.getInventoryLocations(
        pageSize,
        offset
      )) as LocationResponse;
      const locations = response.locations ?? [];
      collected.push(...locations);

      const total = typeof response.total === 'number' ? response.total : null;
      const returned = locations.length;
      const limit =
        typeof response.limit === 'number' && response.limit > 0 ? response.limit : pageSize;
      const nextOffset = offset + Math.max(returned, limit);

      if (typeof response.next === 'string' && response.next.length > 0) {
        offset = nextOffset;
        continue;
      }

      if (total !== null && collected.length < total && returned > 0) {
        offset = nextOffset;
        continue;
      }

      break;
    }
  } catch (error) {
    return {
      error,
      locations: collected,
    };
  }

  return { locations: collected };
}

function mapInventoryLocations(
  locations: InventoryLocationResponse[]
): LivePublishConfigDiscoveryReport['inventoryLocations'] {
  return locations
    .map((location) => {
      const merchantLocationKey = normalizeText(location.merchantLocationKey);
      if (!merchantLocationKey) {
        return null;
      }

      return {
        merchantLocationKey,
        name: normalizeText(location.name) ?? merchantLocationKey,
        status: normalizeText(location.merchantLocationStatus) ?? 'UNKNOWN',
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
}

async function runPolicyFamily<TPolicyResponse, TPolicySummary>(input: {
  apiCall: () => Promise<TPolicyResponse>;
  family: 'account';
  mapResponse: (response: TPolicyResponse | undefined) => TPolicySummary[];
  sensitiveValues: string[];
  ineligibleMessage: string;
}): Promise<{
  entries: TPolicySummary[];
  errors: LivePublishConfigDiscoveryError[];
  ineligible: boolean;
}> {
  try {
    const response = await input.apiCall();
    return {
      entries: input.mapResponse(response),
      errors: [],
      ineligible: false,
    };
  } catch (error) {
    if (isBusinessPolicyIneligibleError(error)) {
      return {
        entries: [],
        errors: [
          buildError(
            input.family,
            input.ineligibleMessage,
            serializeError(error, input.sensitiveValues)
          ),
        ],
        ineligible: true,
      };
    }

    return {
      entries: [],
      errors: [
        buildError(
          input.family,
          'Failed to list publish config values.',
          serializeError(error, input.sensitiveValues)
        ),
      ],
      ineligible: false,
    };
  }
}

export async function discoverLivePublishConfig({
  api,
  oauthConfig,
  runtimeConfig,
  validateOAuth: validateOAuthImpl,
}: LivePublishConfigDiscoveryOptions): Promise<LivePublishConfigDiscoveryReport> {
  const checkedAt = new Date().toISOString();
  const marketplaceId = normalizeMarketplaceId(runtimeConfig.marketplaceId ?? oauthConfig.marketplaceId);
  const sensitiveValues = getSensitiveValues(runtimeConfig, oauthConfig);

  if (!isProductionEnvironment(runtimeConfig.environment) || !isProductionEnvironment(oauthConfig.environment)) {
    return {
      environment: runtimeConfig.environment,
      marketplaceId,
      apiBaseUrl: PRODUCTION_API_BASE_URL,
      checkedAt,
      overallStatus: 'failed',
      paymentPolicies: [],
      fulfillmentPolicies: [],
      returnPolicies: [],
      inventoryLocations: [],
      errors: [
        buildError('preflight', 'EBAY_ENVIRONMENT must be exactly "production".', {
          runtimeEnvironment: runtimeConfig.environment,
          oauthEnvironment: oauthConfig.environment,
          expectedEnvironment: 'production',
        }),
      ],
    };
  }

  if (oauthConfig.apiBaseUrl !== PRODUCTION_API_BASE_URL || oauthConfig.oauthBaseUrl !== PRODUCTION_OAUTH_BASE_URL) {
    return {
      environment: 'production',
      marketplaceId,
      apiBaseUrl: PRODUCTION_API_BASE_URL,
      checkedAt,
      overallStatus: 'failed',
      paymentPolicies: [],
      fulfillmentPolicies: [],
      returnPolicies: [],
      inventoryLocations: [],
      errors: [
        buildError('preflight', 'Production API base URLs required for live publish config discovery.', {
          apiBaseUrl: oauthConfig.apiBaseUrl,
          oauthBaseUrl: oauthConfig.oauthBaseUrl,
          expectedApiBaseUrl: PRODUCTION_API_BASE_URL,
          expectedOauthBaseUrl: PRODUCTION_OAUTH_BASE_URL,
        }),
      ],
    };
  }

  const validateOAuth = validateOAuthImpl ?? validateEbayOAuth;

  let oauthResult: EbayOAuthValidationResult;
  try {
    oauthResult = await validateOAuth(oauthConfig);
  } catch (error) {
    return {
      environment: 'production',
      marketplaceId,
      apiBaseUrl: PRODUCTION_API_BASE_URL,
      checkedAt,
      overallStatus: 'failed',
      paymentPolicies: [],
      fulfillmentPolicies: [],
      returnPolicies: [],
      inventoryLocations: [],
      errors: [buildError('oauth', 'Failed to initialize production OAuth token.', serializeError(error, sensitiveValues))],
    };
  }

  try {
    await api.initialize();
  } catch (error) {
    return {
      environment: 'production',
      marketplaceId,
      apiBaseUrl: PRODUCTION_API_BASE_URL,
      checkedAt,
      overallStatus: 'failed',
      paymentPolicies: [],
      fulfillmentPolicies: [],
      returnPolicies: [],
      inventoryLocations: [],
      errors: [buildError('oauth', 'Failed to initialize production eBay API client.', serializeError(error, sensitiveValues))],
    };
  }

  const [paymentPoliciesResult, fulfillmentPoliciesResult, returnPoliciesResult, inventoryResult] =
    await Promise.all([
      runPolicyFamily<PaymentPolicyResponse, LivePublishConfigDiscoveryReport['paymentPolicies'][number]>({
        apiCall: async () => await api.account.getPaymentPolicies(marketplaceId),
        family: 'account',
        mapResponse: (response) => mapPaymentPolicies(response, marketplaceId),
        sensitiveValues,
        ineligibleMessage: 'User is not eligible for Business Policy. Payment policies unavailable.',
      }),
      runPolicyFamily<FulfillmentPolicyResponse, LivePublishConfigDiscoveryReport['fulfillmentPolicies'][number]>({
        apiCall: async () => await api.account.getFulfillmentPolicies(marketplaceId),
        family: 'account',
        mapResponse: (response) => mapFulfillmentPolicies(response, marketplaceId),
        sensitiveValues,
        ineligibleMessage: 'User is not eligible for Business Policy. Fulfillment policies unavailable.',
      }),
      runPolicyFamily<ReturnPolicyResponse, LivePublishConfigDiscoveryReport['returnPolicies'][number]>({
        apiCall: async () => await api.account.getReturnPolicies(marketplaceId),
        family: 'account',
        mapResponse: (response) => mapReturnPolicies(response, marketplaceId),
        sensitiveValues,
        ineligibleMessage: 'User is not eligible for Business Policy. Return policies unavailable.',
      }),
      listInventoryLocations(api),
    ]);

  const policyErrors = [
    ...paymentPoliciesResult.errors,
    ...fulfillmentPoliciesResult.errors,
    ...returnPoliciesResult.errors,
  ];

  const businessPolicyIneligible =
    paymentPoliciesResult.ineligible ||
    fulfillmentPoliciesResult.ineligible ||
    returnPoliciesResult.ineligible;

  const inventoryErrors: LivePublishConfigDiscoveryError[] = [];
  if ('error' in inventoryResult && inventoryResult.error) {
    inventoryErrors.push(
      buildError(
        'inventory',
        normalizeErrorMessage(inventoryResult.error).includes('Inventory location listing unavailable')
          ? normalizeErrorMessage(inventoryResult.error)
          : 'Failed to list inventory locations.',
        serializeError(inventoryResult.error, sensitiveValues)
      )
    );
  }

  const reportErrors = [...policyErrors, ...inventoryErrors];
  const overallStatus: LivePublishConfigDiscoveryReport['overallStatus'] =
    reportErrors.length === 0 ? 'ok' : 'partial';

  const response = {
    environment: 'production',
    marketplaceId: normalizeText(oauthResult.marketplaceId) ?? marketplaceId,
    apiBaseUrl: PRODUCTION_API_BASE_URL,
    checkedAt,
    overallStatus,
    paymentPolicies: businessPolicyIneligible ? [] : paymentPoliciesResult.entries,
    fulfillmentPolicies: businessPolicyIneligible ? [] : fulfillmentPoliciesResult.entries,
    returnPolicies: businessPolicyIneligible ? [] : returnPoliciesResult.entries,
    inventoryLocations: mapInventoryLocations(inventoryResult.locations),
    errors: reportErrors,
  } satisfies LivePublishConfigDiscoveryReport;

  return response;
}
