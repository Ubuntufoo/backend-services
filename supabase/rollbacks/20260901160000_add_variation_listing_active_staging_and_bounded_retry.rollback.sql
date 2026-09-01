-- Manual pre-apply rollback for YP5.3 Slice A. Safe only before Slice A durable retry-state rows exist.
begin;

do $$ begin
  if exists (select 1 from public.variation_listing_publishing_checkpoints where state in ('retry_authorized','retry_exhausted')) then
    raise exception 'YP5.3 Slice A rollback requires no retry-state checkpoint rows';
  end if;
end $$;

drop function if exists public.update_variation_listing_copy_availability(uuid,uuid,uuid,bigint,text);
drop function if exists public.update_variation_listing_representative_copy(uuid,uuid,uuid,bigint);

alter table public.variation_listing_publishing_checkpoints
  drop constraint variation_listing_publishing_checkpoints_state_check;
alter table public.variation_listing_publishing_checkpoints
  add constraint variation_listing_publishing_checkpoints_state_check check (
    state in ('started','unknown','confirmed_complete','confirmed_no_op')
  );

create or replace function public.append_variation_listing_journal_checkpoint(
  p_revision_id uuid, p_operation_key text, p_checkpoint_id uuid, p_attempt_number integer,
  p_checkpoint_number integer, p_state text, p_observed_remote_state text, p_evidence jsonb
) returns table (checkpoint jsonb) language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
declare v_group_id uuid; v_plan jsonb; v_prev record; v_latest record; v_seq integer;
begin
  select r.group_id, r.operation_plan into v_group_id, v_plan from public.variation_listing_revisions r where r.revision_id = p_revision_id;
  if v_group_id is null then raise exception 'variation listing revision not found' using errcode = 'VR004'; end if;
  if not exists (select 1 from jsonb_array_elements(v_plan) x where x->>'operation_key' = p_operation_key) then raise exception 'operation key is not in frozen revision plan' using errcode = 'VR004'; end if;
  perform 1 from public.variation_listing_groups where group_id = v_group_id for update;
  select * into v_latest from public.variation_listing_publishing_checkpoints where revision_id = p_revision_id and operation_key = p_operation_key order by attempt_number desc, checkpoint_number desc limit 1;
  if p_state not in ('started','unknown','confirmed_complete','confirmed_no_op') then raise exception 'invalid checkpoint state' using errcode = 'VR002'; end if;
  if p_observed_remote_state is not null and p_observed_remote_state not in ('present','proven_absent','unknown') then raise exception 'invalid observed remote state' using errcode = 'VR002'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'object' then raise exception 'checkpoint evidence must be an object' using errcode = 'VR002'; end if;
  if p_state in ('confirmed_complete','confirmed_no_op') and (p_observed_remote_state is null or p_observed_remote_state not in ('present','proven_absent') or p_evidence = '{}'::jsonb) then raise exception 'terminal checkpoint requires exact evidence' using errcode = 'VR003'; end if;
  if p_state = 'unknown' and (p_observed_remote_state is distinct from 'unknown' or p_evidence = '{}'::jsonb) then raise exception 'unknown checkpoint requires ambiguity evidence' using errcode = 'VR003'; end if;
  if p_state = 'started' and p_observed_remote_state is not null then raise exception 'started checkpoint cannot claim remote evidence' using errcode = 'VR003'; end if;
  if v_latest.state in ('confirmed_complete','confirmed_no_op') then raise exception 'terminal checkpoint cannot be reopened' using errcode = 'VR003';
  elsif v_latest.state = 'started' then
    if p_attempt_number <> v_latest.attempt_number or p_checkpoint_number <> v_latest.checkpoint_number + 1 or p_state not in ('unknown','confirmed_complete','confirmed_no_op') then raise exception 'started checkpoint must resolve on same attempt' using errcode = 'VR003'; end if;
  elsif v_latest.state = 'unknown' or v_latest.observed_remote_state = 'unknown' then
    if p_attempt_number <> v_latest.attempt_number + 1 or p_checkpoint_number <> 1 or p_state not in ('confirmed_complete','confirmed_no_op') or p_observed_remote_state is null or p_observed_remote_state not in ('present','proven_absent') then raise exception 'unknown outcome requires exact reconciliation' using errcode = 'VR003'; end if;
  elsif v_latest.state is null then
    if p_attempt_number <> 1 or p_checkpoint_number <> 1 then raise exception 'checkpoint history must begin at attempt 1/checkpoint 1' using errcode = 'VR002'; end if;
    if p_state <> 'started' and not exists (select 1 from jsonb_array_elements(v_plan) x where x->>'operation_key' = p_operation_key and x->>'operation_kind' in ('revision_reconcile','final_absence_verification')) then raise exception 'mutation operation must begin started' using errcode = 'VR003'; end if;
  else
    if p_attempt_number = v_latest.attempt_number and p_checkpoint_number <> v_latest.checkpoint_number + 1 then raise exception 'checkpoint ordering violation' using errcode = 'VR002'; end if;
    if p_attempt_number <> v_latest.attempt_number + 1 or p_checkpoint_number <> 1 then raise exception 'new attempt must be contiguous' using errcode = 'VR002'; end if;
  end if;
  insert into public.variation_listing_publishing_checkpoints(checkpoint_id,revision_id,operation_key,attempt_number,checkpoint_number,state,observed_remote_state,evidence)
  values(p_checkpoint_id,p_revision_id,p_operation_key,p_attempt_number,p_checkpoint_number,p_state,p_observed_remote_state,p_evidence);
  return query select to_jsonb(c) from public.variation_listing_publishing_checkpoints c where c.checkpoint_id = p_checkpoint_id;
