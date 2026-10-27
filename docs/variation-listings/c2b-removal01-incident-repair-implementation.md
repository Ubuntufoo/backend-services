# C2BRemoval01 incident repair: offline implementation

Date: 2026-10-27
Status: provider ordering correction and disabled offline authorization gateway implemented; hosted migration and Sandbox mutation gates remain closed

The offline implementation adds an incident-bound repair ledger, typed RPC client, exact-state classifier, strictly read-only inspection path, and an injected recovery state machine for the held Sandbox revision. Its incident gateway is disabled by default, has no live Supabase/eBay binding, and never constructs a mutating client or credentials. The migration file has not been applied to any database. Verification used seller-verified Sandbox GETs, the read-equivalent Trading GetUser protocol call, bounded canonical Supabase SELECTs, and offline injected stores/remotes only. No eBay mutation, hosted Supabase mutation, journal change, service restart, Item/Offer deletion, local finalization, or image cleanup was performed.

## Frozen identity

The implementation is permanently bound to seller `testuser_variationbuyer`, marketplace `EBAY_US`, listing `110591443545`, group `VL-G-586051B7970A45BDA53A1D1A10285B42` / `586051b7-970a-45bd-a53a-1d1a10285b42`, revision `0f8a4786-12a3-45d9-b293-63e2a6318260`, snapshot digest `602f38a42f0beb0f940a6f222c105ffa0914bbe0b0d3eff03a2830a0a6737727`, and desired/confirmed revisions `6/5`. Target SKU/Offer is `BSKBL-C2BRemoval01-000001` / `11951367010`; survivors are `000002` / `11951368010` and `000003` / `11951369010`, each quantity one.

Selector strings are not copied from the sanitized preflight report or supplied by UI state. eBay Group `variantSKUs` and `Card` values are validated as independent unique collections; their indices never establish per-SKU ownership. Ownership comes only from immutable confirmed variation rows plus each exact frozen Item `product.aspects.Card`. The corrected two-SKU group payload is projected in immutable survivor order, and its canonical digest must exactly match the SQL projection from immutable common fields before the plan is accepted. Three-SKU membership with only two selectors, two-SKU membership with three selectors, duplicate/missing/foreign selectors, nonempty group images, changed common fields, overlength selectors, Item ownership drift, or a digest mismatch fails closed. The original malformed replacement, frozen revision, and its `started -> unknown` checkpoints remain immutable.

The exact read-only verification observed Group membership `000002,000003,000001` and Group Card values in independent A,B,C order. Exact Item reads and the immutable confirmed aggregate both map A→A, B→B, C→C. Through the established semantic response normalizers, the real adapter produced the B,C replacement with only B,C Card values and canonical digest `e7352fbf7f86089af8740d3b0166f38292861877d66d296ea1a40f69df5a6d9e`; that digest exactly matched the unapplied SQL projection. The full seller/group/Item/exhaustive-Offer classifier returned `EXACT_PRE`. This is evidence for a future separately authorized repair, not authorization to prepare a ledger row or issue a PUT.

## Durable state and at-most-one write

The additive ledger states are `planned`, `started`, `unknown`, `confirmed_post`, and `reconciled_post`. Identity and corrected payload are immutable; application roles receive no direct table privileges. Service-role RPCs serialize intake sessions, group, revision, then ledger and enforce the exact incident CAS.

- Inspection/classification is read-only for every ledger state and remote state, including a missing row and `EXACT_CORRECTED_POST`; it calls only `ledger.load` plus seller/group/Item/exhaustive Offer reads. A missing row remains absent/unprepared and is never implicitly changed to `planned`.
- `planned + EXACT_PRE`: the disabled gateway can write only in a separately authorized `prepare`/`one-put` phase. It must persist `planned` and then `started` before the sole corrected group PUT; an omitted, invalid, expired, foreign, replayed, or out-of-scope authority performs no write.
- `planned + EXACT_CORRECTED_POST`: the read-only path reports the exact post-state without resolving it. A separately authorized `resolve-post` phase may persist `reconciled_post`; it must never issue a PUT.
- `started` or `unknown`: GET-only reconciliation. Never return to `planned` and never issue another PUT.
- exact corrected post after a started write: only separately authorized `resolve-post` may persist `confirmed_post`, then use the guarded bridge to append the legal attempt-1 checkpoint-3 c2 terminal event.
- `MIXED` or `UNKNOWN`: stop. No terminal c2 event, c2b preparation, delete, or local finalization.

