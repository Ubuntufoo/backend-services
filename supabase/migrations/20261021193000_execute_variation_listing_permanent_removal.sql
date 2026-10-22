begin;

-- YP9.6c2: the remove-only journal is deliberately separate from ordinary
-- active revisions.  This additive migration does not rewrite the applied c1
-- stage migration and does not perform any hosted data or eBay mutation.

-- No tombstone or duplicate confirmation table: revision snapshot is authoritative.

create or replace function public.prevent_variation_listing_pending_removal_mix()
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
  capability_relation oid;
  capability_valid boolean := false;
begin
  -- c2's SECURITY DEFINER functions create a transaction-local capability
  -- table owned by the function owner. A caller-supplied GUC alone is
  -- forgeable by service_role and must never authorize a journal/finalizer
  -- write.
  if write_scope = 'c2_execute' and tg_table_name = 'variation_listing_revisions' and tg_op = 'INSERT' then
    capability_relation := pg_catalog.to_regclass('pg_temp.variation_listing_c2_capability');
    if capability_relation is not null then
      select exists (
        select 1 from pg_catalog.pg_class c
         where c.oid = capability_relation
           and c.relowner = (select r.oid from pg_catalog.pg_roles r where r.rolname = current_user)
      ) and exists (
        select 1 from pg_temp.variation_listing_c2_capability cap
         where cap.mode = 'c2_execute_revision'
           and cap.group_id = scoped_group_id
           and cap.revision_id = new.revision_id
           and cap.remaining = 1
      ) into capability_valid;
    end if;
    if capability_valid and new.group_id = scoped_group_id then
      update pg_temp.variation_listing_c2_capability cap
         set remaining = 0
       where cap.mode = 'c2_execute_revision' and cap.revision_id = new.revision_id;
      return new;
    end if;
    raise exception 'c2 revision write requires a dedicated permanent-removal RPC' using errcode = 'VR002';
  elsif write_scope = 'c2_execute' and tg_table_name = 'variation_listing_publishing_checkpoints' and tg_op = 'INSERT' then
    capability_relation := pg_catalog.to_regclass('pg_temp.variation_listing_c2_capability');
    if capability_relation is not null then
      select exists (
        select 1 from pg_catalog.pg_class c
         where c.oid = capability_relation
           and c.relowner = (select r.oid from pg_catalog.pg_roles r where r.rolname = current_user)
      ) and exists (
        select 1 from pg_temp.variation_listing_c2_capability cap
         where cap.mode = 'c2_execute_checkpoint'
           and cap.group_id = scoped_group_id
           and cap.revision_id = new.revision_id
           and cap.remaining = 1
      ) into capability_valid;
    end if;
    if capability_valid and exists (select 1 from public.variation_listing_revisions r where r.revision_id = new.revision_id and r.group_id = scoped_group_id) then
      update pg_temp.variation_listing_c2_capability cap
         set remaining = 0
       where cap.mode = 'c2_execute_checkpoint' and cap.revision_id = new.revision_id;
      return new;
    end if;
    raise exception 'c2 checkpoint write requires a dedicated permanent-removal RPC' using errcode = 'VR002';
  end if;

  if write_scope = 'c2_finalize' and tg_table_name = 'variation_listing_groups' and tg_op = 'UPDATE' then
    capability_relation := pg_catalog.to_regclass('pg_temp.variation_listing_c2_capability');
    if capability_relation is not null then
      select exists (
        select 1 from pg_catalog.pg_class c
         where c.oid = capability_relation
           and c.relowner = (select r.oid from pg_catalog.pg_roles r where r.rolname = current_user)
      ) and exists (
        select 1 from pg_temp.variation_listing_c2_capability cap
         where cap.mode = 'c2_finalize'
           and cap.group_id = scoped_group_id
           and cap.variation_id = scoped_variation_id
           and cap.remaining = 1
      ) into capability_valid;
    end if;
    if capability_valid and old.group_id = scoped_group_id and new.group_id = old.group_id
       and new.desired_revision = old.desired_revision
       and new.last_confirmed_revision = old.desired_revision
       and to_jsonb(new) - array['last_confirmed_revision','updated_at']
           is not distinct from to_jsonb(old) - array['last_confirmed_revision','updated_at'] then
      update pg_temp.variation_listing_c2_capability cap
         set remaining = 0
       where cap.mode = 'c2_finalize' and cap.group_id = scoped_group_id and cap.remaining = 1;
      return new;
    end if;
    raise exception 'c2 group finalization requires a dedicated permanent-removal RPC' using errcode = 'VR002';
  end if;
  if write_scope = 'c2_finalize' and tg_table_name = 'variation_listing_variations' and tg_op = 'DELETE' then
    capability_relation := pg_catalog.to_regclass('pg_temp.variation_listing_c2_capability');
    if capability_relation is not null then
      select exists (
        select 1 from pg_catalog.pg_class c where c.oid = capability_relation
        and c.relowner = (select r.oid from pg_catalog.pg_roles r where r.rolname = current_user)
      ) and exists (
        select 1 from pg_temp.variation_listing_c2_capability cap
         where cap.mode = 'c2_finalize' and cap.group_id = scoped_group_id
           and cap.variation_id = scoped_variation_id and cap.remaining = 2
      ) into capability_valid;
    end if;
    if capability_valid and old.group_id = scoped_group_id
       and old.variation_id = scoped_variation_id and old.pending_removal_at is not null then
      update pg_temp.variation_listing_c2_capability set remaining = 1
       where mode = 'c2_finalize' and group_id = scoped_group_id
         and variation_id = scoped_variation_id and remaining = 2;
      return old;
    end if;
    raise exception 'c2 variation hard delete requires dedicated finalization RPC' using errcode = 'VR002';
  end if;

  -- Preserve c1's narrowly scoped stage/cancel writes while replacing the
  -- trigger body. All other writes continue through the pending-marker guard.
  if tg_table_name = 'variation_listing_groups' and write_scope in ('stage', 'cancel') and tg_op = 'UPDATE' then
    if old.group_id = scoped_group_id and old.desired_revision = expected_revision
       and new.group_id = old.group_id and new.desired_revision = old.desired_revision + 1
       and to_jsonb(new) - array['desired_revision','updated_at']
           is not distinct from to_jsonb(old) - array['desired_revision','updated_at'] then
      return new;
    end if;
  elsif tg_table_name = 'variation_listing_variations' and write_scope in ('stage', 'cancel') and tg_op = 'UPDATE' then
    if old.group_id = scoped_group_id and old.variation_id = scoped_variation_id
       and new.group_id = old.group_id and new.variation_id = old.variation_id
       and to_jsonb(new) - array['pending_removal_at','updated_at']
           is not distinct from to_jsonb(old) - array['pending_removal_at','updated_at']
       and ((write_scope = 'stage' and old.pending_removal_at is null and new.pending_removal_at is not null)
         or (write_scope = 'cancel' and old.pending_removal_at is not null and new.pending_removal_at is null)) then
      return new;
    end if;
  end if;

  if tg_table_name = 'variation_listing_groups' then
    target_group_id := old.group_id;
  elsif tg_table_name = 'variation_listing_variations' then
    target_group_id := case when tg_op = 'DELETE' then old.group_id else new.group_id end;
  elsif tg_table_name = 'variation_listing_intake_sessions' then
    if tg_op = 'DELETE' then return old; end if;
    target_group_id := coalesce(
      new.target_group_id,
      (new.pending_pair->>'target_group_id')::uuid,
      case when tg_op = 'UPDATE' then old.target_group_id end,
      case when tg_op = 'UPDATE' then (old.pending_pair->>'target_group_id')::uuid end
    );
    if target_group_id is null then return new; end if;
  elsif tg_table_name = 'variation_listing_revisions' then
    target_group_id := case when tg_op = 'DELETE' then old.group_id else new.group_id end;
  elsif tg_table_name = 'variation_listing_publishing_checkpoints' then
    select r.group_id into target_group_id
      from public.variation_listing_revisions r
     where r.revision_id = case when tg_op = 'DELETE' then old.revision_id else new.revision_id end;
  else
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if target_group_id is not null then
    perform 1 from public.variation_listing_groups g where g.group_id = target_group_id for update;
  end if;
  if target_group_id is not null and exists (
    select 1 from public.variation_listing_variations v
     where v.group_id = target_group_id and v.pending_removal_at is not null
  ) then
    raise exception 'cancel staged permanent removal before editing or capturing this group' using errcode = 'VR002';
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

