-- YP7.2b: durably select and freeze duplicate-copy condition.
-- Source-only migration. Do not apply to hosted Supabase without explicit authorization.
begin;

lock table public.variation_listing_groups,
  public.variation_listing_variations,
  public.variation_listing_copies,
  public.variation_listing_intake_sessions
  in access exclusive mode;

-- Add the nullable session field before backfilling legacy duplicate sessions.
alter table public.variation_listing_intake_sessions
  add column copy_condition_token text;

-- Existing duplicate sessions used the target group's condition implicitly. Preserve
-- that behavior as the durable frozen value before enforcing the new invariants.
update public.variation_listing_intake_sessions s
   set copy_condition_token = g.condition_token
  from public.variation_listing_groups g
 where s.mode = 'duplicate_copy'
   and s.target_group_id = g.group_id;

-- Existing duplicate pending snapshots likewise inherit the target group's condition.
update public.variation_listing_intake_sessions s
   set pending_pair = jsonb_set(
     s.pending_pair,
     '{condition_token}',
     to_jsonb(g.condition_token),
     true
   )
  from public.variation_listing_groups g
 where s.mode = 'duplicate_copy'
   and s.pending_pair is not null
   and s.target_group_id = g.group_id;

update public.variation_listing_intake_sessions
   set pending_pair = jsonb_set(pending_pair, '{condition_token}', 'null'::jsonb, true)
 where mode = 'new_variation'
   and pending_pair is not null;

alter table public.variation_listing_intake_sessions
  add constraint variation_listing_intake_sessions_copy_condition_token_check check (
    copy_condition_token is null
    or copy_condition_token in ('NEAR_MINT_OR_BETTER','EXCELLENT','VERY_GOOD','POOR')
  ),
  add constraint variation_listing_intake_sessions_mode_copy_condition_check check (
    (mode in ('idle','new_variation') and copy_condition_token is null)
    or (mode = 'duplicate_copy' and copy_condition_token is not null)
  );

-- Replace the JSON shape check with one that includes the frozen condition.
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
      and (pending_pair->>'price_amount')::numeric in (0.99,1.49,1.99,2.49)
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

alter table public.variation_listing_intake_sessions
  add constraint variation_listing_intake_sessions_pending_copy_condition_check check (
    pending_pair is null
    or (pending_pair->>'mode' = 'new_variation' and pending_pair->'condition_token' = 'null'::jsonb
        and copy_condition_token is null)
    or (pending_pair->>'mode' = 'duplicate_copy'
        and pending_pair->>'condition_token' is not distinct from copy_condition_token)
  );

-- Replace configure with the condition-aware service-role RPC.
drop function if exists public.configure_variation_listing_intake(text,text,uuid,uuid,numeric);
create function public.configure_variation_listing_intake(
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
  if p_sticky_price_amount is null or p_sticky_price_amount not in (0.99,1.49,1.99,2.49) then
    raise exception 'sticky price amount is invalid' using errcode = 'VR002';
  end if;
  if p_copy_condition_token is not null
     and p_copy_condition_token not in ('NEAR_MINT_OR_BETTER','EXCELLENT','VERY_GOOD','POOR') then
    raise exception 'copy condition is invalid' using errcode = 'VR002';
  end if;

  -- Intake session is the first lock in the configure/start protocol.
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

-- Start snapshots the selected condition into the pending pair.
create or replace function public.start_variation_listing_intake_pair(
  p_capture_source_key text, p_pair_id uuid, p_front_source_ref text, p_started_at timestamptz
) returns table(session_row jsonb)
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
declare
  s public.variation_listing_intake_sessions;
  g public.variation_listing_groups;
  condition_token text;
begin
  select * into s from public.variation_listing_intake_sessions
   where capture_source_key = p_capture_source_key for update;
  if not found or s.mode = 'idle' or s.target_group_id is null then
    raise exception 'intake target is required' using errcode = 'VR002';
  end if;
  if s.pending_pair is not null then raise exception 'pending pair already exists' using errcode = 'VR001'; end if;
  if p_pair_id is null or nullif(btrim(p_front_source_ref), '') is null or p_started_at is null then
    raise exception 'pending pair identity/source/time is required' using errcode = 'VR002';
  end if;
  if exists (select 1 from public.variation_listing_copies where capture_pair_id = p_pair_id) then
    raise exception 'capture pair already completed' using errcode = 'VR001';
  end if;
  select * into g from public.variation_listing_groups where group_id = s.target_group_id for update;
  if not found then raise exception 'target group not found' using errcode = 'VR004'; end if;
  if s.mode = 'new_variation' then
    if s.copy_condition_token is not null or s.target_variation_id is not null then
      raise exception 'new-variation intake configuration is invalid' using errcode = 'VR002';
    end if;
    condition_token := null;
  else
    if s.target_variation_id is null or s.copy_condition_token is null then
      raise exception 'duplicate-copy intake configuration is invalid' using errcode = 'VR002';
    end if;
    if not exists (
      select 1 from public.variation_listing_variations v
       where v.group_id = g.group_id and v.variation_id = s.target_variation_id
    ) then raise exception 'target variation does not belong to target group' using errcode = 'VR002'; end if;
    if (case s.copy_condition_token when 'POOR' then 0 when 'VERY_GOOD' then 1 when 'EXCELLENT' then 2 when 'NEAR_MINT_OR_BETTER' then 3 end)
       < (case g.condition_token when 'POOR' then 0 when 'VERY_GOOD' then 1 when 'EXCELLENT' then 2 when 'NEAR_MINT_OR_BETTER' then 3 end) then
      raise exception 'copy condition is worse than group condition' using errcode = 'VR002';
    end if;
    condition_token := s.copy_condition_token;
  end if;
  update public.variation_listing_intake_sessions
     set pending_pair = jsonb_build_object(
       'pair_id', p_pair_id,
       'mode', s.mode,
       'target_group_id', s.target_group_id,
       'target_variation_id', s.target_variation_id,
       'price_amount', s.sticky_price_amount,
       'price_currency', s.sticky_price_currency,
       'condition_token', condition_token,
       'front_source_ref', p_front_source_ref,
       'started_at', p_started_at,
       'expected_desired_revision', g.desired_revision
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
  -- Recheck after taking the session lock so a concurrent completion becomes
  -- an exact idempotent retry instead of a unique-key error.
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
  insert into public.variation_listing_copies(
    copy_id, variation_id, condition_token, front_r2_key, back_r2_key,
    capture_source_key, capture_pair_id, capture_front_source_ref,
    capture_back_source_ref, capture_started_at, captured_at
  ) values (
    p_copy_id, s.target_variation_id, frozen_condition, p_front_r2_key, p_back_r2_key,
    p_capture_source_key, p_capture_pair_id, s.pending_pair->>'front_source_ref',
    p_back_source_ref, (s.pending_pair->>'started_at')::timestamptz, coalesce(p_captured_at, now())
  );
  update public.variation_listing_groups set desired_revision = desired_revision + 1 where group_id = g.group_id;
  update public.variation_listing_intake_sessions set pending_pair = null where capture_source_key = p_capture_source_key;
  return query select to_jsonb(x), to_jsonb(y)
    from public.variation_listing_groups x
    join public.variation_listing_copies y on y.copy_id = p_copy_id
   where x.group_id = g.group_id;
end;
$$;

revoke all on function public.configure_variation_listing_intake(text,text,uuid,uuid,numeric,text)
  from public, anon, authenticated;
grant execute on function public.configure_variation_listing_intake(text,text,uuid,uuid,numeric,text)
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
