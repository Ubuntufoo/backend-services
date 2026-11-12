-- EXEC4a: additive, non-authorizing exact-key writer barrier.
--
-- This migration deliberately has no callable registry-population path. A
-- separately reviewed deployment step may seed trusted origins and frozen
-- keys; application roles cannot inspect or mutate either protected table.

create schema removed_sku_writer_barrier;

create table removed_sku_writer_barrier.frozen_r2_keys (
  key text primary key,
  revision_id uuid not null,
  deletion_authorized boolean not null default false,
  constraint frozen_r2_keys_key_ck check (
    key <> '' and key = btrim(key) and key !~ '[[:space:][:cntrl:]]'
      and key !~ '(^|/)[.]{1,2}(/|$)' and key !~ '//' and key !~ '%'
      and key !~ '^/' and key !~ '/$' and strpos(key, chr(92)) = 0
  ),
  constraint frozen_r2_keys_no_authority_ck check (deletion_authorized is false)
);
alter table removed_sku_writer_barrier.frozen_r2_keys enable row level security;

-- Empty by design. No application role receives a population or read path.
create table removed_sku_writer_barrier.trusted_r2_url_bases (
  base_url text primary key,
  constraint trusted_r2_url_base_ck check (
    base_url ~ '^https://[a-z0-9.-]+(/[A-Za-z0-9_-]+)*$'
      and base_url !~ '[[:space:][:cntrl:]]'
  )
);
alter table removed_sku_writer_barrier.trusted_r2_url_bases enable row level security;

create function removed_sku_writer_barrier.decode_ascii(p_value text)
returns text language plpgsql
set search_path = pg_catalog, removed_sku_writer_barrier, pg_temp
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
    if strpos(value, '%') = 0 then
      if value ~ '[^ -~]' then
        raise exception 'non-ASCII image URL';
      end if;
      return value;
    end if;
    decoded := '';
    i := 1;
    while i <= length(value) loop
      ch := substr(value, i, 1);
      if ch = '%' then
        if i + 2 > length(value) or substr(value, i + 1, 2) !~ '^[0-9A-Fa-f]{2}$' then
          raise exception 'malformed percent-encoded image URL';
        end if;
        hex := substr(value, i + 1, 2);
        byte := get_byte(decode(hex, 'hex'), 0);
        if byte < 32 or byte > 126 then
          raise exception 'non-ASCII percent-encoded image URL';
        end if;
        decoded := decoded || chr(byte);
        i := i + 3;
      else
        decoded := decoded || ch;
        i := i + 1;
      end if;
    end loop;
    if decoded = value then
      exit;
    end if;
    value := decoded;
  end loop;
  if value ~ '%' then
    raise exception 'percent-encoded image URL exceeds decode budget';
  end if;
  if value ~ '[^ -~]' then
    raise exception 'non-ASCII image URL';
  end if;
  return value;
end;
$$;

create function removed_sku_writer_barrier.lock_keys(p_keys text[])
returns void language plpgsql
set search_path = pg_catalog, removed_sku_writer_barrier, pg_temp
as $$
declare
  k text;
begin
  if p_keys is null or cardinality(p_keys) = 0 then
    raise exception 'missing image keys';
  end if;
  for k in select distinct x from unnest(p_keys) x order by x loop
    if k is null or k = '' or k <> btrim(k) or k ~ '[[:space:][:cntrl:]]'
       or k ~ '(^|/)[.]{1,2}(/|$)' or k ~ '//' or k ~ '%' or k ~ '^/' or k ~ '/$'
       or strpos(k, chr(92)) > 0 then
      raise exception 'malformed image key';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('YP9.6c4:' || k, 0));
  end loop;
end;
$$;

create function removed_sku_writer_barrier.standard_keys(p_keys text[], p_urls text[])
returns text[] language plpgsql
set search_path = pg_catalog, removed_sku_writer_barrier, pg_temp
as $$
declare
  u text;
  base text;
  tail text;
  decoded_u text;
  decoded_tail text;
  keys text[] := coalesce(p_keys, '{}'::text[]);
  matched boolean;
