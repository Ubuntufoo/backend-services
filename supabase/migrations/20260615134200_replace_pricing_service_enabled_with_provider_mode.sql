alter table public.app_settings
  add column if not exists pricing_provider_mode text;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'app_settings'
      and column_name = 'pricing_service_enabled'
  ) then
    execute $sql$
      update public.app_settings
      set pricing_provider_mode = case
        when pricing_provider_mode in ('off', 'soldcomps', 'apify') then pricing_provider_mode
        when pricing_service_enabled is false then 'off'
        else 'soldcomps'
      end
    $sql$;
  else
    update public.app_settings
    set pricing_provider_mode = case
      when pricing_provider_mode in ('off', 'soldcomps', 'apify') then pricing_provider_mode
      else 'soldcomps'
    end;
  end if;
end
$$;

alter table public.app_settings
  alter column pricing_provider_mode set default 'soldcomps';

update public.app_settings
set pricing_provider_mode = 'soldcomps'
where pricing_provider_mode is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'app_settings_pricing_provider_mode_check'
      and conrelid = 'public.app_settings'::regclass
  ) then
    alter table public.app_settings
      add constraint app_settings_pricing_provider_mode_check
      check (pricing_provider_mode in ('off', 'soldcomps', 'apify'));
  end if;
end
$$;

alter table public.app_settings
  validate constraint app_settings_pricing_provider_mode_check;

alter table public.app_settings
  alter column pricing_provider_mode set not null;

alter table public.app_settings
  drop column if exists pricing_service_enabled;
