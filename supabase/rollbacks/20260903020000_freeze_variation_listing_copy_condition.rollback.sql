-- YP7.2b rollback. Refuses to discard a live non-group duplicate condition.
begin;

lock table public.variation_listing_groups,
  public.variation_listing_variations,
  public.variation_listing_copies,
  public.variation_listing_intake_sessions
  in access exclusive mode;

do $$
begin
  -- Completed copies retain their own condition_token in the prior schema, so
  -- only live duplicate session/pending snapshots can lose new semantics.
  if exists (
    select 1
      from public.variation_listing_intake_sessions s
      join public.variation_listing_groups g on g.group_id = s.target_group_id
     where s.mode = 'duplicate_copy'
       and s.copy_condition_token is distinct from g.condition_token
  ) then
    raise exception 'YP7.2b rollback refused: live duplicate session condition would be lost';
  end if;
  if exists (
    select 1
      from public.variation_listing_intake_sessions s
      join public.variation_listing_groups g on g.group_id = s.target_group_id
     where s.pending_pair is not null
       and s.pending_pair->>'mode' = 'duplicate_copy'
       and s.pending_pair->>'condition_token' is distinct from g.condition_token
  ) then
    raise exception 'YP7.2b rollback refused: live pending duplicate condition would be lost';
  end if;
end;
$$;

-- Restore the pre-YP7.2b pending JSON shape and constraints.
alter table public.variation_listing_intake_sessions
  drop constraint if exists variation_listing_intake_sessions_pending_copy_condition_check,
  drop constraint if exists variation_listing_intake_sessions_mode_copy_condition_check,
  drop constraint if exists variation_listing_intake_sessions_pending_pair_check;

update public.variation_listing_intake_sessions
   set pending_pair = pending_pair - 'condition_token'
 where pending_pair is not null;

alter table public.variation_listing_intake_sessions
  add constraint variation_listing_intake_sessions_pending_pair_check check (
    pending_pair is null or (jsonb_typeof(pending_pair) = 'object'
      and pending_pair ? 'pair_id' and pending_pair ? 'mode'
      and pending_pair ? 'target_group_id' and pending_pair ? 'target_variation_id'
      and pending_pair ? 'price_amount' and pending_pair ? 'price_currency'
      and pending_pair ? 'front_source_ref' and pending_pair ? 'started_at'
      and pending_pair ? 'expected_desired_revision'
      and jsonb_typeof(pending_pair->'pair_id') = 'string'
      and (pending_pair->>'mode') in ('new_variation','duplicate_copy')
      and jsonb_typeof(pending_pair->'target_group_id') = 'string'
      and ((pending_pair->>'mode' = 'new_variation' and pending_pair->'target_variation_id' = 'null'::jsonb)
        or (pending_pair->>'mode' = 'duplicate_copy' and jsonb_typeof(pending_pair->'target_variation_id') = 'string'))
      and jsonb_typeof(pending_pair->'price_amount') = 'number'
      and (pending_pair->>'price_amount')::numeric in (0.99,1.49,1.99,2.49)
      and pending_pair->>'price_currency' = 'USD'
      and nullif(btrim(pending_pair->>'front_source_ref'),'') is not null
      and jsonb_typeof(pending_pair->'started_at') = 'string'
      and jsonb_typeof(pending_pair->'expected_desired_revision') = 'number'
      and (pending_pair->>'expected_desired_revision') ~ '^[0-9]+$')
  );

alter table public.variation_listing_intake_sessions
  drop constraint if exists variation_listing_intake_sessions_copy_condition_token_check;

