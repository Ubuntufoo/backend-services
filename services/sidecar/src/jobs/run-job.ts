import type {
  GeminiJobAttemptAuditUpdate,
  GeminiModelAttempt,
  JobRow,
  ListingRow,
  ListingUpdate,
} from '@ebay-inventory/data';
import {
  aspectValueSchema,
  generateListingDraft,
  getConfiguredGeminiModelName,
  resolveTradingCardListingIds,
  type GenerateListingDraftInput,
} from '@/gemini/index.js';
import { getSidecarDataAccess, type SidecarDataAccess } from '@/data/sidecar-data.js';
import {
  publishListing as publishApprovedListing,
  type PublishListingDependencies,
  type PublishListingResult,
} from '@/ebay/publish-listing.js';
import {
  classifyJobError,
  createRetryExhaustedError,
  JOB_ERROR_CODES,
  SidecarJobError,
  toJobErrorUpdateInput,
  toListingErrorContext,
} from './job-errors.js';
import {
  prepareRecordCreatedListings,
  type PrepareRecordCreatedListingsResult,
} from './prepare-record-created-listings.js';
import { getNextRetryAt, hasAttemptsRemaining } from './retry-policy.js';

const GENERATE_AI_JOB_TYPE = 'generate_ai';
const PUBLISH_JOB_TYPE = 'publish';
const PROCESS_IMAGES_JOB_TYPE = 'process_images';
const JOB_STATUS_RUNNING = 'running';
const CATEGORY_SUGGESTION_ASPECT_KEY = 'CategorySuggestion';
const CONDITION_SUGGESTION_ASPECT_KEY = 'ConditionSuggestion';

type GenerateListingDraftFn = (
  input: GenerateListingDraftInput
) => ReturnType<typeof generateListingDraft>;
type PublishListingFn = (
  listingId: string,
  dependencies?: Partial<PublishListingDependencies>
) => Promise<PublishListingResult>;
type PrepareRecordCreatedListingsFn = (
  options?: Parameters<typeof prepareRecordCreatedListings>[0]
) => Promise<PrepareRecordCreatedListingsResult>;

export interface RunSidecarJobOptions {
  dataAccess?: SidecarDataAccess;
  generateListingDraft?: GenerateListingDraftFn;
  now?: () => Date;
  publishListing?: PublishListingFn;
  prepareRecordCreatedListings?: PrepareRecordCreatedListingsFn;
}

export interface AssetPrepSummary {
  exhaustedCandidates: boolean;
  failedCount: number;
  processedCount: number;
  skippedCount: number;
}

