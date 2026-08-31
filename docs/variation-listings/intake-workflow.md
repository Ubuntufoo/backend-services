# Variation-listing target-aware intake contract (YP3.1)

## Scope and source of truth

This document is the current application contract between the watcher/capture pipeline and the
six-table variation-listing persistence/RPC seam after YP2.9b. It defines session targeting, one
front/back capture pair, restart authority, completion inputs/outputs, and fail-closed behavior. It
does not implement watcher routing, filesystem/R2 writes, Gemini generation, eBay calls, or
Supabase mutations.

For intake-session shape and transitions, this document supersedes the pre-YP2.9 session-version
and duplicated pending-column descriptions in `persistence-design.md` and older architecture
sections. Those descriptions are historical. The deployed row has one `pending_pair` JSON value;
the stable TypeScript/RPC boundary is the one exported from:

- `packages/data/src/variation-listing-transactions.ts` — `ConfigureVariationListingIntakeInput`,
  `StartVariationListingIntakePairInput`, the two completion inputs, and
  `VariationListingTransactionGateway`;
- `packages/data/src/repositories/variation-listings.ts` —
  `validateVariationListingPendingPair`, `VariationListingIntakeSession`, and row mappers; and
- `packages/data/src/variation-listing-rpc.ts` —
  `createSupabaseVariationListingTransactionGateway` and response-parity checks.

## Product and legacy boundary

One group is a long-lived inventory bucket. One variation is one selector/SKU identity; one copy is
one physical card under that variation. A duplicate copy replenishes the existing variation and
never creates a duplicate selector or SKU. Local capture changes the staged desired aggregate only;
no eBay, market-pricing, or publication action is part of this contract.

Variation intake is a separate capture path. The legacy `CaptureMode` union remains exactly
`single_2_image | lot_3_image` (`packages/types/src/index.ts`). The existing watcher grouping state,
`consumeImageGrouping`, Single/Lot allocator, `public.listings` persistence, processed-directory
behavior, and all legacy state transitions remain unchanged. Variation intake must not add a mode to
that union, call the legacy grouping path, or write `public.listings`.

## Durable session state

There is one `variation_listing_intake_sessions` row per immutable `capture_source_key` (the
station/camera identity). The current row shape is:

| Field | Contract |
| --- | --- |
| `capture_source_key` | Non-empty immutable source identity; session primary key. |
| `mode` | Exactly `idle`, `new_variation`, or `duplicate_copy`. |
| `target_group_id` | Required for either non-idle mode; null in `idle`. |
| `target_variation_id` | Null in `idle` and `new_variation`; required in `duplicate_copy`, and proven to belong to `target_group_id`. |
| `sticky_price_amount` | Exactly `0.99`, `1.49`, `1.99`, or `2.49`; retained through `idle`. |
| `sticky_price_currency` | Exactly `USD`; no other currency is supported. |
| `pending_pair` | Null, or one complete frozen JSON snapshot defined below. |

The row also has ordinary `created_at`/`updated_at` audit fields. There is no `session_version`,
`pending_pair_id`, or other duplicated pending column in the current six-table schema.

The sticky target is the pair `(target_group_id, target_variation_id)` interpreted by `mode`.
`new_variation` targets a group only; `duplicate_copy` targets one existing variation in that group.
The sticky price is the default manual price for a new variation. It remains visible and selectable
while idle; it is not applied to duplicate copies.

### Configuration transitions

`configureIntake` calls the existing `configure_variation_listing_intake` RPC with the source key,
mode, target IDs, and price amount (currency is fixed to USD):

1. The requested mode/target combination is validated. A non-idle mode requires an existing target
   group; `duplicate_copy` additionally requires an existing target variation that belongs to that
   group, while `idle` requires both target IDs to be null.
2. With no pending pair, arming a target, changing mode/target, changing the sticky price, or
   disarming to `idle` is allowed. The current seam has no caller session-version argument; these
   no-pending changes are last-write-wins, and an exact no-op is harmless.
3. Disarming means `mode = idle` with both target IDs null. It does not erase the sticky price.
4. With a pending pair, every mode, target, and price change is rejected as a conflict. No current
   configuration or pending value is rewritten around a half-pair.

The service/API seam owns authorization and validation; browser roles do not write the table
directly. A session row remains durable while idle and across process restart.

## Frozen pending-pair snapshot

The first image creates exactly one `pending_pair` JSON object through
`start_variation_listing_intake_pair`. Required keys and meanings are:

```json
{
  "pair_id": "<pair UUID>",
  "mode": "new_variation | duplicate_copy",
  "target_group_id": "<group UUID>",
  "target_variation_id": "<variation UUID> | null",
  "price_amount": 0.99,
  "price_currency": "USD",
  "front_source_ref": "<exact source reference>",
  "started_at": "<ISO timestamp>",
  "expected_desired_revision": 0
}
```

`price_amount` may be any one of the four manual tiers. `target_variation_id` is null exactly in
`new_variation` mode. `expected_desired_revision` is the target group's desired-revision value read
when `startIntakePair` creates the snapshot for the first image; it is a non-negative integer and is
not supplied by the watcher as a rebase hint. The pending object is all-or-none and must contain no
partial substitute for these facts.

