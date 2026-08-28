# Variation-listing initial persistence design

## Decision and boundary

YP2.1 defines the exact additive local persistence contract. It does not author or apply SQL,
write the shared Supabase project, mutate eBay, or add repositories/runtime code. YP2.2a may
translate this document into one forward migration and one dependency-safe rollback/compensating
migration without making another architecture decision.

The initial boundary is exactly four namespaced tables:

1. `public.variation_listing_groups` — long-lived aggregate identity, shared eBay invariants,
   SKU allocation namespace/high-water mark, local revision watermarks, and lifecycle overlay.
2. `public.variation_listing_variations` — ordered selector/SKU identities, application metadata,
   manual price, and one representative-copy reference.
3. `public.variation_listing_copies` — one physical card per row, with per-copy availability,
   internal condition, front/back R2 keys, and capture/pair provenance.
4. `public.variation_listing_intake_sessions` — one durable target-aware session per capture source;
   sticky target/mode/price and an all-or-none pending front/back snapshot.

No session state is stored on a group. Stations, cameras, modes, and half-pairs have independent
lifecycle and restart semantics, so a group row cannot be their authority. Existing `public.listings`,
`jobs`, `orders`, `app_settings`, enums, triggers, functions, repositories, generated legacy types,
Single/Lot capture modes, and Single/Lot SKU parsing/allocation remain untouched.

The initial tables deliberately do not contain revision snapshots, payload digests, remote IDs,
operation attempts/checkpoints, eBay Media identities, order lines, or sold-history evidence. Those
rows belong to the separately reviewed YP2.5 operation ledger (and YP2.8 sold/order extension).
No publishing is allowed before that ledger exists.

## Group table — `public.variation_listing_groups`

| Column | PostgreSQL contract | Meaning and mutability |
| --- | --- | --- |
| `group_id` | `uuid` PK, `NOT NULL`, no default | Immutable application aggregate identity, generated once by the service, never reused. |
| `group_key` | `text NOT NULL` | Immutable deterministic Inventory group key `VL-G-` + `upper(replace(group_id::text, '-', ''))`. |
| `sku_category_code` | `text NOT NULL` | Existing structured-SKU category code. Initial allowed values are exactly `BSKBL`, `BSBL`, `OTHER`; service supplies uppercase text. Immutable after insert. |
| `sku_bucket_token` | `text NOT NULL` | Stable ASCII middle SKU segment (for example `McGrady` or `2003Topps`). Chosen before insert and immutable from insert onward. |
| `next_inventory_serial` | `integer NOT NULL DEFAULT 1` | Next six-digit inventory serial to consume. Range `1..1000000`; `1000000` is the exhausted sentinel after serial `999999`. Only the allocator may increment it. |
| `lifecycle_state` | `text NOT NULL DEFAULT 'intake'` | Last normal aggregate state: `intake`, `draft`, `review`, `publish-ready`, `publishing`, `active`, `withdrawn`, `abandoned`, `cleanup`, or `terminal-absent`. |
| `recovery_required` | `boolean NOT NULL DEFAULT false` | Fail-closed overlay retaining the last normal lifecycle state. |
| `selector_name` | `text NOT NULL DEFAULT 'Card'` | Immutable sole MVP eBay selector aspect; exact value `Card`. |
| `title` | `text` nullable | Group-owned title; null only before generation/review completion. |
| `description` | `text` nullable | Group-owned description; null only before generation/review completion. |
| `derived_common_ebay_aspects` | `jsonb NOT NULL DEFAULT '{}'::jsonb` | Recomputed common group projection; never variation metadata source of truth. |
| `category_id` | `text NOT NULL` | Shared eBay category invariant (initial category evidence is `261328`). |
| `marketplace_id` | `text NOT NULL` | Shared marketplace invariant (initial evidence is `EBAY_US`). |
| `listing_format` | `text NOT NULL DEFAULT 'FIXED_PRICE'` | Shared fixed-price format. |
| `merchant_location_key` | `text NOT NULL` | Shared merchant-location invariant. |
| `fulfillment_policy_id` | `text NOT NULL` | Shared fulfillment policy. |
| `payment_policy_id` | `text NOT NULL` | Shared payment policy. |
| `return_policy_id` | `text NOT NULL` | Shared return policy. |
| `condition_id` | `text NOT NULL` | Shared eBay condition tier. |
| `condition_token` | `text NOT NULL` | Shared internal minimum condition token; compatibility authority for available copies. |
| `condition_description` | `text` nullable | Optional normalized shared condition description. |
| `condition_descriptors` | `jsonb NOT NULL DEFAULT '[]'::jsonb` | Ordered shared condition descriptors. |
| `desired_revision` | `bigint NOT NULL DEFAULT 0` | Local desired-state watermark. Every committed aggregate mutation increments exactly once. |
| `last_confirmed_revision` | `bigint` nullable | Highest revision whose remote effect YP2.5 confirmed. Null means no remote revision is confirmed. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation audit timestamp. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Trigger-maintained last aggregate mutation timestamp. |

