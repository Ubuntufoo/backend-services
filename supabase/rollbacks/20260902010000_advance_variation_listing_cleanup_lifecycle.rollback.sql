-- Manual rollback for YP5.4 cleanup lifecycle RPC.
begin;

drop function if exists public.abandon_untouched_variation_listing_group(uuid,bigint);
drop function if exists public.advance_variation_listing_cleanup_lifecycle(uuid,uuid,bigint,bigint,text);

commit;
