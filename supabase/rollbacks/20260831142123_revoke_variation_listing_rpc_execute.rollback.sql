-- YP2.7c ACL remediation rollback for disposable/pre-apply recovery only.
-- Restore only the explicit browser-role grants removed by the forward file.

grant execute on function public.capture_variation_listing_revision(uuid, uuid, bigint, integer, text, jsonb, jsonb)
  to anon, authenticated;
grant execute on function public.append_variation_listing_journal_checkpoint(uuid, uuid, integer, integer, text, integer, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, text, text, jsonb)
  to anon, authenticated;
grant execute on function public.confirm_variation_listing_revision(uuid, bigint, bigint)
  to anon, authenticated;
