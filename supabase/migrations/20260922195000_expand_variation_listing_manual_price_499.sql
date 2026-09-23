-- Expand to the nine exact Variation listing manual price tiers through $4.99.
-- Source-only and unapplied. Do not run against hosted Supabase without
-- separate operator authorization. The table lock is intentionally bounded
-- to the three effective price constraints; no rows are backfilled. A failed
-- statement rolls back this transaction; any compensating rollback must first
-- prove that no stored row or pending snapshot uses 3.49, 3.99, 4.49, or 4.99.
begin;

lock table public.variation_listing_variations,
  public.variation_listing_intake_sessions
  in access exclusive mode;

-- Preserve every existing variation invariant while widening only its price gate.
alter table public.variation_listing_variations
  drop constraint if exists variation_listing_variations_price_amount_check;
alter table public.variation_listing_variations
  add constraint variation_listing_variations_price_amount_check
  check (price_amount in (0.99, 1.49, 1.99, 2.49, 2.99, 3.49, 3.99, 4.49, 4.99));

-- Sticky intake price remains USD and all other session checks are unchanged.
alter table public.variation_listing_intake_sessions
  drop constraint if exists variation_listing_intake_sessions_sticky_price_check;
alter table public.variation_listing_intake_sessions
  add constraint variation_listing_intake_sessions_sticky_price_check
  check (sticky_price_amount in (0.99, 1.49, 1.99, 2.49, 2.99, 3.49, 3.99, 4.49, 4.99));

-- Replace only the effective frozen pending-pair JSON shape check. Keep its
-- identity, mode, target, currency, source, revision, and condition invariants.
alter table public.variation_listing_intake_sessions
  drop constraint if exists variation_listing_intake_sessions_pending_pair_check;
alter table public.variation_listing_intake_sessions
  add constraint variation_listing_intake_sessions_pending_pair_check check (
    pending_pair is null or (jsonb_typeof(pending_pair) = 'object'
      and pending_pair ? 'pair_id' and pending_pair ? 'mode'
      and pending_pair ? 'target_group_id' and pending_pair ? 'target_variation_id'
      and pending_pair ? 'price_amount' and pending_pair ? 'price_currency'
      and pending_pair ? 'front_source_ref' and pending_pair ? 'started_at'
      and pending_pair ? 'expected_desired_revision'
      and pending_pair ? 'condition_token'
      and jsonb_typeof(pending_pair->'pair_id') = 'string'
      and (pending_pair->>'mode') in ('new_variation','duplicate_copy')
      and jsonb_typeof(pending_pair->'target_group_id') = 'string'
      and ((pending_pair->>'mode' = 'new_variation' and pending_pair->'target_variation_id' = 'null'::jsonb)
        or (pending_pair->>'mode' = 'duplicate_copy' and jsonb_typeof(pending_pair->'target_variation_id') = 'string'))
      and jsonb_typeof(pending_pair->'price_amount') = 'number'
      and (pending_pair->>'price_amount')::numeric in (0.99,1.49,1.99,2.49,2.99,3.49,3.99,4.49,4.99)
      and pending_pair->>'price_currency' = 'USD'
      and nullif(btrim(pending_pair->>'front_source_ref'),'') is not null
      and jsonb_typeof(pending_pair->'started_at') = 'string'
      and jsonb_typeof(pending_pair->'expected_desired_revision') = 'number'
      and (pending_pair->>'expected_desired_revision') ~ '^[0-9]+$'
      and ((pending_pair->>'mode' = 'new_variation' and pending_pair->'condition_token' = 'null'::jsonb)
        or (pending_pair->>'mode' = 'duplicate_copy'
          and jsonb_typeof(pending_pair->'condition_token') = 'string'
          and pending_pair->>'condition_token' in ('NEAR_MINT_OR_BETTER','EXCELLENT','VERY_GOOD','POOR')))
  ));

-- Keep the effective six-argument, condition-aware intake RPC's locking,
-- lifecycle, target ownership, and service-role boundary unchanged.
create or replace function public.configure_variation_listing_intake(
  p_capture_source_key text,
  p_mode text,
  p_target_group_id uuid,
  p_target_variation_id uuid,
  p_sticky_price_amount numeric,
  p_copy_condition_token text
) returns table(session_row jsonb)
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
declare
  s public.variation_listing_intake_sessions;
  g public.variation_listing_groups;
