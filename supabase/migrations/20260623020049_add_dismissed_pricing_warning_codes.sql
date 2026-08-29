alter table public.listing_price_research
add column if not exists dismissed_pricing_warning_codes jsonb not null default '[]'::jsonb;
