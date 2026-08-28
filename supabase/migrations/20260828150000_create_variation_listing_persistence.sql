-- YP2.2a additive variation-listing persistence. Service-role only.

create table public.variation_listing_groups (
  group_id uuid not null,
  group_key text not null,
  sku_category_code text not null,
  sku_bucket_token text not null,
  next_inventory_serial integer not null default 1,
  lifecycle_state text not null default 'intake',
  recovery_required boolean not null default false,
  selector_name text not null default 'Card',
  title text,
  description text,
  derived_common_ebay_aspects jsonb not null default '{}'::jsonb,
  category_id text not null,
  marketplace_id text not null,
  listing_format text not null default 'FIXED_PRICE',
  merchant_location_key text not null,
  fulfillment_policy_id text not null,
  payment_policy_id text not null,
  return_policy_id text not null,
  condition_id text not null,
  condition_token text not null,
  condition_description text,
  condition_descriptors jsonb not null default '[]'::jsonb,
  desired_revision bigint not null default 0,
  last_confirmed_revision bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint variation_listing_groups_pkey primary key (group_id),
  constraint variation_listing_groups_group_key_key unique (group_key),
  constraint variation_listing_groups_sku_namespace_key unique (sku_category_code, sku_bucket_token),
  constraint variation_listing_groups_sku_category_code_check check (
    sku_category_code in ('BSKBL','BSBL','OTHER') and sku_category_code = upper(sku_category_code)
  ),
  constraint variation_listing_groups_sku_bucket_token_check check (
    length(sku_bucket_token) between 1 and 32
    and sku_bucket_token = btrim(sku_bucket_token)
    and sku_bucket_token ~ '^[A-Za-z0-9]+([._-][A-Za-z0-9]+)*$'
    and sku_bucket_token not in ('Single','Lot')
  ),
  constraint variation_listing_groups_group_key_projection_check check (
    group_key = 'VL-G-' || upper(replace(group_id::text, '-', ''))
  ),
  constraint variation_listing_groups_next_inventory_serial_check check (next_inventory_serial between 1 and 1000000),
  constraint variation_listing_groups_lifecycle_state_check check (
    lifecycle_state in ('intake','draft','review','publish-ready','publishing','active','withdrawn','abandoned','cleanup','terminal-absent')
  ),
  constraint variation_listing_groups_selector_name_check check (selector_name = 'Card'),
  constraint variation_listing_groups_title_check check (title is null or (title = btrim(title) and length(title) > 0)),
  constraint variation_listing_groups_description_check check (description is null or (description = btrim(description) and length(description) > 0)),
  constraint variation_listing_groups_condition_description_check check (condition_description is null or (condition_description = btrim(condition_description) and length(condition_description) > 0)),
  constraint variation_listing_groups_text_check check (
    group_key = btrim(group_key) and length(group_key) > 0
    and category_id = btrim(category_id) and length(category_id) > 0
    and marketplace_id = btrim(marketplace_id) and length(marketplace_id) > 0
    and merchant_location_key = btrim(merchant_location_key) and length(merchant_location_key) > 0
    and fulfillment_policy_id = btrim(fulfillment_policy_id) and length(fulfillment_policy_id) > 0
    and payment_policy_id = btrim(payment_policy_id) and length(payment_policy_id) > 0
    and return_policy_id = btrim(return_policy_id) and length(return_policy_id) > 0
    and condition_id = btrim(condition_id) and length(condition_id) > 0
  ),
  constraint variation_listing_groups_listing_format_check check (listing_format = 'FIXED_PRICE'),
  constraint variation_listing_groups_derived_common_ebay_aspects_check check (jsonb_typeof(derived_common_ebay_aspects) = 'object'),
  constraint variation_listing_groups_condition_descriptors_check check (jsonb_typeof(condition_descriptors) = 'array'),
  constraint variation_listing_groups_condition_token_check check (condition_token in ('NEAR_MINT_OR_BETTER','EXCELLENT','VERY_GOOD','POOR')),
  constraint variation_listing_groups_revision_watermark_check check (
    desired_revision >= 0 and (last_confirmed_revision is null or (last_confirmed_revision >= 1 and last_confirmed_revision <= desired_revision))
  )
);

