begin;

-- YP9.6b1: post-publication sellable quantity is eBay-authoritative.
-- Local intent is a cumulative signed counter per variation/SKU. A confirmed
-- revision freezes the counter value, so the next active revision applies only
-- the counter delta to a fresh remote eBay sellable baseline.
alter table public.variation_listing_variations
  add column quantity_adjustment_counter integer not null default 0;

comment on column public.variation_listing_variations.quantity_adjustment_counter is
  'Cumulative local post-publication quantity adjustment counter. eBay sales do not modify this value.';

create function public.update_variation_listing_quantity_adjustment(
  p_group_id uuid,
  p_variation_id uuid,
  p_expected_desired_revision bigint,
  p_delta integer
) returns table(group_row jsonb, variation_row jsonb)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp as $$
declare
  v_group public.variation_listing_groups;
  v_variation public.variation_listing_variations;
  v_next_counter bigint;
begin
  if p_expected_desired_revision is null or p_expected_desired_revision < 0 then
    raise exception 'variation listing quantity adjustment expected revision is invalid' using errcode = 'VR002';
  end if;
  if p_delta is null or p_delta not in (-1, 1) then
    raise exception 'variation listing quantity adjustment delta must be -1 or 1' using errcode = 'VR002';
  end if;

  select * into v_group
    from public.variation_listing_groups
   where group_id = p_group_id
   for update;
  if not found then
    raise exception 'variation listing group not found' using errcode = 'VR004';
  end if;
  if v_group.desired_revision <> p_expected_desired_revision then
    raise exception 'variation listing quantity adjustment CAS mismatch' using errcode = 'VR001';
  end if;
  if v_group.lifecycle_state <> 'active' then
    raise exception 'variation listing quantity adjustment requires active lifecycle' using errcode = 'VR002';
  end if;

  select * into v_variation
    from public.variation_listing_variations
   where variation_id = p_variation_id
     and group_id = p_group_id
   for update;
  if not found then
    raise exception 'variation listing variation not found in group' using errcode = 'VR004';
  end if;

  v_next_counter := v_variation.quantity_adjustment_counter::bigint + p_delta::bigint;
  if v_next_counter < -2147483648 or v_next_counter > 2147483647 then
    raise exception 'variation listing quantity adjustment counter exceeds int32 range' using errcode = 'VR002';
  end if;

  update public.variation_listing_variations
     set quantity_adjustment_counter = v_next_counter::integer
   where variation_id = p_variation_id
     and group_id = p_group_id;

  update public.variation_listing_groups
     set desired_revision = desired_revision + 1
   where group_id = p_group_id;

  return query
  select to_jsonb(g), to_jsonb(v)
    from public.variation_listing_groups g
    join public.variation_listing_variations v on v.group_id = g.group_id
   where g.group_id = p_group_id
     and v.variation_id = p_variation_id;
end;
$$;

-- Duplicate capture keeps its existing idempotent copy record, and for an
-- already-active listing stages exactly +1 through the same cumulative counter.
create or replace function public.complete_variation_listing_duplicate_copy(
  p_capture_source_key text, p_copy_id uuid, p_capture_pair_id uuid, p_variation_id uuid,
  p_condition_token text, p_front_r2_key text, p_back_r2_key text,
  p_back_source_ref text, p_captured_at timestamptz
) returns table(group_row jsonb, copy_row jsonb)
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
declare
  s public.variation_listing_intake_sessions;
  g public.variation_listing_groups;
  v public.variation_listing_variations;
  c public.variation_listing_copies;
  frozen_condition text;
  session_found boolean;
