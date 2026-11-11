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

-- EXEC4 URL bridge test seam: explicit R2 public URL bases are trusted fixture
-- input. A production migration must derive/verifiably provision these origins.
-- No environment values or user-supplied aliases are trusted implicitly.
create table yp_c4_probe.allowed_r2_url_bases (
  base_url text primary key,
  constraint c4_url_base_shape check (
    base_url ~ '^https://[a-z0-9.-]+(/[a-zA-Z0-9_-]+)*$'
    and base_url !~ '[[:space:][:cntrl:]]'
  )
);
alter table yp_c4_probe.allowed_r2_url_bases enable row level security;
revoke all on yp_c4_probe.allowed_r2_url_bases from public, anon, authenticated, service_role;

-- Override only the disposable real-schema fixture's Standard URL mapper.
-- Real buildPublicImageUrl encodes each object-key path segment and appends it
-- after R2_PUBLIC_BASE_URL. Decode bounded ASCII aliases only for detection;
-- canonical Variation references must still be unencoded safe paths. Ordinary
-- encoded Standard URLs remain unrelated when they cannot be mapped safely.
create function yp_c4_probe.decode_url_ascii(p_value text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  value text := p_value;
  decoded text;
  ch text;
  hex text;
  byte integer;
  i integer;
  pass integer;
begin
  for pass in 1..4 loop
    if pg_catalog.strpos(value, '%') = 0 then return value; end if;
    decoded := '';
    i := 1;
    while i <= pg_catalog.length(value) loop
      ch := pg_catalog.substr(value, i, 1);
      if ch = '%' then
        if i + 2 > pg_catalog.length(value) then
          raise exception 'malformed percent-encoded image URL';
        end if;
        hex := pg_catalog.substr(value, i + 1, 2);
        if hex !~ '^[0-9A-Fa-f]{2}$' then
          raise exception 'malformed percent-encoded image URL';
        end if;
        byte := pg_catalog.get_byte(pg_catalog.decode(hex, 'hex'), 0);
        if byte < 32 or byte > 126 then
          raise exception 'non-ASCII percent-encoded image URL';
        end if;
        decoded := decoded || pg_catalog.chr(byte);
        i := i + 3;
      else
        decoded := decoded || ch;
        i := i + 1;
      end if;
    end loop;
    if decoded = value then return decoded; end if;
    value := decoded;
  end loop;
  if pg_catalog.strpos(value, '%') > 0 then
    raise exception 'percent-encoded image URL exceeds decode budget';
  end if;
  return value;
end;
$$;

create or replace function yp_c4_probe.standard_keys(p_keys text[], p_urls text[])
returns text[]
language plpgsql security definer set search_path = ''
as $$
declare
  u text;
  base text;
  tail text;
  decoded_u text;
  decoded_tail text;
  keys text[] := p_keys;
  matched boolean;
begin
  if p_keys is null or p_urls is null then
    raise exception 'missing references';
  end if;
  if exists (select 1 from pg_catalog.unnest(p_keys) x
             where x is null or x = '' or x <> pg_catalog.btrim(x)) then
    raise exception 'malformed key';
  end if;
  if exists (select 1 from pg_catalog.unnest(p_keys) x
             group by x having count(*) > 1) then
    raise exception 'duplicate Standard key';
  end if;
  foreach u in array p_urls loop
    if u is null then raise exception 'null URL'; end if;
    decoded_u := yp_c4_probe.decode_url_ascii(u);
    matched := false;
    tail := null;
    for base in
      select b.base_url from yp_c4_probe.allowed_r2_url_bases b
      order by pg_catalog.length(b.base_url) desc
    loop
      if pg_catalog.left(u, pg_catalog.length(base) + 1) = base || '/' then
        matched := true;
        tail := pg_catalog.substr(u, pg_catalog.length(base) + 2);
        decoded_tail := pg_catalog.substr(decoded_u, pg_catalog.length(base) + 2);
        exit;
      end if;
    end loop;
    if matched then
      if decoded_tail ~ '[^ -~]' then
        raise exception 'non-ASCII image URL';
      end if;
      if pg_catalog.lower(decoded_tail) ~ '(^|/)variation-listing/' then
        if tail is null or tail = '' or tail ~ '[?#[:space:][:cntrl:]]'
           or tail ~ '//|(^|/)[.]{1,2}(/|$)'
           or pg_catalog.strpos(tail, pg_catalog.chr(92)) > 0
           or decoded_tail ~ '[?#[:space:][:cntrl:]]'
           or decoded_tail ~ '//|(^|/)[.]{1,2}(/|$)'
           or pg_catalog.strpos(decoded_tail, pg_catalog.chr(92)) > 0 then
          raise exception 'noncanonical R2 URL';
        end if;
        if tail <> decoded_tail then
          raise exception 'ambiguous percent-encoded image URL';
        end if;
        if decoded_tail !~ '^variation-listing/[A-Za-z0-9._/-]+$' then
          raise exception 'noncanonical Variation R2 URL';
        end if;
        if not (decoded_tail = any(keys)) then
          keys := pg_catalog.array_append(keys, decoded_tail);
        end if;
      elsif tail = decoded_tail
         and tail !~ '[?#[:space:][:cntrl:]]'
         and tail !~ '//|(^|/)[.]{1,2}(/|$)'
         and pg_catalog.strpos(tail, pg_catalog.chr(92)) = 0
         and pg_catalog.left(tail, 1) <> '/'
         and pg_catalog.right(tail, 1) <> '/'
         and not (tail = any(keys)) then
        -- A paired Standard public URL + direct key is one canonical ref.
        keys := pg_catalog.array_append(keys, tail);
      end if;
    elsif decoded_u ~ '[^ -~]' then
      raise exception 'non-ASCII image URL';
    elsif pg_catalog.lower(decoded_u) ~ '(^|/)variation-listing/' then
      raise exception 'unrecognized Variation R2 URL origin';
    end if;
  end loop;
  return keys;
end;
$$;
revoke all on function yp_c4_probe.decode_url_ascii(text)
  from public, anon, authenticated, service_role;
revoke all on function yp_c4_probe.standard_keys(text[],text[])
  from public, anon, authenticated, service_role;

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

-- Existing Standard fields are text[] not jsonb. URL bases are fixture-seeded
-- and never derived from runtime configuration; this trigger remains test-only.
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
