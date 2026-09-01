-- Manual rollback for the YP4.2b review-draft persistence RPC.
begin;

revoke execute on function public.apply_variation_listing_group_review_draft(uuid, bigint, text, text, jsonb) from public, anon, authenticated, service_role;
drop function if exists public.apply_variation_listing_group_review_draft(uuid, bigint, text, text, jsonb);

commit;
