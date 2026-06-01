import {
  DailyUsageLimitExceededError,
  type JobRow,
  type Json,
  type ListingRow,
} from '@ebay-inventory/data';
import {
  GeminiDraftServiceError,
  GeminiDraftValidationError,
} from '@/gemini/index.js';
import { PublishListingError } from '@/ebay/publish-validation.js';
import type { EbayApiError } from '@/types/ebay.js';
import { getJobMaxAttempts } from './retry-policy.js';

export type JobErrorCategory = 'recoverable' | 'terminal' | 'user_fixable';

export const JOB_ERROR_CODES = {
  DAILY_GEMINI_LIMIT_EXCEEDED: 'DAILY_GEMINI_LIMIT_EXCEEDED',
  DAILY_ORDER_SYNC_LIMIT_EXCEEDED: 'DAILY_ORDER_SYNC_LIMIT_EXCEEDED',
  DUPLICATE_ACTIVE_JOB: 'duplicate_active_job',
  LISTING_NOT_FOUND: 'listing_not_found',
  PUBLISH_APP_SETTINGS_NOT_FOUND: 'publish_app_settings_not_found',
  PUBLISH_EXPORT_STATE_PERSIST_FAILED: 'publish_export_state_persist_failed',
  PUBLISH_INVENTORY_ITEM_UPSERT_FAILED: 'publish_inventory_item_upsert_failed',
  PUBLISH_LISTING_NOT_FOUND: 'publish_listing_not_found',
  PUBLISH_LISTING_NOT_READY: 'publish_listing_not_ready',
  PUBLISH_OFFER_CREATE_FAILED: 'publish_offer_create_failed',
  PUBLISH_OFFER_PUBLISH_FAILED: 'publish_offer_publish_failed',
  GENERATE_AI_FAILED: 'generate_ai_failed',
  GENERATE_AI_LISTING_NOT_ELIGIBLE: 'generate_ai_listing_not_eligible',
  GENERATE_AI_LISTING_NOT_FOUND: 'generate_ai_listing_not_found',
  GENERATE_AI_MISSING_IMAGE_URLS: 'generate_ai_missing_image_urls',
  GENERATE_AI_MISSING_LISTING_ID: 'generate_ai_missing_listing_id',
  JOB_NOT_FOUND: 'job_not_found',
  JOB_NOT_CLAIMABLE: 'job_not_claimable',
  JOB_NOT_RUNNABLE: 'job_not_runnable',
  MANUAL_RETRY_NOT_ALLOWED: 'manual_retry_not_allowed',
  ORPHAN_ACTIVE_STATE: 'orphan_active_state',
  PUBLISH_FAILED: 'publish_failed',
  PUBLISH_LISTING_NOT_ELIGIBLE: 'publish_listing_not_eligible',
  PUBLISH_MISSING_LISTING_ID: 'publish_missing_listing_id',
  PROCESS_IMAGES_FAILED: 'process_images_failed',
  RETRY_EXHAUSTED: 'retry_exhausted',
  STALE_WORKER: 'stale_worker',
  UNSUPPORTED_JOB_TYPE: 'unsupported_job_type',
} as const;

export type JobErrorCode = (typeof JOB_ERROR_CODES)[keyof typeof JOB_ERROR_CODES];

export type JobErrorContext = Record<string, Json>;
type StoredErrorContext = Json | null | undefined;
type StoredJobErrorCategory = JobErrorCategory | 'unknown';
type EbayApiErrorEntry = EbayApiError['errors'][number];
type PublishValidationScope = 'app_settings' | 'listing' | 'unknown';

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

