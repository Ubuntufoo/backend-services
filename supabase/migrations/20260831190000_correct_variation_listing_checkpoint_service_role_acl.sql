-- YP2.9b hosted ACL correction: checkpoint table is service-role SELECT-only.
begin;

revoke all privileges on table public.variation_listing_publishing_checkpoints from service_role;
grant select on table public.variation_listing_publishing_checkpoints to service_role;

commit;
