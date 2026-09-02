-- YP5.4: durable, CAS-guarded cleanup lifecycle transitions.
-- This migration only adds a narrow lifecycle RPC. Remote cleanup remains
-- journaled and read-before-write in the sidecar executor.
begin;

create function public.advance_variation_listing_cleanup_lifecycle(
  p_group_id uuid,
  p_revision_id uuid,
  p_expected_desired_revision bigint,
  p_expected_previous_confirmed_revision bigint,
  p_target_lifecycle text
) returns table(group_row jsonb)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  g public.variation_listing_groups;
  r public.variation_listing_revisions;
  op jsonb;
  k text;
  latest record;
  withdrawal_latest record;
  final_latest record;
  operation_count integer;
  final_count integer;
  withdrawal_count integer;
  has_withdrawal boolean;
  terminal_lifecycle text;
  plan_index integer;
  kind text;
  seen_offer boolean := false;
  seen_group boolean := false;
  seen_item boolean := false;
begin
  if p_expected_desired_revision is null or p_expected_desired_revision < 0 then
    raise exception 'variation listing cleanup desired revision is invalid' using errcode = 'VR002';
  end if;
  if p_target_lifecycle not in ('withdrawn', 'cleanup', 'abandoned', 'terminal-absent') then
    raise exception 'variation listing cleanup target lifecycle is invalid' using errcode = 'VR002';
  end if;

  select * into g
    from public.variation_listing_groups
   where group_id = p_group_id
   for update;
  if not found then
    raise exception 'variation listing group not found' using errcode = 'VR004';
  end if;
  if g.desired_revision is distinct from p_expected_desired_revision
     or g.last_confirmed_revision is distinct from p_expected_previous_confirmed_revision then
    raise exception 'variation listing cleanup lifecycle CAS mismatch' using errcode = 'VR001';
  end if;

  select * into r
    from public.variation_listing_revisions
   where revision_id = p_revision_id
     and group_id = p_group_id;
  if not found then
    raise exception 'variation listing cleanup revision not found' using errcode = 'VR004';
  end if;
  if r.captured_desired_revision is distinct from p_expected_desired_revision then
    raise exception 'variation listing cleanup revision is stale' using errcode = 'VR001';
  end if;

  -- Cleanup lifecycle may only consume a cleanup plan captured by the pure
  -- planner. Reject a publish/intake revision even if its checkpoints happen
  -- to look resolved; this prevents a stale desired update from being reused
  -- as a destructive plan.
  if jsonb_typeof(r.snapshot) is distinct from 'object'
     or jsonb_typeof(r.snapshot->'planVersion') is distinct from 'number'
     or r.snapshot->>'planVersion' <> '1'
     or r.snapshot->>'groupKey' is distinct from g.group_key
     or r.snapshot->>'marketplaceId' is distinct from g.marketplace_id
     or jsonb_typeof(r.snapshot->'orderedSkus') is distinct from 'array'
     or jsonb_typeof(r.snapshot->'ownedRemote') is distinct from 'object'
     or jsonb_typeof(r.snapshot->'observed') is distinct from 'object'
     or r.snapshot->>'terminalLifecycle' is null
     or r.snapshot->>'terminalLifecycle' not in ('abandoned', 'terminal-absent') then
    raise exception 'variation listing cleanup revision snapshot is incompatible' using errcode = 'VR004';
  end if;
  terminal_lifecycle := r.snapshot->>'terminalLifecycle';

  if jsonb_typeof(r.operation_plan) is distinct from 'array'
     or jsonb_array_length(r.operation_plan) <> r.operation_count
     or r.operation_count < 1 then
    raise exception 'variation listing cleanup revision plan is invalid' using errcode = 'VR004';
  end if;
  operation_count := jsonb_array_length(r.operation_plan);
  select count(*)::integer into final_count
    from jsonb_array_elements(r.operation_plan) x
   where x->>'operation_kind' = 'final_absence_verification';
  select count(*)::integer into withdrawal_count
    from jsonb_array_elements(r.operation_plan) x
   where x->>'operation_kind' = 'withdrawal';
  if final_count <> 1 or withdrawal_count > 1
     or (r.operation_plan->(operation_count - 1))->>'operation_kind' <> 'final_absence_verification' then
    raise exception 'variation listing cleanup revision plan has invalid lifecycle operations' using errcode = 'VR004';
  end if;
  has_withdrawal := withdrawal_count = 1;
  for op, plan_index in
    select value, ordinality::integer
      from jsonb_array_elements(r.operation_plan) with ordinality
  loop
    kind := op->>'operation_kind';
    if op->>'sequence_no' is distinct from plan_index::text
       or nullif(btrim(op->>'operation_key'), '') is null
       or op->>'operation_key' is distinct from btrim(op->>'operation_key')
       or kind is null
       or kind not in ('withdrawal', 'cleanup_offer', 'cleanup_group', 'cleanup_child_inventory_item', 'final_absence_verification')
       or nullif(btrim(op->>'target_ref'), '') is null
       or op->>'target_ref' is distinct from btrim(op->>'target_ref')
       or jsonb_typeof(op->'intent_version') is distinct from 'number'
       or op->>'intent_version' !~ '^[1-9][0-9]*$'
       or op->>'intent_digest' !~ '^[0-9a-f]{64}$'
       or jsonb_typeof(op->'intent') is distinct from 'object' then
      raise exception 'variation listing cleanup revision contains a non-cleanup operation' using errcode = 'VR004';
    end if;
    if (select count(*) from jsonb_array_elements(r.operation_plan) x where x->>'operation_key' = op->>'operation_key') <> 1 then
      raise exception 'variation listing cleanup revision operation keys must be unique' using errcode = 'VR004';
    end if;
    if kind = 'withdrawal' then
      if plan_index <> 1 or has_withdrawal and seen_offer then
        raise exception 'variation listing cleanup withdrawal must be first' using errcode = 'VR004';
      end if;
    elsif kind = 'cleanup_offer' then
      if seen_group or seen_item then
        raise exception 'variation listing cleanup offers must precede group and item cleanup' using errcode = 'VR004';
      end if;
      seen_offer := true;
    elsif kind = 'cleanup_group' then
      if seen_item then
        raise exception 'variation listing cleanup group must precede item cleanup' using errcode = 'VR004';
      end if;
      seen_group := true;
    elsif kind = 'cleanup_child_inventory_item' then
      seen_item := true;
    elsif kind = 'final_absence_verification' and plan_index <> operation_count then
      raise exception 'variation listing final absence operation must be last' using errcode = 'VR004';
    end if;
  end loop;

  if has_withdrawal and (p_target_lifecycle = 'withdrawn'
    or (p_target_lifecycle = 'cleanup' and g.lifecycle_state = 'withdrawn')) then
    select * into withdrawal_latest
      from public.variation_listing_publishing_checkpoints c
     where c.revision_id = r.revision_id
       and c.operation_key = (
         select x->>'operation_key' from jsonb_array_elements(r.operation_plan) x
          where x->>'operation_kind' = 'withdrawal'
       )
     order by c.attempt_number desc, c.checkpoint_number desc
     limit 1;
    if withdrawal_latest.state is null
       or withdrawal_latest.state not in ('confirmed_complete', 'confirmed_no_op')
       or withdrawal_latest.observed_remote_state is null
       or withdrawal_latest.observed_remote_state not in ('present', 'proven_absent') then
      raise exception 'variation listing cleanup withdrawal operation is unresolved' using errcode = 'VR004';
    end if;
  end if;

  if p_target_lifecycle in ('abandoned', 'terminal-absent') then
    -- Every operation must have one fully resolved latest checkpoint. This is
    -- deliberately stricter than merely checking the final absence operation:
    -- terminal lifecycle state is only durable after the complete frozen plan
    -- is proven.
    for op in select value from jsonb_array_elements(r.operation_plan) loop
      k := op->>'operation_key';
      if k is null or btrim(k) = '' then
        raise exception 'variation listing cleanup revision contains an invalid operation key' using errcode = 'VR004';
      end if;
      select * into latest
        from public.variation_listing_publishing_checkpoints
       where revision_id = r.revision_id
         and operation_key = k
       order by attempt_number desc, checkpoint_number desc
       limit 1;
      if latest.state is null
         or latest.state not in ('confirmed_complete', 'confirmed_no_op')
         or latest.observed_remote_state not in ('present', 'proven_absent')
         or latest.evidence = '{}'::jsonb then
        raise exception 'variation listing cleanup operation % is unresolved', k using errcode = 'VR004';
      end if;
      if latest.state = 'confirmed_no_op' and exists (
        select 1
          from public.variation_listing_publishing_checkpoints h
         where h.revision_id = r.revision_id
           and h.operation_key = k
           and (h.state = 'unknown' or h.observed_remote_state = 'unknown')
      ) then
        raise exception 'variation listing cleanup operation % reconciled to no-effect after unknown', k using errcode = 'VR004';
      end if;
    end loop;

    select * into final_latest
      from public.variation_listing_publishing_checkpoints
     where revision_id = r.revision_id
       and operation_key = r.operation_plan->(operation_count - 1)->>'operation_key'
     order by attempt_number desc, checkpoint_number desc
     limit 1;
    if final_latest.observed_remote_state <> 'proven_absent' then
      raise exception 'variation listing cleanup final absence requires proven absence' using errcode = 'VR004';
    end if;
  end if;

  if p_target_lifecycle = 'withdrawn' then
    if not has_withdrawal or g.lifecycle_state not in ('active', 'withdrawn') then
      raise exception 'variation listing cleanup withdrawal lifecycle transition is invalid' using errcode = 'VR002';
    end if;
  elsif p_target_lifecycle = 'cleanup' then
    if g.lifecycle_state = 'cleanup' then
      null;
    elsif g.lifecycle_state = 'withdrawn'
      and (has_withdrawal or terminal_lifecycle = 'terminal-absent') then
      null;
    elsif g.lifecycle_state = 'active'
      and not has_withdrawal
      and terminal_lifecycle = 'terminal-absent'
      and jsonb_array_length(r.snapshot->'orderedSkus') > 0
      and jsonb_typeof(r.snapshot->'ownedRemote'->'publicationHistoryExists') = 'boolean'
      and r.snapshot->'ownedRemote'->>'publicationHistoryExists' = 'true'
      and jsonb_typeof(r.snapshot->'ownedRemote'->'listingId') = 'string'
      and nullif(btrim(r.snapshot->'ownedRemote'->>'listingId'), '') is not null
      and jsonb_typeof(r.snapshot->'ownedRemote'->'offerIdsBySku') = 'object'
      and r.snapshot->'observed'->>'state' = 'inactive-or-unpublished'
      and r.snapshot->'observed'->'activeListingId' = 'null'::jsonb
      and r.snapshot->'observed'->'groupPresent' = 'true'::jsonb
      and jsonb_typeof(r.snapshot->'observed'->'itemPresentSkus') = 'array'
      and jsonb_typeof(r.snapshot->'observed'->'offerPresentSkus') = 'array'
      and not exists (
        select 1
          from jsonb_array_elements_text(r.snapshot->'orderedSkus') sku
         where not (
           r.snapshot->'ownedRemote'->'offerIdsBySku' ? sku
           and jsonb_typeof(r.snapshot->'ownedRemote'->'offerIdsBySku'->sku) = 'string'
           and nullif(btrim(r.snapshot->'ownedRemote'->'offerIdsBySku'->>sku), '') is not null
           and exists (
             select 1 from jsonb_array_elements_text(r.snapshot->'observed'->'itemPresentSkus') item_sku
              where item_sku = sku
           )
           and exists (
             select 1 from jsonb_array_elements_text(r.snapshot->'observed'->'offerPresentSkus') offer_sku
              where offer_sku = sku
           )
         )
      ) then
      -- eBay may already have ended the exact owned listing outside this
      -- process. The frozen cleanup preflight proves definitive non-active
      -- publication state, so withdrawal is unnecessary and cleanup may start
      -- directly from the still-active local lifecycle.
      null;
    elsif g.lifecycle_state in ('intake', 'draft', 'review', 'publish-ready', 'publishing')
      and not has_withdrawal
      and terminal_lifecycle = 'abandoned' then
      null;
    else
      raise exception 'variation listing cleanup start lifecycle transition is invalid' using errcode = 'VR002';
    end if;
  elsif p_target_lifecycle = 'abandoned' then
    if terminal_lifecycle <> 'abandoned'
       or g.lifecycle_state not in ('cleanup', 'abandoned') then
      raise exception 'variation listing abandonment lifecycle transition is invalid' using errcode = 'VR002';
    end if;
  elsif p_target_lifecycle = 'terminal-absent' then
    if terminal_lifecycle <> 'terminal-absent'
       or g.lifecycle_state not in ('cleanup', 'terminal-absent') then
      raise exception 'variation listing terminal absence lifecycle transition is invalid' using errcode = 'VR002';
    end if;
  end if;

  update public.variation_listing_groups
     set lifecycle_state = p_target_lifecycle
   where group_id = p_group_id;

  return query
  select to_jsonb(x)
    from public.variation_listing_groups x
   where x.group_id = p_group_id;
