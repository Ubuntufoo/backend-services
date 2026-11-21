# Master Inventory Storage — Investigation and Decisions

Status: Phase 1 read-only Supabase audit completed; phases 2–6 pending. Updated 2026-11-16 (America/New_York).

## Goal and scope
Create a marketplace-agnostic source of truth for acquired physical inventory (sports-card singles, lots, comic books, future item types) from which marketplace-specific listing adapters can build listings. Support one-off and batch import from auction sources, including item data and images, without exhausting Supabase free-tier capacity. Existing eBay listing behavior must remain operational during adoption.

This is an investigation log, not an approved schema or migration. No database writes were made.

## Verified environment
- Supabase project: `ebay-inventory-manager` (`fmiliwxthjonjwywuqta`), PostgreSQL 17, ACTIVE_HEALTHY.
- Backend worktree: `backend-services-you-pick`, branch `feature/you-pick`, clean when audit began.
- Public schema: **19 ordinary tables**, total **5,431,296 bytes (~5.18 MiB)** of PostgreSQL table + index + TOAST allocations at audit time. This is **not** the total project billing/database disk footprint.
- Other cataloged schema allocations: auth ~1.16 MiB, storage ~0.33 MiB, supabase_migrations 0.25 MiB, realtime ~0.24 MiB. These figures exclude other PostgreSQL/system overhead and off-database object bytes.
- No dedicated marketplace-neutral master-inventory table identified. Supabase Storage object binaries, R2 bucket consumption, and exact remaining free-plan headroom have **not** been verified.

## Existing table families and relationships
- **Standard listings:** `listings` contains both characteristics (`title`, `description`, `condition_id`, `item_specifics jsonb`, etc.) and eBay-specific publication fields (`ebay_offer_id`, `ebay_listing_id`, `ebay_listing_status`, `sku`, `status`). Image references: `image_urls text[]`, `r2_object_keys text[]`, retention/deletion timestamps. This mixing is a migration/interface consideration.
- **Standard listing dependencies:** `jobs`, `listing_price_research`, `ai_model_attempts` reference `listings(listing_id)` with cascading delete; `orders` uses SET NULL for this reference. Inspect semantics before reusing/deleting listing rows.
- **Variation listings:** `variation_listing_groups` → `variation_listing_variations` → `variation_listing_copies`. Variations have SKU/selector/price/metadata, while copies have individual `copy_id`, availability/condition, front/back R2 object keys, and capture metadata. `variation_listing_variations.representative_copy_id` points back to copies through a deferred composite FK.
- **Publish provenance:** `variation_listing_revisions` stores `snapshot jsonb` and `operation_plan jsonb`; `variation_listing_publishing_checkpoints` stores `evidence jsonb` and references revisions. Other specialized incident/remote-retirement tables also reference variations/groups/revisions.
- **Indexes:** `listings` has SKU, status, date, merchant-location and unique listing-ID indexes. Variation tables have unique SKU, group/position, group/selector, group/revision and revision/operation indexes. There is no verified existing inventory-to-multiple-marketplaces linkage table.
- RLS is enabled on listed public tables (from metadata). Actual policies/access boundaries were **not audited**.

## Largest public tables (physical allocated size, including indexes and TOAST)
| Table | Allocated | Planner estimated rows |
| --- | ---: | ---: |
| listing_price_research | 896 KiB | 49 (stale planner estimate; exact count: **1**) |
| variation_listing_revisions | 888 KiB | 48 |
| listings | 800 KiB | 211 |
| variation_listing_publishing_checkpoints | 760 KiB | 686 |
| jobs | 432 KiB | 842 |
| variation_listing_variations | 312 KiB | 45 |
| ai_model_attempts | 240 KiB | 203 |
| variation_listing_copies | 168 KiB | 47 |
| app_settings | 168 KiB | 1 |
| variation_listing_groups | 136 KiB | 20 |

Planner row estimates are approximate, not COUNT(*) results. A follow-up read-only `COUNT(*)` confirmed **exactly one** `listing_price_research` row. Pricing research is **deprecated/inactive** in the application; its table is intentionally preserved for potential reintroduction, with one reference entry retained. Its 896 KiB physical allocation is not evidence of active pricing research or 49 live rows: allocated pages may include historical/dead tuples and TOAST/index allocations. Do not infer per-row inventory cost directly or recommend deleting this retained table. Revision snapshot growth deserves separate examination.

## Findings / design implications (not final decisions)
1. A new neutral inventory identity should be distinct from both `listings.listing_id` and eBay SKUs/variation IDs. Existing eBay records should initially link to inventory rather than be repurposed.
2. **Confirmed model direction:** each individual physical item gets its own inventory record (including each copy of an identical card). Provide an easy duplicate-N workflow that creates N independent records from an initial item. Consider an optional self-referencing `copied_from_item_id` or a shared group identifier to capture provenance/related copies; do **not** assume both `isCopy` and `sharedParent` are needed, as an optional reference can often express copy provenance by itself. Whether later edits propagate across duplicated records remains undecided.
3. Existing R2 key references make keeping image bytes outside PostgreSQL plausible; verify lifecycle ownership and reuse before designing shared media.
4. Do not store repeated full auction HTML, large raw JSON, or image binaries in the master record by default; assess compact source provenance + selected normalized fields and object storage.
5. Separate stable item facts, acquisition/provenance and cost, item-type attributes, and marketplace-specific publication data; precise table split remains undecided.
6. Keep listing publication revisions/checkpoints in the current domain; avoid creating cross-platform coupling to eBay semantics.

## Confirmed user requirements / decisions
- Phase 1: audit existing Supabase structure and storage **read-only**.
- Maintain this file at `MASTER_INV_STORAGE.md` in the **backend You Pick worktree** as findings and decisions evolve.
- Master inventory must be marketplace-agnostic; future adapters may include eBay, Mercari, Vinted.
- Inventory supports at least sports-card singles, card lots, and comic books.
- Provide web-facing import for one-off auction items and batches, with source information and images.
- Keep Supabase free-tier storage usage central to design trade-offs.
- **Inventory granularity confirmed:** one record per physical item, even when several copies of a card are identical. An interface must allow duplicating an initial record by number of owned copies, producing distinct item IDs. A copy flag and parent/shared reference were suggested, but precise linkage fields remain to be designed.
- **Pricing research confirmed inactive/deprecated:** preserve its existing table and the single intentionally retained reference row for possible future use. Verified by read-only `COUNT(*) = 1`.
- No new schema, adapter, import workflow, or deletion policy approved yet.

## Open decisions — interview
1. **Copy relationship semantics — DECIDED:** Duplicating an item copies the initial data into a new, independent physical-item record with a unique inventory ID. Subsequent changes to the source item or any duplicate never propagate to other records. An optional `copied_from_item_id` may retain creation provenance only; it must not imply ongoing synchronization. A separate `isCopy` flag is unnecessary if the optional provenance reference is used.
2. **Lot identity:** Does a card lot have one inventory record as an indivisible sale unit, or must its component cards also have their own records and a reserved/contained relation?
3. Can components of purchased lots later be split into single inventory units, and can single inventory units be committed to multiple mutually exclusive lots?
4. Which acquisition metadata must survive (auction provider, URL, lot ID, winning bid, shipping, tax, seller, acquisition date)?
5. Are source photos preserved permanently, replaced by processed photos, or deleted after sale?
6. Should imported inventory be publish-ready, or pass an explicit review/enrichment step?
7. Should unsold inventory be listed on multiple marketplaces simultaneously, requiring reservation/sale reconciliation?
8. Must older eBay listings be backfilled, or can master inventory begin only with new acquisitions?
9. Target inventory scale (items/yr, images/item) and desired storage/retention horizon?

## Remaining Phase 1 verification / later phase handoff
- Verify exact counts / column-level JSONB and TOAST growth if materially needed; measure database disk usage using a project-appropriate source rather than only `pg_total_relation_size`.
- Inspect Supabase Dashboard billing/quota figures and current free-plan limits before estimating headroom.
- Audit RLS policies and grants before designing a new exposed table.
- Phase 2: trace backend/frontend codepaths, R2 ownership, image deletion semantics and capture flows; no code changes unless separately authorized.
- Phase 3: compare shared table + JSONB versus type-specific child tables, using actual anticipated query patterns.
- Phase 4: investigate auction importer and existing scraper/extension reuse.
- Phase 5: define marketplace adapters and stock-reservation boundaries.
- Phase 6: quantify normalized row sizes and image/research retention scenarios.

## Change safety
Audit performed with Supabase metadata tools and SELECT-only SQL. No production database mutations. This Markdown file is the only intended worktree modification for Phase 1.

## Confirmed requirements — lot intake and watcher dual-purpose capture (2026-11-16)
- **Purchased lot intake:** Do not automatically create a master inventory record representing an acquired/raw lot. The user will manually add selected individual items from purchased lots to the master inventory table. This does not yet settle whether a deliberately assembled **saleable bundle/lot** may be represented as a product later.
- **Watcher capture modes:** A captured card must support two explicit destinations/workflows:
  1. **Master only:** create the physical-item record in master inventory without adding it to a staged marketplace listing.
  2. **Master + current staged listing:** create the physical-item record **and** add it to the currently staged listing. This must work for **both standard and variation listings**.
- The inventory record is always created in either path, rather than allowing a listing-only capture. Preserve existing listing creation and variation-capture behavior through the new integration.
- **Open implementation decisions:** determine how the UI selects these modes; what constitutes the 'currently staged' standard/variation target; how to avoid duplicate item creation on watcher retries; what happens if master creation succeeds but listing staging fails; how image references are shared and deleted safely.