end; $$;

create or replace function public.confirm_variation_listing_revision(p_group_id uuid, p_expected_previous_confirmed_revision bigint, p_confirmed_revision bigint)
returns table(group_row jsonb) language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
declare g public.variation_listing_groups; r public.variation_listing_revisions; op jsonb; k text; latest record;
begin
  select * into g from public.variation_listing_groups where group_id = p_group_id for update;
  if not found or g.last_confirmed_revision is distinct from p_expected_previous_confirmed_revision then raise exception 'variation listing confirmation CAS mismatch' using errcode = 'VR001'; end if;
  if p_confirmed_revision is null or p_confirmed_revision < 1 or p_confirmed_revision > g.desired_revision or p_confirmed_revision < coalesce(g.last_confirmed_revision,0) then raise exception 'variation listing confirmation revision is outside allowed range' using errcode = 'VR001'; end if;
  select * into r from public.variation_listing_revisions where group_id = p_group_id and captured_desired_revision = p_confirmed_revision;
  if not found then raise exception 'variation listing revision not found' using errcode = 'VR004'; end if;
  if (select count(*) from jsonb_array_elements(r.operation_plan)) <> (select count(distinct x->>'operation_key') from jsonb_array_elements(r.operation_plan) x) then raise exception 'revision operation keys must be unique' using errcode = 'VR004'; end if;
  for op in select * from jsonb_array_elements(r.operation_plan) loop
    k := op->>'operation_key';
    select * into latest from public.variation_listing_publishing_checkpoints where revision_id = r.revision_id and operation_key = k order by attempt_number desc, checkpoint_number desc limit 1;
    if latest.state not in ('confirmed_complete','confirmed_no_op') or latest.observed_remote_state is null or latest.observed_remote_state not in ('present','proven_absent') or latest.evidence = '{}'::jsonb then raise exception 'revision operation unresolved' using errcode = 'VR004'; end if;
  end loop;
  update public.variation_listing_groups set last_confirmed_revision = p_confirmed_revision where group_id = p_group_id;
  return query select to_jsonb(x) from public.variation_listing_groups x where x.group_id = p_group_id;
end; $$;

create or replace function public.update_variation_listing_manual_price(
  p_group_id uuid,
  p_variation_id uuid,
  p_expected_desired_revision bigint,
  p_price_amount numeric
) returns table (group_row jsonb, variation_row jsonb)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_group public.variation_listing_groups;
  v_variation public.variation_listing_variations;
begin
  if p_expected_desired_revision is null or p_expected_desired_revision < 0 then raise exception 'variation listing price edit expected revision is invalid' using errcode = 'VR002'; end if;
  if p_price_amount is null or p_price_amount not in (0.99, 1.49, 1.99, 2.49) then raise exception 'variation listing price edit amount is invalid' using errcode = 'VR002'; end if;
  select * into v_group from public.variation_listing_groups where group_id = p_group_id for update;
  if not found then raise exception 'variation listing group not found' using errcode = 'VR004'; end if;
  if v_group.desired_revision <> p_expected_desired_revision then raise exception 'variation listing price edit CAS mismatch' using errcode = 'VR001'; end if;
  if v_group.lifecycle_state not in ('intake', 'draft', 'review') then raise exception 'variation listing group lifecycle is not editable' using errcode = 'VR002'; end if;
  select * into v_variation from public.variation_listing_variations where variation_id = p_variation_id and group_id = p_group_id;
  if not found then raise exception 'variation listing variation not found in group' using errcode = 'VR004'; end if;
  if v_variation.price_amount = p_price_amount then raise exception 'variation listing price edit must change the price' using errcode = 'VR002'; end if;
  update public.variation_listing_variations set price_amount = p_price_amount where variation_id = p_variation_id and group_id = p_group_id;
  update public.variation_listing_groups set desired_revision = desired_revision + 1 where group_id = p_group_id;
  return query select to_jsonb(g), to_jsonb(v) from public.variation_listing_groups g join public.variation_listing_variations v on v.group_id = g.group_id where g.group_id = p_group_id and v.variation_id = p_variation_id;
end;
$$;

commit;
