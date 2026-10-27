begin;

-- Incident-only, additive recovery ledger for the held C2BRemoval01 revision.
-- This migration intentionally does not alter the applied c1/c2/c2b objects,
-- write any existing journal row, or perform an eBay mutation.
create table public.variation_listing_c2b_removal01_incident_repairs (
  repair_id uuid not null,
  incident_key text not null default 'C2BRemoval01',
  group_id uuid not null,
  revision_id uuid not null,
  group_key text not null,
  seller_user_id text not null,
  marketplace_id text not null,
  listing_id text not null,
  snapshot_digest text not null,
  captured_desired_revision bigint not null,
  expected_previous_confirmed_revision bigint not null,
  target_variation_id uuid not null,
  target_sku text not null,
  target_offer_id text not null,
  target_quantity integer not null,
  survivor_skus text[] not null,
  survivor_offer_ids text[] not null,
  survivor_quantities integer[] not null,
  corrected_group_payload jsonb not null,
  corrected_payload_digest text not null,
  state text not null default 'planned',
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  post_at timestamptz,
  unknown_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint variation_listing_c2b_removal01_incident_repairs_pkey
    primary key (repair_id),
  constraint variation_listing_c2b_removal01_incident_repairs_revision_key
    unique (revision_id),
  constraint variation_listing_c2b_removal01_incident_repairs_group_fkey
    foreign key (group_id) references public.variation_listing_groups(group_id)
    on update no action on delete no action,
  constraint variation_listing_c2b_removal01_incident_repairs_revision_fkey
    foreign key (revision_id) references public.variation_listing_revisions(revision_id)
    on update no action on delete no action,
  constraint variation_listing_c2b_removal01_incident_repairs_incident_check
    check (
      incident_key = 'C2BRemoval01'
      and repair_id = '0f8a4786-12a3-45d9-b293-63e2a6318260'::uuid
      and group_id = '586051b7-970a-45bd-a53a-1d1a10285b42'::uuid
      and revision_id = '0f8a4786-12a3-45d9-b293-63e2a6318260'::uuid
      and group_key = 'VL-G-586051B7970A45BDA53A1D1A10285B42'
      and seller_user_id = 'testuser_variationbuyer'
      and marketplace_id = 'EBAY_US'
      and listing_id = '110591443545'
      and snapshot_digest = '602f38a42f0beb0f940a6f222c105ffa0914bbe0b0d3eff03a2830a0a6737727'
      and captured_desired_revision = 6
      and expected_previous_confirmed_revision = 5
      and target_sku = 'BSKBL-C2BRemoval01-000001'
      and target_offer_id = '11951367010'
      and target_quantity = 0
      and survivor_skus = ARRAY['BSKBL-C2BRemoval01-000002','BSKBL-C2BRemoval01-000003']::text[]
      and survivor_offer_ids = ARRAY['11951368010','11951369010']::text[]
      and survivor_quantities = ARRAY[1,1]::integer[]
    ),
  constraint variation_listing_c2b_removal01_incident_repairs_digest_check
    check (corrected_payload_digest ~ '^[0-9a-f]{64}$'),
  constraint variation_listing_c2b_removal01_incident_repairs_payload_check
    check (jsonb_typeof(corrected_group_payload) = 'object'),
  constraint variation_listing_c2b_removal01_incident_repairs_evidence_check
    check (jsonb_typeof(evidence) = 'object'),
  constraint variation_listing_c2b_removal01_incident_repairs_state_check
    check (state in ('planned','started','unknown','confirmed_post','reconciled_post')),
  constraint variation_listing_c2b_removal01_incident_repairs_lifecycle_check
    check (
      (state = 'planned' and started_at is null and post_at is null and unknown_at is null)
      or (state = 'started' and started_at is not null and post_at is null and unknown_at is null)
      or (state = 'unknown' and started_at is not null and post_at is null and unknown_at is not null)
      or (state = 'confirmed_post' and started_at is not null and post_at is not null and unknown_at is null)
      or (state = 'reconciled_post' and post_at is not null and unknown_at is null)
    )
);

create trigger variation_listing_c2b_removal01_incident_repairs_updated_at
  before update on public.variation_listing_c2b_removal01_incident_repairs
  for each row execute function public.set_row_updated_at();

create function public.prevent_variation_listing_c2b_removal01_incident_identity_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  x public.variation_listing_c2b_removal01_incident_repairs;
begin
  if tg_op = 'DELETE' then
    raise exception 'C2BRemoval01 incident repair rows are immutable' using errcode = 'VR002';
  end if;
  if new.repair_id is distinct from old.repair_id
     or new.incident_key is distinct from old.incident_key
     or new.group_id is distinct from old.group_id
     or new.revision_id is distinct from old.revision_id
     or new.group_key is distinct from old.group_key
     or new.seller_user_id is distinct from old.seller_user_id
     or new.marketplace_id is distinct from old.marketplace_id
     or new.listing_id is distinct from old.listing_id
     or new.snapshot_digest is distinct from old.snapshot_digest
     or new.captured_desired_revision is distinct from old.captured_desired_revision
     or new.expected_previous_confirmed_revision is distinct from old.expected_previous_confirmed_revision
     or new.target_variation_id is distinct from old.target_variation_id
     or new.target_sku is distinct from old.target_sku
     or new.target_offer_id is distinct from old.target_offer_id
     or new.target_quantity is distinct from old.target_quantity
     or new.survivor_skus is distinct from old.survivor_skus
     or new.survivor_offer_ids is distinct from old.survivor_offer_ids
     or new.survivor_quantities is distinct from old.survivor_quantities
     or new.corrected_group_payload is distinct from old.corrected_group_payload
     or new.corrected_payload_digest is distinct from old.corrected_payload_digest
     or new.created_at is distinct from old.created_at then
    raise exception 'C2BRemoval01 incident repair identity is immutable' using errcode = 'VR002';
  end if;
  return new;
