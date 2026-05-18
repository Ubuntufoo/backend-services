import type { JobInsert, JobRow, JobUpdate } from '../database.js';
import type { SupabaseDataClient } from '../client.js';
import {
  requireOptionalResult,
  requireSingleResult,
  type MultiResult,
  type SingleResult,
} from './shared.js';

export async function createJob(client: SupabaseDataClient, input: JobInsert): Promise<JobRow> {
  const result = (await client.from('jobs').insert(input).select().single()) as SingleResult<JobRow>;

  return requireSingleResult(result, 'Job was not created.');
}

export async function getJobById(client: SupabaseDataClient, jobId: string): Promise<JobRow | null> {
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