## Confirmed decision — watcher partial-failure recovery (2026-11-16)
- In **Master + current staged listing** capture, if master inventory creation succeeds but adding the card to a standard or variation staged listing fails, **preserve the successfully created inventory record**.
- Report the listing-stage failure and permit a retry of **listing staging only**, referring to the existing inventory record. A retry must not create a duplicate master record.
- Implementation analysis must define durable idempotency/correlation identity, recovery state, and exact retry boundaries; do not assume both steps are atomic.
- This supersedes the prior open question about the outcome of master-success/listing-failure. No production behavior or database schema change is authorized by this decision.

## Confirmed decision — sold inventory retention and permanent purge (2026-11-16)
- **Sold physical inventory items are archived**, not immediately deleted.
- **Retention window: 30 days after confirmed sale**, subject to verification of the authoritative sale timestamp during implementation.
- **After 30 days:** permanently delete the sold item's master-inventory record, associated item metadata, and images (including owned R2 objects and applicable local files) to minimize database and object-storage footprint.
- This is a user-confirmed lifecycle requirement, **not authorization to delete existing production data**.
- **Critical implementation safeguards to investigate:** verify sale confirmation, distinguish inventory-owned images from shared images used by active listings/other copies, honor pending/unknown eBay operations and order-related obligations, make purge retry-safe and crash-safe, and ensure deletion does not cascade into active marketplace records unintentionally. Determine whether externally required minimal financial/order records must be maintained separately from the purged master inventory item; do not infer that all order history can be deleted.
- **Retention trigger — CONFIRMED:** the 30-day retention clock starts at the **confirmed sale timestamp**, not payment, shipment, or delivery. After this period, purge subject to the documented safety checks. Define the authoritative sale event/source during implementation.

## Confirmed requirement — include existing eBay-listed inventory (2026-11-16)
- The master inventory must **eventually include items that are already listed on eBay**, not only newly captured/imported stock.
- **Migration/backfill strategy is NOT decided.** User explicitly raised backwards-compatibility and recovery risks; do not assume existing eBay listing rows can be replaced or repurposed.
- **Provisional low-risk investigation direction:** build a read-only inventory reconciliation/mapping report; distinguish standard listings, variation members, and physical copies; identify records with incomplete or unavailable source data; test a staged, idempotent backfill creating new master-item IDs while preserving current listing IDs, SKUs, quantities, revisions, and publish/recovery machinery. Link existing listings to new inventory records only after the relationship is validated. Avoid live eBay mutations and destructive rewrites in the backfill phase.
- **Open decisions:** whether backfill is automated for all eligible listings, initially limited to a pilot, or reviewed individually; whether all historical sold listings should be excluded, especially given the 30-day purge rule; how to treat active variation SKU copy counts and unavailable images; and which system becomes authoritative during phased adoption.

## Confirmed decision — migration rollout (2026-11-16)
- Adopt a **small, verified migration pilot first**, including representative existing active eBay standard listings and variation inventory.
- Verify physical-item identity, quantity parity, existing listing-to-inventory mappings, image references, and unchanged eBay publication/recovery behavior before proceeding.
- After a successful pilot, **automate the backfill of the remaining active eBay inventory**, using idempotent operations and reconciliation checks.
- Existing eBay listings, SKUs, listing IDs, and durable revision/recovery records must not be destructively rewritten as part of the pilot.
- This is a planning decision, not permission to execute migrations or mutate live inventory yet. Selection criteria, rollback/recovery, and acceptance gates remain to be specified during repository analysis.

## Phase 2 — repository and data-flow investigation (2026-11-16/17)

**Status:** Focused read-only investigation completed for the primary capture, storage, frontend routing, and deletion paths. This is architectural evidence, not an implementation authorization. The current worktrees have unrelated in-progress code edits; none were modified by this investigation.

### Confirmed implementation sequencing
- The **You Pick backend and frontend worktrees will be merged into their respective main branches before master inventory is implemented**. The merged main branches, revalidated after the merge, are the implementation baseline.
- Keep this analysis in the backend You Pick worktree for now; ensure `MASTER_INV_STORAGE.md` is carried to main during merge. Recheck affected entry points after merge, especially while You Pick publication/removal tests are still changing.

### Current capture architecture: verified source paths
1. `services/watcher-service/src/cli.ts` starts recovery of pending variation image archives and restores standard pending grouping paths before launching `startWatcherRuntime`.
2. `services/watcher-service/src/standard-capture-state.ts` stores a `standard | variation` workspace in `.capture-workspace.json`, and standard pending paths in `.standard-capture-pending.json`. Capture workspace is **not** the same dimension as desired master-only vs master+listing.
3. `services/watcher-service/src/watcher-runtime.ts` watches incoming files, snapshots variation ownership at arrival, and directs events to either variation intake or the legacy standard batch processor. Queued variation images cannot silently switch owner, bucket, mode, or target. Disarmed variation intake is ignored rather than forwarded to standard capture. Retry and pending-state controls are already nontrivial.
4. **Standard:** `services/watcher-service/src/process-image-batch.ts` groups incoming images, allocates a listing ID, moves images to `processed/` and inserts a `listings` row via `createWatcherListing`. On insertion failure it rolls back the processed move. No separate independent master-inventory persistence step currently exists.
5. **Variation:** `services/watcher-service/src/variation-listing-runtime.ts` routes a front/back pair through frozen durable intake; derives copy/variation UUIDs from the capture pair ID, prepares images and identity, then persists through `variation-listing-persistence.ts` using `createSupabaseVariationListingTransactionGateway`. The latter checks existing `capture_pair_id` and returns `already_completed` only after matching immutable persisted command fields. This is a candidate idempotency seam for linking the **same physical capture** to a master record.
6. The current variation `duplicate_copy` mode adds a captured copy to an eBay variation. This differs from **Duplicate × N** of a master record, which must create independent inventory records without synchronizing subsequent edits.

### Frontend and control boundaries
- `app/workspace-switcher.tsx` uses `/api/variation-listings/intake-session` GET/PATCH and explicitly blocks switching to standard while a variation image pair is pending. `app/listings-realtime.tsx` offers Standard Single/Lot capture mode; `app/variation-listings/variation-listings-workspace.tsx` and `variation-inventory-panel.tsx` control variation arm/new-variation/duplicate-copy targets.
- **Recommendation (not yet confirmed):** model `master_only | master_and_listing` as an **independent destination choice** from existing Standard/Variation ownership and Single/Lot/duplicate-copy capture modes. Freeze it with each capture so a changing UI cannot redirect queued images. A master-only action should never accidentally fall back to a listing; a disarmed Variation remains disarmed until expressly changed.
- Open requirement: select default destination and whether the last selected destination persists across restart. Also determine what “currently staged standard listing” means in an existing flow that normally creates a fresh standard listing for each capture.

### Images, local archive and deletion: verified paths
- `packages/data/src/r2.ts`: standard object keys are currently derived under `listings/{listingId}/...` with content hash in filename.
- `services/watcher-service/src/variation-listing-intake.ts`: variation object keys use `variation-listing/{groupId}/{variationId}/{copyId}/{front|back}-{hash}...` and create-once conditional uploads; ambiguous upload outcomes deliberately **do not** trigger speculative unconditional R2 deletes.
- `services/watcher-service/src/variation-image-archive.ts`: post-persistence archiving verifies durable copy/group IDs, pair source paths, R2 keys, source/destination hashes and filesystem identity; it persists recovery journals and has restart recovery.
- `services/sidecar/src/listings/abandon-needs-review-listing.ts`: after safety checks for allowed status, eBay/export traces, active jobs and orders, standard abandonment currently deletes R2 objects, local processed directory and finally listing row. This deletion pattern assumes listing-scoped media and is unsafe if master inventory also owns/references the same objects without reference checks.
- **Design conclusion:** master inventory and staged listings must have explicit image ownership/ref semantics. For new captures, prefer inventory-owned images with listings referencing them; for backfilled listings, initially reference existing keys without renaming/moving them. Require owner/ref checks before deletion, distinguish shared image from disposable listing copy, and preserve crash-safe retry/reconciliation behavior. Final schema and storage contract remain open.

### Dual-purpose watcher integration: proposed minimal change
- Assign a durable capture identity (pair ID or equivalent) and freeze both workspace target and destination mode at capture start; create an independent master item **exactly once**.
- `master_only`: save item + its owned media; no listing records created.
- `master_and_listing`: save item first, then stage it in the currently authorized Standard or Variation listing workflow, recording an immutable item→listing association. Persist outcome states to support **inventory saved / listing staging pending or failed / listing staged**.
- If staging fails, retain master record and media, surface the exact failure, and allow **listing-stage-only** retry on the same item/capture ID. Never blindly recapture or reinsert master data. Preserve existing variation transaction/reconciliation safety and standard file rollback behavior through the new boundary.
- Treat these as initial architectural recommendations to validate against post-merge state, not approved table or API contracts.

### Existing-live-item migration and lifecycle
- Pilot then automated active-eBay backfill remains confirmed; use read-only discovery, independent master IDs, no rewriting eBay SKU/listing IDs/revisions and evidence-based quantity/image mappings. Pilot should include representative standard and variation-copy records.
- One physical item per master record; purchased raw lots are not themselves master records. Independent duplicates may retain optional `copied_from_item_id` for provenance only.
- Sold items archive for 30 days starting at confirmed sale, then purge their master row, metadata, and owned media; outstanding listing/fulfillment/recovery and reference ownership must prevent unsafe deletion. Whether minimal legal/accounting data needs separate retention remains to assess.

