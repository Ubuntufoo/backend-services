import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'fs';
import { z } from 'zod';
import type { ZodError, ZodIssue, ZodTypeAny } from 'zod';

export type EnvSource = Record<string, string | undefined>;

export interface LoadEnvOptions<TSchema extends ZodTypeAny> {
  serviceName: string;
  schema: TSchema;
  env?: EnvSource;
  dotenvPath?: string;
  dotenvPaths?: string[];
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
const optionalTrimmedString = () =>
  z.preprocess(normalizeOptionalEnvValue, z.string().trim().optional());
const falseByDefaultBooleanString = () =>
  z.preprocess(
    (value) => {
      const normalized = normalizeOptionalEnvValue(value);
      return normalized === undefined ? 'false' : normalized;
    },
    z.enum(['true', 'false'])
  );
const optionalPositiveIntegerStringWithDefault = (name: string, defaultValue: string) =>
  z.preprocess(
    normalizeOptionalEnvValue,
    z.string().trim().regex(/^[1-9]\d*$/, `${name} must be a positive integer string`).optional().default(defaultValue)
  );
const requiredUrlString = (name: string) =>
  requiredNonEmptyString(name).url(`${name} must be a valid URL`);
const optionalUrlString = (name: string) =>
  z.preprocess(
    normalizeOptionalEnvValue,
    z.string().trim().url(`${name} must be a valid URL`).optional()
  );

export const supabaseEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: requiredUrlString('NEXT_PUBLIC_SUPABASE_URL'),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: requiredNonEmptyString(
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'
  ),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalNonEmptyString(),
  SUPABASE_SERVICE_ROLE_KEY: requiredNonEmptyString('SUPABASE_SERVICE_ROLE_KEY'),
  SUPABASE_PROJECT_REF: requiredNonEmptyString('SUPABASE_PROJECT_REF'),
});

export type SupabaseEnv = z.infer<typeof supabaseEnvSchema>;

const rawR2EnvSchema = z
  .object({
    R2_ACCOUNT_ID: requiredNonEmptyString('R2_ACCOUNT_ID'),
    R2_ACCESS_KEY_ID: requiredNonEmptyString('R2_ACCESS_KEY_ID'),
    R2_SECRET_ACCESS_KEY: requiredNonEmptyString('R2_SECRET_ACCESS_KEY'),
    R2_BUCKET_NAME: requiredNonEmptyString('R2_BUCKET_NAME'),
    R2_S3_ENDPOINT: optionalUrlString('R2_S3_ENDPOINT'),
    R2_ENDPOINT: optionalUrlString('R2_ENDPOINT'),
    R2_PUBLIC_BASE_URL: requiredUrlString('R2_PUBLIC_BASE_URL'),
  })
  .superRefine((env, ctx) => {
    if (env.R2_S3_ENDPOINT || env.R2_ENDPOINT) {
      return;
    }

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'R2_S3_ENDPOINT is required',
      path: ['R2_S3_ENDPOINT'],
    });
  });

export interface R2Env {
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET_NAME: string;
  R2_S3_ENDPOINT: string;
  R2_PUBLIC_BASE_URL: string;
}

