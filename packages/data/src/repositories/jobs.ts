// cSpell:ignore Supabase
import type { JobInsert, JobRow, JobUpdate } from '../database.js';
import type { SupabaseDataClient } from '../client.js';
import {
  requireOptionalResult,
  requireSingleResult,
  type MultiResult,
  type SingleResult,
} from './shared.js';

const GENERATE_AI_JOB_TYPE = 'generate_ai';
const PUBLISH_JOB_TYPE = 'publish';
const PROCESS_IMAGES_JOB_TYPE = 'process_images';
const GENERATE_AI_ACTIVE_JOB_STATUSES = ['queued', 'running'] as const;
const PUBLISH_ACTIVE_JOB_STATUSES = ['queued', 'running'] as const;
const PROCESS_IMAGES_ACTIVE_JOB_STATUSES = ['queued', 'running'] as const;
const ACTIVE_GENERATE_AI_JOB_UNIQUE_INDEX = 'jobs_generate_ai_active_listing_idx';
const ACTIVE_PUBLISH_JOB_UNIQUE_INDEX = 'jobs_publish_active_listing_idx';
const ACTIVE_PROCESS_IMAGES_JOB_UNIQUE_INDEX = 'jobs_process_images_active_batch_idx';
const POSTGRES_UNIQUE_VIOLATION_CODE = '23505';

interface SupabaseErrorWithCode {
  code?: string;
  message: string;
}

export interface EnqueueGenerateAiJobResult {
  alreadyQueued: boolean;
  job: JobRow;
}

export interface EnqueueProcessImagesJobResult {
  alreadyQueued: boolean;
  job: JobRow;
}

export interface EnqueuePublishJobResult {
  alreadyQueued: boolean;
  job: JobRow;
}

export interface ListDueQueuedJobsOptions {
  limit?: number;
}

export interface JobErrorUpdateInput {
  errorAt: string;
  errorCode: string;
  errorMessage: string;
}

function isSupabaseErrorWithCode(value: unknown): value is SupabaseErrorWithCode {
  return typeof value === 'object' && value !== null && 'message' in value;
}

function isActiveGenerateAiConflict(error: unknown): error is SupabaseErrorWithCode {
  return (
    isSupabaseErrorWithCode(error) &&
    error.code === POSTGRES_UNIQUE_VIOLATION_CODE &&
    error.message.includes(ACTIVE_GENERATE_AI_JOB_UNIQUE_INDEX)
  );
}

function isActiveProcessImagesConflict(error: unknown): error is SupabaseErrorWithCode {
  return (
    isSupabaseErrorWithCode(error) &&
    error.code === POSTGRES_UNIQUE_VIOLATION_CODE &&
    error.message.includes(ACTIVE_PROCESS_IMAGES_JOB_UNIQUE_INDEX)
  );
}

function isActivePublishConflict(error: unknown): error is SupabaseErrorWithCode {
  return (
    isSupabaseErrorWithCode(error) &&
    error.code === POSTGRES_UNIQUE_VIOLATION_CODE &&
    error.message.includes(ACTIVE_PUBLISH_JOB_UNIQUE_INDEX)
  );
}

export async function createJob(client: SupabaseDataClient, input: JobInsert): Promise<JobRow> {
  const result = (await client
    .from('jobs')
    .insert(input)
    .select()
    .single()) as SingleResult<JobRow>;

  return requireSingleResult(result, 'Job was not created.');
}

export async function getActiveGenerateAiJobByListingId(
  client: SupabaseDataClient,
  listingId: string
): Promise<JobRow | null> {
  const result = (await client
    .from('jobs')
    .select('*')
    .eq('listing_id', listingId)
    .eq('job_type', GENERATE_AI_JOB_TYPE)
    .in('status', [...GENERATE_AI_ACTIVE_JOB_STATUSES])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()) as SingleResult<JobRow>;

  return requireOptionalResult(result);
}

export async function enqueueGenerateAiJob(
  client: SupabaseDataClient,
  listingId: string,
  maxAttempts = 3
): Promise<EnqueueGenerateAiJobResult> {
  const insertResult = (await client
    .from('jobs')
    .insert({
      job_type: GENERATE_AI_JOB_TYPE,
      listing_id: listingId,
      max_attempts: maxAttempts,
      status: 'queued',
    })
    .select()
    .single()) as SingleResult<JobRow>;

  if (!insertResult.error) {
    return {
      alreadyQueued: false,
      job: requireSingleResult(insertResult, 'generate_ai job was not created.'),
    };
  }

  if (isActiveGenerateAiConflict(insertResult.error)) {
    const existingJob = await getActiveGenerateAiJobByListingId(client, listingId);

    if (existingJob) {
      return {
        alreadyQueued: true,
        job: existingJob,
      };
    }
  }

  throw new Error(insertResult.error.message);
}

