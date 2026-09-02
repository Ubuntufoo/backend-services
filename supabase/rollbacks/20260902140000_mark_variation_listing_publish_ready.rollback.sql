begin;

drop function if exists public.reserve_variation_listing_action_revision(uuid,bigint);

drop function if exists public.mark_variation_listing_publish_ready(uuid,bigint);

commit;
