create table if not exists public.ai_model_catalog (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  model_name text not null,
  display_name text,
  is_enabled boolean not null default true,
  is_free_tier_eligible boolean not null default false,
  free_tier_status text not null default 'unknown',
  supports_text boolean not null default true,
  supports_images boolean not null default false,
  supports_json_output boolean not null default false,
  supports_structured_output boolean not null default false,
  input_token_limit integer,
  output_token_limit integer,
  verification_source_url text,
  verification_notes text,
  notes text,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_model_catalog_provider_check check (char_length(btrim(provider)) > 0),
  constraint ai_model_catalog_model_name_check check (char_length(btrim(model_name)) > 0),
  constraint ai_model_catalog_free_tier_status_check check (
    free_tier_status in (
      'unknown',
      'verified_free',
      'verified_paid_only',
      'deprecated',
      'unavailable'
    )
  ),
  constraint ai_model_catalog_provider_model_name_key unique (provider, model_name)
);

alter table public.ai_model_catalog enable row level security;

create table if not exists public.ai_model_task_routes (
  id uuid primary key default gen_random_uuid(),
  task_type text not null,
  provider text not null,
  model_name text not null,
  route_order integer not null,
  is_enabled boolean not null default true,
  require_images boolean not null default false,
  require_json_output boolean not null default true,
  require_structured_output boolean not null default false,
  fallback_on_rate_limit boolean not null default true,
  fallback_on_quota_exceeded boolean not null default true,
  fallback_on_unavailable boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_model_task_routes_task_type_check check (char_length(btrim(task_type)) > 0),
  constraint ai_model_task_routes_provider_check check (char_length(btrim(provider)) > 0),
  constraint ai_model_task_routes_model_name_check check (char_length(btrim(model_name)) > 0),
  constraint ai_model_task_routes_route_order_check check (route_order > 0),
  constraint ai_model_task_routes_task_provider_model_key unique (task_type, provider, model_name),
  constraint ai_model_task_routes_task_route_order_key unique (task_type, route_order),
  constraint ai_model_task_routes_provider_model_name_fkey
    foreign key (provider, model_name)
    references public.ai_model_catalog (provider, model_name)
    on delete cascade
);

alter table public.ai_model_task_routes enable row level security;

create index if not exists ai_model_task_routes_task_type_idx
  on public.ai_model_task_routes (task_type);

create index if not exists ai_model_task_routes_provider_model_name_idx
  on public.ai_model_task_routes (provider, model_name);

create index if not exists ai_model_task_routes_is_enabled_idx
  on public.ai_model_task_routes (is_enabled);

drop trigger if exists set_ai_model_catalog_updated_at on public.ai_model_catalog;

create trigger set_ai_model_catalog_updated_at
before update on public.ai_model_catalog
for each row
execute function public.set_row_updated_at();

drop trigger if exists set_ai_model_task_routes_updated_at on public.ai_model_task_routes;

create trigger set_ai_model_task_routes_updated_at
before update on public.ai_model_task_routes
for each row
execute function public.set_row_updated_at();

insert into public.ai_model_catalog (
  provider,
  model_name,
  display_name,
  is_enabled,
  is_free_tier_eligible,
  free_tier_status,
  supports_text,
  supports_images,
  supports_json_output,
  supports_structured_output,
  notes
)
values (
  'google',
  'gemini-3.1-flash-lite',
  'Gemini 3.1 Flash Lite',
  true,
  true,
  'unknown',
  true,
  true,
  true,
  true,
  'Initial DB-backed route seed for listing draft generation.'
)
on conflict (provider, model_name) do update
set
  display_name = excluded.display_name,
  is_enabled = excluded.is_enabled,
  is_free_tier_eligible = excluded.is_free_tier_eligible,
  free_tier_status = excluded.free_tier_status,
  supports_text = excluded.supports_text,
  supports_images = excluded.supports_images,
  supports_json_output = excluded.supports_json_output,
  supports_structured_output = excluded.supports_structured_output,
  notes = excluded.notes;

-- Keep the seeded route_order stable during idempotent re-runs.
-- Reordering routes should happen through explicit route-shift SQL to avoid
-- colliding with the unique (task_type, route_order) constraint.
insert into public.ai_model_task_routes (
  task_type,
  provider,
  model_name,
  route_order,
  is_enabled,
  require_images,
  require_json_output,
  require_structured_output,
  fallback_on_rate_limit,
  fallback_on_quota_exceeded,
  fallback_on_unavailable,
  notes
)
values (
  'listing_draft_generation',
  'google',
  'gemini-3.1-flash-lite',
  1,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  'Primary configured Gemini route for listing draft generation.'
)
on conflict (task_type, provider, model_name) do update
set
  is_enabled = excluded.is_enabled,
  require_images = excluded.require_images,
  require_json_output = excluded.require_json_output,
  require_structured_output = excluded.require_structured_output,
  fallback_on_rate_limit = excluded.fallback_on_rate_limit,
  fallback_on_quota_exceeded = excluded.fallback_on_quota_exceeded,
  fallback_on_unavailable = excluded.fallback_on_unavailable,
  notes = excluded.notes;

revoke all privileges on table
  public.ai_model_catalog,
  public.ai_model_task_routes
from anon, authenticated;

grant all privileges on table
  public.ai_model_catalog,
  public.ai_model_task_routes
to service_role;