begin
  if p_condition_token is null or p_condition_token not in ('NEAR_MINT_OR_BETTER','EXCELLENT','VERY_GOOD','POOR') then
    raise exception 'variation listing copy condition is invalid' using errcode = 'VR002';
  end if;
  select * into c from public.variation_listing_copies where capture_pair_id = p_capture_pair_id;
  if found then
    select * into v from public.variation_listing_variations where variation_id = c.variation_id;
    select * into g from public.variation_listing_groups where group_id = v.group_id;
    if c.copy_id is distinct from p_copy_id or c.variation_id is distinct from p_variation_id
       or c.condition_token is distinct from p_condition_token
       or c.capture_source_key is distinct from p_capture_source_key
       or c.front_r2_key is distinct from p_front_r2_key or c.back_r2_key is distinct from p_back_r2_key
       or c.capture_back_source_ref is distinct from p_back_source_ref then
      raise exception 'capture pair retry conflicts with persisted copy' using errcode = 'VR001';
    end if;
    if not found or g.group_id is null then raise exception 'target group not found' using errcode = 'VR004'; end if;
    return query select to_jsonb(g), to_jsonb(c);
    return;
  end if;

  select * into s from public.variation_listing_intake_sessions
   where capture_source_key = p_capture_source_key for update;
  session_found := found;
  select * into c from public.variation_listing_copies where capture_pair_id = p_capture_pair_id;
  if found then
    select * into v from public.variation_listing_variations where variation_id = c.variation_id;
    select * into g from public.variation_listing_groups where group_id = v.group_id;
    if c.copy_id is distinct from p_copy_id or c.variation_id is distinct from p_variation_id
       or c.condition_token is distinct from p_condition_token
       or c.capture_source_key is distinct from p_capture_source_key
       or c.front_r2_key is distinct from p_front_r2_key or c.back_r2_key is distinct from p_back_r2_key
       or c.capture_back_source_ref is distinct from p_back_source_ref then
      raise exception 'capture pair retry conflicts with persisted copy' using errcode = 'VR001';
    end if;
    if not found or g.group_id is null then raise exception 'target group not found' using errcode = 'VR004'; end if;
    return query select to_jsonb(g), to_jsonb(c);
    return;
  end if;
  if not session_found or s.pending_pair is null or s.mode <> 'duplicate_copy' then
    raise exception 'pending duplicate-copy pair required' using errcode = 'VR002';
  end if;
  if p_capture_pair_id::text <> s.pending_pair->>'pair_id'
     or s.pending_pair->>'mode' <> 'duplicate_copy'
     or s.target_group_id::text <> s.pending_pair->>'target_group_id'
     or p_variation_id::text <> s.pending_pair->>'target_variation_id'
     or s.target_variation_id is distinct from p_variation_id
     or s.sticky_price_amount <> (s.pending_pair->>'price_amount')::numeric
     or s.copy_condition_token is distinct from (s.pending_pair->>'condition_token')
     or p_condition_token is distinct from (s.pending_pair->>'condition_token') then
    raise exception 'duplicate copy does not match pending snapshot' using errcode = 'VR001';
  end if;
  frozen_condition := s.pending_pair->>'condition_token';
  select * into g from public.variation_listing_groups where group_id = s.target_group_id for update;
  if not found then raise exception 'target group not found' using errcode = 'VR004'; end if;
  select * into v from public.variation_listing_variations
   where variation_id = s.target_variation_id and group_id = g.group_id;
  if not found then raise exception 'target variation does not belong to target group' using errcode = 'VR002'; end if;
  if g.desired_revision <> (s.pending_pair->>'expected_desired_revision')::bigint then
    raise exception 'stale intake desired revision' using errcode = 'VR001';
  end if;
  if (case frozen_condition when 'POOR' then 0 when 'VERY_GOOD' then 1 when 'EXCELLENT' then 2 when 'NEAR_MINT_OR_BETTER' then 3 end)
     < (case g.condition_token when 'POOR' then 0 when 'VERY_GOOD' then 1 when 'EXCELLENT' then 2 when 'NEAR_MINT_OR_BETTER' then 3 end) then
    raise exception 'copy condition is worse than group condition' using errcode = 'VR002';
  end if;
  if g.lifecycle_state = 'active' and v.quantity_adjustment_counter = 2147483647 then
    raise exception 'variation listing quantity adjustment counter exceeds int32 range' using errcode = 'VR002';
  end if;

  insert into public.variation_listing_copies(
    copy_id, variation_id, condition_token, front_r2_key, back_r2_key,
    capture_source_key, capture_pair_id, capture_front_source_ref,
    capture_back_source_ref, capture_started_at, captured_at
  ) values (
    p_copy_id, s.target_variation_id, frozen_condition, p_front_r2_key, p_back_r2_key,
    p_capture_source_key, p_capture_pair_id, s.pending_pair->>'front_source_ref',
    p_back_source_ref, (s.pending_pair->>'started_at')::timestamptz, coalesce(p_captured_at, now())
  );

  if g.lifecycle_state = 'active' then
    update public.variation_listing_variations
       set quantity_adjustment_counter = quantity_adjustment_counter + 1
     where variation_id = s.target_variation_id
       and group_id = g.group_id;
  end if;
  update public.variation_listing_groups set desired_revision = desired_revision + 1 where group_id = g.group_id;
  update public.variation_listing_intake_sessions set pending_pair = null where capture_source_key = p_capture_source_key;
  return query select to_jsonb(x), to_jsonb(y)
    from public.variation_listing_groups x
    join public.variation_listing_copies y on y.copy_id = p_copy_id
   where x.group_id = g.group_id;
end;
$$;

revoke all on function public.update_variation_listing_quantity_adjustment(uuid,uuid,bigint,integer)
  from public, anon, authenticated;
grant execute on function public.update_variation_listing_quantity_adjustment(uuid,uuid,bigint,integer)
  to service_role;

commit;