While pending, the snapshot is authoritative for mode, target, price/currency, front source, pair
identity, start time, and expected revision. The current session fields must continue to agree with
the snapshot and are a consistency check, not permission to retarget. There is no in-memory or
local-file fallback that may replace a durable pending value after restart.

## Front/back progression and restart behavior

The existing watcher boundary exposes an incoming image as `WatcherImageDescriptor.path`. YP3.2
uses that exact incoming path string as `frontSourceRef` or `backSourceRef`; it must not switch
normalization rules after a pair starts. Processed local paths are not image authority.

### First image

An operator or watcher with a valid non-idle session generates one UUID `pair_id` and calls
`startIntakePair({ captureSourceKey, pairId, frontSourceRef, startedAt })`. The RPC locks the source
session, confirms that no pair is pending and that the current mode/target are valid, reads the
target group's current desired revision, and stores the complete snapshot atomically. It does not
allocate a variation/SKU/copy and does not change the session configuration.

`startedAt` is an instant, not a presentation string. YP3.2 must normalize it once and the data
gateway must compare returned timestamps by instant (or by one shared canonical RFC 3339 form),
not by caller spelling. The current strict string parity check can observe PostgreSQL's normalized
offset spelling after the pending row has already committed; that failure must never trigger a
blind second start.

If a durable pending pair is already present, a second start event is not a new pair: load and resume
the stored snapshot. A repeated event with the stored `front_source_ref` is a duplicate front
notification, not the back image; ignore it after confirming the same pending pair. A different
front-replacement event is quarantined until explicit discard. Never silently replace the stored
pair, source, target, or price.

### Second image

After restart or normal progression, the back-image event must be routed by the same
`capture_source_key` and the stored `pair_id`. Before completion, the service requires:

- pending mode and target still identify the intended new group or duplicate variation;
- the target group's current `desired_revision` equals `expected_desired_revision`;
- the back source reference is a non-empty exact value for this pair; and
- the completion inputs identify the same pair and target and carry the exact front/back R2 keys.

The new-variation or duplicate-copy completion RPC performs the group lock, compatibility checks,
aggregate write, desired-revision CAS, capture-pair idempotency check, and pending-pair clear in one
database transaction. A successful transaction clears all pending state. No eBay or Gemini call is
implied.

Missing source, an unexpected source path, a different pair ID, target/mode/price disagreement,
corrupt pending JSON, missing target, or any R2/provenance mismatch fails closed: quarantine the
unexpected input as an implementation concern, create no copy or variation, and leave the durable
pending snapshot for recovery. On process restart, resume only from that snapshot.

`discardIntakePair(captureSourceKey)` is the explicit recovery action. It clears only
`pending_pair`, preserves the current mode, target, and sticky price, and permits a deliberate
restart (or a subsequent no-pending `configureIntake` change). It must not retarget, rebase, or
silently complete the discarded pair.

## Stale-revision and mismatch rule

`expected_desired_revision` is a hard compare-and-swap guard. If any local group mutation advances
the target group's desired revision after the front image, completion returns a stale-pair conflict;
it does not rebase the pending pair, retarget it, or consume a serial. The operator must discard the
pair and explicitly restart against the current target/revision. A missing/deleted target, a target
variation that no longer belongs to the target group, or a current session that conflicts with the
snapshot is handled the same way.

The stale rule also applies after an interrupted process: the stored revision remains the one to
check. A restart may retry the exact pair only while all frozen facts and current revision still
match; it may not infer a newer target or revision from UI state.

## Completion contract: new variation

`completeNewVariation` uses the existing
`CompleteVariationListingNewVariationInput` fields:

- `captureSourceKey`, `capturePairId`, immutable `variationId`, and immutable `copyId`;
- `selectorValue` (one canonical card identity) and `variationMetadata` (the application-owned
  metadata handoff);
- explicit `conditionToken`;
- exact `frontR2Key`, `backR2Key`, and `backSourceRef`; and
- optional `capturedAt` (the RPC supplies its default when omitted).

The front source reference and capture start time come from the frozen pending snapshot; they are
not replaced by a second-image event. The completion transaction validates the pair and target,
allocates one variation serial/SKU in the target group, inserts one variation and its first copy,
sets that first copy as the variation's representative, applies the frozen sticky manual price,
and increments the group's desired revision exactly once. A committed serial is never reused.

The raw RPC payload is `{ group_row, variation_row, copy_row }`; the application-facing gateway
returns `{ group, variation, copy }`, each represented by the existing
`VariationListingGroupRow`, `VariationListingVariationRow`, and `VariationListingCopyRow` types.
The variation row owns selector, metadata, immutable SKU, and manual price; the copy row owns
condition, front/back R2 keys, source provenance, and `capture_pair_id`.

YP3.1 only defines the metadata handoff. It does not authorize or implement Gemini. Price remains
the frozen manual tier; no Gemini, SoldComps, Browse, or automatic pricing value is accepted.
`variationMetadata` equality is semantic JSON equality; YP3.3 must canonicalize JSON or replace the
current property-order-sensitive stringify parity check before multi-key metadata reaches this seam.

