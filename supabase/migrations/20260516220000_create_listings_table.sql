create extension if not exists pgcrypto;

create table if not exists public.listings (
  id uuid primary key default gen_random_uuid(),
  listing_id text not null unique,
  sku text,
  status text,
  sub_status text,
  capture_mode text,
  listing_type text,
  title text,
  description text,
  seller_hints text,
  condition_id text,
  condition_notes text,
  category_id text,
  item_specifics jsonb not null default '{}'::jsonb,
  price numeric,
  shipping_profile text,
  package_type text,
  estimated_weight_oz numeric,
  ese_eligible boolean,
  handling_days integer,
  merchant_location_key text,
  ebay_offer_id text,
  ebay_listing_id text,
  ebay_listing_url text,
  ebay_listing_status text,
  last_error_code text,
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_for_export_at timestamptz,
  exported_at timestamptz,
  sold_at timestamptz,
  image_urls jsonb not null default '[]'::jsonb,
  r2_object_keys jsonb not null default '[]'::jsonb,
  r2_retention_policy text,
  r2_delete_after timestamptz,
  r2_deleted_at timestamptz,
  constraint listings_listing_type_check
    check (listing_type is null or listing_type in ('single', 'lot'))
);

alter table public.listings enable row level security;

create index if not exists listings_status_idx on public.listings (status);
create index if not exists listings_sku_idx on public.listings (sku);
create index if not exists listings_merchant_location_key_idx on public.listings (merchant_location_key);
create index if not exists listings_approved_for_export_at_idx on public.listings (approved_for_export_at);
create index if not exists listings_exported_at_idx on public.listings (exported_at);
create index if not exists listings_sold_at_idx on public.listings (sold_at);

create or replace function public.set_listings_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_listings_updated_at on public.listings;

create trigger set_listings_updated_at
before update on public.listings
for each row
execute function public.set_listings_updated_at();
