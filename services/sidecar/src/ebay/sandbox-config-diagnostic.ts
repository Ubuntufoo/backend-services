import { DEFAULT_APP_SETTINGS_ID, type AppSettingsRow } from '@ebay-inventory/data';
import type { SidecarDataAccess } from '@/data/sidecar-data.js';
import { getPublishAppSettingIssues } from '@/ebay/publish-config.js';
import {
  DEFAULT_LOCATION_KEY,
  POLICY_NAMES,
  validateSandboxOAuthAccess,
  type SandboxBootstrapApi,
} from '@/ebay/sandbox-bootstrap.js';
import { getSandboxSellingPolicyManagementDiagnostic } from '@/ebay/sandbox-selling-policy-program.js';
import type { SandboxProgramApi } from '@/ebay/sandbox-selling-policy-program.js';
import type { components as AccountComponents } from '@/types/sell-apps/account-management/sellAccountV1Oas3.js';
import type { components as InventoryComponents } from '@/types/sell-apps/listing-management/sellInventoryV1Oas3.js';
import type { ComponentLogger } from '@/utils/logger.js';
import { setupLogger } from '@/utils/logger.js';

type FulfillmentPolicy = AccountComponents['schemas']['FulfillmentPolicy'];
type PaymentPolicy = AccountComponents['schemas']['PaymentPolicy'];
type ReturnPolicy = AccountComponents['schemas']['ReturnPolicy'];
type InventoryLocationResponse = InventoryComponents['schemas']['InventoryLocationResponse'];
type LocationResponse = InventoryComponents['schemas']['LocationResponse'];
type InventoryLocationFull = InventoryComponents['schemas']['InventoryLocationFull'];

type SafeAppSettings = Pick<
  AppSettingsRow,
  | 'default_fulfillment_policy_id'
  | 'default_payment_policy_id'
  | 'default_return_policy_id'
  | 'ebay_marketplace_id'
  | 'id'
  | 'merchant_location_key'
>;

export interface SandboxConfigDiagnosticOptions {
  api: SandboxBootstrapApi & Pick<SandboxProgramApi, 'account'>;
  appSettingsId?: string;
  dataAccess?: Pick<SidecarDataAccess, 'appSettings'>;
  logger?: ComponentLogger;
  marketplaceId?: string;
}

export interface SandboxPolicySummary {
  categoryTypes: string[];
  id: string;
  marketplaceId: string | null;
  name: string | null;
  summary: string | null;
}

export interface SandboxLocationSummary {
  locationTypes: string[];
  merchantLocationKey: string;
  name: string | null;
  status: string | null;
}

export type SandboxConfigCheckStatus = 'pass' | 'fail';

export type SandboxConfigCheckKey =
  | 'app_settings.default'
  | 'marketplace'
  | 'paymentPolicyId'
  | 'fulfillmentPolicyId'
  | 'returnPolicyId'
  | 'merchantLocationKey';

export interface SandboxConfigCheck {
  configuredValue: string | null;
  expectedValue: string | null;
  key: SandboxConfigCheckKey;
  label: string;
  message: string;
  remediation: string[];
  status: SandboxConfigCheckStatus;
}

