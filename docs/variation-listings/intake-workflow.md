# Variation-listing intake, replenishment, and staged-publication workflow

## Product intent

Variation listings are long-lived inventory buckets. One group owns one buyer-facing aggregate;
one variation/SKU is one selectable card identity; one copy is one physical card. Duplicate copies
remain under the same variation/SKU and increase derived quantity. A group may contain zero variations
while a bucket is being created, one variation while its first card is being built, and only becomes
`publish-ready` when it has at least two variations (and no more than the configured cap).

The exact durable schema is in [`persistence-design.md`](persistence-design.md). This document describes
the operator/session sequence that consumes it. It does not widen the legacy Single/Lot watcher.

## Separate durable capture session

Variation listing never joins the legacy `single_2_image` / `lot_3_image` capture-mode union. The legacy
watcher remains flat-directory, listing-centric, and persists `public.listings`; its behavior and
allocator are unchanged.

Each capture station/source has exactly one row in
`public.variation_listing_intake_sessions`, keyed by immutable `capture_source_key`. The row survives
idle and process restart and contains:

- positive `session_version`;
- `mode`: exactly `idle`, `new_variation`, or `duplicate_copy`;
- nullable `target_group_id` (required for either non-idle mode);
- nullable `target_variation_id` (required only for `duplicate_copy`, and proven to belong to the
  target group by the composite FK `(target_group_id, target_variation_id)`);
- sticky exact `sticky_price_amount` (`0.99`, `1.49`, `1.99`, or `2.49`) and `sticky_price_currency`
  (`USD`), retained through idle; and
- an all-or-none pending-pair snapshot: pair UUID, session version, mode, target(s), price/currency,
  front source reference, and `pending_pair_started_at`.

Session state is not copied onto the group. A station can change target or mode independently of every
other station and may carry a half-pair across a process restart.

## Target/mode/price CAS

Every session operation locks its row with `SELECT ... FOR UPDATE` and includes the caller's expected
`session_version`:

1. Target, mode, or sticky-price changes are accepted only with no pending pair and an exact expected
   version. The service validates the mode/target combination and increments the version by exactly
   one. A no-op does not increment. A change while a pending pair exists is rejected.
2. First-image capture locks the row, verifies a valid non-idle target, and writes the complete pending
   snapshot from the current row plus the front source and start time. It does not increment version.
3. Second-image capture locks the row and requires exact equality of current version, mode, target
   group/variation, sticky price/currency, and pending pair identity. It then persists the physical
   copy/variation transaction, records pair provenance, and clears every pending column atomically.
   Version does not change because target/mode/price did not change.
4. A mismatch, missing/stale second image, or target change is fail-closed: leave the snapshot for
   operator recovery, quarantine the unexpected source, and create no copy or variation. Restart
   resumes from the stored snapshot. Explicit discard/recovery clears the full snapshot and increments
   `session_version` exactly once.

The target cannot be changed around a half-pair, so a front image can never be silently paired into a
different group or variation. The session row is service-role-only; the UI uses a server/API seam.
Completed copies have unique `capture_pair_id`. An acknowledgement retry returns the existing copy only
after exact provenance/image comparison; mismatch fails closed and the pair never creates two copies.

## New-variation capture

With `mode = new_variation` and a selected target group:

1. First and second images complete the exact pending-pair protocol above.
2. In one aggregate transaction, generate immutable `variation_id` and `copy_id` UUIDs, lock the group
   allocator row, consume one serial, and persist exact full SKU plus the copy's source/session/pair
   provenance. The variation starts with `representative_copy_id = NULL`.
3. Insert the first copy with its exact front/back R2 keys, canonical internal condition token, and
   `availability_state = available` only after compatibility with the group's shared eBay condition is
   verified.
4. Set `representative_copy_id` to the first copy in the same transaction. The deferred composite FK
   and deferred non-null trigger validate the cycle at commit.
5. Apply the current sticky price to the new variation. Gemini may later establish/review variation
   metadata; duplicate copies never rerun Gemini.
6. Increment the owning group's desired local revision exactly once through its expected-revision CAS.
   Leave the group local/staged; no eBay call occurs.

If image/Gemini/review work fails before commit, no partial copy is visible. A committed serial is
consumed permanently even if a later local workflow abandons that variation; the serial is never reused.

## Duplicate-copy capture

With `mode = duplicate_copy`, the session's composite target identifies an existing variation in the
selected group. A completed pair:

- allocates a new `copy_id` only (never a new variation ID, serial, SKU, or selector);
- reuses the variation's metadata, canonical selector, and price (sticky price is display context only);
- stores a new exact front/back R2 pair and immutable capture provenance;
- validates the copy condition token and permits `available` only if compatible with the group's shared
  condition; otherwise stores it as `unavailable` or rejects/regroups; and
