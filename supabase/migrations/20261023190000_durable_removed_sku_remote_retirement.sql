begin;

-- YP9.6c2b.  This is an additive, unapplied remote-retirement journal.  The
-- c2 membership journal remains authoritative for the frozen revision and its
-- terminal membership proof; this table records the subsequent Inventory Item
-- deletion intent and exact remote-absence reconciliation only.
create table public.variation_listing_removed_sku_remote_retirements (
  revision_id uuid not null,
  group_id uuid not null,
  target_variation_id uuid not null,
  target_sku text not null,
  target_offer_id text not null,
  marketplace_id text not null,
  listing_id text not null,
  c2_confirmed_revision bigint not null,
  c2_terminal_checkpoint_id uuid not null,
  state text not null default 'ready',
  observed_remote_state text,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint variation_listing_removed_sku_remote_retirements_pkey
    primary key (revision_id),
  constraint variation_listing_removed_sku_remote_retirements_group_id_fkey
    foreign key (group_id) references public.variation_listing_groups(group_id)
    on update no action on delete no action,
  constraint variation_listing_removed_sku_remote_retirements_revision_id_fkey
    foreign key (revision_id) references public.variation_listing_revisions(revision_id)
    on update no action on delete no action,
  constraint variation_listing_removed_sku_remote_retirements_checkpoint_fkey
    foreign key (c2_terminal_checkpoint_id)
    references public.variation_listing_publishing_checkpoints(checkpoint_id)
    on update no action on delete no action,
  constraint variation_listing_removed_sku_remote_retirements_text_check check (
    target_sku = btrim(target_sku) and length(target_sku) > 0
    and target_offer_id = btrim(target_offer_id) and length(target_offer_id) > 0
    and marketplace_id = btrim(marketplace_id) and length(marketplace_id) > 0
    and listing_id = btrim(listing_id) and length(listing_id) > 0
  ),
  constraint variation_listing_removed_sku_remote_retirements_revision_check
    check (c2_confirmed_revision > 0),
  constraint variation_listing_removed_sku_remote_retirements_state_check check (
    state in ('ready','started','unknown','confirmed_complete')
  ),
  constraint variation_listing_removed_sku_remote_retirements_observed_state_check check (
    observed_remote_state is null
      or observed_remote_state in ('present','proven_absent','unknown')
  ),
  constraint variation_listing_removed_sku_remote_retirements_evidence_check
    check (jsonb_typeof(evidence) = 'object'),
  constraint variation_listing_removed_sku_remote_retirements_lifecycle_check
    check (
      (state = 'ready' and started_at is null and completed_at is null
        and observed_remote_state is null)
      or (state = 'started' and started_at is not null and completed_at is null
        and observed_remote_state is null)
      or (state = 'unknown' and started_at is not null and completed_at is null
        and observed_remote_state = 'unknown')
      or (state = 'confirmed_complete' and started_at is not null
        and completed_at is not null and observed_remote_state = 'proven_absent')
    )
);

create unique index variation_listing_removed_sku_remote_retirements_pending_group_idx
  on public.variation_listing_removed_sku_remote_retirements(group_id)
  where state <> 'confirmed_complete';

create trigger variation_listing_removed_sku_remote_retirements_updated_at
  before update on public.variation_listing_removed_sku_remote_retirements
  for each row execute function public.set_row_updated_at();

create function public.prevent_variation_listing_removed_sku_remote_retirement_identity_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'removed-SKU remote-retirement rows are immutable' using errcode = 'VR002';
  end if;
  if new.revision_id is distinct from old.revision_id
     or new.group_id is distinct from old.group_id
     or new.target_variation_id is distinct from old.target_variation_id
     or new.target_sku is distinct from old.target_sku
     or new.target_offer_id is distinct from old.target_offer_id
     or new.marketplace_id is distinct from old.marketplace_id
     or new.listing_id is distinct from old.listing_id
     or new.c2_confirmed_revision is distinct from old.c2_confirmed_revision
     or new.c2_terminal_checkpoint_id is distinct from old.c2_terminal_checkpoint_id
     or new.created_at is distinct from old.created_at then
    raise exception 'removed-SKU remote-retirement identity is immutable' using errcode = 'VR002';
  end if;
  return new;
end;
$$;