export interface SandboxConfigDiagnosticResult {
  appSettings: {
    current: SafeAppSettings | null;
    issues: string[];
    readError: string | null;
  };
  environment: string | undefined;
  marketplaceId: string;
  oauthValidation: {
    ok: true;
  };
  overallStatus: SandboxConfigCheckStatus;
  proposedValues: {
    default_fulfillment_policy_id: string | null;
    default_payment_policy_id: string | null;
    default_return_policy_id: string | null;
    ebay_marketplace_id: string;
    merchant_location_key: string | null;
  };
  checks: SandboxConfigCheck[];
  sellingPolicyManagementOptedIn: boolean | 'unknown';
  suggestedSql: string;
  summaries: {
    fulfillmentPolicies: SandboxPolicySummary[];
    inventoryLocations: SandboxLocationSummary[];
    paymentPolicies: SandboxPolicySummary[];
    returnPolicies: SandboxPolicySummary[];
  };
  warnings: string[];
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

function safeName(value: string | null | undefined): string | null {
  return normalizeText(value);
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

function isMarketplaceIdFormat(value: string | null | undefined): boolean {
  const normalized = normalizeText(value);
  return normalized ? /^EBAY_[A-Z_]+$/.test(normalized) : false;
}

function createCheck(input: {
  configuredValue?: string | null;
  expectedValue?: string | null;
  key: SandboxConfigCheckKey;
  label: string;
  message: string;
  remediation?: string[];
  status: SandboxConfigCheckStatus;
}): SandboxConfigCheck {
  return {
    configuredValue: input.configuredValue ?? null,
    expectedValue: input.expectedValue ?? null,
    key: input.key,
    label: input.label,
    message: input.message,
    remediation: input.remediation ?? [],
    status: input.status,
  };
}

function summarizeCategoryTypes(
  categoryTypes: Array<{ name?: string | null }> | null | undefined
): string[] {
  return (categoryTypes ?? [])
    .map((categoryType) => categoryType.name)
    .filter((value): value is string => hasText(value));
}

function summarizeShippingOptions(policy: FulfillmentPolicy): string | null {
  const optionCount = policy.shippingOptions?.length ?? 0;
  if (optionCount === 0) {
    return null;
  }

  const optionTypes = [
    ...new Set(
      (policy.shippingOptions ?? [])
        .map((option) => option.optionType)
        .filter((value): value is string => hasText(value))
    ),
  ];

  return optionTypes.length > 0
    ? `${optionCount} shipping option(s): ${optionTypes.join(', ')}`
    : `${optionCount} shipping option(s)`;
}

function summarizePaymentMethods(policy: PaymentPolicy): string | null {
  const paymentMethods = [
    ...new Set(
      (policy.paymentMethods ?? [])
        .map((method) => method.paymentMethodType)
        .filter((value): value is string => hasText(value))
    ),
  ];

  if (paymentMethods.length > 0) {
    return `payment methods: ${paymentMethods.join(', ')}`;
  }

  if (policy.immediatePay === true) {
    return 'immediatePay=true';
  }

  return null;
}

function summarizeReturnTerms(policy: ReturnPolicy): string | null {
  const parts: string[] = [];

  if (typeof policy.returnsAccepted === 'boolean') {
    parts.push(`returnsAccepted=${policy.returnsAccepted}`);
  }

  if (policy.returnPeriod?.value && hasText(policy.returnPeriod.unit)) {
    parts.push(`returnPeriod=${policy.returnPeriod.value} ${policy.returnPeriod.unit}`);
  }

  if (hasText(policy.returnShippingCostPayer)) {
    parts.push(`payer=${policy.returnShippingCostPayer}`);
  }

  return parts.length > 0 ? parts.join(', ') : null;
}

function summarizeFulfillmentPolicy(policy: FulfillmentPolicy): SandboxPolicySummary | null {
  if (!hasText(policy.fulfillmentPolicyId)) {
    return null;
  }

  return {
    categoryTypes: summarizeCategoryTypes(policy.categoryTypes),
    id: policy.fulfillmentPolicyId,
    marketplaceId: safeName(policy.marketplaceId),
    name: safeName(policy.name),
    summary: summarizeShippingOptions(policy),
  };
}

function summarizePaymentPolicy(policy: PaymentPolicy): SandboxPolicySummary | null {
  if (!hasText(policy.paymentPolicyId)) {
    return null;
  }

  return {
    categoryTypes: summarizeCategoryTypes(policy.categoryTypes),
    id: policy.paymentPolicyId,
    marketplaceId: safeName(policy.marketplaceId),
    name: safeName(policy.name),
    summary: summarizePaymentMethods(policy),
  };
}

function summarizeReturnPolicy(policy: ReturnPolicy): SandboxPolicySummary | null {
  if (!hasText(policy.returnPolicyId)) {
    return null;
  }

  return {
    categoryTypes: summarizeCategoryTypes(policy.categoryTypes),
    id: policy.returnPolicyId,
    marketplaceId: safeName(policy.marketplaceId),
    name: safeName(policy.name),
    summary: summarizeReturnTerms(policy),
  };
}

function summarizeLocation(location: InventoryLocationResponse): SandboxLocationSummary | null {
  if (!hasText(location.merchantLocationKey)) {
    return null;
  }

  return {
    locationTypes: (location.locationTypes ?? []).filter((value): value is string => hasText(value)),
    merchantLocationKey: location.merchantLocationKey,
    name: safeName(location.name),
    status: safeName(location.merchantLocationStatus),
  };
}

function findPreferredPolicyId(
  policies: SandboxPolicySummary[],
  storedId: string | null | undefined,
  bootstrapName: string
): string | null {
  if (hasText(storedId) && policies.some((policy) => policy.id === storedId.trim())) {
    return storedId.trim();
  }

  const namedPolicy = policies.find((policy) => policy.name === bootstrapName);
  if (namedPolicy) {
    return namedPolicy.id;
  }

  const defaultNamedPolicy = policies.find((policy) =>
    hasText(policy.name) ? /default/i.test(policy.name) : false
  );
  if (defaultNamedPolicy) {
    return defaultNamedPolicy.id;
  }

  return policies[0]?.id ?? null;
}

function findPreferredLocationKey(
  locations: SandboxLocationSummary[],
  storedKey: string | null | undefined
): string | null {
  if (hasText(storedKey) && locations.some((location) => location.merchantLocationKey === storedKey.trim())) {
    return storedKey.trim();
  }

  const defaultLocation = locations.find(
    (location) => location.merchantLocationKey === DEFAULT_LOCATION_KEY
  );
  if (defaultLocation) {
    return defaultLocation.merchantLocationKey;
  }

  const enabledLocation = locations.find((location) => location.status === 'ENABLED');
  if (enabledLocation) {
    return enabledLocation.merchantLocationKey;
  }

  return locations[0]?.merchantLocationKey ?? null;
}

function buildSuggestedSql(input: {
  appSettingsId: string;
  defaultFulfillmentPolicyId: string | null;
  defaultPaymentPolicyId: string | null;
  defaultReturnPolicyId: string | null;
  marketplaceId: string;
  merchantLocationKey: string | null;
}): string {
  const sqlString = (value: string): string => `'${value.replaceAll("'", "''")}'`;
  const sqlValueOrPlaceholder = (value: string | null, placeholder: string): string =>
    sqlString(value ?? placeholder);

  return [
    'update public.app_settings',
    'set',
    `  ebay_marketplace_id = ${sqlString(input.marketplaceId)},`,
    `  default_payment_policy_id = ${sqlValueOrPlaceholder(input.defaultPaymentPolicyId, '<paymentPolicyId>')},`,
    `  default_fulfillment_policy_id = ${sqlValueOrPlaceholder(input.defaultFulfillmentPolicyId, '<fulfillmentPolicyId>')},`,
    `  default_return_policy_id = ${sqlValueOrPlaceholder(input.defaultReturnPolicyId, '<returnPolicyId>')},`,
    `  merchant_location_key = ${sqlValueOrPlaceholder(input.merchantLocationKey, '<merchantLocationKey>')}`,
    `where id = ${sqlString(input.appSettingsId)};`,
  ].join('\n');
}

function toSafeAppSettings(row: AppSettingsRow): SafeAppSettings {
  return {
    default_fulfillment_policy_id: row.default_fulfillment_policy_id,
    default_payment_policy_id: row.default_payment_policy_id,
    default_return_policy_id: row.default_return_policy_id,
    ebay_marketplace_id: row.ebay_marketplace_id,
    id: row.id,
    merchant_location_key: row.merchant_location_key,
  };
}

async function loadCurrentAppSettings(
  dataAccess: Pick<SidecarDataAccess, 'appSettings'> | undefined,
  appSettingsId: string
): Promise<SandboxConfigDiagnosticResult['appSettings']> {
  if (!dataAccess) {
    return {
      current: null,
      issues: [],
      readError: 'DB access not configured for sandbox config diagnostic.',
    };
  }

  try {
    const current = await dataAccess.appSettings.get(appSettingsId);
    return {
      current: current ? toSafeAppSettings(current) : null,
      issues: current ? getPublishAppSettingIssues(current) : ['app_settings.default row not found.'],
      readError: null,
    };
  } catch (error) {
    return {
      current: null,
      issues: [],
      readError: `Failed to read app_settings.${appSettingsId}: ${normalizeError(error)}`,
    };
  }
}

function validateAppSettingsRowCheck(
  appSettingsState: SandboxConfigDiagnosticResult['appSettings']
): SandboxConfigCheck {
  if (appSettingsState.readError) {
    return createCheck({
      key: 'app_settings.default',
      label: 'app_settings.default',
      message: appSettingsState.readError,
      remediation: [
        'Verify Supabase connectivity and confirm app_settings.default row readable before publish.',
      ],
      status: 'fail',
    });
  }

  if (!appSettingsState.current) {
    return createCheck({
      key: 'app_settings.default',
      label: 'app_settings.default',
      message: 'Required app_settings.default row missing.',
      remediation: ['Seed app_settings.default, then rerun sandbox config diagnostic.'],
      status: 'fail',
    });
  }

  return createCheck({
    configuredValue: appSettingsState.current.id,
    expectedValue: appSettingsState.current.id,
    key: 'app_settings.default',
    label: 'app_settings.default',
    message: 'Required app_settings.default row present and readable.',
    status: 'pass',
  });
}

function validateMarketplaceCheck(input: {
  appSettingsState: SandboxConfigDiagnosticResult['appSettings'];
  resolvedMarketplaceId: string;
}): SandboxConfigCheck {
  const configuredValue = normalizeText(input.appSettingsState.current?.ebay_marketplace_id);

  if (!configuredValue) {
    return createCheck({
      expectedValue: input.resolvedMarketplaceId,
      key: 'marketplace',
      label: 'marketplace ID/site config',
      message: 'app_settings.default.ebay_marketplace_id missing.',
      remediation: [
        `Set app_settings.default.ebay_marketplace_id to ${input.resolvedMarketplaceId}.`,
      ],
      status: 'fail',
    });
  }

  if (!isMarketplaceIdFormat(configuredValue) || isObviousPlaceholder(configuredValue)) {
    return createCheck({
      configuredValue,
      expectedValue: input.resolvedMarketplaceId,
      key: 'marketplace',
      label: 'marketplace ID/site config',
      message: 'Configured marketplace ID invalid or placeholder.',
      remediation: [
        `Use real eBay marketplace ID like ${input.resolvedMarketplaceId} and keep sidecar/env config aligned.`,
      ],
      status: 'fail',
    });
  }

  if (configuredValue !== input.resolvedMarketplaceId) {
    return createCheck({
      configuredValue,
      expectedValue: input.resolvedMarketplaceId,
      key: 'marketplace',
      label: 'marketplace ID/site config',
      message: 'app_settings.default.ebay_marketplace_id does not match active sidecar marketplace config.',
      remediation: [
        `Align app_settings.default.ebay_marketplace_id with sidecar marketplace ${input.resolvedMarketplaceId}.`,
      ],
      status: 'fail',
    });
  }

  return createCheck({
    configuredValue,
    expectedValue: input.resolvedMarketplaceId,
    key: 'marketplace',
    label: 'marketplace ID/site config',
    message: 'Stored marketplace matches active sandbox sidecar config.',
    status: 'pass',
  });
}

function validatePolicyCheck(input: {
  configuredValue: string | null | undefined;
  expectedValue: string | null;
  fieldName:
    | 'default_payment_policy_id'
    | 'default_fulfillment_policy_id'
    | 'default_return_policy_id';
  key: Extract<
    SandboxConfigCheckKey,
    'paymentPolicyId' | 'fulfillmentPolicyId' | 'returnPolicyId'
  >;
  label: string;
  marketplaceId: string;
  policies: SandboxPolicySummary[];
}): SandboxConfigCheck {
  const configuredValue = normalizeText(input.configuredValue);
  const matchedPolicy = configuredValue
    ? input.policies.find((policy) => policy.id === configuredValue)
    : undefined;

  if (!configuredValue) {
    return createCheck({
      expectedValue: input.expectedValue,
      key: input.key,
      label: input.label,
      message: `${input.fieldName} missing from app_settings.default.`,
      remediation: input.expectedValue
        ? [`Set ${input.fieldName} to ${input.expectedValue}.`]
        : [
            `Create/select a real sandbox ${input.label.toLowerCase()} for marketplace ${input.marketplaceId}, then persist ${input.fieldName}.`,
          ],
      status: 'fail',
    });
  }

  if (isObviousPlaceholder(configuredValue)) {
    return createCheck({
      configuredValue,
      expectedValue: input.expectedValue,
      key: input.key,
      label: input.label,
      message: `${input.fieldName} contains obvious placeholder value.`,
      remediation: input.expectedValue
        ? [`Replace placeholder with real sandbox policy ID ${input.expectedValue}.`]
        : [
            `Replace placeholder with real sandbox ${input.label.toLowerCase()} ID after policy exists for ${input.marketplaceId}.`,
          ],
      status: 'fail',
    });
  }

  if (!matchedPolicy) {
    return createCheck({
      configuredValue,
      expectedValue: input.expectedValue,
      key: input.key,
      label: input.label,
      message: `Configured ID not found in sandbox ${input.label.toLowerCase()} list.`,
      remediation: input.expectedValue
        ? [`Update ${input.fieldName} to discovered sandbox policy ID ${input.expectedValue}.`]
        : [
            `No matching sandbox ${input.label.toLowerCase()} found. Create/select one, then persist ${input.fieldName}.`,
          ],
      status: 'fail',
    });
  }

  if (hasText(matchedPolicy.marketplaceId) && matchedPolicy.marketplaceId !== input.marketplaceId) {
    return createCheck({
      configuredValue,
      expectedValue: input.expectedValue,
      key: input.key,
      label: input.label,
      message: `Configured policy belongs to marketplace ${matchedPolicy.marketplaceId}, not ${input.marketplaceId}.`,
      remediation: input.expectedValue
        ? [`Use sandbox policy ${input.expectedValue} for marketplace ${input.marketplaceId}.`]
        : [`Select policy scoped to marketplace ${input.marketplaceId}.`],
      status: 'fail',
    });
  }

  return createCheck({
    configuredValue,
    expectedValue: configuredValue,
    key: input.key,
    label: input.label,
    message: `Configured sandbox ${input.label.toLowerCase()} exists for marketplace ${input.marketplaceId}.`,
    status: 'pass',
  });
}

function validateLocationCheck(input: {
  configuredValue: string | null | undefined;
  expectedValue: string | null;
  locations: SandboxLocationSummary[];
}): SandboxConfigCheck {
  const configuredValue = normalizeText(input.configuredValue);
  const matchedLocation = configuredValue
    ? input.locations.find((location) => location.merchantLocationKey === configuredValue)
    : undefined;

  if (!configuredValue) {
    return createCheck({
      expectedValue: input.expectedValue,
      key: 'merchantLocationKey',
      label: 'merchant location key',
      message: 'merchant_location_key missing from app_settings.default.',
      remediation: input.expectedValue
        ? [`Set merchant_location_key to ${input.expectedValue}.`]
        : ['Create/select an enabled sandbox inventory location, then persist merchant_location_key.'],
      status: 'fail',
    });
  }

  if (isObviousPlaceholder(configuredValue)) {
    return createCheck({
      configuredValue,
      expectedValue: input.expectedValue,
      key: 'merchantLocationKey',
      label: 'merchant location key',
      message: 'merchant_location_key contains obvious placeholder value.',
      remediation: input.expectedValue
        ? [`Replace placeholder with real merchant location key ${input.expectedValue}.`]
        : ['Replace placeholder with enabled sandbox inventory location key.'],
      status: 'fail',
    });
  }

  if (!matchedLocation) {
    return createCheck({
      configuredValue,
      expectedValue: input.expectedValue,
      key: 'merchantLocationKey',
      label: 'merchant location key',
      message: 'Configured merchant_location_key not found in sandbox inventory locations.',
      remediation: input.expectedValue
        ? [`Update merchant_location_key to ${input.expectedValue}.`]
        : ['Create/select an enabled sandbox inventory location, then update merchant_location_key.'],
      status: 'fail',
    });
  }

  if (hasText(matchedLocation.status) && matchedLocation.status !== 'ENABLED') {
    return createCheck({
      configuredValue,
      expectedValue: input.expectedValue,
      key: 'merchantLocationKey',
      label: 'merchant location key',
      message: `Configured merchant location status ${matchedLocation.status}; expected ENABLED.`,
      remediation: ['Enable stored inventory location or point merchant_location_key at an ENABLED location.'],
      status: 'fail',
    });
  }

  return createCheck({
    configuredValue,
    expectedValue: configuredValue,
    key: 'merchantLocationKey',
    label: 'merchant location key',
    message: 'Configured merchant location exists in sandbox inventory locations.',
    status: 'pass',
  });
}

function buildChecks(input: {
  appSettingsState: SandboxConfigDiagnosticResult['appSettings'];
  fulfillmentPolicies: SandboxPolicySummary[];
  locations: SandboxLocationSummary[];
  marketplaceId: string;
  paymentPolicies: SandboxPolicySummary[];
  proposedValues: SandboxConfigDiagnosticResult['proposedValues'];
  returnPolicies: SandboxPolicySummary[];
}): SandboxConfigCheck[] {
  return [
    validateAppSettingsRowCheck(input.appSettingsState),
    validateMarketplaceCheck({
      appSettingsState: input.appSettingsState,
      resolvedMarketplaceId: input.marketplaceId,
    }),
    validatePolicyCheck({
      configuredValue: input.appSettingsState.current?.default_payment_policy_id,
      expectedValue: input.proposedValues.default_payment_policy_id,
      fieldName: 'default_payment_policy_id',
      key: 'paymentPolicyId',
      label: 'payment policy ID',
      marketplaceId: input.marketplaceId,
      policies: input.paymentPolicies,
    }),
    validatePolicyCheck({
      configuredValue: input.appSettingsState.current?.default_fulfillment_policy_id,
      expectedValue: input.proposedValues.default_fulfillment_policy_id,
      fieldName: 'default_fulfillment_policy_id',
      key: 'fulfillmentPolicyId',
      label: 'fulfillment policy ID',
      marketplaceId: input.marketplaceId,
      policies: input.fulfillmentPolicies,
    }),
    validatePolicyCheck({
      configuredValue: input.appSettingsState.current?.default_return_policy_id,
      expectedValue: input.proposedValues.default_return_policy_id,
      fieldName: 'default_return_policy_id',
      key: 'returnPolicyId',
      label: 'return policy ID',
      marketplaceId: input.marketplaceId,
      policies: input.returnPolicies,
    }),
    validateLocationCheck({
      configuredValue: input.appSettingsState.current?.merchant_location_key,
      expectedValue: input.proposedValues.merchant_location_key,
      locations: input.locations,
    }),
  ];
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

async function listInventoryLocations(
  api: SandboxBootstrapApi
): Promise<InventoryLocationResponse[]> {
  const response = (await api.inventory.getInventoryLocations()) as LocationResponse;
  return response.locations ?? [];
}

async function getStoredInventoryLocation(
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

export async function getSandboxConfigDiagnostic({
  api,
  appSettingsId = DEFAULT_APP_SETTINGS_ID,
  dataAccess,
  logger = setupLogger,
  marketplaceId,
}: SandboxConfigDiagnosticOptions): Promise<SandboxConfigDiagnosticResult> {
  await validateSandboxOAuthAccess(api, logger);

  const [appSettingsState, sellingPolicyDiagnostic] = await Promise.all([
    loadCurrentAppSettings(dataAccess, appSettingsId),
    getSandboxSellingPolicyManagementDiagnostic(api, logger),
  ]);

  const resolvedMarketplaceId =
    marketplaceId ??
    api.getAuthClient().getConfig().marketplaceId ??
    appSettingsState.current?.ebay_marketplace_id ??
    'EBAY_US';

  const warnings = [...sellingPolicyDiagnostic.warnings];
  if (appSettingsState.readError) {
    warnings.push(appSettingsState.readError);
  }

  const [fulfillmentResponse, paymentResponse, returnResponse] = await Promise.all([
    api.account.getFulfillmentPolicies(resolvedMarketplaceId),
    api.account.getPaymentPolicies(resolvedMarketplaceId),
    api.account.getReturnPolicies(resolvedMarketplaceId),
  ]);

  let inventoryLocations: InventoryLocationResponse[] = [];
  try {
    inventoryLocations = await listInventoryLocations(api);
  } catch (error) {
    warnings.push(`Failed to list inventory locations. Root cause: ${normalizeError(error)}`);

    if (hasText(appSettingsState.current?.merchant_location_key)) {
      try {
        const storedLocation = await getStoredInventoryLocation(
          api,
          appSettingsState.current.merchant_location_key
        );
        if (storedLocation) {
          inventoryLocations = [storedLocation];
          warnings.push(
            `Inventory location list failed; direct lookup succeeded for ${appSettingsState.current.merchant_location_key}.`
          );
        }
      } catch (storedLocationError) {
        warnings.push(
          `Failed direct inventory location lookup for ${appSettingsState.current.merchant_location_key}. Root cause: ${normalizeError(storedLocationError)}`
        );
      }
    }
  }

  const fulfillmentPolicies = (fulfillmentResponse.fulfillmentPolicies ?? [])
    .map(summarizeFulfillmentPolicy)
    .filter((policy): policy is SandboxPolicySummary => policy !== null);
  const paymentPolicies = (paymentResponse.paymentPolicies ?? [])
    .map(summarizePaymentPolicy)
    .filter((policy): policy is SandboxPolicySummary => policy !== null);
  const returnPolicies = (returnResponse.returnPolicies ?? [])
    .map(summarizeReturnPolicy)
    .filter((policy): policy is SandboxPolicySummary => policy !== null);
  const locations = inventoryLocations
    .map(summarizeLocation)
    .filter((location): location is SandboxLocationSummary => location !== null);

  const proposedValues = {
    default_fulfillment_policy_id: findPreferredPolicyId(
      fulfillmentPolicies,
      appSettingsState.current?.default_fulfillment_policy_id,
      POLICY_NAMES.fulfillment
    ),
    default_payment_policy_id: findPreferredPolicyId(
      paymentPolicies,
      appSettingsState.current?.default_payment_policy_id,
      POLICY_NAMES.payment
    ),
    default_return_policy_id: findPreferredPolicyId(
      returnPolicies,
      appSettingsState.current?.default_return_policy_id,
      POLICY_NAMES.return
    ),
    ebay_marketplace_id: resolvedMarketplaceId,
    merchant_location_key: findPreferredLocationKey(
      locations,
      appSettingsState.current?.merchant_location_key
    ),
  };
  const checks = buildChecks({
    appSettingsState,
    fulfillmentPolicies,
    locations,
    marketplaceId: resolvedMarketplaceId,
    paymentPolicies,
    proposedValues,
    returnPolicies,
  });

  if (paymentPolicies.length === 0) {
    warnings.push(`No payment policies found for marketplace ${resolvedMarketplaceId}.`);
  }
  if (fulfillmentPolicies.length === 0) {
    warnings.push(`No fulfillment policies found for marketplace ${resolvedMarketplaceId}.`);
  }
  if (returnPolicies.length === 0) {
    warnings.push(`No return policies found for marketplace ${resolvedMarketplaceId}.`);
  }
  if (locations.length === 0) {
    warnings.push('No inventory locations found.');
  }

  return {
    appSettings: appSettingsState,
    checks,
    environment: api.getAuthClient().getConfig().environment,
    marketplaceId: resolvedMarketplaceId,
    oauthValidation: {
      ok: true,
    },
    overallStatus: checks.every((check) => check.status === 'pass') ? 'pass' : 'fail',
    proposedValues,
    sellingPolicyManagementOptedIn:
      sellingPolicyDiagnostic.selling_policy_management_opted_in,
    suggestedSql: buildSuggestedSql({
      appSettingsId,
      defaultFulfillmentPolicyId: proposedValues.default_fulfillment_policy_id,
      defaultPaymentPolicyId: proposedValues.default_payment_policy_id,
      defaultReturnPolicyId: proposedValues.default_return_policy_id,
      marketplaceId: proposedValues.ebay_marketplace_id,
      merchantLocationKey: proposedValues.merchant_location_key,
    }),
    summaries: {
      fulfillmentPolicies,
      inventoryLocations: locations,
      paymentPolicies,
      returnPolicies,
    },
    warnings: dedupe(warnings),
  };
}

export function formatSandboxConfigDiagnostic(result: SandboxConfigDiagnosticResult): string {
  const lines: string[] = [
    'eBay sandbox config diagnostic',
    `overall: ${result.overallStatus.toUpperCase()}`,
    `environment: ${result.environment ?? 'unknown'}`,
    `marketplace: ${result.marketplaceId}`,
    '',
  ];

  for (const check of result.checks) {
    lines.push(`[${check.status === 'pass' ? 'PASS' : 'FAIL'}] ${check.label}`);
    lines.push(`  current: ${check.configuredValue ?? '[missing]'}`);

    if (check.expectedValue && check.expectedValue !== check.configuredValue) {
      lines.push(`  expected: ${check.expectedValue}`);
    }

    lines.push(`  note: ${check.message}`);

    for (const remediation of check.remediation) {
      lines.push(`  fix: ${remediation}`);
    }

    lines.push('');
  }

  if (result.warnings.length > 0) {
    lines.push('warnings:');
    for (const warning of result.warnings) {
      lines.push(`- ${warning}`);
    }
    lines.push('');
  }

  if (result.overallStatus === 'fail') {
    lines.push('suggested sql:');
    lines.push(result.suggestedSql);
  }

  return lines.join('\n').trimEnd();
}
