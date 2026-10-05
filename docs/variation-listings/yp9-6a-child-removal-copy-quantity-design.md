# YP9.6a — Child retirement and physical-copy quantity adjustment design

Status: **historical design context; partially superseded by the YP9.6b1 / YP9.6b2 / YP9.6c roadmap direction.** The operator-authorized clean reset discarded all historical Variation rows on 2026-10-05; Standard Single/Lot data is production data, was verified unchanged, and is never disposable. This document itself does not authorize hosted, eBay, or R2 mutation.

> Supersession note (2026-10-02): the operator rejected the per-copy live-inventory model described in Contract A. Physical copy rows/images remain historical capture and intake evidence only; `number of captured copy rows != current sellable quantity`, and the app must never infer which `copy_id` sold. Post-publication quantity changes now use a **variation/SKU-level cumulative adjustment counter**. For each active publish, `new adjustment delta = current counter - previous confirmed counter`, then `desired quantity = fresh remote eBay sellable quantity + new adjustment delta`. Whole-variation removal remains a separate YP9.6c concern and retains the zero-quantity-then-group-membership-removal safety investigation below.

> Clean-reset completion note (2026-10-05): the operator confirmed all historical published Variation tests were withdrawn and authorized the purge. The manual artifact cleared only its six named `public.variation_listing_*` tables; protected Standard/non-Variation counts and deterministic fingerprints remained unchanged. YP9.6b1 was then applied and directly verified. Snapshot v3 is the clean persisted active baseline; historical v1/v2 revisions were not retained. The first post-reset test must use a brand-new SKU bucket token absent from every enumerated historical remote namespace; never silently reuse a retained token. No fresh post-reset publication or replenishment test has run.

## Operator requirements

1. Remove one card/child variation from a Variation listing without destroying its history.
2. Reduce or restore sellable quantity when a specific physical copy becomes damaged, lost, or returns to sellable stock.
3. Preserve the existing rule that eBay is authoritative for post-publication sellable quantity; local copy rows are evidence and operator inventory records, not an inferred record of which copy sold.
4. All active-listing changes remain staged until the operator explicitly chooses **Publish Changes**.

## Current architecture findings

- `variation_listing_copies.availability_state` already supports `available | unavailable`.
- A service-role-only `update_variation_listing_copy_availability` RPC and data-gateway method already exist, but the current dedicated HTTP router/schema and frontend expose no copy-availability mutation.
- The current copy-availability RPC is active-only and advances `desired_revision` with CAS and exact group/variation/copy ownership.
- The aggregate API currently exposes every copy's `availabilityState`, but `copyCount` is total captured copies, not available/sellable copies.
- Initial payload quantity is derived from the number of local copies whose availability is `available`.
- Active revisions correctly read the current eBay Inventory Item and Offer quantities and use the lower value as the remote sellable baseline. This protects against sales that occurred after the last local revision.
- **Gap:** active desired quantity currently equals fresh remote sellable baseline plus newly captured available copies. It does not account for an existing copy changing `available -> unavailable` or `unavailable -> available`. Therefore the existing availability RPC alone cannot reduce or restore live eBay quantity.
- Active revision identity validation currently rejects removal of any previously confirmed variation.
- The current schema has no durable child-retirement/tombstone field. Hard deletion would discard the current operational record and complicate recovery even though older frozen revision snapshots retain historical JSON.
- Existing remote cleanup machinery can delete offers/items, but those destructive operations belong to whole-group withdrawal/cleanup. They should not be reused for ordinary removal of one child from an active multiple-variation listing.

## eBay contract checked 2026-10-01

Current official Inventory API documentation states:

- `createOrReplaceInventoryItemGroup` is full replacement. Omitting a SKU from `variantSKUs` removes that inventory item from the inventory item group.
- `updateOffer` revises a published offer/live listing in real time.
- Quantity exists at Inventory Item and Offer level; the effective listing quantity is the lower value when both are populated. eBay's bulk quantity guidance says quantity changes should update both levels.
- Quantity `0` produces an out-of-stock offer/listing state.
- Inventory-API-created listings must be revised through Inventory API.
- eBay documentation does not provide enough evidence to treat deleting one published child offer as a safe child-removal primitive for this app. Normal YP9.6 child retirement must therefore avoid `deleteOffer` and `deleteInventoryItem`.

