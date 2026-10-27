# C2BRemoval01 incident repair: Stage 1 implementation

Date: 2026-10-26  
Status: provider ordering correction and read-only exact-pre proof verified; mutation gates remain closed

Stage 1 adds an incident-bound repair ledger, typed RPC client, exact-state classifier, and injected recovery state machine for the held Sandbox revision. The migration file has not been applied to any database. This verification used seller-verified Sandbox GETs, the read-equivalent Trading GetUser protocol call, and bounded canonical Supabase SELECTs only. No eBay mutation, hosted Supabase mutation, journal change, service restart, Item/Offer deletion, local finalization, or image cleanup was performed.

## Frozen identity

The implementation is permanently bound to seller `testuser_variationbuyer`, marketplace `EBAY_US`, listing `110591443545`, group `VL-G-586051B7970A45BDA53A1D1A10285B42` / `586051b7-970a-45bd-a53a-1d1a10285b42`, revision `0f8a4786-12a3-45d9-b293-63e2a6318260`, snapshot digest `602f38a42f0beb0f940a6f222c105ffa0914bbe0b0d3eff03a2830a0a6737727`, and desired/confirmed revisions `6/5`. Target SKU/Offer is `BSKBL-C2BRemoval01-000001` / `11951367010`; survivors are `000002` / `11951368010` and `000003` / `11951369010`, each quantity one.

Selector strings are not copied from the sanitized preflight report or supplied by UI state. eBay Group `variantSKUs` and `Card` values are validated as independent unique collections; their indices never establish per-SKU ownership. Ownership comes only from immutable confirmed variation rows plus each exact frozen Item `product.aspects.Card`. The corrected two-SKU group payload is projected in immutable survivor order, and its canonical digest must exactly match the SQL projection from immutable common fields before the plan is accepted. Three-SKU membership with only two selectors, two-SKU membership with three selectors, duplicate/missing/foreign selectors, nonempty group images, changed common fields, overlength selectors, Item ownership drift, or a digest mismatch fails closed. The original malformed replacement, frozen revision, and its `started -> unknown` checkpoints remain immutable.

The exact read-only verification observed Group membership `000002,000003,000001` and Group Card values in independent A,B,C order. Exact Item reads and the immutable confirmed aggregate both map A→A, B→B, C→C. Through the established semantic response normalizers, the real adapter produced the B,C replacement with only B,C Card values and canonical digest `e7352fbf7f86089af8740d3b0166f38292861877d66d296ea1a40f69df5a6d9e`; that digest exactly matched the unapplied SQL projection. The full seller/group/Item/exhaustive-Offer classifier returned `EXACT_PRE`. This is evidence for a future separately authorized repair, not authorization to prepare a ledger row or issue a PUT.

## Durable state and at-most-one write

The additive ledger states are `planned`, `started`, `unknown`, `confirmed_post`, and `reconciled_post`. Identity and corrected payload are immutable; application roles receive no direct table privileges. Service-role RPCs serialize intake sessions, group, revision, then ledger and enforce the exact incident CAS.

- `planned + EXACT_PRE`: Stage 1 returns without writing by default. A future separately authorized executor may atomically persist `started`, then issue the sole corrected group PUT.
- `planned + EXACT_CORRECTED_POST`: persist `reconciled_post`; issue no PUT.
- `started` or `unknown`: GET-only reconciliation. Never return to `planned` and never issue another PUT.
- exact corrected post after a started write: persist `confirmed_post`, then use the guarded bridge to append the legal attempt-1 checkpoint-3 c2 terminal event.
- `MIXED` or `UNKNOWN`: stop. No terminal c2 event, c2b preparation, delete, or local finalization.

A crash after durable `started` but before the process can prove whether the outbound request began is intentionally stranded. Database locking cannot create a distributed transaction with eBay. Preserving `started` and permitting only reconciliation is the at-most-one guarantee; recovery may require a new operator decision, never an automatic retry.

## Evidence boundary

The classifier requires the exact Sandbox seller, exact group/common payload, all three Items, and fully paginated all-marketplace Offers for every SKU. It requires exact Offer IDs, marketplace, listing, quantities, publication/lifecycle states, Item group membership, child images, and normalized non-quantity payloads. Missing pages, duplicate or foreign Offers, identity drift, image drift, unexpected status, or ambiguous listing identity returns `MIXED`/`UNKNOWN` and blocks mutation.

The c2b survivor verifier now performs an exhaustive all-marketplace identity/status/listing/quantity read for both survivors before retaining its marketplace-scoped full-payload/lifecycle comparison. A hidden second-marketplace Offer blocks target deletion and local finalization.

## Required operator sequence after Stage 1

1. Review and commit the local implementation if desired; this run does neither.
2. Separately authorize and apply the additive migration to the canonical project. Verify project identity, migration history, ACLs, schema, and function fingerprints afterward.
3. Refresh seller-verified, fully paginated read-only evidence. Require `EXACT_PRE` and exact local CAS `6/5`.
4. Separately authorize one incident-specific Sandbox group PUT with an exact run-bound attestation. Persist `started` before the outbound call. A lost response is `unknown`; do not retry.
5. Re-read seller, group, Items, and all-marketplace Offers. Only exact corrected post may durably resolve c2 through the guarded bridge.
6. Obtain separate authorization for c2b remote Item retirement and local finalization. The repair does not authorize either.
7. Obtain separate authorization for local/R2 image cleanup. No cleanup is coupled to repair or c2b.

No general Retry, Publish Changes, router, UI, or background worker is wired to this incident path. The recovery service exposes injected read/mutate/ledger seams for offline tests; its approval gate defaults false and there is no production gateway construction in Stage 1.

The disposable PostgreSQL 17 validators apply the full local migration chain and verify schema, RLS, service-role-only RPC ACLs, direct-write denial, null-safe evidence-field rejection, and lock/bridge guards. A bounded canonical read-only export supplied the exact incident group, three variations, three copies, immutable revision, and two checkpoints to a mode-0600 temporary fixture. Local-only RPC execution verified the canonical snapshot digest, duplicate prepare, stale CAS denial, concurrent start with one winner, started→unknown, exact-post marking, concurrent/idempotent terminal bridge with one checkpoint 3, preservation of checkpoints 1 and 2, role denial, and forged/missing/null evidence rejection. This SQL proof and the live read-only ordering proof authorize no hosted migration or eBay mutation.

The current SQL projection is order-independent and bound to the exact canonical snapshot digest. It does not separately revalidate every frozen Item Card aspect or all historical Group collection-shape details inside the RPC; the TypeScript adapter does. That defense-in-depth gap requires a separate migration review because this verification prohibited SQL edits. It does not relax the current fail-closed adapter or authorize hosted apply.