create index variation_listing_groups_lifecycle_state_idx on public.variation_listing_groups (lifecycle_state);
create index variation_listing_groups_pending_revision_idx on public.variation_listing_groups (group_id)
  where last_confirmed_revision is null or last_confirmed_revision < desired_revision;

create table public.variation_listing_variations (
  variation_id uuid not null,
  group_id uuid not null,
  inventory_serial integer not null,
  sku text not null,
  position integer not null,
  selector_value text not null,
  price_amount numeric not null,
  price_currency text not null default 'USD',
  representative_copy_id uuid,
  variation_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint variation_listing_variations_pkey primary key (variation_id),
  constraint variation_listing_variations_group_variation_key unique (group_id, variation_id),
  constraint variation_listing_variations_sku_key unique (sku),
  constraint variation_listing_variations_group_position_key unique (group_id, position) deferrable initially deferred,
  constraint variation_listing_variations_group_selector_value_key unique (group_id, selector_value),
  constraint variation_listing_variations_group_id_fkey foreign key (group_id)
    references public.variation_listing_groups (group_id) on update no action on delete no action,
  constraint variation_listing_variations_inventory_serial_check check (inventory_serial between 1 and 999999),
  constraint variation_listing_variations_position_check check (position >= 0),
  constraint variation_listing_variations_selector_value_check check (selector_value = btrim(selector_value) and length(selector_value) > 0),
  constraint variation_listing_variations_price_amount_check check (price_amount in (0.99,1.49,1.99,2.49)),
  constraint variation_listing_variations_price_currency_check check (price_currency = 'USD'),
  constraint variation_listing_variations_metadata_check check (jsonb_typeof(variation_metadata) = 'object'),
  constraint variation_listing_variations_sku_grammar_check check (
    sku ~ '^[A-Z]+-[A-Za-z0-9]+([._-][A-Za-z0-9]+)*-[0-9]{6}$' and right(sku, 6) <> '000000'
  )
);
create index variation_listing_variations_group_id_idx on public.variation_listing_variations (group_id);

create table public.variation_listing_copies (
  copy_id uuid not null,
  variation_id uuid not null,
  availability_state text not null default 'available',
  condition_token text not null,
  condition_notes text,
  front_r2_key text not null,
  back_r2_key text not null,
  capture_source_key text not null,
  capture_session_version bigint not null,
  capture_pair_id uuid not null,
  capture_front_source_ref text not null,
  capture_back_source_ref text not null,
  capture_started_at timestamptz not null,
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint variation_listing_copies_pkey primary key (copy_id),
  constraint variation_listing_copies_variation_copy_key unique (variation_id, copy_id),
  constraint variation_listing_copies_capture_pair_id_key unique (capture_pair_id),
  constraint variation_listing_copies_variation_id_fkey foreign key (variation_id)
    references public.variation_listing_variations (variation_id) on update no action on delete no action,
  constraint variation_listing_copies_availability_state_check check (availability_state in ('available','unavailable')),
  constraint variation_listing_copies_condition_token_check check (condition_token in ('NEAR_MINT_OR_BETTER','EXCELLENT','VERY_GOOD','POOR')),
  constraint variation_listing_copies_condition_notes_check check (condition_notes is null or (condition_notes = btrim(condition_notes) and length(condition_notes) > 0)),
  constraint variation_listing_copies_r2_key_check check (
    front_r2_key = btrim(front_r2_key) and length(front_r2_key) > 0
    and back_r2_key = btrim(back_r2_key) and length(back_r2_key) > 0
    and front_r2_key like 'variation-listing/%/front-%' and back_r2_key like 'variation-listing/%/back-%'
    and front_r2_key !~ '[[:space:][:cntrl:]]' and back_r2_key !~ '[[:space:][:cntrl:]]'
  ),
  constraint variation_listing_copies_capture_source_check check (
    capture_source_key = btrim(capture_source_key) and length(capture_source_key) > 0
    and capture_front_source_ref = btrim(capture_front_source_ref) and length(capture_front_source_ref) > 0
    and capture_back_source_ref = btrim(capture_back_source_ref) and length(capture_back_source_ref) > 0
  ),
  constraint variation_listing_copies_capture_session_version_check check (capture_session_version >= 1),
  constraint variation_listing_copies_capture_time_check check (capture_started_at <= captured_at)
);
create index variation_listing_copies_variation_id_idx on public.variation_listing_copies (variation_id);
create index variation_listing_copies_availability_idx on public.variation_listing_copies (variation_id, availability_state);

