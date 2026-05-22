import type { JobRow, ListingRow, ListingUpdate } from '@ebay-inventory/data';
import { aspectValueSchema, generateListingDraft, type GenerateListingDraftInput } from '@/gemini/index.js';
import { getSidecarDataAccess, type SidecarDataAccess } from '@/data/sidecar-data.js';
import {
  prepareRecordCreatedListings,
  type PrepareRecordCreatedListingsResult,
} from './prepare-record-created-listings.js';

const GENERATE_AI_JOB_TYPE = 'generate_ai';
const PROCESS_IMAGES_JOB_TYPE = 'process_images';
const JOB_STATUS_RUNNING = 'running';
const JOB_STATUS_COMPLETED = 'completed';
const JOB_STATUS_FAILED = 'failed';
const LISTING_ERROR_CODE_GENERATE_AI_FAILED = 'generate_ai_failed';
const LISTING_ERROR_CODE_MISSING_IMAGE_URLS = 'generate_ai_missing_image_urls';
const JOB_ERROR_CODE_PROCESS_IMAGES_FAILED = 'process_images_failed';
const JOB_ERROR_CODE_UNSUPPORTED_JOB_TYPE = 'unsupported_job_type';
const JOB_ERROR_CODE_MISSING_LISTING_ID = 'generate_ai_missing_listing_id';
const JOB_ERROR_CODE_LISTING_NOT_FOUND = 'generate_ai_listing_not_found';
const JOB_ERROR_CODE_LISTING_NOT_ELIGIBLE = 'generate_ai_listing_not_eligible';
const JOB_ERROR_CODE_MISSING_IMAGE_URLS = 'generate_ai_missing_image_urls';
const CATEGORY_SUGGESTION_ASPECT_KEY = 'CategorySuggestion';
const CONDITION_SUGGESTION_ASPECT_KEY = 'ConditionSuggestion';

type GenerateListingDraftFn = (
  input: GenerateListingDraftInput
) => ReturnType<typeof generateListingDraft>;
type PrepareRecordCreatedListingsFn = (
  options?: Parameters<typeof prepareRecordCreatedListings>[0]
) => Promise<PrepareRecordCreatedListingsResult>;

export interface RunSidecarJobOptions {
  dataAccess?: SidecarDataAccess;
  generateListingDraft?: GenerateListingDraftFn;
  now?: () => Date;
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
}

class SidecarJobError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SidecarJobError';
    this.code = code;
  }
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
  draft: Awaited<ReturnType<typeof generateListingDraft>>
): ListingUpdate {
  return {
    description: draft.description,
    item_specifics: buildGeneratedListingAspects(draft),
    last_error_at: null,
    last_error_code: null,
    price: draft.priceSuggestion ?? null,
    status: 'needs_review',
    sub_status: 'review_pending',
    title: draft.title,
  };
}

function buildRetryableFailureUpdate(errorCode: string, errorAt: string): ListingUpdate {
  return {
    last_error_at: errorAt,
    last_error_code: errorCode,
    status: 'assets_ready',
    sub_status: 'ready_to_generate',
  };
}

function appendCleanupFailure(message: string, cleanupError: unknown): string {
  const cleanupMessage =
    cleanupError instanceof Error ? cleanupError.message : 'Unknown cleanup error';

  return `${message} Cleanup also failed: ${cleanupMessage}`;
}

async function markJobRunning(dataAccess: SidecarDataAccess, jobId: string): Promise<void> {
  await dataAccess.jobs.update(jobId, {
    last_error: null,
    last_error_at: null,
    last_error_code: null,
    status: JOB_STATUS_RUNNING,
  });
}

async function markJobFailed(
  dataAccess: SidecarDataAccess,
  jobId: string,
  errorCode: string,
  errorMessage: string,
  errorAt: string
): Promise<JobRow> {
  return await dataAccess.jobs.update(jobId, {
    last_error: errorMessage,
    last_error_at: errorAt,
    last_error_code: errorCode,
    status: JOB_STATUS_FAILED,
  });
}