begin
  if nullif(btrim(p_capture_source_key), '') is null or p_capture_source_key <> btrim(p_capture_source_key) then
    raise exception 'capture source key is invalid' using errcode = 'VR002';
  end if;
  if p_mode is null or p_mode not in ('idle','new_variation','duplicate_copy') then
    raise exception 'intake mode is invalid' using errcode = 'VR002';
  end if;
  if p_sticky_price_amount is null or p_sticky_price_amount not in (0.99,1.49,1.99,2.49,2.99,3.49,3.99,4.49,4.99) then
    raise exception 'sticky price amount is invalid' using errcode = 'VR002';
  end if;
  if p_copy_condition_token is not null
     and p_copy_condition_token not in ('NEAR_MINT_OR_BETTER','EXCELLENT','VERY_GOOD','POOR') then
    raise exception 'copy condition is invalid' using errcode = 'VR002';
  end if;

  insert into public.variation_listing_intake_sessions(capture_source_key)
  values (p_capture_source_key)
  on conflict (capture_source_key) do nothing;
  select * into s from public.variation_listing_intake_sessions
   where capture_source_key = p_capture_source_key for update;
  if s.pending_pair is not null then
    raise exception 'pending pair locks intake target' using errcode = 'VR001';
  end if;

  if p_mode = 'idle' then
    if p_target_group_id is not null or p_target_variation_id is not null or p_copy_condition_token is not null then
      raise exception 'idle intake cannot have targets or copy condition' using errcode = 'VR002';
    end if;
  elsif p_mode = 'new_variation' then
    if p_target_group_id is null or p_target_variation_id is not null or p_copy_condition_token is not null then
      raise exception 'new-variation intake targets or copy condition are invalid' using errcode = 'VR002';
    end if;
    select * into g from public.variation_listing_groups where group_id = p_target_group_id for share;
    if not found then raise exception 'target group not found' using errcode = 'VR004'; end if;
  else
    if p_target_group_id is null or p_target_variation_id is null or p_copy_condition_token is null then
      raise exception 'duplicate-copy intake requires target and copy condition' using errcode = 'VR002';
    end if;
    select * into g from public.variation_listing_groups where group_id = p_target_group_id for share;
    if not found then raise exception 'target group not found' using errcode = 'VR004'; end if;
    if not exists (
      select 1 from public.variation_listing_variations v
       where v.group_id = p_target_group_id and v.variation_id = p_target_variation_id
    ) then
      raise exception 'target variation does not belong to target group' using errcode = 'VR002';
    end if;
    if (case p_copy_condition_token when 'POOR' then 0 when 'VERY_GOOD' then 1 when 'EXCELLENT' then 2 when 'NEAR_MINT_OR_BETTER' then 3 end)
       < (case g.condition_token when 'POOR' then 0 when 'VERY_GOOD' then 1 when 'EXCELLENT' then 2 when 'NEAR_MINT_OR_BETTER' then 3 end) then
      raise exception 'copy condition is worse than group condition' using errcode = 'VR002';
    end if;
  end if;

  update public.variation_listing_intake_sessions
     set mode = p_mode,
         target_group_id = p_target_group_id,
         target_variation_id = p_target_variation_id,
         sticky_price_amount = p_sticky_price_amount,
         copy_condition_token = p_copy_condition_token
   where capture_source_key = p_capture_source_key;
  return query select to_jsonb(x) from public.variation_listing_intake_sessions x
   where x.capture_source_key = p_capture_source_key;
end;
$$;

-- Keep active-lifecycle staging, group lock/CAS, ownership, single revision
-- increment, SECURITY DEFINER, pinned search_path, and service-only ACLs.
create or replace function public.update_variation_listing_manual_price(
  p_group_id uuid,
  p_variation_id uuid,
  p_expected_desired_revision bigint,
  p_price_amount numeric
) returns table (group_row jsonb, variation_row jsonb)
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_group public.variation_listing_groups; v_variation public.variation_listing_variations;
begin
  if p_expected_desired_revision is null or p_expected_desired_revision < 0 then raise exception 'variation listing price edit expected revision is invalid' using errcode = 'VR002'; end if;
  if p_price_amount is null or p_price_amount not in (0.99,1.49,1.99,2.49,2.99,3.49,3.99,4.49,4.99) then raise exception 'variation listing price edit amount is invalid' using errcode = 'VR002'; end if;
  select * into v_group from public.variation_listing_groups where group_id=p_group_id for update;
  if not found then raise exception 'variation listing group not found' using errcode = 'VR004'; end if;
  if v_group.desired_revision <> p_expected_desired_revision then raise exception 'variation listing price edit CAS mismatch' using errcode = 'VR001'; end if;
  if v_group.lifecycle_state not in ('intake','draft','review','active') then raise exception 'variation listing group lifecycle is not editable' using errcode = 'VR002'; end if;
  select * into v_variation from public.variation_listing_variations where variation_id=p_variation_id and group_id=p_group_id;
  if not found then raise exception 'variation listing variation not found in group' using errcode = 'VR004'; end if;
  if v_variation.price_amount = p_price_amount then raise exception 'variation listing price edit must change the price' using errcode = 'VR002'; end if;
  update public.variation_listing_variations set price_amount=p_price_amount where variation_id=p_variation_id and group_id=p_group_id;
  update public.variation_listing_groups set desired_revision=desired_revision+1 where group_id=p_group_id;
  return query select to_jsonb(g),to_jsonb(v) from public.variation_listing_groups g join public.variation_listing_variations v on v.group_id=g.group_id where g.group_id=p_group_id and v.variation_id=p_variation_id;
end; $$;

revoke execute on function public.configure_variation_listing_intake(text,text,uuid,uuid,numeric,text)
  from public, anon, authenticated;
grant execute on function public.configure_variation_listing_intake(text,text,uuid,uuid,numeric,text)
  to service_role;
revoke execute on function public.update_variation_listing_manual_price(uuid, uuid, bigint, numeric)
  from public, anon, authenticated;
grant execute on function public.update_variation_listing_manual_price(uuid, uuid, bigint, numeric)
  to service_role;

commit;
