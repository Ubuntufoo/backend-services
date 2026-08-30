-- YP2.5 additive variation-listing crash-safe publishing journal.
-- Service-role owned; no hosted/shared apply is implied by authoring this file.

create table public.variation_listing_revisions (
  revision_id uuid not null,
  group_id uuid not null,
  captured_desired_revision bigint not null,
  snapshot_version integer not null,
  snapshot_digest text not null,
  snapshot jsonb not null,
  operation_count integer not null,
  captured_at timestamptz not null default now(),
  constraint variation_listing_revisions_pkey primary key (revision_id),
  constraint variation_listing_revisions_group_revision_key unique (group_id, captured_desired_revision),
  constraint variation_listing_revisions_group_id_fkey foreign key (group_id)
    references public.variation_listing_groups (group_id) on update no action on delete no action,
  constraint variation_listing_revisions_captured_revision_check check (captured_desired_revision > 0),
  constraint variation_listing_revisions_snapshot_version_check check (snapshot_version > 0),
  constraint variation_listing_revisions_snapshot_digest_check check (
    length(snapshot_digest) = 64 and snapshot_digest ~ '^[0-9a-f]{64}$'
  ),
  constraint variation_listing_revisions_snapshot_object_check check (jsonb_typeof(snapshot) = 'object'),
  constraint variation_listing_revisions_operation_count_check check (operation_count > 0)
);

create table public.variation_listing_operations (
  operation_id uuid not null,
  revision_id uuid not null,
  sequence_no integer not null,
  operation_key text not null,
  operation_kind text not null,
  target_ref text not null,
  intent_version integer not null,
  intent_digest text not null,
  intent jsonb not null,
  current_state text not null default 'planned',
  current_evidence_state text,
  current_evidence jsonb,
  latest_attempt_number integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint variation_listing_operations_pkey primary key (operation_id),
  constraint variation_listing_operations_revision_sequence_key unique (revision_id, sequence_no),
  constraint variation_listing_operations_revision_key_key unique (revision_id, operation_key),
  constraint variation_listing_operations_revision_id_fkey foreign key (revision_id)
    references public.variation_listing_revisions (revision_id) on update no action on delete no action,
  constraint variation_listing_operations_sequence_check check (sequence_no > 0),
  constraint variation_listing_operations_key_check check (
    operation_key = btrim(operation_key) and length(operation_key) > 0
  ),
  constraint variation_listing_operations_kind_check check (operation_kind in (
    'media_ingest',
    'child_inventory_item_write',
    'child_offer_write',
    'complete_group_replace',
    'group_publish',
    'revision_reconcile',
    'withdrawal',
    'cleanup_offer',
    'cleanup_group',
    'cleanup_child_inventory_item',
    'final_absence_verification'
  )),
  constraint variation_listing_operations_target_ref_check check (
    target_ref = btrim(target_ref) and length(target_ref) > 0
  ),
  constraint variation_listing_operations_intent_version_check check (intent_version > 0),
  constraint variation_listing_operations_intent_digest_check check (
    length(intent_digest) = 64 and intent_digest ~ '^[0-9a-f]{64}$'
  ),
  constraint variation_listing_operations_intent_object_check check (jsonb_typeof(intent) = 'object'),
  constraint variation_listing_operations_current_state_check check (
    current_state in ('planned', 'started', 'confirmed_complete', 'confirmed_no_op', 'unknown')
  ),
  constraint variation_listing_operations_current_evidence_state_check check (
    current_evidence_state is null or current_evidence_state in ('present', 'proven_absent', 'unknown')
  ),
  constraint variation_listing_operations_current_evidence_object_check check (
    current_evidence is null or jsonb_typeof(current_evidence) = 'object'
  ),
  constraint variation_listing_operations_latest_attempt_check check (latest_attempt_number >= 0)
);

create index variation_listing_operations_recovery_idx
  on public.variation_listing_operations (revision_id, current_state)
  where current_state = 'unknown';

create table public.variation_listing_operation_attempts (
  checkpoint_id uuid not null,
  operation_id uuid not null,
  attempt_number integer not null,
  checkpoint_number integer not null,
  state text not null,
  evidence_version integer not null,
  pre_evidence jsonb,
  response_evidence jsonb,
  post_evidence jsonb,
  error_evidence jsonb,
  remote_identity jsonb,
  decision text,
  observed_remote_state text,
  created_at timestamptz not null default now(),
  constraint variation_listing_operation_attempts_pkey primary key (checkpoint_id),
  constraint variation_listing_operation_attempts_operation_attempt_checkpoint_key
    unique (operation_id, attempt_number, checkpoint_number),
  constraint variation_listing_operation_attempts_operation_id_fkey foreign key (operation_id)
    references public.variation_listing_operations (operation_id) on update no action on delete no action,
  constraint variation_listing_operation_attempts_attempt_number_check check (attempt_number > 0),
  constraint variation_listing_operation_attempts_checkpoint_number_check check (checkpoint_number > 0),
  constraint variation_listing_operation_attempts_state_check check (
    state in ('started', 'confirmed_complete', 'confirmed_no_op', 'unknown')
  ),
  constraint variation_listing_operation_attempts_evidence_version_check check (evidence_version > 0),
  constraint variation_listing_operation_attempts_pre_evidence_check check (
    pre_evidence is null or jsonb_typeof(pre_evidence) = 'object'
  ),
  constraint variation_listing_operation_attempts_response_evidence_check check (
    response_evidence is null or jsonb_typeof(response_evidence) = 'object'
  ),
  constraint variation_listing_operation_attempts_post_evidence_check check (
    post_evidence is null or jsonb_typeof(post_evidence) = 'object'
  ),
  constraint variation_listing_operation_attempts_error_evidence_check check (
    error_evidence is null or jsonb_typeof(error_evidence) = 'object'
  ),
  constraint variation_listing_operation_attempts_remote_identity_check check (
    remote_identity is null or jsonb_typeof(remote_identity) = 'object'
  ),
  constraint variation_listing_operation_attempts_decision_check check (
    decision is null or (decision = btrim(decision) and length(decision) > 0)
  ),
  constraint variation_listing_operation_attempts_observed_remote_state_check check (
    observed_remote_state is null or observed_remote_state in ('present', 'proven_absent', 'unknown')
  )
);

