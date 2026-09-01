-- YP4.2b narrow approved group review-draft persistence seam.
begin;

create function public.apply_variation_listing_group_review_draft(
  p_group_id uuid,
  p_expected_desired_revision bigint,
  p_title text,
  p_description text,
  p_derived_common_ebay_aspects jsonb
) returns table (group_row jsonb)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_group public.variation_listing_groups;
begin
  if p_expected_desired_revision is null then
    raise exception 'variation listing review draft expected revision is required' using errcode = 'VR002';
  end if;
  if p_title is null or nullif(btrim(p_title), '') is null
     or p_description is null or nullif(btrim(p_description), '') is null then
    raise exception 'variation listing review draft title and description are required' using errcode = 'VR002';
  end if;
  if p_derived_common_ebay_aspects is null
     or jsonb_typeof(p_derived_common_ebay_aspects) is distinct from 'object' then
    raise exception 'variation listing review draft common aspects must be an object' using errcode = 'VR002';
  end if;

  select * into v_group
    from public.variation_listing_groups
   where group_id = p_group_id
   for update;
  if not found then
    raise exception 'variation listing group not found' using errcode = 'VR004';
  end if;
  if v_group.desired_revision <> p_expected_desired_revision then
    raise exception 'variation listing review draft CAS mismatch' using errcode = 'VR001';
  end if;
  if v_group.lifecycle_state not in ('intake', 'draft', 'review') then
    raise exception 'variation listing group lifecycle is not editable' using errcode = 'VR002';
  end if;

  update public.variation_listing_groups
     set title = btrim(p_title),
         description = btrim(p_description),
         derived_common_ebay_aspects = p_derived_common_ebay_aspects,
         lifecycle_state = 'review',
         desired_revision = desired_revision + 1
   where group_id = p_group_id;

  return query
    select to_jsonb(g)
      from public.variation_listing_groups g
     where g.group_id = p_group_id;
end;
$$;

revoke execute on function public.apply_variation_listing_group_review_draft(uuid, bigint, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.apply_variation_listing_group_review_draft(uuid, bigint, text, text, jsonb) to service_role;

commit;
