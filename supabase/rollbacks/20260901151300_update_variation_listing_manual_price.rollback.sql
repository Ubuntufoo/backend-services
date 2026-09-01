-- Manual rollback for the YP4.3 pre-publication variation price-edit RPC.
begin;

revoke execute on function public.update_variation_listing_manual_price(uuid, uuid, bigint, numeric) from public, anon, authenticated, service_role;
drop function if exists public.update_variation_listing_manual_price(uuid, uuid, bigint, numeric);

commit;
