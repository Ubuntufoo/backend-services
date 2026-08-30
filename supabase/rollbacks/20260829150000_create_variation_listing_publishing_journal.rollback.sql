-- YP2.5 pre-apply recovery only. This is intentionally outside automatic
-- migration discovery. Once durable journal rows exist, use a compensating
-- migration instead of destructive rollback.

begin;

lock table public.variation_listing_operation_attempts,
  public.variation_listing_operations,
  public.variation_listing_revisions
  in access exclusive mode;

do $$
begin
  if exists (select 1 from public.variation_listing_operation_attempts limit 1)
     or exists (select 1 from public.variation_listing_operations limit 1)
     or exists (select 1 from public.variation_listing_revisions limit 1) then
    raise exception 'YP2.5 publishing journal is not empty; use a compensating migration';
  end if;
end; $$;

drop table public.variation_listing_operation_attempts;
drop table public.variation_listing_operations;
drop table public.variation_listing_revisions;

drop function public.require_variation_listing_revision_plan();
drop function public.require_variation_listing_operation_sequence();
drop function public.prevent_variation_listing_operation_attempt_mutation();
drop function public.prevent_variation_listing_operation_delete();
drop function public.prevent_variation_listing_operation_identity_update();
drop function public.prevent_variation_listing_revision_mutation();

commit;