revoke all on function public.prevent_variation_listing_pending_removal_mix() from public, anon, authenticated, service_role;

create function public.prevent_variation_listing_c2_copy_hard_delete()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  row_group_id uuid;
  row_pending boolean;
  capability_relation oid;
  capability_valid boolean := false;
begin
  select v.group_id, v.pending_removal_at is not null
    into row_group_id, row_pending
    from public.variation_listing_variations v
   where v.variation_id = old.variation_id;
  -- This guard is c2-specific. Non-staged aggregate deletes retain c1's
  -- ordinary aggregate/CAS authorization path.
  if row_pending is not true then
    return old;
  end if;
  capability_relation := pg_catalog.to_regclass('pg_temp.variation_listing_c2_capability');
  if current_setting('app.variation_listing_permanent_removal', true) = 'c2_finalize'
     and capability_relation is not null then
    select exists (
      select 1 from pg_catalog.pg_class c
       where c.oid = capability_relation
         and c.relowner = (select r.oid from pg_catalog.pg_roles r where r.rolname = current_user)
    ) and exists (
      select 1 from pg_temp.variation_listing_c2_capability cap
       where cap.mode = 'c2_finalize'
         and cap.group_id = nullif(current_setting('app.variation_listing_group_id', true), '')::uuid
         and cap.variation_id = old.variation_id
         and cap.group_id = row_group_id
         and cap.remaining > 2
    ) into capability_valid;
  end if;
  if not capability_valid then
    raise exception 'c2 copy hard delete requires dedicated finalization RPC' using errcode = 'VR002';
  end if;
  update pg_temp.variation_listing_c2_capability
     set remaining = remaining - 1
   where mode = 'c2_finalize'
     and group_id = row_group_id
     and variation_id = old.variation_id
     and remaining > 2;
  return old;
end;
$$;

create trigger variation_listing_copies_c2_hard_delete_guard
  before delete on public.variation_listing_copies
  for each row execute function public.prevent_variation_listing_c2_copy_hard_delete();

revoke all on function public.prevent_variation_listing_c2_copy_hard_delete() from public, anon, authenticated, service_role;