Before enabling **active child removal** for production use, YP9.6b must prove the zero-quantity + group-membership replacement sequence in Sandbox and inspect the exact child Offer/Inventory Item/group after-state. A failed/ambiguous Sandbox result keeps active child removal disabled; copy availability/quantity adjustment can remain independently shippable.

> **Do not implement Contract A as written.** It is preserved only to explain the audit that led to the simplified model. YP9.6b1/YP9.6b2 use variation-level `±1` staged adjustments and a cumulative counter; copy availability is not post-publication stock authority.

## Contract A — physical-copy availability / quantity

### UX

- Keep each immutable physical copy visible with front/back images, copy ID, condition, and a clear `Available` / `Unavailable` badge.
- Provide confirmation-driven **Mark unavailable (damaged/lost)** and **Restore to available** actions on the physical copy, not an arbitrary numeric quantity input.
- Keep `copyCount` as captured-history count for compatibility. Add an explicit `availableCopyCount` to the API/UI; never relabel total captured count as current eBay quantity.
- For active groups, state clearly that a copy availability change is **staged** and eBay quantity is unchanged until **Publish Changes** succeeds.
- Never claim or infer which local copy was sold. An operator marking a card unavailable asserts that the physical card is presently in hand/known and should reduce sellable inventory by one.

### Persistence/API

- Re-expose the existing narrow availability seam through:
  `PATCH /api/variation-listings/:groupId/variations/:variationId/copies/:copyId/availability`
  with `{ expectedDesiredRevision, availabilityState }`.
- Use the existing CAS/ownership/service-role pattern. An additive migration may replace the already-applied RPC to permit `intake`, `draft`, `review`, and `active`; keep `publish-ready`, `publishing`, recovery/unknown, withdrawn, and terminal lifecycles blocked.
- Do not add a free-form/manual quantity column.
- If making a representative copy unavailable while another available copy remains, require the operator to choose an available representative first. If the change makes the child quantity zero, retaining the historical representative image is allowed because the child is not sellable.
- Restoring an unavailable copy is the exact inverse operator action and advances one desired revision.

### Active quantity algorithm

Use the freshly reconciled eBay sellable quantity as baseline and apply only explicit local inventory deltas since the previous confirmed snapshot:

- newly captured available copy: `+1`
- existing confirmed copy `available -> unavailable`: `-1`
- existing confirmed copy `unavailable -> available`: `+1`
- unchanged copy state: `0`

Then:

`desired = freshRemoteSellable + additions - removals + restores`

Requirements:

- Reject negative desired quantity instead of clamping.
- Continue updating both Inventory Item quantity and Offer `availableQuantity` to the same desired value.
- Preserve the existing immediate pre-write paired Item/Offer reads, quantity-drift/reprepare behavior, journal checkpoints, unknown-outcome handling, and no-blind-retry rule.
- A concurrent sale after freeze must cause reprepare/reconciliation, never a stale overwrite.
- Sibling variations are untouched unless their own desired payload changed.

This delta model deliberately does **not** reconcile local captured-copy count to eBay quantity; sales remain represented only by the remote baseline.

## Contract B — child variation retirement/removal

### Persistence

Use an additive soft-retirement field on `variation_listing_variations` (recommended: nullable `retired_at timestamptz`; no hard delete). Keep the immutable variation ID, SKU, copies, R2 keys, timestamps, and all frozen revision history.

Add a narrow service-role-only CAS RPC for retire/unretire staging. It must prove exact group/variation ownership and permitted lifecycle and advance `desired_revision` once.

A child may be unretired while the retirement is only local/staged. Once an active retirement is remotely confirmed, restoring that previously removed child to the live group is outside the first YP9.6b scope; use a separately reviewed re-add path rather than silently reversing history.

### Pre-publication behavior

- Retired children are excluded from the desired eBay payload and visible active-child count but remain available in local history.
- Never delete their copies or R2 images.
- Initial publication still requires at least two non-retired variations with positive available quantity.
- Retirement is blocked while that variation/group is an armed or pending capture target unless intake is safely disarmed first.

### Active-listing behavior

For a confirmed active child, **Remove child** stages retirement locally. It does not contact eBay immediately.

On explicit **Publish Changes**, the active revision must:

