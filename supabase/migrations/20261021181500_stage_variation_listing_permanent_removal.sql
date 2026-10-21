begin;

-- YP9.6c1: reversible local intent only. This migration does not delete a
-- variation, alter an eBay listing, or authorize active child removal.
alter table public.variation_listing_variations
  add column pending_removal_at timestamptz;

create unique index variation_listing_one_pending_removal_per_group_idx
  on public.variation_listing_variations (group_id)
  where pending_removal_at is not null;

comment on column public.variation_listing_variations.pending_removal_at is
  'Staged permanent-removal intent. Quantity 0 alone never sets this field. Remote removal is unavailable until YP9.6c2.';

-- Once removal intent exists, every later local edit must first cancel it. The
-- stage/cancel RPC sets this transaction-local scope only around its own
-- marker+revision update; all other aggregate, child, and intake writes are
-- rejected before they can create a desired revision that cancellation could
-- not safely undo.
create function public.prevent_variation_listing_pending_removal_mix()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  target_group_id uuid;
  write_scope text := current_setting('app.variation_listing_permanent_removal', true);
  scoped_group_id uuid := nullif(current_setting('app.variation_listing_group_id', true), '')::uuid;
  scoped_variation_id uuid := nullif(current_setting('app.variation_listing_variation_id', true), '')::uuid;
  expected_revision bigint := nullif(current_setting('app.variation_listing_expected_revision', true), '')::bigint;
begin
  if tg_table_name = 'variation_listing_groups' then
    if write_scope in ('stage', 'cancel') and tg_op = 'UPDATE'
       and old.group_id = scoped_group_id
       and old.desired_revision = expected_revision
       and new.group_id = old.group_id
       and new.desired_revision = old.desired_revision + 1
       and to_jsonb(new) - array['desired_revision','updated_at']
           is not distinct from to_jsonb(old) - array['desired_revision','updated_at'] then
      return new;
    end if;
    target_group_id := old.group_id;
  elsif tg_table_name = 'variation_listing_variations' then
    if write_scope in ('stage', 'cancel') and tg_op = 'UPDATE'
       and old.group_id = scoped_group_id
       and old.variation_id = scoped_variation_id
       and new.group_id = old.group_id
       and new.variation_id = old.variation_id
       and to_jsonb(new) - array['pending_removal_at','updated_at']
           is not distinct from to_jsonb(old) - array['pending_removal_at','updated_at']
       and ((write_scope = 'stage' and old.pending_removal_at is null and new.pending_removal_at is not null)
         or (write_scope = 'cancel' and old.pending_removal_at is not null and new.pending_removal_at is null)) then
      return new;
    end if;
    target_group_id := case when tg_op = 'DELETE' then old.group_id else new.group_id end;
  elsif tg_table_name = 'variation_listing_intake_sessions' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    target_group_id := coalesce(
      new.target_group_id,
      (new.pending_pair->>'target_group_id')::uuid,
      case when tg_op = 'UPDATE' then old.target_group_id end,
      case when tg_op = 'UPDATE' then (old.pending_pair->>'target_group_id')::uuid end
    );
    if target_group_id is null then
      return new;
    end if;
  elsif tg_table_name = 'variation_listing_revisions' then
    target_group_id := case when tg_op = 'DELETE' then old.group_id else new.group_id end;
  elsif tg_table_name = 'variation_listing_publishing_checkpoints' then
    select r.group_id into target_group_id
      from public.variation_listing_revisions r
     where r.revision_id = case when tg_op = 'DELETE' then old.revision_id else new.revision_id end;
  else
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  -- Serialize every non-stage write against the group row. Stage locks all
  -- sessions then the group before setting the marker; a concurrent intake
  -- insert/update that started after the session scan therefore waits here,
  -- observes the committed marker, and is rejected instead of slipping into
  -- the pre-marker gap.
  if target_group_id is not null then
    perform 1
      from public.variation_listing_groups g
     where g.group_id = target_group_id
     for update;
  end if;
  if target_group_id is not null and exists (
    select 1
      from public.variation_listing_variations v
     where v.group_id = target_group_id
       and v.pending_removal_at is not null
  ) then
    raise exception 'cancel staged permanent removal before editing or capturing this group' using errcode = 'VR002';
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

create trigger variation_listing_groups_block_pending_removal_mix
  before update on public.variation_listing_groups
  for each row execute function public.prevent_variation_listing_pending_removal_mix();

create trigger variation_listing_variations_block_pending_removal_mix
  before insert or update or delete on public.variation_listing_variations
  for each row execute function public.prevent_variation_listing_pending_removal_mix();

create trigger variation_listing_intake_sessions_block_pending_removal_mix
  before insert or update on public.variation_listing_intake_sessions
  for each row execute function public.prevent_variation_listing_pending_removal_mix();

create trigger variation_listing_revisions_block_pending_removal_mix
  before insert on public.variation_listing_revisions
  for each row execute function public.prevent_variation_listing_pending_removal_mix();

create trigger variation_listing_checkpoints_block_pending_removal_mix
  before insert on public.variation_listing_publishing_checkpoints
  for each row execute function public.prevent_variation_listing_pending_removal_mix();