create trigger variation_listing_removed_sku_remote_retirements_identity_guard
  before update or delete on public.variation_listing_removed_sku_remote_retirements
  for each row execute function public.prevent_variation_listing_removed_sku_remote_retirement_identity_mutation();

-- A c2b row is the durable lock after c2 has removed local intent or after a
-- historical c2 finalizer has already removed the target row.  Keep all
-- aggregate/intake/journal writes serialized on the group row and blocked until
-- remote Item/Offer absence is confirmed.  The retirement RPCs do not touch
-- these tables, so this guard cannot block their own transitions.
create function public.prevent_variation_listing_removed_sku_remote_retirement_pending_mix()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  target_group_id uuid;
begin
  if tg_table_name = 'variation_listing_groups' then
    target_group_id := case when tg_op = 'DELETE' then old.group_id else new.group_id end;
  elsif tg_table_name = 'variation_listing_variations' then
    target_group_id := case when tg_op = 'DELETE' then old.group_id else new.group_id end;
  elsif tg_table_name = 'variation_listing_copies' then
    select v.group_id into target_group_id
      from public.variation_listing_variations v
     where v.variation_id = case when tg_op = 'DELETE' then old.variation_id else new.variation_id end;
  elsif tg_table_name = 'variation_listing_intake_sessions' then
    if tg_op = 'DELETE' then
      target_group_id := coalesce(old.target_group_id, (old.pending_pair->>'target_group_id')::uuid);
    else
      target_group_id := coalesce(
        new.target_group_id,
        (new.pending_pair->>'target_group_id')::uuid,
        case when tg_op = 'UPDATE' then old.target_group_id end,
        case when tg_op = 'UPDATE' then (old.pending_pair->>'target_group_id')::uuid end
      );
    end if;
  elsif tg_table_name = 'variation_listing_revisions' then
    target_group_id := case when tg_op = 'DELETE' then old.group_id else new.group_id end;
  elsif tg_table_name = 'variation_listing_publishing_checkpoints' then
    select r.group_id into target_group_id
      from public.variation_listing_revisions r
     where r.revision_id = case when tg_op = 'DELETE' then old.revision_id else new.revision_id end;
  else
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if target_group_id is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  -- Existing c1/c2 writers lock intake sessions then group.  Keep this guard
  -- group-first (RPC transitions use the same order), so a state transition
  -- cannot race an edit while the group row is locked.
  perform 1 from public.variation_listing_groups g
   where g.group_id = target_group_id for update;
  -- The applied c2 finalizer sets this transaction-local capability immediately
  -- before hard-deleting target copies/variation and advancing the watermark.
  -- Once c2b exists, that capability is valid only after exact remote absence
  -- has been durably confirmed; a direct c2 finalizer cannot bypass prepare.
  if current_setting('app.variation_listing_permanent_removal', true) = 'c2_finalize'
     and not exists (
       select 1
         from public.variation_listing_removed_sku_remote_retirements r
        where r.group_id = target_group_id
          and r.c2_confirmed_revision = (
            select g.desired_revision
              from public.variation_listing_groups g
             where g.group_id = target_group_id
          )
          and r.state = 'confirmed_complete'
     ) then
    raise exception 'c2 finalization requires confirmed removed-SKU remote retirement' using errcode = 'VR002';
  end if;
  if exists (
    select 1
      from public.variation_listing_removed_sku_remote_retirements r
     where r.group_id = target_group_id and r.state <> 'confirmed_complete'
  ) then
    raise exception 'remote SKU retirement is pending; reconcile remote absence before editing or publishing this group' using errcode = 'VR002';
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

create trigger variation_listing_groups_block_removed_sku_remote_retirement
  before update or delete on public.variation_listing_groups
  for each row execute function public.prevent_variation_listing_removed_sku_remote_retirement_pending_mix();
create trigger variation_listing_variations_block_removed_sku_remote_retirement
  before insert or update or delete on public.variation_listing_variations
  for each row execute function public.prevent_variation_listing_removed_sku_remote_retirement_pending_mix();
create trigger variation_listing_copies_block_removed_sku_remote_retirement
  before insert or update or delete on public.variation_listing_copies
  for each row execute function public.prevent_variation_listing_removed_sku_remote_retirement_pending_mix();
create trigger variation_listing_intake_sessions_block_removed_sku_remote_retirement
  before insert or update or delete on public.variation_listing_intake_sessions
  for each row execute function public.prevent_variation_listing_removed_sku_remote_retirement_pending_mix();