drop function if exists public.configure_variation_listing_intake(text,text,uuid,uuid,numeric,text);
create function public.configure_variation_listing_intake(
  p_capture_source_key text, p_mode text, p_target_group_id uuid,
  p_target_variation_id uuid, p_sticky_price_amount numeric
) returns table(session_row jsonb)
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
declare s public.variation_listing_intake_sessions; g public.variation_listing_groups;
begin
  insert into public.variation_listing_intake_sessions(capture_source_key)
  values (p_capture_source_key) on conflict (capture_source_key) do nothing;
  select * into s from public.variation_listing_intake_sessions
   where capture_source_key = p_capture_source_key for update;
  if s.pending_pair is not null then raise exception 'pending pair locks intake target'; end if;
  update public.variation_listing_intake_sessions
     set mode = p_mode,
         target_group_id = p_target_group_id,
         target_variation_id = p_target_variation_id,
         sticky_price_amount = p_sticky_price_amount
   where capture_source_key = p_capture_source_key;
  return query select to_jsonb(x) from public.variation_listing_intake_sessions x
   where x.capture_source_key = p_capture_source_key;
end;
$$;

create or replace function public.start_variation_listing_intake_pair(
  p_capture_source_key text, p_pair_id uuid, p_front_source_ref text, p_started_at timestamptz
) returns table(session_row jsonb)
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
declare s public.variation_listing_intake_sessions; g public.variation_listing_groups;
begin
  select * into s from public.variation_listing_intake_sessions
   where capture_source_key = p_capture_source_key for update;
  if not found or s.mode = 'idle' or s.target_group_id is null then raise exception 'intake target is required'; end if;
  if s.pending_pair is not null then raise exception 'pending pair already exists'; end if;
  if p_pair_id is null or nullif(btrim(p_front_source_ref), '') is null or p_started_at is null then raise exception 'pending pair identity/source/time is required'; end if;
  if exists (select 1 from public.variation_listing_copies where capture_pair_id = p_pair_id) then raise exception 'capture pair already completed' using errcode = 'VR001'; end if;
  select * into g from public.variation_listing_groups where group_id = s.target_group_id for update;
  if not found then raise exception 'target group not found'; end if;
  update public.variation_listing_intake_sessions
     set pending_pair = jsonb_build_object(
       'pair_id', p_pair_id, 'mode', s.mode, 'target_group_id', s.target_group_id,
       'target_variation_id', s.target_variation_id, 'price_amount', s.sticky_price_amount,
       'price_currency', s.sticky_price_currency, 'front_source_ref', p_front_source_ref,
       'started_at', p_started_at, 'expected_desired_revision', g.desired_revision
     )
   where capture_source_key = p_capture_source_key;
  return query select to_jsonb(x) from public.variation_listing_intake_sessions x
   where x.capture_source_key = p_capture_source_key;
end;
$$;