### Risks prioritized
1. Standard capture currently allocates listing IDs and moves images **before** saving listing data. Master-first persistence must not be accidentally rolled back by the standard listing stage.
2. Arrival-time Variation ownership and durable pair locks must not be weakened by a new routing selector.
3. Changing image ownership impacts standard abandonment, variation cleanup, and future sold-item purge; never delete by folder prefix alone.
4. Multiple e-commerce adapters will require authoritative inventory availability and conflict/oversell policy, not simply multiple platform IDs.
5. Existing in-flight worktree publication/removal changes require a post-merge baseline verification rather than assumptions about present code.

### Suggested post-merge Phase 2 acceptance checks (planning, not run)
- Standard two-image capture in both destination modes; standard listing staging failure followed by successful retry with exactly one master record.
- Variation new-card and additional-copy capture in both destinations where supported; pending-pair ownership remains frozen; disarmed mode cannot leak into standard listing.
- Duplicate × N creates N independent master records and never propagates edits.
- Shared-media abandonment and sold-item purge cannot delete any image still used by another item or active listing.
- Pilot backfill has no remote eBay writes; exact identity/qty/media parity verified and re-running the backfill introduces zero duplicates.

### Remaining design decisions / next phase
- Default watcher destination: master-only, master+listing, or remember last; needs user confirmation.
- How a Standard capture targets a “currently staged” standard listing when each existing standard card normally starts a new listing.
- Source-of-truth for market-wide reservations, partial sale, order cancellation/refunds, and 30-day deletion gating.
- Whether newly created master inventory needs metadata enrichment before becoming listable.
- Formal schema, query patterns, storage projections, RLS and adapter interface design belong to subsequent phases.

**Phase 2 outcome:** primary code seams identified, major compatibility/media risks assessed, and post-merge acceptance work defined. No application code, database, eBay or R2 changes were made.

## Confirmed decision — default watcher capture destination (2026-11-16/17)
- The watcher default capture destination is **Master + Listing**.
- Every normal capture creates one independent master inventory record and also stages the captured item in the currently authorized Standard or Variation listing workflow.
- **Master only** remains an explicit selectable alternative and must never silently stage a listing.
- This destination setting is separate from Standard/Variation workspace ownership and existing capture modes; preserve routing guards and freeze the selected destination for an in-progress capture.
- A listing-stage failure must preserve the successfully created master record and allow an idempotent listing-only retry, as previously confirmed.
- Whether destination selection persists between sessions is not yet decided; the startup/default value is Master + Listing.

## Phase 3 — eBay-first master inventory schema research (2026-11-16/17)

### Confirmed priority
- **eBay is the highest-value marketplace** and its product data, category/item specifics, condition, images and listing construction requirements must be first-class design constraints.
- Other marketplaces may need fewer aspects. Do **not** dilute eBay compatibility to accommodate simpler integrations; instead let adapters select and translate the fields they require.
- The physical master inventory is still marketplace-neutral. eBay offer IDs, publication revisions, business policies, merchant location, listing category, and marketplace-specific availability remain in existing eBay listing/offer domains rather than becoming required attributes of every master physical item.

### External eBay documentation checked (2026-11-16/17)
- https://developer.ebay.com/api-docs/sell/static/inventory/managing-inventory-and-offers.html — inventory items (SKU, title/description, aspects, images, condition, quantity), item groups, offers.
- https://developer.ebay.com/api-docs/sell/static/inventory/publishing-offers.html — publication-required item, group and offer fields including policies, marketplace, price, location and quantity.
- https://developer.ebay.com/api-docs/sell/static/metadata/sell-categories.html — category-dependent required/optional aspects via Taxonomy API `getItemAspectsForCategory`.
- https://developer.ebay.com/api-docs/sell/static/inventory/inventory-item-to-offer.html — distinct standard offer vs grouped variation publishing flows.

### Verified existing schema inputs
- `public.listings` mixes catalog-style facts (`title`, `description`, `item_specifics jsonb`, `condition_id`, `condition_notes`, images) with channel/listing terms (`category_id`, SKU, eBay offer/listing IDs, listing status, price, shipping/packaging, location, timestamps). Keep these columns intact throughout initial migration.
- `public.variation_listing_variations` holds `variation_id`, `group_id`, `sku`, `selector_value`, `variation_metadata jsonb`, `price_amount`, `representative_copy_id`, quantity adjustment counter.
- `public.variation_listing_copies` is closest to physical-unit tracking: `copy_id`, `variation_id`, `availability_state`, `condition_token`, notes, front/back R2 keys, capture pair ID/provenance. Do **not** reuse `copy_id` as the universal master-item ID; link it to a new independent ID.
- `public.variation_listing_groups` has shared description, category, common eBay aspects, condition and policies plus publication revisions. Variation-level group publication semantics must remain here.

### Proposed minimal logical schema (not approved DDL)
1. **`inventory_items`** — one record per individual physical object:
   - `item_id uuid` immutable primary key; `item_type` (e.g. `sports_card`, `comic_book`, extensible); a compact `name`/description for identifying an unlisted item; optional `condition` and notes.
   - `attributes jsonb` for stable, item-type-specific facts (sports card year/set/player/card number/team/parallel; comic series/issue/publisher/variant, etc.). Store user-known/evidence-backed facts, not a verbatim eBay listing payload; preserve scalar/multi-value representation needed for eBay aspect transformation.
   - Optional acquisition/source provenance (`source_name`, `source_url`, `source_external_id`, `acquired_at`, purchase cost/currency). Keep only useful source attributes; do not store complete auction pages or arbitrary large raw responses.
   - `status` for item lifecycle (available/reserved/sold-archived etc.), `sold_confirmed_at` as authoritative 30-day retention anchor, `created_at`, `updated_at`.
   - `copied_from_item_id uuid null` *optional* provenance link to an original, with no edit synchronization. Avoid a second `isCopy` flag.
   - Durable `capture_id` or separate unique capture identity to guarantee one physical record per accepted capture across restarts and listing-stage retries.
2. **`inventory_item_images`** — narrow child table: `image_id`, `item_id`, `role` (front/back/additional), `sort_order`, `r2_object_key`, optional source/ownership indicator. R2 contains bytes, not PostgreSQL. **Do not** treat deleting an item row as permission to delete a referenced R2 object: explicit cross-reference/ownership verification is required first. Design for legacy backfilled media keys that remain located in original listing/variation paths.
3. **`inventory_listing_links`** — association of one physical item to a marketplace listing or variation. At minimum `item_id`, `marketplace`, channel listing reference(s), linkage state/timestamps. For eBay, model a standard `listings.listing_id` association or `variation_listing_copies.copy_id` association to the correct existing physical copy; preserve SKU, remote listing/offer IDs and revision in their authoritative listing domain. Future non-eBay channels need their own adapter identifiers, without changing master-item schema.
4. **Reuse existing eBay tables** rather than duplicate eBay offer/policy/revision schemas. Each eBay adapter transforms master attributes/images/condition into category-validated `product.aspects`, product title/description/condition/imageUrls and uses existing Standard/Variation offer and group flows for price, quantity, category, business policies and merchant location.

**Minimization checkpoint:** Three new logical tables are a *working proposal*, not a requirement. If images can safely be represented in a compact structure without losing per-image ownership, references or deletion proof, evaluate reducing to two. Conversely add a dedicated media-object ownership table only if shared R2 objects actually require it; avoid premature abstraction.

### Boundary between stable facts and eBay publication
- Store reusable physical-item facts once; an eBay listing may have its own optimized title, description, category mapping, condition ID, selected aspects, price and fulfillment details.
- **Validation:** eBay category requirements are dynamic and must be checked using the current category-specific aspect/condition metadata; presence of a master record alone must **not** imply eBay publish-ready. The adapter can return missing-field errors for review.
- Standard listings and You Pick variation groups should consume item facts while retaining existing publication/reconciliation state. Group shared aspects/variation selector belong at the group/variation presentation level, **not** universally on every physical-item row.
- Availability: one item must not be simultaneously sold twice if future marketplaces are added. Reservation/sale arbitration is a separate Phase 5 design; do not conflate physical item count with eBay SKU quantity. Group count is derived from linked physical units and reconciled authoritative remote evidence.

### Backfill boundaries
- Pilot: create new inventory IDs, copy verified item characteristics and reference existing image keys; link `listings.listing_id` and existing variation copy IDs without rewriting identifiers, revisions or offer records.
- Variation quantities can reflect non-captured quantity adjustments; a one-to-one mapping of existing `variation_listing_copies` rows to actual on-hand units is **not automatically guaranteed**. Audit and reconcile count/identity gaps before creating phantom master inventory rows or claiming exact parity.
- Exclude sold-out historical items outside confirmed retention policy unless needed by separate order requirements; pilot requires explicit no-remote-write and idempotent mapping checks.

### Remaining Phase 3 decisions
- **Master item enrichment:** Is an inventory item allowed to be saved with incomplete eBay details (recommended), or must required eBay item specifics be present when item is first created?
- Whether all acquisition metadata should be on `inventory_items` or a small separate acquisition-event/lot provenance table, subject to actual import requirements.
- Whether master item identity should have a human-friendly optional label in addition to UUID.
- Image ownership/ref counting and deletion state machine require implementation-level design before enabling 30-day purge.
- Exact indexes, constraints, RLS policies, migrations, and byte estimates require post-merge validation. No schema change authorized.

## Confirmed decision — incomplete master inventory records (2026-11-16/17)
- **Allow incomplete master inventory records.** A physical item may be saved at capture/import time even if its eBay category, title, condition mapping, item specifics, or other eBay-required fields are incomplete.
- **eBay-specific completeness and current category/condition rules are validated before publication**, not as a prerequisite for creating the master record.
- A record being saved to inventory does **not** imply it is publish-ready. The eBay adapter/listing preparation workflow must identify missing required fields and block publication until corrected, while preserving the master record and images.
- This applies to both watcher capture destinations: **Master only** and **Master + Listing**. In the latter, master creation must succeed independently even when listing preparation/staging/publishing cannot complete; retain the established idempotent listing-only retry policy.
- This decision supersedes the corresponding open Phase 3 question. No schema, application, or production data changes are authorized.

