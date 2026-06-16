create table if not exists public.listing_price_research (
  id uuid primary key default gen_random_uuid(),
  listing_id text not null references public.listings(listing_id),
  provider text not null,
  status text not null,
  query text,
  sold_count integer,
  median_sold_price numeric,
  suggested_price numeric,
  confidence text,
  comps jsonb not null default '[]'::jsonb,
  raw_result_json jsonb not null default '{}'::jsonb,
  llm_reasoning_json jsonb not null default '{}'::jsonb,
  llm_rejected_comp_ids jsonb not null default '[]'::jsonb,
  llm_price_explanation text,
  pricing_model_name text,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.listing_price_research enable row level security;

create index if not exists listing_price_research_listing_id_idx
on public.listing_price_research (listing_id);

create index if not exists listing_price_research_created_at_idx
on public.listing_price_research (created_at desc);

create index if not exists listing_price_research_listing_id_created_at_idx
on public.listing_price_research (listing_id, created_at desc);

drop trigger if exists set_listing_price_research_updated_at on public.listing_price_research;

create trigger set_listing_price_research_updated_at
before update on public.listing_price_research
for each row
execute function public.set_row_updated_at();

create unique index if not exists jobs_research_price_active_listing_idx
on public.jobs (listing_id, job_type)
where listing_id is not null
  and job_type = 'research_price'
  and status in ('queued', 'running');