end;
$$;

create trigger variation_listing_c2b_removal01_incident_identity_guard
  before update or delete on public.variation_listing_c2b_removal01_incident_repairs
  for each row execute function public.prevent_variation_listing_c2b_removal01_incident_identity_mutation();

create or replace function public.c2b_removal01_incident_require_post_evidence(
  p_evidence jsonb,
  p_repair public.variation_listing_c2b_removal01_incident_repairs
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if jsonb_typeof(p_evidence) is distinct from 'object'
     or p_evidence = '{}'::jsonb
     or p_evidence->>'revisionId' is distinct from p_repair.revision_id::text
     or p_evidence->>'groupId' is distinct from p_repair.group_id::text
     or p_evidence->>'sellerUserId' is distinct from p_repair.seller_user_id
     or p_evidence->>'marketplaceId' is distinct from p_repair.marketplace_id
     or p_evidence->>'listingId' is distinct from p_repair.listing_id
     or p_evidence->>'targetSku' is distinct from p_repair.target_sku
     or p_evidence->>'targetOfferId' is distinct from p_repair.target_offer_id
     or p_evidence->'survivorSkus' is distinct from to_jsonb(p_repair.survivor_skus)
     or p_evidence->'survivorOfferIds' is distinct from to_jsonb(p_repair.survivor_offer_ids)
     or jsonb_typeof(p_evidence->'revisionId') is distinct from 'string'
     or jsonb_typeof(p_evidence->'groupId') is distinct from 'string'
     or jsonb_typeof(p_evidence->'sellerUserId') is distinct from 'string'
     or jsonb_typeof(p_evidence->'marketplaceId') is distinct from 'string'
     or jsonb_typeof(p_evidence->'listingId') is distinct from 'string'
     or jsonb_typeof(p_evidence->'targetSku') is distinct from 'string'
     or jsonb_typeof(p_evidence->'targetOfferId') is distinct from 'string'
     or jsonb_typeof(p_evidence->'survivorSkus') is distinct from 'array'
     or jsonb_typeof(p_evidence->'survivorOfferIds') is distinct from 'array'
     or jsonb_typeof(p_evidence->'remoteState') is distinct from 'string'
     or jsonb_typeof(p_evidence->'originalSnapshotDigest') is distinct from 'string'
     or jsonb_typeof(p_evidence->'correctedPayloadDigest') is distinct from 'string'
     or p_evidence->>'remoteState' is distinct from 'EXACT_CORRECTED_POST'
     or p_evidence->>'originalSnapshotDigest' is distinct from p_repair.snapshot_digest
     or p_evidence->>'correctedPayloadDigest' is distinct from p_repair.corrected_payload_digest then
    raise exception 'C2BRemoval01 post evidence does not prove exact frozen identity' using errcode = 'VR003';
  end if;
end;
$$;

create function public.c2b_removal01_incident_assert_locked_identity(
  p_repair public.variation_listing_c2b_removal01_incident_repairs
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  g public.variation_listing_groups;
  r public.variation_listing_revisions;
  c public.variation_listing_publishing_checkpoints;
  v public.variation_listing_variations;
begin
  select * into g from public.variation_listing_groups where group_id = p_repair.group_id;
  select * into r from public.variation_listing_revisions where revision_id = p_repair.revision_id and group_id = p_repair.group_id;
  select * into c from public.variation_listing_publishing_checkpoints
   where revision_id = p_repair.revision_id and operation_key = 'remove-group-membership'
   order by attempt_number desc, checkpoint_number desc limit 1;
  select * into v from public.variation_listing_variations where group_id = p_repair.group_id and variation_id = p_repair.target_variation_id;
  if not found or g.group_id is null or r.revision_id is null
     or g.group_key is distinct from p_repair.group_key or g.marketplace_id is distinct from p_repair.marketplace_id
     or g.desired_revision is distinct from 6 or g.last_confirmed_revision is distinct from 5 or g.lifecycle_state is distinct from 'active'
     or r.snapshot_version is distinct from 3 or r.snapshot_digest is distinct from p_repair.snapshot_digest
     or encode(extensions.digest(public.variation_listing_recovery_canonical_json(r.snapshot), 'sha256'), 'hex') is distinct from p_repair.snapshot_digest
     or r.operation_count is distinct from 1 or r.operation_plan->0->>'operation_key' is distinct from 'remove-group-membership'
     or c.state is distinct from 'unknown' or c.observed_remote_state is distinct from 'unknown' or c.attempt_number is distinct from 1 or c.checkpoint_number is distinct from 2
     or v.sku is distinct from p_repair.target_sku or v.pending_removal_at is null then
    raise exception 'C2BRemoval01 repair durable identity/CAS/checkpoint is stale' using errcode = 'VR003';
  end if;
  if exists (select 1 from public.variation_listing_removed_sku_remote_retirements x where x.revision_id = p_repair.revision_id)
     or exists (select 1 from public.variation_listing_removed_sku_remote_retirements x where x.group_id = p_repair.group_id and x.state is distinct from 'confirmed_complete') then
    raise exception 'C2BRemoval01 repair cannot coexist with c2b retirement' using errcode = 'VR003';
  end if;
end;
$$;

-- Validate the historical provider collections as independent sets and bind
-- each frozen Item Card aspect to the immutable confirmed SKU mapping.  This
-- helper returns only the survivor selector projection needed by prepare;
-- callers cannot use it as a general-purpose snapshot parser.
create function public.c2b_removal01_incident_expected_survivor_selector_values(
  p_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  incident_skus text[] := ARRAY[
    'BSKBL-C2BRemoval01-000001',
    'BSKBL-C2BRemoval01-000002',
    'BSKBL-C2BRemoval01-000003'
  ]::text[];
  survivor_skus text[] := ARRAY[
    'BSKBL-C2BRemoval01-000002',
    'BSKBL-C2BRemoval01-000003'
  ]::text[];
  expected_group jsonb;
  confirmed_variations jsonb;
  item_payloads jsonb;
  row jsonb;
  item_payload jsonb;
  sku text;
  selector text;
  key text;
  confirmed_skus jsonb := '[]'::jsonb;
  confirmed_selectors jsonb := '[]'::jsonb;
  expected_group_skus jsonb := '[]'::jsonb;
  expected_group_selectors jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_snapshot) is distinct from 'object' then
    raise exception 'C2BRemoval01 historical snapshot is not an object' using errcode = 'VR002';
  end if;
  expected_group := p_snapshot->'permanentRemoval'->'expectedGroupPayload';
  confirmed_variations := p_snapshot->'confirmed'->'aggregate'->'variations';
  item_payloads := p_snapshot->'permanentRemoval'->'inventoryItemPayloadsBySku';
  if jsonb_typeof(expected_group) is distinct from 'object'
     or jsonb_typeof(confirmed_variations) is distinct from 'array'
     or jsonb_array_length(confirmed_variations) is distinct from 3
     or jsonb_typeof(item_payloads) is distinct from 'object' then
    raise exception 'C2BRemoval01 historical evidence shape is incomplete' using errcode = 'VR002';
  end if;

  -- Confirmed aggregate is the immutable SKU -> selector authority.
  for row in select value from jsonb_array_elements(confirmed_variations) loop
    if jsonb_typeof(row) is distinct from 'object'
       or jsonb_typeof(row->'sku') is distinct from 'string'
       or jsonb_typeof(row->'selector_value') is distinct from 'string' then
      raise exception 'C2BRemoval01 confirmed variation SKU/selector shape is invalid' using errcode = 'VR002';
    end if;
    sku := row->>'sku';
    selector := row->>'selector_value';
    if sku = '' or selector = '' or not (sku = any(incident_skus)) then
      raise exception 'C2BRemoval01 confirmed variation SKU/selector is foreign or empty' using errcode = 'VR002';
    end if;
    if confirmed_skus ? sku or confirmed_selectors ? selector then
      raise exception 'C2BRemoval01 confirmed SKU/selector membership is duplicated' using errcode = 'VR002';
    end if;
    confirmed_skus := confirmed_skus || jsonb_build_array(sku);
    confirmed_selectors := confirmed_selectors || jsonb_build_array(selector);
  end loop;
  if jsonb_array_length(confirmed_skus) is distinct from 3 then
    raise exception 'C2BRemoval01 confirmed SKU membership is not exact' using errcode = 'VR002';
  end if;
  foreach key in array incident_skus loop
    if not (confirmed_skus ? key) then
      raise exception 'C2BRemoval01 confirmed SKU membership is missing or foreign' using errcode = 'VR002';
    end if;
  end loop;

  -- Historical Group variantSKUs and Card values are independent sets.
  if jsonb_typeof(expected_group->'variantSKUs') is distinct from 'array'
     or jsonb_array_length(expected_group->'variantSKUs') is distinct from 3
     or jsonb_typeof(expected_group->'variesBy') is distinct from 'object'
     or jsonb_typeof(expected_group->'variesBy'->'specifications') is distinct from 'array'
     or jsonb_array_length(expected_group->'variesBy'->'specifications') is distinct from 1
     or jsonb_typeof(expected_group->'variesBy'->'specifications'->0) is distinct from 'object'
     or expected_group->'variesBy'->'specifications'->0->>'name' is distinct from 'Card'
     or jsonb_typeof(expected_group->'variesBy'->'specifications'->0->'values') is distinct from 'array'
     or jsonb_array_length(expected_group->'variesBy'->'specifications'->0->'values') is distinct from 3 then
    raise exception 'C2BRemoval01 historical Group SKU/Card collections are malformed' using errcode = 'VR002';
  end if;
  for row in select value from jsonb_array_elements(expected_group->'variantSKUs') loop
    if jsonb_typeof(row) is distinct from 'string' then
      raise exception 'C2BRemoval01 historical Group SKU collection contains a non-string' using errcode = 'VR002';
    end if;
    sku := row #>> '{}';
    if sku = '' or not (sku = any(incident_skus)) or expected_group_skus ? sku then
      raise exception 'C2BRemoval01 historical Group SKU collection is missing, foreign, or duplicated' using errcode = 'VR002';
    end if;
    expected_group_skus := expected_group_skus || jsonb_build_array(sku);
  end loop;
  foreach key in array incident_skus loop
    if not (expected_group_skus ? key) then
      raise exception 'C2BRemoval01 historical Group SKU collection is not the exact incident set' using errcode = 'VR002';
    end if;
  end loop;
  for row in select value from jsonb_array_elements(expected_group->'variesBy'->'specifications'->0->'values') loop
    if jsonb_typeof(row) is distinct from 'string' then
      raise exception 'C2BRemoval01 historical Group Card collection contains a non-string' using errcode = 'VR002';
    end if;
    selector := row #>> '{}';
    if selector = '' or expected_group_selectors ? selector then
      raise exception 'C2BRemoval01 historical Group Card collection is missing, foreign, or duplicated' using errcode = 'VR002';
    end if;
    expected_group_selectors := expected_group_selectors || jsonb_build_array(selector);
  end loop;
  if jsonb_array_length(expected_group_selectors) is distinct from jsonb_array_length(confirmed_selectors) then
    raise exception 'C2BRemoval01 historical Group Card collection cardinality is not exact' using errcode = 'VR002';
  end if;
  for row in select value from jsonb_array_elements(confirmed_selectors) loop
    if not (expected_group_selectors ? (row #>> '{}')) then
      raise exception 'C2BRemoval01 historical Group Card collection is foreign or incomplete' using errcode = 'VR002';
    end if;
  end loop;

  -- Item payload map must have exactly the three immutable incident keys.
  if (select count(*) from jsonb_object_keys(item_payloads)) is distinct from 3 then
    raise exception 'C2BRemoval01 inventory Item payload map key count is not exact' using errcode = 'VR002';
  end if;
  for key in select jsonb_object_keys(item_payloads) loop
    if not (key = any(incident_skus)) then
      raise exception 'C2BRemoval01 inventory Item payload map has a foreign SKU' using errcode = 'VR002';
    end if;
  end loop;
  foreach key in array incident_skus loop
    if not (item_payloads ? key) then
      raise exception 'C2BRemoval01 inventory Item payload map is missing an incident SKU' using errcode = 'VR002';
    end if;
    item_payload := item_payloads->key;
    if jsonb_typeof(item_payload) is distinct from 'object'
       or jsonb_typeof(item_payload->'product') is distinct from 'object'
       or jsonb_typeof(item_payload->'product'->'aspects') is distinct from 'object'
       or jsonb_typeof(item_payload->'product'->'aspects'->'Card') is distinct from 'array'
       or jsonb_array_length(item_payload->'product'->'aspects'->'Card') is distinct from 1
       or jsonb_typeof(item_payload->'product'->'aspects'->'Card'->0) is distinct from 'string'
       or item_payload->'product'->'aspects'->'Card'->>0 is distinct from (
         (select confirmed_row->>'selector_value' from jsonb_array_elements(confirmed_variations) as confirmed_row where confirmed_row->>'sku' = key)
       ) then
      raise exception 'C2BRemoval01 inventory Item Card ownership is not exact' using errcode = 'VR002';
    end if;
  end loop;

  return jsonb_build_array(
    (select confirmed_row->>'selector_value' from jsonb_array_elements(confirmed_variations) as confirmed_row where confirmed_row->>'sku' = survivor_skus[1]),
    (select confirmed_row->>'selector_value' from jsonb_array_elements(confirmed_variations) as confirmed_row where confirmed_row->>'sku' = survivor_skus[2])
  );
end;
$$;

create function public.prepare_c2b_removal01_incident_repair(
  p_repair_id uuid,
  p_group_id uuid,
  p_revision_id uuid,
  p_target_variation_id uuid,
  p_seller_user_id text,
  p_marketplace_id text,
  p_listing_id text,
  p_snapshot_digest text,
  p_corrected_group_payload jsonb,
  p_corrected_payload_digest text
) returns table(repair jsonb)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  g public.variation_listing_groups;
  r public.variation_listing_revisions;
  v public.variation_listing_variations;
  c public.variation_listing_publishing_checkpoints;
  existing public.variation_listing_c2b_removal01_incident_repairs;
  expected_survivor_skus text[] := ARRAY['BSKBL-C2BRemoval01-000002','BSKBL-C2BRemoval01-000003']::text[];
  expected_survivor_offers text[] := ARRAY['11951368010','11951369010']::text[];
  expected_selector_values jsonb;
  expected_corrected_payload jsonb;
begin
  perform 1 from public.variation_listing_intake_sessions s order by s.capture_source_key for update;
  select * into g from public.variation_listing_groups where group_id = p_group_id for update;
  if not found then raise exception 'C2BRemoval01 repair group not found' using errcode = 'VR004'; end if;
  if exists (
    select 1 from public.variation_listing_intake_sessions s
     where s.target_group_id = p_group_id
        or (s.pending_pair->>'target_group_id')::uuid = p_group_id
  ) then
    raise exception 'C2BRemoval01 repair requires an idle intake session' using errcode = 'VR002';
  end if;
  select * into r from public.variation_listing_revisions where revision_id = p_revision_id and group_id = p_group_id for update;
  if not found then raise exception 'C2BRemoval01 repair revision not found' using errcode = 'VR004'; end if;
  if p_repair_id is null or p_target_variation_id is null
     or p_repair_id is distinct from p_revision_id
     or p_group_id is distinct from '586051b7-970a-45bd-a53a-1d1a10285b42'::uuid
     or p_revision_id is distinct from '0f8a4786-12a3-45d9-b293-63e2a6318260'::uuid
     or p_target_variation_id is null
     or p_seller_user_id is distinct from 'testuser_variationbuyer'
     or p_marketplace_id is distinct from 'EBAY_US'
     or p_listing_id is distinct from '110591443545'
     or p_snapshot_digest is distinct from '602f38a42f0beb0f940a6f222c105ffa0914bbe0b0d3eff03a2830a0a6737727'
     or p_corrected_payload_digest is null
     or p_corrected_payload_digest !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(p_corrected_group_payload) is distinct from 'object'
     or encode(extensions.digest(public.variation_listing_recovery_canonical_json(p_corrected_group_payload), 'sha256'), 'hex') is distinct from p_corrected_payload_digest
     or p_corrected_group_payload->>'inventoryItemGroupKey' is distinct from 'VL-G-586051B7970A45BDA53A1D1A10285B42'
     or p_corrected_group_payload->'variantSKUs' is distinct from to_jsonb(expected_survivor_skus) then
    raise exception 'C2BRemoval01 repair identity or corrected payload is invalid' using errcode = 'VR002';
  end if;
  if g.group_id is distinct from p_group_id or g.group_key is distinct from 'VL-G-586051B7970A45BDA53A1D1A10285B42'
     or g.marketplace_id is distinct from 'EBAY_US' or g.desired_revision is distinct from 6 or g.last_confirmed_revision is distinct from 5
     or g.lifecycle_state is distinct from 'active' then
    raise exception 'C2BRemoval01 repair group CAS is stale or foreign' using errcode = 'VR001';
  end if;
  if r.snapshot_version is distinct from 3 or r.snapshot_digest is distinct from p_snapshot_digest
     or r.captured_desired_revision is distinct from 6
     or encode(extensions.digest(public.variation_listing_recovery_canonical_json(r.snapshot), 'sha256'), 'hex') is distinct from p_snapshot_digest
     or r.operation_count is distinct from 1
     or r.operation_plan->0->>'operation_key' is distinct from 'remove-group-membership'
     or r.operation_plan->0->>'operation_kind' is distinct from 'permanent_removal_group_membership'
     or r.snapshot->'permanentRemoval'->>'groupKey' is distinct from g.group_key
     or r.snapshot->'permanentRemoval'->>'targetVariationId' is distinct from p_target_variation_id::text
     or r.snapshot->'permanentRemoval'->>'targetSku' is distinct from 'BSKBL-C2BRemoval01-000001'
     or r.snapshot->'permanentRemoval'->'offerIdsBySku'->>'BSKBL-C2BRemoval01-000001' is distinct from '11951367010'
     or r.snapshot->'permanentRemoval'->'survivorSkus' is distinct from to_jsonb(expected_survivor_skus)
     or r.snapshot->'permanentRemoval'->'offerIdsBySku'->>'BSKBL-C2BRemoval01-000002' is distinct from '11951368010'
     or r.snapshot->'permanentRemoval'->'offerIdsBySku'->>'BSKBL-C2BRemoval01-000003' is distinct from '11951369010'
     or r.snapshot->'permanentRemoval'->>'listingId' is distinct from p_listing_id then
    raise exception 'C2BRemoval01 repair frozen revision is not exact' using errcode = 'VR002';
  end if;
  expected_selector_values := public.c2b_removal01_incident_expected_survivor_selector_values(r.snapshot);
  if jsonb_typeof(r.snapshot->'permanentRemoval'->'expectedGroupPayload') is distinct from 'object'
     or jsonb_typeof(r.snapshot->'permanentRemoval'->'expectedGroupPayload'->'variesBy') is distinct from 'object'
     or jsonb_typeof(r.snapshot->'permanentRemoval'->'expectedGroupPayload'->'variesBy'->'specifications') is distinct from 'array'
     or jsonb_array_length(r.snapshot->'permanentRemoval'->'expectedGroupPayload'->'variesBy'->'specifications') is distinct from 1
     or r.snapshot->'permanentRemoval'->'expectedGroupPayload'->'variesBy'->'specifications'->0->>'name' is distinct from 'Card'
     or jsonb_typeof(r.snapshot->'confirmed'->'aggregate'->'variations') is distinct from 'array'
     or (select count(*) from jsonb_array_elements(r.snapshot->'confirmed'->'aggregate'->'variations')) is distinct from 3
     or (select count(*) from jsonb_array_elements(r.snapshot->'confirmed'->'aggregate'->'variations') x where x->>'sku' is not distinct from 'BSKBL-C2BRemoval01-000001' and x->>'variation_id' is not distinct from p_target_variation_id::text) is distinct from 1
     or (select count(*) from jsonb_array_elements(r.snapshot->'confirmed'->'aggregate'->'variations') x where x->>'sku' is not distinct from expected_survivor_skus[1]) is distinct from 1
     or (select count(*) from jsonb_array_elements(r.snapshot->'confirmed'->'aggregate'->'variations') x where x->>'sku' is not distinct from expected_survivor_skus[2]) is distinct from 1
     or (select count(*) from jsonb_array_elements(r.snapshot->'confirmed'->'aggregate'->'variations') x where x->>'sku' = any(expected_survivor_skus) and jsonb_typeof(x->'selector_value') is not distinct from 'string') is distinct from 2
     or (select count(distinct x->>'sku') from jsonb_array_elements(r.snapshot->'confirmed'->'aggregate'->'variations') x) is distinct from 3
     or (select count(*) from jsonb_array_elements(r.snapshot->'confirmed'->'aggregate'->'variations') x where jsonb_typeof(x->'selector_value') is not distinct from 'string') is distinct from 3
     or (select count(distinct x->>'selector_value') from jsonb_array_elements(r.snapshot->'confirmed'->'aggregate'->'variations') x) is distinct from 3 then
    raise exception 'C2BRemoval01 repair frozen selector projection is not exact' using errcode = 'VR002';
  end if;
  expected_corrected_payload := jsonb_set(
    jsonb_set(r.snapshot->'permanentRemoval'->'expectedGroupPayload', '{variantSKUs}', to_jsonb(expected_survivor_skus), true),
    '{variesBy,specifications,0,values}', expected_selector_values, true
  );
  if p_corrected_group_payload is distinct from expected_corrected_payload then
    raise exception 'C2BRemoval01 corrected payload does not exactly project immutable Card selectors/common fields' using errcode = 'VR002';
  end if;
  select * into c from public.variation_listing_publishing_checkpoints
   where revision_id = p_revision_id and operation_key = 'remove-group-membership'
   order by attempt_number desc, checkpoint_number desc limit 1 for update;
  if not found or c.attempt_number is distinct from 1 or c.checkpoint_number is distinct from 2
     or c.state is distinct from 'unknown' or c.observed_remote_state is distinct from 'unknown' then
    raise exception 'C2BRemoval01 repair requires the held started-to-unknown checkpoint' using errcode = 'VR003';
  end if;
  select * into v from public.variation_listing_variations where group_id = p_group_id and variation_id = p_target_variation_id for update;
  if not found or v.sku is distinct from 'BSKBL-C2BRemoval01-000001' or v.pending_removal_at is null then
    raise exception 'C2BRemoval01 repair requires the staged target variation' using errcode = 'VR002';
  end if;
  if exists (select 1 from public.variation_listing_removed_sku_remote_retirements x where x.revision_id = p_revision_id)
     or exists (select 1 from public.variation_listing_removed_sku_remote_retirements x where x.group_id = p_group_id and x.state is distinct from 'confirmed_complete') then
    raise exception 'C2BRemoval01 repair cannot coexist with c2b retirement' using errcode = 'VR003';
  end if;
  insert into public.variation_listing_c2b_removal01_incident_repairs(
    repair_id, group_id, revision_id, group_key, seller_user_id, marketplace_id,
    listing_id, snapshot_digest, captured_desired_revision, expected_previous_confirmed_revision,
    target_variation_id, target_sku, target_offer_id, target_quantity,
    survivor_skus, survivor_offer_ids, survivor_quantities,
    corrected_group_payload, corrected_payload_digest
  ) values (
    p_repair_id, p_group_id, p_revision_id, g.group_key, p_seller_user_id, p_marketplace_id,
    p_listing_id, p_snapshot_digest, 6, 5, p_target_variation_id,
    'BSKBL-C2BRemoval01-000001', '11951367010', 0,
    expected_survivor_skus, expected_survivor_offers, ARRAY[1,1]::integer[],
    p_corrected_group_payload, p_corrected_payload_digest
  ) on conflict (revision_id) do nothing;
  select * into existing from public.variation_listing_c2b_removal01_incident_repairs x where x.revision_id = p_revision_id for update;
  if not found or existing.repair_id is distinct from p_repair_id
     or existing.corrected_payload_digest is distinct from p_corrected_payload_digest
     or existing.corrected_group_payload is distinct from p_corrected_group_payload then
    raise exception 'C2BRemoval01 repair identity conflict' using errcode = 'VR001';
  end if;
  return query select to_jsonb(existing);
end;
$$;

create function public.load_c2b_removal01_incident_repair(p_repair_id uuid)
returns table(repair jsonb)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  x public.variation_listing_c2b_removal01_incident_repairs;
begin
  select * into x from public.variation_listing_c2b_removal01_incident_repairs x where x.repair_id = p_repair_id;
  if found then
    return query select to_jsonb(x);
  else
    return query select null::jsonb;
  end if;
end;
$$;

create function public.start_c2b_removal01_incident_repair(p_repair_id uuid)
returns table(repair jsonb)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  x public.variation_listing_c2b_removal01_incident_repairs;
  target_group_id uuid;
  target_revision_id uuid;
begin
  select group_id, revision_id into target_group_id, target_revision_id from public.variation_listing_c2b_removal01_incident_repairs where repair_id = p_repair_id;
  if not found then raise exception 'C2BRemoval01 repair is not prepared' using errcode = 'VR004'; end if;
  perform 1 from public.variation_listing_intake_sessions s order by s.capture_source_key for update;
  perform 1 from public.variation_listing_groups where group_id = target_group_id for update;
  perform 1 from public.variation_listing_revisions where revision_id = target_revision_id for update;
  select * into x from public.variation_listing_c2b_removal01_incident_repairs where repair_id = p_repair_id for update;
  if x.state is distinct from 'planned' then raise exception 'C2BRemoval01 repair start requires planned state' using errcode = 'VR003'; end if;
  perform public.c2b_removal01_incident_assert_locked_identity(x);
  update public.variation_listing_c2b_removal01_incident_repairs set state='started', started_at=clock_timestamp(), evidence='{}'::jsonb where repair_id=p_repair_id;
  return query select to_jsonb(y) from public.variation_listing_c2b_removal01_incident_repairs y where y.repair_id=p_repair_id;
end;
$$;

create function public.mark_unknown_c2b_removal01_incident_repair(p_repair_id uuid, p_evidence jsonb)
returns table(repair jsonb)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  x public.variation_listing_c2b_removal01_incident_repairs;
  target_group_id uuid;
  target_revision_id uuid;
begin
  if jsonb_typeof(p_evidence) is distinct from 'object' or p_evidence = '{}'::jsonb then raise exception 'C2BRemoval01 unknown evidence is required' using errcode = 'VR002'; end if;
  select group_id, revision_id into target_group_id, target_revision_id from public.variation_listing_c2b_removal01_incident_repairs where repair_id=p_repair_id;
  if not found then raise exception 'C2BRemoval01 repair is not prepared' using errcode = 'VR004'; end if;
  perform 1 from public.variation_listing_intake_sessions s order by s.capture_source_key for update;
  perform 1 from public.variation_listing_groups where group_id=target_group_id for update;
  perform 1 from public.variation_listing_revisions where revision_id=target_revision_id for update;
  select * into x from public.variation_listing_c2b_removal01_incident_repairs where repair_id=p_repair_id for update;
  if x.state is not distinct from 'unknown' then return query select to_jsonb(x); return; end if;
  if x.state is distinct from 'started' then raise exception 'C2BRemoval01 unknown transition requires started state' using errcode = 'VR003'; end if;
  perform public.c2b_removal01_incident_assert_locked_identity(x);
  update public.variation_listing_c2b_removal01_incident_repairs set state='unknown', unknown_at=clock_timestamp(), evidence=p_evidence where repair_id=p_repair_id;
  return query select to_jsonb(y) from public.variation_listing_c2b_removal01_incident_repairs y where y.repair_id=p_repair_id;
end;
$$;

create function public.mark_post_c2b_removal01_incident_repair(p_repair_id uuid, p_state text, p_evidence jsonb)
returns table(repair jsonb)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  x public.variation_listing_c2b_removal01_incident_repairs;
  target_group_id uuid;
  target_revision_id uuid;
begin
  select group_id, revision_id into target_group_id, target_revision_id from public.variation_listing_c2b_removal01_incident_repairs where repair_id=p_repair_id;
  if not found then raise exception 'C2BRemoval01 repair is not prepared' using errcode = 'VR004'; end if;
  perform 1 from public.variation_listing_intake_sessions s order by s.capture_source_key for update;
  perform 1 from public.variation_listing_groups where group_id=target_group_id for update;
  perform 1 from public.variation_listing_revisions where revision_id=target_revision_id for update;
  select * into x from public.variation_listing_c2b_removal01_incident_repairs where repair_id=p_repair_id for update;
  perform public.c2b_removal01_incident_require_post_evidence(p_evidence, x);
  if x.state is not distinct from 'planned'
     or x.state is not distinct from 'started'
     or x.state is not distinct from 'unknown' then
    perform public.c2b_removal01_incident_assert_locked_identity(x);
  end if;
  if p_state = 'reconciled_post' then
    if x.state is not distinct from 'reconciled_post' then return query select to_jsonb(x); return; end if;
    if x.state is distinct from 'planned' then raise exception 'C2BRemoval01 reconciliation requires planned state' using errcode = 'VR003'; end if;
  elsif p_state = 'confirmed_post' then
    if x.state is not distinct from 'confirmed_post' then return query select to_jsonb(x); return; end if;
    if x.state is distinct from 'started' and x.state is distinct from 'unknown' then raise exception 'C2BRemoval01 confirmed post requires started or unknown state' using errcode = 'VR003'; end if;
  else
    raise exception 'C2BRemoval01 post state is invalid' using errcode = 'VR002';
  end if;
  update public.variation_listing_c2b_removal01_incident_repairs
     set state=p_state, post_at=clock_timestamp(), unknown_at=null, evidence=p_evidence
   where repair_id=p_repair_id;
  return query select to_jsonb(y) from public.variation_listing_c2b_removal01_incident_repairs y where y.repair_id=p_repair_id;
end;
$$;

create function public.append_terminal_c2b_removal01_incident_repair(
  p_repair_id uuid,
  p_checkpoint_id uuid,
  p_evidence jsonb
) returns table(repair jsonb, checkpoint jsonb)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  x public.variation_listing_c2b_removal01_incident_repairs;
  r public.variation_listing_revisions;
  latest public.variation_listing_publishing_checkpoints;
  target_group_id uuid;
  appended jsonb;
begin
  select group_id into target_group_id from public.variation_listing_c2b_removal01_incident_repairs where repair_id=p_repair_id;
  if not found then raise exception 'C2BRemoval01 repair is not prepared' using errcode = 'VR004'; end if;
  perform 1 from public.variation_listing_intake_sessions s order by s.capture_source_key for update;
  perform 1 from public.variation_listing_groups where group_id=target_group_id for update;
  select * into r from public.variation_listing_revisions where revision_id=(select revision_id from public.variation_listing_c2b_removal01_incident_repairs where repair_id=p_repair_id) for update;
  select * into x from public.variation_listing_c2b_removal01_incident_repairs where repair_id=p_repair_id for update;
  perform public.c2b_removal01_incident_require_post_evidence(p_evidence, x);
  if x.state is distinct from 'reconciled_post' and x.state is distinct from 'confirmed_post' then raise exception 'C2BRemoval01 terminal bridge requires exact post state' using errcode = 'VR003'; end if;
  if exists (select 1 from public.variation_listing_removed_sku_remote_retirements z where z.revision_id = x.revision_id or z.group_id = x.group_id) then
    raise exception 'C2BRemoval01 terminal bridge cannot finalize c2b retirement' using errcode = 'VR003';
  end if;
  select * into latest from public.variation_listing_publishing_checkpoints where revision_id=x.revision_id and operation_key='remove-group-membership' order by attempt_number desc, checkpoint_number desc limit 1 for update;
  if latest.state is not distinct from 'unknown' then perform public.c2b_removal01_incident_assert_locked_identity(x); end if;
  if latest.state is not distinct from 'confirmed_complete' or latest.state is not distinct from 'confirmed_no_op' then
    if latest.state is distinct from 'confirmed_complete' or latest.attempt_number is distinct from 1 or latest.checkpoint_number is distinct from 3
       or latest.observed_remote_state is distinct from 'present'
       or latest.evidence is distinct from jsonb_build_object('listingId',x.listing_id,'targetSku',x.target_sku,'survivorSkus',to_jsonb(x.survivor_skus),'state','removed') then
      raise exception 'C2BRemoval01 terminal bridge found non-exact durable terminal evidence' using errcode = 'VR003';
    end if;
    appended := to_jsonb(latest);
  else
    if latest.state is distinct from 'unknown' or latest.attempt_number is distinct from 1 or latest.checkpoint_number is distinct from 2 then raise exception 'C2BRemoval01 terminal bridge requires started-to-unknown checkpoint' using errcode = 'VR003'; end if;
    select terminal.checkpoint into appended from public.append_variation_listing_permanent_removal_checkpoint(
      x.revision_id, 'remove-group-membership', coalesce(p_checkpoint_id, gen_random_uuid()), 1, 3,
      'confirmed_complete', 'present',
      jsonb_build_object('listingId',x.listing_id,'targetSku',x.target_sku,'survivorSkus',to_jsonb(x.survivor_skus),'state','removed')
    ) as terminal;
  end if;
  return query select to_jsonb(x), appended;
end;
$$;

alter table public.variation_listing_c2b_removal01_incident_repairs enable row level security;
revoke all privileges on table public.variation_listing_c2b_removal01_incident_repairs from public, anon, authenticated, service_role;
revoke all on function public.prevent_variation_listing_c2b_removal01_incident_identity_mutation() from public, anon, authenticated, service_role;
revoke all on function public.c2b_removal01_incident_require_post_evidence(jsonb,public.variation_listing_c2b_removal01_incident_repairs) from public, anon, authenticated, service_role;
revoke all on function public.c2b_removal01_incident_assert_locked_identity(public.variation_listing_c2b_removal01_incident_repairs) from public, anon, authenticated, service_role;
revoke all on function public.c2b_removal01_incident_expected_survivor_selector_values(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.prepare_c2b_removal01_incident_repair(uuid,uuid,uuid,uuid,text,text,text,text,jsonb,text) from public, anon, authenticated, service_role;
revoke all on function public.load_c2b_removal01_incident_repair(uuid) from public, anon, authenticated, service_role;
revoke all on function public.start_c2b_removal01_incident_repair(uuid) from public, anon, authenticated, service_role;
revoke all on function public.mark_unknown_c2b_removal01_incident_repair(uuid,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.mark_post_c2b_removal01_incident_repair(uuid,text,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.append_terminal_c2b_removal01_incident_repair(uuid,uuid,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.prepare_c2b_removal01_incident_repair(uuid,uuid,uuid,uuid,text,text,text,text,jsonb,text) to service_role;
grant execute on function public.load_c2b_removal01_incident_repair(uuid) to service_role;
grant execute on function public.start_c2b_removal01_incident_repair(uuid) to service_role;
grant execute on function public.mark_unknown_c2b_removal01_incident_repair(uuid,jsonb) to service_role;
grant execute on function public.mark_post_c2b_removal01_incident_repair(uuid,text,jsonb) to service_role;
grant execute on function public.append_terminal_c2b_removal01_incident_repair(uuid,uuid,jsonb) to service_role;

commit;
