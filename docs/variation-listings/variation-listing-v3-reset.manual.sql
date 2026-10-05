-- OPERATOR-ONLY, ONE-TIME DEVELOPMENT RESET.
--
-- Run only after explicit operator authorization confirms historical Variation
-- publications are withdrawn and the six-table data is disposable. This
-- artifact is deliberately outside supabase/migrations so
-- normal migration apply cannot execute it. It clears Variation persistence
-- only; Standard Single/Lot and every other application/system table are out
-- of scope.

begin;

-- Lock exactly the approved tables (and never inherited descendants) before
-- catalog preflight or the destructive statement.
lock table only
  public.variation_listing_groups,
  public.variation_listing_variations,
  public.variation_listing_copies,
  public.variation_listing_intake_sessions,
  public.variation_listing_revisions,
  public.variation_listing_publishing_checkpoints
  in access exclusive mode;

do $$
declare
  approved text[] := array[
    'variation_listing_publishing_checkpoints',
    'variation_listing_revisions',
    'variation_listing_intake_sessions',
    'variation_listing_copies',
    'variation_listing_variations',
    'variation_listing_groups'
  ];
begin
  if (
    select count(*)
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'
       and c.relname = any (approved)
  ) <> cardinality(approved) then
    raise exception 'Variation reset refused: exact six approved tables are not present';
  end if;

  -- A foreign key touching an approved table must stay inside the approved
  -- set. Otherwise PostgreSQL would require a broader dependency operation.
  if exists (
    select 1
      from pg_constraint fk
      join pg_class child on child.oid = fk.conrelid
      join pg_namespace child_schema on child_schema.oid = child.relnamespace
      join pg_class parent on parent.oid = fk.confrelid
      join pg_namespace parent_schema on parent_schema.oid = parent.relnamespace
     where fk.contype = 'f'
       and (
         (child_schema.nspname = 'public' and child.relname = any (approved)
          and not (parent_schema.nspname = 'public' and parent.relname = any (approved)))
         or
         (parent_schema.nspname = 'public' and parent.relname = any (approved)
          and not (child_schema.nspname = 'public' and child.relname = any (approved)))
       )
  ) then
    raise exception 'Variation reset refused: foreign key crosses the approved six-table boundary';
  end if;

  -- Inheritance would make a plain TRUNCATE broader than the six approved
  -- relations. Any parent/child edge crossing that boundary is unsafe.
  if exists (
    select 1
      from pg_inherits inheritance
      join pg_class child on child.oid = inheritance.inhrelid
      join pg_namespace child_schema on child_schema.oid = child.relnamespace
      join pg_class parent on parent.oid = inheritance.inhparent
      join pg_namespace parent_schema on parent_schema.oid = parent.relnamespace
     where (
       (child_schema.nspname = 'public' and child.relname = any (approved)
        and not (parent_schema.nspname = 'public' and parent.relname = any (approved)))
       or
       (parent_schema.nspname = 'public' and parent.relname = any (approved)
        and not (child_schema.nspname = 'public' and child.relname = any (approved)))
     )
  ) then
    raise exception 'Variation reset refused: inheritance crosses the approved six-table boundary';
  end if;

  -- A user-defined ON TRUNCATE trigger could mutate an unexpected table. Any
  -- such trigger is a fail-closed condition, not a reason to broaden scope.
  if exists (
    select 1
      from pg_trigger trigger_row
      join pg_class table_row on table_row.oid = trigger_row.tgrelid
      join pg_namespace table_schema on table_schema.oid = table_row.relnamespace
     where not trigger_row.tgisinternal
       and (trigger_row.tgtype & 32) <> 0
       and table_schema.nspname = 'public'
       and table_row.relname = any (approved)
  ) then
    raise exception 'Variation reset refused: approved table has an ON TRUNCATE trigger';
  end if;
end;
$$;

-- Destructive boundary: this is the only mutation statement in this artifact.
truncate table only
  public.variation_listing_publishing_checkpoints,
  public.variation_listing_revisions,
  public.variation_listing_intake_sessions,
  public.variation_listing_copies,
  public.variation_listing_variations,
  public.variation_listing_groups;

commit;