## Confirmed decision — acquisition data stored on each item (2026-11-16/17)
- Store essential acquisition details **directly on each `inventory_items` record**, rather than creating a separate acquisition-event or lot table initially.
- Candidate optional fields: purchase price and currency, acquisition date, auction/source name, source URL, and external source/lot identifier. **Do not include shipping cost or tax fields** in the master inventory schema. Exact names remain design details, not approved DDL.
- Items manually added from purchased lots remain independent physical inventory records; a raw purchased lot does not itself become a master inventory item.
- Keep missing acquisition details nullable and avoid storing full auction page HTML or large raw responses. Duplicate-item creation copies initial fields only; subsequent updates stay independent.
- Revisit a dedicated acquisition entity only if verified operational needs justify one, such as shared purchase-level accounting or cost allocation.

## Confirmed decision — human-readable inventory ID (2026-11-16/17)
- Every master inventory item gets a **short, unique, human-readable inventory identifier** (proposed format: `INV-000001`) **in addition to** its immutable internal UUID.
- Treat the human-readable ID as an inventory lookup/label, not as an eBay SKU. Preserve existing eBay SKU naming conventions.
- Ensure IDs are unique and assigned atomically, including concurrent watcher captures, imports, backfills, and Duplicate × N operations. Do not recycle identifiers after the 30-day sold-item purge.
- The exact prefix, padding, and numbering scheme remain implementation details unless separately confirmed.
- **Acquisition simplification confirmed:** no dedicated shipping cost or tax columns in master inventory; retain optional purchase price, acquisition date, and source/provenance fields directly on each item.

## Confirmed decision — multiple item images (2026-11-16/17)
- Master inventory must support **additional photographs beyond the normal front/back pair** for comics, collectibles, condition details, and future item types.
- Do not enforce a fixed database-level limit of two images per item. Preserve image order and an optional role/type (front, back, detail, additional) so eBay adapters can select and order images according to current marketplace rules.
- Store image metadata and R2 object references, **not binary image data**, in PostgreSQL. Existing watcher front/back capture remains supported; additional photos can be attached separately as the workflow develops.
- Maintain explicit image ownership and reference/deletion safeguards so the 30-day sold-item purge cannot delete an image still needed by another active item or listing.
- This decision does not require unlimited upload size or bypass marketplace-specific image count/format restrictions; enforce those at the appropriate adapter or upload boundary.

## Confirmed decision — master inventory remains editable (2026-11-17)
- **Master inventory records can be edited after creation**, including their identifying title/name, description, condition, item-specific attributes, acquisition details, and image associations/order.
- Editing one physical item must not synchronize changes to independently duplicated inventory records.
- **Do not silently mutate already-published eBay listings** when a master item is edited. Existing marketplace publication remains governed by its own explicit staging, validation, publish/reconcile and revision controls; the user must explicitly initiate any corresponding listing update.
- Preserve existing image ownership/reference safeguards when adding, replacing, reordering, or removing images.
- This is a requirements decision; no application/schema/database mutation is authorized.

## Confirmed decision — manual reservation/unavailability (2026-11-17)
- Master inventory must allow an item to be **manually marked Reserved or Unavailable** while retaining its record, metadata, and images.
- Reserved/Unavailable items **must not be eligible to be added to new staged listings** until explicitly returned to an eligible available state.
- These manual states do **not** automatically withdraw or modify an existing published eBay listing. Existing remote listing changes continue through explicit guarded publication/reconciliation workflows.
- Keep this separate from the sold/archived 30-day retention lifecycle. Exact reservation reason, timestamps, and whether status applies to already-staged but unpublished items remain design questions.
- Future multi-marketplace allocation must also prevent a single physical item from being independently committed/sold twice; detailed arbitration belongs to the marketplace coordination phase.

## Mandatory requirement — simultaneous cross-marketplace listings and sale-triggered withdrawal (2026-11-17)
- **A single physical inventory item MUST be allowed to be listed simultaneously on multiple marketplaces** (e.g., eBay and Mercari). This is a mandatory architectural requirement, not optional future polish.
- **When a sale is authoritatively confirmed on any connected marketplace, immediately mark the physical item as sold/unavailable for further allocation and initiate automatic withdrawal/end/deactivation of every other active marketplace listing associated with that same physical item.** Preserve an auditable, retryable outcome for each withdrawal.
- The sold item enters the confirmed 30-day archive-retention period, subject to existing safety and media-reference checks before permanent purge.
- The link model must support **multiple active marketplace associations per physical item**; no uniqueness constraint limiting an item to a single marketplace listing. Still prevent duplicate associations to the *same* marketplace listing/variation where inappropriate.
- **Safety and practical limitations:** marketplace APIs, webhook/polling delays, and concurrent buyers make instantaneous prevention of every cross-marketplace oversell impossible. Design for rapid event ingestion/poll reconciliation, idempotent first-sale handling, prompt fan-out withdrawals, explicit unknown/failed withdrawal recovery, and manual intervention alerts rather than claiming guaranteed atomic cross-platform withdrawal.
- Existing eBay durable publication/recovery guardrails and explicit authorization boundaries must remain intact. Automated cross-channel sell-down/withdrawal is a newly approved product requirement; implementation authorization and remote-mutation safety policies must be specified separately before any live marketplace writes.
- **Open follow-up:** define behavior for eBay variation listings representing multiple physical copies, including decrementing shared SKU quantity rather than automatically withdrawing the entire SKU when another marketplace sells one copy; define handling of cancellations/returns after automatic withdrawals.

## Confirmed scope restriction — eBay variation inventory is eBay-exclusive (2026-11-17)
- **Physical items assigned to eBay You Pick / variation listings will NOT be listed on other marketplaces.** Treat this as an explicit eligibility rule, not merely a test assumption.
- Therefore cross-marketplace sale handling does not need to decrement an eBay variation's quantity following a sale on Mercari or another marketplace: a variation-linked physical item must be excluded from those channels in the first place.
- The previously confirmed **mandatory simultaneous cross-marketplace listings and sale-triggered automatic withdrawal** apply to eligible inventory items, such as standard single-item listings; **eBay variation-linked inventory is an exception**.
- Enforce this exclusivity when staging, publishing, importing, or changing an item's marketplace associations. An item already listed on another marketplace must not silently be assigned to an eBay variation; require a safe transition that resolves other live listings first.
- Existing eBay variation quantity adjustment, removal, and remote reconciliation behavior stays intact and separate from cross-marketplace sell-down.
- This resolves the prior open question about decrementing variations after cross-marketplace sales. Detailed transition rules between a standard cross-listed item and eBay-exclusive variation membership remain for later design.

## Confirmed decision — release eBay variation items to general inventory (2026-11-17)
- A physical master item assigned exclusively to an eBay You Pick variation **may return to general available inventory** after the variation is withdrawn/removed **and eBay's remote state authoritatively confirms that the specific item is no longer offered for sale**.
- This is **not** an automatic release upon merely requesting or staging withdrawal. Keep the item unavailable for cross-marketplace listing while eBay withdrawal/removal is pending, failed, or remote outcome is unknown; require successful reconciliation first.
- Once release is confirmed, the same master item ID and its attributes/images are preserved and the item may be offered as a standard single item on eBay or eligible other marketplaces.
- **Important distinction:** existing You Pick variation permanent-removal logic hard-deletes variation-specific records/media, and zero-quantity withdrawal may represent a sold physical item. The master-inventory release operation must not mistakenly resurrect sold units or delete retained master inventory/images. Before implementation, separate physical-item disposition (still owned vs sold) from eBay variation membership and coordinate media deletion with ownership/reference proofs.
- Exact transitions for an entire withdrawn bucket versus an individual removed variation, including multi-copy variations, need post-merge code and data contract verification.

## Confirmed decision — automatic release after complete eBay variation-listing withdrawal (2026-11-17)
- When an **entire eBay You Pick variation listing/group is withdrawn**, automatically return **all remaining physical items verified unsold and still owned** to general available master inventory **after authoritative eBay confirmation** that the listing is no longer purchasable.
- Do not release sold, unaccounted-for, manually reserved, or otherwise unavailable physical items. Validate the disposition of each underlying physical copy; preserve item IDs, attributes, image references, and history as applicable.
- Until the complete withdrawal is confirmed and reconciled, keep associated items excluded from other marketplaces. A failed/unknown remote withdrawal must not make any physical copy generally available.
- The eBay variation's existing hard-delete/remove and image-cleanup code must not delete surviving master-owned inventory or media when returning unsold stock to general inventory. This is a post-merge integration requirement, not authorization to change live You Pick behavior now.
- Idempotent bulk release is required: retrying the reconciliation must not create duplicate items or improperly unlock items already sold or reserved.

## Confirmed decision — manual reservation does not withdraw active listings (2026-11-17)
- **Manually marking a master inventory item Reserved does NOT automatically withdraw, end, deactivate, or change any existing marketplace listing**, including eBay or other connected channels.
- The user knowingly accepts responsibility for managing any already-live listing and its sale risk when applying the manual Reserved status.
- Reserved items remain blocked from being added to **new** staged listings until returned to an eligible available status, consistent with the previously confirmed reservation policy.
- **Distinguish manual reservation from confirmed sale:** the mandatory automatic cross-marketplace withdrawal requirement still applies when a sale is authoritatively confirmed. A manual Reserved status must not disable or bypass sale detection, sold-item disposition, or cross-marketplace withdrawal on sale.
- This decision supersedes earlier suggestions to automatically withdraw active listings upon a manual reservation. No production listing changes or code changes are authorized.