revoke all on function public.prevent_variation_listing_pending_removal_mix()
  from public, anon, authenticated, service_role;

create function public.stage_variation_listing_permanent_removal(
  p_group_id uuid,
  p_variation_id uuid,
  p_expected_desired_revision bigint,
  p_remove boolean
) returns table(group_row jsonb, variation_row jsonb)
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
declare
  g_group_id uuid;
  g_desired_revision bigint;
  g_last_confirmed_revision bigint;
  g_lifecycle_state text;
  v_variation_id uuid;
  v_sku text;
  v_pending_removal_at timestamptz;
  r_revision_id uuid;
  r_snapshot_version integer;
  r_snapshot jsonb;
  revision_row record;
  confirmed_aggregate jsonb;
  op jsonb;
  k text;
  latest record;
begin
  if p_group_id is null or p_variation_id is null or p_expected_desired_revision is null
     or p_expected_desired_revision < 0 or p_remove is null then
    raise exception 'permanent-removal arguments are invalid' using errcode = 'VR002';
  end if;

  -- Do not stage retirement while a capture targets this group. Lock every
  -- session first in deterministic order: intake always locks its session
  -- before its target group. The post-group recheck closes the gap where a
  -- new session is inserted after this scan but before the group lock.
  perform 1 from public.variation_listing_intake_sessions s
   order by s.capture_source_key
   for update;
  if exists (
    select 1 from public.variation_listing_intake_sessions s
     where s.target_group_id = p_group_id
        or (s.pending_pair is not null and s.pending_pair->>'target_group_id' = p_group_id::text)
  ) then
    raise exception 'disarm and finish variation-listing intake before removing a child' using errcode = 'VR002';
  end if;

  select x.group_id, x.desired_revision, x.last_confirmed_revision, x.lifecycle_state
    into g_group_id, g_desired_revision, g_last_confirmed_revision, g_lifecycle_state
    from public.variation_listing_groups x
   where x.group_id = p_group_id for update;
  if not found then raise exception 'variation listing group not found' using errcode = 'VR004'; end if;
  if g_desired_revision <> p_expected_desired_revision then
    raise exception 'permanent-removal desired revision CAS mismatch' using errcode = 'VR001';
  end if;
  if g_lifecycle_state <> 'active' or g_last_confirmed_revision is null then
    raise exception 'permanent removal requires a confirmed active group' using errcode = 'VR002';
  end if;
  if exists (
    select 1 from public.variation_listing_intake_sessions s
     where s.target_group_id = p_group_id
        or (s.pending_pair is not null and s.pending_pair->>'target_group_id' = p_group_id::text)
  ) then
    raise exception 'disarm and finish variation-listing intake before removing a child' using errcode = 'VR002';
  end if;

  select x.variation_id, x.sku, x.pending_removal_at
    into v_variation_id, v_sku, v_pending_removal_at
    from public.variation_listing_variations x
   where x.group_id = p_group_id and x.variation_id = p_variation_id for update;
  if not found then raise exception 'target variation not found in group' using errcode = 'VR004'; end if;

  if exists (
    select 1 from public.variation_listing_revisions x
     where x.group_id = p_group_id and x.captured_desired_revision > g_last_confirmed_revision
  ) then
    raise exception 'permanent removal requires resolution of newer frozen revisions' using errcode = 'VR002';
  end if;

  select x.revision_id, x.snapshot_version, x.snapshot
    into r_revision_id, r_snapshot_version, r_snapshot
    from public.variation_listing_revisions x
   where x.group_id = p_group_id
     and x.captured_desired_revision = g_last_confirmed_revision;
  if not found
     or (r_snapshot_version is distinct from 1 and r_snapshot_version is distinct from 3)
     or jsonb_typeof(r_snapshot) is distinct from 'object'
     or jsonb_typeof(r_snapshot->'aggregate') is distinct from 'object'
     or jsonb_typeof(r_snapshot->'aggregate'->'group') is distinct from 'object'
     or jsonb_typeof(r_snapshot->'aggregate'->'variations') is distinct from 'array' then
    raise exception 'permanent removal requires an exactly confirmed child SKU' using errcode = 'VR002';
  end if;

  -- v1 stores the confirmed aggregate at the root. v3 additionally carries
  -- the prior parent confirmed aggregate; validate that bridge shape, but use
  -- the root aggregate (the revision just confirmed) for child identity so a
  -- child first introduced by this v3 revision remains stageable.
  if r_snapshot_version = 3 then
    if jsonb_typeof(r_snapshot->'confirmed') is distinct from 'object'
       or jsonb_typeof(r_snapshot->'confirmed'->'aggregate') is distinct from 'object'
       or jsonb_typeof(r_snapshot->'confirmed'->'aggregate'->'group') is distinct from 'object'
       or jsonb_typeof(r_snapshot->'confirmed'->'aggregate'->'variations') is distinct from 'array'
       or coalesce(r_snapshot->'confirmed'->'aggregate'->'group'->>'group_id', '') <> g_group_id::text then
      raise exception 'permanent removal requires an exactly confirmed child SKU' using errcode = 'VR002';
    end if;
    confirmed_aggregate := r_snapshot->'aggregate';
  else
    confirmed_aggregate := r_snapshot->'aggregate';
  end if;
  if coalesce(confirmed_aggregate->'group'->>'group_id', '') <> g_group_id::text
     or not exists (
       select 1 from jsonb_array_elements(confirmed_aggregate->'variations') prior
        where prior->>'variation_id' = v_variation_id::text
          and prior->>'sku' = v_sku
     ) then
    raise exception 'permanent removal requires an exactly confirmed child SKU' using errcode = 'VR002';
  end if;
  -- Every frozen group revision must be journal-resolved before a removal
  -- intent can be staged. A newer revision is rejected above; this loop also
  -- closes the older-revision hole where an unresolved checkpoint could be
  -- hidden behind a later confirmation.
  for revision_row in
    select * from public.variation_listing_revisions x where x.group_id = p_group_id
  loop
    if jsonb_typeof(revision_row.operation_plan) is distinct from 'array'
       or jsonb_array_length(revision_row.operation_plan) <> revision_row.operation_count
       or revision_row.operation_count < 1 then
      raise exception 'permanent removal requires a complete confirmed revision' using errcode = 'VR002';
    end if;
    for op in select value from jsonb_array_elements(revision_row.operation_plan) loop
      k := op->>'operation_key';
      if nullif(btrim(k), '') is null then
        raise exception 'permanent removal requires a complete confirmed revision' using errcode = 'VR002';
      end if;
      select * into latest
        from public.variation_listing_publishing_checkpoints c
       where c.revision_id = revision_row.revision_id
         and c.operation_key = k
       order by c.attempt_number desc, c.checkpoint_number desc
       limit 1;
      if not found then
        raise exception 'permanent removal requires a complete confirmed revision' using errcode = 'VR002';
      end if;
      if latest.state is null
         or latest.state not in ('confirmed_complete', 'confirmed_no_op')
         or latest.observed_remote_state is null
         or latest.observed_remote_state not in ('present', 'proven_absent')
         or latest.evidence is null
         or latest.evidence = '{}'::jsonb then
        raise exception 'permanent removal requires a complete confirmed revision' using errcode = 'VR002';
      end if;
      if latest.state = 'confirmed_no_op' and exists (
        select 1
          from public.variation_listing_publishing_checkpoints h
         where h.revision_id = revision_row.revision_id
           and h.operation_key = k
           and (h.state = 'unknown' or h.observed_remote_state = 'unknown')
      ) then
        raise exception 'permanent removal requires reconciliation of unknown checkpoint' using errcode = 'VR002';
      end if;
    end loop;
  end loop;

  if p_remove then
    if g_desired_revision <> g_last_confirmed_revision then
      raise exception 'stage removal only with no other pending changes' using errcode = 'VR002';
    end if;
    if v_pending_removal_at is not null or exists (
      select 1 from public.variation_listing_variations x
       where x.group_id = p_group_id and x.pending_removal_at is not null
    ) then
      raise exception 'another removal is already staged' using errcode = 'VR002';
    end if;
    if (select count(*) from public.variation_listing_variations x where x.group_id = p_group_id) < 3 then
      raise exception 'at least two surviving variations are required' using errcode = 'VR002';
    end if;
  else
    if v_pending_removal_at is null or g_desired_revision <> g_last_confirmed_revision + 1
       or (select count(*) from public.variation_listing_variations x
            where x.group_id = p_group_id and x.pending_removal_at is not null) <> 1 then
      raise exception 'only the sole, unexecuted staged removal can be cancelled' using errcode = 'VR002';
    end if;
  end if;

  -- Both staging and cancellation advance exactly once; no remote or copy rows
  -- are touched. The transaction-local scope admits only these marker writes;
  -- pending-removal triggers reject every other aggregate/intake/journal edit.
  perform set_config('app.variation_listing_group_id', p_group_id::text, true);
  perform set_config('app.variation_listing_variation_id', p_variation_id::text, true);
  perform set_config('app.variation_listing_expected_revision', g_desired_revision::text, true);
  perform set_config('app.variation_listing_permanent_removal', case when p_remove then 'stage' else 'cancel' end, true);

  update public.variation_listing_variations
     set pending_removal_at = case when p_remove then clock_timestamp() else null end
   where group_id = p_group_id and variation_id = p_variation_id;

  update public.variation_listing_groups
     set desired_revision = desired_revision + 1
   where group_id = p_group_id;

  return query
  select to_jsonb(gg), to_jsonb(vv)
    from public.variation_listing_groups gg
    join public.variation_listing_variations vv on vv.group_id = gg.group_id
   where gg.group_id = p_group_id and vv.variation_id = p_variation_id;
end;
$$;

revoke all on function public.stage_variation_listing_permanent_removal(uuid,uuid,bigint,boolean)
  from public, anon, authenticated;
grant execute on function public.stage_variation_listing_permanent_removal(uuid,uuid,bigint,boolean)
  to service_role;

commit;
