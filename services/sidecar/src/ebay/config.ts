import { EnvValidationError, loadEnv } from '@ebay-inventory/env';
import { z } from 'zod';

export type EbayEnvironment = 'sandbox' | 'production';

export interface EbayOAuthValidationConfig {
  environment: EbayEnvironment;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  redirectUri?: string;
  apiBaseUrl: string;
  oauthBaseUrl: string;
  marketplaceId: string;
  publishEnabled: boolean;
}

const requiredNonEmptyString = (name: string) =>
  z
    .string({
      required_error: `${name} is required`,
      invalid_type_error: `${name} is required`,
    })
    .trim()
    .min(1, `${name} is required`);

function normalizeOptionalEnvValue(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  return value.trim() === '' ? undefined : value;
}

const optionalNonEmptyString = () =>
  z.preprocess(normalizeOptionalEnvValue, z.string().trim().min(1).optional());
const optionalUrlString = (name: string) =>
  z.preprocess(
    normalizeOptionalEnvValue,
    z.string().trim().url(`${name} must be a valid URL`).optional()
  );

function looksLikeAuthorizationCodeValue(value: string): boolean {
  const trimmed = value.trim();

  if (trimmed.startsWith('v%5E')) {
    return true;
  }

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      return new URL(trimmed).searchParams.has('code');
    } catch {
      return trimmed.includes('code=');
    }
  }

  if (trimmed.includes('code=')) {
    try {
      const query = trimmed.startsWith('?') ? trimmed.slice(1) : trimmed;
      return new URLSearchParams(query).has('code');
    } catch {
      return true;
    }
  }

  return false;
}

const rawEbayOAuthValidationEnvSchema = z
  .object({
    EBAY_ENVIRONMENT: z.enum(['sandbox', 'production']).default('sandbox'),
    EBAY_CLIENT_ID: requiredNonEmptyString('EBAY_CLIENT_ID'),
    EBAY_CLIENT_SECRET: requiredNonEmptyString('EBAY_CLIENT_SECRET'),
    EBAY_REFRESH_TOKEN: optionalNonEmptyString(),
    EBAY_USER_REFRESH_TOKEN: optionalNonEmptyString(),
    EBAY_REDIRECT_URI: optionalNonEmptyString(),
    EBAY_API_BASE_URL: optionalUrlString('EBAY_API_BASE_URL'),
    EBAY_OAUTH_BASE_URL: optionalUrlString('EBAY_OAUTH_BASE_URL'),
    EBAY_MARKETPLACE_ID: optionalNonEmptyString().default('EBAY_US'),
    EBAY_PUBLISH_ENABLED: z.enum(['true', 'false']).default('false'),
  })
  .superRefine((env, ctx) => {
    const refreshToken = env.EBAY_REFRESH_TOKEN ?? env.EBAY_USER_REFRESH_TOKEN;
    const refreshTokenKey = env.EBAY_REFRESH_TOKEN ? 'EBAY_REFRESH_TOKEN' : 'EBAY_USER_REFRESH_TOKEN';

    if (!refreshToken) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'EBAY_REFRESH_TOKEN or EBAY_USER_REFRESH_TOKEN is required',
        path: ['EBAY_REFRESH_TOKEN'],
      });
      return;
    }

    if (looksLikeAuthorizationCodeValue(refreshToken)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          `${refreshTokenKey} appears to contain an authorization code or callback URL. ` +
          'Store the long refresh token instead. API Explorer Bearer tokens and callback code= values are not refresh tokens.',
        path: [refreshTokenKey],
      });
    }
  });

function getDefaultApiBaseUrl(environment: EbayEnvironment): string {
  return environment === 'production' ? 'https://api.ebay.com' : 'https://api.sandbox.ebay.com';
}

function getDefaultOAuthBaseUrl(environment: EbayEnvironment): string {
  return environment === 'production'
    ? 'https://api.ebay.com/identity/v1/oauth2/token'
    : 'https://api.sandbox.ebay.com/identity/v1/oauth2/token';
}

export function loadEbayOAuthValidationConfig(
  env: NodeJS.ProcessEnv = process.env
): EbayOAuthValidationConfig {
  const parsed = loadEnv({
    serviceName: 'ebay',
    schema: rawEbayOAuthValidationEnvSchema,
    env,
  });

  return {
    environment: parsed.EBAY_ENVIRONMENT,
    clientId: parsed.EBAY_CLIENT_ID,
    clientSecret: parsed.EBAY_CLIENT_SECRET,
    refreshToken: parsed.EBAY_REFRESH_TOKEN ?? parsed.EBAY_USER_REFRESH_TOKEN!,
    redirectUri: parsed.EBAY_REDIRECT_URI,
    apiBaseUrl: parsed.EBAY_API_BASE_URL ?? getDefaultApiBaseUrl(parsed.EBAY_ENVIRONMENT),
    oauthBaseUrl: parsed.EBAY_OAUTH_BASE_URL ?? getDefaultOAuthBaseUrl(parsed.EBAY_ENVIRONMENT),
    marketplaceId: parsed.EBAY_MARKETPLACE_ID,
    publishEnabled: parsed.EBAY_PUBLISH_ENABLED === 'true',
  };
}

export { EnvValidationError };