## Confirmed decision — manual Unavailable status leaves existing listings unchanged (2026-11-17)
- **Manually marking a master inventory item Unavailable must NOT automatically withdraw, end, deactivate, or otherwise modify any already-active marketplace listing.** This follows the same policy as manually marking an item Reserved.
- An Unavailable item cannot be added to new staged listings until explicitly returned to an eligible available state. Existing marketplace listings remain the user's responsibility to manage.
- **Confirmed sales are different:** authoritative sale detection must still trigger the mandatory automatic withdrawal of other marketplace listings for eligible cross-listed items, irrespective of a prior manually set Reserved/Unavailable status.
- No code, schema, or marketplace mutations are authorized by this requirement.

## Confirmed decision — manually restore Reserved/Unavailable items (2026-11-17)
- Users may **manually change Reserved or Unavailable inventory items back to Available** at any time, provided the item is **not sold** and has **no unresolved marketplace operation** that makes releasing it unsafe.
- The transition changes master inventory availability and eligibility for **new** listing staging only; it must not automatically create, republish, or otherwise modify existing marketplace listings.
- Do not permit manual Available status to override confirmed sold disposition, pending/unknown withdrawal, or unresolved marketplace reconciliation. Existing eBay variation exclusivity rules continue to apply.
- No schema, code, or remote marketplace mutation is authorized by this decision.

## Confirmed requirements — bulk status updates and dedicated Master Inventory page (2026-11-17)
- **Bulk status updates are required:** select multiple physical master items and change their status to Available, Reserved, or Unavailable in one operation. Apply the same per-item eligibility safeguards as individual status changes; report successes and blocked rows without silently overriding sold or unresolved items. Bulk manual status updates must not automatically modify already-live marketplace listings.
- **Dedicated full-page Master Inventory UI is required:** add a standalone route/page in the inventory application for exploring, finding, filtering, and editing master inventory records. Do not confine master inventory management to the existing eBay Standard/Variation listing screens.
- **Editable, highly filterable table:** global search and per-column filters; sortable columns; selectable/visible columns; paging; stable row selection; multi-select bulk actions; fast access to item-specific editing and images; clear inventory availability and marketplace listing association indicators. The UI should show eBay-relevant item specifics while remaining usable for comics and other future item types.
- **Technology investigation:** recommend TanStack Table (`@tanstack/react-table`) for table state (sort/filter/selection/pagination/visibility) and custom existing Next.js/React/Tailwind markup for the UI. Its headless nature means editing and form persistence are application responsibilities, not automatically supplied by the library. Current `ebay-ui-app-you-pick/package.json` has Next.js 16, React 19, Tailwind 4, and **does not currently include TanStack Table**; existing `app/listings-table-editable.tsx` is a custom native HTML table. Introducing a focused new table dependency is justified by the requested full-feature inventory grid; avoid rewriting existing listing tables.
- **Performance:** use server-side Supabase filtering, sorting and pagination once inventory grows; never claim only the currently loaded page represents the entire inventory. Bulk selection across filters/pages requires explicit scoped IDs and safe operation semantics. Use narrow projections and lazy-load images/details to minimize bandwidth and client work.
- **Editing recommendation, not yet confirmed:** compact, editable simple cells (e.g., name, condition, purchase price, status) with validation and explicit save, while rich JSONB aspects, descriptions, and image management open a focused item editor/drawer rather than building a heavy spreadsheet clone.
- **Security/integrity:** backend applies status and eBay/listing constraints; do not rely solely on disabled frontend controls. Bulk changes should use a bounded, idempotent endpoint with per-item error reporting. Keep existing explicit publication and 30-day deletion safeguards unchanged.
- **Timing:** implement only after You Pick branches have merged into main and the merged app has passed baseline tests. This is requirements documentation only, not authorization for package installation, frontend modifications, or database migrations.

### Open UX decision
- Should inline edits autosave on blur, or require an explicit Save action? Recommend explicit Save to reduce accidental writes; bulk status changes should require a single explicit Apply action.

### TanStack source
- https://tanstack.com/table/latest/docs/overview — headless engine for filtering, sorting, selection and pagination
- https://tanstack.com/table/latest/docs/framework/react/quick-start — framework integration

## Confirmed decision — explicit saving for Master Inventory editing (2026-11-17)
- **Individual item/cell edits require an explicit Save action.** Do not automatically persist changes on blur or merely when an editor loses focus.
- **Bulk status changes require an explicit Apply action** after the user selects the target inventory rows and desired status.
- Until Save/Apply succeeds, edits remain staged locally; display validation or server errors without pretending they were saved. Backend authorization, eligibility checks, stale-record protection, and per-item results remain required.
- This resolves the Phase 3 Master Inventory page editing-mode decision. No application code, dependency installation, schema changes, or database writes are authorized by this documentation decision.

## Confirmed decision — saved Master Inventory table views (2026-11-17)
- The standalone Master Inventory page **must support user-defined saved filter presets/views**, so the user can restore common table configurations without rebuilding filters each time.
- A saved view should capture relevant search text, column filters, sorting, visible columns, and page size; optionally column order once supported. Reapply criteria against live inventory rather than storing a frozen list of matching item IDs.
- Provide a sensible **default view** and allow users to create, name, select, update, and delete their own views (e.g., Unlisted Sports Cards, Reserved Items, Comics Ready for eBay).
- Keep view preferences separate from master item data; selecting or editing a view must not mutate inventory records or marketplace listings.
- **Open detail:** decide whether column layout/filter view preferences are saved per user or shared across the whole application; for the initial single-operator app, a per-user model is recommended for future extensibility.
- Implementation remains deferred until the You Pick worktrees are merged to main and the merged baseline is verified. No code or schema modification is authorized yet.

## Confirmed operating model — single-user private home-device app (2026-11-17)
- The inventory manager is a **strictly single-user application**, used privately on the owner's home device. Do not design Master Inventory saved views, table settings, or editing flows around multiple user accounts, teams, sharing, or roles.
- **Saved inventory views are application-local/single-operator settings**; no per-user ownership model or shared/private visibility permissions are required. Persist named views and a default view simply, without a multi-tenant access-control layer.
- Keep access/security **proportionate and minimal**, avoiding unnecessary login, role-based access control, user-management UI, and permission abstractions for the private deployment.
- Minimal security does **not** relax safety for external credentials or irreversible/remote operations: keep eBay and other marketplace tokens/secrets server-side; continue validating inventory changes on the backend and enforcing explicit Save/Apply, guarded publication/withdrawal, sold-item disposition, and deletion/reconciliation protections.
- Do not introduce multi-user infrastructure preemptively. Revisit this only if the operating model changes.
- No code, DB migrations, deployment/config changes, or marketplace operations are authorized by this decision.

## Confirmed decision — restore last selected Master Inventory view (2026-11-17)
- Remember the **last selected saved Master Inventory view** across page reloads and application restarts on the single-user home device.
- When the Master Inventory page opens, automatically restore that saved view's filters, sorting, visible columns, and other stored table preferences.
- If the last selected view has been deleted or is invalid, safely fall back to the default view.
- Keep this as simple local/application preference state; no per-account ownership or multi-user synchronization is required.
- Choosing a view or restoring it never modifies inventory records or marketplace listings.
- No code, database, or marketplace mutations are authorized by this design decision.

## Confirmed decision — CSV export of filtered Master Inventory (2026-11-17)
- The Master Inventory page **must support exporting filtered inventory records to CSV** for offline analysis and backup-oriented data extraction.
- Export must respect the active saved-view/search/filter criteria and sorting, and offer the matching result set rather than silently exporting only the currently rendered pagination page.
- Include useful master inventory fields (stable inventory ID, item name/type, condition, availability, acquisition fields where present, and marketplace association/status indicators), with sane spreadsheet-safe CSV escaping. Define a stable column/field policy at implementation; exclude credentials, tokens, and internal secrets.
- CSV export is read-only and must never change inventory, saved views, or marketplace listings. Use server-side streaming/batching for potentially large result sets, avoiding loading the full inventory into the browser.
- CSV is an analysis/portable data export, not a replacement for complete backup and restore of master records, relational links, and R2 image bytes.
- No code, database, or remote mutations are authorized by this documentation decision.

## Confirmed exclusion — no CSV import (2026-11-17)
- **Do not implement CSV inventory import** in the Master Inventory page. There is no need for spreadsheet-based record creation, CSV upload, import preview, or CSV import validation workflows.
- **CSV export remains required** for filtered master inventory data; this is an intentional export-only capability.
- Inventory creation continues through the confirmed capture/manual-entry/backfill workflows rather than CSV ingestion.
- Do not add package dependencies, schema, or frontend complexity for CSV import unless requirements explicitly change.