begin
  if p_keys is null or p_urls is null then
    raise exception 'missing references';
  end if;
  if exists (select 1 from unnest(p_keys) x where x is null or x = '' or x <> btrim(x))
     or exists (select 1 from unnest(p_keys) x group by x having count(*) > 1) then
    raise exception 'malformed or duplicate Standard key';
  end if;
  foreach u in array p_urls loop
    if u is null then
      raise exception 'null image URL';
    end if;
    decoded_u := removed_sku_writer_barrier.decode_ascii(u);
    matched := false;
    tail := null;
    for base in
      select b.base_url from removed_sku_writer_barrier.trusted_r2_url_bases b
      order by length(b.base_url) desc
    loop
      if left(u, length(base) + 1) = base || '/' then
        matched := true;
        tail := substr(u, length(base) + 2);
        decoded_tail := substr(decoded_u, length(base) + 2);
        exit;
      end if;
    end loop;
    if matched and lower(decoded_tail) ~ '(^|/)variation-listing/' then
      if tail is null or tail = '' or tail <> decoded_tail or tail ~ '[?#[:space:][:cntrl:]]'
         or tail ~ '//|(^|/)[.]{1,2}(/|$)' or strpos(tail, chr(92)) > 0
         or decoded_tail !~ '^variation-listing/[A-Za-z0-9._/-]+$' then
        raise exception 'noncanonical Variation R2 URL';
      end if;
      if not (decoded_tail = any(keys)) then
        keys := array_append(keys, decoded_tail);
      end if;
    elsif matched and tail = decoded_tail and tail !~ '[?#[:space:][:cntrl:]]'
      and tail !~ '//|(^|/)[.]{1,2}(/|$)' and strpos(tail, chr(92)) = 0
      and left(tail, 1) <> '/' and right(tail, 1) <> '/' and not (tail = any(keys)) then
      keys := array_append(keys, tail);
    elsif not matched and lower(decoded_u) ~ '(^|/)variation-listing/' then
      raise exception 'unrecognized Variation R2 URL origin';
    end if;
  end loop;
  return keys;
end;
$$;

create function removed_sku_writer_barrier.reject_frozen(p_keys text[])
returns void language plpgsql
set search_path = pg_catalog, removed_sku_writer_barrier, pg_temp
as $$
begin
  if p_keys is null or cardinality(p_keys) = 0 then
    return;
  end if;
  perform removed_sku_writer_barrier.lock_keys(p_keys);
  if exists (
    select 1 from removed_sku_writer_barrier.frozen_r2_keys where key = any(p_keys)
  ) then
    raise exception 'retired R2 key frozen';
  end if;
end;
$$;

create function removed_sku_writer_barrier.guard_standard()
returns trigger language plpgsql security definer
set search_path = pg_catalog, removed_sku_writer_barrier, pg_temp
as $$
declare
  keys text[];
begin
  if tg_op = 'UPDATE' then
    keys := removed_sku_writer_barrier.standard_keys(old.r2_object_keys, old.image_urls)
      || removed_sku_writer_barrier.standard_keys(new.r2_object_keys, new.image_urls);
  else
    keys := removed_sku_writer_barrier.standard_keys(new.r2_object_keys, new.image_urls);
  end if;
  perform removed_sku_writer_barrier.reject_frozen(keys);
  return new;
end;
$$;
create trigger zz_removed_sku_standard_writer_barrier
before insert or update of image_urls, r2_object_keys on public.listings
for each row execute function removed_sku_writer_barrier.guard_standard();

create function removed_sku_writer_barrier.guard_variation()
returns trigger language plpgsql security definer
set search_path = pg_catalog, removed_sku_writer_barrier, pg_temp
as $$
begin
  if tg_op = 'UPDATE' then
    perform removed_sku_writer_barrier.reject_frozen(array[
      old.front_r2_key, old.back_r2_key, new.front_r2_key, new.back_r2_key
    ]);
  else
    perform removed_sku_writer_barrier.reject_frozen(array[new.front_r2_key, new.back_r2_key]);
  end if;
  return new;
end;
$$;
create trigger zz_removed_sku_variation_writer_barrier
before insert or update of front_r2_key, back_r2_key on public.variation_listing_copies
for each row execute function removed_sku_writer_barrier.guard_variation();

-- Explicit defense-in-depth: no role can inspect, seed, alter, or execute.
revoke all on schema removed_sku_writer_barrier from public, anon, authenticated, service_role;
revoke all on table removed_sku_writer_barrier.frozen_r2_keys,
  removed_sku_writer_barrier.trusted_r2_url_bases from public, anon, authenticated, service_role;
revoke all on all functions in schema removed_sku_writer_barrier
  from public, anon, authenticated, service_role;
