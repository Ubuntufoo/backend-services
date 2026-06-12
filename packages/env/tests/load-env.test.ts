import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  EnvValidationError,
  formatEnvValidationErrors,
  loadEnv,
  loadR2Env,
  loadSidecarRootEnv,
  loadSupabaseEnv,
} from '../src/index.js';

const serviceName = 'test-service';

const schema = z.object({
  REQUIRED_VALUE: z
    .string({ required_error: 'REQUIRED_VALUE is required' })
    .min(1, 'REQUIRED_VALUE is required'),
  MODE: z.enum(['sandbox', 'production']).default('sandbox'),
});

describe('loadEnv', () => {
  it('returns typed values for valid environment input', () => {
    const env = loadEnv({
      serviceName,
      schema,
      env: {
        REQUIRED_VALUE: 'configured',
        MODE: 'production',
      },
    });

    expect(env).toEqual({
      REQUIRED_VALUE: 'configured',
      MODE: 'production',
    });
  });

  it('throws a validation error when a required value is missing', () => {
    expect(() =>
      loadEnv({
        serviceName,
        schema,
        env: {},
      })
    ).toThrow(EnvValidationError);
  });

  it('throws a validation error for invalid enum values', () => {
    expect(() =>
      loadEnv({
        serviceName,
        schema,
        env: {
          REQUIRED_VALUE: 'configured',
          MODE: 'invalid',
        },
      })
    ).toThrow(/MODE/);
  });

  it('applies schema defaults for optional values', () => {
    const env = loadEnv({
      serviceName,
      schema,
      env: {
        REQUIRED_VALUE: 'configured',
      },
    });

    expect(env.MODE).toBe('sandbox');
  });

  it('formats validation errors with service and variable context', () => {
    const result = schema.safeParse({});

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error('Expected schema validation to fail.');
    }

    const message = formatEnvValidationErrors(serviceName, result.error);

    expect(message).toContain('test-service environment validation failed');
    expect(message).toContain('REQUIRED_VALUE');
    expect(message).toContain('REQUIRED_VALUE is required');
  });

  it('loads Supabase configuration with required publishable and service keys', () => {
    const env = loadSupabaseEnv({
      env: {
        NEXT_PUBLIC_SUPABASE_URL: 'https://fmiliwxthjonjwywuqta.supabase.co',
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
        SUPABASE_PROJECT_REF: 'fmiliwxthjonjwywuqta',
      },
    });

    expect(env.SUPABASE_PROJECT_REF).toBe('fmiliwxthjonjwywuqta');
    expect(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).toBe('sb_publishable_test');
  });

  it('loads the combined sidecar root environment contract', () => {
    const env = loadSidecarRootEnv({
      env: {
        NEXT_PUBLIC_SUPABASE_URL: 'https://fmiliwxthjonjwywuqta.supabase.co',
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
        SUPABASE_PROJECT_REF: 'fmiliwxthjonjwywuqta',
        EBAY_CLIENT_ID: 'client-id',
        EBAY_CLIENT_SECRET: 'client-secret',
      },
    });

    expect(env.EBAY_ENVIRONMENT).toBeUndefined();
    expect(env.EBAY_CLIENT_ID).toBe('client-id');
  });

  it('normalizes blank optional legacy ebay token values to undefined', () => {
    const env = loadSidecarRootEnv({
      env: {
        NEXT_PUBLIC_SUPABASE_URL: 'https://fmiliwxthjonjwywuqta.supabase.co',
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
        SUPABASE_PROJECT_REF: 'fmiliwxthjonjwywuqta',
        EBAY_ENABLED: 'true',
        EBAY_CLIENT_ID: 'client-id',
        EBAY_CLIENT_SECRET: 'client-secret',
        EBAY_USER_ACCESS_TOKEN: '   ',
        EBAY_APP_ACCESS_TOKEN: '',
      },
    });

    expect(env.EBAY_USER_ACCESS_TOKEN).toBeUndefined();
    expect(env.EBAY_APP_ACCESS_TOKEN).toBeUndefined();
  });

  it('loads required R2 configuration with the explicit S3 endpoint', () => {
    const env = loadR2Env({
      env: {
        R2_ACCOUNT_ID: 'account-id',
        R2_ACCESS_KEY_ID: 'access-key-id',
        R2_SECRET_ACCESS_KEY: 'secret-access-key',
        R2_BUCKET_NAME: 'listing-images',
        R2_S3_ENDPOINT: 'https://account-id.r2.cloudflarestorage.com',
        R2_PUBLIC_BASE_URL: 'https://images.example.com',
      },
    });

    expect(env).toEqual({
      R2_ACCOUNT_ID: 'account-id',
      R2_ACCESS_KEY_ID: 'access-key-id',
      R2_SECRET_ACCESS_KEY: 'secret-access-key',
      R2_BUCKET_NAME: 'listing-images',
      R2_S3_ENDPOINT: 'https://account-id.r2.cloudflarestorage.com',
      R2_PUBLIC_BASE_URL: 'https://images.example.com',
    });
  });

  it('accepts the legacy R2 endpoint variable and normalizes it', () => {
    const env = loadR2Env({
      env: {
        R2_ACCOUNT_ID: 'account-id',
        R2_ACCESS_KEY_ID: 'access-key-id',
        R2_SECRET_ACCESS_KEY: 'secret-access-key',
        R2_BUCKET_NAME: 'listing-images',
        R2_ENDPOINT: 'https://account-id.r2.cloudflarestorage.com',
        R2_PUBLIC_BASE_URL: 'https://images.example.com',
      },
    });

    expect(env.R2_S3_ENDPOINT).toBe('https://account-id.r2.cloudflarestorage.com');
  });

  it('requires an R2 S3 endpoint when R2 config is loaded', () => {
    expect(() =>
      loadR2Env({
        env: {
          R2_ACCOUNT_ID: 'account-id',
          R2_ACCESS_KEY_ID: 'access-key-id',
          R2_SECRET_ACCESS_KEY: 'secret-access-key',
          R2_BUCKET_NAME: 'listing-images',
          R2_PUBLIC_BASE_URL: 'https://images.example.com',
        },
      })
    ).toThrow(/R2_S3_ENDPOINT is required/);
  });

  it('allows DB-only sidecar env when EBAY_ENABLED=false', () => {
    const env = loadSidecarRootEnv({
      env: {
        NEXT_PUBLIC_SUPABASE_URL: 'https://fmiliwxthjonjwywuqta.supabase.co',
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
        SUPABASE_PROJECT_REF: 'fmiliwxthjonjwywuqta',
        EBAY_ENABLED: 'false',
      },
    });

    expect(env.EBAY_ENABLED).toBe('false');
    expect(env.EBAY_CLIENT_ID).toBeUndefined();
    expect(env.EBAY_CLIENT_SECRET).toBeUndefined();
  });

  it('requires eBay credentials when EBAY_ENABLED=true', () => {
    expect(() =>
      loadSidecarRootEnv({
        env: {
          NEXT_PUBLIC_SUPABASE_URL: 'https://fmiliwxthjonjwywuqta.supabase.co',
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
          SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
          SUPABASE_PROJECT_REF: 'fmiliwxthjonjwywuqta',
          EBAY_ENABLED: 'true',
        },
      })
    ).toThrow(/EBAY_CLIENT_ID is required/);
  });

  it('allows blank Apify values when disabled and applies defaults', () => {
    const env = loadSidecarRootEnv({
      env: {
        NEXT_PUBLIC_SUPABASE_URL: 'https://fmiliwxthjonjwywuqta.supabase.co',
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
        SUPABASE_PROJECT_REF: 'fmiliwxthjonjwywuqta',
        EBAY_ENABLED: 'false',
        APIFY_ENABLED: 'false',
        APIFY_TOKEN: '   ',
        APIFY_PRICE_ACTOR_ID: '',
      },
    });

    expect(env.APIFY_ENABLED).toBe('false');
    expect(env.APIFY_TOKEN).toBeUndefined();
    expect(env.APIFY_PRICE_ACTOR_ID).toBeUndefined();
    expect(env.APIFY_MIN_SOLD_COMPS).toBe('8');
    expect(env.APIFY_PRICE_TIMEOUT_SECONDS).toBe('120');
  });

  it('treats blank APIFY_ENABLED as disabled', () => {
    const env = loadSidecarRootEnv({
      env: {
        NEXT_PUBLIC_SUPABASE_URL: 'https://fmiliwxthjonjwywuqta.supabase.co',
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
        SUPABASE_PROJECT_REF: 'fmiliwxthjonjwywuqta',
        APIFY_ENABLED: '',
        EBAY_ENABLED: 'false',
      },
    });

    expect(env.APIFY_ENABLED).toBe('false');
    expect(env.APIFY_MIN_SOLD_COMPS).toBe('8');
    expect(env.APIFY_PRICE_TIMEOUT_SECONDS).toBe('120');
  });

  it('requires Apify token and actor id when enabled', () => {
    expect(() =>
      loadSidecarRootEnv({
        env: {
          NEXT_PUBLIC_SUPABASE_URL: 'https://fmiliwxthjonjwywuqta.supabase.co',
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
          SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
          SUPABASE_PROJECT_REF: 'fmiliwxthjonjwywuqta',
          EBAY_ENABLED: 'false',
          APIFY_ENABLED: 'true',
        },
      })
    ).toThrow(/APIFY_TOKEN is required/);
  });

  it('rejects invalid positive integer string Apify min values even when disabled', () => {
    for (const invalidValue of ['0', '-1', '1.5', 'abc']) {
      expect(() =>
        loadSidecarRootEnv({
          env: {
            NEXT_PUBLIC_SUPABASE_URL: 'https://fmiliwxthjonjwywuqta.supabase.co',
            NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
            SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
            SUPABASE_PROJECT_REF: 'fmiliwxthjonjwywuqta',
            APIFY_MIN_SOLD_COMPS: invalidValue,
            EBAY_ENABLED: 'false',
          },
        })
      ).toThrow(/APIFY_MIN_SOLD_COMPS must be a positive integer string/);
    }
  });

  it('rejects invalid Apify timeout values even when disabled', () => {
    for (const invalidValue of ['0', '-1', '1.5', 'abc']) {
      expect(() =>
        loadSidecarRootEnv({
          env: {
            NEXT_PUBLIC_SUPABASE_URL: 'https://fmiliwxthjonjwywuqta.supabase.co',
            NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
            SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
            SUPABASE_PROJECT_REF: 'fmiliwxthjonjwywuqta',
            APIFY_PRICE_TIMEOUT_SECONDS: invalidValue,
            EBAY_ENABLED: 'false',
          },
        })
      ).toThrow(/APIFY_PRICE_TIMEOUT_SECONDS must be a positive integer string/);
    }
  });

  it('rejects invalid positive integer string Apify values when enabled', () => {
    expect(() =>
      loadSidecarRootEnv({
        env: {
          NEXT_PUBLIC_SUPABASE_URL: 'https://fmiliwxthjonjwywuqta.supabase.co',
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
          SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
          SUPABASE_PROJECT_REF: 'fmiliwxthjonjwywuqta',
          APIFY_ENABLED: 'true',
          APIFY_MIN_SOLD_COMPS: '12',
          APIFY_PRICE_ACTOR_ID: 'actor-id',
          APIFY_PRICE_TIMEOUT_SECONDS: 'abc',
          APIFY_TOKEN: 'token',
          EBAY_ENABLED: 'false',
        },
      })
    ).toThrow(/APIFY_PRICE_TIMEOUT_SECONDS must be a positive integer string/);
  });
});