## Completion contract: duplicate copy

`completeDuplicateCopy` uses the existing
`CompleteVariationListingDuplicateCopyInput` fields:

- `captureSourceKey`, `capturePairId`, immutable new `copyId`, and the frozen target
  `variationId`;
- explicit `conditionToken`;
- exact new `frontR2Key`, `backR2Key`, and `backSourceRef`; and
- optional `capturedAt`.

The transaction verifies that the target variation belongs to the frozen target group, creates only
the new physical copy, and increments the group's desired revision exactly once. It reuses the
existing variation's selector, SKU, metadata, representative choice, and manual price. The sticky
session price is display/configuration context only in this mode. No new variation ID, inventory
serial, selector, SKU, price, metadata generation, or Gemini call is permitted.

The raw RPC payload is `{ group_row, copy_row }`; the application-facing gateway returns
`{ group, copy }`. Desired quantity remains derived from the count of `available` copies under the
existing variation; no manual quantity row is created.

## Per-copy condition handoff

Every completion supplies one explicit canonical coarse condition token:

```text
POOR < VERY_GOOD < EXCELLENT < NEAR_MINT_OR_BETTER
```

An available copy admitted to a group must have a rank equal to or better than the group's shared
condition tier. Physical copies may differ internally, but intake completion must reject an
incompatible token; it must not silently weaken the group or convert the completion into an
`unavailable` copy. Condition changes on a completed pair are retry mismatches, not upgrades.

## R2 ownership and provenance

YP3.2 owns storage processing; YP3.1 defines the deterministic ownership boundary only. Both R2
objects for one copy are immutable and use the IDs that own them:

```text
variation-listing/<group_uuid>/<variation_uuid>/<copy_uuid>/front-<content_hash>.<ext>
variation-listing/<group_uuid>/<variation_uuid>/<copy_uuid>/back-<content_hash>.<ext>
```

The path contains no title, selector text, position, price, or listing ID. The copy row persists
front/back keys plus capture source/pair provenance. A failed or uncommitted upload may not be
retargeted to another group, variation, copy, or pair; cleanup/retry of uncommitted objects is a
later storage concern and cannot authorize a different completion.

## Capture-pair idempotency and retry

`variation_listing_copies.capture_pair_id` is unique and is the completion idempotency key. Once a
pair has committed and its pending snapshot has cleared, an acknowledgement retry with the exact
same semantic inputs returns the persisted result without allocating another ID, SKU serial, copy,
or desired-revision increment.

The current completion inputs/RPC retry branch can directly compare capture source key, pair ID,
variation/copy IDs, selector value and semantic metadata (new variation), condition token,
front/back R2 keys, and back source reference. Any difference in those values fails closed. The
front source, mode, frozen price, and expected revision came from the now-cleared pending snapshot
and are not completion arguments. YP3.3 must add a narrow copy lookup by unique
`capture_pair_id` and compare the persisted `capture_front_source_ref` before acknowledging a
completed pair. The discriminated completion command retains its original completion kind; if that
caller context is unavailable after restart, read and return an `already_completed` result with
`completionKind = unknown` instead of reconstructing or invoking an opposite-mode completion. The
six-table rows do not durably retain completion kind after `pending_pair` clears, and the current RPC
alone cannot prove a post-clear mode or changed-front-source mismatch. A retry must never repair a
mismatch by overwriting the persisted copy or by creating a second copy.

## Minimum later DTO boundaries

YP3.2 owns the watcher/storage side of this contract. It should:

- read/map the durable intake session and validated `pending_pair` state needed to route an incoming
  watcher event, without wiring watcher code directly to mutation RPCs;
- carry `WatcherImageDescriptor.path` into the exact `frontSourceRef`/`backSourceRef` boundary;
- normalize `startedAt` once as an instant;
- establish immutable group/variation/copy image ownership and deterministic R2 keys; and
- produce a small discriminated completion command containing the frozen routing facts, immutable
  identities, condition/metadata handoff, and exact front/back source/R2 references needed by the
  persistence workflow.

YP3.2 stops at that routed, storage-ready command. It does not call `completeNewVariation` or
`completeDuplicateCopy`, perform post-clear `capture_pair_id` reconciliation, advance
`desired_revision`, consume an inventory serial, or otherwise persist the completion through
`VariationListingTransactionGateway`.

YP3.3 owns the persistence/reconciliation side. It should wire the watcher-facing intake operations
to the existing typed transaction gateway/RPC seam, including configure/start/discard as needed by
the durable-session workflow and the appropriate completion RPC. It also owns the unique
`capture_pair_id` provenance lookup after pending state has cleared, exact retry/idempotency
reconciliation, semantic JSON comparison/canonicalization for `variationMetadata`, and committed
result handling. If original caller context is unavailable after restart, the persistence workflow
may return an `already_completed` result with `completionKind = unknown`; it must not reconstruct
completion kind from mutable UI/session state or invoke the opposite completion mode.

Neither task should add a generic event bus, queue, workflow engine, multi-user session model, or a
second capture-mode union.
