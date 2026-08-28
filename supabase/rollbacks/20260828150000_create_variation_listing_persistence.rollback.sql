-- YP2.2a pre-apply rollback/compensation.
-- Destructive only while every namespaced table is empty; never drops shared helpers.

begin;

do $$
declare occupied boolean;
begin
  if to_regclass('public.variation_listing_intake_sessions') is not null then
    lock table public.variation_listing_intake_sessions in access exclusive mode;
    execute 'select exists (select 1 from public.variation_listing_intake_sessions)' into occupied;
    if occupied then raise exception 'variation_listing_intake_sessions is not empty; use an additive compensation'; end if;
  end if;
  if to_regclass('public.variation_listing_copies') is not null then
    lock table public.variation_listing_copies in access exclusive mode;
    execute 'select exists (select 1 from public.variation_listing_copies)' into occupied;
    if occupied then raise exception 'variation_listing_copies is not empty; use an additive compensation'; end if;
  end if;
  if to_regclass('public.variation_listing_variations') is not null then
    lock table public.variation_listing_variations in access exclusive mode;
    execute 'select exists (select 1 from public.variation_listing_variations)' into occupied;
    if occupied then raise exception 'variation_listing_variations is not empty; use an additive compensation'; end if;
  end if;
  if to_regclass('public.variation_listing_groups') is not null then
    lock table public.variation_listing_groups in access exclusive mode;
    execute 'select exists (select 1 from public.variation_listing_groups)' into occupied;
    if occupied then raise exception 'variation_listing_groups is not empty; use an additive compensation'; end if;
  end if;
end $$;

drop table if exists public.variation_listing_intake_sessions;
alter table if exists public.variation_listing_variations
  drop constraint if exists variation_listing_variations_representative_copy_fkey;
drop table if exists public.variation_listing_copies;
drop table if exists public.variation_listing_variations;
drop table if exists public.variation_listing_groups;

drop function if exists public.prevent_variation_listing_group_identity_update();
drop function if exists public.prevent_allocated_variation_listing_group_delete();
drop function if exists public.validate_variation_listing_group_guarded_update();
drop function if exists public.verify_variation_listing_allocator_consumption();
drop function if exists public.prevent_variation_listing_variation_identity_update();
drop function if exists public.validate_variation_listing_sku_projection();
drop function if exists public.validate_variation_listing_variation_aggregate_write();
drop function if exists public.require_variation_listing_variation_revision_advance();
drop function if exists public.prevent_variation_listing_copy_identity_update();
drop function if exists public.validate_variation_listing_copy_aggregate_write();
drop function if exists public.require_variation_listing_copy_revision_advance();
drop function if exists public.require_variation_listing_representative_copy();
drop function if exists public.prevent_variation_listing_intake_session_identity_update();
drop function if exists public.validate_variation_listing_intake_session_transition();

commit;
