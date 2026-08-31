-- YP2.9a compensating simplification. Local/disposable validation only.
-- Refuses to touch any durable variation-listing row.
begin;

lock table public.variation_listing_groups,
  public.variation_listing_variations,
  public.variation_listing_copies,
  public.variation_listing_intake_sessions,
  public.variation_listing_revisions,
  public.variation_listing_operations,
  public.variation_listing_operation_attempts
  in access exclusive mode;

do $$
declare occupied boolean;
begin
  if exists (select 1 from public.variation_listing_groups limit 1)
     or exists (select 1 from public.variation_listing_variations limit 1)
     or exists (select 1 from public.variation_listing_copies limit 1)
     or exists (select 1 from public.variation_listing_intake_sessions limit 1)
     or exists (select 1 from public.variation_listing_revisions limit 1)
     or exists (select 1 from public.variation_listing_operations limit 1)
     or exists (select 1 from public.variation_listing_operation_attempts limit 1) then
    raise exception 'variation-listing simplification requires all seven historical tables to be empty';
  end if;
end $$;

-- Replace old RPCs before dropping their dependencies.
drop function if exists public.capture_variation_listing_revision(uuid, uuid, bigint, integer, text, jsonb, jsonb);
drop function if exists public.append_variation_listing_journal_checkpoint(uuid, uuid, integer, integer, text, integer, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, text, text, jsonb);
drop function if exists public.confirm_variation_listing_revision(uuid, bigint, bigint);

-- Remove obsolete journal triggers/functions/tables.
drop trigger if exists variation_listing_revisions_require_complete_plan on public.variation_listing_revisions;
drop trigger if exists variation_listing_operations_prevent_identity_update on public.variation_listing_operations;
drop trigger if exists variation_listing_operations_prevent_delete on public.variation_listing_operations;
drop trigger if exists variation_listing_operations_require_sequence on public.variation_listing_operations;
drop trigger if exists variation_listing_operations_updated_at on public.variation_listing_operations;
drop trigger if exists variation_listing_operation_attempts_prevent_mutation on public.variation_listing_operation_attempts;
drop trigger if exists variation_listing_revisions_prevent_update on public.variation_listing_revisions;
drop trigger if exists variation_listing_revisions_prevent_delete on public.variation_listing_revisions;

drop table public.variation_listing_operation_attempts;
drop table public.variation_listing_operations;

drop function if exists public.prevent_variation_listing_operation_attempt_mutation();
drop function if exists public.prevent_variation_listing_operation_delete();
drop function if exists public.prevent_variation_listing_operation_identity_update();
drop function if exists public.require_variation_listing_operation_sequence();
drop function if exists public.require_variation_listing_revision_plan();

-- Retire the YP2.4 GUC/temp-proof/deferred aggregate machinery.
drop trigger if exists variation_listing_groups_validate_guarded_update on public.variation_listing_groups;
drop trigger if exists variation_listing_groups_verify_allocator_consumption on public.variation_listing_groups;
drop trigger if exists variation_listing_variations_validate_aggregate_write on public.variation_listing_variations;
drop trigger if exists variation_listing_variations_require_revision_advance on public.variation_listing_variations;
drop trigger if exists variation_listing_copies_validate_aggregate_write on public.variation_listing_copies;
drop trigger if exists variation_listing_copies_require_revision_advance on public.variation_listing_copies;
drop trigger if exists variation_listing_intake_sessions_validate_transition on public.variation_listing_intake_sessions;
drop function if exists public.validate_variation_listing_group_guarded_update();
drop function if exists public.verify_variation_listing_allocator_consumption();
drop function if exists public.validate_variation_listing_variation_aggregate_write();
drop function if exists public.require_variation_listing_variation_revision_advance();
drop function if exists public.validate_variation_listing_copy_aggregate_write();
drop function if exists public.require_variation_listing_copy_revision_advance();
drop function if exists public.validate_variation_listing_intake_session_transition();