create trigger variation_listing_revisions_block_removed_sku_remote_retirement
  before insert on public.variation_listing_revisions
  for each row execute function public.prevent_variation_listing_removed_sku_remote_retirement_pending_mix();
create trigger variation_listing_checkpoints_block_removed_sku_remote_retirement
  before insert on public.variation_listing_publishing_checkpoints
  for each row execute function public.prevent_variation_listing_removed_sku_remote_retirement_pending_mix();

create function public.prepare_variation_listing_removed_sku_remote_retirement(
  p_revision_id uuid,
  p_group_id uuid,
  p_target_variation_id uuid,
  p_target_sku text
) returns table(retirement jsonb)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  g public.variation_listing_groups;
  r public.variation_listing_revisions;
  v public.variation_listing_variations;
  c public.variation_listing_publishing_checkpoints;
  existing public.variation_listing_removed_sku_remote_retirements;
  metadata jsonb;
  target_offer text;
  target_marketplace text;
  target_listing text;
  survivors jsonb;
  op jsonb;
begin
  if p_revision_id is null or p_group_id is null or p_target_variation_id is null
     or nullif(btrim(p_target_sku), '') is null then
    raise exception 'removed-SKU remote-retirement arguments are invalid' using errcode = 'VR002';
  end if;

  -- Match c1/c2 lock order: intake sessions, then group.  RPC transitions
  -- also lock group before their c2b row, avoiding cross-phase deadlocks.
  perform 1 from public.variation_listing_intake_sessions s
   order by s.capture_source_key for update;
  select * into g from public.variation_listing_groups
   where group_id = p_group_id for update;
  if not found or g.lifecycle_state <> 'active' then
    raise exception 'removed-SKU remote retirement requires an active group' using errcode = 'VR002';
  end if;
  -- Recheck after the group lock.  A concurrent intake insert can start
  -- after the initial all-session lock scan and then win the group lock; do
  -- not freeze/delete a group while that c1 intake still targets it.
  if exists (
    select 1
      from public.variation_listing_intake_sessions s
     where s.target_group_id = p_group_id
        or (s.pending_pair->>'target_group_id')::uuid = p_group_id
  ) then
    raise exception 'removed-SKU remote retirement requires an idle intake session' using errcode = 'VR002';
  end if;
  select * into r from public.variation_listing_revisions
   where revision_id = p_revision_id and group_id = p_group_id for update;
  if not found or r.snapshot_version <> 3
     or r.captured_desired_revision < 1
     or g.desired_revision < r.captured_desired_revision
     or g.last_confirmed_revision is null
     or g.last_confirmed_revision < r.captured_desired_revision - 1
     or r.operation_count <> 1
     or jsonb_typeof(r.operation_plan) is distinct from 'array'
     or jsonb_array_length(r.operation_plan) <> 1 then
    raise exception 'removed-SKU remote retirement revision/group watermark is invalid' using errcode = 'VR002';
  end if;
  if r.snapshot_digest is distinct from encode(extensions.digest(public.variation_listing_recovery_canonical_json(r.snapshot), 'sha256'), 'hex')
     or jsonb_typeof(r.snapshot->'permanentRemoval') is distinct from 'object'
     or jsonb_typeof(r.snapshot->'confirmed') is distinct from 'object'
     or jsonb_typeof(r.snapshot->'confirmed'->'aggregate') is distinct from 'object'
     or jsonb_typeof(r.snapshot->'confirmed'->'aggregate'->'variations') is distinct from 'array' then
    raise exception 'removed-SKU remote retirement frozen v3 snapshot digest/shape is invalid' using errcode = 'VR002';
  end if;
  op := r.operation_plan->0;
  if op->>'operation_key' is distinct from 'remove-group-membership'
     or op->>'operation_kind' is distinct from 'permanent_removal_group_membership'
     or op->>'target_ref' is distinct from g.group_key
     or op->'intent'->>'targetSku' is distinct from p_target_sku
     or jsonb_typeof(op->'intent'->'survivorSkus') is distinct from 'array' then
    raise exception 'removed-SKU remote retirement operation is outside the frozen c2 plan' using errcode = 'VR002';
  end if;
  metadata := r.snapshot->'permanentRemoval';
  survivors := metadata->'survivorSkus';
  if metadata->>'version' is distinct from '1'
     or metadata->>'groupKey' is distinct from g.group_key
     or metadata->>'targetVariationId' is distinct from p_target_variation_id::text
     or metadata->>'targetSku' is distinct from p_target_sku
     or nullif(btrim(metadata->>'marketplaceId'), '') is null
     or nullif(btrim(metadata->>'listingId'), '') is null
     or jsonb_typeof(survivors) is distinct from 'array'
     or jsonb_array_length(survivors) < 2
     or (select count(*) from jsonb_array_elements_text(survivors) s) <> (select count(distinct s) from jsonb_array_elements_text(survivors) s)
     or exists (select 1 from jsonb_array_elements_text(survivors) s where s = p_target_sku)
     or op->'intent'->'survivorSkus' is distinct from survivors
     or not exists (
       select 1 from jsonb_array_elements(r.snapshot->'confirmed'->'aggregate'->'variations') x
        where x->>'variation_id' = p_target_variation_id::text and x->>'sku' = p_target_sku
     ) then
    raise exception 'removed-SKU remote retirement target/survivor identity is invalid' using errcode = 'VR002';
  end if;
  target_marketplace := metadata->>'marketplaceId';
  target_listing := metadata->>'listingId';
  if jsonb_typeof(metadata->'offerIdsBySku') is distinct from 'object'
     or jsonb_typeof(metadata->'quantitiesBySku') is distinct from 'object'
     or jsonb_typeof(metadata->'offerIdsBySku'->p_target_sku) is distinct from 'string'
     or jsonb_typeof(metadata->'quantitiesBySku'->p_target_sku) is distinct from 'object'
     or metadata->'quantitiesBySku'->p_target_sku->>'inventoryItemQuantity' is distinct from '0'
     or metadata->'quantitiesBySku'->p_target_sku->>'offerQuantity' is distinct from '0'
     or metadata->'quantitiesBySku'->p_target_sku->>'sellableQuantity' is distinct from '0'
     or jsonb_typeof(r.snapshot->'confirmed'->'remote') is distinct from 'object'
     or r.snapshot->'confirmed'->'remote'->>'listingId' is distinct from target_listing
     or jsonb_typeof(r.snapshot->'confirmed'->'remote'->'offerIdsBySku') is distinct from 'object'
     -- c2's confirmed.remote intentionally contains survivor identities only;
     -- target Offer ownership remains frozen in permanentRemoval metadata.
     then
    raise exception 'removed-SKU remote retirement target Offer/zero quantity proof is invalid' using errcode = 'VR002';
  end if;
  target_offer := metadata->'offerIdsBySku'->>p_target_sku;
  if nullif(btrim(target_offer), '') is null then
    raise exception 'removed-SKU remote retirement target Offer identity is missing' using errcode = 'VR002';
  end if;

  select * into c from public.variation_listing_publishing_checkpoints
   where revision_id = p_revision_id and operation_key = 'remove-group-membership'
   order by attempt_number desc, checkpoint_number desc limit 1 for update;
  if not found or c.state not in ('confirmed_complete','confirmed_no_op')
     or c.observed_remote_state not in ('present','proven_absent')
     or c.evidence is distinct from jsonb_build_object(
       'listingId', r.snapshot->'confirmed'->'remote'->>'listingId',
       'targetSku', metadata->>'targetSku',
       'survivorSkus', survivors,
       'state', 'removed') then
    raise exception 'removed-SKU remote retirement requires exact terminal c2 membership evidence' using errcode = 'VR004';
  end if;

  select * into v from public.variation_listing_variations
   where group_id = p_group_id and variation_id = p_target_variation_id for update;
  if found then
    if v.sku is distinct from p_target_sku or v.pending_removal_at is null
       or g.desired_revision <> r.captured_desired_revision
       or g.last_confirmed_revision <> r.captured_desired_revision - 1 then
      raise exception 'removed-SKU remote retirement local target is not the staged c2 target' using errcode = 'VR002';
    end if;
  elsif g.desired_revision < r.captured_desired_revision
     or g.last_confirmed_revision < r.captured_desired_revision
     or exists (
       select 1
         from public.variation_listing_variations current_variation
        where current_variation.group_id = p_group_id
          and current_variation.sku = p_target_sku
     ) then
    raise exception 'removed-SKU remote retirement target is absent without a confirmed c2 watermark' using errcode = 'VR002';
  end if;

  if exists (
    select 1 from public.variation_listing_removed_sku_remote_retirements x
     where x.group_id = p_group_id and x.revision_id <> p_revision_id and x.state <> 'confirmed_complete'
  ) then
    raise exception 'another remote SKU retirement is pending for this group' using errcode = 'VR003';
  end if;
  insert into public.variation_listing_removed_sku_remote_retirements(
    revision_id, group_id, target_variation_id, target_sku, target_offer_id,
    marketplace_id, listing_id, c2_confirmed_revision, c2_terminal_checkpoint_id
  ) values (
    p_revision_id, p_group_id, p_target_variation_id, p_target_sku, target_offer,
    target_marketplace, target_listing, r.captured_desired_revision, c.checkpoint_id
  ) on conflict (revision_id) do nothing;
  select * into existing from public.variation_listing_removed_sku_remote_retirements
   where revision_id = p_revision_id for update;
  if existing.group_id is distinct from p_group_id
     or existing.target_variation_id is distinct from p_target_variation_id
     or existing.target_sku is distinct from p_target_sku
     or existing.target_offer_id is distinct from target_offer
     or existing.marketplace_id is distinct from target_marketplace
     or existing.listing_id is distinct from target_listing
     or existing.c2_confirmed_revision is distinct from r.captured_desired_revision
     or existing.c2_terminal_checkpoint_id is distinct from c.checkpoint_id then
    raise exception 'removed-SKU remote retirement identity conflict' using errcode = 'VR001';
  end if;
  return query select to_jsonb(existing);
