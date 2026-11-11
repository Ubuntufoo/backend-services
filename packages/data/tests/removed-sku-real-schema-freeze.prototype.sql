-- YP9.6c4 REAL TABLE SPIKE. TEST-ONLY: not a migration.
-- Load after the effective app schema, read-only ownership witness,
-- and removed-sku-reference-freeze.prototype.sql in disposable PostgreSQL.
-- Reuses synthetic yp_c4_probe.frozen; cannot create frozen rows or delete.
-- Standard URL normalization is incomplete and NOT production-safe.

create function yp_c4_probe.inspect_real_retirement(p_revision_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  retirement public.variation_listing_removed_sku_remote_retirements%rowtype;
  revision public.variation_listing_revisions%rowtype;
  checkpoint public.variation_listing_publishing_checkpoints%rowtype;
  witness jsonb;
begin
  if p_revision_id is null then raise exception 'retirement revision required'; end if;
  select * into retirement from public.variation_listing_removed_sku_remote_retirements
   where revision_id = p_revision_id;
  if not found or retirement.state <> 'confirmed_complete'
     or retirement.observed_remote_state <> 'proven_absent'
     or retirement.c2_terminal_checkpoint_id is null
     or retirement.completed_at is null
     or pg_catalog.jsonb_typeof(retirement.evidence) is distinct from 'object'
     or pg_catalog.jsonb_typeof(retirement.evidence->'revisionId') is distinct from 'string'
     or pg_catalog.jsonb_typeof(retirement.evidence->'targetSku') is distinct from 'string'
     or pg_catalog.jsonb_typeof(retirement.evidence->'targetOfferId') is distinct from 'string'
     or pg_catalog.jsonb_typeof(retirement.evidence->'marketplaceId') is distinct from 'string'
     or pg_catalog.jsonb_typeof(retirement.evidence->'listingId') is distinct from 'string'
     or retirement.evidence->>'revisionId' is distinct from retirement.revision_id::text
     or retirement.evidence->>'targetSku' is distinct from retirement.target_sku
     or retirement.evidence->>'targetOfferId' is distinct from retirement.target_offer_id
     or retirement.evidence->>'marketplaceId' is distinct from retirement.marketplace_id
     or retirement.evidence->>'listingId' is distinct from retirement.listing_id
     or pg_catalog.jsonb_typeof(retirement.evidence->'item') is distinct from 'object'
     or pg_catalog.jsonb_typeof(retirement.evidence->'item'->'state') is distinct from 'string'
     or pg_catalog.jsonb_typeof(retirement.evidence->'item'->'sku') is distinct from 'string'
     or retirement.evidence->'item'->>'state' is distinct from 'absent'
     or retirement.evidence->'item'->>'sku' is distinct from retirement.target_sku
     or pg_catalog.jsonb_typeof(retirement.evidence->'offers') is distinct from 'object'
     or pg_catalog.jsonb_typeof(retirement.evidence->'offers'->'complete') is distinct from 'boolean'
     or retirement.evidence->'offers'->>'complete' is distinct from 'true'
     or pg_catalog.jsonb_typeof(retirement.evidence->'offers'->'offers') is distinct from 'array'
     or coalesce((select pg_catalog.jsonb_array_length(retirement.evidence->'offers'->'offers')
                    where pg_catalog.jsonb_typeof(retirement.evidence->'offers'->'offers') = 'array'), 0) <> 0
     or pg_catalog.jsonb_typeof(retirement.evidence->'survivors') is distinct from 'object'
     or pg_catalog.jsonb_typeof(retirement.evidence->'survivors'->'exact') is distinct from 'boolean'
     or retirement.evidence->'survivors'->>'exact' is distinct from 'true'
     or pg_catalog.jsonb_typeof(retirement.evidence->'survivors'->'skus') is distinct from 'array' then
    raise exception 'c2b remote retirement is not confirmed';
  end if;
  select * into revision from public.variation_listing_revisions
   where revision_id = p_revision_id and group_id = retirement.group_id;
  if not found or revision.snapshot_version <> 3
     or revision.captured_desired_revision is distinct from retirement.c2_confirmed_revision
     or revision.snapshot->'permanentRemoval'->>'targetVariationId' is distinct from retirement.target_variation_id::text
     or revision.snapshot->'permanentRemoval'->>'targetSku' is distinct from retirement.target_sku then
    raise exception 'c2b retirement does not match frozen v3 revision';
  end if;
  if retirement.evidence->'survivors'->'skus' is distinct from revision.snapshot->'permanentRemoval'->'survivorSkus' then
    raise exception 'c2b remote retirement evidence does not match frozen survivors';
  end if;
  select * into checkpoint from public.variation_listing_publishing_checkpoints
   where checkpoint_id = retirement.c2_terminal_checkpoint_id
     and revision_id = p_revision_id
     and operation_key = 'remove-group-membership';
  if not found or checkpoint.state not in ('confirmed_complete', 'confirmed_no_op')
     or checkpoint.observed_remote_state not in ('present', 'proven_absent') then
    raise exception 'c2b terminal checkpoint linkage incomplete';
  end if;
  witness := public.inspect_variation_removed_sku_ownership(
    retirement.group_id,p_revision_id,retirement.target_variation_id,retirement.target_sku
  );
  if witness->>'groupId' is distinct from retirement.group_id::text
     or witness->>'revisionId' is distinct from p_revision_id::text
     or witness->>'targetSku' is distinct from retirement.target_sku
     or witness->>'deletionAuthorized' is distinct from 'false'
     or pg_catalog.jsonb_typeof(witness->'r2ObjectKeys') is distinct from 'array'
     or pg_catalog.jsonb_array_length(witness->'r2ObjectKeys') < 2 then
    raise exception 'read-only witness does not match c2b identity';
  end if;
  return pg_catalog.jsonb_build_object(
    'revisionId', p_revision_id, 'groupId', retirement.group_id,
    'targetVariationId', retirement.target_variation_id,
    'targetSku', retirement.target_sku, 'r2ObjectKeys', witness->'r2ObjectKeys',
    'historyVerified', false, 'referenceFreezeAuthorized', false,
    'deletionAuthorized', false
  );
end;
$$;

-- These guards use REAL table fields but SYNTHETIC non-authorizing frozen keys.
-- Existing Variation group guards acquire their group lock before this zz trigger.
create function yp_c4_probe.guard_real_variation_copy()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform yp_c4_probe.reject_frozen(array[new.front_r2_key,new.back_r2_key]);
  elsif new.front_r2_key is distinct from old.front_r2_key
     or new.back_r2_key is distinct from old.back_r2_key then
    perform yp_c4_probe.reject_frozen(
      array[old.front_r2_key,old.back_r2_key,new.front_r2_key,new.back_r2_key]);
  end if;
  return new;
end;
$$;
create trigger zz_c4_real_variation_copy_guard
  before insert or update of front_r2_key,back_r2_key
  on public.variation_listing_copies
  for each row execute function yp_c4_probe.guard_real_variation_copy();

-- Existing Standard fields are text[] not jsonb. Parser is synthetic and
-- does NOT yet cover production URL hosts/encodings. Never deploy this trigger.
create function yp_c4_probe.guard_real_standard_listing()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  old_keys text[] := array[]::text[];
  new_keys text[];
begin
  if tg_op = 'UPDATE' then
    old_keys := yp_c4_probe.standard_keys(old.r2_object_keys,old.image_urls);
  end if;
  new_keys := yp_c4_probe.standard_keys(new.r2_object_keys,new.image_urls);
  if pg_catalog.cardinality(old_keys || new_keys) > 0 then
    perform yp_c4_probe.reject_frozen(old_keys || new_keys);
  end if;
  return new;
end;
$$;
create trigger zz_c4_real_standard_listing_guard
  before insert or update of r2_object_keys,image_urls
  on public.listings
  for each row execute function yp_c4_probe.guard_real_standard_listing();

revoke all on function yp_c4_probe.inspect_real_retirement(uuid)
  from public,anon,authenticated,service_role;
revoke all on function yp_c4_probe.guard_real_variation_copy()
  from public,anon,authenticated,service_role;
revoke all on function yp_c4_probe.guard_real_standard_listing()
  from public,anon,authenticated,service_role;
grant execute on function yp_c4_probe.inspect_real_retirement(uuid)
  to service_role;