alter table public.variation_listing_groups drop column recovery_required;

alter table public.variation_listing_copies drop constraint if exists variation_listing_copies_capture_session_version_check;
alter table public.variation_listing_copies drop column capture_session_version;

-- Intake keeps one frozen restart snapshot instead of a version plus duplicated fields.
alter table public.variation_listing_intake_sessions drop constraint if exists variation_listing_intake_sessions_pending_pair_source_check;
alter table public.variation_listing_intake_sessions drop constraint if exists variation_listing_intake_sessions_pending_snapshot_check;
alter table public.variation_listing_intake_sessions drop constraint if exists variation_listing_intake_sessions_pending_pair_version_check;
alter table public.variation_listing_intake_sessions drop constraint if exists variation_listing_intake_sessions_pending_variation_group_fkey;
alter table public.variation_listing_intake_sessions drop constraint if exists variation_listing_intake_sessions_pending_pair_group_fkey;
alter table public.variation_listing_intake_sessions drop constraint if exists variation_listing_intake_sessions_pending_pair_mode_check;
alter table public.variation_listing_intake_sessions drop constraint if exists variation_listing_intake_sessions_pending_pair_currency_check;
alter table public.variation_listing_intake_sessions drop constraint if exists variation_listing_intake_sessions_pending_pair_price_check;
alter table public.variation_listing_intake_sessions drop constraint if exists variation_listing_intake_sessions_pending_all_or_none_check;
alter table public.variation_listing_intake_sessions drop constraint if exists variation_listing_intake_sessions_session_version_check;
alter table public.variation_listing_intake_sessions
  drop column session_version,
  drop column pending_pair_id,
  drop column pending_pair_session_version,
  drop column pending_pair_mode,
  drop column pending_pair_target_group_id,
  drop column pending_pair_target_variation_id,
  drop column pending_pair_price_amount,
  drop column pending_pair_price_currency,
  drop column pending_pair_front_source_ref,
  drop column pending_pair_started_at,
  add column pending_pair jsonb;
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

-- Immutable revision owns complete ordered operation plan.
alter table public.variation_listing_revisions
  add column operation_plan jsonb not null default '[]'::jsonb;
alter table public.variation_listing_revisions
  add constraint variation_listing_revisions_operation_plan_check check (
    jsonb_typeof(operation_plan) = 'array' and jsonb_array_length(operation_plan) = operation_count
  );

create table public.variation_listing_publishing_checkpoints (
  checkpoint_id uuid not null,
  revision_id uuid not null,
  operation_key text not null,
  attempt_number integer not null,
  checkpoint_number integer not null,
  state text not null,
  observed_remote_state text,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint variation_listing_publishing_checkpoints_pkey primary key (checkpoint_id),
  constraint variation_listing_publishing_checkpoints_revision_operation_order_key
    unique (revision_id, operation_key, attempt_number, checkpoint_number),
  constraint variation_listing_publishing_checkpoints_revision_id_fkey foreign key (revision_id)
    references public.variation_listing_revisions (revision_id) on update no action on delete no action,
  constraint variation_listing_publishing_checkpoints_operation_key_check check (operation_key = btrim(operation_key) and length(operation_key) > 0),
  constraint variation_listing_publishing_checkpoints_attempt_number_check check (attempt_number > 0),
  constraint variation_listing_publishing_checkpoints_checkpoint_number_check check (checkpoint_number > 0),
  constraint variation_listing_publishing_checkpoints_state_check check (state in ('started','unknown','confirmed_complete','confirmed_no_op')),
  constraint variation_listing_publishing_checkpoints_observed_remote_state_check check (observed_remote_state is null or observed_remote_state in ('present','proven_absent','unknown')),
  constraint variation_listing_publishing_checkpoints_evidence_check check (jsonb_typeof(evidence) = 'object')
);
create index variation_listing_publishing_checkpoints_revision_operation_idx
  on public.variation_listing_publishing_checkpoints (revision_id, operation_key, attempt_number desc, checkpoint_number desc);