end;
$$;

create function public.start_variation_listing_removed_sku_remote_retirement(
  p_revision_id uuid
) returns table(retirement jsonb)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  x public.variation_listing_removed_sku_remote_retirements;
  target_group_id uuid;
begin
  select r.group_id into target_group_id
    from public.variation_listing_removed_sku_remote_retirements r
   where r.revision_id = p_revision_id;
  if not found then raise exception 'removed-SKU remote retirement not prepared' using errcode = 'VR004'; end if;
  perform 1 from public.variation_listing_groups where group_id = target_group_id for update;
  select * into x from public.variation_listing_removed_sku_remote_retirements
   where revision_id = p_revision_id for update;
  if not found then raise exception 'removed-SKU remote retirement not prepared' using errcode = 'VR004'; end if;
  if x.state <> 'ready' then
    raise exception 'removed-SKU remote retirement start requires ready state' using errcode = 'VR003';
  end if;
  update public.variation_listing_removed_sku_remote_retirements
     set state = 'started', started_at = clock_timestamp(), evidence = '{}'::jsonb,
         observed_remote_state = null
   where revision_id = p_revision_id;
  return query select to_jsonb(row_data) from public.variation_listing_removed_sku_remote_retirements row_data
   where row_data.revision_id = p_revision_id;