create function public.capture_variation_listing_permanent_removal_revision(
  p_group_id uuid,
  p_revision_id uuid,
  p_captured_desired_revision bigint,
  p_snapshot_digest text,
  p_snapshot jsonb,
  p_operation_plan jsonb
) returns table(revision jsonb)
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
declare
  g public.variation_listing_groups;
  v_target uuid;
  v_target_sku text;
  op jsonb;
  idx integer;
begin
  if p_group_id is null or p_revision_id is null or p_snapshot_digest !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(p_snapshot) is distinct from 'object'
     or jsonb_typeof(p_operation_plan) is distinct from 'array'
     or encode(extensions.digest(public.variation_listing_recovery_canonical_json(p_snapshot), 'sha256'), 'hex') is distinct from p_snapshot_digest
     or jsonb_typeof(p_snapshot->'aggregate') is distinct from 'object'
     or jsonb_typeof(p_snapshot->'aggregate'->'variations') is distinct from 'array'
     or jsonb_typeof(p_snapshot->'confirmed') is distinct from 'object'
     or jsonb_typeof(p_snapshot->'confirmed'->'aggregate') is distinct from 'object'
     or jsonb_typeof(p_snapshot->'confirmed'->'aggregate'->'variations') is distinct from 'array'
     or jsonb_array_length(p_snapshot->'aggregate'->'variations') < 2
     or jsonb_array_length(p_snapshot->'confirmed'->'aggregate'->'variations') < 3
     or jsonb_typeof(p_snapshot->'permanentRemoval') is distinct from 'object'
     or jsonb_array_length(p_operation_plan) <> 1 then
    raise exception 'invalid permanent-removal revision arguments' using errcode = 'VR002';
  end if;
  select * into g from public.variation_listing_groups where group_id = p_group_id for update;
  if not found or g.lifecycle_state <> 'active' or g.last_confirmed_revision is null
     or g.desired_revision <> p_captured_desired_revision
     or (select count(*) from public.variation_listing_variations v where v.group_id = p_group_id and v.pending_removal_at is not null) <> 1 then
    raise exception 'permanent-removal revision requires one active staged group' using errcode = 'VR002';
  end if;
  select v.variation_id, v.sku into v_target, v_target_sku
    from public.variation_listing_variations v
   where v.group_id = p_group_id and v.pending_removal_at is not null;
  -- The survivor and confirmed aggregates are durable authority for future
  -- revisions. Bind both aggregate group identities and every active local
  -- variation identity to this group before accepting the frozen snapshot.
  if p_snapshot->'aggregate'->'group'->>'group_id' is distinct from p_group_id::text
     or p_snapshot->'aggregate'->'group'->>'group_key' is distinct from g.group_key
     or p_snapshot->'aggregate'->'group'->>'marketplace_id' is distinct from g.marketplace_id
     or p_snapshot->'confirmed'->'aggregate'->'group'->>'group_id' is distinct from p_group_id::text
     or p_snapshot->'confirmed'->'aggregate'->'group'->>'group_key' is distinct from g.group_key
     or p_snapshot->'confirmed'->'aggregate'->'group'->>'marketplace_id' is distinct from g.marketplace_id
     or jsonb_array_length(p_snapshot->'aggregate'->'variations') <> (
       select count(*) - 1 from public.variation_listing_variations v
        where v.group_id = p_group_id
     )
     or jsonb_array_length(p_snapshot->'confirmed'->'aggregate'->'variations') <> (
       select count(*) from public.variation_listing_variations v
        where v.group_id = p_group_id
     )
     or exists (
       select 1 from jsonb_array_elements(p_snapshot->'aggregate'->'variations') x
        where x->>'variation_id' = v_target::text
           or x->>'sku' = v_target_sku
           or not exists (
             select 1 from public.variation_listing_variations v
              where v.group_id = p_group_id
                and v.variation_id::text = x->>'variation_id'
                and v.sku = x->>'sku'
           )
     )
     or exists (
       select 1 from public.variation_listing_variations v
        where v.group_id = p_group_id
          and v.variation_id <> v_target
          and not exists (
            select 1 from jsonb_array_elements(p_snapshot->'aggregate'->'variations') x
             where x->>'variation_id' = v.variation_id::text and x->>'sku' = v.sku
          )
     )
     or exists (
       select 1 from jsonb_array_elements(p_snapshot->'confirmed'->'aggregate'->'variations') x
        where not exists (
          select 1 from public.variation_listing_variations v
           where v.group_id = p_group_id
             and v.variation_id::text = x->>'variation_id'
             and v.sku = x->>'sku'
        )
     )
     or exists (
       select 1 from public.variation_listing_variations v
        where v.group_id = p_group_id
          and not exists (
            select 1 from jsonb_array_elements(p_snapshot->'confirmed'->'aggregate'->'variations') x
             where x->>'variation_id' = v.variation_id::text and x->>'sku' = v.sku
          )
     ) then
    raise exception 'permanent-removal snapshot variation ownership does not match the staged group' using errcode = 'VR002';
  end if;
  if p_snapshot->'permanentRemoval'->>'version' is distinct from '1'
     or p_snapshot->'permanentRemoval'->>'groupKey' is distinct from g.group_key
     or p_snapshot->'permanentRemoval'->>'marketplaceId' is distinct from g.marketplace_id
     or p_snapshot->'permanentRemoval'->>'targetVariationId' is distinct from v_target::text
     or p_snapshot->'permanentRemoval'->>'targetSku' is distinct from v_target_sku
     or jsonb_typeof(p_snapshot->'permanentRemoval'->'survivorSkus') is distinct from 'array'
     or jsonb_array_length(p_snapshot->'permanentRemoval'->'survivorSkus') < 2
     or jsonb_typeof(p_snapshot->'confirmed'->'remote') is distinct from 'object'
     or nullif(btrim(p_snapshot->'permanentRemoval'->>'listingId'), '') is null
     or p_snapshot->'permanentRemoval'->>'listingId' is distinct from p_snapshot->'confirmed'->'remote'->>'listingId'
     or jsonb_typeof(p_snapshot->'confirmed'->'remote'->'offerIdsBySku') is distinct from 'object'
     or jsonb_typeof(p_snapshot->'confirmed'->'remote'->'quantitiesBySku') is distinct from 'object'
     or (select count(*) from jsonb_object_keys(p_snapshot->'confirmed'->'remote'->'offerIdsBySku')) <>
        (select count(*) from jsonb_array_elements(p_snapshot->'aggregate'->'variations'))
     or (select count(*) from jsonb_object_keys(p_snapshot->'confirmed'->'remote'->'quantitiesBySku')) <>
        (select count(*) from jsonb_array_elements(p_snapshot->'aggregate'->'variations'))
     or jsonb_typeof(p_snapshot->'permanentRemoval'->'offerIdsBySku') is distinct from 'object'
     or jsonb_typeof(p_snapshot->'permanentRemoval'->'quantitiesBySku') is distinct from 'object'
     or jsonb_typeof(p_snapshot->'permanentRemoval'->'inventoryItemPayloadsBySku') is distinct from 'object'
     or jsonb_typeof(p_snapshot->'permanentRemoval'->'offerPayloadsBySku') is distinct from 'object'
     or (select count(*) from jsonb_object_keys(p_snapshot->'permanentRemoval'->'inventoryItemPayloadsBySku')) <>
        (select count(*) from jsonb_array_elements(p_snapshot->'confirmed'->'aggregate'->'variations'))
     or (select count(*) from jsonb_object_keys(p_snapshot->'permanentRemoval'->'offerPayloadsBySku')) <>
        (select count(*) from jsonb_array_elements(p_snapshot->'confirmed'->'aggregate'->'variations'))
     or exists (
       select 1 from jsonb_array_elements(p_snapshot->'confirmed'->'aggregate'->'variations') v
        where not (p_snapshot->'permanentRemoval'->'offerIdsBySku' ? (v->>'sku'))
           or not (p_snapshot->'permanentRemoval'->'quantitiesBySku' ? (v->>'sku'))
           or not (p_snapshot->'permanentRemoval'->'inventoryItemPayloadsBySku' ? (v->>'sku'))
           or not (p_snapshot->'permanentRemoval'->'offerPayloadsBySku' ? (v->>'sku'))
     )
     or exists (
       select 1 from jsonb_array_elements(p_snapshot->'aggregate'->'variations') v
        where p_snapshot->'confirmed'->'remote'->'offerIdsBySku'->(v->>'sku') is distinct from p_snapshot->'permanentRemoval'->'offerIdsBySku'->(v->>'sku')
           or p_snapshot->'confirmed'->'remote'->'quantitiesBySku'->(v->>'sku') is distinct from p_snapshot->'permanentRemoval'->'quantitiesBySku'->(v->>'sku')
     )
     or exists (
       select 1 from jsonb_object_keys(p_snapshot->'confirmed'->'remote'->'offerIdsBySku') k
        where not exists (select 1 from jsonb_array_elements(p_snapshot->'aggregate'->'variations') v where v->>'sku' = k)
     )
     or exists (
       select 1 from jsonb_object_keys(p_snapshot->'confirmed'->'remote'->'quantitiesBySku') k
        where not exists (select 1 from jsonb_array_elements(p_snapshot->'aggregate'->'variations') v where v->>'sku' = k)
     )
     or exists (
       select 1 from jsonb_object_keys(p_snapshot->'permanentRemoval'->'inventoryItemPayloadsBySku') k
        where not exists (select 1 from jsonb_array_elements(p_snapshot->'confirmed'->'aggregate'->'variations') v where v->>'sku' = k)
     )
     or exists (
       select 1 from jsonb_object_keys(p_snapshot->'permanentRemoval'->'offerPayloadsBySku') k
        where not exists (select 1 from jsonb_array_elements(p_snapshot->'confirmed'->'aggregate'->'variations') v where v->>'sku' = k)
     )
     or exists (
       select 1 from jsonb_each(p_snapshot->'permanentRemoval'->'inventoryItemPayloadsBySku') e where jsonb_typeof(e.value) is distinct from 'object'
     )
     or exists (
       select 1 from jsonb_each(p_snapshot->'permanentRemoval'->'offerPayloadsBySku') e where jsonb_typeof(e.value) is distinct from 'object'
     )
     or jsonb_array_length(p_snapshot->'aggregate'->'variations') <> jsonb_array_length(p_snapshot->'permanentRemoval'->'survivorSkus')
     or exists (
       select 1 from jsonb_array_elements_text(p_snapshot->'permanentRemoval'->'survivorSkus') s
        where not exists (select 1 from jsonb_array_elements(p_snapshot->'aggregate'->'variations') v where v->>'sku' = s)
     )
     or exists (
       select 1 from jsonb_array_elements(p_snapshot->'aggregate'->'variations') v
        where not exists (select 1 from jsonb_array_elements_text(p_snapshot->'permanentRemoval'->'survivorSkus') s where s = v->>'sku')
     ) then
    raise exception 'permanent-removal snapshot metadata does not match staged target/survivor projection' using errcode = 'VR002';
  end if;
  for op, idx in select value, ordinality::integer from jsonb_array_elements(p_operation_plan) with ordinality loop
    if jsonb_typeof(op) is distinct from 'object'
       or (op->>'sequence_no')::integer is distinct from idx
       or nullif(btrim(op->>'operation_key'),'') is null
       or nullif(btrim(op->>'target_ref'),'') is null
       or op->>'operation_key' is distinct from 'remove-group-membership'
       or op->>'operation_kind' is distinct from 'permanent_removal_group_membership'
       or op->>'target_ref' is distinct from g.group_key
       or op->>'intent_version' is distinct from '1'
       or jsonb_typeof(op->'intent') is distinct from 'object'
       or op->>'intent_digest' !~ '^[0-9a-f]{64}$'
       or encode(extensions.digest(public.variation_listing_recovery_canonical_json(op->'intent'), 'sha256'), 'hex') is distinct from op->>'intent_digest' then
      raise exception 'invalid permanent-removal operation plan' using errcode = 'VR002';
    end if;
  end loop;
  if (p_operation_plan->0->'intent'->>'groupKey' is distinct from g.group_key
     or nullif(btrim(p_operation_plan->0->'intent'->>'targetSku'), '') is null
     or p_operation_plan->0->'intent'->>'targetSku' is distinct from p_snapshot->'permanentRemoval'->>'targetSku'
     or jsonb_typeof(p_operation_plan->0->'intent'->'survivorSkus') is distinct from 'array'
     or jsonb_array_length(p_operation_plan->0->'intent'->'survivorSkus') < 2
     or p_operation_plan->0->'intent'->'survivorSkus' is distinct from p_snapshot->'permanentRemoval'->'survivorSkus'
     or exists (select 1 from jsonb_array_elements_text(p_operation_plan->0->'intent'->'survivorSkus') s where s = p_operation_plan->0->'intent'->>'targetSku')
     or (select count(*) from jsonb_array_elements_text(p_operation_plan->0->'intent'->'survivorSkus')) <>
        (select count(distinct s) from jsonb_array_elements_text(p_operation_plan->0->'intent'->'survivorSkus') s)
     or not exists (select 1 from jsonb_array_elements(p_snapshot->'confirmed'->'aggregate'->'variations') v where v->>'sku' = p_operation_plan->0->'intent'->>'targetSku')) then
    raise exception 'permanent-removal operation identity or survivor projection is invalid' using errcode = 'VR002';
  end if;
  drop table if exists pg_temp.variation_listing_c2_capability;
  create temp table variation_listing_c2_capability (
    mode text not null,
    group_id uuid not null,
    revision_id uuid,
    variation_id uuid,
    remaining integer not null check (remaining >= 0)
  ) on commit drop;
  insert into pg_temp.variation_listing_c2_capability(mode, group_id, revision_id, remaining)
    values ('c2_execute_revision', p_group_id, p_revision_id, 1);
  perform set_config('app.variation_listing_permanent_removal', 'c2_execute', true);
  perform set_config('app.variation_listing_group_id', p_group_id::text, true);
  insert into public.variation_listing_revisions(
    revision_id, group_id, captured_desired_revision, snapshot_version,
    snapshot_digest, snapshot, operation_count, operation_plan
  ) values (
    p_revision_id, p_group_id, p_captured_desired_revision, 3,
    p_snapshot_digest, p_snapshot, jsonb_array_length(p_operation_plan), p_operation_plan
  );
  return query select to_jsonb(r) from public.variation_listing_revisions r where r.revision_id = p_revision_id;
