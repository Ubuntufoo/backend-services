-- YP9.6c4 disposable-only key-freeze concurrency prototype (NOT a migration).
-- Synthetic references / proof records only; never use against production.
create schema yp_c4_probe;

create table yp_c4_probe.proofs (
 revision_id uuid primary key, group_id uuid not null, variation_id uuid not null,
 sku text not null, keys text[] not null,
 terminal_verified boolean not null default false,
 ownership_complete boolean not null default false,
 remote_verified boolean not null default false
);
create table yp_c4_probe.frozen (
 key text primary key, revision_id uuid not null,
 deletion_authorized boolean not null default false check (deletion_authorized is false)
);
create table yp_c4_probe.variation_refs (
 copy_id uuid primary key, front_key text not null, back_key text not null
);
create table yp_c4_probe.standard_refs (
 listing_id uuid primary key, keys text[] not null, urls text[] not null
);
alter table yp_c4_probe.proofs enable row level security;
alter table yp_c4_probe.frozen enable row level security;

-- Cooperative sorted transaction locks. Same lock domain for every writer
-- and freeze; collisions only serialize additional unrelated keys.
create function yp_c4_probe.lock_keys(p_keys text[]) returns void
language plpgsql set search_path = pg_catalog, yp_c4_probe as $$
declare k text;
begin
 if p_keys is null or cardinality(p_keys) = 0 then
   raise exception 'missing keys';
 end if;
 for k in select distinct x from unnest(p_keys) x order by x loop
   if k is null or k = '' or k <> btrim(k)
      or k ~ '[[:space:]]' or k ~ '[[:cntrl:]]'
      or strpos(k, '%') > 0 or strpos(k, pg_catalog.chr(92)) > 0
      or strpos(k, '//') > 0 or k ~ '(^|/)[.]{1,2}(/|$)'
      or left(k, 1) = '/' or right(k, 1) = '/' then
     raise exception 'malformed key';
   end if;
   perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('YP9.6c4:' || k, 0));
 end loop;
end;
$$;

-- URL handling is test-only, strictly canonical, and blocks ambiguous
-- Variation URLs. This grammar is not ready for real Standard image URLs.
create function yp_c4_probe.standard_keys(p_keys text[], p_urls text[])
returns text[] language plpgsql set search_path = pg_catalog, yp_c4_probe as $$
declare u text; keys text[] := coalesce(p_keys, array[]::text[]);
begin
 if p_keys is null or p_urls is null then raise exception 'missing references'; end if;
 foreach u in array p_urls loop
   if u is null then raise exception 'null URL'; end if;
   -- Synthetic images.invalid URLs are either canonical Variation URLs or
   -- ordinary unrelated Standard URLs. Reject encoded/ambiguous spellings
   -- before the literal `variation` gate so first-character aliases fail closed.
   if lower(u) ~ '^https://images[.]invalid/' and (
      strpos(u, '%') > 0 or strpos(u, pg_catalog.chr(92)) > 0
      or u ~ '[[:space:]]' or u ~ '[[:cntrl:]]'
      or substring(u from 9) ~ '//'
      or u ~ '(^|/)[.]{1,2}(/|$)'
   ) then
     raise exception 'noncanonical Variation URL';
   end if;
   if strpos(lower(u), 'variation') > 0 then
     if u !~ '^https://images[.]invalid/variation-listing/[a-z0-9][a-z0-9/_.-]*[a-z0-9]$'
        then
       raise exception 'noncanonical Variation URL';
     end if;
     keys := array_append(keys, substring(u from '(variation-listing/.+)$'));
   end if;
 end loop;
 if exists (
   select 1 from unnest(keys) x group by x having count(*) > 1
 ) then
   raise exception 'duplicate Standard key';
 end if;
 return keys;
end;
$$;

create function yp_c4_probe.reject_frozen(p_keys text[]) returns void
language plpgsql set search_path = pg_catalog, yp_c4_probe as $$
begin
 perform yp_c4_probe.lock_keys(p_keys);
 if exists (select 1 from yp_c4_probe.frozen where key = any(p_keys)) then
   raise exception 'retired R2 key frozen';
 end if;
