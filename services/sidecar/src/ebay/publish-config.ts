import type { AppSettingsRow, Json } from '@ebay-inventory/data';
import type { EbayEnvironment } from '@/ebay/config.js';

export type PublishConfigIssueCode =
  | 'fulfillment_policy_id_missing_for_environment'
  | 'marketplace_id_missing_for_environment'
  | 'merchant_location_key_missing_for_environment'
  | 'payment_policy_id_missing_for_environment'
  | 'publish_config_marketplace_mismatch'
  | 'publish_config_missing_for_environment'
  | 'return_policy_id_missing_for_environment';

export interface ResolvedPublishConfig {
  environment: EbayEnvironment;
  fulfillmentPolicyId: string;
  marketplaceId: string;
  merchantLocationKey: string;
  paymentPolicyId: string;
  returnPolicyId: string;
  source: 'environment_config' | 'legacy_flat';
}

export interface PublishConfigResolutionOptions {
  environment: EbayEnvironment;
  runtimeMarketplaceId?: string | null;
}

interface PublishConfigFields {
  fulfillmentPolicyId: string | null;
  marketplaceId: string | null;
  merchantLocationKey: string | null;
  paymentPolicyId: string | null;
  returnPolicyId: string | null;
}

export interface PublishConfigResolutionResult {
  config: ResolvedPublishConfig | null;
  issues: string[];
}

export type PublishConfigCandidate = Partial<ResolvedPublishConfig> | null;

