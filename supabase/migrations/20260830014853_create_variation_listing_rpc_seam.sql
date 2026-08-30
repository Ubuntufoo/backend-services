-- YP2.7b additive variation-listing RPC transaction seam.
-- Service-role only; no hosted/shared apply is implied by authoring this file.
--
-- The already-applied YP2.4/YP2.5 contract requires the transaction-sensitive
-- variation-listing journal writes to share one PostgreSQL transaction (group
-- row lock, exact revision CAS, the guarded group trigger, deferred
-- revision/operation-plan checks, and append-only attempt ordering). Supabase
-- REST `.from()` calls cannot provide that boundary, so these three narrow,
-- purpose-built RPC functions execute each write in a single transaction inside
-- the hosted PostgreSQL database. Normal reads and existing Single/Lot data
-- access keep using the existing Supabase client.
--
-- The aggregate-scope mutation seam (advancing `desired_revision` and writing
-- variation/copy rows through the YP2.4 proof/allocator path) is intentionally
-- deferred to YP3 intake; YP2.7b has no concrete aggregate mutation shape yet.
-- `confirm_variation_listing_revision` below exercises the same guarded-trigger
-- + transaction-local GUC seam that later mutation RPCs will reuse.

create function public.capture_variation_listing_revision(
  p_group_id uuid,
  p_revision_id uuid,
  p_captured_desired_revision bigint,
  p_snapshot_version integer,
  p_snapshot_digest text,
  p_snapshot jsonb,
  p_operations jsonb
)
returns table (
  revision jsonb,
  operations jsonb
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_desired_revision bigint;
  v_operation_count integer;
  v_revision_json jsonb;
  v_operations_json jsonb;
begin
  if jsonb_typeof(p_operations) is distinct from 'array' or jsonb_array_length(p_operations) = 0 then
    raise exception 'variation listing revision capture requires a non-empty ordered operation plan';
  end if;
  v_operation_count := jsonb_array_length(p_operations);

  select desired_revision into v_desired_revision
  from public.variation_listing_groups
  where group_id = p_group_id
  for update;

  if not found then
    raise exception 'variation listing group % not found', p_group_id;
  end if;

  if v_desired_revision is distinct from p_captured_desired_revision then
    raise exception 'variation listing revision capture CAS mismatch: captured % but group is at %',
      p_captured_desired_revision, v_desired_revision
      using errcode = 'VR001';
  end if;

  if exists (
    select 1
    from public.variation_listing_revisions
    where group_id = p_group_id and captured_desired_revision = p_captured_desired_revision
  ) then
    raise exception 'variation listing revision % is already captured for group %',
      p_captured_desired_revision, p_group_id
      using errcode = 'VR001';
  end if;

  insert into public.variation_listing_revisions (
    revision_id, group_id, captured_desired_revision, snapshot_version, snapshot_digest, snapshot, operation_count
  ) values (
    p_revision_id, p_group_id, p_captured_desired_revision, p_snapshot_version, p_snapshot_digest, p_snapshot, v_operation_count
  );

  insert into public.variation_listing_operations (
    operation_id, revision_id, sequence_no, operation_key, operation_kind, target_ref, intent_version, intent_digest, intent
  )
  select
    x.operation_id,
    p_revision_id,
    x.sequence_no,
    x.operation_key,
    x.operation_kind,
    x.target_ref,
    x.intent_version,
    x.intent_digest,
    x.intent
  from jsonb_to_recordset(p_operations) as x(
    operation_id uuid,
    sequence_no integer,
    operation_key text,
    operation_kind text,
    target_ref text,
    intent_version integer,
    intent_digest text,
    intent jsonb
  );

  select to_jsonb(r) into v_revision_json
  from public.variation_listing_revisions r
  where r.revision_id = p_revision_id;

  select coalesce(jsonb_agg(to_jsonb(o) order by o.sequence_no), '[]'::jsonb) into v_operations_json
  from public.variation_listing_operations o
  where o.revision_id = p_revision_id;

  return query select v_revision_json, v_operations_json;
end;
$$;

create function public.append_variation_listing_journal_checkpoint(
  p_operation_id uuid,
  p_checkpoint_id uuid,
  p_attempt_number integer,
  p_checkpoint_number integer,
  p_state text,
  p_evidence_version integer,
  p_pre_evidence jsonb,
  p_response_evidence jsonb,
  p_post_evidence jsonb,
  p_error_evidence jsonb,
  p_remote_identity jsonb,
  p_decision text,
  p_observed_remote_state text,
  p_current_state text,
  p_current_evidence_state text,
  p_current_evidence jsonb
)
returns table (
  operation jsonb,
  attempt jsonb
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_operation public.variation_listing_operations;
  v_group_id uuid;
  v_max_attempt integer;
  v_max_checkpoint integer;
  v_old_ambiguous boolean;
  v_latest_state text;
  v_latest_observed text;
  v_operation_json jsonb;
  v_attempt_json jsonb;
begin
  -- Append and confirmation both lock the owning group first, establishing a
  -- single serialization order for operation and whole-revision transitions.
  select r.group_id into v_group_id
  from public.variation_listing_operations o
  join public.variation_listing_revisions r on r.revision_id = o.revision_id
  where o.operation_id = p_operation_id;

  if v_group_id is null then
    raise exception 'variation listing operation % not found', p_operation_id;
  end if;

  perform 1
  from public.variation_listing_groups
  where group_id = v_group_id
  for update;

  if not found then
    raise exception 'variation listing group % not found', v_group_id;
  end if;

  select * into v_operation
  from public.variation_listing_operations
  where operation_id = p_operation_id
  for update;

  if not found then
    raise exception 'variation listing operation % not found', p_operation_id;
  end if;

  if v_operation.current_state in ('confirmed_complete', 'confirmed_no_op') then
    raise exception 'variation listing operation % is terminal and cannot be reopened', p_operation_id
      using errcode = 'VR003';
  end if;

  -- The mutable projection is a cache; its attempt number must stay consistent
  -- with the complete append-only attempt history before any new checkpoint.
  select coalesce(max(attempt_number), 0) into v_max_attempt
  from public.variation_listing_operation_attempts
  where operation_id = p_operation_id;

  if v_operation.latest_attempt_number is distinct from v_max_attempt then
    raise exception 'variation listing operation % projection attempt % does not match append-only history %',
      p_operation_id, v_operation.latest_attempt_number, v_max_attempt
      using errcode = 'VR002';
  end if;

  if v_max_attempt = 0
     and (v_operation.current_state is distinct from 'planned'
          or v_operation.current_evidence_state is not null
          or v_operation.current_evidence is not null) then
    raise exception 'variation listing operation % has a non-planned projection without durable checkpoint history',
      p_operation_id
      using errcode = 'VR002';
  end if;

  -- The existing mutable projection must agree with the existing latest durable
  -- checkpoint before another checkpoint is appended on top of it.
  if v_max_attempt > 0 then
    select a.state, a.observed_remote_state into v_latest_state, v_latest_observed
    from public.variation_listing_operation_attempts a
    where a.operation_id = p_operation_id
    order by a.attempt_number desc, a.checkpoint_number desc
    limit 1;

    if v_operation.current_state is distinct from v_latest_state
       or v_operation.current_evidence_state is distinct from v_latest_observed then
      raise exception 'variation listing operation % projection state % disagrees with latest checkpoint %',
        p_operation_id, v_operation.current_state, v_latest_state
        using errcode = 'VR002';
    end if;

  end if;

  if p_attempt_number is null or p_attempt_number < 1 then
    raise exception 'variation listing operation % attempt number must be positive', p_operation_id
      using errcode = 'VR002';
  end if;

  if p_attempt_number < v_max_attempt then
    raise exception 'variation listing operation % attempt-number regression: % is behind %',
      p_operation_id, p_attempt_number, v_max_attempt
      using errcode = 'VR002';
  end if;

  if p_attempt_number = v_max_attempt then
    select coalesce(max(checkpoint_number), 0) into v_max_checkpoint
    from public.variation_listing_operation_attempts
    where operation_id = p_operation_id and attempt_number = p_attempt_number;

    if p_checkpoint_number is distinct from v_max_checkpoint + 1 then
      raise exception 'variation listing operation % checkpoint ordering violation: expected checkpoint %, got %',
        p_operation_id, v_max_checkpoint + 1, p_checkpoint_number
        using errcode = 'VR002';
    end if;
  elsif p_attempt_number is distinct from v_max_attempt + 1
     or p_checkpoint_number is distinct from 1 then
    raise exception 'variation listing operation % new attempt must be contiguous and begin at checkpoint 1',
      p_operation_id
      using errcode = 'VR002';
  end if;

  -- The new checkpoint is durable authority: the supplied projection state must
  -- match it and must not introduce an internally inconsistent durable state.
  if p_current_state is distinct from p_state then
    raise exception 'variation listing operation % checkpoint state % conflicts with projection state %',
      p_operation_id, p_state, p_current_state
      using errcode = 'VR002';
  end if;

  if p_current_evidence_state is distinct from p_observed_remote_state then
    raise exception 'variation listing operation % projection evidence % contradicts observed remote state %',
      p_operation_id, p_current_evidence_state, p_observed_remote_state
      using errcode = 'VR002';
  end if;

  if p_state in ('confirmed_complete', 'confirmed_no_op')
     and (p_observed_remote_state is null
          or p_observed_remote_state not in ('present', 'proven_absent')) then
    raise exception 'variation listing terminal checkpoint % requires exact remote evidence', p_operation_id
      using errcode = 'VR003';
  end if;

  -- A mutation operation must durably record that it started before any
  -- terminal/ambiguous outcome. Only explicitly read-only reconciliation
  -- operations may begin with a confirmed checkpoint, because they never
  -- issue an external mutation request.
  if v_max_attempt = 0
     and v_operation.operation_kind not in ('revision_reconcile', 'final_absence_verification')
     and p_state <> 'started' then
    raise exception 'variation listing mutation operation % must begin with a started checkpoint', p_operation_id
      using errcode = 'VR003';
  end if;

  if v_max_attempt = 0
     and v_operation.operation_kind in ('revision_reconcile', 'final_absence_verification')
     and p_state in ('confirmed_complete', 'confirmed_no_op')
     and p_observed_remote_state not in ('present', 'proven_absent') then
    raise exception 'variation listing read-only reconciliation operation % requires exact remote evidence', p_operation_id
      using errcode = 'VR003';
  end if;

  -- A durable ambiguous/unknown outcome may be cleared only by an exact
  -- reconciliation checkpoint. It never disappears because a later caller
  -- supplied a clean projection.
  v_old_ambiguous := v_operation.current_state = 'unknown'
    or v_operation.current_evidence_state = 'unknown';

  -- A started checkpoint represents a request already issued (or still
  -- in-flight). It may record that request's response as unknown or confirmed
  -- on the same attempt, but a new attempt cannot start another mutation or
  -- even perform a read-back until that request is durably marked unknown.
  if v_operation.current_state = 'started' then
    if p_attempt_number <> v_max_attempt
       or p_state not in ('unknown', 'confirmed_complete', 'confirmed_no_op') then
      raise exception 'variation listing operation % started checkpoint must resolve on the same attempt before retry',
        p_operation_id
        using errcode = 'VR003';
    end if;
  end if;

  if v_old_ambiguous then
    if p_attempt_number <> v_max_attempt + 1 or p_checkpoint_number <> 1
       or p_state not in ('confirmed_complete', 'confirmed_no_op')
       or p_observed_remote_state not in ('present', 'proven_absent') then
      raise exception 'variation listing operation % ambiguous outcome requires an exact reconciliation checkpoint',
        p_operation_id
        using errcode = 'VR003';
    end if;
  end if;

  insert into public.variation_listing_operation_attempts (
    checkpoint_id, operation_id, attempt_number, checkpoint_number, state, evidence_version,
    pre_evidence, response_evidence, post_evidence, error_evidence, remote_identity, decision, observed_remote_state
  ) values (
    p_checkpoint_id, p_operation_id, p_attempt_number, p_checkpoint_number, p_state, p_evidence_version,
    p_pre_evidence, p_response_evidence, p_post_evidence, p_error_evidence, p_remote_identity, p_decision, p_observed_remote_state
  );

  update public.variation_listing_operations
  set current_state = p_current_state,
      current_evidence_state = p_current_evidence_state,
      current_evidence = p_current_evidence,
      latest_attempt_number = p_attempt_number
  where operation_id = p_operation_id;

  select to_jsonb(o) into v_operation_json
  from public.variation_listing_operations o
  where o.operation_id = p_operation_id;

  select to_jsonb(a) into v_attempt_json
  from public.variation_listing_operation_attempts a
  where a.checkpoint_id = p_checkpoint_id;

  return query select v_operation_json, v_attempt_json;
end;
$$;

create function public.confirm_variation_listing_revision(
  p_group_id uuid,
  p_expected_previous_confirmed_revision bigint,
  p_confirmed_revision bigint
)
returns table (
  group_row jsonb
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_group public.variation_listing_groups;
  v_revision public.variation_listing_revisions;
  v_operation record;
  v_actual_count integer;
  v_max_attempt integer;
  v_latest_state text;
  v_latest_observed text;
  v_group_json jsonb;
  v_attempt record;
  v_previous_attempt record;
  v_has_previous boolean := false;
begin
  select * into v_group
  from public.variation_listing_groups
  where group_id = p_group_id
  for update;

  if not found then
    raise exception 'variation listing group % not found', p_group_id;
  end if;

  if v_group.last_confirmed_revision is distinct from p_expected_previous_confirmed_revision then
    raise exception 'variation listing confirmation CAS mismatch: expected previous %, actual %',
      p_expected_previous_confirmed_revision, v_group.last_confirmed_revision
      using errcode = 'VR001';
  end if;

  if p_confirmed_revision is null or p_confirmed_revision < 1
     or p_confirmed_revision > v_group.desired_revision
     or p_confirmed_revision < coalesce(v_group.last_confirmed_revision, 0) then
    raise exception 'variation listing confirmation % is outside the allowed range [%, %]',
      p_confirmed_revision, greatest(coalesce(v_group.last_confirmed_revision, 0), 1), v_group.desired_revision
      using errcode = 'VR001';
  end if;

  -- The confirmed revision must be one real immutable captured revision for
  -- this group. last_confirmed_revision is durable database truth and this RPC
  -- is its write authority, so it cannot advance on a revision that was never
  -- captured or whose whole operation plan is not yet resolved.
  select * into v_revision
  from public.variation_listing_revisions
  where group_id = p_group_id
    and captured_desired_revision = p_confirmed_revision;

  if not found then
    raise exception 'variation listing revision % is not captured for group %',
      p_confirmed_revision, p_group_id
      using errcode = 'VR004';
  end if;

  select count(*)::integer into v_actual_count
  from public.variation_listing_operations
  where revision_id = v_revision.revision_id;

  if v_actual_count is distinct from v_revision.operation_count then
    raise exception 'variation listing revision % has an incomplete operation plan: expected %, actual %',
      v_revision.revision_id, v_revision.operation_count, v_actual_count
      using errcode = 'VR004';
  end if;

  -- Every operation in the captured plan must be resolved and its projection
  -- must agree with durable history before the whole revision may be confirmed.
  for v_operation in
    select * from public.variation_listing_operations
    where revision_id = v_revision.revision_id
    order by sequence_no
    for update
  loop
    if v_operation.current_state not in ('confirmed_complete', 'confirmed_no_op') then
      raise exception 'variation listing operation % in revision % is not resolved (state %)',
        v_operation.operation_id, v_revision.revision_id, v_operation.current_state
        using errcode = 'VR004';
    end if;

    select coalesce(max(attempt_number), 0) into v_max_attempt
    from public.variation_listing_operation_attempts
    where operation_id = v_operation.operation_id;

    if v_operation.latest_attempt_number is distinct from v_max_attempt then
      raise exception 'variation listing operation % projection attempt % does not match append-only history %',
        v_operation.operation_id, v_operation.latest_attempt_number, v_max_attempt
        using errcode = 'VR004';
    end if;

    if v_max_attempt = 0 then
      raise exception 'variation listing operation % is confirmed in projection without durable checkpoint history',
        v_operation.operation_id
        using errcode = 'VR004';
    end if;

    -- Revalidate the complete durable history before allowing the watermark
    -- to advance. This protects the confirmation authority even if rows were
    -- written by a pre-seam grant or a maintenance path that bypassed append.
    v_has_previous := false;
    for v_attempt in
      select *
      from public.variation_listing_operation_attempts
      where operation_id = v_operation.operation_id
      order by attempt_number, checkpoint_number
    loop
      if not v_has_previous then
        if v_attempt.attempt_number <> 1 or v_attempt.checkpoint_number <> 1 then
          raise exception 'variation listing operation % history must begin at attempt 1/checkpoint 1',
            v_operation.operation_id
            using errcode = 'VR004';
        end if;
        if v_operation.operation_kind not in ('revision_reconcile', 'final_absence_verification')
           and v_attempt.state <> 'started' then
          raise exception 'variation listing mutation operation % history must begin with started',
            v_operation.operation_id
            using errcode = 'VR004';
        end if;
        if v_attempt.state in ('confirmed_complete', 'confirmed_no_op')
           and v_attempt.observed_remote_state not in ('present', 'proven_absent') then
          raise exception 'variation listing operation % terminal history requires exact evidence',
            v_operation.operation_id
            using errcode = 'VR004';
        end if;
        v_has_previous := true;
      else
        if not (
          (v_attempt.attempt_number = v_previous_attempt.attempt_number
           and v_attempt.checkpoint_number = v_previous_attempt.checkpoint_number + 1)
          or
          (v_attempt.attempt_number = v_previous_attempt.attempt_number + 1
           and v_attempt.checkpoint_number = 1)
        ) then
          raise exception 'variation listing operation % history has non-contiguous checkpoints',
            v_operation.operation_id
            using errcode = 'VR004';
        end if;

        if v_attempt.state in ('confirmed_complete', 'confirmed_no_op')
           and v_attempt.observed_remote_state not in ('present', 'proven_absent') then
          raise exception 'variation listing operation % terminal history requires exact evidence',
            v_operation.operation_id
            using errcode = 'VR004';
        end if;

        if v_previous_attempt.state = 'started' then
          if v_attempt.attempt_number <> v_previous_attempt.attempt_number
             or v_attempt.state not in ('unknown', 'confirmed_complete', 'confirmed_no_op') then
            raise exception 'variation listing operation % started checkpoint must resolve on the same attempt',
              v_operation.operation_id
              using errcode = 'VR004';
          end if;
        elsif v_previous_attempt.state = 'unknown'
           or v_previous_attempt.observed_remote_state = 'unknown' then
          if v_attempt.attempt_number <> v_previous_attempt.attempt_number + 1
             or v_attempt.checkpoint_number <> 1
             or v_attempt.state not in ('confirmed_complete', 'confirmed_no_op')
             or v_attempt.observed_remote_state not in ('present', 'proven_absent') then
            raise exception 'variation listing operation % ambiguous history requires exact reconciliation',
              v_operation.operation_id
              using errcode = 'VR004';
          end if;
        elsif v_previous_attempt.state in ('confirmed_complete', 'confirmed_no_op') then
          raise exception 'variation listing operation % terminal history cannot be reopened',
            v_operation.operation_id
            using errcode = 'VR004';
        end if;
      end if;

      v_previous_attempt := v_attempt;
    end loop;

    if v_max_attempt > 0 then
      select a.state, a.observed_remote_state into v_latest_state, v_latest_observed
      from public.variation_listing_operation_attempts a
      where a.operation_id = v_operation.operation_id
      order by a.attempt_number desc, a.checkpoint_number desc
      limit 1;

      if v_latest_state not in ('confirmed_complete', 'confirmed_no_op')
         or v_latest_observed = 'unknown' then
        raise exception 'variation listing operation % latest checkpoint is not a confirmed outcome',
          v_operation.operation_id
          using errcode = 'VR004';
      end if;

      if v_operation.current_state is distinct from v_latest_state
         or v_operation.current_evidence_state is distinct from v_latest_observed then
        raise exception 'variation listing operation % projection state % disagrees with latest checkpoint %',
          v_operation.operation_id, v_operation.current_state, v_latest_state
          using errcode = 'VR004';
      end if;

      if v_latest_observed is not null
         and v_operation.current_evidence_state is distinct from v_latest_observed then
        raise exception 'variation listing operation % projection evidence % contradicts observed remote state %',
          v_operation.operation_id, v_operation.current_evidence_state, v_latest_observed
          using errcode = 'VR004';
      end if;
    end if;
  end loop;

  -- Run the confirmation transition through the existing guarded YP2.4 seam so
  -- the trigger enforces the exact confirmation contract and never lets an
  -- individual operation success advance last_confirmed_revision.
  perform set_config('app.variation_listing_write_scope', 'confirmation', true);
  perform set_config('app.variation_listing_group_id', p_group_id::text, true);
  perform set_config('app.variation_listing_expected_revision', v_group.desired_revision::text, true);

  update public.variation_listing_groups
  set last_confirmed_revision = p_confirmed_revision
  where group_id = p_group_id;

  select to_jsonb(g) into v_group_json
  from public.variation_listing_groups g
  where g.group_id = p_group_id;

  return query select v_group_json;
end;
$$;

revoke all on function public.capture_variation_listing_revision(uuid, uuid, bigint, integer, text, jsonb, jsonb) from public;
revoke all on function public.append_variation_listing_journal_checkpoint(uuid, uuid, integer, integer, text, integer, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, text, text, jsonb) from public;
revoke all on function public.confirm_variation_listing_revision(uuid, bigint, bigint) from public;

grant execute on function public.capture_variation_listing_revision(uuid, uuid, bigint, integer, text, jsonb, jsonb) to service_role;
grant execute on function public.append_variation_listing_journal_checkpoint(uuid, uuid, integer, integer, text, integer, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, text, text, jsonb) to service_role;
grant execute on function public.confirm_variation_listing_revision(uuid, bigint, bigint) to service_role;

-- YP2.5 granted service_role direct UPDATE access to the mutable projection.
-- Remove all direct journal writes additively; the SECURITY DEFINER RPCs are
-- now the sole revision/operation/attempt mutation seam. Rollback restores the
-- historical YP2.5 grants.
revoke insert on table public.variation_listing_revisions,
  public.variation_listing_operations,
  public.variation_listing_operation_attempts from service_role;
revoke update on table public.variation_listing_operations from service_role;