1. Reconcile the last confirmed group, child identities, Offer IDs, listing ID, and fresh eBay quantities exactly.
2. Freeze the retiring SKU and its confirmed remote identity into the new immutable revision.
3. Drive both the retiring Inventory Item and its exact Offer to quantity `0`, with the same pre/post reads and unknown-outcome journal safety used for other active writes.
4. Replace the Inventory Item Group with a desired group payload that omits the retired SKU and its selector value while leaving every sibling identity/value unchanged.
5. Read back the group and prove the SKU is absent from membership and every remaining sibling is exact.
6. Re-read the retired child's Offer and Inventory Item. Do not delete either object in this normal path. Require a safe non-sellable after-state; persist evidence.
7. Confirm the revision only after all required after-state evidence is durable.

The operation order intentionally makes the child non-buyable before membership removal.

### Hard guards

- Block retirement if fewer than **two non-retired child variations** would remain. Converting a multiple-variation listing to one child is out of scope; withdraw/relist as a standard listing instead.
- Block on pending capture, stale desired revision, recovery required, unknown remote state, foreign/multiple offers, mismatched group/listing identity, or quantity drift that cannot be reprepared safely.
- Do not call `deleteOffer`, `deleteInventoryItem`, or whole-group withdrawal as part of ordinary child retirement.
- Do not renumber surviving positions/SKUs/serials merely for cosmetic compactness.
- Do not delete R2 images when retiring a child.
- If Sandbox proves eBay does not safely accept this active sequence, leave active child removal disabled and support only pre-publication retirement plus variation-level ±1 active quantity adjustment.

## Aggregate/API projection

- Add `retiredAt` to serialized variations.
- Add `availableCopyCount` while retaining existing `copyCount` as total captured copies.
- Build desired listing payloads from a **listing-eligible projection** of non-retired variations. Keep the full aggregate in durable snapshots/history so retired variations and their copies are not lost.
- Historical confirmed snapshots must continue to hydrate exactly as frozen; new desired projections must never rewrite old snapshots.
- Readiness validation applies the two-variation/positive-quantity requirements to non-retired variations only.

## Focused YP9.6b test plan

### Data/RPC

- availability CAS, ownership, no-op, lifecycle and service-role ACL
- representative-copy unavailable guard
- retire/unretire CAS, ownership, lifecycle, no-op and ACL
- retired rows/copies remain readable and unchanged
- migrations validate forward/rollback in disposable PostgreSQL; hosted application requires separate operator authorization

### Active quantity

- remote baseline 2 + one new copy => 3
- remote baseline 2 + one confirmed available copy marked unavailable => 1
- remote baseline 2 + one confirmed unavailable copy restored => 3
- remote baseline 0 + one unavailable delta => fail closed, never negative
- remote sale/quantity drift after freeze => reprepare/reconcile; no mutation from stale baseline
- one child's availability change does not rewrite sibling child/group payloads

### Child retirement

- pre-publication retire retains row/copies and excludes child from desired payload
- retire leaving fewer than two eligible variations is blocked from publish
- active retire freezes exact prior Offer/item/group identity
- retiring child quantity reaches 0 before group membership removal
- group replacement omits only retiring SKU/selector
- siblings remain byte-for-byte equivalent outside expected group membership
- unknown Item/Offer/group read or mutation outcome stops fail-closed with journal evidence and no blind replay
- no normal retirement path invokes Offer/Inventory Item deletion
- staged retirement may be undone before remote confirmation

### Frontend

- availability badge/action per copy; confirm before state change
- representative-copy guard is clear and actionable
- total captured vs locally available counts have distinct labels
- active changes show staged/publish-required language
- child removal requires explicit confirmation and shows retained-history semantics
- YP9.5 processing/recovery lock blocks these controls during publish/reconcile
- multi-bucket tests prove no action leaks to another selected group

## YP9.6b implementation order

1. Add offline data/domain projection + signed quantity-delta tests.
2. Add the additive migration/RPC source and disposable DB validation only; do not apply hosted migration yet.
3. Add Sidecar availability and retirement routes plus focused tests.
4. Extend active revision planning/execution for signed quantity deltas and retirement operations.
5. Add FE copy availability and Remove child UX.
6. Run focused BE/FE tests and typechecks.
7. With separate operator authorization, apply any reviewed hosted migration.
8. Validate active child-retirement semantics in Sandbox before enabling that control for production usage.
