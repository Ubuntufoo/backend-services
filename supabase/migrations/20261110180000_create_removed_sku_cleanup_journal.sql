-- YP9.6c4-EXEC1: additive, unapplied durable journal foundation.
-- This migration creates no executor and grants no destructive capability.

create table public.variation_listing_removed_sku_cleanup_journals (
  journal_id uuid primary key default gen_random_uuid(),
  group_id uuid not null,
  revision_id uuid not null,
  target_variation_id uuid not null,
  target_sku text not null,
  operator_confirmed boolean not null default false,
  deletion_authorized boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint variation_listing_removed_sku_cleanup_journals_identity_uq
    unique (group_id, revision_id, target_variation_id, target_sku),
  constraint variation_listing_removed_sku_cleanup_journals_sku_ck
    check (target_sku <> '' and target_sku !~ '^[[:space:]]' and target_sku !~ '[[:space:]]$'),
  constraint variation_listing_removed_sku_cleanup_journals_flags_ck
    check (operator_confirmed is false and deletion_authorized is false)
);

create table public.variation_listing_removed_sku_cleanup_resources (
  journal_id uuid not null references public.variation_listing_removed_sku_cleanup_journals(journal_id) on delete restrict,
  resource_kind text not null,
  resource_identity text not null,
  state text not null default 'planned',
  attempt_count integer not null default 0,
  version integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (journal_id, resource_kind, resource_identity),
  constraint variation_listing_removed_sku_cleanup_resources_kind_ck
    check (resource_kind in ('local', 'r2')),
  constraint variation_listing_removed_sku_cleanup_resources_identity_ck
    check (resource_identity <> '' and resource_identity !~ '^[[:space:]]' and resource_identity !~ '[[:space:]]$'),
  constraint variation_listing_removed_sku_cleanup_resources_state_ck
    check (state in ('planned', 'attempting', 'removed', 'already_absent', 'failed', 'unknown')),
  constraint variation_listing_removed_sku_cleanup_resources_attempt_ck
    check (attempt_count >= 0),
  constraint variation_listing_removed_sku_cleanup_resources_version_ck
    check (version >= 0),
  constraint variation_listing_removed_sku_cleanup_resources_error_ck
    check (last_error is null or (last_error <> '' and last_error !~ '^[[:space:]]' and last_error !~ '[[:space:]]$'))
);

-- These tables are in the exposed public schema. Keep direct client access denied;
-- only the explicitly granted service-role SECURITY DEFINER RPCs may access them.
alter table public.variation_listing_removed_sku_cleanup_journals enable row level security;
alter table public.variation_listing_removed_sku_cleanup_resources enable row level security;

create index variation_listing_removed_sku_cleanup_resources_journal_idx
  on public.variation_listing_removed_sku_cleanup_resources (journal_id, state);

