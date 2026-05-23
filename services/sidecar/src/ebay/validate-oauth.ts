import type { EbayOAuthValidationConfig } from '@/ebay/config.js';
import {
  exchangeRefreshTokenForAccessToken,
  type ExchangeRefreshTokenOptions,
} from '@/ebay/oauth-client.js';

export interface EbayOAuthValidationResult {
  ok: true;
  environment: EbayOAuthValidationConfig['environment'];
  marketplaceId: string;
  tokenType: string;
  expiresIn: number;
}

export async function validateEbayOAuth(
  config: EbayOAuthValidationConfig,
  options: ExchangeRefreshTokenOptions = {}
): Promise<EbayOAuthValidationResult> {
  const token = await exchangeRefreshTokenForAccessToken(config, options);

  return {
    ok: true,
    environment: config.environment,
    marketplaceId: config.marketplaceId,
    tokenType: token.tokenType,
    expiresIn: token.expiresIn,
  };
}
