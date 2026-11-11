# YP9.6c4 — removal provenance and image-reference writer audit

**Status:** independently verified read-only source audit, 2026-11-10. No migration applied, freeze activated, cleanup executor added, remote resource read, or production deletion performed.

## 1. Effective lineage and trust boundary

| Stage | Source of truth / entry point | What it proves and does not prove |
| --- | --- | --- |
| Stage/remove intent and frozen revision | Intent staging: `stage_variation_listing_permanent_removal` in `supabase/migrations/20261021181500_stage_variation_listing_permanent_removal.sql`; c2 capture: `capture_variation_listing_permanent_removal_revision` in `20261021193000_execute_variation_listing_permanent_removal.sql` | Staging records the removal intent. c2 validates the digest-bound v3 snapshot, operation, target, and survivor structure and creates a transaction-local capability, but does **not** check target zero. c2b `prepare_variation_listing_removed_sku_remote_retirement` in `20261023190000_durable_removed_sku_remote_retirement.sql` performs the target inventory/offer/sellable-zero checks (lines 299–305). |
| Membership checkpoint | `supabase/migrations/20261021193000_execute_variation_listing_permanent_removal.sql`: `append_variation_listing_permanent_removal_checkpoint` | Ordered lifecycle checkpoint; append accepts caller JSON under lifecycle/shape rules. Exact frozen-projection matching is enforced when c2 finalization/c2b preparation consumes the terminal checkpoint, not by append alone. |
| c2 finalization | `supabase/migrations/20261021193000_execute_variation_listing_permanent_removal.sql`: `confirm_variation_listing_permanent_removal` | Database lineage, write shape, locks, and survivor/copy rechecks; it is no longer directly executable by `service_role` after `20261023190000`. |
| c2b retirement and effective wrapper | `supabase/migrations/20261023190000_durable_removed_sku_remote_retirement.sql`: `prepare_variation_listing_removed_sku_remote_retirement`, `complete_variation_listing_removed_sku_remote_retirement`, `confirm_variation_listing_permanent_removal_after_remote_retirement` (PostgreSQL may truncate the runtime RPC identifier) | Persists c2 revision/checkpoint identity and exact target/SKU/offer/listing metadata. The wrapper gates c2 and revokes direct c2 `service_role` execution, but c2b completion still validates caller-provided JSON; neither RPC queries eBay nor authenticates a human operator. |
| Original image ownership | Removed target copy rows in the immutable v3 `snapshot.confirmed.aggregate.copies` | Captured front/back R2 keys, copy identities, and source references for that historical snapshot; not a live exclusive-owner registry. |
| Current diagnostic witness | `supabase/migrations/20261023140500_read_only_variation_removed_sku_ownership_witness.sql` | Read-only consistency/reference observations only. It reports `sameGroupHistoricalReferencesVerified:false`, `journalHistoryVerified:false`, and `referenceSearchComplete:false`; zero findings are not a freeze or deletion authority. |

**Trust boundary:** c2/c2b provide strong DB lineage and write-shape evidence, not independent remote truth or human approval. A safe future flow reuses the effective c2b row and linked c2 checkpoint, obtains a fresh independent eBay read, and requires a separately authenticated operator confirmation. Do not add a duplicate generic identity schema unless a missing trust predicate is demonstrated.

## 2. Confirmed writers and reference stores

### Confirmed new-owner writers

| Domain | Writer / source | Stored references |
| --- | --- | --- |
| Variation | `complete_variation_listing_new_variation` in `20260831170000_simplify_variation_listing_persistence.sql` | Inserts `variation_listing_copies.front_r2_key/back_r2_key` and its variation/group rows. |
| Variation | Latest `complete_variation_listing_duplicate_copy` replacement in `20261005153617_add_variation_listing_quantity_adjustment.sql` | Inserts front/back keys; `service_role` has SELECT-only table access and RPC execution is the write seam. |
| Standard | `services/watcher-service/src/data/listings.ts` watcher insert | Inserts `listings.image_urls` and empty `r2_object_keys`. |
| Standard | `services/sidecar/src/http/data-router.ts` generic create (`POST /listings`) | Inserts caller-supplied `image_urls` and initializes `r2_object_keys`. |
| Standard | Same router image URL patch (`PATCH /listings/:listingId/image-urls`) | Replaces `image_urls` through `saveImageMetadata`. |
| Standard | `services/sidecar/src/jobs/prepare-record-created-listings.ts` record-created asset pipeline | Writes uploaded `image_urls` and `r2_object_keys`. |
| Standard | `services/sidecar/src/data/upload-listing-image.ts` upload append | Appends a public URL and R2 key through the CAS-aware metadata save. |
| Standard | `packages/data/src/repositories/listings.ts`: `saveListingArtifacts`, `saveListingImageMetadata` | Generic update/save artifact surface, callable or dormant, writes both arrays. |
| Standard | Direct `listings` DML as `service_role` | `20260601194206_explicit_api_table_grants.sql` grants `ALL`; SQL/PostgREST callers can bypass the application writer inventory. |

### Reference/evidence stores not proven to be live owners

