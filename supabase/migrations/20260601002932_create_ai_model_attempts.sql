create table if not exists public.ai_model_attempts (
  id uuid primary key default gen_random_uuid(),
  listing_id text not null,
  job_id uuid,
  attempt_order integer not null,
  provider text not null,
  model_name text not null,
  provider_model_id text,
  routing_source text,
  status text not null,
  failure_code text,
  failure_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint ai_model_attempts_attempt_order_check check (attempt_order > 0),
  constraint ai_model_attempts_provider_check check (char_length(btrim(provider)) > 0),
  constraint ai_model_attempts_model_name_check check (char_length(btrim(model_name)) > 0),
  constraint ai_model_attempts_status_check check (status in ('started', 'succeeded', 'failed', 'skipped')),
  constraint ai_model_attempts_duration_ms_check check (duration_ms is null or duration_ms >= 0),
  constraint ai_model_attempts_listing_id_fkey
    foreign key (listing_id)
    references public.listings (listing_id)
    on update cascade
    on delete cascade,
  constraint ai_model_attempts_job_id_fkey
    foreign key (job_id)
    references public.jobs (id)
    on update cascade
    on delete set null
);

alter table public.ai_model_attempts enable row level security;

create unique index if not exists ai_model_attempts_listing_job_attempt_order_uidx
  on public.ai_model_attempts (listing_id, job_id, attempt_order)
  where job_id is not null;

create index if not exists ai_model_attempts_listing_id_idx
  on public.ai_model_attempts (listing_id);

create index if not exists ai_model_attempts_job_id_idx
  on public.ai_model_attempts (job_id);

create index if not exists ai_model_attempts_created_at_desc_idx
  on public.ai_model_attempts (created_at desc);

revoke all privileges on table public.ai_model_attempts from anon, authenticated;
grant all privileges on table public.ai_model_attempts to service_role;
