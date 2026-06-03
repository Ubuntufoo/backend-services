alter table public.app_settings
add column if not exists ebay_publish_config jsonb;