create function public.prevent_variation_listing_revision_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'variation listing revision snapshots are immutable';
end; $$;

create function public.prevent_variation_listing_operation_identity_update()
returns trigger language plpgsql as $$
begin
  if new.operation_id is distinct from old.operation_id
     or new.revision_id is distinct from old.revision_id
     or new.sequence_no is distinct from old.sequence_no
     or new.operation_key is distinct from old.operation_key
     or new.operation_kind is distinct from old.operation_kind
     or new.target_ref is distinct from old.target_ref
     or new.intent_version is distinct from old.intent_version
     or new.intent_digest is distinct from old.intent_digest
     or new.intent is distinct from old.intent
     or new.created_at is distinct from old.created_at then
    raise exception 'variation listing operation identity and intent are immutable';
  end if;
  return new;
end; $$;

create function public.prevent_variation_listing_operation_delete()
returns trigger language plpgsql as $$
begin
  raise exception 'variation listing operation rows are immutable';
end; $$;

create function public.prevent_variation_listing_operation_attempt_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'variation listing operation attempts are append-only';
end; $$;

create function public.require_variation_listing_operation_sequence()
returns trigger language plpgsql as $$
declare operation_limit integer;
begin
  select operation_count into operation_limit
    from public.variation_listing_revisions
   where revision_id = new.revision_id;
  if operation_limit is null or new.sequence_no < 1 or new.sequence_no > operation_limit then
    raise exception 'variation listing operation sequence is outside captured plan';
  end if;
  return new;
end; $$;

create function public.require_variation_listing_revision_plan()
returns trigger language plpgsql as $$
declare expected_count integer;
declare actual_count integer;
begin
  select operation_count into expected_count
    from public.variation_listing_revisions
   where revision_id = new.revision_id;
  select count(*)::integer into actual_count
    from public.variation_listing_operations
   where revision_id = new.revision_id;
  if expected_count is null or actual_count <> expected_count then
    raise exception 'variation listing revision requires a complete operation plan';
  end if;
  return new;
end; $$;

revoke all on function public.prevent_variation_listing_revision_mutation() from public, anon, authenticated, service_role;
revoke all on function public.prevent_variation_listing_operation_identity_update() from public, anon, authenticated, service_role;
revoke all on function public.prevent_variation_listing_operation_delete() from public, anon, authenticated, service_role;
revoke all on function public.prevent_variation_listing_operation_attempt_mutation() from public, anon, authenticated, service_role;
revoke all on function public.require_variation_listing_operation_sequence() from public, anon, authenticated, service_role;
revoke all on function public.require_variation_listing_revision_plan() from public, anon, authenticated, service_role;

create trigger variation_listing_revisions_prevent_update
  before update on public.variation_listing_revisions for each row
  execute function public.prevent_variation_listing_revision_mutation();
create trigger variation_listing_revisions_prevent_delete
  before delete on public.variation_listing_revisions for each row
  execute function public.prevent_variation_listing_revision_mutation();

create trigger variation_listing_operations_prevent_identity_update
  before update on public.variation_listing_operations for each row
  execute function public.prevent_variation_listing_operation_identity_update();
create trigger variation_listing_operations_prevent_delete
  before delete on public.variation_listing_operations for each row
  execute function public.prevent_variation_listing_operation_delete();
create constraint trigger variation_listing_operations_require_sequence
  after insert or update of revision_id, sequence_no on public.variation_listing_operations
  deferrable initially deferred for each row
  execute function public.require_variation_listing_operation_sequence();
create trigger variation_listing_operations_updated_at
  before update on public.variation_listing_operations for each row
  execute function public.set_row_updated_at();

create constraint trigger variation_listing_revisions_require_complete_plan
  after insert on public.variation_listing_revisions
  deferrable initially deferred for each row
  execute function public.require_variation_listing_revision_plan();

create trigger variation_listing_operation_attempts_prevent_mutation
  before update or delete on public.variation_listing_operation_attempts for each row
  execute function public.prevent_variation_listing_operation_attempt_mutation();

alter table public.variation_listing_revisions enable row level security;
alter table public.variation_listing_operations enable row level security;
alter table public.variation_listing_operation_attempts enable row level security;
revoke all privileges on table public.variation_listing_revisions,
  public.variation_listing_operations, public.variation_listing_operation_attempts
  from public, anon, authenticated, service_role;
grant select, insert on table public.variation_listing_revisions to service_role;
grant select, insert, update on table public.variation_listing_operations to service_role;
grant select, insert on table public.variation_listing_operation_attempts to service_role;
