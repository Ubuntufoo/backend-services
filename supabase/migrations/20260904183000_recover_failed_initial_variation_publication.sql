-- Recover a fully reconciled failed initial publication back to editable review.
-- Existing overlong selector rows are intentionally not validated so the live
-- diagnostic group can be shortened after recovery; all future inserts/updates
-- must satisfy the eBay 65-character Card selector limit.
begin;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.variation_listing_variations'::regclass
       and conname = 'variation_listing_variations_selector_value_ebay_length_check'
  ) then
    alter table public.variation_listing_variations
      add constraint variation_listing_variations_selector_value_ebay_length_check
      check (char_length(selector_value) between 1 and 65) not valid;
  end if;
end $$;

-- Match the cleanup planner's canonical JSON serialization for the small
-- string/object/array intents below. The RPC below first constrains every
-- persisted SKU key to the group's exact prefix plus six decimal digits; for
-- that bounded key set, C ordering matches the planner's default localeCompare
-- ordering while avoiding a database-locale dependency.
create function public.variation_listing_recovery_canonical_json(p_value jsonb)
returns text
language plpgsql
immutable
strict
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_type text := jsonb_typeof(p_value);
  v_result text;
  v_first boolean;
  v_key text;
  v_child jsonb;
begin
  if v_type = 'object' then
    v_result := '{';
    v_first := true;
    for v_key, v_child in
      select key, value from jsonb_each(p_value) order by key collate "C"
    loop
      if not v_first then v_result := v_result || ','; end if;
      v_result := v_result
        || public.variation_listing_recovery_canonical_json(to_jsonb(v_key))
        || ':'
        || public.variation_listing_recovery_canonical_json(v_child);
      v_first := false;
    end loop;
    return v_result || '}';
  elsif v_type = 'array' then
    v_result := '[';
    v_first := true;
    for v_child in select value from jsonb_array_elements(p_value)
    loop
      if not v_first then v_result := v_result || ','; end if;
      v_result := v_result || public.variation_listing_recovery_canonical_json(v_child);
      v_first := false;
    end loop;
    return v_result || ']';
  end if;
  return p_value::text;
end;
$$;

create function public.return_variation_listing_to_review(
  p_group_id uuid,
  p_expected_desired_revision bigint,
  p_cleanup_revision_id uuid
) returns table (group_row jsonb)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_group public.variation_listing_groups;
  v_revision public.variation_listing_revisions;
  v_operation jsonb;
  v_latest public.variation_listing_publishing_checkpoints;
  v_operation_count integer;
  v_final_count integer;
  v_withdrawal_count integer;
  v_plan_index integer;
  v_kind text;
  v_seen_offer boolean := false;
  v_seen_group boolean := false;
  v_seen_item boolean := false;