end;
$$;

create function public.append_variation_listing_permanent_removal_checkpoint(
  p_revision_id uuid,
  p_operation_key text,
  p_checkpoint_id uuid,
  p_attempt_number integer,
  p_checkpoint_number integer,
  p_state text,
  p_observed_remote_state text,
  p_evidence jsonb
) returns table(checkpoint jsonb)
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
declare
  r public.variation_listing_revisions;
  latest record;
begin
  select * into r from public.variation_listing_revisions where revision_id = p_revision_id for update;
  if not found or r.snapshot_version <> 3
     or jsonb_array_length(r.operation_plan) <> 1
     or p_operation_key <> 'remove-group-membership'
     or (r.operation_plan->0->>'operation_key') <> 'remove-group-membership'
     or (r.operation_plan->0->>'operation_kind') <> 'permanent_removal_group_membership' then
    raise exception 'permanent-removal checkpoint is outside the frozen plan' using errcode = 'VR004';
  end if;
  if p_state not in ('started','unknown','retry_authorized','retry_exhausted','confirmed_complete','confirmed_no_op')
     or p_evidence is null or jsonb_typeof(p_evidence) <> 'object' then
    raise exception 'invalid permanent-removal checkpoint' using errcode = 'VR002';
  end if;
  select * into latest from public.variation_listing_publishing_checkpoints c
   where c.revision_id = p_revision_id and c.operation_key = p_operation_key
   order by c.attempt_number desc, c.checkpoint_number desc limit 1;
  if latest.state in ('confirmed_complete','confirmed_no_op','retry_exhausted') then raise exception 'terminal permanent-removal checkpoint cannot reopen' using errcode = 'VR003'; end if;
  if latest.revision_id is null then
    if p_attempt_number <> 1 or p_checkpoint_number <> 1 or p_state <> 'started' or p_observed_remote_state is not null or p_evidence <> '{}'::jsonb then
      raise exception 'permanent-removal journal must begin with started attempt 1 checkpoint 1' using errcode = 'VR003';
    end if;
  elsif latest.state = 'started' then
    if p_attempt_number <> latest.attempt_number or p_checkpoint_number <> latest.checkpoint_number + 1
       or p_state not in ('unknown','retry_exhausted','confirmed_complete','confirmed_no_op')
       or (p_state = 'unknown' and exists (
         select 1 from public.variation_listing_publishing_checkpoints prior
          where prior.revision_id = p_revision_id and prior.operation_key = p_operation_key
            and prior.state = 'retry_authorized'
       ))
       or (p_state = 'retry_exhausted' and not exists (
         select 1 from public.variation_listing_publishing_checkpoints prior
          where prior.revision_id = p_revision_id and prior.operation_key = p_operation_key
            and prior.state = 'retry_authorized'
       )) then
      raise exception 'started checkpoint must resolve on the same attempt' using errcode = 'VR003';
    end if;
  elsif latest.state = 'unknown' then
    if p_state = 'retry_authorized' then
      if p_attempt_number <> latest.attempt_number + 1 or p_checkpoint_number <> 1
         or exists (
           select 1 from public.variation_listing_publishing_checkpoints prior
            where prior.revision_id = p_revision_id and prior.operation_key = p_operation_key
              and prior.state = 'retry_authorized'
         ) then
        raise exception 'unknown checkpoint retry authorization requires next attempt checkpoint 1' using errcode = 'VR003';
      end if;
    elsif p_state in ('confirmed_complete','confirmed_no_op') then
      if p_attempt_number <> latest.attempt_number or p_checkpoint_number <> latest.checkpoint_number + 1 then
        raise exception 'unknown checkpoint exact reconciliation must remain on the same attempt' using errcode = 'VR003';
      end if;
    else
      raise exception 'unknown checkpoint requires one bounded resolution' using errcode = 'VR003';
    end if;
  elsif latest.state = 'retry_authorized' then
    if p_attempt_number <> latest.attempt_number or p_checkpoint_number <> latest.checkpoint_number + 1 or p_state <> 'started' then
      raise exception 'retry authorization permits exactly one started replay' using errcode = 'VR003';
    end if;
  end if;
  if p_state in ('confirmed_complete','confirmed_no_op','retry_authorized') and (p_observed_remote_state not in ('present','proven_absent') or p_evidence = '{}'::jsonb) then raise exception 'resolved permanent-removal checkpoint requires exact evidence' using errcode = 'VR003'; end if;
  if p_state = 'retry_exhausted' and (p_observed_remote_state is distinct from 'unknown' or p_evidence = '{}'::jsonb) then raise exception 'retry-exhausted checkpoint requires ambiguity evidence' using errcode = 'VR003'; end if;
  if p_state = 'started' and p_observed_remote_state is not null then raise exception 'started permanent-removal checkpoint cannot claim evidence' using errcode = 'VR003'; end if;
  if p_state = 'unknown' and (p_observed_remote_state is distinct from 'unknown' or p_evidence = '{}'::jsonb) then raise exception 'unknown permanent-removal checkpoint requires ambiguity evidence' using errcode = 'VR003'; end if;
  if p_state = 'retry_exhausted' and latest.state <> 'started' then raise exception 'retry-exhausted checkpoint must resolve a replay attempt' using errcode = 'VR003'; end if;
  drop table if exists pg_temp.variation_listing_c2_capability;
  create temp table variation_listing_c2_capability (
    mode text not null,
    group_id uuid not null,
    revision_id uuid,
    variation_id uuid,
    remaining integer not null check (remaining >= 0)
  ) on commit drop;
  insert into pg_temp.variation_listing_c2_capability(mode, group_id, revision_id, remaining)
    values ('c2_execute_checkpoint', r.group_id, p_revision_id, 1);
  perform set_config('app.variation_listing_permanent_removal', 'c2_execute', true);
  perform set_config('app.variation_listing_group_id', r.group_id::text, true);
  insert into public.variation_listing_publishing_checkpoints(
    checkpoint_id, revision_id, operation_key, attempt_number, checkpoint_number,
    state, observed_remote_state, evidence
  ) values (
    p_checkpoint_id, p_revision_id, p_operation_key, p_attempt_number, p_checkpoint_number,
    p_state, p_observed_remote_state, p_evidence
  );
  return query select to_jsonb(c) from public.variation_listing_publishing_checkpoints c where c.checkpoint_id = p_checkpoint_id;
