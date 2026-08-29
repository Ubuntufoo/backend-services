alter table public.app_settings
  add column if not exists soldcomps_usage_snapshot jsonb;