## Confirmed decision — inventory record creation requires image-supported enrichment (2026-11-17)
- **Do not provide a blank/manual-create inventory item workflow** on the Master Inventory page. Editing existing items manually remains supported with explicit Save; this exclusion concerns creating a new record from scratch.
- **Creation path A — physical item capture:** Use captured item photographs and **Gemini generative AI** to identify the item and fill missing identifying attributes, similar to the existing watcher → listing pipeline. A new master item should begin with rich, useful item data rather than a largely empty manual form. Preserve source evidence and allow later correction of AI-derived values. Do not treat uncertain model guesses as verified facts; expose uncertainty/missing information for review.
- **Creation path B — purchased online auction item:** Create a master inventory record from a **won/purchased online auction listing** by scraping/reusing the available auction listing's item details and images. This is an authorized intake route independent of taking fresh photos. Retain source URL/auction ID and acquisition provenance when available; avoid duplicate records when reprocessing the same purchased source item.
- Both paths must converge on the **same canonical master item schema, unique internal UUID/human inventory ID, images, acquisition fields, and availability lifecycle**. Keep marketplace listing drafts separate from item creation, consistent with earlier optional Master-only vs Master + staged Listing capture choice.
- Existing photos may be reused for the master inventory record as long as the ingestion respects source access/rights constraints; do not silently overwrite user-taken media or delete shared media references. Record whether images were sourced from camera or auction.
- **Open follow-up:** whether auction-sourced item records may be entered as Available before physical delivery, or should remain Pending Receipt until the purchase arrives and the owner verifies possession. This affects cross-marketplace sale safety.
- Implementation remains deferred until the You Pick feature merges into main and passes baseline verification. No scraper, Gemini integration, schema, or application code changes authorized now.

## Confirmed decision — Pending Delivery inventory status (2026-11-17)
- Add a dedicated inventory availability/lifecycle status for **purchased auction items that have not yet physically arrived**. Proposed UI label: **Pending Delivery**; proposed stable internal value: `pending_receipt` (prefer a clear descriptive identifier over abbreviated `pendDeliver`). Naming can be finalized during schema design.
- Newly imported won/purchased online auction items begin in Pending Delivery, retaining their scraped identification, source listing details, images, acquisition provenance, and assigned master inventory ID.
- **Pending Delivery blocks creation/staging/publication of new marketplace listings** until the owner explicitly confirms physical receipt. Do not automatically change to Available because a shipment is marked delivered by a carrier, or simply because time has elapsed.
- After explicit receipt confirmation, transition the item to **Available**, subject to existing sold/unknown-operation and marketplace-exclusivity safeguards.
- Treat Pending Delivery separately from manual Reserved/Unavailable and the Sold/Archived retention lifecycle. No automatic marketplace withdrawal is implied solely by setting this status.
- Existing master item edits continue to require explicit Save. The receipt-confirmation control should be explicit and idempotent.
- No application code, schema, or remote marketplace changes authorized by this requirement decision.

## Confirmed decision — bulk receipt confirmation (2026-11-17)
- On the standalone Master Inventory page, allow selection of **multiple Pending Delivery/Pending Receipt items** and a single explicit **Confirm Received / Apply** action to transition verified physically received items to **Available**.
- Apply the already-confirmed bulk-edit safeguards: explicitly selected records, backend validation of each item's current status and unresolved marketplace operations, per-item success/failure reporting, and retry-safe/idempotent handling. Do not automatically mark an entire purchased auction lot received if the owner selects only a subset of its item records.
- The bulk action is confirmation of **actual physical possession**, not a carrier-delivery inference. Retain original auction source/provenance and media; this does not initiate new marketplace listings.
- Do not affect Reserved, Unavailable, Sold, already Available, or otherwise ineligible records silently. No code/schema/remote operations are authorized by this requirements decision.

## Confirmed decision — reuse auction images as primary inventory/listing media (2026-11-17)
- For items imported digitally from won/purchased online auction listings, **reuse the auction listing's existing item photographs as the primary master inventory images**. This is the intended workflow, designed to avoid additional physical photography and reduce manual work.
- **Do not require new camera/watch captures or separate owner photographs** before creating a master item, confirming receipt, or staging a marketplace listing when usable source images were imported.
- Reuse these imported images for downstream marketplace listings, subject to marketplace image requirements and applicable permission/licensing constraints. Do not impose an automatic preference for newly taken owner photos; the auction-source images are the default.
- Preserve source URL/auction ID and image provenance; import/retain usable image assets in managed storage with stable master-item references and shared-media deletion safeguards. Handle failed downloads or unusable image quality as exceptions rather than requiring recapture for all imports.
- Optional later photographs may be added or replace images by explicit user edit and Save, consistent with the previously approved editable master inventory fields. Do not automatically duplicate or overwrite source images.
- This supersedes the earlier suggestion to prefer newly photographed images for auction-imported items. No production scraping, code, database, or remote marketplace modifications are authorized by this documentation decision.

## Confirmed decision — preserve original auction image bytes (2026-11-17)
- **Preserve auction-imported photographs exactly as downloaded** as the original managed master-inventory image assets. Do not automatically crop, deskew, recompress, re-encode, or otherwise modify those original bytes during import.
- If a destination marketplace requires different dimensions, format, encoding, or other processing, produce a **separate derived copy** for that specific publication flow. Never overwrite the retained original.
- Continue using the preserved imported images by default for inventory display and downstream listings when marketplace-compatible; no new camera capture is required.
- Maintain clear original/derived image provenance and storage references, and apply reference-safe cleanup so neither inventory edits nor listing removal delete an original still owned by a master item.
- This decision applies specifically to **auction-sourced images**, not necessarily images from the existing watcher camera workflow. No implementation or remote writes authorized at this stage.

## Confirmed decision — prevent duplicate purchased-auction imports (2026-11-17)
- Detect when the same purchased online auction listing is imported more than once, using a **source-specific stable auction listing/item ID** together with the source marketplace/site identifier. Normalize source URLs as a fallback when no reliable ID exists; do not rely solely on title, photographs, or AI-derived fields.
- For an already imported source listing, **do not silently create a second master inventory item**. Instead show the existing record and provide a way to inspect/open it.
- Make auction ingestion idempotent across retries, partial image downloads, and interruption/restart, so a failed attempt can safely resume without duplicate records or media ownership inconsistencies.
- **Potential exception to design later:** a purchased auction listing may contain multiple physically distinct items or copies. Source-level duplicate detection must not prevent legitimate separate per-physical-item inventory records from a multi-item lot; distinguish the source purchase/listing from individual identified physical items and avoid re-importing previously imported items.
- No code, schema, scraping, or marketplace mutations are authorized by this requirements decision.

## Confirmed decision — purchased multi-item lots are handled after physical receipt (2026-11-17)
- **Do not automatically unpack, identify, or create per-item master inventory records from purchased auction lots containing multiple physical items.** Source photographs and AI are insufficiently reliable for this complex workflow.
- The owner will **physically receive multi-item lots and process their individual contents manually through the existing camera/watcher image-capture plus Gemini-enrichment workflow**. “Manually” refers to controlling capture and physical item separation, not creating blank master-item forms.
- Keep automatic online auction import for **suitable individually identifiable purchased items** with reusable auction details and photographs, as previously agreed.
- Do not create a master inventory item representing an entire purchased raw lot simply because it was won; this preserves the earlier decision that raw lots are not automatically inventory items.
- Duplicate auction-source handling must distinguish intentionally unsupported multi-item lots from individually importable auction purchases. Do not introduce Gemini-based automatic lot splitting, per-item recognition, or speculative record creation for lots.
- No code, schema, scrape, or marketplace mutations authorized by this requirements decision.

## Confirmed decision — Gemini enrichment is mandatory for every eligible auction-item import (2026-11-17)
- **Every individually identifiable item imported from a purchased online auction MUST run through Gemini enrichment**, regardless of whether the auction's scraped title, description, and other item details appear complete.
- Supply Gemini with the auction's existing images and available listing data so it can identify additional item specifics, identifiers, and other relevant physical-item attributes that the auction seller omitted or described incompletely.
- Merge extracted auction evidence and Gemini-derived details into the same canonical master inventory record, preserving original source data/provenance. Do not silently overwrite a reliable explicit source attribute with a conflicting model guess; surface unresolved conflicts or uncertainty for review.
- This explicitly supersedes the earlier suggestion to invoke Gemini only when scraped auction data is incomplete. Cost optimization must not skip the enrichment pass.
- The multi-item auction-lot exclusion remains: Gemini does not automatically split purchased lots into separate records; the owner physically receives and captures those items through the watcher workflow.
- No code, migrations, scraping, or remote marketplace mutations are authorized by this requirements decision.

## Confirmed decision — automatic auction-import creation, with explicit eBay-only Gemini skip (2026-11-17)
- **Automatically create the master inventory record after auction-source ingestion and enrichment; no mandatory human review/approval gate before creation.** Created records remain editable afterward with the previously confirmed explicit Save action.
- **Default: always run Gemini** for eligible individual-item auction imports, including imports from eBay, to enrich identifiers and item specifics.
- **Narrow exception:** when an item was **purchased directly on eBay** and the source eBay listing already supplies **all applicable item specifics/identifiers**, allow the owner to **explicitly choose Skip Gemini** for that import. This must be an intentional per-import choice, never an automatic inference/silent optimization.
- If Skip Gemini is not explicitly chosen, always run Gemini, even if the eBay source listing appears complete. Do not extend this exception to non-eBay auction sources without a future separate decision.
- When the explicit skip is used, preserve the eBay-provided item specifics and image/source provenance as imported; validate enough source data exists for a usable master item and surface any missing/uncertain fields for later manual editing. Do not fabricate missing attributes.
- Keep the existing exclusion for purchased multi-item auction lots: do not auto-split them into per-physical-item records.
- Ensure duplicate-import/idempotency checks happen before creating a record or redundantly invoking Gemini. Preserve Pending Delivery as the starting status of purchased imported items until explicit receipt confirmation.
- No code, schema, AI integration, marketplace write, or deployment changes authorized by this decision.