### Group constraints and indexes

The migration must use these names and semantics:

- `variation_listing_groups_pkey`: primary key `(group_id)`.
- `variation_listing_groups_group_key_key`: unique `(group_key)`.
- `variation_listing_groups_sku_namespace_key`: unique `(sku_category_code, sku_bucket_token)`.
  One retained group owns a bucket namespace; a second group cannot start the same serial stream.
- `variation_listing_groups_sku_category_code_check`: `sku_category_code IN ('BSKBL','BSBL','OTHER')`
  and `sku_category_code = upper(sku_category_code)`.
- `variation_listing_groups_sku_bucket_token_check`: `length(sku_bucket_token) BETWEEN 1 AND 32`,
  `sku_bucket_token = btrim(sku_bucket_token)`, and the exact ASCII grammar
  `^[A-Za-z0-9]+([._-][A-Za-z0-9]+)*$`. Service additionally applies Unicode NFC before the SQL write;
  no whitespace, slash, or unbounded token is accepted; exact reserved tokens `Single` and `Lot` are
  rejected (`sku_bucket_token NOT IN ('Single','Lot')`) so a variation SKU cannot collide with the
  legacy parser's middle segment.
- `variation_listing_groups_group_key_projection_check`: `group_key = 'VL-G-' || upper(replace(group_id::text, '-', ''))`.
- `variation_listing_groups_next_inventory_serial_check`: `next_inventory_serial BETWEEN 1 AND 1000000`.
- `variation_listing_groups_lifecycle_state_check`: exactly the ten values listed above.
- `variation_listing_groups_selector_name_check`: `selector_name = 'Card'`.
- `variation_listing_groups_text_check` family: nullable title/description/condition description are
  null or non-empty outer-trimmed; every required text invariant is non-empty outer-trimmed.
- `variation_listing_groups_listing_format_check`: `listing_format = 'FIXED_PRICE'`.
- `variation_listing_groups_derived_common_ebay_aspects_check`: `jsonb_typeof(...) = 'object'`.
- `variation_listing_groups_condition_descriptors_check`: `jsonb_typeof(...) = 'array'`.
- `variation_listing_groups_condition_token_check`: `condition_token IN
  ('NEAR_MINT_OR_BETTER','EXCELLENT','VERY_GOOD','POOR')`.
- `variation_listing_groups_revision_watermark_check`: `desired_revision >= 0` and
  (`last_confirmed_revision IS NULL OR (last_confirmed_revision >= 1 AND last_confirmed_revision <= desired_revision)`).
- `variation_listing_groups_lifecycle_state_idx`: B-tree on `(lifecycle_state)`.
- `variation_listing_groups_pending_revision_idx`: partial B-tree on `(group_id)` where
  `last_confirmed_revision IS NULL OR last_confirmed_revision < desired_revision`.

`variation_listing_groups_prevent_identity_update` is a `BEFORE UPDATE` trigger backed by
`public.prevent_variation_listing_group_identity_update()`. It rejects changes to `group_id`,
`group_key`, `sku_category_code`, `sku_bucket_token`, `selector_name`, or `created_at`.
`variation_listing_groups_prevent_allocated_delete`, backed by
`public.prevent_allocated_variation_listing_group_delete()`, rejects `DELETE` whenever
`OLD.next_inventory_serial > 1`; an allocated namespace/high-water is retained permanently.

`variation_listing_groups_validate_guarded_update`, backed by
`public.validate_variation_listing_group_guarded_update()`, reads transaction-local setting
`app.variation_listing_write_scope`. For aggregate writes, the trusted service also sets
`app.variation_listing_group_id` and `app.variation_listing_expected_revision`. It calls
`set_config(<key>, <value>, true)` for those three caller-configured keys before child writes and the
one group update, then leaves them set through commit so deferred checks can read them. The guarded
group trigger, not the caller, sets the separate revision proof after the CAS validation described
below. `true` makes every setting transaction local, and PostgreSQL clears them when the transaction
ends. One transaction mutates exactly one group aggregate; cross-group bulk writes use separate
transactions.
The trigger requires configured group ID = `OLD.group_id` and configured expected revision =
`OLD.desired_revision`. Exact accepted transitions:

- `aggregate`: `desired_revision = OLD.desired_revision + 1`, `last_confirmed_revision` unchanged,
  and `next_inventory_serial` unchanged or exactly `OLD.next_inventory_serial + 1`;
- `confirmation`: `desired_revision` and `next_inventory_serial` unchanged, and non-null
  `last_confirmed_revision` between `1` and `desired_revision`, not below its prior non-null value;
- missing/empty: all three allocator/revision fields and all material group fields unchanged; only
  trigger-maintained `updated_at` may differ.

After validating an `aggregate` transition from revision `N` to `N+1`, the group trigger requires that
no proof is already present and sets transaction-local
`app.variation_listing_group_revision_proof` to the exact
`<txid>|<group_id>|<N>|<N+1>` tuple. A confirmation, missing, or unknown scope never creates this proof.
The transaction ID plus exact group/from/to revisions prevents proof from another transaction, group,
or revision transition from satisfying a deferred child check and enforces the one-group/one-CAS
transaction boundary. The proof is trigger-produced under the trusted `service_role` write seam and is
cleared automatically at transaction end.