export class DailyUsageGuardrailError extends SidecarJobError {
  constructor(
    code:
      | typeof JOB_ERROR_CODES.DAILY_GEMINI_LIMIT_EXCEEDED
      | typeof JOB_ERROR_CODES.DAILY_ORDER_SYNC_LIMIT_EXCEEDED,
    message: string,
    context: JobErrorContext = {},
    options?: ErrorOptions
  ) {
    super(code, 'recoverable', message, context, options);
    this.name = 'DailyUsageGuardrailError';
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

function getContextCategory(
  context: StoredErrorContext,
  key: 'category' | 'source_category'
): JobErrorCategory | undefined {
  if (!context || Array.isArray(context) || typeof context !== 'object') {
    return undefined;
  }

  const value = context[key];

  return value === 'recoverable' || value === 'terminal' || value === 'user_fixable'
    ? value
    : undefined;
}

function isKnownJobErrorCode(code: string): code is JobErrorCode {
  return Object.values(JOB_ERROR_CODES).includes(code as JobErrorCode);
}

function getDefaultStoredErrorCategory(code: JobErrorCode): StoredJobErrorCategory {
  switch (code) {
    case JOB_ERROR_CODES.DAILY_GEMINI_LIMIT_EXCEEDED:
    case JOB_ERROR_CODES.DAILY_ORDER_SYNC_LIMIT_EXCEEDED:
    case JOB_ERROR_CODES.DUPLICATE_ACTIVE_JOB:
    case JOB_ERROR_CODES.GENERATE_AI_FAILED:
    case JOB_ERROR_CODES.LISTING_NOT_FOUND:
    case JOB_ERROR_CODES.PUBLISH_FAILED:
    case JOB_ERROR_CODES.PUBLISH_OFFER_CREATE_FAILED:
    case JOB_ERROR_CODES.PUBLISH_OFFER_PUBLISH_FAILED:
    case JOB_ERROR_CODES.PROCESS_IMAGES_FAILED:
    case JOB_ERROR_CODES.STALE_WORKER:
    case JOB_ERROR_CODES.ORPHAN_ACTIVE_STATE:
      return 'recoverable';
    case JOB_ERROR_CODES.GENERATE_AI_MISSING_IMAGE_URLS:
    case JOB_ERROR_CODES.GENERATE_AI_LISTING_NOT_ELIGIBLE:
    case JOB_ERROR_CODES.PUBLISH_APP_SETTINGS_NOT_FOUND:
    case JOB_ERROR_CODES.PUBLISH_LISTING_NOT_ELIGIBLE:
    case JOB_ERROR_CODES.PUBLISH_LISTING_NOT_READY:
      return 'user_fixable';
    case JOB_ERROR_CODES.GENERATE_AI_LISTING_NOT_FOUND:
    case JOB_ERROR_CODES.GENERATE_AI_MISSING_LISTING_ID:
    case JOB_ERROR_CODES.JOB_NOT_CLAIMABLE:
    case JOB_ERROR_CODES.JOB_NOT_FOUND:
    case JOB_ERROR_CODES.JOB_NOT_RUNNABLE:
    case JOB_ERROR_CODES.MANUAL_RETRY_NOT_ALLOWED:
    case JOB_ERROR_CODES.PUBLISH_EXPORT_STATE_PERSIST_FAILED:
    case JOB_ERROR_CODES.PUBLISH_INVENTORY_ITEM_UPSERT_FAILED:
    case JOB_ERROR_CODES.PUBLISH_LISTING_NOT_FOUND:
    case JOB_ERROR_CODES.PUBLISH_MISSING_LISTING_ID:
    case JOB_ERROR_CODES.RETRY_EXHAUSTED:
    case JOB_ERROR_CODES.UNSUPPORTED_JOB_TYPE:
      return 'terminal';
  }
}

function isGeminiApiKeyError(error: GeminiDraftServiceError): boolean {
  return error.message.includes('GEMINI_API_KEY is required');
}

function createDailyUsageGuardrailError(error: DailyUsageLimitExceededError): DailyUsageGuardrailError {
  const code =
    error.resource === 'gemini'
      ? JOB_ERROR_CODES.DAILY_GEMINI_LIMIT_EXCEEDED
      : JOB_ERROR_CODES.DAILY_ORDER_SYNC_LIMIT_EXCEEDED;

  return new DailyUsageGuardrailError(
    code,
    error.message,
    {
      effective_limit: error.effectiveLimit,
      guardrail_type: 'quota_guardrail',
      limit_source: error.source,
      resource: error.resource,
      usage_date: error.usageDate,
      used: error.used,
    },
    { cause: error }
  );
}

function getGeminiValidationIssues(error: GeminiDraftValidationError): string[] {
  return error.issues.map((issue) =>
    issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message
  );
}

function getPublishJobErrorCode(
  code: PublishListingError['code']
): JobErrorCode {
  switch (code) {
    case 'APP_SETTINGS_NOT_FOUND':
      return JOB_ERROR_CODES.PUBLISH_APP_SETTINGS_NOT_FOUND;
    case 'EXPORT_STATE_PERSIST_FAILED':
      return JOB_ERROR_CODES.PUBLISH_EXPORT_STATE_PERSIST_FAILED;
    case 'INVENTORY_ITEM_UPSERT_FAILED':
      return JOB_ERROR_CODES.PUBLISH_INVENTORY_ITEM_UPSERT_FAILED;
    case 'LISTING_NOT_FOUND':
      return JOB_ERROR_CODES.PUBLISH_LISTING_NOT_FOUND;
    case 'LISTING_NOT_READY':
      return JOB_ERROR_CODES.PUBLISH_LISTING_NOT_READY;
    case 'OFFER_CREATE_FAILED':
      return JOB_ERROR_CODES.PUBLISH_OFFER_CREATE_FAILED;
    case 'OFFER_PUBLISH_FAILED':
      return JOB_ERROR_CODES.PUBLISH_OFFER_PUBLISH_FAILED;
  }
}

function asLowerText(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase() : '';
}

function mentionsListingPayloadField(text: string): boolean {
  return [
    'title',
    'description',
    'price',
    'image',
    'images',
    'condition',
    'category',
    'aspect',
    'aspects',
    'item specific',
    'item_specific',
  ].some((token) => text.includes(token));
}

function getPublishValidationScope(error: PublishListingError): PublishValidationScope | undefined {
  if (error.code === 'APP_SETTINGS_NOT_FOUND') {
    return 'app_settings';
  }

  if (error.code === 'LISTING_NOT_READY') {
    const issues = error.context.issues ?? [];
    const hasListingIssue = issues.some((issue) => mentionsListingPayloadField(asLowerText(issue)));
    if (hasListingIssue) {
      return 'listing';
    }

    const hasAppSettingsIssue = issues.some((issue) => asLowerText(issue).includes('app_settings.'));
    return hasAppSettingsIssue ? 'app_settings' : 'unknown';
  }

  return undefined;
}

function isInventoryRequestValidationError(error: EbayApiErrorEntry): boolean {
  return asLowerText(error.domain) === 'api_inventory' && asLowerText(error.category) === 'request';
}

function getValidationText(error: EbayApiErrorEntry): string {
  const parameterText = (error.parameters ?? [])
    .flatMap((parameter) => [parameter.name, parameter.value])
    .join(' ');

  return [error.message, error.longMessage, parameterText].filter(Boolean).join(' ').toLowerCase();
}

function getUserFixableInventoryValidationErrors(
  error: PublishListingError
): EbayApiErrorEntry[] {
  const ebayErrors = error.context.ebayErrors ?? [];

  return ebayErrors.filter((entry) => {
    if (!isInventoryRequestValidationError(entry)) {
      return false;
    }

    const text = getValidationText(entry);

    if (entry.errorId === 25718 && text.includes('title')) {
      return true;
    }

    return mentionsListingPayloadField(text);
  });
}

function isUserFixableInventoryValidationError(error: PublishListingError): boolean {
  if (getUserFixableInventoryValidationErrors(error).length > 0) {
    return true;
  }

  const message = [error.message, error.context.causeMessage].filter(Boolean).join(' ').toLowerCase();
  return (
    message.includes('invalid value for title') ||
    (message.includes('title') && message.includes('length should be between 1 and 80'))
  );
}

export function classifyJobError(jobType: JobRow['job_type'], error: unknown): SidecarJobError {
  if (error instanceof SidecarJobError) {
    return error;
  }

  if (jobType === 'publish') {
    if (error instanceof PublishListingError) {
      const validationScope = getPublishValidationScope(error);
      const userFixableInventoryErrors = getUserFixableInventoryValidationErrors(error);
      const category: JobErrorCategory =
        error.code === 'EXPORT_STATE_PERSIST_FAILED' || error.code === 'LISTING_NOT_FOUND'
          ? 'terminal'
          : error.code === 'LISTING_NOT_READY' ||
              error.code === 'APP_SETTINGS_NOT_FOUND' ||
              isUserFixableInventoryValidationError(error)
            ? 'user_fixable'
            : 'recoverable';

      return new SidecarJobError(
        getPublishJobErrorCode(error.code),
        category,
        error.message,
        Object.fromEntries(
          Object.entries({
            ...buildBaseContext(error),
            attemptedFields: error.context.attemptedFields,
            causeMessage: error.context.causeMessage,
            issues: error.context.issues,
            listingId: error.context.listingId,
            offerId: error.context.offerId,
            ebayErrors: userFixableInventoryErrors.length > 0 ? userFixableInventoryErrors : error.context.ebayErrors,
            publish_error_code: error.code,
            publishOfferListingId: error.context.publishOfferListingId,
            stage: error.context.stage,
            validation_scope:
              validationScope ??
              (isUserFixableInventoryValidationError(error) ? 'listing' : undefined),
          }).filter(([, value]) => value !== undefined)
        ) as JobErrorContext,
        { cause: error }
      );
    }

    return new SidecarJobError(
      JOB_ERROR_CODES.PUBLISH_FAILED,
      'recoverable',
      asErrorMessage(error),
      buildBaseContext(error),
      {
        cause: error instanceof Error ? error : undefined,
      }
    );
  }

  if (jobType === 'generate_ai') {
    if (error instanceof DailyUsageLimitExceededError) {
      return createDailyUsageGuardrailError(error);
    }

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

export function createManualRetryNotAllowedError(
  message: string,
  context: JobErrorContext = {}
): SidecarJobError {
  return new SidecarJobError(
    JOB_ERROR_CODES.MANUAL_RETRY_NOT_ALLOWED,
    'terminal',
    message,
    context
  );
}

export function createDuplicateActiveJobError(
  workflow: 'generate_ai' | 'publish',
  listingId: string,
  jobId?: string
): SidecarJobError {
  return new SidecarJobError(
    JOB_ERROR_CODES.DUPLICATE_ACTIVE_JOB,
    'recoverable',
    `Listing "${listingId}" already has an active ${workflow} job.`,
    Object.fromEntries(
      Object.entries({
        job_id: jobId,
        listing_id: listingId,
        workflow,
      }).filter(([, value]) => value !== undefined)
    ) as JobErrorContext
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

export function createOrphanActiveStateError(
  workflow: 'generate_ai' | 'publish',
  listing: Pick<ListingRow, 'listing_id' | 'status' | 'sub_status'>,
  latestJobState: 'failed' | 'missing'
): SidecarJobError {
  return new SidecarJobError(
    JOB_ERROR_CODES.ORPHAN_ACTIVE_STATE,
    'recoverable',
    `Listing "${listing.listing_id}" was repaired from orphan ${workflow} state "${listing.status}/${listing.sub_status}".`,
    {
      latest_job_state: latestJobState,
      listing_id: listing.listing_id,
      repaired_from_status: listing.status,
      repaired_from_sub_status: listing.sub_status,
      workflow,
    }
  );
}

export function getStoredJobErrorCategory(
  code: string | null | undefined,
  context?: StoredErrorContext
): StoredJobErrorCategory {
  if (!code || !isKnownJobErrorCode(code)) {
    return 'unknown';
  }

  if (code === JOB_ERROR_CODES.RETRY_EXHAUSTED) {
    return getContextCategory(context, 'source_category') ?? 'terminal';
  }

  return getContextCategory(context, 'category') ?? getDefaultStoredErrorCategory(code);
}

export function isManualRetryAllowedStoredError(
  code: string | null | undefined,
  context?: StoredErrorContext
): boolean {
  const category = getStoredJobErrorCategory(code, context);
  return category === 'recoverable' || category === 'user_fixable';
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