## Confirmed decision — manually initiated purchased-auction imports (2026-11-19)
- **Purchased online auction inventory imports must be explicitly initiated by the owner.** Do not automatically detect purchases, poll marketplaces for completed purchases, or automatically create master inventory records from purchase history.
- An import can be initiated by supplying an individual purchased auction listing URL or selecting a specific purchased item through a supported source integration, if available. This is one user-triggered import operation, not an automatic synchronization service.
- Preserve previously confirmed safeguards: suitable single-item purchases only; deduplicate by auction source/item identity; default Gemini enrichment with the explicit skip option only for adequately specified direct eBay purchases; reuse unmodified auction images; automatically create a Pending Delivery master record upon successful import.
- Keep the initial implementation minimal and defer source-specific selector/URL UX decisions until source integrations are scoped. No code, schema, scraping, or marketplace mutations are authorized by this requirement decision.

## Confirmed decision — auction import initiated and resolved in Master Inventory dashboard (2026-11-20)
- The standalone Master Inventory page must provide an **Import from Auction** action to manually initiate import of an eligible individually purchased auction item (e.g., by auction listing URL or supported source selector).
- **Any human-in-the-loop import resolution must happen inside the inventory application's dashboard**, not by expanding browser-extension UI, workflows, or dependencies. Keep browser extensions focused on their existing responsibilities; import orchestration and resolution belong in the application.
- Normal successful imports remain **automatic** without a mandatory review/approval step. Present a dashboard review/resolution UI only when an import requires intervention (e.g., conflicting identifiers, inaccessible/unsuitable source data, missing photos, or an uncertain duplicate). Allow retry or correction without creating duplicate inventory items.
- Preserve the existing decisions: imports are always explicitly user-triggered; single-item purchases only; acquired auction images used as-is; Gemini runs by default with a **user-explicit skip option only for complete direct-eBay purchases**; create Pending Delivery items; handle multi-item lots through physical watcher capture instead; explicit Save/Apply for manual edits.
- Maintain clear in-dashboard import status/errors, with recoverable retry and idempotent source identity; avoid new browser-extension features or broad architectural integrations solely to support import troubleshooting.
- Design and documentation only: implement after You Pick merges into main and passes baseline verification; no code, database changes, scraper integrations, or marketplace mutations authorized now.

## Confirmed decision — durable, recoverable auction import attempts (2026-11-20)
- **Preserve incomplete or failed auction import attempts** in the Master Inventory dashboard, retaining all successfully retrieved auction source information, downloaded image references, Gemini output where available, and actionable error details.
- The user must be able to **inspect, correct, and retry/resume** an interrupted import directly from the dashboard without starting from scratch or redoing successful work.
- Use a **minimal durable import-status mechanism** rather than a new general-purpose workflow engine. Distinguish in-progress, needs-attention/failed, and completed attempts; do not represent a partially completed attempt as a finalized master inventory item unless its creation has actually succeeded.
- Retries must be **idempotent**: preserve stable source identity, avoid duplicate master inventory items or duplicate R2 originals, and execute only missing/failed stages when practicable.
- Automatically completed imports still require **no mandatory human review**; show intervention controls only for exceptions. If successfully created, the item begins **Pending Delivery** as previously agreed.
- Store enough error context to diagnose problems without exposing marketplace credentials or secrets; ensure abandoned temporary assets eventually receive reference-safe cleanup.
- This records requirements only. No code, schema, scraper, Gemini, or remote marketplace mutations are authorized.

## Confirmed decision — exactly one automatic retry for transient auction-import failures (2026-11-20)
- For transient failures in the auction import process (e.g., network timeout, temporary upstream API error, rate limit), allow **at most one automatic retry** of the failed operation after the initial attempt, using a short bounded delay/backoff and respecting an upstream `Retry-After` hint where practical.
- If that single automatic retry also fails, mark the durable import attempt **Needs Attention** and provide the existing in-dashboard manual correction/retry action; do not create unbounded automatic retry loops or restart already successful stages.
- **Permanent/non-retryable failures** (e.g., unsupported multi-item lot, invalid source URL, definitive validation error) go directly to Needs Attention without automatic retry.
- Keep retry operations idempotent, preserve scraped data and downloaded images, and do not create duplicate master items or media during retries. A manual user-initiated retry is distinct from the automatic one-retry allowance.
- No code, schema, scraper, AI, or remote marketplace mutations are authorized by this decision.

## Confirmed navigation and Import Activity UX — four compact top-level destinations (2026-11-20)
- Extend the application's **existing Standard / Variation mode toggle/navigation** with two additional destinations: **Inventory** and **Imports**. Keep navigation compact; conventional navigation links/tabs are acceptable rather than forcing the current toggle control to scale awkwardly.
- **Standard** remains the existing standard listing workflow, and **Variation** remains the existing You Pick variation workflow; preserve their functional behavior and capture-routing rules.
- **Inventory** opens the standalone master-inventory table/dashboard with saved views, search, editing, status management, CSV export, and an entry point to import purchased auction items.
- **Imports** opens a dedicated **Import Activity** workspace listing current/in-progress, successful, and failed/Needs Attention auction imports. Include status, source/item identification, actionable error details, and controls to open/correct/retry the import without losing successfully processed stages.
- A compact global navigation may be implemented as Standard | Variation | Inventory | Imports, using ordinary links or tabs. Avoid building a complex navigation system or extra extension UI.
- The **Import from Auction** action remains accessible from the Inventory dashboard as already confirmed; its progress and exceptions can be managed in Imports. Keep the navigation destinations clear without duplicating the import orchestration logic.
- Preserve all previously agreed retry policy (one automatic retry for transient errors, none for permanent errors), source idempotency, Pending Delivery status, and explicit manual import initiation.
- **Implementation after You Pick merge to main**, following baseline verification; no code, database, or remote marketplace changes authorized by this design decision.

## Confirmed decision — 14-day completed import activity retention (2026-11-20)
- Retain **successful/completed auction import activity/history entries for 14 days (two weeks)**, then automatically prune their transient activity records.
- **Failed / Needs Attention / in-progress attempts must remain available until resolved**, rather than expiring while the owner might still need to inspect, correct, or retry them. Once an attempt succeeds or is explicitly dismissed/resolved, apply the 14-day completed-history retention policy from its resolution timestamp.
- Pruning an import activity entry **must never delete its created master inventory item, retained original images, acquisition provenance, or listing associations**. Keep any minimal stable source identity/deduplication record required to prevent the same purchase from being imported again after its activity history is pruned.
- Import-history cleanup is separate from the **30-day sold-item archival and cleanup** policy. Abandoned temporary assets still require reference-safe cleanup.
- Implementation remains deferred until the You Pick branches merge into main; no code, schema, or remote changes authorized by this documentation update.

## Confirmed decision — manually dismiss failed auction imports (2026-11-20)
- The **Imports** workspace must allow the owner to **manually dismiss a Failed / Needs Attention import attempt** that they do not intend to correct or retry.
- Require an **explicit confirmation** before dismissal. The action closes the incomplete attempt; it must not create, delete, or modify any successfully created master inventory record or marketplace listing.
- Dismissal may release/delete **temporary assets owned exclusively by the abandoned attempt** only after verifying no master inventory item, active import, or other record references them. Preserve shared R2 original images and other retained media.
- Treat the dismissed attempt as **resolved** for the previously confirmed **14-day import activity retention** policy, counting from dismissal time. After that period, prune its transient activity/history record.
- **Keep durable source identity/deduplication separate from transient activity history.** A dismissal of an attempt that never successfully created an item must not incorrectly mark the source purchase as already imported; a later intentional fresh import should be possible. If a master item already exists, preserve the completed-source deduplication record regardless of dismissal or activity pruning.
- Ensure confirmation, action status, and retry-safe handling are managed entirely in the dashboard. No code, database, or remote marketplace mutations are authorized by this requirements decision.

## Confirmed decision — serial auction imports (2026-11-20)
- Process **only one purchased-auction import at a time** in the initial Master Inventory / Imports implementation. Do not run multiple independent auction import pipelines concurrently.
- Keep the UI clear when an import is already in progress. Additional manually initiated imports may be deferred until the active one completes; do not silently launch concurrent scrape, image-download, or Gemini tasks.
- Preserve the previously agreed durable per-import progress, one automatic retry for transient failures, manual Needs Attention recovery/dismissal, and source-based duplicate prevention. Serialize execution without losing recoverable attempts.
- Treat serial import execution as the current implementation scope rather than a permanent prohibition on future concurrency. Avoid implementing speculative parallel-worker infrastructure.
- No application code, database, scraping, or marketplace changes are authorized by this requirements decision.

## Confirmed correction — batch submission with sequential auction-import queue (2026-11-20)
- **Auction purchases arrive in batches; the owner must be able to submit multiple purchased-item URLs in one action** (or otherwise make one batch submission). Repeated manual start/wait/start for each item is unacceptable.
- Maintain **one active import worker at a time** as previously agreed, but automatically **queue the rest of the submitted items and process them sequentially** without requiring user action between successful imports.
- The queue and per-item import progress must be **durable across page navigation, reload, process restarts, and interrupted jobs**. A queued item must not be lost, run concurrently, or inadvertently be imported twice.
- Dashboard **Imports** displays each queued/processing/completed/Needs Attention entry and batch-level progress. An item that requires manual resolution should be retained as Needs Attention and should **not automatically block unrelated queued items**; continue processing the rest where safe.
- Apply the existing **one automatic retry** only to transient errors **per failed operation/item**, then mark that item Needs Attention. Preserve all existing source deduplication, original-image, Gemini, explicit eBay-only Gemini skip, Pending Delivery, and 14-day resolved-history decisions.
- **This supersedes the previously suggested 'block new import until the current finishes' UX.** Manual initiation applies to the **batch**, not a repeated manual initiation for each item. Do not implement speculative concurrent import workers or a complex distributed queue engine; prefer a minimal durable database-backed sequential queue.
- **Open follow-up:** for a mixed batch containing eBay purchases, should the explicit 'Skip Gemini' option be configurable separately for each eligible eBay item? Default remains Gemini on for every item unless explicitly skipped.
- This is a requirements/documentation decision only; no code, schema, external scraping, AI calls, or marketplace mutations are authorized.