end;
$$;

create function public.mark_variation_listing_removed_sku_remote_retirement_unknown(
  p_revision_id uuid,
  p_evidence jsonb
) returns table(retirement jsonb)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  x public.variation_listing_removed_sku_remote_retirements;
  target_group_id uuid;
begin
  if jsonb_typeof(p_evidence) is distinct from 'object' or p_evidence = '{}'::jsonb then
    raise exception 'removed-SKU remote retirement ambiguity evidence is required' using errcode = 'VR002';
  end if;
  select r.group_id into target_group_id
    from public.variation_listing_removed_sku_remote_retirements r
   where r.revision_id = p_revision_id;
  if not found then raise exception 'removed-SKU remote retirement not prepared' using errcode = 'VR004'; end if;
  perform 1 from public.variation_listing_groups where group_id = target_group_id for update;
  select * into x from public.variation_listing_removed_sku_remote_retirements
   where revision_id = p_revision_id for update;
  if not found then raise exception 'removed-SKU remote retirement not prepared' using errcode = 'VR004'; end if;
  if x.state = 'unknown' then
    return query select to_jsonb(x);
    return;
  end if;
  if x.state <> 'started' then
    raise exception 'removed-SKU remote retirement unknown transition requires started state' using errcode = 'VR003';
  end if;
  update public.variation_listing_removed_sku_remote_retirements
     set state = 'unknown', observed_remote_state = 'unknown', evidence = p_evidence
   where revision_id = p_revision_id;
  return query select to_jsonb(row_data) from public.variation_listing_removed_sku_remote_retirements row_data
   where row_data.revision_id = p_revision_id;
