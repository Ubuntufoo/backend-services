# YP2.8 variation-listing persistence simplification audit

## Operating model

This application is private, single-user, and runs from one local installation while using hosted Supabase. The persistence design should therefore retain only safeguards that prevent concrete corruption or unsafe eBay replay. Multi-user authorization, generalized workflow infrastructure, event sourcing, and speculative concurrency systems are out of scope.

All seven deployed variation-listing tables are currently empty, making this the lowest-cost point to simplify the design before YP3.3 creates durable variation data.

## Table verdicts

| Current table | Verdict | Reason |
| --- | --- | --- |
| `variation_listing_groups` | Keep, simplify | Essential aggregate identity, shared listing data, SKU namespace/high-water, coarse lifecycle, and desired/confirmed revision watermarks. Remove `recovery_required`; recovery is derivable from unresolved publishing checkpoints. |
| `variation_listing_variations` | Keep, simplify | Essential one-row-per-selector/SKU domain identity. Keep ownership, SKU/selector/order uniqueness, price, metadata, and representative-copy reference. Remove aggregate-write proof machinery. |
| `variation_listing_copies` | Keep, simplify | Essential physical inventory authority. Keep ownership, availability/condition, front/back R2 keys, unique capture-pair identity, and provenance sufficient for idempotent completion. Remove aggregate-write proof machinery. |
| `variation_listing_intake_sessions` | Keep, simplify materially | A durable DB row remains simpler than adding local-file persistence and survives process restart. Keep current target/mode/sticky price plus one pending-pair snapshot; remove session-version and duplicated pending snapshot columns. |
| `variation_listing_revisions` | Keep, simplify | A frozen Publish Changes revision remains necessary because local desired state may advance while an older remote revision is in flight. Store the complete ordered operation plan inside the immutable revision snapshot. |
| `variation_listing_operations` | Remove | Immutable operation intent can live in the frozen revision; mutable current-state projection duplicates checkpoint history and requires parity validation. |
| `variation_listing_operation_attempts` | Replace | Durable remote checkpoints remain required, but replace this table with one simpler append-only publishing-checkpoint table. |

**Target: six tables instead of seven.** The four domain/intake tables remain, plus one immutable revision table and one append-only publishing-checkpoint table.

## Aggregate mutation simplification

The YP2.4 GUC + temporary proof table + deferred child revision-proof machinery solved a real problem: separate Supabase REST mutations cannot form one multi-table transaction. Now that narrow PostgreSQL RPCs are accepted, that machinery is indirect and redundant.

The target aggregate write path is one purpose-built SECURITY DEFINER RPC:

1. Validate one requested aggregate mutation in TypeScript.
2. Lock the owning group row `FOR UPDATE`.
3. Verify the expected `desired_revision`.
4. Perform group/variation/copy changes and any SKU allocation inside the same PostgreSQL transaction.
5. Increment `desired_revision` exactly once and return the committed aggregate identity/revision.

The PostgreSQL transaction itself becomes the same-transaction proof. The future compensating migration should remove the aggregate write-scope GUCs, temporary proof table mechanism, variation/copy aggregate-scope triggers, deferred child revision-advance triggers, and allocator-consumption proof trigger.

SKU allocation remains safe because the RPC holds the group lock, consumes the stored high-water, constructs and inserts the exact SKU in the same transaction, and retains the existing uniqueness/check constraints.

Keep `desired_revision` and `last_confirmed_revision`. They solve a genuine staged-publication problem: local state can advance while an older frozen revision is still being reconciled remotely.

## Minimum database enforcement

Keep database features that cheaply prevent durable relational corruption:

- primary keys, foreign keys, unique constraints, and compact scalar checks;
- unique group SKU namespace, variation SKU, selector/order uniqueness, and `capture_pair_id`;
- the same-variation representative-copy foreign key;
- RLS with no `anon`/`authenticated` table access because Supabase is hosted;
- service-role-only narrow SECURITY DEFINER write RPCs with pinned `search_path`;
- only cheap identity/provenance immutability guards where changing an ID, SKU namespace, or physical-copy provenance would create permanent corruption; and
- the shared `updated_at` trigger where useful.

Move workflow transition rules and rich object validation to TypeScript when they are not needed to make a multi-row database transaction safe. Do not keep database transition triggers merely to protect against hypothetical hostile callers when direct mutation privileges are unavailable.

Keep coarse `lifecycle_state` for now because states such as active, withdrawn, and abandoned have persistent product meaning. Remove `recovery_required`; recovery is derived from unresolved/unknown publishing checkpoints. Keep optional lifecycle/pending indexes only when an actual query justifies them.

## Intake-session target

Keep one row per `capture_source_key` with:

- current mode;
- target group;
- optional target variation;
- sticky price; and
- one nullable `pending_pair` JSON object.

The pending object needs only restart-critical frozen facts such as pair ID, mode, target IDs, price, front source reference, and start time. A narrow intake RPC locks the session row. While a pending pair exists, target/mode/price changes are rejected. Successful second-image persistence clears the pending pair in the same transaction that creates the variation/copy.

`variation_listing_copies.capture_pair_id` remains unique and is the completion-retry idempotency key. A separate monotonic session version is unnecessary for one local operator because the frozen pending pair plus row lock already prevents rerouting; target changes while no pair is pending can safely be last-write-wins.

## Publishing journal target

Keep one immutable `variation_listing_revisions` row per Publish Changes action. Its snapshot/digest is authoritative for both desired remote aggregate state and the complete ordered operation plan.

Replace `variation_listing_operations` + `variation_listing_operation_attempts` with one append-only checkpoint table containing the minimum relational fields:

- `checkpoint_id`
- `revision_id`
- `operation_key`
- `attempt_number`
- `checkpoint_number`
- `state` (`started`, `unknown`, `confirmed_complete`, `confirmed_no_op`)
- `observed_remote_state` (`present`, `proven_absent`, `unknown`, or null)
- one JSONB evidence object containing request/response/error/read-back/remote identities/decision as needed
- `created_at`

Use a unique key on `(revision_id, operation_key, attempt_number, checkpoint_number)`.

The append RPC validates that `operation_key` exists in the frozen revision plan, enforces contiguous transitions, preserves unknown outcomes, and requires exact present/proven-absent evidence for terminal resolution. Current operation state is derived from the latest checkpoint; there is no mutable projection to drift from history.

The confirmation RPC locks the group, loads the frozen revision plan, and advances `last_confirmed_revision` only when every planned operation has a terminal latest checkpoint with exact evidence. It no longer requires the old GUC confirmation scope.

This preserves the eBay properties that actually matter: freeze intent before mutation, durably record started, preserve ambiguity, read before retry, never blindly replay an unknown mutation, and confirm a whole revision only from exact evidence.

## Security boundary

Security remains deliberately small. Do not add owners, users, tenants, roles, or browser policies. Hosted Supabase still warrants RLS and revoked browser-role access. The local backend uses the service role, and transaction-sensitive writes go through a small set of service-role-only SECURITY DEFINER RPCs with pinned `search_path`.

These controls protect the hosted database surface and prevent accidental bypass. They are not a multi-user authorization system.

## Implementation gate

Implement this simplification before YP3.3 creates durable variation data.

The implementation should be one reviewed compensating forward migration plus matching data-layer/RPC/repository/type/test changes, validated against disposable PostgreSQL. Hosted application remains a separate explicit authorization task. YP3.3 must target the simplified aggregate/intake RPC seam and must not reintroduce the historical GUC/temp-proof/deferred child-write design.
