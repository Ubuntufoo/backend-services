-- YP9.6c4 EXEC4c — historical reference inventory (TEST-ONLY).
-- Disposable PostgreSQL only; NOT a migration and NOT a registration RPC.
-- Works alongside EXEC4a migration and EXEC4b private read-only preflight.
-- A match is evidence requiring classification; absence is NOT ownership proof.

create function removed_sku_writer_barrier.inspect_exact_historical_references(
  p_revision_id uuid
) returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  preflight jsonb;
  preflight_blocked_by_owner boolean := false;
  retirement public.variation_listing_removed_sku_remote_retirements%rowtype;
  witness jsonb;
  keys text[];
  source_refs text[];
  total_matches bigint;
  same_group_matches bigint;
  cross_group_matches bigint;
  journal_matches bigint;
  sample jsonb;
begin
  -- EXEC4b validates the exact c2b/v3 identity and checks current live
  -- ownership under group -> sorted-key transaction locks. This is not a
  -- persistent lock after the transaction commits, and it registers nothing.
  -- EXEC4b normally returns a non-authorizing preflight.  Its deliberate
  -- fail-closed owner check raises when a live Variation/Standard/copy owner
  -- or historical revision in another group contains one of these resources.
  -- Record that generic blocker and continue this diagnostic inventory so
  -- references remain visible instead of hidden by the preflight. PostgreSQL rolls back locks
  -- acquired inside a caught exception subtransaction, so the ordered locks
  -- are reacquired explicitly below after the witness derives exact keys.
  begin
    preflight := removed_sku_writer_barrier.inspect_exact_freeze_preflight(p_revision_id);
  exception when others then
    if sqlstate = 'P0001'
       and sqlerrm = 'live or other-group owner prevents reference freeze' then
      preflight_blocked_by_owner := true;
    else
      raise;
    end if;
  end;

  select * into retirement from public.variation_listing_removed_sku_remote_retirements
   where revision_id = p_revision_id;
  if not found then raise exception 'historical audit retirement record missing'; end if;
  witness := public.inspect_variation_removed_sku_ownership(
    retirement.group_id, p_revision_id,
    retirement.target_variation_id, retirement.target_sku
  );
  if witness->>'revisionId' is distinct from p_revision_id::text
     or witness->>'groupId' is distinct from retirement.group_id::text
     or witness->>'targetVariationId' is distinct from retirement.target_variation_id::text
     or witness->>'targetSku' is distinct from retirement.target_sku
     or witness->>'deletionAuthorized' is distinct from 'false'
     or witness->>'referenceSearchComplete' is distinct from 'false'
     or pg_catalog.jsonb_typeof(witness->'r2ObjectKeys') is distinct from 'array'
     or pg_catalog.jsonb_typeof(witness->'sourceRefs') is distinct from 'array' then
    raise exception 'historical audit requires non-authorizing complete-shape witness';
  end if;

  select pg_catalog.array_agg(x.value order by x.value) into keys
    from pg_catalog.jsonb_array_elements_text(witness->'r2ObjectKeys') as x(value);
  select pg_catalog.array_agg(x.value order by x.value) into source_refs
    from pg_catalog.jsonb_array_elements_text(witness->'sourceRefs') as x(value);
  if keys is null or source_refs is null
     or pg_catalog.cardinality(keys) <> pg_catalog.cardinality(source_refs)
     or (not preflight_blocked_by_owner and pg_catalog.to_jsonb(keys) is distinct from preflight->'r2ObjectKeys') then
    raise exception 'historical audit source/key identity is incomplete';
  end if;

  if preflight_blocked_by_owner then
    -- Re-establish EXEC4b's group -> sorted-key order after the caught
    -- subtransaction released its locks. This protects this inventory's own
    -- scan without claiming the failed preflight retained a lock.
    perform 1 from public.variation_listing_groups g
      where g.group_id = retirement.group_id for update;
    if not found then raise exception 'historical audit removal group missing'; end if;
    perform removed_sku_writer_barrier.lock_keys(keys);
  end if;

  -- Scan the *effective*, known persistence stores. The old
  -- variation_listing_operations table was dropped by the v3 migration;
  -- revision.operation_plan is the current store. Cleanup resource strings
  -- are scanned exactly as stored, not trusted as proof of ownership.
  with resources(kind, resource) as (
    select 'r2_key'::text, pg_catalog.unnest(keys)
    union all
    select 'source_ref'::text, pg_catalog.unnest(source_refs)
  ),
  documents(scope, owner, group_id, payload) as (
    select 'revision_snapshot'::text, r.revision_id::text, r.group_id, r.snapshot
      from public.variation_listing_revisions r
    union all
    select 'revision_operation_plan', r.revision_id::text, r.group_id,
           coalesce(r.operation_plan, 'null'::jsonb)
      from public.variation_listing_revisions r
    union all
    select 'checkpoint_evidence', c.checkpoint_id::text, r.group_id, c.evidence
      from public.variation_listing_publishing_checkpoints c
      join public.variation_listing_revisions r on r.revision_id = c.revision_id
    union all
    select 'remote_retirement_evidence', r.revision_id::text, r.group_id, r.evidence
      from public.variation_listing_removed_sku_remote_retirements r
    union all
    select 'cleanup_journal_resource', j.journal_id::text, j.group_id,
           pg_catalog.to_jsonb(x.resource_identity)
      from public.variation_listing_removed_sku_cleanup_resources x
      join public.variation_listing_removed_sku_cleanup_journals j
        on j.journal_id = x.journal_id
  ),
  leaves as (
    select d.scope, d.owner, d.group_id, (x.value #>> '{}') as value
      from documents d
      cross join lateral pg_catalog.jsonb_path_query(
        d.payload, 'strict $.** ? (@.type() == "string")'::jsonpath
      ) as x(value)
  ),
  raw_hits as (
    select l.scope, l.owner, l.group_id, r.kind, r.resource,
      case
        when l.scope = 'cleanup_journal_resource' then 'journal_requires_review'
        when l.group_id = retirement.group_id then 'same_group_history_requires_review'
        else 'cross_group_reference_requires_review'
      end as classification
    from leaves l cross join resources r
    where l.value = r.resource
       or pg_catalog.strpos(l.value, r.resource) > 0
       or pg_catalog.strpos(
         pg_catalog.lower(l.value),
         pg_catalog.lower(pg_catalog.replace(r.resource, '/', '%2f'))
       ) > 0
  ),
  -- A resource may occur in both the immutable aggregate and confirmed copy,
  -- or several times in one JSON document.  Count one document/resource hit,
  -- while retaining distinct R2 versus source-reference kinds.
  hits as (
    select distinct scope, owner, group_id, kind, resource, classification
      from raw_hits
  )
  select
    (select count(*) from hits),
    (select count(*) from hits where classification = 'same_group_history_requires_review'),
    (select count(*) from hits where classification = 'cross_group_reference_requires_review'),
    (select count(*) from hits where classification = 'journal_requires_review'),
    (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(s)), '[]'::jsonb)
       from (select scope, owner, kind, resource, classification
               from hits order by classification, scope, owner, kind, resource
              limit 40) s)
  into total_matches, same_group_matches, cross_group_matches, journal_matches, sample;

  return pg_catalog.jsonb_build_object(
    'revisionId', p_revision_id,
    'groupId', retirement.group_id,
    'targetVariationId', retirement.target_variation_id,
    'targetSku', retirement.target_sku,
    'r2ObjectKeys', pg_catalog.to_jsonb(keys),
    'sourceRefs', pg_catalog.to_jsonb(source_refs),
    'totalReferenceMatches', total_matches,
    'sameGroupHistoricalMatches', same_group_matches,
    'crossGroupMatches', cross_group_matches,
    'journalMatches', journal_matches,
    'matchSample', sample,
    'matchSampleTruncated', total_matches > 40,
    'preflightBlockedByOwnerReference', preflight_blocked_by_owner,
    'scannedStores', pg_catalog.jsonb_build_array(
      'revision_snapshot', 'revision_operation_plan',
      'checkpoint_evidence', 'remote_retirement_evidence',
      'cleanup_journal_resource'
    ),
    'sameGroupHistoricalReferencesVerified', false,
    'journalHistoryVerified', false,
    'referenceSearchComplete', false,
    'freezeAuthorized', false,
    'deletionAuthorized', false,
    'blockers', pg_catalog.jsonb_build_array(
      'historical_matches_require_copy_provenance_classification',
      'ambiguous_or_unsupported_url_aliases_require_review',
      'unscanned_json_and_external_media_consumers',
      'historical_writers_not_part_of_persistent_key_freeze',
      'external_r2_writer_exclusivity_not_proven',
      'independent_ebay_and_operator_approval_missing'
    )
  );
end;
$$;

revoke all on function removed_sku_writer_barrier.inspect_exact_historical_references(uuid)
  from public, anon, authenticated, service_role;