Identity changes are rejected for every scope. `aggregate` may change local content/lifecycle/recovery;
`confirmation` may change only confirmation and remote-evidence lifecycle/recovery. The trigger rejects
unknown scopes, counter skips/decrements, mixed transitions, and unguarded material updates. Only
`service_role` receives table write access. `set_variation_listing_groups_updated_at` invokes the
existing `public.set_row_updated_at()` convention.

If an aggregate update increments `next_inventory_serial`, deferred constraint trigger
`variation_listing_groups_verify_allocator_consumption`, backed by
`public.verify_variation_listing_allocator_consumption()`, re-queries current state at commit and
requires one variation in that group with `inventory_serial = OLD.next_inventory_serial` and the exact
projected SKU. Missing or mismatched allocation raises and rolls back the high-water update.

The service schema for `condition_descriptors` is an ordered array of objects with exact keys
`name: non-empty trimmed string`, `values: non-empty array of unique non-empty trimmed strings`, and
optional `additionalInfo: non-empty trimmed string`; unknown keys and empty arrays are rejected.
`derived_common_ebay_aspects` is an object of non-empty normalized aspect names to non-empty unique
string arrays. SQL enforces top-level shape; the trusted aggregate validator enforces these complete
nested schemas before every write.

## Variation table — `public.variation_listing_variations`

| Column | PostgreSQL contract | Meaning and mutability |
| --- | --- | --- |
| `variation_id` | `uuid` PK, `NOT NULL`, no default | Immutable application variation/selector identity, generated once and never reused. |
| `group_id` | `uuid NOT NULL` | Owning group; immutable. |
| `inventory_serial` | `integer NOT NULL` | Allocated serial `1..999999`, immutable. |
| `sku` | `text NOT NULL` | Exact immutable full SKU `<sku_category_code>-<sku_bucket_token>-<six-digit inventory serial>`, unique across application-owned variation listings. |
| `position` | `integer NOT NULL` | Zero-based application order, mutable only by aggregate reorder. |
| `selector_value` | `text NOT NULL` | Canonical custom-`Card` value, normalized once and immutable. |
| `price_amount` | `numeric NOT NULL` | Exact manual USD basket amount. |
| `price_currency` | `text NOT NULL DEFAULT 'USD'` | Exact `USD`; no other currency is accepted. |
| `representative_copy_id` | `uuid` nullable during the one transaction that creates the first copy | Same-variation physical-copy reference; must be non-null at commit for every surviving variation. |
| `variation_metadata` | `jsonb NOT NULL DEFAULT '{}'::jsonb` | Gemini-derived/reviewed facts that may differ between variations; top-level object only. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation audit timestamp. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Trigger-maintained mutable-field timestamp. |

Constraints/indexes:

- `variation_listing_variations_pkey`: primary key `(variation_id)`.
- `variation_listing_variations_group_id_fkey`: `(group_id)` references groups `(group_id)`
  `ON UPDATE NO ACTION ON DELETE NO ACTION` (service deletes children before a group).
- `variation_listing_variations_group_variation_key`: unique `(group_id, variation_id)`, required as
  the target of same-group intake-session composite foreign keys.
- `variation_listing_variations_sku_key`: unique `(sku)` across all variation listings.
- `variation_listing_variations_group_position_key`: unique `(group_id, position)`,
  `DEFERRABLE INITIALLY DEFERRED`; supports an atomic position swap/rewrite.
- `variation_listing_variations_group_selector_value_key`: unique `(group_id, selector_value)`.
- `variation_listing_variations_inventory_serial_check`: `inventory_serial BETWEEN 1 AND 999999`.
- `variation_listing_variations_position_check`: `position >= 0`.
- `variation_listing_variations_selector_value_check`: non-empty outer-trimmed text. Service applies
  Unicode NFC, preserves case, and rejects price/stock/position suffixes before insertion.
- `variation_listing_variations_price_amount_check`: exact numeric membership in `(0.99, 1.49, 1.99, 2.49)`.
- `variation_listing_variations_price_currency_check`: `price_currency = 'USD'`.
- `variation_listing_variations_metadata_check`: `jsonb_typeof(variation_metadata) = 'object'`.
- `variation_listing_variations_sku_grammar_check`: exact generic grammar
  `^[A-Z]+-[A-Za-z0-9]+([._-][A-Za-z0-9]+)*-[0-9]{6}$` and a non-zero six-digit suffix.
- `variation_listing_variations_sku_projection_check`: a trigger reads the owning group and requires
  `sku = group.sku_category_code || '-' || group.sku_bucket_token || '-' || lpad(inventory_serial::text, 6, '0')`.
  This is the exact cross-row code/token/serial check; a caller cannot write a plausible but wrong prefix.
- `variation_listing_variations_group_id_idx`: B-tree `(group_id)` for aggregate loading (the unique
  position and selector indexes remain separately named and usable).

