import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  EnvValidationError,
  formatEnvValidationErrors,
  loadEnv,
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
});
