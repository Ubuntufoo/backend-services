create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_id text not null unique,
  listing_id text,
  sku text,
  ebay_listing_id text,
  order_status text,
  fulfillment_status text,
  ship_by_date timestamptz,
  sale_price numeric,
  quantity_sold integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.orders enable row level security;

create index if not exists orders_listing_id_idx on public.orders (listing_id);
create index if not exists orders_sku_idx on public.orders (sku);
create index if not exists orders_order_status_idx on public.orders (order_status);
create index if not exists orders_fulfillment_status_idx on public.orders (fulfillment_status);
create index if not exists orders_ship_by_date_idx on public.orders (ship_by_date);

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null,
  listing_id text,
  status text not null,
  next_run_at timestamptz,
  last_error text,
  last_error_code text,
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.jobs enable row level security;

create index if not exists jobs_job_type_idx on public.jobs (job_type);
create index if not exists jobs_listing_id_idx on public.jobs (listing_id);
create index if not exists jobs_status_idx on public.jobs (status);
create index if not exists jobs_next_run_at_idx on public.jobs (next_run_at);

create table if not exists public.daily_usage (
  usage_date date primary key default current_date,
  gemini_calls_used integer not null default 0,
  gemini_daily_limit integer not null default 500,
  order_sync_count integer not null default 0
);

alter table public.daily_usage enable row level security;

create table if not exists public.app_settings (
  id text primary key default 'default',
  incoming_folder_path text,
  processed_folder_path text,
  capture_mode text,
  merchant_location_key text,
  office_location_name text,
  default_payment_policy_id text,
  default_fulfillment_policy_id text,
  default_return_policy_id text,
  default_shipping_profile text,
  default_package_type text,
  handling_days integer,
  gemini_daily_limit integer,
  max_order_syncs_per_day integer,
  ebay_marketplace_id text,
  updated_at timestamptz not null default now(),
  r2_retention_days_after_sold integer
);

alter table public.app_settings enable row level security;

create or replace function public.set_row_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_orders_updated_at on public.orders;

create trigger set_orders_updated_at
before update on public.orders
for each row
execute function public.set_row_updated_at();

drop trigger if exists set_jobs_updated_at on public.jobs;

create trigger set_jobs_updated_at
before update on public.jobs
for each row
execute function public.set_row_updated_at();

drop trigger if exists set_app_settings_updated_at on public.app_settings;

create trigger set_app_settings_updated_at
before update on public.app_settings
for each row
execute function public.set_row_updated_at();
