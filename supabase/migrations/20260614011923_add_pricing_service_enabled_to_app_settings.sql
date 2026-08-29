alter table public.app_settings
  add column if not exists pricing_service_enabled boolean not null default true;

update public.app_settings
set pricing_service_enabled = true
where id = 'default'
  and pricing_service_enabled is distinct from true;
