import {
  type EnvSource,
  EnvValidationError,
  loadApifyPricingEnv,
  loadSoldCompsPricingEnv,
} from '@ebay-inventory/env';

import {
  createApifyPricingProvider,
  type ApifyPricingProviderDependencies,
} from './apify-provider.js';
import {
  createSoldCompsPricingProvider,
  type SoldCompsPricingProviderDependencies,
} from './soldcomps-provider.js';
import type { PricingProvider } from './types.js';

export type LivePricingProviderMode = 'apify' | 'soldcomps';

export interface ResolveProductionPricingProviderInput {
  apifyProviderDependencies?: ApifyPricingProviderDependencies;
  createApifyProvider?: typeof createApifyPricingProvider;
  createSoldCompsProvider?: typeof createSoldCompsPricingProvider;
  env?: EnvSource;
  mode: LivePricingProviderMode;
  soldCompsProviderDependencies?: SoldCompsPricingProviderDependencies;
}

export class PricingProviderResolverError extends Error {
  readonly category = 'auth_config';
  readonly code: string;
  readonly provider: LivePricingProviderMode;
  readonly workflowSafe = true;

  constructor(provider: LivePricingProviderMode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PricingProviderResolverError';
    this.code = `${provider}_config_invalid`;
    this.provider = provider;
  }
}

export function resolveProductionPricingProvider(
  input: ResolveProductionPricingProviderInput
): PricingProvider {
  const env = input.env ?? process.env;

  switch (input.mode) {
    case 'soldcomps':
      return resolveSoldCompsPricingProvider(env, input);
    case 'apify':
      return resolveApifyPricingProvider(env, input);
  }
}

function resolveSoldCompsPricingProvider(
  env: EnvSource,
  input: ResolveProductionPricingProviderInput
): PricingProvider {
  try {
    const resolvedEnv = loadSoldCompsPricingEnv({
      env,
    });

    return (input.createSoldCompsProvider ?? createSoldCompsPricingProvider)(
      {
        apiKey: resolvedEnv.SOLDCOMPS_API_KEY,
        timeoutSeconds: Number(resolvedEnv.SOLDCOMPS_PRICE_TIMEOUT_SECONDS),
      },
      input.soldCompsProviderDependencies
    );
  } catch (error) {
    throw toPricingProviderResolverError('soldcomps', error);
  }
}

function resolveApifyPricingProvider(
  env: EnvSource,
  input: ResolveProductionPricingProviderInput
): PricingProvider {
  try {
    const resolvedEnv = loadApifyPricingEnv({
      env,
    });

    return (input.createApifyProvider ?? createApifyPricingProvider)(
      {
        actorId: resolvedEnv.APIFY_PRICE_ACTOR_ID,
        timeoutSeconds: Number(resolvedEnv.APIFY_PRICE_TIMEOUT_SECONDS),
        token: resolvedEnv.APIFY_TOKEN,
      },
      input.apifyProviderDependencies
    );
  } catch (error) {
    throw toPricingProviderResolverError('apify', error);
  }
}

function toPricingProviderResolverError(
  provider: LivePricingProviderMode,
  error: unknown
): PricingProviderResolverError {
  if (error instanceof PricingProviderResolverError) {
    return error;
  }

  if (error instanceof EnvValidationError) {
    return new PricingProviderResolverError(provider, error.message, { cause: error });
  }

  return new PricingProviderResolverError(
    provider,
    error instanceof Error ? error.message : String(error),
    error instanceof Error ? { cause: error } : undefined
  );
}
