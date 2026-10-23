begin;

-- YP9.6c4: read-only one-statement-snapshot witness for a REMOVED SKU.
-- This creates no persistent table, mutation or deletion authority.
-- Do not apply to the hosted project without separate operator approval.
create function public.inspect_variation_removed_sku_ownership(
  p_group_id uuid,
  p_revision_id uuid,
  p_target_variation_id uuid,
  p_target_sku text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  g public.variation_listing_groups%rowtype;
  r public.variation_listing_revisions%rowtype;
  terminal public.variation_listing_publishing_checkpoints%rowtype;
  frozen_copies jsonb;
  removal jsonb;
  operation jsonb;
  entry jsonb;
  r2_keys text[] := '{}'::text[];
  source_refs text[] := '{}'::text[];
  copy_ids uuid[] := '{}'::uuid[];
  target_variation_count bigint := 0;
  target_copy_count bigint := 0;
  copy_conflicts bigint := 0;
  standard_conflicts bigint := 0;
  historical_other_group_conflicts bigint := 0;
begin
  if p_target_sku is null or p_target_sku = '' or p_target_sku <> btrim(p_target_sku) then
    raise exception 'removed-SKU ownership witness requires exact SKU';
  end if;
  select * into g from public.variation_listing_groups where group_id = p_group_id;
  if not found then raise exception 'removed-SKU ownership witness group does not exist'; end if;
  select * into r from public.variation_listing_revisions
    where revision_id = p_revision_id and group_id = p_group_id;
  if not found then raise exception 'removed-SKU ownership witness revision does not exist'; end if;
  removal := r.snapshot->'permanentRemoval';
  frozen_copies := r.snapshot->'confirmed'->'aggregate'->'copies';
  operation := r.operation_plan->0;
  if g.lifecycle_state <> 'active'
     or g.last_confirmed_revision is null
     or g.last_confirmed_revision < r.captured_desired_revision
     or r.snapshot_version <> 3
     or r.snapshot_digest is distinct from
       encode(extensions.digest(public.variation_listing_recovery_canonical_json(r.snapshot), 'sha256'), 'hex')
     or r.operation_count <> 1
     or jsonb_typeof(r.operation_plan) is distinct from 'array'
     or jsonb_array_length(r.operation_plan) <> 1
     or r.operation_plan->0->>'operation_key' is distinct from 'remove-group-membership'
     or r.operation_plan->0->>'operation_kind' is distinct from 'permanent_removal_group_membership'
     or r.operation_plan->0->>'target_ref' is distinct from g.group_key
     or r.operation_plan->0->>'sequence_no' is distinct from '1'
     or r.operation_plan->0->>'intent_version' is distinct from '1'
     or r.snapshot->'aggregate'->'group'->>'group_id' is distinct from p_group_id::text
     or r.snapshot->'aggregate'->'group'->>'group_key' is distinct from g.group_key
     or r.snapshot->'aggregate'->'group'->>'marketplace_id' is distinct from g.marketplace_id
     or r.snapshot->'confirmed'->'aggregate'->'group'->>'group_id' is distinct from p_group_id::text
     or r.snapshot->'confirmed'->'aggregate'->'group'->>'group_key' is distinct from g.group_key
     or r.snapshot->'confirmed'->'aggregate'->'group'->>'marketplace_id' is distinct from g.marketplace_id
     or jsonb_typeof(frozen_copies) is distinct from 'array'
     or jsonb_typeof(removal->'survivorSkus') is distinct from 'array'
     or jsonb_array_length(removal->'survivorSkus') < 2
  then
    raise exception 'removed-SKU ownership witness revision or confirmation watermark invalid';
  end if;
  if jsonb_typeof(operation) is distinct from 'object'
     or jsonb_typeof(operation->'sequence_no') is distinct from 'number'
     or jsonb_typeof(operation->'intent_version') is distinct from 'number'
     or jsonb_typeof(operation->'intent') is distinct from 'object'
     or operation->>'intent_digest' !~ '^[0-9a-f]{64}$'
     or encode(extensions.digest(public.variation_listing_recovery_canonical_json(operation->'intent'), 'sha256'), 'hex') is distinct from operation->>'intent_digest'
  then
    raise exception 'removed-SKU ownership witness operation intent digest is invalid';
  end if;
  if operation->'intent'->>'groupKey' is distinct from g.group_key
     or operation->'intent'->>'targetSku' is distinct from p_target_sku
     or (select count(*) from jsonb_object_keys(operation->'intent')) <> 3
     or not (operation->'intent' ? 'groupKey')
     or not (operation->'intent' ? 'targetSku')
     or not (operation->'intent' ? 'survivorSkus')
     or jsonb_typeof(operation->'intent'->'survivorSkus') is distinct from 'array'
     or operation->'intent'->'survivorSkus' is distinct from removal->'survivorSkus'
  then
    raise exception 'removed-SKU ownership witness operation intent identity is invalid';
  end if;
  if exists (
    select 1 from jsonb_array_elements(removal->'survivorSkus') s
    where jsonb_typeof(s) is distinct from 'string'
       or nullif(btrim(s #>> '{}'), '') is null
       or s #>> '{}' <> btrim(s #>> '{}')
  ) or exists (
    select 1 from jsonb_array_elements(operation->'intent'->'survivorSkus') s
    where jsonb_typeof(s) is distinct from 'string'
       or nullif(btrim(s #>> '{}'), '') is null
       or s #>> '{}' <> btrim(s #>> '{}')
  ) then
    raise exception 'removed-SKU ownership witness survivor SKU identity is malformed';
  end if;
  if (select count(*) from jsonb_array_elements(removal->'survivorSkus')) <>
       (select count(distinct s) from jsonb_array_elements_text(removal->'survivorSkus') s)
     or exists (
       select 1 from jsonb_array_elements_text(removal->'survivorSkus') s where s = p_target_sku
     )
  then
    raise exception 'removed-SKU ownership witness survivor SKU set is invalid';
  end if;
  if removal->>'version' is distinct from '1'
     or jsonb_typeof(removal) is distinct from 'object'
     or jsonb_typeof(removal->'version') is distinct from 'number'
     or jsonb_typeof(removal->'groupKey') is distinct from 'string'
     or jsonb_typeof(removal->'marketplaceId') is distinct from 'string'
     or jsonb_typeof(removal->'targetVariationId') is distinct from 'string'
     or jsonb_typeof(removal->'targetSku') is distinct from 'string'
     or jsonb_typeof(removal->'listingId') is distinct from 'string'
     or removal->>'groupKey' is distinct from g.group_key
     or removal->>'marketplaceId' is distinct from g.marketplace_id
     or removal->>'targetVariationId' is distinct from p_target_variation_id::text
     or removal->>'targetSku' is distinct from p_target_sku
     or jsonb_typeof(r.snapshot->'confirmed'->'remote') is distinct from 'object'
     or jsonb_typeof(r.snapshot->'confirmed'->'remote'->'listingId') is distinct from 'string'
     or nullif(btrim(removal->>'listingId'), '') is null
     or removal->>'listingId' is distinct from r.snapshot->'confirmed'->'remote'->>'listingId'
  then
    raise exception 'removed-SKU ownership witness removal identity is invalid';
  end if;
  if jsonb_typeof(r.snapshot->'confirmed'->'aggregate'->'variations') is distinct from 'array' then
    raise exception 'removed-SKU ownership witness frozen variation inventory is invalid';
  end if;
  select count(*) into target_variation_count
    from jsonb_array_elements(r.snapshot->'confirmed'->'aggregate'->'variations') v
   where v->>'variation_id' = p_target_variation_id::text
      or v->>'sku' = p_target_sku;
  if target_variation_count <> 1 or not exists (
    select 1 from jsonb_array_elements(r.snapshot->'confirmed'->'aggregate'->'variations') v
     where v->>'variation_id' = p_target_variation_id::text and v->>'sku' = p_target_sku
  ) then
    raise exception 'removed-SKU ownership witness frozen target variation is missing or duplicated';
  end if;
  if jsonb_array_length(r.snapshot->'confirmed'->'aggregate'->'variations') <>
       jsonb_array_length(removal->'survivorSkus') + 1
     or exists (
       select 1 from jsonb_array_elements(r.snapshot->'confirmed'->'aggregate'->'variations') v
        where jsonb_typeof(v) is distinct from 'object'
           or jsonb_typeof(v->'variation_id') is distinct from 'string'
           or jsonb_typeof(v->'sku') is distinct from 'string'
           or nullif(btrim(v->>'variation_id'), '') is null
           or nullif(btrim(v->>'sku'), '') is null
           or v->>'variation_id' <> btrim(v->>'variation_id')
           or v->>'sku' <> btrim(v->>'sku')
     )
     or (select count(distinct v->>'variation_id')
           from jsonb_array_elements(r.snapshot->'confirmed'->'aggregate'->'variations') v) <>
        jsonb_array_length(r.snapshot->'confirmed'->'aggregate'->'variations')
     or (select count(distinct v->>'sku')
           from jsonb_array_elements(r.snapshot->'confirmed'->'aggregate'->'variations') v) <>
        jsonb_array_length(r.snapshot->'confirmed'->'aggregate'->'variations')
     or exists (
       select 1 from jsonb_array_elements(r.snapshot->'confirmed'->'aggregate'->'variations') v
        where v->>'variation_id' <> p_target_variation_id::text
          and not exists (
            select 1 from jsonb_array_elements_text(removal->'survivorSkus') survivor
             where survivor = v->>'sku'
          )
     )
     or exists (
       select 1 from jsonb_array_elements_text(removal->'survivorSkus') survivor
        where not exists (
          select 1 from jsonb_array_elements(r.snapshot->'confirmed'->'aggregate'->'variations') v
           where v->>'sku' = survivor
             and v->>'variation_id' <> p_target_variation_id::text
        )
     )
  then
    raise exception 'removed-SKU ownership witness frozen survivor projection is invalid';
  end if;
  if exists (
    select 1 from public.variation_listing_publishing_checkpoints c
     where c.revision_id = p_revision_id
       and c.operation_key <> 'remove-group-membership'
  ) then
    raise exception 'removed-SKU ownership witness contains a foreign checkpoint operation';
  end if;
  select * into terminal from public.variation_listing_publishing_checkpoints
    where revision_id = p_revision_id and operation_key = 'remove-group-membership'
    order by attempt_number desc, checkpoint_number desc limit 1;
  if terminal.checkpoint_id is null
     or terminal.state <> 'confirmed_complete'
     or terminal.observed_remote_state <> 'present'
     or terminal.evidence is distinct from jsonb_build_object(
       'listingId', removal->>'listingId',
       'targetSku', p_target_sku,
       'survivorSkus', removal->'survivorSkus',
       'state', 'removed'
     ) then
    raise exception 'removed-SKU ownership witness lacks exact terminal membership proof';
  end if;
  if exists (select 1 from public.variation_listing_variations v
       where v.variation_id = p_target_variation_id or v.sku = p_target_sku)
     or exists (select 1 from public.variation_listing_copies c
       where c.variation_id = p_target_variation_id) then
    raise exception 'removed-SKU ownership witness target still exists';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(r.snapshot->'confirmed'->'aggregate'->'variations') v
    where v->>'variation_id' = p_target_variation_id::text and v->>'sku' = p_target_sku
  ) then
    raise exception 'removed-SKU ownership witness target not identified in prior frozen variations';
  end if;
  for entry in
    select x from jsonb_array_elements(frozen_copies) x
  loop
    if jsonb_typeof(entry) is distinct from 'object'
       or jsonb_typeof(entry->'variation_id') is distinct from 'string'
       or jsonb_typeof(entry->'copy_id') is distinct from 'string'
       or jsonb_typeof(entry->'front_r2_key') is distinct from 'string'
       or jsonb_typeof(entry->'back_r2_key') is distinct from 'string'
       or jsonb_typeof(entry->'capture_front_source_ref') is distinct from 'string'
       or jsonb_typeof(entry->'capture_back_source_ref') is distinct from 'string'
       or nullif(btrim(entry->>'variation_id'), '') is null
       or entry->>'variation_id' <> btrim(entry->>'variation_id')
       or nullif(btrim(entry->>'copy_id'), '') is null
       or entry->>'copy_id' <> btrim(entry->>'copy_id')
       or nullif(btrim(entry->>'front_r2_key'), '') is null
       or entry->>'front_r2_key' <> btrim(entry->>'front_r2_key')
       or nullif(btrim(entry->>'back_r2_key'), '') is null
       or entry->>'back_r2_key' <> btrim(entry->>'back_r2_key')
       or nullif(btrim(entry->>'capture_front_source_ref'), '') is null
       or entry->>'capture_front_source_ref' <> btrim(entry->>'capture_front_source_ref')
       or nullif(btrim(entry->>'capture_back_source_ref'), '') is null
       or entry->>'capture_back_source_ref' <> btrim(entry->>'capture_back_source_ref')
    then
      raise exception 'removed-SKU ownership witness frozen copy identity is malformed';
    end if;
    perform (entry->>'variation_id')::uuid;
    perform (entry->>'copy_id')::uuid;
  end loop;
  for entry in
    select x from jsonb_array_elements(frozen_copies) x
      where x->>'variation_id' = p_target_variation_id::text
  loop
    if nullif(entry->>'copy_id', '') is null
       or nullif(entry->>'front_r2_key', '') is null
       or nullif(entry->>'back_r2_key', '') is null
       or nullif(entry->>'capture_front_source_ref', '') is null
       or nullif(entry->>'capture_back_source_ref', '') is null
       or entry->>'front_r2_key' = entry->>'back_r2_key'
       or entry->>'capture_front_source_ref' = entry->>'capture_back_source_ref'
    then
      raise exception 'removed-SKU ownership witness missing frozen copy resource identities';
    end if;
    target_copy_count := target_copy_count + 1;
    copy_ids := array_append(copy_ids, (entry->>'copy_id')::uuid);
    r2_keys := array_append(array_append(r2_keys, entry->>'front_r2_key'), entry->>'back_r2_key');
    source_refs := array_append(array_append(source_refs, entry->>'capture_front_source_ref'), entry->>'capture_back_source_ref');
  end loop;
  if target_copy_count = 0
     or cardinality(copy_ids) = 0
     or cardinality(r2_keys) <> (select count(distinct x) from unnest(r2_keys) x)
     or cardinality(source_refs) <> (select count(distinct x) from unnest(source_refs) x)
     or cardinality(copy_ids) <> (select count(distinct x) from unnest(copy_ids) x)
  then
    raise exception 'removed-SKU ownership witness resource set is incomplete or duplicated';
  end if;
  if exists (
    select 1 from jsonb_array_elements(frozen_copies) x
    where x->>'variation_id' <> p_target_variation_id::text
      and (
        (x->>'copy_id')::uuid = any(copy_ids)
        or x->>'front_r2_key' = any(r2_keys)
        or x->>'back_r2_key' = any(r2_keys)
        or x->>'capture_front_source_ref' = any(source_refs)
        or x->>'capture_back_source_ref' = any(source_refs)
      )
  ) then
    raise exception 'removed-SKU ownership witness target resources are shared by a frozen survivor copy';
  end if;

  -- Single MVCC snapshot across these reads: no separate PostgREST pages.
  -- The witness is NOT a lock and is NOT permission to perform a future delete.
  select count(*) into copy_conflicts from public.variation_listing_copies c
    where c.copy_id = any(copy_ids)
       or c.front_r2_key = any(r2_keys) or c.back_r2_key = any(r2_keys)
       or c.capture_front_source_ref = any(source_refs)
       or c.capture_back_source_ref = any(source_refs);

  if exists (
    select 1 from public.listings l
     where exists (
       select 1 from unnest(coalesce(l.r2_object_keys, '{}'::text[])) value
        where value is null
     )
        or exists (
       select 1 from unnest(coalesce(l.image_urls, '{}'::text[])) value
        where value is null
     )
  ) then
    raise exception 'removed-SKU ownership witness standard listing media arrays are malformed';
  end if;
  select count(*) into standard_conflicts from public.listings l
    where exists (
       select 1 from unnest(coalesce(l.r2_object_keys, '{}'::text[])) k where k = any(r2_keys)
    )
    or exists (
       select 1 from unnest(coalesce(l.image_urls, '{}'::text[])) url
       cross join unnest(r2_keys) key
       where strpos(url, key) > 0
    )
    or exists (
       select 1 from unnest(coalesce(l.image_urls, '{}'::text[])) url
       cross join unnest(source_refs) ref
       where url = ref
    );

  -- Immutable historical revisions cannot be assumed free of consumers.
  -- References in OTHER groups are a blocking cross-group witness.
  -- Historical references in this same group still require the broad
  -- preview to discriminate exact target-copy lineage from other owners.
  -- Walk parsed JSON scalar values rather than searching jsonb::text: quoted,
  -- escaped, or nested source references must not become false negatives.
  select count(*) into historical_other_group_conflicts
    from public.variation_listing_revisions hr
    where hr.group_id <> p_group_id and exists (
      select 1 from unnest(r2_keys || source_refs) resource
      where exists (
        with recursive walk(value) as (
          select hr.snapshot
          union all
          select child.value
            from walk parent
            cross join lateral (
              select e.value
                from jsonb_each(
                  case when jsonb_typeof(parent.value) = 'object'
                       then parent.value else '{}'::jsonb end
                ) e
              union all
              select a.value
                from jsonb_array_elements(
                  case when jsonb_typeof(parent.value) = 'array'
                       then parent.value else '[]'::jsonb end
                ) a
            ) child
        )
        select 1 from walk
         where jsonb_typeof(walk.value) = 'string'
           and walk.value #>> '{}' = resource
      )
    );

  -- These flags are deliberately false: latest-terminal and the bounded
  -- probes above are diagnostic evidence, not a complete journal/reference
  -- ownership proof or permission to perform a later destructive action.
  return jsonb_build_object(
    'version', 1,
    'groupId', p_group_id,
    'revisionId', p_revision_id,
    'targetVariationId', p_target_variation_id,
    'targetSku', p_target_sku,
    'confirmedRevision', g.last_confirmed_revision,
    'desiredRevision', g.desired_revision,
    'capturedDesiredRevision', r.captured_desired_revision,
    'copyIds', (select to_jsonb(array_agg(x order by x)) from unnest(copy_ids) x),
    'r2ObjectKeys', (select to_jsonb(array_agg(x order by x)) from unnest(r2_keys) x),
    'sourceRefs', (select to_jsonb(array_agg(x order by x)) from unnest(source_refs) x),
    'liveVariationReferenceCount', copy_conflicts,
    'standardReferenceCount', standard_conflicts,
    'otherGroupRevisionReferenceCount', historical_other_group_conflicts,
    'sameGroupHistoricalReferencesVerified', false,
    'journalHistoryVerified', false,
    'referenceSearchComplete', false,
    'singleStatementSnapshot', true,
    'deletionAuthorized', false
  );
end;
$$;

revoke all on function public.inspect_variation_removed_sku_ownership(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.inspect_variation_removed_sku_ownership(uuid, uuid, uuid, text)
  to service_role;

commit;