export interface RunSidecarJobResult {
  assetPrepSummary?: AssetPrepSummary;
  job: JobRow;
  listing: ListingRow | null;
  processedListings?: ListingRow[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asIsoTimestamp(now: () => Date): string {
  return now().toISOString();
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getListingImageUrls(listing: ListingRow): string[] {
  return listing.image_urls
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function getListingPriceHint(listing: ListingRow): number | undefined {
  return typeof listing.price === 'number' && Number.isFinite(listing.price)
    ? listing.price
    : undefined;
}

function getListingAspectHints(
  listing: ListingRow
): NonNullable<GenerateListingDraftInput['userHints']>['aspects'] | undefined {
  if (!isRecord(listing.item_specifics)) {
    return undefined;
  }

  const aspects = Object.fromEntries(
    Object.entries(listing.item_specifics).flatMap(([key, value]) => {
      const parsed = aspectValueSchema.safeParse(value);
      return parsed.success ? [[key, parsed.data]] : [];
    })
  );

  return Object.keys(aspects).length > 0 ? aspects : undefined;
}

function getListingNotesHint(listing: ListingRow): string | undefined {
  const sections = [
    asNonEmptyString(listing.seller_hints),
    asNonEmptyString(listing.condition_notes),
  ].filter((value): value is string => value !== undefined);

  return sections.length > 0 ? sections.join('\n\n') : undefined;
}

function buildUserHints(listing: ListingRow): GenerateListingDraftInput['userHints'] | undefined {
  const title = asNonEmptyString(listing.title);
  const notes = getListingNotesHint(listing);
  const aspects = getListingAspectHints(listing);
  const price = getListingPriceHint(listing);

  if (!title && !notes && !aspects && price === undefined) {
    return undefined;
  }

  return {
    aspects,
    notes,
    price,
    title,
  };
}

function buildGeneratedListingAspects(
  draft: Awaited<ReturnType<typeof generateListingDraft>>
): NonNullable<ListingUpdate['item_specifics']> {
  return {
    ...draft.aspects,
    ...(draft.categorySuggestion
      ? { [CATEGORY_SUGGESTION_ASPECT_KEY]: draft.categorySuggestion }
      : {}),
    ...(draft.conditionSuggestion
      ? { [CONDITION_SUGGESTION_ASPECT_KEY]: draft.conditionSuggestion }
      : {}),
  };
}

function buildGeneratedListingReviewUpdate(
  listing: ListingRow,
  draft: Awaited<ReturnType<typeof generateListingDraft>>
): ListingUpdate {
  const resolvedIds = resolveTradingCardListingIds(listing, draft);

  return {
    category_id: resolvedIds.category_id,
    condition_id: resolvedIds.condition_id,
    description: draft.description,
    item_specifics: buildGeneratedListingAspects(draft),
    last_error_at: null,
    last_error_code: null,
    last_error_context: {},
    last_error_message: null,
    price: draft.priceSuggestion ?? null,
    status: 'needs_review',
    sub_status: 'review_pending',
    title: draft.title,
  };
}

function buildGenerateAiFailureUpdate(error: SidecarJobError, errorAt: string): ListingUpdate {
  return {
    last_error_at: errorAt,
    last_error_code: error.code,
    last_error_context: toListingErrorContext(error),
    last_error_message: error.message,
    status: 'assets_ready',
    sub_status: 'ready_to_generate',
  };
}

function buildPublishFailureUpdate(
  error: SidecarJobError,
  errorAt: string,
  subStatus: 'idle' | 'publish_queued'
): ListingUpdate {
  return {
    last_error_at: errorAt,
    last_error_code: error.code,
    last_error_context: toListingErrorContext(error),
    last_error_message: error.message,
    status: 'approved_for_export',
    sub_status: subStatus,
  };
}

function appendCleanupFailure(message: string, cleanupError: unknown): string {
  const cleanupMessage =
    cleanupError instanceof Error ? cleanupError.message : 'Unknown cleanup error';

  return `${message} Cleanup also failed: ${cleanupMessage}`;
}

function getDurationMs(startedAt: string, completedAt: string): number {
  return Math.max(0, Date.parse(completedAt) - Date.parse(startedAt));
}

function summarizeGeminiAttemptFailureMessage(message: string): string {
  const normalized = message.replace(/\s+/g, ' ').trim();

  if (normalized.length <= 240) {
    return normalized;
  }

  return `${normalized.slice(0, 237)}...`;
}

async function persistGeminiAttemptAudit(
  dataAccess: SidecarDataAccess,
  jobId: string,
  audit: GeminiJobAttemptAuditUpdate,
  bestEffort = false
): Promise<void> {
  try {
    await dataAccess.jobs.updateGeminiAttemptAudit(jobId, audit);
  } catch (error) {
    if (!bestEffort) {
      throw error;
    }
  }
}

async function ensureJobRunning(
  dataAccess: SidecarDataAccess,
  job: JobRow,
  now: () => Date
): Promise<JobRow> {
  if (job.status === JOB_STATUS_RUNNING) {
    return job;
  }

  if (job.status === 'queued') {
    const claimedJob = await dataAccess.jobs.claimDueQueued(job.id, asIsoTimestamp(now));

    if (claimedJob) {
      return claimedJob;
    }

    throw new SidecarJobError(
      JOB_ERROR_CODES.JOB_NOT_CLAIMABLE,
      'terminal',
      `Job "${job.id}" is queued but could not be claimed for execution. It may not be due yet or another worker already claimed it.`
    );
  }

  throw new SidecarJobError(
    JOB_ERROR_CODES.JOB_NOT_RUNNABLE,
    'terminal',
    `Job "${job.id}" has status "${job.status}" and cannot be run.`
  );
}

async function getListingSafely(
  dataAccess: SidecarDataAccess,
  listingId: string
): Promise<ListingRow | null> {
  try {
    return await dataAccess.listings.getByListingId(listingId);
  } catch {
    return null;
  }
}

async function hasOtherPublishJobsForListing(
  dataAccess: SidecarDataAccess,
  listingId: string,
  currentJobId: string
): Promise<boolean> {
  const jobs = await dataAccess.jobs.listByListingId(listingId);

  return jobs.some(
    (candidateJob) => candidateJob.job_type === PUBLISH_JOB_TYPE && candidateJob.id !== currentJobId
  );
}

async function runGenerateAiJob(
  job: JobRow,
  options: Required<Pick<RunSidecarJobOptions, 'dataAccess' | 'generateListingDraft' | 'now'>>
): Promise<RunSidecarJobResult> {
  const listingId = asNonEmptyString(job.listing_id);
  const errorAt = asIsoTimestamp(options.now);

  if (!listingId) {
    const error = new SidecarJobError(
      JOB_ERROR_CODES.GENERATE_AI_MISSING_LISTING_ID,
      'terminal',
      `Job "${job.id}" is missing listing_id and cannot run generate_ai.`
    );
    const failedJob = await options.dataAccess.jobs.fail(job.id, toJobErrorUpdateInput(error, errorAt));

    return {
      job: failedJob,
      listing: null,
    };
  }

  const listing = await options.dataAccess.listings.getByListingId(listingId);

  if (!listing) {
    const error = new SidecarJobError(
      JOB_ERROR_CODES.GENERATE_AI_LISTING_NOT_FOUND,
      'terminal',
      `Listing "${listingId}" was not found for generate_ai.`
    );
    const failedJob = await options.dataAccess.jobs.fail(job.id, toJobErrorUpdateInput(error, errorAt));

    return {
      job: failedJob,
      listing: null,
    };
  }

  if (listing.status !== 'assets_ready') {
    const error = new SidecarJobError(
      JOB_ERROR_CODES.GENERATE_AI_LISTING_NOT_ELIGIBLE,
      'user_fixable',
      `Listing "${listingId}" is not eligible for generate_ai from status "${listing.status}".`
    );
    const failedJob = await options.dataAccess.jobs.fail(job.id, toJobErrorUpdateInput(error, errorAt));

    return {
      job: failedJob,
      listing,
    };
  }

  const imageUrls = getListingImageUrls(listing);

  if (imageUrls.length === 0) {
    let listingError = new SidecarJobError(
      JOB_ERROR_CODES.GENERATE_AI_MISSING_IMAGE_URLS,
      'user_fixable',
      `Listing "${listingId}" does not have any image URLs for generate_ai.`
    );

    try {
      await options.dataAccess.listings.update(listingId, buildGenerateAiFailureUpdate(listingError, errorAt));
    } catch (error) {
      listingError = new SidecarJobError(
        listingError.code,
        listingError.category,
        appendCleanupFailure(listingError.message, error),
        listingError.context,
        { cause: listingError }
      );
    }

    const failedJob = await options.dataAccess.jobs.fail(
      job.id,
      toJobErrorUpdateInput(listingError, errorAt)
    );

    return {
      job: failedJob,
      listing: await getListingSafely(options.dataAccess, listingId),
    };
  }

  let generationStarted = false;
  const modelName = getConfiguredGeminiModelName();
  const startedAt = asIsoTimestamp(options.now);
  const startedAttempt: GeminiModelAttempt = {
    attempt_order: 1,
    completed_at: null,
    duration_ms: null,
    failure_code: null,
    failure_message: null,
    model_name: modelName,
    started_at: startedAt,
    status: 'started',
  };

  try {
    await persistGeminiAttemptAudit(options.dataAccess, job.id, {
      gemini_attempt_count: 1,
      gemini_attempts: [startedAttempt],
      gemini_selected_model: null,
    }, true);
    await options.dataAccess.listings.updateWorkflowState({
      listingId,
      status: 'generating',
      subStatus: 'ai_call_in_progress',
    });
    generationStarted = true;

    const draft = await options.generateListingDraft({
      imageUrls,
      listingId,
      userHints: buildUserHints(listing),
    });

    const reviewListing = await options.dataAccess.listings.update(
      listingId,
      buildGeneratedListingReviewUpdate(listing, draft)
    );
    const completedAt = asIsoTimestamp(options.now);
    await persistGeminiAttemptAudit(options.dataAccess, job.id, {
      gemini_attempt_count: 1,
      gemini_attempts: [
        {
          ...startedAttempt,
          completed_at: completedAt,
          duration_ms: getDurationMs(startedAt, completedAt),
          status: 'succeeded',
        },
      ],
      gemini_selected_model: modelName,
    }, true);
    const completedJob = await options.dataAccess.jobs.complete(job.id);

    return {
      job: completedJob,
      listing: reviewListing,
    };
  } catch (error) {
    let jobError = classifyJobError(job.job_type, error);
    const completedAt = asIsoTimestamp(options.now);

    await persistGeminiAttemptAudit(
      options.dataAccess,
      job.id,
      {
        gemini_attempt_count: 1,
        gemini_attempts: [
          {
            ...startedAttempt,
            completed_at: completedAt,
            duration_ms: getDurationMs(startedAt, completedAt),
            failure_code: jobError.code,
            failure_message: summarizeGeminiAttemptFailureMessage(jobError.message),
            status: 'failed',
          },
        ],
        gemini_selected_model: null,
      },
      true
    );

    if (generationStarted) {
      try {
        await options.dataAccess.listings.update(
          listingId,
          buildGenerateAiFailureUpdate(jobError, errorAt)
        );
      } catch (cleanupError) {
        jobError = new SidecarJobError(
          jobError.code,
          jobError.category,
          appendCleanupFailure(jobError.message, cleanupError),
          jobError.context,
          { cause: jobError }
        );
      }
    }

    if (jobError.category === 'recoverable' && hasAttemptsRemaining(job)) {
      const requeuedJob = await options.dataAccess.jobs.requeue(
        job.id,
        toJobErrorUpdateInput(jobError, errorAt),
        getNextRetryAt(job.attempts, options.now())
      );

      return {
        job: requeuedJob,
        listing: await getListingSafely(options.dataAccess, listingId),
      };
    }

    const finalError =
      jobError.category === 'recoverable' ? createRetryExhaustedError(job, jobError) : jobError;
    const failedJob = await options.dataAccess.jobs.fail(
      job.id,
      toJobErrorUpdateInput(finalError, errorAt)
    );

    return {
      job: failedJob,
      listing: await getListingSafely(options.dataAccess, listingId),
    };
  }
}

function buildAssetPrepSummary(
  result: PrepareRecordCreatedListingsResult
): AssetPrepSummary {
  return {
    exhaustedCandidates: result.exhaustedCandidates,
    failedCount: result.failed.length,
    processedCount: result.processed.length,
    skippedCount: result.skipped.length,
  };
}

async function runProcessImagesJob(
  job: JobRow,
  options: Required<Pick<RunSidecarJobOptions, 'dataAccess' | 'now' | 'prepareRecordCreatedListings'>>
): Promise<RunSidecarJobResult> {
  const errorAt = asIsoTimestamp(options.now);

  try {
    const result = await options.prepareRecordCreatedListings({
      dataAccess: options.dataAccess,
      now: options.now,
    });
    const completedJob = await options.dataAccess.jobs.complete(job.id);

    return {
      assetPrepSummary: buildAssetPrepSummary(result),
      job: completedJob,
      listing: null,
      processedListings: result.processed,
    };
  } catch (error) {
    const jobError = classifyJobError(job.job_type, error);

    if (jobError.category === 'recoverable' && hasAttemptsRemaining(job)) {
      const requeuedJob = await options.dataAccess.jobs.requeue(
        job.id,
        toJobErrorUpdateInput(jobError, errorAt),
        getNextRetryAt(job.attempts, options.now())
      );

      return {
        job: requeuedJob,
        listing: null,
      };
    }

    const finalError =
      jobError.category === 'recoverable' ? createRetryExhaustedError(job, jobError) : jobError;
    const failedJob = await options.dataAccess.jobs.fail(job.id, toJobErrorUpdateInput(finalError, errorAt));

    return {
      job: failedJob,
      listing: null,
    };
  }
}

async function runPublishJob(
  job: JobRow,
  options: Required<Pick<RunSidecarJobOptions, 'dataAccess' | 'now' | 'publishListing'>>
): Promise<RunSidecarJobResult> {
  const listingId = asNonEmptyString(job.listing_id);
  const errorAt = asIsoTimestamp(options.now);

  if (!listingId) {
    const error = new SidecarJobError(
      JOB_ERROR_CODES.PUBLISH_MISSING_LISTING_ID,
      'terminal',
      `Job "${job.id}" is missing listing_id and cannot run publish.`
    );
    const failedJob = await options.dataAccess.jobs.fail(job.id, toJobErrorUpdateInput(error, errorAt));

    return {
      job: failedJob,
      listing: null,
    };
  }

  const listing = await options.dataAccess.listings.getByListingId(listingId);

  if (!listing) {
    const error = new SidecarJobError(
      JOB_ERROR_CODES.PUBLISH_LISTING_NOT_FOUND,
      'terminal',
      `Listing "${listingId}" was not found for publish.`
    );
    const failedJob = await options.dataAccess.jobs.fail(job.id, toJobErrorUpdateInput(error, errorAt));

    return {
      job: failedJob,
      listing: null,
    };
  }

  if (listing.status !== 'approved_for_export') {
    const error = new SidecarJobError(
      JOB_ERROR_CODES.PUBLISH_LISTING_NOT_ELIGIBLE,
      'user_fixable',
      `Listing "${listingId}" is not eligible for publish from status "${listing.status}".`
    );

    await options.dataAccess.listings.update(
      listingId,
      buildPublishFailureUpdate(error, errorAt, 'idle')
    );

    const failedJob = await options.dataAccess.jobs.fail(job.id, toJobErrorUpdateInput(error, errorAt));

    return {
      job: failedJob,
      listing: await getListingSafely(options.dataAccess, listingId),
    };
  }

  if (listing.sub_status === 'idle') {
    const hasOtherPublishJobs = await hasOtherPublishJobsForListing(
      options.dataAccess,
      listingId,
      job.id
    );

    if (hasOtherPublishJobs) {
      const error = new SidecarJobError(
        JOB_ERROR_CODES.JOB_NOT_RUNNABLE,
        'terminal',
        `Publish job "${job.id}" is stale for listing "${listingId}" because another publish job already resolved the listing to approved_for_export/idle.`
      );
      const failedJob = await options.dataAccess.jobs.fail(
        job.id,
        toJobErrorUpdateInput(error, errorAt)
      );

      return {
        job: failedJob,
        listing,
      };
    }
  }

  if (listing.sub_status !== 'publish_queued' && listing.sub_status !== 'publishing_to_ebay') {
    const error = new SidecarJobError(
      JOB_ERROR_CODES.PUBLISH_LISTING_NOT_ELIGIBLE,
      'user_fixable',
      `Listing "${listingId}" is not eligible for publish from sub_status "${listing.sub_status}".`
    );

    await options.dataAccess.listings.update(
      listingId,
      buildPublishFailureUpdate(error, errorAt, 'idle')
    );

    const failedJob = await options.dataAccess.jobs.fail(job.id, toJobErrorUpdateInput(error, errorAt));

    return {
      job: failedJob,
      listing: await getListingSafely(options.dataAccess, listingId),
    };
  }

  if (listing.sub_status === 'publish_queued') {
    const claimedListing = await options.dataAccess.listings.claimApprovedForPublish(listingId);

    if (!claimedListing) {
      const error = new SidecarJobError(
        JOB_ERROR_CODES.PUBLISH_LISTING_NOT_ELIGIBLE,
        'user_fixable',
        `Listing "${listingId}" could not be claimed for publish.`
      );
      const failedJob = await options.dataAccess.jobs.fail(job.id, toJobErrorUpdateInput(error, errorAt));

      return {
        job: failedJob,
        listing: await getListingSafely(options.dataAccess, listingId),
      };
    }
  }

  try {
    await options.publishListing(listingId, {
      dataAccess: options.dataAccess,
      now: options.now,
    });
    const completedJob = await options.dataAccess.jobs.complete(job.id);

    return {
      job: completedJob,
      listing: await getListingSafely(options.dataAccess, listingId),
    };
  } catch (error) {
    const classifiedError = classifyJobError(job.job_type, error);
    const shouldRetry = classifiedError.category === 'recoverable' && hasAttemptsRemaining(job);
    let finalError = shouldRetry
      ? classifiedError
      : classifiedError.category === 'recoverable'
        ? createRetryExhaustedError(job, classifiedError)
        : classifiedError;

    try {
      await options.dataAccess.listings.update(
        listingId,
        buildPublishFailureUpdate(finalError, errorAt, shouldRetry ? 'publish_queued' : 'idle')
      );
    } catch (cleanupError) {
      finalError = new SidecarJobError(
        finalError.code,
        finalError.category,
        appendCleanupFailure(finalError.message, cleanupError),
        finalError.context,
        { cause: finalError }
      );
    }

    if (shouldRetry) {
      const requeuedJob = await options.dataAccess.jobs.requeue(
        job.id,
        toJobErrorUpdateInput(finalError, errorAt),
        getNextRetryAt(job.attempts, options.now())
      );

      return {
        job: requeuedJob,
        listing: await getListingSafely(options.dataAccess, listingId),
      };
    }

    const failedJob = await options.dataAccess.jobs.fail(
      job.id,
      toJobErrorUpdateInput(finalError, errorAt)
    );

    return {
      job: failedJob,
      listing: await getListingSafely(options.dataAccess, listingId),
    };
  }
}

export async function runSidecarJob(
  jobId: string,
  options: RunSidecarJobOptions = {}
): Promise<RunSidecarJobResult> {
  const dataAccess = options.dataAccess ?? getSidecarDataAccess();
  const runGenerateDraft = options.generateListingDraft ?? generateListingDraft;
  const runPublishListing = options.publishListing ?? publishApprovedListing;
  const runPrepareRecordCreatedListings =
    options.prepareRecordCreatedListings ?? prepareRecordCreatedListings;
  const now = options.now ?? (() => new Date());
  const job = await dataAccess.jobs.getById(jobId);

  if (!job) {
    throw new SidecarJobError(JOB_ERROR_CODES.JOB_NOT_FOUND, 'terminal', `Job "${jobId}" was not found.`);
  }

  const runnableJob = await ensureJobRunning(dataAccess, job, now);

  switch (runnableJob.job_type) {
    case GENERATE_AI_JOB_TYPE:
      return await runGenerateAiJob(runnableJob, {
        dataAccess,
        generateListingDraft: runGenerateDraft,
        now,
      });
    case PUBLISH_JOB_TYPE:
      return await runPublishJob(runnableJob, {
        dataAccess,
        now,
        publishListing: runPublishListing,
      });
    case PROCESS_IMAGES_JOB_TYPE:
      return await runProcessImagesJob(runnableJob, {
        dataAccess,
        now,
        prepareRecordCreatedListings: runPrepareRecordCreatedListings,
      });
    default: {
      const errorAt = asIsoTimestamp(now);
      const error = new SidecarJobError(
        JOB_ERROR_CODES.UNSUPPORTED_JOB_TYPE,
        'terminal',
        `Job "${runnableJob.id}" has unsupported type "${runnableJob.job_type}".`
      );
      const failedJob = await dataAccess.jobs.fail(runnableJob.id, toJobErrorUpdateInput(error, errorAt));

      return {
        job: failedJob,
        listing: null,
      };
    }
  }
}
