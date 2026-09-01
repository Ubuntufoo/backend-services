-- YP4.3 narrow pre-publication variation price-edit persistence seam.
begin;

create function public.update_variation_listing_manual_price(
  p_group_id uuid,
  p_variation_id uuid,
  p_expected_desired_revision bigint,
  p_price_amount numeric
) returns table (group_row jsonb, variation_row jsonb)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_group public.variation_listing_groups;
  v_variation public.variation_listing_variations;
begin
  if p_expected_desired_revision is null or p_expected_desired_revision < 0 then
    raise exception 'variation listing price edit expected revision is invalid' using errcode = 'VR002';
  end if;
  if p_price_amount is null or p_price_amount not in (0.99, 1.49, 1.99, 2.49) then
    raise exception 'variation listing price edit amount is invalid' using errcode = 'VR002';
  end if;

  select * into v_group
    from public.variation_listing_groups
   where group_id = p_group_id
   for update;
  if not found then
    raise exception 'variation listing group not found' using errcode = 'VR004';
  end if;
  if v_group.desired_revision <> p_expected_desired_revision then
    raise exception 'variation listing price edit CAS mismatch' using errcode = 'VR001';
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
  if v_variation.price_amount = p_price_amount then
    raise exception 'variation listing price edit must change the price' using errcode = 'VR002';
  end if;

  update public.variation_listing_variations
     set price_amount = p_price_amount
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

revoke execute on function public.update_variation_listing_manual_price(uuid, uuid, bigint, numeric) from public, anon, authenticated;
grant execute on function public.update_variation_listing_manual_price(uuid, uuid, bigint, numeric) to service_role;

commit;