create table public.variation_listing_intake_sessions (
  capture_source_key text not null,
  session_version bigint not null default 1,
  mode text not null default 'idle',
  target_group_id uuid,
  target_variation_id uuid,
  sticky_price_amount numeric not null default 0.99,
  sticky_price_currency text not null default 'USD',
  pending_pair_id uuid,
  pending_pair_session_version bigint,
  pending_pair_mode text,
  pending_pair_target_group_id uuid,
  pending_pair_target_variation_id uuid,
  pending_pair_price_amount numeric,
  pending_pair_price_currency text,
  pending_pair_front_source_ref text,
  pending_pair_started_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint variation_listing_intake_sessions_pkey primary key (capture_source_key),
  constraint variation_listing_intake_sessions_capture_source_key_check check (capture_source_key = btrim(capture_source_key) and length(capture_source_key) > 0),
  constraint variation_listing_intake_sessions_session_version_check check (session_version >= 1),
  constraint variation_listing_intake_sessions_mode_check check (mode in ('idle','new_variation','duplicate_copy')),
  constraint variation_listing_intake_sessions_target_mode_check check (
    (mode = 'idle' and target_group_id is null and target_variation_id is null)
    or (mode = 'new_variation' and target_group_id is not null and target_variation_id is null)
    or (mode = 'duplicate_copy' and target_group_id is not null and target_variation_id is not null)
  ),
  constraint variation_listing_intake_sessions_target_group_id_fkey foreign key (target_group_id)
    references public.variation_listing_groups (group_id) on update no action on delete no action,
  constraint variation_listing_intake_sessions_target_variation_group_fkey foreign key (target_group_id,target_variation_id)
    references public.variation_listing_variations (group_id,variation_id) on update no action on delete no action,
  constraint variation_listing_intake_sessions_sticky_price_check check (sticky_price_amount in (0.99,1.49,1.99,2.49)),
  constraint variation_listing_intake_sessions_sticky_price_currency_check check (sticky_price_currency = 'USD'),
  constraint variation_listing_intake_sessions_pending_all_or_none_check check (
    (pending_pair_id is null and pending_pair_session_version is null and pending_pair_mode is null
      and pending_pair_target_group_id is null and pending_pair_target_variation_id is null
      and pending_pair_price_amount is null and pending_pair_price_currency is null
      and pending_pair_front_source_ref is null and pending_pair_started_at is null)
    or (pending_pair_id is not null and pending_pair_session_version is not null and pending_pair_mode is not null
      and pending_pair_target_group_id is not null and pending_pair_price_amount is not null
      and pending_pair_price_currency is not null and pending_pair_front_source_ref is not null and pending_pair_started_at is not null
      and ((pending_pair_mode = 'new_variation' and pending_pair_target_variation_id is null)
        or (pending_pair_mode = 'duplicate_copy' and pending_pair_target_variation_id is not null))
  )),
  constraint variation_listing_intake_sessions_pending_pair_price_check check (pending_pair_price_amount is null or pending_pair_price_amount in (0.99,1.49,1.99,2.49)),
  constraint variation_listing_intake_sessions_pending_pair_currency_check check (pending_pair_price_currency is null or pending_pair_price_currency = 'USD'),
  constraint variation_listing_intake_sessions_pending_pair_mode_check check (pending_pair_mode is null or pending_pair_mode in ('new_variation','duplicate_copy')),
  constraint variation_listing_intake_sessions_pending_pair_group_fkey foreign key (pending_pair_target_group_id)
    references public.variation_listing_groups (group_id) on update no action on delete no action,
  constraint variation_listing_intake_sessions_pending_variation_group_fkey foreign key (pending_pair_target_group_id,pending_pair_target_variation_id)
    references public.variation_listing_variations (group_id,variation_id) on update no action on delete no action,
  constraint variation_listing_intake_sessions_pending_pair_version_check check (pending_pair_session_version is null or (pending_pair_session_version >= 1 and pending_pair_session_version = session_version)),
  constraint variation_listing_intake_sessions_pending_snapshot_check check (
    (pending_pair_id is null and pending_pair_mode is null)
    or (pending_pair_mode = mode and pending_pair_target_group_id is not distinct from target_group_id
      and pending_pair_target_variation_id is not distinct from target_variation_id
      and pending_pair_price_amount = sticky_price_amount and pending_pair_price_currency = sticky_price_currency)
  ),
  constraint variation_listing_intake_sessions_pending_pair_source_check check (
    (pending_pair_front_source_ref is null and pending_pair_id is null and pending_pair_started_at is null)
    or (pending_pair_front_source_ref = btrim(pending_pair_front_source_ref) and length(pending_pair_front_source_ref) > 0
      and pending_pair_id is not null and pending_pair_started_at is not null)
  )
);