`variation_listing_variations_prevent_identity_update` is a `BEFORE UPDATE` trigger backed by
`public.prevent_variation_listing_variation_identity_update()`. It rejects changes to
`variation_id`, `group_id`, `inventory_serial`, `sku`, `selector_value`, or `created_at`; only the aggregate reorder
service may change `position`, and only the service may change price/metadata/representative reference.
`set_variation_listing_variations_updated_at` invokes `public.set_row_updated_at()`.

`variation_listing_variations_validate_aggregate_write`, backed by
`public.validate_variation_listing_variation_aggregate_write()`, runs on `INSERT`, `UPDATE`, and
`DELETE`. It requires aggregate scope plus configured group/expected-revision values matching the row.
Deferred companion `variation_listing_variations_require_revision_advance` re-queries the owning group
at commit and requires both `desired_revision = configured_expected_revision + 1` and the exact
same-transaction group/revision proof minted by the guarded group CAS. Delete uses `OLD.group_id`;
insert/update use `NEW.group_id`. Direct child mutation against a group already sitting at the numeric
target revision cannot pass without that transaction's owning group CAS.

## Copy table — `public.variation_listing_copies`

| Column | PostgreSQL contract | Meaning and mutability |
| --- | --- | --- |
| `copy_id` | `uuid` PK, `NOT NULL`, no default | Immutable identity for one physical card. Never an eBay variation/SKU. |
| `variation_id` | `uuid NOT NULL` | Sole owning variation; immutable. |
| `availability_state` | `text NOT NULL DEFAULT 'available'` | Exactly `available` or `unavailable`. Initial rows are available only after condition compatibility validation. |
| `condition_token` | `text NOT NULL` | Internal normalized condition token, exactly one of `NEAR_MINT_OR_BETTER`, `EXCELLENT`, `VERY_GOOD`, `POOR`. |
| `condition_notes` | `text` nullable | Optional non-empty outer-trimmed operator notes; evidence, not eBay condition authority. |
| `front_r2_key` | `text NOT NULL` | Exact application-owned R2 object key for this copy's front image. |
| `back_r2_key` | `text NOT NULL` | Exact application-owned R2 object key for this copy's back image. |
| `capture_source_key` | `text NOT NULL` | Immutable watcher/station identity that captured the pair. |
| `capture_session_version` | `bigint NOT NULL` | Positive session version snapshotted for the pair. |
| `capture_pair_id` | `uuid NOT NULL` | Immutable pair provenance identity shared by front/back processing evidence. |
| `capture_front_source_ref` | `text NOT NULL` | Exact source reference for front input. |
| `capture_back_source_ref` | `text NOT NULL` | Exact source reference for back input. |
| `capture_started_at` | `timestamptz NOT NULL` | Time first image snapshot was recorded. |
| `captured_at` | `timestamptz NOT NULL DEFAULT now()` | Pair completion time. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Persistence audit timestamp. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Trigger-maintained condition/availability audit timestamp. |

Constraints/indexes:

- `variation_listing_copies_pkey`: primary key `(copy_id)`.
- `variation_listing_copies_variation_id_fkey`: `(variation_id)` references variations `(variation_id)`
  `ON UPDATE NO ACTION ON DELETE NO ACTION`.
- `variation_listing_copies_variation_copy_key`: unique `(variation_id, copy_id)`; this named composite
  key is the target for the cycle-safe representative foreign key.
- `variation_listing_copies_capture_pair_id_key`: unique `(capture_pair_id)`. An acknowledgement retry
  cannot persist the same completed pair as a second physical copy.
- `variation_listing_copies_variation_id_idx`: B-tree `(variation_id)`.
- `variation_listing_copies_availability_idx`: B-tree `(variation_id, availability_state)`.
- `variation_listing_copies_availability_state_check`: value in `('available','unavailable')`.
- `variation_listing_copies_condition_token_check`: value in the exact four canonical tokens above.
- `variation_listing_copies_condition_notes_check`: null or non-empty outer-trimmed text.
- `variation_listing_copies_r2_key_check`: each key is non-empty, outer-trimmed, contains no whitespace or
  control characters, starts with `variation-listing/`, and has the role-specific suffix `/front-...` for
  `front_r2_key` or `/back-...` for `back_r2_key`; service additionally proves the exact immutable
  `<group>/<variation>/<copy>/<front|back>-<content-hash>.<ext>` ownership path. Local processed paths are
  deterministic derivatives and are never persisted as authority.
- `variation_listing_copies_capture_source_check`: source refs/keys are non-empty outer-trimmed.
- `variation_listing_copies_capture_session_version_check`: `capture_session_version >= 1`.
- `variation_listing_copies_capture_time_check`: `capture_started_at <= captured_at`.