end;
$$;

create function yp_c4_probe.guard_variation() returns trigger
language plpgsql security definer set search_path = pg_catalog, yp_c4_probe as $$
begin
 if new.front_key is not distinct from new.back_key then
   raise exception 'duplicate Variation key';
 end if;
 if tg_op = 'UPDATE' then
   perform yp_c4_probe.reject_frozen(array[old.front_key, old.back_key, new.front_key, new.back_key]);
 else
   perform yp_c4_probe.reject_frozen(array[new.front_key, new.back_key]);
 end if;
 return new;
end;
$$;

create function yp_c4_probe.guard_standard() returns trigger
language plpgsql security definer set search_path = pg_catalog, yp_c4_probe as $$
declare keys text[];
begin
 if tg_op = 'UPDATE' then
   -- Validate each stored row's canonical direct+URL identity once, then
   -- combine old/new references only for locking the full UPDATE footprint.
   keys := yp_c4_probe.standard_keys(old.keys, old.urls)
     || yp_c4_probe.standard_keys(new.keys, new.urls);
 else
   keys := yp_c4_probe.standard_keys(new.keys, new.urls);
 end if;
 if cardinality(keys) > 0 then perform yp_c4_probe.reject_frozen(keys); end if;
 return new;
end;
$$;

create trigger c4_variation_guard before insert or update on yp_c4_probe.variation_refs
for each row execute function yp_c4_probe.guard_variation();
create trigger c4_standard_guard before insert or update on yp_c4_probe.standard_refs
for each row execute function yp_c4_probe.guard_standard();

-- This models reference serialization only. The proof row is seeded by
-- a disposable fixture administrator, NOT sourced from authentic c2/c2b.
-- Replaces no executable production authorization.
create function yp_c4_probe.freeze(
 p_revision uuid, p_group uuid, p_variation uuid, p_sku text
) returns integer
language plpgsql security definer set search_path = pg_catalog, yp_c4_probe as $$
declare proof yp_c4_probe.proofs%rowtype; k text;
begin
 select * into proof from yp_c4_probe.proofs where revision_id = p_revision;
 if not found or proof.group_id is distinct from p_group
   or proof.variation_id is distinct from p_variation
   or proof.sku is distinct from p_sku
   or proof.terminal_verified is distinct from true
   or proof.ownership_complete is distinct from true
   or proof.remote_verified is distinct from true
  or array_ndims(proof.keys) <> 1
  or cardinality(proof.keys) <> 2
  or proof.keys[1] is null or proof.keys[2] is null
  or proof.keys[1] = proof.keys[2] then
   raise exception 'untrusted or incomplete retirement proof';
 end if;
 perform yp_c4_probe.lock_keys(proof.keys);
 -- Fresh READ COMMITTED SELECT after all key locks; no Standard row locks.
 if exists (
   select 1 from yp_c4_probe.variation_refs v
   where v.front_key = any(proof.keys) or v.back_key = any(proof.keys)
 ) or exists (
   select 1 from yp_c4_probe.standard_refs s
   where yp_c4_probe.standard_keys(s.keys, s.urls) && proof.keys
 ) then
   raise exception 'live owner prevents freeze';
 end if;
 for k in select distinct x from unnest(proof.keys) x order by x loop
   insert into yp_c4_probe.frozen(key, revision_id) values (k, p_revision)
   on conflict (key) do nothing;
   if exists (select 1 from yp_c4_probe.frozen where key = k and revision_id <> p_revision) then
     raise exception 'key already belongs to another retirement';
   end if;
 end loop;
 return 2;
end;
$$;

-- Protect synthetic proof/freeze from service_role mutations even in tests.
revoke all on schema yp_c4_probe from public;
revoke all on all tables in schema yp_c4_probe from public, anon, authenticated, service_role;
revoke all on all functions in schema yp_c4_probe from public, anon, authenticated, service_role;
grant usage on schema yp_c4_probe to service_role;
grant select, insert, update on yp_c4_probe.variation_refs, yp_c4_probe.standard_refs to service_role;
grant execute on function yp_c4_probe.freeze(uuid,uuid,uuid,text) to service_role;
