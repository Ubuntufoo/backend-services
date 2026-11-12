-- YP9.6c4 EXEC4b — READ-ONLY transaction-scoped freeze preflight.
-- TEST FIXTURE ONLY, NOT A MIGRATION. Load AFTER the EXEC4a migration in
-- disposable PostgreSQL. It never INSERTs a frozen key or authorizes deletion.
-- Exact identities are derived from c2b + immutable v3 witness, not caller keys.

create function removed_sku_writer_barrier.inspect_exact_freeze_preflight(
  p_revision_id uuid
) returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  retire public.variation_listing_removed_sku_remote_retirements%rowtype;
  rev public.variation_listing_revisions%rowtype;
  before_lock jsonb;
  after_lock jsonb;
  keys text[];
  listing record;
  standard_keys text[];
begin
  if p_revision_id is null then
    raise exception 'exact revision required';
  end if;
  -- READ COMMITTED is necessary for fresh statements after key-lock waits.
  -- A pre-existing REPEATABLE READ snapshot could miss a committed new owner.
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'reference preflight requires READ COMMITTED';
  end if;

  select * into retire
    from public.variation_listing_removed_sku_remote_retirements r
   where r.revision_id = p_revision_id;
  if not found then raise exception 'c2b retirement record missing'; end if;
  -- Preserve Variation capture's group -> exact-key locking order.
  perform 1 from public.variation_listing_groups g
    where g.group_id = retire.group_id for update;
  if not found then raise exception 'removal group not found'; end if;

  select * into retire
    from public.variation_listing_removed_sku_remote_retirements r
   where r.revision_id = p_revision_id;
  if retire.state is distinct from 'confirmed_complete'
     or retire.observed_remote_state is distinct from 'proven_absent'
     or retire.completed_at is null or retire.c2_terminal_checkpoint_id is null
     or pg_catalog.jsonb_typeof(retire.evidence) is distinct from 'object'
     or retire.evidence->>'revisionId' is distinct from p_revision_id::text
     or retire.evidence->>'targetSku' is distinct from retire.target_sku
     or retire.evidence->>'targetOfferId' is distinct from retire.target_offer_id
     or retire.evidence->>'marketplaceId' is distinct from retire.marketplace_id
     or retire.evidence->>'listingId' is distinct from retire.listing_id
     or retire.evidence->'item'->>'state' is distinct from 'absent'
     or retire.evidence->'item'->>'sku' is distinct from retire.target_sku
     or pg_catalog.jsonb_typeof(retire.evidence->'offers'->'complete') is distinct from 'boolean'
     or retire.evidence->'offers'->>'complete' is distinct from 'true'
     or pg_catalog.jsonb_typeof(retire.evidence->'offers'->'offers') is distinct from 'array'
     or (case when pg_catalog.jsonb_typeof(retire.evidence->'offers'->'offers') = 'array'
         then pg_catalog.jsonb_array_length(retire.evidence->'offers'->'offers') <> 0
         else true end)
     or pg_catalog.jsonb_typeof(retire.evidence->'survivors'->'exact') is distinct from 'boolean'
     or retire.evidence->'survivors'->>'exact' is distinct from 'true'
  then
    raise exception 'c2b retirement evidence is incomplete or untrusted';
  end if;

  select * into rev from public.variation_listing_revisions r
   where r.revision_id = p_revision_id and r.group_id = retire.group_id;
  if not found or rev.snapshot_version <> 3
     or rev.captured_desired_revision is distinct from retire.c2_confirmed_revision
     or rev.snapshot->'permanentRemoval'->>'targetVariationId' is distinct from retire.target_variation_id::text
     or rev.snapshot->'permanentRemoval'->>'targetSku' is distinct from retire.target_sku
     or retire.marketplace_id is distinct from rev.snapshot->'permanentRemoval'->>'marketplaceId'
     or retire.listing_id is distinct from rev.snapshot->'permanentRemoval'->>'listingId'
     or retire.target_offer_id is distinct from
        rev.snapshot->'permanentRemoval'->'offerIdsBySku'->>retire.target_sku
     or retire.evidence->'survivors'->'skus' is distinct from
        rev.snapshot->'permanentRemoval'->'survivorSkus'
  then
    raise exception 'frozen v3 revision conflicts with c2b identity';
  end if;
  if not exists (
    select 1 from public.variation_listing_publishing_checkpoints c
     where c.checkpoint_id = retire.c2_terminal_checkpoint_id
       and c.revision_id = p_revision_id
       and c.operation_key = 'remove-group-membership'
       and c.state = 'confirmed_complete'
       and c.observed_remote_state = 'present'
  ) then
    raise exception 'linked c2 terminal checkpoint invalid';
  end if;

  before_lock := public.inspect_variation_removed_sku_ownership(
    retire.group_id, p_revision_id, retire.target_variation_id, retire.target_sku
  );
  if before_lock->>'sameGroupHistoricalReferencesVerified' is distinct from 'false'
     or before_lock->>'journalHistoryVerified' is distinct from 'false'
     or before_lock->>'referenceSearchComplete' is distinct from 'false'
     or before_lock->>'deletionAuthorized' is distinct from 'false'
     or before_lock->>'singleStatementSnapshot' is distinct from 'true' then
    raise exception 'ownership witness completeness or authority flags are not fail-closed';
  end if;
  if pg_catalog.jsonb_typeof(before_lock->'r2ObjectKeys') is distinct from 'array'
     or pg_catalog.jsonb_array_length(before_lock->'r2ObjectKeys') < 2 then
    raise exception 'frozen copy keys are incomplete';
  end if;
  select pg_catalog.array_agg(item.value order by item.value) into keys
    from pg_catalog.jsonb_array_elements_text(before_lock->'r2ObjectKeys') as item(value);
  if pg_catalog.cardinality(keys) % 2 <> 0
     or pg_catalog.cardinality(keys) <> (
       select count(distinct item.value)
         from pg_catalog.unnest(keys) as item(value)
     ) then
    raise exception 'frozen copy keys duplicate or incomplete';
  end if;

  perform removed_sku_writer_barrier.lock_keys(keys);
  -- This is a new statement AFTER the lock wait (READ COMMITTED), not a
  -- stale snapshot captured before a concurrent writer's commit.
  after_lock := public.inspect_variation_removed_sku_ownership(
    retire.group_id, p_revision_id, retire.target_variation_id, retire.target_sku
  );
  if after_lock->>'sameGroupHistoricalReferencesVerified' is distinct from 'false'
     or after_lock->>'journalHistoryVerified' is distinct from 'false'
     or after_lock->>'referenceSearchComplete' is distinct from 'false'
     or after_lock->>'deletionAuthorized' is distinct from 'false'
     or after_lock->>'singleStatementSnapshot' is distinct from 'true' then
    raise exception 'post-lock ownership witness completeness or authority flags are not fail-closed';
  end if;
  if after_lock->'r2ObjectKeys' is distinct from before_lock->'r2ObjectKeys'
     or after_lock->>'revisionId' is distinct from p_revision_id::text
     or after_lock->>'targetVariationId' is distinct from retire.target_variation_id::text
     or after_lock->>'targetSku' is distinct from retire.target_sku then
    raise exception 'ownership changed before the post-lock scan';
  end if;

  if coalesce((after_lock->>'liveVariationReferenceCount')::bigint, -1) <> 0
     or coalesce((after_lock->>'standardReferenceCount')::bigint, -1) <> 0
     or coalesce((after_lock->>'otherGroupRevisionReferenceCount')::bigint, -1) <> 0
     or exists (select 1 from public.variation_listing_copies c
                 where c.front_r2_key = any(keys) or c.back_r2_key = any(keys))
  then raise exception 'live or other-group owner prevents reference freeze'; end if;

  -- Recheck Standard identity using the EXEC4a canonical URL normalizer under
  -- the same locks. Unknown or ambiguous URL forms fail closed.
  for listing in select l.image_urls, l.r2_object_keys from public.listings l loop
    standard_keys := removed_sku_writer_barrier.standard_keys(
      listing.r2_object_keys, listing.image_urls
    );
    if standard_keys && keys then
      raise exception 'Standard image reference prevents freeze';
    end if;
  end loop;

  if exists (
    select 1 from removed_sku_writer_barrier.frozen_r2_keys f
    where f.key = any(keys) and f.revision_id <> p_revision_id
  ) then raise exception 'image key already frozen by a different revision'; end if;

  -- No registration and no authorization. History and exhaustive JSON
  -- reference coverage remain false in the authoritative witness.
  return pg_catalog.jsonb_build_object(
    'revisionId', p_revision_id,
    'groupId', retire.group_id,
    'targetVariationId', retire.target_variation_id,
    'targetSku', retire.target_sku,
    'r2ObjectKeys', pg_catalog.to_jsonb(keys),
    'heldSortedKeyLocksUntilTransactionEnd', true,
    'sameGroupHistoricalReferencesVerified',
      after_lock->'sameGroupHistoricalReferencesVerified',
    'journalHistoryVerified', after_lock->'journalHistoryVerified',
    'referenceSearchComplete', after_lock->'referenceSearchComplete',
    'freezeAuthorized', false,
    'deletionAuthorized', false,
    'blockers', pg_catalog.jsonb_build_array(
      'incomplete_historical_and_json_reference_search',
      'unverified_trusted_r2_origin_provenance',
      'independent_remote_read_not_bound',
      'external_r2_writers_not_excluded',
      'operator_not_authenticated'
    )
  );
end;
$$;

revoke all on function removed_sku_writer_barrier.inspect_exact_freeze_preflight(uuid)
  from public, anon, authenticated, service_role;
