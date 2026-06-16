import type {
  Json,
  ListingPriceResearchInsert,
  ListingPriceResearchRow,
  ListingPriceResearchUpdate,
} from '../database.js';
import type { SupabaseDataClient } from '../client.js';
import { requireOptionalResult, requireSingleResult, type SingleResult } from './shared.js';

export interface MarkListingPriceResearchSucceededInput {
  id: string;
  comps?: Json;
  llm_price_explanation?: string | null;
  llm_reasoning_json?: Json;
  llm_rejected_comp_ids?: Json;
  median_sold_price?: number | null;
  suggested_price?: number | null;
  confidence?: string | null;
  pricing_model_name?: string | null;
  query?: string | null;
  raw_result_json?: Json;
  sold_count?: number | null;
}

export interface MarkListingPriceResearchFailedInput {
  id: string;
  error_code: string;
  error_message: string;
  llm_reasoning_json?: Json;
  pricing_model_name?: string | null;
  raw_result_json?: Json;
}

export async function createListingPriceResearch(
  client: SupabaseDataClient,
  input: ListingPriceResearchInsert
): Promise<ListingPriceResearchRow> {
  const result = (await client
    .from('listing_price_research')
    .insert(input)
    .select()
    .single()) as SingleResult<ListingPriceResearchRow>;

  return requireSingleResult(result, `Listing price research for "${input.listing_id}" was not created.`);
}

export async function getLatestListingPriceResearchByListingId(
  client: SupabaseDataClient,
  listingId: string
): Promise<ListingPriceResearchRow | null> {
  const result = (await client
    .from('listing_price_research')
    .select('*')
    .eq('listing_id', listingId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()) as SingleResult<ListingPriceResearchRow>;

  return requireOptionalResult(result);
}

export async function markListingPriceResearchSucceeded(
  client: SupabaseDataClient,
  input: MarkListingPriceResearchSucceededInput
): Promise<ListingPriceResearchRow> {
  const changes: ListingPriceResearchUpdate = {
    error_code: null,
    error_message: null,
    status: 'succeeded',
    ...(input.comps !== undefined ? { comps: input.comps } : {}),
    ...(input.llm_price_explanation !== undefined
      ? { llm_price_explanation: input.llm_price_explanation }
      : {}),
    ...(input.llm_reasoning_json !== undefined
      ? { llm_reasoning_json: input.llm_reasoning_json }
      : {}),
    ...(input.llm_rejected_comp_ids !== undefined
      ? { llm_rejected_comp_ids: input.llm_rejected_comp_ids }
      : {}),
    ...(input.median_sold_price !== undefined
      ? { median_sold_price: input.median_sold_price }
      : {}),
    ...(input.suggested_price !== undefined ? { suggested_price: input.suggested_price } : {}),
    ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
    ...(input.pricing_model_name !== undefined
      ? { pricing_model_name: input.pricing_model_name }
      : {}),
    ...(input.query !== undefined ? { query: input.query } : {}),
    ...(input.raw_result_json !== undefined ? { raw_result_json: input.raw_result_json } : {}),
    ...(input.sold_count !== undefined ? { sold_count: input.sold_count } : {}),
  };

  const result = (await client
    .from('listing_price_research')
    .update(changes)
    .eq('id', input.id)
    .select()
    .single()) as SingleResult<ListingPriceResearchRow>;

  return requireSingleResult(
    result,
    `Listing price research "${input.id}" was not marked succeeded.`
  );
}

export async function markListingPriceResearchFailed(
  client: SupabaseDataClient,
  input: MarkListingPriceResearchFailedInput
): Promise<ListingPriceResearchRow> {
  const changes: ListingPriceResearchUpdate = {
    error_code: input.error_code,
    error_message: input.error_message,
    status: 'failed',
    ...(input.llm_reasoning_json !== undefined
      ? { llm_reasoning_json: input.llm_reasoning_json }
      : {}),
    ...(input.pricing_model_name !== undefined
      ? { pricing_model_name: input.pricing_model_name }
      : {}),
    ...(input.raw_result_json !== undefined ? { raw_result_json: input.raw_result_json } : {}),
  };

  const result = (await client
    .from('listing_price_research')
    .update(changes)
    .eq('id', input.id)
    .select()
    .single()) as SingleResult<ListingPriceResearchRow>;

  return requireSingleResult(result, `Listing price research "${input.id}" was not marked failed.`);
}