end;
$$;


-- Untouched revision-0 groups cannot use the positive-revision publishing
-- journal. This separate read-only abandonment seam keeps that invariant: the
-- sidecar must first prove exact remote group absence, then this RPC only
-- permits a truly empty, unarmed, never-confirmed intake group to become
-- abandoned. It never increments desired_revision and cannot touch published
-- or allocated groups.
create function public.abandon_untouched_variation_listing_group(
  p_group_id uuid,
  p_expected_desired_revision bigint
) returns table(group_row jsonb)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  g public.variation_listing_groups;
begin
  if p_expected_desired_revision is distinct from 0 then
    raise exception 'variation listing untouched abandonment requires desired revision 0' using errcode = 'VR002';
  end if;
  select * into g
    from public.variation_listing_groups
   where group_id = p_group_id
   for update;
  if not found then
    raise exception 'variation listing group not found' using errcode = 'VR004';
  end if;
  if g.desired_revision is distinct from 0
     or g.last_confirmed_revision is not null then
    raise exception 'variation listing untouched abandonment CAS mismatch' using errcode = 'VR001';
  end if;
  if g.lifecycle_state = 'abandoned' then
    return query select to_jsonb(x) from public.variation_listing_groups x where x.group_id = p_group_id;
    return;
  end if;
  if g.lifecycle_state <> 'intake'
     or g.next_inventory_serial <> 1
     or exists (select 1 from public.variation_listing_variations v where v.group_id = p_group_id)
     or exists (
       select 1 from public.variation_listing_intake_sessions s
        where s.target_group_id = p_group_id
           or (s.pending_pair is not null and s.pending_pair->>'target_group_id' = p_group_id::text)
     ) then
    raise exception 'variation listing untouched abandonment requires an empty unarmed intake group' using errcode = 'VR002';
  end if;
  update public.variation_listing_groups
     set lifecycle_state = 'abandoned'
   where group_id = p_group_id;
  return query select to_jsonb(x) from public.variation_listing_groups x where x.group_id = p_group_id;
end;
$$;

revoke all on function public.abandon_untouched_variation_listing_group(uuid,bigint)
  from public, anon, authenticated;
grant execute on function public.abandon_untouched_variation_listing_group(uuid,bigint)
  to service_role;

revoke all on function public.advance_variation_listing_cleanup_lifecycle(uuid,uuid,bigint,bigint,text)
  from public, anon, authenticated;
grant execute on function public.advance_variation_listing_cleanup_lifecycle(uuid,uuid,bigint,bigint,text)
  to service_role;

commit;