- increments the group's desired revision once. Desired quantity becomes the exact count of available
  copies for that variation.

No duplicate selector, SKU, or manual quantity row is created. A duplicate pair never invokes Gemini.

## Physical-copy condition and availability

`variation_listing_copies.condition_token` is normalized internal evidence and is exactly one of the
canonical tokens used by the card-condition contract:

```text
NEAR_MINT_OR_BETTER | EXCELLENT | VERY_GOOD | POOR
```

Optional `condition_notes` retain operator detail. `availability_state` is initially `available` or
`unavailable`; no `sold` state or order foreign key is added here. YP2.8/YP8.1/YP8.2 extend sold/order
evidence and deletion guards without introducing a competing quantity column.

The service is the only writer of condition/availability. It must check every available copy against
the group's shared minimum token using `POOR < VERY_GOOD < EXCELLENT < NEAR_MINT_OR_BETTER`; the copy
must have equal or higher rank. For initial category `261328`, the group uses raw-card eBay condition
`4000` and the existing token-to-descriptor mapping. An incompatible card remains
unavailable or is moved to a compatible group; it must not silently weaken the group condition.

Desired eBay quantity is exactly:

```text
COUNT(variation_listing_copies WHERE variation_id = ? AND availability_state = 'available')
```

There is no manually editable variation quantity. Selling/unavailability reduces the derived count;
restocking adds a copy under the same variation/SKU. A representative copy becoming unavailable never
auto-repoints representative images.

## R2 and local image ownership

Each copy owns immutable application R2 keys under:

```text
variation-listing/<group_uuid>/<variation_uuid>/<copy_uuid>/front-<content_hash>.<ext>
variation-listing/<group_uuid>/<variation_uuid>/<copy_uuid>/back-<content_hash>.<ext>
```

Processed local paths are deterministic derivatives, for example:

```text
processed/variation-listing/<group_uuid>/<variation_uuid>/<copy_uuid>/front.<ext>
processed/variation-listing/<group_uuid>/<variation_uuid>/<copy_uuid>/back.<ext>
```

Only the R2 keys are persisted authority. Local processed paths are derived and may be recreated; no
listing ID, title, selector text, position, or price participates in image identity. Every copy keeps
its pair even when it is not representative. Only the selected representative pair is later projected
to eBay Media/EPS by YP2.5+ work.

## Representative copy lifecycle

The first copy is representative by service rule. A later change is an explicit local staged mutation:
the service verifies the target copy belongs to the variation, updates the nullable representative
reference, and increments the group desired revision. Repoint before deleting a representative. The
deferred `NO ACTION` composite FK prevents cross-variation references and orphaning at commit.

Selling, making unavailable, or adding another copy never automatically changes the representative.
Representative images and physical availability are separate concerns.

## SKU allocation used by intake

The legacy parser accepts only `<category>-<Single|Lot>-<six digits>`. Legacy Single/Lot allocation is
independent per listing-type prefix: latest value plus unique-collision retry. The suffix alone is not a
global ID. Variation intake does not call or modify that path.

Variation allocation uses the dedicated group namespace defined in `persistence-design.md`:

```text
<sku_category_code>-<sku_bucket_token>-<six-digit-inventory-serial>
```

The group stores category code, stable bucket token, and next serial high-water mark; the variation
stores integer serial and exact full SKU. The allocator locks the group row, checks expected revision,
consumes the next value in `1..999999`, increments high-water by one, inserts the variation, and fails
closed at sentinel `1000000`. Complete application-owned variation SKU is unique; serial alone is not. A committed serial
is never reused. `(category, bucket token)` is unique across retained groups; token/category are
immutable from group insertion, and a group that allocated any serial is retained with its high-water.

## Staged publication

Capture, copy availability/condition changes, metadata/review, price edits, reorders, and representative
changes modify local state only and increment `desired_revision` with an expected-revision CAS. Pending
is derived from the group watermarks (`last_confirmed_revision IS NULL OR < desired_revision`). No eBay
write occurs on pair completion.

Only a later explicit **Publish Changes** action may create a YP2.5 immutable revision intent and remote
operation ledger. Until that ledger exists, no group may publish. If local changes continue while a
remote revision is in flight, its confirmation may advance `last_confirmed_revision` only to the
captured revision; any newer desired revision remains pending.

## Legacy isolation checklist

- Do not add variation modes to the legacy watcher union or write `public.listings`.
- Do not alter `packages/types/src/structured-sku.ts`, legacy parser/allocation, output, or checks.
- Do not persist local processed paths as image authority or duplicate image ownership on variations.
- Do not create a quantity column, sold state, order link, remote ID, Media ID, revision snapshot, or
  operation checkpoint in the initial four tables.
- Do not call eBay, SoldComps, Browse, or Gemini for duplicate-copy capture.