create or replace function public.create_variation_listing_removed_sku_cleanup_journal(
  p_group_id uuid,
  p_revision_id uuid,
  p_target_variation_id uuid,
  p_target_sku text,
  p_local_paths text[],
  p_r2_keys text[]
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_journal_id uuid;
  v_identity text;
  v_existing boolean := false;
begin
  if p_group_id is null or p_revision_id is null or p_target_variation_id is null
     or p_target_sku is null or p_target_sku = ''
     or p_target_sku ~ '^[[:space:]]' or p_target_sku ~ '[[:space:]]$'
     or coalesce(array_length(p_local_paths, 1), 0) = 0
     or coalesce(array_length(p_r2_keys, 1), 0) = 0 then
    raise exception 'cleanup journal identity or resource evidence is invalid' using errcode = 'VR002';
  end if;
  if exists (select 1 from unnest(p_local_paths || p_r2_keys) x(v)
             where v is null or v = '' or v ~ '^[[:space:]]' or v ~ '[[:space:]]$')
     or (select count(*) from unnest(p_local_paths) x(v)) <>
        (select count(distinct v) from unnest(p_local_paths) x(v))
     or (select count(*) from unnest(p_r2_keys) x(v)) <>
        (select count(distinct v) from unnest(p_r2_keys) x(v)) then
    raise exception 'cleanup journal resource identity is invalid or duplicated' using errcode = 'VR002';
  end if;
  insert into public.variation_listing_removed_sku_cleanup_journals
    (group_id, revision_id, target_variation_id, target_sku)
  values (p_group_id, p_revision_id, p_target_variation_id, p_target_sku)
  on conflict (group_id, revision_id, target_variation_id, target_sku)
  do nothing
  returning journal_id into v_journal_id;
  if not found then
    v_existing := true;
    select journal_id into v_journal_id
      from public.variation_listing_removed_sku_cleanup_journals
     where group_id = p_group_id and revision_id = p_revision_id
       and target_variation_id = p_target_variation_id and target_sku = p_target_sku;
    if (select count(*) from public.variation_listing_removed_sku_cleanup_resources
         where journal_id = v_journal_id) <> array_length(p_local_paths, 1) + array_length(p_r2_keys, 1)
       or exists (
         select 1 from public.variation_listing_removed_sku_cleanup_resources r
          where r.journal_id = v_journal_id
            and not ((r.resource_kind = 'local' and r.resource_identity = any(p_local_paths))
                 or (r.resource_kind = 'r2' and r.resource_identity = any(p_r2_keys)))) then
      raise exception 'cleanup journal identity is already frozen with different resources' using errcode = 'VR002';
    end if;
  end if;
  foreach v_identity in array p_local_paths loop
    insert into public.variation_listing_removed_sku_cleanup_resources
      (journal_id, resource_kind, resource_identity)
    values (v_journal_id, 'local', v_identity)
    on conflict do nothing;
  end loop;
  foreach v_identity in array p_r2_keys loop
    insert into public.variation_listing_removed_sku_cleanup_resources
      (journal_id, resource_kind, resource_identity)
    values (v_journal_id, 'r2', v_identity)
    on conflict do nothing;
  end loop;
  if v_existing then
    update public.variation_listing_removed_sku_cleanup_journals
       set updated_at = now()
     where journal_id = v_journal_id;
  end if;
  return v_journal_id;
end;
$$;

create or replace function public.transition_variation_listing_removed_sku_cleanup_resource(
  p_journal_id uuid,
  p_resource_kind text,
  p_resource_identity text,
  p_expected_state text,
  p_next_state text,
  p_expected_version integer,
  p_last_error text default null
) returns table(state text, attempt_count integer, version integer)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_current public.variation_listing_removed_sku_cleanup_resources;
begin
  if p_journal_id is null or p_resource_kind not in ('local', 'r2')
     or p_resource_identity is null or p_resource_identity = ''
     or p_resource_identity ~ '^[[:space:]]' or p_resource_identity ~ '[[:space:]]$'
     or p_resource_identity = '' or p_expected_version is null or p_expected_version < 0
     or p_expected_state is null or p_next_state is null then
    raise exception 'cleanup journal transition arguments are invalid' using errcode = 'VR002';
  end if;
  select * into v_current
    from public.variation_listing_removed_sku_cleanup_resources
   where journal_id = p_journal_id and resource_kind = p_resource_kind
     and resource_identity = p_resource_identity
   for update;
  if not found or v_current.state <> p_expected_state or v_current.version <> p_expected_version then
    raise exception 'cleanup journal transition CAS mismatch' using errcode = 'VR002';
  end if;
  if (v_current.state = 'planned' and p_next_state <> 'attempting') or
     (v_current.state = 'attempting' and p_next_state not in ('removed', 'already_absent', 'failed', 'unknown')) or
     v_current.state not in ('planned', 'attempting') then
    raise exception 'cleanup journal transition is not allowed' using errcode = 'VR002';
  end if;
  if p_next_state = 'attempting' and v_current.attempt_count <> 0 then
    raise exception 'cleanup journal retry requires independent reconciliation' using errcode = 'VR002';
  end if;
  if p_next_state in ('failed', 'unknown') and (p_last_error is null or p_last_error = '' or
      p_last_error ~ '^[[:space:]]' or p_last_error ~ '[[:space:]]$') then
    raise exception 'cleanup journal uncertain outcome requires a reason' using errcode = 'VR002';
  end if;
  if p_next_state = 'attempting' and p_last_error is not null then
    raise exception 'cleanup journal attempt cannot carry an error' using errcode = 'VR002';
  end if;
  if p_next_state in ('removed', 'already_absent') and p_last_error is not null then
    raise exception 'cleanup journal terminal success cannot carry an error' using errcode = 'VR002';
  end if;
  update public.variation_listing_removed_sku_cleanup_resources as r
     set state = p_next_state,
         attempt_count = r.attempt_count + case when p_next_state = 'attempting' then 1 else 0 end,
         version = r.version + 1,
         last_error = p_last_error,
         updated_at = now()
   where r.journal_id = p_journal_id and r.resource_kind = p_resource_kind
     and r.resource_identity = p_resource_identity and r.version = p_expected_version;
  if not found then
    raise exception 'cleanup journal transition lost CAS race' using errcode = 'VR002';
  end if;
  return query select r.state, r.attempt_count, r.version
    from public.variation_listing_removed_sku_cleanup_resources r
   where r.journal_id = p_journal_id and r.resource_kind = p_resource_kind
     and r.resource_identity = p_resource_identity;
end;
$$;

create or replace function public.recover_variation_listing_removed_sku_cleanup_resource(
  p_journal_id uuid,
  p_resource_kind text,
  p_resource_identity text,
  p_expected_version integer
) returns table(state text, attempt_count integer, version integer)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  update public.variation_listing_removed_sku_cleanup_resources as r
     set state = 'unknown',
         last_error = 'Interrupted operation; provider outcome requires reconciliation.',
         version = r.version + 1,
         updated_at = now()
   where r.journal_id = p_journal_id and r.resource_kind = p_resource_kind
     and r.resource_identity = p_resource_identity and r.state = 'attempting'
     and r.version = p_expected_version;
  if not found then
    raise exception 'cleanup journal recovery CAS mismatch' using errcode = 'VR002';
  end if;
  return query select r.state, r.attempt_count, r.version
    from public.variation_listing_removed_sku_cleanup_resources r
   where r.journal_id = p_journal_id and r.resource_kind = p_resource_kind
     and r.resource_identity = p_resource_identity;
end;
$$;

revoke all on table public.variation_listing_removed_sku_cleanup_journals from public, anon, authenticated, service_role;
revoke all on table public.variation_listing_removed_sku_cleanup_resources from public, anon, authenticated, service_role;
revoke all on function public.create_variation_listing_removed_sku_cleanup_journal(uuid,uuid,uuid,text,text[],text[]) from public, anon, authenticated, service_role;
revoke all on function public.transition_variation_listing_removed_sku_cleanup_resource(uuid,text,text,text,text,integer,text) from public, anon, authenticated, service_role;
revoke all on function public.recover_variation_listing_removed_sku_cleanup_resource(uuid,text,text,integer) from public, anon, authenticated, service_role;
grant execute on function public.create_variation_listing_removed_sku_cleanup_journal(uuid,uuid,uuid,text,text[],text[]) to service_role;
grant execute on function public.transition_variation_listing_removed_sku_cleanup_resource(uuid,text,text,text,text,integer,text) to service_role;
grant execute on function public.recover_variation_listing_removed_sku_cleanup_resource(uuid,text,text,integer) to service_role;