async function markJobCompleted(
  dataAccess: SidecarDataAccess,
  jobId: string
): Promise<JobRow> {
  return await dataAccess.jobs.update(jobId, {
    last_error: null,
    last_error_at: null,
    last_error_code: null,
    status: JOB_STATUS_COMPLETED,
  });
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

function toSidecarJobError(error: unknown): SidecarJobError {
  if (error instanceof SidecarJobError) {
    return error;
  }

  const message = error instanceof Error ? error.message : 'Unknown error';
  return new SidecarJobError(LISTING_ERROR_CODE_GENERATE_AI_FAILED, message, {
    cause: error instanceof Error ? error : undefined,
  });
}

async function runGenerateAiJob(
  job: JobRow,
  options: Required<Pick<RunSidecarJobOptions, 'dataAccess' | 'generateListingDraft' | 'now'>>
): Promise<RunSidecarJobResult> {
  const listingId = asNonEmptyString(job.listing_id);
  const errorAt = asIsoTimestamp(options.now);

  if (!listingId) {
    const failedJob = await markJobFailed(
      options.dataAccess,
      job.id,
      JOB_ERROR_CODE_MISSING_LISTING_ID,
      `Job "${job.id}" is missing listing_id and cannot run generate_ai.`,
      errorAt
    );

    return {
      job: failedJob,
      listing: null,
    };
  }

  const listing = await options.dataAccess.listings.getByListingId(listingId);

  if (!listing) {
    const failedJob = await markJobFailed(
      options.dataAccess,
      job.id,
      JOB_ERROR_CODE_LISTING_NOT_FOUND,
      `Listing "${listingId}" was not found for generate_ai.`,
      errorAt
    );

    return {
      job: failedJob,
      listing: null,
    };
  }

  if (listing.status !== 'assets_ready') {
    const failedJob = await markJobFailed(
      options.dataAccess,
      job.id,
      JOB_ERROR_CODE_LISTING_NOT_ELIGIBLE,
      `Listing "${listingId}" is not eligible for generate_ai from status "${listing.status}".`,
      errorAt
    );

    return {
      job: failedJob,
      listing,
    };
  }

  const imageUrls = getListingImageUrls(listing);

  if (imageUrls.length === 0) {
    let errorMessage = `Listing "${listingId}" does not have any image URLs for generate_ai.`;

    try {
      await options.dataAccess.listings.update(listingId, {
        last_error_at: errorAt,
        last_error_code: LISTING_ERROR_CODE_MISSING_IMAGE_URLS,
      });
    } catch (error) {
      errorMessage = appendCleanupFailure(errorMessage, error);
    }

    const failedJob = await markJobFailed(
      options.dataAccess,
      job.id,
      JOB_ERROR_CODE_MISSING_IMAGE_URLS,
      errorMessage,
      errorAt
    );

    return {
      job: failedJob,
      listing: await getListingSafely(options.dataAccess, listingId),
    };
  }

  let generationStarted = false;

  try {
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
      buildGeneratedListingReviewUpdate(draft)
    );
    const completedJob = await markJobCompleted(options.dataAccess, job.id);

    return {
      job: completedJob,
      listing: reviewListing,
    };
  } catch (error) {
    const jobError = toSidecarJobError(error);
    let jobErrorMessage = jobError.message;

    if (generationStarted) {
      try {
        await options.dataAccess.listings.update(
          listingId,
          buildRetryableFailureUpdate(jobError.code, errorAt)
        );
      } catch (cleanupError) {
        jobErrorMessage = appendCleanupFailure(jobErrorMessage, cleanupError);
      }
    }

    const failedJob = await markJobFailed(
      options.dataAccess,
      job.id,
      jobError.code,
      jobErrorMessage,
      errorAt
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
    const completedJob = await markJobCompleted(options.dataAccess, job.id);

    return {
      assetPrepSummary: buildAssetPrepSummary(result),
      job: completedJob,
      listing: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failedJob = await markJobFailed(
      options.dataAccess,
      job.id,
      JOB_ERROR_CODE_PROCESS_IMAGES_FAILED,
      message,
      errorAt
    );

    return {
      job: failedJob,
      listing: null,
    };
  }
}

export async function runSidecarJob(
  jobId: string,
  options: RunSidecarJobOptions = {}
): Promise<RunSidecarJobResult> {
  const dataAccess = options.dataAccess ?? getSidecarDataAccess();
  const runGenerateDraft = options.generateListingDraft ?? generateListingDraft;
  const runPrepareRecordCreatedListings =
    options.prepareRecordCreatedListings ?? prepareRecordCreatedListings;
  const now = options.now ?? (() => new Date());
  const job = await dataAccess.jobs.getById(jobId);

  if (!job) {
    throw new SidecarJobError('job_not_found', `Job "${jobId}" was not found.`);
  }

  await markJobRunning(dataAccess, job.id);

  switch (job.job_type) {
    case GENERATE_AI_JOB_TYPE:
      return await runGenerateAiJob(job, {
        dataAccess,
        generateListingDraft: runGenerateDraft,
        now,
      });
    case PROCESS_IMAGES_JOB_TYPE:
      return await runProcessImagesJob(job, {
        dataAccess,
        now,
        prepareRecordCreatedListings: runPrepareRecordCreatedListings,
      });
    default: {
      const errorAt = asIsoTimestamp(now);
      const failedJob = await markJobFailed(
        dataAccess,
        job.id,
        JOB_ERROR_CODE_UNSUPPORTED_JOB_TYPE,
        `Job "${job.id}" has unsupported type "${job.job_type}".`,
        errorAt
      );

      return {
        job: failedJob,
        listing: null,
      };
    }
  }
}
