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

const optionalNonEmptyString = () => z.string().trim().min(1).optional();

export const supabaseEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: requiredNonEmptyString('NEXT_PUBLIC_SUPABASE_URL').url(
    'NEXT_PUBLIC_SUPABASE_URL must be a valid URL'
  ),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: requiredNonEmptyString(
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'
  ),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalNonEmptyString(),
  SUPABASE_SERVICE_ROLE_KEY: requiredNonEmptyString('SUPABASE_SERVICE_ROLE_KEY'),
  SUPABASE_PROJECT_REF: requiredNonEmptyString('SUPABASE_PROJECT_REF'),
});

export type SupabaseEnv = z.infer<typeof supabaseEnvSchema>;

export const sidecarRootEnvSchema = supabaseEnvSchema.extend({
  SIDECAR_API_URL: optionalNonEmptyString(),
  GEMINI_API_KEY: optionalNonEmptyString(),
  GEMINI_MODEL: optionalNonEmptyString(),
  EBAY_CLIENT_ID: requiredNonEmptyString('EBAY_CLIENT_ID'),
  EBAY_CLIENT_SECRET: requiredNonEmptyString('EBAY_CLIENT_SECRET'),
  EBAY_REDIRECT_URI: optionalNonEmptyString(),
  EBAY_ENVIRONMENT: z.enum(['production', 'sandbox']).default('sandbox'),
  EBAY_USER_REFRESH_TOKEN: optionalNonEmptyString(),
  EBAY_USER_ACCESS_TOKEN: optionalNonEmptyString(),
  EBAY_APP_ACCESS_TOKEN: optionalNonEmptyString(),
  EBAY_MARKETPLACE_ID: optionalNonEmptyString(),
  EBAY_CONTENT_LANGUAGE: optionalNonEmptyString(),
  EBAY_LOG_LEVEL: optionalNonEmptyString(),
  EBAY_ENABLE_FILE_LOGGING: z.enum(['true', 'false']).optional(),
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

export function loadSidecarRootEnv(
  options: Omit<LoadEnvOptions<typeof sidecarRootEnvSchema>, 'serviceName' | 'schema'> = {}
): SidecarRootEnv {
  return loadEnv({
    ...options,
    serviceName: 'sidecar',
    schema: sidecarRootEnvSchema,
  });
}