create function public.prevent_variation_listing_group_identity_update()
returns trigger language plpgsql as $$
begin
  if new.group_id is distinct from old.group_id or new.group_key is distinct from old.group_key
     or new.sku_category_code is distinct from old.sku_category_code or new.sku_bucket_token is distinct from old.sku_bucket_token
     or new.selector_name is distinct from old.selector_name or new.created_at is distinct from old.created_at then
    raise exception 'variation listing group identity is immutable';
  end if;
  return new;
end; $$;

create function public.prevent_allocated_variation_listing_group_delete()
returns trigger language plpgsql as $$
begin
  if old.next_inventory_serial > 1 then
    raise exception 'allocated variation listing namespace cannot be deleted';
  end if;
  return old;
end; $$;

create function public.validate_variation_listing_group_guarded_update()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
declare scope text := current_setting('app.variation_listing_write_scope', true);
declare configured_group text := current_setting('app.variation_listing_group_id', true);
declare configured_revision text := current_setting('app.variation_listing_expected_revision', true);
begin
  if configured_group is null or configured_group = '' or configured_revision is null or configured_revision = ''
     or configured_group <> old.group_id::text or configured_revision::bigint <> old.desired_revision then
    raise exception 'variation listing group update requires matching aggregate CAS';
  end if;
  if scope = 'aggregate' then
    if new.desired_revision <> old.desired_revision + 1
       or new.last_confirmed_revision is distinct from old.last_confirmed_revision
       or new.next_inventory_serial not in (old.next_inventory_serial, old.next_inventory_serial + 1) then
      raise exception 'invalid aggregate revision or allocator transition';
    end if;
    execute $proof$
      create temp table variation_listing_aggregate_revision_proof (
        transaction_id xid8 not null,
        group_id uuid not null,
        from_revision bigint not null,
        to_revision bigint not null
      ) on commit drop
    $proof$;
    insert into pg_temp.variation_listing_aggregate_revision_proof
      (transaction_id, group_id, from_revision, to_revision)
    values (pg_current_xact_id(), old.group_id, old.desired_revision, new.desired_revision);
  elsif scope = 'confirmation' then
    if new.desired_revision <> old.desired_revision or new.next_inventory_serial <> old.next_inventory_serial
       or new.last_confirmed_revision is null or new.last_confirmed_revision < 1
       or new.last_confirmed_revision > new.desired_revision
       or (old.last_confirmed_revision is not null and new.last_confirmed_revision < old.last_confirmed_revision) then
      raise exception 'invalid confirmation transition';
    end if;
    if new.title is distinct from old.title or new.description is distinct from old.description
       or new.derived_common_ebay_aspects is distinct from old.derived_common_ebay_aspects
       or new.category_id is distinct from old.category_id or new.marketplace_id is distinct from old.marketplace_id
       or new.listing_format is distinct from old.listing_format or new.merchant_location_key is distinct from old.merchant_location_key
       or new.fulfillment_policy_id is distinct from old.fulfillment_policy_id or new.payment_policy_id is distinct from old.payment_policy_id
       or new.return_policy_id is distinct from old.return_policy_id or new.condition_id is distinct from old.condition_id
       or new.condition_token is distinct from old.condition_token or new.condition_description is distinct from old.condition_description
       or new.condition_descriptors is distinct from old.condition_descriptors then
      raise exception 'confirmation may only alter confirmation evidence and lifecycle overlay';
    end if;
  elsif scope is null or scope = '' then
    if new.desired_revision is distinct from old.desired_revision or new.last_confirmed_revision is distinct from old.last_confirmed_revision
       or new.next_inventory_serial is distinct from old.next_inventory_serial
       or new.lifecycle_state is distinct from old.lifecycle_state or new.recovery_required is distinct from old.recovery_required
       or new.title is distinct from old.title or new.description is distinct from old.description
       or new.derived_common_ebay_aspects is distinct from old.derived_common_ebay_aspects
       or new.category_id is distinct from old.category_id or new.marketplace_id is distinct from old.marketplace_id
       or new.listing_format is distinct from old.listing_format or new.merchant_location_key is distinct from old.merchant_location_key
       or new.fulfillment_policy_id is distinct from old.fulfillment_policy_id or new.payment_policy_id is distinct from old.payment_policy_id
       or new.return_policy_id is distinct from old.return_policy_id or new.condition_id is distinct from old.condition_id
       or new.condition_token is distinct from old.condition_token or new.condition_description is distinct from old.condition_description
       or new.condition_descriptors is distinct from old.condition_descriptors then
      raise exception 'unguarded variation listing group mutation';
    end if;
  else
    raise exception 'unknown variation listing write scope: %', scope;
  end if;
  return new;
