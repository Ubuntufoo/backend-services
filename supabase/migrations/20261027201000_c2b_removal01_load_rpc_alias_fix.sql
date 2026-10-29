begin;

-- Forward-only repair of the Gate B incident read seam.  The original
-- function used `x` both for its PL/pgSQL row variable and its table alias,
-- which makes `x.repair_id` ambiguous at execution time.  Keep the public
-- contract, definer/search_path, and null-row semantics unchanged.
create or replace function public.load_c2b_removal01_incident_repair(p_repair_id uuid)
returns table(repair jsonb)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  incident_row public.variation_listing_c2b_removal01_incident_repairs;
begin
  select ir.*
    into incident_row
    from public.variation_listing_c2b_removal01_incident_repairs as ir
   where ir.repair_id = p_repair_id;
  if found then
    return query select to_jsonb(incident_row);
  else
    return query select null::jsonb;
  end if;
end;
$$;

-- Reassert the incident read RPC's service-role-only boundary.  No private
-- helper ACLs are touched by this forward migration.
revoke all on function public.load_c2b_removal01_incident_repair(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.load_c2b_removal01_incident_repair(uuid)
  to service_role;

commit;