`variation_listing_copies_prevent_identity_update` is a `BEFORE UPDATE` trigger backed by
`public.prevent_variation_listing_copy_identity_update()`. It rejects changes to `copy_id`,
`variation_id`, all R2 keys, all capture/pair provenance, and creation timestamps. The service may
change only `availability_state`, `condition_token`, `condition_notes`, and `updated_at`; each such
mutation participates in the owning aggregate's desired-revision CAS. `set_variation_listing_copies_updated_at`
invokes `public.set_row_updated_at()`.

`variation_listing_copies_validate_aggregate_write`, backed by
`public.validate_variation_listing_copy_aggregate_write()`, runs on `INSERT`, `UPDATE`, and `DELETE`.
It resolves the owning group through the variation and requires the same aggregate scope/group/expected
revision settings. Deferred companion `variation_listing_copies_require_revision_advance` re-queries
that group at commit and requires both `desired_revision = configured_expected_revision + 1` and the
exact same-transaction group/revision proof. Direct copy mutation without the owning aggregate CAS in
that transaction fails even when an earlier transaction already advanced the group to the target number.

### Representative-copy cycle and transaction sequence

`variation_listing_variations.representative_copy_id` has this exact foreign key:

```sql
FOREIGN KEY (variation_id, representative_copy_id)
  REFERENCES public.variation_listing_copies (variation_id, copy_id)
  ON UPDATE NO ACTION ON DELETE NO ACTION
  DEFERRABLE INITIALLY DEFERRED
```

The variation's `representative_copy_id` is nullable only inside the creation transaction. A deferred
constraint trigger named `variation_listing_variations_require_representative` (backed by
`public.require_variation_listing_representative_copy()`) runs `AFTER INSERT OR UPDATE` on each
variation and is `DEFERRABLE INITIALLY DEFERRED`. At deferred execution it re-queries the current row
by `variation_id`: a deleted row is skipped, a surviving row with null representative raises, and a
surviving non-null row passes. It must not inspect the queued event's stale `NEW` value. The FK proves
ownership; the trigger proves eventual non-nullness.

The only valid first-copy sequence is:

1. Insert variation with `representative_copy_id = NULL`.
2. Insert its first copy with matching `(variation_id, copy_id)`.
3. Update that variation's `representative_copy_id = copy_id`.
4. Commit, allowing the deferred FK and non-null trigger to check the complete state.

The service chooses the first copy as the default representative. Repointing is explicit and staged;
it must occur before deleting the current representative. Selling or making a representative copy
unavailable never auto-repoints it. A delete transaction that removes a representative must first
update the variation to another same-variation copy (or delete the variation in the same transaction);
`NO ACTION` plus deferred checking rejects an orphan at commit. Copy deletion is otherwise service-role
only and only for an eligible unsold/unprotected local aggregate; YP2.8 adds order/sold guards.

## Durable intake sessions — `public.variation_listing_intake_sessions`

| Column | PostgreSQL contract | Meaning |
| --- | --- | --- |
| `capture_source_key` | `text` PK, `NOT NULL`, no default | Immutable station/capture-source identity; one row survives idle/restart. |
| `session_version` | `bigint NOT NULL DEFAULT 1` | Positive monotonic version for target/mode/price CAS. |
| `mode` | `text NOT NULL DEFAULT 'idle'` | Exactly `idle`, `new_variation`, or `duplicate_copy`. |
| `target_group_id` | `uuid` nullable | Sticky target group; required for either non-idle mode. |
| `target_variation_id` | `uuid` nullable | Required only for `duplicate_copy`; must belong to `target_group_id`. |
| `sticky_price_amount` | `numeric NOT NULL DEFAULT 0.99` | Sticky exact basket amount `(0.99, 1.49, 1.99, 2.49)`, retained through idle. |
| `sticky_price_currency` | `text NOT NULL DEFAULT 'USD'` | Exact `USD`. |
| `pending_pair_id` | `uuid` nullable | Pair snapshot identity; all pending columns are null or populated as one snapshot. |
| `pending_pair_session_version` | `bigint` nullable | Version observed at first image; must equal current `session_version` until completion/recovery. |
| `pending_pair_mode` | `text` nullable | Snapshot of `new_variation` or `duplicate_copy`. |
| `pending_pair_target_group_id` | `uuid` nullable | Snapshot target group. |
| `pending_pair_target_variation_id` | `uuid` nullable | Snapshot target variation; null only for new-variation mode. |
| `pending_pair_price_amount` | `numeric` nullable | Snapshot sticky price. |
| `pending_pair_price_currency` | `text` nullable | Snapshot currency, exactly `USD`. |
| `pending_pair_front_source_ref` | `text` nullable | Exact front source reference captured first. |
| `pending_pair_started_at` | `timestamptz` nullable | First-image snapshot time. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation audit timestamp. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Trigger-maintained session timestamp. |

Constraints/FKs/indexes:

- `variation_listing_intake_sessions_pkey`: primary key `(capture_source_key)`.
- `variation_listing_intake_sessions_capture_source_key_check`: non-empty outer-trimmed source key.
- `variation_listing_intake_sessions_session_version_check`: `session_version >= 1`.
- `variation_listing_intake_sessions_mode_check`: exact three modes.
- `variation_listing_intake_sessions_target_mode_check`: idle requires both targets null; new variation
  requires a group and null variation; duplicate copy requires both.