drop function if exists public.complete_variation_listing_duplicate_copy(text,uuid,uuid,uuid,text,text,text,text,timestamptz);
create function public.complete_variation_listing_duplicate_copy(
  p_capture_source_key text, p_copy_id uuid, p_capture_pair_id uuid, p_variation_id uuid,
  p_condition_token text, p_front_r2_key text, p_back_r2_key text,
  p_back_source_ref text, p_captured_at timestamptz
) returns table(group_row jsonb, copy_row jsonb)
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
declare s public.variation_listing_intake_sessions; g public.variation_listing_groups; c public.variation_listing_copies;
begin
  select * into c from public.variation_listing_copies where capture_pair_id = p_capture_pair_id;
  if found then
    if c.copy_id is distinct from p_copy_id or c.variation_id is distinct from p_variation_id or c.condition_token is distinct from p_condition_token or c.capture_source_key is distinct from p_capture_source_key or c.front_r2_key is distinct from p_front_r2_key or c.back_r2_key is distinct from p_back_r2_key or c.capture_back_source_ref is distinct from p_back_source_ref then raise exception 'capture pair retry conflicts with persisted copy' using errcode = 'VR001'; end if;
    select * into g from public.variation_listing_groups where group_id = (select group_id from public.variation_listing_variations where variation_id = c.variation_id);
    return query select to_jsonb(g), to_jsonb(c); return;
  end if;
  select * into s from public.variation_listing_intake_sessions where capture_source_key = p_capture_source_key for update;
  select * into c from public.variation_listing_copies where capture_pair_id = p_capture_pair_id;
  if found then
    if c.copy_id is distinct from p_copy_id or c.variation_id is distinct from p_variation_id or c.condition_token is distinct from p_condition_token or c.capture_source_key is distinct from p_capture_source_key or c.front_r2_key is distinct from p_front_r2_key or c.back_r2_key is distinct from p_back_r2_key or c.capture_back_source_ref is distinct from p_back_source_ref then raise exception 'capture pair retry conflicts with persisted copy' using errcode = 'VR001'; end if;
    select * into g from public.variation_listing_groups where group_id = (select group_id from public.variation_listing_variations where variation_id = c.variation_id);
    return query select to_jsonb(g), to_jsonb(c); return;
  end if;
  if s.capture_source_key is null or s.pending_pair is null or s.mode <> 'duplicate_copy' then raise exception 'pending duplicate-copy pair required'; end if;
  if p_capture_pair_id::text <> s.pending_pair->>'pair_id' or s.pending_pair->>'mode' <> 'duplicate_copy' or s.target_group_id::text <> s.pending_pair->>'target_group_id' or p_variation_id::text <> s.pending_pair->>'target_variation_id' or s.target_variation_id is distinct from p_variation_id or s.sticky_price_amount <> (s.pending_pair->>'price_amount')::numeric then raise exception 'duplicate copy does not match pending snapshot'; end if;
  select * into g from public.variation_listing_groups where group_id = s.target_group_id for update;
  if not found then raise exception 'target group not found'; end if;
  if g.desired_revision <> (s.pending_pair->>'expected_desired_revision')::bigint then raise exception 'stale intake desired revision' using errcode = 'VR001'; end if;
  if p_condition_token is null or p_condition_token not in ('NEAR_MINT_OR_BETTER','EXCELLENT','VERY_GOOD','POOR') then raise exception 'variation listing copy condition is invalid' using errcode = 'VR002'; end if;
  if (case p_condition_token when 'NEAR_MINT_OR_BETTER' then 0 when 'EXCELLENT' then 1 when 'VERY_GOOD' then 2 when 'POOR' then 3 end) > (case g.condition_token when 'NEAR_MINT_OR_BETTER' then 0 when 'EXCELLENT' then 1 when 'VERY_GOOD' then 2 when 'POOR' then 3 end) then raise exception 'variation listing copy condition is worse than group condition' using errcode = 'VR002'; end if;
  insert into public.variation_listing_copies(copy_id,variation_id,condition_token,front_r2_key,back_r2_key,capture_source_key,capture_pair_id,capture_front_source_ref,capture_back_source_ref,capture_started_at,captured_at) values(p_copy_id,s.target_variation_id,p_condition_token,p_front_r2_key,p_back_r2_key,p_capture_source_key,p_capture_pair_id,s.pending_pair->>'front_source_ref',p_back_source_ref,(s.pending_pair->>'started_at')::timestamptz,coalesce(p_captured_at,now()));
  update public.variation_listing_groups set desired_revision = desired_revision + 1 where group_id = g.group_id;
  update public.variation_listing_intake_sessions set pending_pair = null where capture_source_key = p_capture_source_key;
  return query select to_jsonb(x),to_jsonb(y) from public.variation_listing_groups x join public.variation_listing_copies y on y.copy_id = p_copy_id where x.group_id = g.group_id;
end;
$$;

alter table public.variation_listing_intake_sessions drop constraint if exists variation_listing_intake_sessions_mode_copy_condition_check;
alter table public.variation_listing_intake_sessions drop column copy_condition_token;

revoke all on function public.configure_variation_listing_intake(text,text,uuid,uuid,numeric)
  from public, anon, authenticated;
grant execute on function public.configure_variation_listing_intake(text,text,uuid,uuid,numeric)
  to service_role;
revoke all on function public.start_variation_listing_intake_pair(text,uuid,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.start_variation_listing_intake_pair(text,uuid,text,timestamptz)
  to service_role;
revoke all on function public.complete_variation_listing_duplicate_copy(text,uuid,uuid,uuid,text,text,text,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.complete_variation_listing_duplicate_copy(text,uuid,uuid,uuid,text,text,text,text,timestamptz)
  to service_role;

commit;