end; $$;

create function public.verify_variation_listing_allocator_consumption()
returns trigger language plpgsql as $$
declare expected_serial integer := old.next_inventory_serial;
declare expected_sku text;
begin
  expected_sku := old.sku_category_code || '-' || old.sku_bucket_token || '-' || lpad(expected_serial::text, 6, '0');
  if (select count(*) from public.variation_listing_variations v
      where v.group_id = old.group_id and v.inventory_serial = expected_serial and v.sku = expected_sku) <> 1 then
    raise exception 'allocator serial % for group % was not consumed by exact variation SKU', expected_serial, old.group_id;
  end if;
  return new;
end; $$;

create function public.prevent_variation_listing_variation_identity_update()
returns trigger language plpgsql as $$
begin
  if new.variation_id is distinct from old.variation_id or new.group_id is distinct from old.group_id
     or new.inventory_serial is distinct from old.inventory_serial or new.sku is distinct from old.sku
     or new.selector_value is distinct from old.selector_value or new.created_at is distinct from old.created_at then
    raise exception 'variation listing variation identity is immutable';
  end if;
  return new;
end; $$;

create function public.validate_variation_listing_sku_projection()
returns trigger language plpgsql as $$
declare group_row record;
begin
  select sku_category_code, sku_bucket_token into group_row from public.variation_listing_groups where group_id = new.group_id;
  if not found or new.sku is distinct from group_row.sku_category_code || '-' || group_row.sku_bucket_token || '-' || lpad(new.inventory_serial::text, 6, '0') then
    raise exception 'variation SKU does not match owning group projection';
  end if;
  return new;
end; $$;

create function public.validate_variation_listing_variation_aggregate_write()
returns trigger language plpgsql as $$
declare scope text := current_setting('app.variation_listing_write_scope', true);
declare configured_group text := current_setting('app.variation_listing_group_id', true);
declare row_group uuid;
begin
  if tg_op = 'DELETE' then row_group := old.group_id; else row_group := new.group_id; end if;
  if scope is distinct from 'aggregate' or configured_group is null or configured_group = '' or configured_group <> row_group::text
     or current_setting('app.variation_listing_expected_revision', true) is null
     or current_setting('app.variation_listing_expected_revision', true) = '' then
    raise exception 'variation write requires aggregate scope and owning group CAS';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end; $$;

create function public.require_variation_listing_variation_revision_advance()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
declare configured_revision text := current_setting('app.variation_listing_expected_revision', true);
declare row_group uuid;
declare current_revision bigint;
declare proof_relation oid;
declare proof_owner oid;
declare proof_valid boolean := false;
begin
  if tg_op = 'DELETE' then row_group := old.group_id; else row_group := new.group_id; end if;
  select desired_revision into current_revision from public.variation_listing_groups where group_id = row_group;
  if configured_revision is null or configured_revision = '' or current_revision is null
     or current_revision <> configured_revision::bigint + 1 then
    raise exception 'variation write did not observe exactly one group revision advance';
  end if;
  proof_relation := pg_catalog.to_regclass('pg_temp.variation_listing_aggregate_revision_proof');
  if proof_relation is null then
    raise exception 'variation write lacks same-transaction group revision proof';
  end if;
  select c.relowner into proof_owner
  from pg_catalog.pg_class c
  where c.oid = proof_relation;
  if proof_owner is distinct from (select r.oid from pg_catalog.pg_roles r where r.rolname = current_user) then
    raise exception 'variation write proof table has unexpected owner';
  end if;
  select count(*) = 1 and bool_and(
      p.transaction_id = pg_current_xact_id()
      and p.group_id = row_group
      and p.from_revision = configured_revision::bigint
      and p.to_revision = current_revision
    )
    into proof_valid
  from pg_temp.variation_listing_aggregate_revision_proof p;
  if proof_valid is not true then
    raise exception 'variation write lacks same-transaction group revision proof';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end; $$;

