-- YP9.6c4 EXEC4d: classify exact target-copy JSON fields versus leftover
-- same-group snapshot references. Disposable PostgreSQL TEST FIXTURE ONLY.
-- Does not turn historical matches into deletion authority or seed markers.

create function removed_sku_writer_barrier.inspect_exact_snapshot_lineage(
  p_revision_id uuid
) returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  audit jsonb;
  retire public.variation_listing_removed_sku_remote_retirements%rowtype;
  frozen public.variation_listing_revisions%rowtype;
  r record;
  expected_copies jsonb;
  expected jsonb;
  expected_row record;
  match_row record;
  path text[];
  copies jsonb;
  redacted jsonb;
  keys text[];
  refs text[];
  resource text;
  field text;
  fields text[] := array[
    'front_r2_key', 'back_r2_key',
    'capture_front_source_ref', 'capture_back_source_ref'
  ];
  n integer;
  matching_count integer;
  recognized_in_revision integer;
  residual_count integer;
  eligible_revision boolean;
  recognized_documents integer := 0;
  unresolved_documents integer := 0;
  recognized_fields integer := 0;
  sample jsonb := '[]'::jsonb;
begin
  select * into retire
    from public.variation_listing_removed_sku_remote_retirements x
   where x.revision_id = p_revision_id;
  if not found then raise exception 'lineage retirement record missing'; end if;

  -- Calls EXEC4c/EXEC4b (group then sorted-key locks, c2b/v3 check,
  -- read-committed owner diagnostics). All returned authority flags stay false.
  audit := removed_sku_writer_barrier.inspect_exact_historical_references(p_revision_id);
  if audit->>'freezeAuthorized' is distinct from 'false'
    or audit->>'deletionAuthorized' is distinct from 'false'
    or audit->>'referenceSearchComplete' is distinct from 'false'
    or audit->>'sameGroupHistoricalReferencesVerified' is distinct from 'false'
    or audit->>'journalHistoryVerified' is distinct from 'false'
    or audit->>'revisionId' is distinct from p_revision_id::text
    or audit->>'groupId' is distinct from retire.group_id::text
    or audit->>'targetVariationId' is distinct from retire.target_variation_id::text
    or audit->>'targetSku' is distinct from retire.target_sku then
    raise exception 'historical report must remain non-authorizing';
  end if;

  select * into frozen
    from public.variation_listing_revisions x
   where x.revision_id = p_revision_id and x.group_id = retire.group_id;
  if not found then raise exception 'frozen revision unavailable'; end if;
  expected_copies := frozen.snapshot #> '{confirmed,aggregate,copies}';
  if pg_catalog.jsonb_typeof(expected_copies) is distinct from 'array' then
    raise exception 'frozen target copy array unavailable';
  end if;

  select pg_catalog.array_agg(x.value order by x.value) into keys
    from pg_catalog.jsonb_array_elements_text(audit->'r2ObjectKeys') as x(value);
  select pg_catalog.array_agg(x.value order by x.value) into refs
    from pg_catalog.jsonb_array_elements_text(audit->'sourceRefs') as x(value);
  if keys is null or refs is null then
    raise exception 'frozen target resource identity unavailable';
  end if;

  -- Only these two known copy arrays can contain structural target-copy
  -- provenance. A matching key elsewhere remains unresolved, including
  -- operation plans, checkpoints, arbitrary JSON and other group records.
  for r in select x.revision_id, x.snapshot, x.snapshot_version,
                   x.captured_desired_revision, x.snapshot_digest
             from public.variation_listing_revisions x
            where x.group_id = retire.group_id
            order by x.revision_id
  loop
    redacted := r.snapshot;
    recognized_in_revision := 0;
    eligible_revision := r.snapshot_version = 3
      and r.captured_desired_revision <= frozen.captured_desired_revision
      and r.snapshot_digest is not distinct from
        pg_catalog.encode(extensions.digest(public.variation_listing_recovery_canonical_json(r.snapshot), 'sha256'), 'hex');
    for n in 1..2 loop
      path := case n when 1 then array['aggregate','copies']
                           else array['confirmed','aggregate','copies'] end;
      copies := redacted #> path;
      if pg_catalog.jsonb_typeof(copies) is distinct from 'array' then
        continue;
      end if;
      if not eligible_revision then
        continue;
      end if;
      if (n = 1 and redacted #>> '{aggregate,group,group_id}' is distinct from retire.group_id::text)
         or (n = 2 and redacted #>> '{confirmed,aggregate,group,group_id}' is distinct from retire.group_id::text) then
        continue;
      end if;
      for expected_row in
        select x.value from pg_catalog.jsonb_array_elements(expected_copies) as x(value)
         where x.value->>'variation_id' = retire.target_variation_id::text
      loop
        expected := expected_row.value;
        -- Keep malformed fixture values from matching through jsonb text
        -- coercion, even though the frozen witness normally validates them.
        if pg_catalog.jsonb_typeof(expected) is distinct from 'object'
           or pg_catalog.jsonb_typeof(expected->'copy_id') is distinct from 'string'
           or pg_catalog.jsonb_typeof(expected->'variation_id') is distinct from 'string'
           or pg_catalog.jsonb_typeof(expected->'front_r2_key') is distinct from 'string'
           or pg_catalog.jsonb_typeof(expected->'back_r2_key') is distinct from 'string'
           or pg_catalog.jsonb_typeof(expected->'capture_front_source_ref') is distinct from 'string'
           or pg_catalog.jsonb_typeof(expected->'capture_back_source_ref') is distinct from 'string'
           or nullif(pg_catalog.btrim(expected->>'copy_id'), '') is null
           or nullif(pg_catalog.btrim(expected->>'variation_id'), '') is null
           or nullif(pg_catalog.btrim(expected->>'front_r2_key'), '') is null
           or nullif(pg_catalog.btrim(expected->>'back_r2_key'), '') is null
           or nullif(pg_catalog.btrim(expected->>'capture_front_source_ref'), '') is null
           or nullif(pg_catalog.btrim(expected->>'capture_back_source_ref'), '') is null
           or expected->>'copy_id' <> pg_catalog.btrim(expected->>'copy_id')
           or expected->>'variation_id' <> pg_catalog.btrim(expected->>'variation_id')
           or expected->>'front_r2_key' <> pg_catalog.btrim(expected->>'front_r2_key')
           or expected->>'back_r2_key' <> pg_catalog.btrim(expected->>'back_r2_key')
           or expected->>'capture_front_source_ref' <> pg_catalog.btrim(expected->>'capture_front_source_ref')
           or expected->>'capture_back_source_ref' <> pg_catalog.btrim(expected->>'capture_back_source_ref')
        then
          continue;
        end if;
        -- Do not mask duplicate, malformed, or differently-owned copies.
        -- Exactly one complete target-copy shape is required in this slot.
        select count(*) into matching_count
          from pg_catalog.jsonb_array_elements(copies) as c(value)
         where pg_catalog.jsonb_typeof(c.value) = 'object'
           and pg_catalog.jsonb_typeof(c.value->'copy_id') = 'string'
           and pg_catalog.jsonb_typeof(c.value->'variation_id') = 'string'
           and pg_catalog.jsonb_typeof(c.value->'front_r2_key') = 'string'
           and pg_catalog.jsonb_typeof(c.value->'back_r2_key') = 'string'
           and pg_catalog.jsonb_typeof(c.value->'capture_front_source_ref') = 'string'
           and pg_catalog.jsonb_typeof(c.value->'capture_back_source_ref') = 'string'
           and nullif(pg_catalog.btrim(c.value->>'copy_id'), '') is not null
           and nullif(pg_catalog.btrim(c.value->>'variation_id'), '') is not null
           and nullif(pg_catalog.btrim(c.value->>'front_r2_key'), '') is not null
           and nullif(pg_catalog.btrim(c.value->>'back_r2_key'), '') is not null
           and nullif(pg_catalog.btrim(c.value->>'capture_front_source_ref'), '') is not null
           and nullif(pg_catalog.btrim(c.value->>'capture_back_source_ref'), '') is not null
           and c.value->>'copy_id' = pg_catalog.btrim(c.value->>'copy_id')
           and c.value->>'variation_id' = pg_catalog.btrim(c.value->>'variation_id')
           and c.value->>'front_r2_key' = pg_catalog.btrim(c.value->>'front_r2_key')
           and c.value->>'back_r2_key' = pg_catalog.btrim(c.value->>'back_r2_key')
           and c.value->>'capture_front_source_ref' = pg_catalog.btrim(c.value->>'capture_front_source_ref')
           and c.value->>'capture_back_source_ref' = pg_catalog.btrim(c.value->>'capture_back_source_ref')
           and c.value->>'copy_id' = expected->>'copy_id'
           and c.value->>'variation_id' = retire.target_variation_id::text
           and c.value->>'front_r2_key' = expected->>'front_r2_key'
           and c.value->>'back_r2_key' = expected->>'back_r2_key'
           and c.value->>'capture_front_source_ref' = expected->>'capture_front_source_ref'
           and c.value->>'capture_back_source_ref' = expected->>'capture_back_source_ref';
        if matching_count <> 1 then
          continue;
        end if;
        for match_row in
          select c.ordinality
            from pg_catalog.jsonb_array_elements(copies) with ordinality as c(value, ordinality)
           where pg_catalog.jsonb_typeof(c.value) = 'object'
             and pg_catalog.jsonb_typeof(c.value->'copy_id') = 'string'
             and pg_catalog.jsonb_typeof(c.value->'variation_id') = 'string'
             and pg_catalog.jsonb_typeof(c.value->'front_r2_key') = 'string'
             and pg_catalog.jsonb_typeof(c.value->'back_r2_key') = 'string'
             and pg_catalog.jsonb_typeof(c.value->'capture_front_source_ref') = 'string'
             and pg_catalog.jsonb_typeof(c.value->'capture_back_source_ref') = 'string'
             and nullif(pg_catalog.btrim(c.value->>'copy_id'), '') is not null
             and nullif(pg_catalog.btrim(c.value->>'variation_id'), '') is not null
             and nullif(pg_catalog.btrim(c.value->>'front_r2_key'), '') is not null
             and nullif(pg_catalog.btrim(c.value->>'back_r2_key'), '') is not null
             and nullif(pg_catalog.btrim(c.value->>'capture_front_source_ref'), '') is not null
             and nullif(pg_catalog.btrim(c.value->>'capture_back_source_ref'), '') is not null
             and c.value->>'copy_id' = pg_catalog.btrim(c.value->>'copy_id')
             and c.value->>'variation_id' = pg_catalog.btrim(c.value->>'variation_id')
             and c.value->>'front_r2_key' = pg_catalog.btrim(c.value->>'front_r2_key')
             and c.value->>'back_r2_key' = pg_catalog.btrim(c.value->>'back_r2_key')
             and c.value->>'capture_front_source_ref' = pg_catalog.btrim(c.value->>'capture_front_source_ref')
             and c.value->>'capture_back_source_ref' = pg_catalog.btrim(c.value->>'capture_back_source_ref')
             and c.value->>'copy_id' = expected->>'copy_id'
             and c.value->>'variation_id' = retire.target_variation_id::text
             and c.value->>'front_r2_key' = expected->>'front_r2_key'
             and c.value->>'back_r2_key' = expected->>'back_r2_key'
             and c.value->>'capture_front_source_ref' = expected->>'capture_front_source_ref'
             and c.value->>'capture_back_source_ref' = expected->>'capture_back_source_ref'
        loop
          foreach field in array fields loop
            -- Mask the one exact field, not the entire copy object. All
            -- other strings (including unexpected consumers) remain visible.
            redacted := pg_catalog.jsonb_set(
              redacted,
              path || array[(match_row.ordinality - 1)::text, field],
              'null'::jsonb,
              false
            );
            recognized_in_revision := recognized_in_revision + 1;
          end loop;
        end loop;
      end loop;
    end loop;

    if recognized_in_revision > 0 then
      recognized_documents := recognized_documents + 1;
      recognized_fields := recognized_fields + recognized_in_revision;
    end if;

    select count(*) into residual_count
      from pg_catalog.jsonb_path_query(
        redacted, 'strict $.** ? (@.type() == "string")'::jsonpath
      ) as v(value)
      cross join lateral (
        select k as resource from pg_catalog.unnest(keys || refs) as a(k)
      ) x
     where v.value #>> '{}' = x.resource
        or pg_catalog.strpos(v.value #>> '{}', x.resource) > 0
        or pg_catalog.strpos(
          pg_catalog.lower(v.value #>> '{}'),
          pg_catalog.lower(pg_catalog.replace(x.resource, '/', '%2f'))
        ) > 0;
    if residual_count > 0 then
      unresolved_documents := unresolved_documents + 1;
      if pg_catalog.jsonb_array_length(sample) < 40 then
        sample := sample || pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'revisionId', r.revision_id,
            'remainingScalarMatches', residual_count
          )
        );
      end if;
    end if;
  end loop;

  return pg_catalog.jsonb_build_object(
    'revisionId', p_revision_id,
    'groupId', retire.group_id,
    'recognizedTargetCopySnapshotDocuments', recognized_documents,
    'recognizedExactCopyFieldOccurrences', recognized_fields,
    'sameGroupSnapshotDocumentsWithUnresolvedReferences', unresolved_documents,
    'unresolvedSample', sample,
    'unresolvedSampleTruncated', unresolved_documents > 40,
    'preflightBlockedByOwnerReference', audit->'preflightBlockedByOwnerReference',
    'crossGroupMatches', audit->'crossGroupMatches',
    'journalMatches', audit->'journalMatches',
    'otherHistoricalMatchCount', audit->'totalReferenceMatches',
    'copyShapeOnlyNotOwnershipAuthority', true,
    'sameGroupHistoricalReferencesVerified', false,
    'journalHistoryVerified', false,
    'referenceSearchComplete', false,
    'freezeAuthorized', false,
    'deletionAuthorized', false,
    'blockers', pg_catalog.jsonb_build_array(
      'operation_plans_checkpoints_journals_and_external_consumers_unclassified',
      'recognized_copy_shape_is_not_live_exclusive_ownership',
      'same_group_snapshot_unrecognized_references_require_review',
      'cross_group_and_journal_references_require_review',
      'url_alias_and_historical_writer_coverage_incomplete',
      'no_persistent_reference_freeze_or_r2_writer_exclusivity'
    )
  );
end;
$$;

revoke all on function removed_sku_writer_barrier.inspect_exact_snapshot_lineage(uuid)
  from public, anon, authenticated, service_role;
