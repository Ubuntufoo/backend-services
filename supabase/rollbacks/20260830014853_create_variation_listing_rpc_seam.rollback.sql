-- YP2.7b additive variation-listing RPC transaction seam rollback.
-- Drops only the three functions this migration added. No tables, grants, or
-- data are touched; YP2.4/YP2.5 objects and existing Single/Lot schema remain.

drop function if exists public.capture_variation_listing_revision(uuid, uuid, bigint, integer, text, jsonb, jsonb);
drop function if exists public.append_variation_listing_journal_checkpoint(uuid, uuid, integer, integer, text, integer, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, text, text, jsonb);
drop function if exists public.confirm_variation_listing_revision(uuid, bigint, bigint);

-- Restore the YP2.5 service-role projection grant when this additive seam is
-- reverted. No rows or tables are modified by the rollback.
grant insert on table public.variation_listing_revisions,
  public.variation_listing_operations,
  public.variation_listing_operation_attempts to service_role;
grant update on table public.variation_listing_operations to service_role;