end;
$$;

create function public.confirm_variation_listing_permanent_removal(
  p_group_id uuid, p_revision_id uuid, p_expected_previous_confirmed_revision bigint,
  p_confirmed_revision bigint, p_target_variation_id uuid, p_target_sku text
) returns table(group_row jsonb)
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
declare
  g public.variation_listing_groups; r public.variation_listing_revisions;
  v public.variation_listing_variations; latest record; frozen_copies jsonb;
begin
  perform 1 from public.variation_listing_intake_sessions s order by s.capture_source_key for update;
  select * into g from public.variation_listing_groups where group_id = p_group_id for update;
  if not found then raise exception 'variation listing group not found' using errcode = 'VR004'; end if;
  select * into r from public.variation_listing_revisions
    where revision_id = p_revision_id and group_id = p_group_id for update;
  if r.revision_id is null or r.snapshot_version <> 3
     or r.captured_desired_revision is distinct from p_confirmed_revision
     or r.operation_count <> 1
     or jsonb_array_length(r.operation_plan) <> 1
     or r.operation_plan->0->>'operation_key' is distinct from 'remove-group-membership'
     or r.operation_plan->0->>'operation_kind' is distinct from 'permanent_removal_group_membership'
     or r.operation_plan->0->>'target_ref' is distinct from g.group_key
     or r.snapshot_digest is distinct from encode(extensions.digest(public.variation_listing_recovery_canonical_json(r.snapshot), 'sha256'), 'hex')
     or r.snapshot->'permanentRemoval'->>'groupKey' is distinct from g.group_key
     or r.snapshot->'permanentRemoval'->>'targetVariationId' is distinct from p_target_variation_id::text
     or r.snapshot->'permanentRemoval'->>'targetSku' is distinct from p_target_sku
     or r.snapshot->'aggregate'->'group'->>'group_id' is distinct from p_group_id::text
     or r.snapshot->'confirmed'->'aggregate'->'group'->>'group_id' is distinct from p_group_id::text
     or jsonb_typeof(r.snapshot->'aggregate'->'variations') is distinct from 'array'
     or jsonb_array_length(r.snapshot->'aggregate'->'variations') < 2
     or exists (select 1 from jsonb_array_elements(r.snapshot->'aggregate'->'variations') x
                 where x->>'variation_id' = p_target_variation_id::text or x->>'sku' = p_target_sku)
     or not exists (select 1 from jsonb_array_elements(r.snapshot->'confirmed'->'aggregate'->'variations') x
                 where x->>'variation_id' = p_target_variation_id::text and x->>'sku' = p_target_sku) then
    raise exception 'permanent-removal frozen revision identity/projection invalid' using errcode = 'VR002';
  end if;
  select * into latest from public.variation_listing_publishing_checkpoints
   where revision_id = p_revision_id and operation_key = 'remove-group-membership'
   order by attempt_number desc, checkpoint_number desc limit 1;
  if latest.state not in ('confirmed_complete','confirmed_no_op')
     or latest.observed_remote_state not in ('present','proven_absent')
     or latest.evidence is distinct from jsonb_build_object(
       'listingId', r.snapshot->'confirmed'->'remote'->>'listingId',
       'targetSku', r.snapshot->'permanentRemoval'->>'targetSku',
       'survivorSkus', r.snapshot->'permanentRemoval'->'survivorSkus',
       'state', 'removed') then
    raise exception 'permanent-removal membership checkpoint is not exact terminal proof' using errcode = 'VR004';
  end if;
  select * into v from public.variation_listing_variations
    where group_id = p_group_id and variation_id = p_target_variation_id for update;
  if v.variation_id is null then
    if g.last_confirmed_revision >= p_confirmed_revision then
      return query select to_jsonb(x) from public.variation_listing_groups x where x.group_id=p_group_id;
      return;
    end if;
    raise exception 'permanent-removal target absent before confirmation' using errcode = 'VR002';
  end if;
  -- Intake is locked above. Re-check every survivor identity and copy key at
  -- finalization so no post-capture sibling move or omission is finalized.
  if exists (
       select 1 from public.variation_listing_variations sv
        where sv.group_id = p_group_id and sv.variation_id <> p_target_variation_id
          and not exists (
            select 1 from jsonb_array_elements(r.snapshot->'aggregate'->'variations') x
             where x->>'variation_id' = sv.variation_id::text and x->>'sku' = sv.sku
          )
     )
     or exists (
       select 1 from jsonb_array_elements(r.snapshot->'aggregate'->'variations') x
        where not exists (
          select 1 from public.variation_listing_variations sv
           where sv.group_id = p_group_id
             and sv.variation_id::text = x->>'variation_id'
             and sv.sku = x->>'sku'
        )
     )
     or exists (
       select 1 from public.variation_listing_copies c
        join public.variation_listing_variations sv on sv.variation_id = c.variation_id
        where sv.group_id = p_group_id and sv.variation_id <> p_target_variation_id
          and not exists (
            select 1 from jsonb_array_elements(r.snapshot->'aggregate'->'copies') x
             where x->>'copy_id' = c.copy_id::text
               and x->>'variation_id' = c.variation_id::text
               and x->>'front_r2_key' = c.front_r2_key
               and x->>'back_r2_key' = c.back_r2_key
          )
     )
     or exists (
       select 1 from jsonb_array_elements(r.snapshot->'aggregate'->'copies') x
        where x->>'variation_id' <> p_target_variation_id::text
          and not exists (
            select 1 from public.variation_listing_copies c
             where c.copy_id::text = x->>'copy_id'
               and c.variation_id::text = x->>'variation_id'
               and c.front_r2_key = x->>'front_r2_key'
               and c.back_r2_key = x->>'back_r2_key'
          )
     ) then
    raise exception 'permanent-removal survivor projection changed after capture' using errcode = 'VR002';
  end if;
  if g.lifecycle_state <> 'active'
     or g.last_confirmed_revision is distinct from p_expected_previous_confirmed_revision
     or g.desired_revision <> p_confirmed_revision or v.sku <> p_target_sku
     or v.pending_removal_at is null then
    raise exception 'permanent-removal confirmation precondition failed' using errcode = 'VR002';
  end if;
  -- Preserve exact target image keys only in the immutable v3 revision.
  -- Fail rather than hard-delete local records if the snapshot cannot later
  -- identify every R2 object for YP9.6c4's separately authorized purge.
  frozen_copies := r.snapshot->'confirmed'->'aggregate'->'copies';
  if jsonb_typeof(frozen_copies) is distinct from 'array'
     or (select count(*) from public.variation_listing_copies c where c.variation_id=p_target_variation_id)
        <> (select count(*) from jsonb_array_elements(frozen_copies) x
             where x->>'variation_id'=p_target_variation_id::text)
     or exists (select 1 from public.variation_listing_copies c
                 where c.variation_id=p_target_variation_id and not exists (
                   select 1 from jsonb_array_elements(frozen_copies) x
                    where x->>'variation_id'=p_target_variation_id::text
                      and x->>'copy_id'=c.copy_id::text
                      and x->>'front_r2_key'=c.front_r2_key
                      and x->>'back_r2_key'=c.back_r2_key))
     or exists (select 1 from jsonb_array_elements(frozen_copies) x
                 where x->>'variation_id'=p_target_variation_id::text and not exists (
                   select 1 from public.variation_listing_copies c
                    where c.variation_id=p_target_variation_id
                      and c.copy_id::text=x->>'copy_id'
                      and c.front_r2_key=x->>'front_r2_key'
                      and c.back_r2_key=x->>'back_r2_key')) then
    raise exception 'frozen removal revision does not cover all target copy/R2 keys' using errcode = 'VR002';
  end if;
  -- Copy FK requires deleting target copies before the target variation.
  -- Representative-copy FK is deferred. All these DB writes are atomic. The
  -- capability count is consumed once per target copy, then by variation and
  -- group writes; a forgeable GUC alone cannot authorize a hard delete.
  drop table if exists pg_temp.variation_listing_c2_capability;
  create temp table variation_listing_c2_capability (
    mode text not null, group_id uuid not null, revision_id uuid,
    variation_id uuid, remaining integer not null check (remaining >= 0)
  ) on commit drop;
  insert into pg_temp.variation_listing_c2_capability(mode,group_id,revision_id,variation_id,remaining)
    select 'c2_finalize',p_group_id,p_revision_id,p_target_variation_id,count(*)::integer + 2
      from public.variation_listing_copies
     where variation_id=p_target_variation_id;
  perform set_config('app.variation_listing_permanent_removal','c2_finalize',true);
  perform set_config('app.variation_listing_group_id',p_group_id::text,true);
  perform set_config('app.variation_listing_variation_id',p_target_variation_id::text,true);
  perform set_config('app.variation_listing_write_scope','aggregate',true);
  perform set_config('app.variation_listing_expected_revision',(g.desired_revision - 1)::text,true);
  create temp table variation_listing_aggregate_revision_proof (
    transaction_id xid8 not null,
    group_id uuid not null,
    from_revision bigint not null,
    to_revision bigint not null
  ) on commit drop;
  insert into pg_temp.variation_listing_aggregate_revision_proof
    (transaction_id, group_id, from_revision, to_revision)
  values (pg_current_xact_id(), p_group_id, g.desired_revision - 1, g.desired_revision);
  delete from public.variation_listing_copies c where c.variation_id=p_target_variation_id;
  delete from public.variation_listing_variations
    where group_id=p_group_id and variation_id=p_target_variation_id
      and sku=p_target_sku and pending_removal_at is not null;
  if not found then raise exception 'target vanished during hard deletion' using errcode = 'VR002'; end if;
  perform set_config('app.variation_listing_write_scope','confirmation',true);
  update public.variation_listing_groups set last_confirmed_revision=p_confirmed_revision
    where group_id=p_group_id;
  return query select to_jsonb(x) from public.variation_listing_groups x where x.group_id=p_group_id;
end;
$$;

revoke all on function public.capture_variation_listing_permanent_removal_revision(uuid,uuid,bigint,text,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.append_variation_listing_permanent_removal_checkpoint(uuid,text,uuid,integer,integer,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.confirm_variation_listing_permanent_removal(uuid,uuid,bigint,bigint,uuid,text) from public, anon, authenticated;
grant execute on function public.capture_variation_listing_permanent_removal_revision(uuid,uuid,bigint,text,jsonb,jsonb) to service_role;
grant execute on function public.append_variation_listing_permanent_removal_checkpoint(uuid,text,uuid,integer,integer,text,text,jsonb) to service_role;
grant execute on function public.confirm_variation_listing_permanent_removal(uuid,uuid,bigint,bigint,uuid,text) to service_role;

commit;
