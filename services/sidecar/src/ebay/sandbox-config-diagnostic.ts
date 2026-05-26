import { DEFAULT_APP_SETTINGS_ID, type AppSettingsRow } from '@ebay-inventory/data';
import type { SidecarDataAccess } from '@/data/sidecar-data.js';
import { getPublishAppSettingIssues } from '@/ebay/publish-validation.js';
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
  proposedValues: {
    default_fulfillment_policy_id: string | null;
    default_payment_policy_id: string | null;
    default_return_policy_id: string | null;
    ebay_marketplace_id: string;
    merchant_location_key: string | null;
  };
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

function safeName(value: string | null | undefined): string | null {
  return hasText(value) ? value.trim() : null;
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
  const quote = (value: string | null, placeholder: string) =>
    value ? `'${value}'` : `'${placeholder}'`;

  return [
    'update public.app_settings',
    'set',
    `  ebay_marketplace_id = '${input.marketplaceId}',`,
    `  default_payment_policy_id = ${quote(input.defaultPaymentPolicyId, '<paymentPolicyId>')},`,
    `  default_fulfillment_policy_id = ${quote(input.defaultFulfillmentPolicyId, '<fulfillmentPolicyId>')},`,
    `  default_return_policy_id = ${quote(input.defaultReturnPolicyId, '<returnPolicyId>')},`,
    `  merchant_location_key = ${quote(input.merchantLocationKey, '<merchantLocationKey>')}`,
    `where id = '${input.appSettingsId}';`,
  ].join('\n');
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
      current,
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
    appSettingsState.current?.ebay_marketplace_id ??
    api.getAuthClient().getConfig().marketplaceId ??
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
    environment: api.getAuthClient().getConfig().environment,
    marketplaceId: resolvedMarketplaceId,
    oauthValidation: {
      ok: true,
    },
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
    warnings,
  };
}
