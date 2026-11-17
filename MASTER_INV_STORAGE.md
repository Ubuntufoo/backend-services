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
