import type {
  AiModelAttemptInsert,
  AiModelAttemptRow,
  AiModelAttemptUpdate,
  AiModelCatalogRow,
  Json,
} from '../database.js';
import type { SupabaseDataClient } from '../client.js';
import {
  requireOptionalResult,
  requireSingleResult,
  type MultiResult,
  type SingleResult,
} from './shared.js';

export type AiModelAttemptStatus = 'started' | 'succeeded' | 'failed' | 'skipped';
export type AiModelAttemptMetadata = Record<string, Json | undefined>;
const POSTGRES_UNIQUE_VIOLATION_CODE = '23505';
const AI_MODEL_ATTEMPTS_UNIQUE_INDEX = 'ai_model_attempts_listing_job_attempt_order_uidx';
const MAX_CREATE_AI_MODEL_ATTEMPT_RETRIES = 3;
const GEMINI_PROVIDER = 'google';
const GEMINI_GENERATE_AI_JOB_TYPE = 'generate_ai';

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

export interface GeminiUsageLastAttempt {
  display_name: string | null;
  finished_at: string | null;
  model_name: string;
  provider: string;
  started_at: string;
  status: string;
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

interface JoinedCatalogRow extends Pick<AiModelCatalogRow, 'display_name'> {}

interface LatestGeminiUsageAttemptRow
  extends Pick<
    AiModelAttemptRow,
    'finished_at' | 'id' | 'model_name' | 'provider' | 'started_at' | 'status'
  > {
  job: unknown;
}

interface SupabaseErrorWithCode {
  code?: string;
  message: string;
}

function isSupabaseUniqueViolation(error: unknown): error is SupabaseErrorWithCode {
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as SupabaseErrorWithCode).message === 'string' &&
    (error as SupabaseErrorWithCode).code === POSTGRES_UNIQUE_VIOLATION_CODE &&
    (error as SupabaseErrorWithCode).message.includes(AI_MODEL_ATTEMPTS_UNIQUE_INDEX)
  );
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
    metadata,
  };
}

function warnGeminiUsageLookupIssue(message: string, error: unknown, context: Record<string, string>): void {
  console.warn(message, {
    ...context,
    error: error instanceof Error ? error.message : String(error),
  });
}

async function getAiModelCatalogDisplayName(
  client: SupabaseDataClient,
  provider: string,
  modelName: string
): Promise<string | null> {
  try {
    const result = (await client
      .from('ai_model_catalog')
      .select('display_name')
      .eq('provider', provider)
      .eq('model_name', modelName)
      .maybeSingle()) as SingleResult<JoinedCatalogRow>;

    if (result.error) {
      warnGeminiUsageLookupIssue(
        'Failed to resolve Gemini usage catalog display name.',
        result.error,
        { modelName, provider }
      );
      return null;
    }

    const catalogRow = requireOptionalResult(result);
    return catalogRow?.display_name ?? null;
  } catch (error) {
    warnGeminiUsageLookupIssue(
      'Failed to resolve Gemini usage catalog display name.',
      error,
      { modelName, provider }
    );
    return null;
  }
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
  const jobId = input.job_id ?? null;
  const metadata: Json = input.metadata ?? {};

  for (let retryCount = 0; retryCount < MAX_CREATE_AI_MODEL_ATTEMPT_RETRIES; retryCount += 1) {
    const attemptOrder =
      input.attempt_order ??
      (await getNextAiModelAttemptOrder(client, input.listing_id, jobId));

    const insert: AiModelAttemptInsert = {
      attempt_order: attemptOrder,
      job_id: jobId,
      listing_id: input.listing_id,
      metadata,
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

    if (!result.error) {
      return requireSingleResult(result, 'AI model attempt was not created.');
    }

    if (input.attempt_order !== undefined || !isSupabaseUniqueViolation(result.error)) {
      throw new Error(result.error.message);
    }
  }

  throw new Error('AI model attempt could not be created after retrying unique-attempt-order conflicts.');
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

export async function listAiModelAttemptsForListings(
  client: SupabaseDataClient,
  listingIds: string[]
): Promise<AiModelAttemptRow[]> {
  const uniqueListingIds = Array.from(new Set(listingIds)).filter((listingId) => listingId.length > 0);

  if (uniqueListingIds.length === 0) {
    return [];
  }

  const result = (await client
    .from('ai_model_attempts')
    .select('*')
    .in('listing_id', uniqueListingIds)
    .order('listing_id', { ascending: true })
    .order('created_at', { ascending: true })
    .order('attempt_order', { ascending: true })) as MultiResult<AiModelAttemptRow>;

  if (result.error) {
    throw new Error(result.error.message);
  }

  return result.data ?? [];
}

export async function getLatestGeminiUsageAttempt(
  client: SupabaseDataClient
): Promise<GeminiUsageLastAttempt | null> {
  const result = (await client
    .from('ai_model_attempts')
    .select(
      'provider, model_name, status, started_at, finished_at, id, job:jobs!inner(job_type)'
    )
    .eq('provider', GEMINI_PROVIDER)
    .eq('job.job_type', GEMINI_GENERATE_AI_JOB_TYPE)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()) as SingleResult<LatestGeminiUsageAttemptRow>;

  if (result.error) {
    throw new Error(result.error.message);
  }

  const row = requireOptionalResult(result);

  if (!row) {
    return null;
  }

  const displayName = await getAiModelCatalogDisplayName(client, row.provider, row.model_name);

  return {
    display_name: displayName,
    finished_at: row.finished_at,
    model_name: row.model_name,
    provider: row.provider,
    started_at: row.started_at,
    status: row.status,
  };
}