end;
$$;

create function public.complete_variation_listing_removed_sku_remote_retirement(
  p_revision_id uuid,
  p_evidence jsonb
) returns table(retirement jsonb)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  x public.variation_listing_removed_sku_remote_retirements;
  target_group_id uuid;
  transitioned_at timestamptz;
begin
  if jsonb_typeof(p_evidence) is distinct from 'object'
     or p_evidence->>'revisionId' is null
     or p_evidence->>'targetSku' is null
     or p_evidence->>'targetOfferId' is null
     or p_evidence->>'marketplaceId' is null
     or p_evidence->>'listingId' is null
     or p_evidence->'item'->>'state' is distinct from 'absent'
     or p_evidence->'item'->>'sku' is null
     or p_evidence->'offers'->>'complete' is distinct from 'true'
     or jsonb_typeof(p_evidence->'offers'->'offers') is distinct from 'array'
     or jsonb_array_length(p_evidence->'offers'->'offers') <> 0
     or p_evidence->'survivors'->>'exact' is distinct from 'true'
     or jsonb_typeof(p_evidence->'survivors'->'skus') is distinct from 'array' then
    raise exception 'removed-SKU remote retirement completion requires exact absence evidence' using errcode = 'VR003';
  end if;
  select r.group_id into target_group_id
    from public.variation_listing_removed_sku_remote_retirements r
   where r.revision_id = p_revision_id;
  if not found then raise exception 'removed-SKU remote retirement not prepared' using errcode = 'VR004'; end if;
  perform 1 from public.variation_listing_groups where group_id = target_group_id for update;
  select * into x from public.variation_listing_removed_sku_remote_retirements
   where revision_id = p_revision_id for update;
  if not found then raise exception 'removed-SKU remote retirement not prepared' using errcode = 'VR004'; end if;
  if p_evidence->>'revisionId' is distinct from x.revision_id::text
     or p_evidence->>'targetSku' is distinct from x.target_sku
     or p_evidence->'item'->>'sku' is distinct from x.target_sku
     or p_evidence->>'targetOfferId' is distinct from x.target_offer_id
     or p_evidence->>'marketplaceId' is distinct from x.marketplace_id
     or p_evidence->>'listingId' is distinct from x.listing_id
     or p_evidence->'survivors'->'skus' is distinct from (
       select r.snapshot->'permanentRemoval'->'survivorSkus'
         from public.variation_listing_revisions r where r.revision_id = x.revision_id
     ) then
    raise exception 'removed-SKU remote retirement completion identity evidence conflicts with frozen c2' using errcode = 'VR002';
  end if;
  if x.state = 'confirmed_complete' then
    return query select to_jsonb(x);
    return;
  end if;
  if x.state not in ('ready','started','unknown') then
    raise exception 'removed-SKU remote retirement completion state is invalid' using errcode = 'VR003';
  end if;
  transitioned_at := clock_timestamp();
  update public.variation_listing_removed_sku_remote_retirements
     set state = 'confirmed_complete', observed_remote_state = 'proven_absent',
         evidence = p_evidence,
         started_at = coalesce(started_at, transitioned_at),
         completed_at = transitioned_at
   where revision_id = p_revision_id;
  return query select to_jsonb(row_data) from public.variation_listing_removed_sku_remote_retirements row_data
   where row_data.revision_id = p_revision_id;
end;
$$;

create function public.get_variation_listing_removed_sku_remote_retirement(
  p_revision_id uuid
) returns table(retirement jsonb)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  x public.variation_listing_removed_sku_remote_retirements;
begin
  if p_revision_id is null then
    raise exception 'removed-SKU remote retirement revision is required' using errcode = 'VR002';
  end if;
  select * into x
    from public.variation_listing_removed_sku_remote_retirements r
   where r.revision_id = p_revision_id;
  if found then
    return query select to_jsonb(x);
  else
    return query select null::jsonb;
  end if;
end;
$$;

