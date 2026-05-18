import { mkdtempSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
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

  it('loads multiple dotenv files in order and lets later files override earlier ones', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'load-env-'));
    const envPath = join(tempDir, '.env');
    const envLocalPath = join(tempDir, '.env.local');
    const originalRequiredValue = process.env.REQUIRED_VALUE;
    const originalMode = process.env.MODE;

    writeFileSync(
      envPath,
      ['REQUIRED_VALUE=from-env', 'MODE=production', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=base'].join(
        '\n'
      )
    );
    writeFileSync(envLocalPath, ['REQUIRED_VALUE=from-env-local', 'MODE=sandbox'].join('\n'));

    delete process.env.REQUIRED_VALUE;
    delete process.env.MODE;

    try {
      const env = loadEnv({
        serviceName,
        schema,
        dotenvPaths: [envPath, envLocalPath],
      });

      expect(env).toEqual({
        REQUIRED_VALUE: 'from-env-local',
        MODE: 'sandbox',
      });
    } finally {
      if (originalRequiredValue === undefined) {
        delete process.env.REQUIRED_VALUE;
      } else {
        process.env.REQUIRED_VALUE = originalRequiredValue;
      }

      if (originalMode === undefined) {
        delete process.env.MODE;
      } else {
        process.env.MODE = originalMode;
      }
    }
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

    expect(env.EBAY_ENVIRONMENT).toBe('sandbox');
    expect(env.EBAY_CLIENT_ID).toBe('client-id');
  });
});
