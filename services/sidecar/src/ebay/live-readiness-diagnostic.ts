import { DEFAULT_APP_SETTINGS_ID, type AppSettingsRow } from '@ebay-inventory/data';
import { EbayApiRequestError } from '@/api/client.js';
import type { SidecarDataAccess } from '@/data/sidecar-data.js';
import type { EbayOAuthValidationConfig } from '@/ebay/config.js';
import { getPublishAppSettingIssues } from '@/ebay/publish-validation.js';
import { EbayOAuthRequestError, type ExchangeRefreshTokenOptions } from '@/ebay/oauth-client.js';
import {
  validateEbayOAuth,
  type EbayOAuthValidationResult,
} from '@/ebay/validate-oauth.js';
import type { EbayConfig } from '@/types/ebay.js';
import type { AccountApi } from '@/api/account-management/account.js';
import type { InventoryApi } from '@/api/listing-management/inventory.js';
import type { components as AccountComponents } from '@/types/sell-apps/account-management/sellAccountV1Oas3.js';
import type { components as InventoryComponents } from '@/types/sell-apps/listing-management/sellInventoryV1Oas3.js';

type PaymentPolicy = AccountComponents['schemas']['PaymentPolicy'];
type FulfillmentPolicy = AccountComponents['schemas']['FulfillmentPolicy'];
type ReturnPolicy = AccountComponents['schemas']['ReturnPolicy'];
type InventoryLocationFull = InventoryComponents['schemas']['InventoryLocationFull'];

const PRODUCTION_API_BASE_URL = 'https://api.ebay.com';
const PRODUCTION_OAUTH_BASE_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const DEFAULT_MARKETPLACE_ID = 'EBAY_US';

export const LIVE_READINESS_CHECK_NAMES = [
  'environment_config',
  'production_publish_guard',
  'oauth_refresh',
  'seller_account_access',
  'payment_policy',
  'fulfillment_policy',
  'return_policy',
  'inventory_location',
  'publish_config_resolution',
] as const;

export type LiveReadinessCheckName = (typeof LIVE_READINESS_CHECK_NAMES)[number];
export type LiveReadinessCheckStatus = 'pass' | 'fail' | 'warning';
export type LiveReadinessOverallStatus = 'ready' | 'blocked' | 'warning';

export interface LiveReadinessCheck {
  details: Record<string, unknown>;
  message: string;
  name: LiveReadinessCheckName;
  status: LiveReadinessCheckStatus;
}

export interface LiveReadinessReport {
  apiBaseUrl: string;
  checkedAt: string;
  checks: LiveReadinessCheck[];
  environment: string;
  marketplaceId: string;
  overallStatus: LiveReadinessOverallStatus;
  productionPublishEnabled: boolean;
}

export interface LiveReadinessApi {
  account: Pick<
    AccountApi,
    'getFulfillmentPolicy' | 'getPaymentPolicy' | 'getPrivileges' | 'getReturnPolicy'
  >;
  initialize(): Promise<void>;
  inventory: Pick<InventoryApi, 'getInventoryLocation'>;
}

export interface LiveReadinessDiagnosticOptions {
  api: LiveReadinessApi;
  appSettingsId?: string;
  dataAccess: Pick<SidecarDataAccess, 'appSettings'>;
  oauthConfig: EbayOAuthValidationConfig;
  oauthOptions?: ExchangeRefreshTokenOptions;
  runtimeConfig: EbayConfig;
  validateOAuth?: (
    config: EbayOAuthValidationConfig,
    options?: ExchangeRefreshTokenOptions
  ) => Promise<EbayOAuthValidationResult>;
}

interface ReportContext {
  apiBaseUrl: string;
  checkedAt: string;
  environment: string;
  marketplaceId: string;
  oauthBaseUrl: string;
  productionPublishEnabled: boolean;
  sensitiveValues: string[];
}