-- Gate the applied c2 finalizer behind the c2b proof.  The applied function
-- returns early when the target variation is already absent, before its own
-- DML triggers can enforce this prerequisite; this additive wrapper covers
-- both target-present and historical target-absent finalization.
create function public.confirm_variation_listing_permanent_removal_after_remote_retirement(
  p_group_id uuid,
  p_revision_id uuid,
  p_expected_previous_confirmed_revision bigint,
  p_confirmed_revision bigint,
  p_target_variation_id uuid,
  p_target_sku text
) returns table(group_row jsonb)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  retirement public.variation_listing_removed_sku_remote_retirements;
  locked_group public.variation_listing_groups;
begin
  -- Match the applied c1/c2 lock order before calling the applied function.
  perform 1
    from public.variation_listing_intake_sessions s
   order by s.capture_source_key for update;
  select * into locked_group
    from public.variation_listing_groups g
   where g.group_id = p_group_id for update;
  if not found then
    raise exception 'variation listing group not found' using errcode = 'VR004';
  end if;
  if exists (
    select 1
      from public.variation_listing_intake_sessions s
     where s.target_group_id = p_group_id
        or (s.pending_pair->>'target_group_id')::uuid = p_group_id
  ) then
    raise exception 'c2 finalization requires an idle intake session' using errcode = 'VR002';
  end if;
  select * into retirement
    from public.variation_listing_removed_sku_remote_retirements r
   where r.revision_id = p_revision_id for update;
  if not found then
    raise exception 'removed-SKU remote retirement not prepared' using errcode = 'VR004';
  end if;
  if p_expected_previous_confirmed_revision is null
     or p_confirmed_revision is null
     or retirement.group_id is distinct from p_group_id
     or retirement.target_variation_id is distinct from p_target_variation_id
     or retirement.target_sku is distinct from p_target_sku
     or retirement.c2_confirmed_revision is distinct from p_confirmed_revision
     or retirement.state <> 'confirmed_complete'
     or locked_group.desired_revision is distinct from p_confirmed_revision
     or locked_group.last_confirmed_revision not in (
       p_expected_previous_confirmed_revision,
       p_confirmed_revision
     ) then
    raise exception 'c2 finalization requires exact confirmed removed-SKU remote retirement' using errcode = 'VR002';
  end if;
  return query
    select *
      from public.confirm_variation_listing_permanent_removal(
        p_group_id,
        p_revision_id,
        p_expected_previous_confirmed_revision,
        p_confirmed_revision,
        p_target_variation_id,
        p_target_sku
      );
end;
$$;

alter table public.variation_listing_removed_sku_remote_retirements enable row level security;
revoke all privileges on table public.variation_listing_removed_sku_remote_retirements
  from public, anon, authenticated, service_role;

revoke all on function public.prevent_variation_listing_removed_sku_remote_retirement_identity_mutation() from public, anon, authenticated, service_role;
revoke all on function public.prevent_variation_listing_removed_sku_remote_retirement_pending_mix() from public, anon, authenticated, service_role;
revoke all on function public.prepare_variation_listing_removed_sku_remote_retirement(uuid,uuid,uuid,text) from public, anon, authenticated, service_role;
revoke all on function public.start_variation_listing_removed_sku_remote_retirement(uuid) from public, anon, authenticated, service_role;
revoke all on function public.mark_variation_listing_removed_sku_remote_retirement_unknown(uuid,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.complete_variation_listing_removed_sku_remote_retirement(uuid,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.get_variation_listing_removed_sku_remote_retirement(uuid) from public, anon, authenticated, service_role;
revoke all on function public.confirm_variation_listing_permanent_removal_after_remote_retirement(uuid,uuid,bigint,bigint,uuid,text) from public, anon, authenticated, service_role;
revoke execute on function public.confirm_variation_listing_permanent_removal(uuid,uuid,bigint,bigint,uuid,text) from service_role;
grant execute on function public.prepare_variation_listing_removed_sku_remote_retirement(uuid,uuid,uuid,text) to service_role;
grant execute on function public.start_variation_listing_removed_sku_remote_retirement(uuid) to service_role;
grant execute on function public.mark_variation_listing_removed_sku_remote_retirement_unknown(uuid,jsonb) to service_role;
grant execute on function public.complete_variation_listing_removed_sku_remote_retirement(uuid,jsonb) to service_role;
grant execute on function public.get_variation_listing_removed_sku_remote_retirement(uuid) to service_role;
grant execute on function public.confirm_variation_listing_permanent_removal_after_remote_retirement(uuid,uuid,bigint,bigint,uuid,text) to service_role;

commit;
