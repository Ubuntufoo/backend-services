import type { EbayApiClient } from '../client.js';
import { getIdentityBaseUrl } from '../../config/environment.js';
import type { AxiosRequestConfig } from 'axios';

/**
 * Identity API - User identity verification
 * Based on: docs/sell-apps/other-apis/commerce_identity_v1_oas3.json
 *
 * Note: Identity API uses apiz subdomain instead of api
 */
export class IdentityApi {
  private readonly basePath = '/commerce/identity/v1';

  constructor(private client: EbayApiClient) {}

  /**
   * Get user information
   * Uses apiz.ebay.com instead of api.ebay.com
   */
  async getUser(requestConfig?: AxiosRequestConfig): Promise<unknown> {
    const config = this.client.getConfig();
    const identityBaseUrl = getIdentityBaseUrl(config.environment);
    const fullUrl = `${identityBaseUrl}${this.basePath}/user`;

    if (requestConfig === undefined) {
      return await this.client.getWithFullUrl(fullUrl);
    }
    return await this.client.getWithFullUrl(fullUrl, undefined, requestConfig);
  }

  /** Return the authenticated Commerce Identity username used for Browse exclusion. */
  async getUsername(config?: AxiosRequestConfig): Promise<string> {
    return parseIdentityUsername(await this.getUser(config));
  }
}

export function parseIdentityUsername(value: unknown): string {
  if (!value || typeof value !== 'object') {
    throw new Error('Commerce Identity response did not include a username');
  }

  const username = (value as { username?: unknown }).username;
  if (typeof username !== 'string' || username.trim().length === 0) {
    throw new Error('Commerce Identity response did not include a username');
  }

  return username.trim();
}