async function getActivePublishJobByListingId(
  client: SupabaseDataClient,
  listingId: string
): Promise<JobRow | null> {
  const result = (await client
    .from('jobs')
    .select('*')
    .eq('listing_id', listingId)
    .eq('job_type', PUBLISH_JOB_TYPE)
    .in('status', [...PUBLISH_ACTIVE_JOB_STATUSES])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()) as SingleResult<JobRow>;

  return requireOptionalResult(result);
}

export async function enqueuePublishJob(
  client: SupabaseDataClient,
  listingId: string,
  maxAttempts = 3
): Promise<EnqueuePublishJobResult> {
  const insertResult = (await client
    .from('jobs')
    .insert({
      job_type: PUBLISH_JOB_TYPE,
      listing_id: listingId,
      max_attempts: maxAttempts,
      status: 'queued',
    })
    .select()
    .single()) as SingleResult<JobRow>;

  if (!insertResult.error) {
    return {
      alreadyQueued: false,
      job: requireSingleResult(insertResult, 'publish job was not created.'),
    };
  }

  if (isActivePublishConflict(insertResult.error)) {
    const existingJob = await getActivePublishJobByListingId(client, listingId);

    if (existingJob) {
      return {
        alreadyQueued: true,
        job: existingJob,
      };
    }
  }

  throw new Error(insertResult.error.message);
}

async function getActiveProcessImagesJob(
  client: SupabaseDataClient
): Promise<JobRow | null> {
  const result = (await client
    .from('jobs')
    .select('*')
    .eq('job_type', PROCESS_IMAGES_JOB_TYPE)
    .is('listing_id', null)
    .in('status', [...PROCESS_IMAGES_ACTIVE_JOB_STATUSES])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()) as SingleResult<JobRow>;

  return requireOptionalResult(result);
}

export async function enqueueProcessImagesJob(
  client: SupabaseDataClient,
  maxAttempts = 2
): Promise<EnqueueProcessImagesJobResult> {
  const insertResult = (await client
    .from('jobs')
    .insert({
      job_type: PROCESS_IMAGES_JOB_TYPE,
      listing_id: null,
      max_attempts: maxAttempts,
      status: 'queued',
    })
    .select()
    .single()) as SingleResult<JobRow>;

  if (!insertResult.error) {
    return {
      alreadyQueued: false,
      job: requireSingleResult(insertResult, 'process_images job was not created.'),
    };
  }

  if (isActiveProcessImagesConflict(insertResult.error)) {
    const existingJob = await getActiveProcessImagesJob(client);

    if (existingJob) {
      return {
        alreadyQueued: true,
        job: existingJob,
      };
    }
  }

  throw new Error(insertResult.error.message);
}

export async function getJobById(
  client: SupabaseDataClient,
  jobId: string
): Promise<JobRow | null> {
  const result = (await client
    .from('jobs')
    .select('*')
    .eq('id', jobId)
    .maybeSingle()) as SingleResult<JobRow>;

  return requireOptionalResult(result);
}

export async function resetJobForManualRetry(
  client: SupabaseDataClient,
  jobId: string,
  now: string
): Promise<JobRow | null> {
  const current = await getJobById(client, jobId);

  if (!current || current.status !== 'failed') {
    return null;
  }

  let query = client
    .from('jobs')
    .update({
      attempts: 0,
      last_error: null,
      last_error_at: null,
      last_error_code: null,
      next_run_at: null,
      status: 'queued',
      updated_at: now,
    })
    .eq('id', jobId)
    .eq('status', 'failed')
    .eq('updated_at', current.updated_at);

  if (current.last_error_code === null) {
    query = query.is('last_error_code', null);
  } else {
    query = query.eq('last_error_code', current.last_error_code);
  }

  const result = (await query
    .select()
    .maybeSingle()) as SingleResult<JobRow>;

  if (!result.error) {
    return result.data ?? null;
  }

  if (
    (current.job_type === GENERATE_AI_JOB_TYPE && isActiveGenerateAiConflict(result.error)) ||
    (current.job_type === PUBLISH_JOB_TYPE && isActivePublishConflict(result.error))
  ) {
    return null;
  }

  throw new Error(result.error.message);
}