create function public.prevent_variation_listing_copy_identity_update()
returns trigger language plpgsql as $$
begin
  if new.copy_id is distinct from old.copy_id or new.variation_id is distinct from old.variation_id
     or new.front_r2_key is distinct from old.front_r2_key or new.back_r2_key is distinct from old.back_r2_key
     or new.capture_source_key is distinct from old.capture_source_key or new.capture_session_version is distinct from old.capture_session_version
     or new.capture_pair_id is distinct from old.capture_pair_id or new.capture_front_source_ref is distinct from old.capture_front_source_ref
     or new.capture_back_source_ref is distinct from old.capture_back_source_ref or new.capture_started_at is distinct from old.capture_started_at
     or new.captured_at is distinct from old.captured_at or new.created_at is distinct from old.created_at then
    raise exception 'variation listing copy identity/provenance is immutable';
  end if;
  return new;
end; $$;

create function public.validate_variation_listing_copy_aggregate_write()
returns trigger language plpgsql as $$
declare scope text := current_setting('app.variation_listing_write_scope', true);
declare configured_group text := current_setting('app.variation_listing_group_id', true);
declare row_variation uuid;
declare row_group uuid;
begin
  if tg_op = 'DELETE' then row_variation := old.variation_id; else row_variation := new.variation_id; end if;
  select group_id into row_group from public.variation_listing_variations where variation_id = row_variation;
  if scope is distinct from 'aggregate' or configured_group is null or configured_group = '' or row_group is null or configured_group <> row_group::text
     or current_setting('app.variation_listing_expected_revision', true) is null
     or current_setting('app.variation_listing_expected_revision', true) = '' then
    raise exception 'copy write requires aggregate scope and owning group CAS';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end; $$;

create function public.require_variation_listing_copy_revision_advance()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
declare configured_revision text := current_setting('app.variation_listing_expected_revision', true);
declare row_variation uuid;
declare row_group uuid;
declare current_revision bigint;
declare proof_relation oid;
declare proof_owner oid;
declare proof_valid boolean := false;
begin
  if tg_op = 'DELETE' then
    row_variation := old.variation_id;
  else
    row_variation := new.variation_id;
  end if;
  select group_id into row_group from public.variation_listing_variations where variation_id = row_variation;
  if row_group is null then
    row_group := nullif(current_setting('app.variation_listing_group_id', true), '')::uuid;
  end if;
  select desired_revision into current_revision from public.variation_listing_groups where group_id = row_group;
  if configured_revision is null or configured_revision = '' or current_revision is null
     or current_revision <> configured_revision::bigint + 1 then
    raise exception 'copy write did not observe exactly one group revision advance';
  end if;
  proof_relation := pg_catalog.to_regclass('pg_temp.variation_listing_aggregate_revision_proof');
  if proof_relation is null then
    raise exception 'copy write lacks same-transaction group revision proof';
  end if;
  select c.relowner into proof_owner
  from pg_catalog.pg_class c
  where c.oid = proof_relation;
  if proof_owner is distinct from (select r.oid from pg_catalog.pg_roles r where r.rolname = current_user) then
    raise exception 'copy write proof table has unexpected owner';
  end if;
  select count(*) = 1 and bool_and(
      p.transaction_id = pg_current_xact_id()
      and p.group_id = row_group
      and p.from_revision = configured_revision::bigint
      and p.to_revision = current_revision
    )
    into proof_valid
  from pg_temp.variation_listing_aggregate_revision_proof p;
  if proof_valid is not true then
    raise exception 'copy write lacks same-transaction group revision proof';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end; $$;

create function public.require_variation_listing_representative_copy()
returns trigger language plpgsql as $$
declare representative uuid;
declare target_id uuid;
begin
  if tg_op = 'DELETE' then target_id := old.variation_id; else target_id := new.variation_id; end if;
  select representative_copy_id into representative from public.variation_listing_variations where variation_id = target_id;
  if found and representative is null then raise exception 'surviving variation must have a representative copy'; end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end; $$;