create trigger variation_listing_revisions_prevent_update
  before update or delete on public.variation_listing_revisions for each row
  execute function public.prevent_variation_listing_revision_mutation();
create function public.prevent_variation_listing_checkpoint_mutation()
returns trigger language plpgsql as $$ begin raise exception 'variation listing publishing checkpoints are append-only'; end; $$;
create trigger variation_listing_publishing_checkpoints_prevent_mutation
  before update or delete on public.variation_listing_publishing_checkpoints for each row
  execute function public.prevent_variation_listing_checkpoint_mutation();

-- Copy identity trigger no longer references removed session_version.
create or replace function public.prevent_variation_listing_copy_identity_update()
returns trigger language plpgsql as $$
begin
  if new.copy_id is distinct from old.copy_id or new.variation_id is distinct from old.variation_id
     or new.front_r2_key is distinct from old.front_r2_key or new.back_r2_key is distinct from old.back_r2_key
     or new.capture_source_key is distinct from old.capture_source_key or new.capture_pair_id is distinct from old.capture_pair_id
     or new.capture_front_source_ref is distinct from old.capture_front_source_ref
     or new.capture_back_source_ref is distinct from old.capture_back_source_ref or new.capture_started_at is distinct from old.capture_started_at
     or new.captured_at is distinct from old.captured_at or new.created_at is distinct from old.created_at then
    raise exception 'variation listing copy identity/provenance is immutable';
  end if;
  return new;
end; $$;

create or replace function public.prevent_variation_listing_revision_mutation()
returns trigger language plpgsql as $$ begin raise exception 'variation listing revision snapshots are immutable'; end; $$;

-- Append checkpoint; operation state is derived from latest rows.
create function public.capture_variation_listing_revision(
  p_group_id uuid, p_revision_id uuid, p_captured_desired_revision bigint,
  p_snapshot_version integer, p_snapshot_digest text, p_snapshot jsonb, p_operation_plan jsonb
) returns table (revision jsonb) language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
declare v_group public.variation_listing_groups; v_count integer; v_op jsonb; v_idx integer;
begin
  if jsonb_typeof(p_operation_plan) is distinct from 'array' or jsonb_array_length(p_operation_plan) = 0 then raise exception 'variation listing revision requires non-empty operation plan'; end if;
  v_count := jsonb_array_length(p_operation_plan);
  for v_op, v_idx in select value, ordinality::integer from jsonb_array_elements(p_operation_plan) with ordinality loop
    if jsonb_typeof(v_op) is distinct from 'object'
       or jsonb_typeof(v_op->'sequence_no') is distinct from 'number'
       or (v_op->>'sequence_no') !~ '^[1-9][0-9]*$'
       or (v_op->>'sequence_no')::integer is distinct from v_idx
       or nullif(btrim(v_op->>'operation_key'),'') is null
       or (v_op->>'operation_key') is distinct from btrim(v_op->>'operation_key')
       or (v_op->>'operation_kind') is null
       or (v_op->>'operation_kind') not in ('media_ingest','child_inventory_item_write','child_offer_write','complete_group_replace','group_publish','revision_reconcile','withdrawal','cleanup_offer','cleanup_group','cleanup_child_inventory_item','final_absence_verification')
       or nullif(btrim(v_op->>'target_ref'),'') is null
       or (v_op->>'target_ref') is distinct from btrim(v_op->>'target_ref')
       or jsonb_typeof(v_op->'intent_version') is distinct from 'number'
       or (v_op->>'intent_version') !~ '^[1-9][0-9]*$'
       or (v_op->>'intent_digest') is null
       or (v_op->>'intent_digest') !~ '^[0-9a-f]{64}$'
       or jsonb_typeof(v_op->'intent') is distinct from 'object' then
      raise exception 'invalid ordered operation plan';
    end if;
    if (select count(*) from jsonb_array_elements(p_operation_plan) x where x->>'operation_key'=v_op->>'operation_key') <> 1 then raise exception 'operation keys must be unique'; end if;
  end loop;
  select * into v_group from public.variation_listing_groups where group_id = p_group_id for update;
  if not found then raise exception 'variation listing group not found' using errcode = 'VR004'; end if;
  if v_group.desired_revision <> p_captured_desired_revision then raise exception 'variation listing revision capture CAS mismatch' using errcode = 'VR001'; end if;
  if exists (select 1 from public.variation_listing_revisions where group_id = p_group_id and captured_desired_revision = p_captured_desired_revision) then raise exception 'variation listing revision already captured' using errcode = 'VR001'; end if;
  insert into public.variation_listing_revisions(revision_id,group_id,captured_desired_revision,snapshot_version,snapshot_digest,snapshot,operation_count,operation_plan)
  values(p_revision_id,p_group_id,p_captured_desired_revision,p_snapshot_version,p_snapshot_digest,p_snapshot,v_count,p_operation_plan);
  return query select to_jsonb(r) from public.variation_listing_revisions r where r.revision_id = p_revision_id;
