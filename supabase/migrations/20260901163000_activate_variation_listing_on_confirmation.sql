-- YP5.3 Slice B prerequisite: whole-revision confirmation activates the published group.
begin;

create or replace function public.confirm_variation_listing_revision(
  p_group_id uuid,
  p_expected_previous_confirmed_revision bigint,
  p_confirmed_revision bigint
) returns table(group_row jsonb)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  g public.variation_listing_groups;
  r public.variation_listing_revisions;
  op jsonb;
  k text;
  latest record;
begin
  select * into g
    from public.variation_listing_groups
   where group_id = p_group_id
   for update;

  if not found or g.last_confirmed_revision is distinct from p_expected_previous_confirmed_revision then
    raise exception 'variation listing confirmation CAS mismatch' using errcode = 'VR001';
  end if;
  if g.lifecycle_state not in ('publish-ready','active') then
    raise exception 'variation listing confirmation requires publish-ready or active lifecycle' using errcode = 'VR002';
  end if;
  if p_confirmed_revision is null
     or p_confirmed_revision < 1
     or p_confirmed_revision > g.desired_revision
     or p_confirmed_revision < coalesce(g.last_confirmed_revision,0) then
    raise exception 'variation listing confirmation revision is outside allowed range' using errcode = 'VR001';
  end if;

  select * into r
    from public.variation_listing_revisions
   where group_id = p_group_id
     and captured_desired_revision = p_confirmed_revision;
  if not found then
    raise exception 'variation listing revision not found' using errcode = 'VR004';
  end if;
  if (select count(*) from jsonb_array_elements(r.operation_plan)) <>
     (select count(distinct x->>'operation_key') from jsonb_array_elements(r.operation_plan) x) then
    raise exception 'revision operation keys must be unique' using errcode = 'VR004';
  end if;

  for op in select * from jsonb_array_elements(r.operation_plan) loop
    k := op->>'operation_key';
    select * into latest
      from public.variation_listing_publishing_checkpoints
     where revision_id = r.revision_id
       and operation_key = k
     order by attempt_number desc, checkpoint_number desc
     limit 1;

    if latest.state not in ('confirmed_complete','confirmed_no_op')
       or latest.observed_remote_state is null
       or latest.observed_remote_state not in ('present','proven_absent')
       or latest.evidence = '{}'::jsonb then
      raise exception 'revision operation unresolved' using errcode = 'VR004';
    end if;
    if latest.state = 'confirmed_no_op' and exists (
      select 1
        from public.variation_listing_publishing_checkpoints h
       where h.revision_id = r.revision_id
         and h.operation_key = k
         and (h.state = 'unknown' or h.observed_remote_state = 'unknown')
    ) then
      raise exception 'revision operation reconciled to no-effect after unknown and requires a new revision' using errcode = 'VR004';
    end if;
  end loop;

  update public.variation_listing_groups
     set last_confirmed_revision = p_confirmed_revision,
         lifecycle_state = case
           when lifecycle_state = 'publish-ready' then 'active'
           else lifecycle_state
         end
   where group_id = p_group_id;

  return query
  select to_jsonb(x)
    from public.variation_listing_groups x
   where x.group_id = p_group_id;
end;
$$;

revoke execute on function public.confirm_variation_listing_revision(uuid,bigint,bigint)
  from public, anon, authenticated;
grant execute on function public.confirm_variation_listing_revision(uuid,bigint,bigint)
  to service_role;

commit;
