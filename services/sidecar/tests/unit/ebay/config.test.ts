import { describe, expect, it } from 'vitest';
import { EnvValidationError, loadEbayOAuthValidationConfig } from '@/ebay/config.js';

function createBaseEnv(): NodeJS.ProcessEnv {
  return {
    EBAY_ENVIRONMENT: 'sandbox',
    EBAY_CLIENT_ID: 'client-id',
    EBAY_CLIENT_SECRET: 'client-secret',
    EBAY_REFRESH_TOKEN: 'v^1.1#refresh-token',
  };
}

describe('loadEbayOAuthValidationConfig', () => {
  it('accepts valid sandbox config', () => {
    const config = loadEbayOAuthValidationConfig({
      ...createBaseEnv(),
      EBAY_REDIRECT_URI: 'https://localhost/callback',
      EBAY_API_BASE_URL: 'https://api.sandbox.ebay.com',
      EBAY_OAUTH_BASE_URL: 'https://api.sandbox.ebay.com/identity/v1/oauth2/token',
      EBAY_MARKETPLACE_ID: 'EBAY_US',
      EBAY_PUBLISH_ENABLED: 'true',
    });

    expect(config).toEqual({
      environment: 'sandbox',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      refreshToken: 'v^1.1#refresh-token',
      redirectUri: 'https://localhost/callback',
      apiBaseUrl: 'https://api.sandbox.ebay.com',
      oauthBaseUrl: 'https://api.sandbox.ebay.com/identity/v1/oauth2/token',
      marketplaceId: 'EBAY_US',
      publishEnabled: true,
    });
  });

  it('rejects missing EBAY_CLIENT_ID', () => {
    expect(() =>
      loadEbayOAuthValidationConfig({
        ...createBaseEnv(),
        EBAY_CLIENT_ID: undefined,
      })
    ).toThrow(EnvValidationError);
  });

  it('rejects missing EBAY_CLIENT_SECRET', () => {
    expect(() =>
      loadEbayOAuthValidationConfig({
        ...createBaseEnv(),
        EBAY_CLIENT_SECRET: undefined,
      })
    ).toThrow(/EBAY_CLIENT_SECRET is required/);
  });

  it('rejects missing EBAY_REFRESH_TOKEN', () => {
    expect(() =>
      loadEbayOAuthValidationConfig({
        ...createBaseEnv(),
        EBAY_REFRESH_TOKEN: undefined,
        EBAY_USER_REFRESH_TOKEN: undefined,
      })
    ).toThrow(/EBAY_REFRESH_TOKEN or EBAY_USER_REFRESH_TOKEN is required/);
  });

  it('accepts EBAY_USER_REFRESH_TOKEN fallback', () => {
    const config = loadEbayOAuthValidationConfig({
      ...createBaseEnv(),
      EBAY_REFRESH_TOKEN: undefined,
      EBAY_USER_REFRESH_TOKEN: 'v^1.1#legacy-refresh-token',
    });

    expect(config.refreshToken).toBe('v^1.1#legacy-refresh-token');
  });

  it('accepts blank preferred refresh token when legacy fallback is set', () => {
    const config = loadEbayOAuthValidationConfig({
      ...createBaseEnv(),
      EBAY_REFRESH_TOKEN: '   ',
      EBAY_USER_REFRESH_TOKEN: 'v^1.1#legacy-refresh-token',
    });

    expect(config.refreshToken).toBe('v^1.1#legacy-refresh-token');
  });

  it('prefers EBAY_REFRESH_TOKEN when both exist', () => {
    const config = loadEbayOAuthValidationConfig({
      ...createBaseEnv(),
      EBAY_REFRESH_TOKEN: 'v^1.1#preferred-refresh-token',
      EBAY_USER_REFRESH_TOKEN: 'v^1.1#legacy-refresh-token',
    });

    expect(config.refreshToken).toBe('v^1.1#preferred-refresh-token');
  });

  it('rejects blank refresh token values when no refresh token is configured', () => {
    expect(() =>
      loadEbayOAuthValidationConfig({
        ...createBaseEnv(),
        EBAY_REFRESH_TOKEN: '',
        EBAY_USER_REFRESH_TOKEN: '   ',
      })
    ).toThrow(/EBAY_REFRESH_TOKEN or EBAY_USER_REFRESH_TOKEN is required/);
  });

  it('rejects obvious callback authorization-code values', () => {
    const badValue = 'v%5E1.1%23callback-code';

    let thrown: unknown;

    try {
      loadEbayOAuthValidationConfig({
        ...createBaseEnv(),
        EBAY_REFRESH_TOKEN: badValue,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(EnvValidationError);
    const message = (thrown as Error).message;
    expect(message).toContain('authorization code or callback URL');
    expect(message).not.toContain(badValue);
  });

  it('rejects invalid EBAY_ENVIRONMENT', () => {
    expect(() =>
      loadEbayOAuthValidationConfig({
        ...createBaseEnv(),
        EBAY_ENVIRONMENT: 'staging',
      } as NodeJS.ProcessEnv)
    ).toThrow(/EBAY_ENVIRONMENT/);
  });

  it('rejects invalid URL values', () => {
    expect(() =>
      loadEbayOAuthValidationConfig({
        ...createBaseEnv(),
        EBAY_API_BASE_URL: 'not-a-url',
      })
    ).toThrow(/EBAY_API_BASE_URL must be a valid URL/);
  });

  it('defaults EBAY_MARKETPLACE_ID to EBAY_US', () => {
    const config = loadEbayOAuthValidationConfig(createBaseEnv());

    expect(config.marketplaceId).toBe('EBAY_US');
  });

  it('defaults EBAY_PUBLISH_ENABLED to false', () => {
    const config = loadEbayOAuthValidationConfig(createBaseEnv());

    expect(config.publishEnabled).toBe(false);
  });

  it('parses EBAY_PUBLISH_ENABLED=true correctly', () => {
    const config = loadEbayOAuthValidationConfig({
      ...createBaseEnv(),
      EBAY_PUBLISH_ENABLED: 'true',
    });

    expect(config.publishEnabled).toBe(true);
  });
});
