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
const PROCESS_IMAGES_JOB_TYPE = 'process_images';
const GENERATE_AI_ACTIVE_JOB_STATUSES = ['queued', 'running'] as const;
const PROCESS_IMAGES_ACTIVE_JOB_STATUSES = ['queued', 'running'] as const;
const ACTIVE_GENERATE_AI_JOB_UNIQUE_INDEX = 'jobs_generate_ai_active_listing_idx';
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
  listingId: string
): Promise<EnqueueGenerateAiJobResult> {
  const insertResult = (await client
    .from('jobs')
    .insert({
      job_type: GENERATE_AI_JOB_TYPE,
      listing_id: listingId,
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
  client: SupabaseDataClient
): Promise<EnqueueProcessImagesJobResult> {
  const insertResult = (await client
    .from('jobs')
    .insert({
      job_type: PROCESS_IMAGES_JOB_TYPE,
      listing_id: null,
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
