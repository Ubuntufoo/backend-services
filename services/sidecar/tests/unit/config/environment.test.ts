import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getEbayConfig,
  getBaseUrl,
  getOauthBaseUrl,
  getAuthUrl,
  isEbayEnabled,
  validateEnvironmentConfig,
} from '@/config/environment.js';

describe('Environment Configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      NEXT_PUBLIC_SUPABASE_URL: 'https://fmiliwxthjonjwywuqta.supabase.co',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
      SUPABASE_PROJECT_REF: 'fmiliwxthjonjwywuqta',
    } as NodeJS.ProcessEnv;
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('getEbayConfig', () => {
    it('should return config with valid credentials', () => {
      process.env.EBAY_CLIENT_ID = 'test_client_id';
      process.env.EBAY_CLIENT_SECRET = 'test_client_secret';
      process.env.EBAY_REDIRECT_URI = 'https://example.com/callback';
      process.env.EBAY_ENVIRONMENT = 'production';

      const config = getEbayConfig();

      expect(config).toMatchObject({
        clientId: 'test_client_id',
        clientSecret: 'test_client_secret',
        redirectUri: 'https://example.com/callback',
        environment: 'production',
      });
    });

    it('should default to sandbox environment', () => {
      process.env.EBAY_CLIENT_ID = 'test_client_id';
      process.env.EBAY_CLIENT_SECRET = 'test_client_secret';
      delete process.env.EBAY_ENVIRONMENT;

      const config = getEbayConfig();

      expect(config.environment).toBe('sandbox');
    });

    it('should handle missing credentials gracefully', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      delete process.env.EBAY_CLIENT_ID;
      delete process.env.EBAY_CLIENT_SECRET;

      const config = getEbayConfig();

      expect(config.clientId).toBe('');
      expect(config.clientSecret).toBe('');
      expect(config.environment).toBe('sandbox');
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    it('should handle missing client ID only', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      delete process.env.EBAY_CLIENT_ID;
      process.env.EBAY_CLIENT_SECRET = 'test_secret';

      const config = getEbayConfig();

      expect(config.clientId).toBe('');
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    it('should handle missing client secret only', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      process.env.EBAY_CLIENT_ID = 'test_id';
      delete process.env.EBAY_CLIENT_SECRET;

      const config = getEbayConfig();

      expect(config.clientSecret).toBe('');
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    it('should handle undefined redirect URI', () => {
      process.env.EBAY_CLIENT_ID = 'test_client_id';
      process.env.EBAY_CLIENT_SECRET = 'test_client_secret';
      delete process.env.EBAY_REDIRECT_URI;

      const config = getEbayConfig();

      expect(config.redirectUri).toBeUndefined();
    });

    it('should default marketplace and content language to US', () => {
      process.env.EBAY_CLIENT_ID = 'test_client_id';
      process.env.EBAY_CLIENT_SECRET = 'test_client_secret';
      delete process.env.EBAY_MARKETPLACE_ID;
      delete process.env.EBAY_CONTENT_LANGUAGE;

      const config = getEbayConfig();

      expect(config.marketplaceId).toBe('EBAY_US');
      expect(config.contentLanguage).toBe('en-US');
    });

    it('should use marketplace and content language from env when set', () => {
      process.env.EBAY_CLIENT_ID = 'test_client_id';
      process.env.EBAY_CLIENT_SECRET = 'test_client_secret';
      process.env.EBAY_MARKETPLACE_ID = 'EBAY_DE';
      process.env.EBAY_CONTENT_LANGUAGE = 'de-DE';

      const config = getEbayConfig();

      expect(config.marketplaceId).toBe('EBAY_DE');
      expect(config.contentLanguage).toBe('de-DE');
    });
  });

  describe('getBaseUrl', () => {
    it('should return production URL for production environment', () => {
      const url = getBaseUrl('production');
      expect(url).toBe('https://api.ebay.com');
    });

    it('should return sandbox URL for sandbox environment', () => {
      const url = getBaseUrl('sandbox');
      expect(url).toBe('https://api.sandbox.ebay.com');
    });
  });

  describe('getOauthBaseUrl', () => {
    it('should return production auth base URL for production environment', () => {
      expect(getOauthBaseUrl('production')).toBe('https://auth.ebay.com');
    });

    it('should return sandbox auth base URL for sandbox environment', () => {
      expect(getOauthBaseUrl('sandbox')).toBe('https://auth.sandbox.ebay.com');
    });
  });

  describe('getAuthUrl', () => {
    it('should return production auth URL for production environment', () => {
      const url = getAuthUrl('test_client_id', 'https://localhost/callback', 'production');
      const parsed = new URL(url);
      expect(parsed.origin).toBe('https://auth.ebay.com');
      expect(parsed.pathname).toBe('/oauth2/authorize');
      expect(parsed.searchParams.get('client_id')).toBe('test_client_id');
      expect(parsed.searchParams.get('response_type')).toBe('code');
    });

    it('should return sandbox auth URL for sandbox environment', () => {
      const url = getAuthUrl('test_client_id', 'https://localhost/callback', 'sandbox');
      const parsed = new URL(url);
      expect(parsed.origin).toBe('https://auth.sandbox.ebay.com');
      expect(parsed.pathname).toBe('/oauth2/authorize');
      expect(parsed.searchParams.get('client_id')).toBe('test_client_id');
      expect(parsed.searchParams.get('response_type')).toBe('code');
    });

    it('should fall back to default scopes when custom scopes are empty', () => {
      const url = getAuthUrl(
        'test_client_id',
        'https://localhost/callback',
        'sandbox',
        undefined,
        undefined,
        undefined,
        undefined,
        []
      );
      const parsed = new URL(url);

      const scope = parsed.searchParams.get('scope');
      expect(scope).toBeTruthy();
      expect(scope).toContain('sell.inventory');
    });
  });

  describe('validateEnvironmentConfig', () => {
    it('should pass validation with valid config', () => {
      process.env.EBAY_CLIENT_ID = 'test_client_id';
      process.env.EBAY_CLIENT_SECRET = 'test_client_secret';
      process.env.EBAY_ENVIRONMENT = 'production';
      process.env.EBAY_REDIRECT_URI = 'https://example.com/callback';

      const result = validateEnvironmentConfig();

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail validation when CLIENT_ID is missing', () => {
      process.env.EBAY_ENABLED = 'true';
      delete process.env.EBAY_CLIENT_ID;
      process.env.EBAY_CLIENT_SECRET = 'test_secret';

      const result = validateEnvironmentConfig();

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('EBAY_CLIENT_ID is required');
    });

    it('should fail validation when CLIENT_SECRET is missing', () => {
      process.env.EBAY_ENABLED = 'true';
      process.env.EBAY_CLIENT_ID = 'test_id';
      delete process.env.EBAY_CLIENT_SECRET;

      const result = validateEnvironmentConfig();

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('EBAY_CLIENT_SECRET is required');
    });

    it('should fail validation for invalid environment value', () => {
      process.env.EBAY_ENABLED = 'true';
      process.env.EBAY_CLIENT_ID = 'test_id';
      process.env.EBAY_CLIENT_SECRET = 'test_secret';
      process.env.EBAY_ENVIRONMENT = 'invalid';

      const result = validateEnvironmentConfig();

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should warn when ENVIRONMENT is not set', () => {
      process.env.EBAY_ENABLED = 'true';
      process.env.EBAY_CLIENT_ID = 'test_id';
      process.env.EBAY_CLIENT_SECRET = 'test_secret';
      delete process.env.EBAY_ENVIRONMENT;

      const result = validateEnvironmentConfig();

      expect(result.isValid).toBe(true);
      expect(result.warnings.some((w) => w.includes('EBAY_ENVIRONMENT not set'))).toBe(true);
    });

    it('should warn when REDIRECT_URI is not set', () => {
      process.env.EBAY_ENABLED = 'true';
      process.env.EBAY_CLIENT_ID = 'test_id';
      process.env.EBAY_CLIENT_SECRET = 'test_secret';
      delete process.env.EBAY_REDIRECT_URI;

      const result = validateEnvironmentConfig();

      expect(result.isValid).toBe(true);
      expect(result.warnings.some((w) => w.includes('EBAY_REDIRECT_URI'))).toBe(true);
    });

    it('should allow DB-only mode without eBay credentials', () => {
      process.env.EBAY_ENABLED = 'false';
      delete process.env.EBAY_CLIENT_ID;
      delete process.env.EBAY_CLIENT_SECRET;
      delete process.env.EBAY_REDIRECT_URI;
      delete process.env.EBAY_ENVIRONMENT;

      const result = validateEnvironmentConfig();

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings.some((w) => w.includes('EBAY_REDIRECT_URI'))).toBe(false);
      expect(result.warnings.some((w) => w.includes('EBAY_ENVIRONMENT'))).toBe(false);
    });

    it('reports eBay enabled state from env', () => {
      expect(isEbayEnabled(process.env)).toBe(true);

      process.env.EBAY_ENABLED = 'false';

      expect(isEbayEnabled(process.env)).toBe(false);
    });
  });
});