- `variation_listing_intake_sessions_target_group_id_fkey`: nullable group target references groups with
  `ON UPDATE NO ACTION ON DELETE NO ACTION`.
- `variation_listing_intake_sessions_target_variation_group_fkey`: nullable composite
  `(target_group_id, target_variation_id)` references variations `(group_id, variation_id)` with
  `ON UPDATE NO ACTION ON DELETE NO ACTION`; this proves duplicate target membership.
- `variation_listing_intake_sessions_sticky_price_check` and `_currency_check`: exact four USD baskets.
- `variation_listing_intake_sessions_pending_pair_all_or_none_check`: either every required pending
  field is null or `pending_pair_id`, positive version, mode, group, price/currency, front ref, and start
  time are all non-null; pending variation is non-null exactly when mode is `duplicate_copy`. YP2.2a
  uses exhaustive `IS NULL`/`IS NOT NULL` branches (or `num_nonnulls`) so SQL `UNKNOWN` cannot admit a
  partial snapshot.
- `variation_listing_intake_sessions_pending_pair_price_check` and `_currency_check`: snapshot exactly
  matches the four USD baskets.
- `variation_listing_intake_sessions_pending_pair_mode_check`: nullable snapshot mode is only
  `new_variation` or `duplicate_copy`.
- `variation_listing_intake_sessions_pending_pair_group_fkey` and
  `variation_listing_intake_sessions_pending_pair_variation_group_fkey`: same nullable group/composite
  FKs as current targets, proving snapshot duplicate variation belongs to its snapshotted group.
- `variation_listing_intake_sessions_pending_pair_version_check`: positive and equal to the current
  `session_version` while pending (the service preserves this equality; SQL rejects stale writes).
- `variation_listing_intake_sessions_pending_pair_current_snapshot_check`: when pending,
  `pending_pair_mode = mode`, both target IDs are `IS NOT DISTINCT FROM` their current target IDs, and
  pending price/currency equal current sticky price/currency. With no pending pair, every pending field
  is null. A target/mode/price rewrite during a half-pair therefore fails at SQL.
- `variation_listing_intake_sessions_pending_pair_source_check`: front source ref non-empty trimmed;
  pending pair ID/start time are jointly present.
- `variation_listing_intake_sessions_capture_source_idx`: no additional index is needed beyond the PK;
  optional queue scans use `(updated_at)` if YP3.1 demonstrates a need.

`variation_listing_intake_sessions_validate_transition` is a `BEFORE UPDATE` trigger backed by
`public.validate_variation_listing_intake_session_transition()`. It rejects identity/`created_at`
changes, version decreases/skips, and every transition except:

1. no-op: all domain/session fields and version unchanged; only trigger-maintained `updated_at` differs;
2. target/mode/price change: old and new pending snapshots empty; version increases by one;
3. first image: current configuration/version unchanged; one complete matching snapshot is set;
4. successful second image: configuration/version unchanged; the complete snapshot is cleared;
5. discard/recovery: configuration unchanged; snapshot cleared; version increases by one.

While populated, a pending snapshot is immutable. `set_variation_listing_intake_sessions_updated_at`
invokes `public.set_row_updated_at()`.

## Session CAS and pair lifecycle

All session writes use a transaction and `SELECT ... FOR UPDATE` on the exact
`capture_source_key` row. A target, mode, or sticky-price change is accepted only when the caller
supplies the current `session_version`, no pending pair exists, and all requested values pass the
mode/target checks. The service then increments `session_version` by exactly one. A no-op update does
not increment. A target/mode/price update with a pending pair is rejected; the half-pair cannot be
silently rerouted.

The first image of a pair locks the row, confirms the mode/target is non-idle and valid, and atomically
records every pending snapshot column from the current row plus the front source reference and start
time. It does **not** increment `session_version`. The second image locks the same row and must match
the pending pair's exact current version, mode, target group/variation, sticky price/currency, and pair
identity. On success, the aggregate transaction allocates/persists the variation/copy (or duplicate
copy), records the snapshot provenance on the copy, and clears every pending column in the same commit.
It does not change session version because target/mode/price did not change.

If completion retries after that commit, unique `capture_pair_id` resolves the existing copy. The
service returns it only when capture source, session version, target variation, both source refs, and
both R2 keys match exactly; any mismatch fails closed. It never inserts a second copy for one pair.

If the second image, current row, or snapshot differs, the service fails closed and leaves the durable
snapshot for operator recovery; it never guesses a target or creates a duplicate. Restart resumes from
the persisted snapshot. An explicit discard/recovery action must lock the row, clear the complete
snapshot, and increment `session_version` exactly once. Idle/restart does not delete or reset session
rows. Legacy Single/Lot watcher state never reads this table.

## Structured SKU allocation contract