## Confirmed decision — explicit per-item Gemini skip within auction import batches (2026-11-20)
- In a manually submitted batch of purchased auction items, provide a **per-item Skip Gemini option** for individually eligible **direct eBay purchases** whose source listing already contains complete relevant item specifics and identifiers.
- **Gemini enrichment is enabled by default on every import item.** Skip must be explicitly selected for each eligible eBay item; selecting Skip for one item must not affect other entries in the same batch, even when they share a source marketplace.
- Non-eBay auction imports continue to **always run Gemini**; do not offer or silently apply Skip Gemini to those items.
- The explicit skip selection must be captured and preserved with that import's queued/durable request so it remains consistent through sequential processing, restarts, and retry/resume. Treat each queued item's configuration independently.
- Before allowing an eBay skip, verify that the scraped eBay listing supplies sufficiently complete applicable item specifics/identifiers. If source data fails that check, require Gemini or surface a clear item-level issue; do not silently create a poorly identified item while claiming enrichment was unnecessary.
- Automatic successful creation, preserved original auction photos, Pending Delivery status, duplicate prevention, and the one-transient-retry rule remain unchanged.
- No code, schema, scraper, AI, or marketplace mutations are authorized by this documentation decision.

## Confirmed decision — cancel individual queued imports (2026-11-20)
- On the **Imports** page, allow the owner to **cancel a single import item that is still queued and has not begun processing**, without canceling or disrupting other items in the same batch.
- Once cancelled, the item must not start processing; remove it from the pending queue atomically, with an unambiguous Cancelled status. Do not create a master item or perform Gemini/image downloads for that cancelled entry.
- Do not silently apply this queued-only cancel action to a currently processing item. Cancellation of in-progress work is a separate, undecided feature and must not be implied by this requirement.
- Other queued items continue normally. Preserve stable source identity/idempotency so a cancelled (never-imported) auction item can be manually queued again later without being mistaken for a previously imported inventory item.
- Treat Cancelled as a resolved import activity state subject to the existing **14-day history retention**; avoid deleting any shared images or existing master inventory records.
- No code, schema, or remote mutations are authorized by this requirements decision.

## Confirmed exclusion — no pause/resume controls for the auction import queue (2026-11-20)
- **Do not add user-facing Pause Queue or Resume Queue controls.** Once a manually submitted batch starts, the sequential worker should continue processing eligible queued items without requiring further user interaction.
- The already-confirmed **per-item cancellation of not-yet-processing queued imports** is sufficient to handle a mistaken or unwanted auction URL. Cancelling a queued item does not interrupt other imports.
- Durability/recovery after application restarts or transient errors is still required; this is automatic operational recovery, **not** a user-controlled queue pause/resume feature.
- Avoid pause-state schema, queue-wide stop controls, and extra UI complexity unless future requirements change.
- No code, schema, or remote operations are authorized by this documentation update.

## Confirmed decision — correct queued URLs by cancel and re-add (2026-11-20)
- **Do not support editing/replacing the URL of an existing queued auction import.** An incorrect URL is corrected by **cancelling the not-yet-processing queue entry and submitting a new import with the correct URL**.
- Retain the previously approved single-item queued cancellation behavior: other imports in the batch continue uninterrupted. The replacement entry is a distinct queued request, checked for source duplicates as usual.
- Avoid queue-entry editing controls, mutable source identities, or special URL-replacement logic. Do not permit changing the URL of an import that has already begun processing.
- This does not alter the durable recovery and dashboard correction of failed/Needs Attention imports, which may require fixing recoverable import metadata without rewriting the identity of an existing queued request.
- This is requirements documentation only; no application code, database schema, or marketplace mutations are authorized.

## Confirmed decision — validate and deduplicate auction URLs before queuing (2026-11-20)
- On submitting an auction import batch, **prevalidate every supplied URL before starting the sequential queue**. Detect empty/malformed URLs, unsupported auction sources, duplicate URLs within the same submitted batch, and sources already successfully imported or currently queued/processing when reliably identifiable.
- Normalize source URLs and extract stable provider listing/item IDs where possible. Deduplicate using source plus stable item ID, not only literal URL equality, so tracking/query variants do not bypass protection.
- **Show per-entry validation results before submission** and exclude invalid/duplicate entries from processing; allow all valid entries to proceed together without restarting the entire batch. Provide a link to an existing inventory record where the purchase has already been imported.
- Keep validation lightweight: a preliminary URL/identity check should not trigger unnecessary scraping, Gemini calls, or image downloads. If duplicate/unsupported-source facts become clear only during processing, handle the item through the existing per-import Needs Attention/deduplication flow and continue the remaining queue.
- The user must be able to fix incorrect entries by the already agreed **cancel and re-add** approach, not by editing the identity of an active queued import.
- No code, schema, scraper, Gemini, or external marketplace mutations are authorized by this design decision.

## Confirmed decision — multiline URL entry for auction import batches (2026-11-20)
- The **Import from Auction** interface must allow the owner to **paste multiple auction listing URLs in one multiline text field**, with **one URL per line**.
- Parse nonempty lines into individual import candidates; trim surrounding whitespace and ignore blank lines. Show the previously confirmed preflight checks for URL validity, supported sources, and duplicate source identities before queue submission.
- Each accepted URL becomes a distinct **durable sequential queue entry**, inheriting the already confirmed per-item eBay-only explicit Gemini skip setting, cancellation, retry, Needs Attention recovery, and source idempotency behavior.
- Keep the UX lightweight; **no CSV/file upload or separate bulk-import document format is needed**. Valid entries should proceed without being blocked by invalid or duplicate lines.
- This resolves the batch entry method. No application code, database schema, AI integration, or marketplace mutations are authorized by this documentation update.

## Confirmed decision — compact batch progress summary on Imports page (2026-11-20)
- Show a **compact batch-level progress summary** above the import activity table, counting items by status: **Queued, Processing, Completed, Needs Attention/Failed, and Cancelled**.
- Derive counts from the durable import queue/activity records, not from only the visible paginated rows. Counts must update as sequential processing proceeds and remain accurate after reload/restart.
- Keep the summary read-only and simple; existing per-item actions for queued cancellation and failed-import resolution remain in the activity table.
- Distinguish completed imports from the master inventory records they created; the 14-day resolved activity retention still applies, and pruning activity never affects retained inventory.
- No code, schema, scraping, AI, or marketplace changes are authorized by this requirements decision.

## Confirmed decision — submit new auction batches while sequential processing is active (2026-11-21)
- Allow the owner to **submit additional auction URL batches even while an earlier batch is still processing**.
- Prevalidate and deduplicate each newly submitted batch, then **append its accepted import items to the end of the existing durable FIFO queue**. Do not interrupt or restart the currently processing item or previously queued items.
- Continue enforcing **exactly one active import at a time** across all batches; do not introduce parallel workers or a manual pause/resume mechanism.
- The Imports page must show batch-specific status summaries and allow each queued import to be cancelled individually before processing, regardless of which batch submitted it.
- Persist source identity, per-item explicit eBay-only Gemini-skip choices, batch association, queue order, progress, and failures across app restarts. A failed item enters Needs Attention without preventing later queued items from proceeding when safe.
- This applies the already approved batch intake and recovery rules. No code, schema, marketplace, or other production mutations are authorized by this requirements update.

## Confirmed exclusion — no bulk Retry All Failed action (2026-11-21)
- Do **not** add a **Retry All Failed** action to the Imports page. Failed/Needs Attention import attempts must be reviewed and retried **individually** by the operator.
- Preserve existing one automatic retry for transient failures on each operation, per-item manual correction/retry, and continued sequential processing of unrelated queued imports.
- Avoid accidentally resubmitting all failed requests or hiding persistent import errors behind bulk retry behavior.
- No application code, schema, marketplace or production changes are authorized by this requirements decision.

## Confirmed decision — completed imports link to their master inventory items (2026-11-21)
- Each successfully completed import row on the Imports page provides a **View Inventory Item** link to the exact master inventory record created or reused by that import.
- Keep inventory editing on the Inventory item view; do not duplicate editing functionality in the Imports page.
- The link must use the persisted master inventory item identity, not a guessed title, URL, or source listing ID. Do not show a created-item link for an import that never created or resolved to a master record.
- No implementation, schema, or production mutation is authorized by this requirement.

## Confirmed decision — retain clickable source auction listing (2026-11-21)
- For each auction-imported physical item, preserve the **original source auction URL** as purchase provenance and show a clickable **View Original Auction** link on the master inventory item detail view.
- Retain source name and provider/listing ID (when available) alongside the URL; keep this provenance even if the external auction page later expires or becomes inaccessible.
- Never treat the external URL as the inventory item's permanent identity; continue using the immutable master item ID and normalized provider/listing identity for import deduplication.
- This is a documentation-only requirement; no application code, schema, marketplace, or production changes are authorized.

## Confirmed decision — import timestamp separate from purchase date (2026-11-21)
- Automatically record the **date and time an auction import completes / the master inventory item is created** as an import timestamp, distinct from the user-entered or source-derived **purchase date**.
- Capture this timestamp without additional operator input. Use an unambiguous stored instant (UTC) and display it in the user's local time.
- Retain this timestamp as inventory provenance; do not overwrite the original import time during subsequent edits or retries of the same successfully imported item.
- This is requirements documentation only; no code, database, or marketplace mutations are authorized.