interface FailureReportOptions {
  apiBaseUrl?: string;
  checkedAt?: string;
  environment?: string;
  error: unknown;
  marketplaceId?: string;
  oauthBaseUrl?: string;
  processEnv?: NodeJS.ProcessEnv;
  productionPublishEnabled?: boolean;
  sensitiveValues?: string[];
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

function isPublishMarketplaceId(value: string | null | undefined): boolean {
  const normalized = normalizeText(value);
  return normalized ? /^EBAY_[A-Z_]+$/.test(normalized) : false;
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
  runtimeConfig?: Partial<EbayConfig>,
  oauthConfig?: Partial<EbayOAuthValidationConfig>,
  processEnv: NodeJS.ProcessEnv = process.env
): string[] {
  const candidateValues = [
    runtimeConfig?.clientSecret,
    runtimeConfig?.refreshToken,
    runtimeConfig?.accessToken,
    runtimeConfig?.appAccessToken,
    oauthConfig?.clientSecret,
    oauthConfig?.refreshToken,
    processEnv.EBAY_CLIENT_SECRET,
    processEnv.EBAY_REFRESH_TOKEN,
    processEnv.EBAY_USER_REFRESH_TOKEN,
    processEnv.EBAY_USER_ACCESS_TOKEN,
    processEnv.EBAY_APP_ACCESS_TOKEN,
  ].filter(hasText);

  const basicCredential =
    hasText(runtimeConfig?.clientId) && hasText(runtimeConfig?.clientSecret)
      ? Buffer.from(`${runtimeConfig.clientId}:${runtimeConfig.clientSecret}`).toString('base64')
      : hasText(oauthConfig?.clientId) && hasText(oauthConfig?.clientSecret)
        ? Buffer.from(`${oauthConfig.clientId}:${oauthConfig.clientSecret}`).toString('base64')
        : null;

  if (basicCredential) {
    candidateValues.push(basicCredential);
  }

  return [...new Set(candidateValues)];
}

function buildCheck(
  name: LiveReadinessCheckName,
  status: LiveReadinessCheckStatus,
  message: string,
  details: Record<string, unknown> = {}
): LiveReadinessCheck {
  return {
    details,
    message,
    name,
    status,
  };
}

function buildBlockedCheck(
  name: Exclude<
    LiveReadinessCheckName,
    'environment_config' | 'production_publish_guard' | 'oauth_refresh' | 'publish_config_resolution'
  >,
  blockedBy: 'environment_config' | 'oauth_refresh',
  message: string
): LiveReadinessCheck {
  return buildCheck(name, 'warning', message, { blockedBy });
}

function buildReport(
  context: Pick<
    ReportContext,
    'apiBaseUrl' | 'checkedAt' | 'environment' | 'marketplaceId' | 'productionPublishEnabled'
  >,
  checks: LiveReadinessCheck[]
): LiveReadinessReport {
  const hasFailure = checks.some((check) => check.status === 'fail');
  const hasBlockingWarning = checks.some(
    (check) => check.status === 'warning' && check.name !== 'production_publish_guard'
  );
  const hasWarning = checks.some((check) => check.status === 'warning');

  return {
    apiBaseUrl: context.apiBaseUrl,
    checkedAt: context.checkedAt,
    checks,
    environment: context.environment,
    marketplaceId: context.marketplaceId,
    overallStatus: hasFailure || hasBlockingWarning ? 'blocked' : hasWarning ? 'warning' : 'ready',
    productionPublishEnabled: context.productionPublishEnabled,
  };
}

function normalizePublishIssueForLiveReadiness(issue: string): string {
  return issue
    .replaceAll(
      'Run sandbox policy diagnostics and update app_settings.default before publish.',
      'Run live readiness diagnostics and update app_settings.default before publish.'
    )
    .replaceAll(
      'Run sandbox location diagnostics and update app_settings.default before publish.',
      'Run live readiness diagnostics and update app_settings.default before publish.'
    );
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

  if (error instanceof EbayOAuthRequestError) {
    return {
      message: sanitizeText(error.message, sensitiveValues),
      statusCode: error.status,
    };
  }

  if (error instanceof Error) {
    const base: Record<string, unknown> = {
      message: sanitizeText(error.message, sensitiveValues),
      name: error.name,
    };

    const issues = (error as { issues?: { message?: string; path?: unknown }[] }).issues;
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

function buildEnvironmentCheck(
  runtimeConfig: EbayConfig,
  oauthConfig: EbayOAuthValidationConfig,
  sensitiveValues: string[]
): LiveReadinessCheck {
  const details: Record<string, unknown> = {
    apiBaseUrl: oauthConfig.apiBaseUrl,
    expectedApiBaseUrl: PRODUCTION_API_BASE_URL,
    expectedEnvironment: 'production',
    expectedMarketplaceId: DEFAULT_MARKETPLACE_ID,
    expectedOauthBaseUrl: PRODUCTION_OAUTH_BASE_URL,
    oauthBaseUrl: oauthConfig.oauthBaseUrl,
    runtimeEnvironment: runtimeConfig.environment,
    runtimeMarketplaceId: runtimeConfig.marketplaceId ?? null,
    validationMarketplaceId: oauthConfig.marketplaceId,
  };

  const failures: string[] = [];

  if (!isProductionEnvironment(process.env.EBAY_ENVIRONMENT)) {
    failures.push('EBAY_ENVIRONMENT must be exactly "production".');
  }

  if (runtimeConfig.environment !== 'production') {
    failures.push('Runtime eBay config did not resolve to production.');
  }

  if (oauthConfig.environment !== 'production') {
    failures.push('OAuth validation config did not resolve to production.');
  }

  if (oauthConfig.apiBaseUrl !== PRODUCTION_API_BASE_URL) {
    failures.push('API base URL must resolve to production host.');
  }

  if (oauthConfig.oauthBaseUrl !== PRODUCTION_OAUTH_BASE_URL) {
    failures.push('OAuth base URL must resolve to production token endpoint.');
  }

  if (!hasText(runtimeConfig.marketplaceId) || !isPublishMarketplaceId(runtimeConfig.marketplaceId)) {
    failures.push('Runtime marketplace must be configured to a valid publish marketplace.');
  }

  if (!hasText(oauthConfig.marketplaceId) || !isPublishMarketplaceId(oauthConfig.marketplaceId)) {
    failures.push('OAuth validation marketplace must be configured to a valid publish marketplace.');
  }

  if (
    hasText(runtimeConfig.marketplaceId) &&
    hasText(oauthConfig.marketplaceId) &&
    runtimeConfig.marketplaceId !== oauthConfig.marketplaceId
  ) {
    failures.push('Runtime marketplace does not match OAuth validation marketplace.');
  }

  if (
    hasText(runtimeConfig.marketplaceId) &&
    runtimeConfig.marketplaceId !== DEFAULT_MARKETPLACE_ID
  ) {
    failures.push(`Runtime marketplace must resolve to ${DEFAULT_MARKETPLACE_ID}.`);
  }

  if (
    hasText(oauthConfig.marketplaceId) &&
    oauthConfig.marketplaceId !== DEFAULT_MARKETPLACE_ID
  ) {
    failures.push(`OAuth validation marketplace must resolve to ${DEFAULT_MARKETPLACE_ID}.`);
  }

  if (failures.length === 0) {
    return buildCheck(
      'environment_config',
      'pass',
      'Production environment and base URLs resolved correctly.',
      details
    );
  }

  return buildCheck(
    'environment_config',
    'fail',
    sanitizeText(failures.join(' '), sensitiveValues),
    sanitizeUnknown(details, sensitiveValues) as Record<string, unknown>
  );
}

function buildProductionPublishGuardCheck(
  oauthConfig: EbayOAuthValidationConfig
): LiveReadinessCheck {
  return oauthConfig.publishEnabled
    ? buildCheck(
        'production_publish_guard',
        'pass',
        'Production publish guard enabled.',
        {
          productionPublishEnabled: true,
        }
      )
    : buildCheck(
        'production_publish_guard',
        'warning',
        'Production publish guard disabled. Live publish remains locally blocked.',
        {
          productionPublishEnabled: false,
        }
      );
}

async function loadAppSettings(
  dataAccess: Pick<SidecarDataAccess, 'appSettings'>,
  appSettingsId: string
): Promise<{ error?: unknown; value: AppSettingsRow | null }> {
  try {
    return {
      value: await dataAccess.appSettings.get(appSettingsId),
    };
  } catch (error) {
    return {
      error,
      value: null,
    };
  }
}

function buildPublishConfigResolutionCheck(
  appSettingsState: { error?: unknown; value: AppSettingsRow | null },
  context: ReportContext
): LiveReadinessCheck {
  if (appSettingsState.error) {
    return buildCheck(
      'publish_config_resolution',
      'fail',
      'Could not resolve publish config from app_settings.default.',
      serializeError(appSettingsState.error, context.sensitiveValues)
    );
  }

  if (!appSettingsState.value) {
    return buildCheck(
      'publish_config_resolution',
      'fail',
      'Required app_settings.default row missing.',
      {
        appSettingsId: DEFAULT_APP_SETTINGS_ID,
      }
    );
  }

  const issues = getPublishAppSettingIssues(appSettingsState.value).map(
    normalizePublishIssueForLiveReadiness
  );

  if (appSettingsState.value.ebay_marketplace_id !== context.marketplaceId) {
    issues.push(
      `app_settings.ebay_marketplace_id "${appSettingsState.value.ebay_marketplace_id ?? '[missing]'}" does not match runtime marketplace "${context.marketplaceId}".`
    );
  }

  if (context.environment !== 'production') {
    issues.push('Runtime environment must resolve to production for live publish readiness.');
  }

  const details = {
    appSettingsId: appSettingsState.value.id,
    default_fulfillment_policy_id: appSettingsState.value.default_fulfillment_policy_id,
    default_payment_policy_id: appSettingsState.value.default_payment_policy_id,
    default_return_policy_id: appSettingsState.value.default_return_policy_id,
    ebay_marketplace_id: appSettingsState.value.ebay_marketplace_id,
    issues,
    merchant_location_key: appSettingsState.value.merchant_location_key,
    runtimeMarketplaceId: context.marketplaceId,
  };

  if (issues.length === 0) {
    return buildCheck(
      'publish_config_resolution',
      'pass',
      'Publish config resolved successfully from app_settings.default.',
      details
    );
  }

  return buildCheck(
    'publish_config_resolution',
    'fail',
    'Publish config could not be resolved safely for production.',
    details
  );
}

async function runOauthCheck(
  oauthConfig: EbayOAuthValidationConfig,
  validateOAuthImpl: LiveReadinessDiagnosticOptions['validateOAuth'],
  oauthOptions: ExchangeRefreshTokenOptions | undefined,
  sensitiveValues: string[]
): Promise<LiveReadinessCheck> {
  try {
    const result = await (validateOAuthImpl ?? validateEbayOAuth)(oauthConfig, oauthOptions);
    return buildCheck('oauth_refresh', 'pass', 'Production refresh token minted a user access token.', {
      expiresIn: result.expiresIn,
      tokenType: result.tokenType,
    });
  } catch (error) {
    return buildCheck(
      'oauth_refresh',
      'fail',
      'Production refresh token could not mint a user access token.',
      serializeError(error, sensitiveValues)
    );
  }
}

async function runSellerAccessCheck(context: ReportContext, api: LiveReadinessApi): Promise<LiveReadinessCheck> {
  try {
    await api.account.getPrivileges();
    return buildCheck(
      'seller_account_access',
      'pass',
      'Seller account access check succeeded via production Account API privileges read.',
      {}
    );
  } catch (error) {
    return buildCheck(
      'seller_account_access',
      'fail',
      'Seller account access check failed.',
      serializeError(error, context.sensitiveValues)
    );
  }
}

function getConfiguredValue(
  appSettingsState: { error?: unknown; value: AppSettingsRow | null },
  field:
    | 'default_payment_policy_id'
    | 'default_fulfillment_policy_id'
    | 'default_return_policy_id'
    | 'merchant_location_key'
): string | null {
  const value = appSettingsState.value?.[field];
  return normalizeText(typeof value === 'string' ? value : null);
}

async function runPolicyCheck<TPolicy extends { marketplaceId?: string | null; name?: string | null }>(
  input: {
    apiCall: (id: string) => Promise<TPolicy>;
    appSettingsState: { error?: unknown; value: AppSettingsRow | null };
    checkName: 'payment_policy' | 'fulfillment_policy' | 'return_policy';
    context: ReportContext;
    field:
      | 'default_payment_policy_id'
      | 'default_fulfillment_policy_id'
      | 'default_return_policy_id';
    idField: 'paymentPolicyId' | 'fulfillmentPolicyId' | 'returnPolicyId';
    label: string;
  }
): Promise<LiveReadinessCheck> {
  if (input.appSettingsState.error) {
    return buildCheck(
      input.checkName,
      'fail',
      `Could not read ${input.field} from app_settings.default.`,
      serializeError(input.appSettingsState.error, input.context.sensitiveValues)
    );
  }

  if (!input.appSettingsState.value) {
    return buildCheck(input.checkName, 'fail', 'Required app_settings.default row missing.', {
      appSettingsId: DEFAULT_APP_SETTINGS_ID,
    });
  }

  const configuredValue = getConfiguredValue(input.appSettingsState, input.field);
  if (!configuredValue) {
    return buildCheck(
      input.checkName,
      'fail',
      `${input.field} is required for live publish readiness.`,
      {
        configuredValue: null,
      }
    );
  }

  try {
    const policy = await input.apiCall(configuredValue);
    const policyMarketplaceId = normalizeText(policy.marketplaceId);
    if (policyMarketplaceId && policyMarketplaceId !== input.context.marketplaceId) {
      return buildCheck(
        input.checkName,
        'fail',
        `${input.label} exists but belongs to a different marketplace.`,
        {
          configuredValue,
          marketplaceId: policyMarketplaceId,
          name: normalizeText(policy.name),
          expectedMarketplaceId: input.context.marketplaceId,
        }
      );
    }

    return buildCheck(
      input.checkName,
      'pass',
      `${input.label} exists remotely for configured marketplace.`,
      {
        configuredValue,
        marketplaceId: policyMarketplaceId ?? input.context.marketplaceId,
        name: normalizeText(policy.name),
        [input.idField]: configuredValue,
      }
    );
  } catch (error) {
    return buildCheck(
      input.checkName,
      'fail',
      `${input.label} could not be verified remotely.`,
      {
        configuredValue,
        ...serializeError(error, input.context.sensitiveValues),
      }
    );
  }
}

async function runInventoryLocationCheck(
  context: ReportContext,
  api: LiveReadinessApi,
  appSettingsState: { error?: unknown; value: AppSettingsRow | null }
): Promise<LiveReadinessCheck> {
  if (appSettingsState.error) {
    return buildCheck(
      'inventory_location',
      'fail',
      'Could not read merchant_location_key from app_settings.default.',
      serializeError(appSettingsState.error, context.sensitiveValues)
    );
  }

  if (!appSettingsState.value) {
    return buildCheck('inventory_location', 'fail', 'Required app_settings.default row missing.', {
      appSettingsId: DEFAULT_APP_SETTINGS_ID,
    });
  }

  const merchantLocationKey = getConfiguredValue(appSettingsState, 'merchant_location_key');
  if (!merchantLocationKey) {
    return buildCheck(
      'inventory_location',
      'fail',
      'merchant_location_key is required for live publish readiness.',
      {
        configuredValue: null,
      }
    );
  }

  try {
    const location = (await api.inventory.getInventoryLocation(merchantLocationKey)) as InventoryLocationFull;
    return buildCheck(
      'inventory_location',
      'pass',
      'Inventory location exists remotely.',
      {
        merchantLocationKey,
        name: normalizeText(location.name),
        status: normalizeText(location.merchantLocationStatus),
      }
    );
  } catch (error) {
    return buildCheck(
      'inventory_location',
      'fail',
      'Inventory location could not be verified remotely.',
      {
        merchantLocationKey,
        ...serializeError(error, context.sensitiveValues),
      }
    );
  }
}

export async function getLiveReadinessDiagnostic({
  api,
  appSettingsId = DEFAULT_APP_SETTINGS_ID,
  dataAccess,
  oauthConfig,
  oauthOptions,
  runtimeConfig,
  validateOAuth: validateOAuthImpl,
}: LiveReadinessDiagnosticOptions): Promise<LiveReadinessReport> {
  const checkedAt = new Date().toISOString();
  const sensitiveValues = getSensitiveValues(runtimeConfig, oauthConfig);
  const context: ReportContext = {
    apiBaseUrl: oauthConfig.apiBaseUrl,
    checkedAt,
    environment: runtimeConfig.environment,
    marketplaceId: runtimeConfig.marketplaceId ?? oauthConfig.marketplaceId ?? DEFAULT_MARKETPLACE_ID,
    oauthBaseUrl: oauthConfig.oauthBaseUrl,
    productionPublishEnabled: oauthConfig.publishEnabled,
    sensitiveValues,
  };

  const environmentCheck = buildEnvironmentCheck(runtimeConfig, oauthConfig, sensitiveValues);
  const productionPublishGuardCheck = buildProductionPublishGuardCheck(oauthConfig);
  const appSettingsState = await loadAppSettings(dataAccess, appSettingsId);
  const publishConfigCheck = buildPublishConfigResolutionCheck(appSettingsState, context);

  if (environmentCheck.status === 'fail') {
    return buildReport(context, [
      environmentCheck,
      productionPublishGuardCheck,
      buildCheck(
        'oauth_refresh',
        'warning',
        'OAuth refresh check skipped because production environment config failed.',
        { blockedBy: 'environment_config' }
      ),
      buildBlockedCheck(
        'seller_account_access',
        'environment_config',
        'Seller account access check skipped because production environment config failed.'
      ),
      buildBlockedCheck(
        'payment_policy',
        'environment_config',
        'Payment policy check skipped because production environment config failed.'
      ),
      buildBlockedCheck(
        'fulfillment_policy',
        'environment_config',
        'Fulfillment policy check skipped because production environment config failed.'
      ),
      buildBlockedCheck(
        'return_policy',
        'environment_config',
        'Return policy check skipped because production environment config failed.'
      ),
      buildBlockedCheck(
        'inventory_location',
        'environment_config',
        'Inventory location check skipped because production environment config failed.'
      ),
      publishConfigCheck,
    ]);
  }

  const oauthCheck = await runOauthCheck(
    oauthConfig,
    validateOAuthImpl,
    oauthOptions,
    sensitiveValues
  );

  if (oauthCheck.status === 'fail') {
    return buildReport(context, [
      environmentCheck,
      productionPublishGuardCheck,
      oauthCheck,
      buildBlockedCheck(
        'seller_account_access',
        'oauth_refresh',
        'Seller account access check skipped because OAuth refresh failed.'
      ),
      buildBlockedCheck(
        'payment_policy',
        'oauth_refresh',
        'Payment policy check skipped because OAuth refresh failed.'
      ),
      buildBlockedCheck(
        'fulfillment_policy',
        'oauth_refresh',
        'Fulfillment policy check skipped because OAuth refresh failed.'
      ),
      buildBlockedCheck(
        'return_policy',
        'oauth_refresh',
        'Return policy check skipped because OAuth refresh failed.'
      ),
      buildBlockedCheck(
        'inventory_location',
        'oauth_refresh',
        'Inventory location check skipped because OAuth refresh failed.'
      ),
      publishConfigCheck,
    ]);
  }

  try {
    await api.initialize();
  } catch (error) {
    const initFailureDetails = serializeError(error, sensitiveValues);
    return buildReport(context, [
      environmentCheck,
      productionPublishGuardCheck,
      oauthCheck,
      buildCheck(
        'seller_account_access',
        'fail',
        'Failed to initialize eBay seller API for live diagnostics.',
        initFailureDetails
      ),
      buildCheck(
        'payment_policy',
        'fail',
        'Failed to initialize eBay seller API for live diagnostics.',
        initFailureDetails
      ),
      buildCheck(
        'fulfillment_policy',
        'fail',
        'Failed to initialize eBay seller API for live diagnostics.',
        initFailureDetails
      ),
      buildCheck(
        'return_policy',
        'fail',
        'Failed to initialize eBay seller API for live diagnostics.',
        initFailureDetails
      ),
      buildCheck(
        'inventory_location',
        'fail',
        'Failed to initialize eBay seller API for live diagnostics.',
        initFailureDetails
      ),
      publishConfigCheck,
    ]);
  }

  const [
    sellerAccessCheck,
    paymentPolicyCheck,
    fulfillmentPolicyCheck,
    returnPolicyCheck,
    inventoryLocationCheck,
  ] = await Promise.all([
    runSellerAccessCheck(context, api),
    runPolicyCheck<PaymentPolicy>({
      apiCall: async (id) => await api.account.getPaymentPolicy(id),
      appSettingsState,
      checkName: 'payment_policy',
      context,
      field: 'default_payment_policy_id',
      idField: 'paymentPolicyId',
      label: 'Payment policy',
    }),
    runPolicyCheck<FulfillmentPolicy>({
      apiCall: async (id) => await api.account.getFulfillmentPolicy(id),
      appSettingsState,
      checkName: 'fulfillment_policy',
      context,
      field: 'default_fulfillment_policy_id',
      idField: 'fulfillmentPolicyId',
      label: 'Fulfillment policy',
    }),
    runPolicyCheck<ReturnPolicy>({
      apiCall: async (id) => await api.account.getReturnPolicy(id),
      appSettingsState,
      checkName: 'return_policy',
      context,
      field: 'default_return_policy_id',
      idField: 'returnPolicyId',
      label: 'Return policy',
    }),
    runInventoryLocationCheck(context, api, appSettingsState),
  ]);

  return buildReport(context, [
    environmentCheck,
    productionPublishGuardCheck,
    oauthCheck,
    sellerAccessCheck,
    paymentPolicyCheck,
    fulfillmentPolicyCheck,
    returnPolicyCheck,
    inventoryLocationCheck,
    publishConfigCheck,
  ]);
}

export function createUnexpectedLiveReadinessReport({
  apiBaseUrl,
  checkedAt = new Date().toISOString(),
  environment = process.env.EBAY_ENVIRONMENT ?? 'unknown',
  error,
  marketplaceId = process.env.EBAY_MARKETPLACE_ID ?? DEFAULT_MARKETPLACE_ID,
  oauthBaseUrl,
  processEnv = process.env,
  productionPublishEnabled = processEnv.EBAY_PUBLISH_ENABLED === 'true',
  sensitiveValues = [],
}: FailureReportOptions): LiveReadinessReport {
  const mergedSensitiveValues = [
    ...new Set([
      ...sensitiveValues,
      ...getSensitiveValues(undefined, undefined, processEnv),
    ]),
  ];
  const resolvedApiBaseUrl =
    apiBaseUrl ??
    (environment === 'production' ? PRODUCTION_API_BASE_URL : 'https://api.sandbox.ebay.com');
  const resolvedOauthBaseUrl =
    oauthBaseUrl ??
    (environment === 'production'
      ? PRODUCTION_OAUTH_BASE_URL
      : 'https://api.sandbox.ebay.com/identity/v1/oauth2/token');
  const failureDetails = serializeError(error, mergedSensitiveValues);

  return buildReport(
    {
      apiBaseUrl: resolvedApiBaseUrl,
      checkedAt,
      environment,
      marketplaceId,
      productionPublishEnabled,
    },
    [
      buildCheck(
        'environment_config',
        'fail',
        'Failed to prepare live readiness diagnostic.',
        failureDetails
      ),
      buildCheck(
        'production_publish_guard',
        productionPublishEnabled ? 'pass' : 'warning',
        productionPublishEnabled
          ? 'Production publish guard enabled.'
          : 'Production publish guard disabled. Live publish remains locally blocked.',
        {
          oauthBaseUrl: resolvedOauthBaseUrl,
          productionPublishEnabled,
        }
      ),
      buildCheck(
        'oauth_refresh',
        'warning',
        'OAuth refresh check skipped because diagnostic preparation failed.',
        { blockedBy: 'environment_config' }
      ),
      buildBlockedCheck(
        'seller_account_access',
        'environment_config',
        'Seller account access check skipped because diagnostic preparation failed.'
      ),
      buildBlockedCheck(
        'payment_policy',
        'environment_config',
        'Payment policy check skipped because diagnostic preparation failed.'
      ),
      buildBlockedCheck(
        'fulfillment_policy',
        'environment_config',
        'Fulfillment policy check skipped because diagnostic preparation failed.'
      ),
      buildBlockedCheck(
        'return_policy',
        'environment_config',
        'Return policy check skipped because diagnostic preparation failed.'
      ),
      buildBlockedCheck(
        'inventory_location',
        'environment_config',
        'Inventory location check skipped because diagnostic preparation failed.'
      ),
      buildCheck(
        'publish_config_resolution',
        'warning',
        'Publish config resolution check skipped because diagnostic preparation failed.',
        { blockedBy: 'environment_config' }
      ),
    ]
  );
}