end; $$;

create function public.append_variation_listing_journal_checkpoint(
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

create function public.confirm_variation_listing_revision(p_group_id uuid, p_expected_previous_confirmed_revision bigint, p_confirmed_revision bigint)
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

-- YP3.3 aggregate/intake seam (small purpose-built primitives).
create function public.create_variation_listing_group(p_group_id uuid, p_group_key text, p_sku_category_code text, p_sku_bucket_token text, p_category_id text, p_marketplace_id text, p_merchant_location_key text, p_fulfillment_policy_id text, p_payment_policy_id text, p_return_policy_id text, p_condition_id text, p_condition_token text)
returns table(group_row jsonb) language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  insert into public.variation_listing_groups(group_id,group_key,sku_category_code,sku_bucket_token,category_id,marketplace_id,merchant_location_key,fulfillment_policy_id,payment_policy_id,return_policy_id,condition_id,condition_token) values(p_group_id,p_group_key,p_sku_category_code,p_sku_bucket_token,p_category_id,p_marketplace_id,p_merchant_location_key,p_fulfillment_policy_id,p_payment_policy_id,p_return_policy_id,p_condition_id,p_condition_token);
  return query select to_jsonb(g) from public.variation_listing_groups g where g.group_id = p_group_id;
end; $$;

create function public.configure_variation_listing_intake(p_capture_source_key text, p_mode text, p_target_group_id uuid, p_target_variation_id uuid, p_sticky_price_amount numeric)
returns table(session_row jsonb) language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare s public.variation_listing_intake_sessions; g public.variation_listing_groups;
begin
  insert into public.variation_listing_intake_sessions(capture_source_key) values(p_capture_source_key) on conflict (capture_source_key) do nothing;
  select * into s from public.variation_listing_intake_sessions where capture_source_key = p_capture_source_key for update;
  if s.pending_pair is not null then raise exception 'pending pair locks intake target'; end if;
  update public.variation_listing_intake_sessions set mode=p_mode,target_group_id=p_target_group_id,target_variation_id=p_target_variation_id,sticky_price_amount=p_sticky_price_amount where capture_source_key=p_capture_source_key;
  return query select to_jsonb(x) from public.variation_listing_intake_sessions x where x.capture_source_key=p_capture_source_key;
end; $$;

create function public.start_variation_listing_intake_pair(p_capture_source_key text, p_pair_id uuid, p_front_source_ref text, p_started_at timestamptz)
returns table(session_row jsonb) language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare s public.variation_listing_intake_sessions; g public.variation_listing_groups;
begin
  select * into s from public.variation_listing_intake_sessions where capture_source_key=p_capture_source_key for update;
  if not found or s.mode='idle' or s.target_group_id is null then raise exception 'intake target is required'; end if;
  if s.pending_pair is not null then raise exception 'pending pair already exists'; end if;
  if p_pair_id is null or nullif(btrim(p_front_source_ref),'') is null or p_started_at is null then raise exception 'pending pair identity/source/time is required'; end if;
  if exists (select 1 from public.variation_listing_copies where capture_pair_id=p_pair_id) then raise exception 'capture pair already completed' using errcode = 'VR001'; end if;
  select * into g from public.variation_listing_groups where group_id=s.target_group_id for update;
  if not found then raise exception 'target group not found'; end if;
  update public.variation_listing_intake_sessions set pending_pair=jsonb_build_object('pair_id',p_pair_id,'mode',s.mode,'target_group_id',s.target_group_id,'target_variation_id',s.target_variation_id,'price_amount',s.sticky_price_amount,'price_currency',s.sticky_price_currency,'front_source_ref',p_front_source_ref,'started_at',p_started_at,'expected_desired_revision',g.desired_revision) where capture_source_key=p_capture_source_key;
  return query select to_jsonb(x) from public.variation_listing_intake_sessions x where x.capture_source_key=p_capture_source_key;
end; $$;

create function public.discard_variation_listing_intake_pair(p_capture_source_key text)
returns table(session_row jsonb) language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin update public.variation_listing_intake_sessions set pending_pair=null where capture_source_key=p_capture_source_key; return query select to_jsonb(x) from public.variation_listing_intake_sessions x where x.capture_source_key=p_capture_source_key; end; $$;

create function public.complete_variation_listing_new_variation(p_capture_source_key text, p_copy_id uuid, p_variation_id uuid, p_capture_pair_id uuid, p_condition_token text, p_selector_value text, p_variation_metadata jsonb, p_front_r2_key text, p_back_r2_key text, p_back_source_ref text, p_captured_at timestamptz)
returns table(group_row jsonb, variation_row jsonb, copy_row jsonb) language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare s public.variation_listing_intake_sessions; g public.variation_listing_groups; v public.variation_listing_variations; serial integer; sku text; existing public.variation_listing_copies;
begin
  select c.* into existing from public.variation_listing_copies c where c.capture_pair_id=p_capture_pair_id;
  if found then
    select * into v from public.variation_listing_variations where variation_id=existing.variation_id;
    if existing.copy_id is distinct from p_copy_id or existing.variation_id is distinct from p_variation_id or existing.condition_token is distinct from p_condition_token or existing.capture_source_key is distinct from p_capture_source_key or existing.front_r2_key is distinct from p_front_r2_key or existing.back_r2_key is distinct from p_back_r2_key or existing.capture_back_source_ref is distinct from p_back_source_ref or v.selector_value is distinct from p_selector_value or v.variation_metadata is distinct from coalesce(p_variation_metadata,'{}'::jsonb) then raise exception 'capture pair retry conflicts with persisted copy' using errcode = 'VR001'; end if;
    select * into g from public.variation_listing_groups where group_id=v.group_id; return query select to_jsonb(g),to_jsonb(v),to_jsonb(existing); return;
  end if;
  select * into s from public.variation_listing_intake_sessions where capture_source_key=p_capture_source_key for update;
  select c.* into existing from public.variation_listing_copies c where c.capture_pair_id=p_capture_pair_id;
  if found then
    select * into v from public.variation_listing_variations where variation_id=existing.variation_id;
    if existing.copy_id is distinct from p_copy_id or existing.variation_id is distinct from p_variation_id or existing.condition_token is distinct from p_condition_token or existing.capture_source_key is distinct from p_capture_source_key or existing.front_r2_key is distinct from p_front_r2_key or existing.back_r2_key is distinct from p_back_r2_key or existing.capture_back_source_ref is distinct from p_back_source_ref or v.selector_value is distinct from p_selector_value or v.variation_metadata is distinct from coalesce(p_variation_metadata,'{}'::jsonb) then raise exception 'capture pair retry conflicts with persisted copy' using errcode = 'VR001'; end if;
    select * into g from public.variation_listing_groups where group_id=v.group_id; return query select to_jsonb(g),to_jsonb(v),to_jsonb(existing); return;
  end if;
  if s.capture_source_key is null or s.pending_pair is null or s.mode <> 'new_variation' then raise exception 'pending new-variation pair required'; end if;
  if p_capture_pair_id::text <> s.pending_pair->>'pair_id'
     or s.pending_pair->>'mode' <> 'new_variation'
     or s.target_group_id::text <> s.pending_pair->>'target_group_id'
     or s.pending_pair->'target_variation_id' <> 'null'::jsonb
     or s.sticky_price_amount <> (s.pending_pair->>'price_amount')::numeric then
    raise exception 'new variation does not match pending snapshot';
  end if;
  select * into g from public.variation_listing_groups where group_id=s.target_group_id for update;
  if not found then raise exception 'target group not found'; end if;
  if g.desired_revision <> (s.pending_pair->>'expected_desired_revision')::bigint then raise exception 'stale intake desired revision' using errcode = 'VR001'; end if;
  if p_condition_token is null or p_condition_token not in ('NEAR_MINT_OR_BETTER','EXCELLENT','VERY_GOOD','POOR') then raise exception 'variation listing copy condition is invalid' using errcode = 'VR002'; end if;
  if (case p_condition_token when 'NEAR_MINT_OR_BETTER' then 0 when 'EXCELLENT' then 1 when 'VERY_GOOD' then 2 when 'POOR' then 3 end) > (case g.condition_token when 'NEAR_MINT_OR_BETTER' then 0 when 'EXCELLENT' then 1 when 'VERY_GOOD' then 2 when 'POOR' then 3 end) then raise exception 'variation listing copy condition is worse than group condition' using errcode = 'VR002'; end if;
  serial:=g.next_inventory_serial; if serial > 999999 then raise exception 'variation SKU namespace exhausted'; end if;
  sku:=g.sku_category_code||'-'||g.sku_bucket_token||'-'||lpad(serial::text,6,'0');
  insert into public.variation_listing_variations(variation_id,group_id,inventory_serial,sku,position,selector_value,price_amount,variation_metadata) values(p_variation_id,g.group_id,serial,sku,coalesce((select max(position)+1 from public.variation_listing_variations where group_id=g.group_id),0),p_selector_value,(s.pending_pair->>'price_amount')::numeric,coalesce(p_variation_metadata,'{}'::jsonb));
  insert into public.variation_listing_copies(copy_id,variation_id,condition_token,front_r2_key,back_r2_key,capture_source_key,capture_pair_id,capture_front_source_ref,capture_back_source_ref,capture_started_at,captured_at) values(p_copy_id,p_variation_id,p_condition_token,p_front_r2_key,p_back_r2_key,p_capture_source_key,p_capture_pair_id,s.pending_pair->>'front_source_ref',p_back_source_ref,(s.pending_pair->>'started_at')::timestamptz,coalesce(p_captured_at,now()));
  update public.variation_listing_variations set representative_copy_id=p_copy_id where variation_id=p_variation_id;
  update public.variation_listing_groups set next_inventory_serial=serial+1,desired_revision=desired_revision+1 where group_id=g.group_id;
  update public.variation_listing_intake_sessions set pending_pair=null where capture_source_key=p_capture_source_key;
  return query select to_jsonb(x),to_jsonb(vv),to_jsonb(cc) from public.variation_listing_groups x join public.variation_listing_variations vv on vv.group_id=x.group_id join public.variation_listing_copies cc on cc.variation_id=vv.variation_id where x.group_id=g.group_id and vv.variation_id=p_variation_id and cc.copy_id=p_copy_id;
end; $$;

create function public.complete_variation_listing_duplicate_copy(p_capture_source_key text, p_copy_id uuid, p_capture_pair_id uuid, p_variation_id uuid, p_condition_token text, p_front_r2_key text, p_back_r2_key text, p_back_source_ref text, p_captured_at timestamptz)
returns table(group_row jsonb, copy_row jsonb) language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare s public.variation_listing_intake_sessions; g public.variation_listing_groups; c public.variation_listing_copies;
begin
  select * into c from public.variation_listing_copies where capture_pair_id=p_capture_pair_id;
  if found then
    if c.copy_id is distinct from p_copy_id or c.variation_id is distinct from p_variation_id or c.condition_token is distinct from p_condition_token or c.capture_source_key is distinct from p_capture_source_key or c.front_r2_key is distinct from p_front_r2_key or c.back_r2_key is distinct from p_back_r2_key or c.capture_back_source_ref is distinct from p_back_source_ref then raise exception 'capture pair retry conflicts with persisted copy' using errcode = 'VR001'; end if;
    select * into g from public.variation_listing_groups where group_id=(select group_id from public.variation_listing_variations where variation_id=c.variation_id); return query select to_jsonb(g),to_jsonb(c); return;
  end if;
  select * into s from public.variation_listing_intake_sessions where capture_source_key=p_capture_source_key for update;
  select * into c from public.variation_listing_copies where capture_pair_id=p_capture_pair_id;
  if found then
    if c.copy_id is distinct from p_copy_id or c.variation_id is distinct from p_variation_id or c.condition_token is distinct from p_condition_token or c.capture_source_key is distinct from p_capture_source_key or c.front_r2_key is distinct from p_front_r2_key or c.back_r2_key is distinct from p_back_r2_key or c.capture_back_source_ref is distinct from p_back_source_ref then raise exception 'capture pair retry conflicts with persisted copy' using errcode = 'VR001'; end if;
    select * into g from public.variation_listing_groups where group_id=(select group_id from public.variation_listing_variations where variation_id=c.variation_id); return query select to_jsonb(g),to_jsonb(c); return;
  end if;
  if s.capture_source_key is null or s.pending_pair is null or s.mode <> 'duplicate_copy' then raise exception 'pending duplicate-copy pair required'; end if;
  if p_capture_pair_id::text <> s.pending_pair->>'pair_id'
     or s.pending_pair->>'mode' <> 'duplicate_copy'
     or s.target_group_id::text <> s.pending_pair->>'target_group_id'
     or p_variation_id::text <> s.pending_pair->>'target_variation_id'
     or s.target_variation_id is distinct from p_variation_id
     or s.sticky_price_amount <> (s.pending_pair->>'price_amount')::numeric then
    raise exception 'duplicate copy does not match pending snapshot';
  end if;
  select * into g from public.variation_listing_groups where group_id=s.target_group_id for update;
  if not found then raise exception 'target group not found'; end if;
  if g.desired_revision <> (s.pending_pair->>'expected_desired_revision')::bigint then raise exception 'stale intake desired revision' using errcode = 'VR001'; end if;
  if p_condition_token is null or p_condition_token not in ('NEAR_MINT_OR_BETTER','EXCELLENT','VERY_GOOD','POOR') then raise exception 'variation listing copy condition is invalid' using errcode = 'VR002'; end if;
  if (case p_condition_token when 'NEAR_MINT_OR_BETTER' then 0 when 'EXCELLENT' then 1 when 'VERY_GOOD' then 2 when 'POOR' then 3 end) > (case g.condition_token when 'NEAR_MINT_OR_BETTER' then 0 when 'EXCELLENT' then 1 when 'VERY_GOOD' then 2 when 'POOR' then 3 end) then raise exception 'variation listing copy condition is worse than group condition' using errcode = 'VR002'; end if;
  insert into public.variation_listing_copies(copy_id,variation_id,condition_token,front_r2_key,back_r2_key,capture_source_key,capture_pair_id,capture_front_source_ref,capture_back_source_ref,capture_started_at,captured_at) values(p_copy_id,s.target_variation_id,p_condition_token,p_front_r2_key,p_back_r2_key,p_capture_source_key,p_capture_pair_id,s.pending_pair->>'front_source_ref',p_back_source_ref,(s.pending_pair->>'started_at')::timestamptz,coalesce(p_captured_at,now()));
  update public.variation_listing_groups set desired_revision=desired_revision+1 where group_id=g.group_id;
  update public.variation_listing_intake_sessions set pending_pair=null where capture_source_key=p_capture_source_key;
  return query select to_jsonb(x),to_jsonb(y) from public.variation_listing_groups x join public.variation_listing_copies y on y.copy_id=p_copy_id where x.group_id=g.group_id;
end; $$;

-- Security posture: browser roles get neither table privileges nor RPC execution.
alter table public.variation_listing_publishing_checkpoints enable row level security;
revoke all privileges on table public.variation_listing_publishing_checkpoints from public, anon, authenticated;
grant select on table public.variation_listing_publishing_checkpoints to service_role;
revoke all privileges on table public.variation_listing_revisions from public, anon, authenticated, service_role;
grant select on table public.variation_listing_revisions to service_role;
revoke all privileges on table public.variation_listing_groups, public.variation_listing_variations, public.variation_listing_copies, public.variation_listing_intake_sessions from service_role;
grant select on table public.variation_listing_groups, public.variation_listing_variations, public.variation_listing_copies, public.variation_listing_intake_sessions to service_role;

revoke execute on function public.capture_variation_listing_revision(uuid,uuid,bigint,integer,text,jsonb,jsonb) from public, anon, authenticated;
revoke execute on function public.append_variation_listing_journal_checkpoint(uuid,text,uuid,integer,integer,text,text,jsonb) from public, anon, authenticated;
revoke execute on function public.confirm_variation_listing_revision(uuid,bigint,bigint) from public, anon, authenticated;
revoke execute on function public.create_variation_listing_group(uuid,text,text,text,text,text,text,text,text,text,text,text) from public, anon, authenticated;
revoke execute on function public.configure_variation_listing_intake(text,text,uuid,uuid,numeric) from public, anon, authenticated;
revoke execute on function public.start_variation_listing_intake_pair(text,uuid,text,timestamptz) from public, anon, authenticated;
revoke execute on function public.discard_variation_listing_intake_pair(text) from public, anon, authenticated;
revoke execute on function public.complete_variation_listing_new_variation(text,uuid,uuid,uuid,text,text,jsonb,text,text,text,timestamptz) from public, anon, authenticated;
revoke execute on function public.complete_variation_listing_duplicate_copy(text,uuid,uuid,uuid,text,text,text,text,timestamptz) from public, anon, authenticated;
revoke execute on function public.prevent_variation_listing_checkpoint_mutation() from public, anon, authenticated, service_role;
grant execute on function public.capture_variation_listing_revision(uuid,uuid,bigint,integer,text,jsonb,jsonb) to service_role;
grant execute on function public.append_variation_listing_journal_checkpoint(uuid,text,uuid,integer,integer,text,text,jsonb) to service_role;
grant execute on function public.confirm_variation_listing_revision(uuid,bigint,bigint) to service_role;
grant execute on function public.create_variation_listing_group(uuid,text,text,text,text,text,text,text,text,text,text,text) to service_role;
grant execute on function public.configure_variation_listing_intake(text,text,uuid,uuid,numeric) to service_role;
grant execute on function public.start_variation_listing_intake_pair(text,uuid,text,timestamptz) to service_role;
grant execute on function public.discard_variation_listing_intake_pair(text) to service_role;
grant execute on function public.complete_variation_listing_new_variation(text,uuid,uuid,uuid,text,text,jsonb,text,text,text,timestamptz) to service_role;
grant execute on function public.complete_variation_listing_duplicate_copy(text,uuid,uuid,uuid,text,text,text,text,timestamptz) to service_role;

commit;
