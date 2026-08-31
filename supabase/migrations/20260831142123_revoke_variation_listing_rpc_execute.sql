-- YP2.7c additive hosted ACL remediation.
-- Remove explicit browser-role execution from the three reviewed RPCs while
-- preserving service_role execution and all existing table privileges.

revoke execute on function public.capture_variation_listing_revision(uuid, uuid, bigint, integer, text, jsonb, jsonb)
  from anon, authenticated;
revoke execute on function public.append_variation_listing_journal_checkpoint(uuid, uuid, integer, integer, text, integer, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, text, text, jsonb)
  from anon, authenticated;
revoke execute on function public.confirm_variation_listing_revision(uuid, bigint, bigint)
  from anon, authenticated;
