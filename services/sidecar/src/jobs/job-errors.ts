import type { JobRow, Json } from '@ebay-inventory/data';
import {
  GeminiDraftServiceError,
  GeminiDraftValidationError,
} from '@/gemini/index.js';
import { getJobMaxAttempts } from './retry-policy.js';

export type JobErrorCategory = 'recoverable' | 'terminal' | 'user_fixable';

export const JOB_ERROR_CODES = {
  GENERATE_AI_FAILED: 'generate_ai_failed',
  GENERATE_AI_LISTING_NOT_ELIGIBLE: 'generate_ai_listing_not_eligible',
  GENERATE_AI_LISTING_NOT_FOUND: 'generate_ai_listing_not_found',
  GENERATE_AI_MISSING_IMAGE_URLS: 'generate_ai_missing_image_urls',
  GENERATE_AI_MISSING_LISTING_ID: 'generate_ai_missing_listing_id',
  JOB_NOT_FOUND: 'job_not_found',
  JOB_NOT_CLAIMABLE: 'job_not_claimable',
  JOB_NOT_RUNNABLE: 'job_not_runnable',
  PROCESS_IMAGES_FAILED: 'process_images_failed',
  RETRY_EXHAUSTED: 'retry_exhausted',
  STALE_WORKER: 'stale_worker',
  UNSUPPORTED_JOB_TYPE: 'unsupported_job_type',
} as const;

export type JobErrorCode = (typeof JOB_ERROR_CODES)[keyof typeof JOB_ERROR_CODES];

export type JobErrorContext = Record<string, Json>;

export class SidecarJobError extends Error {
  readonly category: JobErrorCategory;
  readonly code: JobErrorCode;
  readonly context: JobErrorContext;

  constructor(
    code: JobErrorCode,
    category: JobErrorCategory,
    message: string,
    context: JobErrorContext = {},
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'SidecarJobError';
    this.category = category;
    this.code = code;
    this.context = context;
  }
}

function asErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildBaseContext(error: unknown): JobErrorContext {
  if (!(error instanceof Error)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries({
      name: error.name,
    }).filter(([, value]) => value !== undefined)
  );
}

function isGeminiApiKeyError(error: GeminiDraftServiceError): boolean {
  return error.message.includes('GEMINI_API_KEY is required');
}

function getGeminiValidationIssues(error: GeminiDraftValidationError): string[] {
  return error.issues.map((issue) =>
    issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message
  );
}

export function classifyJobError(jobType: JobRow['job_type'], error: unknown): SidecarJobError {
  if (error instanceof SidecarJobError) {
    return error;
  }

  if (jobType === 'generate_ai') {
    if (error instanceof GeminiDraftValidationError) {
      return new SidecarJobError(
        JOB_ERROR_CODES.GENERATE_AI_FAILED,
        'user_fixable',
        error.message,
        {
          ...buildBaseContext(error),
          issues: getGeminiValidationIssues(error),
        },
        { cause: error }
      );
    }

    if (error instanceof GeminiDraftServiceError && isGeminiApiKeyError(error)) {
      return new SidecarJobError(
        JOB_ERROR_CODES.GENERATE_AI_FAILED,
        'user_fixable',
        error.message,
        buildBaseContext(error),
        { cause: error }
      );
    }

    return new SidecarJobError(
      JOB_ERROR_CODES.GENERATE_AI_FAILED,
      'recoverable',
      asErrorMessage(error),
      buildBaseContext(error),
      {
        cause: error instanceof Error ? error : undefined,
      }
    );
  }

  return new SidecarJobError(
    JOB_ERROR_CODES.PROCESS_IMAGES_FAILED,
    'recoverable',
    asErrorMessage(error),
    buildBaseContext(error),
    {
      cause: error instanceof Error ? error : undefined,
    }
  );
}

export function createRetryExhaustedError(
  job: Pick<JobRow, 'attempts' | 'id' | 'job_type' | 'max_attempts'>,
  error: SidecarJobError
): SidecarJobError {
  return new SidecarJobError(
    JOB_ERROR_CODES.RETRY_EXHAUSTED,
    'terminal',
    `Job "${job.id}" exhausted ${getJobMaxAttempts(job)} attempts after ${error.code}: ${error.message}`,
    {
      attempts: job.attempts,
      exhausted_code: error.code,
      exhausted_max_attempts: getJobMaxAttempts(job),
      job_type: job.job_type,
      source_category: error.category,
    },
    { cause: error }
  );
}

export function createStaleWorkerError(
  job: Pick<JobRow, 'id' | 'job_type'>
): SidecarJobError {
  return new SidecarJobError(
    JOB_ERROR_CODES.STALE_WORKER,
    'recoverable',
    `Job "${job.id}" was left running after worker shutdown or crash.`,
    {
      job_type: job.job_type,
    }
  );
}

export function toJobErrorUpdateInput(error: SidecarJobError, errorAt: string): {
  errorAt: string;
  errorCode: string;
  errorMessage: string;
} {
  return {
    errorAt,
    errorCode: error.code,
    errorMessage: error.message,
  };
}

export function toListingErrorContext(error: SidecarJobError): Json {
  const context = {
    category: error.category,
    ...error.context,
  };

  return context satisfies Json;
}