The existing `packages/types/src/structured-sku.ts` parser accepts only
`<category>-<Single|Lot>-<six digits>` and the legacy watcher allocates Single and Lot independently:
it reads the latest sequence for that listing-type prefix, proposes the next value, attempts the insert,
and retries a unique collision with a fresh candidate. The six-digit suffix alone is therefore **not** a
global unique ID; `Single-000241` and `Lot-000241` are independent namespaces. Existing parser,
allocator, output, and `public.listings` checks remain unchanged.

Variation listings add a dedicated parser/allocator later. They reuse the same six-digit range and
non-zero formatting but use `<sku_category_code>-<sku_bucket_token>-<six-digit inventory serial>`.
The bucket token is an analogous allocation/search namespace, not a claim that serials are globally
unique across Single/Lot or category prefixes. Application-owned variation SKU uniqueness is provided
by the complete variation `sku` unique constraint. `(sku_category_code, sku_bucket_token)` is also
unique on groups, so two group allocators cannot generate the same stream. Reserved `Single`/`Lot`
tokens make the variation grammar disjoint from every valid legacy structured SKU, so no racy
cross-table preflight is used. A later publish-readiness read still fails closed on a foreign remote
Inventory SKU collision; it never adopts or overwrites that resource.

The group persists the category code, bucket token, and next-serial high-water mark; each variation
persists the allocated integer `inventory_serial` and exact full `sku`. Copies never allocate a SKU.
The bucket token and category code are immutable from group insertion. A serial consumed by a committed
aggregate transaction is never reused, including after eligible local variation deletion. A group with
`next_inventory_serial > 1` is retained permanently (at least as an abandoned/tombstoned local bucket),
preserving its namespace key and high-water; only a group that never allocated a serial may be hard-deleted.
When `next_inventory_serial = 1000000`,
allocation fails closed with overflow; no wrap, reuse, collision retry, or guessed value is allowed.

The exact allocator transaction is:

1. Begin the aggregate transaction and lock the group row `FOR UPDATE`.
2. Re-read category/token/high-water and verify the expected group revision CAS.
3. If high-water is `1000000`, abort with overflow. Otherwise set `serial = next_inventory_serial` and
   `next_inventory_serial = serial + 1` under `app.variation_listing_write_scope = 'aggregate'`.
4. Construct the exact SKU using the group code/token and six-digit zero-padding; insert the variation
   with that integer and full SKU in the same transaction.
5. A complete-SKU unique violation is a fail-closed collision/integrity error; do not select another
   serial or retry after a committed allocation. Rollback before commit leaves the high-water update
   uncommitted, but a committed serial is never returned to the pool.

The group lock serializes concurrent allocators for one bucket. The variation-SKU unique index protects
cross-group collisions. A dedicated variation parser validates this grammar later; it must not modify
the legacy parser or make Single/Lot prefixes accept bucket tokens.

## Revision watermarks and staged local state

`desired_revision` and `last_confirmed_revision` are the only initial local revision state. Pending is
derived exactly as:

```text
pending = last_confirmed_revision IS NULL
       OR last_confirmed_revision < desired_revision
```

Every aggregate mutation (group/variation/copy membership, reorder, price, representative, condition,
availability, metadata, or derived common-aspect recomputation) executes in one transaction, locks the
group row, requires caller `expected_desired_revision = desired_revision`, applies all row changes, and
sets `desired_revision = old + 1`. A stale expected value aborts without partial writes. The service may
coalesce several field changes into one transaction/one increment; it may not increment twice for one
commit or write a revision number supplied by a client. The guarded mutation predicate is equivalent to
`SELECT ... FOR UPDATE` followed by `UPDATE ... SET desired_revision = desired_revision + 1 WHERE
group_id = :group_id AND desired_revision = :expected_desired_revision`; exactly one row must update.

YP2.5 creates an immutable revision snapshot/digest and operation ledger from a captured desired
revision. Only after exact remote reads confirm that ledger intent may the service lock the group and
CAS `last_confirmed_revision` from its expected previous value to the confirmed revision. The guarded
update predicate is equivalent to:

```sql
UPDATE public.variation_listing_groups
SET last_confirmed_revision = :confirmed_revision
WHERE group_id = :group_id
  AND last_confirmed_revision IS NOT DISTINCT FROM :expected_previous
  AND :confirmed_revision >= GREATEST(COALESCE(last_confirmed_revision, 0), 1)
  AND :confirmed_revision <= desired_revision;
```

The service requires exactly one affected row. It may set a value only in the range
`previous <= confirmed <= desired_revision`; it never decreases or advances beyond the desired watermark.
If local mutations advanced `desired_revision` meanwhile, the confirmed value remains lower and pending
stays true. Reconfirming the same value is an idempotent no-op; a stale expected-confirmed value fails.

No eBay publish, revision, offer mutation, remote checkpoint, or remote-ID write is represented by these
four tables. Until YP2.5 exists and is separately reviewed, all groups remain local/staged even when
`desired_revision` is nonzero.

## Aggregate/service invariants

The database enforces row shape and the relational constraints above. The aggregate service must load
the complete group, variations, copies, and relevant session state in one transaction and enforce:

