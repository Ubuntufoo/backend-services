alter table public.listings
  add column if not exists auto_pricing_enabled boolean not null default true;