- `variation_listing_revisions.snapshot` and `operation_plan` (dedicated and generic revision paths), plus `variation_listing_publishing_checkpoints.evidence`: historical evidence/reference; they may contain keys/URLs but are not live consumers.
- c2b retirement `evidence` and identity fields: durable caller-supplied remote evidence bound to c2 lineage, not an eBay query.
- `20261026140000_c2b_removal01_incident_repair.sql`: incident `corrected_group_payload` and `evidence`; immutable historical repair/reference state, not a current owner.
- Unapplied EXEC1 `variation_listing_removed_sku_cleanup_journals` / `_resources`: caller-supplied local/R2 resource identities with CAS lifecycle; registry/reference only, `operator_confirmed` and `deletion_authorized` are constrained false.
- Revisions/plans in other groups, Standard arrays, URLs, and any additional JSON/text consumer: must be searched at implementation time. The witness currently scans only current copies/Standard arrays and selected other-group revision/plan references; same-group history, journal completeness, and arbitrary JSON consumers remain unresolved. Distinguish historical evidence/reference from a live owner/consumer before deriving a deletion set.

## 3. Lock and freeze design constraints

1. Variation writers and freeze must preserve existing **session → group** ordering, then acquire sorted distinct resource locks. Include all old and new key/source references affected by an update, not only the final value.
2. Standard writes need one implementable row/key contract: an UPDATE may lock its existing Standard row first and then acquire canonical keys; an INSERT has no row, so it must acquire canonical keys, then check the frozen marker, then insert. Freeze acquires canonical keys and performs its final scan **without** key → `FOR UPDATE` Standard-row locks, avoiding a row/key cycle. Missing-row keys still require phantom protection: a READ COMMITTED fresh final scan after locks, or SERIALIZABLE with bounded retry.
3. Use cooperative advisory/key locks only if every relevant RPC, trigger, direct-DML path, and service-role caller participates. Canonicalize URL/key identities before locking and use one stable two-key order (front/back or lexical) to prevent opposite-order deadlocks.
4. A point-in-time witness is insufficient. Freeze must lock keys before its final reference scan and reject any live/cross-owner reference; external R2 writers and macOS source-path replacement remain outside database control.

## Offline prototype — synthetic, unapplied, independently verified

Two test-only files exercise a limited reference-lock contract without touching the production schema: `packages/data/tests/removed-sku-reference-freeze.prototype.sql` defines synthetic Variation/Standard reference tables, an administrator-seeded retirement proof and non-authorizing frozen-key rows; `packages/data/tests/validate-variation-removed-sku-freeze-prototype.mjs` runs isolated PostgreSQL 17 Docker transactions with real simultaneous sessions. The 2026-11-10 run passed exact SQLSTATE/message assertions for writer→freeze and freeze→writer contention, fresh missing-row phantom protection, direct Standard INSERT/UPDATE of keys and `image_urls`, Variation INSERT/UPDATE, rollback lock release, simultaneous opposite-order two-key contention with a database lock-wait observation, same-revision idempotence, cross-revision frozen-key collision rollback, null/duplicate/malformed/encoded key and URL rejection (including direct-plus-URL duplicate identity), forged/wrong/incomplete proof, role ACLs, and `deletion_authorized:false`. All identifiers are synthetic, and the fixture grants no deletion capability.

**Not a deployable migration:** the fixture's proof row is manually seeded and cannot authenticate actual c2/c2b provenance; the test-only URL grammar accepts one canonical `images.invalid/variation-listing/...` shape plus safe unrelated synthetic URLs, rejects encoded/ambiguous `images.invalid` spellings before Variation detection, and does not model real Standard URL hosts/encodings; the tables are not the real `listings` / `variation_listing_copies` or their RPCs, and current history/reference scans remain incomplete. The PostgreSQL transaction-lock protocol relies on every real writer taking the same locks; external R2 writers and local-file TOCTOU remain outside this proof. Derive trusted keys from the existing terminal v3/c2b chain, inventory every real writer/URL encoding, test on the real schema and create a separate additive migration with the available Supabase CLI only after separate authorization. Do not apply it or enable cleanup.

## Real-schema adapter spike — untested, no migration

`packages/data/tests/removed-sku-real-schema-freeze.prototype.sql` now provides a **test-only** bridge from the verified synthetic key-lock guard to actual `public.variation_listing_copies.front_r2_key/back_r2_key` and `public.listings.r2_object_keys/image_urls` (`text[]`) insert/update triggers. It also supplies a read-only inspection function that joins a `confirmed_complete` c2b remote-retirement record to the frozen v3 revision, linked c2 terminal checkpoint, and the existing read-only ownership witness; results return `referenceFreezeAuthorized:false` and `deletionAuthorized:false` even with matching identities. No trigger or function grants the ability to insert a frozen row or delete images.

**Not yet tested. Not for deployment:** the bridge depends on synthetic `yp_c4_probe` functions and marker table, and the Standard URL parser recognizes only the synthetic `images.invalid` grammar. It does not prove all possible production URL forms, all active writers, R2 external writer isolation, or actual c2b evidence provenance. It cannot be treated as an authorizing freeze. Next independently test against the full effective local SQL schema with direct service-role Standard DML, both Variation intake RPCs, existing trigger order, missing-row/write races and current image URL fixtures; only then consider creating a separate, unapplied migration via the installed Supabase CLI. Never run this test-only SQL on a hosted project.

## 4. Smallest safe next proof (disposable PostgreSQL only)

The verified disposable scope covers both lock orders (writer→freeze and freeze→writer), missing-key phantom inserts, simultaneous opposite-order two-key contention, rollback, fresh final scans, direct synthetic Standard/Variation DML, key/URL canonicalization, proof rejection, and ACL/search-path boundaries. It does not cover real Variation RPCs, stale/CAS races, forged c2 checkpoint/c2b completion JSON, complete writer inventory, SERIALIZABLE retry, hosted data, eBay, R2, or local-file operations. Do not deploy or run destructive work on this proof.

No cleanup freeze is active and no deletion is authorized by this audit.