begin
  if p_expected_desired_revision is null or p_expected_desired_revision < 1 then
    raise exception 'variation listing return-to-review expected revision is invalid' using errcode = 'VR002';
  end if;

  select * into v_group
    from public.variation_listing_groups
   where group_id = p_group_id
   for update;
  if not found then
    raise exception 'variation listing group not found' using errcode = 'VR004';
  end if;
  if v_group.desired_revision <> p_expected_desired_revision then
    raise exception 'variation listing return-to-review CAS mismatch' using errcode = 'VR001';
  end if;
  if v_group.last_confirmed_revision is not null then
    raise exception 'published variation listing cannot return to unpublished review' using errcode = 'VR002';
  end if;
  if v_group.lifecycle_state <> 'abandoned' then
    raise exception 'variation listing must complete unpublished remote cleanup before returning to review' using errcode = 'VR002';
  end if;
  if exists (
    select 1
      from public.variation_listing_intake_sessions s
     where s.pending_pair is not null
       and (s.target_group_id = p_group_id
         or s.pending_pair->>'target_group_id' = p_group_id::text)
  ) then
    raise exception 'variation listing pending intake pair blocks return to review' using errcode = 'VR002';
  end if;

  select * into v_revision
    from public.variation_listing_revisions
   where revision_id = p_cleanup_revision_id
     and group_id = p_group_id
     and captured_desired_revision = p_expected_desired_revision;
  if not found then
    raise exception 'variation listing cleanup revision does not match return-to-review state' using errcode = 'VR002';
  end if;

  -- Revalidate the immutable cleanup snapshot/plan here instead of relying on
  -- the earlier lifecycle transition alone. This keeps the reopen seam
  -- fail-closed if a historical row was produced by an older or malformed
  -- writer and guarantees the revision is the exact unpublished cleanup plan.
  if jsonb_typeof(v_revision.snapshot) is distinct from 'object'
     or jsonb_typeof(v_revision.snapshot->'planVersion') is distinct from 'number'
     or v_revision.snapshot->>'planVersion' <> '1'
     or v_revision.snapshot->>'groupKey' is distinct from v_group.group_key
     or v_revision.snapshot->>'marketplaceId' is distinct from v_group.marketplace_id
     or jsonb_typeof(v_revision.snapshot->'orderedSkus') is distinct from 'array'
     or jsonb_typeof(v_revision.snapshot->'ownedRemote') is distinct from 'object'
     or jsonb_typeof(v_revision.snapshot->'observed') is distinct from 'object'
     or v_revision.snapshot->>'terminalLifecycle' is distinct from 'abandoned'
     or jsonb_typeof(v_revision.snapshot->'ownedRemote'->'publicationHistoryExists') is distinct from 'boolean'
     or v_revision.snapshot->'ownedRemote'->>'publicationHistoryExists' <> 'false'
     or v_revision.snapshot->'ownedRemote'->'listingId' is distinct from 'null'::jsonb
     or jsonb_typeof(v_revision.snapshot->'ownedRemote'->'offerIdsBySku') is distinct from 'object'
     or v_revision.snapshot->'observed'->'activeListingId' is distinct from 'null'::jsonb
     or jsonb_typeof(v_revision.snapshot->'observed'->'groupPresent') is distinct from 'boolean'
     or jsonb_typeof(v_revision.snapshot->'observed'->'itemPresentSkus') is distinct from 'array'
     or jsonb_typeof(v_revision.snapshot->'observed'->'offerPresentSkus') is distinct from 'array'
     or v_revision.snapshot->'observed'->>'state' is null
     or v_revision.snapshot->'observed'->>'state' not in ('absent', 'inactive-or-unpublished') then
    raise exception 'variation listing cleanup revision snapshot is incompatible' using errcode = 'VR002';
  end if;
  if exists (
    select 1
      from jsonb_array_elements_text(v_revision.snapshot->'orderedSkus') sku
     where length(sku) <> length(v_group.sku_category_code || '-' || v_group.sku_bucket_token || '-000000')
        or left(sku, length(v_group.sku_category_code || '-' || v_group.sku_bucket_token || '-'))
             is distinct from v_group.sku_category_code || '-' || v_group.sku_bucket_token || '-'
        or right(sku, 6) !~ '^[0-9]{6}$'
        or right(sku, 6) = '000000'
  )
  or (select count(*) from jsonb_array_elements_text(v_revision.snapshot->'orderedSkus'))
       <> (select count(distinct sku) from jsonb_array_elements_text(v_revision.snapshot->'orderedSkus') sku)
  or exists (
    select 1
      from jsonb_each(v_revision.snapshot->'ownedRemote'->'offerIdsBySku') offer(sku, offer_id)
     where not exists (
       select 1
         from jsonb_array_elements_text(v_revision.snapshot->'orderedSkus') ordered
        where ordered = offer.sku
     )
        or jsonb_typeof(offer.offer_id) is distinct from 'string'
        or nullif(btrim(offer.offer_id #>> '{}'), '') is null
  ) then
    raise exception 'variation listing cleanup revision SKU identity is incompatible' using errcode = 'VR002';
  end if;
  if jsonb_typeof(v_revision.operation_plan) is distinct from 'array'
     or jsonb_array_length(v_revision.operation_plan) <> v_revision.operation_count
     or v_revision.operation_count < 1 then
    raise exception 'variation listing cleanup revision plan is invalid' using errcode = 'VR002';
  end if;
  v_operation_count := jsonb_array_length(v_revision.operation_plan);
  select count(*)::integer into v_final_count
    from jsonb_array_elements(v_revision.operation_plan) op
   where op->>'operation_kind' = 'final_absence_verification';
  select count(*)::integer into v_withdrawal_count
    from jsonb_array_elements(v_revision.operation_plan) op
   where op->>'operation_kind' = 'withdrawal';
  if v_final_count <> 1
     or v_withdrawal_count <> 0
     or (v_revision.operation_plan->(v_operation_count - 1))->>'operation_kind' <> 'final_absence_verification' then
    raise exception 'variation listing cleanup revision plan has invalid lifecycle operations' using errcode = 'VR002';
  end if;
  for v_operation, v_plan_index in
    select value, ordinality::integer
      from jsonb_array_elements(v_revision.operation_plan) with ordinality
  loop
    v_kind := v_operation->>'operation_kind';
    if v_operation->>'sequence_no' is distinct from v_plan_index::text
       or nullif(btrim(v_operation->>'operation_key'), '') is null
       or v_operation->>'operation_key' is distinct from btrim(v_operation->>'operation_key')
       or v_kind is null
       or v_kind not in ('cleanup_offer', 'cleanup_group', 'cleanup_child_inventory_item', 'final_absence_verification')
       or nullif(btrim(v_operation->>'target_ref'), '') is null
       or v_operation->>'target_ref' is distinct from btrim(v_operation->>'target_ref')
       or jsonb_typeof(v_operation->'intent_version') is distinct from 'number'
       or v_operation->>'intent_version' !~ '^[1-9][0-9]*$'
       or v_operation->>'intent_digest' is null
       or v_operation->>'intent_digest' !~ '^[0-9a-f]{64}$'
       or jsonb_typeof(v_operation->'intent') is distinct from 'object' then
      raise exception 'variation listing cleanup revision contains a non-cleanup operation' using errcode = 'VR002';
    end if;
    if (select count(*) from jsonb_array_elements(v_revision.operation_plan) op
         where op->>'operation_key' = v_operation->>'operation_key') <> 1 then
      raise exception 'variation listing cleanup revision operation keys must be unique' using errcode = 'VR002';
    end if;
    if v_kind = 'cleanup_offer' then
      if (select count(*) from jsonb_object_keys(v_operation->'intent')) <> 2
         or not (v_operation->'intent' ? 'offerId')
         or not (v_operation->'intent' ? 'sku')
         or jsonb_typeof(v_operation->'intent'->'offerId') is distinct from 'string'
         or jsonb_typeof(v_operation->'intent'->'sku') is distinct from 'string'
         or nullif(btrim(v_operation->'intent'->>'offerId'), '') is null
         or nullif(btrim(v_operation->'intent'->>'sku'), '') is null
         or v_operation->>'operation_key' is distinct from 'cleanup-offer:' || (v_operation->'intent'->>'sku')
         or v_operation->>'target_ref' is distinct from v_operation->'intent'->>'offerId'
         or not exists (
           select 1 from jsonb_array_elements_text(v_revision.snapshot->'orderedSkus') sku
            where sku = v_operation->'intent'->>'sku'
         )
         or v_revision.snapshot->'ownedRemote'->'offerIdsBySku'->>(v_operation->'intent'->>'sku') is distinct from v_operation->'intent'->>'offerId' then
        raise exception 'variation listing cleanup offer operation intent is not an exact owned identity' using errcode = 'VR002';
      end if;
    elsif v_kind = 'cleanup_group' then
      if (select count(*) from jsonb_object_keys(v_operation->'intent')) <> 1
         or not (v_operation->'intent' ? 'groupKey')
         or jsonb_typeof(v_operation->'intent'->'groupKey') is distinct from 'string'
         or nullif(btrim(v_operation->'intent'->>'groupKey'), '') is null
         or v_operation->>'operation_key' is distinct from 'cleanup-group'
         or v_operation->>'target_ref' is distinct from v_operation->'intent'->>'groupKey'
         or v_operation->'intent'->>'groupKey' is distinct from v_group.group_key then
        raise exception 'variation listing cleanup group operation intent is not an exact owned identity' using errcode = 'VR002';
      end if;
    elsif v_kind = 'cleanup_child_inventory_item' then
      if (select count(*) from jsonb_object_keys(v_operation->'intent')) <> 1
         or not (v_operation->'intent' ? 'sku')
         or jsonb_typeof(v_operation->'intent'->'sku') is distinct from 'string'
         or nullif(btrim(v_operation->'intent'->>'sku'), '') is null
         or v_operation->>'operation_key' is distinct from 'cleanup-item:' || (v_operation->'intent'->>'sku')
         or v_operation->>'target_ref' is distinct from v_operation->'intent'->>'sku'
         or not exists (
           select 1 from jsonb_array_elements_text(v_revision.snapshot->'orderedSkus') sku
            where sku = v_operation->'intent'->>'sku'
         ) then
        raise exception 'variation listing cleanup item operation intent is not an exact owned identity' using errcode = 'VR002';
      end if;
    elsif v_kind = 'final_absence_verification' then
      if (select count(*) from jsonb_object_keys(v_operation->'intent')) <> 5
         or not (v_operation->'intent' ? 'groupKey')
         or not (v_operation->'intent' ? 'marketplaceId')
         or not (v_operation->'intent' ? 'offerIdsBySku')
         or not (v_operation->'intent' ? 'orderedSkus')
         or not (v_operation->'intent' ? 'terminalLifecycle')
         or jsonb_typeof(v_operation->'intent'->'groupKey') is distinct from 'string'
         or jsonb_typeof(v_operation->'intent'->'marketplaceId') is distinct from 'string'
         or jsonb_typeof(v_operation->'intent'->'offerIdsBySku') is distinct from 'object'
         or jsonb_typeof(v_operation->'intent'->'orderedSkus') is distinct from 'array'
         or jsonb_typeof(v_operation->'intent'->'terminalLifecycle') is distinct from 'string'
         or v_operation->>'operation_key' is distinct from 'final-absence'
         or v_operation->>'target_ref' is distinct from v_operation->'intent'->>'groupKey'
         or v_operation->'intent'->>'groupKey' is distinct from v_group.group_key
         or v_operation->'intent'->>'marketplaceId' is distinct from v_group.marketplace_id
         or v_operation->'intent'->'offerIdsBySku' is distinct from v_revision.snapshot->'ownedRemote'->'offerIdsBySku'
         or v_operation->'intent'->'orderedSkus' is distinct from v_revision.snapshot->'orderedSkus'
         or v_operation->'intent'->>'terminalLifecycle' is distinct from 'abandoned' then
        raise exception 'variation listing final absence operation intent is not an exact owned identity' using errcode = 'VR002';
      end if;
    end if;
    if v_operation->>'intent_digest' is distinct from encode(
      extensions.digest(public.variation_listing_recovery_canonical_json(v_operation->'intent'), 'sha256'), 'hex'
    ) then
      raise exception 'variation listing cleanup operation intent digest mismatch' using errcode = 'VR002';
    end if;
    if v_kind = 'cleanup_offer' then
      if v_seen_group or v_seen_item then
        raise exception 'variation listing cleanup offers must precede group and item cleanup' using errcode = 'VR002';
      end if;
      v_seen_offer := true;
    elsif v_kind = 'cleanup_group' then
      if v_seen_item then
        raise exception 'variation listing cleanup group must precede item cleanup' using errcode = 'VR002';
      end if;
      v_seen_group := true;
    elsif v_kind = 'cleanup_child_inventory_item' then
      v_seen_item := true;
    elsif v_kind = 'final_absence_verification' and v_plan_index <> v_operation_count then
      raise exception 'variation listing final absence operation must be last' using errcode = 'VR002';
    end if;
  end loop;

  for v_operation in select value from jsonb_array_elements(v_revision.operation_plan)
  loop
    select * into v_latest
      from public.variation_listing_publishing_checkpoints c
     where c.revision_id = p_cleanup_revision_id
       and c.operation_key = v_operation->>'operation_key'
     order by c.attempt_number desc, c.checkpoint_number desc
     limit 1;
    if not found
       or v_latest.state is null
       or v_latest.state not in ('confirmed_complete','confirmed_no_op')
       or v_latest.observed_remote_state is null
       or v_latest.observed_remote_state not in ('present','proven_absent')
       or v_latest.evidence = '{}'::jsonb then
      raise exception 'variation listing cleanup revision is not fully reconciled' using errcode = 'VR002';
    end if;
    if v_latest.state = 'confirmed_no_op' and exists (
      select 1
        from public.variation_listing_publishing_checkpoints h
       where h.revision_id = p_cleanup_revision_id
         and h.operation_key = v_operation->>'operation_key'
         and (h.state = 'unknown' or h.observed_remote_state = 'unknown')
    ) then
      raise exception 'variation listing cleanup operation reconciled to no-effect after unknown' using errcode = 'VR002';
    end if;
    if v_operation->>'operation_kind' = 'final_absence_verification'
       and v_latest.observed_remote_state <> 'proven_absent' then
      raise exception 'variation listing final absence is not proven' using errcode = 'VR002';
    end if;
  end loop;

  update public.variation_listing_groups
     set lifecycle_state = 'review',
         desired_revision = desired_revision + 1
   where group_id = p_group_id;

  return query
    select to_jsonb(g)
      from public.variation_listing_groups g
     where g.group_id = p_group_id;
end;
$$;

revoke all on function public.variation_listing_recovery_canonical_json(jsonb)
  from public, anon, authenticated, service_role;

revoke execute on function public.return_variation_listing_to_review(uuid, bigint, uuid)
  from public, anon, authenticated;
grant execute on function public.return_variation_listing_to_review(uuid, bigint, uuid)
  to service_role;

commit;
