import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';
import type { ZodError, ZodIssue, ZodTypeAny } from 'zod';

export type EnvSource = Record<string, string | undefined>;

export interface LoadEnvOptions<TSchema extends ZodTypeAny> {
  serviceName: string;
  schema: TSchema;
  env?: EnvSource;
  dotenvPath?: string;
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
}: LoadEnvOptions<TSchema>): z.infer<TSchema> {
  if (dotenvPath) {
    loadDotenv({ path: dotenvPath, quiet: true });
  }

  const result = schema.safeParse(env ?? process.env);

  if (!result.success) {
    throw new EnvValidationError(serviceName, result.error);
  }

  return result.data;
}