export async function listJobsByListingId(
  client: SupabaseDataClient,
  listingId: string
): Promise<JobRow[]> {
  const result = (await client
    .from('jobs')
    .select('*')
    .eq('listing_id', listingId)) as MultiResult<JobRow>;

  if (result.error) {
    throw new Error(result.error.message);
  }

  return result.data ?? [];
}

export async function listJobsByListingIds(
  client: SupabaseDataClient,
  listingIds: string[]
): Promise<JobRow[]> {
  if (listingIds.length === 0) {
    return [];
  }

  const result = (await client
    .from('jobs')
    .select('*')
    .in('listing_id', listingIds)) as MultiResult<JobRow>;

  if (result.error) {
    throw new Error(result.error.message);
  }

  return result.data ?? [];
}

export async function listDueQueuedJobs(
  client: SupabaseDataClient,
  now: string,
  options: ListDueQueuedJobsOptions = {}
): Promise<JobRow[]> {
  const limit = options.limit ?? 1;
  const result = (await client
    .from('jobs')
    .select('*')
    .eq('status', 'queued')
    .or(`next_run_at.is.null,next_run_at.lte.${now}`)
    .order('created_at', { ascending: true })
    .limit(limit)) as MultiResult<JobRow>;

  if (result.error) {
    throw new Error(result.error.message);
  }

  return result.data ?? [];
}


export async function claimDueQueuedJob(
  client: SupabaseDataClient,
  jobId: string,
  now: string
): Promise<JobRow | null> {
  const currentResult = (await client
    .from('jobs')
    .select('*')
    .eq('id', jobId)
    .eq('status', 'queued')
    .or(`next_run_at.is.null,next_run_at.lte.${now}`)
    .maybeSingle()) as SingleResult<JobRow>;

  const current = requireOptionalResult(currentResult);

  if (!current) {
    return null;
  }

  let query = client
    .from('jobs')
    .update({
      attempts: current.attempts + 1,
      next_run_at: null,
      status: 'running',
    })
    .eq('id', jobId)
    .eq('status', 'queued')
    .eq('attempts', current.attempts);

  query =
    current.next_run_at === null
      ? query.is('next_run_at', null)
      : query.eq('next_run_at', current.next_run_at);

  const result = (await query
    .select()
    .maybeSingle()) as SingleResult<JobRow>;

  return requireOptionalResult(result);
}

export async function listStaleRunningJobs(
  client: SupabaseDataClient,
  cutoff: string
): Promise<JobRow[]> {
  const result = (await client
    .from('jobs')
    .select('*')
    .eq('status', 'running')
    .lt('updated_at', cutoff)
    .order('updated_at', { ascending: true })) as MultiResult<JobRow>;

  if (result.error) {
    throw new Error(result.error.message);
  }

  return result.data ?? [];
}

export async function requeueJob(
  client: SupabaseDataClient,
  jobId: string,
  error: JobErrorUpdateInput,
  nextRunAt: string
): Promise<JobRow> {
  return await updateJob(client, jobId, {
    last_error: error.errorMessage,
    last_error_at: error.errorAt,
    last_error_code: error.errorCode,
    next_run_at: nextRunAt,
    status: 'queued',
  });
}

export async function failJob(
  client: SupabaseDataClient,
  jobId: string,
  error: JobErrorUpdateInput
): Promise<JobRow> {
  return await updateJob(client, jobId, {
    last_error: error.errorMessage,
    last_error_at: error.errorAt,
    last_error_code: error.errorCode,
    next_run_at: null,
    status: 'failed',
  });
}

export async function completeJob(
  client: SupabaseDataClient,
  jobId: string
): Promise<JobRow> {
  return await updateJob(client, jobId, {
    last_error: null,
    last_error_at: null,
    last_error_code: null,
    next_run_at: null,
    status: 'completed',
  });
}

export async function updateJob(
  client: SupabaseDataClient,
  jobId: string,
  changes: JobUpdate
): Promise<JobRow> {
  const result = (await client
    .from('jobs')
    .update(changes)
    .eq('id', jobId)
    .select()
    .single()) as SingleResult<JobRow>;

  return requireSingleResult(result, `Job "${jobId}" was not updated.`);
}
