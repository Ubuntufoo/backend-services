-- Narrow pre-publication buyer-facing variation selector/title edit seam.
begin;

-- The original persistence trigger treated selector_value as immutable. Keep
-- variation/group/SKU identity guards, but allow this dedicated pre-publication
-- RPC to change only selector_value.
create or replace function public.prevent_variation_listing_variation_identity_update()
returns trigger language plpgsql as $$
begin
  if new.variation_id is distinct from old.variation_id or new.group_id is distinct from old.group_id
     or new.inventory_serial is distinct from old.inventory_serial or new.sku is distinct from old.sku
     or new.created_at is distinct from old.created_at then
    raise exception 'variation listing variation identity is immutable';
  end if;
  return new;
end;
$$;

create function public.update_variation_listing_selector_value(
  p_group_id uuid,
  p_variation_id uuid,
  p_expected_desired_revision bigint,
  p_selector_value text
) returns table (group_row jsonb, variation_row jsonb)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_group public.variation_listing_groups;
  v_variation public.variation_listing_variations;
  v_selector_value text;
begin
  if p_expected_desired_revision is null or p_expected_desired_revision < 0 then
    raise exception 'variation listing selector edit expected revision is invalid' using errcode = 'VR002';
  end if;

  -- Match JavaScript String.prototype.trim (including Unicode space/BOM).
  v_selector_value := btrim(p_selector_value, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
  if v_selector_value is null or v_selector_value = '' or v_selector_value <> p_selector_value then
    raise exception 'variation listing selector value must be a non-empty outer-trimmed string' using errcode = 'VR002';
  end if;

  select * into v_group
    from public.variation_listing_groups
   where group_id = p_group_id
   for update;
  if not found then
    raise exception 'variation listing group not found' using errcode = 'VR004';
  end if;
  if v_group.desired_revision <> p_expected_desired_revision then
    raise exception 'variation listing selector edit CAS mismatch' using errcode = 'VR001';
  end if;
  if v_group.lifecycle_state not in ('intake', 'draft', 'review') then
    raise exception 'variation listing group lifecycle is not editable' using errcode = 'VR002';
  end if;

  select * into v_variation
    from public.variation_listing_variations
   where variation_id = p_variation_id
     and group_id = p_group_id;
  if not found then
    raise exception 'variation listing variation not found in group' using errcode = 'VR004';
  end if;
  if v_variation.selector_value = v_selector_value then
    raise exception 'variation listing selector edit must change the value' using errcode = 'VR002';
  end if;
  if exists (
    select 1
      from public.variation_listing_variations
     where group_id = p_group_id
       and variation_id <> p_variation_id
       and selector_value = v_selector_value
  ) then
    raise exception 'variation listing selector value must be unique within the group' using errcode = 'VR002';
  end if;

  update public.variation_listing_variations
     set selector_value = v_selector_value
   where variation_id = p_variation_id
     and group_id = p_group_id;

  update public.variation_listing_groups
     set desired_revision = desired_revision + 1
   where group_id = p_group_id;

  return query
    select to_jsonb(g), to_jsonb(v)
      from public.variation_listing_groups g
      join public.variation_listing_variations v on v.group_id = g.group_id
     where g.group_id = p_group_id
       and v.variation_id = p_variation_id;
end;
$$;

revoke execute on function public.update_variation_listing_selector_value(uuid, uuid, bigint, text) from public, anon, authenticated;
grant execute on function public.update_variation_listing_selector_value(uuid, uuid, bigint, text) to service_role;

commit;
