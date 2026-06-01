import type {
  AiModelAttemptInsert,
  AiModelAttemptRow,
  AiModelAttemptUpdate,
  Json,
} from '../database.js';
import type { SupabaseDataClient } from '../client.js';
import { requireSingleResult, type MultiResult, type SingleResult } from './shared.js';

export type AiModelAttemptStatus = 'started' | 'succeeded' | 'failed' | 'skipped';
export type AiModelAttemptMetadata = Record<string, Json | undefined>;

export interface CreateAiModelAttemptInput {
  attempt_order?: number;
  job_id?: string | null;
  listing_id: string;
  metadata?: AiModelAttemptMetadata;
  model_name: string;
  provider: string;
  provider_model_id?: string | null;
  routing_source?: string | null;
  started_at?: string;
  status?: AiModelAttemptStatus;
}

export interface MarkAiModelAttemptSucceededInput {
  finished_at: string;
  id: string;
  duration_ms?: number | null;
  metadata?: AiModelAttemptMetadata;
}

export interface MarkAiModelAttemptFailedInput {
  failure_code?: string | null;
  failure_message?: string | null;
  finished_at: string;
  id: string;
  duration_ms?: number | null;
  metadata?: AiModelAttemptMetadata;
}

interface AttemptOrderRow {
  attempt_order: number;
}

function withOptionalMetadata<TUpdate extends { metadata?: Json }>(
  changes: TUpdate,
  metadata: AiModelAttemptMetadata | undefined
): TUpdate {
  if (metadata === undefined) {
    return changes;
  }

  return {
    ...changes,
    metadata: metadata as Json,
  };
}

async function getNextAiModelAttemptOrder(
  client: SupabaseDataClient,
  listingId: string,
  jobId: string | null
): Promise<number> {
  let query = client
    .from('ai_model_attempts')
    .select('attempt_order')
    .eq('listing_id', listingId);

  query = jobId === null ? query.is('job_id', null) : query.eq('job_id', jobId);

  const result = (await query
    .order('attempt_order', { ascending: false })
    .limit(1)) as MultiResult<AttemptOrderRow>;

  if (result.error) {
    throw new Error(result.error.message);
  }

  const current = result.data?.[0]?.attempt_order ?? 0;
  return current + 1;
}

export async function createAiModelAttempt(
  client: SupabaseDataClient,
  input: CreateAiModelAttemptInput
): Promise<AiModelAttemptRow> {
  const attemptOrder =
    input.attempt_order ??
    (await getNextAiModelAttemptOrder(client, input.listing_id, input.job_id ?? null));

  const insert: AiModelAttemptInsert = {
    attempt_order: attemptOrder,
    job_id: input.job_id ?? null,
    listing_id: input.listing_id,
    metadata: (input.metadata ?? {}) as Json,
    model_name: input.model_name,
    provider: input.provider,
    provider_model_id: input.provider_model_id ?? null,
    routing_source: input.routing_source ?? null,
    started_at: input.started_at,
    status: input.status ?? 'started',
  };

  const result = (await client
    .from('ai_model_attempts')
    .insert(insert)
    .select()
    .single()) as SingleResult<AiModelAttemptRow>;

  return requireSingleResult(result, 'AI model attempt was not created.');
}

export async function markAiModelAttemptSucceeded(
  client: SupabaseDataClient,
  input: MarkAiModelAttemptSucceededInput
): Promise<AiModelAttemptRow> {
  const changes = withOptionalMetadata<AiModelAttemptUpdate>(
    {
      duration_ms: input.duration_ms ?? null,
      finished_at: input.finished_at,
      status: 'succeeded',
    },
    input.metadata
  );

  const result = (await client
    .from('ai_model_attempts')
    .update(changes)
    .eq('id', input.id)
    .select()
    .single()) as SingleResult<AiModelAttemptRow>;

  return requireSingleResult(result, `AI model attempt "${input.id}" was not marked succeeded.`);
}

export async function markAiModelAttemptFailed(
  client: SupabaseDataClient,
  input: MarkAiModelAttemptFailedInput
): Promise<AiModelAttemptRow> {
  const changes = withOptionalMetadata<AiModelAttemptUpdate>(
    {
      duration_ms: input.duration_ms ?? null,
      failure_code: input.failure_code ?? null,
      failure_message: input.failure_message ?? null,
      finished_at: input.finished_at,
      status: 'failed',
    },
    input.metadata
  );

  const result = (await client
    .from('ai_model_attempts')
    .update(changes)
    .eq('id', input.id)
    .select()
    .single()) as SingleResult<AiModelAttemptRow>;

  return requireSingleResult(result, `AI model attempt "${input.id}" was not marked failed.`);
}

export async function listAiModelAttemptsForListing(
  client: SupabaseDataClient,
  listingId: string
): Promise<AiModelAttemptRow[]> {
  const result = (await client
    .from('ai_model_attempts')
    .select('*')
    .eq('listing_id', listingId)
    .order('attempt_order', { ascending: true })
    .order('created_at', { ascending: true })) as MultiResult<AiModelAttemptRow>;

  if (result.error) {
    throw new Error(result.error.message);
  }

  return result.data ?? [];
}
