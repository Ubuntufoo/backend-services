-- YP2.9a manual, pre-data rollback preparation.
--
-- This artifact deliberately avoids duplicating the historical DDL. After it
-- succeeds, reapply these tracked files in order to restore the exact prior
-- schema, then use the YP2.9a forward migration again if required:
--   20260828150000_create_variation_listing_persistence.sql
--   20260829150000_create_variation_listing_publishing_journal.sql
--   20260830014853_create_variation_listing_rpc_seam.sql
--   20260831142123_revoke_variation_listing_rpc_execute.sql
--
-- Never use after durable variation-listing data exists.

begin;

lock table public.variation_listing_groups,
  public.variation_listing_variations,
  public.variation_listing_copies,
  public.variation_listing_intake_sessions,
  public.variation_listing_revisions,
  public.variation_listing_publishing_checkpoints
  in access exclusive mode;

do $$
begin
  if exists (select 1 from public.variation_listing_groups limit 1)
     or exists (select 1 from public.variation_listing_variations limit 1)
     or exists (select 1 from public.variation_listing_copies limit 1)
     or exists (select 1 from public.variation_listing_intake_sessions limit 1)
     or exists (select 1 from public.variation_listing_revisions limit 1)
     or exists (select 1 from public.variation_listing_publishing_checkpoints limit 1) then
    raise exception 'YP2.9a rollback preparation requires all six variation-listing tables to be empty';
  end if;
end $$;

drop function if exists public.capture_variation_listing_revision(uuid,uuid,bigint,integer,text,jsonb,jsonb);
drop function if exists public.append_variation_listing_journal_checkpoint(uuid,text,uuid,integer,integer,text,text,jsonb);
drop function if exists public.confirm_variation_listing_revision(uuid,bigint,bigint);
drop function if exists public.create_variation_listing_group(uuid,text,text,text,text,text,text,text,text,text,text,text);
drop function if exists public.configure_variation_listing_intake(text,text,uuid,uuid,numeric);
drop function if exists public.start_variation_listing_intake_pair(text,uuid,text,timestamptz);
drop function if exists public.discard_variation_listing_intake_pair(text);
drop function if exists public.complete_variation_listing_new_variation(text,uuid,uuid,uuid,text,text,jsonb,text,text,text,timestamptz);
drop function if exists public.complete_variation_listing_duplicate_copy(text,uuid,uuid,uuid,text,text,text,text,timestamptz);

drop table public.variation_listing_publishing_checkpoints;
drop table public.variation_listing_revisions;
drop table public.variation_listing_intake_sessions;
drop table public.variation_listing_copies cascade;
drop table public.variation_listing_variations cascade;
drop table public.variation_listing_groups;

drop function if exists public.prevent_variation_listing_checkpoint_mutation();
drop function if exists public.prevent_variation_listing_revision_mutation();
drop function if exists public.prevent_variation_listing_intake_session_identity_update();
drop function if exists public.require_variation_listing_representative_copy();
drop function if exists public.prevent_variation_listing_copy_identity_update();
drop function if exists public.validate_variation_listing_sku_projection();
drop function if exists public.prevent_variation_listing_variation_identity_update();
drop function if exists public.prevent_allocated_variation_listing_group_delete();
drop function if exists public.prevent_variation_listing_group_identity_update();

commit;
