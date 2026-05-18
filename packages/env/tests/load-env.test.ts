import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  EnvValidationError,
  formatEnvValidationErrors,
  loadEnv,
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
});