- A group may contain zero variations in an intake bucket and one variation while a card is being
  built. A publish-ready or publish attempt requires at least two and no more than the configurable
  admission cap (initially 2 or 3; default 2).
- For every non-empty set, positions are exactly `0..n-1`; empty is vacuously gapless. Reorder rewrites
  all affected positions atomically under the deferred unique constraint.
- Selector values are NFC-normalized plus outer-trimmed once, case-sensitive, non-empty, unique in the
  group, and contain only card identity. The only eBay pivot is the custom `Card` selector.
- Every variation has one representative copy at commit; the representative belongs to that variation.
  Repointing is explicit and precedes deletion. Availability changes never auto-repoint.
- All copies marked `available` have a condition compatible with the group's shared eBay condition.
  An incompatible copy may be retained only as `unavailable` or moved to a compatible group; it may
  not weaken the group's condition. Desired quantity is exactly `COUNT(*)` of available copies for the
  variation. No quantity column or manual quantity authority exists.
- Initial category `261328` compatibility is deterministic. Group and copy each persist one canonical
  token ranked `POOR=0`, `VERY_GOOD=1`, `EXCELLENT=2`, `NEAR_MINT_OR_BETTER=3`; a copy may be
  `available` only when its rank is at least the group's minimum rank. The group service also requires
  raw-card `condition_id = '4000'` and validates `condition_descriptors` through the existing
  category/token-to-descriptor mapping. Another category/condition contract must be explicitly added
  before such a group can contain available copies or become publish-ready.
- `derived_common_ebay_aspects` is recomputed from the complete variation metadata set in the same
  mutation transaction: SINGLE aspects require one truthful common value, MULTI aspects use set
  intersection (never union), heterogeneous optional/recommended values are omitted, and required
  no-common values block publication or require regrouping.
- Group shared category, marketplace, fixed-price format, location, policies, condition, and selector
  invariants are identical throughout the aggregate. Titles/descriptions are group-owned.
- Group/variation/copy UUIDs, group key, category/token after allocation, variation serial/SKU/selector,
  copy R2 keys, and capture provenance are immutable. Identity is never reused.
- Local changes are staged; explicit Publish Changes is the only later remote entry point. Nothing in
  intake, copy persistence, or revision watermark mutation invokes eBay.

No SQL row check pretends to prove sibling gaplessness, common metadata, condition compatibility,
representative ownership beyond the FK, or derived quantity. Those are service-level aggregate rules.

## RLS, grants, timestamps, rollback, and generated types

All four tables enable RLS. The initial migration must revoke all table privileges from `anon` and
`authenticated`, grant all table privileges to `service_role`, and create no browser policy. The UI
uses a trusted server/API seam; a later authenticated read policy is a separate review. No speculative
`owner_user_id` column is added.

Each table has `created_at`/`updated_at` defaults, a dedicated updated-at trigger, and named identity
guards above. The migration must create dedicated functions/triggers without changing the shared
`set_row_updated_at()` function or any legacy trigger. All foreign keys use `NO ACTION` unless this
document explicitly says otherwise; service deletion is dependency ordered and service-role-only.
The first additive migration uses fail-closed `CREATE FUNCTION` for every dedicated variation-listing
function; it does not silently replace an unexpected pre-existing function with the same signature.

After YP2.2a is locally validated, the normal generation workflow adds `Row`, `Insert`, `Update`, and
`Relationships` entries for these four tables to `packages/data/src/database-generated.ts` (UUID/time
as `string`, integer/numeric as `number`, JSONB as generated `Json`). No manual `database.ts` overlay is
needed. Generated types are not edited in YP2.1 and no runtime type is added here.

YP2.2a implements the forward contract in
`supabase/migrations/20260828150000_create_variation_listing_persistence.sql`. Its manual-only,
pre-apply rollback is
`supabase/rollbacks/20260828150000_create_variation_listing_persistence.rollback.sql`; keeping it
outside `supabase/migrations` prevents the destructive SQL from entering the automatic forward
migration sequence. The rollback takes exclusive locks, aborts unless all four namespaced tables are
empty, then drops intake sessions, copies, variations, groups, and only the dedicated functions in
reverse dependency order. It never drops the shared updated-at helper, legacy objects, or generated
legacy types. After any durable data or shared apply, use an additive compensating migration preserving
UUIDs, serials, images, and evidence; a Git rollback is not a database rollback.

Forward DDL order is groups, variations without the representative FK, copies, intake sessions, then
`ALTER TABLE variation_listing_variations` to add the deferred composite representative FK and its
deferred current-row constraint trigger. This mechanically breaks the relational creation cycle.

## Compatibility proof

The contract is additive under `variation_listing_*`. It does not alter the legacy Single/Lot SKU
grammar or allocator, `public.listings`/`jobs`/`orders`/`app_settings`, existing enums/checks/RLS,
watcher capture unions, repositories, routes, pricing providers, or generated legacy types. Variation
listing generation remains Gemini-only with manual four-tier prices; SoldComps/Browse are not coupled.
No migration SQL or database write belongs to YP2.1.