export const sidecarRootEnvSchema = supabaseEnvSchema
  .extend({
    SIDECAR_API_URL: optionalNonEmptyString(),
    GEMINI_API_KEY: optionalNonEmptyString(),
    GEMINI_MODEL: optionalNonEmptyString(),
    APIFY_ENABLED: falseByDefaultBooleanString(),
    APIFY_TOKEN: optionalNonEmptyString(),
    APIFY_PRICE_ACTOR_ID: optionalNonEmptyString(),
    APIFY_MIN_SOLD_COMPS: optionalPositiveIntegerStringWithDefault('APIFY_MIN_SOLD_COMPS', '8'),
    APIFY_PRICE_TIMEOUT_SECONDS: optionalPositiveIntegerStringWithDefault(
      'APIFY_PRICE_TIMEOUT_SECONDS',
      '120'
    ),
    SOLDCOMPS_ENABLED: falseByDefaultBooleanString(),
    SOLDCOMPS_API_KEY: optionalNonEmptyString(),
    SOLDCOMPS_PRICE_TIMEOUT_SECONDS: optionalPositiveIntegerStringWithDefault(
      'SOLDCOMPS_PRICE_TIMEOUT_SECONDS',
      '120'
    ),
    EBAY_ENABLED: z.enum(['true', 'false']).default('true'),
    EBAY_CLIENT_ID: optionalNonEmptyString(),
    EBAY_CLIENT_SECRET: optionalNonEmptyString(),
    EBAY_REDIRECT_URI: optionalNonEmptyString(),
    EBAY_ENVIRONMENT: optionalTrimmedString(),
    EBAY_USER_REFRESH_TOKEN: optionalNonEmptyString(),
    EBAY_USER_ACCESS_TOKEN: optionalNonEmptyString(),
    EBAY_APP_ACCESS_TOKEN: optionalNonEmptyString(),
    EBAY_MARKETPLACE_ID: optionalNonEmptyString(),
    EBAY_CONTENT_LANGUAGE: optionalNonEmptyString(),
    EBAY_LOG_LEVEL: optionalNonEmptyString(),
    EBAY_ENABLE_FILE_LOGGING: z.enum(['true', 'false']).optional(),
    R2_ACCOUNT_ID: optionalNonEmptyString(),
    R2_ACCESS_KEY_ID: optionalNonEmptyString(),
    R2_SECRET_ACCESS_KEY: optionalNonEmptyString(),
    R2_BUCKET_NAME: optionalNonEmptyString(),
    R2_S3_ENDPOINT: optionalTrimmedString(),
    R2_ENDPOINT: optionalTrimmedString(),
    R2_PUBLIC_BASE_URL: optionalTrimmedString(),
  })
  .superRefine((env, ctx) => {
    if (env.APIFY_ENABLED === 'true') {
      if (!env.APIFY_TOKEN) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'APIFY_TOKEN is required',
          path: ['APIFY_TOKEN'],
        });
      }

      if (!env.APIFY_PRICE_ACTOR_ID) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'APIFY_PRICE_ACTOR_ID is required',
          path: ['APIFY_PRICE_ACTOR_ID'],
        });
      }
    }

    if (env.SOLDCOMPS_ENABLED === 'true' && !env.SOLDCOMPS_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'SOLDCOMPS_API_KEY is required',
        path: ['SOLDCOMPS_API_KEY'],
      });
    }

    if (env.EBAY_ENABLED === 'false') {
      return;
    }

    if (!env.EBAY_CLIENT_ID) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'EBAY_CLIENT_ID is required',
        path: ['EBAY_CLIENT_ID'],
      });
    }

    if (!env.EBAY_CLIENT_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'EBAY_CLIENT_SECRET is required',
        path: ['EBAY_CLIENT_SECRET'],
      });
    }

    if (
      env.EBAY_ENVIRONMENT !== undefined &&
      env.EBAY_ENVIRONMENT !== 'production' &&
      env.EBAY_ENVIRONMENT !== 'sandbox'
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'EBAY_ENVIRONMENT must be either "production" or "sandbox".',
        path: ['EBAY_ENVIRONMENT'],
      });
    }
  });

export type SidecarRootEnv = z.infer<typeof sidecarRootEnvSchema>;

export function loadDotenvFiles(paths: string[]): void {
  for (const path of paths) {
    if (existsSync(path)) {
      loadDotenv({ path, quiet: true });
    }
  }
}

export function formatEnvValidationIssue(issue: ZodIssue): string {
  const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
  return `${path}: ${issue.message}`;
}

export function formatEnvValidationErrors(serviceName: string, error: ZodError): string {
  const lines = [`${serviceName} environment validation failed:`];

  for (const issue of error.issues) {
    lines.push(`- ${formatEnvValidationIssue(issue)}`);
  }

  return lines.join('\n');
}

export class EnvValidationError extends Error {
  readonly issues: ZodIssue[];
  readonly serviceName: string;

  constructor(serviceName: string, error: ZodError) {
    super(formatEnvValidationErrors(serviceName, error));
    this.name = 'EnvValidationError';
    this.serviceName = serviceName;
    this.issues = error.issues;
  }
}

export function loadEnv<TSchema extends ZodTypeAny>({
  serviceName,
  schema,
  env,
  dotenvPath,
  dotenvPaths,
}: LoadEnvOptions<TSchema>): z.infer<TSchema> {
  if (dotenvPaths) {
    loadDotenvFiles(dotenvPaths);
  }

  if (dotenvPath) {
    loadDotenv({ path: dotenvPath, quiet: true });
  }

  const result = schema.safeParse(env ?? process.env);

  if (!result.success) {
    throw new EnvValidationError(serviceName, result.error);
  }

  return result.data;
}

export function loadSupabaseEnv(
  options: Omit<LoadEnvOptions<typeof supabaseEnvSchema>, 'serviceName' | 'schema'> = {}
): SupabaseEnv {
  return loadEnv({
    ...options,
    serviceName: 'supabase',
    schema: supabaseEnvSchema,
  });
}

export function loadR2Env(
  options: Omit<LoadEnvOptions<typeof rawR2EnvSchema>, 'serviceName' | 'schema'> = {}
): R2Env {
  const env = loadEnv({
    ...options,
    serviceName: 'r2',
    schema: rawR2EnvSchema,
  });

  return {
    R2_ACCOUNT_ID: env.R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY,
    R2_BUCKET_NAME: env.R2_BUCKET_NAME,
    R2_S3_ENDPOINT: env.R2_S3_ENDPOINT ?? env.R2_ENDPOINT!,
    R2_PUBLIC_BASE_URL: env.R2_PUBLIC_BASE_URL,
  };
}

export function loadSidecarRootEnv(
  options: Omit<LoadEnvOptions<typeof sidecarRootEnvSchema>, 'serviceName' | 'schema'> = {}
): SidecarRootEnv {
  return loadEnv({
    ...options,
    serviceName: 'sidecar',
    schema: sidecarRootEnvSchema,
  });
}