create function public.prevent_variation_listing_intake_session_identity_update()
returns trigger language plpgsql as $$
begin
  if new.capture_source_key is distinct from old.capture_source_key or new.created_at is distinct from old.created_at then
    raise exception 'variation listing intake session identity is immutable';
  end if;
  return new;
end; $$;

create function public.validate_variation_listing_intake_session_transition()
returns trigger language plpgsql as $$
declare old_pending boolean := old.pending_pair_id is not null;
declare new_pending boolean := new.pending_pair_id is not null;
declare config_changed boolean := new.mode is distinct from old.mode
  or new.target_group_id is distinct from old.target_group_id
  or new.target_variation_id is distinct from old.target_variation_id
  or new.sticky_price_amount is distinct from old.sticky_price_amount
  or new.sticky_price_currency is distinct from old.sticky_price_currency;
declare snapshots_same boolean := new.pending_pair_id is not distinct from old.pending_pair_id
  and new.pending_pair_session_version is not distinct from old.pending_pair_session_version
  and new.pending_pair_mode is not distinct from old.pending_pair_mode
  and new.pending_pair_target_group_id is not distinct from old.pending_pair_target_group_id
  and new.pending_pair_target_variation_id is not distinct from old.pending_pair_target_variation_id
  and new.pending_pair_price_amount is not distinct from old.pending_pair_price_amount
  and new.pending_pair_price_currency is not distinct from old.pending_pair_price_currency
  and new.pending_pair_front_source_ref is not distinct from old.pending_pair_front_source_ref
  and new.pending_pair_started_at is not distinct from old.pending_pair_started_at;
begin
  if new.session_version < old.session_version then
    raise exception 'intake session version cannot decrease';
  end if;
  if not old_pending and not new_pending and config_changed then
    if new.session_version <> old.session_version + 1 then
      raise exception 'target/mode/price changes require one session version increment';
    end if;
  elsif not old_pending and new_pending then
    if config_changed then
      raise exception 'first-image capture cannot change target/mode/price';
    end if;
    if new.session_version <> old.session_version
       or new.pending_pair_session_version <> old.session_version
       or new.pending_pair_mode <> new.mode
       or new.pending_pair_target_group_id is distinct from new.target_group_id
       or new.pending_pair_target_variation_id is distinct from new.target_variation_id
       or new.pending_pair_price_amount <> new.sticky_price_amount
       or new.pending_pair_price_currency <> new.sticky_price_currency then
      raise exception 'invalid first-image pending snapshot';
    end if;
  elsif old_pending and not new_pending then
    if config_changed or (new.session_version <> old.session_version and new.session_version <> old.session_version + 1) then
      raise exception 'invalid pending-pair clear transition';
    end if;
  elsif old_pending and new_pending then
    if not snapshots_same or config_changed or new.session_version <> old.session_version then
      raise exception 'pending pair snapshot is immutable';
    end if;
  elsif not config_changed and new.session_version <> old.session_version then
    raise exception 'session version changed without a supported transition';
  end if;
  return new;
end; $$;

revoke all on function public.prevent_variation_listing_group_identity_update() from public, anon, authenticated, service_role;
revoke all on function public.prevent_allocated_variation_listing_group_delete() from public, anon, authenticated, service_role;
revoke all on function public.validate_variation_listing_group_guarded_update() from public, anon, authenticated, service_role;
revoke all on function public.verify_variation_listing_allocator_consumption() from public, anon, authenticated, service_role;
revoke all on function public.prevent_variation_listing_variation_identity_update() from public, anon, authenticated, service_role;
revoke all on function public.validate_variation_listing_sku_projection() from public, anon, authenticated, service_role;
revoke all on function public.validate_variation_listing_variation_aggregate_write() from public, anon, authenticated, service_role;
revoke all on function public.require_variation_listing_variation_revision_advance() from public, anon, authenticated, service_role;
revoke all on function public.prevent_variation_listing_copy_identity_update() from public, anon, authenticated, service_role;
revoke all on function public.validate_variation_listing_copy_aggregate_write() from public, anon, authenticated, service_role;
revoke all on function public.require_variation_listing_copy_revision_advance() from public, anon, authenticated, service_role;
revoke all on function public.require_variation_listing_representative_copy() from public, anon, authenticated, service_role;
revoke all on function public.prevent_variation_listing_intake_session_identity_update() from public, anon, authenticated, service_role;
revoke all on function public.validate_variation_listing_intake_session_transition() from public, anon, authenticated, service_role;

