-- YP6.2: narrow CAS review -> publish-ready transition.
-- This migration remains local/unapplied to hosted Supabase until separately authorized.
begin;

create function public.mark_variation_listing_publish_ready(
  p_group_id uuid,
  p_expected_desired_revision bigint
) returns table(group_row jsonb)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  g public.variation_listing_groups;
  variation_count integer;
begin
  if p_expected_desired_revision is null or p_expected_desired_revision < 1 then
    raise exception 'variation listing publish-ready expected revision must be positive' using errcode = 'VR002';
  end if;

  select * into g
    from public.variation_listing_groups
   where group_id = p_group_id
   for update;
  if not found then
    raise exception 'variation listing group not found' using errcode = 'VR004';
  end if;
  if g.desired_revision is distinct from p_expected_desired_revision then
    raise exception 'variation listing publish-ready CAS mismatch' using errcode = 'VR001';
  end if;
  if g.last_confirmed_revision is not null then
    raise exception 'published variation listing cannot enter initial publish-ready state' using errcode = 'VR003';
  end if;
  if g.lifecycle_state = 'publish-ready' then
    return query select to_jsonb(x) from public.variation_listing_groups x where x.group_id = p_group_id;
    return;
  end if;
  if g.lifecycle_state <> 'review' then
    raise exception 'variation listing must be in review before publish-ready' using errcode = 'VR003';
  end if;
  if nullif(btrim(g.title), '') is null or nullif(btrim(g.description), '') is null then
    raise exception 'variation listing publish-ready requires title and description' using errcode = 'VR003';
  end if;
  if length(g.title) > 80 or length(g.description) > 4000
     or (g.condition_description is not null and length(g.condition_description) > 1000) then
    raise exception 'variation listing publish-ready content length mismatch' using errcode = 'VR003';
  end if;
  if g.category_id <> '261328'
     or g.marketplace_id <> 'EBAY_US'
     or g.listing_format <> 'FIXED_PRICE'
     or g.selector_name <> 'Card'
     or g.condition_id <> '4000' then
    raise exception 'variation listing publish-ready group contract mismatch' using errcode = 'VR003';
  end if;
  if jsonb_typeof(g.derived_common_ebay_aspects) <> 'object'
     or g.derived_common_ebay_aspects ? 'Card'
     or not (g.derived_common_ebay_aspects ? 'Sport')
     or exists (
       select 1
         from jsonb_each(g.derived_common_ebay_aspects) aspect(name, value)
        where aspect.name <> btrim(aspect.name)
           or nullif(aspect.name, '') is null
           or (case jsonb_typeof(aspect.value)
                 when 'string' then
                   (aspect.value #>> '{}') <> btrim(aspect.value #>> '{}')
                   or nullif(aspect.value #>> '{}', '') is null
                 when 'array' then
                   jsonb_array_length(aspect.value) = 0
                   or exists (
                     select 1
                       from jsonb_array_elements(aspect.value) item(value)
                      where jsonb_typeof(item.value) <> 'string'
                         or (item.value #>> '{}') <> btrim(item.value #>> '{}')
                         or nullif(item.value #>> '{}', '') is null
                   )
                   or (select count(*) from jsonb_array_elements(aspect.value))
                      <> (select count(distinct item.value #>> '{}') from jsonb_array_elements(aspect.value) item(value))
                 else true
               end)
     ) then
    raise exception 'variation listing publish-ready requires non-empty common Sport aspect' using errcode = 'VR003';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(g.condition_descriptors) descriptor(value)
     where jsonb_typeof(descriptor.value) <> 'object'
        or not (descriptor.value ? 'name' and descriptor.value ? 'values')
        or exists (
          select 1 from jsonb_object_keys(descriptor.value) descriptor_key
           where descriptor_key not in ('name','values','additionalInfo')
        )
        or jsonb_typeof(descriptor.value->'name') <> 'string'
        or (descriptor.value->>'name') !~ '^[0-9]+$'
        or (descriptor.value ? 'additionalInfo' and (
          jsonb_typeof(descriptor.value->'additionalInfo') <> 'string'
          or (descriptor.value->>'additionalInfo') <> btrim(descriptor.value->>'additionalInfo')
          or nullif(descriptor.value->>'additionalInfo', '') is null
          or length(descriptor.value->>'additionalInfo') > 30
        ))
        or (case jsonb_typeof(descriptor.value->'values')
              when 'array' then
                jsonb_array_length(descriptor.value->'values') = 0
                or exists (
                  select 1
                    from jsonb_array_elements(descriptor.value->'values') item(value)
                   where jsonb_typeof(item.value) <> 'string'
                      or (item.value #>> '{}') !~ '^[0-9]+$'
                )
                or (select count(*) from jsonb_array_elements(descriptor.value->'values'))
                   <> (select count(distinct item.value #>> '{}') from jsonb_array_elements(descriptor.value->'values') item(value))
              else true
            end)
        or (select count(*) from jsonb_array_elements(g.condition_descriptors))
           <> (select count(distinct descriptor.value->>'name') from jsonb_array_elements(g.condition_descriptors) descriptor(value))
  ) then
    raise exception 'variation listing publish-ready condition descriptor mismatch' using errcode = 'VR003';
  end if;

  select count(*)::integer into variation_count
    from public.variation_listing_variations v
   where v.group_id = p_group_id;
  if variation_count < 2 then
    raise exception 'variation listing publish-ready requires at least two variations' using errcode = 'VR003';
  end if;

  if exists (
    select 1
      from (
        select v.position, row_number() over (order by v.position) - 1 as expected_position
          from public.variation_listing_variations v
         where v.group_id = p_group_id
      ) ordered
     where ordered.position <> ordered.expected_position
  ) then
    raise exception 'variation listing publish-ready requires contiguous variation positions' using errcode = 'VR003';
  end if;

  if exists (
    select 1
      from public.variation_listing_variations v
     where v.group_id = p_group_id
       and (
         v.representative_copy_id is null
         or not exists (
           select 1 from public.variation_listing_copies c
            where c.copy_id = v.representative_copy_id
              and c.variation_id = v.variation_id
         )
         or not exists (
           select 1 from public.variation_listing_copies c
            where c.variation_id = v.variation_id
              and c.availability_state = 'available'
         )
       )
  ) then
    raise exception 'variation listing publish-ready requires representative ownership and positive available quantity' using errcode = 'VR003';
  end if;

  if exists (
    select 1
      from public.variation_listing_variations v
      join public.variation_listing_copies c on c.variation_id = v.variation_id
     where v.group_id = p_group_id
       and c.availability_state = 'available'
       and (case c.condition_token
              when 'POOR' then 0
              when 'VERY_GOOD' then 1
              when 'EXCELLENT' then 2
              when 'NEAR_MINT_OR_BETTER' then 3
            end)
           < (case g.condition_token
                when 'POOR' then 0
                when 'VERY_GOOD' then 1
                when 'EXCELLENT' then 2
                when 'NEAR_MINT_OR_BETTER' then 3
              end)
  ) then
    raise exception 'variation listing publish-ready available copy condition mismatch' using errcode = 'VR003';
  end if;

  update public.variation_listing_groups
     set lifecycle_state = 'publish-ready'
   where group_id = p_group_id;

  return query select to_jsonb(x) from public.variation_listing_groups x where x.group_id = p_group_id;
end;
$$;

revoke all on function public.mark_variation_listing_publish_ready(uuid,bigint)
  from public, anon, authenticated;
grant execute on function public.mark_variation_listing_publish_ready(uuid,bigint)
  to service_role;

create function public.reserve_variation_listing_action_revision(
  p_group_id uuid,
  p_expected_desired_revision bigint
) returns table(group_row jsonb)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  g public.variation_listing_groups;
begin
  if p_expected_desired_revision is null or p_expected_desired_revision < 0 then
    raise exception 'variation listing action revision expected revision must be non-negative' using errcode = 'VR002';
  end if;

  select * into g
    from public.variation_listing_groups
   where group_id = p_group_id
   for update;
  if not found then
    raise exception 'variation listing group not found' using errcode = 'VR004';
  end if;
  if g.desired_revision is distinct from p_expected_desired_revision then
    raise exception 'variation listing action revision CAS mismatch' using errcode = 'VR001';
  end if;
  if not exists (
    select 1
      from public.variation_listing_revisions r
     where r.group_id = p_group_id
       and r.captured_desired_revision = p_expected_desired_revision
  ) then
    raise exception 'variation listing action revision requires an occupied durable revision' using errcode = 'VR003';
  end if;
  if not (
    (g.lifecycle_state = 'active'
      and g.last_confirmed_revision is not null
      and g.desired_revision is not distinct from g.last_confirmed_revision)
    or
    (g.lifecycle_state = 'publish-ready'
      and g.last_confirmed_revision is null)
  ) then
    raise exception 'variation listing action revision requires an exact clean remote-action revision' using errcode = 'VR003';
  end if;

  update public.variation_listing_groups
     set desired_revision = desired_revision + 1
   where group_id = p_group_id;

  return query select to_jsonb(x) from public.variation_listing_groups x where x.group_id = p_group_id;
end;
$$;

revoke all on function public.reserve_variation_listing_action_revision(uuid,bigint)
  from public, anon, authenticated;
grant execute on function public.reserve_variation_listing_action_revision(uuid,bigint)
  to service_role;

commit;