function hasText(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeText(value: string | null | undefined): string | null {
  return hasText(value) ? value.trim() : null;
}

function isRecord(value: Json | Record<string, unknown> | null | undefined): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getStringField(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function buildIssue(code: PublishConfigIssueCode, message: string): string {
  return `${code}: ${message}`;
}

function getPublishConfigRoot(appSettings: AppSettingsRow): Record<string, unknown> | null {
  return isRecord(appSettings.ebay_publish_config) ? appSettings.ebay_publish_config : null;
}

function getEnvironmentConfigFields(
  appSettings: AppSettingsRow,
  environment: EbayEnvironment
): PublishConfigFields | null {
  const root = getPublishConfigRoot(appSettings);

  if (!root) {
    return null;
  }

  const environmentConfig = root[environment] as Json | Record<string, unknown> | undefined;
  if (!isRecord(environmentConfig)) {
    return null;
  }

  return {
    fulfillmentPolicyId: getStringField(
      environmentConfig,
      'fulfillmentPolicyId',
      'fulfillment_policy_id'
    ),
    marketplaceId: getStringField(environmentConfig, 'marketplaceId', 'marketplace_id'),
    merchantLocationKey: getStringField(
      environmentConfig,
      'merchantLocationKey',
      'merchant_location_key'
    ),
    paymentPolicyId: getStringField(environmentConfig, 'paymentPolicyId', 'payment_policy_id'),
    returnPolicyId: getStringField(environmentConfig, 'returnPolicyId', 'return_policy_id'),
  };
}

function getLegacyFlatFields(appSettings: AppSettingsRow): PublishConfigFields {
  return {
    fulfillmentPolicyId: normalizeText(appSettings.default_fulfillment_policy_id),
    marketplaceId: normalizeText(appSettings.ebay_marketplace_id),
    merchantLocationKey: normalizeText(appSettings.merchant_location_key),
    paymentPolicyId: normalizeText(appSettings.default_payment_policy_id),
    returnPolicyId: normalizeText(appSettings.default_return_policy_id),
  };
}

function isMockPlaceholder(value: string | null | undefined): boolean {
  const normalized = normalizeText(value);
  return normalized ? /^mock-/i.test(normalized) : false;
}

function hasLegacyFlatPublishConfig(appSettings: AppSettingsRow): boolean {
  return [
    appSettings.default_payment_policy_id,
    appSettings.default_fulfillment_policy_id,
    appSettings.default_return_policy_id,
    appSettings.merchant_location_key,
    appSettings.ebay_marketplace_id,
  ].some((value) => hasText(value));
}

function isPlaceholderMerchantLocationKey(fields: PublishConfigFields): boolean {
  const normalized = normalizeText(fields.merchantLocationKey);
  if (!normalized) {
    return false;
  }

  if (isMockPlaceholder(normalized)) {
    return true;
  }

  return (
    normalized === 'default-main-location' &&
    [
      fields.paymentPolicyId,
      fields.fulfillmentPolicyId,
      fields.returnPolicyId,
    ].some((value) => !hasText(value) || isMockPlaceholder(value))
  );
}

function getMissingFieldIssues(
  environment: EbayEnvironment,
  fields: PublishConfigFields,
  pathPrefix: string
): string[] {
  const issues: string[] = [];

  if (!hasText(fields.marketplaceId)) {
    issues.push(
      buildIssue(
        'marketplace_id_missing_for_environment',
        `${pathPrefix}.marketplaceId is required for ${environment} publish config.`
      )
    );
  }

  if (!hasText(fields.paymentPolicyId)) {
    issues.push(
      buildIssue(
        'payment_policy_id_missing_for_environment',
        `${pathPrefix}.paymentPolicyId is required for ${environment} publish config.`
      )
    );
  } else if (isMockPlaceholder(fields.paymentPolicyId)) {
    issues.push(
      buildIssue(
        'payment_policy_id_missing_for_environment',
        `${pathPrefix}.paymentPolicyId "${fields.paymentPolicyId}" is a placeholder.`
      )
    );
  }

  if (!hasText(fields.fulfillmentPolicyId)) {
    issues.push(
      buildIssue(
        'fulfillment_policy_id_missing_for_environment',
        `${pathPrefix}.fulfillmentPolicyId is required for ${environment} publish config.`
      )
    );
  } else if (isMockPlaceholder(fields.fulfillmentPolicyId)) {
    issues.push(
      buildIssue(
        'fulfillment_policy_id_missing_for_environment',
        `${pathPrefix}.fulfillmentPolicyId "${fields.fulfillmentPolicyId}" is a placeholder.`
      )
    );
  }

  if (!hasText(fields.returnPolicyId)) {
    issues.push(
      buildIssue(
        'return_policy_id_missing_for_environment',
        `${pathPrefix}.returnPolicyId is required for ${environment} publish config.`
      )
    );
  } else if (isMockPlaceholder(fields.returnPolicyId)) {
    issues.push(
      buildIssue(
        'return_policy_id_missing_for_environment',
        `${pathPrefix}.returnPolicyId "${fields.returnPolicyId}" is a placeholder.`
      )
    );
  }

  if (!hasText(fields.merchantLocationKey)) {
    issues.push(
      buildIssue(
        'merchant_location_key_missing_for_environment',
        `${pathPrefix}.merchantLocationKey is required for ${environment} publish config.`
      )
    );
  } else if (isPlaceholderMerchantLocationKey(fields)) {
    issues.push(
      buildIssue(
        'merchant_location_key_missing_for_environment',
        `${pathPrefix}.merchantLocationKey "${fields.merchantLocationKey}" looks like a placeholder.`
      )
    );
  }

  return issues;
}

export function resolvePublishConfig(
  appSettings: AppSettingsRow,
  options: PublishConfigResolutionOptions
): PublishConfigResolutionResult {
  const environmentFields = getEnvironmentConfigFields(appSettings, options.environment);
  const runtimeMarketplaceId = normalizeText(options.runtimeMarketplaceId);
  const issues: string[] = [];
  let fields: PublishConfigFields | null = null;
  let source: ResolvedPublishConfig['source'] | null = null;
  let pathPrefix = `app_settings.ebay_publish_config.${options.environment}`;

  if (environmentFields) {
    fields = environmentFields;
    source = 'environment_config';
  } else if (options.environment === 'sandbox' && !getPublishConfigRoot(appSettings) && hasLegacyFlatPublishConfig(appSettings)) {
    fields = getLegacyFlatFields(appSettings);
    source = 'legacy_flat';
    pathPrefix = 'app_settings (legacy flat sandbox publish fields)';
  } else {
    issues.push(
      buildIssue(
        'publish_config_missing_for_environment',
        `${pathPrefix} is required when EBAY_ENVIRONMENT=${options.environment}.`
      )
    );
    return {
      config: null,
      issues,
    };
  }

  issues.push(...getMissingFieldIssues(options.environment, fields, pathPrefix));

  if (runtimeMarketplaceId && hasText(fields.marketplaceId) && fields.marketplaceId !== runtimeMarketplaceId) {
    issues.push(
      buildIssue(
        'publish_config_marketplace_mismatch',
        `Resolved publish marketplace "${fields.marketplaceId}" does not match runtime marketplace "${runtimeMarketplaceId}".`
      )
    );
  }

  if (issues.length > 0) {
    return {
      config: null,
      issues,
    };
  }

  return {
    config: {
      environment: options.environment,
      fulfillmentPolicyId: fields.fulfillmentPolicyId!,
      marketplaceId: fields.marketplaceId!,
      merchantLocationKey: fields.merchantLocationKey!,
      paymentPolicyId: fields.paymentPolicyId!,
      returnPolicyId: fields.returnPolicyId!,
      source,
    },
    issues: [],
  };
}

export function getPublishConfigCandidate(
  appSettings: AppSettingsRow,
  options: PublishConfigResolutionOptions
): PublishConfigCandidate {
  const environmentFields = getEnvironmentConfigFields(appSettings, options.environment);

  if (environmentFields) {
    return {
      environment: options.environment,
      fulfillmentPolicyId: environmentFields.fulfillmentPolicyId ?? undefined,
      marketplaceId: environmentFields.marketplaceId ?? undefined,
      merchantLocationKey: environmentFields.merchantLocationKey ?? undefined,
      paymentPolicyId: environmentFields.paymentPolicyId ?? undefined,
      returnPolicyId: environmentFields.returnPolicyId ?? undefined,
      source: 'environment_config',
    };
  }

  if (options.environment === 'sandbox' && !getPublishConfigRoot(appSettings) && hasLegacyFlatPublishConfig(appSettings)) {
    const legacyFields = getLegacyFlatFields(appSettings);

    return {
      environment: options.environment,
      fulfillmentPolicyId: legacyFields.fulfillmentPolicyId ?? undefined,
      marketplaceId: legacyFields.marketplaceId ?? undefined,
      merchantLocationKey: legacyFields.merchantLocationKey ?? undefined,
      paymentPolicyId: legacyFields.paymentPolicyId ?? undefined,
      returnPolicyId: legacyFields.returnPolicyId ?? undefined,
      source: 'legacy_flat',
    };
  }

  return null;
}

export function getPublishAppSettingIssues(
  appSettings: AppSettingsRow,
  options: Partial<PublishConfigResolutionOptions> = {}
): string[] {
  const environment = options.environment ?? 'sandbox';
  const runtimeMarketplaceId =
    options.runtimeMarketplaceId ?? normalizeText(appSettings.ebay_marketplace_id) ?? null;

  return resolvePublishConfig(appSettings, {
    environment,
    runtimeMarketplaceId,
  }).issues;
}