create trigger variation_listing_groups_prevent_identity_update
  before update on public.variation_listing_groups for each row
  execute function public.prevent_variation_listing_group_identity_update();
create trigger variation_listing_groups_validate_guarded_update
  before update on public.variation_listing_groups for each row
  execute function public.validate_variation_listing_group_guarded_update();
create trigger set_variation_listing_groups_updated_at
  before update on public.variation_listing_groups for each row
  execute function public.set_row_updated_at();
create trigger variation_listing_groups_prevent_allocated_delete
  before delete on public.variation_listing_groups for each row
  execute function public.prevent_allocated_variation_listing_group_delete();
create constraint trigger variation_listing_groups_verify_allocator_consumption
  after update of next_inventory_serial on public.variation_listing_groups
  deferrable initially deferred for each row
  when (new.next_inventory_serial = old.next_inventory_serial + 1)
  execute function public.verify_variation_listing_allocator_consumption();

create trigger variation_listing_variations_prevent_identity_update
  before update on public.variation_listing_variations for each row
  execute function public.prevent_variation_listing_variation_identity_update();
create trigger variation_listing_variations_validate_aggregate_write
  before insert or update or delete on public.variation_listing_variations for each row
  execute function public.validate_variation_listing_variation_aggregate_write();
create trigger variation_listing_variations_sku_projection_check
  before insert or update on public.variation_listing_variations for each row
  execute function public.validate_variation_listing_sku_projection();
create trigger set_variation_listing_variations_updated_at
  before update on public.variation_listing_variations for each row
  execute function public.set_row_updated_at();
create constraint trigger variation_listing_variations_require_revision_advance
  after insert or update or delete on public.variation_listing_variations
  deferrable initially deferred for each row
  execute function public.require_variation_listing_variation_revision_advance();

create trigger variation_listing_copies_prevent_identity_update
  before update on public.variation_listing_copies for each row
  execute function public.prevent_variation_listing_copy_identity_update();
create trigger variation_listing_copies_validate_aggregate_write
  before insert or update or delete on public.variation_listing_copies for each row
  execute function public.validate_variation_listing_copy_aggregate_write();
create trigger set_variation_listing_copies_updated_at
  before update on public.variation_listing_copies for each row
  execute function public.set_row_updated_at();
create constraint trigger variation_listing_copies_require_revision_advance
  after insert or update or delete on public.variation_listing_copies
  deferrable initially deferred for each row
  execute function public.require_variation_listing_copy_revision_advance();

create trigger variation_listing_intake_sessions_prevent_identity_update
  before update on public.variation_listing_intake_sessions for each row
  execute function public.prevent_variation_listing_intake_session_identity_update();
create trigger variation_listing_intake_sessions_validate_transition
  before update on public.variation_listing_intake_sessions for each row
  execute function public.validate_variation_listing_intake_session_transition();
create trigger set_variation_listing_intake_sessions_updated_at
  before update on public.variation_listing_intake_sessions for each row
  execute function public.set_row_updated_at();

alter table public.variation_listing_variations
  add constraint variation_listing_variations_representative_copy_fkey
  foreign key (variation_id, representative_copy_id)
  references public.variation_listing_copies (variation_id, copy_id)
  on update no action on delete no action deferrable initially deferred;

create constraint trigger variation_listing_variations_require_representative
  after insert or update on public.variation_listing_variations
  deferrable initially deferred for each row
  execute function public.require_variation_listing_representative_copy();

alter table public.variation_listing_groups enable row level security;
alter table public.variation_listing_variations enable row level security;
alter table public.variation_listing_copies enable row level security;
alter table public.variation_listing_intake_sessions enable row level security;
revoke all privileges on table public.variation_listing_groups, public.variation_listing_variations,
  public.variation_listing_copies, public.variation_listing_intake_sessions from anon, authenticated;
grant all privileges on table public.variation_listing_groups, public.variation_listing_variations,
  public.variation_listing_copies, public.variation_listing_intake_sessions to service_role;
