-- Manual rollback for the YP2.9b checkpoint service_role ACL correction.
-- This artifact is outside automatic migration discovery and restores only the
-- pre-correction broad service_role table ACL (not schema or data).
begin;

revoke all privileges on table public.variation_listing_publishing_checkpoints from service_role;
grant all privileges on table public.variation_listing_publishing_checkpoints to service_role;

commit;