A crash after durable `started` but before the process can prove whether the outbound request began is intentionally stranded. Database locking cannot create a distributed transaction with eBay. Preserving `started` and permitting only reconciliation is the at-most-one guarantee; recovery may require a new operator decision, never an automatic retry.

## Evidence boundary

The classifier requires the exact Sandbox seller, exact group/common payload, all three Items, and fully paginated all-marketplace Offers for every SKU. It requires exact Offer IDs, marketplace, listing, quantities, publication/lifecycle states, Item group membership, child images, and normalized non-quantity payloads. Missing pages, duplicate or foreign Offers, identity drift, image drift, unexpected status, or ambiguous listing identity returns `MIXED`/`UNKNOWN` and blocks mutation.

The c2b survivor verifier now performs an exhaustive all-marketplace identity/status/listing/quantity read for both survivors before retaining its marketplace-scoped full-payload/lifecycle comparison. A hidden second-marketplace Offer blocks target deletion and local finalization.

## Required operator sequence after offline implementation

1. Review and commit the local implementation if desired; this run does neither.
2. Gate A: separately authorize the exact incident migration only through a reviewed single-migration mechanism. Never use broad `supabase db push`; verify project identity, migration history, SQL hash, ACLs, schema, and function fingerprints afterward.
3. Refresh seller-verified, fully paginated read-only evidence. Require `EXACT_PRE` and exact local CAS `6/5`.
4. Gate B: separately authorize one incident-specific Sandbox group PUT with an exact run-bound attestation naming seller, environment, marketplace, listing, group, revision, payload digest, and allowed `one-put` phase. Persist `started` before the outbound call. A lost response is `unknown`; do not retry.
5. Gate B resolve-post: after fresh exact post evidence, separately authorize `resolve-post`; only that phase may persist post state and append checkpoint 3 through the guarded bridge.
6. Gate C: obtain separate authorization for c2b remote Item/Offer retirement and local finalization. The repair does not authorize either.
7. Gate D: obtain separate authorization for exclusive local/R2 image cleanup. No cleanup is coupled to repair or c2b.

No general Retry, Publish Changes, router, UI, or background worker is wired to this incident path. The gateway is incident-specific, injected, disabled by default, and offline-only; no live binding or operator authority has been issued. Inspection is strictly no-write, and future mutating calls require phase-specific incident-bound authorization rather than a raw boolean approval. The in-memory single-use authority is a test seam, not tamper-proof or cross-process security; enabling a live adapter requires a trusted signed/replay-protected operator mechanism and another review.

The disposable PostgreSQL 17 validators previously verified the local migration chain, schema/RLS/ACL guards, evidence denials, and historical transition/concurrency behavior. The exact mode-0600 historical snapshot fixture is unavailable for this run, so that transition/concurrency proof is not current-run evidence. The private SQL evidence helper independently validates the historical three-SKU/three-Card collections, exact Item payload-map keys, and each frozen Item `product.aspects.Card` ownership against immutable confirmed SKU rows; a synthetic B,C,A SKU / A,B,C Card snapshot passes while wrong Item Card and missing/foreign/duplicate Group SKU/Card cases fail closed. These offline results and the live read-only ordering proof authorize no hosted migration or eBay mutation.

The additive migration remains unapplied. Its private helper is revoked from public, anon, authenticated, and service_role; incident-bound RPCs remain service-role-only. The exact historical transition/concurrency fixture was unavailable, so this run does not claim fresh SQL terminal-bridge proof; any hosted migration and live resolution still require separate review and authorization. No hosted apply, repair-ledger preparation, eBay write, journal mutation, c2b action, cleanup, commit, or push is authorized by this offline proof.
